/* eslint-disable @typescript-eslint/no-require-imports */
/* global console, require, process, setTimeout, structuredClone, __dirname, __filename */

const { app, BrowserWindow, contextBridge } = require("electron");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const scenarios = JSON.parse(
  readFileSync(
    process.env.ROVE_QUALIFICATION_SCENARIOS ??
      join(
        __dirname,
        "../../artifacts/customer-journeys/conversation-task-rendered-qualification/production-projection-scenarios.json",
      ),
    "utf8",
  ),
);
const listeners = new Set();
const calls = [];
const stateChanges = [];
let scenarioName = "immediate_sustained";
let snapshot = structuredClone(scenarios[scenarioName]);
let revision = snapshot.revision;

function publish(label) {
  revision += 1;
  snapshot.revision = revision;
  snapshot.surface.revision = revision;
  stateChanges.push({
    sequence: stateChanges.length + 1,
    label,
    scenario: scenarioName,
  });
  for (const listener of listeners) listener(structuredClone(snapshot));
}

function setScenario(name) {
  if (!scenarios[name])
    throw new Error(`Unknown qualification scenario: ${name}`);
  scenarioName = name;
  snapshot = structuredClone(scenarios[name]);
  if (name === "start_sustained") {
    snapshot.product.tasks[0].customerExecution.workingVisibleAfter = new Date(
      Date.now() + 250,
    ).toISOString();
  }
  publish(`scenario.${name}`);
  return structuredClone(snapshot);
}

function taskById(taskId) {
  return snapshot.product.tasks.find((entry) => entry.taskId === taskId);
}

function refreshTaskPresentation(task) {
  if (task.customerExecution.state === "stopping") {
    task.customerPresentation = {
      state: "stopping",
      sidebar: { label: "Stopping", tone: "muted" },
      terminalWorkLabel: "Worked",
    };
  } else if (task.customerExecution.state === "stopped") {
    task.customerPresentation = {
      state: "stopped",
      sidebar: { label: "Stopped", tone: "muted" },
      terminalWorkLabel: "Stopped",
    };
  }
}

function executeProductIntent(intent) {
  calls.push({ type: "product", intent: structuredClone(intent) });
  const task = intent.taskId ? taskById(intent.taskId) : undefined;
  if (intent.type === "task.queue.add" && task) {
    const id = `queue:${intent.operationId}`;
    task.customerExecution.queue.push({
      id,
      operationId: intent.operationId,
      message: intent.outcome,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attachmentIds: intent.attachmentIds ?? [],
    });
    publish("queue.added");
  } else if (intent.type === "task.queue.edit" && task) {
    const entry = task.customerExecution.queue.find(
      (candidate) => candidate.id === intent.entryId,
    );
    if (entry) {
      entry.message = intent.outcome;
      entry.updatedAt = new Date().toISOString();
    }
    publish("queue.edited");
  } else if (intent.type === "task.queue.remove" && task) {
    task.customerExecution.queue = task.customerExecution.queue.filter(
      (entry) => entry.id !== intent.entryId,
    );
    publish("queue.removed");
  } else if (intent.type === "task.queue.reorder" && task) {
    const byId = new Map(
      task.customerExecution.queue.map((entry) => [entry.id, entry]),
    );
    task.customerExecution.queue = intent.entryIds.map((id) => byId.get(id));
    publish("queue.reordered");
  } else if (intent.type === "task.queue.steer" && task) {
    const entry = task.customerExecution.queue.find(
      (candidate) => candidate.id === intent.entryId,
    );
    if (!entry || intent.expectedTurnId !== task.conversation.activeTurnId)
      throw new Error("Queued Steer lost exact entry or turn authority.");
    task.customerExecution.queue = task.customerExecution.queue.filter(
      (candidate) => candidate.id !== entry.id,
    );
    const id = `user:${entry.operationId}`;
    task.conversation.items[id] = {
      id,
      turnId: intent.expectedTurnId,
      clientId: entry.operationId,
      kind: "user_message",
      status: "completed",
      authoredBy: "user",
      acceptedAt: new Date().toISOString(),
      text: entry.message,
    };
    task.conversation.itemOrder.push(id);
    task.customerExecution.segments.push({
      id,
      inputItemId: id,
      commentaryItemIds: [],
      finalAnswerItemIds: [],
      activities: [],
      workOrder: [],
      status: "active",
      accumulatedActiveMs: 0,
      activeSince: new Date().toISOString(),
    });
    publish("queue.steered");
  } else if (intent.type === "task.steer" && task) {
    const id = `user:${intent.operationId}`;
    task.conversation.items[id] = {
      id,
      turnId: task.conversation.activeTurnId,
      kind: "user_message",
      status: "completed",
      authoredBy: "user",
      acceptedAt: new Date().toISOString(),
      text: intent.outcome,
    };
    task.conversation.itemOrder.push(id);
    task.customerExecution.segments.push({
      id,
      inputItemId: id,
      commentaryItemIds: [],
      finalAnswerItemIds: [],
      activities: [],
      workOrder: [],
      status: "active",
      accumulatedActiveMs: 0,
      activeSince: new Date().toISOString(),
    });
    publish("turn.steered");
  } else if (intent.type === "task.stop" && task) {
    task.customerExecution.state = "stopping";
    task.capabilities.canStop = false;
    refreshTaskPresentation(task);
    publish("task.stopping");
    setTimeout(() => {
      task.customerExecution.state = "stopped";
      const current = task.customerExecution.segments.at(-1);
      if (current) {
        if (current.activities.length === 0) {
          current.activities.push({
            id: "activity:stop_transition",
            itemId: "stop_transition",
            kind: "verify",
            state: "confirmed",
            label: "Verified stopped work",
          });
          current.workOrder.push({
            type: "activity",
            id: "activity:stop_transition",
          });
        }
        current.status = "terminal";
        delete current.activeSince;
        current.completedAt = new Date().toISOString();
      }
      task.capabilities.canSubmit = true;
      refreshTaskPresentation(task);
      publish("task.stopped");
    }, 80);
  } else if (intent.type === "attention.decide") {
    const entry = snapshot.product.attention.find(
      (candidate) =>
        candidate.requestId === intent.requestId &&
        candidate.generation === intent.generation,
    );
    if (entry) entry.status = "responding";
    if (task?.customerCollaboration?.request) {
      task.customerCollaboration.request.responseState = "submitting";
      task.customerCollaboration.request.state = "submitting";
      task.customerCollaboration.request.description =
        "Submitting your response…";
      task.customerCollaboration.request.actions = [];
    }
    publish("attention.submitting");
  } else if (intent.type === "task.return-control") {
    setScenario("browser_checking");
  }
  return {};
}

