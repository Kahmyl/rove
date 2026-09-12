import { setTimeout } from "node:timers";

export function validateSurfaceSnapshot(state, stage = "snapshot") {
  if (!state || typeof state !== "object")
    throw new Error(`Snapshot ${stage} root is not an object.`);
  if (typeof state.revision !== "number")
    throw new Error(`Snapshot ${stage} revision is not a number.`);
  if (state.product === null) return state;
  if (!state.product || typeof state.product !== "object")
    throw new Error(`Snapshot ${stage} product is not an object or null.`);
  for (const field of [
    "tasks",
    "attention",
    "fileAttention",
    "recoveryWarnings",
  ])
    if (!Array.isArray(state.product[field]))
      throw new Error(`Snapshot ${stage} product.${field} is not an array.`);
  state.product.tasks.forEach((task, index) => {
    if (!task || typeof task !== "object")
      throw new Error(
        `Snapshot ${stage} product.tasks[${index}] is not an object.`,
      );
    if (typeof task.taskId !== "string")
      throw new Error(
        `Snapshot ${stage} product.tasks[${index}].taskId is not a string.`,
      );
  });
  return state;
}

export async function pollSnapshot({
  page,
  snapshot,
  predicate,
  stage,
  timeoutMs = 30_000,
  intervalMs = 100,
  summarize = (state) => state,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastState;
  while (Date.now() <= deadline) {
    lastState = await snapshot(page);
    const result = predicate(lastState);
    if (result !== false && result !== null && result !== undefined)
      return result;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(intervalMs, remaining)),
    );
  }
  let summary;
  try {
    summary = JSON.stringify(summarize(lastState)).slice(0, 2_000);
  } catch {
    summary = "unavailable";
  }
  throw new Error(
    `Snapshot poll timed out at ${stage}; last validated snapshot: ${summary}`,
  );
}

export function pollProductTruth(options) {
  return pollSnapshot({
    ...options,
    predicate: (state) =>
      state.product?.host.ready === true &&
      state.product.catalog.account.status !== "unavailable"
        ? state
        : false,
  });
}
