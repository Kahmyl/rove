import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  PlaywrightBrowserEngine,
  type BrowserEngine,
  type BrowserSession,
} from "@rove/browser";
import { loadConfig } from "@rove/config";
import {
  RoveError,
  type BrowserRuntimeCapabilities,
  type PageInspection,
  type TargetReference,
} from "@rove/protocol";
import {
  FileEvidenceStore,
  FileObservationStore,
  FileSessionStore,
} from "@rove/storage";
import {
  startFixtureServer,
  type FixtureServer,
} from "../../../packages/browser/src/fixtures/fixture-server.js";
import { BrowserService } from "./browser/browser.service.js";
import { BrowserCommandCoordinator } from "./control/command-coordinator.js";
import { BrowserOwnershipFence } from "./control/browser-ownership-fence.js";
import { ControlService } from "./control/control.service.js";
import { ControlWaitService } from "./control/control-wait.service.js";
import { OwnershipTransitionService } from "./control/ownership-transition.service.js";
import { EvidenceService } from "./evidence/evidence.service.js";
import { ObservationService } from "./observation/observation.service.js";
import { InteractionPolicy } from "./policy/interaction-policy.js";
import { RuntimeService } from "./runtime.service.js";
import { SessionService } from "./session/session.service.js";

interface Harness {
  home: string;
  runtime: RuntimeService;
  browser: BrowserService;
  sessions: SessionService;
  ownershipFence: BrowserOwnershipFence;
}

const homes: string[] = [];
const servers: FixtureServer[] = [];
const active: { runtime: RuntimeService; id: string }[] = [];
const testCapabilities: BrowserRuntimeCapabilities = {
  browserFamily: "chromium",
  distribution: "chromium",
  browserVersion: "test",
  headless: true,
  profile: { mode: "temporary" },
  downloads: { managed: true, evidence: true },
  storage: {
    cookies: true,
    localStorage: true,
    indexedDb: true,
    cacheStorage: true,
    sessionStorage: "page_scoped",
    serviceWorkers: true,
  },
  humanInteraction: { available: false },
  sandbox: { requested: true, verified: "unknown" },
  diagnostics: [],
};

async function harness(
  engine: BrowserEngine = new PlaywrightBrowserEngine(),
  browserPolicy: {
    headless?: boolean;
    minimumActionIntervalMs?: number;
  } = {},
): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), "rove-runtime-"));
  homes.push(home);
  const sessions = new SessionService(new FileSessionStore(home));
  const browser = new BrowserService(engine);
  const observations = new ObservationService(new FileObservationStore(home));
  const ownershipFence = new BrowserOwnershipFence();

  const runtime = new RuntimeService(
    sessions,
    new ControlService(),
    new ControlWaitService(sessions, observations),
    new BrowserCommandCoordinator(),
    browser,
    observations,
    new EvidenceService(new FileEvidenceStore(home)),
    (() => {
      const config = loadConfig({
        cwd: home,
        env: { ROVE_BROWSER: "chromium", ROVE_BROWSER_HEADLESS: "true" },
      });

      return {
        ...config,
        browser: {
          ...config.browser,
          ...(browserPolicy.headless === undefined
            ? {}
            : { headless: browserPolicy.headless }),
          ...(browserPolicy.minimumActionIntervalMs === undefined
            ? {}
            : {
                minimumActionIntervalMs: browserPolicy.minimumActionIntervalMs,
              }),
        },
      };
    })(),
    ownershipFence,
  );

  return {
    home,
    runtime,
    browser,
    sessions,
    ownershipFence,
  };
}

async function fixture(): Promise<FixtureServer> {
  const server = await startFixtureServer();
  servers.push(server);
  return server;
}

function target(inspection: PageInspection, name: string): TargetReference {
  const item = inspection.targets?.find((candidate) => candidate.name === name);
  if (!item) throw new Error(`Missing target ${name}`);
  return {
    pageId: inspection.pageId,
    revision: inspection.revision,
    ref: item.ref,
  };
}

function readyBrowserSession(id: string): BrowserSession {
  return {
    id,
    capabilities: testCapabilities,
    onActivity: () => () => undefined,
    inspect: async () => ({
      pageId: "page_01",
      revision: 0,
      url: "about:blank",
      title: "",
      metadata: {
        pageState: {
          kind: "ready",
          confidence: "high",
          signals: ["test:ready"],
          recommendedAction: "continue",
        },
      },
    }),
    pages: async () => [
      {
        id: "page_01",
        url: "about:blank",
        title: "",
        active: true,
        revision: 0,
      },
    ],
    close: async () => undefined,
  } as unknown as BrowserSession;
}

