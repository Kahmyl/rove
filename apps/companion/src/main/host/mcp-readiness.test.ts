import { describe, expect, it, vi } from "vitest";

import { waitForMcpReady } from "./mcp-readiness.js";

describe("waitForMcpReady", () => {
  it("waits until MCP reports healthy", async () => {
    let attempts = 0;

    const fetchImpl = vi.fn(async () => {
      attempts += 1;

      if (attempts < 3) {
        throw new Error("not ready");
      }

      return new Response(
        JSON.stringify({
          status: "ok",
          service: "rove-mcp",
          transport: "http",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    await expect(
      waitForMcpReady("http://127.0.0.1:47821", {
        timeoutMs: 1_000,
        pollIntervalMs: 1,
        fetchImpl,
      }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails deterministically when MCP never becomes ready", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as typeof fetch;

    await expect(
      waitForMcpReady("http://127.0.0.1:47821", {
        timeoutMs: 20,
        pollIntervalMs: 2,
        fetchImpl,
      }),
    ).rejects.toThrow("Rove MCP did not become ready");
  });
});
