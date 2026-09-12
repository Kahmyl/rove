import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  PlaywrightBrowserEngine,
  type BrowserEngine,
  type BrowserSession,
  type RoveProfileLock,
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
  FileEffectJournalStore,
  FileObservationStore,
  FileSessionStore,
} from "@rove/storage";
import {
  startFixtureServer,
  type FixtureServer,
} from "../../../packages/browser/src/fixtures/fixture-server.js";
import { SessionController } from "./api/session.controller.js";
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
    actionMs?: number;
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
        timeouts: {
          ...config.timeouts,
          ...(browserPolicy.actionMs === undefined
            ? {}
            : { actionMs: browserPolicy.actionMs }),
        },
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

  await runtime.createBrowserWorkspace("Default");

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

describe("runtime integration", () => {
  it("reports a terminal workspace session released while a newer session owns that workspace", async () => {
    const { runtime } = await harness({
      start: async (request) => readyBrowserSession(`browser_${request.mode}`),
    });
    const workspace = (await runtime.listBrowserWorkspaces()).workspaces[0]!;
    const first = await runtime.startSession({
      mode: "agent",
      browser: { mode: "workspace", workspaceId: workspace.id },
    });
    await runtime.endSession(first.id);
    const second = await runtime.startSession({
      mode: "agent",
      browser: { mode: "workspace", workspaceId: workspace.id },
    });
    active.push({ runtime, id: second.id });

    await expect(runtime.listSessionInventory()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          session: expect.objectContaining({
            id: first.id,
            status: "completed",
          }),
          profileOwnership: "released",
          recovery: "cleanup_required",
        }),
        expect.objectContaining({
          session: expect.objectContaining({ id: second.id }),
          profileOwnership: "owned",
          recovery: "not_needed",
        }),
      ]),
    );
  });

  it("inventories persisted sessions even when no browser is attached", async () => {
    const { home, runtime, sessions } = await harness({
      start: async () => readyBrowserSession("browser_inventory"),
    });
    expect(
      JSON.parse(
        await readFile(
          join(home, ".rove/effect-journal/cutover/v1.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ epoch: "phase5-effect-journal-v1" });
    const persisted = await sessions.start(
      {
        bootstrapId: "boot_11111111111111111111111111111111",
        mode: "agent",
        browser: { mode: "temporary" },
      },
      { profile: { mode: "temporary" } },
    );
    await expect(runtime.listActiveSessions()).resolves.toEqual([persisted]);
    await expect(runtime.listSessionInventory()).resolves.toMatchObject([
      {
        schemaVersion: 1,
        session: { id: persisted.id },
        attachment: "missing",
        recovery: "unrecoverable",
        profileOwnership: "released",
        legacyEffects: "not_applicable",
      },
    ]);
  });

  it("recovers one exact named persisted session without replaying navigation", async () => {
    let starts = 0;
    const { runtime, sessions } = await harness({
      start: async () => {
        starts += 1;
        return readyBrowserSession(`browser_recovery_${starts}`);
      },
    });
    const workspace = (await runtime.listBrowserWorkspaces()).workspaces[0]!;
    const persisted = await sessions.start(
      {
        bootstrapId: "boot_22222222222222222222222222222222",
        mode: "agent",
        browser: { mode: "workspace", workspaceId: workspace.id },
      },
      {
        profile: { mode: "persistent", name: workspace.id },
        workspace,
      },
    );
    const results = await Promise.all([
      runtime.recoverSession(persisted.id),
      runtime.recoverSession(persisted.id),
    ]);
    expect(starts).toBe(1);
    expect(results).toMatchObject([
      { attachment: "attached", recovery: "not_needed" },
      { attachment: "attached", recovery: "not_needed" },
    ]);
    active.push({ runtime, id: persisted.id });
  });

  it("retries a transient profile-lock release and confirms terminal released inventory", async () => {
    const { runtime } = await harness({
      start: async () => readyBrowserSession("browser_release_retry"),
    });
    const workspace = (await runtime.listBrowserWorkspaces()).workspaces[0]!;
    const session = await runtime.startSession({
      mode: "agent",
      browser: { mode: "workspace", workspaceId: workspace.id },
    });
    const locks = (
      runtime as unknown as { profileLocks: Map<string, RoveProfileLock> }
    ).profileLocks;
    const lock = locks.get(session.id)!;
    const release = lock.release.bind(lock);
    let attempts = 0;
    lock.release = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("injected unlink failure");
      await release();
    };

    await expect(runtime.endSession(session.id)).rejects.toThrow(
      /injected unlink failure/,
    );
    expect(locks.has(session.id)).toBe(true);
    await expect(runtime.endSession(session.id)).resolves.toMatchObject({
      status: "completed",
      controller: null,
    });
    expect(attempts).toBe(2);
    expect(locks.has(session.id)).toBe(false);
    await expect(runtime.listSessionInventory()).resolves.toEqual([
      expect.objectContaining({
        session: expect.objectContaining({
          id: session.id,
          status: "completed",
        }),
        attachment: "missing",
        profileOwnership: "released",
      }),
    ]);
  });

  it("conservatively terminates a lost Temporary session and repeats cleanup", async () => {
    const { runtime, sessions } = await harness({
      start: async () => readyBrowserSession("browser_unused"),
    });
    const persisted = await sessions.start(
      { mode: "agent", browser: { mode: "temporary" } },
      { profile: { mode: "temporary" } },
    );
    await expect(runtime.recoverSession(persisted.id)).resolves.toMatchObject({
      session: { status: "failed", controller: null },
      attachment: "missing",
      recovery: "cleanup_required",
    });
    const first = await runtime.endSession(persisted.id);
    const second = await runtime.endSession(persisted.id);
    expect(second).toEqual(first);
  });

  it("ends an active persisted Temporary session when no ownership fence was restored", async () => {
    const { runtime, sessions } = await harness({
      start: async () => readyBrowserSession("browser_unused"),
    });
    const persisted = await sessions.start(
      { mode: "agent", browser: { mode: "temporary" } },
      { profile: { mode: "temporary" } },
    );

    await expect(runtime.endSession(persisted.id)).resolves.toMatchObject({
      id: persisted.id,
      status: "completed",
      controller: null,
    });
    await expect(runtime.listSessionInventory()).resolves.toEqual([
      expect.objectContaining({
        session: expect.objectContaining({
          id: persisted.id,
          status: "completed",
        }),
        attachment: "missing",
        profileOwnership: "released",
      }),
    ]);
  });

  it("reports the latest durable observation cursor in active control truth", async () => {
    const { runtime, sessions } = await harness({
      start: async () => readyBrowserSession("browser_unused"),
    });
    const persisted = await sessions.start(
      { mode: "agent", browser: { mode: "temporary" } },
      { profile: { mode: "temporary" } },
    );
    const activeSession = await sessions.update({
      ...persisted,
      status: "active",
      controller: "agent",
    });
    const fence = (
      runtime as unknown as { ownershipFence: BrowserOwnershipFence }
    ).ownershipFence;
    fence.initialize(
      activeSession.id,
      activeSession.controller,
      activeSession.ownershipGeneration,
    );
    const requested = await runtime.requestHuman(persisted.id, {
      reason: "Cursor qualification",
    });

    await expect(runtime.getControlStatus(persisted.id)).resolves.toMatchObject(
      {
        sessionId: persisted.id,
        status: "awaiting_human",
        observationSeq: requested.observationSeq,
      },
    );
    await runtime.endSession(persisted.id);
  });

  it("reports persisted human and returned control truth after in-memory ownership state is lost", async () => {
    const { runtime, ownershipFence } = await harness({
      start: async () =>
        ({
          ...readyBrowserSession("browser_control_restart"),
          invalidateAllTargets: async () => [],
        }) as BrowserSession,
    });
    const workspace = (await runtime.listBrowserWorkspaces()).workspaces[0]!;
    const session = await runtime.startSession({
      mode: "agent",
      browser: { mode: "workspace", workspaceId: workspace.id },
    });
    active.push({ runtime, id: session.id });

    const requested = await runtime.requestHuman(session.id, {
      reason: "Restart control-state qualification",
    });
    const human = await runtime.takeHumanControl(session.id);
    ownershipFence.clear(session.id);

    await expect(runtime.getControlStatus(session.id)).resolves.toMatchObject({
      sessionId: session.id,
      status: "active",
      controller: "human",
      generation: human.generation,
      activeHandoffId: requested.activeHandoffId,
      activeHandoffGeneration: requested.activeHandoffGeneration,
      observationSeq: human.observationSeq,
    });

    ownershipFence.initialize(session.id, "human", human.generation);
    const returned = await runtime.returnAgentControl(session.id);
    ownershipFence.clear(session.id);

    await expect(runtime.getControlStatus(session.id)).resolves.toMatchObject({
      sessionId: session.id,
      status: "active",
      controller: "agent",
      generation: returned.generation,
      lastReturnedHandoffId: requested.activeHandoffId,
      observationSeq: returned.observationSeq,
    });
  });

  it("starts real agent, companion, and capture sessions with the correct lifecycle", async () => {
    const { runtime, browser, home } = await harness();
    const agent = await runtime.startSession({
      mode: "agent",
      browser: { mode: "temporary" },
    });
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

    const companion = await runtime.startSession({
      mode: "companion",
      browser: { mode: "temporary" },
    });
    active.push({ runtime, id: companion.id });
    expect(companion.controller).toBe("agent");

    const capture = await runtime.startSession({
      mode: "capture",
      browser: { mode: "temporary" },
    });
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

  it("starts successfully when optional initial assessment sees page churn", async () => {
    const liveBrowser = readyBrowserSession("browser_startup_churn");
    Object.defineProperty(liveBrowser, "inspect", {
      configurable: true,
      value: async () => {
        throw new RoveError({
          code: "PAGE_CHANGED",
          message: "forced startup page churn",
          retryable: true,
        });
      },
    });
    const engine: BrowserEngine = {
      start: async () => liveBrowser,
    };
    const { runtime } = await harness(engine);

    const session = await runtime.startSession({ mode: "agent" });
    active.push({ runtime, id: session.id });

    expect(session).toMatchObject({
      status: "active",
      controller: "agent",
      activePageId: "page_01",
    });
    expect(
      (await runtime.getObservations(session.id)).items.map(
        (item) => item.type,
      ),
    ).toEqual(["session_started"]);
  });

  it("launches the selected durable browser workspace and records its identity", async () => {
    const { runtime, home } = await harness();
    const session = await runtime.startSession({ mode: "agent" });
    active.push({ runtime, id: session.id });

    const catalog = JSON.parse(
      await readFile(join(home, ".rove", "browser-workspaces.json"), "utf8"),
    );

    expect(session.workspace).toMatchObject({
      id: catalog.selectedWorkspaceId,
      displayName: "Default",
      browser: "chromium",
      storageLayout: "workspace",
    });
    expect(session.profile).toEqual({
      mode: "persistent",
      name: catalog.selectedWorkspaceId,
    });
  });

  it("rejects a second active session using the same browser workspace", async () => {
    let starts = 0;
    const engine: BrowserEngine = {
      start: async () => {
        starts += 1;
        return readyBrowserSession(`browser_${starts}`);
      },
    };

    const { runtime } = await harness(engine);
    const first = await runtime.startSession({ mode: "agent" });
    active.push({ runtime, id: first.id });

    await expect(runtime.startSession({ mode: "agent" })).rejects.toMatchObject(
      {
        code: "PROFILE_LOCKED",
      },
    );

    expect(starts).toBe(1);
  });

  it("does not create a duplicate writable host when a session-start response is still uncertain", async () => {
    let releaseLaunch!: () => void;
    const launchGate = new Promise<void>((resolve) => {
      releaseLaunch = resolve;
    });
    let launchStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      launchStarted = resolve;
    });
    let starts = 0;
    const engine: BrowserEngine = {
      start: async () => {
        starts += 1;
        launchStarted();
        await launchGate;
        return readyBrowserSession(`browser_${starts}`);
      },
    };
    const { runtime } = await harness(engine);
    const request = { mode: "agent" as const };

    const firstResponse = runtime.startSession(request);
    await started;
    await expect(runtime.startSession(request)).rejects.toMatchObject({
      code: "PROFILE_LOCKED",
    });
    releaseLaunch();
    const first = await firstResponse;
    active.push({ runtime, id: first.id });

    expect(starts).toBe(1);
    await expect(runtime.listActiveSessions()).resolves.toHaveLength(1);
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

  it("keeps agent ownership and allows navigation away when a site restricts access", async () => {
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
    ).resolves.toMatchObject({
      ok: true,
      url: new URL("/", server.url).toString(),
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
    while (
      (!records.some((item) => item.metadata?.kind === "navigation") ||
        !records.some((item) => item.metadata?.kind === "request_failure")) &&
      Date.now() < deadline
    ) {
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

  it("keeps an unknown interstitial observational and allows navigation away", async () => {
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
    ).resolves.toMatchObject({
      ok: true,
      url: new URL("/", server.url).toString(),
    });
  });

  describe("page-policy state and mode matrix", () => {
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
      "$mode mode + $label has the expected page-policy ownership behavior",
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

        // The legacy page decision remains observable, while action-level
        // authorization permits navigation out of stable stop-only states.
        if (
          mode !== "capture" &&
          mutationAllowed === false &&
          disposition !== "request_human"
        ) {
          const navigation = runtime.navigate(session.id, {
            url: `${server.url}/actions`,
          });

          if (pageState === "loading") {
            await expect(navigation).rejects.toMatchObject({
              code: "INSPECTION_REQUIRED",
              retryable: true,
            });
          } else {
            await expect(navigation).resolves.toMatchObject({
              ok: true,
              url: `${server.url}/actions`,
            });
          }

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
      startUrl: `${server.url}/download`,
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
    await expect(runtime.endSession(session.id)).resolves.toEqual(ended);
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

  it("classifies direct-click post-action failure instead of leaking a protocol error", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/consequential-action`,
    });
    active.push({ runtime, id: session.id });
    const inspection = await runtime.inspectBrowser(session.id);
    const liveBrowser = browser.get(session.id);
    const internal = liveBrowser as unknown as {
      synchronizeAfterAction: (...args: unknown[]) => Promise<unknown>;
    };
    const synchronize = internal.synchronizeAfterAction.bind(liveBrowser);
    let synchronizationCalls = 0;

    internal.synchronizeAfterAction = async (...args: unknown[]) => {
      synchronizationCalls += 1;
      if (synchronizationCalls === 1) {
        throw new Error("forced post-action synchronization failure");
      }
      return synchronize(...args);
    };

    await expect(
      runtime.click(session.id, {
        target: target(inspection, "Apply consequential mutation"),
      }),
    ).rejects.toMatchObject({
      code: "ACTION_OUTCOME_UNKNOWN",
      retryable: false,
      details: {
        dispatched: true,
        stage: "post_action_synchronization",
        partialResult: {
          ok: true,
          url: `${server.url}/consequential-result`,
        },
      },
    });
    expect(server.mutationCount()).toBe(1);
  });

  it("keeps a completed action when optional post-action inspection sees page churn", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/consequential-action`,
    });
    active.push({ runtime, id: session.id });
    const inspection = await runtime.inspectBrowser(session.id);
    const liveBrowser = browser.get(session.id);
    const inspect = liveBrowser.inspect.bind(liveBrowser);
    let rejectNextInspection = true;

    Object.defineProperty(liveBrowser, "inspect", {
      configurable: true,
      value: async (...args: Parameters<typeof inspect>) => {
        if (rejectNextInspection) {
          rejectNextInspection = false;
          throw new RoveError({
            code: "PAGE_CHANGED",
            message: "forced post-action page churn",
            retryable: true,
          });
        }
        return inspect(...args);
      },
    });

    await expect(
      runtime.click(session.id, {
        target: target(inspection, "Apply consequential mutation"),
      }),
    ).resolves.toMatchObject({
      ok: true,
      action: "click",
      pageChanged: true,
      url: `${server.url}/consequential-result`,
    });
    expect(server.mutationCount()).toBe(1);
    expect(
      (await runtime.getObservations(session.id)).items.some(
        (item) => item.type === "agent_clicked",
      ),
    ).toBe(true);
  });

  it("returns applied with explicit degradation after a completed consequential mutation", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/consequential-action`,
    });
    active.push({ runtime, id: session.id });
    const inspection = await runtime.inspectBrowser(session.id);
    const liveBrowser = browser.get(session.id);
    const internal = liveBrowser as unknown as {
      synchronizeAfterAction: (...args: unknown[]) => Promise<unknown>;
    };
    const synchronize = internal.synchronizeAfterAction.bind(liveBrowser);
    let synchronizationCalls = 0;

    internal.synchronizeAfterAction = async (...args: unknown[]) => {
      synchronizationCalls += 1;
      if (synchronizationCalls === 1) {
        throw new Error("forced post-action synchronization failure");
      }
      return synchronize(...args);
    };

    const receipt = await runtime.interact(session.id, {
      observationId: inspection.observationId,
      action: {
        kind: "click",
        target: target(inspection, "Apply consequential mutation"),
      },
      expectedEffects: [{ kind: "url_changed" }],
      consequential: true,
      consequenceKey: "fixture:mutation:applied",
    });

    expect(server.mutationCount()).toBe(1);
    expect(receipt).toMatchObject({
      dispatched: true,
      dispatchStatus: "completed",
      outcome: "applied",
      phases: expect.arrayContaining([
        expect.objectContaining({ phase: "preflight", status: "completed" }),
        expect.objectContaining({ phase: "commit", status: "completed" }),
        expect.objectContaining({ phase: "synchronize", status: "completed" }),
      ]),
      degradations: [
        {
          stage: "page_synchronization",
          code: "RUNTIME_PROTOCOL_ERROR",
        },
      ],
    });
  });

  it("reconciles a dispatch-stage control error when successor evidence proves the effect", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/interactive-reconciliation`,
    });
    active.push({ runtime, id: session.id });
    const inspection = await runtime.inspectBrowser(session.id);
    const liveBrowser = browser.get(session.id);
    const internal = liveBrowser as unknown as {
      applyCheckedState: (...args: unknown[]) => Promise<void>;
    };
    const applyCheckedState = internal.applyCheckedState.bind(liveBrowser);

    internal.applyCheckedState = async (...args: unknown[]) => {
      await applyCheckedState(...args);
      throw new RoveError({
        code: "TARGET_NOT_INTERACTIVE",
        message: "forced control replacement after checked state changed",
      });
    };

    const receipt = await runtime.interact(session.id, {
      observationId: inspection.observationId,
      action: {
        kind: "check",
        target: target(inspection, "task one"),
      },
      expectedEffects: [
        {
          kind: "target_checked",
          target: { name: "task one", kind: "checkbox" },
        },
      ],
      consequential: true,
      consequenceKey: "fixture:checkbox:checked",
    });

    expect(receipt).toMatchObject({
      dispatched: true,
      dispatchStatus: "completed",
      outcome: "applied",
      degradations: [
        {
          stage: "action_dispatch",
          code: "TARGET_NOT_INTERACTIVE",
        },
      ],
    });
  });

  it("reconciles a delayed client-side consequential commit without redispatching it", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/consequential-action`,
    });
    active.push({ runtime, id: session.id });
    const predecessor = await runtime.inspectBrowser(session.id);
    const liveBrowser = browser.get(session.id);
    const inspect = liveBrowser.inspect.bind(liveBrowser);
    let successorInspectionCalls = 0;

    Object.defineProperty(liveBrowser, "inspect", {
      configurable: true,
      value: async (...args: Parameters<typeof inspect>) => {
        successorInspectionCalls += 1;

        if (successorInspectionCalls === 1) {
          return predecessor;
        }

        return inspect(...args);
      },
    });

    const receipt = await runtime.interact(session.id, {
      observationId: predecessor.observationId,
      action: {
        kind: "click",
        target: target(predecessor, "Apply consequential mutation"),
      },
      expectedEffects: [{ kind: "url_changed" }],
      consequential: true,
      consequenceKey: "fixture:mutation:delayed-reconciliation",
    });

    expect(server.mutationCount()).toBe(1);
    expect(successorInspectionCalls).toBeGreaterThan(1);
    expect(receipt).toMatchObject({
      dispatched: true,
      dispatchStatus: "completed",
      outcome: "applied",
      pageChanged: true,
      url: `${server.url}/consequential-result`,
    });
  });

  it("reconciles delayed expected effects for ordinary navigation", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/actions`,
    });
    active.push({ runtime, id: session.id });
    const predecessor = await runtime.inspectBrowser(session.id);
    const liveBrowser = browser.get(session.id);
    const inspect = liveBrowser.inspect.bind(liveBrowser);
    let successorInspectionCalls = 0;

    Object.defineProperty(liveBrowser, "inspect", {
      configurable: true,
      value: async (...args: Parameters<typeof inspect>) => {
        successorInspectionCalls += 1;

        if (successorInspectionCalls === 1) return predecessor;

        return inspect(...args);
      },
    });

    const receipt = await runtime.interact(session.id, {
      observationId: predecessor.observationId,
      action: {
        kind: "click",
        target: target(predecessor, "Navigate result"),
      },
      expectedEffects: [{ kind: "url_changed" }],
      effect: "navigate",
    });

    expect(successorInspectionCalls).toBeGreaterThan(1);
    expect(receipt).toMatchObject({
      outcome: "applied",
      pageChanged: true,
      url: `${server.url}/result`,
    });
  });

  it("fences unresolved workspace work across origin, Runtime, and task replacement while permitting one trusted attempt", async () => {
    const affectedServer = await fixture();
    const unrelatedServer = await fixture();
    const { runtime, browser, sessions, ownershipFence } = await harness();
    const workspace = (await runtime.listBrowserWorkspaces()).workspaces[0]!;
    const taskABootstrap = `boot_${"a".repeat(32)}`;
    const taskBBootstrap = `boot_${"b".repeat(32)}`;
    const sessionA = await runtime.startSession({
      bootstrapId: taskABootstrap,
      mode: "agent",
      startUrl: `${affectedServer.url}/consequential-form?churn=one`,
      browser: { mode: "workspace", workspaceId: workspace.id },
    });
    active.push({ runtime, id: sessionA.id });
    const prepareForm = async (
      current: RuntimeService,
      sessionId: string,
      server: FixtureServer,
      title: string,
      churn: string,
    ) => {
      await current.inspectBrowser(sessionId);
      await current.navigate(sessionId, {
        url: `${server.url}/consequential-form?churn=${churn}`,
      });
      const empty = await current.inspectBrowser(sessionId);
      await current.interact(sessionId, {
        observationId: empty.observationId,
        action: {
          kind: "fill",
          target: target(empty, "Record title"),
          value: title,
        },
        expectedEffects: [
          {
            kind: "target_value",
            target: { kind: "input", name: "Record title" },
            value: title,
          },
        ],
        consequential: false,
      });
      return current.inspectBrowser(sessionId);
    };
    const issueA = await prepareForm(
      runtime,
      sessionA.id,
      affectedServer,
      "Issue A",
      "one",
    );
    const liveBrowser = browser.get(sessionA.id);
    const browserInternal = liveBrowser as unknown as {
      synchronizeAfterAction: (...args: unknown[]) => Promise<unknown>;
    };
    const synchronize =
      browserInternal.synchronizeAfterAction.bind(liveBrowser);
    const inspect = liveBrowser.inspect.bind(liveBrowser);

    browserInternal.synchronizeAfterAction = async () => {
      throw new Error("forced post-action synchronization failure");
    };
    Object.defineProperty(liveBrowser, "inspect", {
      configurable: true,
      value: async () => {
        throw new Error("forced successor inspection failure");
      },
    });

    const receipt = await runtime.interact(sessionA.id, {
      observationId: issueA.observationId,
      action: {
        kind: "click",
        target: target(issueA, "Create record"),
      },
      expectedEffects: [{ kind: "url_changed" }],
      consequential: true,
      consequenceKey: "fixture:form:issue-a:unknown",
    });

    expect(affectedServer.mutationCount()).toBe(1);
    expect(receipt).toMatchObject({
      dispatched: true,
      dispatchStatus: "completed",
      outcome: "unknown",
      degradations: expect.arrayContaining([
        expect.objectContaining({ stage: "page_synchronization" }),
        expect.objectContaining({ stage: "successor_inspection" }),
      ]),
    });

    browserInternal.synchronizeAfterAction = synchronize;
    Object.defineProperty(liveBrowser, "inspect", {
      configurable: true,
      value: inspect,
    });

    const runtimeInternal = runtime as unknown as {
      control: ControlService;
      controlWait: ControlWaitService;
      coordinator: BrowserCommandCoordinator;
      observations: ObservationService;
      evidence: EvidenceService;
      config: ReturnType<typeof loadConfig>;
    };
    const replacement = new RuntimeService(
      sessions,
      runtimeInternal.control,
      runtimeInternal.controlWait,
      runtimeInternal.coordinator,
      browser,
      runtimeInternal.observations,
      runtimeInternal.evidence,
      runtimeInternal.config,
      ownershipFence,
      new FileEffectJournalStore(runtimeInternal.config.home),
    );

    const sameIssueWithUnrelatedChurn = await prepareForm(
      replacement,
      sessionA.id,
      affectedServer,
      "Issue A",
      "two",
    );
    await expect(
      replacement.interact(sessionA.id, {
        observationId: sameIssueWithUnrelatedChurn.observationId,
        action: {
          kind: "click",
          target: target(sameIssueWithUnrelatedChurn, "Create record"),
        },
        expectedEffects: [{ kind: "url_changed" }],
        consequential: true,
        consequenceKey: "fixture:form:issue-a:rotated-key",
        repeatAuthorization: "caller-authored-value-must-not-work",
      } as never),
    ).rejects.toMatchObject({
      code: "CONSEQUENTIAL_ACTION_UNRESOLVED",
      details: { effectIds: [expect.stringMatching(/^[a-f0-9]{64}$/)] },
    });
    expect(affectedServer.mutationCount()).toBe(1);

    const differentFormState = await prepareForm(
      replacement,
      sessionA.id,
      affectedServer,
      "Issue B",
      "three",
    );
    await expect(
      replacement.interact(sessionA.id, {
        observationId: differentFormState.observationId,
        action: {
          kind: "click",
          target: target(differentFormState, "Create record"),
        },
        expectedEffects: [{ kind: "url_changed" }],
        consequential: true,
        consequenceKey: "fixture:form:issue-b:same-task",
      }),
    ).rejects.toMatchObject({ code: "CONSEQUENTIAL_ACTION_UNRESOLVED" });
    expect(affectedServer.mutationCount()).toBe(1);

    await replacement.navigate(sessionA.id, {
      url: `${unrelatedServer.url}/consequential-form?churn=read-only`,
    });
    await expect(
      replacement.inspectBrowser(sessionA.id),
    ).resolves.toMatchObject({
      url: expect.stringContaining(unrelatedServer.url),
    });

    const originalJournal = new FileEffectJournalStore(
      runtimeInternal.config.home,
    );
    const unresolved = await originalJournal.find(
      taskABootstrap,
      workspace.id,
      "fixture:form:issue-a:unknown",
    );
    expect(unresolved).toMatchObject({
      state: "unresolved",
      taskScope: taskABootstrap,
      browserWorkspaceScope: workspace.id,
    });

    await runtime.endSession(sessionA.id);

    const sessionB = await replacement.startSession({
      bootstrapId: taskBBootstrap,
      mode: "agent",
      startUrl: `${affectedServer.url}/consequential-form?churn=four`,
      browser: { mode: "workspace", workspaceId: workspace.id },
    });
    active.push({ runtime: replacement, id: sessionB.id });

    const taskBDifferentForm = await prepareForm(
      replacement,
      sessionB.id,
      affectedServer,
      "Issue B",
      "four",
    );
    await expect(
      replacement.interact(sessionB.id, {
        observationId: taskBDifferentForm.observationId,
        action: {
          kind: "click",
          target: target(taskBDifferentForm, "Create record"),
        },
        expectedEffects: [{ kind: "url_changed" }],
        consequential: true,
        consequenceKey: "fixture:form:issue-a:unknown",
      }),
    ).rejects.toMatchObject({ code: "CONSEQUENTIAL_ACTION_UNRESOLVED" });
    expect(affectedServer.mutationCount()).toBe(1);

    const unrelatedDomain = await prepareForm(
      replacement,
      sessionB.id,
      unrelatedServer,
      "Unrelated origin",
      "five",
    );
    await expect(
      replacement.interact(sessionB.id, {
        observationId: unrelatedDomain.observationId,
        action: {
          kind: "click",
          target: target(unrelatedDomain, "Create record"),
        },
        expectedEffects: [{ kind: "url_changed" }],
        consequential: true,
        consequenceKey: "fixture:form:unrelated-origin",
      }),
    ).rejects.toMatchObject({ code: "CONSEQUENTIAL_ACTION_UNRESOLVED" });
    expect(unrelatedServer.mutationCount()).toBe(0);

    const productAuthorizationBoundary = new SessionController(replacement);
    await productAuthorizationBoundary.authorizeEffectRepeat(sessionB.id, {
      effectId: unresolved!.effectId,
      authorizationId: "effect_repeat_12345678-1234-4123-8123-123456789abc",
    });

    const authorizedProgress = await prepareForm(
      replacement,
      sessionB.id,
      affectedServer,
      "Issue B",
      "six",
    );
    await expect(
      replacement.interact(sessionB.id, {
        observationId: authorizedProgress.observationId,
        action: {
          kind: "click",
          target: target(authorizedProgress, "Create record"),
        },
        expectedEffects: [{ kind: "url_changed" }],
        consequential: true,
        consequenceKey: "fixture:form:authorized-progress",
      }),
    ).resolves.toMatchObject({ outcome: "applied" });
    expect(affectedServer.mutationCount()).toBe(2);
    expect(
      await originalJournal.find(
        taskABootstrap,
        workspace.id,
        "fixture:form:issue-a:unknown",
      ),
    ).toMatchObject({
      state: "unresolved",
      repeatAuthorization: {
        consumedByAttemptId: expect.stringMatching(/^effect_attempt_/),
      },
    });
    const consumed = (await originalJournal.findById(unresolved!.effectId))!
      .repeatAuthorization!.consumedByAttemptId!;
    const authorizedEffectId = createHash("sha256")
      .update(
        [
          taskBBootstrap,
          workspace.id,
          "fixture:form:authorized-progress",
          consumed,
        ].join("\0"),
      )
      .digest("hex");
    expect(await originalJournal.findById(authorizedEffectId)).toMatchObject({
      state: "applied",
      taskScope: taskBBootstrap,
      attemptId: consumed,
    });

    await replacement.endSession(sessionB.id);
    const taskCBootstrap = `boot_${"c".repeat(32)}`;
    const sessionC = await replacement.startSession({
      bootstrapId: taskCBootstrap,
      mode: "agent",
      startUrl: `${affectedServer.url}/consequential-form?churn=seven`,
      browser: { mode: "workspace", workspaceId: workspace.id },
    });
    active.push({ runtime: replacement, id: sessionC.id });
    const reusedCallerKey = await prepareForm(
      replacement,
      sessionC.id,
      affectedServer,
      "Issue C",
      "seven",
    );
    await expect(
      replacement.interact(sessionC.id, {
        observationId: reusedCallerKey.observationId,
        action: {
          kind: "click",
          target: target(reusedCallerKey, "Create record"),
        },
        expectedEffects: [{ kind: "url_changed" }],
        consequential: true,
        consequenceKey: "fixture:form:authorized-progress",
      }),
    ).rejects.toMatchObject({ code: "CONSEQUENTIAL_ACTION_UNRESOLVED" });
    expect(affectedServer.mutationCount()).toBe(2);

    const independentWorkspace =
      await replacement.createBrowserWorkspace("Independent");
    const sessionD = await replacement.startSession({
      bootstrapId: `boot_${"d".repeat(32)}`,
      mode: "agent",
      startUrl: `${unrelatedServer.url}/consequential-form?churn=eight`,
      browser: { mode: "workspace", workspaceId: independentWorkspace.id },
    });
    active.push({ runtime: replacement, id: sessionD.id });
    const independentAction = await prepareForm(
      replacement,
      sessionD.id,
      unrelatedServer,
      "Independent",
      "eight",
    );
    await expect(
      replacement.interact(sessionD.id, {
        observationId: independentAction.observationId,
        action: {
          kind: "click",
          target: target(independentAction, "Create record"),
        },
        expectedEffects: [{ kind: "url_changed" }],
        consequential: true,
        consequenceKey: "fixture:form:independent-workspace",
      }),
    ).resolves.toMatchObject({ outcome: "applied" });
    expect(unrelatedServer.mutationCount()).toBe(1);
  }, 30_000);

  it("records Browser-proven pre-dispatch rejection as not applied without fencing the workspace", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness();
    const workspace = (await runtime.listBrowserWorkspaces()).workspaces[0]!;
    const bootstrapId = `boot_${"e".repeat(32)}`;
    const session = await runtime.startSession({
      bootstrapId,
      mode: "agent",
      startUrl: `${server.url}/consequential-form?churn=predispatch`,
      browser: { mode: "workspace", workspaceId: workspace.id },
    });
    active.push({ runtime, id: session.id });
    const observation = await runtime.inspectBrowser(session.id);
    const liveBrowser = browser.get(session.id);
    const interact = liveBrowser.interact.bind(liveBrowser);
    Object.defineProperty(liveBrowser, "interact", {
      configurable: true,
      value: async (...args: Parameters<typeof interact>) => {
        await liveBrowser.navigate(`${server.url}/result`);
        return interact(...args);
      },
    });

    await expect(
      runtime.interact(session.id, {
        observationId: observation.observationId,
        action: {
          kind: "click",
          target: target(observation, "Create record"),
        },
        expectedEffects: [{ kind: "url_changed" }],
        consequential: true,
        consequenceKey: "fixture:predispatch:rejected",
      }),
    ).rejects.toMatchObject({ code: "OBSERVATION_STALE" });
    expect(server.mutationCount()).toBe(0);

    const runtimeInternal = runtime as unknown as {
      config: ReturnType<typeof loadConfig>;
    };
    const journal = new FileEffectJournalStore(runtimeInternal.config.home);
    await expect(
      journal.find(bootstrapId, workspace.id, "fixture:predispatch:rejected"),
    ).resolves.toMatchObject({ state: "not_applied" });

    Object.defineProperty(liveBrowser, "interact", {
      configurable: true,
      value: interact,
    });
    await runtime.inspectBrowser(session.id);
    await runtime.navigate(session.id, {
      url: `${server.url}/consequential-form?churn=retry`,
    });
    const fresh = await runtime.inspectBrowser(session.id);
    await expect(
      runtime.interact(session.id, {
        observationId: fresh.observationId,
        action: {
          kind: "click",
          target: target(fresh, "Create record"),
        },
        expectedEffects: [{ kind: "url_changed" }],
        consequential: true,
        consequenceKey: "fixture:predispatch:fresh-work",
      }),
    ).resolves.toMatchObject({ outcome: "applied" });
    expect(server.mutationCount()).toBe(1);
  }, 15_000);

  it("rejects a semantic transfer commit whose expected effect is unrelated to the source", async () => {
    const server = await fixture();
    const { runtime } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/semantic-transfer`,
    });
    active.push({ runtime, id: session.id });

    const initial = await runtime.inspectBrowser(session.id);
    const begun = await runtime.beginSemanticTransaction(session.id, {
      observationId: initial.observationId,
      kind: "transfer",
      sourceTarget: target(initial, "Quarterly report"),
      destination: {
        verification: "destination_observation",
        label: "Archive",
      },
      mechanism: "drag",
      consequenceKey: "fixture:move:weak-commit-evidence",
    });

    await expect(
      runtime.advanceSemanticTransaction(session.id, {
        transactionId: begun.transactionId,
        observationId: initial.observationId,
        phase: "commit",
        action: {
          kind: "click",
          target: target(initial, "Quarterly report"),
        },
        expectedEffects: [{ kind: "text_present", text: "Archive" }],
        effect: "external_commit",
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_STATE_INVALID" });

    expect(
      await runtime.getSemanticTransaction(session.id, begun.transactionId),
    ).toMatchObject({ status: "prepared", steps: [] });
    expect(
      (await runtime.inspectBrowser(session.id)).targets?.find(
        (item) => item.name === "Quarterly report",
      )?.state?.expanded,
    ).not.toBe(true);
  });

  it("executes a freshly grounded semantic transfer through one explicit commit", async () => {
    const server = await fixture();
    const { runtime } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/semantic-transfer`,
    });
    active.push({ runtime, id: session.id });

    const initial = await runtime.inspectBrowser(session.id);
    const begun = await runtime.beginSemanticTransaction(session.id, {
      observationId: initial.observationId,
      kind: "transfer",
      sourceTarget: target(initial, "Quarterly report"),
      destination: {
        verification: "within_scope",
        scope: { kind: "list", label: "Archive" },
      },
      mechanism: "menu",
      consequenceKey: "fixture:move:quarterly-report:archive",
    });
    const duplicate = await runtime.beginSemanticTransaction(session.id, {
      observationId: initial.observationId,
      kind: "transfer",
      sourceTarget: target(initial, "Quarterly report"),
      destination: {
        verification: "within_scope",
        scope: { kind: "list", label: "Archive" },
      },
      mechanism: "menu",
      consequenceKey: "fixture:move:quarterly-report:archive",
    });

    expect(duplicate.transactionId).toBe(begun.transactionId);
    expect(begun).toMatchObject({
      status: "prepared",
      source: { name: "Quarterly report", kind: "button" },
      destination: {
        verification: "within_scope",
        scope: { kind: "list", label: "Archive" },
      },
    });

    const prepared = await runtime.advanceSemanticTransaction(session.id, {
      transactionId: begun.transactionId,
      observationId: initial.observationId,
      phase: "prepare",
      action: { kind: "click", target: target(initial, "Quarterly report") },
      expectedEffects: [
        {
          kind: "target_present",
          target: { name: "Move to Archive", kind: "menuitem" },
        },
      ],
      effect: "reversible_ui",
    });

    expect(prepared).toMatchObject({
      transaction: { status: "in_progress" },
      receipt: { outcome: "applied", consequential: false },
    });

    const commitObservation = await runtime.inspectBrowser(session.id);
    expect(commitObservation.observationId).not.toBe(initial.observationId);
    const committed = await runtime.advanceSemanticTransaction(session.id, {
      transactionId: begun.transactionId,
      observationId: commitObservation.observationId,
      phase: "commit",
      action: {
        kind: "click",
        target: target(commitObservation, "Move to Archive"),
      },
      expectedEffects: [
        {
          kind: "target_within_scope",
          target: { name: "Quarterly report", kind: "button" },
          scope: { kind: "list", label: "Archive" },
        },
      ],
      effect: "external_commit",
    });

    expect(committed).toMatchObject({
      transaction: { status: "committed" },
      receipt: {
        outcome: "applied",
        consequential: true,
        consequenceKey: "fixture:move:quarterly-report:archive",
      },
    });

    const verificationObservation = await runtime.inspectBrowser(session.id);
    expect(verificationObservation.observationId).not.toBe(
      commitObservation.observationId,
    );
    const verified = await runtime.verifySemanticTransaction(session.id, {
      transactionId: begun.transactionId,
      observationId: verificationObservation.observationId,
      additionalExpectedEffects: [
        { kind: "text_present", text: "Moved to Archive" },
      ],
    });

    expect(verified).toMatchObject({
      outcome: "applied",
      transaction: {
        status: "verified",
        steps: [
          { phase: "prepare", outcome: "applied" },
          { phase: "commit", outcome: "applied" },
        ],
        verification: {
          observationId: verificationObservation.observationId,
          outcome: "applied",
        },
      },
      effects: [
        {
          effect: {
            kind: "target_within_scope",
            scope: { kind: "list", label: "Archive" },
          },
          state: "observed",
        },
        {
          effect: { kind: "text_present", text: "Moved to Archive" },
          state: "observed",
        },
      ],
    });

    await expect(
      runtime.cancelSemanticTransaction(session.id, begun.transactionId),
    ).rejects.toMatchObject({ code: "TRANSACTION_STATE_INVALID" });
    expect(
      (await runtime.getObservations(session.id)).items.map(
        (observation) => observation.type,
      ),
    ).toEqual(
      expect.arrayContaining([
        "semantic_transaction_begun",
        "semantic_transaction_advanced",
        "semantic_transaction_verified",
      ]),
    );
  }, 15_000);

  it("stages trusted clipboard cut from an exactly selected transaction source", async () => {
    const server = await fixture();
    const { runtime } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/semantic-clipboard-transfer`,
    });
    active.push({ runtime, id: session.id });

    const initial = await runtime.inspectBrowser(session.id);
    const source = initial.targets?.find(
      (candidate) =>
        candidate.kind === "gridcell" && candidate.name === "Quarterly report",
    );
    expect(source).toMatchObject({ state: { selected: true } });
    if (source === undefined) throw new Error("Missing selected source");

    const begun = await runtime.beginSemanticTransaction(session.id, {
      observationId: initial.observationId,
      kind: "transfer",
      sourceTarget: {
        pageId: initial.pageId,
        revision: initial.revision,
        ref: source.ref,
      },
      destination: {
        verification: "destination_observation",
        label: "Archive",
      },
      mechanism: "keyboard",
      consequenceKey: "fixture:clipboard:quarterly-report:archive",
    });

    const prepared = await runtime.advanceSemanticTransaction(session.id, {
      transactionId: begun.transactionId,
      observationId: initial.observationId,
      phase: "prepare",
      action: { kind: "clipboard", operation: "cut" },
      expectedEffects: [],
      effect: "reversible_ui",
    });

    expect(prepared).toMatchObject({
      transaction: {
        status: "in_progress",
        steps: [
          {
            outcome: "unknown",
            dispatchStatus: "completed",
            evidenceBasis: "trusted_dispatch",
          },
        ],
      },
      receipt: {
        dispatched: true,
        dispatchStatus: "completed",
        outcome: "unknown",
        consequential: false,
      },
    });
    expect((await runtime.inspectBrowser(session.id)).text).toContain(
      "Cut received",
    );
  }, 10_000);

  it("rejects effect-free clipboard staging when the exact source is not selected", async () => {
    const server = await fixture();
    const { runtime } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/semantic-transfer`,
    });
    active.push({ runtime, id: session.id });

    const initial = await runtime.inspectBrowser(session.id);
    const begun = await runtime.beginSemanticTransaction(session.id, {
      observationId: initial.observationId,
      kind: "transfer",
      sourceTarget: target(initial, "Quarterly report"),
      destination: {
        verification: "destination_observation",
        label: "Archive",
      },
      mechanism: "keyboard",
      consequenceKey: "fixture:clipboard:unselected-report:archive",
    });

    await expect(
      runtime.advanceSemanticTransaction(session.id, {
        transactionId: begun.transactionId,
        observationId: initial.observationId,
        phase: "prepare",
        action: { kind: "clipboard", operation: "cut" },
        expectedEffects: [],
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_STATE_INVALID" });

    expect(
      await runtime.getSemanticTransaction(session.id, begun.transactionId),
    ).toMatchObject({ status: "prepared", steps: [] });
  });

  it("verifies a remote transfer from exact source presence plus independent destination context", async () => {
    const server = await fixture();
    const { runtime } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/semantic-transfer`,
    });
    active.push({ runtime, id: session.id });

    const initial = await runtime.inspectBrowser(session.id);
    const begun = await runtime.beginSemanticTransaction(session.id, {
      observationId: initial.observationId,
      kind: "transfer",
      sourceTarget: target(initial, "Quarterly report"),
      destination: {
        verification: "destination_observation",
        label: "Archive",
      },
      mechanism: "menu",
      consequenceKey: "fixture:move:quarterly-report:remote-archive",
    });

    await runtime.advanceSemanticTransaction(session.id, {
      transactionId: begun.transactionId,
      observationId: initial.observationId,
      phase: "prepare",
      action: { kind: "click", target: target(initial, "Quarterly report") },
      expectedEffects: [
        {
          kind: "target_present",
          target: { name: "Move to Archive", kind: "menuitem" },
        },
      ],
      effect: "reversible_ui",
    });

    const commitObservation = await runtime.inspectBrowser(session.id);
    await runtime.advanceSemanticTransaction(session.id, {
      transactionId: begun.transactionId,
      observationId: commitObservation.observationId,
      phase: "commit",
      action: {
        kind: "click",
        target: target(commitObservation, "Move to Archive"),
      },
      expectedEffects: [
        {
          kind: "target_within_scope",
          target: { name: "Quarterly report", kind: "button" },
          scope: { kind: "list", label: "Archive" },
        },
      ],
    });

    const destinationObservation = await runtime.inspectBrowser(session.id);
    await expect(
      runtime.verifySemanticTransaction(session.id, {
        transactionId: begun.transactionId,
        observationId: destinationObservation.observationId,
      }),
    ).rejects.toMatchObject({ code: "TRANSACTION_STATE_INVALID" });

    const verified = await runtime.verifySemanticTransaction(session.id, {
      transactionId: begun.transactionId,
      observationId: destinationObservation.observationId,
      additionalExpectedEffects: [
        { kind: "text_present", text: "Moved to Archive" },
      ],
    });

    expect(verified).toMatchObject({
      outcome: "applied",
      transaction: {
        status: "verified",
        destination: {
          verification: "destination_observation",
          label: "Archive",
        },
      },
      effects: [
        {
          effect: {
            kind: "target_present",
            target: { name: "Quarterly report", kind: "button" },
          },
          state: "observed",
        },
        {
          effect: { kind: "text_present", text: "Moved to Archive" },
          state: "observed",
        },
      ],
    });
  }, 15_000);

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
        mimeType: "text/plain",
        mimeTypeBasis: "filename_extension",
        source: "browser_download",
        sizeBytes: "rove session download".length,
      },
    });

    expect(downloaded.data).toMatchObject({
      evidenceId: file?.id,
      mimeType: "text/plain",
      mimeTypeBasis: "filename_extension",
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

  it.each([
    ["Download file", "rove-session-download.txt"],
    ["Slow download file", "rove-slow-download.txt"],
  ])(
    "verifies an action-correlated managed download from %s",
    async (targetName, filename) => {
      const server = await fixture();
      const { runtime } = await harness();
      const session = await runtime.startSession({
        mode: "agent",
        startUrl: `${server.url}/download`,
      });
      active.push({ runtime, id: session.id });

      const inspection = await runtime.inspectBrowser(session.id);
      const receipt = await runtime.interact(session.id, {
        observationId: inspection.observationId,
        action: { kind: "click", target: target(inspection, targetName) },
        expectedEffects: [{ kind: "download_completed", filename }],
        consequential: true,
        consequenceKey: `download:${filename}`,
      });

      expect(receipt).toMatchObject({
        dispatched: true,
        outcome: "applied",
        effects: [
          {
            effect: { kind: "download_completed", filename },
            state: "observed",
            observationId: expect.stringMatching(/^obs_/),
            evidenceId: expect.stringMatching(/^ev_/),
          },
        ],
      });
      expect(
        (await runtime.listEvidence(session.id)).filter(
          (item) => item.type === "file",
        ),
      ).toHaveLength(1);
    },
    15_000,
  );

  it("contradicts an action-correlated download with the wrong filename", async () => {
    const server = await fixture();
    const { runtime } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/download`,
    });
    active.push({ runtime, id: session.id });
    const inspection = await runtime.inspectBrowser(session.id);

    const receipt = await runtime.interact(session.id, {
      observationId: inspection.observationId,
      action: {
        kind: "click",
        target: target(inspection, "Download file"),
      },
      expectedEffects: [
        { kind: "download_completed", filename: "different.txt" },
      ],
    });

    expect(receipt).toMatchObject({
      outcome: "not_applied",
      effects: [
        {
          state: "contradicted",
          code: "DOWNLOAD_FILENAME_MISMATCH",
          observationId: expect.stringMatching(/^obs_/),
          evidenceId: expect.stringMatching(/^ev_/),
        },
      ],
    });
  }, 15_000);

  it("returns honest contradiction for an action-correlated download failure", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/download`,
    });
    active.push({ runtime, id: session.id });
    const inspection = await runtime.inspectBrowser(session.id);
    const liveBrowser = browser.get(session.id);
    const interact = liveBrowser.interact.bind(liveBrowser);
    const emitActivity = (
      liveBrowser as unknown as {
        emitActivity: (activity: unknown) => void;
      }
    ).emitActivity.bind(liveBrowser);
    Object.defineProperty(liveBrowser, "interact", {
      configurable: true,
      value: async (...args: Parameters<typeof interact>) => {
        const result = await interact(...args);
        emitActivity({
          type: "download_failed",
          pageId: result.pageId,
          timestamp: new Date().toISOString(),
          data: {
            reason: "fixture transport failure",
            suggestedFilename: "rove-failed-download.txt",
            downloadUrl: `${server.url}/failed-download-probe`,
            actionBoundaryId: args[1].activityBoundaryId,
            correlation: "matched",
          },
        });
        return result;
      },
    });

    const receipt = await runtime.interact(session.id, {
      observationId: inspection.observationId,
      action: {
        kind: "click",
        target: target(inspection, "Failed download probe"),
      },
      expectedEffects: [{ kind: "download_completed" }],
    });

    expect(receipt).toMatchObject({
      dispatched: true,
      outcome: "not_applied",
      effects: [
        {
          state: "contradicted",
          code: "DOWNLOAD_FAILED",
          observationId: expect.stringMatching(/^obs_/),
        },
      ],
    });
    expect(
      (await runtime.listEvidence(session.id)).filter(
        (item) => item.type === "file",
      ),
    ).toHaveLength(0);
  }, 15_000);

  it("does not let old download evidence satisfy a new action and fences replay without redispatch", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness(undefined, { actionMs: 100 });
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/download`,
    });
    active.push({ runtime, id: session.id });

    let inspection = await runtime.inspectBrowser(session.id);
    await runtime.click(session.id, {
      target: target(inspection, "Download file"),
    });
    await waitForObservation(runtime, session.id, "download_completed");

    const liveBrowser = browser.get(session.id);
    const interact = liveBrowser.interact.bind(liveBrowser);
    let dispatches = 0;
    Object.defineProperty(liveBrowser, "interact", {
      configurable: true,
      value: async (...args: Parameters<typeof interact>) => {
        dispatches += 1;
        return interact(...args);
      },
    });

    inspection = await runtime.inspectBrowser(session.id);
    const request = {
      observationId: inspection.observationId,
      action: {
        kind: "click" as const,
        target: target(inspection, "Failed download probe"),
      },
      expectedEffects: [{ kind: "download_completed" as const }],
      consequential: true,
      consequenceKey: "download:no-event",
    };
    const receipt = await runtime.interact(session.id, request);

    expect(receipt).toMatchObject({
      dispatched: true,
      outcome: "unknown",
      effects: [{ state: "unresolved", code: "DOWNLOAD_TIMEOUT" }],
    });
    expect(dispatches).toBe(1);

    inspection = await runtime.inspectBrowser(session.id);
    await expect(
      runtime.interact(session.id, {
        ...request,
        observationId: inspection.observationId,
        action: {
          ...request.action,
          target: target(inspection, "Failed download probe"),
        },
      }),
    ).rejects.toMatchObject({ code: "CONSEQUENTIAL_ACTION_UNRESOLVED" });
    expect(dispatches).toBe(1);
    expect(
      (await runtime.listEvidence(session.id)).filter(
        (item) => item.type === "file",
      ),
    ).toHaveLength(1);
  }, 15_000);

  it("fences a consequential download when ownership generation changes while completion is pending", async () => {
    const server = await fixture();
    const { runtime, browser, ownershipFence } = await harness(undefined, {
      actionMs: 1_000,
    });
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/download`,
    });
    active.push({ runtime, id: session.id });
    let inspection = await runtime.inspectBrowser(session.id);
    const liveBrowser = browser.get(session.id);
    const interact = liveBrowser.interact.bind(liveBrowser);
    const dispatched = raceGate();
    let dispatches = 0;
    Object.defineProperty(liveBrowser, "interact", {
      configurable: true,
      value: async (...args: Parameters<typeof interact>) => {
        dispatches += 1;
        const result = await interact(...args);
        dispatched.resolve();
        return result;
      },
    });
    const consequenceKey = "download:ownership-change";
    const pending = runtime.interact(session.id, {
      observationId: inspection.observationId,
      action: {
        kind: "click",
        target: target(inspection, "Failed download probe"),
      },
      expectedEffects: [{ kind: "download_completed" }],
      consequential: true,
      consequenceKey,
    });
    await dispatched.promise;
    const transitionStarted = observeNextOwnershipTransition(ownershipFence);
    const handoff = runtimeOwnershipTransitions(runtime).requestHuman(
      session.id,
      "download completion ownership race",
    );
    await transitionStarted;

    await expect(pending).rejects.toMatchObject({ code: "CONTROL_NOT_OWNED" });
    await expect(handoff).resolves.toMatchObject({
      status: "awaiting_human",
      controller: null,
    });
    await runtime.takeHumanControl(session.id);
    await runtime.returnAgentControl(session.id);
    inspection = await runtime.inspectBrowser(session.id);
    await expect(
      runtime.interact(session.id, {
        observationId: inspection.observationId,
        action: {
          kind: "click",
          target: target(inspection, "Failed download probe"),
        },
        expectedEffects: [{ kind: "download_completed" }],
        consequential: true,
        consequenceKey,
      }),
    ).rejects.toMatchObject({ code: "CONSEQUENTIAL_ACTION_UNRESOLVED" });
    expect(dispatches).toBe(1);
  }, 15_000);

  it("keeps an overlapping delayed prior same-URL download ambiguous", async () => {
    const server = await fixture();
    const { runtime } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/download`,
    });
    active.push({ runtime, id: session.id });
    let inspection = await runtime.inspectBrowser(session.id);
    await runtime.click(session.id, {
      target: target(inspection, "Schedule unrelated download"),
    });
    inspection = await runtime.inspectBrowser(session.id);

    const receipt = await runtime.interact(session.id, {
      observationId: inspection.observationId,
      action: {
        kind: "click",
        target: target(inspection, "Delayed requested download"),
      },
      expectedEffects: [{ kind: "download_completed" }],
    });

    expect(receipt).toMatchObject({
      dispatched: true,
      outcome: "unknown",
      effects: [
        {
          state: "unresolved",
          code: "DOWNLOAD_CORRELATION_AMBIGUOUS",
        },
      ],
    });
  }, 15_000);

  it("verifies one exact action-bound no-href button download", async () => {
    const server = await fixture();
    const { runtime } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/download`,
    });
    active.push({ runtime, id: session.id });
    const inspection = await runtime.inspectBrowser(session.id);

    const receipt = await runtime.interact(session.id, {
      observationId: inspection.observationId,
      action: {
        kind: "click",
        target: target(inspection, "Button download"),
      },
      expectedEffects: [{ kind: "download_completed" }],
    });

    expect(receipt).toMatchObject({
      dispatched: true,
      outcome: "applied",
      effects: [
        {
          state: "observed",
          observationId: expect.stringMatching(/^obs_/),
          evidenceId: expect.stringMatching(/^ev_/),
        },
      ],
    });
    const observation = await waitForObservation(
      runtime,
      session.id,
      "download_completed",
    );
    expect(observation.data).toMatchObject({
      correlation: "matched",
      correlationStrategy: "trusted_action_download",
    });
    expect(
      (await runtime.listEvidence(session.id)).filter(
        (item) => item.type === "file",
      ),
    ).toHaveLength(1);
  }, 15_000);

  it("keeps two no-href downloads in one action boundary ambiguous", async () => {
    const server = await fixture();
    const { runtime } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/download`,
    });
    active.push({ runtime, id: session.id });
    const inspection = await runtime.inspectBrowser(session.id);
    const receipt = await runtime.interact(session.id, {
      observationId: inspection.observationId,
      action: {
        kind: "click",
        target: target(inspection, "Button download twice"),
      },
      expectedEffects: [{ kind: "download_completed" }],
      consequential: true,
      consequenceKey: "download:dynamic-two",
    });

    expect(receipt).toMatchObject({
      dispatched: true,
      outcome: "unknown",
      effects: [
        { state: "unresolved", code: "DOWNLOAD_CORRELATION_AMBIGUOUS" },
      ],
    });
    expect(
      (await runtime.listEvidence(session.id)).filter(
        (item) => item.type === "file",
      ),
    ).toHaveLength(2);
  }, 15_000);

  it.runIf(process.platform === "darwin")(
    "verifies Chromium PDF viewer Download through its bounded viewer identity",
    async () => {
      const server = await fixture();
      const { runtime } = await harness(undefined, {
        headless: false,
        actionMs: 2_000,
      });
      const session = await runtime.startSession({
        mode: "agent",
        startUrl: `${server.url}/fixture.pdf`,
      });
      active.push({ runtime, id: session.id });
      const inspection = await runtime.inspectBrowser(session.id);

      const receipt = await runtime.interact(session.id, {
        observationId: inspection.observationId,
        action: {
          kind: "click",
          target: target(inspection, "Download"),
        },
        expectedEffects: [
          { kind: "download_completed", filename: "rove-fixture.pdf" },
        ],
      });

      expect(receipt).toMatchObject({
        dispatched: true,
        outcome: "applied",
        effects: [
          {
            state: "observed",
            observationId: expect.stringMatching(/^obs_/),
            evidenceId: expect.stringMatching(/^ev_/),
          },
        ],
      });
      expect(
        (await runtime.listEvidence(session.id)).filter(
          (item) => item.type === "file",
        ),
      ).toHaveLength(1);
      expect(
        (await runtime.getObservations(session.id)).items.find(
          (item) => item.type === "download_completed",
        ),
      ).toMatchObject({
        data: {
          downloadUrl: `${server.url}/fixture.pdf`,
          correlation: "matched",
          correlationStrategy: "chromium_pdf_viewer",
        },
      });
    },
    20_000,
  );

  it("cancels the registered Runtime waiter after BrowserSession rejects before dispatch", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/download`,
    });
    active.push({ runtime, id: session.id });
    const inspection = await runtime.inspectBrowser(session.id);
    const liveBrowser = browser.get(session.id);
    const interact = liveBrowser.interact.bind(liveBrowser);
    let waiterCountAtBrowserEntry = 0;
    Object.defineProperty(liveBrowser, "interact", {
      configurable: true,
      value: async (
        request: Parameters<typeof interact>[0],
        context: Parameters<typeof interact>[1],
      ) => {
        waiterCountAtBrowserEntry = (
          runtime as unknown as {
            downloadEffectWaiters: Map<string, unknown>;
          }
        ).downloadEffectWaiters.size;
        if (request.kind !== "click") {
          throw new Error("Expected the download fixture click.");
        }
        return interact(
          {
            ...request,
            target: { ...request.target, ref: "t_missing" },
          },
          context,
        );
      },
    });

    await expect(
      runtime.interact(session.id, {
        observationId: inspection.observationId,
        action: {
          kind: "click",
          target: target(inspection, "Download file"),
        },
        expectedEffects: [{ kind: "download_completed" }],
      }),
    ).rejects.toMatchObject({ code: "TARGET_NOT_FOUND" });

    expect(waiterCountAtBrowserEntry).toBe(1);
    expect(
      (
        runtime as unknown as {
          downloadEffectWaiters: Map<string, unknown>;
        }
      ).downloadEffectWaiters.size,
    ).toBe(0);
    expect(
      (
        liveBrowser as unknown as {
          downloadCorrelationWindows: Map<string, unknown>;
        }
      ).downloadCorrelationWindows.size,
    ).toBe(0);
  }, 15_000);

  it("materializes generated and user-granted bytes as opaque file evidence", async () => {
    const { runtime } = await harness();
    const session = await runtime.startSession({ mode: "agent" });
    active.push({ runtime, id: session.id });

    const generated = await runtime.materializeFileEvidence(session.id, {
      filename: "acceptance.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("Rove acceptance"),
      source: "agent_generated",
    });
    const granted = await runtime.materializeFileEvidence(session.id, {
      filename: "selected.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      source: "user_file_grant",
      grantId: `grant_${"a".repeat(32)}`,
    });

    expect(generated).toMatchObject({
      type: "file",
      label: "acceptance.txt",
      metadata: {
        filename: "acceptance.txt",
        mimeType: "text/plain",
        sizeBytes: 15,
        source: "agent_generated",
      },
    });
    expect(generated.metadata?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(granted).toMatchObject({
      type: "file",
      metadata: {
        filename: "selected.pdf",
        source: "user_file_grant",
        grantId: `grant_${"a".repeat(32)}`,
      },
    });
    expect(JSON.stringify(granted)).not.toContain("/tmp/");
    await expect(
      runtime.readEvidence(session.id, generated.id),
    ).resolves.toMatchObject({
      binary: { available: true, encoding: "external" },
    });
    expect(
      (await runtime.getObservations(session.id)).items.slice(-2),
    ).toMatchObject([
      { actor: "agent", type: "file_artifact_created" },
      { actor: "human", type: "local_file_granted" },
    ]);
    await expect(
      runtime.deleteFileGrant(session.id, `grant_${"a".repeat(32)}`),
    ).resolves.toEqual({
      sessionId: session.id,
      grantId: `grant_${"a".repeat(32)}`,
      deleted: 1,
    });
    expect(
      (await runtime.listEvidence(session.id)).map((item) => item.id),
    ).toContain(generated.id);
    expect(
      (await runtime.listEvidence(session.id)).map((item) => item.id),
    ).not.toContain(granted.id);
    await expect(
      runtime.deleteFileGrant(session.id, `grant_${"a".repeat(32)}`),
    ).resolves.toMatchObject({ deleted: 0 });
    await expect(
      runtime.materializeFileEvidence(session.id, {
        filename: "not-granted.txt",
        mimeType: "text/plain",
        bytes: new Uint8Array(),
        source: "user_file_grant",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
    await expect(
      runtime.materializeFileEvidence(session.id, {
        filename: "generated.txt",
        mimeType: "text/plain",
        bytes: new Uint8Array(),
        source: "agent_generated",
        grantId: `grant_${"b".repeat(32)}`,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
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
    const firstSession = await runtime.startSession({
      mode: "agent",
      browser: { mode: "temporary" },
    });
    const secondSession = await runtime.startSession({
      mode: "agent",
      browser: { mode: "temporary" },
    });
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

describe("human activity foundation", () => {
  it("persists browser lifecycle activity only while human owns control", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness();

    const capture = await runtime.startSession({
      mode: "capture",
      browser: { mode: "temporary" },
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
      browser: { mode: "temporary" },
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

describe("human DOM activity", () => {
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
    // Control transitions are validated at their authoritative boundary.
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

describe("adversarial ownership races", () => {
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
    // proves the required post-action ordering.
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
