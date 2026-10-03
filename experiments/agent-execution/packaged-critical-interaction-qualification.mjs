#!/usr/bin/env node
/* global document, fetch, getComputedStyle, HTMLElement, innerHeight, innerWidth */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  emptyTaskAggregate,
  projectTaskAggregate,
  taskEventDigest,
} from "../../packages/protocol/dist/index.js";
import { SqliteTaskEngineStore } from "../../apps/companion/dist/main/main/codex/sqlite-task-engine-store.js";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const artifactsRoot = join(repositoryRoot, "release", "artifacts");
const requireBrowser = createRequire(
  join(repositoryRoot, "packages/browser/package.json"),
);
const { chromium } = requireBrowser("playwright");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function packageExecutable() {
  const explicit = process.env.ROVE_PACKAGED_EXECUTABLE?.trim();
  if (explicit) return resolve(explicit);
  if (process.platform !== "darwin")
    throw new Error(
      "Set ROVE_PACKAGED_EXECUTABLE for packaged interaction qualification outside macOS.",
    );
  return join(
    artifactsRoot,
    `mac-${process.arch}`,
    "Rove.app",
    "Contents",
    "MacOS",
    "Rove",
  );
}

function taskIdentity(index) {
  const digit = String(index);
  return {
    taskId: `task_${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
    operationId: `intent_${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
    bootstrapId: `boot_${digit.repeat(32)}`,
    threadId: `thread_packaged_${digit}`,
    turnId: `turn_packaged_${digit}`,
  };
}

export function baseAggregate(index, outcome) {
  const identity = taskIdentity(index);
  const aggregate = emptyTaskAggregate(identity.taskId);
  aggregate.revision = 1;
  aggregate.launch = {
    operationId: identity.operationId,
    bootstrapId: identity.bootstrapId,
    requestedAt: `2026-09-27T12:0${index}:00.000Z`,
    outcome,
    executionMode: "agent",
    approvalsReviewer: index === 2 ? "user" : "auto_review",
    cwd: "/qualification/packaged-task",
    attachmentIds: [],
  };
  aggregate.record = {
    schemaVersion: 1,
    identity: {
      taskId: identity.taskId,
      threadId: identity.threadId,
    },
    bootstrap: {
      operationId: identity.bootstrapId,
      threadSource: `rove:${identity.taskId}:${identity.bootstrapId}`,
      stage: "complete",
    },
    desiredState: "open",
  };
  aggregate.codex = {
    availability: "available",
    threadExists: true,
    threadId: identity.threadId,
    threadSource: aggregate.record.bootstrap.threadSource,
    sourceLookup: "exact",
    runtimeStatus: "idle",
    archived: false,
    turn: "completed",
  };
  aggregate.conversation = {
    items: {
      [`user:${identity.operationId}`]: {
        id: `user:${identity.operationId}`,
        kind: "user_message",
        status: "completed",
        clientId: identity.operationId,
        turnId: identity.turnId,
        acceptedAt: aggregate.launch.requestedAt,
        startedAt: aggregate.launch.requestedAt,
        completedAt: aggregate.launch.requestedAt,
        text: outcome,
      },
    },
    itemOrder: [`user:${identity.operationId}`],
    turnOrder: [],
    terminalTurns: {},
  };
  // Synthetic persistence history includes exact delivery facts; assistant text grants none.
  aggregate.messageDeliveries[identity.operationId] = {
    operationId: identity.operationId,
    threadId: identity.threadId,
    turnId: identity.turnId,
    state: "message_materialized",
    connectionGeneration: 1,
    observedAt: aggregate.launch.requestedAt,
  };
  return { aggregate, identity };
}

async function persistAggregate(store, aggregate, index) {
  const event = {
    schemaVersion: 1,
    type: "codex_availability_observed",
    eventId: `packaged-qualification:${index}`,
    taskId: aggregate.taskId,
    source: {
      kind: "codex",
      id: "packaged-qualification",
      generation: 1,
      position: index,
    },
    observedAt: `2026-09-27T12:0${index}:30.000Z`,
    availability: "available",
  };
  const acceptance = {
    duplicate: false,
    aggregate,
    projection: projectTaskAggregate(aggregate),
    command: null,
  };
  await store.transact(aggregate.taskId, (transaction) =>
    transaction.commit({
      event,
      digest: taskEventDigest(event),
      acceptance,
    }),
  );
}

export async function seedProductHome(home) {
  const stateDirectory = join(home, "codex-product");
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const store = new SqliteTaskEngineStore({
    path: join(stateDirectory, "task-process.v1.sqlite3"),
  });
  try {
    const ready = baseAggregate(1, "Review the packaged launch evidence");
    ready.aggregate.conversation.items.assistant_ready = {
      id: "assistant_ready",
      kind: "assistant_message",
      status: "completed",
      turnId: ready.identity.turnId,
      text: "The persisted packaged conversation remains readable and ready for follow-up.",
    };
    ready.aggregate.conversation.itemOrder = [
      ...ready.aggregate.conversation.itemOrder,
      "assistant_ready",
    ];
    ready.aggregate.conversation.turnOrder = [ready.identity.turnId];
    ready.aggregate.conversation.terminalTurns = {
      [ready.identity.turnId]: "completed",
    };
    await persistAggregate(store, ready.aggregate, 1);

    const attention = baseAggregate(2, "Review the packaged command request");
    attention.aggregate.codex.runtimeStatus = "active";
    attention.aggregate.codex.turn = "active";
    attention.aggregate.codex.turnId = attention.identity.turnId;
    attention.aggregate.conversation.turnOrder = [attention.identity.turnId];
    attention.aggregate.attentions = [
      {
        authority: "codex",
        kind: "command_approval",
        requestId: "packaged-command-approval",
        method: "item/commandExecution/requestApproval",
        wireRequestId: 17,
        responseFields: {
          command: "printf packaged-qualification",
          reason: "Verify the packaged approval presentation",
          availableDecisions: ["accept", "decline"],
        },
        taskId: attention.identity.taskId,
        threadId: attention.identity.threadId,
        turnId: attention.identity.turnId,
        itemId: "item_packaged_command",
        generation: 1,
        status: "pending",
      },
    ];
    await persistAggregate(store, attention.aggregate, 2);

    const working = baseAggregate(3, "Continue the packaged background review");
    working.aggregate.codex.runtimeStatus = "active";
    working.aggregate.codex.turn = "active";
    working.aggregate.codex.turnId = working.identity.turnId;
    working.aggregate.conversation.turnOrder = [working.identity.turnId];
    working.aggregate.conversation.items.activity_packaged = {
      id: "activity_packaged",
      kind: "assistant_message",
      status: "started",
      turnId: working.identity.turnId,
      text: "Comparing the packaged application evidence.",
    };
    working.aggregate.conversation.itemOrder = [
      ...working.aggregate.conversation.itemOrder,
      "activity_packaged",
    ];
    await persistAggregate(store, working.aggregate, 3);
  } finally {
    store.close();
  }
}

async function allocatePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : null;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  assert(port !== null, "Could not allocate a packaged qualification port.");
  return port;
}

