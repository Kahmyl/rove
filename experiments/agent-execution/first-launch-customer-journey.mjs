#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import process from "node:process";

import {
  pollSnapshot,
  validateSurfaceSnapshot,
} from "./source-product-poll.mjs";
import {
  captureJourneyStep,
  renderJourneyContactSheet,
  sanitizeText,
  writeJourneyArtifacts,
} from "./electron-customer-journey-walker.mjs";

const harnessRepositoryRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(
  process.env.ROVE_CUSTOMER_JOURNEY_REPOSITORY_ROOT ?? harnessRepositoryRoot,
);
const companionRoot = join(repositoryRoot, "apps/companion");
const launchCwd = resolve(
  process.env.ROVE_CUSTOMER_JOURNEY_LAUNCH_CWD ?? companionRoot,
);
const outputRoot = resolve(
  process.env.ROVE_CUSTOMER_JOURNEY_OUTPUT_ROOT ??
    join(repositoryRoot, "artifacts/customer-journeys/journey-01-first-launch"),
);
const requireBrowser = createRequire(
  join(repositoryRoot, "packages/browser/package.json"),
);
const requireCompanion = createRequire(join(companionRoot, "package.json"));
const { _electron: electron, chromium } = requireBrowser("playwright");
const electronExecutable = requireCompanion("electron");
const electronEntry = join(companionRoot, "dist/main/main/main.js");
const sandbox = await mkdtemp(join(tmpdir(), "rove-first-launch-"));
const electronData = join(sandbox, "electron-data");
const productHome = join(sandbox, "product-home");
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

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

function isolatedEnvironment() {
  const env = { ...process.env };
  for (const key of [
    "ROVE_CONTROL_PLANE_URL",
    "ROVE_HUB_DEVICE_ID",
    "ROVE_HUB_TOKEN",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ROVE_CUSTOMER_JOURNEY_REPOSITORY_ROOT",
    "ROVE_CUSTOMER_JOURNEY_LAUNCH_CWD",
    "ROVE_CUSTOMER_JOURNEY_OUTPUT_ROOT",
  ])
    delete env[key];
  return {
    ...env,
    ROVE_DESKTOP_HOME: productHome,
    ROVE_BROWSER: "chromium",
    ROVE_BROWSER_HEADLESS: "true",
  };
}

const observations = [];
const steps = [];
const observe = (classification, step, text) =>
  observations.push({ classification, step, text });
const capture = async (page, details) => {
  const step = await captureJourneyStep({
    page,
    outputRoot,
    artifactRoot: outputRoot,
    ...details,
  });
  steps.push(step);
  return step;
};
const snapshot = async (page) =>
  validateSurfaceSnapshot(
    await page.evaluate(() => globalThis.rove.getSurfaceSnapshot()),
    "first-launch-customer-journey",
  );

let application;
let page;
let traceStarted = false;
let journeyFailure = null;
let harnessFailure = null;
let externalOpenAttempts = 0;

