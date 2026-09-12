import { assertSchema } from "./schema-validator.mjs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const clone = (value) => JSON.parse(JSON.stringify(value));
const same = (left, right) => isDeepStrictEqual(left, right);
const observationFingerprint = (record) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        roveTaskId: record.roveTaskId,
        codexThreadId: record.codexThreadId,
        originatingCodexTurnId: record.originatingCodexTurnId,
        roveSessionId: record.roveSessionId,
        ...(record.handoffId === undefined
          ? {}
          : { handoffId: record.handoffId }),
        handoffGeneration: record.handoffGeneration,
        requestedInstruction: record.requestedInstruction,
        continuationPolicy: record.continuationPolicy,
        ...(record.preHandoffObservationSeq === undefined
          ? {}
          : { preHandoffObservationSeq: record.preHandoffObservationSeq }),
      }),
    )
    .digest("hex");

export class EventLog {
  constructor(events = []) {
    this.events = [];
    for (const event of events) this.append(event);
  }
  append(event) {
    const existing = this.events.find((item) => item.id === event.id);
    if (existing) {
      if (same(existing, event)) return false;
      throw new Error("event_identity_collision");
    }
    this.events.push(clone(event));
    return true;
  }
  serialize() {
    return JSON.stringify(this.events);
  }
  static restore(serialized) {
    return new EventLog(JSON.parse(serialized));
  }
}

export class RpcCorrelation {
  constructor() {
    this.initialized = false;
    this.pending = new Map();
    this.settled = new Set();
    this.nextId = 1;
  }
  initialize() {
    this.initialized = true;
  }
  request(method) {
    if (!this.initialized && method !== "initialize")
      throw new Error("not_initialized");
    const id = `rpc-${this.nextId++}`;
    this.pending.set(id, method);
    return id;
  }
  settle(id) {
    if (this.settled.has(id)) throw new Error("duplicate_response");
    if (!this.pending.has(id)) throw new Error("unknown_response_id");
    this.pending.delete(id);
    this.settled.add(id);
  }
  exit() {
    const uncertain = [...this.pending].map(([id, method]) => ({
      id,
      method,
      outcome: "transport_uncertain",
    }));
    this.pending.clear();
    return uncertain;
  }
}

export class AttentionCoordinator {
  constructor() {
    this.items = new Map();
  }
  addCodex({ requestId, threadId, turnId, itemId, kind }) {
    const key = `codex:${requestId}`;
    const item = {
      authority: "codex",
      requestId,
      threadId,
      turnId,
      itemId,
      kind,
    };
    this.#add(key, item);
    return key;
  }
  addRove({ sessionId, generation, taskId, action }) {
    const key = `rove:${sessionId}:${generation}`;
    this.#add(key, {
      authority: "rove",
      sessionId,
      generation,
      taskId,
      ...(action ? { action } : {}),
    });
    return key;
  }
  #add(key, item) {
    const existing = this.items.get(key);
    if (existing) {
      if (same(existing, item)) return false;
      throw new Error("attention_identity_collision");
    }
    this.items.set(key, item);
    return true;
  }
  resolveCodex({ requestId, threadId, turnId, itemId }) {
    const key = `codex:${requestId}`;
    const item = this.items.get(key);
    if (
      !item ||
      item.threadId !== threadId ||
      item.turnId !== turnId ||
      item.itemId !== itemId
    )
      throw new Error("stale_codex_decision");
    this.items.delete(key);
  }
  resolveRove({ sessionId, generation, taskId }) {
    const key = `rove:${sessionId}:${generation}`;
    const item = this.items.get(key);
    if (!item || item.taskId !== taskId) throw new Error("stale_rove_decision");
    this.items.delete(key);
  }
  cancelTurn(threadId, turnId) {
    for (const [key, item] of this.items) {
      if (
        item.authority === "codex" &&
        item.threadId === threadId &&
        item.turnId === turnId
      )
        this.items.delete(key);
    }
  }
  projection() {
    return [...this.items.values()].sort((left, right) =>
      left.authority.localeCompare(right.authority),
    );
  }
}

