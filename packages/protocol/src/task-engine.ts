import {
  NATIVE_LIFECYCLE_COMMAND_TYPES,
  reduceLifecycleInventory,
  reduceTaskLifecycle,
  type NativeAttentionTruth,
  type NativeBrowserIdentity,
  type NativeCodexTruth,
  type NativeContinuationTruth,
  type NativeFreshInspectionProof,
  type NativeLifecycleCommandType,
  type NativeLifecycleInput,
  type NativeLifecycleOutput,
  type NativeRequestedOperation,
  type NativeRuntimeTruth,
  type NativeTaskRecord,
} from "./native-lifecycle-contract.js";

export type TaskPortableValue =
  | null
  | boolean
  | number
  | string
  | readonly TaskPortableValue[]
  | { readonly [key: string]: TaskPortableValue };

export interface TaskEventSource {
  kind: "product" | "codex" | "runtime" | "worker" | "migration" | "host";
  id: string;
  generation: number;
  position: number;
}

interface TaskEventBase {
  schemaVersion: 1;
  eventId: string;
  taskId: string;
  source: TaskEventSource;
  observedAt: string;
}

export interface TaskLaunchConfiguration {
  operationId: string;
  bootstrapId: string;
  requestedAt: string;
  outcome: string;
  executionMode: "agent" | "companion" | "capture";
  browserIdentity?: NativeBrowserIdentity;
  approvalsReviewer: "auto_review" | "user";
  cwd: string;
  model?: string;
  reasoningEffort?: string;
  attachmentIds: readonly string[];
  workflowAssociation?: {
    workflowId: string;
    workflowName: string;
  };
  workflowContext?: TaskWorkflowContextSnapshot;
}

export interface TaskWorkflowContextSnapshot {
  workflowId: string;
  workflowName: string;
  revision: number;
  digest: string;
  developerInstructions: string;
}

export interface TaskSelectedResultContextSnapshot {
  resultIds: readonly string[];
  digest: string;
  developerInstructions: string;
}

export interface TaskConversationItem {
  id: string;
  turnId: string;
  clientId?: string;
  attachments?: readonly {
    filename: string;
    kind: "file" | "image" | "audio";
  }[];
  kind:
    | "user_message"
    | "assistant_message"
    | "plan"
    | "command"
    | "file_change"
    | "tool"
    | "other";
  status: "started" | "completed";
  phase?: "commentary" | "final_answer";
  startedAt?: string;
  completedAt?: string;
  text?: string;
  title?: string;
  progress?: string;
}

export interface TaskCompletedHandoff {
  sessionId: string;
  handoffId: string;
  handoffGeneration: number;
  ownershipGeneration: number;
  controller: NativeRuntimeTruth["controller"];
  status: NativeRuntimeTruth["status"];
  continuation: NativeContinuationTruth;
  attention: NativeAttentionTruth;
}

export interface TaskMessageDeliveryEvidence {
  operationId: string;
  threadId: string;
  turnId?: string;
  state:
    | "dispatch_not_started"
    | "transport_may_have_received"
    | "acceptance_observed"
    | "message_materialized"
    | "non_submission_established"
    | "unresolved";
  connectionGeneration: number;
  observedAt: string;
}

export type TaskEvent =
  | (TaskEventBase & {
      type: "task_launch_requested";
      operationId: string;
      launch: TaskLaunchConfiguration;
    })
  | (TaskEventBase & {
      type: "task_message_requested";
      operationId: string;
      message: string;
      expectedTurnId?: string;
      attachmentIds?: readonly string[];
      workflowContext?: TaskWorkflowContextSnapshot;
      selectedResultContext?: TaskSelectedResultContextSnapshot;
    })
  | (TaskEventBase & {
      type: "task_return_requested";
      operationId: string;
    })
  | (TaskEventBase & {
      type: "task_interrupt_requested";
      operationId: string;
    })
  | (TaskEventBase & {
      type: "task_finish_requested";
      operationId: string;
    })
  | (TaskEventBase & {
      type: "task_cleanup_retry_requested";
      operationId: string;
    })
  | (TaskEventBase & {
      type: "task_archive_requested" | "task_unarchive_requested";
      operationId: string;
    })
  | (TaskEventBase & {
      type: "attention_response_requested";
      operationId: string;
      requestId: string;
      generation: number;
      response: TaskPortableValue;
    })
  | (TaskEventBase & {
      type: "explicit_continuation_response_requested";
      operationId: string;
      message: string;
      attachmentIds?: readonly string[];
      workflowContext?: TaskWorkflowContextSnapshot;
      selectedResultContext?: TaskSelectedResultContextSnapshot;
    })
  | (TaskEventBase & {
      type: "codex_availability_observed";
      availability: NativeCodexTruth["availability"];
    })
  | (TaskEventBase & {
      type: "codex_thread_observed";
      thread: NativeCodexTruth;
      codexSessionId?: string;
    })
  | (TaskEventBase & {
      type: "codex_turn_observed";
      turn: Pick<NativeCodexTruth, "turn" | "turnId" | "runtimeStatus">;
      threadId: string;
    })
  | (TaskEventBase & {
      type: "codex_item_observed";
      threadId: string;
      turnId: string;
      itemId: string;
      terminal: boolean;
      item?: TaskConversationItem;
      completedHandoff?: TaskCompletedHandoff;
    })
  | (TaskEventBase & {
      type: "codex_request_observed";
      attentions: readonly NativeAttentionTruth[];
    })
  | (TaskEventBase & {
      type: "codex_request_resolved";
      requestId: string;
      threadId: string;
      generation: number;
      resolution: "resolved" | "cancelled" | "stale";
    })
  | (TaskEventBase & {
      type: "codex_message_delivery_observed";
      delivery: TaskMessageDeliveryEvidence;
    })
  | (TaskEventBase & {
      type: "runtime_inventory_observed";
      runtime: NativeRuntimeTruth;
    })
  | (TaskEventBase & {
      type: "runtime_control_observed";
      sessionId: string;
      controller: NativeRuntimeTruth["controller"];
      status: NativeRuntimeTruth["status"];
      ownershipGeneration: number;
      observationSeq?: number;
    })
  | (TaskEventBase & {
      type: "runtime_handoff_observed";
      sessionId: string;
      handoffId: string;
      handoffGeneration: number;
      ownershipGeneration: number;
      controller: NativeRuntimeTruth["controller"];
      status: NativeRuntimeTruth["status"];
      continuation: NativeContinuationTruth;
      attention: NativeAttentionTruth | null;
    })
  | (TaskEventBase & {
      type: "command_outcome_observed";
      commandId: string;
      status: "succeeded" | "failed" | "unresolved";
      facts: readonly TaskObservedFact[];
      detail?: Readonly<Record<string, TaskPortableValue>>;
    })
  | (TaskEventBase & {
      type: "attachment_state_observed";
      ready: boolean;
      attachmentIds: readonly string[];
    })
  | (TaskEventBase & {
      type: "task_capability_observed";
      fingerprint: string;
    })
  | (TaskEventBase & {
      type: "host_generation_changed";
      component: "codex" | "runtime";
      generation: number;
    });

