/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, structuredClone, __filename */

const { app, BrowserWindow, contextBridge } = require("electron");

const timestamp = "2026-09-14T09:00:00.000Z";
const workspaceId = "wrk_00000000-0000-4000-8000-000000000003";
const workflowId = "workflow_weekly_product_update";
const taskId = "task_weekly_product_update";
const turnId = "turn_weekly_product_update";
const calls = [];
const stateChanges = [];
const listeners = new Set();
let resultSequence = 0;

function digest(value) {
  const seed = String(value).length.toString(16).padStart(4, "0");
  return seed.repeat(16).slice(0, 64);
}

function workflow() {
  return {
    workflowId,
    name: "Weekly product update",
    archived: false,
    currentRevision: 2,
    revision: {
      workflowId,
      revision: 2,
      configuration: {
        purpose: "Prepare a clear weekly product update from completed work.",
        focus: "review",
        preferences: [],
        criteria: [],
        guidance: [],
        procedures: [],
        resultConventions: [],
        approvedKnowledge: [],
        resourceRequirements: [],
        resultStyle: "concise",
      },
      digest: digest("weekly-product-update-workflow-revision-2"),
      approvedAt: timestamp,
    },
    createdAt: "2026-09-12T09:00:00.000Z",
    updatedAt: timestamp,
  };
}

const snapshot = {
  revision: 1,
  surface: {
    presentation: "full",
    browserContext: "windowed",
    activeHost: "control_center",
    returnPresentation: "chip",
    revision: 1,
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
        createdAt: timestamp,
        lastUsedAt: timestamp,
      },
    ],
  },
  product: {
    version: 9,
    host: { state: "ready", ready: true, restartAttempt: 0 },
    catalog: {
      account: { status: "logged_in", authMode: "chatgpt", planType: "Plus" },
      models: [
        {
          id: "gpt-fixture",
          model: "gpt-fixture",
          displayName: "Codex",
          description: "Deterministic customer-journey fixture",
          efforts: ["low"],
          defaultEffort: "low",
          isDefault: true,
          inputModalities: ["text"],
          supportsPersonality: false,
          defaultServiceTier: null,
        },
      ],
      rateLimits: null,
      usage: null,
      refreshedAt: timestamp,
    },
    attention: [],
    tasks: [],
    currentTaskId: undefined,
    workflows: [workflow()],
    recoveryWarnings: [],
    draftAttachments: [],
    fileAttention: [],
  },
  productError: null,
};

function recordState(label, detail = {}) {
  stateChanges.push({
    sequence: stateChanges.length + 1,
    label,
    detail: structuredClone(detail),
    snapshotRevision: snapshot.revision,
  });
}

function notify(label, detail) {
  snapshot.revision += 1;
  snapshot.surface.revision += 1;
  recordState(label, detail);
  for (const listener of listeners) listener(structuredClone(snapshot));
}

function task() {
  return snapshot.product.tasks.find((entry) => entry.taskId === taskId);
}

function result(resultId) {
  return task()?.results.find((entry) => entry.resultId === resultId);
}

function currentIso(offsetMinutes = 0) {
  return new Date(Date.parse(timestamp) + offsetMinutes * 60_000).toISOString();
}

function createResult(intent) {
  resultSequence += 1;
  const createdAt = currentIso(10 + resultSequence);
  const resultId =
    intent.kind === "draft"
      ? "result_weekly_update_draft"
      : intent.kind === "finding_collection"
        ? "result_supporting_findings"
        : intent.kind === "action"
          ? "result_send_leadership_update"
          : `result_${resultSequence}`;
  const actionMaterial = intent.actionMaterial
    ? structuredClone(intent.actionMaterial)
    : undefined;
  const materialDigest = actionMaterial
    ? digest(JSON.stringify(actionMaterial))
    : undefined;
  const created = {
    resultId,
    taskId,
    turnId,
    kind: intent.kind,
    lifecycle: "prepared",
    selected: false,
    currentRevision: 1,
    revision: {
      resultId,
      revision: 1,
      title: intent.title,
      body: intent.body,
      artifactIds: [],
      digest: digest(`${intent.title}\n${intent.body}`),
      createdAt,
    },
    source: {
      conversationItemId: intent.sourceItemId,
      conversationTextDigest: digest("fixture-completed-response"),
      evidenceIds: [],
    },
    ...(actionMaterial ? { actionMaterial, materialDigest } : {}),
    createdAt,
    updatedAt: createdAt,
  };
  task().results.push(created);
  notify("result.created", {
    resultId,
    kind: created.kind,
    lifecycle: created.lifecycle,
  });
  return created;
}

