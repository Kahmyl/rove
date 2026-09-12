import {
  lifecycleContract as generatedLifecycleContract,
  reduceLifecycleInventory as generatedInventoryReducer,
  reduceTaskLifecycle as generatedTaskReducer,
} from "./native-lifecycle-contract.generated.js";

export type NativeLifecyclePhase =
  | "starting"
  | "ready"
  | "working"
  | "waiting_for_human"
  | "recovering"
  | "cleanup_required"
  | "closing"
  | "closed"
  | "failed";
export type NativeLifecycleAction =
  | "observe"
  | "launch"
  | "finish"
  | "retry_cleanup"
  | "message"
  | "interrupt"
  | "return_control"
  | "respond_attention"
  | "resume"
  | "archive";
export type NativeLifecycleCommandType =
  | "persist_bootstrap_intent"
  | "lookup_or_start_runtime"
  | "bind_runtime_identity"
  | "lookup_or_start_codex_thread"
  | "bind_codex_identity"
  | "advance_bootstrap_stage"
  | "read_codex_thread"
  | "read_runtime_inventory"
  | "read_lifecycle_truth"
  | "persist_close_intent"
  | "interrupt_codex_turn"
  | "settle_continuation_attention"
  | "end_runtime_session"
  | "advance_close_stage"
  | "relaunch_named_browser"
  | "resume_codex_thread"
  | "unarchive_codex_thread"
  | "recover_codex_thread"
  | "inspect_after_return"
  | "record_return_event"
  | "prepare_continuation_command"
  | "persist_continuation_dispatch_intent"
  | "dispatch_or_reconcile_continuation"
  | "reconcile_continuation_dispatch"
  | "respond_continuation_explicit"
  | "reconcile_attention_response"
  | "start_or_steer_codex_turn"
  | "return_runtime_ownership"
  | "respond_codex_attention"
  | "archive_codex_thread";

export const NATIVE_LIFECYCLE_COMMAND_TYPES = [
  "persist_bootstrap_intent",
  "lookup_or_start_runtime",
  "bind_runtime_identity",
  "lookup_or_start_codex_thread",
  "bind_codex_identity",
  "advance_bootstrap_stage",
  "read_codex_thread",
  "read_runtime_inventory",
  "read_lifecycle_truth",
  "persist_close_intent",
  "interrupt_codex_turn",
  "settle_continuation_attention",
  "end_runtime_session",
  "advance_close_stage",
  "relaunch_named_browser",
  "resume_codex_thread",
  "unarchive_codex_thread",
  "recover_codex_thread",
  "inspect_after_return",
  "record_return_event",
  "prepare_continuation_command",
  "persist_continuation_dispatch_intent",
  "dispatch_or_reconcile_continuation",
  "reconcile_continuation_dispatch",
  "respond_continuation_explicit",
  "reconcile_attention_response",
  "start_or_steer_codex_turn",
  "return_runtime_ownership",
  "respond_codex_attention",
  "archive_codex_thread",
] as const satisfies readonly NativeLifecycleCommandType[];

export function parseNativeLifecycleCommandType(
  value: unknown,
): NativeLifecycleCommandType {
  if (!(NATIVE_LIFECYCLE_COMMAND_TYPES as readonly unknown[]).includes(value))
    throw new Error("Unknown native lifecycle command type.");
  return value as NativeLifecycleCommandType;
}

export type NativeBrowserIdentity =
  { mode: "temporary" } | { mode: "workspace"; workspaceId: string };
