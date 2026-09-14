#!/usr/bin/env node
/* global document, getComputedStyle, HTMLButtonElement, HTMLDetailsElement, HTMLElement, localStorage, window */

import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

import {
  UI_TRUTH_SCENARIO_BY_ID,
  UI_TRUTH_VIEWPORTS,
} from "./ui-truth-scenarios.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const requireBrowserDependency = createRequire(
  join(repositoryRoot, "packages/browser/package.json"),
);
const { chromium } = requireBrowserDependency("playwright");
const rendererRoot = join(repositoryRoot, "apps/companion/dist/renderer");
const outputRoot = process.env.ROVE_PRODUCT_SURFACE_VISUAL_OUTPUT
  ? resolve(process.env.ROVE_PRODUCT_SURFACE_VISUAL_OUTPUT)
  : join(repositoryRoot, "artifacts/verification/product-surface");
const workspaceId = "wrk_00000000-0000-4000-8000-000000000001";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const path = join(rendererRoot, pathname === "/" ? "index.html" : pathname);
    const body = await readFile(path);
    response.writeHead(200, {
      "content-type": mime[extname(path)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise((resolveListen) =>
  server.listen(0, "127.0.0.1", resolveListen),
);
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("No fixture port.");

function baseSnapshot(presentation, accountStatus) {
  return {
    surface: {
      presentation,
      browserContext: "windowed",
      activeHost:
        presentation === "full" ? "control_center" : "browser_follower",
      returnPresentation: "chip",
      revision: 3,
    },
    companion: null,
    notice: null,
    workspaces: {
      selectedWorkspaceId: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          displayName: "Personal",
          browser: "chrome",
          storageLayout: "workspace",
          createdAt: "2026-09-07T00:00:00Z",
          lastUsedAt: "2026-09-07T00:00:00Z",
        },
      ],
    },
    product: {
      version: 9,
      host: {
        state: "ready",
        ready: true,
        restartAttempt: 0,
        compatibility: {
          version: "0.153.4",
          platform: "macos",
          architecture: "arm64",
          source: "packaged",
        },
      },
      catalog: {
        account:
          accountStatus === "logged_in"
            ? { status: "logged_in", authMode: "chatgpt", planType: "Plus" }
            : { status: accountStatus },
        models: [
          {
            id: "gpt-6-astra",
            model: "gpt-6-astra",
            displayName: "GPT-6 Astra",
            description: "Fixture model",
            efforts: ["low", "medium", "high"],
            defaultEffort: "low",
            isDefault: true,
            inputModalities: ["text", "image"],
            supportsPersonality: false,
            defaultServiceTier: null,
          },
          {
            id: "gpt-5.6-sol",
            model: "gpt-5.6-sol",
            displayName: "GPT-5.6 Sol",
            description: "Fixture model with a narrower effort catalog",
            efforts: ["low", "high"],
            defaultEffort: "high",
            isDefault: false,
            inputModalities: ["text", "image"],
            supportsPersonality: false,
            defaultServiceTier: null,
          },
        ],
        rateLimits: [
          {
            limitId: "codex",
            limitName: "Five-hour window",
            usedPercent: 38,
            resetsAt: 1788825600,
            windowDurationMins: 300,
            planType: "Plus",
          },
        ],
        usage: { summary: { inputTokens: 18500 }, dailyUsageBuckets: null },
        refreshedAt: "2026-09-07T00:00:00Z",
      },
      attention: [],
      fileAttention: [],
      draftAttachments: [],
      tasks: [],
      workflows: [],
      recoveryWarnings: [],
    },
    productError: null,
  };
}

function activeSnapshot(presentation) {
  const value = baseSnapshot(presentation, "logged_in");
  value.product.recoveryWarnings = [
    "Codex event recovery: Task event identity was reused with different content.",
    "Codex event recovery: Task event identity was reused with different content.",
  ];
  value.companion = {
    session: {
      id: "ses_visual",
      bootstrapId: "boot_visual",
      mode: "companion",
      status: "awaiting_human",
      controller: null,
      profile: { mode: "persistent", name: workspaceId },
      workspace: value.workspaces.workspaces[0],
      handoff: {
        reason: "Confirm the delivery address before checkout",
        requestedAt: "2026-09-07T00:00:00Z",
      },
      createdAt: "2026-09-07T00:00:00Z",
      updatedAt: "2026-09-07T00:01:00Z",
    },
    observationCount: 12,
    evidenceCount: 4,
  };
  value.product.tasks = [
    {
      taskId: "task_history",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      selectionSource: "user_selected",
      selectedAt: "2026-09-06T00:00:00Z",
      approvalsReviewer: "auto_review",
      bootstrapStage: "complete",
      roveSessionId: "ses_history",
      codexThreadId: "thread_history",
      conversation: {
        turnStatus: "completed",
        archived: false,
        turnOrder: ["turn_history"],
        items: {
          history: {
            id: "history",
            turnId: "turn_history",
            kind: "assistant_message",
            status: "completed",
            authoredBy: "assistant",
            text: "Historical result",
          },
        },
      },
      lifecycle: { phase: "closed", reason: "Historical task · read-only" },
      availableActions: ["archive"],
    },
    {
      taskId: "task_visual",
      executionMode: "companion",
      browserIdentity: { mode: "workspace", workspaceId },
      selectionSource: "user_selected",
      selectedAt: "2026-09-07T00:00:00Z",
      approvalsReviewer: "auto_review",
      bootstrapStage: "complete",
      roveSessionId: "ses_visual",
      codexThreadId: "thread_visual",
      model: "gpt-6-astra",
      reasoningEffort: "low",
      conversation: {
        activeTurnId: "turn_visual",
        turnStatus: "in_progress",
        archived: false,
        turnOrder: ["turn_visual"],
        items: {
          user: {
            id: "user",
            turnId: "turn_visual",
            kind: "user_message",
            status: "completed",
            authoredBy: "user",
            completedAt: "2026-09-07T00:00:00Z",
            text: "Compare the options and prepare the order for my review.",
          },
          assistant: {
            id: "assistant",
            turnId: "turn_visual",
            kind: "assistant_message",
            status: "completed",
            authoredBy: "assistant",
            phase: "commentary",
            completedAt: "2026-09-07T00:00:06Z",
            text: "I compared the available options and paused before checkout.",
          },
          tool: {
            id: "tool",
            turnId: "turn_visual",
            kind: "tool",
            status: "completed",
            completedAt: "2026-09-07T00:00:10Z",
            title: "rove/browser.inspect",
          },
          command: {
            id: "command",
            turnId: "turn_visual",
            kind: "command",
            status: "completed",
            completedAt: "2026-09-07T00:00:14Z",
            title: "Prepare comparison",
          },
          result: {
            id: "result",
            turnId: "turn_visual",
            kind: "assistant_message",
            status: "completed",
            authoredBy: "assistant",
            phase: "final_answer",
            completedAt: "2026-09-07T00:00:16Z",
            text: [
              "## Comparison ready",
              "",
              "- Option A is faster.",
              "- Option B costs less.",
              "",
              "| Option | Outcome |",
              "| --- | --- |",
              "| A | Faster |",
              "| B | Lower cost |",
              "",
              'ROVE_LIVE_RESULT {"status":"passed","choice":"A"}',
            ].join("\n"),
          },
          continuation: {
            id: "continuation",
            turnId: "turn_visual",
            kind: "user_message",
            status: "completed",
            authoredBy: "host",
            completedAt: "2026-09-07T00:00:20Z",
            text: "Continue after human control returned.",
          },
          resumed: {
            id: "resumed",
            turnId: "turn_visual",
            kind: "assistant_message",
            status: "completed",
            authoredBy: "assistant",
            phase: "commentary",
            completedAt: "2026-09-07T00:00:23Z",
            text: "Control is back. I am checking the final page state.",
          },
        },
      },
      lifecycle: {
        phase: "waiting_for_human",
        reason: "Confirm the delivery address before checkout.",
      },
      availableActions: ["finish"],
      runtime: {
        status: "awaiting_human",
        controller: null,
        attachment: "attached",
        recovery: "not_needed",
        profileOwnership: "owned",
      },
    },
  ];
  value.product.currentTaskId = "task_visual";
  value.product.attention = [
    {
      authority: "codex",
      kind: "file_approval",
      requestId: "file_visual",
      taskId: "task_visual",
      threadId: "thread_visual",
      turnId: "turn_visual",
      itemId: "file_item",
      generation: 2,
      status: "pending",
      sequence: 1,
      title: "File change approval",
      context: [
        { label: "Reason", value: "Update the generated comparison" },
        { label: "Scope", value: "Proposed file changes" },
      ],
    },
    {
      authority: "codex",
      kind: "user_input",
      requestId: "questions_visual",
      taskId: "task_visual",
      threadId: "thread_visual",
      turnId: "turn_visual",
      itemId: "question_item",
      generation: 2,
      status: "pending",
      sequence: 2,
      title: "Codex needs your input",
      questions: [
        {
          id: "region",
          header: "Region",
          question: "Which delivery region should Rove use?",
          isOther: false,
          isSecret: false,
          options: [
            { label: "West", description: "Western delivery zone" },
            { label: "East", description: "Eastern delivery zone" },
          ],
        },
        {
          id: "private_note",
          header: "Private note",
          question: "Enter the private delivery note.",
          isOther: true,
          isSecret: true,
          options: null,
        },
      ],
    },
    {
      authority: "codex",
      kind: "mcp_elicitation",
      requestId: "form_visual",
      taskId: "task_visual",
      threadId: "thread_visual",
      turnId: "turn_visual",
      itemId: "form_item",
      generation: 2,
      status: "pending",
      sequence: 3,
      title: "Tool needs information",
      elicitation: {
        mode: "form",
        message: "Choose delivery preferences.",
        serverName: "shipping",
        fields: [
          {
            id: "speed",
            title: "Delivery speed",
            required: true,
            type: "single_select",
            options: [
              { value: "standard", label: "Standard" },
              { value: "express", label: "Express" },
            ],
          },
          {
            id: "insured",
            title: "Add insurance",
            required: false,
            type: "boolean",
          },
        ],
      },
    },
    {
      authority: "rove_control",
      kind: "control_handoff",
      requestId: "control:ses_visual:2",
      taskId: "task_visual",
      threadId: "thread_visual",
      turnId: "turn_visual",
      generation: 2,
      status: "pending",
      sequence: 5,
      title: "Browser control handoff",
      instruction: "Confirm the delivery address before checkout.",
      continuationPolicy: "resume_after_control_return",
    },
  ];
  value.product.attention.splice(3, 0, {
    authority: "codex",
    kind: "mcp_elicitation",
    requestId: "url_visual",
    taskId: "task_visual",
    threadId: "thread_visual",
    turnId: "turn_visual",
    itemId: "url_item",
    generation: 2,
    status: "pending",
    sequence: 4,
    title: "Tool needs information",
    elicitation: {
      mode: "url",
      message: "Connect the current shipping account.",
      serverName: "shipping",
    },
  });
  return value;
}

function explicitResponseReturnedSnapshot() {
  const value = activeSnapshot("full");
  value.companion.session.status = "active";
  value.companion.session.controller = "agent";
  delete value.companion.session.handoff;
  const handoff = value.product.attention.find(
    (entry) => entry.authority === "rove_control",
  );
  handoff.instruction =
    "Control has returned. Rove is waiting for your explicit response before the task continues.";
  handoff.continuationPolicy = "explicit_user_response";
  value.product.tasks.find((task) => task.taskId === "task_visual").runtime = {
    status: "active",
    controller: "agent",
    attachment: "attached",
    recovery: "not_needed",
    profileOwnership: "owned",
  };
  value.product.tasks.find(
    (task) => task.taskId === "task_visual",
  ).availableActions = ["message", "finish"];
  return value;
}

function activeComposerSnapshot() {
  const value = activeSnapshot("full");
  value.product.attention = [];
  value.companion.session.status = "active";
  value.companion.session.controller = "agent";
  delete value.companion.session.handoff;
  const task = value.product.tasks.find(
    (entry) => entry.taskId === "task_visual",
  );
  task.lifecycle = { phase: "running", reason: "Working" };
  task.availableActions = ["message", "finish"];
  task.runtime = {
    status: "active",
    controller: "agent",
    attachment: "attached",
    recovery: "not_needed",
    profileOwnership: "owned",
  };
  return value;
}

function browserHandoffSnapshot() {
  const value = activeSnapshot("full");
  value.product.attention = value.product.attention.filter(
    (entry) => entry.authority === "rove_control",
  );
  value.product.tasks.find(
    (task) => task.taskId === "task_visual",
  ).availableActions = ["finish"];
  return value;
}

function constrainedLongSnapshot() {
  const value = activeSnapshot("full");
  const task = value.product.tasks.find(
    (entry) => entry.taskId === "task_visual",
  );
  task.availableActions = ["message", "finish"];
  for (let index = 0; index < 48; index += 1) {
    task.conversation.items[`long_${index}`] = {
      id: `long_${index}`,
      turnId: "turn_visual",
      kind: "assistant_message",
      status: "completed",
      authoredBy: "assistant",
      text: `Constrained layout entry ${index}: ${"verified progress detail ".repeat(8)}`,
    };
  }
  return value;
}

function uiTruthTask({
  taskId,
  request,
  phase = "ready",
  reason = "Ready.",
  turnStatus = "completed",
  availableActions = ["message", "finish"],
  runtime,
  executionMode = "agent",
}) {
  const turnId = `turn_${taskId}`;

  return {
    taskId,
    executionMode,
    browserIdentity: { mode: "temporary" },
    selectionSource: "user_selected",
    selectedAt: "2026-09-13T12:00:00.000Z",
    approvalsReviewer: "auto_review",
    bootstrapStage: "complete",
    results: [],
    conversation: {
      ...(turnStatus === "in_progress" ? { activeTurnId: turnId } : {}),
      turnStatus,
      archived: false,
      turnOrder: [turnId],
      items: {
        [`user_${taskId}`]: {
          id: `user_${taskId}`,
          turnId,
          kind: "user_message",
          status: "completed",
          authoredBy: "user",
          completedAt: "2026-09-13T12:00:00.000Z",
          text: request,
        },
      },
    },
    lifecycle: { phase, reason },
    availableActions,
    ...(runtime === undefined ? {} : { runtime }),
  };
}

function uiTruthWorkingSnapshot() {
  const value = baseSnapshot("full", "logged_in");
  const task = uiTruthTask({
    taskId: "task_truth_working",
    request: "Run the active analysis",
    phase: "working",
    reason: "Working.",
    turnStatus: "in_progress",
    availableActions: ["message", "interrupt", "finish"],
    runtime: {
      status: "active",
      controller: "agent",
      attachment: "attached",
      recovery: "not_needed",
      profileOwnership: "owned",
    },
  });

  value.product.tasks = [task];
  value.product.currentTaskId = task.taskId;
  return value;
}

function uiTruthCompletedSnapshot() {
  const value = baseSnapshot("full", "logged_in");
  const task = uiTruthTask({
    taskId: "task_truth_completed",
    request: "Summarize the completed research",
    phase: "ready",
    reason: "Ready for follow-up.",
    turnStatus: "completed",
    availableActions: ["message", "finish"],
  });

  value.product.tasks = [task];
  value.product.currentTaskId = task.taskId;
  return value;
}

function uiTruthInterruptedSnapshot() {
  const value = baseSnapshot("full", "logged_in");
  const task = uiTruthTask({
    taskId: "task_truth_interrupted",
    request: "Continue the interrupted investigation",
    phase: "ready",
    reason: "Stopped by the user.",
    turnStatus: "completed",
    availableActions: ["message", "resume", "finish"],
  });

  value.product.tasks = [task];
  value.product.currentTaskId = task.taskId;
  return value;
}

function uiTruthFailedSnapshot() {
  const value = baseSnapshot("full", "logged_in");
  const task = uiTruthTask({
    taskId: "task_truth_failed",
    request: "Investigate the failed workflow",
    phase: "failed",
    reason: "The task failed.",
    turnStatus: "completed",
    availableActions: [],
  });

  value.product.tasks = [task];

  // Preserve stale application currentTaskId deliberately. The renderer projection
  // must still treat failed work as terminal rather than resurrecting authority.
  value.product.currentTaskId = task.taskId;
  return value;
}

function uiTruthAttentionSnapshot() {
  const value = baseSnapshot("full", "logged_in");
  const task = uiTruthTask({
    taskId: "task_truth_attention",
    request: "Complete the browser sign in",
    phase: "waiting_for_human",
    reason: "Complete sign in.",
    turnStatus: "in_progress",
    availableActions: ["finish"],
    executionMode: "companion",
    runtime: {
      status: "awaiting_human",
      controller: null,
      attachment: "attached",
      recovery: "not_needed",
      profileOwnership: "owned",
    },
  });

  value.product.tasks = [task];
  value.product.currentTaskId = task.taskId;
  value.product.attention = [
    {
      authority: "rove_control",
      kind: "control_handoff",
      requestId: "control:ses_truth_attention:1",
      taskId: task.taskId,
      threadId: "thread_truth_attention",
      turnId: `turn_${task.taskId}`,
      generation: 1,
      status: "pending",
      sequence: 1,
      title: "Browser control handoff",
      instruction: "Complete sign in.",
      continuationPolicy: "resume_after_control_return",
    },
  ];
  return value;
}

function uiTruthWorkflow(revision = 1) {
  const workflowId = "workflow_ui_truth";
  return {
    workflowId,
    name: "Research review",
    archived: false,
    currentRevision: revision,
    revision: {
      workflowId,
      revision,
      configuration: {
        purpose: "Review research consistently.",
        preferences: [],
        criteria: [],
        guidance: [
          {
            id: "guidance_sources",
            text: "Prefer primary sources.",
            appliesTo: ["research"],
          },
        ],
        procedures: [],
        resourceRequirements: [],
        resultConventions: [],
        approvedKnowledge: [],
      },
      digest: "a".repeat(64),
      approvedAt: "2026-09-13T12:00:00.000Z",
    },
    createdAt: "2026-09-13T11:00:00.000Z",
    updatedAt: "2026-09-13T12:00:00.000Z",
  };
}

function uiTruthResult({
  resultId = "result_ui_truth",
  taskId = "task_truth_result",
  kind = "report",
  lifecycle = "prepared",
  selected = false,
  revision = 1,
  title = "Research brief",
  body = "Current reviewed research brief.",
}) {
  return {
    resultId,
    taskId,
    turnId: `turn_${taskId}`,
    kind,
    lifecycle,
    selected,
    currentRevision: revision,
    revision: {
      resultId,
      revision,
      title,
      body,
      artifactIds: [],
      digest: "b".repeat(64),
      createdAt: "2026-09-13T12:00:00.000Z",
    },
    source: {
      conversationItemId: `assistant_${taskId}`,
      conversationTextDigest: "c".repeat(64),
      evidenceIds: [],
    },
    ...(kind === "action"
      ? {
          actionMaterial: {
            recipient: "reviewer@example.test",
            recipientControl: "Exact recipient reviewed by the user",
            content: "Send the approved research summary.",
            contentControl: "Exact content reviewed by the user",
            target: "mailbox:reviewer",
            commitControl: "Dispatch requires explicit authorization",
            attachmentIds: [],
            scope: "One message",
          },
          materialDigest: "d".repeat(64),
        }
      : {}),
    createdAt: "2026-09-13T12:00:00.000Z",
    updatedAt: "2026-09-13T12:00:00.000Z",
  };
}

function uiTruthTaskSnapshot({
  taskId,
  request,
  executionMode = "agent",
  runtime,
  availableActions = ["message", "finish"],
  results = [],
  recordings,
  workflows = [],
  workflowAssociation,
  workflowContext,
  phase = "ready",
  reason = "Ready for follow-up.",
  turnStatus = "completed",
}) {
  const value = baseSnapshot("full", "logged_in");
  const task = uiTruthTask({
    taskId,
    request,
    executionMode,
    runtime,
    availableActions,
    phase,
    reason,
    turnStatus,
  });
  task.results = results;
  if (recordings !== undefined) task.recordings = recordings;
  if (workflowAssociation !== undefined)
    task.workflowAssociation = workflowAssociation;
  if (workflowContext !== undefined) task.workflowContext = workflowContext;
  value.product.tasks = [task];
  value.product.currentTaskId = taskId;
  value.product.workflows = workflows;
  return value;
}

function uiTruthWorkflowSnapshot({ revision = 1, promote = false } = {}) {
  const workflow = uiTruthWorkflow(revision);
  const taskId = "task_truth_workflow";
  const result = uiTruthResult({
    resultId: "result_workflow_source",
    taskId,
    kind: "report",
    title: "Reusable source assessment",
    body: "Use the verified source assessment for future reviews.",
  });
  return uiTruthTaskSnapshot({
    taskId,
    request: "Review the research with my Workflow",
    workflows: [workflow],
    results: promote ? [result] : [],
    workflowAssociation: {
      workflowId: workflow.workflowId,
      workflowName: workflow.name,
    },
    workflowContext: {
      workflowId: workflow.workflowId,
      workflowName: workflow.name,
      revision: Math.max(1, revision - 1),
      digest: "e".repeat(64),
      developerInstructions: "Earlier approved task context.",
    },
  });
}

function uiTruthResultSnapshot(options = {}) {
  const taskId = "task_truth_result";
  const workflow = uiTruthWorkflow();
  return uiTruthTaskSnapshot({
    taskId,
    request: "Prepare a structured research result",
    results: [uiTruthResult({ taskId, ...options })],
    workflows: options.workflows ?? [workflow],
    workflowAssociation: {
      workflowId: workflow.workflowId,
      workflowName: workflow.name,
    },
    workflowContext: {
      workflowId: workflow.workflowId,
      workflowName: workflow.name,
      revision: workflow.currentRevision,
      digest: workflow.revision.digest,
      developerInstructions: "Current approved Workflow context.",
    },
  });
}

function uiTruthActionSnapshot(lifecycle) {
  return uiTruthResultSnapshot({
    resultId: `result_action_${lifecycle}`,
    kind: "action",
    lifecycle,
    title: "Send approved research summary",
    body: `Authoritative action state: ${lifecycle}.`,
  });
}

function uiTruthRecording(state) {
  const id = `rec_${state.slice(0, 1).padEnd(32, state.slice(0, 1))}`;
  return {
    schemaVersion: 1,
    id,
    taskId: "task_truth_recording",
    sessionId: `ses_${"a".repeat(32)}`,
    mode: "agent",
    state,
    scope: {
      kind: "page",
      pageId: `page_${"b".repeat(32)}`,
      url: "https://example.test/research",
    },
    sensitiveDataPolicy: "user_confirmed_visible_content",
    includesAudio: false,
    coverage: "Selected task-owned page only.",
    exclusions: ["Browser chrome", "Other tabs", "Native dialogs"],
    requestedAt: "2026-09-13T12:00:00.000Z",
    updatedAt: "2026-09-13T12:02:00.000Z",
    ...(["recording", "finalizing", "available"].includes(state)
      ? { startedAt: "2026-09-13T12:00:01.000Z" }
      : {}),
    ...(["finalizing", "available"].includes(state)
      ? { stoppedAt: "2026-09-13T12:01:59.000Z" }
      : {}),
    ...(state === "available"
      ? {
          artifact: {
            artifactId: id,
            filename: "task-page-recording.webm",
            mimeType: "video/webm",
            sizeBytes: 4096,
            sha256: "f".repeat(64),
            playable: true,
            partial: false,
          },
        }
      : {}),
    ...(state === "failed"
      ? {
          failure: {
            code: "CAPTURE_INTERRUPTED",
            message: "The page recording was interrupted before completion.",
          },
        }
      : {}),
  };
}

function uiTruthRecordingSnapshot(state) {
  return uiTruthTaskSnapshot({
    taskId: "task_truth_recording",
    request: "Record the selected task page",
    runtime: {
      status: "active",
      controller: "agent",
      attachment: "attached",
      recovery: "not_needed",
      profileOwnership: "owned",
    },
    recordings: [uiTruthRecording(state)],
  });
}

function uiTruthViewedOtherSnapshot() {
  const value = baseSnapshot("full", "logged_in");

  const active = uiTruthTask({
    taskId: "task_truth_active_a",
    request: "Run the active analysis",
    phase: "working",
    reason: "Task A is working.",
    turnStatus: "in_progress",
    availableActions: ["message", "interrupt", "finish"],
    runtime: {
      status: "active",
      controller: "agent",
      attachment: "attached",
      recovery: "not_needed",
      profileOwnership: "owned",
    },
  });

  const viewed = uiTruthTask({
    taskId: "task_truth_viewed_b",
    request: "Review the comparison notes",
    phase: "ready",
    reason: "Task B is ready.",
    turnStatus: "completed",
    availableActions: ["message", "finish"],
  });

  value.product.tasks = [active, viewed];
  value.product.currentTaskId = active.taskId;
  return value;
}

async function requireVisible(locator, label) {
  const count = await locator.count();
  if (count === 0)
    throw new Error(`[UI Truth] Expected visible semantic target: ${label}`);

  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) return;
  }
  throw new Error(`[UI Truth] Semantic target is not visible: ${label}`);
}

