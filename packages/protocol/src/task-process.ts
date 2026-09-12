import {
  reduceTaskLifecycle,
  parseNativeLifecycleCommandType,
  type NativeLifecycleCommandType,
  type NativeLifecycleInput,
  type NativeLifecycleOutput,
} from "./native-lifecycle-contract.js";

export type TaskProcessInputKind = "intent" | "fact";
export type TaskCommandStatus =
  | "pending"
  | "leased"
  | "accepted"
  | "possibly_started"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "reconcile_required";

export interface TaskProcessInput {
  schemaVersion: 1;
  inputId: string;
  taskId: string;
  kind: TaskProcessInputKind;
  source: string;
  sourceId: string;
  observedAt: string;
  lifecycle: NativeLifecycleInput;
  commandOutcome?: {
    commandId: string;
    status: "accepted" | "succeeded" | "failed" | "unresolved";
    detail?: Readonly<Record<string, unknown>>;
  };
  launchConfiguration?: Readonly<Record<string, unknown>>;
  durableData?: TaskProcessDurableData;
}

export type TaskProcessPortableValue =
  | null
  | boolean
  | number
  | string
  | readonly TaskProcessPortableValue[]
  | { readonly [key: string]: TaskProcessPortableValue };

export interface TaskProcessDurableContinuation {
  schemaVersion: 1;
  roveTaskId: string;
  codexThreadId: string;
  originatingCodexTurnId: string;
  roveSessionId: string;
  handoffId?: string;
  observationFingerprint?: string;
  handoffGeneration: number;
  requestedInstruction: string;
  continuationPolicy: "resume_after_control_return" | "explicit_user_response";
  status: "pending" | "consumed" | "cancelled" | "superseded";
  freshInspectionRequired: boolean;
  returnControlOperationId?: string;
  freshInspection?: {
    inspectionId: string;
    sessionId: string;
    handoffId: string;
    generation: number;
    afterObservationSeq: number;
  };
  preHandoffObservationSeq?: number;
  returnEventId?: string;
  returnObservationSeq?: number;
  continuationCommand?: {
    commandId: string;
    returnEventId: string;
    kind: "turn/start" | "turn/steer";
    dispatchStatus: "not_started" | "possibly_started" | "terminal";
    payload: {
      roveContinuationCommandId: string;
      authoredBy: "host";
      instruction: string;
    };
  };
  consumedEventId?: string;
}

export interface TaskProcessDurableAttention {
  schemaVersion: 1;
  authority: "codex" | "rove_control";
  kind:
    | "command_approval"
    | "file_approval"
    | "network_approval"
    | "permission_approval"
    | "mcp_elicitation"
    | "user_input"
    | "control_handoff";
  requestId: string;
  taskId: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  generation: number;
  payload: { readonly [key: string]: TaskProcessPortableValue };
  status:
    | "pending"
    | "responding"
    | "awaiting_confirmation"
    | "resolution_unknown"
    | "resolved"
    | "cancelled"
    | "stale";
  sequence: number;
  method?: string;
}

export interface TaskProcessDurableData {
  schemaVersion: 1;
  continuation?: TaskProcessDurableContinuation | null;
  attentions: readonly TaskProcessDurableAttention[];
  codexSessionId?: string | null;
}

const durableKeys = new Set([
  "schemaVersion",
  "continuation",
  "attentions",
  "codexSessionId",
]);

function durableRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactDurableKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key)))
    throw new Error(`${label} contains an unknown field.`);
}

function requiredDurableString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 65_536)
    throw new Error(`${label} is invalid.`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new Error(`${label} is invalid.`);
  return Number(value);
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error(`${label} is invalid.`);
  return Number(value);
}

function validatePortableValue(
  value: unknown,
  depth = 0,
): TaskProcessPortableValue {
  if (depth > 12)
    throw new Error("Portable lifecycle value is too deeply nested.");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value))
    return value.map((item) => validatePortableValue(item, depth + 1));
  const record = durableRecord(value, "Portable lifecycle value");
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      validatePortableValue(item, depth + 1),
    ]),
  );
}

