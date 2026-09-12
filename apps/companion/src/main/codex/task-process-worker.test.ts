import { describe, expect, it, vi } from "vitest";
import {
  MemoryTaskStore,
  TaskProcessManager,
  type NativeLifecycleInput,
} from "@rove/protocol";

import { TaskProcessWorker } from "./task-process-worker.js";
import type {
  TaskProcessAdapterContext,
  TaskProcessCommandAdapter,
} from "./task-process-worker.js";

function lifecycle(taskId: string): NativeLifecycleInput {
  const bootstrapId = `boot_${"6".repeat(32)}`;
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

async function seed(store: MemoryTaskStore, taskId: string) {
  return new TaskProcessManager(store).accept({
    schemaVersion: 1,
    inputId: `intent:${taskId}`,
    taskId,
    kind: "intent",
    source: "test",
    sourceId: `intent:${taskId}`,
    observedAt: "2026-09-09T12:00:00.000Z",
    lifecycle: lifecycle(taskId),
    launchConfiguration: { roveTaskId: `raw:${taskId}` },
  });
}

describe("TaskProcessWorker", () => {
  it("claims before dispatch and commits adapter success as the next fact", async () => {
    const store = new MemoryTaskStore();
    const taskId = "task_66666666-6666-4666-8666-666666666666";
    await seed(store, taskId);
    const execute: TaskProcessCommandAdapter["execute"] = vi.fn(
      async (_command, context: TaskProcessAdapterContext) => ({
        status: "succeeded" as const,
        lifecycle: (await store.lifecycle(taskId))!,
        detail: { rawTaskId: context.launchConfiguration?.roveTaskId },
      }),
    );
    const worker = new TaskProcessWorker({
      store,
      adapter: { execute, reconcile: vi.fn() },
      workerId: "worker-a",
      now: () => "2026-09-09T12:00:01.000Z",
    });

    expect(await worker.runOnce(1)).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        launchConfiguration: { roveTaskId: `raw:${taskId}` },
      }),
    );
    expect(await store.projection(taskId)).toMatchObject({ sequence: 3 });
    expect(await store.claimDueCommands("inspection", 2, 1)).toMatchObject([
      { type: "lookup_or_start_codex_thread", claimedFrom: "pending" },
    ]);
  });

  it("reconciles an unresolved command before allowing another dispatch", async () => {
    const store = new MemoryTaskStore();
    const taskId = "task_77777777-7777-4777-8777-777777777777";
    await seed(store, taskId);
    const execute = vi.fn(async () => {
      throw new Error("cut after dispatch");
    });
    let reconciliationAttempts = 0;
    const reconcile = vi.fn(async () => {
      reconciliationAttempts += 1;
      if (reconciliationAttempts === 1)
        throw new Error("reconciliation temporarily unavailable");
      return {
        status: "succeeded" as const,
        lifecycle: (await store.lifecycle(taskId))!,
        detail: { reconciled: true },
      };
    });
    const worker = new TaskProcessWorker({
      store,
      adapter: { execute, reconcile },
      workerId: "worker-a",
      now: () => "2026-09-09T12:00:01.000Z",
    });

    await worker.runOnce(1);
    await worker.runOnce(1);
    await worker.runOnce(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });
});