async function requireAbsent(locator, label) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible())
      throw new Error(
        `[UI Truth] Forbidden semantic target is visible: ${label}`,
      );
  }
}

async function requireInputValue(page, value, label) {
  const matched = await page
    .locator("input, textarea, select")
    .evaluateAll(
      (elements, expected) =>
        elements.some((element) => element.value === expected),
      value,
    );
  if (!matched) throw new Error(`[UI Truth] Expected form value: ${label}`);
}

async function captureVisualMetrics(page) {
  return page.evaluate(() => {
    const selectors = [
      ".product-topbar",
      ".product-sidebar",
      ".sidebar-new-task",
      ".workflow-list",
      ".workflow-list-row",
      ".side-heading",
      ".task-history-row",
      ".product-main",
      ".composer-welcome h1",
      ".composer-input-shell",
      ".composer-input-shell > textarea",
      ".composer-menu > summary",
      ".workflow-task-choice select",
      ".task-detail",
      ".task-timeline",
      ".timeline-message .message-body",
      ".attention-card",
      ".workflow-output-list > button",
      ".output-detail",
      ".output-detail-content",
      ".output-action-status",
      ".output-action-review",
      ".recording-panel",
      ".product-inspector",
      ".inspector-panel",
      ".profile-modal",
      ".settings-modal",
      ".workflow-editor-form",
      ".modal-actions",
      ".modal-actions button",
      ".auth-actions",
      ".settings-data",
      ".settings-data button",
      ".theme-options",
      ".theme-options button",
      ".control-actions button",
      ".output-context-rail button",
    ];
    const properties = [
      "display",
      "position",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "letterSpacing",
      "color",
      "backgroundColor",
      "borderTopWidth",
      "borderTopColor",
      "borderRadius",
      "boxShadow",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "marginTop",
      "marginRight",
      "marginBottom",
      "marginLeft",
      "gap",
      "alignItems",
      "justifyContent",
      "overflowX",
      "overflowY",
      "opacity",
      "transitionDuration",
    ];

    return selectors.flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return [];
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return [
        {
          selector,
          tag: element.tagName.toLowerCase(),
          text: (element.innerText || "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 120),
          rect: {
            x: Math.round(rect.x * 100) / 100,
            y: Math.round(rect.y * 100) / 100,
            width: Math.round(rect.width * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
          },
          style: Object.fromEntries(
            properties.map((property) => [property, style[property]]),
          ),
        },
      ];
    });
  });
}

