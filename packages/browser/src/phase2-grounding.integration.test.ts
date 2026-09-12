import { afterEach, describe, expect, it } from "vitest";

import { PlaywrightBrowserEngine } from "./playwright-browser-engine.js";

import {
  startFixtureServer,
  type FixtureServer,
} from "./fixtures/fixture-server.js";

import type { BrowserSession } from "./engine.js";

const sessions: BrowserSession[] = [];

const servers: FixtureServer[] = [];

afterEach(async () => {
  while (sessions.length > 0) {
    await sessions.pop()?.close();
  }

  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

describe("Phase 2 perceived controls", () => {
  it("attaches capabilities, structural scopes, and verification state to the current BrowserObservation", async () => {
    const server = await startFixtureServer();

    servers.push(server);

    const session = await new PlaywrightBrowserEngine().start({
      browser: "chromium",
      headless: true,
      profile: {
        mode: "temporary",
      },
    });

    sessions.push(session);

    await session.navigate(`${server.url}/actions`);

    const observation = await session.inspect();

    const search = observation.targets?.find(
      (target) => target.name === "Search",
    );

    const select = observation.targets?.find(
      (target) => target.name === "Sort",
    );

    expect(search?.perceived?.capabilities).toContain("fill");

    expect(
      search?.perceived?.scopes.some((scope) => scope.kind === "form"),
    ).toBe(true);

    expect(select?.perceived?.capabilities).toContain("select");

    expect(select?.state?.selectedValues).toEqual(["newest"]);
  });

  it("grounds only against an exact current observation", async () => {
    const server = await startFixtureServer();

    servers.push(server);

    const session = await new PlaywrightBrowserEngine().start({
      browser: "chromium",
      headless: true,
      profile: {
        mode: "temporary",
      },
    });

    sessions.push(session);

    await session.navigate(`${server.url}/actions`);

    const observation = await session.inspect();

    const resolution = await session.resolveTarget({
      observationId: observation.observationId,
      intent: {
        capability: "activate",
        text: "Change state",
      },
    });

    expect(resolution).toMatchObject({
      status: "selected",
      target: {
        pageId: observation.pageId,
        revision: observation.revision,
      },
    });

    await session.scroll({
      direction: "down",
      amount: 100,
    });

    await expect(
      session.resolveTarget({
        observationId: observation.observationId,
        intent: {
          text: "Change state",
        },
      }),
    ).rejects.toMatchObject({
      code: "OBSERVATION_STALE",
      retryable: true,
    });
  });

  it("grounds against the canonical index when target presentation is limited", async () => {
    const server = await startFixtureServer();
    servers.push(server);
    const session = await new PlaywrightBrowserEngine().start({
      browser: "chromium",
      headless: true,
      profile: { mode: "temporary" },
    });
    sessions.push(session);
    await session.navigate(`${server.url}/actions`);

    const observation = await session.inspect({ targetLimit: 1 });
    expect(observation.targets).toHaveLength(1);
    expect(observation.targets?.[0]?.name).not.toBe("Change state");

    await expect(
      session.resolveTarget({
        observationId: observation.observationId,
        intent: { capability: "activate", text: "Change state" },
      }),
    ).resolves.toMatchObject({
      status: "selected",
      target: { pageId: observation.pageId },
    });
  });

  it("uses whole-token name fallback against canonical target authority", async () => {
    const server = await startFixtureServer();
    servers.push(server);
    const session = await new PlaywrightBrowserEngine().start({
      browser: "chromium",
      headless: true,
      profile: { mode: "temporary" },
    });
    sessions.push(session);
    await session.navigate(`${server.url}/token-sequence-grounding`);

    const observation = await session.inspect({ targetLimit: 1 });
    expect(observation.targets).toHaveLength(1);
    expect(observation.targets?.[0]?.name).not.toBe(
      "2026 Quarterly Report (PDF)",
    );

    const resolution = await session.resolveTarget({
      observationId: observation.observationId,
      intent: {
        capability: "activate",
        text: "Quarterly Report PDF",
      },
    });

    expect(resolution).toMatchObject({
      status: "selected",
      target: { pageId: observation.pageId },
      reason: "grounded",
    });
    expect(resolution.alternatives[0]).toMatchObject({
      target: resolution.target,
      evidence: expect.arrayContaining([
        "capability_match",
        "partial_name_match",
        "actionable",
      ]),
    });
  });
});
