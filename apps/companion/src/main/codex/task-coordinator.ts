import { authoritativePreHandoffObservationSeq } from "./handoff-observation.js";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  canonicalRoveToolDefinitionsJsonWire,
  ROVE_TOOL_CATALOG,
  ROVE_TOOL_DEFINITIONS_SHA256,
  type ControlStatus,
  type NativeBrowserIdentity,
  type NativeCodexTruth,
  type NativeContinuationTruth,
  type NativeLifecycleInput,
  type NativeLifecycleCommandType,
  type NativeLifecycleOutput,
  type NativeRuntimeTruth,
  type TaskProcessCommand,
  type TaskProcessDurableData,
  validateTaskProcessDurableData,
  type TaskProcessState,
  type Session,
  type RuntimeSessionInventory,
  type Recording,
  type StartSessionRequest,
  type StartRecordingRequest,
  type TaskWorkflowContextSnapshot,
  type TaskResultActionPlan,
} from "@rove/protocol";
import { APPROVED_CODEX_CLI_VERSION } from "./compatibility.js";
import { customerTaskCapabilities } from "./customer-task-capabilities.js";
import type { CustomerTaskExecutionProjection } from "./customer-task-execution.js";

export type ProductionLifecycleCommandClass =
  | "internal_durable_transition"
  | "external_dispatch"
  | "observation_reconciliation";

export const PRODUCTION_LIFECYCLE_COMMAND_CLASS = {
  persist_bootstrap_intent: "internal_durable_transition",
  lookup_or_start_runtime: "external_dispatch",
  bind_runtime_identity: "internal_durable_transition",
  lookup_or_start_codex_thread: "external_dispatch",
  prepare_codex_reassociation: "internal_durable_transition",
  bind_codex_identity: "internal_durable_transition",
  advance_bootstrap_stage: "internal_durable_transition",
  read_codex_thread: "observation_reconciliation",
  read_runtime_inventory: "observation_reconciliation",
  read_lifecycle_truth: "observation_reconciliation",
  persist_close_intent: "internal_durable_transition",
  interrupt_codex_turn: "external_dispatch",
  settle_continuation_attention: "internal_durable_transition",
  end_runtime_session: "external_dispatch",
  advance_close_stage: "internal_durable_transition",
  relaunch_named_browser: "external_dispatch",
  resume_codex_thread: "external_dispatch",
  unarchive_codex_thread: "external_dispatch",
  recover_codex_thread: "external_dispatch",
  inspect_after_return: "external_dispatch",
  record_return_event: "internal_durable_transition",
  prepare_continuation_command: "internal_durable_transition",
  persist_continuation_dispatch_intent: "internal_durable_transition",
  dispatch_or_reconcile_continuation: "external_dispatch",
  reconcile_continuation_dispatch: "observation_reconciliation",
  respond_continuation_explicit: "external_dispatch",
  reconcile_attention_response: "observation_reconciliation",
  start_or_steer_codex_turn: "external_dispatch",
  return_runtime_ownership: "external_dispatch",
  respond_codex_attention: "external_dispatch",
  archive_codex_thread: "external_dispatch",
} as const satisfies Record<
  NativeLifecycleCommandType,
  ProductionLifecycleCommandClass
>;

import type {
  CodexAccountProjection,
  CodexModelProjection,
} from "./account-catalog.js";
import {
  CodexConversationService,
  type ConversationAssociation,
  type ConversationAssociationStore,
} from "./conversations.js";
import {
  isEmptyDurableConversation,
  isPinnedEmptyLegacyThreadFailure,
  isPinnedThreadNotLoadedFailure,
} from "./history-compatibility.js";
import type {
  AttachmentRuntimeMaterializer,
  TaskAttachmentAuthority,
  TaskAttachmentDescriptor,
} from "./task-attachments.js";
import { browserRouteDeveloperInstructions } from "./browser-route-policy.js";
import { normalizeCompletedRequestHumanToolItem } from "./request-human-tool-item.js";
import type {
  DurableContinuationStore,
  PendingContinuation,
} from "./continuations.js";
import type { AttentionRequest, OrderedAttentionQueue } from "./attention.js";
import { reduceProductionTaskLifecycle } from "./lifecycle-contract.js";
import type {
  CodexRpcPort,
  CodexServerEvent,
  CodexThread,
  CodexThreadItem,
  JsonValue,
  McpServerStatus,
  TurnStartResponse,
  TurnSteerResponse,
  UserInput,
} from "./protocol.js";
import type { StateRepository } from "./persistence.js";
import {
  boundedIdentity,
  boundedOpaqueIdentity,
  exactKeys,
  requiredString,
  sha256Digest,
  strictRecord,
  strictRfc3339,
} from "./state-validation.js";
import type {
  TaskProcessAdapterContext,
  TaskProcessAdapterResult,
} from "./task-process-worker.js";

export interface TaskProcessDriver {
  runUntilIdle(taskId: string): Promise<void>;
}

export type ExecutionMode = "agent" | "companion" | "capture";
export type ApprovalsReviewer = "auto_review" | "user";
export type BrowserIdentity =
  { mode: "temporary" } | { mode: "workspace"; workspaceId: string };
export type BootstrapStage =
  | "intent_persisted"
  | "runtime_dispatching"
  | "runtime_bound"
  | "attachments_binding"
  | "attachments_bound"
  | "mcp_verified"
  | "rollback_pending"
  | "rollback_evidence_settled"
  | "rollback_runtime_settled"
  | "rollback_attachments_settled"
  | "thread_dispatching"
  | "complete";
export interface FrozenTaskPolicy {
  cwd: string;
  model?: string;
  reasoningEffort?: string;
  approvalPolicy: "on-request";
  approvalsReviewer: ApprovalsReviewer;
  sandbox: "workspace-write";
}
export interface BootstrapState {
  attemptId: string;
  threadSource: string;
  stage: BootstrapStage;
}
function lifecycleBootstrapStage(stage: BootstrapStage) {
  switch (stage) {
    case "attachments_binding":
    case "attachments_bound":
    case "mcp_verified":
    case "rollback_pending":
    case "rollback_evidence_settled":
    case "rollback_runtime_settled":
    case "rollback_attachments_settled":
      return "runtime_bound" as const;
    default:
      return stage;
  }
}
function lifecycleCloseStage(stage: TaskCloseOperation["stage"]) {
  return stage === "attachments_settled" ? ("runtime_settled" as const) : stage;
}
export type ProductLifecyclePhase =
  | "starting"
  | "ready"
  | "working"
  | "waiting_for_human"
  | "recovering"
  | "cleanup_required"
  | "closing"
  | "closed"
  | "failed";
export type ProductLifecycleAction =
  | "message"
  | "interrupt"
  | "return_control"
  | "resume"
  | "finish"
  | "retry_cleanup"
  | "archive"
  | "acknowledge_legacy_effects";
export interface TaskCloseOperation {
  operationId: string;
  requestedAt: string;
  stage:
    | "requested"
    | "codex_settled"
    | "continuation_settled"
    | "runtime_settled"
    | "attachments_settled"
    | "complete";
  lastAttemptAt?: string;
  boundedFailure?: string;
}
export interface TaskLifecycleState {
  schemaVersion: 1;
  desiredState: "open" | "closed";
  closeOperation?: TaskCloseOperation;
  lastConvergence?: {
    at: string;
    phase: ProductLifecyclePhase;
    reason: string;
  };
}
export type InitialLaunchStage =
  | "requested"
  | "infrastructure_ready"
  | "turn_dispatching"
  | "reconciliation_required"
  | "turn_started";
export interface InitialLaunchJournal {
  operationId: string;
  inputDigest: string;
  stage: InitialLaunchStage;
  requestedAt: string;
  outcome?: string;
  turnId?: string;
  boundedFailure?: string;
}
export type InitialLaunchFaultPoint = InitialLaunchStage | "turn_accepted";
export interface ResolvedTaskContext {
  roveTaskId: string;
  executionMode: ExecutionMode;
  browserIdentity: BrowserIdentity;
  selectionSource: "user_selected" | "remembered_default" | "workflow_policy";
  selectedAt: string;
  policy: FrozenTaskPolicy;
  bootstrap: BootstrapState;
  roveSessionId?: string;
  codexThreadId?: string;
  codexSessionId?: string;
  capabilityFingerprint?: string;
  attachmentIds?: readonly string[];
  workflowAssociation?: {
    workflowId: string;
    workflowName: string;
  };
  workflowContext?: TaskWorkflowContextSnapshot;
  initialLaunch?: InitialLaunchJournal;
  /** Optional only on the accepted v2 migration input; validation materializes it. */
  lifecycle?: TaskLifecycleState;
}
export interface TaskContextState {
  contexts: Record<string, ResolvedTaskContext>;
}

const MAX_TASK_CONTEXTS = 256;

function canonicalUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function preJournalCleanupLifecycle(
  context: ResolvedTaskContext,
): TaskLifecycleState {
  return {
    schemaVersion: 1,
    desiredState: "closed",
    closeOperation: {
      operationId: `intent_${canonicalUuid(`pre-journal:${context.roveTaskId}`)}`,
      requestedAt: context.selectedAt,
      stage: "requested",
      boundedFailure:
        "Pre-journal launch outcome is unavailable; cleanup is required.",
    },
    lastConvergence: {
      at: context.selectedAt,
      phase: "cleanup_required",
      reason:
        "Pre-journal launch outcome is unavailable; it will not be replayed.",
    },
  };
}
function contractIdentity(
  value: string,
  kind: "task" | "session" | "workspace" | "bootstrap" | "handoff",
): string {
  if (kind === "task" && /^task_[a-f0-9-]{36}$/.test(value)) return value;
  if (kind === "session" && /^ses_[a-f0-9]{32}$/.test(value)) return value;
  if (kind === "workspace" && /^wrk_[a-f0-9-]{36}$/.test(value)) return value;
  if (kind === "bootstrap" && /^boot_[a-f0-9]{32}$/.test(value)) return value;
  if (kind === "handoff" && /^handoff_[a-f0-9]{32}$/.test(value)) return value;
  const uuid = canonicalUuid(`${kind}:${value}`);
  if (kind === "session" || kind === "bootstrap" || kind === "handoff")
    return `${kind === "session" ? "ses" : kind === "bootstrap" ? "boot" : "handoff"}_${uuid.replaceAll("-", "")}`;
  return `${kind === "task" ? "task" : "wrk"}_${uuid}`;
}
function canonicalTimestamp(value: string): string {
  return new Date(value).toISOString();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = requiredString;
export function validateTaskContext(value: unknown): ResolvedTaskContext {
  if (!isRecord(value)) throw new Error("Invalid persisted task context.");
  exactKeys(
    value,
    [
      "roveTaskId",
      "executionMode",
      "browserIdentity",
      "selectionSource",
      "selectedAt",
      "policy",
      "bootstrap",
      "roveSessionId",
      "codexThreadId",
      "codexSessionId",
      "capabilityFingerprint",
      "attachmentIds",
      "initialLaunch",
      "lifecycle",
    ],
    "task context",
  );
  const roveTaskId = boundedIdentity(
    value.roveTaskId,
    "Rove task identity",
    /^task_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,
  );
  const executionMode = value.executionMode;
  if (
    executionMode !== "agent" &&
    executionMode !== "companion" &&
    executionMode !== "capture"
  )
    throw new Error("Invalid execution mode.");
  if (!isRecord(value.browserIdentity))
    throw new Error("Invalid browser identity.");
  exactKeys(value.browserIdentity, ["mode", "workspaceId"], "browser identity");
  const browserIdentity: BrowserIdentity =
    value.browserIdentity.mode === "temporary" &&
    value.browserIdentity.workspaceId === undefined
      ? { mode: "temporary" }
      : value.browserIdentity.mode === "workspace" &&
          typeof value.browserIdentity.workspaceId === "string" &&
          /^wrk_[a-f0-9-]{36}$/.test(value.browserIdentity.workspaceId)
        ? { mode: "workspace", workspaceId: value.browserIdentity.workspaceId }
        : (() => {
            throw new Error("Invalid browser identity.");
          })();
  const selectionSource = value.selectionSource;
  if (
    selectionSource !== "user_selected" &&
    selectionSource !== "remembered_default" &&
    selectionSource !== "workflow_policy"
  )
    throw new Error("Invalid selection source.");
  const selectedAt = strictRfc3339(value.selectedAt, "selection timestamp");
  if (!isRecord(value.policy)) throw new Error("Invalid frozen task policy.");
  exactKeys(
    value.policy,
    [
      "cwd",
      "model",
      "reasoningEffort",
      "approvalPolicy",
      "approvalsReviewer",
      "sandbox",
    ],
    "task policy",
  );
  const cwd = nonempty(value.policy.cwd, "task cwd");
  if (!cwd.startsWith("/")) throw new Error("Task cwd must be absolute.");
  if (
    value.policy.approvalPolicy !== "on-request" ||
    value.policy.sandbox !== "workspace-write"
  )
    throw new Error("Invalid frozen task security policy.");
  const approvalsReviewer =
    value.policy.approvalsReviewer === undefined
      ? "user"
      : value.policy.approvalsReviewer === "auto_review" ||
          value.policy.approvalsReviewer === "user"
        ? value.policy.approvalsReviewer
        : (() => {
            throw new Error("Invalid frozen task approvals reviewer.");
          })();
  if (!isRecord(value.bootstrap)) throw new Error("Invalid bootstrap state.");
  exactKeys(
    value.bootstrap,
    ["attemptId", "threadSource", "stage"],
    "bootstrap state",
  );
  const attemptId = nonempty(value.bootstrap.attemptId, "bootstrap attempt");
  if (!/^boot_[a-f0-9]{32}$/.test(attemptId))
    throw new Error("Invalid bootstrap attempt.");
  const expectedThreadSource = `rove:${roveTaskId}:${attemptId}`;
  if (value.bootstrap.threadSource !== expectedThreadSource)
    throw new Error(
      "Bootstrap thread source does not match its task and attempt.",
    );
  const stage = value.bootstrap.stage;
  if (
    ![
      "intent_persisted",
      "runtime_dispatching",
      "runtime_bound",
      "attachments_binding",
      "attachments_bound",
      "mcp_verified",
      "rollback_pending",
      "rollback_evidence_settled",
      "rollback_runtime_settled",
      "rollback_attachments_settled",
      "thread_dispatching",
      "complete",
    ].includes(String(stage))
  )
    throw new Error("Invalid bootstrap stage.");
  const optional = (
    key:
      | "roveSessionId"
      | "codexThreadId"
      | "codexSessionId"
      | "capabilityFingerprint",
  ) => (value[key] === undefined ? undefined : nonempty(value[key], key));
  const context: ResolvedTaskContext = {
    roveTaskId,
    executionMode,
    browserIdentity,
    selectionSource,
    selectedAt,
    policy: {
      cwd,
      ...(value.policy.model === undefined
        ? {}
        : { model: nonempty(value.policy.model, "model") }),
      ...(value.policy.reasoningEffort === undefined
        ? {}
        : {
            reasoningEffort: nonempty(
              value.policy.reasoningEffort,
              "reasoning effort",
            ),
          }),
      approvalPolicy: "on-request",
      approvalsReviewer,
      sandbox: "workspace-write",
    },
    bootstrap: {
      attemptId,
      threadSource: expectedThreadSource,
      stage: stage as BootstrapStage,
    },
    lifecycle: parseLifecycleState(value.lifecycle),
  };
  const roveSessionId = optional("roveSessionId");
  const codexThreadId = optional("codexThreadId");
  const codexSessionId = optional("codexSessionId");
  const capabilityFingerprint =
    value.capabilityFingerprint === undefined
      ? undefined
      : sha256Digest(value.capabilityFingerprint, "capability fingerprint");
  if (roveSessionId !== undefined)
    boundedIdentity(
      roveSessionId,
      "Rove session identity",
      /^ses_[A-Za-z0-9][A-Za-z0-9_-]*$/,
    );
  if (codexThreadId !== undefined)
    boundedOpaqueIdentity(codexThreadId, "Codex thread identity");
  if (codexSessionId !== undefined)
    boundedOpaqueIdentity(codexSessionId, "Codex session identity");
  if (roveSessionId !== undefined) context.roveSessionId = roveSessionId;
  if (codexThreadId !== undefined) context.codexThreadId = codexThreadId;
  if (codexSessionId !== undefined) context.codexSessionId = codexSessionId;
  if (capabilityFingerprint !== undefined)
    context.capabilityFingerprint = capabilityFingerprint;
  if (value.attachmentIds !== undefined) {
    if (
      !Array.isArray(value.attachmentIds) ||
      value.attachmentIds.length > 100 ||
      new Set(value.attachmentIds).size !== value.attachmentIds.length ||
      value.attachmentIds.some(
        (id) => typeof id !== "string" || !/^att_[a-f0-9]{32}$/.test(id),
      )
    )
      throw new Error("Invalid task attachment identities.");
    context.attachmentIds = value.attachmentIds as string[];
  }
  if (value.initialLaunch !== undefined)
    context.initialLaunch = parseInitialLaunch(value.initialLaunch);
  if (
    context.bootstrap.stage === "complete" &&
    (!context.roveSessionId ||
      !context.codexThreadId ||
      !context.codexSessionId ||
      !context.capabilityFingerprint)
  )
    throw new Error("Complete bootstrap is missing identity bindings.");
  if (
    ["intent_persisted", "runtime_dispatching"].includes(
      context.bootstrap.stage,
    ) &&
    (roveSessionId || codexThreadId || codexSessionId || capabilityFingerprint)
  )
    throw new Error("Unbound bootstrap stage contains bound identities.");
  if (
    [
      "runtime_bound",
      "attachments_binding",
      "attachments_bound",
      "mcp_verified",
      "rollback_pending",
      "rollback_evidence_settled",
      "rollback_runtime_settled",
      "rollback_attachments_settled",
      "thread_dispatching",
    ].includes(context.bootstrap.stage) &&
    (!roveSessionId ||
      !capabilityFingerprint ||
      codexThreadId ||
      codexSessionId)
  )
    throw new Error("Runtime-bound bootstrap has inconsistent identities.");
  if (
    context.initialLaunch !== undefined &&
    (context.executionMode === "capture" ||
      ([
        "infrastructure_ready",
        "turn_dispatching",
        "reconciliation_required",
        "turn_started",
      ].includes(context.initialLaunch.stage) &&
        context.bootstrap.stage !== "complete"))
  )
    throw new Error("Initial launch journal conflicts with task bootstrap.");
  return context;
}

function parseInitialLaunch(value: unknown): InitialLaunchJournal {
  const launch = strictRecord(value, "initial launch journal");
  exactKeys(
    launch,
    [
      "operationId",
      "inputDigest",
      "stage",
      "requestedAt",
      "outcome",
      "turnId",
      "boundedFailure",
    ],
    "initial launch journal",
  );
  const operationId = boundedIdentity(
    launch.operationId,
    "initial launch operation identity",
    /^intent_[a-f0-9-]{36}$/,
  );
  const inputDigest = sha256Digest(
    launch.inputDigest,
    "initial launch input digest",
  );
  const requestedAt = strictRfc3339(
    launch.requestedAt,
    "initial launch requested at",
  );
  if (
    ![
      "requested",
      "infrastructure_ready",
      "turn_dispatching",
      "reconciliation_required",
      "turn_started",
    ].includes(String(launch.stage))
  )
    throw new Error("Invalid initial launch stage.");
  const stage = launch.stage as InitialLaunchStage;
  const outcome =
    launch.outcome === undefined
      ? undefined
      : requiredString(launch.outcome, "initial launch outcome").slice(
          0,
          16_000,
        );
  const turnId =
    launch.turnId === undefined
      ? undefined
      : boundedOpaqueIdentity(launch.turnId, "initial launch turn identity");
  const boundedFailure =
    launch.boundedFailure === undefined
      ? undefined
      : requiredString(launch.boundedFailure, "initial launch failure").slice(
          0,
          240,
        );
  if (
    (stage === "turn_started" && !turnId) ||
    (stage !== "turn_started" && turnId !== undefined) ||
    (stage !== "turn_started" && outcome === undefined)
  )
    throw new Error("Initial launch journal is inconsistent.");
  return {
    operationId,
    inputDigest,
    stage,
    requestedAt,
    ...(outcome === undefined ? {} : { outcome }),
    ...(turnId === undefined ? {} : { turnId }),
    ...(boundedFailure === undefined ? {} : { boundedFailure }),
  };
}

function parseLifecycleState(value: unknown): TaskLifecycleState {
  if (value === undefined) return { schemaVersion: 1, desiredState: "open" };
  const lifecycle = strictRecord(value, "task lifecycle");
  exactKeys(
    lifecycle,
    ["schemaVersion", "desiredState", "closeOperation", "lastConvergence"],
    "task lifecycle",
  );
  if (
    lifecycle.schemaVersion !== 1 ||
    !["open", "closed"].includes(String(lifecycle.desiredState))
  )
    throw new Error("Invalid task lifecycle state.");
  let closeOperation: TaskCloseOperation | undefined;
  if (lifecycle.closeOperation !== undefined) {
    const close = strictRecord(lifecycle.closeOperation, "close operation");
    exactKeys(
      close,
      [
        "operationId",
        "requestedAt",
        "stage",
        "lastAttemptAt",
        "boundedFailure",
      ],
      "close operation",
    );
    const operationId = boundedIdentity(
      close.operationId,
      "close operation identity",
      /^intent_[a-f0-9-]{36}$/,
    );
    const requestedAt = strictRfc3339(close.requestedAt, "close requested at");
    if (
      ![
        "requested",
        "codex_settled",
        "continuation_settled",
        "runtime_settled",
        "attachments_settled",
        "complete",
      ].includes(String(close.stage))
    )
      throw new Error("Invalid close stage.");
    closeOperation = {
      operationId,
      requestedAt,
      stage: close.stage as TaskCloseOperation["stage"],
      ...(close.lastAttemptAt === undefined
        ? {}
        : {
            lastAttemptAt: strictRfc3339(
              close.lastAttemptAt,
              "close attempt timestamp",
            ),
          }),
      ...(close.boundedFailure === undefined
        ? {}
        : {
            boundedFailure: requiredString(
              close.boundedFailure,
              "close failure",
            ).slice(0, 240),
          }),
    };
  }
  if ((lifecycle.desiredState === "closed") !== (closeOperation !== undefined))
    throw new Error("Closed lifecycle requires one close operation.");
  let lastConvergence: TaskLifecycleState["lastConvergence"];
  if (lifecycle.lastConvergence !== undefined) {
    const convergence = strictRecord(
      lifecycle.lastConvergence,
      "last convergence",
    );
    exactKeys(convergence, ["at", "phase", "reason"], "last convergence");
    if (
      ![
        "starting",
        "ready",
        "working",
        "waiting_for_human",
        "recovering",
        "cleanup_required",
        "closing",
        "closed",
        "failed",
      ].includes(String(convergence.phase))
    )
      throw new Error("Invalid convergence phase.");
    lastConvergence = {
      at: strictRfc3339(convergence.at, "convergence timestamp"),
      phase: convergence.phase as ProductLifecyclePhase,
      reason: requiredString(convergence.reason, "convergence reason").slice(
        0,
        240,
      ),
    };
  }
  return {
    schemaVersion: 1,
    desiredState: lifecycle.desiredState as "open" | "closed",
    ...(closeOperation === undefined ? {} : { closeOperation }),
    ...(lastConvergence === undefined ? {} : { lastConvergence }),
  };
}

export function prepareTaskContexts(
  value: unknown,
): Record<string, ResolvedTaskContext> {
  if (!isRecord(value)) throw new Error("Invalid task context collection.");
  if (Object.keys(value).length > MAX_TASK_CONTEXTS)
    throw new Error("Task context bound exceeded.");
  const prepared: Record<string, ResolvedTaskContext> = {};
  for (const [taskId, raw] of Object.entries(value)) {
    const context = validateTaskContext(raw);
    if (taskId !== context.roveTaskId)
      throw new Error("Persisted task context key mismatch.");
    prepared[taskId] = context;
  }
  const launchOperations = Object.values(prepared).flatMap((context) =>
    context.initialLaunch ? [context.initialLaunch.operationId] : [],
  );
  if (new Set(launchOperations).size !== launchOperations.length)
    throw new Error("Initial launch operation identity is duplicated.");
  return prepared;
}

export function prepareTaskContextState(value: unknown): TaskContextState {
  const root = strictRecord(value, "task context repository");
  exactKeys(root, ["contexts"], "task context repository");
  const contexts = prepareTaskContexts(root.contexts);
  for (const [taskId, context] of Object.entries(contexts)) {
    if (
      context.executionMode !== "capture" &&
      context.initialLaunch === undefined &&
      context.bootstrap.stage !== "complete" &&
      !context.bootstrap.stage.startsWith("rollback_") &&
      context.lifecycle?.desiredState !== "closed"
    ) {
      contexts[taskId] = validateTaskContext({
        ...context,
        lifecycle: preJournalCleanupLifecycle(context),
      });
    }
  }
  return { contexts };
}

export class ContextAuthority {
  private readonly contexts = new Map<string, ResolvedTaskContext>();
  resolve(input: ResolvedTaskContext): ResolvedTaskContext {
    const context = validateTaskContext(input);
    const existing = this.contexts.get(context.roveTaskId);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(context))
        throw new Error("Active task context is immutable.");
      return structuredClone(existing);
    }
    prepareTaskContexts({
      ...this.snapshot(),
      [context.roveTaskId]: context,
    });
    this.contexts.set(context.roveTaskId, context);
    return structuredClone(context);
  }
  replace(taskId: string, context: ResolvedTaskContext): ResolvedTaskContext {
    const parsed = validateTaskContext(context);
    if (parsed.roveTaskId !== taskId || !this.contexts.has(taskId))
      throw new Error("Task context replacement mismatch.");
    prepareTaskContexts({ ...this.snapshot(), [taskId]: parsed });
    this.contexts.set(taskId, parsed);
    return structuredClone(parsed);
  }
  get(taskId: string): ResolvedTaskContext | undefined {
    const value = this.contexts.get(taskId);
    return value === undefined ? undefined : structuredClone(value);
  }
  findByThread(threadId: string): ResolvedTaskContext | undefined {
    const value = [...this.contexts.values()].find(
      (entry) => entry.codexThreadId === threadId,
    );
    return value === undefined ? undefined : structuredClone(value);
  }
  findBySession(sessionId: string): ResolvedTaskContext | undefined {
    const matches = [...this.contexts.values()].filter(
      (entry) => entry.roveSessionId === sessionId,
    );
    if (matches.length > 1)
      throw new Error("Runtime session is bound to multiple tasks.");
    return matches[0] === undefined ? undefined : structuredClone(matches[0]);
  }
  snapshot(): Record<string, ResolvedTaskContext> {
    return prepareTaskContexts(
      Object.fromEntries(
        [...this.contexts].map(([id, context]) => [
          id,
          structuredClone(context),
        ]),
      ),
    );
  }
  restore(contexts: unknown): void {
    if (this.contexts.size !== 0)
      throw new Error("Invalid or duplicate context restore.");
    const prepared = prepareTaskContexts(contexts);
    for (const [taskId, context] of Object.entries(prepared))
      this.contexts.set(taskId, context);
  }
  close(taskId: string): void {
    this.contexts.delete(taskId);
  }
}

