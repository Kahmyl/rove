/** The one production Rove MCP tool catalog, shared by server and host gates. */
export const ROVE_TOOL_CATALOG = [
  "session.start",
  "session.status",
  "session.end",
  "session.observations",
  "browser.navigate",
  "browser.open_page",
  "browser.pages",
  "browser.switch_page",
  "browser.close_page",
  "browser.inspect",
  "browser.resolve_target",
  "browser.interact",
  "browser.reconcile_outcome",
  "browser.prepare_task_result_action",
  "browser.task_result_action_plan",
  "browser.transaction_begin",
  "browser.transaction_advance",
  "browser.transaction_verify",
  "browser.transaction_status",
  "browser.transaction_cancel",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.screenshot",
  "evidence.create_file",
  "evidence.request_file_grant",
  "evidence.save_record",
  "evidence.list",
  "evidence.read",
  "control.status",
  "control.request_human",
  "control.wait",
] as const;

export type RoveToolName = (typeof ROVE_TOOL_CATALOG)[number];

function canonicalJsonValue(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) as string;
  if (Array.isArray(value))
    return `[${value.map(canonicalJsonValue).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJsonValue(item)}`)
    .join(",")}}`;
}

/**
 * Canonical tools/list JSON wire representation. JSON serialization removes
 * non-wire values before definitions are sorted by name and object keys.
 */
export function canonicalRoveToolDefinitionsJsonWire(
  definitions: readonly unknown[],
): string {
  const encoded = JSON.stringify(definitions);
  if (encoded === undefined)
    throw new Error("Rove tool definitions are not JSON serializable.");
  const wire = JSON.parse(encoded) as unknown[];
  return canonicalJsonValue(
    [...wire].sort((left, right) =>
      String((left as { name?: unknown }).name).localeCompare(
        String((right as { name?: unknown }).name),
      ),
    ),
  );
}

/** SHA-256 of canonicalRoveToolDefinitionsJsonWire for the 0.1.0 tools/list payload. */
export const ROVE_TOOL_DEFINITIONS_SHA256 =
  "7129514a4d35e31667cdb911ab17d2890babe019d79ecad9215847106b1ced83";
