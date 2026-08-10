import { createInterface } from "node:readline/promises";
import type { AddressInfo } from "node:net";
import { NestFactory } from "@nestjs/core";
import { startFixtureServer } from "@rove/browser";
import { loadConfig } from "@rove/config";
import type { ControlStatus, ControlWaitResult, PageInspection, Session } from "@rove/protocol";
import { AppModule } from "../app.module.js";

const config = loadConfig();
const fixture = await startFixtureServer();
const app = await NestFactory.create(AppModule, { logger: ["error"] });
await app.listen(0, config.runtime.host);
const address = app.getHttpServer().address() as AddressInfo;
const baseUrl = `http://${config.runtime.host}:${address.port}`;
const headers = { "content-type": "application/json", ...(config.runtime.token === undefined ? {} : { authorization: `Bearer ${config.runtime.token}` }) };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const body = await response.json() as T & { error?: { code?: string; message?: string } };
  if (!response.ok) throw Object.assign(new Error(body.error?.message ?? "Runtime request failed."), { code: body.error?.code });
  return body;
}

async function pauseForHuman(): Promise<void> {
  if (process.env.ROVE_CONTROL_DEMO_WAIT !== "1") return;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  await readline.question("Use the visible browser to update the fixture, then press Enter...");
  readline.close();
}

try {
  const agent = await request<Session>("/sessions", { method: "POST", body: JSON.stringify({ mode: "agent", startUrl: `${fixture.url}/handoff` }) });
  const inspection = await request<PageInspection>(`/sessions/${agent.id}/browser/inspect`, { method: "POST", body: "{}" });
  const update = inspection.targets?.find((item) => item.name === "Update");
  if (!update) throw new Error("Handoff target was not found.");
  const oldTarget = { pageId: inspection.pageId, revision: inspection.revision, ref: update.ref };
  const requested = await request<ControlStatus>(`/sessions/${agent.id}/control/request-human`, { method: "POST", body: JSON.stringify({ reason: "Please manually update the fixture." }) });
  console.log(`requested: ${requested.status}/${String(requested.controller)}`);
  try {
    await request(`/sessions/${agent.id}/browser/click`, { method: "POST", body: JSON.stringify({ target: oldTarget }) });
  } catch (error) {
    console.log(`blocked: ${error instanceof Error && "code" in error ? String(error.code) : "unexpected"}`);
  }
  const tookWait = request<ControlWaitResult>(`/sessions/${agent.id}/control/wait?afterSeq=${String(requested.observationSeq)}&timeoutMs=5000`);
  const taken = await request<ControlStatus>(`/sessions/${agent.id}/control/take`, { method: "POST" });
  console.log(`take: ${(await tookWait).event} ${taken.controller}`);
  await pauseForHuman();
  const returnWait = request<ControlWaitResult>(`/sessions/${agent.id}/control/wait?afterSeq=${String(taken.observationSeq)}&timeoutMs=5000`);
  const returned = await request<ControlStatus>(`/sessions/${agent.id}/control/return`, { method: "POST" });
  console.log(`return: ${(await returnWait).event} ${returned.controller}`);
  try {
    await request(`/sessions/${agent.id}/browser/click`, { method: "POST", body: JSON.stringify({ target: oldTarget }) });
  } catch (error) {
    console.log(`old target: ${error instanceof Error && "code" in error ? String(error.code) : "unexpected"}`);
  }
  await request(`/sessions/${agent.id}/end`, { method: "POST" });

  const companion = await request<Session>("/sessions", { method: "POST", body: JSON.stringify({ mode: "companion", startUrl: `${fixture.url}/handoff` }) });
  const voluntary = await request<ControlStatus>(`/sessions/${companion.id}/control/take`, { method: "POST" });
  console.log(`companion take: ${voluntary.controller}`);
  try {
    await request(`/sessions/${companion.id}/browser/navigate`, { method: "POST", body: JSON.stringify({ url: fixture.url }) });
  } catch (error) {
    console.log(`companion blocked: ${error instanceof Error && "code" in error ? String(error.code) : "unexpected"}`);
  }
  console.log(`companion return: ${(await request<ControlStatus>(`/sessions/${companion.id}/control/return`, { method: "POST" })).controller}`);
  await request(`/sessions/${companion.id}/end`, { method: "POST" });
} finally {
  await app.close();
  await fixture.close();
}
