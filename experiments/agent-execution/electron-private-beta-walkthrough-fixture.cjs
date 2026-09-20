/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, structuredClone, __filename */

const { app, BrowserWindow, contextBridge } = require("electron");

const timestamp = "2026-09-14T12:00:00.000Z";
const workspaceId = "wrk_00000000-0000-4000-8000-000000000004";
const listeners = new Set();
const calls = [];
const stateChanges = [];
let backupOutcome = "created";
let connectionFailure = false;

function baseSnapshot(
  account = { status: "logged_in", authMode: "chatgpt", planType: "Plus" },
) {
  return {
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
        account,
        models: [
          {
            id: "gpt-fixture",
            model: "gpt-fixture",
            displayName: "Codex",
            description: "Deterministic private-beta walkthrough fixture",
            efforts: ["low", "medium", "high"],
            defaultEffort: "medium",
            isDefault: true,
            inputModalities: ["text", "image"],
            supportsPersonality: false,
            defaultServiceTier: null,
          },
        ],
        rateLimits: [
          {
            limitId: "codex",
            limitName: "Five-hour window",
            usedPercent: 34,
            resetsAt: 1789372800,
            windowDurationMins: 300,
            planType: "Plus",
          },
        ],
        usage: { summary: { inputTokens: 8200 }, dailyUsageBuckets: null },
        refreshedAt: timestamp,
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

function task({
  taskId,
  request,
  executionMode = "agent",
  phase = "ready",
  reason = "Ready for follow-up.",
  turnStatus = "completed",
  availableActions = ["message"],
  runtime,
  browserIdentity = { mode: "temporary" },
}) {
  const turnId = `turn_${taskId}`;
  return {
    taskId,
    executionMode,
    browserIdentity,
    selectionSource: "user_selected",
    selectedAt: timestamp,
    approvalsReviewer: "auto_review",
    bootstrapStage: "complete",
    model: "gpt-fixture",
    reasoningEffort: "medium",
    results: [],
    recordings: [],
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
          completedAt: timestamp,
          text: request,
        },
      },
    },
    lifecycle: { phase, reason },
    availableActions,
    ...(runtime ? { runtime } : {}),
  };
}

function multiTaskSnapshot({ attention = false, answered = false } = {}) {
  const value = baseSnapshot();
  const active = task({
    taskId: "task_market_analysis",
    request: "Analyze the customer interview themes",
    phase: answered ? "working" : attention ? "waiting_for_human" : "working",
    reason: answered
      ? "Continuing with the selected audience."
      : attention
        ? "Choose the audience for the summary."
        : "Reviewing interview notes.",
    turnStatus: "in_progress",
    availableActions: answered
      ? ["message", "interrupt"]
      : attention
        ? ["interrupt"]
        : ["message", "interrupt"],
    runtime: {
      status: "active",
      controller: "agent",
      attachment: "not_attached",
      recovery: "not_needed",
      profileOwnership: "none",
    },
  });
  active.conversation.items.progress_a = {
    id: "progress_a",
    turnId: "turn_task_market_analysis",
    kind: "assistant_message",
    status: "completed",
    authoredBy: "assistant",
    phase: "commentary",
    completedAt: "2026-09-14T12:00:08.000Z",
    text: answered
      ? "I’m continuing with a concise leadership summary."
      : "I’m grouping the recurring themes and checking supporting quotes.",
  };
  const viewed = task({
    taskId: "task_launch_checklist",
    request: "Review the launch checklist",
  });
  viewed.conversation.items.response_b = {
    id: "response_b",
    turnId: "turn_task_launch_checklist",
    kind: "assistant_message",
    status: "completed",
    authoredBy: "assistant",
    phase: "final_answer",
    completedAt: "2026-09-14T12:01:00.000Z",
    text: "The checklist is ready. Two owners still need confirmation.",
  };
  value.product.tasks = [active, viewed];
  value.product.currentTaskId = active.taskId;
  if (attention) {
    value.product.attention = [
      {
        authority: "codex",
        kind: "user_input",
        requestId: "input_audience",
        taskId: active.taskId,
        threadId: "thread_market_analysis",
        turnId: "turn_task_market_analysis",
        itemId: "question_audience",
        generation: 1,
        status: "pending",
        sequence: 1,
        title: "Choose the audience",
        questions: [
          {
            id: "audience",
            header: "Audience",
            question: "Who should receive this summary?",
            isOther: false,
            isSecret: false,
            options: [
              {
                label: "Leadership",
                description: "A concise decision-oriented summary.",
              },
              {
                label: "Product team",
                description: "More detail and supporting observations.",
              },
            ],
          },
        ],
      },
    ];
  }
  return value;
}

