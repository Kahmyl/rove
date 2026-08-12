import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type {
  BrowserLaunchConfig,
  PageInspection,
  TargetReference,
} from "@rove/protocol";

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

function target(inspection: PageInspection, name: string): TargetReference {
  const found = inspection.targets?.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing fixture target: ${name}`);
  return { pageId: inspection.pageId, revision: inspection.revision, ref: found.ref };
}

async function waitForFile(path: string, timeoutMs = 3_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Timed out waiting for file: ${path}`);
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

  it("starts a persistent Chromium session in the resolved Rove profile directory", async () => {
    const userDataDir =
      await mkdtemp(
        join(
          tmpdir(),
          "rove-profile-",
        ),
      );

    try {
      const session =
        await new PlaywrightBrowserEngine()
          .start({
            ...config,
            profile: {
              mode: "persistent",
              name: "test-profile",
            },
            profileUserDataDir:
              userDataDir,
          });

      sessions.push(session);

      const pages =
        await session.pages();

      expect(pages.length).toBeGreaterThan(0);
      expect(
        pages.some(
          (page) => page.active,
        ),
      ).toBe(true);
    } finally {
      while (sessions.length > 0) {
        await sessions.pop()?.close();
      }

      await rm(
        userDataDir,
        {
          recursive: true,
          force: true,
        },
      );
    }
  });

  it("requires a resolved directory for persistent profiles", async () => {
    await expect(
      new PlaywrightBrowserEngine()
        .start({
          ...config,
          profile: {
            mode: "persistent",
            name: "test-profile",
          },
        }),
    ).rejects.toMatchObject({
      code: "INVALID_CONFIGURATION",
    });
  });

  it("saves persistent session downloads through the managed directory policy", async () => {
    const userDataDir =
      await mkdtemp(
        join(
          tmpdir(),
          "rove-profile-downloads-",
        ),
      );
    const server = await startServer();

    try {
      const session =
        await new PlaywrightBrowserEngine()
          .start({
            ...config,
            profile: {
              mode: "persistent",
              name: "downloads-test",
            },
            profileUserDataDir:
              userDataDir,
          });

      sessions.push(session);

      await session.navigate(`${server.url}/download`);
      const inspection = await session.inspect();
      await session.click(target(inspection, "Download file"));
      await session.click(target(inspection, "Download file"));

      const downloadsDirectory = join(
        userDataDir,
        "downloads",
        "profile_downloads-test",
      );

      await expect(
        waitForFile(join(downloadsDirectory, "rove-session-download.txt")),
      ).resolves.toBe("rove session download");
      await expect(
        waitForFile(join(downloadsDirectory, "rove-session-download (1).txt")),
      ).resolves.toBe("rove session download");
    } finally {
      while (sessions.length > 0) {
        await sessions.pop()?.close();
      }

      await rm(
        userDataDir,
        {
          recursive: true,
          force: true,
        },
      );
    }
  });

  it("keeps direct existing-profile attachment disabled", async () => {
    await expect(
      new PlaywrightBrowserEngine()
        .start({
          ...config,
          profile: {
            mode: "existing",
            userDataDir:
              "/tmp/not-used",
          },
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

});
