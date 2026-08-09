import { afterEach, describe, expect, it } from "vitest";

import type { BrowserLaunchConfig } from "@rove/protocol";

import type { BrowserSession } from "./engine.js";
import {
  startFixtureServer,
  type FixtureServer,
} from "./fixtures/fixture-server.js";
import { PlaywrightBrowserEngine } from "./playwright-browser-engine.js";

const config: BrowserLaunchConfig = {
  headless: true,
  browser: "chromium",
  profile: { mode: "temporary" },
};

const sessions: BrowserSession[] = [];
const servers: FixtureServer[] = [];

async function startSession(): Promise<BrowserSession> {
  const session = await new PlaywrightBrowserEngine().start(config);
  sessions.push(session);
  return session;
}

async function startServer(): Promise<FixtureServer> {
  const server = await startFixtureServer();
  servers.push(server);
  return server;
}

async function waitForPageCount(
  session: BrowserSession,
  count: number,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const pages = await session.pages();
    if (pages.length === count) return pages;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${count} browser pages.`);
}

afterEach(async () => {
  while (sessions.length > 0) {
    await sessions.pop()?.close();
  }

  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe("PlaywrightBrowserEngine", () => {
  it("starts a real temporary Chromium session with page_01", async () => {
    const session = await startSession();

    expect(session.id).toMatch(/^browser_/);

    const pages = await session.pages();

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      id: "page_01",
      url: "about:blank",
      active: true,
      revision: 0,
    });
  });

  it("rejects unsupported profile modes without silently using temporary", async () => {
    const engine = new PlaywrightBrowserEngine();

    await expect(
      engine.start({
        ...config,
        profile: { mode: "persistent", name: "test-profile" },
      }),
    ).rejects.toMatchObject({
      code: "NOT_IMPLEMENTED",
    });
  });

  it("navigates the active page and increments its revision", async () => {
    const server = await startServer();
    const session = await startSession();

    const [before] = await session.pages();
    expect(before?.id).toBe("page_01");
    expect(before?.revision).toBe(0);

    const result = await session.navigate(server.url);

    const [after] = await session.pages();

    expect(result).toMatchObject({
      ok: true,
      action: "navigate",
      sessionId: session.id,
      pageId: "page_01",
      pageChanged: true,
      previousRevision: 0,
      currentRevision: 1,
    });

    expect(after?.id).toBe("page_01");
    expect(after?.revision).toBe(1);
    expect(after?.url).toBe(new URL("/", server.url).href);
    expect(after?.title).toBe("Rove Inspection Fixture");
  });

  it("registers a newly opened popup as page_02 and makes it active", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(`${server.url}/popup`);

    const pages = await waitForPageCount(session, 2);

    expect(pages.map((page) => page.id)).toEqual(["page_01", "page_02"]);

    expect(pages.find((page) => page.id === "page_01")?.active).toBe(false);
    expect(pages.find((page) => page.id === "page_02")?.active).toBe(true);
  });

  it("switches active pages", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(`${server.url}/popup`);
    await waitForPageCount(session, 2);

    const selected = await session.switchPage("page_01");

    expect(selected.id).toBe("page_01");
    expect(selected.active).toBe(true);

    const pages = await session.pages();

    expect(pages.find((page) => page.id === "page_01")?.active).toBe(true);
    expect(pages.find((page) => page.id === "page_02")?.active).toBe(false);
  });

  it("rejects switching to an unknown page", async () => {
    const session = await startSession();

    await expect(session.switchPage("page_99")).rejects.toMatchObject({
      code: "PAGE_NOT_FOUND",
    });
  });

  it("closes a page and removes it from the registry", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(`${server.url}/popup`);
    await waitForPageCount(session, 2);

    await session.closePage("page_02");

    const pages = await waitForPageCount(session, 1);

    expect(pages).toHaveLength(1);
    expect(pages[0]?.id).toBe("page_01");
    expect(pages[0]?.active).toBe(true);
  });

  it("creates a fresh active page when the final page is closed", async () => {
    const session = await startSession();

    await session.closePage("page_01");

    const pages = await waitForPageCount(session, 1);

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      id: "page_02",
      url: "about:blank",
      active: true,
      revision: 0,
    });
  });

  it("rejects closing an unknown page", async () => {
    const session = await startSession();

    await expect(session.closePage("page_99")).rejects.toMatchObject({
      code: "PAGE_NOT_FOUND",
    });
  });

  it("closes idempotently", async () => {
    const session = await startSession();

    await expect(session.close()).resolves.toBeUndefined();
    await expect(session.close()).resolves.toBeUndefined();
  });

  it("maps operations after close to BROWSER_CLOSED", async () => {
    const session = await startSession();

    await session.close();

    await expect(
      session.navigate("http://127.0.0.1:1"),
    ).rejects.toMatchObject({
      code: "BROWSER_CLOSED",
    });

    await expect(session.pages()).rejects.toMatchObject({
      code: "BROWSER_CLOSED",
    });
  });

  it("keeps Milestone 3 actions explicitly unimplemented", async () => {
    const session = await startSession();

    await expect(
      session.click({
        pageId: "page_01",
        revision: 0,
        ref: "t1",
      }),
    ).rejects.toMatchObject({
      code: "NOT_IMPLEMENTED",
    });
  });
});
