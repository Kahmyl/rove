import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  canonicalRoveToolDefinitionsJsonWire,
  ROVE_TOOL_DEFINITIONS_SHA256,
} from "@rove/protocol";
import { TOOL_CATALOG } from "./tool-catalog.js";
import { toolDefinitions } from "./register-tools.js";
import type { RuntimeClient } from "../runtime/runtime-client.types.js";

function digest(definitions: unknown): string {
  return createHash("sha256")
    .update(canonicalRoveToolDefinitionsJsonWire(definitions as unknown[]))
    .digest("hex");
}

describe("TOOL_CATALOG", () => {
  it("exposes the agreed agent-facing tool names", () => {
    expect([...TOOL_CATALOG].sort()).toEqual(
      [
        "browser.back",
        "browser.forward",
        "browser.inspect",
        "browser.interact",
        "browser.prepare_task_result_action",
        "browser.task_result_action_plan",
        "browser.transaction_begin",
        "browser.transaction_advance",
        "browser.transaction_verify",
        "browser.transaction_status",
        "browser.transaction_cancel",
        "browser.navigate",
        "browser.open_page",
        "browser.pages",
        "browser.switch_page",
        "browser.close_page",
        "browser.resolve_target",
        "browser.screenshot",
        "browser.scroll",
        "control.status",
        "control.request_human",
        "control.wait",
        "evidence.list",
        "evidence.read",
        "evidence.create_file",
        "evidence.request_file_grant",
        "evidence.save_record",
        "session.end",
        "session.observations",
        "session.start",
        "session.status",
      ].sort(),
    );
    expect(TOOL_CATALOG).not.toContain("control.take_human");
    expect(TOOL_CATALOG).not.toContain("control.return_agent");
    expect(TOOL_CATALOG).not.toContain("control.transfer");
    expect(TOOL_CATALOG).not.toContain("control.set");
  });
  it("matches the independently pinned full production-definition digest", () => {
    const runtime = new Proxy(
      {},
      { get: () => async () => ({}) },
    ) as RuntimeClient;
    const definitions = toolDefinitions(runtime)
      .map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(digest(definitions)).toBe(ROVE_TOOL_DEFINITIONS_SHA256);
    expect(digest(JSON.parse(JSON.stringify(definitions)))).toBe(
      ROVE_TOOL_DEFINITIONS_SHA256,
    );
    definitions[0] = {
      ...definitions[0]!,
      description: `${definitions[0]!.description} drift`,
    };
    expect(digest(definitions)).not.toBe(ROVE_TOOL_DEFINITIONS_SHA256);
  });
});
