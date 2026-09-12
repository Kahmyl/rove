const TASK_ID = /^task_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SESSION_ID = /^ses_[A-Za-z0-9][A-Za-z0-9_-]*$/;
const OPERATION_ID = /^intent_[a-f0-9-]{36}$/;

export function parseRunOwnedRecovery(argv) {
  const prefix = "--recover-run-owned=";
  const matches = argv.filter((argument) => argument.startsWith(prefix));
  if (matches.length === 0) return null;
  if (matches.length !== 1)
    throw new Error("Specify --recover-run-owned exactly once.");
  const parts = matches[0].slice(prefix.length).split(",");
  if (
    parts.length !== 3 ||
    !TASK_ID.test(parts[0]) ||
    !SESSION_ID.test(parts[1]) ||
    !OPERATION_ID.test(parts[2])
  )
    throw new Error(
      "--recover-run-owned must be taskId,sessionId,operationId with exact Rove identities.",
    );
  return {
    taskId: parts[0],
    sessionId: parts[1],
    operationId: parts[2],
  };
}

export function selectRunOwnedRecoveryTask(tasks, recovery, terminalPhases) {
  if (!recovery) return null;
  const matchingId = tasks.filter((task) => task.taskId === recovery.taskId);
  if (matchingId.length !== 1)
    throw new Error(
      `Recovery ownership target ${recovery.taskId} was not found exactly once.`,
    );
  const [task] = matchingId;
  if (
    task.roveSessionId !== recovery.sessionId ||
    task.initialLaunch?.operationId !== recovery.operationId
  )
    throw new Error(
      `Recovery ownership tuple does not exactly match task ${recovery.taskId}.`,
    );
  if (
    terminalPhases.has(task.lifecycle?.phase) &&
    postCloseArchiveDisposition(task) === "missing"
  )
    throw new Error(
      `Recovery ownership target ${recovery.taskId} is terminal but its archive state is unsafe.`,
    );
  return task;
}

export function postCloseArchiveDisposition(task) {
  if (task.conversation?.archived === true) return "settled";
  if (task.availableActions?.includes("archive")) return "archive";
  if (task.codexThreadId === undefined && task.conversation === undefined)
    return "not_applicable";
  return "missing";
}

export async function waitForPostCloseArchiveDisposition({
  readTask,
  wait,
  timeoutMs = 120_000,
  pollMs = 100,
  now = Date.now,
}) {
  const deadline = now() + timeoutMs;
  let task = await readTask();
  while (task) {
    const disposition = postCloseArchiveDisposition(task);
    if (disposition !== "missing") return { task, disposition };
    if (now() >= deadline) return { task, disposition };
    await wait(pollMs);
    task = await readTask();
  }
  throw new Error("Run-owned task disappeared during post-close cleanup.");
}