function executeProductIntent(intent) {
  calls.push({ type: "product", intent: structuredClone(intent) });
  if (intent.type === "task.launch") {
    const launchedAt = currentIso(1);
    const launched = {
      taskId,
      executionMode: intent.input.executionMode,
      browserIdentity: intent.input.browserIdentity,
      selectionSource: "user_selected",
      selectedAt: launchedAt,
      approvalsReviewer: intent.input.approvalsReviewer,
      bootstrapStage: "complete",
      model: intent.input.model,
      reasoningEffort: intent.input.reasoningEffort,
      results: [],
      recordings: [],
      conversation: {
        activeTurnId: turnId,
        turnStatus: "in_progress",
        archived: false,
        turnOrder: [turnId],
        items: {
          weekly_request: {
            id: "weekly_request",
            turnId,
            kind: "user_message",
            status: "completed",
            authoredBy: "user",
            completedAt: launchedAt,
            text: intent.input.outcome,
          },
          weekly_commentary: {
            id: "weekly_commentary",
            turnId,
            kind: "assistant_message",
            status: "completed",
            authoredBy: "assistant",
            phase: "commentary",
            completedAt: currentIso(2),
            text: "I’m reviewing completed work, decisions, and open risks for this week’s update.",
          },
        },
      },
      lifecycle: { phase: "working", reason: "Working." },
      availableActions: ["message", "interrupt", "finish"],
      workflowAssociation: {
        workflowId,
        workflowName: "Weekly product update",
      },
      ...(intent.input.shareWorkflowContext
        ? {
            workflowContext: {
              workflowId,
              workflowName: "Weekly product update",
              revision: 2,
              digest: workflow().revision.digest,
              developerInstructions: workflow().revision.configuration.purpose,
            },
          }
        : {}),
    };
    snapshot.product.tasks = [launched];
    snapshot.product.currentTaskId = taskId;
    notify("task.launched", { taskId, workflowId });
    return { aggregate: { taskId } };
  }
  if (intent.type === "result.create")
    return structuredClone(createResult(intent));
  if (intent.type === "workflow.promote") {
    const current = snapshot.product.workflows.find(
      (entry) => entry.workflowId === intent.workflowId,
    );
    if (!current) throw new Error("Workflow not found.");
    if (current.currentRevision !== intent.expectedRevision)
      throw new Error("Workflow revision conflict.");
    current.currentRevision += 1;
    current.revision = {
      ...current.revision,
      revision: current.currentRevision,
      digest: digest(`workflow:${current.currentRevision}:${intent.text}`),
      approvedAt: currentIso(35 + current.currentRevision),
      configuration: {
        ...current.revision.configuration,
        approvedKnowledge: [
          ...current.revision.configuration.approvedKnowledge,
          {
            id: `knowledge_${current.currentRevision}`,
            text: intent.text,
            appliesTo: structuredClone(intent.appliesTo),
          },
        ],
      },
    };
    current.updatedAt = current.revision.approvedAt;
    notify("workflow.context_promoted", {
      workflowId: current.workflowId,
      sourceResultId: intent.sourceResultId,
      revision: current.currentRevision,
    });
    return structuredClone(current);
  }
  if (intent.type === "result.select") {
    const selected = result(intent.resultId);
    if (!selected) throw new Error("Result not found.");
    selected.selected = intent.selected;
    selected.updatedAt = currentIso(20 + stateChanges.length);
    notify("result.selection_changed", {
      resultId: selected.resultId,
      selected: selected.selected,
    });
    return structuredClone(selected);
  }
  if (intent.type === "result.revise") {
    const revised = result(intent.resultId);
    if (!revised || revised.kind !== "draft")
      throw new Error("Draft result not found.");
    if (revised.currentRevision !== intent.expectedRevision)
      throw new Error("Result revision conflict.");
    revised.currentRevision += 1;
    revised.revision = {
      resultId: revised.resultId,
      revision: revised.currentRevision,
      title: intent.title,
      body: intent.body,
      artifactIds: [],
      digest: digest(`${intent.title}\n${intent.body}`),
      createdAt: currentIso(30 + revised.currentRevision),
    };
    revised.updatedAt = revised.revision.createdAt;
    notify("result.revised", {
      resultId: revised.resultId,
      revision: revised.currentRevision,
    });
    return structuredClone(revised);
  }
  if (intent.type === "result.authorize") {
    const authorized = result(intent.resultId);
    if (!authorized || authorized.kind !== "action")
      throw new Error("Action result not found.");
    authorized.lifecycle = "authorized";
    authorized.updatedAt = currentIso(40 + stateChanges.length);
    notify("action.authorized", {
      resultId: authorized.resultId,
      lifecycle: authorized.lifecycle,
    });
    return structuredClone(authorized);
  }
  if (intent.type === "task.message") {
    const active = task();
    const nextTurn = "turn_weekly_followup";
    active.conversation.turnOrder.push(nextTurn);
    active.conversation.items.weekly_followup_request = {
      id: "weekly_followup_request",
      turnId: nextTurn,
      kind: "user_message",
      status: "completed",
      authoredBy: "user",
      completedAt: currentIso(50),
      text: intent.outcome,
    };
    active.conversation.items.weekly_followup_response = {
      id: "weekly_followup_response",
      turnId: nextTurn,
      kind: "assistant_message",
      status: "completed",
      authoredBy: "assistant",
      phase: "final_answer",
      completedAt: currentIso(51),
      text: "I’ll use the selected weekly update draft as working material and make the leadership version shorter.",
    };
    active.conversation.turnStatus = "completed";
    active.lifecycle = { phase: "ready", reason: "Ready for another message." };
    active.availableActions = ["message", "finish"];
    notify("task.followup_completed", {
      taskId,
      selectedResultIds: structuredClone(intent.selectedResultIds ?? []),
    });
    return { aggregate: { taskId } };
  }
  return {};
}

