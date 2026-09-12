import type {
  CodexRpcPort,
  CodexServerEvent,
  CodexServerRequestMethod,
  JsonRpcId,
} from "./protocol.js";
import type { StateRepository } from "./persistence.js";
import {
  boundedIdentity,
  boundedOpaqueIdentity,
  exactKeys,
  strictRecord,
} from "./state-validation.js";
import {
  CODEX_SERVER_REQUEST_METHODS,
  validateServerRequestResponse,
} from "./protocol.js";

export type AttentionAuthority = "codex" | "rove_control";
export type AttentionKind =
  | "command_approval"
  | "file_approval"
  | "network_approval"
  | "permission_approval"
  | "mcp_elicitation"
  | "user_input"
  | "control_handoff";
export type AttentionStatus =
  | "pending"
  | "responding"
  | "awaiting_confirmation"
  | "resolution_unknown"
  | "resolved"
  | "cancelled"
  | "stale";
export interface AttentionRequest {
  authority: AttentionAuthority;
  kind: AttentionKind;
  requestId: string;
  taskId: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  generation: number;
  payload: Record<string, unknown>;
  status: AttentionStatus;
  sequence: number;
  method?: CodexServerRequestMethod;
}
export interface AttentionState {
  sequence: number;
  entries: AttentionRequest[];
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}
function fingerprint(
  value: Omit<AttentionRequest, "status" | "sequence"> | AttentionRequest,
): string {
  if ("status" in value && "sequence" in value) {
    const stable = Object.fromEntries(
      Object.entries(value).filter(
        ([name]) => name !== "status" && name !== "sequence",
      ),
    );
    return canonical(stable);
  }
  return canonical(value);
}
function key(authority: AttentionAuthority, requestId: string): string {
  return `${authority}:${requestId}`;
}