async function waitForObservation(
  runtime: RuntimeService,
  sessionId: string,
  type: string,
) {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const observations = await runtime.getObservations(sessionId);

    const observation = observations.items.find((item) => item.type === type);

    if (observation !== undefined) {
      return observation;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for observation ${type}.`);
}

async function allFileText(directory: string): Promise<string> {
  const chunks: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) chunks.push(await allFileText(path));
    else chunks.push((await readFile(path)).toString("utf8"));
  }
  return chunks.join("\n");
}

afterEach(async () => {
  while (active.length > 0) {
    const item = active.pop()!;
    await item.runtime.endSession(item.id).catch(() => undefined);
  }
  while (servers.length > 0) await servers.pop()?.close();
  while (homes.length > 0)
    await rm(homes.pop()!, { recursive: true, force: true });
});

describe("Milestone 4 runtime integration", () => {
  it("starts real agent, companion, and capture sessions with the correct lifecycle", async () => {
    const { runtime, browser, home } = await harness();
    const agent = await runtime.startSession({ mode: "agent" });
    active.push({ runtime, id: agent.id });
    expect(agent).toMatchObject({
      status: "active",
      controller: "agent",
      activePageId: "page_01",
    });
    expect(agent.browserRuntime).toMatchObject({
      browserFamily: "chromium",
      distribution: "chromium",
      headless: true,
      profile: { mode: "temporary" },
      downloads: { managed: true, evidence: true },
    });
    expect(["enabled", "disabled", "unknown"]).toContain(
      agent.browserRuntime?.sandbox.verified,
    );
    expect(agent.browserRuntime?.sandbox.requested).toBe(
      process.platform !== "win32",
    );
    expect(agent.browserRuntime?.sandbox.verificationMethod).toBe(
      "chrome_sandbox_page",
    );
    expect(agent.browserRuntime?.sandbox.diagnostic?.length).toBeGreaterThan(0);
    expect(agent.id).toMatch(/^ses_/);
    expect(browser.has(agent.id)).toBe(true);
    expect(
      JSON.parse(
        await readFile(
          join(home, "sessions", agent.id, "session.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ status: "active" });
    expect(
      (await runtime.getObservations(agent.id)).items.map((item) => item.type),
    ).toEqual(["session_started"]);

    const companion = await runtime.startSession({ mode: "companion" });
    active.push({ runtime, id: companion.id });
    expect(companion.controller).toBe("agent");

    const capture = await runtime.startSession({ mode: "capture" });
    active.push({ runtime, id: capture.id });
    expect(capture.controller).toBe("human");
    await expect(
      runtime.navigate(capture.id, { url: "about:blank" }),
    ).rejects.toMatchObject({ code: "CONTROL_NOT_OWNED" });
  });

  it("persists failed startup and its observation", async () => {
    const failing: BrowserEngine = {
      start: async () => {
        throw new RoveError({
          code: "BROWSER_LAUNCH_FAILED",
          message: "Expected launch failure.",
        });
      },
    };
    const { runtime, sessions, home } = await harness(failing);
    let sessionId = "";
    try {
      await runtime.startSession({ mode: "agent" });
    } catch (error) {
      expect(error).toMatchObject({ code: "BROWSER_LAUNCH_FAILED" });
      const sessionDirectories = await readdir(join(home, "sessions"));
      sessionId = sessionDirectories[0]!;
    }
    const failed = await sessions.get(sessionId);
    expect(failed).toMatchObject({ status: "failed", controller: null });
    expect(failed.endedAt).toBeDefined();
    expect(
      (await runtime.getObservations(sessionId)).items.map((item) => item.type),
    ).toEqual(["session_failed"]);
  });

  it("creates Rove-managed persistent profile metadata before browser launch", async () => {
    const { runtime, home } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      profile: {
        mode: "persistent",
        name: "default",
      },
    });
    active.push({ runtime, id: session.id });

    const metadata = JSON.parse(
      await readFile(
        join(home, ".rove", "profiles", "default", "profile.json"),
        "utf8",
      ),
    );

    expect(metadata).toMatchObject({
      name: "default",
      browserDistribution: "chromium",
    });
    expect(metadata.createdAt).toEqual(expect.any(String));
    expect(metadata.lastUsedAt).toEqual(expect.any(String));
  });

  it("rejects a second active persistent session using the same profile", async () => {
    let starts = 0;
    const engine: BrowserEngine = {
      start: async () => {
        starts += 1;
        return readyBrowserSession(`browser_${starts}`);
      },
    };

    const { runtime } = await harness(engine);
    const first = await runtime.startSession({
      mode: "agent",
      profile: {
        mode: "persistent",
        name: "default",
      },
    });
    active.push({ runtime, id: first.id });

    await expect(
      runtime.startSession({
        mode: "agent",
        profile: {
          mode: "persistent",
          name: "default",
        },
      }),
    ).rejects.toMatchObject({
      code: "PROFILE_LOCKED",
    });

    expect(starts).toBe(1);
  });

  it("keeps repeated direct inspection observational while returning page policy", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness();

    const session = await runtime.startSession({ mode: "agent" });
    active.push({ runtime, id: session.id });

    expect(session).toMatchObject({
      status: "active",
      controller: "agent",
    });
    expect(session.handoff).toBeUndefined();

    // Deliberately move the browser to authentication outside a runtime
    // orchestration boundary. Inspection must observe it, not seize control.
    await browser.get(session.id).navigate(`${server.url}/authentication`);

    const rawInspection = await browser.get(session.id).inspect();

    expect(rawInspection.metadata?.pageState).toMatchObject({
      kind: "authentication_required",
    });
    expect(rawInspection.metadata?.pagePolicy).toBeUndefined();

    for (let index = 0; index < 3; index += 1) {
      const inspection = await runtime.inspectBrowser(session.id);

      expect(inspection.metadata?.pageState).toMatchObject({
        kind: "authentication_required",
      });

      expect(inspection.metadata?.pagePolicy).toMatchObject({
        disposition: "request_human",
        reason: "authentication_required",
        mutationAllowed: false,
        retryable: false,
        errorCode: "AUTHENTICATION_REQUIRED",
      });

      const current = await runtime.getSession(session.id);

      expect(current).toMatchObject({
        status: "active",
        controller: "agent",
      });
      expect(current.handoff).toBeUndefined();
    }

    expect(
      (await runtime.getObservations(session.id)).items.map(
        (item) => item.type,
      ),
    ).toEqual(["session_started"]);
  });

  it("orchestrates authentication only after a successful action boundary", async () => {
    const server = await fixture();
    const { runtime } = await harness();

    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/actions`,
    });
    active.push({ runtime, id: session.id });

    const inspection = await runtime.inspectBrowser(session.id);

    expect(inspection.metadata?.pagePolicy).toMatchObject({
      disposition: "continue",
      mutationAllowed: true,
    });

    const result = await runtime.navigate(session.id, {
      url: `${server.url}/authentication`,
    });

    expect(result.url).toBe(`${server.url}/authentication`);

    expect(await runtime.getSession(session.id)).toMatchObject({
      status: "awaiting_human",
      controller: null,
      handoff: {
        reason:
          "The page requires authentication that must be completed by a human.",
      },
    });

    expect(
      (await runtime.getObservations(session.id)).items.map(
        (item) => item.type,
      ),
    ).toEqual([
      "session_started",
      "browser_navigated",
      "authentication_required",
    ]);
  });

  it("keeps agent ownership when a site explicitly restricts access", async () => {
    const server = await fixture();
    const { runtime } = await harness();

    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/access-restricted`,
    });
    active.push({ runtime, id: session.id });

    expect(session).toMatchObject({
      status: "active",
      controller: "agent",
    });
    expect(session.handoff).toBeUndefined();

    expect(
      (await runtime.getObservations(session.id)).items.map(
        (item) => item.type,
      ),
    ).toEqual(["session_started"]);

    await expect(
      runtime.navigate(session.id, { url: server.url }),
    ).rejects.toMatchObject({
      code: "SITE_ACCESS_RESTRICTED",
      retryable: false,
    });
  });

  it("persists sanitized browser evidence records independently of inspection", async () => {
    const server = await fixture();
    const { runtime } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/evidence-redirect`,
    });
    active.push({ runtime, id: session.id });

    let records = await runtime.listEvidence(session.id);
    const deadline = Date.now() + 3_000;
    while (records.length < 4 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      records = await runtime.listEvidence(session.id);
    }

    expect(records.every((item) => item.label === "browser_evidence")).toBe(
      true,
    );
    expect(records.some((item) => item.metadata?.kind === "navigation")).toBe(
      true,
    );
    expect(
      records.some((item) => item.metadata?.kind === "request_failure"),
    ).toBe(true);

    const payloads = await Promise.all(
      records.map((item) => runtime.readEvidence(session.id, item.id)),
    );
    const serialized = JSON.stringify(payloads);
    expect(serialized).toContain('"status":451');
    expect(serialized).not.toContain("redirect-secret");
    expect(serialized).not.toContain("console-secret");
    expect(serialized).not.toContain("page-secret");
    expect(serialized).not.toContain("request-secret");
  });

  it.each([
    [
      "human-verification",
      "human_verification_required",
      "human verification step",
    ],
    ["authentication", "authentication_required", "requires authentication"],
  ])(
    "automatically requests human control for %s",
    async (route, eventType, reason) => {
      const server = await fixture();
      const { runtime } = await harness();
      const session = await runtime.startSession({
        mode: "agent",
        startUrl: `${server.url}/${route}`,
      });
      active.push({ runtime, id: session.id });

      expect(session).toMatchObject({
        status: "awaiting_human",
        controller: null,
      });
      expect(session.handoff?.reason).toContain(reason);
      expect(
        (await runtime.getObservations(session.id)).items.map(
          (item) => item.type,
        ),
      ).toEqual(["session_started", eventType]);
    },
  );

  it("stops on an unknown interstitial without automatic handoff", async () => {
    const server = await fixture();
    const { runtime } = await harness();

    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/unknown-interstitial`,
    });
    active.push({ runtime, id: session.id });

    expect(session).toMatchObject({
      status: "active",
      controller: "agent",
    });
    expect(session.handoff).toBeUndefined();

    expect(
      (await runtime.getObservations(session.id)).items.map(
        (item) => item.type,
      ),
    ).toEqual(["session_started"]);

    await expect(
      runtime.navigate(session.id, { url: server.url }),
    ).rejects.toMatchObject({
      code: "UNKNOWN_INTERSTITIAL",
      retryable: false,
    });
  });

  describe("F2.5 page-policy state and mode matrix", () => {
    const cases = [
      {
        label: "ready",
        route: "actions",
        pageState: "ready",
        disposition: "continue",
        reason: "page_ready",
        mutationAllowed: true,
        retryable: false,
      },
      {
        label: "authentication",
        route: "authentication",
        pageState: "authentication_required",
        disposition: "request_human",
        reason: "authentication_required",
        mutationAllowed: false,
        retryable: false,
        errorCode: "AUTHENTICATION_REQUIRED",
        handoffObservation: "authentication_required",
      },
      {
        label: "human verification",
        route: "human-verification",
        pageState: "human_verification",
        disposition: "request_human",
        reason: "human_verification_required",
        mutationAllowed: false,
        retryable: false,
        errorCode: "HUMAN_VERIFICATION_REQUIRED",
        handoffObservation: "human_verification_required",
      },
      {
        label: "access restriction",
        route: "access-restricted",
        pageState: "access_restricted",
        disposition: "stop",
        reason: "access_restricted",
        mutationAllowed: false,
        retryable: false,
        errorCode: "SITE_ACCESS_RESTRICTED",
      },
      {
        label: "unknown interstitial",
        route: "unknown-interstitial",
        pageState: "unknown_interstitial",
        disposition: "stop",
        reason: "unknown_interstitial",
        mutationAllowed: false,
        retryable: false,
        errorCode: "UNKNOWN_INTERSTITIAL",
      },
      {
        label: "page error",
        route: "server-error",
        pageState: "error",
        disposition: "stop",
        reason: "page_error",
        mutationAllowed: false,
        retryable: false,
        errorCode: "PAGE_NOT_READY",
      },
      {
        label: "loading",
        route: "loading",
        pageState: "loading",
        disposition: "wait_and_inspect",
        reason: "page_unstable",
        mutationAllowed: false,
        retryable: true,
        errorCode: "PAGE_NOT_READY",
      },
    ] as const;

    const modes = ["agent", "companion", "capture"] as const;

    it.each(
      modes.flatMap((mode) =>
        cases.map((pageCase) => ({
          mode,
          ...pageCase,
        })),
      ),
    )(
      "$mode mode + $label has the frozen F2 ownership behavior",
      async ({
        mode,
        route,
        pageState,
        disposition,
        reason,
        mutationAllowed,
        retryable,
        errorCode,
        handoffObservation,
      }) => {
        const server = await fixture();
        const { runtime } = await harness();

        const session = await runtime.startSession({
          mode,
          startUrl: `${server.url}/${route}`,
        });

        active.push({ runtime, id: session.id });

        const agentOwned = mode !== "capture";
        const automaticHandoff = agentOwned && disposition === "request_human";

        if (automaticHandoff) {
          expect(session).toMatchObject({
            status: "awaiting_human",
            controller: null,
          });
          expect(session.handoff).toBeDefined();

          expect(
            (await runtime.getObservations(session.id)).items.map(
              (item) => item.type,
            ),
          ).toEqual(["session_started", handoffObservation]);

          return;
        }

        expect(session).toMatchObject({
          status: "active",
          controller: mode === "capture" ? "human" : "agent",
        });
        expect(session.handoff).toBeUndefined();

        expect(
          (await runtime.getObservations(session.id)).items.map(
            (item) => item.type,
          ),
        ).toEqual(["session_started"]);

        const beforeInspect = await runtime.getSession(session.id);

        if (mode === "capture") {
          await expect(
            runtime.inspectBrowser(session.id, {
              includeText: false,
              includeTargets: false,
            }),
          ).rejects.toMatchObject({
            code: "CONTROL_NOT_OWNED",
          });

          await expect(runtime.pages(session.id)).rejects.toMatchObject({
            code: "CONTROL_NOT_OWNED",
          });

          await expect(
            runtime.captureScreenshot(session.id),
          ).rejects.toMatchObject({
            code: "CONTROL_NOT_OWNED",
          });

          const afterDeniedReads = await runtime.getSession(session.id);

          expect(afterDeniedReads.status).toBe(beforeInspect.status);
          expect(afterDeniedReads.controller).toBe("human");
          expect(afterDeniedReads.handoff).toEqual(beforeInspect.handoff);

          return;
        }

        const inspection = await runtime.inspectBrowser(session.id, {
          includeText: false,
          includeTargets: false,
        });

        expect(inspection.metadata?.pageState).toMatchObject({
          kind: pageState,
        });

        expect(inspection.metadata?.pagePolicy).toMatchObject({
          disposition,
          reason,
          mutationAllowed,
          retryable,
          ...(errorCode === undefined ? {} : { errorCode }),
        });

        const afterInspect = await runtime.getSession(session.id);

        expect(afterInspect.status).toBe(beforeInspect.status);
        expect(afterInspect.controller).toBe(beforeInspect.controller);
        expect(afterInspect.handoff).toEqual(beforeInspect.handoff);

        // For agent-owned stop/wait states, prove that preserving ownership
        // does not mean autonomous mutation remains authorized.
        if (
          mode !== "capture" &&
          mutationAllowed === false &&
          disposition !== "request_human"
        ) {
          await expect(
            runtime.navigate(session.id, {
              url: `${server.url}/actions`,
            }),
          ).rejects.toMatchObject({
            code: errorCode,
            retryable,
          });

          expect(await runtime.getSession(session.id)).toMatchObject({
            status: "active",
            controller: "agent",
          });
        }
      },
      15_000,
    );
  });

  it("keeps explicit human collaboration available for a stop-only interstitial", async () => {
    const server = await fixture();
    const { runtime } = await harness();

    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/unknown-interstitial`,
    });
    active.push({ runtime, id: session.id });

    expect(session).toMatchObject({
      status: "active",
      controller: "agent",
    });
    expect(session.handoff).toBeUndefined();

    await runtime.requestHuman(session.id, {
      reason: "Please review the unexpected page.",
    });

    expect(await runtime.getSession(session.id)).toMatchObject({
      status: "awaiting_human",
      controller: null,
      handoff: {
        reason: "Please review the unexpected page.",
      },
    });
  });

  it("requires a fresh inspection after human control returns", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/actions`,
    });
    active.push({ runtime, id: session.id });

    await runtime.requestHuman(session.id, { reason: "Smoke-test handoff" });
    await runtime.takeHumanControl(session.id);
    await browser.get(session.id).navigate(`${server.url}/result`);
    await runtime.returnAgentControl(session.id);

    await expect(
      runtime.navigate(session.id, { url: `${server.url}/actions` }),
    ).rejects.toMatchObject({
      code: "INSPECTION_REQUIRED",
    });
    await runtime.inspectBrowser(session.id);
    await expect(
      runtime.navigate(session.id, { url: `${server.url}/actions` }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("requires a fresh inspection after out-of-band navigation changes the page revision", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/history-a`,
    });
    active.push({ runtime, id: session.id });

    const inspected = await runtime.inspectBrowser(session.id, {
      includeText: false,
      includeTargets: false,
    });

    await browser.get(session.id).navigate(`${server.url}/history-b`);

    const activePage = (await browser.get(session.id).pages()).find(
      (page) => page.active,
    );

    expect(activePage?.revision).toBeGreaterThan(inspected.revision);

    await expect(
      runtime.scroll(session.id, {
        direction: "down",
        amount: 100,
      }),
    ).rejects.toMatchObject({
      code: "INSPECTION_REQUIRED",
      retryable: true,
    });

    await runtime.inspectBrowser(session.id);

    await expect(
      runtime.scroll(session.id, {
        direction: "down",
        amount: 100,
      }),
    ).resolves.toMatchObject({
      ok: true,
      action: "scroll",
    });
  });

  it("orchestrates real actions, persistence, evidence, and historical reads without persisting typed values", async () => {
    const server = await fixture();
    const { runtime, browser, home } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/actions`,
    });
    active.push({ runtime, id: session.id });
    expect(session.activePageId).toBe("page_01");
    await runtime.navigate(session.id, { url: `${server.url}/actions` });
    let inspection = await runtime.inspectBrowser(session.id);
    const secret = "DO_NOT_PERSIST_THIS_VALUE";
    const typed = await runtime.type(session.id, {
      target: target(inspection, "Password"),
      value: secret,
    });
    expect(typed.sessionId).toBe(session.id);
    inspection = await runtime.inspectBrowser(session.id);
    const clicked = await runtime.click(session.id, {
      target: target(inspection, "Change state"),
    });
    expect(clicked.sessionId).toBe(session.id);
    const screenshot = await runtime.captureScreenshot(session.id);
    expect(screenshot).toMatchObject({
      sessionId: session.id,
      type: "screenshot",
      metadata: { mimeType: "image/png", mode: "viewport" },
    });
    expect(
      (
        await readdir(
          join(home, "sessions", session.id, "evidence", "screenshots"),
        )
      ).some((name) => name.endsWith(".png")),
    ).toBe(true);

    const record = await runtime.saveEvidence(session.id, {
      type: "record",
      payload: { title: "Senior Backend Engineer", company: "Example" },
    });
    expect(
      (await runtime.listEvidence(session.id)).map((item) => item.id),
    ).toEqual(expect.arrayContaining([screenshot.id, record.id]));
    expect((await runtime.readEvidence(session.id, record.id)).id).toBe(
      record.id,
    );

    const observations = (await runtime.getObservations(session.id)).items;
    expect(observations.map((item) => item.type)).toEqual([
      "session_started",
      "browser_navigated",
      "agent_typed",
      "agent_clicked",
      "screenshot_captured",
      "record_saved",
    ]);
    expect(observations.map((item) => item.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(JSON.stringify(observations)).not.toContain(secret);
    expect(await allFileText(join(home, "sessions", session.id))).not.toContain(
      secret,
    );

    const ended = await runtime.endSession(session.id);
    active.pop();
    expect(ended).toMatchObject({ status: "completed", controller: null });
    expect(ended.endedAt).toBeDefined();
    expect(browser.has(session.id)).toBe(false);
    await expect(runtime.endSession(session.id)).rejects.toMatchObject({
      code: "SESSION_ALREADY_ENDED",
    });
    await expect(runtime.inspectBrowser(session.id)).rejects.toMatchObject({
      code: "SESSION_NOT_ACTIVE",
    });
    await expect(
      runtime.navigate(session.id, { url: server.url }),
    ).rejects.toMatchObject({ code: "SESSION_NOT_ACTIVE" });
    expect((await runtime.getObservations(session.id)).items.at(-1)?.type).toBe(
      "session_completed",
    );
    expect(
      (await runtime.listEvidence(session.id)).filter(
        (item) => item.label !== "browser_evidence",
      ),
    ).toHaveLength(2);

    const recreated = new EvidenceService(new FileEvidenceStore(home));
    expect((await recreated.metadata(session.id, record.id)).id).toBe(
      record.id,
    );
  });

  it("exposes managed browser downloads as file evidence", async () => {
    const server = await fixture();
    const { runtime } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/download`,
    });
    active.push({ runtime, id: session.id });

    const inspection = await runtime.inspectBrowser(session.id);
    await runtime.click(session.id, {
      target: target(inspection, "Download file"),
    });

    const downloaded = await waitForObservation(
      runtime,
      session.id,
      "download_completed",
    );

    expect(downloaded).toMatchObject({
      actor: "browser",
      type: "download_completed",
      data: {
        filename: "rove-session-download.txt",
      },
    });

    const evidence = await runtime.listEvidence(session.id);
    const file = evidence.find((item) => item.type === "file");

    expect(file).toMatchObject({
      sessionId: session.id,
      type: "file",
      label: "rove-session-download.txt",
      metadata: {
        filename: "rove-session-download.txt",
        source: "browser_download",
        sizeBytes: "rove session download".length,
      },
    });

    expect(downloaded.data).toMatchObject({
      evidenceId: file?.id,
    });
    await expect(
      runtime.readEvidence(session.id, file!.id),
    ).resolves.toMatchObject({
      id: file!.id,
      binary: {
        available: true,
        encoding: "external",
      },
    });
  });

  it("serializes runtime mutations per session without blocking another session", async () => {
    const order: string[] = [];
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let markSlowStarted!: () => void;
    const slowStarted = new Promise<void>((resolve) => {
      markSlowStarted = resolve;
    });
    let browserCounter = 0;
    const engine: BrowserEngine = {
      start: async () => {
        const browserId = `browser_fake_${browserCounter++}`;
        return {
          id: browserId,
          capabilities: testCapabilities,
          onActivity: () => () => undefined,
          pages: async () => [
            { id: "page_01", url: "about:blank", active: true, revision: 0 },
          ],
          inspect: async () => ({
            pageId: "page_01",
            revision: 0,
            url: "about:blank",
            title: "",
            metadata: {
              pageState: {
                kind: "ready",
                confidence: "high",
                signals: ["document:stable"],
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
              pageStateFingerprint:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
          }),
          pageStateIdentity: async () => ({
            pageId: "page_01",
            fingerprint:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          }),
          navigate: async (url: string) => {
            if (url.endsWith("/slow")) {
              order.push(`${browserId}:slow:start`);
              markSlowStarted();
              await slowGate;
              order.push(`${browserId}:slow:end`);
            } else {
              order.push(`${browserId}:fast`);
            }
            return {
              ok: true,
              action: "navigate",
              sessionId: browserId,
              pageId: "page_01",
              pageChanged: true,
              previousRevision: 0,
              currentRevision: 1,
              url,
            };
          },
          close: async () => undefined,
        } as BrowserSession;
      },
    };
    const { runtime } = await harness(engine);
    const firstSession = await runtime.startSession({ mode: "agent" });
    const secondSession = await runtime.startSession({ mode: "agent" });
    active.push(
      { runtime, id: firstSession.id },
      { runtime, id: secondSession.id },
    );

    const first = runtime.navigate(firstSession.id, {
      url: "https://example.test/slow",
    });
    await slowStarted;
    const queued = runtime.navigate(firstSession.id, {
      url: "https://example.test/fast",
    });
    await runtime.navigate(secondSession.id, {
      url: "https://example.test/fast",
    });
    expect(order).toEqual(["browser_fake_0:slow:start", "browser_fake_1:fast"]);
    releaseSlow();
    await Promise.all([first, queued]);
    expect(order).toEqual([
      "browser_fake_0:slow:start",
      "browser_fake_1:fast",
      "browser_fake_0:slow:end",
      "browser_fake_0:fast",
    ]);
  });

  it("rechecks page-state freshness after a visible-mode pacing delay", async () => {
    const originalFingerprint = "a".repeat(64);
    const changedFingerprint = "b".repeat(64);
    let currentFingerprint = originalFingerprint;
    let navigationCount = 0;

    const engine: BrowserEngine = {
      start: async () =>
        ({
          id: "browser_freshness_race",
          onActivity: () => () => undefined,
          pages: async () => [
            {
              id: "page_01",
              url: "about:blank",
              active: true,
              revision: 0,
            },
          ],
          inspect: async () => ({
            pageId: "page_01",
            revision: 0,
            url: "about:blank",
            title: "",
            metadata: {
              pageState: {
                kind: "ready",
                confidence: "high",
                signals: ["document:stable"],
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
              pageStateFingerprint: originalFingerprint,
            },
          }),
          pageStateIdentity: async () => ({
            pageId: "page_01",
            fingerprint: currentFingerprint,
          }),
          navigate: async (url: string) => {
            navigationCount += 1;

            return {
              ok: true,
              action: "navigate",
              sessionId: "browser_freshness_race",
              pageId: "page_01",
              pageChanged: true,
              previousRevision: 0,
              currentRevision: navigationCount,
              url,
            };
          },
          close: async () => undefined,
        }) as BrowserSession,
    };

    const { runtime } = await harness(engine, {
      headless: false,
      minimumActionIntervalMs: 120,
    });

    const session = await runtime.startSession({ mode: "agent" });
    active.push({ runtime, id: session.id });

    await runtime.inspectBrowser(session.id);

    await runtime.navigate(session.id, {
      url: "https://example.test/first",
    });

    expect(navigationCount).toBe(1);

    setTimeout(() => {
      currentFingerprint = changedFingerprint;
    }, 25);

    await expect(
      runtime.navigate(session.id, {
        url: "https://example.test/second",
      }),
    ).rejects.toMatchObject({
      code: "INSPECTION_REQUIRED",
      retryable: true,
    });

    expect(navigationCount).toBe(1);
  });
});

describe("Milestone 9 human activity foundation", () => {
  it("persists browser lifecycle activity only while human owns control", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness();

    const capture = await runtime.startSession({
      mode: "capture",
    });

    active.push({
      runtime,
      id: capture.id,
    });

    await browser.get(capture.id).navigate(`${server.url}/actions`);

    const urlChanged = await waitForObservation(
      runtime,
      capture.id,
      "url_changed",
    );

    expect(urlChanged).toMatchObject({
      actor: "human",
      type: "url_changed",
      pageId: "page_01",
      data: {
        previousUrl: "about:blank",
        url: `${server.url}/actions`,
      },
    });

    const navigation = await waitForObservation(
      runtime,
      capture.id,
      "navigation_completed",
    );

    expect(navigation).toMatchObject({
      actor: "human",
      type: "navigation_completed",
      pageId: "page_01",
      data: {
        url: `${server.url}/actions`,
      },
    });

    const agent = await runtime.startSession({
      mode: "agent",
    });

    active.push({
      runtime,
      id: agent.id,
    });

    await browser.get(agent.id).navigate(`${server.url}/actions`);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(
      (await runtime.getObservations(agent.id)).items.map((item) => item.type),
    ).toEqual(["session_started"]);
  });
});

