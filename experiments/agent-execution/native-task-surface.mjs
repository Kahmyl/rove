#!/usr/bin/env node

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process, { loadEnvFile } from "node:process";
import readline from "node:readline";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const repositoryEnvironment = join(repositoryRoot, ".env");
if (existsSync(repositoryEnvironment)) loadEnvFile(repositoryEnvironment);
const requireBrowserDependency = createRequire(
  join(repositoryRoot, "packages/browser/package.json"),
);
const requireCompanionDependency = createRequire(
  join(repositoryRoot, "apps/companion/package.json"),
);
const { _electron: electron } = requireBrowserDependency("playwright");
const packagedExecutablePath = join(
  repositoryRoot,
  "release/artifacts/mac-arm64/Rove.app/Contents/MacOS/Rove",
);
const sourceCompanionDirectory = join(repositoryRoot, "apps/companion");
const outputRoot = join(
  repositoryRoot,
  "artifacts/verification/browser-acceptance",
);

function readMode() {
  const argument = process.argv.find((value) => value.startsWith("--mode="));
  const mode = argument?.slice("--mode=".length) ?? "local";
  if (mode !== "local" && mode !== "packaged") {
    throw new Error("--mode must be either local or packaged.");
  }
  return mode;
}

const mode = readMode();
const executablePath =
  mode === "local"
    ? requireCompanionDependency("electron")
    : packagedExecutablePath;
const electronUserDataDirectory = await mkdtemp(
  join(tmpdir(), "rove-native-task-surface-"),
);
const launchArgs =
  mode === "local"
    ? [
        ".",
        "--rove-manage-services",
        `--user-data-dir=${electronUserDataDirectory}`,
      ]
    : [];

await mkdir(outputRoot, { recursive: true });

const electronApp = await electron
  .launch({
    executablePath,
    cwd: mode === "local" ? sourceCompanionDirectory : repositoryRoot,
    args: launchArgs,
  })
  .catch(async (error) => {
    await rm(electronUserDataDirectory, { recursive: true, force: true });
    throw error;
  });

function redact(value) {
  return String(value)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(
      /\b(?:token|secret|cookie|authorization)\s*[=:]\s*\S+/gi,
      "$1=[redacted]",
    )
    .replace(/\/Users\/[^\s"']+/g, "[redacted-local-path]")
    .replace(
      /ws:\/\/127\.0\.0\.1:\d+\/\S+/g,
      "[redacted-local-debug-endpoint]",
    );
}

const child = electronApp.process();
let cleaned = false;

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  await electronApp.close().catch(() => undefined);
  await rm(electronUserDataDirectory, { recursive: true, force: true });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(128));
  });
}
child.stdout?.on("data", (chunk) => {
  process.stderr.write(`[rove-stdout] ${redact(chunk)}\n`);
});
child.stderr?.on("data", (chunk) => {
  process.stderr.write(`[rove-stderr] ${redact(chunk)}\n`);
});

let page;
try {
  // Rove starts as a tray application. A normal second launch asks the first
  // instance to reveal the full product window.
  const reveal = spawn(executablePath, launchArgs, {
    cwd: mode === "local" ? sourceCompanionDirectory : repositoryRoot,
    stdio: "ignore",
  });
  reveal.unref();
  page = await electronApp.firstWindow({ timeout: 30_000 });
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      ready: false,
      stage: "firstWindow",
      pid: child.pid,
      error: redact(error instanceof Error ? error.message : error),
    })}\n`,
  );
  await cleanup();
  process.exitCode = 1;
  process.exit();
}

async function snapshot() {
  const controls = [];
  for (const selector of ["button", "input", "textarea", "select", "a"]) {
    const locator = page.locator(selector);
    for (let index = 0; index < (await locator.count()); index += 1) {
      const item = locator.nth(index);
      if (!(await item.isVisible())) continue;
      controls.push({
        element: selector,
        text: redact((await item.innerText().catch(() => "")) || ""),
        ariaLabel: redact((await item.getAttribute("aria-label")) || ""),
        name: redact((await item.getAttribute("name")) || ""),
        value: redact((await item.inputValue().catch(() => "")) || ""),
        disabled: await item.isDisabled().catch(() => false),
        options:
          selector === "select"
            ? await item.locator("option").allTextContents()
            : undefined,
      });
    }
  }
  return {
    title: redact(await page.title()),
    url: redact(page.url()),
    text: redact(await page.locator("body").innerText()),
    controls,
  };
}

async function dispatch(command) {
  if (command.op === "snapshot") return snapshot();
  if (command.op === "surfaceSnapshot") {
    return JSON.parse(
      redact(
        JSON.stringify(
          await page.evaluate(() => globalThis.rove.getSurfaceSnapshot()),
        ),
      ),
    );
  }
  if (command.op === "fill") {
    await page.getByLabel(command.label, { exact: true }).fill(command.value);
    return snapshot();
  }
  if (command.op === "select") {
    await page
      .getByLabel(command.label, { exact: true })
      .selectOption(command.value);
    return snapshot();
  }
  if (command.op === "click") {
    await page
      .getByRole(command.role, { name: command.name, exact: true })
      .click();
    return snapshot();
  }
  if (command.op === "clickNth") {
    const matches = page.getByRole(command.role, {
      name: command.name,
      exact: true,
    });
    const count = await matches.count();
    if (
      !Number.isInteger(command.index) ||
      command.index < 0 ||
      command.index >= count
    )
      throw new Error(
        `Click index ${String(command.index)} is outside ${count} exact semantic matches.`,
      );
    await matches.nth(command.index).click();
    return snapshot();
  }
  if (command.op === "clickTaskByVisibleId") {
    await page
      .getByRole("button", {
        name: `Task history: ${String(command.taskId)}`,
        exact: true,
      })
      .click();
    return snapshot();
  }
  if (command.op === "screenshot") {
    const path = join(outputRoot, command.name);
    await page.screenshot({ path, fullPage: true });
    return { path };
  }
  if (command.op === "wait") {
    await page.waitForTimeout(command.milliseconds);
    return snapshot();
  }
  if (command.op === "close") {
    await cleanup();
    return { closed: true };
  }
  throw new Error(`Unknown operation ${String(command.op)}.`);
}

process.stdout.write(
  `${JSON.stringify({
    ready: true,
    mode,
    sourceBuilt: mode === "local",
    packaged: mode === "packaged",
    desktopHomeClass:
      process.env.ROVE_DESKTOP_HOME === undefined
        ? "canonical_os_home"
        : "explicit_qualification_override",
    desktopPid: child.pid,
    ...(await snapshot()),
  })}\n`,
);

const input = readline.createInterface({ input: process.stdin });
for await (const line of input) {
  try {
    const result = await dispatch(JSON.parse(line));
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
    if (result.closed) {
      input.close();
      break;
    }
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: redact(error instanceof Error ? error.message : error) })}\n`,
    );
  }
}

await cleanup();