function takeControl(taskId, handoffGeneration) {
  calls.push({ type: "takeControl", taskId, handoffGeneration });
  const expected = scenarioName === "browser_voluntary" ? undefined : 7;
  if (taskId !== "task_browser" || handoffGeneration !== expected)
    throw new Error(
      "Browser takeover does not match the exact Task generation.",
    );
  setScenario("browser_human");
  return structuredClone(snapshot.companion);
}

let appendedActivity = 0;
function appendJourneyActivity() {
  const task = taskById("task_long");
  const segment = task?.customerExecution?.segments?.at(-1);
  if (!segment) throw new Error("Long-content activity segment is missing.");
  appendedActivity += 1;
  const id = `activity:follow_${appendedActivity}`;
  segment.activities.push({
    id,
    itemId: `follow_${appendedActivity}`,
    kind: "verify",
    state: "confirmed",
    label: `Verified follow-up ${appendedActivity}`,
  });
  segment.workOrder.push({ type: "activity", id });
  publish(`activity.appended.${appendedActivity}`);
}

function appendStoppedJourneyActivity() {
  const task = taskById(snapshot.product.currentTaskId);
  const segment = task?.customerExecution?.segments?.at(-1);
  if (!segment || segment.status !== "terminal")
    throw new Error("Stopped transition segment is not terminal.");
  const id = "activity:after_manual_reopen";
  segment.activities.push({
    id,
    itemId: "after_manual_reopen",
    kind: "verify",
    state: "confirmed",
    label: "Verified later terminal update",
  });
  segment.workOrder.push({ type: "activity", id });
  publish("activity.after-manual-reopen");
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
    getSnapshot: async () => structuredClone(snapshot.companion),
    getNotice: async () => snapshot.notice,
    getLiveSession: async () =>
      structuredClone(snapshot.companion?.session ?? null),
    getFollowerPresentation: async () => "windowed_expanded",
    takeControl: async (taskId, handoffGeneration) =>
      takeControl(taskId, handoffGeneration),
    returnControl: async (taskId) =>
      executeProductIntent({ type: "task.return-control", taskId }),
    pauseSession: async () => structuredClone(snapshot.companion),
    finishSession: async () => null,
    setFollowerExpanded: async () => "windowed_expanded",
    beginFollowerDrag: async () => undefined,
    updateFollowerDrag: async () => undefined,
    endFollowerDrag: async () => undefined,
    openRove: async () => undefined,
    restartRove: async () => true,
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
    openRecording: async () => undefined,
    exportLocalBackup: async () => ({ status: "cancelled" }),
    getBrowserWorkspaces: async () => structuredClone(snapshot.workspaces),
    createBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    selectBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    renameBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    deleteBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    executeProductIntent: async (intent) => executeProductIntent(intent),
    setJourneyScenario: async (name) => setScenario(name),
    appendJourneyActivity: async () => appendJourneyActivity(),
    appendStoppedJourneyActivity: async () => appendStoppedJourneyActivity(),
    getJourneyState: async () => ({
      scenario: scenarioName,
      calls: structuredClone(calls),
      stateChanges: structuredClone(stateChanges),
      snapshot: structuredClone(snapshot),
    }),
  });
} else {
  app.whenReady().then(async () => {
    try {
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
          sandbox: false,
          preload: __filename,
        },
      });
      window.once("ready-to-show", () => window.show());
      await window.loadFile(
        `${process.env.ROVE_JOURNEY_RENDERER_ROOT}/index.html`,
      );
    } catch (error) {
      console.error("Qualification fixture failed to load.", error);
      app.quit();
    }
  });
  app.on("window-all-closed", () => app.quit());
}