export class OrderedAttentionQueue {
  private sequence = 0;
  private readonly entries = new Map<string, AttentionRequest>();
  private readonly fingerprints = new Map<string, string>();
  private persistChain = Promise.resolve();
  constructor(
    private readonly maximum = 100,
    private readonly repository?: StateRepository<AttentionState>,
  ) {}
  private install(value: AttentionState): void {
    const prepared = validateAttentionState(value, this.maximum);
    this.sequence = prepared.sequence;
    this.entries.clear();
    this.fingerprints.clear();
    for (const entry of prepared.entries) {
      const id = key(entry.authority, entry.requestId);
      this.entries.set(id, structuredClone(entry));
      this.fingerprints.set(id, fingerprint(entry));
    }
  }
  private replace(value: AttentionState): void {
    this.install(value);
    this.schedulePersist(value);
  }
  async restore(): Promise<void> {
    const snapshot = await this.repository?.read();
    if (snapshot === undefined) return;
    const state = validateAttentionState(snapshot.value, this.maximum);
    const entries = state.entries.map((restored) => {
      const entry = structuredClone(restored);
      if (
        entry.authority === "codex" &&
        [
          "pending",
          "responding",
          "awaiting_confirmation",
          "resolution_unknown",
        ].includes(entry.status)
      )
        entry.status = "stale";
      return entry;
    });
    this.install({ sequence: state.sequence, entries });
    this.schedulePersist({ sequence: state.sequence, entries });
    await this.flush();
  }
  flush(): Promise<void> {
    return this.persistChain;
  }
  mergeRestored(entries: readonly AttentionRequest[]): void {
    const merged = new Map(
      this.list().map((entry) => [
        key(entry.authority, entry.requestId),
        entry,
      ]),
    );
    for (const entry of entries)
      merged.set(key(entry.authority, entry.requestId), structuredClone(entry));
    const values = [...merged.values()].sort(
      (left, right) => left.sequence - right.sequence,
    );
    const sequence = values.reduce(
      (greatest, entry) => Math.max(greatest, entry.sequence),
      0,
    );
    this.replace(
      validateAttentionState({ sequence, entries: values }, this.maximum),
    );
  }
  private schedulePersist(
    value = validateAttentionState(
      {
        sequence: this.sequence,
        entries: this.list(),
      },
      this.maximum,
    ),
  ): void {
    if (this.repository === undefined) return;
    const prepared = validateAttentionState(value, this.maximum);
    this.persistChain = this.persistChain.then(async () => {
      const snapshot = await this.repository!.read();
      await this.repository!.write(snapshot?.revision ?? 0, prepared);
    });
  }
  enqueue(
    request: Omit<AttentionRequest, "status" | "sequence">,
  ): AttentionRequest {
    if (!Number.isInteger(request.generation) || request.generation <= 0)
      throw new Error("Invalid attention connection generation.");
    const id = key(request.authority, request.requestId);
    const nextFingerprint = fingerprint(request);
    const existing = this.entries.get(id);
    if (existing) {
      if (this.fingerprints.get(id) !== nextFingerprint)
        throw new Error(`Attention identity collision: ${id}.`);
      return structuredClone(existing);
    }
    if (canonical(request.payload).length > 65_536)
      throw new Error("Attention payload bound exceeded.");

    const entries = [...this.list()];
    if (entries.length >= this.maximum) {
      const removable = entries.findIndex((entry) =>
        ["resolved", "cancelled", "stale"].includes(entry.status),
      );
      if (removable >= 0) entries.splice(removable, 1);
    }
    if (
      entries.filter((entry) =>
        [
          "pending",
          "responding",
          "awaiting_confirmation",
          "resolution_unknown",
        ].includes(entry.status),
      ).length >= this.maximum ||
      entries.length >= this.maximum
    )
      throw new Error("Attention queue capacity exceeded.");

    const entry: AttentionRequest = {
      ...structuredClone(request),
      status: "pending",
      sequence: this.sequence + 1,
    };
    this.replace({ sequence: entry.sequence, entries: [...entries, entry] });
    return structuredClone(entry);
  }
  requireExact(
    identity: Pick<
      AttentionRequest,
      | "authority"
      | "requestId"
      | "taskId"
      | "threadId"
      | "turnId"
      | "itemId"
      | "generation"
    >,
  ): AttentionRequest {
    const entry = this.entries.get(key(identity.authority, identity.requestId));
    if (
      !entry ||
      entry.taskId !== identity.taskId ||
      entry.threadId !== identity.threadId ||
      entry.turnId !== identity.turnId ||
      entry.itemId !== identity.itemId ||
      entry.generation !== identity.generation
    )
      throw new Error("Stale or mismatched attention decision.");
    return entry;
  }
  beginResponse(
    identity: Parameters<OrderedAttentionQueue["requireExact"]>[0],
  ): AttentionRequest {
    this.requireExact(identity);
    return this.transition(
      identity.authority,
      identity.requestId,
      ["pending"],
      "responding",
    );
  }
  markAwaiting(authority: AttentionAuthority, requestId: string): void {
    this.transition(
      authority,
      requestId,
      ["responding"],
      "awaiting_confirmation",
    );
  }
  markUnknown(authority: AttentionAuthority, requestId: string): void {
    this.transition(
      authority,
      requestId,
      ["responding", "awaiting_confirmation"],
      "resolution_unknown",
    );
  }
  confirm(authority: AttentionAuthority, requestId: string): AttentionRequest {
    return this.transition(
      authority,
      requestId,
      ["awaiting_confirmation", "resolution_unknown", "stale"],
      "resolved",
    );
  }
  resolveExact(
    identity: Parameters<OrderedAttentionQueue["requireExact"]>[0],
  ): AttentionRequest {
    this.requireExact(identity);
    return this.transition(
      identity.authority,
      identity.requestId,
      ["pending"],
      "resolved",
    );
  }
  cancel(authority: AttentionAuthority, requestId: string): AttentionRequest {
    return this.transition(
      authority,
      requestId,
      ["pending", "responding", "awaiting_confirmation", "resolution_unknown"],
      "cancelled",
    );
  }
  markStale(taskId: string, generation: number): void {
    let changed = false;
    const entries = this.list().map((entry) => {
      if (
        entry.authority === "codex" &&
        entry.taskId === taskId &&
        entry.generation < generation &&
        [
          "pending",
          "responding",
          "awaiting_confirmation",
          "resolution_unknown",
        ].includes(entry.status)
      ) {
        changed = true;
        return { ...entry, status: "stale" as const };
      }
      return entry;
    });
    if (changed) this.replace({ sequence: this.sequence, entries });
  }
  markTurnTerminal(
    threadId: string,
    turnId: string,
    generation?: number,
  ): AttentionRequest[] {
    let changed = false;
    const transitioned: AttentionRequest[] = [];
    const entries = this.list().map((entry) => {
      if (
        entry.authority === "codex" &&
        entry.threadId === threadId &&
        entry.turnId === turnId &&
        (generation === undefined || entry.generation === generation) &&
        [
          "pending",
          "responding",
          "awaiting_confirmation",
          "resolution_unknown",
        ].includes(entry.status)
      ) {
        changed = true;
        const next = { ...entry, status: "stale" as const };
        transitioned.push(next);
        return next;
      }
      return entry;
    });
    if (changed) this.replace({ sequence: this.sequence, entries });
    return transitioned.map((entry) => structuredClone(entry));
  }
  findByWireRequest(
    threadId: string,
    wireRequestId: JsonRpcId,
    generation: number,
  ): AttentionRequest | undefined {
    const suffix = `:server:${String(wireRequestId)}`;
    return [...this.entries.values()].find(
      (entry) =>
        entry.authority === "codex" &&
        entry.threadId === threadId &&
        (entry.generation === generation || entry.status === "stale") &&
        entry.requestId.endsWith(suffix),
    );
  }
  list(): readonly AttentionRequest[] {
    return [...this.entries.values()]
      .sort((a, b) => a.sequence - b.sequence)
      .map((entry) => structuredClone(entry));
  }
  reconcileRovePending(activeRequestIds: ReadonlySet<string>): void {
    let changed = false;
    const entries = this.list().map((entry) => {
      if (
        entry.authority === "rove_control" &&
        entry.status === "stale" &&
        activeRequestIds.has(entry.requestId)
      ) {
        changed = true;
        return { ...entry, status: "pending" as const };
      }
      if (
        entry.authority === "rove_control" &&
        entry.status === "pending" &&
        !activeRequestIds.has(entry.requestId)
      ) {
        changed = true;
        return { ...entry, status: "cancelled" as const };
      }
      return entry;
    });
    if (changed) this.replace({ sequence: this.sequence, entries });
  }
  private transition(
    authority: AttentionAuthority,
    requestId: string,
    from: AttentionStatus[],
    to: AttentionStatus,
  ): AttentionRequest {
    const entry = this.entries.get(key(authority, requestId));
    if (!entry) throw new Error("Unknown attention request.");
    if (entry.status === to) return structuredClone(entry);
    if (!from.includes(entry.status))
      throw new Error(`Attention request is ${entry.status}.`);
    const next = { ...entry, status: to };
    this.replace({
      sequence: this.sequence,
      entries: this.list().map((candidate) =>
        candidate.authority === authority && candidate.requestId === requestId
          ? next
          : candidate,
      ),
    });
    return structuredClone(next);
  }
}

