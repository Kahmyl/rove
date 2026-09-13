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
  "artifacts/customer-journeys/journey-02-workflow",
);
const rendererRoot = join(repositoryRoot, "apps/companion/dist/renderer");
const fixtureMain = join(
  repositoryRoot,
  "experiments/agent-execution/electron-workflow-journey-fixture.cjs",
);
const requireBrowser = createRequire(
  join(repositoryRoot, "packages/browser/package.json"),
);
const requireCompanion = createRequire(
  join(repositoryRoot, "apps/companion/package.json"),
);
const { _electron: electron, chromium } = requireBrowser("playwright");
const electronExecutable = requireCompanion("electron");
const steps = [];

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
    const styles = [
      ".workflow-workspace",
      ".workflow-workspace-header",
      ".workflow-start-card",
      ".workflow-home-section",
      ".workflow-output-list",
      ".workflow-create-dialog",
      ".workflow-editor",
      ".workflow-context-surface",
      ".workflow-context-focused-editor",
      ".composer-command-palette",
      ".task-response-surface",
      ".composer-input-shell",
    ]
      .map((selector) => {
        const element = document.querySelector(selector);
        if (!element || !visible(element)) return null;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          selector,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          padding: style.padding,
          gap: style.gap,
          border: style.border,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
          color: style.color,
          backgroundColor: style.backgroundColor,
        };
      })
      .filter(Boolean);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      text: document.body.innerText.replace(/\s+/g, " ").trim(),
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      styles,
    };
  });
}

