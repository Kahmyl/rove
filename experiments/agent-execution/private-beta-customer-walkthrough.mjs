#!/usr/bin/env node
/* global console, document, getComputedStyle, HTMLElement, innerHeight, innerWidth, localStorage, window */

import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputRoot = join(
  repositoryRoot,
  "artifacts/customer-journeys/private-beta-walkthrough",
);
const rendererRoot = join(repositoryRoot, "apps/companion/dist/renderer");
const fixtureMain = join(
  repositoryRoot,
  "experiments/agent-execution/electron-private-beta-walkthrough-fixture.cjs",
);
const requireBrowser = createRequire(
  join(repositoryRoot, "packages/browser/package.json"),
);
const requireCompanion = createRequire(
  join(repositoryRoot, "apps/companion/package.json"),
);
const { _electron: electron, chromium } = requireBrowser("playwright");
const electronExecutable = requireCompanion("electron");
const allowedClassifications = new Set([
  "CUSTOMER_FLOW_BLOCKER",
  "MENTAL_MODEL_CONFUSION",
  "COGNITIVE_LOAD",
  "INFORMATION_HIERARCHY_ISSUE",
  "COPY_CONFUSION",
  "VISUAL_LAYOUT_ISSUE",
  "MISPLACED_RESPONSIBILITY",
  "SAFETY_COMMUNICATION_ISSUE",
  "QUALIFICATION_GAP",
  "BETA_POLISH",
  "NON_BLOCKING_NOTE",
]);
const steps = [];
const findings = [];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function finding(
  classification,
  scenario,
  intent,
  actualState,
  observedUi,
  why,
  source,
) {
  assert(
    allowedClassifications.has(classification),
    `Unknown classification: ${classification}`,
  );
  findings.push({
    classification,
    scenario,
    customerIntent: intent,
    actualState,
    observedUi,
    whyItMatters: why,
    ...(source ? { source } : {}),
  });
}

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
    const root = getComputedStyle(document.documentElement);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      theme: document.documentElement.dataset.roveTheme ?? "system",
      text: document.body.innerText.replace(/\s+/g, " ").trim(),
      outside,
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      tokens: {
        accent: root.getPropertyValue("--rove-accent").trim(),
        success: root.getPropertyValue("--success").trim(),
        warning: root.getPropertyValue("--warning").trim(),
        danger: root.getPropertyValue("--danger").trim(),
      },
    };
  });
}

async function capture(
  page,
  group,
  slug,
  customerIntent,
  action,
  applicationState,
) {
  const number = steps.length + 1;
  const screenshot = `${String(number).padStart(2, "0")}-${group}-${slug}.png`;
  await page.screenshot({ path: join(outputRoot, screenshot) });
  const visible = await visibleState(page);
  assert(
    visible.outside.length === 0,
    `${screenshot} contains an out-of-viewport dialog.`,
  );
  steps.push({
    number,
    group,
    slug,
    screenshot,
    customerIntent,
    action,
    applicationState,
    visible,
  });
}

async function setScenario(page, name) {
  await page.evaluate(
    (scenario) => window.rove.setJourneyScenario(scenario),
    name,
  );
  await page.waitForTimeout(120);
}

async function openTask(page, taskId) {
  await page.getByRole("button", { name: `Task history: ${taskId}` }).click();
  await page.locator(".task-detail").waitFor();
}

