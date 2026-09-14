import type { RuntimeSessionInventory } from "@rove/protocol";

export interface TaskRuntimeAuthorityAggregate {
  taskId: string;
  launch: { bootstrapId: string } | null;
  desiredState: "open" | "closed";
  record: {
    bootstrap: { stage: string };
    identity: { sessionId?: string };
  } | null;
  runtime: { sessionId?: string };
  continuation: {
    status: string;
    taskId?: string;
    sessionId?: string;
    handoffId?: string;
    generation?: number;
  };
}

export interface ExactTaskRuntimeControlAuthority {
  sessionId: string;
  ownershipGeneration: number;
  handoffId?: string;
  handoffGeneration?: number;
}

export function resolveTaskRuntimeControlAuthority(
  taskId: string,
  aggregate: TaskRuntimeAuthorityAggregate | null,
  inventory: readonly RuntimeSessionInventory[],
  expectedHandoffGeneration?: number,
): ExactTaskRuntimeControlAuthority {
  const sessionId = aggregate?.record?.identity.sessionId;
  if (
    aggregate?.taskId !== taskId ||
    !aggregate.launch ||
    aggregate.record?.bootstrap.stage !== "complete" ||
    aggregate.desiredState !== "open" ||
    !sessionId ||
    aggregate.runtime.sessionId !== sessionId
  )
    throw new Error("Task has no exact live Runtime authority.");
  const matches = inventory.filter((entry) => entry.session.id === sessionId);
  if (matches.length !== 1)
    throw new Error("Task Runtime authority is missing or conflicting.");
  const session = matches[0]!.session;
  if (
    session.bootstrapId !== aggregate.launch.bootstrapId ||
    ["completed", "failed"].includes(session.status) ||
    session.ownershipGeneration === undefined
  )
    throw new Error("Task Runtime authority is stale or mismatched.");
  if (expectedHandoffGeneration !== undefined) {
    if (
      aggregate.continuation.status !== "pending" ||
      aggregate.continuation.taskId !== taskId ||
      aggregate.continuation.sessionId !== sessionId ||
      aggregate.continuation.generation !== expectedHandoffGeneration ||
      aggregate.continuation.handoffId !== session.activeHandoffId ||
      expectedHandoffGeneration !== session.activeHandoffGeneration
    )
      throw new Error("Task control handoff is stale or mismatched.");
  }
  return {
    sessionId,
    ownershipGeneration: session.ownershipGeneration,
    ...(session.activeHandoffId === undefined
      ? {}
      : { handoffId: session.activeHandoffId }),
    ...(session.activeHandoffGeneration === undefined
      ? {}
      : { handoffGeneration: session.activeHandoffGeneration }),
  };
}