async function assertUiTruthCase(page, item) {
  if (!item.truthScenarioId) return;

  const scenario = UI_TRUTH_SCENARIO_BY_ID.get(item.truthScenarioId);
  if (!scenario)
    throw new Error(
      `[UI Truth] Unknown repository scenario ${item.truthScenarioId}.`,
    );

  switch (scenario.id) {
    case "T01": {
      await requireVisible(
        page.getByLabel("Desired outcome"),
        "T01 new-task desired-outcome composer",
      );
      await requireVisible(
        page.getByLabel("Start task"),
        "T01 Start task action",
      );
      await requireAbsent(
        page.getByLabel("Stop task"),
        "T01 must not imply active execution",
      );
      break;
    }

    case "T02": {
      await requireVisible(
        page.getByText("Run the active analysis", { exact: true }),
        "T02 active task request",
      );
      await requireVisible(
        page.getByLabel("Stop task"),
        "T02 active Stop action",
      );
      await requireAbsent(
        page.getByLabel("Resume task"),
        "T02 working task must not imply interruption",
      );
      break;
    }

    case "T03": {
      await requireVisible(
        page.getByText("Summarize the completed research", { exact: true }),
        "T03 completed task request",
      );
      await requireVisible(
        page.getByRole("textbox"),
        "T03 follow-up input remains usable",
      );
      await requireAbsent(
        page.getByLabel("Stop task"),
        "T03 completed turn must not imply active execution",
      );
      break;
    }

    case "T04": {
      await requireVisible(
        page.getByText("Continue the interrupted investigation", {
          exact: true,
        }),
        "T04 interrupted task request",
      );
      await requireVisible(
        page.getByLabel("Resume task"),
        "T04 explicit continuation action",
      );
      await requireAbsent(
        page.getByLabel("Stop task"),
        "T04 interrupted state must not still look actively running",
      );
      break;
    }

    case "T05": {
      await requireVisible(
        page.getByLabel("Desired outcome"),
        "T05 failed task returns product to independent new-task readiness",
      );
      await requireVisible(
        page.getByLabel("Task history: task_truth_failed"),
        "T05 failed task remains reviewable in history",
      );
      await requireAbsent(
        page.getByLabel("Stop task"),
        "T05 failed task must not retain live execution authority",
      );
      break;
    }

    case "T06": {
      await requireVisible(
        page.getByText("Complete sign in.", { exact: true }),
        "T06 authoritative handoff instruction",
      );
      await requireVisible(
        page.getByText("Browser control handoff", { exact: true }),
        "T06 authoritative attention title",
      );
      await requireVisible(
        page.getByRole("button", { name: "Take Over", exact: true }),
        "T06 task-scoped takeover action",
      );
      await requireAbsent(
        page.getByText("The task failed.", { exact: true }),
        "T06 attention must not be presented as task failure",
      );
      break;
    }

    case "T07": {
      const activeRow = page.getByLabel("Task history: task_truth_active_a");
      const viewedRow = page.getByLabel("Task history: task_truth_viewed_b");

      await requireVisible(activeRow, "T07 active Task A navigation entry");
      await requireVisible(viewedRow, "T07 Task B navigation entry");

      await viewedRow.click();

      await requireVisible(
        page.getByText("Review the comparison notes", { exact: true }),
        "T07 Task B is the viewed main content",
      );

      await requireVisible(
        activeRow,
        "T07 Task A remains represented while B is viewed",
      );

      await requireAbsent(
        page.getByLabel("Stop task"),
        "T07 Task B must not inherit Task A Stop authority",
      );

      await requireAbsent(
        page.getByLabel("Resume task"),
        "T07 Task B must not inherit unrelated execution controls",
      );
      break;
    }

    case "T08": {
      await requireVisible(
        page.getByText("Work without a Workflow", { exact: true }),
        "T08 standalone task content",
      );
      await requireVisible(
        page.getByText(/Standalone · ready · Agent/),
        "T08 standalone task status",
      );
      await requireVisible(
        page.getByLabel("Follow-up outcome"),
        "T08 standalone follow-up composer",
      );
      await requireAbsent(
        page.getByText(/Workflow is required/i),
        "T08 must not require a Workflow",
      );
      break;
    }

    case "W01": {
      await requireVisible(
        page.getByText("Workflows", { exact: true }),
        "W01 quiet Workflow section heading",
      );
      await requireVisible(
        page.getByRole("button", { name: "Create Workflow", exact: true }),
        "W01 quiet Workflow creation action",
      );
      await requireAbsent(
        page.getByText("Reusable guidance for recurring work", {
          exact: true,
        }),
        "W01 empty navigation must not compete with New task",
      );
      await requireAbsent(
        page.getByText(/failed to load Workflows/i),
        "W01 empty collection must not look failed",
      );
      break;
    }

    case "W02": {
      await requireVisible(
        page.getByText(/Research review · ready · Agent/),
        "W02 concrete task-to-Workflow association",
      );
      await requireAbsent(
        page.getByText(/task history is Workflow/i),
        "W02 history must not be represented as portable configuration",
      );
      break;
    }

    case "W03": {
      await requireVisible(
        page.getByText("1 task", { exact: true }),
        "W03 current Workflow membership",
      );
      await page
        .getByRole("button", { name: /Research review/ })
        .first()
        .click();
      await requireVisible(
        page.getByRole("heading", { name: "Research review" }),
        "W03 current Workflow Home",
      );
      await page.getByRole("button", { name: "Context", exact: true }).click();
      await requireVisible(
        page.getByRole("heading", {
          name: "Help Rove understand how to work here",
        }),
        "W03 readable Workflow Context",
      );
      await requireVisible(
        page.getByText("Prefer primary sources.", { exact: true }),
        "W03 current approved guidance read view",
      );
      await requireAbsent(
        page.getByText(/historical task.*revision 2/i),
        "W03 must not rewrite historical task context",
      );
      break;
    }

    case "W04": {
      await page
        .getByRole("button", { name: /Research review/ })
        .first()
        .click();
      await page.getByRole("button", { name: "Outputs", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Open Output: Reusable source assessment",
        })
        .click();
      await page.getByRole("button", { name: "Add to Context" }).click();
      await requireVisible(
        page.getByRole("dialog", { name: "Add to Context" }),
        "W04 explicit promotion review",
      );
      await requireInputValue(
        page,
        "Use the verified source assessment for future reviews.",
        "W04 exact reusable material",
      );
      await requireVisible(
        page.getByLabel("What Rove should remember"),
        "W04 editable reusable material",
      );
      await requireAbsent(
        page.getByLabel("Workflow", { exact: true }),
        "W04 current Workflow destination stays implicit",
      );
      await requireAbsent(
        page.getByLabel("Promotion category"),
        "W04 internal reusable-information class stays hidden",
      );
      await requireAbsent(
        page.getByLabel("Relevant topics"),
        "W04 advanced topic scope starts collapsed",
      );
      break;
    }

    case "R01": {
      await page
        .getByRole("button", { name: /Research review/ })
        .first()
        .click();
      await page.getByRole("button", { name: "Outputs", exact: true }).click();
      await requireVisible(
        page.getByRole("heading", { name: "Useful work to return to" }),
        "R01 Workflow Outputs region",
      );
      await page
        .getByRole("button", {
          name: "Open Output: Research brief",
        })
        .click();
      await requireVisible(
        page.getByText("Report", { exact: true }),
        "R01 customer-facing Output kind",
      );
      await requireVisible(
        page.getByText("Current reviewed research brief.", { exact: true }),
        "R01 current Output content",
      );
      await requireAbsent(
        page.getByText(/Revision 1/i),
        "R01 internal revision mechanics stay hidden",
      );
      break;
    }

    case "R02": {
      await page
        .getByRole("button", { name: /Research review/ })
        .first()
        .click();
      await page.getByRole("button", { name: "Outputs", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Open Output: Revised research brief",
        })
        .click();
      await requireVisible(
        page.getByText("Revised research brief", { exact: true }),
        "R02 current revised Output",
      );
      await requireVisible(
        page.getByText("Current selected revision.", { exact: true }),
        "R02 current Output content",
      );
      await page.getByRole("button", { name: "Continue in task" }).click();
      await requireVisible(
        page.getByRole("button", {
          name: "Using: Revised research brief ×",
        }),
        "R02 selected Output follow-up state",
      );
      await requireAbsent(
        page.getByText("Obsolete first revision", { exact: true }),
        "R02 obsolete revision must not be current",
      );
      await requireAbsent(
        page.getByText(/Revision 2/i),
        "R02 internal revision mechanics stay hidden",
      );
      break;
    }

    case "A01":
    case "A02":
    case "A03":
    case "A04":
    case "A05": {
      const lifecycle = {
        A01: "prepared",
        A02: "authorized",
        A03: "dispatched",
        A04: "confirmed",
        A05: "unresolved",
      }[scenario.id];
      const customerStatus = {
        A01: "Ready for approval",
        A02: "Approved",
        A03: "Checking outcome",
        A04: "Sent",
        A05: "Outcome unclear",
      }[scenario.id];
      await page
        .getByRole("button", { name: /Research review/ })
        .first()
        .click();
      await page.getByRole("button", { name: "Outputs", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Open Output: Send approved research summary",
        })
        .click();
      await requireVisible(
        page.getByText(customerStatus, { exact: true }),
        `${scenario.id} customer-facing action lifecycle for ${lifecycle}`,
      );
      await requireVisible(
        page.getByText("Send the approved research summary.", { exact: true }),
        `${scenario.id} exact action material`,
      );
      await requireAbsent(
        page.getByText("Dispatch requires explicit authorization", {
          exact: true,
        }),
        `${scenario.id} internal commit control stays hidden`,
      );
      if (scenario.id === "A01")
        await requireVisible(
          page.getByRole("button", { name: "Approve and send" }),
          "A01 explicit authorization boundary",
        );
      else
        await requireAbsent(
          page.getByRole("button", { name: "Approve and send" }),
          `${scenario.id} must not repeat prepared authorization UI`,
        );
      if (scenario.id === "A05") {
        await requireAbsent(
          page.getByText("failed", { exact: true }),
          "A05 unresolved must not be called failed",
        );
        await requireAbsent(
          page.getByRole("button", { name: /retry/i }),
          "A05 unresolved must not invite blind retry",
        );
      }
      break;
    }

    case "B01": {
      await requireVisible(
        page.getByLabel("Follow-up outcome"),
        "B01 task remains usable without browser",
      );
      await requireVisible(
        page.getByText("None", { exact: true }),
        "B01 no browser controller",
      );
      await requireAbsent(
        page.getByText("The task failed.", { exact: true }),
        "B01 browser absence must not be task failure",
      );
      break;
    }

    case "B02":
    case "C01":
    case "C03": {
      await requireVisible(
        page.getByText("Agent", { exact: true }),
        `${scenario.id} authoritative agent control`,
      );
      await requireVisible(
        page.getByRole("button", { name: /^(?:Open|View) Browser$/ }),
        `${scenario.id} task-owned browser surface`,
      );
      await requireAbsent(
        page.getByRole("button", { name: "Return control" }),
        `${scenario.id} must not imply human control`,
      );
      break;
    }

    case "C02": {
      await requireVisible(
        page.getByText("You", { exact: true }),
        "C02 authoritative human control",
      );
      await requireVisible(
        page.getByRole("button", { name: "Return control" }),
        "C02 return-control action",
      );
      await requireAbsent(
        page.getByRole("button", { name: "Take Over" }),
        "C02 must not offer takeover after transfer",
      );
      break;
    }

    case "C04": {
      await requireVisible(
        page.getByText(/Standalone · ready · Capture/),
        "C04 human-led Capture participation",
      );
      await requireVisible(
        page.getByText("Capture · Human-driven", { exact: true }),
        "C04 explicit human-led Capture semantics",
      );
      await requireAbsent(
        page.getByText("Automate · Agent mode", { exact: true }),
        "C04 Capture setup must not be mislabeled as Agent mode",
      );
      await requireAbsent(
        page.getByLabel("Stop task"),
        "C04 Capture must not imply an active Codex turn",
      );
      break;
    }

    case "V01": {
      await requireVisible(
        page.getByText("Page recording active", { exact: true }),
        "V01 active page recording",
      );
      await requireVisible(
        page.getByRole("button", { name: "Stop page recording" }),
        "V01 stop recording action",
      );
      await requireAbsent(
        page.getByText("browser-window recording", { exact: false }),
        "V01 active page recording must not claim window scope",
      );
      break;
    }

    case "V02": {
      const finalizing = page.getByRole("button", {
        name: "Finalizing recording…",
      });
      await requireVisible(finalizing, "V02 finalizing state");
      if (await finalizing.isEnabled())
        throw new Error("[UI Truth] V02 finalizing control must be disabled.");
      await requireAbsent(
        page.getByRole("button", { name: "Open recording" }),
        "V02 must not expose playable success",
      );
      break;
    }

    case "V03": {
      await requireVisible(
        page.getByText("available", { exact: true }),
        "V03 available lifecycle",
      );
      await requireVisible(
        page.getByRole("button", { name: "Open recording" }),
        "V03 playable recording action",
      );
      await requireAbsent(
        page.getByText("Recording unavailable", { exact: false }),
        "V03 must not look failed",
      );
      break;
    }

    case "V04": {
      await requireVisible(
        page.getByText("failed", { exact: true }),
        "V04 failed lifecycle",
      );
      await requireVisible(
        page.getByText(/Recording unavailable:.*interrupted before completion/),
        "V04 truthful interrupted recording",
      );
      await requireAbsent(
        page.getByRole("button", { name: "Open recording" }),
        "V04 failed recording must not be playable",
      );
      break;
    }

    case "D01":
    case "D02":
    case "D03": {
      const opened = await page.evaluate(() => {
        const details = document.querySelector("details.app-menu");
        const button = [...document.querySelectorAll(".app-menu button")].find(
          (candidate) => candidate.textContent?.trim() === "Settings",
        );
        if (
          !(details instanceof HTMLDetailsElement) ||
          !(button instanceof HTMLButtonElement)
        )
          return false;
        details.open = true;
        button.click();
        return true;
      });
      if (!opened)
        throw new Error(`[UI Truth] ${scenario.id} settings entry missing.`);
      await requireVisible(
        page.getByRole("dialog", { name: "Settings" }),
        `${scenario.id} data-management settings`,
      );
      if (scenario.id === "D01") {
        await page
          .getByRole("button", { name: "Export local backup…" })
          .click();
        await requireVisible(
          page.getByText("rove-local-backup created with 4 files.", {
            exact: true,
          }),
          "D01 truthful export completion",
        );
      } else if (scenario.id === "D02") {
        await page
          .getByRole("button", { name: "Export local backup…" })
          .click();
        await requireVisible(
          page.getByText("The backup export was cancelled.", { exact: true }),
          "D02 truthful export cancellation",
        );
        await requireAbsent(
          page.getByText(/created with .* files/i),
          "D02 must not claim export success",
        );
      }
      await requireVisible(
        page.getByText(/Restore is not available yet/),
        `${scenario.id} restore unsupported disclosure`,
      );
      await requireAbsent(
        page.getByRole("button", { name: /^Restore/i }),
        `${scenario.id} must not expose a functioning Restore action`,
      );
      break;
    }

    default:
      throw new Error(
        `[UI Truth] No semantic qualification implemented for ${scenario.id}.`,
      );
  }
}

