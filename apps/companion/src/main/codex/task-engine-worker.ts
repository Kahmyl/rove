import { randomUUID } from "node:crypto";

import type {
  TaskEngine,
  TaskCommand,
  TaskEngineStore,
  TaskObservedFact,
  TaskPortableValue,
} from "@rove/protocol";

export interface TaskCommandResult {
  status: "succeeded" | "failed" | "unresolved";
  facts: readonly TaskObservedFact[];
  detail?: Readonly<Record<string, TaskPortableValue>>;
}

export interface TaskCommandAdapter {
  execute(command: TaskCommand): Promise<TaskCommandResult>;
  reconcile(command: TaskCommand): Promise<TaskCommandResult>;
}

export interface TaskEngineWorkerOptions {
  engine: TaskEngine;
  store: TaskEngineStore;
  adapter: TaskCommandAdapter;
  workerId?: string;
  generation?: number;
  now?: () => string;
  onCut?: (
    point:
      | "after_claim_before_dispatch"
      | "after_external_acceptance_before_outcome"
      | "after_terminal_change_before_observation"
      | "after_outcome_commit_before_notification",
    command: TaskCommand,
  ) => Promise<void> | void;
  maximumConcurrentTasks?: number;
  onBackgroundError?: (error: Error) => Promise<void> | void;
  onTaskWaitCancelled?: (command: TaskCommand) => Promise<void> | void;
}

/** Claims and performs one durable command at a time. Every result re-enters
 * through TaskEngine as a typed fact; the adapter cannot select more work. */
export class TaskEngineWorker {
  private readonly engine: TaskEngine;
  private readonly workerId: string;
  private readonly generation: number;
  private readonly now: () => string;
  private activeRun: Promise<void> | undefined;
  private rerunRequested = false;
  private readonly maximumConcurrentTasks: number;
  private readonly activeTaskCancellations = new Map<
    string,
    { cancel: () => void; command: TaskCommand }
  >();
  private readonly claimedTaskCommands = new Map<
    string,
    {
      command: TaskCommand;
      phase: "claimed" | "preparing" | "active" | "committing";
    }
  >();
  private readonly pendingCommandCancellations = new Set<string>();

  constructor(private readonly options: TaskEngineWorkerOptions) {
    this.engine = options.engine;
    this.workerId =
      options.workerId ?? `task_worker_${randomUUID().replaceAll("-", "")}`;
    this.generation = options.generation ?? Math.max(1, Date.now());
    this.now = options.now ?? (() => new Date().toISOString());
    this.maximumConcurrentTasks = options.maximumConcurrentTasks ?? 4;
    if (
      !Number.isSafeInteger(this.maximumConcurrentTasks) ||
      this.maximumConcurrentTasks < 1 ||
      this.maximumConcurrentTasks > 4
    )
      throw new Error("Task worker concurrency must be between one and four.");
  }

  async runOnce(): Promise<boolean> {
    const [command] = await this.options.store.claimDueCommands(
      this.workerId,
      this.generation,
      1,
    );
    if (!command) return false;
    return this.performClaimed(command);
  }

  private async performClaimed(command: TaskCommand): Promise<boolean> {
    const claimed: {
      command: TaskCommand;
      phase: "claimed" | "preparing" | "active" | "committing";
    } = { command, phase: "claimed" };
    this.claimedTaskCommands.set(command.taskId, claimed);
    try {
      return await this.perform(command);
    } finally {
      this.pendingCommandCancellations.delete(command.commandId);
      if (this.claimedTaskCommands.get(command.taskId) === claimed)
        this.claimedTaskCommands.delete(command.taskId);
    }
  }

