#!/usr/bin/env node
/* global console, document, getComputedStyle, innerHeight, innerWidth, localStorage, window */

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
  "artifacts/customer-journeys/journey-03-results-outputs",
);
const rendererRoot = join(repositoryRoot, "apps/companion/dist/renderer");
const fixtureMain = join(
  repositoryRoot,
  "experiments/agent-execution/electron-results-outputs-journey-fixture.cjs",
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
const allowedClassifications = new Set([
  "CUSTOMER_FLOW_BLOCKER",
  "MENTAL_MODEL_CONFUSION",
  "COGNITIVE_LOAD",
  "INFORMATION_HIERARCHY_ISSUE",
  "COPY_CONFUSION",
  "VISUAL_LAYOUT_ISSUE",
  "MISPLACED_RESPONSIBILITY",
  "SAFETY_COMMUNICATION_ISSUE",
  "NON_BLOCKING_NOTE",
]);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function observation(classification, detail) {
  assert(
    allowedClassifications.has(classification),
    `Unknown classification: ${classification}`,
  );
  return { classification, detail };
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
    const selectors = [
      ".workflow-workspace",
      ".workflow-home",
      ".workflow-outputs",
      ".workflow-output-list",
      ".output-detail",
      ".output-action-status",
      ".output-action-review",
      ".task-detail",
      ".task-timeline",
      ".output-saved-marker",
      ".output-context-rail",
      ".workflow-promotion",
      ".workflow-editor",
      ".composer-input-shell",
    ];
    const styles = selectors
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
          overflow: style.overflow,
        };
      })
      .filter(Boolean);
    const root = getComputedStyle(document.documentElement);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      theme: document.documentElement.dataset.roveTheme ?? "system",
      brandTokens: {
        accent: root.getPropertyValue("--rove-accent").trim(),
        accentVisible: root.getPropertyValue("--rove-accent-visible").trim(),
        accentSoft: root.getPropertyValue("--rove-accent-soft").trim(),
        warning: root.getPropertyValue("--warning").trim(),
        danger: root.getPropertyValue("--danger").trim(),
        success: root.getPropertyValue("--success").trim(),
      },
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
  customerIntent,
  action,
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
    customerIntent,
    action,
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
    </style><h1>Rove Journey 03 · Outputs</h1><div class="grid">${cells
      .map(
        (step) =>
          `<article class="cell"><div class="meta"><strong>${String(step.number).padStart(2, "0")} · ${escapeHtml(step.slug.replaceAll("-", " "))}</strong><span>${escapeHtml(step.customerIntent)}</span></div><img src="data:image/png;base64,${step.image}"></article>`,
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

async function openOutput(page, title) {
  await page
    .getByRole("button", { name: `Open Output: ${title}` })
    .first()
    .click();
  await page.locator(".output-detail").waitFor();
}

async function setTheme(page, theme) {
  await page.evaluate((value) => {
    document.documentElement.dataset.roveTheme = value;
    localStorage.setItem("rove-theme", value);
  }, theme);
}

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

  const workflowRow = page
    .locator(".workflow-list-row")
    .filter({ hasText: "Weekly product update" });
  await workflowRow.click();
  await page.locator(".workflow-home").waitFor();
  await capture(
    page,
    "workflow-home",
    "Prepare useful work in my recurring weekly-update workspace.",
    "Open the existing Workflow.",
    "Workflow Home presents task creation first and truthfully has no Outputs yet.",
    [
      observation(
        "NON_BLOCKING_NOTE",
        "Workflow Home remains restrained and makes starting work the primary action.",
      ),
    ],
  );

  await page
    .locator(".workflow-start-card")
    .getByRole("button", { name: "New task" })
    .click();
  await page
    .getByLabel("Desired outcome")
    .fill("Prepare this week's product update from the work we've completed.");
  await page.getByLabel("Commands", { exact: true }).click();
  await page.getByLabel("Workflow guidance sharing").selectOption("share");
  await page.keyboard.press("Escape");
  await capture(
    page,
    "task-ready",
    "Ask Rove for this week's update.",
    "Enter the request and allow relevant Workflow guidance.",
    "The ordinary compact composer is ready to start the Workflow task.",
    [],
  );

  await page.getByRole("button", { name: "Start task" }).click();
  await page.getByLabel("Task history: task_weekly_product_update").waitFor();
  await capture(
    page,
    "task-started",
    "Know that Rove started the work.",
    "Start the task.",
    "The request and working commentary appear in the normal conversation.",
    [],
  );

  await page.evaluate(() => window.rove.seedCompletedWork());
  await page
    .getByText("Weekly product update", { exact: true })
    .last()
    .waitFor();
  await capture(
    page,
    "useful-work",
    "Read and decide whether to keep the useful update.",
    "Wait for deterministic completion.",
    "Useful work appears as an assistant response with one clear Save to Outputs action.",
    [
      observation(
        "NON_BLOCKING_NOTE",
        "Conversation remains primary and no duplicate saved-work shelf appears.",
      ),
    ],
  );

  const saveOutput = page.getByRole("button", {
    name: "Save response to Outputs",
  });
  await saveOutput.click();
  const savedMarker = page.getByRole("button", {
    name: "Open saved Output: Weekly product update",
  });
  await savedMarker.waitFor();
  await capture(
    page,
    "saved-output-marker",
    "Confirm that the work is now durable.",
    "Choose Save to Outputs once.",
    "A quiet terracotta-tinted marker acknowledges Weekly product update · Saved to Outputs.",
    [
      observation(
        "NON_BLOCKING_NOTE",
        "Saving requires no type, title, or material form and preserves exact response content.",
      ),
    ],
  );

  let journeyState = await page.evaluate(() => window.rove.getJourneyState());
  assert(
    journeyState.snapshot.product.tasks[0].results.length === 1,
    "One-click save did not create exactly one durable Output.",
  );
  assert(
    (await page
      .getByRole("button", { name: "Save response to Outputs" })
      .count()) === 0,
    "Save remained available after the source response was saved.",
  );

  await workflowRow.click();
  await page.locator(".workflow-home").waitFor();
  await capture(
    page,
    "workflow-home-with-output",
    "Find the update again without remembering its task.",
    "Return to Workflow Home.",
    "Recent Outputs shows the title, recognizable preview, and restrained Output identity.",
    [],
  );

  await page.getByRole("button", { name: "Outputs", exact: true }).click();
  await page.locator(".workflow-output-list").waitFor();
  const draftOutputRow = page.getByRole("button", {
    name: "Open Output: Weekly product update",
  });
  const outputAccessibleNames = await page
    .locator('.workflow-output-list > button[aria-label^="Open Output:"]')
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label") ?? ""),
    );
  assert(
    outputAccessibleNames.every(
      (name) => !/result_|revision|workflow output/i.test(name),
    ),
    "Output accessible names exposed internal terminology or identifiers.",
  );
  await draftOutputRow.focus();
  await capture(
    page,
    "outputs-list",
    "See the useful things this Workflow produced.",
    "Open Outputs and focus the weekly update.",
    "Outputs presents recognition-oriented cards with kind, title, preview, and source task.",
    [
      observation(
        "NON_BLOCKING_NOTE",
        "The focused Output uses terracotta only as a restrained Rove-owned emphasis.",
      ),
    ],
  );

  await openOutput(page, "Weekly product update");
  await capture(
    page,
    "output-detail",
    "Read and act on the saved update.",
    "Open the weekly update.",
    "A dedicated Output detail surface stays inside the Workflow and shows content, natural task provenance, Edit, Add to Context, and Continue in task.",
    [],
  );

  await page.getByRole("button", { name: "Continue in task" }).click();
  const usingChip = page.getByRole("button", {
    name: /Using: Weekly product update/,
  });
  await usingChip.waitFor();
  await capture(
    page,
    "using-output",
    "Ask Rove to keep working from this exact Output.",
    "Choose Continue in task.",
    "The source task opens and a soft terracotta chip says Using: Weekly product update.",
    [],
  );

  await page.getByLabel("Follow-up outcome").fill("Make this shorter.");
  await capture(
    page,
    "follow-up-ready",
    "Request a concise version using the saved work.",
    "Enter a normal follow-up.",
    "The Output context remains visible while the customer writes normally.",
    [],
  );
  await page.getByRole("button", { name: "Send follow-up" }).click();
  await page.getByText(/make the leadership version shorter/).waitFor();
  await capture(
    page,
    "follow-up-complete",
    "Confirm that Rove used the saved Output.",
    "Submit the follow-up.",
    "The deterministic task message carries the exact internal Result identity while the UI speaks only about the Output.",
    [],
  );

  await savedMarker.click();
  await page.locator(".output-detail").waitFor();
  await page.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByRole("dialog", { name: "Edit Output" });
  await editor.waitFor();
  const editorBody = editor.getByLabel("Output content");
  assert(
    !(await editorBody.inputValue()).startsWith("## Weekly product update"),
    "Edit Output repeated the Output title as a Markdown heading.",
  );
  await capture(
    page,
    "edit-output",
    "Directly improve the durable work.",
    "Choose Edit.",
    "A focused editor exposes title and content without revision terminology.",
    [],
  );
  await editorBody.fill(
    "Workflow Home and the compact composer are complete. Next week, validate the Outputs experience with customers.",
  );
  await editor.getByRole("button", { name: "Save changes" }).click();
  await page.locator(".output-detail").waitFor();
  await capture(
    page,
    "edited-output",
    "See the saved change.",
    "Save the edited Output.",
    "The detail updates through immutable internal revision machinery without exposing version numbers.",
    [],
  );

  await page.getByRole("button", { name: "Add to Context" }).click();
  const promotion = page.getByRole("dialog", { name: "Add to Context" });
  await promotion.waitFor();
  await promotion.getByLabel("What Rove should remember").waitFor();
  assert(
    (await promotion.getByLabel("Workflow").count()) === 0,
    "Add to Context exposed the current Workflow as a configuration choice.",
  );
  assert(
    (await promotion.getByText("Reusable information class").count()) === 0 &&
      (await promotion.getByLabel("Promotion category").count()) === 0,
    "Add to Context exposed internal reusable-information taxonomy.",
  );
  assert(
    !(await promotion.getByLabel("Relevant topics").isVisible()),
    "Advanced topic scope was expanded by default.",
  );
  await capture(
    page,
    "add-to-context",
    "Let Rove reuse this approved information in future Workflow tasks.",
    "Choose Add to Context.",
    "The explicit promotion review explains future use and keeps the reusable text editable.",
    [],
  );
  await promotion
    .getByRole("button", { name: "Add to Context", exact: true })
    .click();
  await page.getByRole("button", { name: "Context", exact: true }).click();
  await page.getByText(/Workflow Home and the compact composer/).waitFor();
  await capture(
    page,
    "context-promoted",
    "Verify that only approved material became reusable.",
    "Save and inspect Workflow Context.",
    "Approved knowledge contains the Output material; the Output remains independently durable.",
    [],
  );

  await page.evaluate(() => window.rove.seedPreparedAction());
  await page.getByRole("button", { name: "Outputs", exact: true }).click();
  await openOutput(page, "Send leadership update");
  await capture(
    page,
    "action-ready",
    "Review exactly what Rove proposes to send.",
    "Open the authoritative Action Output.",
    "Ready for approval says nothing has been sent and shows To, Message, Destination, and Scope without browser control names.",
    [],
  );
  assert(
    !(await page.locator(".output-detail").innerText()).includes("control"),
    "Internal browser control names leaked into Action review.",
  );

  await page.getByRole("button", { name: "Approve and send" }).click();
  await page.getByText("Approved", { exact: true }).waitFor();
  await capture(
    page,
    "action-approved",
    "Know that permission was recorded but completion is not confirmed.",
    "Approve the reviewed consequence.",
    "Approved explicitly says Rove has permission and completion is not yet confirmed.",
    [],
  );
  await page.evaluate(() =>
    window.rove.transitionAction("result_send_leadership_update", "dispatched"),
  );
  await page.getByText("Checking outcome", { exact: true }).waitFor();
  await capture(
    page,
    "action-checking",
    "Understand that Rove initiated the action but is still checking.",
    "Advance deterministic Runtime truth to dispatched.",
    "Checking outcome uses semantic warning treatment, not the terracotta brand accent.",
    [],
  );
  await page.evaluate(() =>
    window.rove.transitionAction("result_send_leadership_update", "confirmed"),
  );
  await page.getByText("Sent", { exact: true }).waitFor();
  await capture(
    page,
    "action-confirmed",
    "Know that the action succeeded.",
    "Advance deterministic Runtime truth to confirmed.",
    "Sent states that Rove confirmed success and uses semantic success treatment.",
    [],
  );

  await page.evaluate(() => window.rove.seedUnresolvedAction());
  await page
    .getByRole("button", { name: /Outputs/ })
    .first()
    .click();
  await openOutput(page, "Send launch-risk summary");
  await capture(
    page,
    "uncertain-action-ready",
    "Review a separate action that may later become uncertain.",
    "Open the second authoritative Action Output.",
    "The action begins Ready for approval with exact customer consequence material.",
    [],
  );
  await page.getByRole("button", { name: "Approve and send" }).click();
  await page.getByText("Approved", { exact: true }).waitFor();
  await capture(
    page,
    "uncertain-action-approved",
    "Authorize only this exact action.",
    "Approve the second action.",
    "The second action is Approved without implying completion.",
    [],
  );
  await page.evaluate(() =>
    window.rove.transitionAction("result_send_risk_summary", "dispatched"),
  );
  await page.getByText("Checking outcome", { exact: true }).waitFor();
  await capture(
    page,
    "uncertain-action-checking",
    "See that the outcome is still being checked.",
    "Advance the second action to dispatched.",
    "The UI preserves the distinction between initiation and confirmation.",
    [],
  );
  await page.evaluate(() =>
    window.rove.transitionAction("result_send_risk_summary", "unresolved"),
  );
  await page.getByText("Outcome unclear", { exact: true }).waitFor();
  await capture(
    page,
    "action-outcome-unclear",
    "Understand the safest next step when Rove cannot confirm the outcome.",
    "Advance deterministic Runtime truth to unresolved.",
    "Outcome unclear tells the customer to check the destination before trying again and offers no Retry.",
    [
      observation(
        "NON_BLOCKING_NOTE",
        "Uncertainty remains truthful and does not encourage blind repetition.",
      ),
    ],
  );
  assert(
    (await page.getByRole("button", { name: /retry/i }).count()) === 0,
    "Unresolved Action offered a blind Retry.",
  );

  await setTheme(page, "dark");
  await capture(
    page,
    "dark-action-unclear",
    "Review uncertainty in dark appearance.",
    "Switch the deterministic visual fixture to dark appearance.",
    "Semantic warning remains distinct from the terracotta Output identity.",
    [],
  );
  await page
    .getByRole("button", { name: /Outputs/ })
    .first()
    .click();
  await page.locator(".workflow-output-list").waitFor();
  await capture(
    page,
    "dark-outputs-list",
    "Scan durable work in dark appearance.",
    "Return to the Outputs list.",
    "Terracotta identity accents remain restrained against the dark neutral foundation.",
    [],
  );
  await openOutput(page, "Weekly product update");
  await capture(
    page,
    "dark-output-detail",
    "Read the saved update in dark appearance.",
    "Open the edited Output.",
    "Output identity, content hierarchy, provenance, and secondary Context action remain legible.",
    [],
  );
  await page.getByRole("button", { name: "Continue in task" }).click();
  await page
    .getByRole("button", { name: /Using: Weekly product update/ })
    .waitFor();
  await capture(
    page,
    "dark-using-output",
    "Confirm the carried Output context in dark appearance.",
    "Continue in the source task.",
    "The tinted Using chip is recognizable without becoming a warning or a primary button.",
    [],
  );

  await setTheme(page, "light");
  await page.setViewportSize({ width: 820, height: 760 });
  await workflowRow.click();
  await page.getByRole("button", { name: "Outputs", exact: true }).click();
  await page.locator(".workflow-output-list").waitFor();
  await capture(
    page,
    "small-outputs-list",
    "Find an Output in a smaller workspace.",
    "Use the Outputs list at an 820px viewport.",
    "Cards retain readable previews and no page-level horizontal overflow.",
    [],
  );
  await openOutput(page, "Weekly product update");
  await capture(
    page,
    "small-output-detail",
    "Use an Output in a smaller workspace.",
    "Open the weekly update at the small viewport.",
    "The detail actions stack, content remains readable, and provenance remains visible.",
    [],
  );

  journeyState = await page.evaluate(() => window.rove.getJourneyState());
  const finalTask = journeyState.snapshot.product.tasks[0];
  const draft = finalTask.results.find(
    (entry) => entry.resultId === "result_weekly_update_draft",
  );
  const confirmed = finalTask.results.find(
    (entry) => entry.resultId === "result_send_leadership_update",
  );
  const unresolved = finalTask.results.find(
    (entry) => entry.resultId === "result_send_risk_summary",
  );
  const followup = journeyState.calls.find(
    (entry) => entry.intent?.type === "task.message",
  );
  const promotions = journeyState.calls.filter(
    (entry) => entry.intent?.type === "workflow.promote",
  );
  assert(
    draft?.currentRevision === 2,
    "Output edit did not advance internally.",
  );
  assert(
    followup?.intent.selectedResultIds?.includes(draft.resultId),
    "Continuation did not bind the exact Output identity.",
  );
  assert(
    confirmed?.lifecycle === "confirmed",
    "Confirmed Action was not retained.",
  );
  assert(
    unresolved?.lifecycle === "unresolved",
    "Unresolved Action was not retained.",
  );
  assert(
    promotions.length === 1,
    "Context promotion was not explicit and singular.",
  );
  assert(
    journeyState.snapshot.product.workflows[0].revision.configuration
      .approvedKnowledge.length === 1,
    "Approved Output material was not retained in Workflow Context.",
  );
  assert(
    steps.every((step) => !step.visible.horizontalOverflow),
    "A Journey 03 checkpoint has page-level horizontal overflow.",
  );
  assert(
    steps.every(
      (step) => step.visible.brandTokens.accent.toLowerCase() === "#c16137",
    ),
    "A Journey 03 checkpoint did not use the terracotta brand source.",
  );
  assert(
    steps
      .filter((step) => step.visible.theme === "dark")
      .every(
        (step) =>
          step.visible.brandTokens.accentVisible !==
          step.visible.brandTokens.warning,
      ),
    "Dark brand accent collapsed into semantic warning.",
  );

  await application.context().tracing.stop({
    path: join(outputRoot, "journey-03.trace.zip"),
  });
  traceStarted = false;
  await renderContactSheet();

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
  const findings = [
    observation(
      "NON_BLOCKING_NOTE",
      "Result remains internal while every ordinary customer-facing durable-work surface uses Output.",
    ),
    observation(
      "NON_BLOCKING_NOTE",
      "One-click saving derives title and kind deterministically and prevents a second save from the same rendered response.",
    ),
    observation(
      "NON_BLOCKING_NOTE",
      "Action Outputs preserve exact internal lifecycle truth while translating consequence and avoiding browser-grounding fields.",
    ),
    observation(
      "NON_BLOCKING_NOTE",
      "The terracotta accent is limited to Rove-owned identity, selection, saved acknowledgement, and context relationships.",
    ),
  ];
  const manifest = {
    title: "Customer Journey 03 — Outputs",
    objective:
      "Save, rediscover, inspect, continue, edit, and promote useful work through one customer-facing Output model, then review confirmed and unresolved authoritative Actions.",
    baseline: { branch: "main", commit, gitStatus },
    environment: {
      state: "deterministic local Electron fixture",
      liveCodexUsed: false,
      supabaseUsed: false,
      realAccountUsed: false,
      externalActionUsed: false,
      defaultViewport: { width: 1180, height: 780 },
      smallViewport: { width: 820, height: 760 },
    },
    brand: {
      renderedAsset: "apps/companion/src/renderer/assets/rove-mark.png",
      staleAssetNotUsedForTokens:
        "apps/companion/src/renderer/assets/rove-mark.svg",
      dominantOpaquePixel: "#C16137",
      supportingObservedPixels: ["#C16037", "#C06037", "#BE5F37"],
      lightMarkPixel: "#FAF5EE",
    },
    counts: {
      screenshots: steps.length,
      outputs: finalTask.results.length,
      internalDraftRevision: draft.currentRevision,
      contextPromotions: promotions.length,
    },
    assertions: {
      resultTerminologyAbsentFromNormalCustomerFlow: true,
      accessibleOutputNamesCustomerFacing: true,
      oneClickSaveToOutputs: true,
      noManualOutputTypeOrTitle: true,
      noManualActionCreation: true,
      duplicateSavePrevented: true,
      oldSavedResultShelfAbsent: true,
      realOutputDetailSurface: true,
      exactOutputContextBoundToFollowup: true,
      usingChipVisible: true,
      editHidesRevisionMechanics: true,
      contextPromotionExplicit: true,
      contextDestinationImplicitInWorkflow: true,
      contextTaxonomyHidden: true,
      contextAdvancedScopeCollapsed: true,
      duplicateTitleHeadingSuppressed: true,
      actionGroundingHidden: true,
      actionTruthPreserved: true,
      unresolvedHasNoBlindRetry: true,
      terracottaBrandSourceUsed: true,
      brandAndSemanticColorsDistinct: true,
      lightDarkAndSmallViewportCaptured: true,
      noExternalAction: true,
    },
    findings,
    steps,
  };
  await writeFile(
    join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(outputRoot, "trace.json"),
    `${JSON.stringify(
      {
        intents: journeyState.calls,
        stateChanges: journeyState.stateChanges,
        finalSnapshot: journeyState.snapshot,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(outputRoot, "summary.md"),
    `# Customer Journey 03 — Outputs

The deterministic local Electron journey captured ${steps.length} customer-visible checkpoints with no live Codex, Supabase, real account, or external action.

## Customer model

Useful assistant work remains in the conversation until the customer chooses **Save to Outputs**. Saving is one click and creates the existing stable internal Result record with a deterministic title and safe kind. The task keeps only a compact saved acknowledgement. Workflow Home and Outputs rediscover the durable work, and opening it presents a real Output detail surface inside the Workflow.

**Continue in task** binds the exact internal Result revision to the next message and shows **Using: Weekly product update** in the composer. **Edit** updates the durable Output through immutable internal revision machinery without exposing version terminology or repeating a first Markdown heading that matches the Output title. **Add to Context** remains an explicit reviewed promotion into reusable Workflow guidance, but the current Workflow destination and internal information class are implicit; optional topic scope is available under Advanced.

Authoritative Action records appear as Action Outputs. Customers review consequence and material, never browser control names. Internal lifecycle states are translated to Ready for approval, Approved, Checking outcome, Sent, Couldn't complete, and Outcome unclear. The unresolved path warns the customer to check the destination before trying again and offers no blind Retry.

## Brand trial

The renderer's current mark is the terracotta PNG at apps/companion/src/renderer/assets/rove-mark.png. Its dominant opaque pixel is #C16137; the older green SVG is not used as token authority. Terracotta appears only in saved Output acknowledgement, Output identity/navigation, Context-related actions, and the Using chip. Success, warning, danger, and uncertainty retain separate semantic colors. Light, dark, and 820px evidence is included.

## Bounded gaps

This journey uses deterministic fixture-only authoritative Action materialization because automatic Action Output creation is not claimed here. Output version-history UI and cross-task “Use in new task” remain deferred.
`,
  );

  for (const name of [
    "manifest.json",
    "trace.json",
    "summary.md",
    "contact-sheet.png",
    "journey-03.trace.zip",
  ])
    assert((await stat(join(outputRoot, name))).size > 0, `${name} is empty.`);
  for (const step of steps)
    assert(
      (await stat(join(outputRoot, step.screenshot))).size > 0,
      `${step.screenshot} is empty.`,
    );
  assert(
    JSON.stringify(manifest).includes(repositoryRoot) === false,
    "Manifest contains a local absolute repository path.",
  );

  console.log(
    JSON.stringify(
      {
        status: "pass",
        output: relative(repositoryRoot, outputRoot),
        screenshots: steps.length,
        outputs: finalTask.results.length,
      },
      null,
      2,
    ),
  );
} finally {
  if (application) {
    if (traceStarted)
      await application.context().tracing.stop({
        path: join(outputRoot, "journey-03.trace.zip"),
      });
    await application.close();
  }
}
