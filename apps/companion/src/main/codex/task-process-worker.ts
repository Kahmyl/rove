import { randomUUID } from "node:crypto";

import type {
  NativeLifecycleInput,
  TaskProcessCommand,
  TaskProcessDurableData,
  TaskProcessInput,
  TaskProcessProjection,
  TaskStore,
} from "@rove/protocol";
import { TaskProcessManager } from "@rove/protocol";

export interface TaskProcessAdapterResult {
  status: "succeeded" | "failed" | "unresolved";
  lifecycle: NativeLifecycleInput;
  detail?: Readonly<Record<string, unknown>>;
  durableData?: TaskProcessDurableData;
}

export interface TaskProcessAdapterContext {
  lifecycle: NativeLifecycleInput;
  launchConfiguration: Readonly<Record<string, unknown>> | null;
  durableData: TaskProcessDurableData;
}

export interface TaskProcessCommandAdapter {
  execute(
    command: TaskProcessCommand,
    context: TaskProcessAdapterContext,
  ): Promise<TaskProcessAdapterResult>;
  reconcile(
    command: TaskProcessCommand,
    context: TaskProcessAdapterContext,
  ): Promise<TaskProcessAdapterResult>;
}

export interface TaskProcessWorkerOptions {
  store: TaskStore;
  adapter: TaskProcessCommandAdapter;
  workerId?: string;
  generation?: number;
  now?: () => string;
}

/** The sole production dispatcher for lifecycle outbox commands. */
export class TaskProcessWorker {
  private readonly manager: TaskProcessManager;
  private readonly workerId: string;
  private readonly generation: number;
  private readonly now: () => string;
  private unresolvedInLastRun = false;

  constructor(private readonly options: TaskProcessWorkerOptions) {
    this.manager = new TaskProcessManager(options.store);
    this.workerId = options.workerId ?? `worker_${randomUUID()}`;
    this.generation = options.generation ?? Date.now();
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async runOnce(limit = 16): Promise<number> {
    this.unresolvedInLastRun = false;
    const commands = await this.options.store.claimDueCommands(
      this.workerId,
      this.generation,
      limit,
    );
    for (const command of commands)
      this.unresolvedInLastRun =
        (await this.consume(command)) || this.unresolvedInLastRun;
    return commands.length;
  }

  async runUntilIdle(maximumClaims = 64): Promise<void> {
    let claims = 0;
    while (claims < maximumClaims) {
      const consumed = await this.runOnce(1);
      if (consumed === 0) return;
      if (this.unresolvedInLastRun) return;
      claims += consumed;
    }
    throw new Error("Task process worker exceeded its convergence bound.");
  }

  async awaitProjection(
    taskId: string,
    predicate: (projection: TaskProcessProjection) => boolean,
    maximumClaims = 64,
  ): Promise<TaskProcessProjection> {
    for (let index = 0; index <= maximumClaims; index += 1) {
      const projection = await this.options.store.projection(taskId);
      if (projection && predicate(projection)) return projection;
      if ((await this.runOnce(1)) === 0) break;
      if (this.unresolvedInLastRun) break;
    }
    throw new Error(`Task ${taskId} did not reach the requested projection.`);
  }

  private async consume(command: TaskProcessCommand): Promise<boolean> {
    const state = await this.options.store.taskState(command.taskId);
    if (!state) throw new Error("Claimed task command lacks lifecycle state.");
    const lifecycle = state.lifecycle;
    await this.acceptFact(
      command,
      "accepted",
      lifecycle,
      undefined,
      state.durableData,
    );
    let result: TaskProcessAdapterResult;
    const adapterContext = {
      lifecycle,
      launchConfiguration: state.launchConfiguration,
      durableData: state.durableData,
    };
    if (command.claimedFrom === "reconcile_required") {
      try {
        result = await this.options.adapter.reconcile(command, adapterContext);
      } catch (error) {
        result = {
          status: "unresolved",
          lifecycle,
          detail: {
            error:
              error instanceof Error
                ? error.message.slice(0, 240)
                : String(error).slice(0, 240),
          },
        };
      }
    } else {
      await this.options.store.markCommand(
        command.commandId,
        "possibly_started",
      );
      try {
        result = await this.options.adapter.execute(command, adapterContext);
      } catch (error) {
        result = {
          status: "unresolved",
          lifecycle,
          detail: {
            error:
              error instanceof Error
                ? error.message.slice(0, 240)
                : String(error).slice(0, 240),
          },
        };
      }
    }
    await this.acceptFact(
      command,
      result.status,
      result.lifecycle,
      result.detail,
      result.durableData ?? adapterContext.durableData,
    );
    return result.status === "unresolved";
  }

  private acceptFact(
    command: TaskProcessCommand,
    status: NonNullable<TaskProcessInput["commandOutcome"]>["status"],
    lifecycle: NativeLifecycleInput,
    detail?: Readonly<Record<string, unknown>>,
    durableData?: TaskProcessDurableData,
  ) {
    const suffix = `${status}:${command.attempts}`;
    return this.manager.accept({
      schemaVersion: 1,
      inputId: `command-fact:${command.commandId}:${suffix}`,
      taskId: command.taskId,
      kind: "fact",
      source: "task-process-worker",
      sourceId: `${command.commandId}:${suffix}`,
      observedAt: this.now(),
      lifecycle,
      commandOutcome: {
        commandId: command.commandId,
        status,
        ...(detail === undefined ? {} : { detail }),
      },
      ...(durableData === undefined ? {} : { durableData }),
    });
  }
}