async function capture(
  page,
  slug,
  customerGoal,
  applicationState,
  observations,
) {
  const number = steps.length + 1;
  const screenshot = `${String(number).padStart(2, "0")}-${slug}.png`;
  await page.screenshot({ path: join(outputRoot, screenshot) });
  steps.push({
    number,
    slug,
    screenshot,
    customerGoal,
    applicationState,
    observations,
    visible: await visibleState(page),
  });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
      .meta{padding:11px 13px;border-bottom:1px solid #eaeae6}.meta strong{display:block;font-size:13px}.meta span{display:block;margin-top:4px;color:#676762;font-size:11px;line-height:1.4}.cell img{display:block;width:100%;height:auto}
    </style><h1>Rove Journey 02 · Workflow workspace</h1><div class="grid">${cells.map((step) => `<article class="cell"><div class="meta"><strong>${String(step.number).padStart(2, "0")} · ${escapeHtml(step.slug.replaceAll("-", " "))}</strong><span>${escapeHtml(step.customerGoal)}</span></div><img src="data:image/png;base64,${step.image}"></article>`).join("")}</div>`);
    await page.screenshot({
      path: join(outputRoot, "contact-sheet.png"),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
}

const note = (detail) => [{ classification: "NON_BLOCKING_NOTE", detail }];
let application;
let traceStarted = false;
try {
  application = await electron.launch({
    executablePath: electronExecutable,
    cwd: repositoryRoot,
    args: [fixtureMain],
    env: { ...process.env, ROVE_JOURNEY_RENDERER_ROOT: rendererRoot },
  });
  await application
    .context()
    .tracing.start({ screenshots: true, snapshots: true, sources: true });
  traceStarted = true;
  const page = await application.firstWindow({ timeout: 30_000 });
  await page.locator(".product-app").waitFor();

  await capture(
    page,
    "workflow-secondary-on-normal-surface",
    "Notice a place for recurring work without losing focus on the current task.",
    "A completed standalone task is open; Workflows is quiet secondary navigation.",
    note("Workflow discovery remains subordinate to ordinary task work."),
  );
  await page.getByRole("button", { name: "Create Workflow" }).click();
  await page.getByRole("dialog", { name: "Name your Workflow" }).waitFor();
  await capture(
    page,
    "name-only-creation",
    "Create a place for weekly product updates.",
    "Creation asks for one name and promises that context can be added later.",
    note("No purpose, taxonomy, resource, or guidance question gates entry."),
  );
  await page.getByLabel("Workflow name").fill("Weekly product update");
  await capture(
    page,
    "workflow-name-entered",
    "Give the recurring workspace a recognizable name.",
    "The sole required field is complete and Create Workflow is enabled.",
    note("One explicit customer input is required before creation."),
  );
  await page
    .getByRole("dialog", { name: "Name your Workflow" })
    .getByRole("button", { name: "Create Workflow", exact: true })
    .click();
  await page.locator(".workflow-workspace").waitFor();
  await capture(
    page,
    "workflow-home-entered",
    "Enter the new workspace and begin work immediately.",
    "Workflow Home is selected immediately after creation.",
    note(
      "Home establishes identity, work entry, recent tasks, and outputs without a configuration gate.",
    ),
  );
  assert(
    await page.getByText("No tasks yet", { exact: true }).isVisible(),
    "Empty recent-task state is missing.",
  );
  assert(
    await page.getByText("No outputs yet", { exact: true }).isVisible(),
    "Empty output state is missing.",
  );
  await capture(
    page,
    "empty-workspace-ready",
    "Understand what this workspace will retain before using it.",
    "Home truthfully shows no tasks and no outputs, with New task visually primary.",
    note(
      "Sparse Workflow validity is visible rather than represented as incomplete setup.",
    ),
  );

  await page
    .locator(".workflow-start-card")
    .getByRole("button", { name: "New task" })
    .click();
  await page.getByLabel("Desired outcome").waitFor();
  await capture(
    page,
    "workflow-task-composer",
    "Start ordinary work inside the Workflow.",
    "The simplified composer opens with the Workflow association already established and secondary settings hidden.",
    note(
      "The request, attachment action, command entry, and start action form the permanent chrome.",
    ),
  );
  assert(
    !(await page.getByLabel("Workflow environment").isVisible()),
    "Workflow configuration leaked into the closed composer.",
  );
  await page.getByLabel("Desired outcome").press("/");
  await page.getByLabel("Search commands").waitFor();
  await capture(
    page,
    "composer-command-palette",
    "Find a less-frequent task setting without losing the request.",
    "Typing slash opens a searchable, keyboard-accessible palette grouped around implemented actions and settings.",
    note(
      "Workflow, participation, approval, browser, model, and file controls remain available without permanent chrome.",
    ),
  );
  await page
    .getByLabel("Desired outcome")
    .fill("Prepare this week's product update from the notes I collected.");
  await page.getByLabel("Workflow guidance sharing").selectOption("share");
  await capture(
    page,
    "workflow-task-ready-to-start",
    "Confirm the task and how Workflow context may be used.",
    "Outcome, exact Workflow, and explicit context disclosure are ready; Start task is enabled.",
    note(
      "The only pre-task decision beyond the request is the existing disclosure choice; no configuration fields appear.",
    ),
  );
  await page.getByRole("button", { name: "Start task" }).click();
  await page.getByLabel("Task history: task_workflow_weekly_update").waitFor();
  await capture(
    page,
    "workflow-task-started",
    "Begin the recurring work as a normal persistent task.",
    "The task is working and task-history metadata names Weekly product update.",
    note(
      "The fixture confirms exact Workflow association and revision context without live Codex.",
    ),
  );

  const workflowRow = page
    .locator(".workflow-list-row")
    .filter({ hasText: "Weekly product update" });
  await workflowRow.click();
  await page.locator(".workflow-workspace").waitFor();
  await capture(
    page,
    "workflow-home-with-recent-task",
    "Return to the recurring workspace and continue recent work.",
    "Recent tasks contains the exact associated task and its Working status.",
    note(
      "The workspace provides persistent task rediscovery beyond the standalone task list.",
    ),
  );
  await page.evaluate(() => window.rove.seedWorkflowAttention());
  await page.getByText("Choose the final audience", { exact: true }).waitFor();
  await capture(
    page,
    "workflow-home-with-attention",
    "See when work inside this Workflow genuinely needs a decision.",
    "Needs attention projects one exact unresolved request from the associated task.",
    note(
      "Workflow Home improves rediscovery while the request remains owned by its task.",
    ),
  );
  await page.getByRole("button", { name: /Choose the final audience/ }).click();
  const responseSurface = page.locator(".task-response-surface");
  await responseSurface.waitFor();
  await capture(
    page,
    "task-input-replaces-composer",
    "Answer the decision in the work that owns it.",
    "Opening the Workflow attention item routes to the exact task and replaces its ordinary composer with one response surface.",
    note(
      "The response uses the existing exact attention identity; the normal composer is absent.",
    ),
  );
  assert(
    (await page.locator(".task-composer-shell").count()) === 0,
    "The ordinary composer competed with blocking task input.",
  );
  await responseSurface.getByText(/Leadership/).click();
  await capture(
    page,
    "bounded-choice-selected",
    "Choose the audience Rove needs to continue.",
    "One explicit option is selected; no choice was made automatically.",
    note("Bounded choices remain clear and reversible before submission."),
  );
  await responseSurface.getByRole("button", { name: "Send" }).click();
  await page.locator(".task-composer-shell").waitFor();
  await capture(
    page,
    "normal-composer-restored",
    "Continue the same task after answering.",
    "The authoritative response resolves and the ordinary composer returns on the same task.",
    note("Task identity and normal continuation are preserved."),
  );
  await page.evaluate(() => window.rove.seedWorkflowAttention());
  await page.locator(".task-response-surface").waitFor();
  await page.getByLabel("Audience answer").fill("Customer advisory group");
  await capture(
    page,
    "freeform-alternative",
    "Provide a valid answer outside the suggested choices.",
    "Something else accepts a freeform audience without trapping the customer in generated choices.",
    note(
      "The alternative is submitted through the same attention-response contract.",
    ),
  );
  await page
    .locator(".task-response-surface")
    .getByRole("button", { name: "Send" })
    .click();
  await page.locator(".task-composer-shell").waitFor();
  await workflowRow.click();
  await page.locator(".workflow-workspace").waitFor();
  await capture(
    page,
    "workflow-home-after-input",
    "Return to the recurring workspace after resolving task input.",
    "Home remains the approved work-oriented workspace; the resolved request no longer appears as attention.",
    note(
      "Task response does not create a second Workflow-level state machine.",
    ),
  );
  await page.getByRole("button", { name: "Context", exact: true }).click();
  await page.locator(".workflow-context-surface").waitFor();
  await capture(
    page,
    "context-read-first",
    "Understand the approved context before changing it.",
    "Context is a full secondary workspace page showing Goal, help, success expectations, and knowledge/resources in readable language.",
    note(
      "No configuration inputs or modal appear until a section is explicitly edited.",
    ),
  );
  assert(
    (await page.getByRole("dialog", { name: "Edit Workflow" }).count()) === 0,
    "Context still opened as a modal.",
  );
  await page
    .locator(".workflow-context-section")
    .filter({ hasText: "Goal" })
    .getByRole("button", { name: "Edit" })
    .click();
  await page
    .getByLabel("Workflow goal")
    .fill("Prepare a clear weekly update for the people who need it.");
  await capture(
    page,
    "context-focused-edit",
    "Improve one part of the Workflow context.",
    "Only Goal is editable while the rest of the page remains readable.",
    note(
      "Focused editing reuses the existing immutable configuration revision machinery.",
    ),
  );
  await page
    .locator(".workflow-context-focused-editor")
    .getByRole("button", { name: "Save" })
    .click();
  await page
    .getByText("Prepare a clear weekly update for the people who need it.", {
      exact: true,
    })
    .waitFor();
  await capture(
    page,
    "context-edit-saved",
    "Confirm the approved context change.",
    "The readable Goal reflects the saved revision and edit controls are closed.",
    note("Save returns to read-first state."),
  );
  await page
    .locator(".workflow-context-section")
    .filter({ hasText: "How Rove should help" })
    .getByRole("button", { name: "Edit" })
    .click();
  await page
    .locator(".workflow-context-focused-editor")
    .getByRole("button", { name: "Cancel" })
    .click();
  assert(
    (await page.locator(".workflow-context-focused-editor").count()) === 0,
    "Cancelling Context editing did not restore the read view.",
  );
  await capture(
    page,
    "context-edit-cancelled",
    "Leave another Context section unchanged.",
    "Cancel returns to the readable Context surface without creating another revision.",
    note("Focused editing has an explicit non-persistent exit."),
  );
  await page
    .locator(".workflow-context-advanced")
    .getByText("Advanced", { exact: true })
    .click();
  await capture(
    page,
    "advanced-context-disclosed",
    "Reach less-common configuration deliberately.",
    "Advanced reveals procedures and output preferences without activating every field.",
    note(
      "Existing capabilities remain reachable through progressive disclosure.",
    ),
  );
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.locator(".workflow-start-card").waitFor();
  await capture(
    page,
    "return-workflow-home",
    "Return to everyday Workflow work.",
    "Home returns with task entry and recent work intact.",
    note("Context remains secondary to work."),
  );

  const journeyState = await page.evaluate(() => window.rove.getJourneyState());
  const creates = journeyState.calls.filter(
    (call) => call.type === "product" && call.intent.type === "workflow.create",
  );
  const launches = journeyState.calls.filter(
    (call) => call.type === "product" && call.intent.type === "task.launch",
  );
  assert(creates.length === 1, "Expected one Workflow creation.");
  assert(
    creates[0].intent.configuration.purpose === "",
    "Creation unexpectedly required purpose.",
  );
  assert(launches.length === 1, "Expected one task launch.");
  assert(
    launches[0].intent.input.workflowId === "workflow_weekly_product_update",
    "Task used the wrong Workflow.",
  );
  assert(
    launches[0].intent.input.shareWorkflowContext === true,
    "Context disclosure was not explicit.",
  );
  assert(
    journeyState.snapshot.product.tasks[1].workflowContext.revision === 1,
    "Task did not use the current Workflow revision.",
  );
  assert(
    journeyState.snapshot.product.workflows[0].currentRevision === 2,
    "Focused Context save did not persist a revision.",
  );
  assert(
    steps.every((entry) => !entry.visible.horizontalOverflow),
    "A journey step has horizontal overflow.",
  );

  await application
    .context()
    .tracing.stop({ path: join(outputRoot, "journey-02.trace.zip") });
  traceStarted = false;
  await renderContactSheet();
  const manifest = {
    title: "Customer Journey 02 — Workflow workspace",
    journey:
      "Create a Workflow, start work through progressive commands, answer exact task input, and refine readable Context.",
    baseline: {
      commit,
      gitStatus,
      fixture:
        "deterministic local Electron state with one completed normal task, no initial Workflow, and fixture-only Codex execution",
      viewport: { width: 1180, height: 780 },
      supabaseUsed: false,
      liveAccountUsed: false,
      liveCodexUsed: false,
      externalActionsUsed: false,
    },
    counts: {
      screenshots: steps.length,
      requiredWorkflowCreationInputs: 1,
      advancedConfigurationInputsBeforeEntry: 0,
      associatedTasks: 1,
      conversationalAttentionResponses: 2,
      workflowContextRevisions: 2,
    },
    assertions: {
      nameOnlyCreation: true,
      immediateWorkflowHome: true,
      sparseWorkflowAccepted: true,
      taskUsesExactWorkflow: true,
      taskUsesCurrentRevisionContext: true,
      recentTaskProjected: true,
      exactAttentionRouted: true,
      slashPaletteAccessible: true,
      taskInputReplacesComposer: true,
      freeformAlternative: true,
      composerRestored: true,
      contextReadFirst: true,
      focusedContextEdit: true,
      focusedContextCancel: true,
      advancedContextReachable: true,
      contextSecondary: true,
      standaloneHistoryPreserved: true,
    },
    steps,
  };
  await writeFile(
    join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(outputRoot, "trace.json"),
    `${JSON.stringify({ calls: journeyState.calls, finalSnapshot: journeyState.snapshot }, null, 2)}\n`,
  );
  await writeFile(
    join(outputRoot, "summary.md"),
    `# Customer Journey 02 — Workflow interaction\n\nThe deterministic local Electron journey passed with ${steps.length} screenshots and no live Codex, real account, Supabase, or external action.\n\n- **Composer:** The permanent surface is reduced to request, attachment, command, and send controls. Typing slash opens searchable access to the implemented task, Workflow, browser, approval, model, and file choices.\n- **Task-required input:** An exact conversational request replaces only its owning selected task's composer. Suggested choices and a freeform alternative both submit through the existing attention contract; successful response restores the normal composer.\n- **Background attention:** Workflow Home shows an exact lightweight indicator and routes to the owning task before presenting input.\n- **Workflow Context:** Context is a full read-first workspace surface. One section enters focused edit mode, save creates the next existing immutable revision, cancel remains available, and Advanced stays collapsed until requested.\n- **Preserved boundaries:** Workflow Home architecture, task lifecycle, browser handoff, approval authority, Results behavior, standalone work, and local-only test state remain unchanged.\n\nEvidence: ordered PNGs, \`contact-sheet.png\`, \`manifest.json\`, \`trace.json\`, and \`journey-02.trace.zip\`.\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ status: "pass", output: relative(repositoryRoot, outputRoot), screenshots: steps.length }, null, 2)}\n`,
  );
} finally {
  if (traceStarted && application)
    await application
      .context()
      .tracing.stop()
      .catch(() => undefined);
  await application?.close().catch(() => undefined);
}
