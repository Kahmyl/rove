import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlaywrightBrowserEngine, type BrowserEngine, type BrowserSession } from "@rove/browser";
import { loadConfig } from "@rove/config";
import { RoveError, type BrowserRuntimeCapabilities, type PageInspection, type TargetReference } from "@rove/protocol";
import { FileEvidenceStore, FileObservationStore, FileSessionStore } from "@rove/storage";
import { startFixtureServer, type FixtureServer } from "../../../../packages/browser/src/fixtures/fixture-server.js";
import { BrowserService } from "../browser/browser.service.js";
import { EvidenceService } from "../evidence/evidence.service.js";
import { ObservationService } from "../observation/observation.service.js";
import { RuntimeService } from "../runtime.service.js";
import { SessionService } from "../session/session.service.js";
import { BrowserCommandCoordinator } from "./command-coordinator.js";
import { ControlService } from "./control.service.js";
import { ControlWaitService } from "./control-wait.service.js";

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

async function harness(engine: BrowserEngine = new PlaywrightBrowserEngine()) {
  const home = await mkdtemp(join(tmpdir(), "rove-control-"));
  homes.push(home);
  const sessions = new SessionService(new FileSessionStore(home));
  const observations = new ObservationService(new FileObservationStore(home));
  const browser = new BrowserService(engine);
  const waits = new ControlWaitService(sessions, observations);
  const runtime = new RuntimeService(
    sessions,
    new ControlService(),
    waits,
    new BrowserCommandCoordinator(),
    browser,
    observations,
    new EvidenceService(new FileEvidenceStore(home)),
    loadConfig({ cwd: home, env: { ROVE_BROWSER: "chromium", ROVE_BROWSER_HEADLESS: "true" } }),
  );
  return { runtime, browser, waits };
}

function target(inspection: PageInspection, name: string): TargetReference {
  const item = inspection.targets?.find((candidate) => candidate.name === name);
  if (!item) throw new Error(`Missing control fixture target: ${name}`);
  return { pageId: inspection.pageId, revision: inspection.revision, ref: item.ref };
}

afterEach(async () => {
  while (active.length > 0) {
    const item = active.pop()!;
    await item.runtime.endSession(item.id).catch(() => undefined);
  }
  while (servers.length > 0) await servers.pop()?.close();
  while (homes.length > 0) await rm(homes.pop()!, { recursive: true, force: true });
});

