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
  attachmentMetadata?: TaskConversationItem["attachments"];
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
  references: readonly {
    taskId: string;
    resultId: string;
    revision: number;
    digest: string;
    lifecycle:
      | "prepared"
      | "authorized"
      | "dispatched"
      | "confirmed"
      | "failed"
      | "unresolved";
  }[];
  digest: string;
  workingContext: string;
  developerInstructions?: string;
}

export interface TaskConversationItem {
  id: string;
  turnId?: string;
  clientId?: string;
  acceptedAt?: string;
  providerItemId?: string;
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
  text?: string;
  title?: string;
  progress?: string;
}

/** Durable customer intent waiting for an execution boundary. Queue entries
 * are deliberately not conversation items and have no provider identity until
 * promotion removes one entry and creates user:<operationId> atomically. */
export interface TaskQueueEntry {
  id: string;
  operationId: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  attachmentIds: readonly string[];
  attachmentMetadata?: TaskConversationItem["attachments"];
  workflowContext?: TaskWorkflowContextSnapshot;
  selectedResultContext?: TaskSelectedResultContextSnapshot;
}

export interface TaskCustomerActiveInterval {
  segmentId: string;
  startedAt: string;
  endedAt?: string;
}

export const MAX_TASK_QUEUE_ENTRIES = 16;
export const MAX_TASK_QUEUE_MESSAGE_LENGTH = 16_000;

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

export interface TaskCodexReconciliationDiagnostic {
  trigger:
    | "event_delivery_failure"
    | "reconnect"
    | "startup"
    | "authority_contradiction"
    | "explicit_read";
  outcome: "scheduled" | "succeeded" | "unresolved";
  recoveryClass: TaskCodexRecoveryClass;
  blockerId: string;
  threadId: string;
  attempt: number;
  observedAt: string;
  eventFamily?: string;
  errorCategory?: string;
  correlationId?: string;
}

export type TaskCodexRecoveryClass =
  | "thread_history_reconstructible"
  | "live_attention"
  | "provider_other_authority";

export interface TaskCodexRecoveryBlocker {
  blockerId: string;
  recoveryClass: TaskCodexRecoveryClass;
  family: string;
  threadId: string;
  correlationId?: string;
  unresolvedAt: string;
  lastObservedAt: string;
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
      attachmentMetadata?: TaskConversationItem["attachments"];
      workflowContext?: TaskWorkflowContextSnapshot;
      selectedResultContext?: TaskSelectedResultContextSnapshot;
    })
  | (TaskEventBase & {
      type: "task_queue_added";
      operationId: string;
      message: string;
      attachmentIds?: readonly string[];
      attachmentMetadata?: TaskConversationItem["attachments"];
      workflowContext?: TaskWorkflowContextSnapshot;
      selectedResultContext?: TaskSelectedResultContextSnapshot;
    })
  | (TaskEventBase & {
      type: "task_queue_edited";
      operationId: string;
      entryId: string;
      message: string;
    })
  | (TaskEventBase & {
      type: "task_queue_removed";
      operationId: string;
      entryId: string;
    })
  | (TaskEventBase & {
      type: "task_queue_reordered";
      operationId: string;
      entryIds: readonly string[];
    })
  | (TaskEventBase & {
      type: "task_queue_steer_requested";
      operationId: string;
      entryId: string;
      expectedTurnId: string;
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
      attachmentMetadata?: TaskConversationItem["attachments"];
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
      type: "codex_reconciliation_observed";
      diagnostic: TaskCodexReconciliationDiagnostic;
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
    itemOrder?: readonly string[];
    turnOrder: readonly string[];
    terminalTurns?: Readonly<
      Record<string, "completed" | "failed" | "interrupted">
    >;
  };
  queue: {
    entries: Readonly<Record<string, TaskQueueEntry>>;
    order: readonly string[];
  };
  customerActiveIntervals: readonly TaskCustomerActiveInterval[];
  pendingQueuePromotion?: TaskQueueEntry;
  messageDeliveries: Readonly<Record<string, TaskMessageDeliveryEvidence>>;
  requestedOperation: NativeRequestedOperation;
  processorGeneration: number;
  sourcePositions: Readonly<
    Record<string, { generation: number; position: number }>
  >;
  recoveryRequired: string | null;
  codexReconciliation?: readonly TaskCodexReconciliationDiagnostic[];
  codexRecoveryBlockers?: Readonly<Record<string, TaskCodexRecoveryBlocker>>;
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
  queue: TaskAggregate["queue"];
  customerActiveIntervals: TaskAggregate["customerActiveIntervals"];
  messageDeliveries: TaskAggregate["messageDeliveries"];
  recoveryRequired: string | null;
  codexReconciliation?: readonly TaskCodexReconciliationDiagnostic[];
  codexRecoveryBlockers?: Readonly<Record<string, TaskCodexRecoveryBlocker>>;
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
  prepare_codex_reassociation: {
    execute: "pure_ledger",
    reconcile: "not_required",
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
  acceptedEvent?(
    taskId: string,
    eventId: string,
  ): Promise<{
    event: TaskEvent;
    digest: string;
    acceptance: TaskAcceptance;
  } | null>;
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
    conversation: {
      items: {},
      itemOrder: [],
      turnOrder: [],
      terminalTurns: {},
    },
    queue: { entries: {}, order: [] },
    customerActiveIntervals: [],
    messageDeliveries: {},
    requestedOperation: { type: "observe", taskId },
    processorGeneration: 1,
    sourcePositions: {},
    recoveryRequired: null,
    codexReconciliation: [],
    codexRecoveryBlockers: {},
  };
}

