const TERMINAL_TASK_PHASES = new Set(["closed", "failed"]);
const TERMINAL_RUNTIME_STATUSES = new Set(["completed", "failed"]);
// Exact terminal complement of ACTIVE_ATTENTION in the production contract.
export const TERMINAL_ATTENTION_STATUSES = new Set([
  "resolved",
  "cancelled",
  "stale",
]);

function bounded(value, maximum = 160) {
  return typeof value === "string" ? value.slice(0, maximum) : undefined;
}

function identity(entry) {
  return [
    bounded(entry?.taskId),
    bounded(entry?.threadId),
    bounded(entry?.turnId),
    bounded(entry?.requestId),
  ]
    .filter(Boolean)
    .join("/");
}

function ownedWarning(warning, taskIds) {
  return (
    typeof warning === "string" &&
    [...taskIds].some((taskId) => warning.includes(taskId))
  );
}

export function evaluateTerminalCleanliness({
  state,
  runOwnedTaskIds,
  ledger,
}) {
  const taskIds = new Set(runOwnedTaskIds);
  const tasks = (state?.product?.tasks ?? []).filter((task) =>
    taskIds.has(task.taskId),
  );
  const sessions = new Set([
    ...tasks.map((task) => task.roveSessionId).filter(Boolean),
    ...ledger
      .filter((entry) => taskIds.has(entry.taskId))
      .map((entry) => entry.sessionId)
      .filter(Boolean),
  ]);
  const violations = [];
  for (const task of tasks) {
    if (!TERMINAL_TASK_PHASES.has(task.lifecycle?.phase))
      violations.push(
        `task_lifecycle_nonterminal:${task.taskId}:${task.lifecycle?.phase ?? "missing"}`,
      );
    if (task.conversation?.archived !== true)
      violations.push(`conversation_unarchived:${task.taskId}`);
    if ((task.attachments?.length ?? 0) !== 0)
      violations.push(
        `attachment_bytes_retained:${task.taskId}:${task.attachments.length}`,
      );
    if (task.runtime && !TERMINAL_RUNTIME_STATUSES.has(task.runtime.status))
      violations.push(
        `runtime_nonterminal:${task.taskId}:${task.roveSessionId ?? "missing"}:${task.runtime.status}`,
      );
  }

  const companion = state?.companion;
  if (
    companion?.session?.id &&
    sessions.has(companion.session.id) &&
    !TERMINAL_RUNTIME_STATUSES.has(companion.session.status)
  )
    violations.push(
      `companion_nonterminal:${companion.session.id}:${companion.session.status}`,
    );

  const ownedFileAttention = (state?.product?.fileAttention ?? []).filter(
    (entry) => taskIds.has(entry.taskId),
  );
  for (const entry of ownedFileAttention)
    violations.push(`file_attention:${identity(entry) || "unknown"}`);

  const ownedAttention = (state?.product?.attention ?? []).filter((entry) =>
    taskIds.has(entry.taskId),
  );
  for (const entry of ownedAttention)
    if (!TERMINAL_ATTENTION_STATUSES.has(entry.status))
      violations.push(
        `attention_nonterminal:${identity(entry) || "unknown"}:${entry.status ?? "missing"}`,
      );

  const ownedRecoveryWarnings = (state?.product?.recoveryWarnings ?? []).filter(
    (warning) => ownedWarning(warning, taskIds),
  );
  for (const warning of ownedRecoveryWarnings)
    violations.push(`recovery_warning:${bounded(warning, 300)}`);

  const expectedHandovers = ledger.filter(
    (entry) => entry.kind === "handover" && taskIds.has(entry.taskId),
  );
  const handoverAttention = ownedAttention.filter(
    (entry) =>
      entry.authority === "rove_control" && entry.kind === "control_handoff",
  );
  if (expectedHandovers.length !== 2)
    violations.push(
      `handover_ledger_count:${expectedHandovers.length}:expected:2`,
    );
  if (handoverAttention.length !== 2)
    violations.push(
      `handover_attention_count:${handoverAttention.length}:expected:2`,
    );
  for (const expected of expectedHandovers) {
    const boundTask = tasks.find((task) => task.taskId === expected.taskId);
    if (
      !boundTask ||
      boundTask.roveSessionId !== expected.sessionId ||
      boundTask.codexThreadId !== expected.threadId
    )
      violations.push(
        `handover_task_binding:${expected.taskId}:${expected.sessionId}:${expected.threadId}`,
      );
    const matches = handoverAttention.filter(
      (entry) =>
        entry.taskId === expected.taskId &&
        entry.threadId === expected.threadId &&
        entry.turnId === expected.turnId &&
        entry.status === "resolved",
    );
    if (matches.length !== 1)
      violations.push(
        `handover_attention_binding:${expected.taskId}:${expected.sessionId}:${expected.threadId}:${expected.turnId}:matches:${matches.length}`,
      );
  }

  return {
    ok: violations.length === 0,
    violations,
    evidence: {
      resolvedHandoverAttentionCount: handoverAttention.filter(
        (entry) => entry.status === "resolved",
      ).length,
    },
    summaries: {
      companion:
        companion?.session === undefined
          ? null
          : {
              sessionId: bounded(companion.session.id),
              status: bounded(companion.session.status),
              controller: bounded(companion.session.controller),
            },
      attention: ownedAttention.map((entry) => ({
        authority: bounded(entry.authority),
        kind: bounded(entry.kind),
        requestId: bounded(entry.requestId),
        taskId: bounded(entry.taskId),
        threadId: bounded(entry.threadId),
        turnId: bounded(entry.turnId),
        status: bounded(entry.status),
      })),
      fileAttention: ownedFileAttention.map((entry) => ({
        requestId: bounded(entry.requestId),
        taskId: bounded(entry.taskId),
        sessionId: bounded(entry.sessionId),
        status: bounded(entry.status),
      })),
      recoveryWarnings: ownedRecoveryWarnings.map((warning) =>
        bounded(warning, 300),
      ),
    },
  };
}
