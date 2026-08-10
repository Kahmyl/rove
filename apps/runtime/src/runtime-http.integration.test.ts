import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, NestFactory, type INestApplication } from "@nestjs/core";
import { afterEach, describe, expect, it } from "vitest";

import { PlaywrightBrowserEngine } from "@rove/browser";
import { loadConfig } from "@rove/config";
import type { PageInspection } from "@rove/protocol";
import { FileEvidenceStore, FileObservationStore, FileSessionStore } from "@rove/storage";
import { startFixtureServer, type FixtureServer } from "../../../packages/browser/src/fixtures/fixture-server.js";
import { BrowserController } from "./api/browser.controller.js";
import { EvidenceController } from "./api/evidence.controller.js";
import { HealthController } from "./api/health.controller.js";
import { ObservationController } from "./api/observation.controller.js";
import { RoveErrorFilter } from "./api/rove-error.filter.js";
import { RuntimeAuthGuard, assertRuntimeBindingSafe } from "./api/runtime-auth.guard.js";
import { SessionController } from "./api/session.controller.js";
import { BrowserService } from "./browser/browser.service.js";
import { BrowserCommandCoordinator } from "./control/command-coordinator.js";
import { ControlService } from "./control/control.service.js";
import { ControlWaitService } from "./control/control-wait.service.js";
import { EvidenceService } from "./evidence/evidence.service.js";
import { ObservationService } from "./observation/observation.service.js";
import { RuntimeService } from "./runtime.service.js";
import { SessionService } from "./session/session.service.js";
import { ROVE_CONFIG } from "./tokens.js";
import { ControlController } from "./api/control.controller.js";

const apps: INestApplication[] = [];
const homes: string[] = [];
const servers: FixtureServer[] = [];

function requiredTarget(inspection: PageInspection, name: string) {
  const item = inspection.targets?.find((candidate) => candidate.name === name);
  if (!item) throw new Error(`Missing HTTP fixture target: ${name}`);
  return item;
}

async function startHttp(token?: string): Promise<{ baseUrl: string; authorization: string; home: string; waits: ControlWaitService }> {
  const home = await mkdtemp(join(tmpdir(), "rove-http-"));
  homes.push(home);
  const config = loadConfig({
    cwd: home,
    env: {
      ROVE_BROWSER: "chromium",
      ROVE_BROWSER_HEADLESS: "true",
      ...(token === undefined ? {} : { ROVE_RUNTIME_TOKEN: token }),
    },
  });
  const sessions = new SessionService(new FileSessionStore(home));
  const observations = new ObservationService(new FileObservationStore(home));
  const waits = new ControlWaitService(sessions, observations);
  const runtime = new RuntimeService(
    sessions,
    new ControlService(),
    waits,
    new BrowserCommandCoordinator(),
    new BrowserService(new PlaywrightBrowserEngine()),
    observations,
    new EvidenceService(new FileEvidenceStore(home)),
    config,
  );

  @Module({
    controllers: [HealthController, SessionController, BrowserController, ObservationController, EvidenceController, ControlController],
    providers: [
      { provide: RuntimeService, useValue: runtime },
      { provide: ROVE_CONFIG, useValue: config },
      { provide: APP_GUARD, useClass: RuntimeAuthGuard },
      { provide: APP_FILTER, useClass: RoveErrorFilter },
    ],
  })
  class TestHttpModule {}

  const app = await NestFactory.create(TestHttpModule, { logger: false });
  apps.push(app);
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, authorization: token === undefined ? "" : `Bearer ${token}`, home, waits };
}

async function json(baseUrl: string, path: string, init: RequestInit = {}, authorization = "") {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(authorization === "" ? {} : { authorization }),
      ...init.headers,
    },
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
  while (servers.length > 0) await servers.pop()?.close();
  while (homes.length > 0) await rm(homes.pop()!, { recursive: true, force: true });
});