const CODEX_RECOVERY_REQUIRED =
  "Codex external truth requires authoritative reconciliation.";
const LEGACY_CODEX_RECOVERY_REQUIRED =
  "Codex history reconciliation could not establish current durable task truth.";
const MAX_CODEX_RECOVERY_BLOCKERS_PER_CLASS = 32;

function addCodexRecoveryBlocker(
  current: Readonly<Record<string, TaskCodexRecoveryBlocker>>,
  blocker: TaskCodexRecoveryBlocker,
): Readonly<Record<string, TaskCodexRecoveryBlocker>> {
  const next = { ...current };
  const existing = next[blocker.blockerId];
  if (existing) {
    next[blocker.blockerId] = {
      ...blocker,
      unresolvedAt: existing.unresolvedAt,
    };
    return next;
  }
  const sameClass = Object.values(next).filter(
    (entry) => entry.recoveryClass === blocker.recoveryClass,
  );
  if (sameClass.length < MAX_CODEX_RECOVERY_BLOCKERS_PER_CLASS) {
    next[blocker.blockerId] = blocker;
    return next;
  }
  const overflowId = `codex-recovery:${blocker.recoveryClass}:overflow`;
  if (!next[overflowId]) {
    const oldest = sameClass.find((entry) => entry.blockerId !== overflowId);
    if (oldest) delete next[oldest.blockerId];
    next[overflowId] = {
      blockerId: overflowId,
      recoveryClass: blocker.recoveryClass,
      family: "overflow",
      threadId: blocker.threadId,
      unresolvedAt: blocker.unresolvedAt,
      lastObservedAt: blocker.lastObservedAt,
    };
  } else {
    next[overflowId] = {
      ...next[overflowId],
      lastObservedAt: blocker.lastObservedAt,
    };
  }
  return next;
}

