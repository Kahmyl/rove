import { createHash } from "node:crypto";

import type { TaskCodexRecoveryClass } from "@rove/protocol";

import type { CodexServerEvent, JsonRpcId } from "./protocol.js";

export type CodexEventRecoveryClass =
  TaskCodexRecoveryClass | "expendable_presentation";

export interface CodexEventRecoveryDescriptor {
  recoveryClass: CodexEventRecoveryClass;
  family: string;
  threadId?: string;
  blockerId?: string;
  correlationId?: string;
}

const THREAD_HISTORY_METHODS = new Set<CodexServerEvent["method"]>([
  "turn/started",
  "turn/completed",
  "item/completed",
]);
const PROVIDER_METHODS = new Set<CodexServerEvent["method"]>([
  "thread/archived",
  "thread/unarchived",
]);

export function classifyCodexEventRecovery(
  event: CodexServerEvent,
  connectionGeneration: number,
): CodexEventRecoveryDescriptor {
  const threadId = eventThreadId(event);
  if (
    event.method === "serverRequest/resolved" ||
    event.requestId !== undefined
  ) {
    const wireIdentity =
      event.method === "serverRequest/resolved"
        ? jsonRpcId(event.params.requestId)
        : event.wireRequestId;
    const correlationId = wireIdentityString(
      connectionGeneration,
      wireIdentity ?? event.requestId,
    );
    return {
      recoveryClass: "live_attention",
      family: event.method,
      ...(threadId ? { threadId } : {}),
      ...(threadId && correlationId
        ? {
            correlationId,
            blockerId: semanticId("live-attention", threadId, correlationId),
          }
        : {}),
    };
  }
  if (PROVIDER_METHODS.has(event.method))
    return {
      recoveryClass: "provider_other_authority",
      family: "thread_archive_membership",
      ...(threadId
        ? {
            threadId,
            blockerId: semanticId("provider-archive", threadId),
          }
        : {}),
    };
  if (THREAD_HISTORY_METHODS.has(event.method))
    return {
      recoveryClass: "thread_history_reconstructible",
      family: event.method,
      ...(threadId
        ? { threadId, blockerId: threadHistoryBlockerId(threadId) }
        : {}),
    };
  return {
    recoveryClass: "expendable_presentation",
    family: event.method,
    ...(threadId ? { threadId } : {}),
  };
}

export function threadHistoryBlockerId(threadId: string): string {
  return semanticId("thread-history", threadId);
}

export function eventThreadId(event: CodexServerEvent): string | undefined {
  const nestedThread = object(event.params.thread);
  return (
    text(event.params.threadId) ??
    text(nestedThread?.id) ??
    text(event.params.conversationId)
  );
}

function semanticId(kind: string, ...parts: string[]): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([kind, ...parts]))
    .digest("hex")
    .slice(0, 24);
  return `codex-recovery:${kind}:${digest}`;
}

function wireIdentityString(
  generation: number,
  value: JsonRpcId | undefined,
): string | undefined {
  return value === undefined
    ? undefined
    : `${generation}:${typeof value}:${String(value)}`;
}

function jsonRpcId(value: unknown): JsonRpcId | undefined {
  return typeof value === "string" || typeof value === "number"
    ? value
    : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
