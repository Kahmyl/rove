import { exactKeys, requiredString, strictRecord } from "./state-validation.js";

export const ROVE_CONTROL_NAMESPACE = "rove";
export const REQUEST_HUMAN_TOOL = "control.request_human";

export type RequestHumanContinuationPolicy =
  "resume_after_control_return" | "explicit_user_response";

export interface NormalizedCompletedRequestHumanCall {
  itemId: string;
  sessionId: string;
  instruction: string;
  continuationPolicy: RequestHumanContinuationPolicy;
  returnedControlStatus: {
    sessionId: string;
    generation: number;
    handoffId: string;
    observationSeq?: number;
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function mcpResult(value: unknown): Record<string, unknown> | undefined {
  const result = record(value);
  if (!result) return undefined;
  if (!Array.isArray(result.content)) return result;
  const text = result.content.filter((entry) => {
    const item = record(entry);
    return item?.type === "text" && typeof item.text === "string";
  });
  if (text.length !== 1) return undefined;
  return parseJsonObject((text[0] as { text: string }).text);
}

function dynamicResult(value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(value) || value.length !== 1) return undefined;
  const content = record(value[0]);
  if (content?.type !== "inputText" || typeof content.text !== "string")
    return undefined;
  return parseJsonObject(content.text);
}

function returnedControlStatus(
  value: unknown,
): NormalizedCompletedRequestHumanCall["returnedControlStatus"] | undefined {
  const payload = record(value);
  if (
    !payload ||
    typeof payload.sessionId !== "string" ||
    typeof payload.activeHandoffId !== "string" ||
    !Number.isSafeInteger(payload.generation) ||
    Number(payload.generation) <= 0 ||
    (payload.observationSeq !== undefined &&
      (!Number.isSafeInteger(payload.observationSeq) ||
        Number(payload.observationSeq) < 0))
  )
    return undefined;
  return {
    sessionId: payload.sessionId,
    generation: Number(payload.generation),
    handoffId: payload.activeHandoffId,
    ...(payload.observationSeq === undefined
      ? {}
      : { observationSeq: Number(payload.observationSeq) }),
  };
}

/**
 * Normalizes only a successfully completed, exact Rove human-control request.
 * Runtime truth must still corroborate the returned handoff before callers may
 * persist a continuation or expose control actions.
 */
export function normalizeCompletedRequestHumanToolItem(
  value: unknown,
): NormalizedCompletedRequestHumanCall | undefined {
  const item = record(value);
  if (!item) return undefined;

  let result: Record<string, unknown> | undefined;
  if (item.type === "mcpToolCall") {
    if (
      item.server !== ROVE_CONTROL_NAMESPACE ||
      item.tool !== REQUEST_HUMAN_TOOL
    )
      return undefined;
    if (item.status !== "completed" || item.error !== null) return undefined;
    result = mcpResult(item.result);
  } else if (item.type === "dynamicToolCall") {
    if (
      item.namespace !== ROVE_CONTROL_NAMESPACE ||
      item.tool !== REQUEST_HUMAN_TOOL
    )
      return undefined;
    if (item.status !== "completed" || item.success !== true) return undefined;
    result = dynamicResult(item.contentItems);
  } else return undefined;

  const args = strictRecord(item.arguments, "request-human tool arguments");
  exactKeys(
    args,
    ["sessionId", "reason", "instruction", "continuationPolicy"],
    "request-human tool arguments",
  );
  requiredString(args.reason, "request-human reason");
  const policy = args.continuationPolicy;
  if (
    policy !== "resume_after_control_return" &&
    policy !== "explicit_user_response"
  )
    throw new Error("Completed handoff tool call has invalid policy.");
  const control = returnedControlStatus(result);
  if (!control)
    throw new Error(
      "Completed handoff tool call lacks trusted Runtime result.",
    );
  return {
    itemId: requiredString(item.id, "request-human item identity"),
    sessionId: requiredString(args.sessionId, "request-human session"),
    instruction: requiredString(args.instruction, "continuation instruction"),
    continuationPolicy: policy,
    returnedControlStatus: control,
  };
}