function synchronizeCodexRecoveryRequired(aggregate: TaskAggregate): void {
  const hasCodexBlocker =
    Object.keys(aggregate.codexRecoveryBlockers ?? {}).length > 0;
  const ownsRecoveryString =
    aggregate.recoveryRequired === CODEX_RECOVERY_REQUIRED ||
    aggregate.recoveryRequired === LEGACY_CODEX_RECOVERY_REQUIRED;
  if (hasCodexBlocker) {
    if (aggregate.recoveryRequired === null || ownsRecoveryString)
      aggregate.recoveryRequired = CODEX_RECOVERY_REQUIRED;
  } else if (ownsRecoveryString) aggregate.recoveryRequired = null;
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
  if (
    !Array.isArray(value.references) ||
    value.references.length !== value.resultIds.length ||
    value.references.some(
      (reference, index) =>
        reference === null ||
        typeof reference !== "object" ||
        reference.resultId !== value.resultIds[index] ||
        typeof reference.taskId !== "string" ||
        reference.taskId.trim().length < 1 ||
        reference.taskId.length > 160 ||
        !Number.isSafeInteger(reference.revision) ||
        reference.revision < 1 ||
        !/^[a-f0-9]{64}$/.test(reference.digest) ||
        ![
          "prepared",
          "authorized",
          "dispatched",
          "confirmed",
          "failed",
          "unresolved",
        ].includes(reference.lifecycle),
    )
  )
    throw new Error("Selected result context references are invalid.");
  if (!/^[a-f0-9]{64}$/.test(value.digest))
    throw new Error("Selected result context digest is invalid.");
  if (
    typeof value.workingContext !== "string" ||
    value.workingContext.length < 1 ||
    value.workingContext.length > 16_000
  )
    throw new Error("Selected result working context is invalid.");
  if (
    value.developerInstructions !== undefined &&
    (typeof value.developerInstructions !== "string" ||
      value.developerInstructions.length < 1 ||
      value.developerInstructions.length > 8_000)
  )
    throw new Error("Selected result policy instructions are invalid.");
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
          event.type === "task_queue_added" ||
          event.type === "explicit_continuation_response_requested"
        ? event.workflowContext
        : undefined;
  if (workflowContext) validateWorkflowContextSnapshot(workflowContext);
  const selectedResultContext =
    event.type === "task_message_requested" ||
    event.type === "task_queue_added" ||
    event.type === "explicit_continuation_response_requested"
      ? event.selectedResultContext
      : undefined;
  if (selectedResultContext) {
    validateSelectedResultContextSnapshot(selectedResultContext);
    if (
      selectedResultContext.references.some(
        (reference) => reference.taskId !== event.taskId,
      )
    )
      throw new Error("Selected result context targets another task.");
  }
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
  const acceptedAttachments =
    event.type === "task_launch_requested"
      ? event.launch.attachmentMetadata
      : event.type === "task_message_requested" ||
          event.type === "task_queue_added" ||
          event.type === "explicit_continuation_response_requested"
        ? event.attachmentMetadata
        : undefined;
  const acceptedAttachmentIds =
    event.type === "task_launch_requested"
      ? event.launch.attachmentIds
      : event.type === "task_message_requested" ||
          event.type === "task_queue_added" ||
          event.type === "explicit_continuation_response_requested"
        ? (event.attachmentIds ?? [])
        : [];
  if (
    acceptedAttachments &&
    (acceptedAttachments.length !== acceptedAttachmentIds.length ||
      acceptedAttachments.length > 100 ||
      acceptedAttachments.some(
        (attachment) =>
          attachment.filename.length < 1 ||
          attachment.filename.length > 255 ||
          !["file", "image", "audio"].includes(attachment.kind),
      ))
  )
    throw new Error("Accepted message attachments are invalid.");
  if (event.type === "task_queue_added" || event.type === "task_queue_edited") {
    if (
      typeof event.message !== "string" ||
      event.message.length < 1 ||
      event.message.length > MAX_TASK_QUEUE_MESSAGE_LENGTH
    )
      throw new Error("Queued task message is invalid.");
  }
  if (
    event.type === "task_queue_added" ||
    event.type === "task_queue_edited" ||
    event.type === "task_queue_removed" ||
    event.type === "task_queue_reordered"
  )
    requireIdentity(event.operationId, "Queue operation identity");
  if (event.type === "task_queue_edited" || event.type === "task_queue_removed")
    requireIdentity(event.entryId, "Queue entry identity");
  if (event.type === "task_queue_steer_requested") {
    requireIdentity(event.operationId, "Queue entry operation identity");
    requireIdentity(event.entryId, "Queue entry identity");
    requireIdentity(event.expectedTurnId, "Expected turn identity");
  }
  if (event.type === "task_queue_reordered") {
    if (
      event.entryIds.length > MAX_TASK_QUEUE_ENTRIES ||
      new Set(event.entryIds).size !== event.entryIds.length
    )
      throw new Error("Task queue order is invalid.");
    for (const entryId of event.entryIds)
      requireIdentity(entryId, "Queue entry identity");
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
    case "task_queue_steer_requested":
      return {
        type: "message",
        taskId: event.taskId,
        operationId: event.operationId,
        message: "queued intervention",
        expectedTurnId: event.expectedTurnId,
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

const HANDOFF_AUTHORITY_RECOVERY =
  "Runtime and durable browser handoff identities do not match. Refresh Runtime truth before retrying takeover.";

function exactPendingHandoffBinding(aggregate: TaskAggregate): boolean {
  const continuation = aggregate.continuation;
  const runtime = aggregate.runtime;
  return (
    aggregate.desiredState === "open" &&
    aggregate.launch !== null &&
    aggregate.record?.bootstrap.stage === "complete" &&
    aggregate.record.bootstrap.operationId === aggregate.launch.bootstrapId &&
    continuation.status === "pending" &&
    continuation.taskId === aggregate.taskId &&
    continuation.sessionId === aggregate.record.identity.sessionId &&
    continuation.threadId === aggregate.record.identity.threadId &&
    continuation.handoffId !== undefined &&
    continuation.generation !== undefined &&
    runtime.sessionExists &&
    runtime.sessionId === continuation.sessionId &&
    runtime.bootstrapLookup === "exact" &&
    runtime.bootstrapId === aggregate.launch.bootstrapId &&
    runtime.ownershipGeneration !== undefined
  );
}

function exactPendingHandoffAuthority(aggregate: TaskAggregate): boolean {
  const continuation = aggregate.continuation;
  const runtime = aggregate.runtime;
  return (
    exactPendingHandoffBinding(aggregate) &&
    runtime.handoffId === continuation.handoffId &&
    runtime.handoffGeneration === continuation.generation &&
    ((runtime.status === "awaiting_human" && runtime.controller === null) ||
      (runtime.status === "active" && runtime.controller === "human"))
  );
}

function exactReturnedHandoffAuthority(aggregate: TaskAggregate): boolean {
  const continuation = aggregate.continuation;
  const runtime = aggregate.runtime;
  return (
    exactPendingHandoffBinding(aggregate) &&
    runtime.status === "active" &&
    runtime.controller === "agent" &&
    runtime.handoffId === undefined &&
    runtime.handoffGeneration === undefined &&
    runtime.lastReturnedHandoffId === continuation.handoffId
  );
}

function isExactHandoffAttention(
  aggregate: TaskAggregate,
  attention: NativeAttentionTruth,
): boolean {
  const continuation = aggregate.continuation;
  return (
    attention.authority === "rove_control" &&
    attention.kind === "control_handoff" &&
    attention.taskId === aggregate.taskId &&
    attention.sessionId === continuation.sessionId &&
    attention.threadId === continuation.threadId &&
    attention.handoffId === continuation.handoffId &&
    attention.generation === continuation.generation
  );
}

/** Runtime plus the durable continuation own handoff authority. Attention is
 * their customer-facing action-routing projection and is repaired only after
 * a fresh Runtime observation corroborates the exact durable identity. */
function reconcileHandoffAttentionProjection(aggregate: TaskAggregate): void {
  const codexAttention = aggregate.attentions.filter(
    (attention) => attention.authority !== "rove_control",
  );
  const exactAuthority = exactPendingHandoffAuthority(aggregate);
  if (!exactAuthority) {
    aggregate.attentions = [
      ...codexAttention,
      ...aggregate.attentions
        .filter((attention) => attention.authority === "rove_control")
        .map((attention) =>
          [
            "pending",
            "responding",
            "awaiting_confirmation",
            "resolution_unknown",
          ].includes(attention.status)
            ? { ...attention, status: "stale" as const }
            : attention,
        ),
    ];
    if (
      aggregate.continuation.status === "pending" &&
      !exactReturnedHandoffAuthority(aggregate)
    ) {
      if (
        aggregate.recoveryRequired === null ||
        aggregate.recoveryRequired === HANDOFF_AUTHORITY_RECOVERY
      )
        aggregate.recoveryRequired = HANDOFF_AUTHORITY_RECOVERY;
    } else if (aggregate.recoveryRequired === HANDOFF_AUTHORITY_RECOVERY) {
      aggregate.recoveryRequired = null;
    }
    return;
  }

  if (aggregate.recoveryRequired === HANDOFF_AUTHORITY_RECOVERY)
    aggregate.recoveryRequired = null;

  const continuation = aggregate.continuation;
  const existing = aggregate.attentions.find((attention) =>
    isExactHandoffAttention(aggregate, attention),
  );
  aggregate.attentions = [
    ...codexAttention,
    existing
      ? { ...structuredClone(existing), status: "pending" as const }
      : {
          authority: "rove_control",
          kind: "control_handoff",
          requestId: `control:${continuation.id ?? `${aggregate.taskId}:${continuation.handoffId}:${continuation.generation}`}`,
          taskId: aggregate.taskId,
          sessionId: continuation.sessionId!,
          threadId: continuation.threadId!,
          handoffId: continuation.handoffId!,
          generation: continuation.generation!,
          status: "pending",
        },
  ];
}

export function hasActionableTaskHandoff(aggregate: TaskAggregate): boolean {
  return (
    exactPendingHandoffAuthority(aggregate) &&
    aggregate.runtime.status === "awaiting_human" &&
    aggregate.runtime.controller === null &&
    aggregate.attentions.filter(
      (attention) =>
        attention.status === "pending" &&
        isExactHandoffAttention(aggregate, attention),
    ).length === 1
  );
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
  aggregate.queue ??= { entries: {}, order: [] };
  aggregate.customerActiveIntervals ??= [];
  aggregate.conversation.itemOrder ??= [
    ...aggregate.conversation.turnOrder.flatMap((turnId) =>
      Object.values(aggregate.conversation.items)
        .filter((item) => item.turnId === turnId)
        .map((item) => item.id),
    ),
    ...Object.keys(aggregate.conversation.items).filter(
      (id) =>
        !aggregate.conversation.turnOrder.includes(
          aggregate.conversation.items[id]?.turnId ?? "",
        ),
    ),
  ];
  aggregate.conversation.terminalTurns ??= {};
  aggregate.codexReconciliation ??= [];
  aggregate.codexRecoveryBlockers ??= {};
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
  }
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
    case "task_queue_added": {
      if (
        aggregate.desiredState !== "open" ||
        aggregate.record?.bootstrap.stage !== "complete" ||
        aggregate.codex.turn !== "active" ||
        !aggregate.codex.turnId ||
        aggregate.recoveryRequired !== null ||
        aggregate.requestedOperation.type !== "observe"
      )
        throw new Error("Queueing requires exact active task authority.");
      if (aggregate.queue.order.length >= MAX_TASK_QUEUE_ENTRIES)
        throw new Error("Task queue is full.");
      const id = `queue:${event.operationId}`;
      if (aggregate.queue.entries[id])
        throw new Error("Queue entry identity already exists.");
      const entry: TaskQueueEntry = {
        id,
        operationId: event.operationId,
        message: event.message,
        createdAt: event.observedAt,
        updatedAt: event.observedAt,
        attachmentIds: [...(event.attachmentIds ?? [])],
        ...(event.attachmentMetadata?.length
          ? { attachmentMetadata: structuredClone(event.attachmentMetadata) }
          : {}),
        ...(event.workflowContext
          ? { workflowContext: structuredClone(event.workflowContext) }
          : {}),
        ...(event.selectedResultContext
          ? {
              selectedResultContext: structuredClone(
                event.selectedResultContext,
              ),
            }
          : {}),
      };
      aggregate.queue = {
        entries: { ...aggregate.queue.entries, [id]: entry },
        order: [...aggregate.queue.order, id],
      };
      break;
    }
    case "task_queue_edited": {
      const entry = aggregate.queue.entries[event.entryId];
      if (!entry) throw new Error("Queue entry was not found on this task.");
      aggregate.queue = {
        ...aggregate.queue,
        entries: {
          ...aggregate.queue.entries,
          [entry.id]: {
            ...entry,
            message: event.message,
            updatedAt: event.observedAt,
          },
        },
      };
      break;
    }
    case "task_queue_removed": {
      if (!aggregate.queue.entries[event.entryId])
        throw new Error("Queue entry was not found on this task.");
      const entries = { ...aggregate.queue.entries };
      delete entries[event.entryId];
      aggregate.queue = {
        entries,
        order: aggregate.queue.order.filter((id) => id !== event.entryId),
      };
      break;
    }
    case "task_queue_reordered": {
      if (
        event.entryIds.length !== aggregate.queue.order.length ||
        event.entryIds.some((id) => !aggregate.queue.entries[id]) ||
        aggregate.queue.order.some((id) => !event.entryIds.includes(id))
      )
        throw new Error("Queue reorder must name every exact task entry once.");
      aggregate.queue = { ...aggregate.queue, order: [...event.entryIds] };
      break;
    }
    case "task_queue_steer_requested": {
      if (
        aggregate.desiredState !== "open" ||
        aggregate.record?.bootstrap.stage !== "complete" ||
        aggregate.codex.turn !== "active" ||
        aggregate.codex.turnId !== event.expectedTurnId ||
        aggregate.recoveryRequired !== null ||
        aggregate.requestedOperation.type !== "message" ||
        aggregate.requestedOperation.operationId !== event.operationId
      )
        throw new Error("Steer targets stale active work.");
      const entry = aggregate.queue.entries[event.entryId];
      if (!entry) throw new Error("Queue entry was not found on this task.");
      if (entry.operationId !== event.operationId)
        throw new Error("Queue entry operation identity changed.");
      const entries = { ...aggregate.queue.entries };
      delete entries[entry.id];
      aggregate.queue = {
        entries,
        order: aggregate.queue.order.filter((id) => id !== entry.id),
      };
      aggregate.pendingQueuePromotion = structuredClone(entry);
      aggregate.requestedOperation = {
        type: "message",
        taskId: aggregate.taskId,
        operationId: entry.operationId,
        message: entry.message,
        expectedTurnId: event.expectedTurnId,
        ...(entry.attachmentIds.length
          ? { attachmentIds: [...entry.attachmentIds] }
          : {}),
      };
      recordAcceptedUserMaterial(aggregate, {
        operationId: entry.operationId,
        text: entry.message,
        acceptedAt: event.observedAt,
        attachments: entry.attachmentMetadata,
      });
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
    case "codex_turn_observed": {
      if (
        aggregate.codex.threadId &&
        event.threadId !== aggregate.codex.threadId
      )
        throw new Error("Codex turn targets a different thread.");
      if (
        event.turn.turn === "active" &&
        event.turn.turnId &&
        aggregate.conversation.terminalTurns?.[event.turn.turnId]
      )
        break;
      const terminalTurn =
        event.turn.turn === "completed" ||
        event.turn.turn === "failed" ||
        event.turn.turn === "interrupted"
          ? event.turn.turn
          : undefined;
      const latestTurnId = aggregate.conversation.turnOrder.at(-1);
      if (
        terminalTurn !== undefined &&
        event.turn.turnId &&
        ((aggregate.codex.turnId &&
          aggregate.codex.turnId !== event.turn.turnId) ||
          (latestTurnId && latestTurnId !== event.turn.turnId))
      ) {
        aggregate.conversation.terminalTurns = {
          ...aggregate.conversation.terminalTurns,
          [event.turn.turnId]: terminalTurn,
        };
        break;
      }
      if (event.turn.turn === "active" && event.turn.turnId)
        aggregate.conversation.turnOrder = [
          ...new Set([...aggregate.conversation.turnOrder, event.turn.turnId]),
        ].slice(-64);
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
        ...(event.turn.turn === "active" && event.turn.turnId
          ? { turnId: event.turn.turnId }
          : {}),
      };
      if (terminalTurn !== undefined && event.turn.turnId)
        aggregate.conversation.terminalTurns = {
          ...aggregate.conversation.terminalTurns,
          [event.turn.turnId]: terminalTurn,
        };
      break;
    }
    case "codex_item_observed":
      if (
        aggregate.codex.threadId &&
        event.threadId !== aggregate.codex.threadId
      )
        throw new Error("Codex item targets a different thread.");
      if (event.item) {
        const correlatedAcceptedItems = Object.values(
          aggregate.conversation.items,
        ).filter(
          (item) =>
            item.kind === "user_message" &&
            item.acceptedAt !== undefined &&
            event.item?.kind === "user_message" &&
            event.item.clientId !== undefined &&
            item.clientId === event.item.clientId,
        );
        if (correlatedAcceptedItems.length > 1)
          throw new Error("Accepted user message identity is ambiguous.");
        const correlatedAcceptedItem = correlatedAcceptedItems[0];
        if (correlatedAcceptedItem) {
          if (
            correlatedAcceptedItem.turnId &&
            correlatedAcceptedItem.turnId !== event.turnId
          )
            throw new Error("Accepted user message turn identity changed.");
          if (
            correlatedAcceptedItem.providerItemId &&
            correlatedAcceptedItem.providerItemId !== event.item.id
          )
            throw new Error("Accepted user message provider identity changed.");
          aggregate.conversation = {
            ...aggregate.conversation,
            items: {
              ...aggregate.conversation.items,
              [correlatedAcceptedItem.id]: {
                ...correlatedAcceptedItem,
                turnId: event.turnId,
                providerItemId: event.item.id,
              },
            },
            turnOrder: [
              ...new Set([...aggregate.conversation.turnOrder, event.turnId]),
            ].slice(-64),
          };
          recordMessageDelivery(aggregate, {
            operationId: event.item.clientId!,
            threadId: event.threadId,
            turnId: event.turnId,
            state: "message_materialized",
            connectionGeneration: event.source.generation,
            observedAt: event.observedAt,
          });
          break;
        }
        const existingItem = aggregate.conversation.items[event.item.id];
        if (existingItem?.status === "completed") {
          if (event.item.status === "started") {
            if (!event.completedHandoff) break;
          }
          const stable = (item: TaskConversationItem) => {
            const value = { ...item };
            delete value.startedAt;
            delete value.completedAt;
            return canonical(value);
          };
          if (stable(existingItem) !== stable(event.item))
            throw new Error(
              "Conflicting completed Codex item content for one identity.",
            );
        }
        const timedItem: TaskConversationItem =
          existingItem?.status === "completed"
            ? existingItem
            : {
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
          itemOrder: [
            ...new Set([
              ...(aggregate.conversation.itemOrder ?? []),
              event.item.id,
            ]),
          ].filter((id) => retainedIds.includes(id)),
          turnOrder: [
            ...new Set([...aggregate.conversation.turnOrder, event.turnId]),
          ].slice(-64),
          terminalTurns: aggregate.conversation.terminalTurns ?? {},
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
        const existingGeneration = aggregate.continuation.generation ?? -1;
        if (existingGeneration > event.completedHandoff.handoffGeneration)
          break;
        if (
          existingGeneration === event.completedHandoff.handoffGeneration &&
          aggregate.continuation.status !== "none"
        ) {
          if (
            aggregate.continuation.handoffId !==
              event.completedHandoff.handoffId ||
            aggregate.continuation.sessionId !==
              event.completedHandoff.sessionId
          )
            throw new Error("Conflicting completed handoff identity.");
          if (aggregate.continuation.status !== "pending") break;
        }
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
    case "codex_reconciliation_observed":
      if (
        aggregate.record?.identity.threadId &&
        event.diagnostic.threadId !== aggregate.record.identity.threadId
      )
        throw new Error("Codex reconciliation targets a different thread.");
      aggregate.codexReconciliation = [
        ...(aggregate.codexReconciliation ?? []),
        structuredClone(event.diagnostic),
      ].slice(-32);
      if (event.diagnostic.outcome === "unresolved")
        aggregate.codexRecoveryBlockers = addCodexRecoveryBlocker(
          aggregate.codexRecoveryBlockers ?? {},
          {
            blockerId: event.diagnostic.blockerId,
            recoveryClass: event.diagnostic.recoveryClass,
            family:
              event.diagnostic.eventFamily ?? event.diagnostic.recoveryClass,
            threadId: event.diagnostic.threadId,
            ...(event.diagnostic.correlationId
              ? { correlationId: event.diagnostic.correlationId }
              : {}),
            unresolvedAt:
              aggregate.codexRecoveryBlockers?.[event.diagnostic.blockerId]
                ?.unresolvedAt ?? event.diagnostic.observedAt,
            lastObservedAt: event.diagnostic.observedAt,
          },
        );
      else if (event.diagnostic.outcome === "succeeded") {
        const blockers = { ...(aggregate.codexRecoveryBlockers ?? {}) };
        delete blockers[event.diagnostic.blockerId];
        aggregate.codexRecoveryBlockers = blockers;
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
      if (
        aggregate.pendingQueuePromotion?.operationId ===
          event.delivery.operationId &&
        [
          "acceptance_observed",
          "message_materialized",
          "non_submission_established",
          "unresolved",
        ].includes(event.delivery.state)
      )
        delete aggregate.pendingQueuePromotion;
      if (
        aggregate.requestedOperation.type === "message" &&
        aggregate.requestedOperation.operationId ===
          event.delivery.operationId &&
        [
          "dispatch_not_started",
          "acceptance_observed",
          "message_materialized",
          "non_submission_established",
        ].includes(event.delivery.state)
      ) {
        aggregate.recoveryRequired = null;
        aggregate.requestedOperation = {
          type: "observe",
          taskId: aggregate.taskId,
        };
      }
      break;
    }
    case "runtime_inventory_observed":
      aggregate.runtime = structuredClone(event.runtime);
      reconcileHandoffAttentionProjection(aggregate);
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
      reconcileHandoffAttentionProjection(aggregate);
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
  synchronizeCodexRecoveryRequired(aggregate);
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

function hasInterruptibleAcceptedWork(aggregate: TaskAggregate): boolean {
  if (aggregate.launch?.executionMode === "capture") return false;
  if (aggregate.desiredState !== "open") return false;
  if (aggregate.codex.turn === "active") return true;
  if (aggregate.record?.bootstrap.stage !== "complete" && aggregate.launch)
    return true;
  if (
    ["completed", "failed", "interrupted"].includes(aggregate.codex.turn) &&
    aggregate.recoveryRequired === null
  )
    return false;
  return Object.values(aggregate.conversation.items).some((item) => {
    if (item.kind !== "user_message" || !item.acceptedAt || !item.clientId)
      return false;
    if (
      item.turnId &&
      aggregate.conversation.terminalTurns?.[item.turnId] !== undefined
    )
      return false;
    return (
      aggregate.messageDeliveries[item.clientId]?.state !==
      "non_submission_established"
    );
  });
}

function withInterruptCapability(
  output: NativeLifecycleOutput,
  aggregate: TaskAggregate,
): NativeLifecycleOutput {
  if (!hasInterruptibleAcceptedWork(aggregate)) return output;
  const allowedActions = output.allowedActions.includes("interrupt")
    ? output.allowedActions
    : [...output.allowedActions, "interrupt" as const];
  if (aggregate.requestedOperation.type !== "interrupt")
    return { ...output, allowedActions };
  const interruptCommand =
    output.nextCommand?.type === "interrupt_codex_turn"
      ? output.nextCommand
      : null;
  const prerequisiteCommand =
    output.nextCommand !== null && interruptCommand === null
      ? output.nextCommand
      : null;
  return {
    ...output,
    allowedActions,
    nextCommand: interruptCommand ?? prerequisiteCommand,
    confirmation:
      interruptCommand !== null || prerequisiteCommand !== null
        ? output.confirmation
        : null,
    operationDisposition: {
      type: "interrupt",
      operationId: aggregate.requestedOperation.operationId ?? null,
      status: prerequisiteCommand ? "deferred-for-convergence" : "accepted",
      reason: prerequisiteCommand
        ? "Stop is retained while current task truth converges."
        : interruptCommand
          ? "Current accepted work will be interrupted."
          : "Future dispatch for current accepted work is prevented.",
    },
  };
}

function outputFor(aggregate: TaskAggregate): NativeLifecycleOutput {
  if (aggregate.recoveryRequired) {
    let underlying: NativeLifecycleOutput | null = null;
    if (aggregate.record !== null)
      try {
        underlying = reduceTaskLifecycle(aggregateLifecycleInput(aggregate));
      } catch {
        // The blocker remains authoritative when contradictory facts cannot
        // form a valid lifecycle input. Recovery must not manufacture actions.
      }
    const safeActions = (underlying?.allowedActions ?? []).filter((action) =>
      ["interrupt", "return_control"].includes(action),
    );
    const recoveryOutput: NativeLifecycleOutput = {
      taskId: aggregate.taskId,
      phase: "recovering",
      allowedActions: safeActions,
      nextCommand:
        aggregate.requestedOperation.type === "interrupt" &&
        underlying?.nextCommand?.type === "interrupt_codex_turn"
          ? underlying.nextCommand
          : null,
      confirmation:
        aggregate.requestedOperation.type === "interrupt" &&
        underlying?.nextCommand?.type === "interrupt_codex_turn"
          ? underlying.confirmation
          : null,
      attention: null,
      operationDisposition: {
        type: aggregate.requestedOperation.type,
        operationId: aggregate.requestedOperation.operationId ?? null,
        status: "rejected",
        reason: "The affected operation requires truth-based recovery.",
      },
    };
    return withInterruptCapability(recoveryOutput, aggregate);
  }
  if (
    aggregate.record === null &&
    aggregate.requestedOperation.type === "interrupt"
  )
    return withInterruptCapability(
      {
        taskId: aggregate.taskId,
        phase: "starting",
        allowedActions: [],
        nextCommand: null,
        confirmation: null,
        attention: null,
        operationDisposition: {
          type: "interrupt",
          operationId: aggregate.requestedOperation.operationId ?? null,
          status: "deferred-for-convergence",
          reason: "Stop is retained while durable task startup converges.",
        },
      },
      aggregate,
    );
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
    return withInterruptCapability(
      {
        taskId: aggregate.taskId,
        phase: "starting",
        allowedActions: ["finish"],
        nextCommand: inventory.nextCommand,
        confirmation: null,
        attention: inventory.attention,
        operationDisposition: inventory.operationDisposition,
      },
      aggregate,
    );
  }
  return withInterruptCapability(
    reduceTaskLifecycle(aggregateLifecycleInput(aggregate)),
    aggregate,
  );
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
    case "prepare_codex_reassociation":
      if (!next.record)
        throw new Error("Codex reassociation requires a durable task record.");
      delete next.record.identity.threadId;
      next.record.bootstrap.stage = "thread_dispatching";
      next.codex = {
        availability: next.codex.availability,
        threadExists: false,
        threadSource: next.record.bootstrap.threadSource,
        sourceLookup: "none",
        runtimeStatus: "unknown",
        archived: null,
        turn: "none",
      };
      next.codexSessionId = null;
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
      if (payload.stage === "complete") {
        next.desiredState = "open";
        next.record.desiredState = "open";
        delete next.record.closeOperation;
      }
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
    queue: structuredClone(aggregate.queue),
    customerActiveIntervals: structuredClone(aggregate.customerActiveIntervals),
    messageDeliveries: structuredClone(aggregate.messageDeliveries),
    recoveryRequired: aggregate.recoveryRequired,
    codexReconciliation: structuredClone(aggregate.codexReconciliation ?? []),
    codexRecoveryBlockers: structuredClone(
      aggregate.codexRecoveryBlockers ?? {},
    ),
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
      ...(aggregate.pendingQueuePromotion?.workflowContext
        ? {
            workflowContext: aggregate.pendingQueuePromotion.workflowContext,
          }
        : {}),
      ...(aggregate.pendingQueuePromotion?.selectedResultContext
        ? {
            selectedResultContext:
              aggregate.pendingQueuePromotion.selectedResultContext,
          }
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

function recordAcceptedUserMaterial(
  aggregate: TaskAggregate,
  input: {
    operationId: string;
    text: string;
    acceptedAt: string;
    attachments?: TaskConversationItem["attachments"];
  },
): void {
  const operationId = input.operationId;
  const id = `user:${operationId}`;
  const text = input.text;
  const attachments = input.attachments;
  const matchingItems = Object.entries(aggregate.conversation.items).filter(
    ([, item]) => item.kind === "user_message" && item.clientId === operationId,
  );
  if (matchingItems.length > 1)
    throw new Error("Accepted user message identity is ambiguous.");
  const [providerKey, providerItem] = matchingItems[0] ?? [];
  const existing = aggregate.conversation.items[id];
  if (
    existing &&
    (existing.kind !== "user_message" ||
      existing.clientId !== operationId ||
      existing.text !== text)
  )
    throw new Error(
      "Accepted user message identity conflicts with transcript.",
    );
  const accepted: TaskConversationItem = {
    id,
    kind: "user_message",
    status: "completed",
    clientId: operationId,
    acceptedAt: existing?.acceptedAt ?? input.acceptedAt,
    startedAt: existing?.startedAt ?? input.acceptedAt,
    completedAt: existing?.completedAt ?? input.acceptedAt,
    text,
    ...(attachments?.length
      ? { attachments: structuredClone(attachments) }
      : {}),
    ...(providerItem?.turnId ? { turnId: providerItem.turnId } : {}),
    ...(providerItem ? { providerItemId: providerItem.id } : {}),
  };
  const items = { ...aggregate.conversation.items };
  if (providerKey && providerKey !== id) delete items[providerKey];
  items[id] = accepted;
  const previousOrder =
    aggregate.conversation.itemOrder ??
    Object.keys(aggregate.conversation.items);
  const itemOrder = [
    ...new Set([
      ...previousOrder.map((itemId) => (itemId === providerKey ? id : itemId)),
      id,
    ]),
  ].slice(-256);
  aggregate.conversation = {
    ...aggregate.conversation,
    items: Object.fromEntries(
      itemOrder.flatMap((itemId) => {
        const item = items[itemId];
        return item ? [[itemId, item] as const] : [];
      }),
    ),
    itemOrder,
  };
}

function recordAcceptedUserItem(
  aggregate: TaskAggregate,
  event: Extract<
    TaskEvent,
    {
      type:
        | "task_launch_requested"
        | "task_message_requested"
        | "explicit_continuation_response_requested";
    }
  >,
): void {
  recordAcceptedUserMaterial(aggregate, {
    operationId: event.operationId,
    text:
      event.type === "task_launch_requested"
        ? event.launch.outcome
        : event.message,
    acceptedAt: event.observedAt,
    attachments:
      event.type === "task_launch_requested"
        ? event.launch.attachmentMetadata
        : event.attachmentMetadata,
  });
}

function promoteNextQueuedEntry(
  aggregate: TaskAggregate,
  observedAt: string,
): boolean {
  const entryId = aggregate.queue.order[0];
  const entry = entryId ? aggregate.queue.entries[entryId] : undefined;
  if (!entry) return false;
  const entries = { ...aggregate.queue.entries };
  delete entries[entry.id];
  aggregate.queue = {
    entries,
    order: aggregate.queue.order.filter((id) => id !== entry.id),
  };
  aggregate.pendingQueuePromotion = structuredClone(entry);
  aggregate.requestedOperation = {
    type: "message",
    taskId: aggregate.taskId,
    operationId: entry.operationId,
    message: entry.message,
    ...(entry.attachmentIds.length
      ? { attachmentIds: [...entry.attachmentIds] }
      : {}),
  };
  recordAcceptedUserMaterial(aggregate, {
    operationId: entry.operationId,
    text: entry.message,
    acceptedAt: observedAt,
    attachments: entry.attachmentMetadata,
  });
  return true;
}

const ACTIVE_ATTENTION_STATES = new Set([
  "pending",
  "responding",
  "awaiting_confirmation",
  "resolution_unknown",
]);

function currentAcceptedSegmentId(aggregate: TaskAggregate): string | null {
  const ids = aggregate.conversation.itemOrder ?? [];
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    const item = aggregate.conversation.items[ids[index]!];
    if (item?.kind === "user_message" && item.acceptedAt) return item.id;
  }
  return null;
}

function customerSemanticActive(aggregate: TaskAggregate): boolean {
  const segmentId = currentAcceptedSegmentId(aggregate);
  if (!segmentId || aggregate.desiredState !== "open") return false;
  if (aggregate.recoveryRequired !== null) return false;
  if (aggregate.requestedOperation.type === "interrupt") return false;
  if (
    aggregate.attentions.some((attention) =>
      ACTIVE_ATTENTION_STATES.has(attention.status),
    )
  )
    return false;
  if (
    aggregate.runtime.controller === "human" ||
    aggregate.runtime.status === "awaiting_human"
  )
    return false;
  if (aggregate.requestedOperation.type === "message") return true;
  if (aggregate.record?.bootstrap.stage !== "complete") return true;
  if (aggregate.codex.turn !== "active") return false;
  const item = aggregate.conversation.items[segmentId];
  return (
    item?.clientId !== undefined &&
    aggregate.messageDeliveries[item.clientId]?.state !==
      "non_submission_established"
  );
}

function updateCustomerActiveIntervals(
  aggregate: TaskAggregate,
  observedAt: string,
): void {
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp)) return;
  const intervals = [...(aggregate.customerActiveIntervals ?? [])];
  const open = intervals.at(-1);
  const segmentId = currentAcceptedSegmentId(aggregate);
  const active = customerSemanticActive(aggregate) && segmentId !== null;
  if (open && open.endedAt === undefined) {
    if (active && open.segmentId === segmentId) return;
    const start = Date.parse(open.startedAt);
    intervals[intervals.length - 1] = {
      ...open,
      endedAt: new Date(Math.max(start, timestamp)).toISOString(),
    };
  }
  if (active && segmentId) {
    intervals.push({ segmentId, startedAt: observedAt });
  }
  aggregate.customerActiveIntervals = intervals.slice(-128);
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
        (event.type === "task_message_requested" ||
          event.type === "task_queue_steer_requested") &&
        current?.record?.bootstrap.stage !== "complete"
      )
        throw new Error(
          "A task message cannot be accepted before bootstrap completes.",
        );
      if (
        (event.type === "task_message_requested" ||
          event.type === "task_queue_steer_requested") &&
        event.expectedTurnId !== undefined &&
        (current?.codex.turn !== "active" ||
          current.codex.turnId !== event.expectedTurnId)
      )
        throw new Error("Steer targets a stale or mismatched active turn.");
      if (
        current &&
        incomingOperation &&
        current.requestedOperation.type !== "observe" &&
        current.requestedOperation.operationId !==
          incomingOperation.operationId &&
        event.type !== "task_finish_requested" &&
        event.type !== "task_interrupt_requested" &&
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
      synchronizeCodexRecoveryRequired(aggregate);
      if (
        event.type === "codex_turn_observed" &&
        event.turn.turn === "completed" &&
        event.turn.turnId !== undefined &&
        current?.codex.turn === "active" &&
        current.codex.turnId === event.turn.turnId &&
        aggregate.codex.turn === "completed" &&
        aggregate.requestedOperation.type === "observe" &&
        aggregate.recoveryRequired === null &&
        !aggregate.attentions.some((attention) =>
          ACTIVE_ATTENTION_STATES.has(attention.status),
        )
      )
        promoteNextQueuedEntry(aggregate, event.observedAt);
      const output = outputFor(aggregate);
      if (
        (event.type === "task_launch_requested" ||
          event.type === "task_message_requested" ||
          event.type === "explicit_continuation_response_requested") &&
        output.operationDisposition.status !== "rejected"
      )
        recordAcceptedUserItem(aggregate, event);
      updateCustomerActiveIntervals(aggregate, event.observedAt);
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