export function validateAttentionState(
  value: unknown,
  maximum = 100,
): AttentionState {
  const root = strictRecord(value, "attention state");
  exactKeys(root, ["sequence", "entries"], "attention state");
  if (
    !Number.isInteger(root.sequence) ||
    Number(root.sequence) < 0 ||
    !Array.isArray(root.entries) ||
    root.entries.length > maximum
  )
    throw new Error("Invalid bounded attention state.");
  const seen = new Set<string>();
  const seenSequences = new Set<number>();
  let greatest = 0;
  const entries = root.entries.map((raw) => {
    const item = strictRecord(raw, "attention entry");
    exactKeys(
      item,
      [
        "authority",
        "kind",
        "requestId",
        "taskId",
        "threadId",
        "turnId",
        "itemId",
        "generation",
        "payload",
        "status",
        "sequence",
        "method",
      ],
      "attention entry",
    );
    if (
      !["codex", "rove_control"].includes(String(item.authority)) ||
      ![
        "command_approval",
        "file_approval",
        "network_approval",
        "permission_approval",
        "mcp_elicitation",
        "user_input",
        "control_handoff",
      ].includes(String(item.kind)) ||
      ![
        "pending",
        "responding",
        "awaiting_confirmation",
        "resolution_unknown",
        "resolved",
        "cancelled",
        "stale",
      ].includes(String(item.status))
    )
      throw new Error("Invalid attention enum.");
    const requestId = boundedOpaqueIdentity(
      item.requestId,
      "attention request identity",
    );
    boundedIdentity(
      item.taskId,
      "attention task identity",
      /^task_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,
    );
    if (
      !Number.isInteger(item.generation) ||
      Number(item.generation) <= 0 ||
      !Number.isInteger(item.sequence) ||
      Number(item.sequence) <= 0
    )
      throw new Error("Invalid attention generation/sequence.");
    strictRecord(item.payload, "attention payload");
    if (canonical(item.payload).length > 65_536)
      throw new Error("Attention payload bound exceeded.");
    for (const field of ["threadId", "turnId", "itemId"] as const)
      if (item[field] !== undefined)
        boundedOpaqueIdentity(item[field], `attention ${field}`);
    if (
      item.authority === "codex" &&
      (typeof item.method !== "string" ||
        !(CODEX_SERVER_REQUEST_METHODS as readonly string[]).includes(
          item.method,
        ))
    )
      throw new Error("Invalid Codex attention method.");
    if (item.authority === "rove_control" && item.method !== undefined)
      throw new Error("Rove attention cannot carry a Codex method.");
    const parsed = item as unknown as AttentionRequest;
    if (parsed.authority === "codex") {
      const baseKind = ATTENTION_METHOD_KIND[parsed.method!];
      const expectedKind =
        baseKind === "command_approval" &&
        parsed.payload.networkApprovalContext !== undefined
          ? "network_approval"
          : baseKind;
      if (expectedKind === undefined || parsed.kind !== expectedKind)
        throw new Error("Codex attention method/kind mismatch.");
    } else if (parsed.kind !== "control_handoff")
      throw new Error("Rove attention must be a control handoff.");
    const identity = key(parsed.authority, requestId);
    if (seen.has(identity)) throw new Error("Duplicate attention identity.");
    seen.add(identity);
    if (seenSequences.has(parsed.sequence))
      throw new Error("Duplicate attention sequence.");
    seenSequences.add(parsed.sequence);
    greatest = Math.max(greatest, parsed.sequence);
    return structuredClone(parsed);
  });
  if (greatest !== Number(root.sequence))
    throw new Error("Attention sequence watermark mismatch.");
  return { sequence: Number(root.sequence), entries };
}