export type TaskIntent = Extract<
  TaskEvent,
  {
    type:
      | "task_launch_requested"
      | "task_message_requested"
      | "task_return_requested"
      | "task_interrupt_requested"
      | "task_finish_requested"
      | "task_cleanup_retry_requested"
      | "task_archive_requested"
      | "task_unarchive_requested"
      | "attention_response_requested"
      | "explicit_continuation_response_requested";
  }
>;

export type TaskObservedFact = Exclude<TaskEvent, TaskIntent>;

export interface TaskAggregate {
  schemaVersion: 1;
  taskId: string;
  revision: number;
  launch: TaskLaunchConfiguration | null;
  desiredState: "open" | "closed";
  record: NativeTaskRecord | null;
  codex: NativeCodexTruth;
  codexSessionId: string | null;
  runtime: NativeRuntimeTruth;
  continuation: NativeContinuationTruth;
  attentions: readonly NativeAttentionTruth[];
  freshInspection: NativeFreshInspectionProof | null;
  attachment: { ready: boolean; attachmentIds: readonly string[] };
  capabilityFingerprint: string | null;
  conversation: {
    items: Readonly<Record<string, TaskConversationItem>>;
    turnOrder: readonly string[];
  };
  messageDeliveries: Readonly<Record<string, TaskMessageDeliveryEvidence>>;
  requestedOperation: NativeRequestedOperation;
  processorGeneration: number;
  sourcePositions: Readonly<
    Record<string, { generation: number; position: number }>
  >;
  recoveryRequired: string | null;
}

export interface TaskProjection {
  schemaVersion: 1;
  taskId: string;
  revision: number;
  phase: NativeLifecycleOutput["phase"];
  allowedActions: NativeLifecycleOutput["allowedActions"];
  attention: NativeLifecycleOutput["attention"];
  operationDisposition: NativeLifecycleOutput["operationDisposition"];
  codex: NativeCodexTruth;
  runtime: NativeRuntimeTruth;
  attentions: readonly NativeAttentionTruth[];
  conversation: TaskAggregate["conversation"];
  messageDeliveries: TaskAggregate["messageDeliveries"];
  recoveryRequired: string | null;
}

export type TaskCommandExecutionClass =
  "pure_ledger" | "repeatable_read" | "correlated_write" | "uncertain_write";

export interface TaskCommandClassification {
  execute: TaskCommandExecutionClass;
  reconcile: "not_required" | "read_truth" | "correlate_receipt";
}

export const TASK_COMMAND_MANIFEST = {
  persist_bootstrap_intent: {
    execute: "pure_ledger",
    reconcile: "not_required",
  },
  lookup_or_start_runtime: {
    execute: "uncertain_write",
    reconcile: "correlate_receipt",
  },
  bind_runtime_identity: { execute: "pure_ledger", reconcile: "not_required" },
  lookup_or_start_codex_thread: {
    execute: "uncertain_write",
    reconcile: "correlate_receipt",
  },
  bind_codex_identity: { execute: "pure_ledger", reconcile: "not_required" },
  advance_bootstrap_stage: {
    execute: "pure_ledger",
    reconcile: "not_required",
  },
  read_codex_thread: { execute: "repeatable_read", reconcile: "read_truth" },
  read_runtime_inventory: {
    execute: "repeatable_read",
    reconcile: "read_truth",
  },
  read_lifecycle_truth: { execute: "repeatable_read", reconcile: "read_truth" },
  persist_close_intent: { execute: "pure_ledger", reconcile: "not_required" },
  interrupt_codex_turn: { execute: "uncertain_write", reconcile: "read_truth" },
  settle_continuation_attention: {
    execute: "pure_ledger",
    reconcile: "not_required",
  },
  end_runtime_session: { execute: "uncertain_write", reconcile: "read_truth" },
  advance_close_stage: { execute: "pure_ledger", reconcile: "not_required" },
  relaunch_named_browser: {
    execute: "uncertain_write",
    reconcile: "correlate_receipt",
  },
  resume_codex_thread: { execute: "uncertain_write", reconcile: "read_truth" },
  unarchive_codex_thread: {
    execute: "uncertain_write",
    reconcile: "read_truth",
  },
  recover_codex_thread: { execute: "uncertain_write", reconcile: "read_truth" },
  inspect_after_return: { execute: "repeatable_read", reconcile: "read_truth" },
  record_return_event: { execute: "pure_ledger", reconcile: "not_required" },
  prepare_continuation_command: {
    execute: "pure_ledger",
    reconcile: "not_required",
  },
  persist_continuation_dispatch_intent: {
    execute: "pure_ledger",
    reconcile: "not_required",
  },
  dispatch_or_reconcile_continuation: {
    execute: "uncertain_write",
    reconcile: "correlate_receipt",
  },
  reconcile_continuation_dispatch: {
    execute: "repeatable_read",
    reconcile: "read_truth",
  },
  respond_continuation_explicit: {
    execute: "correlated_write",
    reconcile: "correlate_receipt",
  },
  reconcile_attention_response: {
    execute: "repeatable_read",
    reconcile: "read_truth",
  },
  start_or_steer_codex_turn: {
    execute: "correlated_write",
    reconcile: "correlate_receipt",
  },
  return_runtime_ownership: {
    execute: "uncertain_write",
    reconcile: "read_truth",
  },
  respond_codex_attention: {
    execute: "uncertain_write",
    reconcile: "read_truth",
  },
  archive_codex_thread: { execute: "uncertain_write", reconcile: "read_truth" },
} as const satisfies Record<
  NativeLifecycleCommandType,
  TaskCommandClassification
>;

type MissingCommands = Exclude<
  NativeLifecycleCommandType,
  keyof typeof TASK_COMMAND_MANIFEST
>;
type ExtraCommands = Exclude<
  keyof typeof TASK_COMMAND_MANIFEST,
  NativeLifecycleCommandType
>;
export const TASK_COMMAND_MANIFEST_COMPLETE: MissingCommands extends never
  ? ExtraCommands extends never
    ? true
    : never
  : never = true;

if (
  NATIVE_LIFECYCLE_COMMAND_TYPES.some(
    (type) => TASK_COMMAND_MANIFEST[type] === undefined,
  )
)
  throw new Error("Native lifecycle command manifest is incomplete.");