export class OutcomeCoordinator {
  constructor(receipts = [], events = []) {
    this.receipts = new Map(
      receipts.map((receipt) => [receipt.consequenceKey, clone(receipt)]),
    );
    this.projection = new EventLog(events);
  }
  recordReceipt(receipt) {
    if (this.receipts.has(receipt.consequenceKey))
      throw new Error("duplicate_consequence");
    this.receipts.set(receipt.consequenceKey, clone(receipt));
  }
  reconcile({ consequenceKey, dispatchStatus, freshObservation }) {
    const receipt = this.receipts.get(consequenceKey);
    if (receipt)
      return { replay: false, outcome: receipt.outcome, source: "receipt" };
    if (freshObservation?.applied)
      return { replay: false, outcome: "applied", source: "fresh_observation" };
    if (dispatchStatus === "not_started")
      return { replay: true, outcome: "not_applied", source: "dispatch" };
    return { replay: false, outcome: "unknown", source: "replay_fence" };
  }
  recover(cut) {
    const event = {
      id: `evt_${cut.name}`,
      type: "turn.terminal",
      status: cut.terminal,
    };
    this.projection.append(event);
    this.projection.append(event);
    const outcome = this.reconcile(cut);
    return {
      ...outcome,
      activeTurnId: cut.terminal ? null : cut.activeTurnId,
      projectedEvents: this.projection.events.length,
    };
  }
  serialize() {
    return JSON.stringify({
      receipts: [...this.receipts.values()],
      events: this.projection.events,
    });
  }
  static restore(serialized) {
    const saved = JSON.parse(serialized);
    return new OutcomeCoordinator(saved.receipts, saved.events);
  }
}

export class BoundedRestartSupervisor {
  constructor(maxAttempts) {
    this.maxAttempts = maxAttempts;
  }
  restart(start) {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const value = start(attempt);
      if (value) return { attempt, value };
    }
    throw new Error("restart_exhausted");
  }
}

export class UnifiedProductStore {
  constructor(state) {
    this.state = clone(state);
    this.presentation = "chip";
    this.browserContext = "windowed";
    this.suppressed = false;
  }
  transition({ presentation, browserContext, suppressed } = {}) {
    if (presentation) this.presentation = presentation;
    if (browserContext) this.browserContext = browserContext;
    if (suppressed !== undefined) this.suppressed = suppressed;
    return this.project();
  }
  project(
    presentation = this.presentation,
    browserContext = this.browserContext,
  ) {
    this.presentation = presentation;
    this.browserContext = browserContext;
    return {
      ...clone(this.state),
      presentation,
      browserContext,
      activeHost:
        presentation === "full" || this.suppressed
          ? "control_center"
          : "browser_follower",
      visibleHostCount: 1,
      suppressed: this.suppressed,
    };
  }
  serialize() {
    return JSON.stringify({
      state: this.state,
      presentation: this.presentation,
      browserContext: this.browserContext,
      suppressed: this.suppressed,
    });
  }
  static restore(serialized) {
    const saved = JSON.parse(serialized);
    if (!Object.hasOwn(saved, "state")) return new UnifiedProductStore(saved);
    const store = new UnifiedProductStore(saved.state);
    store.presentation = saved.presentation;
    store.browserContext = saved.browserContext;
    store.suppressed = saved.suppressed;
    return store;
  }
}

