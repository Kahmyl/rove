import type { ConversationAssociation } from "./conversations.js";
import type { CodexThread } from "./protocol.js";
import {
  APPROVED_CODEX_CLI_VERSION,
  approvedCodexBaseline,
} from "./compatibility.js";

const APPROVED_HISTORY_MODE = approvedCodexBaseline("development").historyMode;

interface ExpectedEmptyLegacyThread {
  taskId: string;
  threadId: string;
  sessionId: string;
  threadSource: string;
}

function isPinnedRpcShape(
  details: Record<string, unknown>,
  message: string,
): boolean {
  const keys = Object.keys(details).sort();
  const dataPresent = Object.hasOwn(details, "data");
  // The approved App Server has emitted the same JSON-RPC error both without `data`
  // and with explicit `data: null`. Preserve that wire distinction, but treat
  // only those two exact shapes as semantically equivalent.
  return (
    details.code === -32600 &&
    details.message === message &&
    ((!dataPresent && keys.join(",") === "code,message") ||
      (dataPresent &&
        details.data === null &&
        keys.join(",") === "code,data,message"))
  );
}

export function isPinnedEmptyLegacyThreadFailure(
  error: unknown,
  thread: CodexThread,
  conversation: ConversationAssociation | undefined,
  expected: ExpectedEmptyLegacyThread,
): boolean {
  if (!(error instanceof Error)) return false;
  const rpc = (error as Error & { rpc?: unknown }).rpc;
  if (rpc === null || typeof rpc !== "object" || Array.isArray(rpc))
    return false;
  const details = rpc as Record<string, unknown>;
  if (
    !isPinnedRpcShape(
      details,
      `thread ${expected.threadId} is not materialized yet; includeTurns is unavailable before first user message`,
    )
  )
    return false;
  if (
    thread.cliVersion !== APPROVED_CODEX_CLI_VERSION ||
    thread.id !== expected.threadId ||
    thread.sessionId !== expected.sessionId ||
    thread.threadSource !== expected.threadSource ||
    thread.historyMode !== APPROVED_HISTORY_MODE ||
    !["idle", "notLoaded"].includes(thread.status.type) ||
    thread.turns.length !== 0
  )
    return false;
  return isEmptyDurableConversation(conversation, expected);
}

export function isPinnedThreadNotLoadedFailure(
  error: unknown,
  threadId: string,
): boolean {
  if (!(error instanceof Error)) return false;
  const rpc = (error as Error & { rpc?: unknown }).rpc;
  if (rpc === null || typeof rpc !== "object" || Array.isArray(rpc))
    return false;
  const details = rpc as Record<string, unknown>;
  return isPinnedRpcShape(details, `thread not loaded: ${threadId}`);
}

export function isPinnedThreadMissingFailure(
  error: unknown,
  threadId: string,
): boolean {
  if (!(error instanceof Error)) return false;
  const rpc = (error as Error & { rpc?: unknown }).rpc;
  if (rpc === null || typeof rpc !== "object" || Array.isArray(rpc))
    return false;
  const details = rpc as Record<string, unknown>;
  return isPinnedRpcShape(
    details,
    `no rollout found for thread id ${threadId}`,
  );
}

export function isPinnedEmptyTurnHistoryFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const rpc = (error as Error & { rpc?: unknown }).rpc;
  if (rpc === null || typeof rpc !== "object" || Array.isArray(rpc))
    return false;
  return isPinnedRpcShape(
    rpc as Record<string, unknown>,
    "list_turns is not supported yet",
  );
}

export function isEmptyDurableConversation(
  conversation: ConversationAssociation | undefined,
  expected: ExpectedEmptyLegacyThread,
): boolean {
  return (
    conversation !== undefined &&
    conversation.roveTaskId === expected.taskId &&
    conversation.codexThreadId === expected.threadId &&
    conversation.codexSessionId === expected.sessionId &&
    conversation.activeTurnId === undefined &&
    conversation.turnStatus === "unknown" &&
    conversation.archived === false &&
    conversation.turnOrder.length === 0 &&
    Object.keys(conversation.items).length === 0
  );
}
