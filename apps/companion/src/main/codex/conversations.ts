import { createHash } from "node:crypto";
import { basename } from "node:path";

import type {
  CodexRpcPort,
  CodexServerEvent,
  CodexThread,
  ThreadResumeParams,
  ThreadStartParams,
  TurnStartParams,
  TurnSteerParams,
} from "./protocol.js";
import { objectValue, stringValue } from "./protocol.js";
import type { StateRepository } from "./persistence.js";
import {
  boundedIdentity,
  boundedOpaqueIdentity,
  exactKeys,
  requiredString,
  sha256Digest,
  strictRecord,
} from "./state-validation.js";

export type CodexTurnStatus =
  "unknown" | "in_progress" | "completed" | "interrupted" | "failed";
export interface ProjectedInputAttachment {
  filename: string;
  kind: "file" | "image" | "audio";
}
export interface ProjectedConversationItem {
  id: string;
  turnId?: string;
  kind:
    | "user_message"
    | "assistant_message"
    | "plan"
    | "command"
    | "file_change"
    | "tool"
    | "other";
  status: "started" | "completed";
  activityOutcome?:
    | "started"
    | "dispatched"
    | "checking"
    | "confirmed"
    | "failed"
    | "unresolved";
  phase?: "commentary" | "final_answer";
  startedAt?: string;
  completedAt?: string;
  authoredBy?: "user" | "assistant" | "host";
  clientId?: string;
  acceptedAt?: string;
  providerItemId?: string;
  deliveryState?: "pending" | "materialized" | "not_sent" | "uncertain";
  attachments?: readonly ProjectedInputAttachment[];
  text?: string;
  title?: string;
  progress?: string;
}
export interface ConversationAssociation {
  roveTaskId: string;
  codexThreadId: string;
  codexSessionId: string;
  roveSessionId?: string;
  activeTurnId?: string;
  turnStatus: CodexTurnStatus;
  explicitSummary?: string;
  archived: boolean;
  lastEventSequence: number;
  items: Record<string, ProjectedConversationItem>;
  itemOrder?: string[];
  turnOrder: string[];
}
export interface NormalizedConversationEvent {
  eventId: string;
  payloadFingerprint: string;
  sequence: number;
  threadId: string;
  turnId?: string;
  itemId?: string;
  type:
    | "thread_started"
    | "thread_archived"
    | "thread_unarchived"
    | "turn_started"
    | "turn_terminal"
    | "item_started"
    | "item_completed"
    | "item_delta"
    | "summary";
  status?: CodexTurnStatus;
  item?: ProjectedConversationItem;
  delta?: string;
  summary?: string;
}
export interface ConversationReducerState {
  associations: Record<string, ConversationAssociation>;
  eventFingerprints: Record<string, string>;
  eventFingerprintVersions?: Record<string, 2>;
  pendingByThread?: Record<string, NormalizedConversationEvent[]>;
}
const TERMINAL = new Set<CodexTurnStatus>([
  "completed",
  "interrupted",
  "failed",
]);
const MAX_ITEMS = 256;
const MAX_TURNS = 64;
const MAX_FINGERPRINTS = 2048;
const MAX_PENDING = 128;

