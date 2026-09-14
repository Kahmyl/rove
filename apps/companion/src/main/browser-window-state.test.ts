import { describe, expect, it, vi } from "vitest";

import { CompanionRuntimeClient } from "./runtime-client.js";

describe("CompanionRuntimeClient browser window state", () => {
  it("reads live cross-platform browser window state from Runtime with the caller AbortSignal", async () => {
    const abort = new AbortController();

    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        expect(String(input)).toContain("/sessions/ses_live/browser/window");

        expect(init?.signal).toBe(abort.signal);

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
      },
    ) as typeof fetch;

    const client = new CompanionRuntimeClient({
      baseUrl: "http:" + "//" + "127.0.0.1:47820",
      fetchImpl,
    });

    await expect(
      client.getBrowserWindowState("ses_live", abort.signal),
    ).resolves.toMatchObject({
      windowId: 123,
      pageId: "page_01",
      windowState: "normal",
      documentFocused: true,
    });
  });

  it("preserves Runtime null when no live browser window state exists", async () => {
    const abort = new AbortController();

    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(init?.signal).toBe(abort.signal);

        return new Response("null", {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      },
    ) as typeof fetch;

    const client = new CompanionRuntimeClient({
      baseUrl: "http:" + "//" + "127.0.0.1:47820",
      fetchImpl,
    });

    await expect(
      client.getBrowserWindowState("ses_none", abort.signal),
    ).resolves.toBeNull();
  });

  it("propagates already-revoked transport authority to fetch", async () => {
    const abort = new AbortController();

    abort.abort();

    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(init?.signal).toBe(abort.signal);

        expect(init?.signal?.aborted).toBe(true);

        return new Response("null", {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      },
    ) as typeof fetch;

    const client = new CompanionRuntimeClient({
      baseUrl: "http:" + "//" + "127.0.0.1:47820",
      fetchImpl,
    });

    await client.getBrowserWindowState("ses_stale", abort.signal);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("asks Runtime to show only the supplied exact managed browser session", async () => {
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        expect(url).toContain("/sessions/ses_show/browser/show");
        expect(init?.method).toBe("POST");
        return new Response("true", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    ) as typeof fetch;
    const client = new CompanionRuntimeClient({
      baseUrl: "http:" + "//" + "127.0.0.1:47820",
      fetchImpl,
    });

    await expect(client.showBrowserForSession("ses_show")).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
