import { describe, expect, it, vi } from "vitest";

import { CompanionRuntimeClient } from "./runtime-client.js";

describe("CompanionRuntimeClient browser window state", () => {
  it("reads live cross-platform browser window state from Runtime", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain("/sessions/ses_live/browser/window");

      return new Response(
        JSON.stringify({
          windowId: 123,
          pageId: "page_01",
          windowState: "normal",
          bounds: {
            left: 20,
            top: 40,
            width: 1200,
            height: 800,
          },
          documentFocused: true,
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

    await expect(
      client.getBrowserWindowState("ses_live"),
    ).resolves.toMatchObject({
      windowId: 123,
      pageId: "page_01",
      windowState: "normal",
      documentFocused: true,
    });
  });

  it("preserves Runtime null when no live browser window state exists", async () => {
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

    await expect(client.getBrowserWindowState("ses_none")).resolves.toBeNull();
  });
});