  private async perform(command: TaskCommand): Promise<boolean> {
    await this.options.onCut?.("after_claim_before_dispatch", command);
    let result: TaskCommandResult;
    if (command.classification.execute === "pure_ledger") {
      result = { status: "succeeded", facts: [] };
    } else {
      const cancelledBeforeDispatch = this.pendingCommandCancellations.delete(
        command.commandId,
      );
      if (cancelledBeforeDispatch) {
        result = {
          status: "unresolved",
          facts: [],
          detail: {
            error:
              "Queued task wait was cancelled by a durable lifecycle intent.",
          },
        };
      } else {
        const reconcile = command.claimedFrom === "reconcile_required";
        const claimed = this.claimedTaskCommands.get(command.taskId);
        if (claimed?.command === command) claimed.phase = "preparing";
        if (!reconcile)
          await this.options.store.markPossiblyStarted(command.commandId);
        if (this.pendingCommandCancellations.delete(command.commandId)) {
          result = {
            status: "unresolved",
            facts: [],
            detail: {
              error:
                "Prepared task wait was cancelled by a durable lifecycle intent.",
            },
          };
        } else {
          let cancel!: () => void;
          const cancelled = new Promise<"cancelled">((resolve) => {
            cancel = () => resolve("cancelled");
          });
          const cancellation = { cancel, command };
          if (claimed?.command === command) claimed.phase = "active";
          this.activeTaskCancellations.set(command.taskId, cancellation);
          const operation = (async (): Promise<TaskCommandResult> => {
            try {
              const completed = reconcile
                ? await this.options.adapter.reconcile(command)
                : await this.options.adapter.execute(command);
              await this.options.onCut?.(
                "after_external_acceptance_before_outcome",
                command,
              );
              await this.options.onCut?.(
                "after_terminal_change_before_observation",
                command,
              );
              return completed;
            } catch (error) {
              return {
                status: "unresolved",
                facts: [],
                detail: {
                  error: (error instanceof Error
                    ? error.message
                    : String(error)
                  ).slice(0, 240),
                },
              };
            }
          })();
          const completed = await Promise.race([operation, cancelled]);
          if (claimed?.command === command) claimed.phase = "committing";
          if (this.activeTaskCancellations.get(command.taskId) === cancellation)
            this.activeTaskCancellations.delete(command.taskId);
          result =
            completed === "cancelled"
              ? {
                  status: "unresolved",
                  facts: [],
                  detail: {
                    error:
                      "Active task wait was cancelled by a durable lifecycle intent.",
                  },
                }
              : completed;
          if (completed === "cancelled") {
            this.pendingCommandCancellations.delete(command.commandId);
            // The adapter promise is deliberately retained with its own catch path;
            // any late outcome has no route back into the task ledger.
            void operation;
          }
        }
      }
    }
    await this.engine.accept({
      schemaVersion: 1,
      type: "command_outcome_observed",
      eventId: `outcome:${command.commandId}:${command.attempts}`,
      taskId: command.taskId,
      source: {
        kind: "worker",
        id: `command:${command.commandId}:attempt:${command.attempts}`,
        generation: 1,
        position: 1,
      },
      observedAt: this.now(),
      commandId: command.commandId,
      status: result.status,
      facts: result.facts,
      ...(result.detail ? { detail: result.detail } : {}),
    });
    await this.options.onCut?.(
      "after_outcome_commit_before_notification",
      command,
    );
    return result.status !== "unresolved";
  }

  async runUntilIdle(maximumCommands = 128): Promise<void> {
    if (this.activeRun) {
      this.rerunRequested = true;
      return this.activeRun;
    }
    const run = async () => {
      try {
        do {
          this.rerunRequested = false;
          let count = 0;
          const unresolvedTasks = new Set<string>();
          const activeTasks = new Map<
            string,
            Promise<{ taskId: string; progressed: boolean }>
          >();
          let queueWasEmpty = false;
          while (count < maximumCommands || activeTasks.size > 0) {
            const capacity = this.maximumConcurrentTasks - activeTasks.size;
            if (capacity > 0 && count < maximumCommands && !queueWasEmpty) {
              const commands = await this.options.store.claimDueCommands(
                this.workerId,
                this.generation,
                Math.min(capacity, maximumCommands - count),
                {
                  excludeTaskIds: [...unresolvedTasks, ...activeTasks.keys()],
                },
              );
              queueWasEmpty = commands.length === 0;
              if (
                new Set(commands.map((command) => command.taskId)).size !==
                commands.length
              )
                throw new Error(
                  "Task worker claimed concurrent commands for one task.",
                );
              count += commands.length;
              for (const command of commands)
                activeTasks.set(
                  command.taskId,
                  this.performClaimed(command).then((progressed) => ({
                    taskId: command.taskId,
                    progressed,
                  })),
                );
            }
            if (activeTasks.size === 0) break;
            const completed = await Promise.race(activeTasks.values());
            activeTasks.delete(completed.taskId);
            if (!completed.progressed) unresolvedTasks.add(completed.taskId);
            queueWasEmpty = false;
          }
          if (count >= maximumCommands)
            throw new Error(
              "Task worker exceeded its finite convergence bound.",
            );
        } while (this.rerunRequested);
      } finally {
        // A signal can arrive after the loop's final rerun check but before
        // ownership is cleared. Preserve that late wakeup by starting a fresh
        // drain after this promise releases ownership.
        const restartAfterRelease = this.rerunRequested;
        this.activeRun = undefined;
        if (restartAfterRelease) {
          this.rerunRequested = false;
          queueMicrotask(() => this.signal());
        }
      }
    };
    this.activeRun = run();
    return this.activeRun;
  }

  signal(): void {
    void this.runUntilIdle().catch(async (error) => {
      await this.options.onBackgroundError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    });
  }

  cancelTask(taskId: string): boolean {
    const active = this.activeTaskCancellations.get(taskId);
    if (active) {
      active.cancel();
      void Promise.resolve(
        this.options.onTaskWaitCancelled?.(active.command),
      ).catch(async (error) => {
        await this.options.onBackgroundError?.(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
      return true;
    }
    const claimed = this.claimedTaskCommands.get(taskId);
    if (
      claimed &&
      claimed.phase !== "committing" &&
      claimed.command.classification.execute !== "pure_ledger"
    ) {
      this.pendingCommandCancellations.add(claimed.command.commandId);
      return true;
    }
    return false;
  }
}