async function waitForDebuggingPort(port, child, output) {
  const endpoint = `http://127.0.0.1:${port}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Packaged Rove exited before renderer attachment.\n${output()}`,
      );
    }
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return endpoint;
    } catch {
      // The packaged renderer debugging endpoint is still starting.
    }
    await delay(100);
  }
  throw new Error(
    `Packaged renderer debugging endpoint did not start.\n${output()}`,
  );
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    const forcedExit = once(child, "exit");
    child.kill("SIGKILL");
    await forcedExit;
  }
}

async function visibleBounds(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        bounds.width > 0 &&
        bounds.height > 0
      );
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      outside: [...document.querySelectorAll("[role=dialog], [role=alert]")]
        .filter(visible)
        .filter((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.left < 0 ||
            bounds.top < 0 ||
            bounds.right > innerWidth ||
            bounds.bottom > innerHeight
          );
        }).length,
      focused:
        document.activeElement instanceof HTMLElement
          ? document.activeElement.getAttribute("aria-label") ||
            document.activeElement.innerText
          : null,
    };
  });
}

export async function qualifyPackagedInteractions() {
  const executablePath = packageExecutable();
  const qualificationRoot = await mkdtemp(
    join(tmpdir(), "rove-packaged-interaction-"),
  );
  const productHome = join(qualificationRoot, "product-home");
  const evidenceRoot = join(
    repositoryRoot,
    "artifacts/customer-journeys/packaged-critical",
    new Date().toISOString().replaceAll(":", "-"),
  );
  await mkdir(evidenceRoot, { recursive: true });
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const provenance = {
    sourceHead: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim(),
    sourceSha256: digest(await readFile(fileURLToPath(import.meta.url))),
    packagedArchiveSha256: digest(
      await readFile(resolve(dirname(executablePath), "../Resources/app.asar")),
    ),
    executablePath,
    mode: "Unsigned darwin/arm64 production package with synthetic SQLite facts, isolated homes, local services; no live model/account/browser Task",
  };
  let page;
  let browser;
  let desktop;
  let activator;
  let desktopOutput = "";

  try {
    await seedProductHome(productHome);
    const debuggingPort = await allocatePort();
    desktop = spawn(
      executablePath,
      [
        "--rove-manage-services",
        `--user-data-dir=${join(qualificationRoot, "electron-user-data")}`,
        `--remote-debugging-port=${debuggingPort}`,
      ],
      {
        cwd: qualificationRoot,
        env: {
          ...process.env,
          ROVE_DESKTOP_HOME: productHome,
          ROVE_BROWSER_HEADLESS: "true",
          ROVE_BROWSER: "chromium",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    desktop.stdout.on("data", (chunk) => (desktopOutput += chunk.toString()));
    desktop.stderr.on("data", (chunk) => (desktopOutput += chunk.toString()));
    const endpoint = await waitForDebuggingPort(
      debuggingPort,
      desktop,
      () => desktopOutput,
    );
    activator = spawn(
      executablePath,
      [`--user-data-dir=${join(qualificationRoot, "electron-user-data")}`],
      {
        cwd: qualificationRoot,
        env: {
          ...process.env,
          ROVE_DESKTOP_HOME: productHome,
          ROVE_BROWSER_HEADLESS: "true",
          ROVE_BROWSER: "chromium",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    activator.stdout.on("data", (chunk) => (desktopOutput += chunk.toString()));
    activator.stderr.on("data", (chunk) => (desktopOutput += chunk.toString()));
    await Promise.race([once(activator, "exit"), delay(5_000)]);
    await stopChild(activator);
    activator = undefined;
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    assert(context, "Packaged renderer did not expose a browser context.");
    let targets = [];
    const pageStartedAt = Date.now();
    while (!page && Date.now() - pageStartedAt < 30_000) {
      targets = await fetch(`${endpoint}/json/list`).then((response) =>
        response.json(),
      );
      page = context
        .pages()
        .find((candidate) => candidate.url().includes("renderer/index.html"));
      if (!page) await delay(100);
    }
    assert(
      page,
      `Packaged Rove did not expose its renderer page. Targets: ${JSON.stringify(targets)}\n${desktopOutput}`,
    );
    await page.locator(".product-app").waitFor({ timeout: 30_000 });
    await page.setViewportSize({ width: 1180, height: 780 });

    await page
      .getByRole("button", {
        name: `Task history: ${taskIdentity(1).taskId}`,
      })
      .click();
    await page
      .getByText("The persisted packaged conversation remains readable", {
        exact: false,
      })
      .waitFor();
    const composer = page.getByLabel("Task message", { exact: true });
    await composer.waitFor({ state: "visible" });

    await page
      .getByRole("button", {
        name: `Task history: ${taskIdentity(2).taskId}`,
      })
      .click();
    await page
      .getByLabel("Task workspace")
      .getByText("Review the packaged command request", { exact: true })
      .waitFor();
    assert(
      !(await page.getByLabel("Current task request").isVisible()),
      "Packaged startup presented a stale provider request as actionable.",
    );
    assert(
      !(await page.getByText("Approve once", { exact: true }).isVisible()),
      "Packaged startup retained a stale provider approval decision.",
    );

    await page
      .getByRole("button", {
        name: `Task history: ${taskIdentity(3).taskId}`,
      })
      .click();
    await page
      .getByLabel("Task workspace")
      .getByText("Comparing the packaged application evidence.", {
        exact: true,
      })
      .waitFor();
    const stopPresented = await page
      .getByRole("button", { name: "Stop current work" })
      .isVisible();

    await page.setViewportSize({ width: 820, height: 700 });
    const historyButton = page.getByRole("button", {
      name: `Task history: ${taskIdentity(1).taskId}`,
    });
    const navigation = page.getByRole("button", {
      name: "Open navigation",
      exact: true,
    });
    await navigation.focus();
    await navigation.press("Enter");
    await page.locator("#shell-navigation").waitFor({ state: "visible" });
    await page.keyboard.press("Tab");
    await historyButton.focus();
    assert(
      await historyButton.evaluate((element) =>
        element.matches(":focus-visible"),
      ),
      "Packaged narrow Task navigation lacks visible keyboard focus.",
    );
    const bounds = await visibleBounds(page);
    assert(
      !bounds.horizontalOverflow,
      "Packaged narrow surface overflows horizontally.",
    );
    assert(
      bounds.outside === 0,
      "Packaged narrow dialog or alert escapes the viewport.",
    );

    const result = {
      ...provenance,
      status: "qualified",
      executablePath,
      packagedMain: true,
      temporaryProductionHome: true,
      taskSwitching: true,
      persistedConversation: true,
      staleProviderAttentionRejected: true,
      liveAttentionPresentation: "not_exercised_without_live_provider_request",
      stopPresentation: stopPresented
        ? "qualified_from_reconciled_task_state"
        : "not_exercised_without_live_stoppable_work",
      narrowKeyboardFocus: true,
      narrowViewport: bounds.viewport,
      browserOwnership: "not_exercised_without_live_task_runtime_binding",
      followerPresentation: "not_exercised_without_live_task_runtime_binding",
      humanAcceptance: false,
    };
    await page.screenshot({
      path: join(evidenceRoot, "narrow-navigation.png"),
    });
    await writeFile(
      join(evidenceRoot, "narrow-navigation.html"),
      await page.content(),
    );
    result.screenshotSha256 = digest(
      await readFile(join(evidenceRoot, "narrow-navigation.png")),
    );
    await writeFile(
      join(evidenceRoot, "report.json"),
      JSON.stringify(result, null, 2),
    );
    process.stdout.write(
      `${JSON.stringify({ ...result, evidenceRoot }, null, 2)}\n`,
    );
  } catch (error) {
    if (page) {
      await page
        .screenshot({ path: join(evidenceRoot, "failure.png") })
        .catch(() => undefined);
      await writeFile(
        join(evidenceRoot, "failure.html"),
        await page.content(),
      ).catch(() => undefined);
    }
    await writeFile(
      join(evidenceRoot, "report.json"),
      JSON.stringify(
        { ...provenance, status: "failed", error: String(error) },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
    await stopChild(activator);
    await stopChild(desktop);
    await rm(qualificationRoot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await qualifyPackagedInteractions();
}