export class ContinuationCoordinator {
  constructor(schema, records = []) {
    this.schema = schema;
    this.records = new Map();
    for (const record of records) this.persist(record);
  }
  persist(record) {
    assertSchema(this.schema, record);
    if (
      record.handoffId !== undefined &&
      record.observationFingerprint !== observationFingerprint(record)
    )
      throw new Error("continuation_observation_fingerprint_mismatch");
    if (
      record.continuationCommand &&
      record.continuationCommand.payload.roveContinuationCommandId !==
        record.continuationCommand.commandId
    )
      throw new Error("continuation_command_correlation_mismatch");
    const existing = this.records.get(record.roveTaskId);
    if (existing) {
      if (
        existing.observationFingerprint !== undefined &&
        existing.observationFingerprint === record.observationFingerprint
      )
        return false;
      if (same(existing, record)) return false;
      throw new Error("continuation_task_collision");
    }
    this.records.set(record.roveTaskId, clone(record));
    return true;
  }
  returnControl(event, threadState) {
    const record = this.records.get(event.roveTaskId);
    if (!record || record.status !== "pending") return { action: "reject" };
    if (
      record.roveSessionId !== event.roveSessionId ||
      record.handoffGeneration !== event.handoffGeneration ||
      (record.handoffId !== undefined && record.handoffId !== event.handoffId)
    )
      return { action: "reject" };
    if (threadState.threadId !== record.codexThreadId)
      return { action: "reject", reason: "thread_identity_mismatch" };
    if (record.continuationPolicy === "explicit_user_response")
      return { action: "pause" };
    if (
      record.returnEventId !== undefined &&
      (record.returnEventId !== event.id ||
        record.returnObservationSeq !== event.observationSeq)
    )
      return { action: "reject", reason: "conflicting_return_event" };
    record.returnEventId = event.id;
    if (event.observationSeq !== undefined)
      record.returnObservationSeq = event.observationSeq;
    record.freshInspectionRequired = false;
    assertSchema(this.schema, record);
    if (
      threadState.activeTurnId !== null &&
      threadState.activeTurnId !== record.originatingCodexTurnId
    )
      return {
        action: "wait_for_idle",
        reason: "different_turn_active",
        activeTurnId: threadState.activeTurnId,
      };
    const selectedKind =
      threadState.activeTurnId === record.originatingCodexTurnId
        ? "turn/steer"
        : "turn/start";
    const commandId = `continue:${record.roveTaskId}:${record.handoffGeneration}:${event.id}`;
    if (record.continuationCommand) {
      if (
        record.continuationCommand.commandId !== commandId ||
        record.continuationCommand.returnEventId !== event.id
      )
        return { action: "reject", reason: "conflicting_return_event" };
    } else {
      record.continuationCommand = {
        commandId,
        returnEventId: event.id,
        kind: selectedKind,
        dispatchStatus: "not_started",
        payload: {
          roveContinuationCommandId: commandId,
          authoredBy: "host",
          instruction: record.requestedInstruction,
        },
      };
    }
    assertSchema(this.schema, record);
    return {
      action:
        record.continuationCommand.kind === "turn/steer"
          ? "steer"
          : "start_turn",
      commandId,
      dispatchStatus: record.continuationCommand.dispatchStatus,
      payload: clone(record.continuationCommand.payload),
      authoredBy: "host",
      freshInspectionRequired: false,
    };
  }
  beginDispatch(roveTaskId, commandId) {
    const record = this.#commandRecord(roveTaskId, commandId);
    if (record.status !== "pending")
      throw new Error("continuation_not_pending");
    if (record.continuationCommand.dispatchStatus !== "not_started")
      return false;
    record.continuationCommand.dispatchStatus = "possibly_started";
    assertSchema(this.schema, record);
    return { action: "send", command: clone(record.continuationCommand) };
  }
  reconcileDispatch(roveTaskId, commandId, threadTruth) {
    const known = this.records.get(roveTaskId);
    if (
      known &&
      (known.status === "cancelled" || known.status === "superseded") &&
      !known.continuationCommand
    )
      return { action: known.status };
    const record = this.#commandRecord(roveTaskId, commandId);
    if (threadTruth.threadId !== record.codexThreadId)
      return { action: "reject", reason: "thread_identity_mismatch" };
    const command = record.continuationCommand;
    const observed = (threadTruth.hostAuthoredPayloads ?? []).some(
      (payload) => payload.roveContinuationCommandId === commandId,
    );
    const terminal = (
      threadTruth.terminalContinuationCommandIds ?? []
    ).includes(commandId);
    if (record.status === "cancelled" || record.status === "superseded") {
      if (terminal) {
        command.dispatchStatus = "terminal";
        assertSchema(this.schema, record);
        return { action: "cancelled_terminal" };
      }
      return {
        action: observed
          ? "await_cancelled_terminal"
          : "reconcile_or_interrupt",
      };
    }
    if (command.dispatchStatus === "terminal") return { action: "complete" };
    if (terminal) {
      command.dispatchStatus = "terminal";
      record.status = "consumed";
      record.consumedEventId = command.returnEventId;
      assertSchema(this.schema, record);
      return { action: "complete" };
    }
    if (observed) {
      command.dispatchStatus = "possibly_started";
      assertSchema(this.schema, record);
      return { action: "await_terminal" };
    }
    if (command.dispatchStatus === "not_started")
      return this.#reconcileUndispatched(record, threadTruth);
    if (threadTruth.definitelyNotStarted === true) {
      command.dispatchStatus = "not_started";
      assertSchema(this.schema, record);
      return this.#reconcileUndispatched(record, threadTruth);
    }
    return { action: "replay_fenced" };
  }
  #reconcileUndispatched(record, threadTruth) {
    const command = record.continuationCommand;
    if (command.kind === "turn/steer") {
      if (threadTruth.activeTurnId === record.originatingCodexTurnId)
        return { action: "retry", command: clone(command) };
      if (threadTruth.activeTurnId === null) {
        command.kind = "turn/start";
        assertSchema(this.schema, record);
        return { action: "retry", command: clone(command) };
      }
      return {
        action: "wait_for_idle",
        activeTurnId: threadTruth.activeTurnId,
      };
    }
    if (threadTruth.activeTurnId !== null)
      return {
        action: "wait_for_idle",
        activeTurnId: threadTruth.activeTurnId,
      };
    return { action: "retry", command: clone(command) };
  }
  #commandRecord(roveTaskId, commandId) {
    const record = this.records.get(roveTaskId);
    if (!record?.continuationCommand)
      throw new Error("continuation_command_missing");
    if (record.continuationCommand.commandId !== commandId)
      throw new Error("continuation_command_mismatch");
    return record;
  }
  cancel(roveTaskId) {
    return this.#stop(roveTaskId, "cancelled");
  }
  supersede(roveTaskId) {
    return this.#stop(roveTaskId, "superseded");
  }
  #stop(roveTaskId, status) {
    const record = this.records.get(roveTaskId);
    if (!record || record.status !== "pending") return false;
    if (record.continuationCommand?.dispatchStatus === "not_started")
      delete record.continuationCommand;
    record.status = status;
    assertSchema(this.schema, record);
    return {
      action: record.continuationCommand
        ? "reconcile_or_interrupt"
        : `${status}_undispatched`,
    };
  }
  serialize() {
    return JSON.stringify([...this.records.values()]);
  }
  static restore(schema, serialized) {
    return new ContinuationCoordinator(schema, JSON.parse(serialized));
  }
}

