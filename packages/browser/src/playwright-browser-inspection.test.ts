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
  profile: {
    mode: "temporary",
  },
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

    if (pages.length === count) {
      return pages;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${count} browser pages.`);
}

async function waitForInspectionText(
  session: BrowserSession,
  text: string,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const inspection = await session.inspect();

    if (inspection.text?.includes(text)) {
      return inspection;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for inspection text: ${text}`);
}

afterEach(async () => {
  while (sessions.length > 0) {
    await sessions.pop()?.close();
  }

  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe("PlaywrightBrowserSession inspection", () => {
  it("inspects the active page through the public session contract", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(server.url);

    const inspection = await session.inspect();

    expect(inspection).toMatchObject({
      pageId: "page_01",
      revision: 1,
      url: new URL("/", server.url).href,
      title: "Rove Inspection Fixture",
      viewport: {
        width: 1440,
        height: 900,
      },
    });

    expect(inspection.text).toContain("Visible fixture description");

    expect(inspection.targets?.[0]?.ref).toBe("t1");
  });

  it("inspects an explicit page without changing the active page", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(`${server.url}/popup`);

    await waitForPageCount(session, 2);

    const before = await session.pages();

    expect(before.find((page) => page.id === "page_02")?.active).toBe(true);

    const inspection = await session.inspect({
      pageId: "page_01",
    });

    expect(inspection.pageId).toBe("page_01");

    const after = await session.pages();

    expect(after.find((page) => page.id === "page_02")?.active).toBe(true);

    expect(after.find((page) => page.id === "page_01")?.active).toBe(false);
  });

  it("rejects inspection of an unknown page", async () => {
    const session = await startSession();

    await expect(
      session.inspect({
        pageId: "page_99",
      }),
    ).rejects.toMatchObject({
      code: "PAGE_NOT_FOUND",
    });
  });

  it("explicitly invalidates only the active page revision", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(`${server.url}/popup`);

    await waitForPageCount(session, 2);

    const before = await session.pages();

    const page1Before = before.find((page) => page.id === "page_01");

    const page2Before = before.find((page) => page.id === "page_02");

    expect(page2Before?.active).toBe(true);

    await session.invalidateTargets();

    const after = await session.pages();

    const page1After = after.find((page) => page.id === "page_01");

    const page2After = after.find((page) => page.id === "page_02");

    expect(page1After?.revision).toBe(page1Before?.revision);

    expect(page2After?.revision).toBe((page2Before?.revision ?? 0) + 1);
  });

  it("returns fresh refs against the new revision after invalidation", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(server.url);

    const first = await session.inspect();

    expect(first.targets?.[0]?.ref).toBe("t1");

    const firstRevision = first.revision;

    await session.invalidateTargets();

    const second = await session.inspect();

    expect(second.revision).toBe(firstRevision + 1);

    expect(second.targets?.[0]?.ref).toBe("t1");
  });

  it("allows inspected targets to drive Milestone 3 actions", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(server.url);

    const inspection = await session.inspect();

    await expect(
      session.click({
        pageId: inspection.pageId,
        revision: inspection.revision,
        ref: inspection.targets![0]!.ref,
      }),
    ).resolves.toMatchObject({ ok: true, action: "click" });
  });

  it("inspects and clicks targets inside iframes", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(`${server.url}/iframes`);

    const inspection = await waitForInspectionText(
      session,
      "cross origin frame loaded",
    );

    expect(inspection.text).toContain("same origin frame loaded");
    expect(inspection.text).toContain("cross origin frame loaded");
    expect(inspection.metadata).toMatchObject({
      frames: expect.arrayContaining([
        expect.objectContaining({
          index: 0,
          main: true,
        }),
        expect.objectContaining({
          index: 1,
          main: false,
        }),
        expect.objectContaining({
          index: 2,
          main: false,
        }),
      ]),
    });

    const target = inspection.targets?.find(
      (candidate) => candidate.name === "Same frame button",
    );

    expect(target).toBeDefined();

    await expect(
      session.click({
        pageId: inspection.pageId,
        revision: inspection.revision,
        ref: target!.ref,
      }),
    ).resolves.toMatchObject({ ok: true, action: "click" });

    expect((await session.inspect()).text).toContain("Same frame clicked");
  });
});