async function captureDesignStateEvidence(page, item) {
  const assertions = {};
  const stateEvidence = [];

  const recordingHeader = page.locator(".recording-panel .inspector-heading");
  if ((await recordingHeader.count()) > 0) {
    const layout = await recordingHeader.evaluate((header) => {
      const headerRect = header.getBoundingClientRect();
      const children = [...header.children].map((child) => {
        const rect = child.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      });
      const nonOverlapping = children.every(
        (child, index) =>
          index === 0 || child.left >= children[index - 1].right - 0.5,
      );
      return {
        contained: children.every(
          (child) =>
            child.left >= headerRect.left - 0.5 &&
            child.right <= headerRect.right + 0.5 &&
            child.top >= headerRect.top - 0.5 &&
            child.bottom <= headerRect.bottom + 0.5,
        ),
        nonOverlapping,
      };
    });
    if (!layout.contained || !layout.nonOverlapping)
      throw new Error(
        `Recording header geometry drifted: ${JSON.stringify(layout)}`,
      );
    assertions.recordingHeaderContained = true;
    assertions.recordingHeaderNonOverlapping = true;
  }

  if (item.truthScenarioId === "R02") {
    const chip = page.locator(".output-context-rail button");
    const layout = await chip.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      text: element.textContent?.trim(),
    }));
    if (layout.width <= 42 || layout.scrollWidth > layout.clientWidth)
      throw new Error(
        `Selected Output chip is unreadable: ${JSON.stringify(layout)}`,
      );
    assertions.selectedOutputChipReadable = true;
    assertions.selectedOutputChipWidth = layout.width;
  }

  const statePath = (suffix) => join(outputRoot, `${item.id}-${suffix}.png`);
  if (item.truthScenarioId === "W01") {
    await page.getByRole("button", { name: "Create Workflow" }).focus();
    const path = statePath("focus");
    await page.screenshot({ path, fullPage: true });
    stateEvidence.push({
      state: "focus",
      target: ".workflow-list .side-heading button",
      path: relative(repositoryRoot, path),
    });
    assertions.workflowCreateFocusInspected = true;
  }
  if (item.truthScenarioId === "T01") {
    await page.getByLabel("Commands", { exact: true }).click();
    await page.getByLabel("Workflow environment").focus();
    const path = statePath("focus");
    await page.screenshot({ path, fullPage: true });
    stateEvidence.push({
      state: "focus",
      target: ".workflow-task-choice select",
      path: relative(repositoryRoot, path),
    });
    assertions.workflowChoiceFocusInspected = true;
  }
  if (item.truthScenarioId === "W04") {
    await page
      .getByRole("dialog", { name: "Add to Context" })
      .getByRole("button", { name: "Add to Context", exact: true })
      .focus();
    const path = statePath("focus");
    await page.screenshot({ path, fullPage: true });
    stateEvidence.push({
      state: "focus",
      target: ".modal-actions .primary",
      path: relative(repositoryRoot, path),
    });
    assertions.promotionPrimaryFocusInspected = true;
  }
  if (item.truthScenarioId === "V02") {
    assertions.finalizingControlDisabled = !(await page
      .getByRole("button", { name: "Finalizing recording…" })
      .isEnabled());
  }

  const transitionLabels = {
    W03: "Workflow list to current revision editor",
    W04: "Workflow Output detail to Add to Context review",
    R02: "Workflow Output detail to selected follow-up context",
    C02: "human browser control to explicit return-control action",
    C04: "task setup to human-led Capture task",
    V01: "task to active recording controls",
    V02: "recording to disabled finalization state",
    V03: "recording completion to playable evidence",
    V04: "recording interruption to truthful failure state",
    D01: "account menu to backup completion",
    D02: "account menu to cancelled backup outcome",
    D03: "account menu to unavailable restore disclosure",
  };
  if (transitionLabels[item.truthScenarioId]) {
    assertions.transitionInspected = transitionLabels[item.truthScenarioId];
  }

  await page.mouse.move(1, 1);
  return { assertions, stateEvidence };
}