try {
  application = await electron.launch({
    executablePath: electronExecutable,
    cwd: launchCwd,
    args: [
      electronEntry,
      "--rove-manage-services",
      `--user-data-dir=${electronData}`,
    ],
    env: isolatedEnvironment(),
  });
  application.process().stdout?.on("data", (chunk) => {
    process.stderr.write(`[rove] ${sanitizeText(chunk).slice(0, 2_000)}`);
  });
  application.process().stderr?.on("data", (chunk) => {
    process.stderr.write(`[rove] ${sanitizeText(chunk).slice(0, 2_000)}`);
  });
  await application.context().tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  traceStarted = true;
  await application.evaluate(({ app }) => app.emit("activate"));
  page = await application.firstWindow({ timeout: 30_000 });
  await page.locator(".product-app").waitFor({ timeout: 30_000 });

  await capture(page, {
    number: 1,
    slug: "application-launch",
    userIntent: "Open Rove for the first time",
    actionTaken: "Launched the real source-built Electron application",
    importantObservations: [
      "Captured the first product window before waiting for account convergence.",
    ],
  });
  const stable = await pollSnapshot({
    page,
    snapshot,
    stage: "customer-journey:first-launch-product-truth",
    timeoutMs: 30_000,
    predicate: (state) =>
      state.product?.host.ready === true || state.productError?.length > 0
        ? state
        : false,
    summarize: (state) => ({
      revision: state?.revision,
      host: state?.product?.host?.state,
      account: state?.product?.catalog?.account?.status,
      tasks: state?.product?.tasks?.length,
      workflows: state?.product?.workflows?.length,
      productError: state?.productError,
    }),
  });
  const composer = page.getByLabel("Desired outcome", { exact: true });
  const testRequest =
    "Summarize this sentence locally: Rove helps with focused work.";

  if (stable.product === null) {
    const blocker = sanitizeText(
      stable.productError || "Codex did not become available.",
    );
    observe("CUSTOMER_FLOW_BLOCKER", 1, blocker);
    if (!(await composer.isVisible()) || !(await composer.isEnabled()))
      throw new Error("The first-launch task composer was not editable.");
    await composer.fill(testRequest);
    await capture(page, {
      number: 2,
      slug: "first-task-attempt-while-codex-unavailable",
      userIntent: "Attempt the obvious first piece of work",
      actionTaken:
        "Entered a deterministic non-consequential request; did not bypass the disabled Start task action",
      importantObservations: [
        "The request could be entered, but the unavailable Codex state prevented task creation.",
      ],
    });
    const refresh = page.getByRole("button", {
      name: "Refresh account status",
      exact: true,
    });
    if (await refresh.isVisible().catch(() => false)) {
      await refresh.click();
      await page.waitForTimeout(500);
    }
    await capture(page, {
      number: 3,
      slug: "available-recovery-path",
      userIntent: "Try the recovery path offered by Rove",
      actionTaken: "Activated Refresh account status once",
      importantObservations: [
        "The compatibility error remained and no sign-in path became available.",
        "No task, Workflow, browser session, credential flow, or external action was created.",
      ],
    });
    await application.evaluate(
      ({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows().find(
          (candidate) => candidate.isVisible() && !candidate.isDestroyed(),
        );
        window?.setSize(size.width, size.height);
      },
      { width: 1040, height: 680 },
    );
    await page.waitForTimeout(300);
    await capture(page, {
      number: 4,
      slug: "minimum-supported-viewport-blocked-state",
      userIntent:
        "Review the blocked fresh-user state in the smaller supported window",
      actionTaken:
        "Resized the real product window to its supported 1040×680 minimum",
      importantObservations: [
        "Captured the same New Task recovery state without changing product state.",
      ],
    });
    journeyFailure = blocker;
  } else {
    if (
      stable.product.catalog.account.status !== "logged_out" ||
      stable.product.tasks.length !== 0 ||
      stable.product.workflows.length !== 0 ||
      stable.companion !== null
    )
      throw new Error(
        "Fresh-home boundary failed: account, task, Workflow, or browser state was present.",
      );

    await capture(page, {
      number: 2,
      slug: "identity-and-execution-state",
      userIntent: "Understand whether Rove can work yet",
      actionTaken:
        "Read the visible product, ChatGPT account, Codex availability, and recovery controls",
      importantObservations: [
        "The local Codex host was ready, while the isolated ChatGPT account was signed out.",
        "No tasks, Workflows, browser session, account history, or attention state existed.",
      ],
    });
    if (!(await composer.isVisible()) || !(await composer.isEnabled()))
      throw new Error("The first-launch task composer was not editable.");
    await composer.fill(testRequest);
    const taskAttemptStep = await capture(page, {
      number: 3,
      slug: "first-task-attempt",
      userIntent: "Ask Rove to do a first, harmless piece of work",
      actionTaken:
        "Entered a deterministic non-consequential request; did not bypass the disabled Start task action",
      importantObservations: [
        "The composer accepted the request, but Start task remained disabled while signed out.",
        "No task was created and no model allowance was used.",
      ],
    });
    if (
      !taskAttemptStep.visibleUi.disabledActions.some(
        (action) => action.label === "Start task",
      )
    )
      throw new Error(
        "Start task was not visibly disabled in the signed-out state.",
      );
    await application.evaluate(({ shell }) => {
      const state = globalThis;
      state.__roveCustomerJourneyExternalOpenAttempts = 0;
      shell.openExternal = async () => {
        state.__roveCustomerJourneyExternalOpenAttempts += 1;
      };
    });
    const connect = page.getByRole("button", {
      name: "Sign in with ChatGPT",
      exact: true,
    });
    await connect.click();
    await page.waitForFunction(
      () => {
        const body = document.body.innerText;
        return (
          body.includes("Continue sign-in") ||
          body.includes("Sign-in needs attention") ||
          body.includes("Codex sign-in could not start")
        );
      },
      undefined,
      { timeout: 30_000 },
    );
    externalOpenAttempts = await application.evaluate(
      () => globalThis.__roveCustomerJourneyExternalOpenAttempts ?? 0,
    );
    await capture(page, {
      number: 4,
      slug: "connect-path",
      userIntent: "Follow the offered path to make Rove usable",
      actionTaken:
        "Activated Sign in with ChatGPT; suppressed the external browser handoff before credentials while preserving the real Electron/account flow",
      importantObservations: [
        externalOpenAttempts > 0
          ? "Rove attempted to open an external sign-in page and retained Continue sign-in and Cancel controls in the application."
          : "The sign-in attempt remained in Rove and exposed its current recovery/error state.",
        "No credentials were entered and no external page was opened.",
      ],
    });
    const cancel = page.getByRole("button", { name: "Cancel", exact: true });
    if (await cancel.isVisible().catch(() => false)) {
      await cancel.click();
      await connect.waitFor({ state: "visible", timeout: 30_000 });
    } else {
      await page.keyboard.press("Escape");
    }
    await capture(page, {
      number: 5,
      slug: "return-to-new-task",
      userIntent: "Return without completing authentication",
      actionTaken:
        "Cancelled the pending sign-in state when available and returned to New Task",
      importantObservations: [
        "The original request remained in the composer.",
        "No task, Workflow, browser session, or external action was created.",
      ],
    });
    if ((await composer.inputValue()) !== testRequest)
      throw new Error("The first-task draft was lost after leaving sign-in.");
    const returned = await snapshot(page);
    if (
      returned.product.tasks.length !== 0 ||
      returned.product.workflows.length !== 0 ||
      returned.companion !== null
    )
      throw new Error("The cancelled recovery path created unexpected state.");
    await application.evaluate(
      ({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows().find(
          (candidate) => candidate.isVisible() && !candidate.isDestroyed(),
        );
        window?.setSize(size.width, size.height);
      },
      { width: 1040, height: 680 },
    );
    await page.waitForTimeout(300);
    await capture(page, {
      number: 6,
      slug: "minimum-supported-viewport",
      userIntent:
        "Review the same fresh-user state in the smaller supported window",
      actionTaken:
        "Resized the real product window to its supported 1040×680 minimum",
      importantObservations: [
        "Captured viewport fit, overflow, clipping, primary actions, and disabled actions without changing product state.",
      ],
    });
  }
} catch (error) {
  journeyFailure = sanitizeText(error instanceof Error ? error.message : error);
  harnessFailure = journeyFailure;
  observe("CUSTOMER_FLOW_BLOCKER", steps.length || 1, journeyFailure);
} finally {
  if (traceStarted && application) {
    await application.context().tracing.stop({
      path: join(outputRoot, "trace.zip"),
    });
  }
  await application?.close().catch(() => undefined);
  await rm(sandbox, { recursive: true, force: true });
}

const manifest = {
  schemaVersion: 1,
  title:
    "Journey 01 — A person opens Rove and wants to start their first piece of work",
  status: journeyFailure === null ? "CAPTURED" : "BLOCKED",
  generatedAt: new Date().toISOString(),
  baseline: {
    commit,
    gitState:
      gitStatus.length === 0
        ? "clean working tree"
        : `working tree changes present: ${gitStatus.join(", ")}`,
    productHome: "new temporary Rove product home, removed after capture",
    electronData:
      "new temporary Electron user-data directory, removed after capture",
    accountState: "isolated Codex home; no prior account or cloud history",
    externalEffects:
      "no Supabase, private browser profile, credentials, external browser page, model execution, or consequential action",
    viewports: [
      { width: 1440, height: 900, role: "normal product window" },
      { width: 1040, height: 680, role: "supported minimum window" },
    ],
    externalBrowserOpenSuppressed: true,
    externalBrowserOpenAttempts: externalOpenAttempts,
  },
  harness: {
    application: "real source-built Electron development application",
    driver: "repository Playwright Electron infrastructure",
    semantics: "user-visible semantic controls",
    trace: "trace.zip",
    acceptanceAuthority:
      "evidence only; neither the harness nor its classifications assert product or aesthetic acceptance",
  },
  steps,
  observations,
  blockedAt: journeyFailure,
  journeyBoundary:
    "Stopped after the first-launch/New Task journey. Workflow, Results, Recording, Settings, and later customer journeys were not exercised.",
};

await writeJourneyArtifacts({ outputRoot, manifest });
if (steps.length > 0)
  await renderJourneyContactSheet({ chromium, outputRoot, steps });

process.stdout.write(
  `${JSON.stringify({
    status: manifest.status,
    steps: steps.length,
    output: relative(repositoryRoot, outputRoot),
    blockedAt: journeyFailure,
    harnessFailure,
  })}\n`,
);
if (harnessFailure !== null) process.exitCode = 1;