describe("Milestone 7 requested handoff", () => {
  it("persists request, blocks mutations, wakes waits, and stales old targets before handback", async () => {
    const fixture = await startFixtureServer();
    servers.push(fixture);
    const { runtime } = await harness();
    const session = await runtime.startSession({ mode: "agent", startUrl: `${fixture.url}/handoff` });
    active.push({ runtime, id: session.id });
    const inspection = await runtime.inspectBrowser(session.id);
    const oldTarget = target(inspection, "Update");

    const requested = await runtime.requestHuman(session.id, { reason: "  Please update the fixture.  " });
    expect(requested).toMatchObject({ status: "awaiting_human", controller: null, handoff: { reason: "Please update the fixture." } });
    const duplicate = await runtime.requestHuman(session.id, { reason: "Replace the original" });
    expect(duplicate.handoff?.reason).toBe("Please update the fixture.");
    await expect(runtime.navigate(session.id, { url: fixture.url })).rejects.toMatchObject({ code: "CONTROL_NOT_OWNED" });
    await expect(runtime.click(session.id, { target: oldTarget })).rejects.toMatchObject({ code: "CONTROL_NOT_OWNED" });
    await expect(runtime.type(session.id, { target: target(inspection, "New value"), value: "blocked" })).rejects.toMatchObject({ code: "CONTROL_NOT_OWNED" });
    await expect(runtime.inspectBrowser(session.id)).resolves.toMatchObject({ pageId: "page_01" });

    const waitForTake = runtime.waitForControl(session.id, { afterSeq: requested.observationSeq, timeoutMs: 1_000 });
    const taken = await runtime.takeHumanControl(session.id);
    expect(taken).toMatchObject({ status: "active", controller: "human", handoff: { reason: "Please update the fixture." } });
    await expect(waitForTake).resolves.toMatchObject({ event: "human_took_control", observationSeq: taken.observationSeq });
    await expect(runtime.click(session.id, { target: oldTarget })).rejects.toMatchObject({ code: "CONTROL_NOT_OWNED" });

    const waitForReturn = runtime.waitForControl(session.id, { afterSeq: taken.observationSeq, timeoutMs: 1_000 });
    const returned = await runtime.returnAgentControl(session.id);
    expect(returned).toMatchObject({ status: "active", controller: "agent" });
    expect(returned.handoff).toBeUndefined();
    await expect(waitForReturn).resolves.toMatchObject({ event: "human_returned_control", observationSeq: returned.observationSeq });
    await expect(runtime.click(session.id, { target: oldTarget })).rejects.toMatchObject({ code: "INSPECTION_REQUIRED" });
    const fresh = await runtime.inspectBrowser(session.id);
    await expect(runtime.click(session.id, { target: oldTarget })).rejects.toMatchObject({ code: "TARGET_STALE" });
    await expect(runtime.click(session.id, { target: target(fresh, "Update") })).resolves.toMatchObject({ ok: true });

    const events = (await runtime.getObservations(session.id)).items.filter((item) => item.type.startsWith("human_"));
    expect(events.map((item) => item.type)).toEqual(["human_requested", "human_took_control", "human_returned_control"]);
  });

  it("wakes a pending wait when the session completes", async () => {
    const { runtime } = await harness();
    const session = await runtime.startSession({ mode: "agent" });
    active.push({ runtime, id: session.id });
    const pending = runtime.waitForControl(session.id, { afterSeq: 1, timeoutMs: 5_000 });
    await runtime.endSession(session.id);
    active.pop();
    await expect(pending).resolves.toMatchObject({ event: "session_completed", status: "completed" });
  }, 10_000);
});