function seedCompletedWork() {
  const active = task();
  if (!active) throw new Error("Task not found.");
  active.conversation.activeTurnId = undefined;
  active.conversation.turnStatus = "completed";
  active.conversation.items.weekly_final = {
    id: "weekly_final",
    turnId,
    kind: "assistant_message",
    status: "completed",
    authoredBy: "assistant",
    phase: "final_answer",
    completedAt: currentIso(6),
    text: "## Weekly product update\n\nThis week we completed Workflow Home and the compact task composer. Customer-journey checks passed without semantic regressions. The main open risk is validating the new Outputs experience. Next week, review the durable work model with customers.",
  };
  active.lifecycle = { phase: "ready", reason: "Ready for another message." };
  active.availableActions = ["message", "finish"];
  notify("task.completed", { taskId, finalItemId: "weekly_final" });
}

function seedPreparedAction() {
  const createdAt = currentIso(60);
  const actionMaterial = {
    recipient: "Leadership team",
    recipientControl: "To",
    content:
      "Here is this week's concise product update for leadership review.",
    contentControl: "Message",
    target: "Leadership updates",
    commitControl: "Send",
    attachmentIds: [],
    scope: "One leadership update",
  };
  const action = {
    resultId: "result_send_leadership_update",
    taskId,
    turnId,
    kind: "action",
    lifecycle: "prepared",
    selected: false,
    currentRevision: 1,
    revision: {
      resultId: "result_send_leadership_update",
      revision: 1,
      title: "Send leadership update",
      body: "Send the approved weekly update to the leadership team.",
      artifactIds: [],
      digest: digest("Send leadership update"),
      createdAt,
    },
    source: {
      operationId: "authoritative_fixture_action",
      evidenceIds: [],
    },
    actionMaterial,
    materialDigest: digest(JSON.stringify(actionMaterial)),
    createdAt,
    updatedAt: createdAt,
  };
  task().results.push(action);
  notify("action.materialized", {
    resultId: action.resultId,
    lifecycle: action.lifecycle,
  });
  return structuredClone(action);
}

