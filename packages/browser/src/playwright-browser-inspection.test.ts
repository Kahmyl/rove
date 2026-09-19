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

  it("carries selected composite-item state onto an actionable descendant", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(`${server.url}/semantic-clipboard-transfer`);

    const inspection = await session.inspect();
    const cell = inspection.targets?.find(
      (candidate) =>
        candidate.kind === "gridcell" && candidate.name === "Quarterly report",
    );

    expect(cell).toMatchObject({
      state: { selected: true },
    });
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

  it("bounds inspection while a high-cardinality interactive tree is hydrating", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(`${server.url}/hydration-churn`);

    const startedAt = performance.now();
    await expect(session.inspect()).rejects.toMatchObject({
      code: "PAGE_CHANGED",
      retryable: true,
    });
    expect(performance.now() - startedAt).toBeLessThan(3_000);

    await new Promise((resolve) => setTimeout(resolve, 1_600));
    const stable = await session.inspect();
    expect(stable.targets).toHaveLength(200);
    expect(stable.metadata).toMatchObject({
      targetsTruncated: true,
      targetCoverage: {
        semanticInteractiveCount: 300,
        registeredTargetCount: 300,
        exposedTargetCount: 200,
      },
    });
  });

  it.each(["list", "grid"] as const)(
    "tracks recycled %s content without treating the render window as complete authority",
    async (kind) => {
      const server = await startServer();
      const session = await startSession();
      await session.navigate(`${server.url}/virtualized-${kind}`);

      let observation = await session.inspect();
      const authoritative = await session.readObservation(
        observation.observationId,
      );
      expect(authoritative.targetEvidence).toEqual({
        source: "canonical_registry",
        completeness: "incomplete",
        incompleteReasons: ["virtualized_content_unrendered"],
      });
      expect(observation.metadata).toMatchObject({
        targetCoverage: {
          virtualizedContentIncomplete: true,
          virtualizedLogicalItemCount: 20,
          virtualizedRenderedItemCount: 4,
        },
      });

      const recycled = observation.targets?.find(
        (candidate) => candidate.name === "Open Item 01",
      );
      expect(recycled).toBeDefined();
      const viewportTarget = observation.targets?.find(
        (candidate) => candidate.name === "Records",
      );
      expect(viewportTarget).toBeDefined();
      await session.interact(
        {
          kind: "precise_scroll",
          target: {
            pageId: observation.pageId,
            revision: observation.revision,
            ref: viewportTarget!.ref,
          },
          deltaX: 0,
          deltaY: 600,
        },
        { observationId: observation.observationId },
      );
      observation = await waitForInspectionText(session, "Open Item 16");
      expect(
        observation.targets?.some(
          (candidate) => candidate.name === "Open Item 16",
        ),
      ).toBe(true);
      await expect(
        session.interact(
          {
            kind: "click",
            target: {
              pageId: authoritative.pageId,
              revision: authoritative.revision,
              ref: recycled!.ref,
            },
          },
          { observationId: authoritative.observationId },
        ),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/TARGET_STALE|OBSERVATION_STALE/),
      });

      for (const [action, proposition] of [
        [
          "Create logical item",
          "Created Item 21 outside the current render window",
        ],
        [
          "Rename logical item",
          "Renamed Item 18 to Renamed 18 outside the current render window",
        ],
        [
          "Move logical item",
          "Moved Item 17 to Archive outside the current render window",
        ],
        [
          "Remove logical item",
          "Removed Item 16 outside the current render window",
        ],
      ] as const) {
        observation = await session.inspect();
        const control = observation.targets?.find(
          (candidate) => candidate.name === action,
        );
        expect(control).toBeDefined();
        await session.click({
          pageId: observation.pageId,
          revision: observation.revision,
          ref: control!.ref,
        });
        const successor = await session.inspect({ maxTextChars: 1 });
        await expect(
          session.readPageText(successor.observationId, proposition),
        ).resolves.toMatchObject({ state: "present" });
      }
    },
  );

  it("fences an aborted inspection before it can publish late target authority", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(`${server.url}/hydration-churn`);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 25);
    try {
      await expect(session.inspect({}, abort.signal)).rejects.toMatchObject({
        name: "AbortError",
      });
    } finally {
      clearTimeout(timer);
    }

    await new Promise((resolve) => setTimeout(resolve, 1_600));
    const current = await session.inspect();
    const target = current.targets?.[0];
    expect(target).toBeDefined();
    await expect(
      session.readObservation(current.observationId),
    ).resolves.toMatchObject({
      observationId: current.observationId,
    });
    await expect(
      session.click({
        pageId: current.pageId,
        revision: current.revision,
        ref: target!.ref,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("allows inspected targets to drive actions", async () => {
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

  it("reads an observation-bound exact text proposition across inspected frames", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(`${server.url}/iframes`);
    const observation = await waitForInspectionText(
      session,
      "cross origin frame loaded",
    );

    await expect(
      session.readPageText(
        observation.observationId,
        "cross origin frame loaded",
      ),
    ).resolves.toMatchObject({
      observationId: observation.observationId,
      query: "cross origin frame loaded",
      state: "present",
      frameCount: 3,
      checkedFrameCount: 3,
      failedFrames: [],
    });
    await expect(
      session.readPageText(observation.observationId, "not rendered anywhere"),
    ).resolves.toMatchObject({ state: "absent" });

    await session.navigate(`${server.url}/history-a`);
    await expect(
      session.readPageText(observation.observationId, "Iframe fixture"),
    ).rejects.toMatchObject({ code: "OBSERVATION_STALE" });
  });
});

describe("semantic inspection acceptance", () => {
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
      scrollX: 0,
      scrollY: 0,
      deviceScaleFactor: 1,
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

  it("retains canonical target authority behind a presentation-limited observation", async () => {
    const server = await startServer();
    const session = await startSession();

    await session.navigate(server.url);

    const presented = await session.inspect({
      targetLimit: 1,
    });

    const authoritative = await session.readObservation(
      presented.observationId,
    );

    expect(presented.targets).toHaveLength(1);
    expect(presented.metadata).toMatchObject({
      targetsTruncated: true,
    });
    expect(authoritative.targets?.length).toBeGreaterThan(1);
    expect(authoritative.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Submit",
        }),
      ]),
    );
    expect(authoritative.targetEvidence).toEqual({
      source: "canonical_registry",
      completeness: "complete",
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
      includeStructure: false,
    });

    expect(inspection).not.toHaveProperty("text");
    expect(inspection).not.toHaveProperty("targets");
    expect(inspection).not.toHaveProperty("viewport");
    expect(inspection).not.toHaveProperty("structure");

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
      "pageStateDiagnostics",
      "pageStateFingerprint",
      "pageStatePropositions",
      "targetCoverage",
      "targetsTruncated",
      "textTruncated",
    ]);

    expect(inspection.metadata).toMatchObject({
      pageState: {
        kind: "ready",
        confidence: "high",
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
          pageState?: Record<string, unknown>;
        }
      ).pageState,
    ).not.toHaveProperty("recommendedAction");

    expect(
      (
        inspection.metadata as {
          pageStateFingerprint?: unknown;
        }
      ).pageStateFingerprint,
    ).toMatch(/^[a-f0-9]{64}$/);
  });
  it("returns redacted hierarchy, geometry, frames, and open-shadow controls", async () => {
    const server = await startServer();

    const session = await startSession();

    await session.navigate(server.url);

    const inspection = await session.inspect();

    expect(inspection.observationId).toMatch(/^bobs_[a-f0-9]+$/);

    expect(inspection.document).toEqual({
      url: inspection.url,
      revision: inspection.revision,
    });

    const structure = JSON.stringify(inspection.structure);

    expect(structure).toContain("Alpha");

    expect(structure).toContain("Beta");

    expect(structure).toContain("Shadow action");

    expect(structure).not.toContain("private-query-value");

    const shadow = inspection.targets?.find(
      (item) => item.name === "Shadow action",
    );

    expect(shadow).toMatchObject({
      shadowRootDepth: 1,
      geometry: {
        bounds: expect.any(Object),
        occluded: false,
      },
    });

    const covered = inspection.targets?.find(
      (item) => item.name === "Covered action",
    );

    expect(covered).toMatchObject({
      geometry: {
        bounds: expect.any(Object),
        occluded: true,
      },
    });
  });

  it("rejects pre-recovery visual and target authority in a fresh browser session", async () => {
    const server = await startServer();
    const beforeRecovery = await startSession();
    const staleVisualObservation = await beforeRecovery.inspect();
    await expect(
      beforeRecovery.screenshot({
        mode: "viewport",
        observationId: staleVisualObservation.observationId,
      }),
    ).resolves.toMatchObject({ mimeType: "image/png" });

    await beforeRecovery.navigate(server.url);
    const staleObservation = await beforeRecovery.inspect();
    const staleTarget = staleObservation.targets?.[0];
    expect(staleTarget).toBeDefined();

    await beforeRecovery.close();

    const afterRecovery = await startSession();

    await expect(
      afterRecovery.readObservation(staleVisualObservation.observationId),
    ).rejects.toMatchObject({ code: "OBSERVATION_STALE" });
    await expect(
      afterRecovery.screenshot({
        mode: "viewport",
        observationId: staleVisualObservation.observationId,
      }),
    ).rejects.toMatchObject({ code: "OBSERVATION_STALE" });
    await expect(
      afterRecovery.click({
        sessionId: staleObservation.sessionId,
        pageId: staleObservation.pageId,
        revision: staleObservation.revision,
        ref: staleTarget!.ref,
      }),
    ).rejects.toMatchObject({ code: "TARGET_STALE" });

    const freshObservation = await afterRecovery.inspect();
    await expect(
      afterRecovery.screenshot({
        mode: "viewport",
        observationId: freshObservation.observationId,
      }),
    ).resolves.toMatchObject({ mimeType: "image/png" });
  });
});
