import {
  NATIVE_LIFECYCLE_COMMAND_TYPES,
  TASK_COMMAND_MANIFEST,
  type NativeLifecycleCommandType,
  type TaskCommand,
} from "@rove/protocol";

import type {
  TaskCommandAdapter,
  TaskCommandResult,
} from "./task-engine-worker.js";

export interface ExactTaskCommandHandler {
  execute(command: TaskCommand): Promise<TaskCommandResult>;
  reconcile(command: TaskCommand): Promise<TaskCommandResult>;
}

export type ExactTaskCommandHandlers = Record<
  NativeLifecycleCommandType,
  ExactTaskCommandHandler
>;

/** Exhaustive adapter dispatch. Adding a reducer command breaks this record at
 * compile time and the runtime manifest assertion before any task can run. */
export class ExactTaskCommandAdapter implements TaskCommandAdapter {
  constructor(private readonly handlers: ExactTaskCommandHandlers) {
    for (const type of NATIVE_LIFECYCLE_COMMAND_TYPES) {
      if (!handlers[type])
        throw new Error(`Missing task command handler ${type}.`);
      if (
        TASK_COMMAND_MANIFEST[type].reconcile !== "not_required" &&
        !handlers[type].reconcile
      )
        throw new Error(`Missing task command reconciliation ${type}.`);
    }
  }

  execute(command: TaskCommand): Promise<TaskCommandResult> {
    return this.handlers[command.type].execute(command);
  }

  reconcile(command: TaskCommand): Promise<TaskCommandResult> {
    return this.handlers[command.type].reconcile(command);
  }
}