describe("Milestone 2 semantic inspection acceptance", () => {
  it("returns the complete deterministic fixture semantics", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(server.url);

    const inspection = await session.inspect();

    expect(inspection.pageId).toBe("page_01");
    expect(inspection.revision).toBe(1);
    expect(inspection.url).toBe(new URL("/", server.url).href);
    expect(inspection.title).toBe("Rove Inspection Fixture");

    expect(inspection.viewport).toEqual({
      width: 1440,
      height: 900,
    });

    expect(inspection.text).toContain("Rove Inspection Fixture");

    expect(inspection.text).toContain("Visible fixture description");

    expect(inspection.text).not.toContain("Hidden fixture text");

    const targets = inspection.targets ?? [];

    expect(
      targets.find(
        (target) => target.kind === "link" && target.name === "View details",
      ),
    ).toMatchObject({
      visible: true,
      enabled: true,
    });

    expect(
      targets.find(
        (target) => target.kind === "button" && target.name === "Submit",
      ),
    ).toMatchObject({
      visible: true,
      enabled: true,
    });

    expect(
      targets.find(
        (target) => target.kind === "input" && target.name === "Search jobs",
      ),
    ).toMatchObject({
      visible: true,
      enabled: true,
    });

    expect(
      targets.find(
        (target) => target.kind === "input" && target.sensitive === true,
      ),
    ).toBeDefined();

    expect(
      targets.find(
        (target) => target.kind === "checkbox" && target.name === "Remote only",
      ),
    ).toMatchObject({
      visible: true,
      enabled: true,
    });

    expect(
      targets.find(
        (target) => target.kind === "select" && target.name === "Sort results",
      ),
    ).toMatchObject({
      visible: true,
      enabled: true,
    });

    expect(
      targets.find(
        (target) =>
          target.kind === "button" && target.name === "Disabled action",
      ),
    ).toMatchObject({
      visible: true,
      enabled: false,
    });

    expect(targets.some((target) => target.name === "Hidden action")).toBe(
      false,
    );

    expect(
      targets.find(
        (target) => target.kind === "button" && target.name === "Custom action",
      ),
    ).toMatchObject({
      visible: true,
      enabled: true,
    });

    expect(
      targets.some(
        (target) =>
          target.role === "heading" || target.name === "Structural role",
      ),
    ).toBe(false);
  });

  it("returns unique compact tN refs", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(server.url);

    const inspection = await session.inspect();

    const refs = inspection.targets?.map((target) => target.ref) ?? [];

    expect(refs.length).toBeGreaterThan(0);

    expect(new Set(refs).size).toBe(refs.length);

    for (const ref of refs) {
      expect(ref).toMatch(/^t\d+$/);
    }

    expect(refs[0]).toBe("t1");
  });

  it("bounds visible text and reports truncation", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(server.url);

    const inspection = await session.inspect({
      maxTextChars: 50,
    });

    expect(inspection.text?.length).toBeLessThanOrEqual(50);

    expect(inspection.metadata).toMatchObject({
      textTruncated: true,
    });
  });

  it("limits targets after eligibility filtering", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(server.url);

    const inspection = await session.inspect({
      targetLimit: 2,
    });

    expect(inspection.targets).toHaveLength(2);

    expect(inspection.targets?.map((target) => target.ref)).toEqual([
      "t1",
      "t2",
    ]);

    expect(inspection.metadata).toMatchObject({
      targetsTruncated: true,
    });
  });

  it("filters inspection targets by kind", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(server.url);

    const inspection = await session.inspect({
      targetKinds: ["button"],
    });

    expect(inspection.targets?.length).toBeGreaterThan(0);

    expect(
      inspection.targets?.every((target) => target.kind === "button"),
    ).toBe(true);

    expect(inspection.targets?.some((target) => target.kind === "link")).toBe(
      false,
    );

    expect(inspection.targets?.some((target) => target.kind === "input")).toBe(
      false,
    );

    expect(inspection.targets?.some((target) => target.kind === "select")).toBe(
      false,
    );
  });

  it("omits unrequested inspection sections entirely", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(server.url);

    const inspection = await session.inspect({
      includeText: false,
      includeTargets: false,
      includeViewport: false,
    });

    expect(inspection).not.toHaveProperty("text");
    expect(inspection).not.toHaveProperty("targets");
    expect(inspection).not.toHaveProperty("viewport");

    expect(inspection).toMatchObject({
      pageId: "page_01",
      revision: 1,
      url: new URL("/", server.url).href,
      title: "Rove Inspection Fixture",
    });
  });

  it("preserves revision across repeated inspections", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(server.url);

    const first = await session.inspect();
    const second = await session.inspect();
    const third = await session.inspect();

    expect(second.revision).toBe(first.revision);
    expect(third.revision).toBe(first.revision);
  });

  it("increments revision only when targets are explicitly invalidated", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(server.url);

    const first = await session.inspect();

    await session.invalidateTargets();

    const second = await session.inspect();

    expect(second.revision).toBe(first.revision + 1);

    expect(second.targets?.[0]?.ref).toBe("t1");
  });

  it("keeps inspection metadata small and deterministic", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(server.url);

    const inspection = await session.inspect();

    expect(Object.keys(inspection.metadata ?? {}).sort()).toEqual([
      "browserEvidence",
      "pageState",
      "pageStateFingerprint",
      "pageStatePropositions",
      "targetsTruncated",
      "textTruncated",
    ]);

    expect(inspection.metadata).toMatchObject({
      pageState: {
        kind: "ready",
        confidence: "high",
        recommendedAction: "continue",
      },
      pageStatePropositions: {
        primaryContentAvailable: true,
        documentUnstable: false,
        authenticationRequired: false,
        humanVerificationPresented: false,
        accessRestricted: false,
        errorPresented: false,
        interstitialPresented: false,
      },
      textTruncated: false,
      targetsTruncated: false,
    });

    expect(
      (
        inspection.metadata as {
          pageState?: {
            signals?: unknown;
          };
        }
      ).pageState?.signals,
    ).toEqual(expect.any(Array));

    expect(
      (
        inspection.metadata as {
          pageStateFingerprint?: unknown;
        }
      ).pageStateFingerprint,
    ).toMatch(/^[a-f0-9]{64}$/);
  });
});