export function validateTaskProcessDurableData(
  value: unknown,
  expected?: { taskId: string; sessionId?: string; threadId?: string },
): TaskProcessDurableData {
  const root = durableRecord(value, "Task durable data");
  if (
    Object.keys(root).some((key) => !durableKeys.has(key)) ||
    root.schemaVersion !== 1
  )
    throw new Error("Task durable data has an invalid schema.");
  if (!Array.isArray(root.attentions) || root.attentions.length > 100)
    throw new Error("Task durable attention collection is invalid.");
  let continuation: TaskProcessDurableContinuation | null | undefined;
  if (root.continuation !== undefined && root.continuation !== null) {
    const item = durableRecord(root.continuation, "Durable continuation");
    exactDurableKeys(
      item,
      [
        "schemaVersion",
        "roveTaskId",
        "codexThreadId",
        "originatingCodexTurnId",
        "roveSessionId",
        "handoffId",
        "observationFingerprint",
        "handoffGeneration",
        "requestedInstruction",
        "continuationPolicy",
        "status",
        "freshInspectionRequired",
        "returnControlOperationId",
        "freshInspection",
        "preHandoffObservationSeq",
        "returnEventId",
        "returnObservationSeq",
        "continuationCommand",
        "consumedEventId",
      ],
      "Durable continuation",
    );
    if (item.schemaVersion !== 1)
      throw new Error("Durable continuation version is invalid.");
    continuation = {
      ...(structuredClone(item) as unknown as TaskProcessDurableContinuation),
      schemaVersion: 1,
      roveTaskId: requiredDurableString(
        item.roveTaskId,
        "Continuation task identity",
      ),
      codexThreadId: requiredDurableString(
        item.codexThreadId,
        "Continuation thread identity",
      ),
      originatingCodexTurnId: requiredDurableString(
        item.originatingCodexTurnId,
        "Continuation turn identity",
      ),
      roveSessionId: requiredDurableString(
        item.roveSessionId,
        "Continuation session identity",
      ),
      handoffGeneration: positiveInteger(
        item.handoffGeneration,
        "Continuation generation",
      ),
      requestedInstruction: requiredDurableString(
        item.requestedInstruction,
        "Continuation instruction",
      ),
    };
    if (
      !["resume_after_control_return", "explicit_user_response"].includes(
        continuation.continuationPolicy,
      )
    )
      throw new Error("Continuation policy is invalid.");
    if (
      !["pending", "consumed", "cancelled", "superseded"].includes(
        continuation.status,
      )
    )
      throw new Error("Continuation status is invalid.");
    if (typeof continuation.freshInspectionRequired !== "boolean")
      throw new Error("Continuation inspection state is invalid.");
    for (const [label, field] of [
      ["Continuation handoff identity", continuation.handoffId],
      [
        "Continuation observation fingerprint",
        continuation.observationFingerprint,
      ],
      ["Continuation return operation", continuation.returnControlOperationId],
      ["Continuation return event", continuation.returnEventId],
      ["Continuation consumed event", continuation.consumedEventId],
    ] as const)
      if (field !== undefined) requiredDurableString(field, label);
    for (const [label, field] of [
      [
        "Continuation pre-handoff observation",
        continuation.preHandoffObservationSeq,
      ],
      ["Continuation return observation", continuation.returnObservationSeq],
    ] as const)
      if (field !== undefined) nonnegativeInteger(field, label);
    if (
      (continuation.returnEventId === undefined) !==
      (continuation.returnObservationSeq === undefined)
    )
      throw new Error(
        "Continuation return identity and sequence must be recorded together.",
      );
    if (continuation.freshInspection) {
      const proof = durableRecord(
        continuation.freshInspection,
        "Fresh inspection proof",
      );
      exactDurableKeys(
        proof,
        [
          "inspectionId",
          "sessionId",
          "handoffId",
          "generation",
          "afterObservationSeq",
        ],
        "Fresh inspection proof",
      );
      if (
        requiredDurableString(proof.sessionId, "Inspection session") !==
          continuation.roveSessionId ||
        requiredDurableString(proof.handoffId, "Inspection handoff") !==
          continuation.handoffId ||
        positiveInteger(proof.generation, "Inspection generation") !==
          continuation.handoffGeneration
      )
        throw new Error(
          "Fresh inspection proof does not match its continuation.",
        );
      requiredDurableString(proof.inspectionId, "Inspection identity");
      nonnegativeInteger(
        proof.afterObservationSeq,
        "Inspection observation sequence",
      );
    }
    if (continuation.continuationCommand) {
      const prepared = durableRecord(
        continuation.continuationCommand,
        "Continuation command",
      );
      exactDurableKeys(
        prepared,
        ["commandId", "returnEventId", "kind", "dispatchStatus", "payload"],
        "Continuation command",
      );
      requiredDurableString(
        prepared.commandId,
        "Continuation command identity",
      );
      if (prepared.returnEventId !== continuation.returnEventId)
        throw new Error("Continuation command return identity is invalid.");
      if (
        !["turn/start", "turn/steer"].includes(String(prepared.kind)) ||
        !["not_started", "possibly_started", "terminal"].includes(
          String(prepared.dispatchStatus),
        )
      )
        throw new Error("Continuation command state is invalid.");
      validatePortableValue(prepared.payload);
    }
    if (
      expected &&
      (continuation.roveTaskId !== expected.taskId ||
        (expected.sessionId !== undefined &&
          continuation.roveSessionId !== expected.sessionId) ||
        (expected.threadId !== undefined &&
          continuation.codexThreadId !== expected.threadId))
    )
      throw new Error("Continuation identity does not match its task binding.");
  } else if (root.continuation === null) continuation = null;
  const seen = new Set<string>();
  const attentions = root.attentions.map((raw) => {
    const item = durableRecord(raw, "Durable attention");
    exactDurableKeys(
      item,
      [
        "schemaVersion",
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
      "Durable attention",
    );
    if (item.schemaVersion !== 1)
      throw new Error("Durable attention version is invalid.");
    const attention = {
      ...(structuredClone(item) as unknown as TaskProcessDurableAttention),
      schemaVersion: 1 as const,
      requestId: requiredDurableString(
        item.requestId,
        "Attention request identity",
      ),
      taskId: requiredDurableString(item.taskId, "Attention task identity"),
      generation: positiveInteger(item.generation, "Attention generation"),
      sequence: nonnegativeInteger(item.sequence, "Attention sequence"),
      payload: validatePortableValue(
        item.payload,
      ) as TaskProcessDurableAttention["payload"],
    };
    if (
      !["codex", "rove_control"].includes(attention.authority) ||
      ![
        "command_approval",
        "file_approval",
        "network_approval",
        "permission_approval",
        "mcp_elicitation",
        "user_input",
        "control_handoff",
      ].includes(attention.kind) ||
      ![
        "pending",
        "responding",
        "awaiting_confirmation",
        "resolution_unknown",
        "resolved",
        "cancelled",
        "stale",
      ].includes(attention.status)
    )
      throw new Error("Durable attention state is invalid.");
    for (const [label, field] of [
      ["Attention thread identity", attention.threadId],
      ["Attention turn identity", attention.turnId],
      ["Attention item identity", attention.itemId],
      ["Attention method", attention.method],
    ] as const)
      if (field !== undefined) requiredDurableString(field, label);
    if (expected && attention.taskId !== expected.taskId)
      throw new Error("Attention identity does not match its task binding.");
    if (
      expected?.threadId !== undefined &&
      attention.threadId !== undefined &&
      attention.threadId !== expected.threadId
    )
      throw new Error("Attention thread does not match its task binding.");
    if (attention.authority === "rove_control") {
      if (
        attention.kind !== "control_handoff" ||
        !continuation ||
        attention.generation !== continuation.handoffGeneration ||
        attention.threadId !== continuation.codexThreadId ||
        attention.payload.handoffId !== continuation.handoffId
      )
        throw new Error("Rove attention does not match its durable handoff.");
    } else if (!attention.threadId)
      throw new Error("Codex attention lacks its bound thread identity.");
    const key = `${attention.authority}:${attention.requestId}`;
    if (seen.has(key)) throw new Error("Duplicate durable attention identity.");
    seen.add(key);
    return attention;
  });
  const codexSessionId =
    root.codexSessionId === undefined || root.codexSessionId === null
      ? (root.codexSessionId as undefined | null)
      : requiredDurableString(root.codexSessionId, "Codex session identity");
  return {
    schemaVersion: 1,
    attentions,
    ...(continuation === undefined ? {} : { continuation }),
    ...(codexSessionId === undefined ? {} : { codexSessionId }),
  };
}

export function emptyTaskProcessDurableData(): TaskProcessDurableData {
  return { schemaVersion: 1, attentions: [] };
}

export interface TaskProcessProjection {
  schemaVersion: 1;
  taskId: string;
  sequence: number;
  phase: NativeLifecycleOutput["phase"];
  allowedActions: NativeLifecycleOutput["allowedActions"];
  attention: NativeLifecycleOutput["attention"];
  operationDisposition: NativeLifecycleOutput["operationDisposition"];
}

export interface TaskProcessCommand {
  schemaVersion: 1;
  commandId: string;
  taskId: string;
  sequence: number;
  type: NativeLifecycleCommandType;
  payload: Readonly<Record<string, unknown>>;
  status: TaskCommandStatus;
  attempts: number;
  createdAt: string;
  claimedFrom?: "pending" | "reconcile_required";
}

export interface TaskProcessDecision {
  duplicate: boolean;
  input: TaskProcessInput;
  output: NativeLifecycleOutput;
  record: NativeLifecycleInput["record"];
  lifecycle: NativeLifecycleInput;
  durableData: TaskProcessDurableData;
  projection: TaskProcessProjection;
  command: TaskProcessCommand | null;
}

export interface TaskProcessState {
  taskId: string;
  lifecycle: NativeLifecycleInput;
  projection: TaskProcessProjection;
  launchConfiguration: Readonly<Record<string, unknown>> | null;
  durableData: TaskProcessDurableData;
}

export function validateTaskProcessDecision(
  value: unknown,
): TaskProcessDecision {
  const root = durableRecord(value, "Task process decision");
  exactDurableKeys(
    root,
    [
      "duplicate",
      "input",
      "output",
      "record",
      "lifecycle",
      "durableData",
      "projection",
      "command",
    ],
    "Task process decision",
  );
  const decision = structuredClone(root) as unknown as TaskProcessDecision;
  if (typeof decision.duplicate !== "boolean")
    throw new Error("Task process decision duplicate flag is invalid.");
  const input = durableRecord(decision.input, "Task process input");
  if (input.schemaVersion !== 1)
    throw new Error("Task process input version is invalid.");
  const taskId = requiredDurableString(input.taskId, "Task identity");
  const lifecycle = structuredClone(decision.lifecycle);
  const reduced = reduceTaskLifecycle(lifecycle);
  if (reduced.taskId !== null && reduced.taskId !== taskId)
    throw new Error("Task process lifecycle identity is invalid.");
  if (decision.record?.identity.taskId !== taskId)
    throw new Error("Task process record identity is invalid.");
  decision.durableData = validateTaskProcessDurableData(decision.durableData, {
    taskId,
    ...(decision.record?.identity.sessionId
      ? { sessionId: decision.record.identity.sessionId }
      : {}),
    ...(decision.record?.identity.threadId
      ? { threadId: decision.record.identity.threadId }
      : {}),
  });
  if (
    decision.projection.taskId !== taskId ||
    decision.projection.schemaVersion !== 1
  )
    throw new Error("Task process projection identity is invalid.");
  if (decision.command) {
    if (
      decision.command.taskId !== taskId ||
      decision.command.schemaVersion !== 1
    )
      throw new Error("Task process command identity is invalid.");
    decision.command.type = parseNativeLifecycleCommandType(
      decision.command.type,
    );
    if (decision.command.payload.type !== decision.command.type)
      throw new Error("Task process command payload is invalid.");
  }
  return decision;
}

export interface TaskTransaction {
  findInput(
    taskId: string,
    inputId: string,
  ): Promise<TaskProcessDecision | null>;
  currentSequence(taskId: string): Promise<number>;
  currentRecord(taskId: string): Promise<NativeLifecycleInput["record"]>;
  currentLifecycle(taskId: string): Promise<NativeLifecycleInput | null>;
  currentDurableData(taskId: string): Promise<TaskProcessDurableData>;
  commitDecision(decision: TaskProcessDecision): Promise<void>;
}

/** Storage-neutral durable lifecycle boundary. SQLite and a future PostgreSQL
 * implementation must satisfy the same transaction contract. */
export interface TaskStore {
  transact<T>(operation: (tx: TaskTransaction) => Promise<T>): Promise<T>;
  claimDueCommands(
    workerId: string,
    generation: number,
    limit: number,
  ): Promise<TaskProcessCommand[]>;
  markCommand(
    commandId: string,
    status: TaskCommandStatus,
    fact?: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  projection(taskId: string): Promise<TaskProcessProjection | null>;
  lifecycle(taskId: string): Promise<NativeLifecycleInput | null>;
  launchConfiguration(
    taskId: string,
  ): Promise<Readonly<Record<string, unknown>> | null>;
  taskState(taskId: string): Promise<TaskProcessState | null>;
  states(): Promise<TaskProcessState[]>;
}

function stableCommandId(
  taskId: string,
  inputId: string,
  sequence: number,
  _command: Readonly<Record<string, unknown>>,
): string {
  return `command:${taskId}:${sequence}:${inputId}`;
}

function applyReducerTransition(
  input: NativeLifecycleInput,
  output: NativeLifecycleOutput,
  observedAt: string,
): NativeLifecycleInput {
  const next = structuredClone(input);
  const record = structuredClone(input.record);
  next.record = record;
  if (!record || !output.nextCommand) return next;
  const command = output.nextCommand;
  switch (command.type) {
    case "persist_close_intent":
      if (typeof command.operationId !== "string")
        throw new Error("Close intent command lacks an operation identity.");
      record.desiredState = "closed";
      record.closeOperation = {
        operationId: command.operationId,
        requestedAt: observedAt,
        stage: "requested",
      };
      break;
    case "advance_close_stage":
      if (!record.closeOperation)
        throw new Error("Close stage command lacks a durable close intent.");
      record.closeOperation.stage =
        command.stage as typeof record.closeOperation.stage;
      record.closeOperation.lastAttemptAt = observedAt;
      break;
    case "advance_bootstrap_stage":
      record.bootstrap.stage = command.stage as typeof record.bootstrap.stage;
      break;
    case "bind_runtime_identity":
      if (typeof command.returnedSessionId !== "string")
        throw new Error("Runtime binding command lacks returned identity.");
      record.identity.sessionId = command.returnedSessionId;
      record.bootstrap.stage = "runtime_bound";
      break;
    case "bind_codex_identity":
      if (typeof command.returnedThreadId !== "string")
        throw new Error("Codex binding command lacks returned identity.");
      record.identity.threadId = command.returnedThreadId;
      record.bootstrap.stage = "complete";
      break;
    case "settle_continuation_attention":
      if (next.continuation.status === "pending")
        next.continuation.status = "cancelled";
      next.attentions = next.attentions.map((attention) =>
        ["resolved", "cancelled", "stale"].includes(attention.status)
          ? attention
          : { ...attention, status: "cancelled" as const },
      );
      break;
    case "record_return_event": {
      const returnEventId =
        typeof command.returnEventId === "string"
          ? command.returnEventId
          : next.continuation.returnEventId;
      const returnObservationSeq =
        typeof command.returnObservationSeq === "number"
          ? command.returnObservationSeq
          : next.runtime.observationSeq;
      if (!returnEventId || returnObservationSeq === undefined)
        throw new Error("Return event command lacks durable identities.");
      next.continuation = {
        ...next.continuation,
        freshInspectionRequired: false,
        returnEventId,
        returnObservationSeq,
      };
      break;
    }
    case "prepare_continuation_command": {
      // The adapter derives start versus steer from current Codex truth and
      // returns the exact prepared command as a durable fact.
      break;
    }
    case "persist_continuation_dispatch_intent":
      if (!next.continuation.command)
        throw new Error("Continuation dispatch intent lacks a command.");
      next.continuation.command.dispatchStatus = "possibly_started";
      break;
  }
  next.record = record;
  return next;
}

/** The only component allowed to select cross-component lifecycle commands. */
export class TaskProcessManager {
  constructor(private readonly store: TaskStore) {}

  accept(input: TaskProcessInput): Promise<TaskProcessDecision> {
    if (input.commandOutcome && input.kind !== "fact")
      throw new Error("Command outcomes must be accepted as facts.");
    if (input.commandOutcome && input.commandOutcome.commandId.length === 0)
      throw new Error("Command outcome lacks a command identity.");
    return this.store.transact(async (tx) => {
      const duplicate = await tx.findInput(input.taskId, input.inputId);
      if (duplicate) return { ...duplicate, duplicate: true };
      const sequence = (await tx.currentSequence(input.taskId)) + 1;
      const currentRecord = await tx.currentRecord(input.taskId);
      const currentDurableData = validateTaskProcessDurableData(
        await tx.currentDurableData(input.taskId),
        {
          taskId: input.taskId,
          ...(currentRecord?.identity.sessionId
            ? { sessionId: currentRecord.identity.sessionId }
            : {}),
          ...(currentRecord?.identity.threadId
            ? { threadId: currentRecord.identity.threadId }
            : {}),
        },
      );
      // Compatibility-only boundary. A supplied snapshot replaces exactly;
      // empty and none never mean "retain prior". Production uses TaskEvent.
      const lifecycle = structuredClone(input.lifecycle);
      const acceptedInput = { ...input, lifecycle };
      const output = reduceTaskLifecycle(lifecycle);
      if (output.taskId !== null && output.taskId !== input.taskId)
        throw new Error(
          "Lifecycle reducer returned a different task identity.",
        );
      const projection: TaskProcessProjection = {
        schemaVersion: 1,
        taskId: input.taskId,
        sequence,
        phase: output.phase,
        allowedActions: output.allowedActions,
        attention: output.attention,
        operationDisposition: output.operationDisposition,
      };
      const command =
        output.nextCommand === null ||
        input.commandOutcome?.status === "accepted" ||
        input.commandOutcome?.status === "failed" ||
        input.commandOutcome?.status === "unresolved"
          ? null
          : {
              schemaVersion: 1 as const,
              commandId: stableCommandId(
                input.taskId,
                input.inputId,
                sequence,
                output.nextCommand,
              ),
              taskId: input.taskId,
              sequence,
              type: output.nextCommand.type,
              payload: output.nextCommand,
              status: "pending" as const,
              attempts: 0,
              createdAt: input.observedAt,
            };
      const nextLifecycle = applyReducerTransition(
        lifecycle,
        output,
        input.observedAt,
      );
      const durableData = validateTaskProcessDurableData(
        input.durableData ?? currentDurableData,
        {
          taskId: input.taskId,
          ...(nextLifecycle.record?.identity.sessionId
            ? { sessionId: nextLifecycle.record.identity.sessionId }
            : {}),
          ...(nextLifecycle.record?.identity.threadId
            ? { threadId: nextLifecycle.record.identity.threadId }
            : {}),
        },
      );
      const decision: TaskProcessDecision = {
        duplicate: false,
        input: acceptedInput,
        output,
        record: nextLifecycle.record,
        lifecycle: nextLifecycle,
        durableData,
        projection,
        command,
      };
      await tx.commitDecision(decision);
      return decision;
    });
  }
}

interface MemoryStoreState {
  sequence: Map<string, number>;
  decisions: Map<string, TaskProcessDecision>;
  projections: Map<string, TaskProcessProjection>;
  commands: Map<string, TaskProcessCommand>;
}

/** Deterministic contract adapter used to keep SQL-specific behavior out of
 * the process manager and to qualify future durable store implementations. */
export class MemoryTaskStore implements TaskStore {
  private state: MemoryStoreState = {
    sequence: new Map(),
    decisions: new Map(),
    projections: new Map(),
    commands: new Map(),
  };
  private queue: Promise<void> = Promise.resolve();

  async transact<T>(
    operation: (tx: TaskTransaction) => Promise<T>,
  ): Promise<T> {
    let result!: T;
    const run = this.queue.then(async () => {
      const draft = structuredClone(this.state);
      const tx: TaskTransaction = {
        findInput: async (taskId, inputId) =>
          structuredClone(draft.decisions.get(`${taskId}\0${inputId}`) ?? null),
        currentSequence: async (taskId) => draft.sequence.get(taskId) ?? 0,
        currentRecord: async (taskId) => {
          const decisions = [...draft.decisions.values()]
            .filter((decision) => decision.input.taskId === taskId)
            .sort(
              (left, right) =>
                right.projection.sequence - left.projection.sequence,
            );
          return structuredClone(decisions[0]?.lifecycle.record ?? null);
        },
        currentLifecycle: async (taskId) => {
          const decisions = [...draft.decisions.values()]
            .filter((decision) => decision.input.taskId === taskId)
            .sort(
              (left, right) =>
                right.projection.sequence - left.projection.sequence,
            );
          return structuredClone(decisions[0]?.lifecycle ?? null);
        },
        currentDurableData: async (taskId) => {
          const decisions = [...draft.decisions.values()]
            .filter((decision) => decision.input.taskId === taskId)
            .sort(
              (left, right) =>
                right.projection.sequence - left.projection.sequence,
            );
          return structuredClone(
            decisions[0]?.durableData ?? emptyTaskProcessDurableData(),
          );
        },
        commitDecision: async (decision) => {
          const outcome = decision.input.commandOutcome;
          if (outcome) {
            const prior = draft.commands.get(outcome.commandId);
            if (!prior) throw new Error("Task command was not found.");
            const terminalStatus =
              outcome.status === "unresolved"
                ? "reconcile_required"
                : outcome.status;
            const allowed =
              outcome.status === "accepted"
                ? prior.status === "leased"
                : outcome.status === "unresolved"
                  ? ["leased", "accepted", "possibly_started"].includes(
                      prior.status,
                    )
                  : ["accepted", "possibly_started"].includes(prior.status);
            if (!allowed)
              throw new Error(
                `Illegal task command fact ${prior.status} -> ${terminalStatus}.`,
              );
            draft.commands.set(outcome.commandId, {
              ...prior,
              status: terminalStatus,
            });
          }
          draft.sequence.set(
            decision.input.taskId,
            decision.projection.sequence,
          );
          draft.decisions.set(
            `${decision.input.taskId}\0${decision.input.inputId}`,
            structuredClone(decision),
          );
          draft.projections.set(
            decision.input.taskId,
            structuredClone(decision.projection),
          );
          if (decision.command)
            draft.commands.set(
              decision.command.commandId,
              structuredClone(decision.command),
            );
        },
      };
      result = await operation(tx);
      this.state = draft;
    });
    this.queue = run.catch(() => undefined);
    await run;
    return result;
  }

  async claimDueCommands(
    _workerId: string,
    _generation: number,
    limit: number,
  ): Promise<TaskProcessCommand[]> {
    const claimed = [...this.state.commands.values()]
      .filter(
        (command) =>
          command.status === "pending" ||
          command.status === "reconcile_required",
      )
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, limit)
      .map((command) => ({
        ...command,
        claimedFrom: command.status as "pending" | "reconcile_required",
        status: "leased" as const,
        attempts: command.attempts + 1,
      }));
    for (const command of claimed)
      this.state.commands.set(command.commandId, structuredClone(command));
    return structuredClone(claimed);
  }

  async markCommand(
    commandId: string,
    status: TaskCommandStatus,
    _fact?: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const command = this.state.commands.get(commandId);
    if (!command) throw new Error("Task command was not found.");
    const allowed: Record<TaskCommandStatus, readonly TaskCommandStatus[]> = {
      pending: ["leased", "cancelled"],
      leased: ["accepted", "reconcile_required"],
      accepted: ["possibly_started", "failed", "reconcile_required"],
      possibly_started: ["succeeded", "failed", "reconcile_required"],
      succeeded: [],
      failed: [],
      cancelled: [],
      reconcile_required: ["leased", "cancelled"],
    };
    if (!allowed[command.status].includes(status))
      throw new Error(
        `Illegal task command transition ${command.status} -> ${status}.`,
      );
    this.state.commands.set(commandId, { ...command, status });
  }

  async projection(taskId: string): Promise<TaskProcessProjection | null> {
    return structuredClone(this.state.projections.get(taskId) ?? null);
  }

  async lifecycle(taskId: string): Promise<NativeLifecycleInput | null> {
    const decisions = [...this.state.decisions.values()]
      .filter((decision) => decision.input.taskId === taskId)
      .sort(
        (left, right) => right.projection.sequence - left.projection.sequence,
      );
    const decision = decisions[0];
    return decision
      ? structuredClone({
          ...decision.lifecycle,
        })
      : null;
  }

  async launchConfiguration(
    taskId: string,
  ): Promise<Readonly<Record<string, unknown>> | null> {
    const decisions = [...this.state.decisions.values()]
      .filter(
        (decision) =>
          decision.input.taskId === taskId &&
          decision.input.launchConfiguration !== undefined,
      )
      .sort(
        (left, right) => right.projection.sequence - left.projection.sequence,
      );
    return structuredClone(decisions[0]?.input.launchConfiguration ?? null);
  }

  async taskState(taskId: string): Promise<TaskProcessState | null> {
    const lifecycle = await this.lifecycle(taskId);
    const projection = await this.projection(taskId);
    if (!lifecycle || !projection) return null;
    const latest = [...this.state.decisions.values()]
      .filter((decision) => decision.input.taskId === taskId)
      .sort(
        (left, right) => right.projection.sequence - left.projection.sequence,
      )[0];
    return {
      taskId,
      lifecycle,
      projection,
      launchConfiguration: await this.launchConfiguration(taskId),
      durableData: latest?.durableData ?? emptyTaskProcessDurableData(),
    };
  }

  async states(): Promise<TaskProcessState[]> {
    const taskIds = [...this.state.projections.keys()].sort();
    return (
      await Promise.all(taskIds.map((taskId) => this.taskState(taskId)))
    ).filter((entry): entry is TaskProcessState => entry !== null);
  }
}