function transitionAction(resultId, lifecycle) {
  const action = result(resultId);
  if (!action || action.kind !== "action") throw new Error("Action not found.");
  action.lifecycle = lifecycle;
  action.updatedAt = currentIso(60 + stateChanges.length);
  notify("action.lifecycle_changed", { resultId, lifecycle });
  return structuredClone(action);
}

function seedUnresolvedAction() {
  const createdAt = currentIso(70);
  const actionMaterial = {
    recipient: "Product team",
    recipientControl: "To",
    content: "Send the launch-risk summary to the product team.",
    contentControl: "Message",
    target: "Team updates",
    commitControl: "Send",
    attachmentIds: [],
    scope: "One product-team update",
  };
  const action = {
    resultId: "result_send_risk_summary",
    taskId,
    turnId,
    kind: "action",
    lifecycle: "prepared",
    selected: false,
    currentRevision: 1,
    revision: {
      resultId: "result_send_risk_summary",
      revision: 1,
      title: "Send launch-risk summary",
      body: "A proposed update to the product team about the remaining launch risk.",
      artifactIds: [],
      digest: digest("Send launch-risk summary"),
      createdAt,
    },
    source: {
      conversationItemId: "weekly_final",
      conversationTextDigest: digest("fixture-completed-response"),
      evidenceIds: [],
    },
    actionMaterial,
    materialDigest: digest(JSON.stringify(actionMaterial)),
    createdAt,
    updatedAt: createdAt,
  };
  task().results.push(action);
  notify("action.seeded_for_uncertainty_path", {
    resultId: action.resultId,
    lifecycle: action.lifecycle,
  });
  return structuredClone(action);
}

if (process.type === "renderer") {
  contextBridge.exposeInMainWorld("rove", {
    getWindowFullscreen: async () => false,
    subscribeWindowFullscreen: () => () => {},
    getSurfaceSnapshot: async () => structuredClone(snapshot),
    subscribeSurfaceSnapshot: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    transitionSurface: async () => structuredClone(snapshot),
    getSnapshot: async () => null,
    getNotice: async () => null,
    getLiveSession: async () => null,
    getFollowerPresentation: async () => "windowed_compact",
    takeControl: async () => null,
    returnControl: async () => null,
    pauseSession: async () => null,
    finishSession: async () => null,
    setFollowerExpanded: async () => "windowed_expanded",
    beginFollowerDrag: async () => undefined,
    updateFollowerDrag: async () => undefined,
    endFollowerDrag: async () => undefined,
    openRove: async () => undefined,
    showBrowser: async () => false,
    openTrustedExternal: async () => undefined,
    openRecording: async () => undefined,
    exportLocalBackup: async () => ({ status: "cancelled" }),
    getBrowserWorkspaces: async () => structuredClone(snapshot.workspaces),
    createBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    selectBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    renameBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    deleteBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    executeProductIntent: async (intent) => executeProductIntent(intent),
    seedCompletedWork: async () => seedCompletedWork(),
    seedPreparedAction: async () => seedPreparedAction(),
    transitionAction: async (resultId, lifecycle) =>
      transitionAction(resultId, lifecycle),
    seedUnresolvedAction: async () => seedUnresolvedAction(),
    getJourneyState: async () => ({
      calls: structuredClone(calls),
      stateChanges: structuredClone(stateChanges),
      snapshot: structuredClone(snapshot),
    }),
  });
} else {
  app.whenReady().then(async () => {
    const window = new BrowserWindow({
      width: 1180,
      height: 780,
      minWidth: 1040,
      minHeight: 680,
      show: false,
      backgroundColor: "#ffffff",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: __filename,
      },
    });
    window.once("ready-to-show", () => window.show());
    await window.loadFile(
      `${process.env.ROVE_JOURNEY_RENDERER_ROOT}/index.html`,
    );
  });
  app.on("window-all-closed", () => app.quit());
}
