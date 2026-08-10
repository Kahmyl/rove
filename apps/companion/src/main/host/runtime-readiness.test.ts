import { describe, expect, it, vi } from "vitest";

import { waitForRuntimeReady } from "./runtime-readiness.js";

describe("waitForRuntimeReady", () => {
  it("waits until Runtime reports healthy", async () => {
    let attempts = 0;

    const fetchImpl = vi.fn(async () => {
      attempts += 1;

      if (attempts < 3) {
        throw new Error("not ready");
      }

      return new Response(
        JSON.stringify({
          ok: true,
          protocolVersion: 1,
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
      waitForRuntimeReady("http://127.0.0.1:47820", {
        timeoutMs: 1_000,
        pollIntervalMs: 1,
        fetchImpl,
      }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails deterministically when Runtime never becomes ready", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as typeof fetch;

    await expect(
      waitForRuntimeReady("http://127.0.0.1:47820", {
        timeoutMs: 20,
        pollIntervalMs: 2,
        fetchImpl,
      }),
    ).rejects.toThrow("Rove Runtime did not become ready");
  });
});
