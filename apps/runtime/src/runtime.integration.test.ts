import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PlaywrightBrowserEngine, type BrowserEngine, type BrowserSession } from "@rove/browser";
import { loadConfig } from "@rove/config";
import { RoveError, type PageInspection, type TargetReference } from "@rove/protocol";
import { FileEvidenceStore, FileObservationStore, FileSessionStore } from "@rove/storage";
import { startFixtureServer, type FixtureServer } from "../../../packages/browser/src/fixtures/fixture-server.js";
import { BrowserService } from "./browser/browser.service.js";
import { BrowserCommandCoordinator } from "./control/command-coordinator.js";
import { ControlService } from "./control/control.service.js";
import { ControlWaitService } from "./control/control-wait.service.js";
import { EvidenceService } from "./evidence/evidence.service.js";
import { ObservationService } from "./observation/observation.service.js";
import { RuntimeService } from "./runtime.service.js";
import { SessionService } from "./session/session.service.js";

interface Harness {
  home: string;
  runtime: RuntimeService;
  browser: BrowserService;
  sessions: SessionService;
}

const homes: string[] = [];
const servers: FixtureServer[] = [];
const active: { runtime: RuntimeService; id: string }[] = [];

async function harness(engine: BrowserEngine = new PlaywrightBrowserEngine()): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), "rove-runtime-"));
  homes.push(home);
  const sessions = new SessionService(new FileSessionStore(home));
  const browser = new BrowserService(engine);
  const observations = new ObservationService(new FileObservationStore(home));
  const runtime = new RuntimeService(
    sessions,
    new ControlService(),
    new ControlWaitService(sessions, observations),
    new BrowserCommandCoordinator(),
    browser,
    observations,
    new EvidenceService(new FileEvidenceStore(home)),
    loadConfig({ cwd: home, env: { ROVE_BROWSER: "chromium", ROVE_BROWSER_HEADLESS: "true" } }),
  );
  return { home, runtime, browser, sessions };
}

async function fixture(): Promise<FixtureServer> {
  const server = await startFixtureServer();
  servers.push(server);
  return server;
}

function target(inspection: PageInspection, name: string): TargetReference {
  const item = inspection.targets?.find((candidate) => candidate.name === name);
  if (!item) throw new Error(`Missing target ${name}`);
  return { pageId: inspection.pageId, revision: inspection.revision, ref: item.ref };
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
  while (homes.length > 0) await rm(homes.pop()!, { recursive: true, force: true });
});