export class AccountCatalogProjection {
  constructor() {
    this.state = {
      account: { status: "logged_out" },
      models: [],
      usage: null,
      rateLimits: null,
    };
  }
  reduce(event) {
    if (event.type === "login_completed")
      this.state.account = {
        status: "logged_in",
        authMode: event.authMode,
        plan: event.plan,
      };
    if (event.type === "token_refreshed")
      this.state.account.refreshedAt = event.at;
    if (event.type === "logout") this.state.account = { status: "logged_out" };
    if (event.type === "models")
      this.state.models = event.models.filter((model) => !model.hidden);
    if (event.type === "usage") this.state.usage = event.usage;
    if (event.type === "rate_limits") this.state.rateLimits = event.rateLimits;
    return clone(this.state);
  }
}

export class DirectLocalProductApi {
  constructor(receiver) {
    this.receiver = receiver;
    this.instrumentation = {
      structuredClones: 0,
      jsonEncodes: 0,
      jsonDecodes: 0,
    };
  }
  send(envelope) {
    this.instrumentation.structuredClones += 1;
    return this.receiver(globalThis.structuredClone(envelope));
  }
}

export class JsonFixtureLocalProductApi {
  constructor(receiver) {
    this.receiver = receiver;
    this.instrumentation = {
      structuredClones: 0,
      jsonEncodes: 0,
      jsonDecodes: 0,
    };
  }
  send(envelope) {
    this.instrumentation.jsonEncodes += 1;
    const encoded = JSON.stringify(envelope);
    this.instrumentation.jsonDecodes += 1;
    return this.receiver(JSON.parse(encoded));
  }
}

export class RemoteProductFixture {
  constructor() {
    this.received = [];
    this.authorities = Object.freeze({
      browser: false,
      approval: false,
      credential: false,
      receipt: false,
      consequentialOutcome: false,
    });
  }
  receive(envelope) {
    this.received.push(clone(envelope));
    return { acceptedSequence: envelope.sequence };
  }
  invoke(authority) {
    if (!Object.hasOwn(this.authorities, authority))
      throw new Error("unknown_authority");
    if (!this.authorities[authority]) throw new Error("authority_device_only");
  }
}

export function toCloudEnvelope(schema, localEvent) {
  const envelope = {
    schemaVersion: 1,
    deviceId: localEvent.deviceId,
    sequence: localEvent.sequence,
    type: localEvent.type,
    payload: Object.fromEntries(
      ["taskId", "workflowId", "status", "summary", "occurredAt"]
        .filter((key) => localEvent.payload[key] !== undefined)
        .map((key) => [key, localEvent.payload[key]]),
    ),
  };
  return assertSchema(schema, envelope);
}

