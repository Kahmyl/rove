/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- this is the reviewed executable lifecycle authority. The
// experiment entry point re-exports this file directly, and production parity
// tests assert function identity so the two paths cannot drift.
/* global structuredClone */

export interface NativeLifecycleOutput {
  taskId: string | null;
  phase:
    | "starting"
    | "ready"
    | "working"
    | "waiting_for_human"
    | "recovering"
    | "cleanup_required"
    | "closing"
    | "closed"
    | "failed";
  allowedActions: Array<
    | "message"
    | "interrupt"
    | "return_control"
    | "resume"
    | "finish"
    | "retry_cleanup"
    | "archive"
  >;
  nextCommand: ({ type: string } & Record<string, unknown>) | null;
  confirmation: ({ type: string } & Record<string, unknown>) | null;
  attention: { code: string; message: string } | null;
  operationDisposition: {
    type: string;
    operationId: string | null;
    status: "accepted" | "deferred-for-convergence" | "rejected";
    reason: string;
  };
}

const PHASES = [
  "starting",
  "ready",
  "working",
  "waiting_for_human",
  "recovering",
  "cleanup_required",
  "closing",
  "closed",
  "failed",
];
const OPERATIONS = [
  "observe",
  "launch",
  "finish",
  "retry_cleanup",
  "message",
  "interrupt",
  "return_control",
  "respond_attention",
  "resume",
  "archive",
];
const COMMANDS = [
  "persist_bootstrap_intent",
  "lookup_or_start_runtime",
  "bind_runtime_identity",
  "lookup_or_start_codex_thread",
  "prepare_codex_reassociation",
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
];
const COMPONENT_COMMANDS = new Set([
  "lookup_or_start_runtime",
  "lookup_or_start_codex_thread",
  "interrupt_codex_turn",
  "settle_continuation_attention",
  "end_runtime_session",
  "relaunch_named_browser",
  "resume_codex_thread",
  "unarchive_codex_thread",
  "recover_codex_thread",
  "inspect_after_return",
  "dispatch_or_reconcile_continuation",
  "reconcile_continuation_dispatch",
  "reconcile_attention_response",
  "respond_continuation_explicit",
  "start_or_steer_codex_turn",
  "return_runtime_ownership",
  "respond_codex_attention",
  "archive_codex_thread",
]);
const ACTIVE_ATTENTION = new Set([
  "pending",
  "responding",
  "awaiting_confirmation",
  "resolution_unknown",
]);
const TERMINAL_CONTINUATION = new Set([
  "none",
  "consumed",
  "cancelled",
  "superseded",
]);
const MESSAGE_CHARACTERS = 16_000;
const OUTPUT_CHARACTERS = 32_768;
const TERMINAL_RUNTIME = new Set(["completed", "failed"]);
const PATTERNS = Object.freeze({
  task: /^task_[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  session: /^ses_[a-f0-9]{32}$/,
  handoff: /^handoff_[a-f0-9]{32}$/,
  workspace:
    /^wrk_[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  bootstrap: /^boot_[a-f0-9]{32}$/,
  operation:
    /^intent_[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  request: /^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/,
  appServer: /^[\s\S]{1,256}$/,
  local: /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/,
});

function object(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new Error(`${label} has unknown field ${key}.`);
  return value;
}
function id(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value))
    throw new Error(`${label} is invalid.`);
}
function choice(value, choices, label) {
  if (!choices.includes(value)) throw new Error(`${label} is invalid.`);
}
function timestamp(value, label) {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new Error(`${label} must be a calendar-valid canonical timestamp.`);
}
function browser(value, label) {
  object(value, ["mode", "workspaceId"], label);
  choice(value.mode, ["workspace", "temporary"], `${label} mode`);
  if (value.mode === "workspace")
    id(value.workspaceId, `${label} workspace id`, PATTERNS.workspace);
  else if (value.workspaceId !== undefined)
    throw new Error(`${label} Temporary identity cannot carry a workspace id.`);
}
function sameBrowser(left, right) {
  return (
    left?.mode === right?.mode &&
    (left?.mode !== "workspace" || left.workspaceId === right.workspaceId)
  );
}

function validateRecord(record) {
  if (record === null) return;
  object(
    record,
    [
      "schemaVersion",
      "identity",
      "bootstrap",
      "desiredState",
      "closeOperation",
      "lastAttemptAt",
      "boundedFailure",
      "lastConvergence",
    ],
    "task record",
  );
  if (record.schemaVersion !== 1)
    throw new Error("Task record schema version is invalid.");
  const identity = object(
    record.identity,
    ["taskId", "sessionId", "threadId", "browser"],
    "task identity",
  );
  id(identity.taskId, "task id", PATTERNS.task);
  if (identity.sessionId !== undefined)
    id(identity.sessionId, "session id", PATTERNS.session);
  if (identity.threadId !== undefined)
    id(identity.threadId, "thread id", PATTERNS.appServer);
  if (identity.browser !== undefined)
    browser(identity.browser, "attached browser identity");
  const bootstrap = object(
    record.bootstrap,
    ["operationId", "threadSource", "stage"],
    "bootstrap workflow",
  );
  id(bootstrap.operationId, "bootstrap operation id", PATTERNS.bootstrap);
  if (
    bootstrap.threadSource !==
    `rove:${identity.taskId}:${bootstrap.operationId}`
  )
    throw new Error("Bootstrap thread source does not match task and attempt.");
  choice(
    bootstrap.stage,
    [
      "intent_persisted",
      "runtime_dispatching",
      "runtime_bound",
      "thread_dispatching",
      "complete",
    ],
    "bootstrap stage",
  );
  const sessionRequired = bootstrap.stage === "runtime_bound";
  const threadBound = bootstrap.stage === "complete";
  if (sessionRequired && identity.sessionId === undefined)
    throw new Error("Bootstrap stage and Runtime identity binding disagree.");
  if (
    ["intent_persisted", "runtime_dispatching"].includes(bootstrap.stage) &&
    identity.sessionId !== undefined
  )
    throw new Error("Bootstrap stage and Runtime identity binding disagree.");
  if (threadBound !== (identity.threadId !== undefined))
    throw new Error("Bootstrap stage and Codex identity binding disagree.");
  choice(record.desiredState, ["open", "closed"], "desired state");
  if (record.desiredState === "closed" && !record.closeOperation)
    throw new Error("Closed desired state requires a close operation.");
  if (record.desiredState === "open" && record.closeOperation !== undefined)
    throw new Error("Open desired state cannot carry a close operation.");
  if (record.closeOperation) {
    const close = object(
      record.closeOperation,
      [
        "operationId",
        "requestedAt",
        "stage",
        "lastAttemptAt",
        "boundedFailure",
      ],
      "close operation",
    );
    id(close.operationId, "close operation id", PATTERNS.operation);
    timestamp(close.requestedAt, "close requestedAt");
    choice(
      close.stage,
      [
        "requested",
        "codex_settled",
        "continuation_settled",
        "runtime_settled",
        "complete",
      ],
      "close stage",
    );
    if (close.lastAttemptAt !== undefined)
      timestamp(close.lastAttemptAt, "close lastAttemptAt");
    if (
      close.boundedFailure !== undefined &&
      (typeof close.boundedFailure !== "string" ||
        close.boundedFailure.length > 240)
    )
      throw new Error("Close failure is invalid.");
  }
  if (record.lastAttemptAt !== undefined)
    timestamp(record.lastAttemptAt, "record lastAttemptAt");
  if (
    record.boundedFailure !== undefined &&
    (typeof record.boundedFailure !== "string" ||
      record.boundedFailure.length > 240)
  )
    throw new Error("Record failure is invalid.");
  if (record.lastConvergence !== undefined) {
    const convergence = object(
      record.lastConvergence,
      ["at", "phase", "commandType", "operationId"],
      "last convergence",
    );
    timestamp(convergence.at, "last convergence timestamp");
    choice(convergence.phase, PHASES, "last convergence phase");
    if (convergence.commandType !== null)
      choice(convergence.commandType, COMMANDS, "last convergence command");
    if (convergence.operationId !== undefined)
      id(
        convergence.operationId,
        "last convergence operation id",
        PATTERNS.operation,
      );
  }
}

function validateCodex(value) {
  object(
    value,
    [
      "availability",
      "threadExists",
      "threadId",
      "threadSource",
      "sourceLookup",
      "runtimeStatus",
      "archived",
      "turn",
      "turnId",
    ],
    "Codex truth",
  );
  choice(
    value.availability,
    ["available", "unavailable"],
    "Codex availability",
  );
  if (typeof value.threadExists !== "boolean")
    throw new Error("Codex thread existence is invalid.");
  choice(
    value.turn,
    ["none", "active", "completed", "failed", "interrupted", "unknown"],
    "Codex turn",
  );
  choice(
    value.runtimeStatus,
    ["notLoaded", "idle", "active", "systemError", "unknown"],
    "Codex thread runtime status",
  );
  choice(
    value.sourceLookup,
    ["none", "exact", "conflicting", "unknown"],
    "Codex thread-source lookup",
  );
  if (typeof value.archived !== "boolean" && value.archived !== null)
    throw new Error("Codex archived truth is invalid.");
  if (value.threadExists) {
    id(value.threadId, "Codex thread id", PATTERNS.appServer);
    if (
      typeof value.threadSource !== "string" ||
      value.threadSource.length > 300
    )
      throw new Error("Codex thread source is invalid.");
    if (typeof value.archived !== "boolean")
      throw new Error("Existing Codex thread requires archived truth.");
  } else if (value.threadId !== undefined)
    throw new Error("Missing Codex thread cannot carry an id.");
  if (value.turn === "active")
    id(value.turnId, "active Codex turn id", PATTERNS.appServer);
  else if (value.turnId !== undefined)
    throw new Error("Non-active Codex truth cannot carry a turn id.");
  if (
    value.availability === "unavailable" &&
    (value.threadExists ||
      value.turn !== "unknown" ||
      value.runtimeStatus !== "unknown" ||
      value.sourceLookup !== "unknown" ||
      value.archived !== null ||
      value.threadSource !== undefined)
  )
    throw new Error("Unavailable Codex truth cannot claim component state.");
  if (
    value.availability === "available" &&
    !value.threadExists &&
    (value.turn !== "none" ||
      value.runtimeStatus !== "notLoaded" ||
      !["none", "conflicting"].includes(value.sourceLookup) ||
      value.archived !== null ||
      value.threadSource !== undefined)
  )
    throw new Error("Missing Codex thread must have no turn.");
  if (
    value.threadExists &&
    (value.runtimeStatus === "active") !== (value.turn === "active")
  )
    throw new Error("Codex active runtime and turn truth disagree.");
  if (value.threadExists && value.sourceLookup !== "exact")
    throw new Error(
      "Existing Codex thread requires one exact source lookup match.",
    );
}

function validateRuntime(value) {
  object(
    value,
    [
      "availability",
      "sessionExists",
      "sessionId",
      "bootstrapId",
      "bootstrapLookup",
      "status",
      "controller",
      "attachment",
      "profileLock",
      "browserIdentity",
      "recovery",
      "legacyEffects",
      "ownershipGeneration",
      "handoffId",
      "handoffGeneration",
      "lastReturnedHandoffId",
      "observationSeq",
    ],
    "Runtime truth",
  );
  choice(
    value.availability,
    ["available", "unavailable"],
    "Runtime availability",
  );
  if (typeof value.sessionExists !== "boolean")
    throw new Error("Runtime session existence is invalid.");
  choice(
    value.status,
    [
      "missing",
      "starting",
      "active",
      "paused",
      "awaiting_human",
      "completed",
      "failed",
      "unknown",
    ],
    "Runtime status",
  );
  choice(
    value.attachment,
    ["attached", "missing", "conflicting", "unknown"],
    "Runtime attachment",
  );
  choice(
    value.profileLock,
    ["owned", "released", "claimable", "conflicting", "unknown"],
    "Runtime profile ownership",
  );
  choice(
    value.recovery,
    [
      "not_needed",
      "relaunchable",
      "cleanup_required",
      "unrecoverable",
      "unknown",
    ],
    "Runtime recovery classification",
  );
  if (value.legacyEffects !== undefined)
    choice(
      value.legacyEffects,
      ["not_applicable", "acknowledgement_required", "acknowledged"],
      "Runtime legacy-effect status",
    );
  choice(
    value.bootstrapLookup,
    ["none", "exact", "conflicting", "unknown"],
    "Runtime bootstrap lookup",
  );
  if (![null, "agent", "human"].includes(value.controller))
    throw new Error("Runtime controller is invalid.");
  if (value.availability === "unavailable") {
    if (
      value.sessionExists ||
      value.status !== "unknown" ||
      value.attachment !== "unknown" ||
      value.profileLock !== "unknown" ||
      value.recovery !== "unknown" ||
      value.sessionId !== undefined ||
      value.bootstrapId !== undefined ||
      value.bootstrapLookup !== "unknown" ||
      value.browserIdentity !== undefined ||
      value.controller !== null ||
      value.ownershipGeneration !== undefined ||
      value.handoffId !== undefined ||
      value.handoffGeneration !== undefined ||
      value.lastReturnedHandoffId !== undefined ||
      value.observationSeq !== undefined ||
      value.legacyEffects !== undefined
    )
      throw new Error(
        "Unavailable Runtime truth cannot claim component state.",
      );
    return;
  }
  if (!value.sessionExists) {
    if (
      value.sessionId !== undefined ||
      value.status !== "missing" ||
      value.controller !== null ||
      value.browserIdentity !== undefined ||
      value.ownershipGeneration !== undefined ||
      value.handoffId !== undefined ||
      value.handoffGeneration !== undefined ||
      value.bootstrapId !== undefined ||
      !["none", "conflicting"].includes(value.bootstrapLookup) ||
      value.lastReturnedHandoffId !== undefined ||
      value.observationSeq !== undefined ||
      value.legacyEffects !== undefined
    )
      throw new Error("Missing Runtime session carries contradictory state.");
    if (
      !["missing", "conflicting"].includes(value.attachment) ||
      !["released", "conflicting"].includes(value.profileLock) ||
      !["cleanup_required", "unrecoverable"].includes(value.recovery)
    )
      throw new Error("Missing Runtime session has invalid recovery facts.");
    return;
  }
  id(value.sessionId, "Runtime session id", PATTERNS.session);
  id(value.bootstrapId, "Runtime bootstrap id", PATTERNS.bootstrap);
  if (value.bootstrapLookup !== "exact")
    throw new Error(
      "Existing Runtime session requires one exact bootstrap lookup match.",
    );
  browser(value.browserIdentity, "Runtime browser identity");
  if (["missing", "unknown"].includes(value.status))
    throw new Error("Existing Runtime session has invalid status.");
  if (
    (TERMINAL_RUNTIME.has(value.status) || value.status === "paused") &&
    value.controller !== null
  )
    throw new Error(
      "Terminal or paused Runtime session cannot have a controller.",
    );
  if (value.controller === "human" && value.status !== "active")
    throw new Error("Human Runtime ownership requires active status.");
  if (value.status === "awaiting_human" && value.controller !== null)
    throw new Error("Awaiting-human Runtime state cannot have a controller.");
  if (value.recovery === "relaunchable") {
    if (
      value.browserIdentity.mode !== "workspace" ||
      TERMINAL_RUNTIME.has(value.status) ||
      value.attachment !== "missing" ||
      !["released", "claimable"].includes(value.profileLock)
    )
      throw new Error(
        "Relaunchable Runtime classification lacks exact authority.",
      );
  }
  if (value.attachment === "attached" && value.recovery !== "not_needed")
    throw new Error(
      "Attached Runtime state has contradictory recovery classification.",
    );
  if (
    value.ownershipGeneration !== undefined &&
    (!Number.isInteger(value.ownershipGeneration) ||
      value.ownershipGeneration <= 0)
  )
    throw new Error("Runtime ownership generation is invalid.");
  if (value.handoffId !== undefined) {
    id(value.handoffId, "Runtime handoff id", PATTERNS.handoff);
    if (
      !Number.isInteger(value.handoffGeneration) ||
      value.handoffGeneration <= 0
    )
      throw new Error("Runtime handoff generation is invalid.");
    if (value.ownershipGeneration === undefined)
      throw new Error(
        "Runtime active handoff requires an ownership generation.",
      );
    const awaitingExact =
      value.status === "awaiting_human" &&
      value.controller === null &&
      value.ownershipGeneration === value.handoffGeneration;
    const humanExact =
      value.status === "active" &&
      value.controller === "human" &&
      value.ownershipGeneration === value.handoffGeneration + 1;
    if (!awaitingExact && !humanExact)
      throw new Error(
        "Runtime active handoff has an invalid ownership-generation transition.",
      );
  } else if (value.handoffGeneration !== undefined)
    throw new Error("Runtime handoff generation requires a handoff id.");
  if (value.lastReturnedHandoffId !== undefined)
    id(
      value.lastReturnedHandoffId,
      "last returned handoff id",
      PATTERNS.handoff,
    );
  if (
    value.observationSeq !== undefined &&
    (!Number.isInteger(value.observationSeq) || value.observationSeq < 0)
  )
    throw new Error("Runtime observation sequence is invalid.");
}

function validateContinuation(value) {
  object(
    value,
    [
      "id",
      "status",
      "taskId",
      "sessionId",
      "threadId",
      "handoffId",
      "generation",
      "policy",
      "freshInspectionRequired",
      "preHandoffObservationSeq",
      "returnEventId",
      "returnObservationSeq",
      "command",
    ],
    "continuation truth",
  );
  choice(
    value.status,
    ["none", "pending", "consumed", "cancelled", "superseded"],
    "continuation status",
  );
  const identity = [
    "id",
    "taskId",
    "sessionId",
    "threadId",
    "handoffId",
    "generation",
    "policy",
    "freshInspectionRequired",
    "preHandoffObservationSeq",
    "returnEventId",
    "returnObservationSeq",
    "command",
  ];
  if (value.status === "none") {
    if (identity.some((field) => value[field] !== undefined))
      throw new Error("Absent continuation cannot carry identity.");
    return;
  }
  for (const [field, label] of [
    ["id", "continuation id"],
    ["taskId", "continuation task id"],
    ["sessionId", "continuation session id"],
    ["threadId", "continuation thread id"],
    ["handoffId", "continuation handoff id"],
  ])
    id(
      value[field],
      label,
      field === "sessionId"
        ? PATTERNS.session
        : field === "threadId"
          ? PATTERNS.appServer
          : field === "handoffId"
            ? PATTERNS.handoff
            : PATTERNS.local,
    );
  if (!Number.isInteger(value.generation) || value.generation <= 0)
    throw new Error("Continuation generation is invalid.");
  choice(
    value.policy,
    ["resume_after_control_return", "explicit_user_response"],
    "continuation policy",
  );
  if (typeof value.freshInspectionRequired !== "boolean")
    throw new Error("Continuation inspection requirement is invalid.");
  if (
    !Number.isInteger(value.preHandoffObservationSeq) ||
    value.preHandoffObservationSeq < 0
  )
    throw new Error("Continuation pre-handoff sequence is invalid.");
  if (value.returnEventId !== undefined)
    id(value.returnEventId, "return event id", PATTERNS.request);
  if (
    value.returnObservationSeq !== undefined &&
    (!Number.isInteger(value.returnObservationSeq) ||
      value.returnObservationSeq <= value.preHandoffObservationSeq)
  )
    throw new Error("Return observation sequence is stale.");
  if (
    (value.returnEventId === undefined) !==
    (value.returnObservationSeq === undefined)
  )
    throw new Error(
      "Return event identity and sequence must be recorded together.",
    );
  if (value.returnEventId !== undefined && value.freshInspectionRequired)
    throw new Error(
      "Recorded return event requires completed fresh inspection.",
    );
  if (value.command !== undefined) {
    const command = object(
      value.command,
      ["commandId", "returnEventId", "kind", "dispatchStatus"],
      "continuation command",
    );
    id(command.commandId, "continuation command id", PATTERNS.request);
    id(
      command.returnEventId,
      "continuation command return event",
      PATTERNS.request,
    );
    choice(
      command.kind,
      ["turn/start", "turn/steer"],
      "continuation command kind",
    );
    choice(
      command.dispatchStatus,
      ["not_started", "possibly_started", "terminal", "resolution_unknown"],
      "continuation dispatch status",
    );
    if (command.returnEventId !== value.returnEventId)
      throw new Error("Continuation command has mismatched return identity.");
  }
  if (
    value.status === "consumed" &&
    (value.freshInspectionRequired ||
      value.returnEventId === undefined ||
      (value.policy === "resume_after_control_return" &&
        value.command?.dispatchStatus !== "terminal"))
  )
    throw new Error("Consumed continuation requires a terminal exact receipt.");
  if (
    value.status === "pending" &&
    value.command?.dispatchStatus === "terminal"
  )
    throw new Error("Pending continuation cannot carry a terminal command.");
  if (
    ["cancelled", "superseded"].includes(value.status) &&
    value.command?.dispatchStatus === "not_started"
  )
    throw new Error(
      "Cancelled continuation cannot retain a dispatchable command.",
    );
}

function validateFreshInspection(value) {
  if (value === null) return;
  object(
    value,
    [
      "inspectionId",
      "sessionId",
      "handoffId",
      "generation",
      "afterObservationSeq",
    ],
    "fresh inspection proof",
  );
  id(value.inspectionId, "inspection id", PATTERNS.request);
  id(value.sessionId, "inspection session id", PATTERNS.session);
  id(value.handoffId, "inspection handoff id", PATTERNS.handoff);
  if (!Number.isInteger(value.generation) || value.generation <= 0)
    throw new Error("Inspection generation is invalid.");
  if (
    !Number.isInteger(value.afterObservationSeq) ||
    value.afterObservationSeq < 0
  )
    throw new Error("Inspection observation sequence is invalid.");
}

function validateAttentions(values) {
  if (!Array.isArray(values) || values.length > 32)
    throw new Error("Attention collection is invalid or exceeds its bound.");
  const seen = new Set();
  for (const value of values) {
    object(
      value,
      [
        "authority",
        "kind",
        "requestId",
        "method",
        "wireRequestId",
        "responseFields",
        "taskId",
        "sessionId",
        "threadId",
        "turnId",
        "itemId",
        "handoffId",
        "generation",
        "status",
      ],
      "attention truth",
    );
    choice(value.authority, ["codex", "rove_control"], "attention authority");
    choice(
      value.kind,
      [
        "command_approval",
        "file_approval",
        "network_approval",
        "permission_approval",
        "mcp_elicitation",
        "user_input",
        "control_handoff",
      ],
      "attention kind",
    );
    choice(
      value.status,
      [
        "pending",
        "responding",
        "awaiting_confirmation",
        "resolution_unknown",
        "resolved",
        "cancelled",
        "stale",
      ],
      "attention status",
    );
    id(
      value.requestId,
      "attention request id",
      value.authority === "codex" ? PATTERNS.appServer : PATTERNS.request,
    );
    if (
      value.authority === "codex" &&
      (value.method !== undefined ||
        value.wireRequestId !== undefined ||
        value.responseFields !== undefined)
    ) {
      choice(
        value.method,
        [
          "item/commandExecution/requestApproval",
          "item/fileChange/requestApproval",
          "item/tool/requestUserInput",
          "mcpServer/elicitation/request",
          "item/permissions/requestApproval",
          "applyPatchApproval",
          "execCommandApproval",
        ],
        "attention method",
      );
      if (!(
        (typeof value.wireRequestId === "string" &&
          value.wireRequestId.length > 0 &&
          value.wireRequestId.length <= 256) ||
        (typeof value.wireRequestId === "number" &&
          Number.isSafeInteger(value.wireRequestId))
      ))
        throw new Error("Attention wire request id is invalid.");
      if (
        value.responseFields === null ||
        typeof value.responseFields !== "object" ||
        Array.isArray(value.responseFields) ||
        JSON.stringify(value.responseFields).length > 65_536
      )
        throw new Error("Attention response fields are invalid.");
    } else if (
      value.authority === "rove_control" &&
      (value.method !== undefined ||
        value.wireRequestId !== undefined ||
        value.responseFields !== undefined)
    )
      throw new Error(
        "Rove control attention cannot carry Codex response data.",
      );
    id(value.taskId, "attention task id", PATTERNS.task);
    id(value.threadId, "attention thread id", PATTERNS.appServer);
    if (value.sessionId !== undefined)
      id(value.sessionId, "attention session id", PATTERNS.session);
    if (value.turnId !== undefined)
      id(value.turnId, "attention turn id", PATTERNS.appServer);
    if (value.itemId !== undefined)
      id(value.itemId, "attention item id", PATTERNS.appServer);
    if (!Number.isInteger(value.generation) || value.generation <= 0)
      throw new Error("Attention generation is invalid.");
    if (value.authority === "rove_control") {
      if (value.kind !== "control_handoff")
        throw new Error("Rove control attention must be a handoff.");
      id(value.sessionId, "Rove control session id", PATTERNS.session);
      id(value.handoffId, "Rove control handoff id", PATTERNS.handoff);
    } else if (
      value.kind === "control_handoff" ||
      value.handoffId !== undefined
    )
      throw new Error("Codex attention cannot carry Rove handoff identity.");
    const key = `${value.authority}:${value.requestId}:${value.generation}`;
    if (seen.has(key)) throw new Error("Duplicate attention identity.");
    seen.add(key);
  }
}

function validateOperation(value) {
  object(
    value,
    [
      "type",
      "taskId",
      "operationId",
      "requestId",
      "generation",
      "message",
      "response",
      "expectedTurnId",
      "attachmentIds",
    ],
    "requested operation",
  );
  choice(value.type, OPERATIONS, "requested operation type");
  if (value.taskId !== undefined)
    id(value.taskId, "requested task id", PATTERNS.task);
  if (value.operationId !== undefined)
    id(value.operationId, "requested operation id", PATTERNS.operation);
  if (value.requestId !== undefined)
    id(value.requestId, "requested attention id", PATTERNS.appServer);
  if (
    value.generation !== undefined &&
    (!Number.isInteger(value.generation) || value.generation <= 0)
  )
    throw new Error("Requested attention generation is invalid.");
  if (
    value.message !== undefined &&
    (typeof value.message !== "string" ||
      value.message.length < 1 ||
      value.message.length > MESSAGE_CHARACTERS)
  )
    throw new Error("Requested message is invalid.");
  if (
    value.expectedTurnId !== undefined &&
    (typeof value.expectedTurnId !== "string" ||
      value.expectedTurnId.length < 1)
  )
    throw new Error("Expected turn identity is invalid.");
  if (
    value.attachmentIds !== undefined &&
    (!Array.isArray(value.attachmentIds) ||
      value.attachmentIds.length > 100 ||
      new Set(value.attachmentIds).size !== value.attachmentIds.length ||
      value.attachmentIds.some(
        (attachmentId) =>
          typeof attachmentId !== "string" || attachmentId.length < 1,
      ))
  )
    throw new Error("Requested attachment identities are invalid.");
  if (
    [
      "launch",
      "finish",
      "retry_cleanup",
      "message",
      "return_control",
      "respond_attention",
      "resume",
      "archive",
    ].includes(value.type) &&
    value.operationId === undefined
  )
    throw new Error(`${value.type} requires a stable operation id.`);
  if (value.type === "message" && value.message === undefined)
    throw new Error("Message operation requires bounded text.");
  if (
    value.response !== undefined &&
    JSON.stringify(value.response).length > 65_536
  )
    throw new Error("Attention response exceeds its portable-data bound.");
  if (
    value.type === "respond_attention" &&
    (value.requestId === undefined || value.generation === undefined)
  )
    throw new Error("Attention response requires exact request identity.");
}

function validateInput(input) {
  object(
    input,
    [
      "record",
      "codex",
      "runtime",
      "continuation",
      "attentions",
      "freshInspection",
      "requestedOperation",
    ],
    "lifecycle input",
  );
  validateRecord(input.record);
  validateCodex(input.codex);
  validateRuntime(input.runtime);
  validateContinuation(input.continuation);
  validateFreshInspection(input.freshInspection);
  validateAttentions(input.attentions);
  validateOperation(input.requestedOperation);
  if (
    input.record &&
    input.runtime.sessionExists &&
    input.runtime.bootstrapId !== input.record.bootstrap.operationId
  )
    throw new Error(
      "Runtime bootstrap identity does not match the durable attempt.",
    );
  if (
    input.record &&
    input.codex.threadExists &&
    input.codex.threadSource !== input.record.bootstrap.threadSource
  )
    throw new Error(
      "Codex thread source does not match the durable association.",
    );
  if (
    input.record?.bootstrap.stage === "intent_persisted" &&
    input.runtime.sessionExists
  )
    throw new Error("Runtime receipt exists before durable dispatch intent.");
  if (
    input.record &&
    ["intent_persisted", "runtime_dispatching", "runtime_bound"].includes(
      input.record.bootstrap.stage,
    ) &&
    input.codex.threadExists
  )
    throw new Error(
      "Codex receipt exists before durable thread dispatch intent.",
    );
  if (input.freshInspection !== null) {
    const continuation = input.continuation;
    if (
      continuation.status === "none" ||
      input.freshInspection.sessionId !== continuation.sessionId ||
      input.freshInspection.handoffId !== continuation.handoffId ||
      input.freshInspection.generation !== continuation.generation ||
      input.freshInspection.afterObservationSeq <=
        continuation.preHandoffObservationSeq ||
      !input.runtime.sessionExists ||
      input.runtime.observationSeq === undefined ||
      input.freshInspection.afterObservationSeq > input.runtime.observationSeq
    )
      throw new Error(
        "Fresh inspection proof does not match the continuation.",
      );
  }
  if (
    input.record?.desiredState === "open" &&
    input.record.bootstrap.stage === "complete" &&
    input.continuation.status === "pending" &&
    !["finish", "retry_cleanup"].includes(input.requestedOperation.type) &&
    input.runtime.availability !== "unavailable" &&
    (!input.runtime.sessionExists ||
      !(
        (input.runtime.handoffId === input.continuation.handoffId &&
          input.runtime.handoffGeneration === input.continuation.generation &&
          ((input.runtime.status === "active" &&
            input.runtime.controller === "human") ||
            (input.runtime.status === "awaiting_human" &&
              input.runtime.controller === null))) ||
        (input.runtime.lastReturnedHandoffId === input.continuation.handoffId &&
          input.runtime.controller === "agent" &&
          input.runtime.observationSeq >
            input.continuation.preHandoffObservationSeq)
      ))
  )
    throw new Error(
      "Open pending continuation lacks matching Runtime handoff truth.",
    );
}

function bounded(value, maximum = 240) {
  return String(value).slice(0, maximum);
}
function transition(type, target, confirmation) {
  return { nextCommand: { type, ...target }, confirmation };
}
function output(taskId, phase, actions, reason, next = {}) {
  const value = {
    taskId,
    phase,
    allowedActions: [...new Set(actions)].sort(),
    nextCommand: next.nextCommand ?? null,
    confirmation: next.confirmation ?? null,
    attention: ["cleanup_required", "failed"].includes(phase)
      ? { code: bounded(reason, 80), message: bounded(reason) }
      : null,
  };
  validateOutput(value);
  return value;
}
function validateOutput(value) {
  object(
    value,
    [
      "taskId",
      "phase",
      "allowedActions",
      "nextCommand",
      "confirmation",
      "attention",
    ],
    "lifecycle output",
  );
  id(value.taskId, "output task id", PATTERNS.task);
  choice(value.phase, PHASES, "output phase");
  if (
    !Array.isArray(value.allowedActions) ||
    value.allowedActions.length > OPERATIONS.length
  )
    throw new Error("Output actions are invalid.");
  for (const action of value.allowedActions)
    choice(action, OPERATIONS, "output action");
  if ((value.nextCommand === null) !== (value.confirmation === null))
    throw new Error("Command and confirmation must be emitted together.");
  if (value.nextCommand !== null) {
    choice(value.nextCommand.type, COMMANDS, "command type");
    if (!value.confirmation || typeof value.confirmation.type !== "string")
      throw new Error("Command confirmation is invalid.");
  }
  if (JSON.stringify(value).length > OUTPUT_CHARACTERS)
    throw new Error("Lifecycle output bound exceeded.");
}

function identityProblem(input) {
  if (!input.record) return null;
  const expected = input.record.identity;
  if (
    input.requestedOperation.taskId !== undefined &&
    input.requestedOperation.taskId !== expected.taskId
  )
    return "Requested task identity does not match the durable task.";
  if (
    input.codex.threadExists &&
    expected.threadId !== undefined &&
    input.codex.threadId !== expected.threadId
  )
    return "Codex thread identity does not match the durable task.";
  if (
    input.runtime.sessionExists &&
    expected.sessionId !== undefined &&
    input.runtime.sessionId !== expected.sessionId
  )
    return "Runtime session identity does not match the durable task.";
  if (
    input.runtime.sessionExists &&
    expected.browser !== undefined &&
    !sameBrowser(input.runtime.browserIdentity, expected.browser)
  )
    return "Runtime browser identity does not match the frozen launch identity.";
  if (
    input.continuation.status !== "none" &&
    (input.continuation.taskId !== expected.taskId ||
      input.continuation.sessionId !== expected.sessionId ||
      input.continuation.threadId !== expected.threadId)
  )
    return "Continuation identity does not match the durable task.";
  if (
    input.attentions.some(
      (entry) =>
        entry.taskId !== expected.taskId ||
        entry.threadId !== expected.threadId ||
        (entry.sessionId !== undefined &&
          entry.sessionId !== expected.sessionId),
    )
  )
    return "Attention identity does not match the durable task.";
  return null;
}
function pendingAttentions(input, authority) {
  return input.attentions
    .filter(
      (entry) =>
        entry.authority === authority && ACTIVE_ATTENTION.has(entry.status),
    )
    .sort((a, b) =>
      `${a.requestId}:${a.generation}`.localeCompare(
        `${b.requestId}:${b.generation}`,
      ),
    );
}
function attentionIdentity(entry) {
  return {
    authority: entry.authority,
    kind: entry.kind,
    taskId: entry.taskId,
    sessionId: entry.sessionId ?? null,
    threadId: entry.threadId,
    requestId: entry.requestId,
    generation: entry.generation,
    handoffId: entry.handoffId ?? null,
  };
}
function exactHandoff(input) {
  const { runtime, continuation } = input;
  if (
    !runtime.sessionExists ||
    runtime.controller !== "human" ||
    runtime.status !== "active" ||
    !runtime.handoffId ||
    continuation.status !== "pending" ||
    continuation.handoffId !== runtime.handoffId ||
    continuation.generation !== runtime.handoffGeneration
  )
    return null;
  return (
    pendingAttentions(input, "rove_control").find(
      (entry) =>
        entry.handoffId === runtime.handoffId &&
        entry.generation === runtime.handoffGeneration,
    ) ?? null
  );
}

function requestedCommand(input, actions) {
  const op = input.requestedOperation;
  if (op.type === "observe" || !actions.includes(op.type)) return null;
  const identity = input.record?.identity;
  if (["finish", "retry_cleanup"].includes(op.type))
    return transition(
      "persist_close_intent",
      { taskId: identity.taskId, operationId: op.operationId },
      {
        type: "durable_close_intent",
        taskId: identity.taskId,
        operationId: op.operationId,
        desiredState: "closed",
        stage: "requested",
      },
    );
  if (op.type === "message")
    return transition(
      "start_or_steer_codex_turn",
      {
        taskId: identity.taskId,
        threadId: identity.threadId,
        operationId: op.operationId,
        message: op.message,
        expectedTurnId: op.expectedTurnId,
        attachmentIds: op.attachmentIds,
      },
      {
        type: "codex_turn_receipt",
        taskId: identity.taskId,
        threadId: identity.threadId,
        operationId: op.operationId,
      },
    );
  if (op.type === "interrupt")
    return transition(
      "interrupt_codex_turn",
      {
        taskId: identity.taskId,
        threadId: identity.threadId,
        turnId: input.codex.turnId,
      },
      {
        type: "codex_no_active_turn",
        taskId: identity.taskId,
        threadId: identity.threadId,
        turnId: input.codex.turnId,
      },
    );
  if (op.type === "return_control") {
    const handoff = exactHandoff(input);
    return transition(
      "return_runtime_ownership",
      {
        taskId: identity.taskId,
        sessionId: identity.sessionId,
        threadId: identity.threadId,
        handoffId: handoff.handoffId,
        generation: handoff.generation,
        operationId: op.operationId,
      },
      {
        type: "runtime_ownership_returned",
        taskId: identity.taskId,
        sessionId: identity.sessionId,
        handoffId: handoff.handoffId,
        generation: handoff.generation,
        operationId: op.operationId,
        controller: "agent",
        minimumObservationSeq: input.continuation.preHandoffObservationSeq + 1,
      },
    );
  }
  if (op.type === "respond_attention") {
    const attention = pendingAttentions(input, "codex").find(
      (entry) =>
        entry.requestId === op.requestId && entry.generation === op.generation,
    );
    return transition(
      "respond_codex_attention",
      {
        ...attentionIdentity(attention),
        operationId: op.operationId,
        response: op.response,
      },
      {
        type: "codex_attention_terminal",
        ...attentionIdentity(attention),
        operationId: op.operationId,
      },
    );
  }
  if (op.type === "resume")
    return transition(
      "resume_codex_thread",
      {
        taskId: identity.taskId,
        threadId: identity.threadId,
        operationId: op.operationId,
      },
      {
        type: "codex_thread_loaded",
        taskId: identity.taskId,
        threadId: identity.threadId,
        operationId: op.operationId,
      },
    );
  if (op.type === "archive")
    return transition(
      "archive_codex_thread",
      {
        taskId: identity.taskId,
        threadId: identity.threadId,
        operationId: op.operationId,
      },
      {
        type: "codex_thread_archived",
        taskId: identity.taskId,
        threadId: identity.threadId,
        operationId: op.operationId,
      },
    );
  return null;
}
function retryableCleanup(input, reason) {
  const actions = ["retry_cleanup"];
  const requested = requestedCommand(input, actions);
  return output(
    input.record.identity.taskId,
    requested ? "closing" : "cleanup_required",
    actions,
    reason,
    requested ?? {},
  );
}
function retryableOpenCleanup(input, reason) {
  const actions = ["message", "retry_cleanup"];
  const requested = requestedCommand(input, actions);
  return output(
    input.record.identity.taskId,
    requested ? "closing" : "cleanup_required",
    actions,
    reason,
    requested ?? {},
  );
}

function reduceBootstrap(input) {
  const { record, runtime, codex } = input;
  const identity = record.identity;
  const stage = record.bootstrap.stage;
  if (stage === "intent_persisted")
    return output(
      identity.taskId,
      "starting",
      ["finish"],
      "Codex dispatch intent must be durable before dispatch.",
      transition(
        "advance_bootstrap_stage",
        { taskId: identity.taskId, stage: "thread_dispatching" },
        {
          type: "durable_bootstrap_stage",
          taskId: identity.taskId,
          stage: "thread_dispatching",
        },
      ),
    );
  if (stage === "runtime_dispatching") {
    if (runtime.availability === "unavailable")
      return output(
        identity.taskId,
        "recovering",
        ["finish", "retry_cleanup"],
        "Runtime bootstrap lookup is unavailable.",
        transition(
          "read_runtime_inventory",
          {
            taskId: identity.taskId,
            bootstrapId: record.bootstrap.operationId,
          },
          {
            type: "runtime_bootstrap_lookup",
            taskId: identity.taskId,
            bootstrapId: record.bootstrap.operationId,
          },
        ),
      );
    if (runtime.bootstrapLookup === "conflicting")
      return retryableCleanup(
        input,
        "Runtime bootstrap lookup returned conflicting matches.",
      );
    if (!runtime.sessionExists)
      return output(
        identity.taskId,
        "starting",
        ["finish"],
        "No Runtime receipt is bound for the durable bootstrap key.",
        transition(
          "lookup_or_start_runtime",
          {
            taskId: identity.taskId,
            bootstrapId: record.bootstrap.operationId,
            browserIdentity: identity.browser,
          },
          {
            type: "runtime_bootstrap_receipt",
            taskId: identity.taskId,
            bootstrapId: record.bootstrap.operationId,
            matchCount: 1,
            assignedIdentityPattern: PATTERNS.session.source,
          },
        ),
      );
    return output(
      identity.taskId,
      "starting",
      ["finish"],
      "Runtime receipt must be bound durably.",
      transition(
        "bind_runtime_identity",
        {
          taskId: identity.taskId,
          bootstrapId: record.bootstrap.operationId,
          returnedSessionId: runtime.sessionId,
        },
        {
          type: "durable_runtime_binding",
          taskId: identity.taskId,
          bootstrapId: record.bootstrap.operationId,
          sessionId: runtime.sessionId,
          stage: "runtime_bound",
        },
      ),
    );
  }
  if (stage === "runtime_bound")
    return output(
      identity.taskId,
      "starting",
      ["finish"],
      "Codex dispatch intent must be durable before dispatch.",
      transition(
        "advance_bootstrap_stage",
        { taskId: identity.taskId, stage: "thread_dispatching" },
        {
          type: "durable_bootstrap_stage",
          taskId: identity.taskId,
          stage: "thread_dispatching",
        },
      ),
    );
  if (stage === "thread_dispatching") {
    if (codex.availability === "unavailable")
      return output(
        identity.taskId,
        "recovering",
        ["finish", "retry_cleanup"],
        "App Server thread-source lookup is unavailable.",
        transition(
          "read_codex_thread",
          {
            taskId: identity.taskId,
            threadSource: record.bootstrap.threadSource,
          },
          {
            type: "codex_thread_source_lookup",
            taskId: identity.taskId,
            threadSource: record.bootstrap.threadSource,
          },
        ),
      );
    if (codex.sourceLookup === "conflicting")
      return retryableCleanup(
        input,
        "Codex thread-source lookup returned conflicting matches.",
      );
    if (!codex.threadExists)
      return output(
        identity.taskId,
        "starting",
        ["finish"],
        "No Codex receipt is bound for the durable thread source.",
        transition(
          "lookup_or_start_codex_thread",
          {
            taskId: identity.taskId,
            threadSource: record.bootstrap.threadSource,
            ...(identity.sessionId ? { sessionId: identity.sessionId } : {}),
          },
          {
            type: "codex_thread_source_receipt",
            taskId: identity.taskId,
            threadSource: record.bootstrap.threadSource,
            matchCount: 1,
            assignedIdentityPattern: PATTERNS.appServer.source,
          },
        ),
      );
    return output(
      identity.taskId,
      "starting",
      ["finish"],
      "Codex receipt must be bound durably.",
      transition(
        "bind_codex_identity",
        {
          taskId: identity.taskId,
          threadSource: record.bootstrap.threadSource,
          returnedThreadId: codex.threadId,
        },
        {
          type: "durable_codex_binding",
          taskId: identity.taskId,
          threadSource: record.bootstrap.threadSource,
          threadId: codex.threadId,
          stage: "complete",
        },
      ),
    );
  }
  return output(identity.taskId, "failed", [], "Unknown bootstrap stage.");
}
function runtimeSettled(value) {
  return (
    value.availability === "available" &&
    (!value.sessionExists || TERMINAL_RUNTIME.has(value.status)) &&
    value.attachment === "missing" &&
    value.profileLock === "released"
  );
}

function reduceClose(input) {
  const { record, codex, runtime, continuation } = input;
  const identity = record.identity;
  const close = record.closeOperation;
  const codexTarget = identity.threadId
    ? { taskId: identity.taskId, threadId: identity.threadId }
    : codex.threadExists
      ? { taskId: identity.taskId, threadId: codex.threadId }
      : {
          taskId: identity.taskId,
          threadSource: record.bootstrap.threadSource,
        };
  const runtimeTarget = identity.sessionId
    ? { taskId: identity.taskId, sessionId: identity.sessionId }
    : runtime.sessionExists
      ? { taskId: identity.taskId, sessionId: runtime.sessionId }
      : { taskId: identity.taskId, bootstrapId: record.bootstrap.operationId };
  if (!identity.sessionId && runtime.bootstrapLookup === "conflicting")
    return output(
      identity.taskId,
      "cleanup_required",
      [],
      "Runtime bootstrap lookup is conflicting; cleanup requires operator attention.",
    );
  if (!identity.threadId && codex.sourceLookup === "conflicting")
    return output(
      identity.taskId,
      "cleanup_required",
      [],
      "Codex thread-source lookup is conflicting; cleanup requires operator attention.",
    );
  const pending = [
    ...pendingAttentions(input, "codex"),
    ...pendingAttentions(input, "rove_control"),
  ].sort((a, b) =>
    `${a.authority}:${a.requestId}:${a.generation}`.localeCompare(
      `${b.authority}:${b.requestId}:${b.generation}`,
    ),
  );
  if (codex.availability === "unavailable")
    return output(
      identity.taskId,
      "recovering",
      ["retry_cleanup"],
      "App Server truth is unavailable during close.",
      transition("read_codex_thread", codexTarget, {
        type: "codex_thread_truth",
        ...codexTarget,
      }),
    );
  if (codex.threadExists && codex.turn === "active")
    return output(
      identity.taskId,
      "closing",
      ["retry_cleanup"],
      "Fresh Codex truth has an active turn.",
      transition(
        "interrupt_codex_turn",
        {
          ...codexTarget,
          turnId: codex.turnId,
        },
        {
          type: "codex_no_active_turn",
          ...codexTarget,
          turnId: codex.turnId,
        },
      ),
    );
  if (close.stage === "requested")
    return output(
      identity.taskId,
      "closing",
      ["retry_cleanup"],
      "Codex is settled but the close stage is not recorded.",
      transition(
        "advance_close_stage",
        {
          taskId: identity.taskId,
          operationId: close.operationId,
          stage: "codex_settled",
        },
        {
          type: "durable_close_stage",
          taskId: identity.taskId,
          operationId: close.operationId,
          stage: "codex_settled",
        },
      ),
    );
  const uncertainAttention = pending.find(
    (entry) => entry.status === "resolution_unknown",
  );
  if (uncertainAttention)
    return output(
      identity.taskId,
      "recovering",
      ["retry_cleanup"],
      "Attention outcome is unknown during close.",
      transition(
        "reconcile_attention_response",
        attentionIdentity(uncertainAttention),
        {
          type: "attention_response_receipt",
          ...attentionIdentity(uncertainAttention),
        },
      ),
    );
  if (!TERMINAL_CONTINUATION.has(continuation.status) || pending.length > 0)
    return output(
      identity.taskId,
      "closing",
      ["retry_cleanup"],
      "Continuation or attention is not terminal.",
      transition(
        "settle_continuation_attention",
        {
          taskId: identity.taskId,
          sessionId: identity.sessionId,
          threadId: identity.threadId,
          continuationId: continuation.id ?? null,
          attention: pending.map(attentionIdentity),
        },
        {
          type: "continuation_attention_terminal",
          taskId: identity.taskId,
          sessionId: identity.sessionId,
          threadId: identity.threadId,
          continuationId: continuation.id ?? null,
          attention: pending.map(attentionIdentity),
        },
      ),
    );
  if (close.stage === "codex_settled")
    return output(
      identity.taskId,
      "closing",
      ["retry_cleanup"],
      "Continuation and attention are settled but the stage is not recorded.",
      transition(
        "advance_close_stage",
        {
          taskId: identity.taskId,
          operationId: close.operationId,
          stage: "continuation_settled",
        },
        {
          type: "durable_close_stage",
          taskId: identity.taskId,
          operationId: close.operationId,
          stage: "continuation_settled",
        },
      ),
    );
  if (runtime.availability === "unavailable")
    return output(
      identity.taskId,
      "recovering",
      ["retry_cleanup"],
      "Runtime truth is unavailable during close.",
      transition("read_runtime_inventory", runtimeTarget, {
        type: "runtime_inventory",
        ...runtimeTarget,
      }),
    );
  if (!runtimeSettled(runtime))
    return output(
      identity.taskId,
      "closing",
      ["retry_cleanup"],
      "Fresh Runtime truth still requires cleanup.",
      transition("end_runtime_session", runtimeTarget, {
        type: "runtime_terminal_detached",
        ...runtimeTarget,
        attachment: "missing",
        profileLock: "released",
      }),
    );
  if (close.stage === "continuation_settled")
    return output(
      identity.taskId,
      "closing",
      ["retry_cleanup"],
      "Runtime cleanup is confirmed but the stage is not recorded.",
      transition(
        "advance_close_stage",
        {
          taskId: identity.taskId,
          operationId: close.operationId,
          stage: "runtime_settled",
        },
        {
          type: "durable_close_stage",
          taskId: identity.taskId,
          operationId: close.operationId,
          stage: "runtime_settled",
        },
      ),
    );
  if (close.stage === "runtime_settled")
    return output(
      identity.taskId,
      "closing",
      ["retry_cleanup"],
      "All close facts are confirmed but completion is not recorded.",
      transition(
        "advance_close_stage",
        {
          taskId: identity.taskId,
          operationId: close.operationId,
          stage: "complete",
        },
        {
          type: "durable_close_stage",
          taskId: identity.taskId,
          operationId: close.operationId,
          stage: "complete",
        },
      ),
    );
  if (close.stage === "complete") {
    const reopened = structuredClone(input);
    reopened.record.desiredState = "open";
    delete reopened.record.closeOperation;
    return reduceOpen(reopened);
  }
  return output(identity.taskId, "failed", [], "Unknown close stage.");
}

function reduceOpen(input) {
  const { record, codex, runtime, continuation } = input;
  const identity = record.identity;
  if (
    codex.availability === "unavailable" &&
    input.requestedOperation.type !== "message"
  )
    return output(
      identity.taskId,
      "ready",
      ["message"],
      "The local task is ready; Codex is unavailable.",
    );
  if (codex.availability === "unavailable")
    return output(
      identity.taskId,
      "recovering",
      ["message"],
      "Codex lifecycle truth is unavailable.",
      transition(
        "read_codex_thread",
        { taskId: identity.taskId },
        { type: "codex_thread_truth", taskId: identity.taskId },
      ),
    );
  if (!codex.threadExists && input.requestedOperation.type !== "message")
    return output(
      identity.taskId,
      "ready",
      ["message"],
      "The local task is ready for a new Codex association.",
    );
  if (!codex.threadExists)
    return output(
      identity.taskId,
      "recovering",
      ["message"],
      "A new Codex association is required for this message.",
      transition(
        "prepare_codex_reassociation",
        { taskId: identity.taskId },
        { type: "codex_reassociation_prepared", taskId: identity.taskId },
      ),
    );
  if (codex.archived && input.requestedOperation.type !== "message")
    return output(
      identity.taskId,
      "ready",
      ["message"],
      "The local task is ready; its prior Codex thread is archived.",
    );
  if (codex.archived)
    return output(
      identity.taskId,
      "recovering",
      ["message"],
      "Bound Codex thread is archived.",
      transition(
        "unarchive_codex_thread",
        { taskId: identity.taskId, threadId: identity.threadId },
        {
          type: "codex_thread_unarchived",
          taskId: identity.taskId,
          threadId: identity.threadId,
        },
      ),
    );
  if (codex.runtimeStatus === "notLoaded") {
    const actions = ["finish", "resume"];
    return output(
      identity.taskId,
      "recovering",
      actions,
      "Bound Codex thread is not loaded after restart.",
      requestedCommand(input, actions) ??
        transition(
          "resume_codex_thread",
          { taskId: identity.taskId, threadId: identity.threadId },
          {
            type: "codex_thread_loaded",
            taskId: identity.taskId,
            threadId: identity.threadId,
            runtimeStatus: "idle_or_active",
          },
        ),
    );
  }
  if (codex.runtimeStatus === "systemError")
    return output(
      identity.taskId,
      "recovering",
      ["finish", "retry_cleanup"],
      "Bound Codex thread reports a system error.",
      transition(
        "recover_codex_thread",
        { taskId: identity.taskId, threadId: identity.threadId },
        {
          type: "codex_thread_recovery_truth",
          taskId: identity.taskId,
          threadId: identity.threadId,
        },
      ),
    );
  if (runtime.sessionExists && identity.sessionId === undefined)
    return output(
      identity.taskId,
      "recovering",
      ["finish"],
      "The on-demand Runtime capability must be bound to this task.",
      transition(
        "bind_runtime_identity",
        {
          taskId: identity.taskId,
          bootstrapId: record.bootstrap.operationId,
          returnedSessionId: runtime.sessionId,
          returnedBrowserIdentity: runtime.browserIdentity,
        },
        {
          type: "durable_runtime_binding",
          taskId: identity.taskId,
          sessionId: runtime.sessionId,
        },
      ),
    );
  const runtimeBound =
    runtime.sessionExists &&
    runtime.sessionId === identity.sessionId &&
    !TERMINAL_RUNTIME.has(runtime.status);
  if (
    runtimeBound &&
    (runtime.attachment === "conflicting" ||
      runtime.profileLock === "conflicting" ||
      ["cleanup_required", "unrecoverable"].includes(runtime.recovery))
  )
    return retryableOpenCleanup(
      input,
      "Bound Runtime resources require cleanup reconciliation.",
    );
  const runtimeAttached = runtimeBound && runtime.attachment === "attached";
  if (runtimeAttached && runtime.status === "starting")
    return output(
      identity.taskId,
      "recovering",
      ["finish", "retry_cleanup"],
      "Runtime startup must converge before task work is dispatched.",
      transition(
        "read_runtime_inventory",
        { taskId: identity.taskId, sessionId: identity.sessionId },
        {
          type: "runtime_inventory",
          taskId: identity.taskId,
          sessionId: identity.sessionId,
        },
      ),
    );
  if (runtimeAttached && runtime.recovery !== "not_needed")
    return retryableOpenCleanup(
      input,
      "Attached Runtime session has contradictory recovery classification.",
    );
  const uncertainAttention = input.attentions.find(
    (entry) => entry.status === "resolution_unknown",
  );
  if (uncertainAttention)
    return output(
      identity.taskId,
      "recovering",
      ["finish", "retry_cleanup"],
      "Attention response outcome is unknown.",
      transition(
        "reconcile_attention_response",
        attentionIdentity(uncertainAttention),
        {
          type: "attention_response_receipt",
          ...attentionIdentity(uncertainAttention),
        },
      ),
    );
  if (
    continuation.status === "pending" &&
    continuation.command?.dispatchStatus === "resolution_unknown"
  )
    return output(
      identity.taskId,
      "recovering",
      ["finish", "retry_cleanup"],
      "Continuation response outcome is unknown.",
      transition(
        "reconcile_continuation_dispatch",
        {
          taskId: identity.taskId,
          threadId: identity.threadId,
          commandId: continuation.command.commandId,
        },
        {
          type: "continuation_dispatch_receipt",
          taskId: identity.taskId,
          threadId: identity.threadId,
          commandId: continuation.command.commandId,
        },
      ),
    );
  if (
    continuation.status === "pending" &&
    runtime.lastReturnedHandoffId === continuation.handoffId
  ) {
    if (continuation.freshInspectionRequired && input.freshInspection === null)
      return output(
        identity.taskId,
        "recovering",
        ["finish", "retry_cleanup"],
        "Fresh post-return inspection is required.",
        transition(
          "inspect_after_return",
          {
            taskId: identity.taskId,
            sessionId: identity.sessionId,
            handoffId: continuation.handoffId,
            generation: continuation.generation,
            afterObservationSeq: runtime.observationSeq,
          },
          {
            type: "fresh_inspection_proof",
            taskId: identity.taskId,
            sessionId: identity.sessionId,
            handoffId: continuation.handoffId,
            generation: continuation.generation,
            afterObservationSeq: runtime.observationSeq,
          },
        ),
      );
    if (
      continuation.freshInspectionRequired &&
      input.freshInspection !== null
    ) {
      const returnEventId = `return:${identity.sessionId}:${continuation.handoffId}:${continuation.generation}`;
      return output(
        identity.taskId,
        "recovering",
        ["finish", "retry_cleanup"],
        "Fresh inspection must be durably bound to the return event.",
        transition(
          "record_return_event",
          {
            taskId: identity.taskId,
            continuationId: continuation.id,
            returnEventId,
            returnObservationSeq: runtime.observationSeq,
            inspectionId: input.freshInspection.inspectionId,
          },
          {
            type: "durable_return_event",
            taskId: identity.taskId,
            continuationId: continuation.id,
            returnEventId,
            freshInspectionRequired: false,
          },
        ),
      );
    }
    if (continuation.policy === "explicit_user_response") {
      const actions = ["finish", "message"];
      const requested =
        input.requestedOperation.type === "message"
          ? transition(
              "respond_continuation_explicit",
              {
                taskId: identity.taskId,
                threadId: identity.threadId,
                continuationId: continuation.id,
                operationId: input.requestedOperation.operationId,
                message: input.requestedOperation.message,
                attachmentIds: input.requestedOperation.attachmentIds,
              },
              {
                type: "continuation_consumed",
                taskId: identity.taskId,
                continuationId: continuation.id,
                operationId: input.requestedOperation.operationId,
              },
            )
          : null;
      return output(
        identity.taskId,
        "waiting_for_human",
        actions,
        "Continuation requires an explicit user response.",
        requested ?? {},
      );
    }
    if (!continuation.command)
      return output(
        identity.taskId,
        "recovering",
        ["finish", "retry_cleanup"],
        "Stable continuation command must be prepared.",
        transition(
          "prepare_continuation_command",
          {
            taskId: identity.taskId,
            continuationId: continuation.id,
            returnEventId: continuation.returnEventId,
          },
          {
            type: "durable_continuation_command",
            taskId: identity.taskId,
            continuationId: continuation.id,
            dispatchStatus: "not_started",
          },
        ),
      );
    if (continuation.command.dispatchStatus === "not_started")
      return output(
        identity.taskId,
        "recovering",
        ["finish", "retry_cleanup"],
        "Continuation dispatch intent must be durable before dispatch.",
        transition(
          "persist_continuation_dispatch_intent",
          {
            taskId: identity.taskId,
            continuationId: continuation.id,
            commandId: continuation.command.commandId,
          },
          {
            type: "durable_continuation_dispatch",
            taskId: identity.taskId,
            continuationId: continuation.id,
            commandId: continuation.command.commandId,
            dispatchStatus: "possibly_started",
          },
        ),
      );
    if (continuation.command.dispatchStatus === "possibly_started")
      return output(
        identity.taskId,
        "recovering",
        ["finish", "retry_cleanup"],
        "Possibly-started continuation must reconcile by stable command identity.",
        transition(
          "dispatch_or_reconcile_continuation",
          {
            taskId: identity.taskId,
            threadId: identity.threadId,
            commandId: continuation.command.commandId,
          },
          {
            type: "continuation_dispatch_receipt",
            taskId: identity.taskId,
            threadId: identity.threadId,
            commandId: continuation.command.commandId,
          },
        ),
      );
  }
  const codexAttention = pendingAttentions(input, "codex");
  const handoff = exactHandoff(input);
  const actions = ["finish"];
  if (codexAttention.length > 0) actions.push("respond_attention");
  if (handoff) actions.push("return_control");
  const canMessage =
    codexAttention.length === 0 &&
    continuation.status !== "pending" &&
    handoff === null &&
    (!runtimeAttached || runtime.controller === "agent");
  if (codex.turn === "active") actions.push("interrupt");
  if (codex.turn === "active" && canMessage) actions.push("message");
  if (
    ["none", "completed", "failed", "interrupted"].includes(codex.turn) &&
    canMessage
  )
    actions.push("message");
  const waiting =
    codexAttention.length > 0 ||
    handoff !== null ||
    continuation.status === "pending" ||
    (runtimeAttached && runtime.controller === "human") ||
    (runtimeAttached && runtime.status === "awaiting_human");
  return output(
    identity.taskId,
    waiting
      ? "waiting_for_human"
      : codex.turn === "active"
        ? "working"
        : "ready",
    actions,
    waiting
      ? "Exact attention or handoff state is pending."
      : "Open task truth is settled.",
    requestedCommand(input, actions) ?? {},
  );
}

function reduceCore(input) {
  validateInput(input);
  if (input.record === null) {
    const taskId = input.requestedOperation.taskId ?? "unbound";
    if (input.runtime.sessionExists || input.codex.threadExists)
      return output(
        taskId,
        "cleanup_required",
        [],
        "Component truth has no durable task record.",
      );
    return output(taskId, "closed", [], "No task exists.");
  }
  const mismatch = identityProblem(input);
  if (mismatch)
    return output(
      input.record.identity.taskId,
      "cleanup_required",
      [],
      mismatch,
    );
  if (
    input.requestedOperation.type === "return_control" &&
    exactHandoff(input) === null
  )
    throw new Error("Return Control request lacks exact active handoff truth.");
  if (
    input.requestedOperation.type === "respond_attention" &&
    !pendingAttentions(input, "codex").some(
      (entry) =>
        entry.requestId === input.requestedOperation.requestId &&
        entry.generation === input.requestedOperation.generation,
    )
  )
    throw new Error("Attention response is stale or mismatched.");
  if (input.record.desiredState === "closed") return reduceClose(input);
  if (input.requestedOperation.type === "finish")
    return output(
      input.record.identity.taskId,
      "closing",
      ["retry_cleanup"],
      "Close intent must be durable before component effects.",
      requestedCommand(input, ["finish"]),
    );
  if (input.record.bootstrap.stage !== "complete")
    return reduceBootstrap(input);
  return reduceOpen(input);
}

const OPERATION_COMMANDS = Object.freeze({
  finish: ["persist_close_intent"],
  retry_cleanup: [
    "persist_close_intent",
    "end_runtime_session",
    "relaunch_named_browser",
    "read_lifecycle_truth",
    "read_codex_thread",
    "read_runtime_inventory",
  ],
  message: [
    "prepare_codex_reassociation",
    "read_codex_thread",
    "unarchive_codex_thread",
    "start_or_steer_codex_turn",
    "respond_continuation_explicit",
  ],
  interrupt: ["interrupt_codex_turn"],
  return_control: ["return_runtime_ownership"],
  respond_attention: ["respond_codex_attention"],
  resume: ["resume_codex_thread", "unarchive_codex_thread"],
  archive: ["archive_codex_thread"],
});

function withDisposition(value, operation, status, reason) {
  const result = {
    ...value,
    operationDisposition: {
      type: operation.type,
      operationId: operation.operationId ?? null,
      status,
      reason: bounded(reason),
    },
  };
  object(
    result.operationDisposition,
    ["type", "operationId", "status", "reason"],
    "operation disposition",
  );
  choice(
    result.operationDisposition.status,
    ["accepted", "deferred-for-convergence", "rejected"],
    "operation disposition status",
  );
  if (result.operationDisposition.operationId !== null)
    id(
      result.operationDisposition.operationId,
      "disposition operation id",
      PATTERNS.operation,
    );
  if (
    typeof result.operationDisposition.reason !== "string" ||
    result.operationDisposition.reason.length > 240
  )
    throw new Error("Operation disposition reason is invalid.");
  if (JSON.stringify(result).length > OUTPUT_CHARACTERS)
    throw new Error("Lifecycle output bound exceeded.");
  return result;
}

export function reduceTaskLifecycle(input): NativeLifecycleOutput {
  validateInput(input);
  const operation = input.requestedOperation;
  if (operation.type === "observe")
    return withDisposition(
      reduceCore(input),
      operation,
      "accepted",
      "Observation reduced from authoritative facts.",
    );
  const neutral = structuredClone(input);
  neutral.requestedOperation = {
    type: "observe",
    ...(operation.taskId === undefined ? {} : { taskId: operation.taskId }),
  };
  if (
    (operation.type === "archive" || operation.type === "resume") &&
    input.record !== null
  )
    return withDisposition(
      { ...reduceCore(neutral), nextCommand: null, confirmation: null },
      operation,
      "accepted",
      "Local task organization is handled by the Product store.",
    );
  if (operation.type === "finish" && input.record !== null)
    return withDisposition(
      reduceCore(input),
      operation,
      "accepted",
      "Finish is accepted for the existing durable task.",
    );
  const observed = reduceCore(neutral);
  if (
    operation.type === "archive" &&
    input.record?.desiredState === "closed" &&
    input.codex.archived
  )
    return withDisposition(
      { ...observed, nextCommand: null, confirmation: null },
      operation,
      "accepted",
      "Thread is already archived; repeated archive is reconciled.",
    );
  const allowed =
    observed.allowedActions.includes(operation.type) ||
    (operation.type === "finish" && input.record?.desiredState === "closed");
  if (!allowed) {
    const deferrable =
      (operation.type === "message" &&
        observed.nextCommand !== null &&
        ["starting", "recovering"].includes(observed.phase)) ||
      (operation.type === "respond_attention" &&
        observed.nextCommand?.type === "reconcile_attention_response");
    if (deferrable)
      return withDisposition(
        observed,
        operation,
        "deferred-for-convergence",
        "Stable operation identity is retained until prerequisite convergence completes.",
      );
    return withDisposition(
      { ...observed, nextCommand: null, confirmation: null },
      operation,
      "rejected",
      "Requested operation is not allowed by current authoritative facts.",
    );
  }
  const actual = reduceCore(input);
  const accepted =
    actual.nextCommand === null ||
    (OPERATION_COMMANDS[operation.type] ?? []).includes(
      actual.nextCommand.type,
    );
  return withDisposition(
    actual,
    operation,
    accepted ? "accepted" : "deferred-for-convergence",
    accepted
      ? "Requested operation is accepted by current facts."
      : "Stable operation identity is retained while prerequisite convergence runs.",
  );
}

export function reduceLifecycleInventory(input) {
  object(input, ["tasks", "requestedOperation"], "lifecycle inventory");
  if (!Array.isArray(input.tasks) || input.tasks.length > 32)
    throw new Error("Task inventory bound exceeded.");
  validateOperation(input.requestedOperation);
  if (input.requestedOperation.type !== "launch")
    throw new Error("Lifecycle inventory accepts only launch operations.");
  const tasks = input.tasks
    .map(reduceTaskLifecycle)
    .sort((a, b) => a.taskId.localeCompare(b.taskId));
  if (new Set(tasks.map((task) => task.taskId)).size !== tasks.length)
    throw new Error("Duplicate task inventory identity.");
  const blockers = tasks.filter(
    (task) => !["closed", "failed"].includes(task.phase),
  );
  const launchAllowed = blockers.length === 0;
  const launch = launchAllowed;
  const deferred = blockers.length === 1 && blockers[0].nextCommand !== null;
  const disposition = {
    type: "launch",
    operationId: input.requestedOperation.operationId,
    status: launch
      ? "accepted"
      : deferred
        ? "deferred-for-convergence"
        : "rejected",
    reason: launch
      ? "Launch intent can be persisted."
      : deferred
        ? "Stable launch identity is retained while one task converges."
        : "Launch is blocked by unresolved or conflicting task state.",
  };
  const result = {
    tasks,
    launchAllowed,
    operationDisposition: disposition,
    nextCommand: launch
      ? {
          type: "persist_bootstrap_intent",
          operationId: input.requestedOperation.operationId,
        }
      : deferred
        ? blockers[0].nextCommand
        : null,
    confirmation: launch
      ? {
          type: "durable_bootstrap_intent",
          operationId: input.requestedOperation.operationId,
        }
      : deferred
        ? blockers[0].confirmation
        : null,
    attention:
      blockers.length > 1
        ? {
            code: "multiple_tasks_require_convergence",
            taskIds: blockers.map((task) => task.taskId),
          }
        : blockers.length === 1 && !deferred
          ? {
              code: "task_requires_manual_resolution",
              taskIds: [blockers[0].taskId],
            }
          : null,
  };
  object(
    result.operationDisposition,
    ["type", "operationId", "status", "reason"],
    "launch operation disposition",
  );
  choice(
    result.operationDisposition.status,
    ["accepted", "deferred-for-convergence", "rejected"],
    "launch operation disposition status",
  );
  id(
    result.operationDisposition.operationId,
    "launch disposition operation id",
    PATTERNS.operation,
  );
  if (result.operationDisposition.reason.length > 240)
    throw new Error("Launch disposition reason is invalid.");
  if ((result.nextCommand === null) !== (result.confirmation === null))
    throw new Error(
      "Inventory command and confirmation must be emitted together.",
    );
  if (JSON.stringify(result).length > 131072)
    throw new Error("Lifecycle inventory output bound exceeded.");
  return result;
}

export const lifecycleContract = Object.freeze({
  phases: PHASES,
  operations: OPERATIONS,
  commands: COMMANDS,
  componentAffectingCommands: [...COMPONENT_COMMANDS],
  identityPatterns: Object.fromEntries(
    Object.entries(PATTERNS).map(([name, pattern]) => [name, pattern.source]),
  ),
  limits: {
    tasks: 32,
    attentionsPerTask: 32,
    roveIdCharacters: 128,
    codexIdCharacters: 256,
    messageCharacters: MESSAGE_CHARACTERS,
    errorCharacters: 240,
    outputCharacters: OUTPUT_CHARACTERS,
  },
});