interface CapabilityClaims {
  taskId: string;
  sessionId: string;
  executionMode: ExecutionMode;
  browserIdentity: BrowserIdentity;
  nonce: string;
}
export class TaskCapabilityIssuer {
  constructor(private readonly key: Buffer = randomBytes(32)) {
    if (key.byteLength !== 32)
      throw new Error("Task capability key must be 32 bytes.");
  }
  issue(claims: Omit<CapabilityClaims, "nonce">): {
    token: string;
    fingerprint: string;
  } {
    const nonce = createHmac("sha256", this.key)
      .update(`${claims.taskId}:${claims.sessionId}`)
      .digest("hex")
      .slice(0, 32);
    const payload = Buffer.from(JSON.stringify({ ...claims, nonce })).toString(
      "base64url",
    );
    const signature = createHmac("sha256", this.key)
      .update(payload)
      .digest("base64url");
    const token = `rtcap_${payload}.${signature}`;
    return {
      token,
      fingerprint: createHash("sha256").update(token).digest("hex"),
    };
  }
  verify(token: string): CapabilityClaims {
    const match = /^rtcap_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
    if (!match?.[1] || !match[2]) throw new Error("Invalid task capability.");
    const expected = createHmac("sha256", this.key).update(match[1]).digest();
    const actual = Buffer.from(match[2], "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new Error("Invalid task capability signature.");
    const claims = JSON.parse(
      Buffer.from(match[1], "base64url").toString("utf8"),
    ) as Partial<CapabilityClaims>;
    if (
      typeof claims.taskId !== "string" ||
      typeof claims.sessionId !== "string" ||
      typeof claims.nonce !== "string" ||
      !["agent", "companion", "capture"].includes(
        String(claims.executionMode),
      ) ||
      !isRecord(claims.browserIdentity)
    )
      throw new Error("Invalid task capability claims.");
    return claims as CapabilityClaims;
  }
  verifier(): string {
    return this.key.toString("base64url");
  }
}

export interface TaskRuntimePort {
  startSession(request: StartSessionRequest): Promise<Session>;
  listSessions?(): Promise<Session[]>;
  listSessionInventory?(): Promise<RuntimeSessionInventory[]>;
  recoverSession?(sessionId: string): Promise<RuntimeSessionInventory>;
  getSession?(sessionId: string): Promise<Session>;
  endSession(sessionId: string): Promise<unknown>;
  inspect?(sessionId: string): Promise<unknown>;
  getControlStatus?(sessionId: string): Promise<ControlStatus>;
  acknowledgeDurableHandoff?(
    sessionId: string,
    identity: { handoffId: string; handoffGeneration: number },
  ): Promise<ControlStatus>;
  returnControlForSession?(
    sessionId: string,
    authority: {
      ownershipGeneration: number;
      handoffId?: string;
      handoffGeneration?: number;
    },
  ): Promise<unknown>;
  acknowledgeLegacyEffectScope?(sessionId: string): Promise<void>;
  authorizeEffectRepetition?(
    sessionId: string,
    effectId: string,
  ): Promise<object>;
  consequentialEffect?(
    sessionId: string,
    consequenceKey: string,
  ): Promise<{
    effectId: string;
    state:
      | "planned"
      | "authorized"
      | "prepared"
      | "applied"
      | "not_applied"
      | "unresolved";
    consequenceKey: string;
    observationId?: string;
    evidenceId?: string;
    taskResultPlan?: TaskResultActionPlan;
  } | null>;
  authorizeTaskResultAction?(
    sessionId: string,
    consequenceKey: string,
    materialDigest: string,
    planId: string,
  ): Promise<object>;
  startRecording?(
    sessionId: string,
    request: StartRecordingRequest,
  ): Promise<Recording>;
  stopRecording?(sessionId: string, recordingId: string): Promise<Recording>;
  listRecordings?(sessionId: string): Promise<Recording[]>;
}
export interface RoveMcpInspection {
  serverName: string;
  serverVersion: string;
  tools: readonly string[];
  catalogDigest: string;
  authenticated: boolean;
  boundSessionId: string;
  ready: boolean;
}
export interface RoveMcpProbe {
  inspect(input: {
    taskId: string;
    capability: string;
    capabilityVerifier: string;
    sessionId: string;
    executionMode: ExecutionMode;
    browserIdentity: BrowserIdentity;
  }): Promise<RoveMcpInspection>;
}
export interface StartTaskInput {
  roveTaskId: string;
  executionMode: ExecutionMode;
  browserIdentity: BrowserIdentity;
  selectionSource: ResolvedTaskContext["selectionSource"];
  cwd: string;
  approvalsReviewer: ApprovalsReviewer;
  model?: string;
  reasoningEffort?: string;
  attachmentIds?: readonly string[];
  initialLaunch?: InitialLaunchJournal;
}

function durableLifecycleData(
  taskId: string,
  continuation: PendingContinuation | undefined,
  attentions: readonly AttentionRequest[],
  codexSessionId: string | undefined,
): TaskProcessDurableData {
  return validateTaskProcessDurableData(
    {
      schemaVersion: 1,
      continuation:
        continuation === undefined
          ? null
          : { schemaVersion: 1, ...continuation },
      attentions: attentions.map((attention) => ({
        schemaVersion: 1,
        ...attention,
      })),
      codexSessionId: codexSessionId ?? null,
    },
    {
      taskId,
      ...(continuation?.roveSessionId
        ? { sessionId: continuation.roveSessionId }
        : {}),
      ...(continuation?.codexThreadId
        ? { threadId: continuation.codexThreadId }
        : {}),
    },
  );
}
export interface LaunchTaskInput extends Omit<
  StartTaskInput,
  "roveTaskId" | "initialLaunch"
> {
  operationId: string;
  outcome: string;
}

function initialLaunchDigest(input: LaunchTaskInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.operationId,
        input.outcome,
        input.executionMode,
        input.browserIdentity,
        input.selectionSource,
        input.cwd,
        input.approvalsReviewer,
        input.model ?? null,
        input.reasoningEffort ?? null,
        input.attachmentIds ?? [],
      ]),
    )
    .digest("hex");
}

function initialLaunchTurns(
  thread: CodexThread,
  operationId: string,
): CodexThread["turns"] {
  return thread.turns.filter((turn) =>
    turn.items.some(
      (item) => item.type === "userMessage" && item.clientId === operationId,
    ),
  );
}
export interface ResumeTaskInput {
  roveTaskId: string;
}
export interface RoveMcpLaunch {
  command: string;
  args: readonly string[];
  environment: Readonly<Record<string, string>>;
}
export interface StartedTask {
  context: Required<ResolvedTaskContext>;
}
export interface ProductTaskCapabilities {
  canSubmit: boolean;
  canQueue: boolean;
  canSteer: boolean;
  canStop: boolean;
  canRespond: boolean;
  canTakeControl: boolean;
  canReturnToRove: boolean;
  canRetry: boolean;
  canArchive: boolean;
}
export interface ProductTaskSnapshot {
  context: Omit<ResolvedTaskContext, "browserIdentity"> & {
    browserIdentity?: BrowserIdentity;
  };
  conversation?: Omit<
    ConversationAssociation,
    "codexThreadId" | "codexSessionId"
  > & {
    codexThreadId?: string;
    codexSessionId?: string;
  };
  lifecycle: { phase: ProductLifecyclePhase; reason: string };
  availableActions: ProductLifecycleAction[];
  capabilities: ProductTaskCapabilities;
  customerExecution?: CustomerTaskExecutionProjection;
  runtime?: {
    status: NativeRuntimeTruth["status"];
    controller: NativeRuntimeTruth["controller"];
    attachment: NativeRuntimeTruth["attachment"];
    recovery: NativeRuntimeTruth["recovery"];
    profileOwnership: NativeRuntimeTruth["profileLock"];
    legacyEffects?:
      "not_applicable" | "acknowledgement_required" | "acknowledged";
    diagnostic?: string;
    handoffActionable?: boolean;
    handoffGeneration?: number;
  };
}
export type ActiveTaskIdentity = Pick<
  Required<ResolvedTaskContext>,
  "roveTaskId" | "roveSessionId" | "codexThreadId"
>;
export interface TurnIntent {
  taskId: string;
  text: string;
  clientIntentId: string;
}
export interface SteerIntent extends TurnIntent {
  expectedTurnId: string;
}
function catalogDigest(tools: Record<string, unknown>): string {
  return createHash("sha256")
    .update(canonicalRoveToolDefinitionsJsonWire(Object.values(tools)))
    .digest("hex");
}
export function assertRoveMcp(
  result: RoveMcpInspection,
  sessionId: string,
  expectedDefinitionDigest: string,
): void {
  const expected = [...ROVE_TOOL_CATALOG].sort();
  const actual = [...result.tools].sort();
  const failed = [
    ...(!result.ready ? ["readiness"] : []),
    ...(!result.authenticated ? ["authentication"] : []),
    ...(result.serverName !== "rove" ? ["server identity"] : []),
    ...(result.serverVersion !== "0.1.0" ? ["server version"] : []),
    ...(result.boundSessionId !== sessionId ? ["session binding"] : []),
    ...(result.catalogDigest !== expectedDefinitionDigest
      ? ["definition digest"]
      : []),
    ...(JSON.stringify(actual) !== JSON.stringify(expected)
      ? ["tool-name set"]
      : []),
  ];
  if (failed.length > 0)
    throw new Error(
      `Required Rove MCP preflight failed: ${failed.join(", ")}.`,
    );
}

export class RoveTaskCoordinator {
  private readonly conversations: CodexConversationService;
  private readonly startLocks = new Map<string, Promise<StartedTask>>();
  private readonly launchLocks = new Map<
    string,
    Promise<
      StartedTask & {
        turnId?: string;
        status?: string;
      }
    >
  >();
  private readonly closeLocks = new Map<string, Promise<void>>();
  private readonly continuationReturnLocks = new Map<
    string,
    Promise<"dispatched" | "pending" | "ignored">
  >();
  private recoveryChain: Promise<readonly string[]> = Promise.resolve([]);
  private recoveryInFlight: Promise<readonly string[]> | undefined;
  private handoffEventChain: Promise<void> = Promise.resolve();
  private continuationRegistered:
    ((record: PendingContinuation) => Promise<void> | void) | undefined;
  private attentionQueue: OrderedAttentionQueue | undefined;
  private readonly startedTurnResults = new Map<string, TurnStartResponse>();
  private readonly steeredTurnResults = new Map<string, TurnSteerResponse>();
  private attentionResponder:
    | ((
        identity: {
          requestId: string;
          taskId: string;
          threadId?: string;
          turnId?: string;
          itemId?: string;
          generation: number;
        },
        result: unknown,
      ) => Promise<void>)
    | undefined;
  private codexAvailable: () => boolean = () => true;
  constructor(
    private readonly rpc: CodexRpcPort,
    private readonly runtime: TaskRuntimePort,
    private readonly mcp: RoveMcpProbe,
    private readonly authority: ContextAuthority,
    private readonly capabilities: TaskCapabilityIssuer,
    private readonly account: () => CodexAccountProjection,
    private readonly mcpLaunch: RoveMcpLaunch,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly conversationStore?: ConversationAssociationStore,
    private readonly models: () => readonly CodexModelProjection[] = () => [],
    private readonly continuations?: DurableContinuationStore,
    private readonly contextRepository?: StateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>,
    private readonly expectedToolDefinitionDigest: string = ROVE_TOOL_DEFINITIONS_SHA256,
    private readonly onCloseStagePersisted?: (
      taskId: string,
      stage: TaskCloseOperation["stage"],
    ) => Promise<void> | void,
    private readonly attachments?: {
      authority: TaskAttachmentAuthority;
      runtime: AttachmentRuntimeMaterializer;
    },
    private readonly onInitialLaunchStagePersisted?: (
      taskId: string,
      point: InitialLaunchFaultPoint,
    ) => Promise<void> | void,
    private readonly onLifecycleDecision?: (
      input: NativeLifecycleInput,
      output: NativeLifecycleOutput,
      launchConfiguration: Readonly<Record<string, unknown>>,
      durableData: TaskProcessDurableData,
    ) => Promise<{
      commandId: string | null;
      record: NativeLifecycleInput["record"];
      output?: NativeLifecycleOutput;
    }>,
    private readonly onLifecycleCommandStatus?: (
      commandId: string,
      status:
        "possibly_started" | "succeeded" | "failed" | "reconcile_required",
      fact?: Readonly<Record<string, unknown>>,
    ) => Promise<void>,
    private readonly taskProcessDriver?: TaskProcessDriver,
  ) {
    this.conversations = new CodexConversationService(rpc);
  }

  onContinuationRegistered(
    listener: (record: PendingContinuation) => Promise<void> | void,
  ): () => void {
    this.continuationRegistered = listener;
    return () => {
      if (this.continuationRegistered === listener)
        this.continuationRegistered = undefined;
    };
  }

  attachAttentionQueue(queue: OrderedAttentionQueue): void {
    if (this.attentionQueue !== undefined && this.attentionQueue !== queue)
      throw new Error(
        "Task lifecycle attention authority is already attached.",
      );
    this.attentionQueue = queue;
  }

  attachAttentionResponder(
    responder: NonNullable<RoveTaskCoordinator["attentionResponder"]>,
  ): void {
    if (this.attentionResponder && this.attentionResponder !== responder)
      throw new Error(
        "Task lifecycle attention responder is already attached.",
      );
    this.attentionResponder = responder;
  }

  attachCodexAvailability(readiness: () => boolean): void {
    this.codexAvailable = readiness;
  }

  reconcileHandoffEvent(event: CodexServerEvent): Promise<void> {
    const operation = this.handoffEventChain.then(() =>
      this.reconcileHandoffEventUnlocked(event),
    );
    this.handoffEventChain = operation.catch(() => undefined);
    return operation;
  }

  private async reconcileHandoffEventUnlocked(
    event: CodexServerEvent,
  ): Promise<void> {
    const params = event.params as Record<string, unknown>;
    const thread = isRecord(params.thread) ? params.thread : {};
    const turn = isRecord(params.turn) ? params.turn : {};
    const threadId =
      typeof params.threadId === "string"
        ? params.threadId
        : typeof thread.id === "string"
          ? thread.id
          : undefined;
    const turnId =
      typeof params.turnId === "string"
        ? params.turnId
        : typeof turn.id === "string"
          ? turn.id
          : undefined;
    if (event.method === "turn/completed") {
      if (!threadId) return;
      const context = this.authority.findByThread(threadId);
      if (context && this.taskProcessDriver) {
        await this.lifecycleDecisionForTask(context, {
          type: "observe",
          taskId: context.roveTaskId,
        });
        await this.taskProcessDriver.runUntilIdle(context.roveTaskId);
      } else if (context)
        await this.returnControlFromRuntime(context.roveTaskId);
      return;
    }
    if (event.method !== "item/completed") return;
    if (!threadId || !turnId || !isRecord(params.item)) return;
    const matched = await this.registerCompletedHandoff(
      threadId,
      turnId,
      params.item,
    );
    const context = this.authority.findByThread(threadId);
    if (matched && context && !this.taskProcessDriver)
      await this.returnControlFromRuntime(context.roveTaskId);
  }

  async start(input: StartTaskInput): Promise<StartedTask> {
    const taskId =
      typeof input.roveTaskId === "string" ? input.roveTaskId : "invalid";
    const existing = this.startLocks.get(taskId);
    if (existing !== undefined) return existing;
    const operation = this.startUnlocked(input).finally(() => {
      if (this.startLocks.get(taskId) === operation)
        this.startLocks.delete(taskId);
    });
    this.startLocks.set(taskId, operation);
    return operation;
  }

  async launch(
    input: LaunchTaskInput,
  ): Promise<StartedTask & { turnId?: string; status?: string }> {
    this.validateLaunchInput(input);
    const operationId = input.operationId;
    const existing = this.launchLocks.get(operationId);
    if (existing) return existing;
    const operation = this.launchUnlocked(input).finally(() => {
      if (this.launchLocks.get(operationId) === operation)
        this.launchLocks.delete(operationId);
    });
    this.launchLocks.set(operationId, operation);
    return operation;
  }