describe("Milestone 7 mode transitions and all-page invalidation", () => {
  it("supports voluntary Companion takeover and preserves Capture ownership", async () => {
    const { runtime } = await harness();
    const agent = await runtime.startSession({ mode: "agent" });
    const companion = await runtime.startSession({ mode: "companion" });
    const capture = await runtime.startSession({ mode: "capture" });
    active.push({ runtime, id: agent.id }, { runtime, id: companion.id }, { runtime, id: capture.id });
    await expect(runtime.takeHumanControl(agent.id)).rejects.toMatchObject({ code: "HUMAN_CONTROL_REQUIRED" });
    await expect(runtime.takeHumanControl(companion.id)).resolves.toMatchObject({ controller: "human", status: "active" });
    await expect(runtime.navigate(companion.id, { url: "about:blank" })).rejects.toMatchObject({ code: "CONTROL_NOT_OWNED" });
    await expect(runtime.returnAgentControl(companion.id)).resolves.toMatchObject({ controller: "agent" });
    await expect(runtime.takeHumanControl(capture.id)).resolves.toMatchObject({ controller: "human" });
    await expect(runtime.returnAgentControl(capture.id)).rejects.toMatchObject({ code: "CONTROL_NOT_OWNED" });
  });

  it("orders running action, takeover, blocked action, return invalidation, and queued stale action", async () => {
    const order: string[] = [];
    let releaseSlow!: () => void;
    const gate = new Promise<void>((resolve) => { releaseSlow = resolve; });
    let invalidated = false;
    const actionResult = (action: "navigate" | "click") => ({ ok: true, action, sessionId: "browser_race", pageId: "page_01", pageChanged: false, previousRevision: 0, currentRevision: invalidated ? 1 : 0, url: "about:blank" });
    const fake: BrowserSession = {
      id: "browser_race",
      capabilities: testCapabilities,
      onActivity: () => () => undefined,
      pages: async () => [{ id: "page_01", url: "about:blank", active: true, revision: invalidated ? 1 : 0 }],
      inspect: async () => ({
        pageId: "page_01",
        revision: invalidated ? 1 : 0,
        url: "about:blank",
        title: "",
      }),
      navigate: async () => {
        order.push("slow:start");
        await gate;
        order.push("slow:end");
        return actionResult("navigate");
      },
      click: async () => {
        order.push("click:validate");
        if (invalidated) throw new RoveError({ code: "TARGET_STALE", message: "Old target.", retryable: true });
        return actionResult("click");
      },
      invalidateAllTargets: async () => { invalidated = true; order.push("invalidate"); return 1; },
      close: async () => undefined,
    } as BrowserSession;
    const { runtime } = await harness({ start: async () => fake });
    const session = await runtime.startSession({ mode: "agent" });
    active.push({ runtime, id: session.id });
    const slow = runtime.navigate(session.id, { url: "https://example.test/slow" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = runtime.requestHuman(session.id, { reason: "Take over" });
    const blocked = runtime.navigate(session.id, { url: "https://example.test/queued" }).catch((error: unknown) => error);
    releaseSlow();
    await slow;
    await expect(request).resolves.toMatchObject({ controller: null });
    await expect(blocked).resolves.toMatchObject({ code: "CONTROL_NOT_OWNED" });
    expect(order).toEqual(["slow:start", "slow:end"]);

    await runtime.takeHumanControl(session.id);
    const returned = runtime.returnAgentControl(session.id);
    const stale = runtime.click(session.id, { target: { pageId: "page_01", revision: 0, ref: "t1" } }).catch((error: unknown) => error);
    await returned;
    await expect(stale).resolves.toMatchObject({ code: "INSPECTION_REQUIRED" });
    expect(order.at(-1)).toBe("invalidate");
    await runtime.inspectBrowser(session.id);
    await expect(runtime.click(session.id, { target: { pageId: "page_01", revision: 0, ref: "t1" } })).rejects.toMatchObject({ code: "TARGET_STALE" });
    expect(order.slice(-2)).toEqual(["invalidate", "click:validate"]);
  });

  it("increments every page exactly once and synchronizes the active page before return", async () => {
    const fixture = await startFixtureServer();
    servers.push(fixture);
    const { runtime, browser } = await harness();
    const session = await runtime.startSession({ mode: "companion", startUrl: `${fixture.url}/actions` });
    active.push({ runtime, id: session.id });
    let inspection1 = await runtime.inspectBrowser(session.id);
    await runtime.click(session.id, { target: target(inspection1, "Open popup") });
    await browser.get(session.id).navigate(`${fixture.url}/handoff`);
    const inspection2 = await runtime.inspectBrowser(session.id);
    const ref2 = target(inspection2, "Update");
    await browser.get(session.id).switchPage("page_01");
    inspection1 = await runtime.inspectBrowser(session.id);
    const ref1 = target(inspection1, "Change state");
    const before = await runtime.pages(session.id);

    await runtime.takeHumanControl(session.id);
    await browser.get(session.id).switchPage("page_02");
    await runtime.returnAgentControl(session.id);
    expect((await runtime.getSession(session.id)).activePageId).toBe("page_02");
    const after = await runtime.pages(session.id);
    for (const page of before) {
      expect(after.find((item) => item.id === page.id)?.revision).toBe(page.revision + 1);
    }
    await expect(runtime.click(session.id, { target: ref1 })).rejects.toMatchObject({ code: "INSPECTION_REQUIRED" });
    await runtime.inspectBrowser(session.id);
    await expect(runtime.click(session.id, { target: ref1 })).rejects.toMatchObject({ code: "TARGET_STALE" });
    await expect(runtime.click(session.id, { target: ref2 })).rejects.toMatchObject({ code: "TARGET_STALE" });
  });

  it("fails the session and wakes waiters when the human closes the browser", async () => {
    const { runtime, browser } = await harness();
    const session = await runtime.startSession({ mode: "companion" });
    active.push({ runtime, id: session.id });
    const taken = await runtime.takeHumanControl(session.id);
    const pending = runtime.waitForControl(session.id, { afterSeq: taken.observationSeq, timeoutMs: 1_000 });
    await browser.get(session.id).close();
    await expect(runtime.returnAgentControl(session.id)).rejects.toMatchObject({ code: "BROWSER_CLOSED" });
    await expect(pending).resolves.toMatchObject({ event: "session_failed", status: "failed", controller: null });
    expect(await runtime.getSession(session.id)).toMatchObject({ status: "failed", controller: null });
    active.pop();
  });
});
