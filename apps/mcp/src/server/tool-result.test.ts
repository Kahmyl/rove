import { describe, expect, it } from "vitest";
import { RuntimeClientError } from "../runtime/runtime-client.error.js";
import { toolFailure, toolSuccess } from "./tool-result.js";

describe("tool result mapping", () => {
  it("serializes successful results as JSON text", () => {
    const result = toolSuccess({ ok: true });
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual({ ok: true });
  });

  it("maps runtime errors into MCP tool errors", () => {
    const result = toolFailure(new RuntimeClientError("TARGET_STALE", "Target is stale.", true, { revision: 1 }));
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual({
      error: {
        code: "TARGET_STALE",
        message: "Target is stale.",
        retryable: true,
        details: { revision: 1 },
      },
    });
  });
});