export interface TaskCommand {
  schemaVersion: 1;
  commandId: string;
  taskId: string;
  aggregateRevision: number;
  type: NativeLifecycleCommandType;
  payload: NonNullable<NativeLifecycleOutput["nextCommand"]>;
  classification: TaskCommandClassification;
  status:
    | "pending"
    | "leased"
    | "possibly_started"
    | "reconcile_required"
    | "succeeded"
    | "failed"
    | "cancelled";
  attempts: number;
  createdAt: string;
  claimedFrom?: "pending" | "reconcile_required";
}

export interface TaskAcceptance {
  duplicate: boolean;
  aggregate: TaskAggregate;
  projection: TaskProjection;
  command: TaskCommand | null;
}

export interface TaskEngineTransaction {
  event(
    taskId: string,
    eventId: string,
  ): Promise<{ digest: string; acceptance: TaskAcceptance } | null>;
  sourceEvent(
    taskId: string,
    source: TaskEventSource,
  ): Promise<{
    eventId: string;
    digest: string;
    acceptance: TaskAcceptance;
  } | null>;
  aggregate(taskId: string): Promise<TaskAggregate | null>;
  command(commandId: string): Promise<TaskCommand | null>;
  activeCommand(taskId: string): Promise<TaskCommand | null>;
  commit(input: {
    event: TaskEvent;
    digest: string;
    acceptance: TaskAcceptance;
  }): Promise<void>;
}

export interface TaskEngineStore {
  transact<T>(
    taskId: string,
    operation: (tx: TaskEngineTransaction) => Promise<T>,
  ): Promise<T>;
  claimDueCommands(
    workerId: string,
    generation: number,
    limit: number,
    options?: { excludeTaskIds?: readonly string[] },
  ): Promise<TaskCommand[]>;
  projection(taskId: string): Promise<TaskProjection | null>;
  projections(): Promise<TaskProjection[]>;
  aggregate(taskId: string): Promise<TaskAggregate | null>;
  markPossiblyStarted(commandId: string): Promise<void>;
  markRecoveryRequired(taskId: string, reason: string): Promise<void>;
}

