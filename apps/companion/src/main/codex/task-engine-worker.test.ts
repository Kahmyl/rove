import { describe, expect, it, vi } from "vitest";
import type { TaskCommand } from "@rove/protocol";

import { TaskEngineWorker } from "./task-engine-worker.js";

function command(index: number): TaskCommand {
  return {
    schemaVersion: 1,
    commandId: `command_${index}`,
    taskId: `task_${index}`,
    aggregateRevision: 1,
    type: "read_lifecycle_truth",
    payload: { type: "read_lifecycle_truth", taskId: `task_${index}` },
    classification: { execute: "repeatable_read", reconcile: "read_truth" },
    status: "leased",
    attempts: 1,
    createdAt: "2026-09-09T12:00:00.000Z",
    claimedFrom: "pending",
  };
}

describe("TaskEngineWorker per-task lanes", () => {
  it("runs up to four distinct task commands concurrently", async () => {
    const commands = [1, 2, 3, 4].map(command);
    let claimed = false;
    let active = 0;
    let greatest = 0;
    const worker = new TaskEngineWorker({
      engine: { accept: vi.fn(async () => ({})) } as never,
      store: {
        claimDueCommands: vi.fn(async () => {
          if (claimed) return [];
          claimed = true;
          return commands;
        }),
        markPossiblyStarted: vi.fn(async () => undefined),
      } as never,
      adapter: {
        execute: vi.fn(async () => {
          active += 1;
          greatest = Math.max(greatest, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { status: "succeeded" as const, facts: [] };
        }),
        reconcile: vi.fn(),
      },
      maximumConcurrentTasks: 4,
    });
    await worker.runUntilIdle();
    expect(greatest).toBe(4);
  });

  it("rejects a batch that would execute two commands for one task", async () => {
    const left = command(1);
    const right = { ...command(2), taskId: left.taskId };
    const worker = new TaskEngineWorker({
      engine: {} as never,
      store: {
        claimDueCommands: vi.fn(async () => [left, right]),
      } as never,
      adapter: {} as never,
    });
    await expect(worker.runUntilIdle()).rejects.toThrow(
      "concurrent commands for one task",
    );
  });

  it("continues other task lanes when one command becomes unresolved", async () => {
    const commands = [1, 2, 3, 4, 5].map(command);
    const remaining = [...commands];
    const executed: string[] = [];
    const worker = new TaskEngineWorker({
      engine: { accept: vi.fn(async () => ({})) } as never,
      store: {
        claimDueCommands: vi.fn(
          async (
            _workerId: string,
            _generation: number,
            limit: number,
            options?: { excludeTaskIds?: readonly string[] },
          ) => {
            const excluded = new Set(options?.excludeTaskIds ?? []);
            const claimed = remaining
              .filter((entry) => !excluded.has(entry.taskId))
              .slice(0, limit);
            for (const entry of claimed)
              remaining.splice(remaining.indexOf(entry), 1);
            return claimed;
          },
        ),
        markPossiblyStarted: vi.fn(async () => undefined),
      } as never,
      adapter: {
        execute: vi.fn(async (entry: TaskCommand) => {
          executed.push(entry.taskId);
          return {
            status: entry.taskId === "task_1" ? "unresolved" : "succeeded",
            facts: [],
          } as const;
        }),
        reconcile: vi.fn(),
      },
    });

    await worker.runUntilIdle();
    expect(executed).toEqual([
      "task_1",
      "task_2",
      "task_3",
      "task_4",
      "task_5",
    ]);
  });

  it("refills a free lane without waiting for the slowest task", async () => {
    const remaining = [1, 2, 3, 4, 5].map(command);
    const started: string[] = [];
    let releaseSlow!: () => void;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const worker = new TaskEngineWorker({
      engine: { accept: vi.fn(async () => ({})) } as never,
      store: {
        claimDueCommands: vi.fn(async (_id, _generation, limit) =>
          remaining.splice(0, limit),
        ),
        markPossiblyStarted: vi.fn(async () => undefined),
      } as never,
      adapter: {
        execute: vi.fn(async (entry: TaskCommand) => {
          started.push(entry.taskId);
          if (entry.taskId === "task_1") await slow;
          return { status: "succeeded", facts: [] } as const;
        }),
        reconcile: vi.fn(),
      },
    });

    const run = worker.runUntilIdle();
    for (
      let attempt = 0;
      attempt < 20 && !started.includes("task_5");
      attempt += 1
    )
      await new Promise((resolve) => setTimeout(resolve, 1));
    expect(started).toContain("task_5");
    releaseSlow();
    await run;
  });

  it("cancels only the active wait for the requested task lane", async () => {
    const entry = command(1);
    let claimed = false;
    const accept = vi.fn(async () => ({}));
    const onTaskWaitCancelled = vi.fn(async () => undefined);
    const execute = vi.fn(() => new Promise<never>(() => undefined));
    const worker = new TaskEngineWorker({
      engine: { accept } as never,
      store: {
        claimDueCommands: vi.fn(async () => {
          if (claimed) return [];
          claimed = true;
          return [entry];
        }),
        markPossiblyStarted: vi.fn(async () => undefined),
      } as never,
      adapter: {
        execute,
        reconcile: vi.fn(),
      },
      onTaskWaitCancelled,
    });

    const run = worker.runUntilIdle();
    for (
      let attempt = 0;
      attempt < 20 && execute.mock.calls.length === 0;
      attempt += 1
    )
      await new Promise((resolve) => setTimeout(resolve, 1));
    worker.cancelTask(entry.taskId);
    await run;
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "command_outcome_observed",
        commandId: entry.commandId,
        status: "unresolved",
      }),
    );
    expect(onTaskWaitCancelled).toHaveBeenCalledWith(entry);
  });

  it("does not arm cancellation for work that has not been claimed", async () => {
    const entry = command(1);
    let claimed = false;
    const execute = vi.fn(async (_entry: TaskCommand) => ({
      status: "succeeded" as const,
      facts: [],
    }));
    const worker = new TaskEngineWorker({
      engine: { accept: vi.fn(async () => ({})) } as never,
      store: {
        claimDueCommands: vi.fn(async () => {
          if (claimed) return [];
          claimed = true;
          return [entry];
        }),
        markPossiblyStarted: vi.fn(async () => undefined),
      } as never,
      adapter: { execute, reconcile: vi.fn() },
    });

    expect(worker.cancelTask(entry.taskId)).toBe(false);
    await worker.runUntilIdle();
    expect(execute).toHaveBeenCalledWith(entry);
  });

  it("honors cancellation while a claimed command is becoming durable", async () => {
    const entry = command(1);
    let claimed = false;
    let releasePrepared!: () => void;
    const prepared = new Promise<void>((resolve) => {
      releasePrepared = resolve;
    });
    const markPossiblyStarted = vi.fn(async () => prepared);
    const execute = vi.fn(async () => ({
      status: "succeeded" as const,
      facts: [],
    }));
    const accept = vi.fn(async () => ({}));
    const worker = new TaskEngineWorker({
      engine: { accept } as never,
      store: {
        claimDueCommands: vi.fn(async () => {
          if (claimed) return [];
          claimed = true;
          return [entry];
        }),
        markPossiblyStarted,
      } as never,
      adapter: { execute, reconcile: vi.fn() },
    });

    const run = worker.runUntilIdle();
    for (
      let attempt = 0;
      attempt < 20 && markPossiblyStarted.mock.calls.length === 0;
      attempt += 1
    )
      await new Promise((resolve) => setTimeout(resolve, 1));
    expect(worker.cancelTask(entry.taskId)).toBe(true);
    releasePrepared();
    await run;

    expect(execute).not.toHaveBeenCalled();
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: entry.commandId,
        status: "unresolved",
      }),
    );
  });

  it("does not carry cancellation from a completed command into its successor", async () => {
    const first = command(1);
    const successor = {
      ...command(2),
      commandId: "command_successor",
      taskId: first.taskId,
    };
    const remaining = [first];
    let releaseOutcomeCommit!: () => void;
    let outcomeCommitStarted!: () => void;
    const commitStarted = new Promise<void>((resolve) => {
      outcomeCommitStarted = resolve;
    });
    const commitRelease = new Promise<void>((resolve) => {
      releaseOutcomeCommit = resolve;
    });
    const accept = vi.fn(async () => {
      if (accept.mock.calls.length === 1) {
        outcomeCommitStarted();
        await commitRelease;
        remaining.push(successor);
      }
      return {};
    });
    const execute = vi.fn(async (_entry: TaskCommand) => ({
      status: "succeeded" as const,
      facts: [],
    }));
    const worker = new TaskEngineWorker({
      engine: { accept } as never,
      store: {
        claimDueCommands: vi.fn(async (_id, _generation, limit) =>
          remaining.splice(0, limit),
        ),
        markPossiblyStarted: vi.fn(async () => undefined),
      } as never,
      adapter: { execute, reconcile: vi.fn() },
    });

    const run = worker.runUntilIdle();
    await commitStarted;
    expect(worker.cancelTask(first.taskId)).toBe(false);
    releaseOutcomeCommit();
    await run;

    expect(execute.mock.calls.map(([entry]) => entry.commandId)).toEqual([
      first.commandId,
      successor.commandId,
    ]);
  });
});
