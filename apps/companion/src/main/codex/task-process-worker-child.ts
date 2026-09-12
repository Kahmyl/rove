import { appendFileSync } from "node:fs";

import { TaskProcessManager, type NativeLifecycleInput } from "@rove/protocol";

import { SqliteTaskStore } from "./sqlite-task-store.js";
import { TaskProcessWorker } from "./task-process-worker.js";

const [mode, databasePath, markerPath] = process.argv.slice(2);
if (!mode || !databasePath || !markerPath)
  throw new Error("Missing child input.");
const taskId = "task_88888888-8888-4888-8888-888888888888";
const bootstrapId = `boot_${"8".repeat(32)}`;

function lifecycle(): NativeLifecycleInput {
  return {
    record: {
      schemaVersion: 1,
      identity: { taskId, browser: { mode: "temporary" } },
      bootstrap: {
        operationId: bootstrapId,
        threadSource: `rove:${taskId}:${bootstrapId}`,
        stage: "intent_persisted",
      },
      desiredState: "open",
    },
    codex: {
      availability: "available",
      threadExists: false,
      sourceLookup: "none",
      runtimeStatus: "notLoaded",
      archived: null,
      turn: "none",
    },
    runtime: {
      availability: "available",
      sessionExists: false,
      bootstrapLookup: "none",
      status: "missing",
      controller: null,
      attachment: "missing",
      profileLock: "released",
      recovery: "cleanup_required",
    },
    continuation: { status: "none" },
    attentions: [],
    freshInspection: null,
    requestedOperation: { type: "observe", taskId },
  };
}

const store = new SqliteTaskStore({ path: databasePath });
if (mode === "seed") {
  await new TaskProcessManager(store).accept({
    schemaVersion: 1,
    inputId: "child-process-intent",
    taskId,
    kind: "intent",
    source: "child-process-test",
    sourceId: "child-process-intent",
    observedAt: new Date().toISOString(),
    lifecycle: lifecycle(),
  });
  process.exit(0);
}

const worker = new TaskProcessWorker({
  store,
  workerId: `child-${mode}`,
  adapter: {
    execute: async () => {
      appendFileSync(markerPath, "execute\n");
      if (mode === "dispatch-cut") process.kill(process.pid, "SIGKILL");
      return {
        status: "succeeded",
        lifecycle: (await store.lifecycle(taskId))!,
      };
    },
    reconcile: async () => {
      appendFileSync(markerPath, "reconcile\n");
      if (mode === "reconcile-cut") process.kill(process.pid, "SIGKILL");
      return {
        status: "succeeded",
        lifecycle: (await store.lifecycle(taskId))!,
      };
    },
  },
});
await worker.runOnce(1);
await store.close();