describe("Milestone 4 runtime HTTP API", () => {
  it("serves the complete authenticated browser, observation, evidence, and session path", async () => {
    const token = "runtime-test-token-123456789";
    const { baseUrl, authorization } = await startHttp(token);
    const fixture = await startFixtureServer();
    servers.push(fixture);

    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    expect((await json(baseUrl, "/sessions", { method: "POST", body: JSON.stringify({ mode: "agent" }) })).response.status).toBe(401);
    expect((await json(baseUrl, "/sessions", { method: "POST", body: JSON.stringify({ mode: "agent" }), headers: { authorization: "Bearer wrong-token" } })).response.status).toBe(401);

    const started = await json(baseUrl, "/sessions", {
      method: "POST",
      body: JSON.stringify({ mode: "agent", startUrl: `${fixture.url}/actions` }),
    }, authorization);
    expect(started.response.status, JSON.stringify(started.body)).toBe(201);
    const sessionId = String(started.body.id);
    expect(sessionId).toMatch(/^ses_/);
    expect((await json(baseUrl, `/sessions/${sessionId}`, {}, authorization)).body).toMatchObject({ status: "active" });

    const inspected = await json(baseUrl, `/sessions/${sessionId}/browser/inspect`, { method: "POST", body: "{}" }, authorization);
    const inspection = inspected.body as unknown as PageInspection;
    const search = requiredTarget(inspection, "Search");
    const change = requiredTarget(inspection, "Change state");
    const searchRef = { pageId: inspection.pageId, revision: inspection.revision, ref: search.ref };
    const typed = await json(baseUrl, `/sessions/${sessionId}/browser/type`, {
      method: "POST",
      body: JSON.stringify({ target: searchRef, value: "backend" }),
    }, authorization);
    expect(typed.body).toMatchObject({ sessionId, action: "type" });

    const inspectedAgain = await json(baseUrl, `/sessions/${sessionId}/browser/inspect`, { method: "POST", body: "{}" }, authorization);
    const nextInspection = inspectedAgain.body as unknown as PageInspection;
    const nextChange = requiredTarget(nextInspection, "Change state");
    const clicked = await json(baseUrl, `/sessions/${sessionId}/browser/click`, {
      method: "POST",
      body: JSON.stringify({ target: { pageId: nextInspection.pageId, revision: nextInspection.revision, ref: nextChange.ref } }),
    }, authorization);
    expect(clicked.body).toMatchObject({ sessionId, action: "click" });

    const stale = await json(baseUrl, `/sessions/${sessionId}/browser/click`, {
      method: "POST",
      body: JSON.stringify({ target: { pageId: inspection.pageId, revision: inspection.revision, ref: change.ref } }),
    }, authorization);
    expect(stale.response.status).toBe(409);
    expect(stale.body).toMatchObject({ ok: false, error: { code: "TARGET_STALE", retryable: true } });

    const pages = await json(baseUrl, `/sessions/${sessionId}/browser/pages`, {}, authorization);
    expect(pages.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: "page_01" })]));
    const screenshot = await json(baseUrl, `/sessions/${sessionId}/browser/screenshot`, { method: "POST", body: "{}" }, authorization);
    expect(screenshot.body).toMatchObject({ type: "screenshot", sessionId });
    const record = await json(baseUrl, `/sessions/${sessionId}/evidence`, {
      method: "POST",
      body: JSON.stringify({ type: "record", payload: { title: "Senior Backend Engineer", company: "Example" } }),
    }, authorization);
    expect(record.body).toMatchObject({ type: "record", sessionId });
    const evidence = await json(baseUrl, `/sessions/${sessionId}/evidence`, {}, authorization);
    expect((evidence.body as unknown as unknown[])).toHaveLength(2);
    expect((await json(baseUrl, `/sessions/${sessionId}/evidence/${String(record.body.id)}`, {}, authorization)).body).toMatchObject({ id: record.body.id });
    const observations = await json(baseUrl, `/sessions/${sessionId}/observations?afterSeq=0&limit=100`, {}, authorization);
    expect((observations.body.items as { type: string }[]).map((item) => item.type)).toEqual(expect.arrayContaining(["session_started", "agent_typed", "agent_clicked", "screenshot_captured", "record_saved"]));
    const ended = await json(baseUrl, `/sessions/${sessionId}/end`, { method: "POST" }, authorization);
    expect(ended.body).toMatchObject({ status: "completed", controller: null });
  });

  it("rejects non-loopback configuration without a token", () => {
    const config = loadConfig({ env: { ROVE_RUNTIME_HOST: "0.0.0.0" } });
    expect(() => assertRuntimeBindingSafe(config)).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
  });

  it("serves authenticated explicit control operations and cancels disconnected waits", async () => {
    const token = "runtime-control-token-123456";
    const { baseUrl, authorization, waits } = await startHttp(token);
    const started = await json(baseUrl, "/sessions", { method: "POST", body: JSON.stringify({ mode: "agent" }) }, authorization);
    const sessionId = String(started.body.id);
    expect((await json(baseUrl, `/sessions/${sessionId}/control`, {}, authorization)).body).toMatchObject({ controller: "agent", status: "active" });
    const requested = await json(baseUrl, `/sessions/${sessionId}/control/request-human`, {
      method: "POST",
      body: JSON.stringify({ reason: "Manual update" }),
    }, authorization);
    expect(requested.body).toMatchObject({ controller: null, status: "awaiting_human", handoff: { reason: "Manual update" } });
    const waitPromise = json(baseUrl, `/sessions/${sessionId}/control/wait?afterSeq=${String(requested.body.observationSeq)}&timeoutMs=1000`, {}, authorization);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const taken = await json(baseUrl, `/sessions/${sessionId}/control/take`, { method: "POST" }, authorization);
    expect(taken.body).toMatchObject({ controller: "human" });
    expect((await waitPromise).body).toMatchObject({ event: "human_took_control" });
    const returned = await json(baseUrl, `/sessions/${sessionId}/control/return`, { method: "POST" }, authorization);
    expect(returned.body).toMatchObject({ controller: "agent" });

    const abort = new AbortController();
    const disconnected = fetch(`${baseUrl}/sessions/${sessionId}/control/wait?afterSeq=${String(returned.body.observationSeq)}&timeoutMs=10000`, {
      headers: { authorization },
      signal: abort.signal,
    });
    while (waits.waiterCount(sessionId) === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    abort.abort();
    await expect(disconnected).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(waits.waiterCount(sessionId)).toBe(0);
    expect((await json(baseUrl, `/sessions/${sessionId}/control`, {}, authorization)).body).toMatchObject({ status: "active", controller: "agent" });
    await json(baseUrl, `/sessions/${sessionId}/end`, { method: "POST" }, authorization);
  });
});
