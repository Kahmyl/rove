/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, structuredClone, __filename */

const { app, BrowserWindow, contextBridge } = require("electron");

const timestamp = "2026-09-13T09:00:00.000Z";
const workspaceId = "wrk_00000000-0000-4000-8000-000000000001";
const calls = [];
const listeners = new Set();

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
    tasks: [
      {
        taskId: "task_previous_weekly_update",
        executionMode: "agent",
        browserIdentity: { mode: "temporary" },
        selectionSource: "user_selected",
        selectedAt: timestamp,
        approvalsReviewer: "auto_review",
        bootstrapStage: "complete",
        model: "gpt-fixture",
        reasoningEffort: "low",
        results: [],
        recordings: [],
        conversation: {
          turnStatus: "completed",
          archived: false,
          turnOrder: ["turn_previous"],
          items: {
            previous_request: {
              id: "previous_request",
              turnId: "turn_previous",
              kind: "user_message",
              status: "completed",
              authoredBy: "user",
              completedAt: timestamp,
              text: "Prepare this week's product update from the notes I collected.",
            },
            previous_response: {
              id: "previous_response",
              turnId: "turn_previous",
              kind: "assistant_message",
              status: "completed",
              authoredBy: "assistant",
              phase: "final_answer",
              completedAt: "2026-09-13T09:03:00.000Z",
              text: "The weekly product update is ready, organized around outcomes, evidence, risks, and next steps.",
            },
          },
        },
        lifecycle: { phase: "closed", reason: "Completed." },
        availableActions: ["archive"],
      },
    ],
    currentTaskId: "task_previous_weekly_update",
    workflows: [],
    recoveryWarnings: [],
    draftAttachments: [],
    fileAttention: [],
  },
  productError: null,
};

function applyCustomerCapabilities() {
  for (const task of snapshot.product.tasks) {
    const active = task.conversation.turnStatus === "in_progress";
    const taskAttention = snapshot.product.attention.filter(
      (entry) => entry.taskId === task.taskId && entry.status === "pending",
    );
    task.capabilities = {
      canSubmit: !active && task.availableActions.includes("message"),
      canQueue: active && task.availableActions.includes("message"),
      canSteer: active && task.availableActions.includes("message"),
      canStop: active && task.availableActions.includes("interrupt"),
      canRespond: taskAttention.some((entry) => entry.authority === "codex"),
      canTakeControl: false,
      canReturnToRove: false,
      canRetry: false,
      canArchive: task.availableActions.includes("archive"),
    };
  }
}

function notify() {
  applyCustomerCapabilities();
  snapshot.revision += 1;
  snapshot.surface.revision += 1;
  for (const listener of listeners) listener(structuredClone(snapshot));
}

function workflowInstructions(configuration) {
  return [
    configuration.purpose,
    ...configuration.preferences.map((entry) => entry.text),
    ...configuration.criteria.map((entry) => entry.text),
    ...configuration.guidance.map((entry) => entry.text),
    ...configuration.procedures.map((entry) => entry.text),
    ...configuration.resultConventions.map((entry) => entry.text),
    ...configuration.approvedKnowledge.map((entry) => entry.text),
  ].join("\n");
}