describe("Milestone 9 human DOM activity", () => {
  it("persists ordered minimized human interactions without sensitive field values", async () => {
    const server = await fixture();

    const { runtime, browser, home } = await harness();

    const capture = await runtime.startSession({
      mode: "capture",
    });

    active.push({
      runtime,
      id: capture.id,
    });

    const sessionBrowser = browser.get(capture.id);

    await sessionBrowser.navigate(`${server.url}/actions`);

    await waitForObservation(runtime, capture.id, "navigation_completed");

    const secret = "M9_SECRET_MUST_NEVER_PERSIST";

    let inspection = await sessionBrowser.inspect();

    await sessionBrowser.type(target(inspection, "Password"), secret);

    inspection = await sessionBrowser.inspect();

    await sessionBrowser.click(target(inspection, "Submit search"));

    await waitForObservation(runtime, capture.id, "human_submit");

    inspection = await sessionBrowser.inspect();

    const select = inspection.targets?.find((item) => item.kind === "select");

    if (select === undefined) {
      throw new Error("Missing select target.");
    }

    await sessionBrowser.press(
      {
        pageId: inspection.pageId,
        revision: inspection.revision,
        ref: select.ref,
      },
      "o",
    );

    const selection = await waitForObservation(
      runtime,
      capture.id,
      "human_selection",
    );

    expect(selection.data).toMatchObject({
      selectedIndex: 1,
    });

    await sessionBrowser.scroll({
      direction: "down",
      amount: 2_000,
    });

    await waitForObservation(runtime, capture.id, "human_scroll");

    inspection = await sessionBrowser.inspect();

    await sessionBrowser.click(target(inspection, "Open popup"));

    await waitForObservation(runtime, capture.id, "page_opened");

    await sessionBrowser.switchPage("page_01");

    await waitForObservation(runtime, capture.id, "page_switched");

    const observations = (await runtime.getObservations(capture.id)).items;

    const types = observations.map((item) => item.type);

    expect(types).toEqual(
      expect.arrayContaining([
        "navigation_completed",
        "url_changed",
        "human_click",
        "human_submit",
        "human_selection",
        "human_scroll",
        "page_opened",
        "page_switched",
      ]),
    );

    expect(observations.map((item) => item.seq)).toEqual(
      observations.map((_, index) => index + 1),
    );

    expect(JSON.stringify(observations)).not.toContain(secret);

    expect(await allFileText(join(home, "sessions", capture.id))).not.toContain(
      secret,
    );

    await expect(
      runtime.navigate(capture.id, {
        url: `${server.url}/result`,
      }),
    ).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });
  });

  it("blocks agent live reads while Capture Mode owns the browser", async () => {
    const browserSession = readyBrowserSession("browser_capture_f3");

    let inspectCalls = 0;
    let pagesCalls = 0;
    let screenshotCalls = 0;

    const baseInspect = browserSession.inspect.bind(browserSession);
    const basePages = browserSession.pages.bind(browserSession);

    browserSession.inspect = async (options) => {
      inspectCalls += 1;
      return baseInspect(options);
    };

    browserSession.pages = async () => {
      pagesCalls += 1;
      return basePages();
    };

    browserSession.screenshot = async () => {
      screenshotCalls += 1;
      throw new Error("Capture screenshot should never reach the browser.");
    };

    const engine: BrowserEngine = {
      start: async () => browserSession,
    };

    const { runtime } = await harness(engine);

    const session = await runtime.startSession({
      mode: "capture",
    });

    active.push({
      runtime,
      id: session.id,
    });

    const startupInspectCalls = inspectCalls;
    const startupPagesCalls = pagesCalls;

    await expect(runtime.inspectBrowser(session.id)).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await expect(runtime.pages(session.id)).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await expect(runtime.captureScreenshot(session.id)).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    expect(inspectCalls).toBe(startupInspectCalls);
    expect(pagesCalls).toBe(startupPagesCalls);
    expect(screenshotCalls).toBe(0);
  });

  it("invalidates an in-flight inspect before request-human completes", async () => {
    const browserSession = readyBrowserSession("browser_inspect_f3");

    let inspectCalls = 0;

    let inspectStartedResolve!: () => void;

    const inspectStarted = new Promise<void>((resolve) => {
      inspectStartedResolve = resolve;
    });

    let releaseInspectResolve!: () => void;

    const releaseInspect = new Promise<void>((resolve) => {
      releaseInspectResolve = resolve;
    });

    const baseInspect = browserSession.inspect.bind(browserSession);

    browserSession.inspect = async (options) => {
      inspectCalls += 1;

      // startSession performs the first assessment.
      // Call two is the agent-facing inspect under test.
      if (inspectCalls === 2) {
        inspectStartedResolve();
        await releaseInspect;
      }

      return baseInspect(options);
    };

    const engine: BrowserEngine = {
      start: async () => browserSession,
    };

    const { runtime, ownershipFence } = await harness(engine);

    const session = await runtime.startSession({
      mode: "agent",
    });

    active.push({
      runtime,
      id: session.id,
    });

    const inspection = runtime.inspectBrowser(session.id);

    await inspectStarted;

    let transitionStartedResolve!: () => void;

    const transitionStarted = new Promise<void>((resolve) => {
      transitionStartedResolve = resolve;
    });

    const originalBeginTransition =
      ownershipFence.beginTransition.bind(ownershipFence);

    ownershipFence.beginTransition = (transitionSessionId) => {
      const transition = originalBeginTransition(transitionSessionId);

      transitionStartedResolve();

      return transition;
    };

    const handoff = runtime.requestHuman(session.id, {
      reason: "F3 inspect race",
    });

    // Exact F3 synchronization boundary:
    // the old generation has been invalidated and new admission
    // is closed, while requestHuman waits for the old inspect.
    await transitionStarted;

    let admissionError: unknown;

    try {
      const unexpectedLease = ownershipFence.acquire(session.id, "agent");

      unexpectedLease.release();
    } catch (error) {
      admissionError = error;
    }

    expect(admissionError).toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    releaseInspectResolve();

    await expect(inspection).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await expect(handoff).resolves.toMatchObject({
      status: "awaiting_human",
      controller: null,
    });
  });

  it("rejects an in-flight mutation result after its ownership generation is invalidated", async () => {
    const server = await fixture();

    const { runtime, browser, ownershipFence } = await harness();

    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/actions`,
    });

    active.push({
      runtime,
      id: session.id,
    });

    // Establish fresh F1 knowledge for mutation authorization.
    await runtime.inspectBrowser(session.id, {
      includeText: false,
      includeTargets: false,
    });

    const liveBrowser = browser.get(session.id);
    const originalNavigate = liveBrowser.navigate.bind(liveBrowser);

    let mutationStartedResolve!: () => void;

    const mutationStarted = new Promise<void>((resolve) => {
      mutationStartedResolve = resolve;
    });

    let releaseMutationResolve!: () => void;

    const releaseMutation = new Promise<void>((resolve) => {
      releaseMutationResolve = resolve;
    });

    Object.defineProperty(liveBrowser, "navigate", {
      configurable: true,
      value: async (url: string) => {
        mutationStartedResolve();

        await releaseMutation;

        return originalNavigate(url);
      },
    });

    const mutation = runtime.navigate(session.id, {
      url: `${server.url}/ready`,
    });

    await mutationStarted;

    // Simulate ownership invalidation at the exact fence layer.
    // F3.5 will centralize all real transition callers.
    const transition = ownershipFence.beginTransition(session.id);

    let drained = false;

    const drain = transition.waitForDrain().then(() => {
      drained = true;
    });

    await Promise.resolve();

    expect(drained).toBe(false);

    releaseMutationResolve();

    await expect(mutation).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await drain;

    expect(drained).toBe(true);

    ownershipFence.completeTransition(transition, null);

    const observationTypes = (
      await runtime.getObservations(session.id)
    ).items.map((item) => item.type);

    expect(observationTypes).not.toContain("browser_navigated");
  });
});

interface RaceGate {
  promise: Promise<void>;
  resolve(): void;
}

function raceGate(): RaceGate {
  let resolve!: () => void;

  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return {
    promise,
    resolve,
  };
}

function observeNextOwnershipTransition(
  ownershipFence: BrowserOwnershipFence,
): Promise<void> {
  const started = raceGate();

  const originalBeginTransition =
    ownershipFence.beginTransition.bind(ownershipFence);

  ownershipFence.beginTransition = (sessionId) => {
    const transition = originalBeginTransition(sessionId);

    started.resolve();

    return transition;
  };

  return started.promise;
}

function runtimeOwnershipTransitions(
  runtime: RuntimeService,
): OwnershipTransitionService {
  return (
    runtime as unknown as {
      ownershipTransitions: OwnershipTransitionService;
    }
  ).ownershipTransitions;
}

function runtimeInteractionPolicy(runtime: RuntimeService): InteractionPolicy {
  return (
    runtime as unknown as {
      interactionPolicy: InteractionPolicy;
    }
  ).interactionPolicy;
}

function runtimeEvidence(runtime: RuntimeService): EvidenceService {
  return (
    runtime as unknown as {
      evidence: EvidenceService;
    }
  ).evidence;
}

describe("F3.6 adversarial ownership races", () => {
  it("Race A — inspect vs request-human discards stale inspection before policy commit or return", async () => {
    const server = await fixture();

    const { runtime, browser, ownershipFence } = await harness();

    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/actions`,
    });

    active.push({
      runtime,
      id: session.id,
    });

    const liveBrowser = browser.get(session.id);

    const originalInspect = liveBrowser.inspect.bind(liveBrowser);

    const inspectStarted = raceGate();
    const releaseInspect = raceGate();

    Object.defineProperty(liveBrowser, "inspect", {
      configurable: true,
      value: async (options?: Parameters<typeof originalInspect>[0]) => {
        inspectStarted.resolve();

        await releaseInspect.promise;

        return originalInspect(options);
      },
    });

    const policy = runtimeInteractionPolicy(runtime);

    const originalRecordInspection = policy.recordInspection.bind(policy);

    let recordedAfterStart = 0;

    policy.recordInspection = (sessionId, inspection) => {
      recordedAfterStart += 1;

      return originalRecordInspection(sessionId, inspection);
    };

    const transitionStarted = observeNextOwnershipTransition(ownershipFence);

    const inspection = runtime.inspectBrowser(session.id);

    await inspectStarted.promise;

    const handoff = runtime.requestHuman(session.id, {
      reason: "Race A",
    });

    let handoffResolved = false;

    void handoff.then(() => {
      handoffResolved = true;
    });

    await transitionStarted;

    expect(handoffResolved).toBe(false);

    releaseInspect.resolve();

    await expect(inspection).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    expect(recordedAfterStart).toBe(0);

    await expect(handoff).resolves.toMatchObject({
      status: "awaiting_human",
      controller: null,
    });
  });

  it("Race B — inspect cannot cross voluntary Companion takeover", async () => {
    const server = await fixture();

    const { runtime, browser, ownershipFence } = await harness();

    const session = await runtime.startSession({
      mode: "companion",
      startUrl: `${server.url}/actions`,
    });

    active.push({
      runtime,
      id: session.id,
    });

    const liveBrowser = browser.get(session.id);

    const originalInspect = liveBrowser.inspect.bind(liveBrowser);

    const inspectStarted = raceGate();
    const releaseInspect = raceGate();

    Object.defineProperty(liveBrowser, "inspect", {
      configurable: true,
      value: async (options?: Parameters<typeof originalInspect>[0]) => {
        inspectStarted.resolve();

        await releaseInspect.promise;

        return originalInspect(options);
      },
    });

    const transitionStarted = observeNextOwnershipTransition(ownershipFence);

    const inspection = runtime.inspectBrowser(session.id);

    await inspectStarted.promise;

    const takeover = runtime.takeHumanControl(session.id);

    await transitionStarted;

    releaseInspect.resolve();

    await expect(inspection).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await expect(takeover).resolves.toMatchObject({
      status: "active",
      controller: "human",
    });
  });

  it("Race C — pages cannot return across a request-human boundary", async () => {
    const { runtime, browser, ownershipFence } = await harness();

    const session = await runtime.startSession({
      mode: "agent",
    });

    active.push({
      runtime,
      id: session.id,
    });

    const liveBrowser = browser.get(session.id);

    const originalPages = liveBrowser.pages.bind(liveBrowser);

    const pagesStarted = raceGate();
    const releasePages = raceGate();

    Object.defineProperty(liveBrowser, "pages", {
      configurable: true,
      value: async () => {
        pagesStarted.resolve();

        await releasePages.promise;

        return originalPages();
      },
    });

    const transitionStarted = observeNextOwnershipTransition(ownershipFence);

    const pages = runtime.pages(session.id);

    await pagesStarted.promise;

    const handoff = runtime.requestHuman(session.id, {
      reason: "Race C",
    });

    await transitionStarted;

    releasePages.resolve();

    await expect(pages).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await expect(handoff).resolves.toMatchObject({
      status: "awaiting_human",
      controller: null,
    });
  });

  it("Race D — a stale screenshot cannot become persisted evidence", async () => {
    const server = await fixture();

    const { runtime, browser, ownershipFence } = await harness();

    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/actions`,
    });

    active.push({
      runtime,
      id: session.id,
    });

    const liveBrowser = browser.get(session.id);

    const originalScreenshot = liveBrowser.screenshot.bind(liveBrowser);

    const screenshotStarted = raceGate();
    const releaseScreenshot = raceGate();

    Object.defineProperty(liveBrowser, "screenshot", {
      configurable: true,
      value: async (options?: Parameters<typeof originalScreenshot>[0]) => {
        screenshotStarted.resolve();

        await releaseScreenshot.promise;

        return originalScreenshot(options);
      },
    });

    const evidence = runtimeEvidence(runtime);

    const originalSaveScreenshot = evidence.saveScreenshot.bind(evidence);

    let screenshotSaves = 0;

    const wrappedSaveScreenshot: EvidenceService["saveScreenshot"] = async (
      ...args
    ) => {
      screenshotSaves += 1;

      return originalSaveScreenshot(...args);
    };

    evidence.saveScreenshot = wrappedSaveScreenshot;

    const transitionStarted = observeNextOwnershipTransition(ownershipFence);

    const screenshot = runtime.captureScreenshot(session.id);

    await screenshotStarted.promise;

    // Exercise the centralized transition service directly so the
    // transition races the already-running coordinator operation.
    const handoff = runtimeOwnershipTransitions(runtime).requestHuman(
      session.id,
      "Race D",
    );

    await transitionStarted;

    releaseScreenshot.resolve();

    await expect(screenshot).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await expect(handoff).resolves.toMatchObject({
      status: "awaiting_human",
      controller: null,
    });

    expect(screenshotSaves).toBe(0);
  });

  it("Race E — mutation queued behind handoff fails before browser execution", async () => {
    const server = await fixture();

    const { runtime, browser } = await harness();

    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/actions`,
    });

    active.push({
      runtime,
      id: session.id,
    });

    await runtime.inspectBrowser(session.id);

    const liveBrowser = browser.get(session.id);

    const originalNavigate = liveBrowser.navigate.bind(liveBrowser);

    const firstMutationStarted = raceGate();
    const releaseFirstMutation = raceGate();

    let navigateCalls = 0;

    Object.defineProperty(liveBrowser, "navigate", {
      configurable: true,
      value: async (url: string) => {
        navigateCalls += 1;

        if (navigateCalls === 1) {
          firstMutationStarted.resolve();

          await releaseFirstMutation.promise;
        }

        return originalNavigate(url);
      },
    });

    const firstMutation = runtime.navigate(session.id, {
      url: `${server.url}/actions`,
    });

    await firstMutationStarted.promise;

    const handoff = runtime.requestHuman(session.id, {
      reason: "Race E",
    });

    const queuedMutation = runtime.navigate(session.id, {
      url: `${server.url}/actions`,
    });

    releaseFirstMutation.resolve();

    await expect(firstMutation).resolves.toMatchObject({
      sessionId: session.id,
    });

    await expect(handoff).resolves.toMatchObject({
      status: "awaiting_human",
      controller: null,
    });

    await expect(queuedMutation).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    expect(navigateCalls).toBe(1);
  });

  it("Race F — handoff waits for an active non-coordinator inspect to drain", async () => {
    const { runtime, browser, ownershipFence } = await harness();

    const session = await runtime.startSession({
      mode: "agent",
    });

    active.push({
      runtime,
      id: session.id,
    });

    const liveBrowser = browser.get(session.id);

    const originalInspect = liveBrowser.inspect.bind(liveBrowser);

    const inspectStarted = raceGate();
    const releaseInspect = raceGate();

    Object.defineProperty(liveBrowser, "inspect", {
      configurable: true,
      value: async (options?: Parameters<typeof originalInspect>[0]) => {
        inspectStarted.resolve();

        await releaseInspect.promise;

        return originalInspect(options);
      },
    });

    const transitionStarted = observeNextOwnershipTransition(ownershipFence);

    const inspection = runtime.inspectBrowser(session.id);

    await inspectStarted.promise;

    let handoffResolved = false;

    const handoff = runtime.requestHuman(session.id, {
      reason: "Race F",
    });

    void handoff.then(() => {
      handoffResolved = true;
    });

    await transitionStarted;

    expect(handoffResolved).toBe(false);

    releaseInspect.resolve();

    await expect(inspection).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await expect(handoff).resolves.toMatchObject({
      status: "awaiting_human",
      controller: null,
    });
  });

  it("Race G — stale pre-human inspect cannot become valid after a later agent generation", async () => {
    const server = await fixture();

    const { runtime, browser, ownershipFence } = await harness();

    const session = await runtime.startSession({
      mode: "companion",
      startUrl: `${server.url}/actions`,
    });

    active.push({
      runtime,
      id: session.id,
    });

    const liveBrowser = browser.get(session.id);

    const originalInspect = liveBrowser.inspect.bind(liveBrowser);

    const staleInspectStarted = raceGate();
    const releaseStaleInspect = raceGate();

    let delayed = true;

    Object.defineProperty(liveBrowser, "inspect", {
      configurable: true,
      value: async (options?: Parameters<typeof originalInspect>[0]) => {
        if (delayed) {
          staleInspectStarted.resolve();

          await releaseStaleInspect.promise;

          delayed = false;
        }

        return originalInspect(options);
      },
    });

    const transitionStarted = observeNextOwnershipTransition(ownershipFence);

    const staleInspection = runtime.inspectBrowser(session.id);

    await staleInspectStarted.promise;

    const takeover = runtime.takeHumanControl(session.id);

    // Queue the return behind takeover before the stale read is
    // physically allowed to complete.
    const returned = runtime.returnAgentControl(session.id);

    await transitionStarted;

    releaseStaleInspect.resolve();

    await expect(staleInspection).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await expect(takeover).resolves.toMatchObject({
      controller: "human",
    });

    await expect(returned).resolves.toMatchObject({
      status: "active",
      controller: "agent",
    });

    // Handback invalidation, not the old inspect, defines the new era.
    await expect(
      runtime.navigate(session.id, {
        url: `${server.url}/actions`,
      }),
    ).rejects.toMatchObject({
      code: "INSPECTION_REQUIRED",
    });

    await runtime.inspectBrowser(session.id);

    await expect(
      runtime.navigate(session.id, {
        url: `${server.url}/actions`,
      }),
    ).resolves.toMatchObject({
      sessionId: session.id,
    });
  });

  it("Race H — concurrent stable reads overlap and the transition drains both", async () => {
    const { runtime, browser, ownershipFence } = await harness();

    const session = await runtime.startSession({
      mode: "agent",
    });

    active.push({
      runtime,
      id: session.id,
    });

    const liveBrowser = browser.get(session.id);

    const originalInspect = liveBrowser.inspect.bind(liveBrowser);

    const originalPages = liveBrowser.pages.bind(liveBrowser);

    const inspectStarted = raceGate();
    const pagesStarted = raceGate();

    const releaseInspect = raceGate();
    const releasePages = raceGate();

    Object.defineProperty(liveBrowser, "inspect", {
      configurable: true,
      value: async (options?: Parameters<typeof originalInspect>[0]) => {
        inspectStarted.resolve();

        await releaseInspect.promise;

        return originalInspect(options);
      },
    });

    Object.defineProperty(liveBrowser, "pages", {
      configurable: true,
      value: async () => {
        pagesStarted.resolve();

        await releasePages.promise;

        return originalPages();
      },
    });

    const inspection = runtime.inspectBrowser(session.id);

    const pages = runtime.pages(session.id);

    // Both operations must physically enter the browser before either
    // is released, proving reads are not globally serialized.
    await Promise.all([inspectStarted.promise, pagesStarted.promise]);

    const transitionStarted = observeNextOwnershipTransition(ownershipFence);

    let handoffResolved = false;

    const handoff = runtime.requestHuman(session.id, {
      reason: "Race H",
    });

    void handoff.then(() => {
      handoffResolved = true;
    });

    await transitionStarted;

    releaseInspect.resolve();

    await expect(inspection).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    expect(handoffResolved).toBe(false);

    releasePages.resolve();

    await expect(pages).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await expect(handoff).resolves.toMatchObject({
      status: "awaiting_human",
      controller: null,
    });
  });

  it("Race I — transition closes admission immediately so new reads cannot extend drain", async () => {
    const { runtime, browser, ownershipFence } = await harness();

    const session = await runtime.startSession({
      mode: "agent",
    });

    active.push({
      runtime,
      id: session.id,
    });

    const liveBrowser = browser.get(session.id);

    const originalInspect = liveBrowser.inspect.bind(liveBrowser);

    const originalPages = liveBrowser.pages.bind(liveBrowser);

    const firstInspectStarted = raceGate();
    const releaseFirstInspect = raceGate();

    let inspectCalls = 0;
    let pagesCalls = 0;

    Object.defineProperty(liveBrowser, "inspect", {
      configurable: true,
      value: async (options?: Parameters<typeof originalInspect>[0]) => {
        inspectCalls += 1;

        if (inspectCalls === 1) {
          firstInspectStarted.resolve();

          await releaseFirstInspect.promise;
        }

        return originalInspect(options);
      },
    });

    Object.defineProperty(liveBrowser, "pages", {
      configurable: true,
      value: async () => {
        pagesCalls += 1;

        return originalPages();
      },
    });

    const oldInspection = runtime.inspectBrowser(session.id);

    await firstInspectStarted.promise;

    const transitionStarted = observeNextOwnershipTransition(ownershipFence);

    const handoff = runtime.requestHuman(session.id, {
      reason: "Race I",
    });

    await transitionStarted;

    await expect(runtime.inspectBrowser(session.id)).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await expect(runtime.pages(session.id)).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    // New work was rejected at admission, before browser execution.
    expect(inspectCalls).toBe(1);
    expect(pagesCalls).toBe(0);

    releaseFirstInspect.resolve();

    await expect(oldInspection).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await expect(handoff).resolves.toMatchObject({
      status: "awaiting_human",
      controller: null,
    });
  });

  it("Race J — session end invalidates and drains an active inspect before completion", async () => {
    const { runtime, browser, ownershipFence } = await harness();

    const session = await runtime.startSession({
      mode: "agent",
    });

    active.push({
      runtime,
      id: session.id,
    });

    const liveBrowser = browser.get(session.id);

    const originalInspect = liveBrowser.inspect.bind(liveBrowser);

    const inspectStarted = raceGate();
    const releaseInspect = raceGate();

    Object.defineProperty(liveBrowser, "inspect", {
      configurable: true,
      value: async (options?: Parameters<typeof originalInspect>[0]) => {
        inspectStarted.resolve();

        await releaseInspect.promise;

        return originalInspect(options);
      },
    });

    const inspection = runtime.inspectBrowser(session.id);

    await inspectStarted.promise;

    const transitionStarted = observeNextOwnershipTransition(ownershipFence);

    let endResolved = false;

    const ending = runtime.endSession(session.id);

    void ending.then(() => {
      endResolved = true;
    });

    await transitionStarted;

    expect(endResolved).toBe(false);

    releaseInspect.resolve();

    await expect(inspection).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await expect(ending).resolves.toMatchObject({
      status: "completed",
      controller: null,
    });

    let fenceError: unknown;

    try {
      ownershipFence.acquire(session.id, "agent");
    } catch (error) {
      fenceError = error;
    }

    expect(fenceError).toMatchObject({
      code: "SESSION_NOT_ACTIVE",
    });
  });

  it("Roadmap H — fresh inspection cannot begin before human-return invalidation completes", async () => {
    const { runtime, browser } = await harness();

    const session = await runtime.startSession({
      mode: "companion",
    });

    active.push({
      runtime,
      id: session.id,
    });

    await runtime.takeHumanControl(session.id);

    const liveBrowser = browser.get(session.id);

    const originalInvalidateAllTargets =
      liveBrowser.invalidateAllTargets.bind(liveBrowser);

    const originalInspect = liveBrowser.inspect.bind(liveBrowser);

    const invalidationStarted = raceGate();
    const releaseInvalidation = raceGate();

    let inspectCalls = 0;

    Object.defineProperty(liveBrowser, "invalidateAllTargets", {
      configurable: true,
      value: async () => {
        invalidationStarted.resolve();

        await releaseInvalidation.promise;

        return originalInvalidateAllTargets();
      },
    });

    Object.defineProperty(liveBrowser, "inspect", {
      configurable: true,
      value: async (options?: Parameters<typeof originalInspect>[0]) => {
        inspectCalls += 1;

        return originalInspect(options);
      },
    });

    const returning = runtime.returnAgentControl(session.id);

    await invalidationStarted.promise;

    await expect(runtime.inspectBrowser(session.id)).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    expect(inspectCalls).toBe(0);

    releaseInvalidation.resolve();

    await expect(returning).resolves.toMatchObject({
      status: "active",
      controller: "agent",
    });

    await expect(runtime.inspectBrowser(session.id)).resolves.toMatchObject({
      pageId: expect.any(String),
    });

    expect(inspectCalls).toBe(1);
  });

  it("Roadmap I — F2 automatic handoff begins only after mutation lease release", async () => {
    const server = await fixture();

    const { runtime } = await harness();

    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/actions`,
    });

    active.push({
      runtime,
      id: session.id,
    });

    await runtime.inspectBrowser(session.id);

    // If F2 tries to transition while the mutation lease is still
    // active, this call deadlocks. Successful completion therefore
    // proves the post-action ordering frozen in F3.4.
    const result = await runtime.navigate(session.id, {
      url: `${server.url}/authentication`,
    });

    expect(result.url).toBe(`${server.url}/authentication`);

    expect(await runtime.getSession(session.id)).toMatchObject({
      status: "awaiting_human",
      controller: null,
    });

    await expect(runtime.inspectBrowser(session.id)).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await expect(runtime.pages(session.id)).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await expect(runtime.captureScreenshot(session.id)).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await expect(
      runtime.navigate(session.id, {
        url: `${server.url}/actions`,
      }),
    ).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });
  });
});