export interface NativeTaskRecord {
  schemaVersion: 1;
  identity: {
    taskId: string;
    sessionId?: string;
    threadId?: string;
    browser?: NativeBrowserIdentity;
  };
  bootstrap: {
    operationId: string;
    threadSource: string;
    stage:
      | "intent_persisted"
      | "runtime_dispatching"
      | "runtime_bound"
      | "thread_dispatching"
      | "complete";
  };
  desiredState: "open" | "closed";
  closeOperation?: {
    operationId: string;
    requestedAt: string;
    stage:
      | "requested"
      | "codex_settled"
      | "continuation_settled"
      | "runtime_settled"
      | "complete";
    lastAttemptAt?: string;
    boundedFailure?: string;
  };
  lastAttemptAt?: string;
  boundedFailure?: string;
  lastConvergence?: {
    at: string;
    phase: NativeLifecyclePhase;
    commandType: NativeLifecycleCommandType | null;
    operationId?: string;
  };
}
export interface NativeCodexTruth {
  availability: "available" | "unavailable";
  threadExists: boolean;
  threadId?: string;
  threadSource?: string;
  sourceLookup: "none" | "exact" | "conflicting" | "unknown";
  runtimeStatus: "notLoaded" | "idle" | "active" | "systemError" | "unknown";
  archived: boolean | null;
  turn: "none" | "active" | "completed" | "failed" | "interrupted" | "unknown";
  turnId?: string;
}
export interface NativeRuntimeTruth {
  availability: "available" | "unavailable";
  sessionExists: boolean;
  sessionId?: string;
  bootstrapId?: string;
  bootstrapLookup: "none" | "exact" | "conflicting" | "unknown";
  status:
    | "missing"
    | "starting"
    | "active"
    | "paused"
    | "awaiting_human"
    | "completed"
    | "failed"
    | "unknown";
  controller: "agent" | "human" | null;
  attachment: "attached" | "missing" | "conflicting" | "unknown";
  profileLock: "owned" | "released" | "claimable" | "conflicting" | "unknown";
  browserIdentity?: NativeBrowserIdentity;
  recovery:
    | "not_needed"
    | "relaunchable"
    | "cleanup_required"
    | "unrecoverable"
    | "unknown";
  legacyEffects?:
    "not_applicable" | "acknowledgement_required" | "acknowledged";
  ownershipGeneration?: number;
  handoffId?: string;
  handoffGeneration?: number;
  lastReturnedHandoffId?: string;
  observationSeq?: number;
}
export interface NativeContinuationTruth {
  status: "none" | "pending" | "consumed" | "cancelled" | "superseded";
  id?: string;
  taskId?: string;
  sessionId?: string;
  threadId?: string;
  handoffId?: string;
  generation?: number;
  policy?: "resume_after_control_return" | "explicit_user_response";
  freshInspectionRequired?: boolean;
  preHandoffObservationSeq?: number;
  returnEventId?: string;
  returnObservationSeq?: number;
  command?: {
    commandId: string;
    returnEventId: string;
    kind: "turn/start" | "turn/steer";
    dispatchStatus:
      "not_started" | "possibly_started" | "terminal" | "resolution_unknown";
  };
}
export interface NativeAttentionTruth {
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
  /** Exact App Server request method and wire identity retained for response. */
  method?: string;
  wireRequestId?: string | number;
  responseFields?: Record<string, unknown>;
  taskId: string;
  sessionId?: string;
  threadId: string;
  turnId?: string;
  itemId?: string;
  handoffId?: string;
  generation: number;
  status:
    | "pending"
    | "responding"
    | "awaiting_confirmation"
    | "resolution_unknown"
    | "resolved"
    | "cancelled"
    | "stale";
}
export interface NativeFreshInspectionProof {
  inspectionId: string;
  sessionId: string;
  handoffId: string;
  generation: number;
  afterObservationSeq: number;
}
export interface NativeRequestedOperation {
  type: NativeLifecycleAction;
  taskId?: string;
  operationId?: string;
  requestId?: string;
  generation?: number;
  message?: string;
  response?: unknown;
  expectedTurnId?: string;
  attachmentIds?: readonly string[];
}
export interface NativeLifecycleInput {
  record: NativeTaskRecord | null;
  codex: NativeCodexTruth;
  runtime: NativeRuntimeTruth;
  continuation: NativeContinuationTruth;
  attentions: NativeAttentionTruth[];
  freshInspection: NativeFreshInspectionProof | null;
  requestedOperation: NativeRequestedOperation;
}
export interface NativeLifecycleOutput {
  taskId: string | null;
  phase: NativeLifecyclePhase;
  allowedActions: NativeLifecycleAction[];
  nextCommand:
    ({ type: NativeLifecycleCommandType } & Record<string, unknown>) | null;
  confirmation: ({ type: string } & Record<string, unknown>) | null;
  attention: { code: string; message: string } | null;
  operationDisposition: {
    type: NativeLifecycleAction;
    operationId: string | null;
    status: "accepted" | "deferred-for-convergence" | "rejected";
    reason: string;
  };
}
export interface NativeLifecycleInventoryInput {
  tasks: NativeLifecycleInput[];
  requestedOperation: NativeRequestedOperation & { type: "launch" };
}

export const reduceTaskLifecycle = generatedTaskReducer as (
  input: NativeLifecycleInput,
) => NativeLifecycleOutput;
export const reduceLifecycleInventory = generatedInventoryReducer as (
  input: NativeLifecycleInventoryInput,
) => unknown;
export const lifecycleContract = generatedLifecycleContract as Readonly<
  Record<string, unknown>
>;