export function projectUserInputAttachments(
  content: unknown,
): ProjectedInputAttachment[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const input = entry as {
      type?: unknown;
      name?: unknown;
      path?: unknown;
    };
    const kind =
      input.type === "localImage"
        ? ("image" as const)
        : input.type === "localAudio"
          ? ("audio" as const)
          : input.type === "mention"
            ? ("file" as const)
            : undefined;
    if (!kind) return [];
    const filename =
      typeof input.name === "string" && input.name.trim()
        ? input.name.trim()
        : typeof input.path === "string"
          ? basename(input.path)
          : "";
    return filename ? [{ filename: filename.slice(0, 255), kind }] : [];
  });
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}
function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function semanticId(
  method: string,
  threadId: string,
  turnId?: string,
  itemId?: string,
  suffix?: string,
): string {
  return ["codex", threadId, turnId, itemId, method, suffix]
    .filter((value) => value !== undefined)
    .join(":");
}
function ids(event: CodexServerEvent): {
  threadId?: string;
  turnId?: string;
  itemId?: string;
} {
  const thread =
    typeof event.params.thread === "object" && event.params.thread !== null
      ? (event.params.thread as Record<string, unknown>)
      : {};
  const turn =
    typeof event.params.turn === "object" && event.params.turn !== null
      ? (event.params.turn as Record<string, unknown>)
      : {};
  const item =
    typeof event.params.item === "object" && event.params.item !== null
      ? (event.params.item as Record<string, unknown>)
      : {};
  const threadId =
    typeof event.params.threadId === "string"
      ? event.params.threadId
      : typeof thread.id === "string"
        ? thread.id
        : undefined;
  const turnId =
    typeof event.params.turnId === "string"
      ? event.params.turnId
      : typeof turn.id === "string"
        ? turn.id
        : undefined;
  const itemId =
    typeof event.params.itemId === "string"
      ? event.params.itemId
      : typeof item.id === "string"
        ? item.id
        : undefined;
  return {
    ...(threadId === undefined ? {} : { threadId }),
    ...(turnId === undefined ? {} : { turnId }),
    ...(itemId === undefined ? {} : { itemId }),
  };
}
function projectItem(
  raw: unknown,
  turnId: string,
  status: ProjectedConversationItem["status"],
): ProjectedConversationItem {
  const item = objectValue(raw, "thread item");
  const id = stringValue(item.id, "item.id");
  const type = item.type;
  const mechanismStatus =
    typeof item.status === "string" ? item.status : undefined;
  const activityOutcome: ProjectedConversationItem["activityOutcome"] = ![
    "commandExecution",
    "fileChange",
    "mcpToolCall",
    "dynamicToolCall",
  ].includes(String(type))
    ? undefined
    : mechanismStatus === "failed" ||
        mechanismStatus === "declined" ||
        item.success === false ||
        (item.error !== null && item.error !== undefined)
      ? "failed"
      : mechanismStatus === "unresolved"
        ? "unresolved"
        : status === "started" || mechanismStatus === "inProgress"
          ? "started"
          : "confirmed";
  if (type === "reasoning") {
    const summaries = Array.isArray(item.summary)
      ? item.summary.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    return {
      id,
      turnId,
      kind: "other",
      status,
      ...(summaries.length === 0 ? {} : { text: summaries.join("\n") }),
    };
  }
  if (type === "userMessage") {
    const content = Array.isArray(item.content) ? item.content : [];
    const text = content
      .flatMap((entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { type?: unknown }).type === "text" &&
        typeof (entry as { text?: unknown }).text === "string"
          ? [(entry as { text: string }).text]
          : [],
      )
      .join("\n");
    const attachments = projectUserInputAttachments(content);
    const host =
      item.clientId !== null &&
      typeof item.clientId === "string" &&
      item.clientId.startsWith("continue_");
    return {
      id,
      turnId,
      kind: "user_message",
      status,
      authoredBy: host ? "host" : "user",
      ...(typeof item.clientId === "string" ? { clientId: item.clientId } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(text ? { text } : {}),
    };
  }
  if (type === "agentMessage")
    return {
      id,
      turnId,
      kind: "assistant_message",
      status,
      authoredBy: "assistant",
      ...(item.phase === "commentary" || item.phase === "final_answer"
        ? { phase: item.phase }
        : {}),
      ...(typeof item.text === "string" ? { text: item.text } : {}),
    };
  if (type === "plan")
    return {
      id,
      turnId,
      kind: "plan",
      status,
      ...(typeof item.text === "string" ? { text: item.text } : {}),
    };
  if (type === "commandExecution")
    return {
      id,
      turnId,
      kind: "command",
      status,
      ...(activityOutcome ? { activityOutcome } : {}),
      ...(typeof item.command === "string" ? { title: item.command } : {}),
      ...(typeof item.aggregatedOutput === "string"
        ? { progress: item.aggregatedOutput.slice(-4000) }
        : {}),
    };
  if (type === "fileChange")
    return {
      id,
      turnId,
      kind: "file_change",
      status,
      ...(activityOutcome ? { activityOutcome } : {}),
      title: "File changes",
    };
  if (type === "mcpToolCall" || type === "dynamicToolCall")
    return {
      id,
      turnId,
      kind: "tool",
      status,
      ...(activityOutcome ? { activityOutcome } : {}),
      title: `${typeof item.server === "string" ? `${item.server}/` : ""}${String(item.tool ?? "tool")}`,
    };
  return { id, turnId, kind: "other", status };
}

export function normalizeConversationServerEvent(
  event: CodexServerEvent,
  sequence: number,
): NormalizedConversationEvent | undefined {
  const identity = ids(event);
  if (!identity.threadId) return undefined;
  let partial:
    | Omit<
        NormalizedConversationEvent,
        "eventId" | "payloadFingerprint" | "sequence" | "threadId"
      >
    | undefined;
  if (event.method === "thread/started") partial = { type: "thread_started" };
  else if (event.method === "thread/archived")
    partial = { type: "thread_archived" };
  else if (event.method === "thread/unarchived")
    partial = { type: "thread_unarchived" };
  else if (event.method === "turn/started" && identity.turnId)
    partial = { type: "turn_started", turnId: identity.turnId };
  else if (event.method === "turn/completed" && identity.turnId) {
    const turn = objectValue(event.params.turn, "turn");
    const raw = turn.status;
    partial = {
      type: "turn_terminal",
      turnId: identity.turnId,
      status: raw === "failed" || raw === "interrupted" ? raw : "completed",
    };
  } else if (
    (event.method === "item/started" || event.method === "item/completed") &&
    identity.turnId &&
    identity.itemId
  ) {
    const status = event.method === "item/started" ? "started" : "completed";
    partial = {
      type: status === "started" ? "item_started" : "item_completed",
      turnId: identity.turnId,
      itemId: identity.itemId,
      item: projectItem(event.params.item, identity.turnId, status),
    };
  } else if (
    [
      "item/agentMessage/delta",
      "item/plan/delta",
      "item/commandExecution/outputDelta",
      "item/fileChange/outputDelta",
      "item/mcpToolCall/progress",
    ].includes(event.method) &&
    identity.turnId &&
    identity.itemId
  ) {
    const delta =
      typeof event.params.delta === "string"
        ? event.params.delta
        : typeof event.params.message === "string"
          ? event.params.message
          : undefined;
    if (delta)
      partial = {
        type: "item_delta",
        turnId: identity.turnId,
        itemId: identity.itemId,
        delta,
      };
  } else if (
    event.method === "turn/plan/updated" &&
    identity.turnId &&
    typeof event.params.explanation === "string"
  )
    partial = {
      type: "summary",
      turnId: identity.turnId,
      summary: event.params.explanation,
    };
  if (!partial) return undefined;
  const phase =
    partial.type === "item_delta"
      ? fingerprint({
          threadId: identity.threadId,
          turnId: identity.turnId,
          itemId: identity.itemId,
          delta: partial.delta,
        })
      : undefined;
  return {
    ...partial,
    eventId: semanticId(
      event.method,
      identity.threadId,
      identity.turnId,
      identity.itemId,
      phase,
    ),
    payloadFingerprint: fingerprint({
      type: partial.type,
      threadId: identity.threadId,
      turnId: identity.turnId,
      itemId: identity.itemId,
      status: partial.status,
      item: partial.item,
      delta: partial.delta,
      summary: partial.summary,
    }),
    sequence,
    threadId: identity.threadId,
  };
}

export function reduceConversationEvent(
  state: ConversationReducerState,
  event: NormalizedConversationEvent,
): ConversationReducerState {
  const previous = state.eventFingerprints[event.eventId];
  if (previous !== undefined) {
    if (previous !== event.payloadFingerprint)
      throw new Error(`Conflicting Codex event identity: ${event.eventId}.`);
    return state;
  }
  const current = state.associations[event.threadId];
  if (!current)
    throw new Error(`Codex event references unbound thread ${event.threadId}.`);
  const next: ConversationAssociation = structuredClone(current);
  if (event.type === "thread_archived") next.archived = true;
  else if (event.type === "thread_unarchived") next.archived = false;
  else if (event.type === "turn_started") {
    if (!event.turnId) throw new Error("turn_started requires turnId.");
    if (!(
      TERMINAL.has(next.turnStatus) && next.turnOrder.at(-1) === event.turnId
    )) {
      next.activeTurnId = event.turnId;
      next.turnStatus = "in_progress";
    }
    if (!next.turnOrder.includes(event.turnId))
      next.turnOrder.push(event.turnId);
  } else if (event.type === "turn_terminal") {
    if (!event.turnId || !event.status || !TERMINAL.has(event.status))
      throw new Error("turn_terminal requires terminal identity and status.");
    if (!next.activeTurnId || next.activeTurnId === event.turnId) {
      next.turnStatus = event.status;
      delete next.activeTurnId;
    }
    if (!next.turnOrder.includes(event.turnId))
      next.turnOrder.push(event.turnId);
  } else if (
    (event.type === "item_started" || event.type === "item_completed") &&
    event.item
  ) {
    if (!event.item.turnId)
      throw new Error("Provider conversation item lacks a turn identity.");
    if (!next.turnOrder.includes(event.item.turnId))
      next.turnOrder.push(event.item.turnId);
    const existing = next.items[event.item.id];
    if (existing?.status === "completed" && event.item.status === "started") {
      /* terminal item wins */
    } else next.items[event.item.id] = event.item;
  } else if (event.type === "item_delta" && event.itemId && event.delta) {
    const existing = next.items[event.itemId];
    if (existing && existing.status !== "completed")
      next.items[event.itemId] = {
        ...existing,
        progress: `${existing.progress ?? ""}${event.delta}`.slice(-4000),
      };
  } else if (event.type === "summary" && event.summary)
    next.explicitSummary = event.summary.slice(0, 8000);
  next.turnOrder = next.turnOrder.slice(-MAX_TURNS);
  const retainedTurnIds = new Set(next.turnOrder);
  const itemEntries = Object.entries(next.items)
    .filter(([, item]) => item.turnId && retainedTurnIds.has(item.turnId))
    .slice(-MAX_ITEMS);
  next.items = Object.fromEntries(itemEntries);
  next.lastEventSequence = Math.max(next.lastEventSequence, event.sequence);
  const fingerprints = {
    ...state.eventFingerprints,
    [event.eventId]: event.payloadFingerprint,
  };
  const trimmed = Object.fromEntries(
    Object.entries(fingerprints).slice(-MAX_FINGERPRINTS),
  );
  const retainedFingerprintIds = new Set(Object.keys(trimmed));
  const fingerprintVersions = Object.fromEntries(
    Object.entries({
      ...(state.eventFingerprintVersions ?? {}),
      [event.eventId]: 2 as const,
    }).filter(([eventId]) => retainedFingerprintIds.has(eventId)),
  );
  return prepareConversationState({
    ...state,
    associations: { ...state.associations, [event.threadId]: next },
    eventFingerprints: trimmed,
    eventFingerprintVersions: fingerprintVersions,
  });
}

export interface ConversationAssociationStore {
  bind(association: ConversationAssociation): Promise<void>;
  apply(event: NormalizedConversationEvent): Promise<ConversationReducerState>;
  read(): Promise<ConversationReducerState>;
  projection(threadId: string): Promise<ConversationAssociation | undefined>;
  reconcile(thread: CodexThread): Promise<void>;
  settleAbsentThread?(threadId: string): Promise<void>;
}
function emptyState(): ConversationReducerState {
  return {
    associations: {},
    eventFingerprints: {},
    eventFingerprintVersions: {},
    pendingByThread: {},
  };
}
export class PersistentConversationStore implements ConversationAssociationStore {
  constructor(
    private readonly repository: StateRepository<ConversationReducerState>,
  ) {}
  async read(): Promise<ConversationReducerState> {
    const value = (await this.repository.read())?.value ?? emptyState();
    return prepareConversationState(value);
  }
  private async commit(
    revision: number,
    value: ConversationReducerState,
  ): Promise<ConversationReducerState> {
    const prepared = prepareConversationState(value);
    await this.repository.write(revision, prepared);
    return prepared;
  }
  async bind(association: ConversationAssociation): Promise<void> {
    validateAssociation(association);
    const snapshot = await this.repository.read();
    let state = snapshot?.value ?? emptyState();
    validateConversationState(state);
    const existing = state.associations[association.codexThreadId];
    if (
      existing &&
      (existing.roveTaskId !== association.roveTaskId ||
        existing.roveSessionId !== association.roveSessionId ||
        existing.codexSessionId !== association.codexSessionId)
    )
      throw new Error("Conversation association collision.");
    state = {
      ...state,
      associations: {
        ...state.associations,
        [association.codexThreadId]: existing ?? association,
      },
    };
    for (const event of state.pendingByThread?.[association.codexThreadId] ??
      [])
      state = reduceConversationEvent(state, event);
    const pending = { ...(state.pendingByThread ?? {}) };
    delete pending[association.codexThreadId];
    state.pendingByThread = pending;
    await this.commit(snapshot?.revision ?? 0, state);
  }
  async settleAbsentThread(threadId: string): Promise<void> {
    const snapshot = await this.repository.read();
    if (!snapshot) throw new Error("Absent thread has no durable association.");
    const current = snapshot.value.associations[threadId];
    if (
      !current ||
      current.archived ||
      current.turnStatus !== "unknown" ||
      current.activeTurnId !== undefined ||
      current.turnOrder.length !== 0 ||
      Object.keys(current.items).length !== 0
    )
      throw new Error("Absent thread conversation state is not empty.");
    await this.commit(snapshot.revision, {
      ...snapshot.value,
      associations: {
        ...snapshot.value.associations,
        [threadId]: { ...current, archived: true },
      },
    });
  }
  async apply(
    event: NormalizedConversationEvent,
  ): Promise<ConversationReducerState> {
    const snapshot = await this.repository.read();
    let state = snapshot?.value ?? emptyState();
    validateConversationState(state);
    if (!state.associations[event.threadId]) {
      const pending = [
        ...(state.pendingByThread?.[event.threadId] ?? []),
        event,
      ];
      state = {
        ...state,
        pendingByThread: {
          ...(state.pendingByThread ?? {}),
          [event.threadId]: pending,
        },
      };
    } else state = reduceConversationEvent(state, event);
    return this.commit(snapshot?.revision ?? 0, state);
  }
  async projection(
    threadId: string,
  ): Promise<ConversationAssociation | undefined> {
    return (await this.read()).associations[threadId];
  }
  private async applyAuthoritative(
    event: NormalizedConversationEvent,
  ): Promise<ConversationReducerState> {
    const snapshot = await this.repository.read();
    let state = snapshot?.value ?? emptyState();
    validateConversationState(state);
    const previous = state.eventFingerprints[event.eventId];
    const currentVersion = state.eventFingerprintVersions?.[event.eventId];
    if (previous !== undefined && currentVersion !== 2) {
      const association = state.associations[event.threadId];
      if (!association)
        throw new Error(
          "Legacy conversation fingerprint has no bound authoritative thread.",
        );
      const turnKnown =
        event.turnId !== undefined &&
        association.turnOrder.includes(event.turnId);
      const authoritativeMatch =
        (event.type === "turn_started" && turnKnown) ||
        (event.type === "item_completed" &&
          event.item !== undefined &&
          association.items[event.item.id] !== undefined &&
          fingerprint(association.items[event.item.id]) ===
            fingerprint(event.item)) ||
        (event.type === "turn_terminal" &&
          turnKnown &&
          association.turnStatus === event.status);
      if (!authoritativeMatch)
        throw new Error(
          `Legacy Codex event fingerprint cannot be upgraded from authoritative truth: ${event.eventId}.`,
        );
      state = {
        ...state,
        eventFingerprints: {
          ...state.eventFingerprints,
          [event.eventId]: event.payloadFingerprint,
        },
        eventFingerprintVersions: {
          ...(state.eventFingerprintVersions ?? {}),
          [event.eventId]: 2,
        },
      };
    }
    if (!state.associations[event.threadId]) {
      const pending = [
        ...(state.pendingByThread?.[event.threadId] ?? []),
        event,
      ];
      state = {
        ...state,
        pendingByThread: {
          ...(state.pendingByThread ?? {}),
          [event.threadId]: pending,
        },
      };
      return this.commit(snapshot?.revision ?? 0, state);
    }
    state = reduceConversationEvent(state, event);
    return this.commit(snapshot?.revision ?? 0, state);
  }
  async reconcile(thread: CodexThread): Promise<void> {
    let sequence = Date.now();
    for (const turn of thread.turns) {
      await this.applyAuthoritative(
        normalizeSynthetic(
          thread.id,
          turn.id,
          "turn/started",
          { threadId: thread.id, turn },
          ++sequence,
        ),
      );
      for (const item of turn.items)
        await this.applyAuthoritative(
          normalizeSynthetic(
            thread.id,
            turn.id,
            "item/completed",
            { threadId: thread.id, turnId: turn.id, item, completedAtMs: 0 },
            ++sequence,
          ),
        );
      if (turn.status !== "inProgress")
        await this.applyAuthoritative(
          normalizeSynthetic(
            thread.id,
            turn.id,
            "turn/completed",
            { threadId: thread.id, turn },
            ++sequence,
          ),
        );
    }
  }
}
function normalizeSynthetic(
  threadId: string,
  _turnId: string,
  method: CodexServerEvent["method"],
  params: Record<string, unknown>,
  sequence: number,
): NormalizedConversationEvent {
  const event = normalizeConversationServerEvent({ method, params }, sequence);
  if (!event) throw new Error(`Cannot reconcile ${threadId}.`);
  return event;
}
function validateAssociation(
  value: unknown,
): asserts value is ConversationAssociation {
  const record = strictRecord(value, "conversation association");
  exactKeys(
    record,
    [
      "roveTaskId",
      "codexThreadId",
      "codexSessionId",
      "roveSessionId",
      "activeTurnId",
      "turnStatus",
      "explicitSummary",
      "archived",
      "lastEventSequence",
      "items",
      "turnOrder",
    ],
    "conversation association",
  );
  for (const key of ["roveTaskId", "roveSessionId"] as const)
    boundedIdentity(record[key], key);
  for (const key of ["codexThreadId", "codexSessionId"] as const)
    boundedOpaqueIdentity(record[key], key);
  if (record.activeTurnId !== undefined)
    boundedOpaqueIdentity(record.activeTurnId, "active turn identity");
  if (
    !["unknown", "in_progress", "completed", "interrupted", "failed"].includes(
      String(record.turnStatus),
    )
  )
    throw new Error("Invalid conversation turn status.");
  if (record.turnStatus === "in_progress" && record.activeTurnId === undefined)
    throw new Error("Active conversation requires an active turn.");
  if (record.activeTurnId !== undefined && record.turnStatus !== "in_progress")
    throw new Error("Only an active conversation may retain an active turn.");
  if (TERMINAL.has(record.turnStatus as CodexTurnStatus) && record.activeTurnId)
    throw new Error("Terminal conversation cannot retain an active turn.");
  if (
    record.explicitSummary !== undefined &&
    (typeof record.explicitSummary !== "string" ||
      record.explicitSummary.length > 8_000)
  )
    throw new Error("Invalid conversation summary.");
  if (
    !Array.isArray(record.turnOrder) ||
    typeof record.items !== "object" ||
    record.items === null ||
    !Number.isInteger(record.lastEventSequence) ||
    Number(record.lastEventSequence) < 0 ||
    typeof record.archived !== "boolean"
  )
    throw new Error("Invalid conversation projection.");
  const turns = record.turnOrder as unknown[];
  if (turns.length > MAX_TURNS)
    throw new Error("Conversation turn bound exceeded.");
  const turnIds = new Set<string>();
  for (const turnId of turns) {
    const parsedTurnId = boundedOpaqueIdentity(turnId, "turn order identity");
    if (turnIds.has(parsedTurnId))
      throw new Error("Duplicate conversation turn ordering.");
    turnIds.add(parsedTurnId);
  }
  if (
    record.activeTurnId !== undefined &&
    !turnIds.has(record.activeTurnId as string)
  )
    throw new Error("Active turn is absent from conversation ordering.");
  const items = strictRecord(record.items, "conversation items");
  if (Object.keys(items).length > MAX_ITEMS)
    throw new Error("Conversation item bound exceeded.");
  for (const [itemId, raw] of Object.entries(items)) {
    const item = validateProjectedItem(raw);
    if (itemId !== item.id) throw new Error("Projected item key mismatch.");
    if (!item.turnId || !turnIds.has(item.turnId))
      throw new Error("Projected item references an unordered turn.");
  }
}
function validateProjectedItem(value: unknown): ProjectedConversationItem {
  const item = strictRecord(value, "projected conversation item");
  exactKeys(
    item,
    [
      "id",
      "turnId",
      "kind",
      "status",
      "phase",
      "startedAt",
      "completedAt",
      "authoredBy",
      "clientId",
      "attachments",
      "text",
      "title",
      "progress",
    ],
    "projected conversation item",
  );
  boundedOpaqueIdentity(item.id, "projected item identity");
  boundedOpaqueIdentity(item.turnId, "projected item turn identity");
  if (
    ![
      "user_message",
      "assistant_message",
      "plan",
      "command",
      "file_change",
      "tool",
      "other",
    ].includes(String(item.kind)) ||
    !["started", "completed"].includes(String(item.status))
  )
    throw new Error("Invalid projected item state.");
  if (
    item.phase !== undefined &&
    !["commentary", "final_answer"].includes(String(item.phase))
  )
    throw new Error("Invalid projected item phase.");
  if (
    item.authoredBy !== undefined &&
    !["user", "assistant", "host"].includes(String(item.authoredBy))
  )
    throw new Error("Invalid projected item author.");
  if (item.clientId !== undefined)
    boundedOpaqueIdentity(item.clientId, "projected item client identity");
  if (
    item.attachments !== undefined &&
    (!Array.isArray(item.attachments) ||
      item.attachments.length > 100 ||
      item.attachments.some((raw) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return true;
        const attachment = raw as Record<string, unknown>;
        return (
          Object.keys(attachment).sort().join(",") !== "filename,kind" ||
          typeof attachment.filename !== "string" ||
          attachment.filename.length < 1 ||
          attachment.filename.length > 255 ||
          !["file", "image", "audio"].includes(String(attachment.kind))
        );
      }))
  )
    throw new Error("Invalid projected item attachments.");
  for (const field of ["text", "title", "progress"] as const)
    if (item[field] !== undefined && typeof item[field] !== "string")
      throw new Error(`Invalid projected item ${field}.`);
  for (const field of ["startedAt", "completedAt"] as const)
    if (
      item[field] !== undefined &&
      (typeof item[field] !== "string" ||
        !Number.isFinite(Date.parse(item[field] as string)))
    )
      throw new Error(`Invalid projected item ${field}.`);
  return item as unknown as ProjectedConversationItem;
}
function validateNormalizedEvent(
  value: unknown,
  expectedThreadId?: string,
): void {
  const event = strictRecord(value, "pending conversation event");
  exactKeys(
    event,
    [
      "eventId",
      "payloadFingerprint",
      "sequence",
      "threadId",
      "turnId",
      "itemId",
      "type",
      "status",
      "item",
      "delta",
      "summary",
    ],
    "pending conversation event",
  );
  requiredString(event.eventId, "event identity");
  sha256Digest(event.payloadFingerprint, "event fingerprint");
  if (!Number.isInteger(event.sequence) || Number(event.sequence) < 0)
    throw new Error("Invalid event sequence.");
  const threadId = boundedOpaqueIdentity(
    event.threadId,
    "event thread identity",
  );
  if (expectedThreadId !== undefined && threadId !== expectedThreadId)
    throw new Error("Pending event thread key mismatch.");
  if (
    ![
      "thread_started",
      "thread_archived",
      "thread_unarchived",
      "turn_started",
      "turn_terminal",
      "item_started",
      "item_completed",
      "item_delta",
      "summary",
    ].includes(String(event.type))
  )
    throw new Error("Invalid conversation event type.");
  if (event.turnId !== undefined)
    boundedOpaqueIdentity(event.turnId, "event turn identity");
  if (event.itemId !== undefined)
    boundedOpaqueIdentity(event.itemId, "event item identity");
  const type = event.type as NormalizedConversationEvent["type"];
  const allowedByType: Record<
    NormalizedConversationEvent["type"],
    readonly string[]
  > = {
    thread_started: [],
    thread_archived: [],
    thread_unarchived: [],
    turn_started: ["turnId"],
    turn_terminal: ["turnId", "status"],
    item_started: ["turnId", "itemId", "item"],
    item_completed: ["turnId", "itemId", "item"],
    item_delta: ["turnId", "itemId", "delta"],
    summary: ["turnId", "summary"],
  };
  for (const field of [
    "turnId",
    "itemId",
    "status",
    "item",
    "delta",
    "summary",
  ] as const)
    if (event[field] !== undefined && !allowedByType[type].includes(field))
      throw new Error(`Pending ${type} event cannot carry ${field}.`);
  if (type === "turn_started" && event.turnId === undefined)
    throw new Error("Pending turn start requires turn identity.");
  if (
    type === "turn_terminal" &&
    (event.turnId === undefined ||
      !["completed", "interrupted", "failed"].includes(String(event.status)))
  )
    throw new Error("Pending terminal turn event is incomplete.");
  if (type === "item_started" || type === "item_completed") {
    if (
      event.turnId === undefined ||
      event.itemId === undefined ||
      event.item === undefined
    )
      throw new Error("Pending item event is incomplete.");
    const item = validateProjectedItem(event.item);
    if (
      item.id !== event.itemId ||
      item.turnId !== event.turnId ||
      item.status !== (type === "item_started" ? "started" : "completed")
    )
      throw new Error("Pending item event identity/state mismatch.");
  }
  if (
    type === "item_delta" &&
    (event.turnId === undefined ||
      event.itemId === undefined ||
      typeof event.delta !== "string")
  )
    throw new Error("Pending item delta is incomplete.");
  if (
    type === "summary" &&
    (event.turnId === undefined || typeof event.summary !== "string")
  )
    throw new Error("Pending summary event is incomplete.");
}
export function validateConversationState(
  value: unknown,
): asserts value is ConversationReducerState {
  const root = strictRecord(value, "conversation state");
  exactKeys(
    root,
    [
      "associations",
      "eventFingerprints",
      "eventFingerprintVersions",
      "pendingByThread",
    ],
    "conversation state",
  );
  const associations = strictRecord(root.associations, "associations");
  if (Object.keys(associations).length > 256)
    throw new Error("Conversation association bound exceeded.");
  for (const [threadId, association] of Object.entries(associations)) {
    validateAssociation(association);
    if (threadId !== (association as ConversationAssociation).codexThreadId)
      throw new Error("Conversation association key mismatch.");
  }
  const fingerprints = strictRecord(
    root.eventFingerprints,
    "event fingerprints",
  );
  if (Object.keys(fingerprints).length > MAX_FINGERPRINTS)
    throw new Error("Conversation fingerprint bound exceeded.");
  for (const [eventId, digest] of Object.entries(fingerprints)) {
    requiredString(eventId, "event identity");
    sha256Digest(digest, "event fingerprint");
  }
  const fingerprintVersions =
    root.eventFingerprintVersions === undefined
      ? {}
      : strictRecord(
          root.eventFingerprintVersions,
          "event fingerprint versions",
        );
  if (Object.keys(fingerprintVersions).length > MAX_FINGERPRINTS)
    throw new Error("Conversation fingerprint-version bound exceeded.");
  for (const [eventId, version] of Object.entries(fingerprintVersions)) {
    requiredString(eventId, "versioned event identity");
    if (!(eventId in fingerprints))
      throw new Error("Conversation fingerprint version has no fingerprint.");
    if (version !== 2)
      throw new Error("Unsupported conversation fingerprint version.");
  }
  const pending =
    root.pendingByThread === undefined
      ? {}
      : strictRecord(root.pendingByThread, "pending events");
  let pendingCount = 0;
  for (const [threadId, raw] of Object.entries(pending)) {
    boundedOpaqueIdentity(threadId, "pending thread identity");
    if (!Array.isArray(raw) || raw.length > MAX_PENDING)
      throw new Error("Invalid pending event collection.");
    pendingCount += raw.length;
    for (const event of raw) validateNormalizedEvent(event, threadId);
  }
  if (pendingCount > MAX_PENDING)
    throw new Error("Conversation pending-event bound exceeded.");
}

