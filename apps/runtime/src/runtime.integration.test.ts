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

function readyBrowserSession(id: string): BrowserSession {
  return {
    id,
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
    const observations =
      await runtime.getObservations(sessionId);

    const observation =
      observations.items.find(
        (item) => item.type === type,
      );

    if (observation !== undefined) {
      return observation;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 20),
    );
  }

  throw new Error(
    `Timed out waiting for observation ${type}.`,
  );
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

  it("pauses for human review when a site explicitly restricts access", async () => {
    const server = await fixture();
    const { runtime } = await harness();
    const session = await runtime.startSession({
      mode: "agent",
      startUrl: `${server.url}/access-restricted`,
    });
    active.push({ runtime, id: session.id });

    expect(session).toMatchObject({
      status: "awaiting_human",
      controller: null,
      handoff: { reason: "The site has restricted access and requires human review." },
    });
    expect((await runtime.getObservations(session.id)).items.map((item) => item.type)).toEqual([
      "session_started",
      "site_access_restricted",
    ]);
    await expect(runtime.navigate(session.id, { url: server.url })).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });
  });

  it.each([
    ["human-verification", "human_verification_required", "human verification step"],
    ["authentication", "authentication_required", "requires authentication"],
    ["unknown-interstitial", "unknown_interstitial", "unrecognized interstitial"],
  ])("classifies %s as a distinct human-only page state", async (route, eventType, reason) => {
    const server = await fixture();
    const { runtime } = await harness();
    const session = await runtime.startSession({ mode: "agent", startUrl: `${server.url}/${route}` });
    active.push({ runtime, id: session.id });

    expect(session).toMatchObject({ status: "awaiting_human", controller: null });
    expect(session.handoff?.reason).toContain(reason);
    expect((await runtime.getObservations(session.id)).items.map((item) => item.type)).toEqual([
      "session_started",
      eventType,
    ]);
  });

  it("requires a fresh inspection after human control returns", async () => {
    const server = await fixture();
    const { runtime, browser } = await harness();
    const session = await runtime.startSession({ mode: "agent", startUrl: `${server.url}/actions` });
    active.push({ runtime, id: session.id });

    await runtime.requestHuman(session.id, { reason: "Smoke-test handoff" });
    await runtime.takeHumanControl(session.id);
    await browser.get(session.id).navigate(`${server.url}/result`);
    await runtime.returnAgentControl(session.id);

    await expect(runtime.navigate(session.id, { url: `${server.url}/actions` })).rejects.toMatchObject({
      code: "INSPECTION_REQUIRED",
    });
    await runtime.inspectBrowser(session.id);
    await expect(runtime.navigate(session.id, { url: `${server.url}/actions` })).resolves.toMatchObject({ ok: true });
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
    await expect(runtime.readEvidence(session.id, file!.id))
      .resolves.toMatchObject({
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
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
    let markSlowStarted!: () => void;
    const slowStarted = new Promise<void>((resolve) => { markSlowStarted = resolve; });
    let browserCounter = 0;
    const engine: BrowserEngine = {
      start: async () => {
        const browserId = `browser_fake_${browserCounter++}`;
        return {
          id: browserId,
          onActivity: () => () => undefined,
          pages: async () => [{ id: "page_01", url: "about:blank", active: true, revision: 0 }],
          inspect: async () => ({
            pageId: "page_01",
            revision: 0,
            url: "about:blank",
            title: "",
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


describe("Milestone 9 human activity foundation", () => {
  it("persists browser lifecycle activity only while human owns control", async () => {
    const server = await fixture();
    const {
      runtime,
      browser,
    } = await harness();

    const capture =
      await runtime.startSession({
        mode: "capture",
      });

    active.push({
      runtime,
      id: capture.id,
    });

    await browser
      .get(capture.id)
      .navigate(`${server.url}/actions`);

    const urlChanged =
      await waitForObservation(
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

    const navigation =
      await waitForObservation(
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

    const agent =
      await runtime.startSession({
        mode: "agent",
      });

    active.push({
      runtime,
      id: agent.id,
    });

    await browser
      .get(agent.id)
      .navigate(`${server.url}/actions`);

    await new Promise((resolve) =>
      setTimeout(resolve, 100),
    );

    expect(
      (
        await runtime.getObservations(
          agent.id,
        )
      ).items.map((item) => item.type),
    ).toEqual([
      "session_started",
    ]);
  });
});

describe("Milestone 9 human DOM activity", () => {
  it("persists ordered minimized human interactions without sensitive field values", async () => {
    const server = await fixture();

    const {
      runtime,
      browser,
      home,
    } = await harness();

    const capture =
      await runtime.startSession({
        mode: "capture",
      });

    active.push({
      runtime,
      id: capture.id,
    });

    const sessionBrowser =
      browser.get(capture.id);

    await sessionBrowser.navigate(
      `${server.url}/actions`,
    );

    await waitForObservation(
      runtime,
      capture.id,
      "navigation_completed",
    );

    const secret =
      "M9_SECRET_MUST_NEVER_PERSIST";

    let inspection =
      await sessionBrowser.inspect();

    await sessionBrowser.type(
      target(
        inspection,
        "Password",
      ),
      secret,
    );

    inspection =
      await sessionBrowser.inspect();

    await sessionBrowser.click(
      target(
        inspection,
        "Submit search",
      ),
    );

    await waitForObservation(
      runtime,
      capture.id,
      "human_submit",
    );

    inspection =
      await sessionBrowser.inspect();

    const select =
      inspection.targets?.find(
        (item) =>
          item.kind === "select",
      );

    if (select === undefined) {
      throw new Error(
        "Missing select target.",
      );
    }

    await sessionBrowser.press(
      {
        pageId: inspection.pageId,
        revision:
          inspection.revision,
        ref: select.ref,
      },
      "o",
    );

    const selection =
      await waitForObservation(
        runtime,
        capture.id,
        "human_selection",
      );

    expect(
      selection.data,
    ).toMatchObject({
      selectedIndex: 1,
    });

    await sessionBrowser.scroll({
      direction: "down",
      amount: 2_000,
    });

    await waitForObservation(
      runtime,
      capture.id,
      "human_scroll",
    );

    inspection =
      await sessionBrowser.inspect();

    await sessionBrowser.click(
      target(
        inspection,
        "Open popup",
      ),
    );

    await waitForObservation(
      runtime,
      capture.id,
      "page_opened",
    );

    await sessionBrowser.switchPage(
      "page_01",
    );

    await waitForObservation(
      runtime,
      capture.id,
      "page_switched",
    );

    const observations =
      (
        await runtime.getObservations(
          capture.id,
        )
      ).items;

    const types =
      observations.map(
        (item) => item.type,
      );

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

    expect(
      observations.map(
        (item) => item.seq,
      ),
    ).toEqual(
      observations.map(
        (_, index) => index + 1,
      ),
    );

    expect(
      JSON.stringify(observations),
    ).not.toContain(secret);

    expect(
      await allFileText(
        join(
          home,
          "sessions",
          capture.id,
        ),
      ),
    ).not.toContain(secret);

    await expect(
      runtime.navigate(
        capture.id,
        {
          url: `${server.url}/result`,
        },
      ),
    ).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });
  });
});
