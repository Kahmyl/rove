import { createHash, randomUUID } from "node:crypto";

import type {
  TaskAggregate,
  TaskCodexReconciliationDiagnostic,
  TaskEvent,
} from "@rove/protocol";

import type { CodexThreadSessionSupervisor } from "./codex-thread-session-supervisor.js";
import type { OrderedTaskIngress } from "./ordered-task-ingress.js";
import type { SqliteTaskEngineStore } from "./sqlite-task-engine-store.js";
import type { TaskRuntimePort } from "./task-coordinator.js";
import {
  composeCompletedRequestHumanHandoff,
  projectedItem,
} from "./codex-task-observations.js";

export type CodexReconciliationTrigger =
  TaskCodexReconciliationDiagnostic["trigger"];

export interface CodexReconciliationFailureHint {
  eventFamily?: string;
  errorCategory?: string;
}

/** Reads one exact bound App Server thread and re-enters reconstructible facts
 * through the existing ordered TaskEngine ingress. It never dispatches work. */
export class CodexThreadTruthReconciler {
  constructor(
    private readonly session: CodexThreadSessionSupervisor,
    private readonly store: SqliteTaskEngineStore,
    private readonly ingress: OrderedTaskIngress,
    private readonly runtime: TaskRuntimePort,
    private readonly generation: () => number,
  ) {}

  async reconcile(
    taskId: string,
    trigger: CodexReconciliationTrigger,
    attempt: number,
    hint: CodexReconciliationFailureHint = {},
  ): Promise<void> {
    const aggregate = await this.boundAggregate(taskId);
    const threadId = aggregate.record!.identity.threadId!;
    await this.diagnostic(
      taskId,
      threadId,
      trigger,
      "scheduled",
      attempt,
      hint,
    );
    const thread = await this.session.read(threadId, true);
    this.assertExactBinding(aggregate, thread);
    if (thread.turns.some((turn) => turn.itemsView !== "full"))
      throw new Error("Codex history did not return full turn items.");

    for (const turn of thread.turns) {
      const turnTime = instant(turn.startedAt ?? thread.createdAt);
      await this.accept({
        schemaVersion: 1,
        type: "codex_turn_observed",
        eventId: `codex-history:${threadId}:turn:${turn.id}:started`,
        taskId,
        source: {
          kind: "codex",
          id: `history:${threadId}:turn:${turn.id}`,
          generation: 1,
          position: 1,
        },
        observedAt: turnTime,
        threadId,
        turn: { turn: "active", turnId: turn.id, runtimeStatus: "active" },
      });
      for (const rawItem of turn.items) {
        const value = rawItem as unknown as Record<string, unknown>;
        const terminalItem = historyItemTerminal(value, turn.status);
        // Mutable progress snapshots are notification state, not durable
        // historical truth. A later full read can safely reconstruct the
        // terminal fact without first inventing a replayable "started" item.
        if (!terminalItem) continue;
        const item = projectedItem(value, turn.id, rawItem.id, terminalItem);
        const completedHandoff = await historicalCompletedHandoff(
          {
            taskId,
            threadId,
            turnId: turn.id,
            item: value,
            boundRuntimeSessionId: aggregate.record?.identity.sessionId,
            getControlStatus: this.runtime.getControlStatus,
          },
          composeCompletedRequestHumanHandoff,
        );
        await this.accept({
          schemaVersion: 1,
          type: "codex_item_observed",
          eventId: `codex-history:${threadId}:turn:${turn.id}:item:${rawItem.id}:completed`,
          taskId,
          source: {
            kind: "codex",
            id: `history:${threadId}:turn:${turn.id}:item:${rawItem.id}`,
            generation: 1,
            position: 2,
          },
          observedAt: turnTime,
          threadId,
          turnId: turn.id,
          itemId: rawItem.id,
          terminal: true,
          ...(item ? { item } : {}),
        });
        if (completedHandoff) {
          const handoffDigest = digest(completedHandoff);
          await this.accept({
            schemaVersion: 1,
            type: "codex_item_observed",
            eventId: `codex-history:${threadId}:turn:${turn.id}:handoff:${completedHandoff.handoffGeneration}:${handoffDigest}`,
            taskId,
            source: {
              kind: "codex",
              id: `history:${threadId}:handoff:${completedHandoff.handoffId}:${handoffDigest}`,
              generation: 1,
              position: 1,
            },
            observedAt: turnTime,
            threadId,
            turnId: turn.id,
            itemId: rawItem.id,
            terminal: true,
            completedHandoff,
          });
        }
        if (completedHandoff && this.runtime.acknowledgeDurableHandoff)
          await this.runtime.acknowledgeDurableHandoff(
            completedHandoff.sessionId,
            {
              handoffId: completedHandoff.handoffId,
              handoffGeneration: completedHandoff.handoffGeneration,
            },
          );
      }
      const terminal =
        turn.status === "inProgress"
          ? undefined
          : turn.status === "failed"
            ? "failed"
            : turn.status === "interrupted"
              ? "interrupted"
              : "completed";
      if (terminal)
        await this.accept({
          schemaVersion: 1,
          type: "codex_turn_observed",
          eventId: `codex-history:${threadId}:turn:${turn.id}:terminal:${terminal}`,
          taskId,
          source: {
            kind: "codex",
            id: `history:${threadId}:turn:${turn.id}`,
            generation: 1,
            position: 2,
          },
          observedAt: instant(turn.completedAt ?? thread.updatedAt),
          threadId,
          turn: { turn: terminal, turnId: turn.id, runtimeStatus: "idle" },
        });
    }

    const repaired = await this.store.aggregate(taskId);
    if (
      repaired?.runtime.status === "awaiting_human" &&
      repaired.runtime.handoffId &&
      (repaired.continuation.status !== "pending" ||
        repaired.continuation.handoffId !== repaired.runtime.handoffId)
    )
      throw new Error(
        "Exact Runtime handoff lacks reconstructible completed Codex continuation evidence.",
      );
    await this.diagnostic(
      taskId,
      threadId,
      trigger,
      "succeeded",
      attempt,
      hint,
    );
  }