export function emptyTaskAggregate(taskId: string): TaskAggregate {
  return {
    schemaVersion: 1,
    taskId,
    revision: 0,
    launch: null,
    desiredState: "open",
    record: null,
    codex: {
      availability: "unavailable",
      threadExists: false,
      sourceLookup: "unknown",
      runtimeStatus: "unknown",
      archived: null,
      turn: "unknown",
    },
    codexSessionId: null,
    runtime: {
      availability: "unavailable",
      sessionExists: false,
      bootstrapLookup: "unknown",
      status: "unknown",
      controller: null,
      attachment: "unknown",
      profileLock: "unknown",
      recovery: "unknown",
    },
    continuation: { status: "none" },
    attentions: [],
    freshInspection: null,
    attachment: { ready: true, attachmentIds: [] },
    capabilityFingerprint: null,
    conversation: { items: {}, turnOrder: [] },
    messageDeliveries: {},
    requestedOperation: { type: "observe", taskId },
    processorGeneration: 1,
    sourcePositions: {},
    recoveryRequired: null,
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

export function taskEventDigest(event: TaskEvent): string {
  const { observedAt: _observedAt, ...normalized } = structuredClone(event);
  void _observedAt;
  if (normalized.type !== "task_launch_requested") return canonical(normalized);
  const { requestedAt: _requestedAt, ...launch } = normalized.launch;
  void _requestedAt;
  return canonical({ ...normalized, launch });
}

function requireIdentity(value: string, label: string): void {
  if (value.length < 1 || value.length > 512)
    throw new Error(`${label} is invalid.`);
}

function validateWorkflowContextSnapshot(
  value: TaskWorkflowContextSnapshot,
): void {
  requireIdentity(value.workflowId, "Workflow context identity");
  if (
    typeof value.workflowName !== "string" ||
    value.workflowName.trim().length < 1 ||
    Array.from(value.workflowName).length > 120
  )
    throw new Error("Workflow context name is invalid.");
  if (!Number.isSafeInteger(value.revision) || value.revision < 1)
    throw new Error("Workflow context revision is invalid.");
  if (!/^[a-f0-9]{64}$/.test(value.digest))
    throw new Error("Workflow context digest is invalid.");
  if (
    typeof value.developerInstructions !== "string" ||
    value.developerInstructions.length < 1 ||
    value.developerInstructions.length > 24_000
  )
    throw new Error("Workflow context instructions are invalid.");
}

function validateSelectedResultContextSnapshot(
  value: TaskSelectedResultContextSnapshot,
): void {
  if (
    !Array.isArray(value.resultIds) ||
    value.resultIds.length < 1 ||
    value.resultIds.length > 8 ||
    value.resultIds.some(
      (resultId) =>
        typeof resultId !== "string" ||
        resultId.trim().length < 1 ||
        resultId.length > 160,
    ) ||
    new Set(value.resultIds).size !== value.resultIds.length
  )
    throw new Error("Selected result context identities are invalid.");
  if (!/^[a-f0-9]{64}$/.test(value.digest))
    throw new Error("Selected result context digest is invalid.");
  if (
    typeof value.developerInstructions !== "string" ||
    value.developerInstructions.length < 1 ||
    value.developerInstructions.length > 16_000
  )
    throw new Error("Selected result context instructions are invalid.");
}

export function validateTaskEvent(event: TaskEvent): void {
  if (event.schemaVersion !== 1)
    throw new Error("Task event version is invalid.");
  requireIdentity(event.eventId, "Task event identity");
  requireIdentity(event.taskId, "Task identity");
  requireIdentity(event.source.id, "Task event source identity");
  if (
    !Number.isSafeInteger(event.source.generation) ||
    event.source.generation < 1
  )
    throw new Error("Task event source generation is invalid.");
  if (!Number.isSafeInteger(event.source.position) || event.source.position < 0)
    throw new Error("Task event source position is invalid.");
  if (!Number.isFinite(Date.parse(event.observedAt)))
    throw new Error("Task event timestamp is invalid.");
  const workflowContext =
    event.type === "task_launch_requested"
      ? event.launch.workflowContext
      : event.type === "task_message_requested" ||
          event.type === "explicit_continuation_response_requested"
        ? event.workflowContext
        : undefined;
  if (workflowContext) validateWorkflowContextSnapshot(workflowContext);
  const selectedResultContext =
    event.type === "task_message_requested" ||
    event.type === "explicit_continuation_response_requested"
      ? event.selectedResultContext
      : undefined;
  if (selectedResultContext)
    validateSelectedResultContextSnapshot(selectedResultContext);
  if (event.type === "codex_item_observed" && event.item?.clientId)
    requireIdentity(event.item.clientId, "Codex item client identity");
  if (event.type === "codex_item_observed" && event.item?.attachments) {
    if (
      event.item.attachments.length > 100 ||
      event.item.attachments.some(
        (attachment) =>
          attachment.filename.length < 1 ||
          attachment.filename.length > 255 ||
          !["file", "image", "audio"].includes(attachment.kind),
      )
    )
      throw new Error("Codex item attachments are invalid.");
  }
}

function recordMessageDelivery(
  aggregate: TaskAggregate,
  delivery: TaskMessageDeliveryEvidence,
): void {
  if (delivery.threadId !== aggregate.record?.identity.threadId)
    throw new Error("Message delivery targets a different thread.");
  const priorDelivery = aggregate.messageDeliveries[delivery.operationId];
  const allowed: Record<
    TaskMessageDeliveryEvidence["state"],
    readonly TaskMessageDeliveryEvidence["state"][]
  > = {
    dispatch_not_started: [
      "dispatch_not_started",
      "non_submission_established",
      "transport_may_have_received",
      "acceptance_observed",
      "message_materialized",
    ],
    transport_may_have_received: [
      "transport_may_have_received",
      "message_materialized",
      "unresolved",
    ],
    acceptance_observed: [
      "acceptance_observed",
      "message_materialized",
      "unresolved",
    ],
    message_materialized: ["message_materialized"],
    non_submission_established: [
      "non_submission_established",
      "acceptance_observed",
      "message_materialized",
    ],
    unresolved: ["unresolved", "message_materialized"],
  };
  if (
    priorDelivery?.turnId &&
    delivery.turnId &&
    priorDelivery.turnId !== delivery.turnId
  )
    throw new Error("Message delivery turn identity changed.");
  // An ordered App Server user-item event can prove materialization before
  // the initiating command returns. A later command result is weaker evidence
  // and must not move the durable state backwards.
  if (
    priorDelivery?.state === "message_materialized" &&
    delivery.state !== "message_materialized"
  )
    return;
  if (priorDelivery && !allowed[priorDelivery.state].includes(delivery.state))
    throw new Error("Message delivery evidence regressed.");
  aggregate.messageDeliveries = Object.fromEntries(
    [
      ...Object.entries(aggregate.messageDeliveries).filter(
        ([operationId]) => operationId !== delivery.operationId,
      ),
      [delivery.operationId, structuredClone(delivery)],
    ].slice(-128),
  );
}

function attentionIdentity(attention: NativeAttentionTruth): string {
  return `${attention.authority}:${attention.requestId}:${attention.generation}`;
}

function attentionDescriptor(attention: NativeAttentionTruth): string {
  const { status: _status, ...descriptor } = attention;
  void _status;
  return canonical(descriptor);
}

function isTerminalAttention(attention: NativeAttentionTruth): boolean {
  return ["resolved", "cancelled", "stale"].includes(attention.status);
}

/** A Codex request notification is an upsert for one exact request, not a
 * snapshot of every outstanding request on the connection. */
function upsertCodexAttentions(
  current: readonly NativeAttentionTruth[],
  observed: readonly NativeAttentionTruth[],
): NativeAttentionTruth[] {
  const merged = current.map((entry) => structuredClone(entry));
  const observedKeys = new Set<string>();
  for (const incoming of observed) {
    if (incoming.authority !== "codex" || incoming.status !== "pending")
      throw new Error("Codex request observation is invalid.");
    const identity = attentionIdentity(incoming);
    if (observedKeys.has(identity))
      throw new Error("Duplicate Codex request observation.");
    observedKeys.add(identity);
    const index = merged.findIndex(
      (entry) => attentionIdentity(entry) === identity,
    );
    if (index === -1) {
      merged.push(structuredClone(incoming));
      continue;
    }
    const existing = merged[index]!;
    if (attentionDescriptor(existing) !== attentionDescriptor(incoming))
      throw new Error("Codex request identity collision.");
    // Repeated delivery of the same request is idempotent. In particular, it
    // cannot move an already responding or terminal request back to pending.
    continue;
  }
  while (merged.length > 32) {
    const terminalIndex = merged.findIndex(
      (entry) => entry.authority === "codex" && isTerminalAttention(entry),
    );
    if (terminalIndex === -1)
      throw new Error("Attention collection is invalid or exceeds its bound.");
    merged.splice(terminalIndex, 1);
  }
  return merged;
}

function operation(event: TaskEvent): NativeRequestedOperation | null {
  switch (event.type) {
    case "task_launch_requested":
      return {
        type: "launch",
        taskId: event.taskId,
        operationId: event.operationId,
      };
    case "task_message_requested":
      return {
        type: "message",
        taskId: event.taskId,
        operationId: event.operationId,
        message: event.message,
        ...(event.expectedTurnId
          ? { expectedTurnId: event.expectedTurnId }
          : {}),
        ...(event.attachmentIds?.length
          ? { attachmentIds: [...event.attachmentIds] }
          : {}),
      };
    case "task_return_requested":
      return {
        type: "return_control",
        taskId: event.taskId,
        operationId: event.operationId,
      };
    case "task_interrupt_requested":
      return {
        type: "interrupt",
        taskId: event.taskId,
        operationId: event.operationId,
      };
    case "task_finish_requested":
      return {
        type: "finish",
        taskId: event.taskId,
        operationId: event.operationId,
      };
    case "task_cleanup_retry_requested":
      return {
        type: "retry_cleanup",
        taskId: event.taskId,
        operationId: event.operationId,
      };
    case "task_archive_requested":
      return {
        type: "archive",
        taskId: event.taskId,
        operationId: event.operationId,
      };
    case "task_unarchive_requested":
      return {
        type: "resume",
        taskId: event.taskId,
        operationId: event.operationId,
      };
    case "attention_response_requested":
      return {
        type: "respond_attention",
        taskId: event.taskId,
        operationId: event.operationId,
        requestId: event.requestId,
        generation: event.generation,
        response: event.response,
      };
    case "explicit_continuation_response_requested":
      return {
        type: "message",
        taskId: event.taskId,
        operationId: event.operationId,
        message: event.message,
        ...(event.attachmentIds?.length
          ? { attachmentIds: [...event.attachmentIds] }
          : {}),
      };
    default:
      return null;
  }
}

function settleRequestedOperation(
  aggregate: TaskAggregate,
  command: TaskCommand,
  ...types: readonly NativeRequestedOperation["type"][]
): void {
  const operationId = command.payload.operationId;
  if (
    types.includes(aggregate.requestedOperation.type) &&
    typeof operationId === "string" &&
    aggregate.requestedOperation.operationId === operationId
  )
    aggregate.requestedOperation = {
      type: "observe",
      taskId: aggregate.taskId,
    };
}

function assertBindings(aggregate: TaskAggregate): void {
  const sessionId = aggregate.record?.identity.sessionId;
  const threadId = aggregate.record?.identity.threadId;
  if (
    sessionId &&
    aggregate.runtime.sessionId &&
    aggregate.runtime.sessionId !== sessionId
  )
    throw new Error("Runtime observation changed the bound session identity.");
  if (
    threadId &&
    aggregate.codex.threadId &&
    aggregate.codex.threadId !== threadId
  )
    throw new Error("Codex observation changed the bound thread identity.");
  if (aggregate.continuation.status !== "none") {
    if (
      aggregate.continuation.taskId !== aggregate.taskId ||
      aggregate.continuation.sessionId !== sessionId ||
      aggregate.continuation.threadId !== threadId
    )
      throw new Error("Continuation identity does not match task bindings.");
  }
  for (const attention of aggregate.attentions) {
    if (
      attention.taskId !== aggregate.taskId ||
      (attention.threadId && threadId && attention.threadId !== threadId)
    )
      throw new Error("Attention identity does not match task bindings.");
  }
}

export function foldTaskEvent(
  current: TaskAggregate | null,
  event: TaskEvent,
): TaskAggregate {
  validateTaskEvent(event);
  const aggregate = structuredClone(
    current ?? emptyTaskAggregate(event.taskId),
  );
  aggregate.messageDeliveries ??= {};
  if (aggregate.taskId !== event.taskId)
    throw new Error("Task event targets a different aggregate.");
  const sourceKey = `${event.source.kind}:${event.source.id}`;
  const prior = aggregate.sourcePositions[sourceKey];
  if (prior && event.source.generation < prior.generation) return aggregate;
  if (
    prior &&
    event.source.generation === prior.generation &&
    event.source.position < prior.position
  )
    return aggregate;
  aggregate.revision += 1;
  aggregate.sourcePositions = {
    ...aggregate.sourcePositions,
    [sourceKey]: {
      generation: event.source.generation,
      position: event.source.position,
    },
  };
  const requestedOperation = operation(event);
  if (requestedOperation) {
    aggregate.requestedOperation = requestedOperation;
    if (
      requestedOperation.type === "finish" ||
      requestedOperation.type === "retry_cleanup" ||
      requestedOperation.type === "archive"
    )
      aggregate.recoveryRequired = null;
  } else if (
    aggregate.requestedOperation.type !== "observe" &&
    !["finish", "retry_cleanup"].includes(aggregate.requestedOperation.type) &&
    outputFor(aggregate).operationDisposition.status === "rejected"
  )
    aggregate.requestedOperation = { type: "observe", taskId: event.taskId };
  switch (event.type) {
    case "task_launch_requested": {
      if (
        aggregate.launch &&
        canonical(aggregate.launch) !== canonical(event.launch)
      )
        throw new Error("Frozen launch configuration cannot change.");
      aggregate.launch = structuredClone(event.launch);
      break;
    }
    case "codex_availability_observed":
      aggregate.codex = {
        ...aggregate.codex,
        availability: event.availability,
      };
      break;
    case "codex_thread_observed":
      aggregate.codex = structuredClone(event.thread);
      if (event.codexSessionId) aggregate.codexSessionId = event.codexSessionId;
      break;
    case "codex_turn_observed":
      if (
        aggregate.codex.threadId &&
        event.threadId !== aggregate.codex.threadId
      )
        throw new Error("Codex turn targets a different thread.");
      aggregate.codex = {
        availability: aggregate.codex.availability,
        threadExists: true,
        threadId: event.threadId,
        ...(aggregate.codex.threadSource
          ? { threadSource: aggregate.codex.threadSource }
          : {}),
        sourceLookup: aggregate.codex.sourceLookup,
        runtimeStatus: event.turn.runtimeStatus,
        archived: aggregate.codex.archived,
        turn: event.turn.turn,
        ...(event.turn.turnId ? { turnId: event.turn.turnId } : {}),
      };
      break;
    case "codex_item_observed":
      if (
        aggregate.codex.threadId &&
        event.threadId !== aggregate.codex.threadId
      )
        throw new Error("Codex item targets a different thread.");
      if (event.item) {
        const existingItem = aggregate.conversation.items[event.item.id];
        const timedItem: TaskConversationItem = {
          ...structuredClone(event.item),
          startedAt: existingItem?.startedAt ?? event.observedAt,
          ...(event.terminal || event.item.status === "completed"
            ? { completedAt: event.observedAt }
            : existingItem?.completedAt
              ? { completedAt: existingItem.completedAt }
              : {}),
        };
        const items = {
          ...aggregate.conversation.items,
          [event.item.id]: timedItem,
        };
        const retainedIds = Object.keys(items).slice(-256);
        aggregate.conversation = {
          items: Object.fromEntries(
            retainedIds.map((id) => [id, items[id]!] as const),
          ),
          turnOrder: [
            ...new Set([...aggregate.conversation.turnOrder, event.turnId]),
          ].slice(-64),
        };
        if (
          event.source.kind === "codex" &&
          event.item.kind === "user_message" &&
          event.item.clientId
        )
          recordMessageDelivery(aggregate, {
            operationId: event.item.clientId,
            threadId: event.threadId,
            turnId: event.turnId,
            state: "message_materialized",
            connectionGeneration: event.source.generation,
            observedAt: event.observedAt,
          });
      }
      if (event.completedHandoff) {
        aggregate.runtime = {
          ...aggregate.runtime,
          sessionExists: true,
          sessionId: event.completedHandoff.sessionId,
          handoffId: event.completedHandoff.handoffId,
          handoffGeneration: event.completedHandoff.handoffGeneration,
          ownershipGeneration: event.completedHandoff.ownershipGeneration,
          controller: event.completedHandoff.controller,
          status: event.completedHandoff.status,
        };
        aggregate.continuation = structuredClone(
          event.completedHandoff.continuation,
        );
        aggregate.attentions = [
          ...aggregate.attentions.filter(
            (item) => item.authority !== "rove_control",
          ),
          structuredClone(event.completedHandoff.attention),
        ];
      }
      break;
    case "codex_request_observed":
      aggregate.attentions = upsertCodexAttentions(
        aggregate.attentions,
        event.attentions,
      );
      break;
    case "codex_request_resolved":
      aggregate.attentions = aggregate.attentions.map((item) =>
        item.authority === "codex" &&
        item.requestId === event.requestId &&
        item.threadId === event.threadId &&
        item.generation === event.generation
          ? { ...item, status: event.resolution }
          : item,
      );
      if (
        aggregate.requestedOperation.type === "respond_attention" &&
        aggregate.requestedOperation.requestId === event.requestId &&
        aggregate.requestedOperation.generation === event.generation
      )
        aggregate.requestedOperation = {
          type: "observe",
          taskId: aggregate.taskId,
        };
      break;
    case "codex_message_delivery_observed": {
      recordMessageDelivery(aggregate, event.delivery);
      break;
    }
    case "runtime_inventory_observed":
      aggregate.runtime = structuredClone(event.runtime);
      break;
    case "runtime_control_observed":
      if (
        aggregate.runtime.sessionId &&
        event.sessionId !== aggregate.runtime.sessionId
      )
        throw new Error("Runtime control targets a different session.");
      aggregate.runtime = {
        ...aggregate.runtime,
        sessionExists: true,
        sessionId: event.sessionId,
        controller: event.controller,
        status: event.status,
        ownershipGeneration: event.ownershipGeneration,
        ...(event.observationSeq === undefined
          ? {}
          : { observationSeq: event.observationSeq }),
      };
      break;
    case "runtime_handoff_observed":
      if (
        aggregate.runtime.sessionId &&
        event.sessionId !== aggregate.runtime.sessionId
      )
        throw new Error("Runtime handoff targets a different session.");
      aggregate.runtime = {
        ...aggregate.runtime,
        sessionExists: true,
        sessionId: event.sessionId,
        handoffId: event.handoffId,
        handoffGeneration: event.handoffGeneration,
        ownershipGeneration: event.ownershipGeneration,
        controller: event.controller,
        status: event.status,
      };
      aggregate.continuation = structuredClone(event.continuation);
      aggregate.attentions = [
        ...aggregate.attentions.filter(
          (item) => item.authority !== "rove_control",
        ),
        ...(event.attention ? [structuredClone(event.attention)] : []),
      ];
      break;
    case "attachment_state_observed":
      aggregate.attachment = {
        ready: event.ready,
        attachmentIds: [...event.attachmentIds],
      };
      break;
    case "task_capability_observed":
      if (
        aggregate.capabilityFingerprint &&
        aggregate.capabilityFingerprint !== event.fingerprint
      )
        throw new Error("Task capability binding changed after issuance.");
      aggregate.capabilityFingerprint = event.fingerprint;
      break;
    case "host_generation_changed":
      aggregate.processorGeneration = Math.max(
        aggregate.processorGeneration,
        event.generation,
      );
      if (event.component === "codex") {
        aggregate.attentions = aggregate.attentions.map((attention) =>
          attention.authority === "codex" &&
          !["resolved", "cancelled", "stale"].includes(attention.status) &&
          attention.generation < event.generation
            ? { ...attention, status: "stale" as const }
            : attention,
        );
        const threadId = aggregate.record?.identity.threadId;
        aggregate.codex = threadId
          ? {
              availability: "available",
              threadExists: true,
              threadId,
              threadSource:
                aggregate.codex.threadSource ??
                aggregate.record!.bootstrap.threadSource,
              sourceLookup: "exact",
              runtimeStatus: "notLoaded",
              archived: aggregate.codex.archived ?? false,
              turn: "none",
            }
          : {
              availability: "unavailable",
              threadExists: false,
              sourceLookup: "unknown",
              runtimeStatus: "unknown",
              archived: null,
              turn: "unknown",
            };
      } else {
        aggregate.runtime = {
          availability: "unavailable",
          sessionExists: false,
          bootstrapLookup: "unknown",
          status: "unknown",
          controller: null,
          attachment: "unknown",
          profileLock: "unknown",
          recovery: "unknown",
        };
        aggregate.freshInspection = null;
      }
      break;
    case "command_outcome_observed":
      break;
    default:
      break;
  }
  assertBindings(aggregate);
  return aggregate;
}

export function aggregateLifecycleInput(
  aggregate: TaskAggregate,
): NativeLifecycleInput {
  return {
    record: structuredClone(aggregate.record),
    codex: structuredClone(aggregate.codex),
    runtime: structuredClone(aggregate.runtime),
    continuation: structuredClone(aggregate.continuation),
    attentions: structuredClone([...aggregate.attentions]),
    freshInspection: structuredClone(aggregate.freshInspection),
    requestedOperation: structuredClone(aggregate.requestedOperation),
  };
}

function outputFor(aggregate: TaskAggregate): NativeLifecycleOutput {
  if (aggregate.recoveryRequired) {
    const cleanupAction =
      aggregate.record?.closeOperation?.stage === "complete" &&
      aggregate.codex.threadExists &&
      !aggregate.codex.archived
        ? "archive"
        : aggregate.record?.closeOperation
          ? "retry_cleanup"
          : "finish";
    return {
      taskId: aggregate.taskId,
      phase: "failed",
      allowedActions: [cleanupAction],
      nextCommand: null,
      confirmation: null,
      attention: {
        code: "recovery_required",
        message: aggregate.recoveryRequired,
      },
      operationDisposition: {
        type: aggregate.requestedOperation.type,
        operationId: aggregate.requestedOperation.operationId ?? null,
        status: "rejected",
        reason: "Task requires explicit recovery.",
      },
    };
  }
  if (
    aggregate.requestedOperation.type === "launch" &&
    aggregate.record === null
  ) {
    const inventory = reduceLifecycleInventory({
      tasks: [],
      requestedOperation:
        aggregate.requestedOperation as NativeRequestedOperation & {
          type: "launch";
        },
    }) as {
      operationDisposition: NativeLifecycleOutput["operationDisposition"];
      nextCommand: NativeLifecycleOutput["nextCommand"];
      attention: NativeLifecycleOutput["attention"];
    };
    return {
      taskId: aggregate.taskId,
      phase: "starting",
      allowedActions: ["finish"],
      nextCommand: inventory.nextCommand,
      confirmation: null,
      attention: inventory.attention,
      operationDisposition: inventory.operationDisposition,
    };
  }
  return reduceTaskLifecycle(aggregateLifecycleInput(aggregate));
}

export function applySuccessfulTaskCommand(
  aggregate: TaskAggregate,
  command: TaskCommand,
  facts: readonly TaskObservedFact[],
): TaskAggregate {
  const next = structuredClone(aggregate);
  const payload = command.payload;
  switch (command.type) {
    case "persist_bootstrap_intent": {
      if (!next.launch)
        throw new Error("Bootstrap command lacks frozen launch configuration.");
      next.record = {
        schemaVersion: 1,
        identity: {
          taskId: next.taskId,
          ...(next.launch.browserIdentity
            ? { browser: structuredClone(next.launch.browserIdentity) }
            : {}),
        },
        bootstrap: {
          operationId: next.launch.bootstrapId,
          threadSource: `rove:${next.taskId}:${next.launch.bootstrapId}`,
          stage: "intent_persisted",
        },
        desiredState: "open",
      };
      settleRequestedOperation(next, command, "launch");
      break;
    }
    case "advance_bootstrap_stage":
      if (!next.record)
        throw new Error("Bootstrap transition lacks a task record.");
      next.record.bootstrap.stage =
        payload.stage as NativeTaskRecord["bootstrap"]["stage"];
      break;
    case "bind_runtime_identity":
      if (!next.record || typeof payload.returnedSessionId !== "string")
        throw new Error(
          "Runtime binding outcome lacks an exact session identity.",
        );
      next.record.identity.sessionId = payload.returnedSessionId;
      if (payload.returnedBrowserIdentity)
        next.record.identity.browser = structuredClone(
          payload.returnedBrowserIdentity as NativeBrowserIdentity,
        );
      if (next.record.bootstrap.stage !== "complete")
        next.record.bootstrap.stage = "runtime_bound";
      break;
    case "bind_codex_identity":
      if (
        !next.record ||
        !next.launch ||
        typeof payload.returnedThreadId !== "string"
      )
        throw new Error(
          "Codex binding outcome lacks an exact thread identity.",
        );
      next.record.identity.threadId = payload.returnedThreadId;
      next.record.bootstrap.stage = "complete";
      if (next.requestedOperation.type === "observe")
        next.requestedOperation =
          next.launch.executionMode === "capture"
            ? { type: "observe", taskId: next.taskId }
            : {
                type: "message",
                taskId: next.taskId,
                operationId: next.launch.operationId,
                message: next.launch.outcome,
              };
      break;
    case "persist_close_intent":
      if (!next.record || typeof payload.operationId !== "string")
        throw new Error("Close transition lacks an operation identity.");
      next.desiredState = "closed";
      next.record.desiredState = "closed";
      next.record.closeOperation = {
        operationId: payload.operationId,
        requestedAt: command.createdAt,
        stage: "requested",
      };
      settleRequestedOperation(next, command, "finish", "retry_cleanup");
      break;
    case "advance_close_stage":
      if (!next.record?.closeOperation)
        throw new Error("Close transition lacks a close operation.");
      next.record.closeOperation.stage = payload.stage as NonNullable<
        NativeTaskRecord["closeOperation"]
      >["stage"];
      next.record.closeOperation.lastAttemptAt = command.createdAt;
      if (
        payload.stage === "complete" &&
        next.codex.threadExists &&
        !next.codex.archived
      )
        next.requestedOperation = {
          type: "archive",
          taskId: next.taskId,
          operationId: next.record.closeOperation.operationId,
        };
      break;
    case "settle_continuation_attention":
      // A prepared command that never crossed the dispatch boundary is safe to
      // discard when a newer lifecycle intent cancels continuation. Retain
      // any command whose dispatch may have started as recovery evidence.
      if (next.continuation.command?.dispatchStatus === "not_started") {
        const withoutCommand = { ...next.continuation };
        delete withoutCommand.command;
        next.continuation = withoutCommand;
      }
      next.continuation = {
        ...next.continuation,
        status: next.continuation.status === "none" ? "none" : "cancelled",
      };
      next.attentions = next.attentions.map((item) =>
        ["resolved", "cancelled", "stale"].includes(item.status)
          ? item
          : { ...item, status: "cancelled" as const },
      );
      break;
    case "record_return_event":
      next.continuation = {
        ...next.continuation,
        ...(typeof payload.returnEventId === "string"
          ? { returnEventId: payload.returnEventId }
          : {}),
        ...(typeof payload.returnObservationSeq === "number"
          ? { returnObservationSeq: payload.returnObservationSeq }
          : next.runtime.observationSeq === undefined
            ? {}
            : { returnObservationSeq: next.runtime.observationSeq }),
        freshInspectionRequired: false,
      };
      next.freshInspection = null;
      break;
    case "persist_continuation_dispatch_intent":
      if (next.continuation.command)
        next.continuation.command = {
          ...next.continuation.command,
          dispatchStatus: "possibly_started",
        };
      break;
    case "prepare_continuation_command": {
      // A late pure-ledger outcome must not resurrect continuation after a
      // newer Finish or cleanup transition has already cancelled it.
      if (next.continuation.status !== "pending") break;
      const returnEventId = next.continuation.returnEventId;
      if (!returnEventId)
        throw new Error("Continuation preparation lacks a return event.");
      next.continuation = {
        ...next.continuation,
        command: {
          commandId: `continuation:${next.taskId}:${next.continuation.generation ?? 0}`,
          returnEventId,
          kind: next.codex.turn === "active" ? "turn/steer" : "turn/start",
          dispatchStatus: "not_started",
        },
      };
      break;
    }
    case "inspect_after_return":
      if (
        typeof payload.sessionId !== "string" ||
        typeof payload.handoffId !== "string" ||
        typeof payload.generation !== "number" ||
        typeof payload.afterObservationSeq !== "number"
      )
        throw new Error("Fresh inspection command lacks exact proof fields.");
      next.freshInspection = {
        inspectionId: `inspect:${payload.sessionId}:${payload.generation}:${payload.afterObservationSeq}`,
        sessionId: payload.sessionId,
        handoffId: payload.handoffId,
        generation: payload.generation,
        afterObservationSeq: payload.afterObservationSeq,
      };
      break;
    case "dispatch_or_reconcile_continuation":
    case "reconcile_continuation_dispatch":
    case "respond_continuation_explicit":
      if (next.continuation.status === "pending") {
        const completedHandoffId = next.continuation.handoffId;
        const completedGeneration = next.continuation.generation;
        next.continuation = {
          ...next.continuation,
          status: "consumed",
          ...(next.continuation.command
            ? {
                command: {
                  ...next.continuation.command,
                  dispatchStatus: "terminal" as const,
                },
              }
            : {}),
        };
        next.attentions = next.attentions.map((attention) =>
          attention.authority === "rove_control" &&
          attention.handoffId === completedHandoffId &&
          attention.generation === completedGeneration &&
          !["resolved", "cancelled", "stale"].includes(attention.status)
            ? { ...attention, status: "resolved" as const }
            : attention,
        );
      }
      if (command.type === "respond_continuation_explicit")
        settleRequestedOperation(next, command, "message");
      break;
    case "start_or_steer_codex_turn":
      settleRequestedOperation(next, command, "message");
      break;
    case "interrupt_codex_turn":
      settleRequestedOperation(next, command, "interrupt");
      break;
    case "return_runtime_ownership":
      settleRequestedOperation(next, command, "return_control");
      break;
    case "resume_codex_thread":
    case "unarchive_codex_thread":
      settleRequestedOperation(next, command, "resume");
      break;
    case "archive_codex_thread":
      settleRequestedOperation(next, command, "archive");
      break;
    case "respond_codex_attention":
      next.attentions = next.attentions.map((attention) =>
        attention.requestId === payload.requestId &&
        attention.generation === payload.generation &&
        !["resolved", "cancelled", "stale"].includes(attention.status)
          ? { ...attention, status: "responding" as const }
          : attention,
      );
      settleRequestedOperation(next, command, "respond_attention");
      break;
    default:
      break;
  }
  for (const fact of facts) {
    const folded = foldTaskEvent(
      { ...next, revision: next.revision - 1 },
      fact,
    );
    Object.assign(next, folded, { revision: next.revision });
  }
  assertBindings(next);
  return next;
}

export function projectTaskAggregate(aggregate: TaskAggregate): TaskProjection {
  const output = outputFor(aggregate);
  return {
    schemaVersion: 1,
    taskId: aggregate.taskId,
    revision: aggregate.revision,
    phase: output.phase,
    allowedActions: output.allowedActions,
    attention: output.attention,
    operationDisposition: output.operationDisposition,
    codex: structuredClone(aggregate.codex),
    runtime: structuredClone(aggregate.runtime),
    attentions: structuredClone([...aggregate.attentions]),
    conversation: structuredClone(aggregate.conversation),
    messageDeliveries: structuredClone(aggregate.messageDeliveries),
    recoveryRequired: aggregate.recoveryRequired,
  };
}

function makeCommand(
  aggregate: TaskAggregate,
  event: TaskEvent,
  output: NativeLifecycleOutput,
): TaskCommand | null {
  if (!output.nextCommand) return null;
  const type = output.nextCommand.type;
  return {
    schemaVersion: 1,
    commandId: `command:${aggregate.taskId}:${aggregate.revision}:${boundedHash(event.eventId)}`,
    taskId: aggregate.taskId,
    aggregateRevision: aggregate.revision,
    type,
    payload: structuredClone({
      ...output.nextCommand,
      ...((event.type === "task_message_requested" ||
        event.type === "explicit_continuation_response_requested") &&
      event.workflowContext
        ? { workflowContext: event.workflowContext }
        : {}),
      ...((event.type === "task_message_requested" ||
        event.type === "explicit_continuation_response_requested") &&
      event.selectedResultContext
        ? { selectedResultContext: event.selectedResultContext }
        : {}),
    }),
    classification: TASK_COMMAND_MANIFEST[type],
    status: "pending",
    attempts: 0,
    createdAt: event.observedAt,
  };
}

function boundedHash(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}

export class TaskEngine {
  constructor(private readonly store: TaskEngineStore) {}

  accept(event: TaskEvent): Promise<TaskAcceptance> {
    validateTaskEvent(event);
    return this.store.transact(event.taskId, async (tx) => {
      const digest = taskEventDigest(event);
      const duplicate = await tx.event(event.taskId, event.eventId);
      if (duplicate) {
        if (duplicate.digest !== digest)
          throw new Error(
            "Task event identity was reused with different content.",
          );
        return { ...structuredClone(duplicate.acceptance), duplicate: true };
      }
      const sourceDuplicate = await tx.sourceEvent(event.taskId, event.source);
      if (sourceDuplicate) {
        const sourceDigest = taskEventDigest({
          ...event,
          eventId: sourceDuplicate.eventId,
        } as TaskEvent);
        if (sourceDuplicate.digest !== sourceDigest)
          throw new Error(
            "Task event source coordinate was reused with different content.",
          );
        return {
          ...structuredClone(sourceDuplicate.acceptance),
          duplicate: true,
        };
      }
      const current = await tx.aggregate(event.taskId);
      const active = await tx.activeCommand(event.taskId);
      const incomingOperation = operation(event);
      const currentDisposition = current
        ? outputFor(current).operationDisposition
        : null;
      const currentOperationIsOutstanding =
        active !== null ||
        currentDisposition?.status === "deferred-for-convergence";
      if (
        event.type === "task_message_requested" &&
        current?.record?.bootstrap.stage !== "complete"
      )
        throw new Error(
          "A task message cannot be accepted before bootstrap completes.",
        );
      if (
        current &&
        incomingOperation &&
        current.requestedOperation.type !== "observe" &&
        current.requestedOperation.operationId !==
          incomingOperation.operationId &&
        event.type !== "task_finish_requested" &&
        event.type !== "task_cleanup_retry_requested" &&
        event.type !== "task_return_requested" &&
        currentDisposition?.status !== "rejected" &&
        currentOperationIsOutstanding
      )
        throw new Error("Task already has an outstanding product intent.");
      let aggregate = foldTaskEvent(current, event);
      const ignored =
        current !== null && aggregate.revision === current.revision;
      if (event.type === "command_outcome_observed") {
        const priorCommand = await tx.command(event.commandId);
        if (!priorCommand || priorCommand.taskId !== event.taskId)
          throw new Error(
            "Command outcome does not match a durable task command.",
          );
        if (event.status === "succeeded") {
          aggregate.recoveryRequired = null;
          aggregate = applySuccessfulTaskCommand(
            aggregate,
            priorCommand,
            event.facts,
          );
        } else if (event.status === "unresolved" || event.status === "failed") {
          for (const fact of event.facts) {
            if (fact.type !== "codex_message_delivery_observed") continue;
            const folded = foldTaskEvent(
              { ...aggregate, revision: aggregate.revision - 1 },
              fact,
            );
            Object.assign(aggregate, folded, { revision: aggregate.revision });
          }
          const nonSubmission = event.facts.some(
            (fact) =>
              fact.type === "codex_message_delivery_observed" &&
              ["dispatch_not_started", "non_submission_established"].includes(
                fact.delivery.state,
              ),
          );
          if (nonSubmission) {
            aggregate.requestedOperation = {
              type: "observe",
              taskId: aggregate.taskId,
            };
            aggregate.recoveryRequired = null;
          } else
            aggregate.recoveryRequired = [
              "finish",
              "retry_cleanup",
              "archive",
              "resume",
            ].includes(aggregate.requestedOperation.type)
              ? null
              : event.status === "unresolved"
                ? `Command ${priorCommand.type} requires truth-based reconciliation.`
                : `Command ${priorCommand.type} failed.`;
        }
      }
      const output = outputFor(aggregate);
      const outcomeReleasesActive =
        event.type === "command_outcome_observed" &&
        active?.commandId === event.commandId;
      const command =
        ignored ||
        (active !== null && !outcomeReleasesActive) ||
        (event.type === "command_outcome_observed" &&
          event.status !== "succeeded")
          ? null
          : makeCommand(aggregate, event, output);
      const acceptance: TaskAcceptance = {
        duplicate: false,
        aggregate,
        projection: projectTaskAggregate(aggregate),
        command,
      };
      await tx.commit({ event, digest, acceptance });
      return acceptance;
    });
  }
}