const ATTENTION_METHOD_KIND: Partial<
  Record<CodexServerRequestMethod, AttentionKind>
> = {
  "item/commandExecution/requestApproval": "command_approval",
  "item/fileChange/requestApproval": "file_approval",
  "item/permissions/requestApproval": "permission_approval",
  "mcpServer/elicitation/request": "mcp_elicitation",
  "item/tool/requestUserInput": "user_input",
  execCommandApproval: "command_approval",
  applyPatchApproval: "file_approval",
};
function kindFor(event: CodexServerEvent): AttentionKind | undefined {
  const kind = ATTENTION_METHOD_KIND[event.method as CodexServerRequestMethod];
  return kind === "command_approval" &&
    event.params.networkApprovalContext !== undefined
    ? "network_approval"
    : kind;
}

export class CodexAttentionBroker {
  private readonly wireIds = new Map<
    string,
    { id: JsonRpcId; method: CodexServerRequestMethod }
  >();
  constructor(
    private readonly rpc: CodexRpcPort,
    private readonly queue: OrderedAttentionQueue,
    private readonly onObserved?: (
      entry: AttentionRequest,
    ) => Promise<void> | void,
  ) {}
  attach(
    resolveContext: (event: CodexServerEvent) => {
      taskId: string;
      threadId?: string;
      turnId?: string;
      generation: number;
    },
  ): () => void {
    return this.rpc.onEvent(async (event) => {
      if (event.method === "serverRequest/resolved") {
        const context = resolveContext(event);
        const rawId = event.params.requestId;
        if (typeof rawId !== "string" && typeof rawId !== "number")
          throw new Error("Invalid resolved server request identity.");
        const entry =
          context.threadId === undefined
            ? undefined
            : this.queue.findByWireRequest(
                context.threadId,
                rawId,
                context.generation,
              );
        if (entry) {
          const confirmed = this.queue.confirm("codex", entry.requestId);
          this.wireIds.delete(entry.requestId);
          await this.onObserved?.(confirmed);
        }
        return;
      }
      if (event.method === "turn/completed") {
        const context = resolveContext(event);
        if (context.threadId && context.turnId)
          for (const transitioned of this.queue.markTurnTerminal(
            context.threadId,
            context.turnId,
            context.generation,
          ))
            await this.onObserved?.(transitioned);
        return;
      }
      if (event.requestId === undefined) return;
      if (
        !(CODEX_SERVER_REQUEST_METHODS as readonly string[]).includes(
          event.method,
        )
      )
        return;
      const method = event.method as CodexServerRequestMethod;
      const kind = kindFor(event);
      if (!kind) {
        void this.rpc.respond(
          event.requestId,
          {},
          { code: -32601, message: "Unsupported App Server request." },
        );
        return;
      }
      const context = resolveContext(event);
      const requestId = String(event.requestId);
      const itemId =
        typeof event.params.itemId === "string"
          ? event.params.itemId
          : typeof event.params.callId === "string"
            ? event.params.callId
            : undefined;
      const entry = this.queue.enqueue({
        authority: "codex",
        kind,
        requestId,
        ...context,
        ...(itemId === undefined ? {} : { itemId }),
        payload: event.params,
        method,
      });
      this.wireIds.set(requestId, { id: event.requestId, method });
      await this.onObserved?.(entry);
    });
  }
  async respond(
    identity: Omit<
      Parameters<OrderedAttentionQueue["requireExact"]>[0],
      "authority"
    >,
    result: unknown,
  ): Promise<void> {
    const entry = this.queue.beginResponse({ authority: "codex", ...identity });
    const wire = this.wireIds.get(identity.requestId);
    if (!wire || !entry.method || wire.method !== entry.method) {
      this.queue.markUnknown("codex", identity.requestId);
      throw new Error(
        "Codex request is no longer attached to a live transport.",
      );
    }
    validateServerRequestResponse(wire.method, result);
    try {
      await this.rpc.respond(wire.id, result);
      this.queue.markAwaiting("codex", identity.requestId);
    } catch (error) {
      this.queue.markUnknown("codex", identity.requestId);
      throw error;
    }
  }
  onConnectionGeneration(generation: number): void {
    for (const entry of this.queue.list())
      if (entry.authority === "codex")
        this.queue.markStale(entry.taskId, generation);
  }
  enqueueRove(
    request: Omit<AttentionRequest, "authority" | "status" | "sequence">,
  ): AttentionRequest {
    return this.queue.enqueue({ ...request, authority: "rove_control" });
  }
}