function executeProductIntent(intent) {
  calls.push({ type: "product", intent: structuredClone(intent) });
  if (intent.type === "workflow.create") {
    const workflow = {
      workflowId: "workflow_weekly_product_update",
      name: intent.name,
      archived: false,
      currentRevision: 1,
      revision: {
        workflowId: "workflow_weekly_product_update",
        revision: 1,
        configuration: structuredClone(intent.configuration),
        digest: "a".repeat(64),
        approvedAt: "2026-09-13T09:10:00.000Z",
      },
      createdAt: "2026-09-13T09:10:00.000Z",
      updatedAt: "2026-09-13T09:10:00.000Z",
    };
    snapshot.product.workflows = [workflow];
    notify();
    return structuredClone(workflow);
  }
  if (intent.type === "workflow.edit") {
    const current = snapshot.product.workflows.find(
      (workflow) => workflow.workflowId === intent.workflowId,
    );
    if (!current) throw new Error("Workflow not found.");
    const revision = current.currentRevision + 1;
    const workflow = {
      ...current,
      name: intent.name,
      currentRevision: revision,
      revision: {
        workflowId: current.workflowId,
        revision,
        configuration: structuredClone(intent.configuration),
        digest: "b".repeat(64),
        approvedAt: "2026-09-13T09:14:00.000Z",
      },
      updatedAt: "2026-09-13T09:14:00.000Z",
    };
    snapshot.product.workflows = [workflow];
    notify();
    return structuredClone(workflow);
  }
  if (intent.type === "task.launch") {
    const workflow = snapshot.product.workflows.find(
      (entry) => entry.workflowId === intent.input.workflowId,
    );
    const taskId = "task_workflow_weekly_update";
    const turnId = "turn_workflow_weekly_update";
    const launchedAt = new Date().toISOString();
    const task = {
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
          workflow_request: {
            id: "workflow_request",
            turnId,
            kind: "user_message",
            status: "completed",
            authoredBy: "user",
            completedAt: launchedAt,
            text: intent.input.outcome,
          },
          workflow_start: {
            id: "workflow_start",
            turnId,
            kind: "assistant_message",
            status: "completed",
            authoredBy: "assistant",
            phase: "commentary",
            completedAt: launchedAt,
            text: "I’m reviewing the notes and drafting this week’s update.",
          },
        },
      },
      lifecycle: { phase: "working", reason: "Working." },
      availableActions: ["message", "interrupt"],
      runtime: {
        status: "active",
        controller: "agent",
        attachment: "attached",
        recovery: "not_needed",
        profileOwnership: "owned",
      },
      ...(workflow
        ? {
            workflowAssociation: {
              workflowId: workflow.workflowId,
              workflowName: workflow.name,
            },
            ...(intent.input.shareWorkflowContext
              ? {
                  workflowContext: {
                    workflowId: workflow.workflowId,
                    workflowName: workflow.name,
                    revision: workflow.currentRevision,
                    digest: workflow.revision.digest,
                    developerInstructions: workflowInstructions(
                      workflow.revision.configuration,
                    ),
                  },
                }
              : {}),
          }
        : {}),
    };
    snapshot.product.tasks = [snapshot.product.tasks[0], task];
    snapshot.product.currentTaskId = taskId;
    notify();
    return { aggregate: { taskId } };
  }
  if (intent.type === "attention.decide") {
    const current = snapshot.product.attention.find(
      (entry) =>
        entry.taskId === intent.taskId &&
        entry.requestId === intent.requestId &&
        entry.generation === intent.generation,
    );
    if (!current) throw new Error("Attention request not found.");
    current.status = "resolved";
    const task = snapshot.product.tasks.find(
      (entry) => entry.taskId === intent.taskId,
    );
    if (task) {
      task.lifecycle = { phase: "ready", reason: "Ready for another message." };
      task.availableActions = ["message"];
    }
    notify();
    return {};
  }
  return {};
}

function seedWorkflowResult() {
  const task = snapshot.product.tasks.find(
    (entry) => entry.taskId === "task_workflow_weekly_update",
  );
  if (!task) throw new Error("Workflow task not found.");
  task.conversation.activeTurnId = undefined;
  task.conversation.turnStatus = "completed";
  task.lifecycle = { phase: "ready", reason: "Ready for another message." };
  task.availableActions = ["message"];
  task.runtime = undefined;
  snapshot.product.attention = [];
  task.results = [
    {
      resultId: "result_weekly_product_update",
      taskId: task.taskId,
      turnId: "turn_workflow_weekly_update",
      kind: "report",
      lifecycle: "prepared",
      selected: false,
      currentRevision: 1,
      revision: {
        resultId: "result_weekly_product_update",
        revision: 1,
        title: "Weekly product update",
        body: "A concise update covering outcomes, supporting evidence, material risks, and next steps.",
        artifactIds: [],
        digest: "c".repeat(64),
        createdAt: new Date().toISOString(),
      },
      source: {
        conversationItemId: "workflow_start",
        conversationTextDigest: "d".repeat(64),
        evidenceIds: [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  notify();
  return structuredClone(task.results[0]);
}

let attentionGeneration = 0;
function seedWorkflowAttention() {
  attentionGeneration += 1;
  snapshot.product.attention = [
    {
      authority: "codex",
      kind: "user_input",
      requestId: "request_weekly_audience",
      taskId: "task_workflow_weekly_update",
      threadId: "thread_workflow_weekly_update",
      turnId: "turn_workflow_weekly_update",
      itemId: "item_weekly_audience",
      generation: attentionGeneration,
      status: "pending",
      sequence: 1,
      title: "Choose the final audience",
      questions: [
        {
          id: "audience",
          header: "Audience",
          question: "Who should receive this update?",
          isOther: true,
          isSecret: false,
          options: [
            { label: "Leadership", description: "Concise executive update" },
            { label: "Product team", description: "More delivery detail" },
          ],
        },
      ],
    },
  ];
  notify();
  return structuredClone(snapshot.product.attention[0]);
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
    openTrustedExternal: async (intent) => {
      calls.push({ type: "external", intent: structuredClone(intent) });
    },
    openRecording: async () => undefined,
    exportLocalBackup: async () => ({ status: "cancelled" }),
    getBrowserWorkspaces: async () => structuredClone(snapshot.workspaces),
    createBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    selectBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    renameBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    deleteBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    executeProductIntent: async (intent) => executeProductIntent(intent),
    seedWorkflowAttention: async () => seedWorkflowAttention(),
    seedWorkflowResult: async () => seedWorkflowResult(),
    getJourneyState: async () => ({
      calls: structuredClone(calls),
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
