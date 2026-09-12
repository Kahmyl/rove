import { describe, expect, it, vi } from "vitest";

import { createProductIntentIpcHandler } from "./product-intent-ipc.js";

describe("renderer product IPC", () => {
  it("does not resolve a successful command before its committed snapshot revision", async () => {
    let commitRevision!: () => void;
    const revisionCommitted = new Promise<void>((resolve) => {
      commitRevision = resolve;
    });
    const handler = createProductIntentIpcHandler(
      () => ({
        executeRendererIntent: vi.fn(async () => ({ accepted: true })),
      }),
      () => revisionCommitted,
    );
    let resolved = false;
    const command = handler(
      {},
      {
        type: "task.message",
        taskId: "task_1",
        operationId: "intent_00000000-0000-4000-8000-000000000001",
        outcome: "Continue",
      },
    ).then((result) => {
      resolved = true;
      return result;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);
    commitRevision();
    await expect(command).resolves.toEqual({ accepted: true });
  });

  it("rejects unknown internal command objects before resolving the mutable API", async () => {
    const api = vi.fn();
    const publish = vi.fn(async () => undefined);
    const handler = createProductIntentIpcHandler(api, publish);
    const internal: unknown[] = [
      { type: "task.start", input: { cwd: "/renderer/cwd" } },
      { type: "task.resume", input: { roveTaskId: "task_old" } },
      { type: "task.close", taskId: "task_old" },
      { type: "task.thread.read", taskId: "task_old" },
      { type: "task.thread.archive", taskId: "task_old" },
      { type: "task.thread.unarchive", taskId: "task_old" },
      { type: "task.turn.start", intent: {} },
      { type: "task.turn.steer", intent: {} },
      { type: "task.turn.interrupt", taskId: "task_old" },
      { type: "continuation.reconcile", taskId: "task_old" },
      { type: "continuation.cancel", identity: {} },
      { type: "attention.respond", result: { arbitrary: true } },
    ];
    for (const value of internal)
      await expect(handler({}, value)).rejects.toThrow(
        /Unsupported renderer product intent/,
      );
    expect(api).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("passes only a narrow intent to host binding and publishes after success", async () => {
    const executeRendererIntent = vi.fn(async () => ({ accepted: true }));
    const publish = vi.fn(async () => undefined);
    const handler = createProductIntentIpcHandler(
      () => ({ executeRendererIntent }),
      publish,
    );
    const intent: unknown = { type: "task.message", outcome: "Continue" };
    await expect(handler({}, intent)).resolves.toEqual({ accepted: true });
    expect(executeRendererIntent).toHaveBeenCalledWith(intent);
    expect(publish).toHaveBeenCalledAfter(executeRendererIntent);
  });
});
