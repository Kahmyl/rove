#!/usr/bin/env node
/* global document, getComputedStyle, innerHeight, innerWidth, window */

import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputRoot = join(
  repositoryRoot,
  "artifacts/customer-journeys/journey-01-first-launch",
);
const rendererRoot = join(repositoryRoot, "apps/companion/dist/renderer");
const fixtureMain = join(
  repositoryRoot,
  "experiments/agent-execution/electron-first-launch-fixture.cjs",
);
const requireBrowser = createRequire(
  join(repositoryRoot, "packages/browser/package.json"),
);
const requireCompanion = createRequire(
  join(repositoryRoot, "apps/companion/package.json"),
);
const { _electron: electron, chromium } = requireBrowser("playwright");
const electronExecutable = requireCompanion("electron");
const request =
  "Summarize this sentence locally: Rove helps with focused work.";
const forbiddenCustomerCopy = [
  "ChatGPT account —",
  "Connecting...",
  "Connecting…",
  "reviewed baseline",
  "App Server",
  "executable hash",
  "Create Workflow\nReusable guidance",
];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();
const gitStatus = execFileSync("git", ["status", "--short"], {
  cwd: repositoryRoot,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);
const steps = [];

async function visibleState(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const outside = [
      ...document.querySelectorAll("[role=dialog], [role=alert]"),
    ]
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left < 0 ||
          rect.top < 0 ||
          rect.right > innerWidth ||
          rect.bottom > innerHeight
        );
      })
      .map((element) => element.getAttribute("role"));
    return {
      viewport: { width: innerWidth, height: innerHeight },
      text: document.body.innerText.replace(/\s+/g, " ").trim(),
      outside,
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      verticalOverflow:
        document.documentElement.scrollHeight >
        document.documentElement.clientHeight,
    };
  });
}