describe("Milestone 4 runtime integration", () => {
  it("starts real agent, companion, and capture sessions with the correct lifecycle", async () => {
    const { runtime, browser, home } = await harness();
    const agent = await runtime.startSession({ mode: "agent" });
    active.push({ runtime, id: agent.id });
    expect(agent).toMatchObject({ status: "active", controller: "agent", activePageId: "page_01" });
    expect(agent.id).toMatch(/^ses_/);
    expect(browser.has(agent.id)).toBe(true);
    expect(JSON.parse(await readFile(join(home, "sessions", agent.id, "session.json"), "utf8"))).toMatchObject({ status: "active" });
    expect((await runtime.getObservations(agent.id)).items.map((item) => item.type)).toEqual(["session_started"]);

    const companion = await runtime.startSession({ mode: "companion" });
    active.push({ runtime, id: companion.id });
    expect(companion.controller).toBe("agent");

    const capture = await runtime.startSession({ mode: "capture" });
    active.push({ runtime, id: capture.id });
    expect(capture.controller).toBe("human");
    await expect(runtime.navigate(capture.id, { url: "about:blank" })).rejects.toMatchObject({ code: "CONTROL_NOT_OWNED" });
  });

  it("persists failed startup and its observation", async () => {
    const failing: BrowserEngine = {
      start: async () => { throw new RoveError({ code: "BROWSER_LAUNCH_FAILED", message: "Expected launch failure." }); },
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
    expect((await runtime.getObservations(sessionId)).items.map((item) => item.type)).toEqual(["session_failed"]);
  });

  it("orchestrates real actions, persistence, evidence, and historical reads without persisting typed values", async () => {
    const server = await fixture();
    const { runtime, browser, home } = await harness();
    const session = await runtime.startSession({ mode: "agent", startUrl: `${server.url}/actions` });
    active.push({ runtime, id: session.id });
    expect(session.activePageId).toBe("page_01");
    await runtime.navigate(session.id, { url: `${server.url}/actions` });
    let inspection = await runtime.inspectBrowser(session.id);
    const secret = "DO_NOT_PERSIST_THIS_VALUE";
    const typed = await runtime.type(session.id, { target: target(inspection, "Password"), value: secret });
    expect(typed.sessionId).toBe(session.id);
    inspection = await runtime.inspectBrowser(session.id);
    const clicked = await runtime.click(session.id, { target: target(inspection, "Change state") });
    expect(clicked.sessionId).toBe(session.id);
    const screenshot = await runtime.captureScreenshot(session.id);
    expect(screenshot).toMatchObject({ sessionId: session.id, type: "screenshot", metadata: { mimeType: "image/png", mode: "viewport" } });
    expect((await readdir(join(home, "sessions", session.id, "evidence", "screenshots"))).some((name) => name.endsWith(".png"))).toBe(true);

    const record = await runtime.saveEvidence(session.id, {
      type: "record",
      payload: { title: "Senior Backend Engineer", company: "Example" },
    });
    expect((await runtime.listEvidence(session.id)).map((item) => item.id)).toEqual(expect.arrayContaining([screenshot.id, record.id]));
    expect((await runtime.readEvidence(session.id, record.id)).id).toBe(record.id);

    const observations = (await runtime.getObservations(session.id)).items;
    expect(observations.map((item) => item.type)).toEqual(["session_started", "browser_navigated", "agent_typed", "agent_clicked", "screenshot_captured", "record_saved"]);
    expect(observations.map((item) => item.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(JSON.stringify(observations)).not.toContain(secret);
    expect(await allFileText(join(home, "sessions", session.id))).not.toContain(secret);

    const ended = await runtime.endSession(session.id);
    active.pop();
    expect(ended).toMatchObject({ status: "completed", controller: null });
    expect(ended.endedAt).toBeDefined();
    expect(browser.has(session.id)).toBe(false);
    await expect(runtime.endSession(session.id)).rejects.toMatchObject({ code: "SESSION_ALREADY_ENDED" });
    await expect(runtime.inspectBrowser(session.id)).rejects.toMatchObject({ code: "SESSION_NOT_ACTIVE" });
    await expect(runtime.navigate(session.id, { url: server.url })).rejects.toMatchObject({ code: "SESSION_NOT_ACTIVE" });
    expect((await runtime.getObservations(session.id)).items.at(-1)?.type).toBe("session_completed");
    expect((await runtime.listEvidence(session.id)).length).toBe(2);

    const recreated = new EvidenceService(new FileEvidenceStore(home));
    expect((await recreated.metadata(session.id, record.id)).id).toBe(record.id);
  });

  it("serializes runtime mutations per session without blocking another session", async () => {
    const order: string[] = [];
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
    let markSlowStarted!: () => void;
    const slowStarted = new Promise<void>((resolve) => { markSlowStarted = resolve; });
    let browserCounter = 0;
    const engine: BrowserEngine = {
      start: async () => {
        const browserId = `browser_fake_${browserCounter++}`;
        return {
          id: browserId,
          pages: async () => [{ id: "page_01", url: "about:blank", active: true, revision: 0 }],
          navigate: async (url: string) => {
            if (url.endsWith("/slow")) {
              order.push(`${browserId}:slow:start`);
              markSlowStarted();
              await slowGate;
              order.push(`${browserId}:slow:end`);
            } else {
              order.push(`${browserId}:fast`);
            }
            return { ok: true, action: "navigate", sessionId: browserId, pageId: "page_01", pageChanged: true, previousRevision: 0, currentRevision: 1, url };
          },
          close: async () => undefined,
        } as BrowserSession;
      },
    };
    const { runtime } = await harness(engine);
    const firstSession = await runtime.startSession({ mode: "agent" });
    const secondSession = await runtime.startSession({ mode: "agent" });
    active.push({ runtime, id: firstSession.id }, { runtime, id: secondSession.id });

    const first = runtime.navigate(firstSession.id, { url: "https://example.test/slow" });
    await slowStarted;
    const queued = runtime.navigate(firstSession.id, { url: "https://example.test/fast" });
    await runtime.navigate(secondSession.id, { url: "https://example.test/fast" });
    expect(order).toEqual(["browser_fake_0:slow:start", "browser_fake_1:fast"]);
    releaseSlow();
    await Promise.all([first, queued]);
    expect(order).toEqual(["browser_fake_0:slow:start", "browser_fake_1:fast", "browser_fake_0:slow:end", "browser_fake_0:fast"]);
  });
});