export class TaskLaunchAuthority {
  constructor(schema, workspaces, rememberedDefault, activeLaunches = []) {
    this.schema = schema;
    this.workspaces = new Map(
      workspaces.map((workspace) => [workspace.id, clone(workspace)]),
    );
    this.rememberedDefault = clone(rememberedDefault);
    this.temporaryProfiles = new Set();
    this.activeLaunches = new Map();
    for (const launch of activeLaunches) {
      assertSchema(this.schema, launch);
      if (this.activeLaunches.has(launch.roveTaskId))
        throw new Error("active_launch_collision");
      this.activeLaunches.set(launch.roveTaskId, Object.freeze(clone(launch)));
    }
  }
  resolveSelection(selection) {
    const hasOverride =
      selection.executionMode !== undefined ||
      selection.browserIdentityMode !== undefined ||
      selection.resolvedWorkspaceId !== undefined;
    const chosen = { ...(this.rememberedDefault ?? {}), ...selection };
    if (!chosen.executionMode || !chosen.browserIdentityMode)
      throw new Error("launch_selection_required");
    return this.resolve({
      roveTaskId: chosen.roveTaskId,
      executionMode: chosen.executionMode,
      browserIdentityMode: chosen.browserIdentityMode,
      ...(chosen.browserIdentityMode === "workspace"
        ? { resolvedWorkspaceId: chosen.resolvedWorkspaceId }
        : {}),
      selectionSource: hasOverride ? "user_selected" : "remembered_default",
      selectedAt: chosen.selectedAt,
    });
  }
  resolve(intent) {
    const resolved = {
      roveTaskId: intent.roveTaskId,
      executionMode: intent.executionMode,
      browserIdentityMode: intent.browserIdentityMode,
      ...(intent.browserIdentityMode === "workspace"
        ? { resolvedWorkspaceId: intent.resolvedWorkspaceId }
        : {}),
      selectionSource: intent.selectionSource,
      selectedAt: intent.selectedAt,
    };
    assertSchema(this.schema, resolved);
    const active = this.activeLaunches.get(resolved.roveTaskId);
    if (active) {
      if (same(active, resolved)) return active;
      throw new Error("active_launch_conflict");
    }
    if (resolved.browserIdentityMode === "workspace") {
      const workspace = this.workspaces.get(resolved.resolvedWorkspaceId);
      if (!workspace) throw new Error("workspace_missing");
      if (
        workspace.leased ||
        (workspace.leasedByTaskId &&
          workspace.leasedByTaskId !== resolved.roveTaskId)
      )
        throw new Error("workspace_leased");
      workspace.leasedByTaskId = resolved.roveTaskId;
    } else {
      this.temporaryProfiles.add(resolved.roveTaskId);
    }
    const frozen = Object.freeze(clone(resolved));
    this.activeLaunches.set(resolved.roveTaskId, frozen);
    return frozen;
  }
  authorizeSessionStart(launch, request) {
    if (launch.roveTaskId !== request.roveTaskId)
      throw new Error("task_identity_mismatch");
    const active = this.activeLaunches.get(launch.roveTaskId);
    if (!active || !same(active, launch)) throw new Error("inactive_launch");
    if (launch.executionMode !== request.executionMode)
      throw new Error("execution_mode_mismatch");
    if (launch.browserIdentityMode !== request.browserIdentityMode)
      throw new Error("browser_identity_mismatch");
    if (launch.resolvedWorkspaceId !== request.resolvedWorkspaceId)
      throw new Error("workspace_identity_mismatch");
    return {
      initialController: launch.executionMode === "capture" ? "human" : "agent",
    };
  }
  close(launch) {
    const active = this.activeLaunches.get(launch.roveTaskId);
    if (!active || !same(active, launch))
      throw new Error("active_launch_mismatch");
    if (launch.browserIdentityMode === "workspace") {
      const workspace = this.workspaces.get(launch.resolvedWorkspaceId);
      if (workspace?.leasedByTaskId !== launch.roveTaskId)
        throw new Error("workspace_lease_mismatch");
      delete workspace.leasedByTaskId;
    } else {
      this.temporaryProfiles.delete(launch.roveTaskId);
    }
    this.activeLaunches.delete(launch.roveTaskId);
    return true;
  }
  serialize() {
    return JSON.stringify({
      workspaces: [...this.workspaces.values()],
      rememberedDefault: this.rememberedDefault,
      temporaryProfiles: [...this.temporaryProfiles],
      activeLaunches: [...this.activeLaunches.values()],
    });
  }
  static restore(schema, serialized) {
    const saved = JSON.parse(serialized);
    const authority = new TaskLaunchAuthority(
      schema,
      saved.workspaces,
      saved.rememberedDefault,
      saved.activeLaunches,
    );
    authority.temporaryProfiles = new Set(saved.temporaryProfiles);
    return authority;
  }
}