async function capture(page, number, slug, observation) {
  const filename = `${String(number).padStart(2, "0")}-${slug}.png`;
  await page.screenshot({ path: join(outputRoot, filename) });
  steps.push({
    number,
    slug,
    screenshot: filename,
    observation,
    visible: await visibleState(page),
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function renderContactSheet() {
  const cells = await Promise.all(
    steps.map(async (step) => ({
      ...step,
      image: (await readFile(join(outputRoot, step.screenshot))).toString(
        "base64",
      ),
    })),
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1560, height: 900 },
    });
    await page.setContent(`<!doctype html><style>
      *{box-sizing:border-box}body{margin:0;padding:28px;background:#efefec;color:#20201e;font:14px -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif}
      h1{margin:0 0 22px;font-size:24px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.cell{overflow:hidden;border:1px solid #d9d9d4;border-radius:14px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.06)}
      .meta{padding:11px 13px;border-bottom:1px solid #eaeae6}.meta strong{display:block;font-size:13px}.meta span{display:block;margin-top:4px;color:#676762;font-size:11px}.cell img{display:block;width:100%;height:auto}
    </style><h1>Rove first-launch customer journey</h1><div class="grid">${cells
      .map(
        (step) =>
          `<article class="cell"><div class="meta"><strong>${String(step.number).padStart(2, "0")} · ${step.slug.replaceAll("-", " ")}</strong><span>${step.observation}</span></div><img src="data:image/png;base64,${step.image}"></article>`,
      )
      .join("")}</div>`);
    await page.screenshot({
      path: join(outputRoot, "contact-sheet.png"),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
}

let application;
let traceStarted = false;
try {
  application = await electron.launch({
    executablePath: electronExecutable,
    cwd: repositoryRoot,
    args: [fixtureMain],
    env: {
      ...process.env,
      ROVE_JOURNEY_RENDERER_ROOT: rendererRoot,
    },
  });
  await application.context().tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  traceStarted = true;
  const page = await application.firstWindow({ timeout: 30_000 });
  await page.locator(".product-app").waitFor();

  await capture(
    page,
    1,
    "fresh-launch",
    "New task is visually primary; Codex is specifically signed out; Workflows are subordinate.",
  );
  assert(
    await page.getByText("Not signed in to Codex", { exact: true }).isVisible(),
    "Signed-out Codex state is missing.",
  );
  assert(
    (await page
      .getByRole("button", { name: "Sign in", exact: true })
      .count()) === 1,
    "Fresh launch has duplicate sign-in actions.",
  );
  assert(
    (await page
      .getByText("Reusable guidance for recurring work", { exact: true })
      .count()) === 0,
    "Empty Workflow card is still visible.",
  );

  const composer = page.getByLabel("Desired outcome", { exact: true });
  await composer.fill(request);
  await capture(
    page,
    2,
    "draft-entered",
    "The signed-out composer accepts and retains a deterministic request.",
  );

  await page.getByRole("button", { name: "Start task", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in to Codex" });
  await dialog.waitFor();
  await capture(
    page,
    3,
    "blocked-submit-recovery",
    "Submission opens one focused sign-in dialog without creating or queueing a task.",
  );
  assert(
    (await composer.inputValue()) === request,
    "Blocked submission discarded the draft.",
  );
  assert(
    (await page
      .getByRole("button", { name: "Sign in", exact: true })
      .count()) === 1,
    "Recovery dialog exposes duplicate sign-in actions.",
  );

  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("dialog", { name: "Signing in…" }).waitFor();
  await capture(
    page,
    4,
    "sign-in-started",
    "Signing in appears only after the fixture records a real authentication start operation.",
  );

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await capture(
    page,
    5,
    "recovery-cancelled",
    "Cancel returns to New task with the original request intact and no fake running state.",
  );
  assert(
    (await composer.inputValue()) === request,
    "Cancelling sign-in discarded the draft.",
  );

  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1040, 680);
  });
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Start task", exact: true }).click();
  await page.getByRole("dialog", { name: "Sign in to Codex" }).waitFor();
  await capture(
    page,
    6,
    "small-viewport-recovery",
    "The same focused recovery remains wholly visible at the minimum supported viewport.",
  );

  const journeyState = await page.evaluate(() => window.rove.getJourneyState());
  const taskLaunches = journeyState.calls.filter(
    (call) => call.type === "product" && call.intent.type === "task.launch",
  );
  assert(
    taskLaunches.length === 0,
    "Blocked submission created a task launch.",
  );
  assert(
    journeyState.snapshot.product.tasks.length === 0,
    "Fixture acquired a fake task.",
  );
  for (const step of steps) {
    assert(
      step.visible.outside.length === 0,
      `Step ${step.number} has clipped recovery content.`,
    );
    assert(
      !step.visible.horizontalOverflow,
      `Step ${step.number} has horizontal overflow.`,
    );
    for (const forbidden of forbiddenCustomerCopy)
      assert(
        !step.visible.text.includes(forbidden),
        `Step ${step.number} exposed forbidden customer copy: ${forbidden}`,
      );
  }

  await application.context().tracing.stop({
    path: join(outputRoot, "journey-01.trace.zip"),
  });
  traceStarted = false;
  await renderContactSheet();
  const manifest = {
    title: "Rove first-launch customer journey",
    baseline: {
      commit,
      gitStatus,
      fixture: "fresh local home; qualified Codex ready; account signed out",
      viewports: [
        { width: 1180, height: 780 },
        { width: 1040, height: 680 },
      ],
      liveCredentialsUsed: false,
      liveCodexAllowanceUsed: false,
    },
    assertions: {
      exactSignedOutState: true,
      connectingOnlyDuringActiveAuthentication: true,
      draftPreserved: true,
      taskLaunchCount: 0,
      singleRecoverySurface: true,
      quietEmptyWorkflowHierarchy: true,
      recoveryContainedAtSmallViewport: true,
      technicalCompatibilityDetailsAbsent: true,
    },
    steps,
  };
  await writeFile(
    join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(outputRoot, "summary.md"),
    `# Rove first-launch customer journey\n\nBaseline: \`${commit}\` with the current primary-worktree changes listed in \`manifest.json\`.\n\nThe deterministic Electron fixture models a Rove-qualified Codex host with a fresh signed-out account. It performs no live authentication, model, browser, or cloud work.\n\nAll Journey 01 assertions passed: exact signed-out state, one focused recovery path, draft preservation, no task launch, quiet empty Workflow hierarchy, no customer-facing compatibility diagnostics, and contained recovery at 1180×780 and 1040×680.\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ status: "pass", output: relative(repositoryRoot, outputRoot), assertions: manifest.assertions }, null, 2)}\n`,
  );
} finally {
  if (traceStarted && application)
    await application
      .context()
      .tracing.stop()
      .catch(() => undefined);
  await application?.close().catch(() => undefined);
}