  private async launchUnlocked(
    input: LaunchTaskInput,
  ): Promise<StartedTask & { turnId?: string; status?: string }> {
    const inputDigest = initialLaunchDigest(input);
    const prior = Object.values(this.authority.snapshot()).filter(
      (context) => context.initialLaunch?.operationId === input.operationId,
    );
    if (prior.length > 1)
      throw new Error("Initial launch operation identity is conflicting.");
    let taskId = prior[0]?.roveTaskId;
    if (
      prior[0]?.initialLaunch &&
      prior[0].initialLaunch.inputDigest !== inputDigest
    )
      throw new Error("Initial launch operation input changed.");
    taskId ??= `task_${randomUUID()}`;
    const started = await this.start({
      roveTaskId: taskId,
      executionMode: input.executionMode,
      browserIdentity: input.browserIdentity,
      selectionSource: input.selectionSource,
      cwd: input.cwd,
      approvalsReviewer: input.approvalsReviewer,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: input.reasoningEffort }),
      ...(input.attachmentIds === undefined
        ? {}
        : { attachmentIds: input.attachmentIds }),
      ...(input.executionMode === "capture"
        ? {}
        : {
            initialLaunch: prior[0]?.initialLaunch ?? {
              operationId: input.operationId,
              inputDigest,
              stage: "requested" as const,
              requestedAt: this.now(),
              outcome: input.outcome,
            },
          }),
    });
    if (input.executionMode === "capture") return started;
    const context = await this.advanceInitialLaunch(started.context);
    const launch = context.initialLaunch!;
    return {
      context: context as Required<ResolvedTaskContext>,
      ...(launch.turnId === undefined ? {} : { turnId: launch.turnId }),
      ...(launch.turnId === undefined ? {} : { status: "inProgress" }),
    };
  }

  private async startUnlocked(input: StartTaskInput): Promise<StartedTask> {
    this.validateStartInput(input);
    if (this.account().status !== "logged_in")
      throw new Error(
        "Rove's Codex account must be signed in before task mutation.",
      );
    this.assertModelSelection(input.model, input.reasoningEffort);
    let context = this.authority.get(input.roveTaskId);
    if (context === undefined) {
      const attemptId = `boot_${randomUUID().replaceAll("-", "")}`;
      context = this.authority.resolve({
        roveTaskId: input.roveTaskId,
        executionMode: input.executionMode,
        browserIdentity: input.browserIdentity,
        selectionSource: input.selectionSource,
        selectedAt: this.now(),
        policy: {
          cwd: input.cwd,
          ...(input.model === undefined ? {} : { model: input.model }),
          ...(input.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: input.reasoningEffort }),
          approvalPolicy: "on-request",
          approvalsReviewer: input.approvalsReviewer,
          sandbox: "workspace-write",
        },
        bootstrap: {
          attemptId,
          threadSource: `rove:${input.roveTaskId}:${attemptId}`,
          stage: "intent_persisted",
        },
        lifecycle: { schemaVersion: 1, desiredState: "open" },
        ...(input.attachmentIds === undefined
          ? {}
          : { attachmentIds: [...input.attachmentIds] }),
        ...(input.initialLaunch === undefined
          ? {}
          : { initialLaunch: input.initialLaunch }),
      });
      if (this.taskProcessDriver)
        await this.lifecycleDecisionForTask(context, {
          type: "observe",
          taskId: context.roveTaskId,
        });
      await this.persistContexts();
      if (input.initialLaunch)
        await this.onInitialLaunchStagePersisted?.(
          input.roveTaskId,
          "requested",
        );
    } else if (
      context.executionMode !== input.executionMode ||
      JSON.stringify(context.browserIdentity) !==
        JSON.stringify(input.browserIdentity) ||
      context.policy.cwd !== input.cwd ||
      context.policy.model !== input.model ||
      context.policy.reasoningEffort !== input.reasoningEffort ||
      context.policy.approvalsReviewer !== input.approvalsReviewer ||
      JSON.stringify(context.attachmentIds ?? []) !==
        JSON.stringify(input.attachmentIds ?? []) ||
      JSON.stringify(context.initialLaunch) !==
        JSON.stringify(input.initialLaunch)
    ) {
      throw new Error("Active task context is immutable.");
    }
    context = await this.advanceBootstrap(context);
    return { context: context as Required<ResolvedTaskContext> };
  }

  private async advanceBootstrap(
    initial: ResolvedTaskContext,
  ): Promise<ResolvedTaskContext> {
    let context = initial;
    if (context.bootstrap.stage === "complete") return context;
    if (context.bootstrap.stage.startsWith("rollback_")) {
      await this.convergeBootstrapRollback(context);
      throw new Error("Task bootstrap was rolled back before dispatch.");
    }
    if (this.taskProcessDriver) {
      await this.lifecycleDecisionForTask(context, {
        type: "observe",
        taskId: context.roveTaskId,
      });
      await this.taskProcessDriver.runUntilIdle(context.roveTaskId);
      const converged = this.authority.get(context.roveTaskId);
      if (!converged || converged.bootstrap.stage !== "complete")
        throw new Error(
          "Durable bootstrap did not reach a terminal projection.",
        );
      return converged;
    }
    if (
      context.bootstrap.stage === "intent_persisted" &&
      this.onLifecycleDecision &&
      this.onLifecycleCommandStatus
    ) {
      const decision = await this.lifecycleDecisionForTask(context, {
        type: "observe",
        taskId: context.roveTaskId,
      });
      if (
        decision.output.nextCommand?.type !== "advance_bootstrap_stage" ||
        decision.output.nextCommand.stage !== "runtime_dispatching" ||
        !decision.commandId
      )
        throw new Error(
          "Reducer did not authorize Runtime bootstrap dispatch.",
        );
      await this.onLifecycleCommandStatus(
        decision.commandId,
        "possibly_started",
      );
      context = await this.updateContext(context, {
        bootstrap: { ...context.bootstrap, stage: "runtime_dispatching" },
      });
      await this.onLifecycleCommandStatus(decision.commandId, "succeeded", {
        stage: "runtime_dispatching",
        observedAt: this.now(),
      });
    }
    if (context.bootstrap.stage === "runtime_dispatching") {
      const matches =
        (await this.runtime.listSessions?.())?.filter(
          (session) => session.bootstrapId === context.bootstrap.attemptId,
        ) ?? [];
      if (matches.length > 1)
        throw new Error("Runtime bootstrap identity collision.");
      if (matches[0]) {
        if (this.onLifecycleDecision && this.onLifecycleCommandStatus) {
          const decision = await this.lifecycleDecisionForTask(context, {
            type: "observe",
            taskId: context.roveTaskId,
          });
          if (
            decision.output.nextCommand?.type !== "bind_runtime_identity" ||
            !decision.commandId
          )
            throw new Error(
              "Reducer did not authorize Runtime identity binding.",
            );
          await this.onLifecycleCommandStatus(
            decision.commandId,
            "possibly_started",
          );
          context = await this.bindRuntime(context, matches[0]);
          await this.onLifecycleCommandStatus(decision.commandId, "succeeded", {
            sessionId: matches[0].id,
            observedAt: this.now(),
          });
        } else context = await this.bindRuntime(context, matches[0]);
      }
    }
    if (
      context.bootstrap.stage === "intent_persisted" ||
      context.bootstrap.stage === "runtime_dispatching"
    ) {
      context = await this.updateContext(context, {
        bootstrap: { ...context.bootstrap, stage: "runtime_dispatching" },
      });
      const durable =
        this.onLifecycleDecision && this.onLifecycleCommandStatus
          ? await this.lifecycleDecisionForTask(context, {
              type: "observe",
              taskId: context.roveTaskId,
            })
          : undefined;
      if (
        durable &&
        (durable.output.nextCommand?.type !== "lookup_or_start_runtime" ||
          !durable.commandId)
      )
        throw new Error("Reducer did not authorize Runtime bootstrap lookup.");
      if (durable)
        await this.onLifecycleCommandStatus!(
          durable.commandId!,
          "possibly_started",
        );
      const session = await this.runtime.startSession({
        bootstrapId: context.bootstrap.attemptId,
        mode: context.executionMode,
        browser:
          context.browserIdentity.mode === "temporary"
            ? { mode: "temporary" }
            : {
                mode: "workspace",
                workspaceId: context.browserIdentity.workspaceId,
              },
      });
      if (durable)
        await this.onLifecycleCommandStatus!(durable.commandId!, "succeeded", {
          sessionId: session.id,
          observedAt: this.now(),
        });
      if (this.onLifecycleDecision && this.onLifecycleCommandStatus) {
        const binding = await this.lifecycleDecisionForTask(context, {
          type: "observe",
          taskId: context.roveTaskId,
        });
        if (
          binding.output.nextCommand?.type !== "bind_runtime_identity" ||
          !binding.commandId
        )
          throw new Error(
            "Reducer did not authorize Runtime identity binding.",
          );
        await this.onLifecycleCommandStatus(
          binding.commandId,
          "possibly_started",
        );
        context = await this.bindRuntime(context, session);
        await this.onLifecycleCommandStatus(binding.commandId, "succeeded", {
          sessionId: session.id,
          observedAt: this.now(),
        });
      } else context = await this.bindRuntime(context, session);
    }
    if (!context.roveSessionId || !context.capabilityFingerprint)
      throw new Error("Runtime bootstrap did not bind identity.");
    const runtimeSessionId = context.roveSessionId;
    if (
      this.attachments &&
      (context.attachmentIds?.length ?? 0) > 0 &&
      context.bootstrap.stage === "runtime_bound"
    )
      context = await this.updateContext(context, {
        bootstrap: { ...context.bootstrap, stage: "attachments_binding" },
      });
    if (
      this.attachments &&
      (context.attachmentIds?.length ?? 0) > 0 &&
      context.bootstrap.stage === "attachments_binding"
    ) {
      await this.attachments.authority.bindDrafts(
        context.attachmentIds!,
        context.roveTaskId,
        runtimeSessionId,
        this.attachments.runtime,
      );
      context = await this.updateContext(context, {
        bootstrap: { ...context.bootstrap, stage: "attachments_bound" },
      });
    }
    const issued = this.capabilities.issue({
      taskId: context.roveTaskId,
      sessionId: runtimeSessionId,
      executionMode: context.executionMode,
      browserIdentity: context.browserIdentity,
    });
    if (issued.fingerprint !== context.capabilityFingerprint)
      throw new Error("Task capability cannot be reproduced.");
    let inspected: RoveMcpInspection;
    try {
      inspected = await this.mcp.inspect({
        taskId: context.roveTaskId,
        capability: issued.token,
        capabilityVerifier: this.capabilities.verifier(),
        sessionId: runtimeSessionId,
        executionMode: context.executionMode,
        browserIdentity: context.browserIdentity,
      });
      assertRoveMcp(
        inspected,
        runtimeSessionId,
        this.expectedToolDefinitionDigest,
      );
    } catch (error) {
      // No Codex thread has been dispatched at runtime_bound, so this is a known-safe
      // compensation point rather than an uncertain cross-process rollback.
      if (
        ["runtime_bound", "attachments_bound"].includes(context.bootstrap.stage)
      ) {
        context = await this.updateContext(context, {
          bootstrap: { ...context.bootstrap, stage: "rollback_pending" },
        });
        await this.convergeBootstrapRollback(context);
      }
      throw error;
    }
    if (
      context.bootstrap.stage === "runtime_bound" ||
      context.bootstrap.stage === "attachments_bound"
    )
      context = await this.updateContext(context, {
        bootstrap: { ...context.bootstrap, stage: "mcp_verified" },
      });
    if (context.bootstrap.stage === "thread_dispatching") {
      const listed = await Promise.all([
        this.rpc.request("thread/list", { limit: 100, archived: false }),
        this.rpc.request("thread/list", { limit: 100, archived: true }),
      ]);
      const matches = [
        ...new Map(
          listed
            .flatMap((page) => page.data)
            .filter(
              (thread) =>
                thread.threadSource === context.bootstrap.threadSource,
            )
            .map((thread) => [thread.id, thread]),
        ).values(),
      ];
      if (matches.length > 1)
        throw new Error("Codex bootstrap thread identity collision.");
      if (matches[0]) {
        const recovered = await this.conversations.resumeThreadWithConfig(
          matches[0].id,
          this.resumeParams(context, issued.token, matches[0].historyMode),
        );
        if (recovered.thread.historyMode !== "legacy")
          await this.rejectUnsupportedNewThreadHistory(
            context,
            recovered.thread,
          );
        this.assertApprovalsReviewer(context, recovered.approvalsReviewer);
        if (this.onLifecycleDecision && this.onLifecycleCommandStatus) {
          const binding = await this.lifecycleDecisionForTask(context, {
            type: "observe",
            taskId: context.roveTaskId,
          });
          if (
            binding.output.nextCommand?.type !== "bind_codex_identity" ||
            !binding.commandId
          )
            throw new Error(
              "Reducer did not authorize Codex identity binding.",
            );
          await this.onLifecycleCommandStatus(
            binding.commandId,
            "possibly_started",
          );
          context = await this.bindThread(context, recovered.thread, inspected);
          await this.onLifecycleCommandStatus(binding.commandId, "succeeded", {
            threadId: recovered.thread.id,
            observedAt: this.now(),
          });
        } else
          context = await this.bindThread(context, recovered.thread, inspected);
      }
    }
    if (
      context.bootstrap.stage === "mcp_verified" ||
      context.bootstrap.stage === "thread_dispatching"
    ) {
      if (
        context.bootstrap.stage === "mcp_verified" &&
        this.onLifecycleDecision &&
        this.onLifecycleCommandStatus
      ) {
        const advance = await this.lifecycleDecisionForTask(context, {
          type: "observe",
          taskId: context.roveTaskId,
        });
        if (
          advance.output.nextCommand?.type !== "advance_bootstrap_stage" ||
          advance.output.nextCommand.stage !== "thread_dispatching" ||
          !advance.commandId
        )
          throw new Error(
            "Reducer did not authorize Codex bootstrap dispatch.",
          );
        await this.onLifecycleCommandStatus(
          advance.commandId,
          "possibly_started",
        );
        context = await this.updateContext(context, {
          bootstrap: { ...context.bootstrap, stage: "thread_dispatching" },
        });
        await this.onLifecycleCommandStatus(advance.commandId, "succeeded", {
          stage: "thread_dispatching",
          observedAt: this.now(),
        });
      }
      context = await this.updateContext(context, {
        bootstrap: { ...context.bootstrap, stage: "thread_dispatching" },
      });
      const durable =
        this.onLifecycleDecision && this.onLifecycleCommandStatus
          ? await this.lifecycleDecisionForTask(context, {
              type: "observe",
              taskId: context.roveTaskId,
            })
          : undefined;
      if (
        durable &&
        (durable.output.nextCommand?.type !== "lookup_or_start_codex_thread" ||
          !durable.commandId)
      )
        throw new Error("Reducer did not authorize Codex thread lookup.");
      if (durable)
        await this.onLifecycleCommandStatus!(
          durable.commandId!,
          "possibly_started",
        );
      const result = await this.conversations.startThread(
        this.threadParams(context, issued.token),
      );
      if (result.thread.historyMode !== "legacy")
        await this.rejectUnsupportedNewThreadHistory(context, result.thread);
      this.assertApprovalsReviewer(context, result.approvalsReviewer);
      if (durable)
        await this.onLifecycleCommandStatus!(durable.commandId!, "succeeded", {
          threadId: result.thread.id,
          observedAt: this.now(),
        });
      if (this.onLifecycleDecision && this.onLifecycleCommandStatus) {
        const binding = await this.lifecycleDecisionForTask(context, {
          type: "observe",
          taskId: context.roveTaskId,
        });
        if (
          binding.output.nextCommand?.type !== "bind_codex_identity" ||
          !binding.commandId
        )
          throw new Error("Reducer did not authorize Codex identity binding.");
        await this.onLifecycleCommandStatus(
          binding.commandId,
          "possibly_started",
        );
        context = await this.bindThread(context, result.thread, inspected);
        await this.onLifecycleCommandStatus(binding.commandId, "succeeded", {
          threadId: result.thread.id,
          observedAt: this.now(),
        });
      } else context = await this.bindThread(context, result.thread, inspected);
    }
    return context;
  }

  private async advanceInitialLaunch(
    initial: ResolvedTaskContext,
  ): Promise<ResolvedTaskContext> {
    let context = initial;
    let launch = context.initialLaunch;
    if (
      !launch ||
      context.executionMode === "capture" ||
      context.bootstrap.stage !== "complete" ||
      !context.codexThreadId
    )
      throw new Error("Initial launch infrastructure is incomplete.");
    const threadId = context.codexThreadId;
    if (launch.stage === "turn_started")
      return this.confirmInitialLaunchOutcome(context);
    if (launch.stage === "requested") {
      context = await this.updateContext(context, {
        initialLaunch: { ...launch, stage: "infrastructure_ready" },
      });
      await this.onInitialLaunchStagePersisted?.(
        context.roveTaskId,
        "infrastructure_ready",
      );
      launch = context.initialLaunch!;
    }
    if (launch.stage !== "infrastructure_ready") {
      let truth: CodexThread;
      try {
        truth = (await this.readThreadHistoryAware(threadId, true, context))
          .thread;
      } catch (error) {
        try {
          if (!(await this.resumeListedNotLoadedThread(context, error)))
            throw error;
          truth = (await this.readThreadHistoryAware(threadId, true, context))
            .thread;
        } catch (recoveryError) {
          await this.markInitialLaunchUncertain(context);
          throw recoveryError;
        }
      }
      if (truth.historyMode === "paginated") {
        const projection = await this.conversationStore?.projection(threadId);
        const matches = Object.values(projection?.items ?? {}).filter(
          (item) =>
            item.kind === "user_message" &&
            item.clientId === launch!.operationId,
        );
        if (matches.length > 1)
          throw new Error("Initial launch operation produced duplicate turns.");
        if (matches[0]) {
          if (!matches[0].turnId)
            throw new Error(
              "Initial launch provider item lacks a turn identity.",
            );
          context = await this.updateContext(context, {
            initialLaunch: {
              ...launch,
              stage: "turn_started",
              turnId: matches[0].turnId,
            },
          });
          return this.confirmInitialLaunchOutcome(context, truth);
        }
        return this.markInitialLaunchUncertain(context);
      } else {
        const matches = initialLaunchTurns(truth, launch.operationId);
        if (matches.length > 1)
          throw new Error("Initial launch operation produced duplicate turns.");
        if (matches[0]) {
          context = await this.updateContext(context, {
            initialLaunch: {
              ...launch,
              stage: "turn_started",
              turnId: matches[0].id,
            },
          });
          return this.confirmInitialLaunchOutcome(context, truth);
        }
      }
    }
    context = await this.updateContext(context, {
      initialLaunch: {
        ...launch,
        stage: "turn_dispatching",
      },
    });
    await this.onInitialLaunchStagePersisted?.(
      context.roveTaskId,
      "turn_dispatching",
    );
    launch = context.initialLaunch!;
    try {
      const result = await this.conversations.startTurn({
        threadId,
        clientUserMessageId: launch.operationId,
        input: this.userText(launch.outcome!),
      });
      await this.onInitialLaunchStagePersisted?.(
        context.roveTaskId,
        "turn_accepted",
      );
      context = await this.updateContext(context, {
        initialLaunch: {
          ...launch,
          stage: "turn_started",
          turnId: result.turn.id,
        },
      });
      await this.onInitialLaunchStagePersisted?.(
        context.roveTaskId,
        "turn_started",
      );
    } catch (error) {
      await this.markInitialLaunchUncertain(context);
      throw error;
    }
    return this.confirmInitialLaunchOutcome(context);
  }

  private async markInitialLaunchUncertain(
    context: ResolvedTaskContext,
  ): Promise<ResolvedTaskContext> {
    const launch = context.initialLaunch;
    if (!launch || launch.stage === "turn_started") return context;
    return this.updateContext(context, {
      initialLaunch: {
        ...launch,
        stage: "reconciliation_required",
        boundedFailure:
          "Initial turn dispatch requires authoritative reconciliation.",
      },
    });
  }

  private async confirmInitialLaunchOutcome(
    context: ResolvedTaskContext,
    knownTruth?: CodexThread,
  ): Promise<ResolvedTaskContext> {
    const launch = context.initialLaunch;
    if (!launch || launch.stage !== "turn_started" || !launch.outcome)
      return context;
    const truth =
      knownTruth ??
      (await this.readThreadHistoryAware(context.codexThreadId!, true)).thread;
    if (truth.historyMode === "paginated") {
      const projection = await this.conversationStore?.projection(
        context.codexThreadId!,
      );
      const matches = Object.values(projection?.items ?? {}).filter(
        (item) =>
          item.kind === "user_message" &&
          item.clientId === launch.operationId &&
          item.turnId === launch.turnId,
      );
      if (matches.length !== 1 || matches[0]?.text !== launch.outcome)
        return context;
      const settled = { ...launch };
      delete settled.outcome;
      delete settled.boundedFailure;
      return this.updateContext(context, { initialLaunch: settled });
    }
    const matches = initialLaunchTurns(truth, launch.operationId);
    if (matches.length !== 1 || matches[0]!.id !== launch.turnId)
      return context;
    const message = matches[0]!.items.find(
      (item) =>
        item.type === "userMessage" && item.clientId === launch.operationId,
    );
    const text =
      message?.type === "userMessage"
        ? message.content
            .flatMap((item) => (item.type === "text" ? [item.text] : []))
            .join("\n")
        : undefined;
    if (text !== launch.outcome)
      throw new Error(
        "Initial launch user message does not match its journal.",
      );
    if (!this.conversationStore) return context;
    await this.conversationStore.reconcile(truth);
    const projection = await this.conversationStore.projection(
      context.codexThreadId!,
    );
    if (
      !Object.values(projection?.items ?? {}).some(
        (item) =>
          item.kind === "user_message" &&
          item.turnId === launch.turnId &&
          item.text === launch.outcome,
      )
    )
      return context;
    const settled = { ...launch };
    delete settled.outcome;
    delete settled.boundedFailure;
    return this.updateContext(context, { initialLaunch: settled });
  }

  private async bindRuntime(
    context: ResolvedTaskContext,
    session: Session,
  ): Promise<ResolvedTaskContext> {
    if (
      session.bootstrapId !== context.bootstrap.attemptId ||
      session.mode !== context.executionMode
    )
      throw new Error("Runtime returned a conflicting bootstrap session.");
    const issued = this.capabilities.issue({
      taskId: context.roveTaskId,
      sessionId: session.id,
      executionMode: context.executionMode,
      browserIdentity: context.browserIdentity,
    });
    return this.updateContext(context, {
      roveSessionId: session.id,
      capabilityFingerprint: issued.fingerprint,
      bootstrap: { ...context.bootstrap, stage: "runtime_bound" },
    });
  }
  private async bindThread(
    context: ResolvedTaskContext,
    thread: CodexThread,
    inspected: RoveMcpInspection,
  ): Promise<ResolvedTaskContext> {
    const status = await this.rpc.request("mcpServerStatus/list", {
      threadId: thread.id,
      detail: "full",
      limit: 100,
    });
    const rove = status.data.filter((entry) => entry.name === "rove");
    if (rove.length !== 1)
      throw new Error("Actual Codex thread lacks one required Rove MCP.");
    this.assertThreadMcp(rove[0]!, inspected);
    return this.bindThreadIdentity(context, thread);
  }
  private async bindThreadIdentity(
    context: ResolvedTaskContext,
    thread: CodexThread,
  ): Promise<ResolvedTaskContext> {
    await this.conversationStore?.bind({
      roveTaskId: context.roveTaskId,
      codexThreadId: thread.id,
      codexSessionId: thread.sessionId,
      roveSessionId: context.roveSessionId!,
      turnStatus: "unknown",
      archived: false,
      lastEventSequence: 0,
      items: {},
      turnOrder: [],
    });
    return this.updateContext(context, {
      codexThreadId: thread.id,
      codexSessionId: thread.sessionId,
      bootstrap: { ...context.bootstrap, stage: "complete" },
    });
  }
  private assertThreadMcp(
    status: McpServerStatus,
    inspected: RoveMcpInspection,
  ): void {
    if (
      status.runtimeStatus !== "connected" ||
      status.serverInfo?.name !== "rove" ||
      status.serverInfo.version !== inspected.serverVersion ||
      status.authStatus === "notLoggedIn" ||
      catalogDigest(status.tools) !== this.expectedToolDefinitionDigest ||
      inspected.catalogDigest !== this.expectedToolDefinitionDigest
    )
      throw new Error(
        "Actual Codex thread Rove MCP provenance/catalog/auth gate failed.",
      );
  }
  private threadParams(context: ResolvedTaskContext, capability: string) {
    return {
      cwd: context.policy.cwd,
      ...(context.policy.model === undefined
        ? {}
        : { model: context.policy.model }),
      approvalPolicy: context.policy.approvalPolicy,
      approvalsReviewer: context.policy.approvalsReviewer,
      sandbox: context.policy.sandbox,
      historyMode: "legacy" as const,
      threadSource: context.bootstrap.threadSource,
      experimentalRawEvents: false,
      developerInstructions: `${browserRouteDeveloperInstructions(context)}${
        context.roveSessionId === undefined || this.attachments === undefined
          ? ""
          : this.attachments.authority.instructions(
              context.roveTaskId,
              context.roveSessionId,
            )
      }`,
      config: {
        ...this.mcpConfig(context, capability),
        ...(context.policy.reasoningEffort === undefined
          ? {}
          : { model_reasoning_effort: context.policy.reasoningEffort }),
      },
    };
  }
  private resumeParams(
    context: ResolvedTaskContext,
    capability: string,
    historyMode: CodexThread["historyMode"],
  ) {
    const start = this.threadParams(context, capability);
    return {
      cwd: start.cwd,
      ...(start.model === undefined ? {} : { model: start.model }),
      approvalPolicy: start.approvalPolicy,
      approvalsReviewer: start.approvalsReviewer,
      sandbox: start.sandbox,
      config: start.config,
      excludeTurns: historyMode === "paginated",
      developerInstructions: start.developerInstructions,
    };
  }
  private async readThreadHistoryAware(
    threadId: string,
    fullTurnsRequired: boolean,
    emptyLegacyContext?: ResolvedTaskContext,
  ): Promise<{
    thread: CodexThread;
    fullTurns: boolean;
    emptyLegacy: boolean;
  }> {
    const metadata = (await this.conversations.readThread(threadId, false))
      .thread;
    if (!fullTurnsRequired || metadata.historyMode === "paginated")
      return { thread: metadata, fullTurns: false, emptyLegacy: false };
    let full: CodexThread;
    try {
      full = (await this.conversations.readThread(threadId, true)).thread;
    } catch (error) {
      const conversation = await this.conversationStore?.projection(threadId);
      if (
        emptyLegacyContext?.codexThreadId === threadId &&
        emptyLegacyContext.codexSessionId !== undefined &&
        isPinnedEmptyLegacyThreadFailure(error, metadata, conversation, {
          taskId: emptyLegacyContext.roveTaskId,
          threadId,
          sessionId: emptyLegacyContext.codexSessionId,
          threadSource: emptyLegacyContext.bootstrap.threadSource,
        })
      )
        return { thread: metadata, fullTurns: true, emptyLegacy: true };
      throw error;
    }
    if (
      full.id !== metadata.id ||
      full.sessionId !== metadata.sessionId ||
      full.historyMode !== "legacy"
    )
      throw new Error("Codex full-history read changed thread identity.");
    return { thread: full, fullTurns: true, emptyLegacy: false };
  }
  private async listBoundThread(
    context: ResolvedTaskContext,
  ): Promise<{ thread: CodexThread; archived: boolean } | undefined> {
    const matches: Array<{ thread: CodexThread; archived: boolean }> = [];
    for (const archived of [false, true]) {
      let cursor: string | undefined;
      const seen = new Set<string>();
      for (let page = 0; page < 10; page += 1) {
        const listed = await this.conversations.listThreads({
          limit: 100,
          archived,
          ...(cursor === undefined ? {} : { cursor }),
        });
        for (const thread of listed.data)
          if (
            thread.id === context.codexThreadId ||
            thread.threadSource === context.bootstrap.threadSource
          )
            matches.push({ thread, archived });
        if (!listed.nextCursor) break;
        if (seen.has(listed.nextCursor))
          throw new Error("Codex thread-list pagination is cyclic.");
        seen.add(listed.nextCursor);
        cursor = listed.nextCursor;
        if (page === 9)
          throw new Error("Codex thread-list pagination exceeded its bound.");
      }
    }
    if (matches.length > 1)
      throw new Error("Codex bound thread list identity is conflicting.");
    const match = matches[0];
    if (!match) return undefined;
    if (
      match.thread.id !== context.codexThreadId ||
      match.thread.sessionId !== context.codexSessionId ||
      match.thread.threadSource !== context.bootstrap.threadSource ||
      match.thread.cliVersion !== APPROVED_CODEX_CLI_VERSION ||
      match.thread.historyMode !== "legacy"
    )
      throw new Error("Codex bound thread list identity changed.");
    return match;
  }
  private async resumeListedNotLoadedThread(
    context: ResolvedTaskContext,
    readError: unknown,
  ): Promise<boolean> {
    if (
      !context.codexThreadId ||
      !context.codexSessionId ||
      !context.roveSessionId ||
      !isPinnedThreadNotLoadedFailure(readError, context.codexThreadId)
    )
      return false;
    const listed = await this.listBoundThread(context);
    if (
      listed &&
      (listed.archived || listed.thread.status.type !== "notLoaded")
    )
      throw new Error("Codex bound thread resume state is ambiguous.");
    const issued = this.capabilities.issue({
      taskId: context.roveTaskId,
      sessionId: context.roveSessionId,
      executionMode: context.executionMode,
      browserIdentity: context.browserIdentity,
    });
    if (issued.fingerprint !== context.capabilityFingerprint)
      throw new Error("Task capability cannot be reproduced.");
    const resumed = await this.conversations.resumeThreadWithConfig(
      context.codexThreadId,
      this.resumeParams(
        context,
        issued.token,
        listed?.thread.historyMode ?? "legacy",
      ),
    );
    this.assertApprovalsReviewer(context, resumed.approvalsReviewer);
    if (
      resumed.thread.id !== context.codexThreadId ||
      resumed.thread.sessionId !== context.codexSessionId ||
      resumed.thread.threadSource !== context.bootstrap.threadSource ||
      resumed.thread.cliVersion !== APPROVED_CODEX_CLI_VERSION ||
      resumed.thread.historyMode !== "legacy"
    )
      throw new Error("Codex resumed conflicting thread identity.");
    return true;
  }
  private async settleNotLoadedThreadForClose(
    context: ResolvedTaskContext,
    readError: unknown,
  ): Promise<boolean> {
    if (
      !context.codexThreadId ||
      !context.codexSessionId ||
      !isPinnedThreadNotLoadedFailure(readError, context.codexThreadId)
    )
      return false;
    const conversation = await this.conversationStore?.projection(
      context.codexThreadId,
    );
    if (
      !isEmptyDurableConversation(conversation, {
        taskId: context.roveTaskId,
        threadId: context.codexThreadId,
        sessionId: context.codexSessionId,
        threadSource: context.bootstrap.threadSource,
      })
    )
      return false;
    if (await this.continuations?.pendingForTask(context.roveTaskId))
      throw new Error("Not-loaded thread has an unresolved continuation.");
    if (
      (this.attentionQueue?.list() ?? []).some(
        (entry) =>
          entry.taskId === context.roveTaskId &&
          !["resolved", "cancelled"].includes(entry.status),
      )
    )
      throw new Error("Not-loaded thread has unresolved attention.");
    const listed = await this.listBoundThread(context);
    if (listed) {
      if (listed.thread.status.type !== "notLoaded")
        throw new Error("Not-loaded thread list status is ambiguous.");
      if (!listed.archived)
        await this.conversations.archiveThread(context.codexThreadId);
    }
    if (!this.conversationStore?.settleAbsentThread)
      throw new Error("Absent-thread archive settlement is unavailable.");
    await this.conversationStore.settleAbsentThread(context.codexThreadId);
    return true;
  }
  private async projectedActiveTurnId(
    threadId: string,
  ): Promise<string | undefined> {
    const projection = await this.conversationStore?.projection(threadId);
    return projection?.turnStatus === "in_progress"
      ? projection.activeTurnId
      : undefined;
  }
  private async rejectUnsupportedNewThreadHistory(
    context: ResolvedTaskContext,
    thread: CodexThread,
  ): Promise<never> {
    const bound = await this.bindThreadIdentity(context, thread);
    await this.closeTask(
      bound.roveTaskId,
      `intent_${canonicalUuid(`unsupported-history:${bound.bootstrap.attemptId}`)}`,
    );
    throw new Error(
      "Codex ignored the required legacy history mode; the task was cleaned before initial turn dispatch.",
    );
  }
  async restore(): Promise<void> {
    const state = await this.contextRepository?.read();
    if (state !== undefined)
      this.authority.restore(prepareTaskContextState(state.value).contexts);
  }
  async productTasks(): Promise<ProductTaskSnapshot[]> {
    const codexAvailable = this.codexAvailable();
    let runtimeAvailable = true;
    const inventory = await this.runtime.listSessionInventory?.().catch(() => {
      runtimeAvailable = false;
      return [];
    });
    return Promise.all(
      Object.values(this.authority.snapshot())
        .sort((left, right) => left.selectedAt.localeCompare(right.selectedAt))
        .map(async (context) => {
          const conversation =
            context.codexThreadId === undefined || !this.conversationStore
              ? undefined
              : await this.conversationStore.projection(context.codexThreadId);
          const runtime = inventory?.find((entry) =>
            context.roveSessionId
              ? entry.session.id === context.roveSessionId
              : entry.session.bootstrapId === context.bootstrap.attemptId,
          );
          const pending = await this.continuations?.pendingForTask(
            context.roveTaskId,
          );
          const control =
            runtime !== undefined && this.runtime.getControlStatus
              ? await this.runtime
                  .getControlStatus(runtime.session.id)
                  .catch(() => undefined)
              : undefined;
          let projection: Pick<
            ProductTaskSnapshot,
            "lifecycle" | "availableActions" | "capabilities" | "runtime"
          >;
          try {
            projection = (
              await this.lifecycleProjection(
                context,
                conversation,
                codexAvailable,
                runtime,
                runtimeAvailable,
                pending,
                control,
                this.attentionQueue
                  ?.list()
                  .filter((entry) => entry.taskId === context.roveTaskId) ?? [],
              )
            ).projection;
            if (
              context.lifecycle?.desiredState !== "closed" &&
              context.initialLaunch &&
              context.initialLaunch.stage !== "turn_started"
            )
              projection = {
                ...projection,
                lifecycle: {
                  phase:
                    context.initialLaunch.stage === "reconciliation_required"
                      ? "recovering"
                      : "starting",
                  reason:
                    context.initialLaunch.stage === "reconciliation_required"
                      ? "Initial task launch requires authoritative reconciliation."
                      : "Initial task launch is still converging.",
                },
                availableActions: ["finish"],
                capabilities: customerTaskCapabilities({
                  canSubmit: false,
                  canQueue: false,
                  canSteer: false,
                  canStop: context.executionMode !== "capture",
                  canRespond: false,
                  canTakeControl: false,
                  canReturnToRove: false,
                  canRetry: false,
                  canArchive: false,
                }),
              };
          } catch (error) {
            projection = {
              lifecycle: {
                phase: "cleanup_required",
                reason:
                  `Lifecycle truth was rejected: ${error instanceof Error ? error.message : String(error)}`.slice(
                    0,
                    240,
                  ),
              },
              availableActions: ["retry_cleanup"],
              capabilities: customerTaskCapabilities({
                canSubmit: false,
                canQueue: false,
                canSteer: false,
                canStop: false,
                canRespond: false,
                canTakeControl: false,
                canReturnToRove: false,
                canRetry: true,
                canArchive: false,
              }),
              ...(runtime === undefined
                ? {}
                : {
                    runtime: {
                      status: runtime.session.status,
                      controller: runtime.session.controller,
                      attachment: runtime.attachment,
                      recovery: runtime.recovery,
                      profileOwnership: runtime.profileOwnership,
                      diagnostic: "Lifecycle evidence is contradictory.",
                    },
                  }),
            };
          }
          return {
            context,
            ...(conversation === undefined ? {} : { conversation }),
            ...projection,
          };
        }),
    );
  }
  recoverFromTruth(): Promise<readonly string[]> {
    if (this.recoveryInFlight) return this.recoveryInFlight;
    const operation = this.recoveryChain.then(() =>
      this.recoverFromTruthUnlocked(),
    );
    this.recoveryInFlight = operation;
    this.recoveryChain = operation.catch(() => []);
    void operation.then(
      () => {
        if (this.recoveryInFlight === operation)
          this.recoveryInFlight = undefined;
      },
      () => {
        if (this.recoveryInFlight === operation)
          this.recoveryInFlight = undefined;
      },
    );
    return operation;
  }
  private async recoverFromTruthUnlocked(): Promise<readonly string[]> {
    const failures: string[] = [];
    for (const context of Object.values(this.authority.snapshot())) {
      try {
        if (context.lifecycle?.desiredState === "closed") {
          const operationId = context.lifecycle.closeOperation?.operationId;
          if (!operationId)
            throw new Error("Closed task is missing its durable operation.");
          await this.closeTask(context.roveTaskId, operationId);
          continue;
        }
        if (context.bootstrap.stage !== "complete") {
          const bootstrapped = await this.advanceBootstrap(context);
          if (
            bootstrapped.initialLaunch &&
            bootstrapped.executionMode !== "capture"
          )
            await this.advanceInitialLaunch(bootstrapped);
          continue;
        }
        if (
          context.executionMode !== "capture" &&
          context.initialLaunch === undefined &&
          (await this.reconcileCompletePreJournalLaunch(context))
        )
          continue;
        if (context.initialLaunch && context.executionMode !== "capture")
          await this.advanceInitialLaunch(context);
        if (context.roveSessionId) {
          const entries = await this.runtimeInventory(context);
          if (entries.length !== 1)
            throw new Error(
              entries.length > 1
                ? "Runtime recovery lookup is conflicting."
                : "Runtime recovery record is missing.",
            );
          let session = entries[0]!.session;
          if (
            session.id !== context.roveSessionId ||
            session.mode !== context.executionMode ||
            (context.browserIdentity.mode === "workspace"
              ? session.workspace?.id !== context.browserIdentity.workspaceId
              : session.profile.mode !== "temporary")
          )
            throw new Error("Recovered Runtime task identity changed.");
          if (entries[0]!.recovery === "relaunchable") {
            if (!this.runtime.recoverSession)
              throw new Error("Runtime recovery command is unavailable.");
            session = (await this.runtime.recoverSession(session.id)).session;
          } else if (entries[0]!.recovery !== "not_needed") {
            await this.recordConvergence(
              context,
              "cleanup_required",
              entries[0]!.diagnostic ?? "Runtime cleanup is required.",
            );
            continue;
          }
          if (this.attachments) {
            await this.attachments.authority.reconcileTaskOperations(
              context.roveTaskId,
              context.roveSessionId,
              this.attachments.runtime,
            );
            const taskAttachments = this.attachments.authority.listForTask(
              context.roveTaskId,
            );
            if (taskAttachments.some((item) => item.status === "unavailable"))
              throw new Error(
                "A task attachment is unavailable and must be reselected or the task finished.",
              );
            const reconcilable = taskAttachments
              .filter((item) => ["binding", "bound"].includes(item.status))
              .map((item) => item.id);
            if (reconcilable.length > 0)
              await this.attachments.authority.bindDrafts(
                reconcilable,
                context.roveTaskId,
                context.roveSessionId,
                this.attachments.runtime,
              );
          }
        }
        if (this.taskProcessDriver) {
          await this.lifecycleDecisionForTask(context, {
            type: "observe",
            taskId: context.roveTaskId,
          });
          await this.taskProcessDriver.runUntilIdle(context.roveTaskId);
          continue;
        }
        await this.resume({ roveTaskId: context.roveTaskId });
        await this.readTaskProjection(context.roveTaskId);
        if (
          this.continuations &&
          this.runtime.getControlStatus &&
          this.runtime.inspect
        ) {
          const reconciled = await this.reconcileContinuationFromTruth(
            context.roveTaskId,
          );
          if (!reconciled)
            await this.returnControlFromRuntime(context.roveTaskId);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const current = this.authority.get(context.roveTaskId);
        if (!current) continue;
        await this.recordConvergence(current, "cleanup_required", reason).catch(
          () => undefined,
        );
        failures.push(`${context.roveTaskId}: ${reason}`);
      }
    }
    return failures;
  }

  private async reconcileCompletePreJournalLaunch(
    context: ResolvedTaskContext,
  ): Promise<boolean> {
    if (!context.codexThreadId || !context.codexSessionId)
      throw new Error(
        "Pre-journal launch truth is ambiguous; complete bootstrap lacks a bound Codex identity and the original outcome will not be replayed.",
      );
    let truth: CodexThread;
    let fullTurns = false;
    try {
      const read = await this.readThreadHistoryAware(
        context.codexThreadId,
        true,
        context,
      );
      truth = read.thread;
      fullTurns = read.fullTurns;
    } catch (error) {
      throw new Error(
        `Pre-journal launch truth is unavailable; the original outcome will not be replayed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (
      truth.id !== context.codexThreadId ||
      truth.sessionId !== context.codexSessionId ||
      truth.threadSource !== context.bootstrap.threadSource
    )
      throw new Error(
        "Pre-journal launch truth is ambiguous; the bound Codex identity changed and the original outcome will not be replayed.",
      );
    const projection = await this.conversationStore?.projection(
      context.codexThreadId,
    );
    const hasUserTurn =
      Object.values(projection?.items ?? {}).some(
        (item) => item.kind === "user_message",
      ) ||
      (fullTurns &&
        truth.turns.some((turn) =>
          turn.items.some((item) => item.type === "userMessage"),
        ));
    if (hasUserTurn) return false;
    const hasActiveOrPendingTurn =
      truth.status.type === "active" ||
      truth.turns.some((turn) => turn.status === "inProgress");
    const hasIncompleteTurnTruth =
      fullTurns && truth.turns.some((turn) => turn.itemsView !== "full");
    if (hasActiveOrPendingTurn || hasIncompleteTurnTruth)
      throw new Error(
        "Pre-journal launch truth is ambiguous; a turn is active, pending, or incompletely loaded and the original outcome will not be replayed.",
      );
    const closing = await this.updateContext(context, {
      lifecycle: preJournalCleanupLifecycle(context),
    });
    await this.closeTask(
      closing.roveTaskId,
      closing.lifecycle!.closeOperation!.operationId,
    );
    return true;
  }
  taskIdForRuntimeSession(sessionId: string): string {
    const context = this.authority.findBySession(
      nonempty(sessionId, "Runtime session id"),
    );
    if (
      !context ||
      context.bootstrap.stage !== "complete" ||
      context.roveSessionId !== sessionId
    )
      throw new Error("Active Runtime session is not bound to a current task.");
    return context.roveTaskId;
  }
  async reselectTaskAttachment(
    taskId: string,
    attachmentId: string,
  ): Promise<TaskAttachmentDescriptor | null> {
    if (!this.attachments) throw new Error("File attachments are unavailable.");
    const context = this.requireCompleteTask(taskId);
    if (!context.roveSessionId)
      throw new Error("Task attachment is missing its Runtime identity.");
    return this.attachments.authority.reselectTaskAttachment(
      attachmentId,
      context.roveTaskId,
      context.roveSessionId,
      this.attachments.runtime,
    );
  }
  async reconcileFileGrant(
    identity: { requestId: string; taskId: string; sessionId: string },
    action: "retry" | "cancel",
  ): Promise<void> {
    if (!this.attachments) throw new Error("File attachments are unavailable.");
    const context = this.requireCompleteTask(identity.taskId);
    if (context.roveSessionId !== identity.sessionId)
      throw new Error("File reconciliation has a mismatched Runtime session.");
    await this.attachments.authority.reconcileMidTask(
      identity,
      this.attachments.runtime,
      action,
    );
  }
  async prepareReturnControl(sessionId: string): Promise<string> {
    if (!this.continuations || !this.runtime.getControlStatus)
      throw new Error("Durable continuation authority is unavailable.");
    const taskId = this.taskIdForRuntimeSession(sessionId);
    const pending = await this.continuations.pendingForTask(taskId);
    if (
      pending?.roveSessionId !== undefined &&
      pending.roveSessionId !== sessionId
    )
      throw new Error("Active Runtime session has a mismatched continuation.");
    const control = await this.runtime.getControlStatus(sessionId);
    if (
      control.controller !== "human" ||
      !["active", "awaiting_human"].includes(control.status)
    )
      throw new Error("Runtime control truth does not match this handoff.");
    if (
      (pending !== undefined &&
        (!pending.handoffId ||
          control.activeHandoffId !== pending.handoffId)) ||
      (pending === undefined && control.activeHandoffId !== undefined)
    )
      throw new Error("Runtime control truth does not match this handoff.");
    return taskId;
  }
  private async returnControlAuthority(taskId: string): Promise<{
    ownershipGeneration: number;
    handoffId: string;
    handoffGeneration: number;
  }> {
    if (!this.continuations || !this.runtime.getControlStatus)
      throw new Error("Durable continuation authority is unavailable.");
    const context = this.requireCompleteTask(taskId);
    const pending = await this.continuations.pendingForTask(taskId);
    if (!pending?.handoffId || pending.roveSessionId !== context.roveSessionId)
      throw new Error("Pending continuation has mismatched Runtime authority.");
    const control = await this.runtime.getControlStatus(context.roveSessionId);
    if (
      control.controller !== "human" ||
      control.activeHandoffId !== pending.handoffId ||
      control.activeHandoffGeneration !== pending.handoffGeneration
    )
      throw new Error("Runtime control truth does not match this handoff.");
    return {
      ownershipGeneration: control.generation,
      handoffId: pending.handoffId,
      handoffGeneration: pending.handoffGeneration,
    };
  }
  async returnControlForTask(
    taskId: string,
    operationId: string,
  ): Promise<"dispatched" | "pending" | "ignored"> {
    const context = this.requireCompleteTask(taskId);
    await this.prepareReturnControl(context.roveSessionId);
    const pending = await this.continuations?.pendingForTask(taskId);
    if (!pending) throw new Error("Pending continuation is unavailable.");
    if (this.taskProcessDriver) {
      await this.lifecycleDecisionForTask(context, {
        type: "return_control",
        taskId,
        operationId,
        generation: pending.handoffGeneration,
      });
      await this.taskProcessDriver.runUntilIdle(taskId);
      const projection = await this.lifecycleDecisionForTask(
        context,
        { type: "observe", taskId },
        false,
      );
      return projection.output.phase === "recovering"
        ? "pending"
        : "dispatched";
    }
    if (this.onLifecycleDecision && this.onLifecycleCommandStatus) {
      const decision = await this.lifecycleDecisionForTask(context, {
        type: "return_control",
        taskId,
        operationId,
        generation: pending.handoffGeneration,
      });
      if (decision.output.nextCommand?.type !== "return_runtime_ownership")
        throw new Error(
          `Lifecycle reducer did not authorize Return Control: ${decision.output.operationDisposition.reason}`,
        );
      if (!decision.commandId)
        throw new Error("Return Control command was not committed.");
      await this.onLifecycleCommandStatus(
        decision.commandId,
        "possibly_started",
      );
      try {
        await this.continuations!.recordReturnControlIntent(
          pending,
          operationId,
        );
        if (!this.runtime.returnControlForSession)
          throw new Error("Runtime Return Control command is unavailable.");
        await this.runtime.returnControlForSession(
          context.roveSessionId,
          await this.returnControlAuthority(taskId),
        );
        await this.onLifecycleCommandStatus(decision.commandId, "succeeded", {
          observedAt: this.now(),
          sessionId: context.roveSessionId,
          generation: pending.handoffGeneration,
        });
      } catch (error) {
        await this.onLifecycleCommandStatus(
          decision.commandId,
          "reconcile_required",
          {
            observedAt: this.now(),
            error:
              error instanceof Error
                ? error.message.slice(0, 240)
                : String(error).slice(0, 240),
          },
        );
        throw error;
      }
      return this.returnControlFromRuntime(taskId);
    }
    await this.continuations?.recordReturnControlIntent(pending, operationId);
    if (!this.runtime.returnControlForSession)
      throw new Error("Runtime Return Control command is unavailable.");
    await this.runtime.returnControlForSession(
      context.roveSessionId,
      await this.returnControlAuthority(taskId),
    );
    return this.returnControlFromRuntime(taskId);
  }
  async resume(input: ResumeTaskInput): Promise<StartedTask> {
    exactKeys(
      input as unknown as Record<string, unknown>,
      ["roveTaskId"],
      "resume intent",
    );
    let context = this.authority.get(nonempty(input.roveTaskId, "task id"));
    if (!context) throw new Error("Task has no restorable context.");
    if (this.taskProcessDriver && context.bootstrap.stage === "complete") {
      await this.lifecycleDecisionForTask(context, {
        type: "resume",
        taskId: context.roveTaskId,
        operationId: `intent_${randomUUID()}`,
      });
      await this.taskProcessDriver.runUntilIdle(context.roveTaskId);
      return { context: this.requireCompleteTask(context.roveTaskId) };
    }
    context = await this.advanceBootstrap(context);
    if (
      !context.codexThreadId ||
      !context.roveSessionId ||
      !context.capabilityFingerprint
    )
      throw new Error("Task has no complete restorable context.");
    const issued = this.capabilities.issue({
      taskId: context.roveTaskId,
      sessionId: context.roveSessionId,
      executionMode: context.executionMode,
      browserIdentity: context.browserIdentity,
    });
    const projected = await this.conversationStore?.projection(
      context.codexThreadId,
    );
    if (projected?.archived)
      await this.conversations.unarchiveThread(context.codexThreadId);
    const metadata = await this.readThreadHistoryAware(
      context.codexThreadId,
      false,
    );
    const result = await this.conversations.resumeThreadWithConfig(
      context.codexThreadId,
      this.resumeParams(context, issued.token, metadata.thread.historyMode),
    );
    this.assertApprovalsReviewer(context, result.approvalsReviewer);
    if (
      result.thread.id !== context.codexThreadId ||
      result.thread.sessionId !== context.codexSessionId
    )
      throw new Error("Codex resumed conflicting thread/session identity.");
    return { context: context as Required<ResolvedTaskContext> };
  }
  private async convergeBootstrapRollback(
    initial: ResolvedTaskContext,
  ): Promise<void> {
    let context = initial;
    const sessionId = context.roveSessionId;
    if (!sessionId)
      throw new Error("Bootstrap rollback is missing its Runtime identity.");
    if (context.bootstrap.stage === "rollback_pending") {
      if (this.attachments)
        await this.attachments.authority.cleanupRuntimeGrants(
          context.roveTaskId,
          sessionId,
          this.attachments.runtime,
        );
      context = await this.updateContext(context, {
        bootstrap: {
          ...context.bootstrap,
          stage: "rollback_evidence_settled",
        },
      });
    }
    if (context.bootstrap.stage === "rollback_evidence_settled") {
      await this.runtime.endSession(sessionId);
      context = await this.updateContext(context, {
        bootstrap: { ...context.bootstrap, stage: "rollback_runtime_settled" },
      });
    }
    if (context.bootstrap.stage === "rollback_runtime_settled") {
      await this.attachments?.authority.cleanupTask(context.roveTaskId);
      context = await this.updateContext(context, {
        bootstrap: {
          ...context.bootstrap,
          stage: "rollback_attachments_settled",
        },
      });
    }
    if (context.bootstrap.stage === "rollback_attachments_settled") {
      this.authority.close(context.roveTaskId);
      try {
        await this.persistContexts();
      } catch (error) {
        this.authority.replace(context.roveTaskId, context);
        throw error;
      }
    }
  }
  async close(identity: ActiveTaskIdentity): Promise<void> {
    const context = this.authority.get(identity.roveTaskId);
    if (
      context?.roveSessionId !== identity.roveSessionId ||
      context.codexThreadId !== identity.codexThreadId
    )
      throw new Error("Stale or mismatched task close.");
    return this.closeTask(identity.roveTaskId, `intent_${randomUUID()}`);
  }
  async closeTask(
    taskId: string,
    operationId = `intent_${randomUUID()}`,
  ): Promise<void> {
    const existing = this.closeLocks.get(taskId);
    if (existing !== undefined) return existing;
    const operation = this.closeTaskUnlocked(taskId, operationId).finally(
      () => {
        if (this.closeLocks.get(taskId) === operation)
          this.closeLocks.delete(taskId);
      },
    );
    this.closeLocks.set(taskId, operation);
    return operation;
  }
  private async closeTaskUnlocked(
    taskId: string,
    operationId: string,
  ): Promise<void> {
    if (this.taskProcessDriver) {
      boundedIdentity(operationId, "close operation", /^intent_[a-f0-9-]{36}$/);
      const context = this.authority.get(nonempty(taskId, "task id"));
      if (!context) throw new Error("Task has no lifecycle record.");
      await this.lifecycleDecisionForTask(context, {
        type: "finish",
        taskId,
        operationId,
      });
      await this.taskProcessDriver.runUntilIdle(taskId);
      const projection = await this.lifecycleDecisionForTask(
        this.authority.get(taskId) ?? context,
        { type: "observe", taskId },
      );
      if (projection.output.phase !== "ready")
        throw new Error(`Durable close stopped in ${projection.output.phase}.`);
      const current = this.authority.get(taskId) ?? context;
      await this.syncLedgerLifecycleRecord(current, projection.record);
      return;
    }
    if (this.onLifecycleDecision && this.onLifecycleCommandStatus)
      return this.closeTaskFromReducer(taskId, operationId);
    boundedIdentity(operationId, "close operation", /^intent_[a-f0-9-]{36}$/);
    let context = this.authority.get(nonempty(taskId, "task id"));
    if (!context) throw new Error("Task has no lifecycle record.");
    if (context.lifecycle?.closeOperation?.stage === "complete") {
      if (context.roveSessionId && this.attachments)
        await this.attachments.authority.cleanupRuntimeGrants(
          taskId,
          context.roveSessionId,
          this.attachments.runtime,
        );
      await this.attachments?.authority.cleanupTask(taskId);
      return;
    }
    if (context.lifecycle?.desiredState !== "closed") {
      context = await this.updateContext(context, {
        lifecycle: {
          schemaVersion: 1,
          desiredState: "closed",
          closeOperation: {
            operationId,
            requestedAt: this.now(),
            stage: "requested",
          },
        },
      });
      await this.onCloseStagePersisted?.(taskId, "requested");
    } else if (context.lifecycle.closeOperation?.operationId !== operationId) {
      throw new Error("A different close operation is already in progress.");
    }
    for (let step = 0; step < 12; step += 1) {
      const close = context.lifecycle?.closeOperation;
      if (!close) throw new Error("Close operation was not persisted.");
      try {
        if (close.stage === "requested") {
          if (context.codexThreadId) {
            try {
              const read = await this.readThreadHistoryAware(
                context.codexThreadId,
                true,
                context,
              );
              const active = read.fullTurns
                ? read.thread.turns.find((turn) => turn.status === "inProgress")
                    ?.id
                : await this.projectedActiveTurnId(context.codexThreadId);
              if (read.thread.status.type === "active" && active === undefined)
                throw new Error(
                  "Paginated Codex thread is active without an exact durable active-turn identity.",
                );
              if (active) {
                await this.conversations.interruptTurnAndWaitForTerminal(
                  context.codexThreadId,
                  active,
                );
                continue;
              }
            } catch (error) {
              if (!(await this.settleNotLoadedThreadForClose(context, error)))
                throw error;
            }
          } else {
            const listed = await Promise.all([
              this.conversations.listThreads({ limit: 100, archived: false }),
              this.conversations.listThreads({ limit: 100, archived: true }),
            ]);
            const matches = [
              ...new Map(
                listed
                  .flatMap((page) => page.data)
                  .filter(
                    (thread) =>
                      thread.threadSource === context!.bootstrap.threadSource,
                  )
                  .map((thread) => [thread.id, thread]),
              ).values(),
            ];
            if (matches.length > 1)
              throw new Error("Codex thread-source lookup is conflicting.");
            if (matches[0])
              context = await this.bindRecoveredThread(context, matches[0]);
          }
          context = await this.advanceCloseStage(context, "codex_settled");
          continue;
        }
        if (close.stage === "codex_settled") {
          let pending = await this.continuations?.pendingForTask(taskId);
          if (
            pending?.continuationCommand?.dispatchStatus === "possibly_started"
          ) {
            if (!context.codexThreadId)
              throw new Error(
                "Continuation dispatch cannot reconcile without a bound Codex thread.",
              );
            const thread = (
              await this.readThreadHistoryAware(context.codexThreadId, true)
            ).thread;
            await this.continuations?.reconcile(pending, thread);
            pending = await this.continuations?.pendingForTask(taskId);
            if (
              pending?.continuationCommand?.dispatchStatus ===
              "possibly_started"
            )
              throw new Error(
                "Continuation dispatch requires an exact terminal receipt before close.",
              );
          }
          if (pending) await this.continuations?.cancel(pending);
          for (const attention of this.attentionQueue?.list() ?? []) {
            if (
              attention.taskId === taskId &&
              (context.codexThreadId === undefined ||
                attention.threadId === context.codexThreadId)
            ) {
              if (
                [
                  "responding",
                  "awaiting_confirmation",
                  "resolution_unknown",
                ].includes(attention.status)
              )
                throw new Error(
                  `Attention ${attention.requestId} requires exact response reconciliation before close.`,
                );
              if (attention.status !== "pending") continue;
              this.attentionQueue?.cancel(
                attention.authority,
                attention.requestId,
              );
            }
          }
          await this.attentionQueue?.flush();
          context = await this.advanceCloseStage(
            context,
            "continuation_settled",
          );
          continue;
        }
        if (close.stage === "continuation_settled") {
          if (context.roveSessionId && this.attachments)
            await this.attachments.authority.cleanupRuntimeGrants(
              taskId,
              context.roveSessionId,
              this.attachments.runtime,
            );
          if (!this.runtime.listSessionInventory) {
            if (context.roveSessionId)
              await this.runtime.endSession(context.roveSessionId);
            context = await this.advanceCloseStage(context, "runtime_settled");
            continue;
          }
          const inventory = await this.runtimeInventory(context);
          if (inventory.length > 1)
            throw new Error("Runtime bootstrap lookup is conflicting.");
          const entry = inventory[0];
          if (
            entry === undefined &&
            (context.roveSessionId !== undefined ||
              context.bootstrap.stage !== "intent_persisted")
          )
            throw new Error(
              "Bound Runtime session is absent; browser attachment and profile release cannot be confirmed.",
            );
          if (entry !== undefined) {
            if (!context.roveSessionId)
              context = await this.bindRuntime(context, entry.session);
            await this.runtime.endSession(entry.session.id);
            const confirmed = await this.runtimeInventory(context);
            if (
              confirmed.length !== 1 ||
              !["completed", "failed"].includes(confirmed[0]!.session.status) ||
              confirmed[0]!.attachment !== "missing" ||
              !["released", "claimable"].includes(
                confirmed[0]!.profileOwnership,
              )
            )
              continue;
          }
          context = await this.advanceCloseStage(context, "runtime_settled");
          continue;
        }
        if (close.stage === "runtime_settled") {
          await this.attachments?.authority.cleanupTask(taskId);
          context = await this.advanceCloseStage(
            context,
            "attachments_settled",
          );
          continue;
        }
        if (close.stage === "attachments_settled") {
          context = await this.advanceCloseStage(context, "complete");
          continue;
        }
        if (close.stage === "complete") return;
      } catch (error) {
        await this.recordConvergence(
          context,
          "cleanup_required",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }
    await this.recordConvergence(
      context,
      "cleanup_required",
      "Close convergence exceeded its command bound.",
    );
    throw new Error("Close convergence exceeded its command bound.");
  }
  private async closeTaskFromReducer(
    taskId: string,
    operationId: string,
  ): Promise<void> {
    const recordStatus = this.onLifecycleCommandStatus;
    if (!recordStatus)
      throw new Error("Durable lifecycle command status authority is missing.");
    boundedIdentity(operationId, "close operation", /^intent_[a-f0-9-]{36}$/);
    let context = this.authority.get(nonempty(taskId, "task id"));
    if (!context) throw new Error("Task has no lifecycle record.");
    if (
      context.lifecycle?.desiredState === "closed" &&
      context.lifecycle.closeOperation?.operationId !== operationId
    )
      throw new Error("A different close operation is already in progress.");
    let operation: NativeLifecycleInput["requestedOperation"] = {
      type: "finish",
      taskId,
      operationId,
    };
    for (let step = 0; step < 24; step += 1) {
      const decision = await this.lifecycleDecisionForTask(context, operation);
      context = await this.syncLedgerLifecycleRecord(context, decision.record);
      operation = { type: "observe", taskId };
      if (decision.output.nextCommand === null) {
        if (decision.output.phase === "ready") return;
        throw new Error(
          `Lifecycle reducer stopped close in ${decision.output.phase}: ${decision.output.attention?.message ?? decision.output.operationDisposition.reason}`,
        );
      }
      if (!decision.commandId)
        throw new Error("Reducer command was not committed to the ledger.");
      await recordStatus(decision.commandId, "possibly_started");
      try {
        context = await this.dispatchCloseCommand(
          context,
          decision.output.nextCommand,
        );
        await recordStatus(decision.commandId, "succeeded", {
          observedAt: this.now(),
          commandType: decision.output.nextCommand.type,
        });
      } catch (error) {
        await recordStatus(decision.commandId, "reconcile_required", {
          observedAt: this.now(),
          error:
            error instanceof Error
              ? error.message.slice(0, 240)
              : String(error).slice(0, 240),
        });
        await this.recordConvergence(
          context,
          "cleanup_required",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    }
    await this.recordConvergence(
      context,
      "cleanup_required",
      "Reducer close convergence exceeded its command bound.",
    );
    throw new Error("Reducer close convergence exceeded its command bound.");
  }

  private async dispatchCloseCommand(
    context: ResolvedTaskContext,
    command: NonNullable<NativeLifecycleOutput["nextCommand"]>,
  ): Promise<ResolvedTaskContext> {
    const taskId = context.roveTaskId;
    switch (command.type) {
      case "persist_close_intent": {
        if (typeof command.operationId !== "string")
          throw new Error("Reducer close intent lacks an operation identity.");
        await this.onCloseStagePersisted?.(taskId, "requested");
        return context;
      }
      case "interrupt_codex_turn":
        if (!context.codexThreadId || typeof command.turnId !== "string")
          throw new Error("Reducer Codex interrupt lacks exact identity.");
        await this.conversations.interruptTurnAndWaitForTerminal(
          context.codexThreadId,
          command.turnId,
        );
        return context;
      case "settle_continuation_attention": {
        const pending = await this.continuations?.pendingForTask(taskId);
        if (pending) await this.continuations?.cancel(pending);
        for (const attention of this.attentionQueue?.list() ?? []) {
          if (attention.taskId !== taskId) continue;
          if (
            [
              "responding",
              "awaiting_confirmation",
              "resolution_unknown",
            ].includes(attention.status)
          )
            throw new Error(
              `Attention ${attention.requestId} requires exact response reconciliation before close.`,
            );
          if (attention.status === "pending")
            this.attentionQueue?.cancel(
              attention.authority,
              attention.requestId,
            );
        }
        await this.attentionQueue?.flush();
        return context;
      }
      case "reconcile_continuation_dispatch": {
        const pending = await this.continuations?.pendingForTask(taskId);
        if (!pending) return context;
        if (!context.codexThreadId)
          throw new Error("Continuation reconciliation lacks a Codex thread.");
        const thread = (
          await this.readThreadHistoryAware(context.codexThreadId, true)
        ).thread;
        await this.continuations?.reconcile(pending, thread);
        return context;
      }
      case "end_runtime_session": {
        if (context.roveSessionId && this.attachments)
          await this.attachments.authority.cleanupRuntimeGrants(
            taskId,
            context.roveSessionId,
            this.attachments.runtime,
          );
        const inventory = await this.runtimeInventory(context);
        if (inventory.length > 1)
          throw new Error("Runtime bootstrap lookup is conflicting.");
        const entry = inventory[0];
        if (!entry)
          throw new Error(
            "Bound Runtime session is absent; browser attachment and profile release cannot be confirmed.",
          );
        if (!context.roveSessionId)
          context = await this.bindRuntime(context, entry.session);
        await this.runtime.endSession(entry.session.id);
        return context;
      }
      case "advance_close_stage": {
        const stage = command.stage;
        if (
          stage !== "codex_settled" &&
          stage !== "continuation_settled" &&
          stage !== "runtime_settled" &&
          stage !== "complete"
        )
          throw new Error("Reducer emitted an invalid close stage.");
        if (stage === "complete")
          await this.attachments?.authority.cleanupTask(taskId);
        await this.onCloseStagePersisted?.(taskId, stage);
        return context;
      }
      case "read_codex_thread":
      case "read_runtime_inventory":
      case "read_lifecycle_truth":
        throw new Error(`${command.type} did not produce authoritative truth.`);
      default:
        throw new Error(
          `Lifecycle reducer emitted unsupported close command ${command.type}.`,
        );
    }
  }

  /** Exhaustive production adapter for every reducer command. The command
   * classification above is compile-time coupled to NativeLifecycleCommandType. */
  private async dispatchTaskProcessCommand(
    context: ResolvedTaskContext,
    command: NonNullable<NativeLifecycleOutput["nextCommand"]>,
    reconcile: boolean,
  ): Promise<ResolvedTaskContext> {
    const taskId = context.roveTaskId;
    const pending = async () => {
      const value = await this.continuations?.pendingForTask(taskId);
      if (!value) throw new Error("Pending continuation is unavailable.");
      if (
        value.roveTaskId !== taskId ||
        (context.roveSessionId &&
          value.roveSessionId !== context.roveSessionId) ||
        (context.codexThreadId && value.codexThreadId !== context.codexThreadId)
      )
        throw new Error(
          "Continuation identity does not match the task binding.",
        );
      return value;
    };
    const resumeBoundThread = async () => {
      if (!context.codexThreadId || !context.roveSessionId)
        throw new Error("Codex resume lacks bound identities.");
      const issued = this.capabilities.issue({
        taskId,
        sessionId: context.roveSessionId,
        executionMode: context.executionMode,
        browserIdentity: context.browserIdentity,
      });
      const listed = await this.listBoundThread(context);
      const resumed = await this.conversations.resumeThreadWithConfig(
        context.codexThreadId,
        this.resumeParams(
          context,
          issued.token,
          listed?.thread.historyMode ?? "legacy",
        ),
      );
      if (
        resumed.thread.id !== context.codexThreadId ||
        (context.codexSessionId &&
          resumed.thread.sessionId !== context.codexSessionId)
      )
        throw new Error("Codex resumed conflicting thread identity.");
      this.assertApprovalsReviewer(context, resumed.approvalsReviewer);
      await this.conversationStore?.reconcile(resumed.thread);
    };
    switch (command.type) {
      case "persist_bootstrap_intent":
        return context;
      case "advance_bootstrap_stage":
        if (
          command.stage !== "runtime_dispatching" &&
          command.stage !== "thread_dispatching"
        )
          throw new Error("Invalid bootstrap stage command.");
        return this.updateContext(context, {
          bootstrap: { ...context.bootstrap, stage: command.stage },
        });
      case "lookup_or_start_runtime": {
        const matches = await this.runtimeInventory(context);
        if (matches.length > 1)
          throw new Error("Runtime bootstrap identity collision.");
        if (!matches[0] && !reconcile)
          await this.runtime.startSession({
            bootstrapId: context.bootstrap.attemptId,
            mode: context.executionMode,
            browser:
              context.browserIdentity.mode === "temporary"
                ? { mode: "temporary" }
                : {
                    mode: "workspace",
                    workspaceId: context.browserIdentity.workspaceId,
                  },
          });
        return context;
      }
      case "bind_runtime_identity": {
        const matches = await this.runtimeInventory(context);
        if (matches.length !== 1)
          throw new Error("Runtime binding lacks one exact receipt.");
        return this.bindRuntime(context, matches[0]!.session);
      }
      case "lookup_or_start_codex_thread": {
        if (!context.roveSessionId)
          throw new Error("Codex bootstrap lacks a Runtime binding.");
        const issued = this.capabilities.issue({
          taskId,
          sessionId: context.roveSessionId,
          executionMode: context.executionMode,
          browserIdentity: context.browserIdentity,
        });
        const listed = await Promise.all([
          this.conversations.listThreads({ limit: 100, archived: false }),
          this.conversations.listThreads({ limit: 100, archived: true }),
        ]);
        const matches = listed
          .flatMap((page) => page.data)
          .filter(
            (thread) => thread.threadSource === context.bootstrap.threadSource,
          );
        if (new Set(matches.map((thread) => thread.id)).size > 1)
          throw new Error("Codex bootstrap identity collision.");
        if (matches.length === 0 && !reconcile)
          await this.conversations.startThread(
            this.threadParams(context, issued.token),
          );
        return context;
      }
      case "prepare_codex_reassociation": {
        const reassociated: ResolvedTaskContext = {
          ...context,
          bootstrap: { ...context.bootstrap, stage: "thread_dispatching" },
        };
        delete reassociated.codexThreadId;
        delete reassociated.codexSessionId;
        const next = this.authority.replace(context.roveTaskId, reassociated);
        await this.persistContexts();
        return next;
      }
      case "bind_codex_identity": {
        if (
          !context.roveSessionId ||
          typeof command.returnedThreadId !== "string"
        )
          throw new Error("Codex binding lacks exact identities.");
        const issued = this.capabilities.issue({
          taskId,
          sessionId: context.roveSessionId,
          executionMode: context.executionMode,
          browserIdentity: context.browserIdentity,
        });
        const inspected = await this.mcp.inspect({
          taskId,
          capability: issued.token,
          capabilityVerifier: this.capabilities.verifier(),
          sessionId: context.roveSessionId,
          executionMode: context.executionMode,
          browserIdentity: context.browserIdentity,
        });
        const listed = await Promise.all([
          this.conversations.listThreads({ limit: 100, archived: false }),
          this.conversations.listThreads({ limit: 100, archived: true }),
        ]);
        const thread = listed
          .flatMap((page) => page.data)
          .find((entry) => entry.id === command.returnedThreadId);
        if (!thread) throw new Error("Codex binding receipt is absent.");
        return this.bindThread(context, thread, inspected);
      }
      case "read_codex_thread":
        if (context.codexThreadId)
          await this.readThreadHistoryAware(
            context.codexThreadId,
            true,
            context,
          );
        return context;
      case "read_runtime_inventory":
        await this.runtimeInventory(context);
        return context;
      case "read_lifecycle_truth":
        await Promise.all([
          this.runtimeInventory(context),
          context.codexThreadId
            ? this.readThreadHistoryAware(context.codexThreadId, true, context)
            : Promise.resolve(undefined),
        ]);
        return context;
      case "persist_close_intent":
        await this.onCloseStagePersisted?.(taskId, "requested");
        return context;
      case "interrupt_codex_turn":
        if (!context.codexThreadId || typeof command.turnId !== "string")
          throw new Error("Codex interrupt lacks exact identity.");
        if (!reconcile)
          await this.conversations.interruptTurnAndWaitForTerminal(
            context.codexThreadId,
            command.turnId,
          );
        else
          await this.readThreadHistoryAware(
            context.codexThreadId,
            true,
            context,
          );
        return context;
      case "settle_continuation_attention": {
        const continuation = await this.continuations?.pendingForTask(taskId);
        if (continuation) await this.continuations?.cancel(continuation);
        for (const attention of this.attentionQueue?.list() ?? []) {
          if (attention.taskId !== taskId) continue;
          if (
            [
              "responding",
              "awaiting_confirmation",
              "resolution_unknown",
            ].includes(attention.status)
          )
            throw new Error(
              `Attention ${attention.requestId} requires reconciliation.`,
            );
          if (attention.status === "pending")
            this.attentionQueue?.cancel(
              attention.authority,
              attention.requestId,
            );
        }
        await this.attentionQueue?.flush();
        return context;
      }
      case "end_runtime_session":
        if (!context.roveSessionId)
          throw new Error("Runtime close lacks a bound session.");
        if (!reconcile) await this.runtime.endSession(context.roveSessionId);
        else await this.runtimeInventory(context);
        return context;
      case "advance_close_stage": {
        const stage = command.stage;
        if (
          ![
            "codex_settled",
            "continuation_settled",
            "runtime_settled",
            "complete",
          ].includes(String(stage))
        )
          throw new Error("Invalid close stage command.");
        if (stage === "complete")
          await this.attachments?.authority.cleanupTask(taskId);
        await this.onCloseStagePersisted?.(
          taskId,
          stage as TaskCloseOperation["stage"],
        );
        return context;
      }
      case "relaunch_named_browser":
        if (!context.roveSessionId || !this.runtime.recoverSession)
          throw new Error("Named browser recovery is unavailable.");
        if (!reconcile)
          await this.runtime.recoverSession(context.roveSessionId);
        else await this.runtimeInventory(context);
        return context;
      case "resume_codex_thread":
      case "recover_codex_thread":
        if (!reconcile) await resumeBoundThread();
        else if (context.codexThreadId)
          await this.readThreadHistoryAware(
            context.codexThreadId,
            true,
            context,
          );
        return context;
      case "unarchive_codex_thread":
        if (!context.codexThreadId)
          throw new Error("Unarchive command lacks a Codex thread.");
        if (!reconcile)
          await this.conversations.unarchiveThread(context.codexThreadId);
        else
          await this.readThreadHistoryAware(
            context.codexThreadId,
            false,
            context,
          );
        return context;
      case "inspect_after_return": {
        const continuation = await pending();
        if (
          !context.roveSessionId ||
          !this.runtime.inspect ||
          !this.runtime.getControlStatus
        )
          throw new Error("Runtime inspection is unavailable.");
        if (!reconcile) await this.runtime.inspect(context.roveSessionId);
        const control = await this.runtime.getControlStatus(
          context.roveSessionId,
        );
        if (
          control.controller !== "agent" ||
          control.observationSeq === undefined ||
          control.observationSeq <=
            (continuation.preHandoffObservationSeq ?? -1) ||
          !continuation.handoffId
        )
          throw new Error(
            "Fresh post-return Runtime inspection was not confirmed.",
          );
        await this.continuations?.recordFreshInspection(continuation, {
          inspectionId: `inspect:${context.roveSessionId}:${continuation.handoffGeneration}:${control.observationSeq}`,
          sessionId: context.roveSessionId,
          handoffId: continuation.handoffId,
          generation: continuation.handoffGeneration,
          afterObservationSeq: control.observationSeq,
        });
        return context;
      }
      case "record_return_event": {
        const continuation = await pending();
        if (typeof command.returnEventId !== "string")
          throw new Error("Return event lacks an identity.");
        await this.continuations?.recordReturnEvent(continuation, {
          eventId: command.returnEventId,
          ...(typeof command.returnObservationSeq === "number"
            ? { observationSeq: command.returnObservationSeq }
            : {}),
        });
        return context;
      }
      case "prepare_continuation_command": {
        const continuation = await pending();
        if (!context.codexThreadId)
          throw new Error("Continuation preparation lacks a Codex thread.");
        const thread = (
          await this.readThreadHistoryAware(context.codexThreadId, true)
        ).thread;
        await this.continuations?.prepareContinuationCommand(
          continuation,
          thread,
        );
        return context;
      }
      case "persist_continuation_dispatch_intent":
        await this.continuations?.persistContinuationDispatchIntent(
          await pending(),
        );
        return context;
      case "dispatch_or_reconcile_continuation": {
        const continuation = await pending();
        if (reconcile) {
          if (!context.codexThreadId)
            throw new Error(
              "Continuation reconciliation lacks a Codex thread.",
            );
          const thread = (
            await this.readThreadHistoryAware(context.codexThreadId, true)
          ).thread;
          const terminal = await this.continuations?.reconcile(
            continuation,
            thread,
          );
          if (!terminal)
            throw new Error("Continuation dispatch outcome is unresolved.");
        } else {
          await this.continuations?.dispatchPreparedContinuation(
            continuation,
            this.rpc,
          );
          if (!context.codexThreadId)
            throw new Error("Continuation dispatch lacks a Codex thread.");
          const thread = (
            await this.readThreadHistoryAware(context.codexThreadId, true)
          ).thread;
          await this.continuations?.reconcile(continuation, thread);
        }
        return context;
      }
      case "reconcile_continuation_dispatch": {
        const continuation = await pending();
        if (!context.codexThreadId)
          throw new Error("Continuation reconciliation lacks a Codex thread.");
        const thread = (
          await this.readThreadHistoryAware(context.codexThreadId, true)
        ).thread;
        if (!(await this.continuations?.reconcile(continuation, thread)))
          throw new Error("Continuation dispatch outcome is unresolved.");
        return context;
      }
      case "respond_continuation_explicit": {
        const continuation = await pending();
        if (typeof command.message !== "string" || !context.codexThreadId)
          throw new Error("Explicit continuation response is invalid.");
        if (!reconcile) {
          await this.conversations.startTurn({
            threadId: context.codexThreadId,
            clientUserMessageId: requiredString(
              command.operationId,
              "operation identity",
            ),
            input: this.userText(command.message),
          });
          await this.continuations?.cancel(continuation, "superseded");
        }
        return context;
      }
      case "reconcile_attention_response": {
        const entry = this.attentionQueue
          ?.list()
          .find(
            (item) =>
              item.taskId === taskId && item.requestId === command.requestId,
          );
        if (
          !entry ||
          !["resolved", "cancelled", "stale"].includes(entry.status)
        )
          throw new Error("Attention response outcome is unresolved.");
        return context;
      }
      case "start_or_steer_codex_turn": {
        if (!context.codexThreadId || typeof command.message !== "string")
          throw new Error("Codex message command lacks exact input.");
        if (reconcile) {
          await this.readThreadHistoryAware(
            context.codexThreadId,
            true,
            context,
          );
          return context;
        }
        const read = await this.readThreadHistoryAware(
          context.codexThreadId,
          true,
          context,
        );
        const active = read.thread.turns.find(
          (turn) => turn.status === "inProgress",
        )?.id;
        if (
          typeof command.expectedTurnId === "string" &&
          command.expectedTurnId !== active
        )
          throw new Error("Stale active-turn intent.");
        const operationId = requiredString(
          command.operationId,
          "operation identity",
        );
        if (active) {
          const result = await this.conversations.steerTurn({
            threadId: context.codexThreadId,
            expectedTurnId: active,
            clientUserMessageId: operationId,
            input: this.userText(command.message),
          });
          this.steeredTurnResults.set(operationId, result);
        } else {
          const result = await this.conversations.startTurn({
            threadId: context.codexThreadId,
            clientUserMessageId: operationId,
            input: this.userText(command.message),
          });
          this.startedTurnResults.set(operationId, result);
        }
        return context;
      }
      case "return_runtime_ownership": {
        const continuation = await pending();
        const operationId = requiredString(
          command.operationId,
          "Return Control operation",
        );
        await this.continuations?.recordReturnControlIntent(
          continuation,
          operationId,
        );
        if (!this.runtime.returnControlForSession || !context.roveSessionId)
          throw new Error("Runtime Return Control command is unavailable.");
        if (!reconcile)
          await this.runtime.returnControlForSession(
            context.roveSessionId,
            await this.returnControlAuthority(context.roveTaskId),
          );
        else if (this.runtime.getControlStatus)
          await this.runtime.getControlStatus(context.roveSessionId);
        return context;
      }
      case "respond_codex_attention": {
        if (
          !this.attentionResponder ||
          typeof command.requestId !== "string" ||
          typeof command.generation !== "number"
        )
          throw new Error("Codex attention response command is unavailable.");
        const attention = this.attentionQueue
          ?.list()
          .find(
            (entry) =>
              entry.authority === "codex" &&
              entry.taskId === taskId &&
              entry.requestId === command.requestId &&
              entry.generation === command.generation,
          );
        if (!attention)
          throw new Error("Codex attention command has no exact queue entry.");
        if (!reconcile)
          await this.attentionResponder(
            {
              requestId: attention.requestId,
              taskId,
              ...(attention.threadId ? { threadId: attention.threadId } : {}),
              ...(attention.turnId ? { turnId: attention.turnId } : {}),
              ...(attention.itemId ? { itemId: attention.itemId } : {}),
              generation: attention.generation,
            },
            command.response,
          );
        return context;
      }
      case "archive_codex_thread":
        if (!context.codexThreadId)
          throw new Error("Archive command lacks a Codex thread.");
        if (!reconcile)
          await this.conversations.archiveThread(context.codexThreadId);
        else
          await this.readThreadHistoryAware(
            context.codexThreadId,
            false,
            context,
          );
        return context;
    }
  }

  async executeTaskProcessCommand(
    claimed: TaskProcessCommand,
    reconcile: boolean,
    processContext: TaskProcessAdapterContext,
  ): Promise<TaskProcessAdapterResult> {
    let context = await this.restoreTaskProcessContext(claimed, processContext);
    const command = claimed.payload as NonNullable<
      NativeLifecycleOutput["nextCommand"]
    >;
    try {
      context = await this.dispatchTaskProcessCommand(
        context,
        command,
        reconcile,
      );
      const observed = await this.lifecycleDecisionForTask(
        context,
        { type: "observe", taskId: context.roveTaskId },
        false,
      );
      return {
        status:
          observed.output.nextCommand !== null &&
          isDeepStrictEqual(observed.output.nextCommand, command)
            ? "unresolved"
            : "succeeded",
        lifecycle: observed.lifecycleInput,
        detail: { commandType: command.type, reconciled: reconcile },
        durableData: durableLifecycleData(
          context.roveTaskId,
          await this.continuations?.latestForTask(context.roveTaskId),
          this.attentionQueue
            ?.list()
            .filter((entry) => entry.taskId === context.roveTaskId) ?? [],
          context.codexSessionId,
        ),
      };
    } catch (error) {
      return {
        status: "unresolved",
        lifecycle: (
          await this.lifecycleDecisionForTask(
            context,
            { type: "observe", taskId: context.roveTaskId },
            false,
          )
        ).lifecycleInput,
        detail: {
          error:
            error instanceof Error
              ? error.message.slice(0, 240)
              : String(error).slice(0, 240),
        },
        durableData: processContext.durableData,
      };
    }
  }

  async restoreTaskProcessStates(states: readonly TaskProcessState[]) {
    for (const state of states) {
      await this.restoreTaskProcessContext(
        {
          schemaVersion: 1,
          commandId: `restore:${state.taskId}:${state.projection.sequence}`,
          taskId: state.taskId,
          sequence: state.projection.sequence,
          type: "read_lifecycle_truth",
          payload: { type: "read_lifecycle_truth", taskId: state.taskId },
          status: "leased",
          attempts: 0,
          createdAt: this.now(),
        },
        {
          lifecycle: state.lifecycle,
          launchConfiguration: {
            ...(state.launchConfiguration ?? {}),
            roveTaskId: state.launchConfiguration?.roveTaskId ?? state.taskId,
          },
          durableData: state.durableData,
        },
      );
    }
    const restoredAttentions = states.flatMap((state) =>
      state.durableData.attentions.map(
        ({ schemaVersion: _schemaVersion, ...attention }) =>
          attention as AttentionRequest,
      ),
    );
    this.attentionQueue?.mergeRestored(restoredAttentions);
    await this.attentionQueue?.flush();
  }
  private async restoreTaskProcessContext(
    claimed: TaskProcessCommand,
    processContext: TaskProcessAdapterContext,
  ): Promise<ResolvedTaskContext> {
    const record = processContext.lifecycle.record;
    const launch = processContext.launchConfiguration as
      (Partial<ResolvedTaskContext> & { roveTaskId?: string }) | null;
    if (!record || !launch || typeof launch.roveTaskId !== "string")
      throw new Error("Ledger lacks frozen task reconstruction state.");
    const restoredSessionId = launch.roveSessionId ?? record.identity.sessionId;
    const restoredThreadId = launch.codexThreadId ?? record.identity.threadId;
    const restoredBrowser = launch.browserIdentity ?? record.identity.browser;
    const restoredBootstrap = launch.bootstrap ?? {
      attemptId: record.bootstrap.operationId,
      threadSource: record.bootstrap.threadSource,
      stage: record.bootstrap.stage,
    };
    if (contractIdentity(launch.roveTaskId, "task") !== record.identity.taskId)
      throw new Error(
        "Frozen task identity does not match the lifecycle ledger.",
      );
    if (!restoredBrowser || !record.identity.browser)
      throw new Error(
        "Legacy lifecycle restoration requires its historical browser binding.",
      );
    if (
      restoredBrowser.mode !== record.identity.browser.mode ||
      (restoredBrowser.mode === "workspace" &&
        (record.identity.browser.mode !== "workspace" ||
          contractIdentity(restoredBrowser.workspaceId, "workspace") !==
            record.identity.browser.workspaceId))
    )
      throw new Error(
        "Frozen browser identity does not match the lifecycle ledger.",
      );
    if (
      record.identity.sessionId !== undefined &&
      (!restoredSessionId ||
        contractIdentity(restoredSessionId, "session") !==
          record.identity.sessionId)
    )
      throw new Error(
        "Frozen Runtime session does not match the lifecycle ledger.",
      );
    if (
      record.identity.threadId !== undefined &&
      restoredThreadId !== record.identity.threadId
    )
      throw new Error(
        "Frozen Codex thread does not match the lifecycle ledger.",
      );
    if (
      contractIdentity(restoredBootstrap.attemptId, "bootstrap") !==
        record.bootstrap.operationId ||
      `rove:${record.identity.taskId}:${record.bootstrap.operationId}` !==
        record.bootstrap.threadSource
    )
      throw new Error(
        "Frozen bootstrap identity does not match the lifecycle ledger.",
      );
    const existing =
      this.authority.get(launch.roveTaskId) ??
      Object.values(this.authority.snapshot()).find(
        (candidate) =>
          contractIdentity(candidate.roveTaskId, "task") === claimed.taskId,
      );
    let codexSessionId =
      typeof processContext.durableData.codexSessionId === "string"
        ? processContext.durableData.codexSessionId
        : existing?.codexSessionId;
    let restoredThread: CodexThread | undefined;
    const existingConversation = record.identity.threadId
      ? await this.conversationStore?.projection(record.identity.threadId)
      : undefined;
    if (
      record.identity.threadId &&
      (!codexSessionId || !existingConversation)
    ) {
      const listed = await Promise.all([
        this.conversations.listThreads({ limit: 100, archived: false }),
        this.conversations.listThreads({ limit: 100, archived: true }),
      ]).catch(() => []);
      restoredThread = listed
        .flatMap((page) => page.data)
        .find((candidate) => candidate.id === record.identity.threadId);
      codexSessionId = restoredThread?.sessionId ?? codexSessionId;
    }
    const capabilityFingerprint = restoredSessionId
      ? this.capabilities.issue({
          taskId: launch.roveTaskId,
          sessionId: restoredSessionId,
          executionMode: launch.executionMode!,
          browserIdentity: restoredBrowser,
        }).fingerprint
      : undefined;
    const close = record.closeOperation;
    const rebuilt = validateTaskContext({
      roveTaskId: launch.roveTaskId,
      executionMode: launch.executionMode,
      browserIdentity: restoredBrowser,
      selectionSource: launch.selectionSource,
      selectedAt: launch.selectedAt,
      policy: launch.policy,
      bootstrap: {
        attemptId: restoredBootstrap.attemptId,
        threadSource: restoredBootstrap.threadSource,
        stage: record.bootstrap.stage,
      },
      ...(restoredSessionId ? { roveSessionId: restoredSessionId } : {}),
      ...(restoredThreadId ? { codexThreadId: restoredThreadId } : {}),
      ...(codexSessionId ? { codexSessionId } : {}),
      ...(capabilityFingerprint ? { capabilityFingerprint } : {}),
      ...(launch.attachmentIds ? { attachmentIds: launch.attachmentIds } : {}),
      ...(launch.initialLaunch ? { initialLaunch: launch.initialLaunch } : {}),
      lifecycle: {
        schemaVersion: 1,
        desiredState: record.desiredState,
        ...(close
          ? {
              closeOperation: {
                operationId: close.operationId,
                requestedAt: close.requestedAt,
                stage: close.stage,
                ...(close.lastAttemptAt
                  ? { lastAttemptAt: close.lastAttemptAt }
                  : {}),
                ...(close.boundedFailure
                  ? { boundedFailure: close.boundedFailure }
                  : {}),
              },
            }
          : {}),
      },
    });
    if (existing) this.authority.replace(existing.roveTaskId, rebuilt);
    else this.authority.resolve(rebuilt);
    if (
      restoredThread &&
      record.identity.sessionId &&
      codexSessionId &&
      record.identity.threadId
    ) {
      await this.conversationStore?.bind({
        roveTaskId: launch.roveTaskId,
        codexThreadId: record.identity.threadId,
        codexSessionId,
        roveSessionId: record.identity.sessionId,
        turnStatus: "unknown",
        archived: false,
        lastEventSequence: 0,
        items: {},
        turnOrder: [],
      });
      await this.conversationStore?.reconcile(restoredThread);
    }
    const continuation = processContext.durableData.continuation;
    if (continuation && this.continuations) {
      const { schemaVersion, ...portable } = continuation;
      void schemaVersion;
      await this.continuations.register(portable);
    }
    await this.persistContexts();
    return rebuilt;
  }

  async startTurn(intent: TurnIntent) {
    this.validateTurnIntent(intent, false);
    const context = this.requireCompleteTask(intent.taskId);
    if (this.taskProcessDriver) {
      await this.lifecycleDecisionForTask(context, {
        type: "message",
        taskId: intent.taskId,
        operationId: intent.clientIntentId,
        message: intent.text,
      });
      await this.taskProcessDriver.runUntilIdle(intent.taskId);
      const result = this.startedTurnResults.get(intent.clientIntentId);
      this.startedTurnResults.delete(intent.clientIntentId);
      if (!result) throw new Error("Codex start-turn receipt is unavailable.");
      return result;
    }
    return this.conversations.startTurn({
      threadId: context.codexThreadId,
      clientUserMessageId: intent.clientIntentId,
      input: this.userText(intent.text),
    });
  }
  async steerTurn(intent: SteerIntent) {
    this.validateTurnIntent(intent, true);
    const context = this.requireCompleteTask(intent.taskId);
    if (this.taskProcessDriver) {
      await this.lifecycleDecisionForTask(context, {
        type: "message",
        taskId: intent.taskId,
        operationId: intent.clientIntentId,
        message: intent.text,
        expectedTurnId: intent.expectedTurnId,
      });
      await this.taskProcessDriver.runUntilIdle(intent.taskId);
      const result = this.steeredTurnResults.get(intent.clientIntentId);
      this.steeredTurnResults.delete(intent.clientIntentId);
      if (!result) throw new Error("Codex steer-turn receipt is unavailable.");
      return result;
    }
    const truth = await this.readThreadHistoryAware(
      context.codexThreadId,
      true,
    );
    const active = truth.fullTurns
      ? truth.thread.turns.find((turn) => turn.status === "inProgress")?.id
      : await this.projectedActiveTurnId(context.codexThreadId);
    if (active !== intent.expectedTurnId)
      throw new Error("Stale active-turn intent.");
    return this.conversations.steerTurn({
      threadId: context.codexThreadId,
      expectedTurnId: active,
      clientUserMessageId: intent.clientIntentId,
      input: this.userText(intent.text),
    });
  }
  async interruptTurn(taskId: string): Promise<void> {
    const context = this.requireCompleteTask(taskId);
    if (this.taskProcessDriver) {
      await this.lifecycleDecisionForTask(context, {
        type: "interrupt",
        taskId,
      });
      await this.taskProcessDriver.runUntilIdle(taskId);
      return;
    }
    const truth = await this.readThreadHistoryAware(
      context.codexThreadId,
      true,
    );
    const active = truth.fullTurns
      ? truth.thread.turns.find((turn) => turn.status === "inProgress")?.id
      : await this.projectedActiveTurnId(context.codexThreadId);
    if (!active) throw new Error("Task has no active Codex turn.");
    await this.conversations.interruptTurn(context.codexThreadId, active);
  }

  async respondAttention(input: {
    requestId: string;
    taskId: string;
    threadId?: string;
    turnId?: string;
    itemId?: string;
    generation: number;
    result: unknown;
  }): Promise<void> {
    const context = this.requireCompleteTask(input.taskId);
    if (input.threadId && input.threadId !== context.codexThreadId)
      throw new Error("Attention response changed the bound thread identity.");
    if (!this.taskProcessDriver)
      throw new Error("Durable task process driver is unavailable.");
    await this.lifecycleDecisionForTask(context, {
      type: "respond_attention",
      taskId: input.taskId,
      operationId: `intent_${randomUUID()}`,
      requestId: input.requestId,
      generation: input.generation,
      response: input.result,
    });
    await this.taskProcessDriver.runUntilIdle(input.taskId);
  }

  async observeTaskLifecycle(taskId: string): Promise<void> {
    if (!this.taskProcessDriver) return;
    const context = this.authority.get(taskId);
    if (!context) throw new Error("Observed lifecycle task is not bound.");
    await this.lifecycleDecisionForTask(context, { type: "observe", taskId });
    await this.taskProcessDriver.runUntilIdle(taskId);
  }
  async readTaskProjection(taskId: string) {
    const context = this.requireCompleteTask(taskId);
    const read = await this.readThreadHistoryAware(context.codexThreadId, true);
    const thread = read.thread;
    if (thread.sessionId !== context.codexSessionId)
      throw new Error("Codex thread session identity changed.");
    if (read.fullTurns) {
      await this.reconcileCompletedHandoffs(context, thread);
      await this.conversationStore?.reconcile(thread);
    }
    return this.conversationStore?.projection(thread.id);
  }

  private async reconcileCompletedHandoffs(
    context: Required<ResolvedTaskContext>,
    thread: CodexThread,
  ): Promise<void> {
    for (const turn of thread.turns)
      for (const item of turn.items)
        await this.registerCompletedHandoff(
          context.codexThreadId,
          turn.id,
          item,
        );
  }

  private async registerCompletedHandoff(
    threadId: string,
    turnId: string,
    rawItem: Record<string, unknown> | CodexThreadItem,
  ): Promise<boolean> {
    if (!this.continuations || !this.runtime.getControlStatus) return false;
    const item = rawItem as Record<string, unknown>;
    const normalized = normalizeCompletedRequestHumanToolItem(item);
    if (!normalized) return false;
    const context = this.authority.findByThread(threadId);
    if (!context || context.bootstrap.stage !== "complete")
      throw new Error("Completed handoff tool call is not task-bound.");
    const sessionId = boundedIdentity(
      normalized.sessionId,
      "request-human session",
      /^ses_[A-Za-z0-9][A-Za-z0-9_-]*$/,
    );
    if (sessionId !== context.roveSessionId)
      throw new Error("Completed handoff tool call changed session identity.");
    const policy = normalized.continuationPolicy;
    const result = normalized.returnedControlStatus;
    if (result.sessionId !== sessionId)
      throw new Error(
        "Completed handoff tool call lacks trusted Runtime result.",
      );
    const originatingCodexTurnId = boundedOpaqueIdentity(
      turnId,
      "request-human turn",
    );
    const handoffId = boundedIdentity(
      result.handoffId,
      "request-human handoff",
      /^handoff_[A-Za-z0-9][A-Za-z0-9_-]*$/,
    );
    const requestedInstruction = requiredString(
      normalized.instruction,
      "continuation instruction",
    );
    if (
      (await this.continuations.observationIdentityStatus({
        roveTaskId: context.roveTaskId,
        codexThreadId: threadId,
        originatingCodexTurnId,
        roveSessionId: sessionId,
        handoffId,
        handoffGeneration: result.generation,
        requestedInstruction,
        continuationPolicy: policy,
      })) === "known"
    )
      return true;
    const control = await this.runtime.getControlStatus(sessionId);
    const preHandoffObservationSeq = authoritativePreHandoffObservationSeq({
      result: {
        handoffId: result.handoffId,
        generation: result.generation,
        ...(result.observationSeq === undefined
          ? {}
          : { observationSeq: result.observationSeq }),
      },
      runtime: control,
    });
    const record: PendingContinuation = {
      roveTaskId: context.roveTaskId,
      codexThreadId: threadId,
      originatingCodexTurnId,
      roveSessionId: sessionId,
      handoffId,
      handoffGeneration: result.generation,
      requestedInstruction,
      continuationPolicy: policy,
      status: "pending",
      freshInspectionRequired: true,
      preHandoffObservationSeq,
    };
    if (this.taskProcessDriver) {
      await this.lifecycleDecisionForTask(
        context,
        { type: "observe", taskId: context.roveTaskId },
        true,
        record,
      );
      const inserted = await this.continuations.register(record);
      if (inserted) await this.continuationRegistered?.(record);
      await this.taskProcessDriver.runUntilIdle(context.roveTaskId);
      return true;
    }
    if ((await this.continuations.observationStatus(record)) === "known")
      return true;
    const inserted = await this.continuations.register(record);
    if (inserted) await this.continuationRegistered?.(record);
    return true;
  }
  async archiveTaskThread(taskId: string): Promise<void> {
    const context = this.requireCompleteTask(taskId);
    const projection = await this.conversationStore?.projection(
      context.codexThreadId,
    );
    if (projection?.archived) return;
    if (this.taskProcessDriver) {
      await this.lifecycleDecisionForTask(context, {
        type: "archive",
        taskId,
        operationId: `intent_${randomUUID()}`,
      });
      await this.taskProcessDriver.runUntilIdle(taskId);
      return;
    }
    await this.conversations.archiveThread(context.codexThreadId);
  }
  async unarchiveTaskThread(taskId: string) {
    const context = this.requireCompleteTask(taskId);
    if (this.taskProcessDriver) {
      await this.lifecycleDecisionForTask(context, {
        type: "observe",
        taskId,
      });
      await this.taskProcessDriver.runUntilIdle(taskId);
      const thread = (
        await this.readThreadHistoryAware(context.codexThreadId, false)
      ).thread;
      await this.conversationStore?.reconcile(thread);
      return this.conversationStore?.projection(thread.id);
    }
    const thread = (
      await this.conversations.unarchiveThread(context.codexThreadId)
    ).thread;
    if (thread.sessionId !== context.codexSessionId)
      throw new Error("Codex thread session identity changed.");
    await this.conversationStore?.reconcile(thread);
    return this.conversationStore?.projection(thread.id);
  }
  async returnControlFromRuntime(
    taskId: string,
  ): Promise<"dispatched" | "pending" | "ignored"> {
    const existing = this.continuationReturnLocks.get(taskId);
    if (existing) return existing;
    const operation = this.returnControlFromRuntimeUnlocked(taskId).finally(
      () => {
        if (this.continuationReturnLocks.get(taskId) === operation)
          this.continuationReturnLocks.delete(taskId);
      },
    );
    this.continuationReturnLocks.set(taskId, operation);
    return operation;
  }
  private async returnControlFromRuntimeUnlocked(
    taskId: string,
  ): Promise<"dispatched" | "pending" | "ignored"> {
    if (
      !this.continuations ||
      !this.runtime.getControlStatus ||
      !this.runtime.inspect
    )
      throw new Error("Durable continuation authority is unavailable.");
    const candidate = this.authority.get(taskId);
    if (
      !candidate ||
      candidate.bootstrap.stage !== "complete" ||
      !candidate.roveSessionId ||
      !candidate.codexThreadId ||
      !candidate.codexSessionId ||
      !candidate.capabilityFingerprint
    )
      return "ignored";
    const context = candidate as Required<ResolvedTaskContext>;
    const pending = await this.continuations.pendingForTask(taskId);
    if (!pending) return "ignored";
    if (
      pending.roveSessionId !== context.roveSessionId ||
      pending.codexThreadId !== context.codexThreadId
    )
      return "ignored";
    if (pending.continuationPolicy === "explicit_user_response")
      return "ignored";
    if (this.taskProcessDriver) {
      await this.lifecycleDecisionForTask(context, {
        type: "observe",
        taskId,
      });
      await this.taskProcessDriver.runUntilIdle(taskId);
      return (await this.continuations.pendingForTask(taskId)) === undefined
        ? "dispatched"
        : "pending";
    }
    if (pending.continuationCommand !== undefined) {
      const thread = (
        await this.readThreadHistoryAware(context.codexThreadId, true)
      ).thread;
      await this.continuations.reconcile(pending, thread);
      return "pending";
    }
    if (pending.returnEventId !== undefined) {
      const thread = (
        await this.readThreadHistoryAware(context.codexThreadId, true)
      ).thread;
      return this.continuations.dispatchReturn(
        {
          roveTaskId: pending.roveTaskId,
          codexThreadId: pending.codexThreadId,
          originatingCodexTurnId: pending.originatingCodexTurnId,
          roveSessionId: pending.roveSessionId,
          handoffGeneration: pending.handoffGeneration,
          ...(pending.handoffId === undefined
            ? {}
            : { handoffId: pending.handoffId }),
          eventId: pending.returnEventId,
          ...(pending.returnObservationSeq === undefined
            ? {}
            : { observationSeq: pending.returnObservationSeq }),
        },
        thread,
        false,
        this.rpc,
      );
    }
    const control = await this.runtime.getControlStatus(context.roveSessionId);
    if (control.controller !== "agent" || control.status !== "active")
      return "ignored";
    const exactReturnedHandoff =
      pending.handoffId === undefined
        ? control.lastReturnedHandoffId === undefined &&
          control.generation === pending.handoffGeneration + 1
        : control.lastReturnedHandoffId === pending.handoffId;
    if (!exactReturnedHandoff) return "ignored";
    if (
      pending.freshInspection !== undefined &&
      control.observationSeq !== undefined &&
      control.observationSeq >= pending.freshInspection.afterObservationSeq
    ) {
      const thread = (
        await this.readThreadHistoryAware(context.codexThreadId, true)
      ).thread;
      return this.continuations.dispatchReturn(
        {
          roveTaskId: pending.roveTaskId,
          codexThreadId: pending.codexThreadId,
          originatingCodexTurnId: pending.originatingCodexTurnId,
          roveSessionId: pending.roveSessionId,
          handoffGeneration: pending.handoffGeneration,
          handoffId: pending.freshInspection.handoffId,
          eventId: `runtime:return:${context.roveSessionId}:${pending.handoffId}`,
          observationSeq: pending.freshInspection.afterObservationSeq,
        },
        thread,
        false,
        this.rpc,
      );
    }
    await this.runtime.inspect(context.roveSessionId);
    const inspectedControl = await this.runtime.getControlStatus(
      context.roveSessionId,
    );
    if (
      inspectedControl.controller !== "agent" ||
      inspectedControl.status !== "active" ||
      inspectedControl.lastReturnedHandoffId !==
        control.lastReturnedHandoffId ||
      inspectedControl.observationSeq === undefined ||
      inspectedControl.observationSeq <=
        (pending.preHandoffObservationSeq ?? -1)
    )
      throw new Error(
        "Fresh post-return Runtime inspection was not confirmed.",
      );
    if (pending.handoffId !== undefined)
      await this.continuations.recordFreshInspection(pending, {
        inspectionId: `inspect:${context.roveSessionId}:${pending.handoffGeneration}:${inspectedControl.observationSeq}`,
        sessionId: context.roveSessionId,
        handoffId: pending.handoffId,
        generation: pending.handoffGeneration,
        afterObservationSeq: inspectedControl.observationSeq,
      });
    const thread = (
      await this.readThreadHistoryAware(context.codexThreadId, true)
    ).thread;
    return this.continuations.dispatchReturn(
      {
        roveTaskId: pending.roveTaskId,
        codexThreadId: pending.codexThreadId,
        originatingCodexTurnId: pending.originatingCodexTurnId,
        roveSessionId: pending.roveSessionId,
        handoffGeneration: pending.handoffGeneration,
        ...(pending.handoffId === undefined
          ? {}
          : { handoffId: pending.handoffId }),
        eventId: `runtime:return:${context.roveSessionId}:${pending.handoffId}`,
        observationSeq: inspectedControl.observationSeq,
      },
      thread,
      true,
      this.rpc,
    );
  }
  async reconcileContinuationFromTruth(taskId: string): Promise<boolean> {
    if (!this.continuations)
      throw new Error("Durable continuation store is unavailable.");
    const context = this.requireCompleteTask(taskId);
    if (this.taskProcessDriver) {
      const before = await this.continuations.pendingForTask(taskId);
      if (!before) return false;
      await this.lifecycleDecisionForTask(context, {
        type: "observe",
        taskId,
      });
      await this.taskProcessDriver.runUntilIdle(taskId);
      return (await this.continuations.pendingForTask(taskId)) === undefined;
    }
    const pending = await this.continuations.pendingForTask(taskId);
    if (!pending) return false;
    const thread = (
      await this.readThreadHistoryAware(context.codexThreadId, true)
    ).thread;
    return this.continuations.reconcile(pending, thread);
  }
  async cancelContinuation(
    identity: Parameters<DurableContinuationStore["cancel"]>[0],
    status?: "cancelled" | "superseded",
  ): Promise<void> {
    if (!this.continuations)
      throw new Error("Durable continuation store is unavailable.");
    if (this.taskProcessDriver) {
      const pending = await this.continuations.pendingForTask(
        identity.roveTaskId,
      );
      if (
        !pending ||
        pending.roveTaskId !== identity.roveTaskId ||
        pending.codexThreadId !== identity.codexThreadId ||
        pending.originatingCodexTurnId !== identity.originatingCodexTurnId ||
        pending.roveSessionId !== identity.roveSessionId ||
        pending.handoffId !== identity.handoffId ||
        pending.handoffGeneration !== identity.handoffGeneration
      )
        throw new Error("Continuation identity does not match pending state.");
      const cancelled: PendingContinuation = {
        ...pending,
        status: status ?? "cancelled",
      };
      const context = this.requireCompleteTask(identity.roveTaskId);
      await this.lifecycleDecisionForTask(
        context,
        { type: "observe", taskId: identity.roveTaskId },
        true,
        cancelled,
      );
      await this.continuations.cancel(identity, status);
      await this.taskProcessDriver.runUntilIdle(identity.roveTaskId);
      return;
    }
    await this.continuations.cancel(identity, status);
  }
  async acknowledgeExplicitResponse(taskId: string): Promise<boolean> {
    if (!this.continuations) return false;
    const pending = await this.continuations.pendingForTask(taskId);
    if (!pending || pending.continuationPolicy !== "explicit_user_response")
      return false;
    await this.cancelContinuation(pending, "superseded");
    return true;
  }
  private requireCompleteTask(taskId: string): Required<ResolvedTaskContext> {
    const context = this.authority.get(taskId);
    if (
      !context ||
      context.bootstrap.stage !== "complete" ||
      !context.roveSessionId ||
      !context.codexThreadId ||
      !context.codexSessionId ||
      !context.capabilityFingerprint
    )
      throw new Error("Task is not completely bound.");
    return context as Required<ResolvedTaskContext>;
  }
  private validateStartInput(input: StartTaskInput): void {
    if (!isRecord(input)) throw new Error("Invalid task start intent.");
    exactKeys(
      input,
      [
        "roveTaskId",
        "executionMode",
        "browserIdentity",
        "selectionSource",
        "cwd",
        "approvalsReviewer",
        "model",
        "reasoningEffort",
        "attachmentIds",
        "initialLaunch",
      ],
      "task start intent",
    );
    nonempty(input.roveTaskId, "task id");
    nonempty(input.cwd, "cwd");
    if (
      input.attachmentIds !== undefined &&
      (!Array.isArray(input.attachmentIds) ||
        input.attachmentIds.length > 100 ||
        new Set(input.attachmentIds).size !== input.attachmentIds.length ||
        input.attachmentIds.some(
          (id) => typeof id !== "string" || !/^att_[a-f0-9]{32}$/.test(id),
        ))
    )
      throw new Error("Invalid task attachment identities.");
    if (
      input.approvalsReviewer !== "auto_review" &&
      input.approvalsReviewer !== "user"
    )
      throw new Error("Invalid task approvals reviewer.");
    if (input.initialLaunch !== undefined)
      parseInitialLaunch(input.initialLaunch);
  }
  private validateLaunchInput(input: LaunchTaskInput): void {
    if (!isRecord(input)) throw new Error("Invalid initial launch intent.");
    exactKeys(
      input,
      [
        "operationId",
        "outcome",
        "executionMode",
        "browserIdentity",
        "selectionSource",
        "cwd",
        "approvalsReviewer",
        "model",
        "reasoningEffort",
        "attachmentIds",
      ],
      "initial launch intent",
    );
    boundedIdentity(
      input.operationId,
      "initial launch operation identity",
      /^intent_[a-f0-9-]{36}$/,
    );
    requiredString(input.outcome, "initial launch outcome");
    this.validateStartInput({
      roveTaskId: "task_00000000-0000-4000-a000-000000000000",
      executionMode: input.executionMode,
      browserIdentity: input.browserIdentity,
      selectionSource: input.selectionSource,
      cwd: input.cwd,
      approvalsReviewer: input.approvalsReviewer,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: input.reasoningEffort }),
      ...(input.attachmentIds === undefined
        ? {}
        : { attachmentIds: input.attachmentIds }),
    });
  }
  private assertApprovalsReviewer(
    context: ResolvedTaskContext,
    actual: JsonValue,
  ): void {
    if (actual !== context.policy.approvalsReviewer)
      throw new Error(
        "App Server retained a conflicting or unsupported approvals reviewer.",
      );
  }
  private validateTurnIntent(
    intent: TurnIntent | SteerIntent,
    steer: boolean,
  ): void {
    if (!isRecord(intent)) throw new Error("Invalid turn intent.");
    exactKeys(
      intent,
      steer
        ? ["taskId", "text", "clientIntentId", "expectedTurnId"]
        : ["taskId", "text", "clientIntentId"],
      "turn intent",
    );
    for (const key of ["taskId", "text", "clientIntentId"] as const)
      nonempty(intent[key], key);
    if (steer)
      nonempty((intent as SteerIntent).expectedTurnId, "expected turn id");
  }
  private userText(text: string): UserInput[] {
    return [{ type: "text", text, text_elements: [] }];
  }
  private async updateContext(
    current: ResolvedTaskContext,
    patch: Partial<ResolvedTaskContext>,
  ): Promise<ResolvedTaskContext> {
    const next = this.authority.replace(current.roveTaskId, {
      ...current,
      ...patch,
    });
    await this.persistContexts();
    return next;
  }
  private async bindRecoveredThread(
    context: ResolvedTaskContext,
    thread: CodexThread,
  ): Promise<ResolvedTaskContext> {
    if (thread.threadSource !== context.bootstrap.threadSource)
      throw new Error("Recovered Codex thread source changed.");
    return this.updateContext(context, {
      codexThreadId: thread.id,
      codexSessionId: thread.sessionId,
    });
  }
  private async runtimeInventory(
    context: ResolvedTaskContext,
  ): Promise<RuntimeSessionInventory[]> {
    if (this.runtime.listSessionInventory) {
      const all = await this.runtime.listSessionInventory();
      return all.filter((entry) =>
        context.roveSessionId
          ? entry.session.id === context.roveSessionId
          : entry.session.bootstrapId === context.bootstrap.attemptId,
      );
    }
    if (!context.roveSessionId || !this.runtime.getSession) return [];
    const session = await this.runtime.getSession(context.roveSessionId);
    return [
      {
        schemaVersion: 1,
        session,
        browserIdentity:
          session.workspace === undefined
            ? { mode: "temporary" }
            : { mode: "workspace", workspaceId: session.workspace.id },
        attachment: "attached",
        recovery: "not_needed",
        profileOwnership:
          session.workspace === undefined ? "released" : "owned",
      },
    ];
  }
  private async lifecycleDecisionForTask(
    context: ResolvedTaskContext,
    requestedOperation: NativeLifecycleInput["requestedOperation"],
    persist = true,
    continuationOverride?: PendingContinuation,
  ): Promise<{
    output: NativeLifecycleOutput;
    commandId: string | null;
    record: NativeLifecycleInput["record"];
    lifecycleInput: NativeLifecycleInput;
  }> {
    if (!this.runtime.listSessionInventory)
      throw new Error(
        "Durable lifecycle requires authoritative Runtime inventory support.",
      );
    let unboundThread: CodexThread | undefined;
    if (context.codexThreadId && this.conversationStore) {
      try {
        const read = await this.readThreadHistoryAware(
          context.codexThreadId,
          true,
          context,
        );
        await this.conversationStore.reconcile(read.thread);
      } catch (error) {
        if (!(await this.settleNotLoadedThreadForClose(context, error)))
          throw error;
      }
    } else if (!context.codexThreadId) {
      const listed = await Promise.all([
        this.conversations.listThreads({ limit: 100, archived: false }),
        this.conversations.listThreads({ limit: 100, archived: true }),
      ]);
      const matches = [
        ...new Map(
          listed
            .flatMap((page) => page.data)
            .filter(
              (thread) =>
                thread.threadSource === context.bootstrap.threadSource,
            )
            .map((thread) => [thread.id, thread]),
        ).values(),
      ];
      if (matches.length > 1)
        throw new Error("Codex thread-source lookup is conflicting.");
      unboundThread = matches[0];
    }
    const inventory = await this.runtimeInventory(context);
    if (inventory.length > 1)
      throw new Error("Runtime lifecycle identity lookup is conflicting.");
    const conversation =
      context.codexThreadId === undefined || !this.conversationStore
        ? undefined
        : await this.conversationStore.projection(context.codexThreadId);
    const continuation =
      continuationOverride ??
      (await this.continuations?.latestForTask(context.roveTaskId));
    const control =
      inventory[0] && this.runtime.getControlStatus
        ? await this.runtime
            .getControlStatus(inventory[0].session.id)
            .catch(() => undefined)
        : undefined;
    const decision = await this.lifecycleProjection(
      context,
      conversation,
      this.codexAvailable(),
      inventory[0],
      true,
      continuation,
      control,
      this.attentionQueue
        ?.list()
        .filter((entry) => entry.taskId === context.roveTaskId) ?? [],
      requestedOperation,
      unboundThread === undefined
        ? undefined
        : {
            availability: "available",
            threadExists: true,
            threadId: unboundThread.id,
            threadSource: context.bootstrap.threadSource,
            sourceLookup: "exact",
            runtimeStatus:
              unboundThread.status.type === "notLoaded" ? "notLoaded" : "idle",
            archived: false,
            turn: "none",
          },
      unboundThread === undefined && context.codexThreadId === undefined,
      persist,
    );
    return {
      output: decision.output,
      commandId: decision.commandId,
      record: decision.record,
      lifecycleInput: decision.lifecycleInput,
    };
  }
  private async syncLedgerLifecycleRecord(
    context: ResolvedTaskContext,
    record: NativeLifecycleInput["record"],
  ): Promise<ResolvedTaskContext> {
    if (!record) return context;
    const close = record.closeOperation;
    const lifecycle: TaskLifecycleState = {
      schemaVersion: 1,
      desiredState: record.desiredState,
      ...(close === undefined
        ? {}
        : {
            closeOperation: {
              operationId: close.operationId,
              requestedAt: close.requestedAt,
              stage: close.stage,
              ...(close.lastAttemptAt === undefined
                ? {}
                : { lastAttemptAt: close.lastAttemptAt }),
              ...(close.boundedFailure === undefined
                ? {}
                : { boundedFailure: close.boundedFailure }),
            },
          }),
    };
    if (JSON.stringify(context.lifecycle) === JSON.stringify(lifecycle))
      return context;
    return this.updateContext(context, { lifecycle });
  }
  private async lifecycleProjection(
    context: ResolvedTaskContext,
    conversation: ConversationAssociation | undefined,
    codexAvailable: boolean,
    inventory: RuntimeSessionInventory | undefined,
    runtimeAvailable: boolean,
    continuation: PendingContinuation | undefined,
    control: ControlStatus | undefined,
    attentions: readonly AttentionRequest[],
    requestedOperation?: NativeLifecycleInput["requestedOperation"],
    codexTruthOverride?: NativeCodexTruth,
    unboundCodexAbsent = false,
    persist = true,
  ): Promise<{
    projection: Pick<
      ProductTaskSnapshot,
      "lifecycle" | "availableActions" | "capabilities" | "runtime"
    >;
    output: NativeLifecycleOutput;
    commandId: string | null;
    record: NativeLifecycleInput["record"];
    lifecycleInput: NativeLifecycleInput;
  }> {
    const runtime =
      inventory === undefined
        ? undefined
        : {
            status: inventory.session.status,
            controller: inventory.session.controller,
            attachment: inventory.attachment,
            recovery: inventory.recovery,
            profileOwnership: inventory.profileOwnership,
            legacyEffects: inventory.legacyEffects ?? "not_applicable",
            ...(inventory.diagnostic === undefined
              ? {}
              : { diagnostic: inventory.diagnostic.slice(0, 240) }),
          };
    const lifecycle = context.lifecycle ?? {
      schemaVersion: 1 as const,
      desiredState: "open" as const,
    };
    const taskId = contractIdentity(context.roveTaskId, "task");
    const sessionId = context.roveSessionId
      ? contractIdentity(context.roveSessionId, "session")
      : undefined;
    const threadId = context.codexThreadId;
    const bootstrapId = contractIdentity(
      context.bootstrap.attemptId,
      "bootstrap",
    );
    const browserIdentity: NativeBrowserIdentity =
      context.browserIdentity.mode === "temporary"
        ? { mode: "temporary" }
        : {
            mode: "workspace",
            workspaceId: contractIdentity(
              context.browserIdentity.workspaceId,
              "workspace",
            ),
          };
    const turn =
      conversation?.turnStatus === "in_progress"
        ? "active"
        : conversation?.turnStatus === "completed"
          ? "completed"
          : conversation?.turnStatus === "failed"
            ? "failed"
            : conversation?.turnStatus === "interrupted"
              ? "interrupted"
              : "unknown";
    const authoritativelyClosed =
      lifecycle.desiredState === "closed" &&
      lifecycle.closeOperation?.stage === "complete";
    const authoritativelyClosedWithoutThread =
      authoritativelyClosed && threadId === undefined;
    const contractContinuation: NativeContinuationTruth =
      continuation === undefined
        ? { status: "none" }
        : {
            id: `continuation:${taskId}:${continuation.handoffGeneration}`,
            status: continuation.status,
            taskId,
            sessionId: sessionId!,
            threadId: threadId!,
            handoffId: contractIdentity(
              continuation.handoffId ??
                `legacy:${continuation.handoffGeneration}`,
              "handoff",
            ),
            generation: continuation.handoffGeneration,
            policy: continuation.continuationPolicy,
            freshInspectionRequired:
              continuation.returnEventId === undefined
                ? true
                : continuation.freshInspectionRequired,
            preHandoffObservationSeq:
              continuation.preHandoffObservationSeq ?? 0,
            ...(continuation.returnEventId === undefined ||
            continuation.returnObservationSeq === undefined
              ? {}
              : {
                  returnEventId: continuation.returnEventId,
                  returnObservationSeq: continuation.returnObservationSeq,
                }),
            ...(continuation.continuationCommand === undefined
              ? {}
              : {
                  command: {
                    commandId: continuation.continuationCommand.commandId,
                    returnEventId:
                      continuation.continuationCommand.returnEventId,
                    kind: continuation.continuationCommand.kind,
                    dispatchStatus:
                      continuation.continuationCommand.dispatchStatus,
                  },
                }),
          };
    const lifecycleInput: NativeLifecycleInput = {
      record: {
        schemaVersion: 1,
        identity: {
          taskId,
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(threadId === undefined ? {} : { threadId }),
          browser: browserIdentity,
        },
        bootstrap: {
          operationId: bootstrapId,
          threadSource: `rove:${taskId}:${bootstrapId}`,
          stage: lifecycleBootstrapStage(context.bootstrap.stage),
        },
        desiredState: lifecycle.desiredState,
        ...(lifecycle.closeOperation === undefined
          ? {}
          : {
              closeOperation: {
                operationId: lifecycle.closeOperation.operationId,
                requestedAt: canonicalTimestamp(
                  lifecycle.closeOperation.requestedAt,
                ),
                stage: lifecycleCloseStage(lifecycle.closeOperation.stage),
                ...(lifecycle.closeOperation.lastAttemptAt === undefined
                  ? {}
                  : {
                      lastAttemptAt: canonicalTimestamp(
                        lifecycle.closeOperation.lastAttemptAt,
                      ),
                    }),
                ...(lifecycle.closeOperation.boundedFailure === undefined
                  ? {}
                  : {
                      boundedFailure:
                        lifecycle.closeOperation.boundedFailure.slice(0, 240),
                    }),
              },
            }),
      },
      codex:
        codexTruthOverride ??
        (authoritativelyClosedWithoutThread
          ? {
              availability: "available",
              threadExists: false,
              sourceLookup: "none",
              runtimeStatus: "notLoaded",
              archived: null,
              turn: "none",
            }
          : conversation === undefined && unboundCodexAbsent
            ? {
                availability: "available",
                threadExists: false,
                sourceLookup: "none",
                runtimeStatus: "notLoaded",
                archived: null,
                turn: "none",
              }
            : !codexAvailable ||
                (conversation === undefined && !unboundCodexAbsent)
              ? {
                  availability: "unavailable",
                  threadExists: false,
                  sourceLookup: "unknown",
                  runtimeStatus: "unknown",
                  archived: null,
                  turn: "unknown",
                }
              : {
                  availability: "available",
                  threadExists: true,
                  threadId: threadId!,
                  threadSource: `rove:${taskId}:${bootstrapId}`,
                  sourceLookup: "exact",
                  runtimeStatus:
                    turn === "active"
                      ? "active"
                      : turn === "unknown"
                        ? "unknown"
                        : "idle",
                  archived: conversation!.archived,
                  turn,
                  ...(turn === "active"
                    ? {
                        turnId: conversation!.activeTurnId!,
                      }
                    : {}),
                }),
      runtime:
        authoritativelyClosed && inventory === undefined
          ? {
              availability: "available",
              sessionExists: false,
              bootstrapLookup: "none",
              status: "missing",
              controller: null,
              attachment: "missing",
              profileLock: "released",
              recovery: "cleanup_required",
            }
          : !runtimeAvailable
            ? {
                availability: "unavailable",
                sessionExists: false,
                bootstrapLookup: "unknown",
                status: "unknown",
                controller: null,
                attachment: "unknown",
                profileLock: "unknown",
                recovery: "unknown",
              }
            : inventory === undefined
              ? {
                  availability: "available",
                  sessionExists: false,
                  bootstrapLookup: "none",
                  status: "missing",
                  controller: null,
                  attachment:
                    context.roveSessionId === undefined
                      ? "missing"
                      : "conflicting",
                  profileLock:
                    context.roveSessionId === undefined
                      ? "released"
                      : "conflicting",
                  recovery: "cleanup_required",
                }
              : {
                  availability: "available",
                  sessionExists: true,
                  sessionId: sessionId!,
                  bootstrapId,
                  bootstrapLookup: "exact",
                  status: inventory.session.status,
                  controller: inventory.session.controller,
                  attachment: inventory.attachment,
                  profileLock: inventory.profileOwnership,
                  browserIdentity,
                  recovery: inventory.recovery,
                  ...(inventory.session.ownershipGeneration === undefined
                    ? {}
                    : {
                        ownershipGeneration:
                          inventory.session.ownershipGeneration,
                      }),
                  ...(inventory.session.activeHandoffId === undefined ||
                  !(
                    inventory.session.status === "awaiting_human" ||
                    (inventory.session.status === "active" &&
                      inventory.session.controller === "human")
                  )
                    ? {}
                    : {
                        handoffId: contractIdentity(
                          inventory.session.activeHandoffId,
                          "handoff",
                        ),
                        ...(inventory.session.activeHandoffGeneration ===
                        undefined
                          ? {}
                          : {
                              handoffGeneration:
                                inventory.session.activeHandoffGeneration,
                            }),
                      }),
                  ...(inventory.session.lastReturnedHandoffId === undefined
                    ? {}
                    : {
                        lastReturnedHandoffId: contractIdentity(
                          inventory.session.lastReturnedHandoffId,
                          "handoff",
                        ),
                      }),
                  ...(control?.observationSeq === undefined
                    ? {}
                    : { observationSeq: control.observationSeq }),
                },
      continuation: contractContinuation,
      attentions: attentions
        .filter(() => threadId !== undefined)
        .map((entry) => ({
          authority: entry.authority,
          kind: entry.kind,
          requestId: entry.requestId,
          taskId,
          ...(entry.authority === "rove_control" && sessionId
            ? {
                sessionId,
                handoffId: contractIdentity(
                  continuation?.handoffId ??
                    (typeof entry.payload.handoffId === "string"
                      ? entry.payload.handoffId
                      : (entry.requestId.split(":").at(-1) ??
                        `legacy:${entry.generation}`)),
                  "handoff",
                ),
              }
            : {}),
          threadId: threadId!,
          ...(entry.turnId === undefined ? {} : { turnId: entry.turnId }),
          generation: entry.generation,
          status: entry.status,
        })),
      freshInspection:
        continuation?.freshInspection === undefined
          ? null
          : {
              inspectionId: continuation.freshInspection.inspectionId,
              sessionId: sessionId!,
              handoffId: contractIdentity(
                continuation.freshInspection.handoffId,
                "handoff",
              ),
              generation: continuation.freshInspection.generation,
              afterObservationSeq:
                continuation.freshInspection.afterObservationSeq,
            },
      requestedOperation:
        requestedOperation === undefined
          ? { type: "observe", taskId }
          : {
              ...requestedOperation,
              ...(requestedOperation.taskId === undefined ? {} : { taskId }),
            },
    };
    const output = reduceProductionTaskLifecycle(lifecycleInput);
    const durable = persist
      ? await this.onLifecycleDecision?.(
          lifecycleInput,
          output,
          {
            roveTaskId: context.roveTaskId,
            executionMode: context.executionMode,
            browserIdentity: context.browserIdentity,
            selectionSource: context.selectionSource,
            selectedAt: context.selectedAt,
            policy: context.policy,
            attachmentIds: context.attachmentIds ?? [],
            ...(context.initialLaunch === undefined
              ? {}
              : { initialLaunch: context.initialLaunch }),
          },
          durableLifecycleData(
            context.roveTaskId,
            continuation,
            attentions,
            context.codexSessionId,
          ),
        )
      : undefined;
    const authoritativeOutput = durable?.output ?? output;
    const reason =
      authoritativeOutput.allowedActions.includes("return_control") &&
      inventory?.session.handoff?.reason
        ? inventory.session.handoff.reason
        : (authoritativeOutput.attention?.message ??
          (authoritativeOutput.nextCommand === null
            ? `Lifecycle is ${authoritativeOutput.phase}.`
            : `Lifecycle requires ${authoritativeOutput.nextCommand.type.replaceAll("_", " ")}.`));
    return {
      output: authoritativeOutput,
      commandId: durable?.commandId ?? null,
      record: durable?.record ?? lifecycleInput.record,
      lifecycleInput,
      projection: {
        lifecycle: {
          phase: authoritativeOutput.phase,
          reason: reason.slice(0, 240),
        },
        availableActions: [
          ...(authoritativeOutput.allowedActions.filter((action) =>
            [
              "message",
              "interrupt",
              "return_control",
              "resume",
              "finish",
              "retry_cleanup",
              "archive",
            ].includes(action),
          ) as ProductLifecycleAction[]),
          ...(runtime?.legacyEffects === "acknowledgement_required"
            ? (["acknowledge_legacy_effects"] as const)
            : []),
        ],
        capabilities: customerTaskCapabilities({
          canSubmit:
            authoritativeOutput.allowedActions.includes("message") &&
            conversation?.turnStatus !== "in_progress" &&
            authoritativeOutput.phase !== "recovering",
          canQueue: false,
          canSteer: false,
          canStop:
            context.executionMode !== "capture" &&
            (authoritativeOutput.allowedActions.includes("interrupt") ||
              (context.initialLaunch !== undefined &&
                context.initialLaunch.stage !== "turn_started")),
          canRespond:
            authoritativeOutput.phase !== "recovering" &&
            attentions.some(
              (attention) =>
                attention.authority === "codex" &&
                [
                  "pending",
                  "responding",
                  "awaiting_confirmation",
                  "resolution_unknown",
                ].includes(attention.status),
            ),
          canTakeControl: false,
          canReturnToRove:
            authoritativeOutput.allowedActions.includes("return_control"),
          canRetry:
            authoritativeOutput.allowedActions.includes("retry_cleanup"),
          canArchive: authoritativeOutput.allowedActions.includes("archive"),
        }),
        ...(runtime === undefined ? {} : { runtime }),
      },
    };
  }
  private async advanceCloseStage(
    context: ResolvedTaskContext,
    stage: TaskCloseOperation["stage"],
  ): Promise<ResolvedTaskContext> {
    const close = context.lifecycle?.closeOperation;
    if (!close) throw new Error("Close operation is missing.");
    const updated = await this.updateContext(context, {
      lifecycle: {
        schemaVersion: 1,
        desiredState: "closed",
        closeOperation: {
          ...close,
          stage,
          lastAttemptAt: this.now(),
        },
      },
    });
    await this.onCloseStagePersisted?.(context.roveTaskId, stage);
    return updated;
  }
  private recordConvergence(
    context: ResolvedTaskContext,
    phase: ProductLifecyclePhase,
    reason: string,
  ): Promise<ResolvedTaskContext> {
    return this.updateContext(context, {
      lifecycle: {
        ...(context.lifecycle ?? {
          schemaVersion: 1 as const,
          desiredState: "open" as const,
        }),
        lastConvergence: {
          at: this.now(),
          phase,
          reason: reason.slice(0, 240),
        },
      },
    });
  }
  private async persistContexts(): Promise<void> {
    if (!this.contextRepository) return;
    const current = await this.contextRepository.read();
    const next = prepareTaskContextState({
      contexts: this.authority.snapshot(),
    });
    await this.contextRepository.write(current?.revision ?? 0, next);
  }
  private assertModelSelection(model?: string, effort?: string): void {
    if (effort && !model)
      throw new Error(
        "A reasoning effort requires an explicit model selection.",
      );
    if (!model) return;
    const selected = this.models().find(
      (entry) => entry.id === model || entry.model === model,
    );
    if (!selected)
      throw new Error("Selected Codex model is unavailable or hidden.");
    if (effort && !selected.efforts.includes(effort))
      throw new Error("Selected reasoning effort is unsupported by the model.");
  }
  private mcpConfig(
    context: ResolvedTaskContext,
    capability: string,
  ): Record<string, JsonValue | undefined> {
    if (!context.roveSessionId) throw new Error("Task session is unbound.");
    return {
      mcp_servers: {
        rove: {
          command: this.mcpLaunch.command,
          args: [...this.mcpLaunch.args],
          env: {
            ...this.mcpLaunch.environment,
            ROVE_TASK_ID: context.roveTaskId,
            ROVE_TASK_SESSION_ID: context.roveSessionId,
            ROVE_TASK_CAPABILITY: capability,
            ROVE_TASK_CAPABILITY_VERIFIER: this.capabilities.verifier(),
            ROVE_TASK_EXECUTION_MODE: context.executionMode,
            ROVE_TASK_BROWSER_IDENTITY: JSON.stringify(context.browserIdentity),
          },
          enabled: true,
          required: true,
          startup_timeout_sec: 15,
        },
      },
      web_search: "disabled",
      browser_use: {
        allow_history_access: false,
        default_origin_policy: {
          access: "deny",
          downloads: "deny",
          uploads: "deny",
          full_cdp_access: "deny",
        },
        origins: {},
      },
      computer_use: { default_app_access: "deny" },
    };
  }
}
