const IDENTITY_FIELDS = [
  "taskId",
  "operationId",
  "sessionId",
  "threadId",
  "turnId",
];

function projectedIdentity(task) {
  return {
    taskId: task?.taskId,
    operationId: task?.initialLaunch?.operationId,
    sessionId: task?.roveSessionId,
    threadId: task?.codexThreadId,
    turnId: task?.initialLaunch?.turnId,
  };
}

function completeIdentity(identity) {
  return IDENTITY_FIELDS.every(
    (field) =>
      typeof identity[field] === "string" && identity[field].length > 0,
  );
}

function invalid(reason, identity) {
  return { status: "invalid", reason, identity };
}

export function evaluateLaunchBoundary({
  state,
  priorTaskIds,
  priorLedger,
  expectedIdentity,
  terminalPhases,
}) {
  const tasks = Array.isArray(state?.product?.tasks) ? state.product.tasks : [];
  const prior = new Set(priorTaskIds);
  const candidates = tasks.filter(
    (task) => typeof task?.taskId === "string" && !prior.has(task.taskId),
  );
  if (candidates.length > 1)
    return invalid(
      "multiple new launch tasks were projected",
      expectedIdentity,
    );
  if (candidates.length === 0)
    return expectedIdentity?.taskId
      ? invalid("the observed launch task disappeared", expectedIdentity)
      : { status: "pending", identity: expectedIdentity };

  const task = candidates[0];
  const observed = projectedIdentity(task);
  const identity = { ...expectedIdentity };
  for (const field of IDENTITY_FIELDS) {
    const value = observed[field];
    if (
      typeof identity[field] === "string" &&
      typeof value === "string" &&
      identity[field] !== value
    )
      return invalid(`launch ${field} changed`, identity);
    if (typeof value === "string" && value.length > 0) identity[field] = value;
  }
  if (terminalPhases.has(task.lifecycle?.phase))
    return invalid(
      "task became terminal before initial user projection",
      identity,
    );
  if (
    task.initialLaunch?.stage !== "turn_started" ||
    !completeIdentity(observed)
  )
    return { status: "pending", identity };

  const items = Object.values(task.conversation?.items ?? {});
  const userItems = items.filter((item) => item?.kind === "user_message");
  const matching = userItems.filter((item) => item.turnId === observed.turnId);
  if (userItems.some((item) => item.turnId !== observed.turnId))
    return invalid(
      "initial user item has a conflicting turn identity",
      identity,
    );
  if (matching.length > 1)
    return invalid("multiple initial user items were projected", identity);
  if (matching.length === 0) return { status: "pending", identity };
  const [item] = matching;
  if (item.clientId !== undefined && item.clientId !== observed.operationId)
    return invalid(
      "initial user item has a conflicting client identity",
      identity,
    );

  const duplicate = priorLedger.find((entry) =>
    IDENTITY_FIELDS.some((field) => entry?.[field] === observed[field]),
  );
  if (duplicate)
    return invalid(
      "launch identity duplicates the accumulated ledger",
      identity,
    );
  return {
    status: "ready",
    identity: observed,
    revision: state.revision,
    task,
    item,
  };
}