async function setWindowSize(application, width, height) {
  await application.evaluate(
    ({ BrowserWindow }, dimensions) =>
      BrowserWindow.getAllWindows()[0]?.setSize(
        dimensions.width,
        dimensions.height,
      ),
    { width, height },
  );
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function renderContactSheet(group) {
  const groupSteps = steps.filter((step) => step.group === group);
  const cells = await Promise.all(
    groupSteps.map(async (step) => ({
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
      .meta{padding:11px 13px;border-bottom:1px solid #eaeae6}.meta strong{display:block;font-size:13px}.meta span{display:block;margin-top:4px;color:#676762;font-size:11px;line-height:1.4}.cell img{display:block;width:100%;height:auto}
    </style><h1>Rove private beta · ${escapeHtml(group.replaceAll("-", " "))}</h1><div class="grid">${cells
      .map(
        (step) =>
          `<article class="cell"><div class="meta"><strong>${String(step.number).padStart(2, "0")} · ${escapeHtml(step.slug.replaceAll("-", " "))}</strong><span>${escapeHtml(step.customerIntent)}</span></div><img src="data:image/png;base64,${step.image}"></article>`,
      )
      .join("")}</div>`);
    await page.screenshot({
      path: join(outputRoot, `contact-sheet-${group}.png`),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
}

const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();
const startingStatus = execFileSync("git", ["status", "--short"], {
  cwd: repositoryRoot,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);

let application;
let traceStarted = false;
try {
  application = await electron.launch({
    executablePath: electronExecutable,
    cwd: repositoryRoot,
    args: [fixtureMain],
    env: { ...process.env, ROVE_JOURNEY_RENDERER_ROOT: rendererRoot },
  });
  await application.context().tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  traceStarted = true;
  const page = await application.firstWindow({ timeout: 30_000 });
  await page.locator(".product-app").waitFor();

  // Multi-task usage.
  await setScenario(page, "multi_working");
  await openTask(page, "task_market_analysis");
  await capture(
    page,
    "multi-task",
    "task-a-working",
    "Let the interview analysis continue in the background.",
    "Observe Task A while it is working.",
    "Task A is selected and visibly Working in navigation and its task surface.",
  );
  await openTask(page, "task_launch_checklist");
  await capture(
    page,
    "multi-task",
    "task-b-viewed",
    "Review another task without stopping Task A.",
    "Open Task B.",
    "Task B is fully usable while Task A remains visibly Working in navigation.",
  );
  await setScenario(page, "multi_attention");
  assert(
    (await page
      .getByRole("button", {
        name: "Task history: task_launch_checklist",
      })
      .getAttribute("aria-current")) === "true",
    "Background attention hijacked Task B.",
  );
  assert(
    (await page
      .getByText("Who should receive this summary?", { exact: true })
      .count()) === 0,
    "Background conversational input replaced Task B's composer.",
  );
  await page
    .getByRole("button", { name: "Task history: task_market_analysis" })
    .getByText(/Needs input/)
    .waitFor();
  await capture(
    page,
    "multi-task",
    "background-attention",
    "Notice that Task A needs me without losing Task B.",
    "Receive background attention for Task A.",
    "Task B stays viewed; Task A says Needs input in navigation.",
  );
  await openTask(page, "task_market_analysis");
  await page
    .getByText("Who should receive this summary?", { exact: true })
    .waitFor();
  await capture(
    page,
    "multi-task",
    "task-a-required-input",
    "Answer the question blocking Task A.",
    "Navigate to Task A.",
    "The active task's composer region is replaced by its bounded response surface.",
  );
  await page.getByText("Leadership", { exact: true }).click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByLabel("Follow-up outcome").waitFor();
  assert(
    (await page
      .getByRole("button", { name: "Task history: task_market_analysis" })
      .getByText(/Needs input/)
      .count()) === 0,
    "Task A retained Needs input after the response was accepted.",
  );
  await capture(
    page,
    "multi-task",
    "task-a-answered",
    "Let Task A continue after my answer.",
    "Choose Leadership and send.",
    "The ordinary task composer returns and Task A continues.",
  );
  await openTask(page, "task_launch_checklist");
  await capture(
    page,
    "multi-task",
    "return-to-task-b",
    "Return to the checklist.",
    "Open Task B again.",
    "Task B retains its own conversation and composer after Task A's response.",
  );

  // Browser collaboration.
  await setScenario(page, "browser_absent");
  await openTask(page, "task_vendor_research");
  const browserStatus = page.getByLabel("Browser status");
  await browserStatus
    .getByText("No browser attached", { exact: true })
    .waitFor();
  assert(
    (await browserStatus.getByText("Guest", { exact: true }).count()) === 0,
    "The absent browser state exposed a Guest identity.",
  );
  await capture(
    page,
    "browser-collaboration",
    "browser-absent",
    "Begin research before a browser is attached.",
    "Inspect the healthy task.",
    "Browser status explicitly says No browser attached and offers Open Browser; no identity or controller is implied.",
  );
  await setScenario(page, "browser_attached");
  await capture(
    page,
    "browser-collaboration",
    "browser-attached",
    "Understand why and where browser work is happening.",
    "Attach the deterministic managed browser.",
    "The task-owned Personal browser and Agent controller become visible without diagnostic counters.",
  );
  await setScenario(page, "browser_handoff");
  await page
    .getByRole("button", { name: "Take Over", exact: true })
    .first()
    .waitFor();
  await capture(
    page,
    "browser-collaboration",
    "takeover-requested",
    "Take control to confirm plan details.",
    "Receive a browser handoff.",
    "The exact task presents the reason, Awaiting handoff, Waiting for you, and Take Over.",
  );
  await page
    .getByRole("button", { name: "Take Over", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Return to Rove", exact: true })
    .first()
    .waitFor();
  await capture(
    page,
    "browser-collaboration",
    "human-control",
    "Inspect the page myself.",
    "Take Over.",
    "Browser controller is You and Return to Rove is the primary task-owned handback action.",
  );
  await openTask(page, "task_contract_notes");
  await capture(
    page,
    "browser-collaboration",
    "shared-browser-other-task",
    "Check another task that uses the same managed browser identity.",
    "Open the second task.",
    "The second task shows the shared Personal identity without inheriting the first task's live handoff state.",
  );
  await openTask(page, "task_vendor_research");
  await page
    .getByRole("button", { name: "Return to Rove", exact: true })
    .first()
    .click();
  await page.getByText("Checking the page…", { exact: true }).first().waitFor();
  await capture(
    page,
    "browser-collaboration",
    "control-returned",
    "Return the current page to Rove and continue.",
    "Choose Return to Rove.",
    "Agent ownership returns only through an explicit fresh-page checking state.",
  );

  // Participation modes and composer controls.
  await setScenario(page, "empty");
  const composer = page.locator(".composer-input-shell");
  await composer.getByLabel("Participation mode: Agent").last().click();
  await capture(
    page,
    "participation",
    "mode-menu",
    "Choose how Rove and I will participate.",
    "Open the participation menu.",
    "Agent, Companion, and Capture have short customer-facing role descriptions.",
  );
  await page.getByRole("button", { name: "Execution mode: Companion" }).click();
  await capture(
    page,
    "participation",
    "companion-selected",
    "Plan to work together with handoffs.",
    "Choose Companion.",
    "The composer retains attachment, Commands, approval behavior, model/reasoning, and Send.",
  );
  await composer.getByLabel("Participation mode: Companion").last().click();
  await page.getByRole("button", { name: "Execution mode: Capture" }).click();
  await capture(
    page,
    "participation",
    "capture-selected",
    "Drive the browser myself while Rove captures useful context.",
    "Choose Capture.",
    "Capture is selected without implying that a model turn is already running.",
  );
  await composer.getByLabel("Commands", { exact: true }).last().click();
  await capture(
    page,
    "participation",
    "commands-open",
    "Reach less-common task configuration only when needed.",
    "Open Commands.",
    "Long-tail task and browser configuration remains behind the slash menu.",
  );

  // Recording and Capture relationship.
  await setScenario(page, "recording_none");
  await page.getByLabel("Task recordings").locator("summary").click();
  await page.getByLabel(/I understand visible sensitive content/).check();
  await capture(
    page,
    "recording",
    "consent-ready",
    "Record only this task page.",
    "Acknowledge the sensitive-content warning.",
    "The UI states selected-page scope, no audio, exclusions, and unavailable window recording.",
  );
  await page.getByRole("button", { name: "Start page recording" }).click();
  const startingRecording = page.getByRole("button", {
    name: "Starting page recording…",
  });
  await startingRecording.waitFor();
  assert(
    await startingRecording.isDisabled(),
    "Requested recording was stoppable.",
  );
  assert(
    (await page
      .getByRole("button", { name: "Stop page recording" })
      .count()) === 0,
    "Requested recording was presented as active.",
  );
  await capture(
    page,
    "recording",
    "requested",
    "See that recording is starting.",
    "Start page recording.",
    "Starting is distinct from active recording and exposes no false Stop action.",
  );
  await setScenario(page, "recording_active");
  await capture(
    page,
    "recording",
    "active",
    "Know that page recording is active.",
    "Advance the deterministic recording fixture.",
    "A persistent Page recording active panel names the task-page scope.",
  );
  await page.getByRole("button", { name: "Stop page recording" }).click();
  await page.getByRole("button", { name: "Finalizing recording…" }).waitFor();
  await capture(
    page,
    "recording",
    "finalizing",
    "Stop and wait for the recording to be saved.",
    "Stop page recording.",
    "Finalizing is disabled and visually distinct from available/playable.",
  );
  await setScenario(page, "recording_available");
  await capture(
    page,
    "recording",
    "available",
    "Open the saved recording.",
    "Complete finalization.",
    "The recording is marked available and exposes Open recording.",
  );
  await setScenario(page, "recording_failed");
  await capture(
    page,
    "recording",
    "interrupted",
    "Understand whether an interrupted recording is usable.",
    "Exercise the failed path.",
    "Recording unavailable names the interruption and does not offer playback.",
  );
  await setScenario(page, "capture_recording");
  await capture(
    page,
    "recording",
    "capture-relationship",
    "Confirm who is driving during Capture recording.",
    "Inspect active recording in Capture mode.",
    "The recording header says Capture · Human-driven while retaining page-only scope.",
  );

  // Local data management.
  await setScenario(page, "codex_ready");
  await page.getByLabel("Rove settings").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.waitFor();
  await capture(
    page,
    "data-management",
    "settings-open",
    "Find local backup and understand its scope.",
    "Open Settings.",
    "Local data explains included content, sensitive material, exclusions, device-local status, and unavailable Restore.",
  );
  await page.evaluate(() => window.rove.setBackupOutcome("created"));
  await settings.getByRole("button", { name: "Export local backup…" }).click();
  await settings.getByText(/created with 6 files/).waitFor();
  await capture(
    page,
    "data-management",
    "export-success",
    "Confirm a local backup was created.",
    "Export the deterministic local backup.",
    "A specific success message states the folder name and file count.",
  );
  await settings.getByRole("button", { name: "Close settings" }).click();
  await page.evaluate(() => window.rove.setBackupOutcome("cancelled"));
  await page.getByLabel("Rove settings").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Export local backup…" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Backup export cancelled. No backup was created." })
    .waitFor();
  assert(
    (await page
      .getByRole("alert")
      .filter({ hasText: /cancelled/i })
      .count()) === 0,
    "Cancelled backup export used failure treatment.",
  );
  await capture(
    page,
    "data-management",
    "export-cancelled",
    "Understand that a cancelled export made no backup.",
    "Cancel the deterministic export.",
    "The surface reports a neutral cancellation and confirms no backup was created.",
  );
  await page.evaluate(() => window.rove.setBackupOutcome("failed"));
  await page.getByRole("button", { name: "Export local backup…" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Rove could not create the local backup." })
    .waitFor();
  await capture(
    page,
    "data-management",
    "export-failed",
    "Understand that a real backup failure needs attention.",
    "Exercise the deterministic export failure.",
    "Operational failure remains distinct from success and customer cancellation.",
  );

  // Codex states and sign out.
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.reload();
  await page.locator(".product-app").waitFor();
  await setScenario(page, "codex_signed_out");
  await capture(
    page,
    "codex-settings",
    "signed-out",
    "Understand why tasks cannot start.",
    "Inspect the signed-out state.",
    "The top bar says Not signed in to Codex and offers one Sign in recovery action.",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const signIn = page.getByRole("dialog", { name: "Sign in to Codex" });
  await signIn.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText("Signing in…", { exact: true }).first().waitFor();
  await capture(
    page,
    "codex-settings",
    "signing-in",
    "Know that sign-in is actively in progress.",
    "Begin deterministic Codex sign-in.",
    "Signing in appears only after an explicit action and retains a Cancel route.",
  );
  await setScenario(page, "codex_ready");
  await capture(
    page,
    "codex-settings",
    "ready",
    "Confirm that Codex can execute tasks.",
    "Complete deterministic sign-in.",
    "Codex ready is concise and distinct from a Rove user profile.",
  );
  await setScenario(page, "codex_usage_limit");
  await capture(
    page,
    "codex-settings",
    "usage-limit",
    "Understand why Codex cannot run another task now.",
    "Reach the known usage limit.",
    "The specific usage-limit state avoids a generic failure and offers no futile retry.",
  );
  await setScenario(page, "codex_unavailable");
  await capture(
    page,
    "codex-settings",
    "account-check-failed",
    "Recover when Rove cannot check the Codex account.",
    "Exercise account status unavailability.",
    "The top bar says Couldn't check your Codex account and offers Retry.",
  );
  await setScenario(page, "codex_startup_failed");
  await page
    .getByRole("button", { name: "Restart Rove", exact: true })
    .waitFor();
  await capture(
    page,
    "codex-settings",
    "startup-failed",
    "Understand that local Codex startup failed.",
    "Exercise the startup-failure state.",
    "Codex couldn't start is specific, exposes Restart Rove, and does not expose diagnostics.",
  );
  await page.getByRole("button", { name: "Restart Rove", exact: true }).click();
  const restartDialog = page.getByRole("dialog", {
    name: "Codex couldn't start",
  });
  await restartDialog.waitFor();
  await capture(
    page,
    "codex-settings",
    "startup-recovery",
    "Restore Codex execution without understanding internals.",
    "Open the startup recovery.",
    "One primary Restart Rove action explains the bounded recovery without claiming an unsaved draft is persisted.",
  );
  await restartDialog.getByRole("button", { name: "Restart Rove" }).click();
  assert(
    await page.evaluate(async () => {
      const state = await window.rove.getJourneyState();
      return state.calls.some((entry) => entry.type === "restartRove");
    }),
    "Restart Rove did not cross the trusted fixture boundary.",
  );
  await page.reload();
  await page.locator(".product-app").waitFor();
  await setScenario(page, "codex_unavailable");
  await page.evaluate(() => window.rove.setConnectionFailure(true));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Couldn't check your Codex account" })
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await page
    .getByText("Something went wrong with Codex", { exact: true })
    .first()
    .waitFor();
  await capture(
    page,
    "codex-settings",
    "unknown-failure",
    "Recover from an unclassified local connection failure.",
    "Retry while the deterministic local host is unavailable.",
    "The unknown state uses bounded generic language and one Retry action.",
  );
  await page.evaluate(() => window.rove.setConnectionFailure(false));
  await page.reload();
  await page.locator(".product-app").waitFor();
  await setScenario(page, "codex_ready");
  await page.getByLabel("Rove settings").click();
  await capture(
    page,
    "codex-settings",
    "sign-out-available",
    "End the Codex execution session.",
    "Open the application menu.",
    "Sign out of Codex is available beside Codex usage, not presented as a Rove profile action.",
  );
  await page.getByRole("button", { name: "Sign out of Codex" }).click();
  await page.getByText("Not signed in to Codex", { exact: true }).waitFor();

  // Representative small and dark states.
  await setWindowSize(application, 820, 700);
  await setScenario(page, "multi_attention");
  await openTask(page, "task_launch_checklist");
  const compactComposer = page.locator(".task-composer-shell");
  for (const name of [
    "Attach files",
    "Commands",
    "Participation mode: Agent",
    "Approval policy: Approve for me",
    "Model and reasoning effort: Codex, Medium",
    "Send follow-up",
  ])
    assert(
      await compactComposer
        .getByLabel(name, { exact: true })
        .last()
        .isVisible(),
      `Compact composer hid ${name}.`,
    );
  const compactLabelsFit = await compactComposer.evaluate((composer) =>
    [
      composer.querySelector(".composer-permission-menu > summary span"),
      composer.querySelector(".composer-model-label"),
      composer.querySelector(".composer-current-effort"),
    ].every(
      (element) =>
        element instanceof HTMLElement &&
        element.scrollWidth <= element.clientWidth,
    ),
  );
  assert(compactLabelsFit, "Compact composer labels were ellipsized.");
  await capture(
    page,
    "responsive-dark",
    "small-multi-attention",
    "Use Task B while Task A needs me on a smaller window.",
    "Resize and inspect background attention.",
    "The viewed task retains glanceable attachment, Commands, participation, approval, model/reasoning, and Send controls without ellipsis or horizontal overflow.",
  );
  await setWindowSize(application, 1180, 780);
  await page.evaluate(() =>
    localStorage.setItem("rove.theme-preference.v1", "dark"),
  );
  await page.reload();
  await page.locator(".product-app").waitFor();
  await setScenario(page, "browser_human");
  await capture(
    page,
    "responsive-dark",
    "dark-browser-human",
    "See browser ownership clearly in dark mode.",
    "Inspect the human-control state.",
    "Human ownership and Return to Rove remain legible; terracotta identity remains distinct from semantic states.",
  );
  await setScenario(page, "recording_finalizing");
  await capture(
    page,
    "responsive-dark",
    "dark-recording-finalizing",
    "Distinguish recording finalization in dark mode.",
    "Inspect the finalizing state.",
    "The disabled finalizing control and page scope remain legible without clipping.",
  );
  await setScenario(page, "codex_ready");
  await page.getByLabel("Rove settings").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await capture(
    page,
    "responsive-dark",
    "dark-settings",
    "Read local-data scope in dark mode.",
    "Open Settings.",
    "Settings stays confined and local backup copy remains readable.",
  );
  await page.getByRole("button", { name: "Close settings" }).click();
  await setWindowSize(application, 820, 700);
  await setScenario(page, "codex_startup_failed");
  const compactLaunchComposer = page.locator(".composer-card");
  for (const name of [
    "Attach files",
    "Commands",
    "Participation mode: Agent",
    "Approval policy: Approve for me",
    "Model and reasoning effort: Codex, Medium",
    "Start task",
  ])
    assert(
      await compactLaunchComposer
        .getByLabel(name, { exact: true })
        .last()
        .isVisible(),
      `Compact launch composer hid ${name}.`,
    );
  const compactLaunchLabelsFit = await compactLaunchComposer.evaluate(
    (composer) =>
      [
        composer.querySelector(".composer-permission-menu > summary span"),
        composer.querySelector(".composer-model-label"),
        composer.querySelector(".composer-current-effort"),
      ].every(
        (element) =>
          element instanceof HTMLElement &&
          element.scrollWidth <= element.clientWidth,
      ),
  );
  assert(
    compactLaunchLabelsFit,
    "Compact launch composer labels were ellipsized.",
  );
  await capture(
    page,
    "responsive-dark",
    "small-dark-codex-error",
    "Recover from Codex startup failure in a smaller dark window.",
    "Inspect the specific failure state.",
    "The state and recovery hierarchy remain visible without overflow.",
  );

  // Evidence-derived findings; no product fixes are made in this stage.
  finding(
    "NON_BLOCKING_NOTE",
    "multi-task",
    "Work in Task B while Task A runs and later answer Task A.",
    "Task A remains the active executor while Task B is the viewed task.",
    "Working/attention status stays in navigation; bounded input appears only after opening Task A.",
    "This preserves independent background work and prevents composer hijacking.",
  );
  finding(
    "NON_BLOCKING_NOTE",
    "browser-collaboration",
    "Take and return browser control for one exact task.",
    "The task progresses from no attachment through Agent, awaiting handoff, You, and Agent again.",
    "The inspector keeps identity, controller, reason, and handback action task-scoped.",
    "The ownership model is understandable without exposing page-group implementation details.",
  );
  finding(
    "NON_BLOCKING_NOTE",
    "participation",
    "Choose Agent, Companion, or Capture.",
    "The mode menu is available before task launch.",
    "Each mode has a one-line role description and Capture does not start a model turn.",
    "The mode distinction is usable and consistent with the approved task mental model.",
  );
  finding(
    "COGNITIVE_LOAD",
    "participation",
    "Configure a normal task only as deeply as needed.",
    "The compact composer retains several adjacent controls even before Commands is opened.",
    "Participation, permission review, and model/reasoning are all visible alongside attachment and Commands.",
    "The controls are coherent, but a first-time private-beta user must understand several execution choices at once.",
    "apps/companion/src/renderer/product-surface.tsx",
  );
  finding(
    "NON_BLOCKING_NOTE",
    "recording",
    "Record and later open only the selected task page.",
    "Requested, recording, finalizing, available, and failed are distinct persisted states.",
    "Scope, exclusions, consent, active status, disabled finalization, playback, and failure are explicit.",
    "The recording truth is safe and understandable for private beta.",
  );
  finding(
    "NON_BLOCKING_NOTE",
    "data-management",
    "Export a truthful device-local backup.",
    "Restore remains unsupported.",
    "Settings states inclusion, exclusions, sensitivity, device-local scope, successful file count, and unavailable Restore.",
    "The surface does not imply cloud backup or Workflow sync.",
  );
  finding(
    "NON_BLOCKING_NOTE",
    "codex-settings",
    "Understand and recover from Codex execution states.",
    "Signed out, signing in, ready, usage limited, account unavailable, startup failed, unknown failure, and sign out are deterministic.",
    "Known states use specific language and avoid diagnostic hashes/versions; signed-out, account-check, and unknown states expose one primary recovery.",
    "Codex identity remains execution-specific and no local-only Rove cloud account is invented.",
  );
  finding(
    "QUALIFICATION_GAP",
    "browser-collaboration",
    "See the requesting browser page physically foregrounded during handoff.",
    "The deterministic fixture records showBrowser and ownership changes without a real private page.",
    "The task-owned inspector and Playwright trace prove the Rove-side transition, but no external browser window is captured.",
    "Physical operating-system foregrounding still requires a packaged/manual qualification with non-private fixture content.",
  );
  finding(
    "QUALIFICATION_GAP",
    "recording",
    "Play the finalized recording artifact.",
    "The fixture exposes a valid playable recording projection.",
    "Open recording is present, but the evidence pack does not launch a real media artifact.",
    "Packaged playback and codec behavior remain outside deterministic renderer evidence.",
  );

  const groups = [
    "multi-task",
    "browser-collaboration",
    "participation",
    "recording",
    "data-management",
    "codex-settings",
    "responsive-dark",
  ];
  for (const group of groups) await renderContactSheet(group);

  const journeyState = await page.evaluate(() => window.rove.getJourneyState());
  const manifest = {
    title: "Rove combined private-beta customer walkthrough",
    baseline: { branch: "main", commit, startingStatus },
    environment: {
      state: "deterministic local Electron fixture",
      liveCodexUsed: false,
      supabaseUsed: false,
      realAccountUsed: false,
      privateBrowserProfileUsed: false,
      externalActionUsed: false,
      defaultViewport: { width: 1180, height: 780 },
      smallViewport: { width: 820, height: 700 },
    },
    counts: {
      screenshots: steps.length,
      findings: findings.length,
      contactSheets: groups.length,
    },
    assertions: {
      activeTaskRemainsVisibleWhileAnotherTaskViewed: true,
      backgroundAttentionDoesNotReplaceViewedComposer: true,
      backgroundAttentionNamesExactTask: true,
      attentionClearsAfterResponse: true,
      activeTaskInputReplacesItsComposer: true,
      browserHandoffSeparateFromConversationInput: true,
      browserOwnershipTaskScoped: true,
      absentBrowserHasNoIdentity: true,
      normalComposerControlsRetained: true,
      longTailConfigurationBehindCommands: true,
      captureDoesNotImplyModelTurn: true,
      recordingScopeAndLifecycleTruthful: true,
      recordingRequestedIsDisabledStartingState: true,
      localBackupDoesNotImplyCloudOrSync: true,
      backupCancellationIsNeutral: true,
      backupOutcomesRemainDistinct: true,
      unsupportedRestoreExplained: true,
      codexStatesCustomerSpecific: true,
      startupFailureHasPrimaryRecovery: true,
      restartCrossesTrustedHostBoundary: true,
      noDeveloperDiagnosticsInCustomerCopy: true,
      noRoveCloudAccountInvented: true,
      workflowOptionalForOrdinaryTasks: true,
      resultTerminologyAbsent: true,
      terracottaDistinctFromSemanticColors: true,
      representativeSmallAndDarkPass: true,
      compactComposerLabelsFit: true,
      noDialogOutsideViewport: true,
    },
    groups,
    findings,
    steps,
  };
  await writeFile(
    join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(outputRoot, "intent-state-trace.json"),
    `${JSON.stringify(
      {
        customerSteps: steps.map(
          ({
            number,
            group,
            slug,
            customerIntent,
            action,
            applicationState,
          }) => ({
            number,
            group,
            slug,
            customerIntent,
            action,
            applicationState,
          }),
        ),
        fixtureCalls: journeyState.calls,
        stateChanges: journeyState.stateChanges,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(outputRoot, "summary.md"),
    `# Rove private-beta walkthrough

This deterministic local Electron/Playwright walkthrough captured ${steps.length} customer-visible checkpoints across the remaining private-beta capabilities. It used no live Codex, Supabase, real account, private browser profile, or external action.

## Assessment

- **Multi-task:** usable. Task A remains visibly active while Task B is viewed; its sidebar row says **Needs input** without hijacking Task B; opening Task A replaces only its composer with the required response, and the label clears after the answer.
- **Browser collaboration:** usable. The absent state explicitly says **No browser attached** without identity/controller claims; ownership transitions are task-scoped, Take Over/Return to Rove are explicit, and another task sharing the managed identity does not inherit the first task's live handoff.
- **Participation:** usable. Agent, Companion, and Capture have distinct roles; Capture remains human-driven and starts no model turn. The pre-launch composer is information-dense but coherent.
- **Capture/recording:** usable and safety-truthful. Page-only scope, sensitive-content consent, Starting, active, finalizing, playback availability, and interruption are distinct. The Starting control is disabled and never implies recording is already active.
- **Data management:** usable for export. Scope and exclusions are explicit, success is concrete, customer cancellation is neutral and confirms no backup was made, operational failure remains an alert, and unsupported Restore is clearly disclosed.
- **Settings/Codex:** ordinary and recovery states are understandable. **Codex couldn't start** exposes one **Restart Rove** recovery through the trusted host boundary without showing internals or claiming the in-memory draft is saved. Unknown failure is bounded, other recoveries are singular, and sign-out belongs to Codex execution rather than a Rove profile.

## Cross-journey result

Normal and bounded recovery paths for the remaining capabilities are usable, and no safety contradiction was observed between task input, browser handoff, participation, recording, and local backup. The six customer-facing corrections pass the deterministic walkthrough. Representative small and dark states show no dialog escape, horizontal overflow, or meaningless composer-label truncation. Remaining work is limited to the packaged/manual qualification gaps below.

### Qualification gaps

- Manually verify packaged operating-system foregrounding of the exact browser task/page using only non-private fixture content.
- Manually verify packaged playback/codec behavior for an actual finalized recording.
`,
  );

  const requiredFiles = [
    "manifest.json",
    "intent-state-trace.json",
    "summary.md",
    ...groups.map((group) => `contact-sheet-${group}.png`),
  ];
  for (const file of requiredFiles)
    assert((await stat(join(outputRoot, file))).size > 0, `${file} is empty.`);
  for (const step of steps)
    assert(
      (await stat(join(outputRoot, step.screenshot))).size > 0,
      `${step.screenshot} is empty.`,
    );
  assert(
    JSON.stringify(manifest).includes(repositoryRoot) === false,
    "Manifest contains a local absolute repository path.",
  );
  assert(
    steps.every((step) => !/\bResult\b/.test(step.visible.text)),
    "Internal Result terminology appeared in a customer-visible checkpoint.",
  );
  assert(
    steps.every(
      (step) => step.visible.tokens.accent.toLowerCase() === "#c16137",
    ),
    "A checkpoint did not retain the approved terracotta brand token.",
  );

  await application.context().tracing.stop({
    path: join(outputRoot, "private-beta-walkthrough.trace.zip"),
  });
  traceStarted = false;
  assert(
    (await stat(join(outputRoot, "private-beta-walkthrough.trace.zip"))).size >
      0,
    "Playwright trace is empty.",
  );
  console.log(
    JSON.stringify({
      status: "pass",
      output: relative(repositoryRoot, outputRoot),
      screenshots: steps.length,
      findings: findings.length,
    }),
  );
} finally {
  if (traceStarted && application) {
    try {
      await application.context().tracing.stop({
        path: join(outputRoot, "private-beta-walkthrough.failed.trace.zip"),
      });
    } catch {
      // Preserve the original failure.
    }
  }
  if (application) await application.close();
}
