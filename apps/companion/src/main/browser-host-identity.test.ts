import { describe, expect, it, vi } from "vitest";

import { CompanionRuntimeClient } from "./runtime-client.js";

describe("CompanionRuntimeClient browser host identity", () => {
  it("reads exact live browser host identity from Runtime", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain("/sessions/ses_live/browser/host");

      return new Response(
        JSON.stringify({
          kind: "owned_process",
          processId: 4321,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    const client = new CompanionRuntimeClient({
      baseUrl: "http:" + "//" + "127.0.0.1:47820",
      fetchImpl,
    });

    await expect(client.getBrowserHostIdentity("ses_live")).resolves.toEqual({
      kind: "owned_process",
      processId: 4321,
    });
  });

  it("preserves Runtime null when no live owned process exists", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("null", {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
    ) as typeof fetch;

    const client = new CompanionRuntimeClient({
      baseUrl: "http:" + "//" + "127.0.0.1:47820",
      fetchImpl,
    });

    await expect(
      client.getBrowserHostIdentity("ses_no_host"),
    ).resolves.toBeNull();
  });
});