function browserSnapshot(state) {
  const value = baseSnapshot();
  const runtime =
    state === "absent"
      ? undefined
      : {
          status: state === "handoff" ? "awaiting_human" : "active",
          controller:
            state === "handoff" ? null : state === "human" ? "human" : "agent",
          attachment: "attached",
          recovery: "not_needed",
          profileOwnership: "owned",
          ...(state === "handoff"
            ? { handoffActionable: true, handoffGeneration: 1 }
            : {}),
          ...(state === "returned"
            ? {
                collaborationState: "checking_after_return",
                continuationPolicy: "resume_after_control_return",
              }
            : {}),
        };
  const primary = task({
    taskId: "task_vendor_research",
    request: "Compare the vendor plans on their public pricing pages",
    executionMode: state === "absent" ? "agent" : "companion",
    phase:
      state === "handoff" || state === "human"
        ? "waiting_for_human"
        : "working",
    reason:
      state === "handoff"
        ? "Confirm the plan details before continuing."
        : state === "human"
          ? "You have browser control."
          : "Reviewing the selected page.",
    turnStatus: "in_progress",
    availableActions:
      state === "human"
        ? ["return_control", "interrupt"]
        : state === "handoff"
          ? ["interrupt"]
          : ["message", "interrupt"],
    runtime,
    browserIdentity:
      state === "absent"
        ? { mode: "temporary" }
        : { mode: "workspace", workspaceId },
  });
  primary.roveSessionId = "session_vendor_research";
  primary.conversation.items.browser_progress = {
    id: "browser_progress",
    turnId: "turn_task_vendor_research",
    kind: "assistant_message",
    status: "completed",
    authoredBy: "assistant",
    phase: "commentary",
    completedAt: "2026-09-14T12:04:00.000Z",
    text:
      state === "absent"
        ? "I can organize the comparison criteria; no browser page is attached yet."
        : state === "returned"
          ? "Control is back. I checked the current plan page and can continue."
          : "I’m comparing the plan limits on the current page.",
  };
  const shared = task({
    taskId: "task_contract_notes",
    request: "Summarize the contract notes",
    browserIdentity: { mode: "workspace", workspaceId },
  });
  value.product.tasks = [primary, shared];
  value.product.currentTaskId = primary.taskId;
  if (state !== "absent") {
    value.companion = {
      session: {
        id: "session_vendor_research",
        bootstrapId: "bootstrap_vendor_research",
        mode: "companion",
        status: state === "handoff" ? "awaiting_human" : "active",
        controller:
          state === "handoff" ? null : state === "human" ? "human" : "agent",
        profile: { mode: "persistent", name: workspaceId },
        workspace: value.workspaces.workspaces[0],
        ...(state === "handoff"
          ? {
              handoff: {
                reason: "Confirm the plan details before continuing.",
                requestedAt: timestamp,
              },
            }
          : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      observationCount: state === "attached" ? 3 : 8,
      evidenceCount: state === "attached" ? 1 : 3,
      browserOpen: true,
    };
  }
  if (state === "handoff") {
    value.product.attention = [
      {
        authority: "rove_control",
        kind: "control_handoff",
        requestId: "control:session_vendor_research:1",
        taskId: primary.taskId,
        threadId: "thread_vendor_research",
        turnId: "turn_task_vendor_research",
        generation: 1,
        status: "pending",
        sequence: 1,
        title: "Browser control handoff",
        instruction: "Confirm the plan details before continuing.",
        continuationPolicy: "resume_after_control_return",
      },
    ];
  }
  return value;
}

function recording(state, mode = "agent") {
  const id = `rec_${state.padEnd(32, state[0]).slice(0, 32)}`;
  return {
    schemaVersion: 1,
    id,
    taskId: "task_recording_review",
    sessionId: "session_recording_review",
    mode,
    state,
    scope: {
      kind: "page",
      pageId: "page_recording_review",
      url: "https://example.test/private-beta-fixture",
    },
    sensitiveDataPolicy: "user_confirmed_visible_content",
    includesAudio: false,
    coverage: "Selected task-owned page only.",
    exclusions: ["Browser chrome", "Other tabs", "Native dialogs"],
    requestedAt: timestamp,
    updatedAt: "2026-09-14T12:08:00.000Z",
    ...(["recording", "finalizing", "available"].includes(state)
      ? { startedAt: "2026-09-14T12:05:01.000Z" }
      : {}),
    ...(["finalizing", "available"].includes(state)
      ? { stoppedAt: "2026-09-14T12:07:59.000Z" }
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

function recordingSnapshot(state, mode = "agent") {
  const value = browserSnapshot("attached");
  const active = value.product.tasks[0];
  active.taskId = "task_recording_review";
  active.executionMode = mode;
  active.conversation.turnOrder = ["turn_task_recording_review"];
  active.conversation.items = {
    recording_request: {
      id: "recording_request",
      turnId: "turn_task_recording_review",
      kind: "user_message",
      status: "completed",
      authoredBy: "user",
      completedAt: timestamp,
      text: "Record the selected task page while I review it",
    },
  };
  active.recordings = state === "none" ? [] : [recording(state, mode)];
  active.roveSessionId = "session_recording_review";
  if (mode === "capture") {
    active.runtime.controller = "human";
    active.runtime.status = "active";
  }
  value.product.tasks = [active];
  value.product.currentTaskId = active.taskId;
  value.companion.session.id = "session_recording_review";
  value.companion.session.mode = mode;
  if (mode === "capture") value.companion.session.controller = "human";
  return value;
}

function accountSnapshot(state) {
  const account =
    state === "signed_out"
      ? { status: "logged_out" }
      : state === "unavailable"
        ? {
            status: "unavailable",
            error: "Account status is temporarily unavailable.",
          }
        : { status: "logged_in", authMode: "chatgpt", planType: "Plus" };
  const value = baseSnapshot(account);
  if (state === "signing_in") {
    value.product.catalog.account = { status: "logged_out" };
    value.product.catalog.login = {
      type: "chatgpt",
      loginId: "login_private_beta",
    };
  }
  if (state === "usage_limit")
    value.product.catalog.rateLimits[0].usedPercent = 100;
  if (state === "startup_failed")
    value.productError = "Fixture startup failure";
  return value;
}

const scenarios = {
  empty: () => baseSnapshot(),
  multi_working: () => multiTaskSnapshot(),
  multi_attention: () => multiTaskSnapshot({ attention: true }),
  multi_answered: () => multiTaskSnapshot({ answered: true }),
  browser_absent: () => browserSnapshot("absent"),
  browser_attached: () => browserSnapshot("attached"),
  browser_handoff: () => browserSnapshot("handoff"),
  browser_human: () => browserSnapshot("human"),
  browser_returned: () => browserSnapshot("returned"),
  recording_none: () => recordingSnapshot("none"),
  recording_requested: () => recordingSnapshot("requested"),
  recording_active: () => recordingSnapshot("recording"),
  recording_finalizing: () => recordingSnapshot("finalizing"),
  recording_available: () => recordingSnapshot("available"),
  recording_failed: () => recordingSnapshot("failed"),
  capture_recording: () => recordingSnapshot("recording", "capture"),
  codex_signed_out: () => accountSnapshot("signed_out"),
  codex_signing_in: () => accountSnapshot("signing_in"),
  codex_ready: () => accountSnapshot("ready"),
  codex_usage_limit: () => accountSnapshot("usage_limit"),
  codex_unavailable: () => accountSnapshot("unavailable"),
  codex_startup_failed: () => accountSnapshot("startup_failed"),
};

let snapshot = scenarios.empty();

function applyCustomerCapabilities(value) {
  for (const task of value.product.tasks) {
    const active = task.conversation.turnStatus === "in_progress";
    const taskAttention = value.product.attention.filter(
      (entry) => entry.taskId === task.taskId && entry.status === "pending",
    );
    const exactHandoff = taskAttention.some(
      (entry) =>
        entry.authority === "rove_control" &&
        entry.kind === "control_handoff" &&
        entry.generation === task.runtime?.handoffGeneration,
    );
    task.capabilities = {
      canSubmit: !active && task.availableActions.includes("message"),
      canQueue: active && task.availableActions.includes("message"),
      canSteer: active && task.availableActions.includes("message"),
      canStop: active && task.availableActions.includes("interrupt"),
      canRespond: taskAttention.some((entry) => entry.authority === "codex"),
      canTakeControl:
        exactHandoff ||
        (task.executionMode === "companion" &&
          task.runtime?.status === "active" &&
          task.runtime?.controller === "agent" &&
          task.runtime?.attachment === "attached"),
      canReturnToRove:
        task.runtime?.controller === "human" &&
        task.availableActions.includes("return_control"),
      canRetry: task.availableActions.includes("retry_cleanup"),
      canArchive: task.availableActions.includes("archive"),
    };
  }
  return value;
}

function publish(label) {
  applyCustomerCapabilities(snapshot);
  snapshot.revision += 1;
  snapshot.surface.revision += 1;
  stateChanges.push({
    sequence: stateChanges.length + 1,
    label,
    snapshotRevision: snapshot.revision,
  });
  for (const listener of listeners) listener(structuredClone(snapshot));
}

function setScenario(name) {
  const build = scenarios[name];
  if (!build) throw new Error(`Unknown private-beta scenario: ${name}`);
  snapshot = build();
  publish(`scenario.${name}`);
  return structuredClone(snapshot);
}

function takeControl() {
  snapshot = browserSnapshot("human");
  publish("browser.control_taken");
  return structuredClone(snapshot.companion);
}

function returnControl() {
  snapshot = browserSnapshot("returned");
  publish("browser.control_returned");
  return structuredClone(snapshot.companion);
}

function executeProductIntent(intent) {
  calls.push({ type: "product", intent: structuredClone(intent) });
  if (intent.type === "account.login") {
    snapshot = accountSnapshot("signing_in");
    publish("codex.signing_in");
    return { type: "chatgpt", loginId: "login_private_beta" };
  }
  if (intent.type === "account.logout") {
    snapshot = accountSnapshot("signed_out");
    publish("codex.signed_out");
    return {};
  }
  if (intent.type === "task.recording.start") {
    snapshot = recordingSnapshot("requested");
    publish("recording.requested");
    return {};
  }
  if (intent.type === "task.recording.stop") {
    snapshot = recordingSnapshot("finalizing");
    publish("recording.finalizing");
    return {};
  }
  if (intent.type === "attention.decide") {
    snapshot = multiTaskSnapshot({ answered: true });
    publish("task.input_answered");
    return {};
  }
  if (intent.type === "task.return-control") return returnControl();
  return {};
}

if (process.type === "renderer") {
  contextBridge.exposeInMainWorld("rove", {
    getWindowFullscreen: async () => false,
    subscribeWindowFullscreen: () => () => {},
    getSurfaceSnapshot: async () => {
      if (connectionFailure)
        throw new Error("Unable to reach the local Rove host.");
      return structuredClone(snapshot);
    },
    subscribeSurfaceSnapshot: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    transitionSurface: async () => structuredClone(snapshot),
    getSnapshot: async () => structuredClone(snapshot.companion),
    getNotice: async () => snapshot.notice,
    getLiveSession: async () =>
      structuredClone(snapshot.companion?.session ?? null),
    getFollowerPresentation: async () => "windowed_compact",
    takeControl: async () => takeControl(),
    returnControl: async () => returnControl(),
    pauseSession: async () => structuredClone(snapshot.companion),
    finishSession: async () => null,
    setFollowerExpanded: async () => "windowed_expanded",
    beginFollowerDrag: async () => undefined,
    updateFollowerDrag: async () => undefined,
    endFollowerDrag: async () => undefined,
    openRove: async () => undefined,
    restartRove: async () => {
      calls.push({ type: "restartRove" });
      return true;
    },
    showBrowser: async (taskId) => {
      calls.push({ type: "showBrowser", taskId });
      return true;
    },
    openTrustedExternal: async (intent) => {
      calls.push({
        type: "openTrustedExternal",
        intent: structuredClone(intent),
      });
    },
    openRecording: async (taskId, recordingId) => {
      calls.push({ type: "openRecording", taskId, recordingId });
    },
    exportLocalBackup: async () => {
      calls.push({ type: "exportLocalBackup", outcome: backupOutcome });
      if (backupOutcome === "cancelled") return { status: "cancelled" };
      if (backupOutcome === "failed")
        throw new Error("Rove could not create the local backup.");
      return {
        status: "created",
        name: "rove-local-backup",
        fileCount: 6,
        missingCount: 0,
      };
    },
    getBrowserWorkspaces: async () => structuredClone(snapshot.workspaces),
    createBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    selectBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    renameBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    deleteBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    executeProductIntent: async (intent) => executeProductIntent(intent),
    setJourneyScenario: async (name) => setScenario(name),
    setBackupOutcome: async (outcome) => {
      backupOutcome = outcome;
    },
    setConnectionFailure: async (failed) => {
      connectionFailure = failed;
    },
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
      minWidth: 760,
      minHeight: 620,
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