const cases = [
  {
    id: "ui-truth-t01",
    truthScenarioId: "T01",
    snapshot: baseSnapshot("full", "logged_in"),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  {
    id: "ui-truth-t02",
    truthScenarioId: "T02",
    snapshot: uiTruthWorkingSnapshot(),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  {
    id: "ui-truth-t03",
    truthScenarioId: "T03",
    snapshot: uiTruthCompletedSnapshot(),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  {
    id: "ui-truth-t04",
    truthScenarioId: "T04",
    snapshot: uiTruthInterruptedSnapshot(),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  {
    id: "ui-truth-t05",
    truthScenarioId: "T05",
    snapshot: uiTruthFailedSnapshot(),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  {
    id: "ui-truth-t06",
    truthScenarioId: "T06",
    snapshot: uiTruthAttentionSnapshot(),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  {
    id: "ui-truth-t07",
    truthScenarioId: "T07",
    snapshot: uiTruthViewedOtherSnapshot(),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  {
    id: "ui-truth-t08",
    truthScenarioId: "T08",
    snapshot: uiTruthTaskSnapshot({
      taskId: "task_truth_standalone",
      request: "Work without a Workflow",
    }),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  {
    id: "ui-truth-w01",
    truthScenarioId: "W01",
    snapshot: baseSnapshot("full", "logged_in"),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  {
    id: "ui-truth-w02",
    truthScenarioId: "W02",
    snapshot: uiTruthWorkflowSnapshot(),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  {
    id: "ui-truth-w03",
    truthScenarioId: "W03",
    snapshot: uiTruthWorkflowSnapshot({ revision: 2 }),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  {
    id: "ui-truth-w04",
    truthScenarioId: "W04",
    snapshot: uiTruthWorkflowSnapshot({ promote: true }),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  {
    id: "ui-truth-r01",
    truthScenarioId: "R01",
    snapshot: uiTruthResultSnapshot(),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  {
    id: "ui-truth-r02",
    truthScenarioId: "R02",
    snapshot: uiTruthResultSnapshot({
      kind: "draft",
      selected: true,
      revision: 2,
      title: "Revised research brief",
      body: "Current selected revision.",
    }),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  ...[
    ["a01", "A01", "prepared"],
    ["a02", "A02", "authorized"],
    ["a03", "A03", "dispatched"],
    ["a04", "A04", "confirmed"],
    ["a05", "A05", "unresolved"],
  ].map(([suffix, truthScenarioId, lifecycle]) => ({
    id: `ui-truth-${suffix}`,
    truthScenarioId,
    snapshot: uiTruthActionSnapshot(lifecycle),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  })),
  {
    id: "ui-truth-b01",
    truthScenarioId: "B01",
    snapshot: uiTruthTaskSnapshot({
      taskId: "task_truth_browser_absent",
      request: "Continue without browser access",
    }),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  ...[
    ["b02", "B02", "agent", "agent", ["message", "finish"]],
    ["c01", "C01", "agent", "agent", ["message", "finish"]],
    ["c02", "C02", "companion", "human", ["return_control", "finish"]],
    ["c03", "C03", "companion", "agent", ["message", "finish"]],
  ].map(([suffix, truthScenarioId, executionMode, controller, actions]) => ({
    id: `ui-truth-${suffix}`,
    truthScenarioId,
    snapshot: uiTruthTaskSnapshot({
      taskId: `task_truth_${suffix}`,
      request: `Exercise ${truthScenarioId} collaboration truth`,
      executionMode,
      availableActions: actions,
      runtime: {
        status: "active",
        controller,
        attachment: "attached",
        recovery: "not_needed",
        profileOwnership: "owned",
      },
    }),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  })),
  {
    id: "ui-truth-c04",
    truthScenarioId: "C04",
    snapshot: uiTruthTaskSnapshot({
      taskId: "task_truth_capture",
      request: "Capture my human-led browser journey",
      executionMode: "capture",
      turnStatus: "completed",
    }),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  },
  ...[
    ["v01", "V01", "recording"],
    ["v02", "V02", "finalizing"],
    ["v03", "V03", "available"],
    ["v04", "V04", "failed"],
  ].map(([suffix, truthScenarioId, state]) => ({
    id: `ui-truth-${suffix}`,
    truthScenarioId,
    snapshot: uiTruthRecordingSnapshot(state),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  })),
  ...[
    ["d01", "D01", "success"],
    ["d02", "D02", "cancel"],
    ["d03", "D03", "unsupported"],
  ].map(([suffix, truthScenarioId, backupOutcome]) => ({
    id: `ui-truth-${suffix}`,
    truthScenarioId,
    backupOutcome,
    snapshot: baseSnapshot("full", "logged_in"),
    follower: false,
    viewport: UI_TRUTH_VIEWPORTS.product,
  })),
  ...[
    ["w01", "W01", baseSnapshot("full", "logged_in")],
    ["w03", "W03", uiTruthWorkflowSnapshot({ revision: 2 })],
    ["w04", "W04", uiTruthWorkflowSnapshot({ promote: true })],
    [
      "r02",
      "R02",
      uiTruthResultSnapshot({
        kind: "draft",
        selected: true,
        revision: 2,
        title: "Revised research brief",
        body: "Current selected revision.",
      }),
    ],
    ["a01", "A01", uiTruthActionSnapshot("prepared")],
    ["v03", "V03", uiTruthRecordingSnapshot("available")],
    ["v04", "V04", uiTruthRecordingSnapshot("failed")],
    ["d01", "D01", baseSnapshot("full", "logged_in")],
  ].map(([suffix, truthScenarioId, snapshot]) => ({
    id: `visual-dark-${suffix}`,
    truthScenarioId,
    snapshot,
    backupOutcome: truthScenarioId === "D01" ? "success" : undefined,
    follower: false,
    colorScheme: "dark",
    themePreference: "dark",
    viewport: UI_TRUTH_VIEWPORTS.product,
  })),
  {
    id: "full-onboarding",
    snapshot: baseSnapshot("full", "logged_out"),
    failFirstLoginOpen: true,
    follower: false,
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "signed-out-local-operation-error",
    snapshot: baseSnapshot("full", "logged_out"),
    failWorkflowSave: true,
    follower: false,
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "full-composer",
    snapshot: baseSnapshot("full", "logged_in"),
    follower: false,
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "full-auth-dark",
    snapshot: baseSnapshot("full", "logged_out"),
    follower: false,
    colorScheme: "dark",
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "full-composer-dark",
    snapshot: baseSnapshot("full", "logged_in"),
    follower: false,
    colorScheme: "dark",
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "full-composer-narrow-dark",
    snapshot: baseSnapshot("full", "logged_in"),
    follower: false,
    colorScheme: "dark",
    viewport: { width: 590, height: 650 },
  },
  {
    id: "full-active-handoff",
    snapshot: activeSnapshot("full"),
    follower: false,
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "full-forced-light-dark-system",
    snapshot: activeComposerSnapshot(),
    follower: false,
    colorScheme: "dark",
    themePreference: "light",
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "full-explicit-response-returned",
    snapshot: explicitResponseReturnedSnapshot(),
    follower: false,
    colorScheme: "dark",
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "full-browser-handoff",
    snapshot: browserHandoffSnapshot(),
    follower: false,
    colorScheme: "dark",
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "compact-active",
    snapshot: activeSnapshot("chip"),
    follower: true,
    viewport: { width: 64, height: 56 },
  },
  {
    id: "expanded-attention",
    snapshot: activeSnapshot("expanded"),
    follower: true,
    viewport: { width: 360, height: 240 },
  },
  {
    id: "full-constrained-long-content",
    snapshot: constrainedLongSnapshot(),
    follower: false,
    viewport: { width: 760, height: 420 },
  },
];
const requestedCase = process.argv
  .find((argument) => argument.startsWith("--case="))
  ?.slice("--case=".length);
const selectedCases = requestedCase
  ? cases.filter((item) => item.id === requestedCase)
  : process.argv.includes("--login-only")
    ? cases.filter((item) => item.id === "full-onboarding")
    : cases;
if (requestedCase && selectedCases.length === 0)
  throw new Error(`Unknown product-surface visual case: ${requestedCase}`);

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true });
const artifacts = [];
try {
  for (const item of selectedCases) {
    const page = await browser.newPage({
      viewport: item.viewport,
      colorScheme: item.colorScheme ?? "light",
    });
    const truthScenario = item.truthScenarioId
      ? UI_TRUTH_SCENARIO_BY_ID.get(item.truthScenarioId)
      : undefined;
    const tracePath = truthScenario?.trace
      ? join(outputRoot, `${item.id}.trace.zip`)
      : undefined;
    if (tracePath)
      await page
        .context()
        .tracing.start({ screenshots: true, snapshots: true });
    page.on("pageerror", (error) => {
      process.stderr.write(`[product-surface:${item.id}] ${error.message}\n`);
    });
    await page.addInitScript(
      ({
        snapshot,
        failFirstLoginOpen,
        failWorkflowSave,
        themePreference,
        backupOutcome,
      }) => {
        for (const task of snapshot.product?.tasks ?? []) {
          task.results ??= [];
          task.recordings ??= [];
        }
        if (themePreference)
          localStorage.setItem("rove.theme-preference.v1", themePreference);
        const listeners = new Set();
        const fullscreenListeners = new Set();
        window.__roveCalls = [];
        window.__roveSetFullscreen = (fullscreen) => {
          for (const listener of fullscreenListeners) listener(fullscreen);
        };
        window.__roveLoginOpenFailures = failFirstLoginOpen ? 1 : 0;
        window.rove = {
          getWindowFullscreen: async () => false,
          subscribeWindowFullscreen: (listener) => {
            fullscreenListeners.add(listener);
            return () => fullscreenListeners.delete(listener);
          },
          getSurfaceSnapshot: async () => snapshot,
          subscribeSurfaceSnapshot: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          transitionSurface: async () => snapshot,
          executeProductIntent: async (intent) => {
            window.__roveCalls.push({ type: "product", command: intent });
            if (failWorkflowSave && intent.type === "workflow.create")
              throw new Error("The local Workflow could not be saved.");
            if (intent.type === "account.login") {
              return intent.loginType === "deviceCode"
                ? {
                    type: "chatgptDeviceCode",
                    loginId: "login_device",
                    userCode: "ABCD-EFGH",
                  }
                : { type: "chatgpt", loginId: "login_browser" };
            }
            return {};
          },
          getSnapshot: async () => snapshot.companion,
          getNotice: async () => snapshot.notice,
          getLiveSession: async () => snapshot.companion?.session ?? null,
          getFollowerPresentation: async () => "windowed_compact",
          takeControl: async () => snapshot.companion,
          returnControl: async () => {
            window.__roveCalls.push({ type: "returnControl" });
            return snapshot.companion;
          },
          pauseSession: async () => snapshot.companion,
          finishSession: async () => null,
          setFollowerExpanded: async () => "windowed_expanded",
          beginFollowerDrag: async () => undefined,
          updateFollowerDrag: async () => undefined,
          endFollowerDrag: async () => undefined,
          openRove: async () => undefined,
          openTrustedExternal: async (intent) => {
            window.__roveCalls.push({ type: "openTrustedExternal", intent });
            if (
              intent.purpose === "account_login" &&
              window.__roveLoginOpenFailures > 0
            ) {
              window.__roveLoginOpenFailures -= 1;
              throw new Error("The sign-in page could not be opened.");
            }
          },
          getBrowserWorkspaces: async () => snapshot.workspaces,
          createBrowserWorkspace: async () => snapshot.workspaces,
          selectBrowserWorkspace: async () => snapshot.workspaces,
          exportLocalBackup: async () => {
            window.__roveCalls.push({ type: "exportLocalBackup" });
            if (backupOutcome === "cancel")
              throw new Error("The backup export was cancelled.");
            return {
              status: "created",
              name: "rove-local-backup",
              fileCount: 4,
              missingCount: 0,
            };
          },
        };
      },
      {
        snapshot: item.snapshot,
        failFirstLoginOpen: item.failFirstLoginOpen ?? false,
        failWorkflowSave: item.failWorkflowSave ?? false,
        themePreference: item.themePreference,
        backupOutcome: item.backupOutcome,
      },
    );
    const suffix = item.follower ? "?surface=follower" : "";
    await page.goto(`http://127.0.0.1:${address.port}/${suffix}`);

    await assertUiTruthCase(page, item);
    await page.waitForSelector(
      item.follower ? ".product-chip, .product-expanded" : ".product-app",
    );
    let keyboardOrder;
    let interactionAssertions;
    if (item.id === "full-onboarding") {
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Sign in to Codex" })
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({
          hasText: "Rove couldn't open the Codex sign-in page. Try again.",
        })
        .waitFor();
      await page.getByRole("button", { name: "Continue sign-in" }).click();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page
        .getByRole("button", { name: "Sign in", exact: true })
        .waitFor();

      const loginCalls = await page.evaluate(() => window.__roveCalls);
      const loginSequence = loginCalls.map((call) =>
        call.type === "product"
          ? {
              type: "product",
              command: call.command.type,
              loginType: call.command.loginType,
              loginId: call.command.loginId,
            }
          : {
              type: "openTrustedExternal",
              purpose: call.intent.purpose,
              loginId: call.intent.loginId,
            },
      );
      const expectedLoginSequence = [
        {
          type: "product",
          command: "account.login",
          loginType: "chatgpt",
        },
        {
          type: "openTrustedExternal",
          purpose: "account_login",
          loginId: "login_browser",
        },
        {
          type: "openTrustedExternal",
          purpose: "account_login",
          loginId: "login_browser",
        },
        {
          type: "product",
          command: "account.login.cancel",
          loginId: "login_browser",
        },
      ];
      if (
        JSON.stringify(loginSequence) !== JSON.stringify(expectedLoginSequence)
      )
        throw new Error(
          `Login interaction order/count drifted: ${JSON.stringify({ expectedLoginSequence, loginSequence })}`,
        );
      interactionAssertions = {
        loginSequence,
        failedOpenWasActionable: true,
        browserRetryRemainedAvailable: true,
        successfulCancelClearedLocalProjection: true,
        singlePrimarySignInPath: true,
      };
    }
    if (item.id === "signed-out-local-operation-error") {
      await page
        .getByRole("button", { name: "Create Workflow", exact: true })
        .click();
      await page.getByLabel("Workflow name").fill("Local research");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Create Workflow", exact: true })
        .click();
      const localFailure = page
        .getByRole("alert")
        .filter({ hasText: "The local Workflow could not be saved." });
      await localFailure.waitFor();
      const errorGeometry = await localFailure.evaluate((alert) => {
        const dialog = alert.closest('[role="dialog"]');
        if (!(dialog instanceof HTMLElement)) return { insideDialog: false };
        const alertRect = alert.getBoundingClientRect();
        const dialogRect = dialog.getBoundingClientRect();
        return {
          insideDialog:
            alertRect.left >= dialogRect.left &&
            alertRect.right <= dialogRect.right &&
            alertRect.top >= dialogRect.top &&
            alertRect.bottom <= dialogRect.bottom,
          width: alertRect.width,
          height: alertRect.height,
        };
      });
      if (
        !errorGeometry.insideDialog ||
        errorGeometry.width === undefined ||
        errorGeometry.width < 200 ||
        (await page
          .getByText("Rove needs attention", { exact: true })
          .count()) !== 1 ||
        (await page
          .getByText("Sign-in needs attention", { exact: true })
          .count()) !== 0
      )
        throw new Error(
          "Signed-out local failure was misclassified as a sign-in failure.",
        );
      interactionAssertions = {
        signedOutLocalWorkflowRemainedAvailable: true,
        localFailureRemainedVisible: true,
        localFailureWasNotMisclassifiedAsLogin: true,
        localFailureContainedByActiveDialog: true,
        localFailureGeometry: errorGeometry,
      };
    }
    if (item.id.startsWith("full-composer")) {
      await page
        .getByLabel("Desired outcome")
        .fill("Review the current work and summarize the result.");
      await page.getByLabel("Desired outcome").focus();
      keyboardOrder = [];
      for (let index = 0; index < 7; index += 1) {
        keyboardOrder.push(
          await page.evaluate(() => {
            const active = document.activeElement;
            return (
              active?.getAttribute("aria-label") ??
              active?.textContent?.trim() ??
              ""
            );
          }),
        );
        await page.keyboard.press("Tab");
      }
      const expectedOrder = [
        "Desired outcome",
        "Attach files",
        "Commands",
        "Participation mode: Agent",
        "Approval policy: Approve for me",
        "Model and reasoning effort: GPT-6 Astra, Low",
        "Start task",
      ];
      if (JSON.stringify(keyboardOrder) !== JSON.stringify(expectedOrder))
        throw new Error(
          `Keyboard order drifted: ${JSON.stringify({ expectedOrder, keyboardOrder })}`,
        );
      await page.getByLabel("Commands", { exact: true }).click();
      await page.getByLabel("Browser profile", { exact: true }).click();
      await page.getByText("Browser profile", { exact: true }).last().waitFor();
      const setupPopoverBox = await page
        .locator(".composer-setup-menu .composer-popover")
        .boundingBox();
      const setupPopoverGeometryValid =
        setupPopoverBox !== null &&
        setupPopoverBox.x >= 0 &&
        setupPopoverBox.y >= 0 &&
        setupPopoverBox.x + setupPopoverBox.width <= item.viewport.width &&
        setupPopoverBox.y + setupPopoverBox.height <= item.viewport.height &&
        setupPopoverBox.width <= 400 &&
        setupPopoverBox.height <= 460;
      if (!setupPopoverGeometryValid)
        throw new Error(
          `Task setup popover geometry is invalid: ${JSON.stringify({ setupPopoverBox, viewport: item.viewport })}`,
        );
      if (item.id === "full-composer-dark")
        await page.screenshot({
          path: join(outputRoot, "full-composer-dark-setup-open.png"),
        });
      await page.locator(".product-topbar").click();
      const setupOutsideClickDismissed = !(await page
        .locator(".composer-setup-menu")
        .evaluate((menu) => menu.open));
      if (!setupOutsideClickDismissed)
        throw new Error("Task setup remained open after an outside click.");
      await page.getByLabel("Commands", { exact: true }).click();
      await page
        .locator("#task-command-palette")
        .getByLabel("Approval policy: Approve for me", { exact: true })
        .click();
      await page.keyboard.press("Escape");
      const permissionEscapeDismissed = !(await page
        .locator("#task-command-palette .composer-permission-menu")
        .evaluate((menu) => menu.open));
      if (!permissionEscapeDismissed)
        throw new Error("Permission menu remained open after Escape.");
      await page.getByLabel("Commands", { exact: true }).click();
      await page
        .locator("#task-command-palette")
        .getByLabel(/Model and reasoning effort/)
        .click();
      await page
        .locator("#task-command-palette")
        .getByText("Reasoning", { exact: true })
        .waitFor();
      const modelPopoverBox = await page
        .locator("#task-command-palette .composer-model-menu .composer-popover")
        .boundingBox();
      const modelPopoverGeometryValid =
        modelPopoverBox !== null &&
        modelPopoverBox.x >= 0 &&
        modelPopoverBox.y >= 0 &&
        modelPopoverBox.x + modelPopoverBox.width <= item.viewport.width &&
        modelPopoverBox.y + modelPopoverBox.height <= item.viewport.height &&
        modelPopoverBox.width <= 320 &&
        modelPopoverBox.height <= 380;
      if (!modelPopoverGeometryValid)
        throw new Error(
          `Model popover geometry is invalid: ${JSON.stringify({ modelPopoverBox, viewport: item.viewport })}`,
        );
      if (item.id === "full-composer-dark")
        await page.screenshot({
          path: join(outputRoot, "full-composer-dark-model-open.png"),
        });
      await page.locator(".product-topbar").click();
      const modelOutsideClickDismissed = !(await page
        .locator("#task-command-palette .composer-model-menu")
        .evaluate((menu) => menu.open));
      if (!modelOutsideClickDismissed)
        throw new Error("Model menu remained open after an outside click.");
      const commandPalette = page.locator("#task-command-palette");
      const visibleConfiguration = page.getByLabel("Task configuration");
      await page.getByLabel("Desired outcome").fill("");
      await page.getByLabel("Desired outcome").press("/");
      try {
        await page.waitForFunction(() => {
          const menu = document.querySelector("#task-command-palette");
          const input = menu?.querySelector("input[type='search']");
          return (
            menu instanceof HTMLDetailsElement &&
            menu.open &&
            input instanceof HTMLElement &&
            document.activeElement === input
          );
        });
      } catch {
        throw new Error(
          "Typed slash did not open and focus the command palette.",
        );
      }
      const typedSlashOpenedSamePalette = true;
      await commandPalette.getByLabel("Search commands").fill("workflow");
      const commandSearchFiltered =
        (await commandPalette.getByLabel("Workflow environment").count()) ===
          1 &&
        (await commandPalette
          .getByText("Attach file", { exact: true })
          .count()) === 0;
      if (!commandSearchFiltered)
        throw new Error("Command search did not filter to Workflow controls.");
      await commandPalette.getByLabel("Search commands").fill("");
      await commandPalette
        .getByLabel("Participation mode: Agent", { exact: true })
        .click();
      await commandPalette
        .getByLabel("Execution mode: Companion", { exact: true })
        .click();
      const paletteModeUpdatedVisibleState =
        (await visibleConfiguration
          .getByLabel("Participation mode: Companion", { exact: true })
          .count()) === 1;
      if (!paletteModeUpdatedVisibleState)
        throw new Error(
          "Palette mode selection did not update composer state.",
        );
      await commandPalette
        .getByLabel("Approval policy: Approve for me", { exact: true })
        .click();
      await commandPalette.getByText("Always ask", { exact: true }).click();
      const paletteApprovalUpdatedVisibleState =
        (await visibleConfiguration
          .getByLabel("Approval policy: Always ask", { exact: true })
          .count()) === 1;
      if (!paletteApprovalUpdatedVisibleState)
        throw new Error(
          "Palette approval selection did not update composer state.",
        );
      await commandPalette.getByLabel(/Model and reasoning effort/).click();
      await commandPalette
        .getByLabel("Model: GPT-5.6 Sol", { exact: true })
        .click();
      const unsupportedEffortOmitted =
        (await commandPalette
          .getByLabel("Reasoning effort: Medium", { exact: true })
          .count()) === 0;
      if (!unsupportedEffortOmitted)
        throw new Error("Selected model exposed an unsupported effort.");
      await commandPalette
        .getByLabel("Reasoning effort: Low", { exact: true })
        .click();
      const paletteModelUpdatedVisibleState =
        (await page
          .locator(".composer-card .composer-footer")
          .getByLabel("Model and reasoning effort: GPT-5.6 Sol, Low", {
            exact: true,
          })
          .count()) === 1;
      if (!paletteModelUpdatedVisibleState)
        throw new Error(
          "Palette model selection did not update composer state.",
        );
      await page.keyboard.press("Escape");
      const commandPaletteEscapeDismissed = !(await commandPalette.evaluate(
        (menu) => menu.open,
      ));
      if (!commandPaletteEscapeDismissed)
        throw new Error("Command palette remained open after Escape.");
      await page
        .getByLabel("Desired outcome")
        .fill("Review the current work and summarize the result.");
      await page.locator(".app-menu > summary").click();
      await page.getByRole("button", { name: "Sign out of Codex" }).waitFor();
      if ((await page.getByText("Token activity").count()) !== 0)
        throw new Error("Account popover still exposes token activity.");
      if ((await page.getByRole("menuitem", { name: "Refresh" }).count()) !== 0)
        throw new Error("Account popover still exposes refresh.");
      const popoverBox = await page.locator(".app-menu-popover").boundingBox();
      const popoverWithinViewport =
        popoverBox !== null &&
        popoverBox.x >= 0 &&
        popoverBox.x + popoverBox.width <= item.viewport.width;
      if (!popoverWithinViewport)
        throw new Error(
          `App menu escaped the viewport: ${JSON.stringify({ popoverBox, viewport: item.viewport })}`,
        );
      await page.getByLabel("Desired outcome").click();
      const outsideClickDismissed = !(await page
        .locator(".app-menu")
        .evaluate((menu) => menu.open));
      if (!outsideClickDismissed)
        throw new Error("App menu remained open after an outside click.");
      await page.locator(".app-menu > summary").click();
      await page.keyboard.press("Escape");
      const escapeDismissed = !(await page
        .locator(".app-menu")
        .evaluate((menu) => menu.open));
      if (!escapeDismissed)
        throw new Error("App menu remained open after Escape.");
      await page.locator(".app-menu > summary").click();
      await page.getByRole("button", { name: "Settings" }).click();
      await page
        .getByRole("dialog", { name: "Settings" })
        .waitFor({ state: "visible" });
      await page.getByRole("button", { name: /Dark/ }).click();
      const darkThemeApplied =
        (await page.locator("html").getAttribute("data-rove-theme")) === "dark";
      await page.getByRole("button", { name: /Light/ }).click();
      const lightThemeApplied =
        (await page.locator("html").getAttribute("data-rove-theme")) ===
        "light";
      await page.getByRole("button", { name: /System/ }).click();
      const systemThemeApplied =
        (await page.locator("html").getAttribute("data-rove-theme")) === null;
      if (!darkThemeApplied || !lightThemeApplied || !systemThemeApplied)
        throw new Error("Appearance setting did not apply all theme modes.");
      await page.getByRole("button", { name: "Close settings" }).click();
      let sidebarToggleWorks = true;
      let nativeFullscreenTogglePositionWorks = true;
      if (item.id === "full-composer") {
        const normalToggleX = await page
          .getByRole("button", { name: "Collapse sidebar" })
          .evaluate((toggle) => toggle.getBoundingClientRect().x);
        await page.evaluate(() => window.__roveSetFullscreen(true));
        await page.locator(".product-app.window-fullscreen").waitFor();
        const fullscreenToggleX = await page
          .getByRole("button", { name: "Collapse sidebar" })
          .evaluate((toggle) => toggle.getBoundingClientRect().x);
        nativeFullscreenTogglePositionWorks =
          normalToggleX >= 90 && fullscreenToggleX <= 14;
        if (!nativeFullscreenTogglePositionWorks)
          throw new Error(
            `Sidebar toggle did not follow native fullscreen state: ${JSON.stringify({ normalToggleX, fullscreenToggleX })}`,
          );
        await page.screenshot({
          path: join(outputRoot, "full-composer-native-fullscreen.png"),
        });
        await page.evaluate(() => window.__roveSetFullscreen(false));
        await page
          .locator(".product-app.window-fullscreen")
          .waitFor({ state: "detached" });
        await page.getByRole("button", { name: "Collapse sidebar" }).click();
        sidebarToggleWorks =
          (await page.locator(".product-sidebar").evaluate((sidebar) => {
            return getComputedStyle(sidebar).display === "none";
          })) &&
          (await page
            .getByRole("button", { name: "Expand sidebar" })
            .count()) === 1;
        if (!sidebarToggleWorks)
          throw new Error("Sidebar did not collapse from its header control.");
        await page.screenshot({
          path: join(outputRoot, "full-composer-sidebar-collapsed.png"),
        });
        await page.getByRole("button", { name: "Expand sidebar" }).click();
        sidebarToggleWorks =
          (await page.locator(".product-sidebar").evaluate((sidebar) => {
            return getComputedStyle(sidebar).display !== "none";
          })) &&
          (await page
            .getByRole("button", { name: "Collapse sidebar" })
            .count()) === 1;
        if (!sidebarToggleWorks)
          throw new Error("Sidebar did not expand from its header control.");
      }
      interactionAssertions = {
        keyboardOrder,
        profilePopoverVisible: true,
        popoverWithinViewport,
        setupPopoverGeometryValid,
        modelPopoverGeometryValid,
        setupOutsideClickDismissed,
        permissionEscapeDismissed,
        modelOutsideClickDismissed,
        typedSlashOpenedSamePalette,
        commandSearchFiltered,
        paletteModeUpdatedVisibleState,
        paletteApprovalUpdatedVisibleState,
        unsupportedEffortOmitted,
        paletteModelUpdatedVisibleState,
        commandPaletteEscapeDismissed,
        outsideClickDismissed,
        escapeDismissed,
        themeSettingWorks:
          darkThemeApplied && lightThemeApplied && systemThemeApplied,
        sidebarToggleWorks,
        nativeFullscreenTogglePositionWorks,
      };
    }
    if (item.id === "full-forced-light-dark-system") {
      const themeSurfaces = await page.evaluate(() => {
        const composer = document.querySelector(
          ".followup.composer-input-shell",
        );
        const toolbar = document.querySelector(
          ".followup.composer-input-shell .composer-action-row",
        );
        const textarea = composer?.querySelector(":scope > textarea");
        const userMessage = document.querySelector(
          ".timeline-user > .message-body",
        );
        const inspector = document.querySelector(
          ".inspector-panel.browser-status",
        );
        if (!composer || !textarea || !toolbar || !userMessage || !inspector)
          return null;
        const composerStyle = getComputedStyle(composer);
        const textareaStyle = getComputedStyle(textarea);
        const toolbarStyle = getComputedStyle(toolbar);
        const userMessageStyle = getComputedStyle(userMessage);
        const inspectorStyle = getComputedStyle(inspector);
        return {
          theme: document.documentElement.dataset.roveTheme,
          composerBackground: composerStyle.backgroundColor,
          composerTextareaBackground: textareaStyle.backgroundColor,
          composerImage: composerStyle.backgroundImage,
          composerRadius: composerStyle.borderRadius,
          toolbarBackground: toolbarStyle.backgroundColor,
          userMessageBackground: userMessageStyle.backgroundColor,
          userMessageColor: userMessageStyle.color,
          userMessageRadius: userMessageStyle.borderRadius,
          inspectorBackground: inspectorStyle.backgroundColor,
          inspectorShadow: inspectorStyle.boxShadow,
        };
      });
      if (
        themeSurfaces === null ||
        themeSurfaces.theme !== "light" ||
        themeSurfaces.composerBackground !== "rgb(255, 255, 255)" ||
        themeSurfaces.composerTextareaBackground !== "rgba(0, 0, 0, 0)" ||
        themeSurfaces.composerImage !== "none" ||
        themeSurfaces.composerRadius !== "22px" ||
        themeSurfaces.toolbarBackground !== "rgba(0, 0, 0, 0)" ||
        themeSurfaces.userMessageBackground !== "rgb(32, 32, 30)" ||
        themeSurfaces.userMessageColor !== "rgb(255, 255, 255)" ||
        themeSurfaces.userMessageRadius !== "18px" ||
        themeSurfaces.inspectorBackground !== "rgb(255, 255, 255)" ||
        themeSurfaces.inspectorShadow === "none"
      )
        throw new Error(
          `Forced-light surfaces leaked dark styling: ${JSON.stringify(themeSurfaces)}`,
        );
      await page.getByLabel("Commands", { exact: true }).click();
      await page.getByLabel("Browser profile", { exact: true }).hover();
      const setupHoverBackground = await page
        .getByLabel("Browser profile", { exact: true })
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      const hoverAlpha = Number(
        setupHoverBackground.match(/rgba\(0, 0, 0, ([\d.]+)\)/)?.[1],
      );
      if (!Number.isFinite(hoverAlpha) || hoverAlpha > 0.05)
        throw new Error(
          `Forced-light setup hover is too strong: ${setupHoverBackground}`,
        );
      interactionAssertions = {
        forcedLightOverridesDarkSystem: true,
        continuousComposerSurface: true,
        softlyElevatedInspector: true,
        lowContrastAccountSeparator: true,
        lowContrastSetupHover: true,
      };
    }
    if (item.id === "full-active-handoff") {
      await page.getByRole("button", { name: "New task" }).click();
      if ((await page.getByLabel("Desired outcome").count()) !== 1)
        throw new Error("New task did not switch to the launch composer.");
      await page.getByLabel("Task history: task_visual").click();
      if ((await page.getByLabel("Current task request").count()) !== 1)
        throw new Error("Task selection did not restore one pending request.");
      if ((await page.locator(".task-composer-shell").count()) !== 0)
        throw new Error(
          "The composer remained visible behind a pending request.",
        );
      if (
        (await page.locator(".product-sidebar .attention-card").count()) !== 0
      )
        throw new Error("A pending request leaked into the sidebar.");
      if (
        (await page.locator(".product-inspector .browser-status").count()) !== 1
      )
        throw new Error("Browser status did not move to the right inspector.");
      if (
        (await page.locator(".product-sidebar .browser-status").count()) !== 0
      )
        throw new Error("Browser status remained in the task-history sidebar.");
      if ((await page.getByText("Codex needs your input").count()) !== 0)
        throw new Error(
          "A later request was rendered before the first request.",
        );
      if ((await page.locator(".product-task-nav").count()) !== 1)
        throw new Error(
          "Current task identity is missing from the top navigation.",
        );
      if ((await page.locator(".task-heading").count()) !== 0)
        throw new Error(
          "The duplicate in-task title/status row is still visible.",
        );
      const recoveryNotice = page.getByText(
        "Codex event recovery: Task event identity was reused with different content.",
      );
      if ((await recoveryNotice.count()) !== 0)
        throw new Error("Internal recovery diagnostics leaked into the UI.");
      await page.locator(".product-sidebar").focus();
      await page.keyboard.press("Shift");
      const sidebarOutline = await page
        .locator(".product-sidebar")
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return { style: style.outlineStyle, width: style.outlineWidth };
        });
      if (sidebarOutline.style !== "none" && sidebarOutline.width !== "0px")
        throw new Error(
          `Sidebar displayed a focus frame: ${JSON.stringify(sidebarOutline)}`,
        );
      const chronologicalText = await page
        .locator(".task-timeline")
        .innerText();
      const firstInputAt = chronologicalText.indexOf("Compare the options");
      const firstOutputAt = chronologicalText.indexOf("Comparison ready");
      const secondInputAt = chronologicalText.indexOf(
        "Continue after human control returned.",
      );
      const resumedWorkAt = chronologicalText.indexOf("Control is back.");
      if (!(
        firstInputAt >= 0 &&
        firstInputAt < firstOutputAt &&
        firstOutputAt < secondInputAt &&
        secondInputAt < resumedWorkAt
      ))
        throw new Error("Conversation segments are not chronological.");
      if ((await page.getByLabel("Copy message").count()) !== 2)
        throw new Error("Input copy controls are not icon-only per message.");
      if ((await page.getByLabel("Copy response").count()) !== 1)
        throw new Error("Output copy control is missing.");
      if (
        (await page
          .locator(".timeline-user > .message-body + .message-meta")
          .count()) !== 2
      )
        throw new Error("Input metadata is not outside the message card.");
      if ((await page.locator(".task-timeline time").count()) < 4)
        throw new Error("Conversation timestamps are missing.");
      if ((await page.locator(".timeline-final h2").count()) !== 1)
        throw new Error("Final answer Markdown was not formatted.");
      if ((await page.locator(".timeline-final table").count()) !== 1)
        throw new Error("Final answer table was not formatted.");
      if (
        (await page.locator(".timeline-final code.language-json").count()) !== 1
      )
        throw new Error("Structured result JSON was not formatted.");
      if ((await page.locator(".task-composer-shell").count()) !== 0)
        throw new Error("The pending request did not replace the composer.");
      if ((await page.getByLabel("Current task request").count()) !== 1)
        throw new Error("The task view did not show one current request.");
      if ((await page.getByRole("button", { name: "Pause" }).count()) !== 0)
        throw new Error("The legacy sidebar Pause control is still visible.");
      const historicalSelect = page.getByLabel("Task history: task_history");
      const historicalRow = historicalSelect.locator("..");
      await historicalRow.hover();
      const directArchive = historicalRow.getByRole("button", {
        name: /^Archive /,
      });
      if ((await directArchive.count()) !== 1)
        throw new Error("The direct hover archive control is missing.");
      await historicalRow.click({ button: "right" });
      await page.getByRole("menu", { name: /^Actions for / }).waitFor();
      await page.getByRole("menuitem", { name: "Rename" }).click();
      await page.getByLabel("Rename task").fill("Historical comparison");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await historicalSelect.getByText("Historical comparison").waitFor();
      await historicalRow.click({ button: "right" });
      if ((await page.getByRole("menuitem", { name: "Archive" }).count()) !== 1)
        throw new Error("Right-click task actions did not include Archive.");
      await page.locator(".product-topbar").click();
      if ((await page.locator(".task-context-menu").count()) !== 0)
        throw new Error("Task context menu remained open after outside click.");
      await historicalSelect.click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[aria-label="Task history: task_history"]')
            ?.getAttribute("aria-current") === "true",
      );
      if ((await page.getByText("Codex needs your input").count()) !== 0)
        throw new Error("Active attention leaked into historical task scope.");
      await page.getByLabel("Task history: task_visual").click();
      if ((await page.getByText("File change approval").count()) !== 1)
        throw new Error("Active attention did not return with active scope.");
      await directArchive.click();
      const archiveCalls = await page.evaluate(() =>
        window.__roveCalls.filter(
          (call) =>
            call.type === "product" && call.command.type === "task.archive",
        ),
      );
      if (
        archiveCalls.length !== 1 ||
        archiveCalls[0].command.taskId !== "task_history"
      )
        throw new Error("Direct archive control did not submit task.archive.");
      const calls = await page.evaluate(() => window.__roveCalls);
      const commands = calls
        .filter((call) => call.type === "product")
        .map((call) => call.command);
      if (commands.some((command) => command.type === "continuation.return"))
        throw new Error(
          "Renderer emitted a forbidden continuation.return command.",
        );
      interactionAssertions = {
        chronologicalInputWorkOutputSegments: true,
        iconOnlyCopyControls: true,
        inputMetadataOutsideCard: true,
        timestampsVisible: true,
        internalRecoveryDiagnosticsHidden: true,
        scrollRegionFocusFrameHidden: true,
        formattedFinalOutput: true,
        pendingRequestReplacesRichComposer: true,
        newTaskSwitchesToLaunchComposer: true,
        directArchiveControlRetained: true,
        rightClickRenameAndArchive: true,
        outsideClickDismissedTaskMenu: true,
        directArchiveCommandCount: archiveCalls.length,
        historicalTaskReadOnly: true,
        activeAttentionScopedAndRestored: true,
        singleInlineAttention: true,
        attentionReplacesComposer: true,
        sidebarAttentionRemoved: true,
        browserStatusInRightInspector: true,
        taskIdentityInTopNavigation: true,
        duplicateTaskStatusRemoved: true,
      };
    }
    if (item.id === "full-constrained-long-content") {
      const layout = await page.evaluate(() => {
        const main = document.querySelector(".product-main");
        const timeline = document.querySelector(".task-timeline");
        const sidebar = document.querySelector(".product-sidebar");
        const attention = document.querySelector(".attention-inline");
        const chip = document.querySelector(".product-chip");
        if (
          !(main instanceof globalThis.HTMLElement) ||
          !(timeline instanceof globalThis.HTMLElement) ||
          !(sidebar instanceof globalThis.HTMLElement)
        )
          throw new Error("Full product scroll regions are missing.");
        timeline.scrollTop = timeline.scrollHeight;
        sidebar.scrollTop = sidebar.scrollHeight;
        return {
          mainContained: main.scrollHeight <= main.clientHeight,
          timelineScrollable: timeline.scrollHeight > timeline.clientHeight,
          sidebarContained: sidebar.scrollHeight <= sidebar.clientHeight,
          sidebarScrollable: sidebar.scrollHeight > sidebar.clientHeight,
          timelineAtBottom:
            Math.abs(
              timeline.scrollHeight -
                timeline.clientHeight -
                timeline.scrollTop,
            ) <= 1,
          sidebarAtBottom:
            Math.abs(
              sidebar.scrollHeight - sidebar.clientHeight - sidebar.scrollTop,
            ) <= 1,
          noHorizontalOverflow:
            main.scrollWidth <= main.clientWidth &&
            sidebar.scrollWidth <= sidebar.clientWidth &&
            document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          approvalActionsContained:
            attention instanceof globalThis.HTMLElement &&
            [...attention.querySelectorAll(".attention-actions button")].every(
              (button) =>
                button.getBoundingClientRect().bottom <=
                attention.getBoundingClientRect().bottom - 8,
            ) &&
            attention.getBoundingClientRect().bottom <=
              globalThis.innerHeight - 8,
          horizontalOverflow: [...document.querySelectorAll("*")]
            .filter(
              (element) =>
                element instanceof globalThis.HTMLElement &&
                element.scrollWidth > element.clientWidth + 1,
            )
            .slice(0, 12)
            .map((element) => ({
              tag: element.tagName,
              className: element.className,
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
            })),
          chipAbsent: chip === null,
        };
      });
      if (
        !layout.mainContained ||
        !layout.timelineScrollable ||
        (!layout.sidebarContained && !layout.sidebarScrollable) ||
        !layout.timelineAtBottom ||
        !layout.sidebarAtBottom ||
        !layout.noHorizontalOverflow ||
        !layout.approvalActionsContained ||
        !layout.chipAbsent
      )
        throw new Error(`Constrained layout failed: ${JSON.stringify(layout)}`);
      interactionAssertions = layout;
    }
    const designStateEvidence = await captureDesignStateEvidence(page, item);
    if (Object.keys(designStateEvidence.assertions).length > 0) {
      interactionAssertions = {
        ...(interactionAssertions ?? {}),
        ...designStateEvidence.assertions,
      };
    }
    const visualMetrics = await captureVisualMetrics(page);
    const path = join(outputRoot, `${item.id}.png`);
    await page.screenshot({ path, fullPage: true });
    if (tracePath) await page.context().tracing.stop({ path: tracePath });
    artifacts.push({
      id: item.id,
      path: relative(repositoryRoot, path),
      ...(truthScenario
        ? {
            scenarioId: truthScenario.id,
            name: truthScenario.name,
            category: truthScenario.category,
            applicationStateSummary: truthScenario.applicationTruth,
            rendererProjectionSummary: truthScenario.rendererTruth,
            semanticAssertions: truthScenario.semanticAssertions,
            negativeAssertions: truthScenario.negativeAssertions,
            viewport: item.viewport,
            status: "PASS",
            defectClassification: null,
            notes: [],
          }
        : {}),
      ...(tracePath ? { tracePath: relative(repositoryRoot, tracePath) } : {}),
      ...(keyboardOrder ? { keyboardOrder } : {}),
      ...(interactionAssertions ? { interactionAssertions } : {}),
      ...(designStateEvidence.stateEvidence.length > 0
        ? { stateEvidence: designStateEvidence.stateEvidence }
        : {}),
      visualMetrics,
    });
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

await writeFile(
  join(outputRoot, "manifest.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), artifacts }, null, 2)}\n`,
);
process.stdout.write(
  `${JSON.stringify({ status: "pass", artifacts }, null, 2)}\n`,
);