export function prepareConversationState(
  value: unknown,
): ConversationReducerState {
  const prepared = structuredClone(value);
  validateConversationState(prepared);
  return prepared;
}

export class CodexConversationService {
  private readonly listeners = new Set<(event: CodexServerEvent) => void>();
  constructor(private readonly rpc: CodexRpcPort) {}
  startThread(params: ThreadStartParams) {
    return this.rpc.request("thread/start", params);
  }
  listThreads(params = {}) {
    return this.rpc.request("thread/list", params);
  }
  readThread(threadId: string, includeTurns = false) {
    return this.rpc.request("thread/read", { threadId, includeTurns });
  }
  resumeThread(threadId: string) {
    return this.rpc.request("thread/resume", { threadId });
  }
  resumeThreadWithConfig(
    threadId: string,
    params: Omit<ThreadResumeParams, "threadId">,
  ) {
    return this.rpc.request("thread/resume", { threadId, ...params });
  }
  archiveThread(threadId: string) {
    return this.rpc.request("thread/archive", { threadId });
  }
  unarchiveThread(threadId: string) {
    return this.rpc.request("thread/unarchive", { threadId });
  }
  startTurn(params: TurnStartParams) {
    return this.rpc.request("turn/start", params);
  }
  steerTurn(params: TurnSteerParams) {
    return this.rpc.request("turn/steer", params);
  }
  interruptTurn(threadId: string, turnId: string) {
    return this.rpc.request("turn/interrupt", { threadId, turnId });
  }
  async interruptTurnAndWaitForTerminal(
    threadId: string,
    turnId: string,
    timeoutMs = 10_000,
  ): Promise<void> {
    let detach: () => void = () => {};
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const terminalEvent = new Promise<void>((resolve, reject) => {
      detach = this.onStream((event) => {
        const normalized = normalizeConversationServerEvent(event, 0);
        if (
          normalized?.threadId === threadId &&
          normalized.turnId === turnId &&
          normalized.type === "turn_terminal"
        )
          resolve();
      });
      timeout = setTimeout(
        () =>
          reject(
            new Error("Codex turn interrupt did not reach terminal truth."),
          ),
        timeoutMs,
      );
    });
    try {
      await this.interruptTurn(threadId, turnId);
      const truth = await this.readThread(threadId, true).catch(
        () => undefined,
      );
      const status = truth?.thread.turns.find(
        (turn) => turn.id === turnId,
      )?.status;
      if (
        status === "completed" ||
        status === "failed" ||
        status === "interrupted"
      )
        return;
      await terminalEvent;
    } finally {
      detach();
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
  onStream(listener: (event: CodexServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  attach(): () => void {
    return this.rpc.onEvent((event) => {
      if (
        [
          "thread/started",
          "thread/archived",
          "thread/unarchived",
          "turn/started",
          "turn/completed",
          "turn/plan/updated",
          "item/started",
          "item/completed",
          "item/agentMessage/delta",
          "item/plan/delta",
          "item/commandExecution/outputDelta",
          "item/fileChange/outputDelta",
          "item/mcpToolCall/progress",
        ].includes(event.method)
      )
        for (const listener of this.listeners) listener(event);
    });
  }
  attachStore(
    store: ConversationAssociationStore,
    onError: (error: unknown) => void,
  ): () => void {
    let sequence = 0;
    let queue = Promise.resolve();
    return this.onStream((event) => {
      const normalized = normalizeConversationServerEvent(event, ++sequence);
      if (!normalized) return;
      queue = queue
        .then(() => store.apply(normalized))
        .then(() => undefined)
        .catch(onError);
    });
  }
  static threadId(result: { thread: CodexThread }): string {
    return result.thread.id;
  }
}