  async unresolved(
    taskId: string,
    trigger: CodexReconciliationTrigger,
    attempt: number,
    hint: CodexReconciliationFailureHint,
  ): Promise<void> {
    const aggregate = await this.boundAggregate(taskId);
    await this.diagnostic(
      taskId,
      aggregate.record!.identity.threadId!,
      trigger,
      "unresolved",
      attempt,
      hint,
    );
  }

  private async boundAggregate(taskId: string): Promise<TaskAggregate> {
    const aggregate = await this.store.aggregate(taskId);
    if (
      !aggregate?.record?.identity.threadId ||
      aggregate.desiredState !== "open"
    )
      throw new Error("Codex reconciliation requires an open bound task.");
    return aggregate;
  }

  private assertExactBinding(
    aggregate: TaskAggregate,
    thread: Awaited<ReturnType<CodexThreadSessionSupervisor["read"]>>,
  ): void {
    if (
      thread.id !== aggregate.record?.identity.threadId ||
      (thread.threadSource !== null &&
        thread.threadSource !== aggregate.record?.bootstrap.threadSource) ||
      (aggregate.codexSessionId !== null &&
        thread.sessionId !== aggregate.codexSessionId)
    )
      throw new Error("Codex history changed the exact Task/thread binding.");
  }

  private accept(event: TaskEvent): Promise<void> {
    return this.ingress.enqueue(this.generation(), event);
  }

  private diagnostic(
    taskId: string,
    threadId: string,
    trigger: CodexReconciliationTrigger,
    outcome: TaskCodexReconciliationDiagnostic["outcome"],
    attempt: number,
    hint: CodexReconciliationFailureHint,
  ): Promise<void> {
    const observedAt = new Date().toISOString();
    const diagnosticId = randomUUID();
    const event: TaskEvent = {
      schemaVersion: 1,
      type: "codex_reconciliation_observed",
      eventId: `codex-reconcile:${taskId}:${trigger}:${attempt}:${outcome}:${diagnosticId}`,
      taskId,
      source: {
        kind: "host",
        id: `codex-reconciler:${threadId}:${diagnosticId}`,
        generation: this.generation(),
        position: 1,
      },
      observedAt,
      diagnostic: { trigger, outcome, threadId, attempt, observedAt, ...hint },
    };
    return this.accept(event);
  }
}

function instant(value: number): string {
  return new Date(value < 10_000_000_000 ? value * 1_000 : value).toISOString();
}

function historyItemTerminal(
  item: Record<string, unknown>,
  turnStatus: "completed" | "interrupted" | "failed" | "inProgress",
): boolean {
  if (turnStatus !== "inProgress") return true;
  if (item.type === "userMessage") return true;
  const status =
    typeof item.status === "string" ? item.status.toLowerCase() : "";
  return [
    "completed",
    "failed",
    "declined",
    "cancelled",
    "canceled",
    "interrupted",
  ].includes(status);
}

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

async function historicalCompletedHandoff(
  input: Parameters<typeof composeCompletedRequestHumanHandoff>[0],
  compose: typeof composeCompletedRequestHumanHandoff,
): ReturnType<typeof composeCompletedRequestHumanHandoff> {
  try {
    return await compose(input);
  } catch (error) {
    // A full thread contains prior handoffs that Runtime can no longer
    // corroborate after newer generations. They are not current repair facts.
    // An absent match for an active contradiction is still rejected by the
    // post-read aggregate check above.
    if (
      error instanceof Error &&
      error.message ===
        "Completed handoff is not corroborated by authoritative Runtime control truth."
    )
      return undefined;
    throw error;
  }
}
