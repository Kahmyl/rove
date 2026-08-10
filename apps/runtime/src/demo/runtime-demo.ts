import { NestFactory } from "@nestjs/core";
import type { AddressInfo } from "node:net";
import { startFixtureServer } from "@rove/browser";
import { loadConfig } from "@rove/config";
import type { PageInspection } from "@rove/protocol";
import { AppModule } from "../app.module.js";

const config = loadConfig();
const fixture = await startFixtureServer();
const app = await NestFactory.create(AppModule, { logger: ["error"] });
await app.listen(0, config.runtime.host);
const address = app.getHttpServer().address() as AddressInfo;
const baseUrl = `http://${config.runtime.host}:${address.port}`;
const headers = {
  "content-type": "application/json",
  ...(config.runtime.token === undefined ? {} : { authorization: `Bearer ${config.runtime.token}` }),
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `Runtime request failed with ${response.status}.`);
  return body;
}

try {
  const session = await request<{ id: string; activePageId?: string }>("/sessions", {
    method: "POST",
    body: JSON.stringify({ mode: "agent" }),
  });
  console.log(`session: ${session.id}`);
  console.log(`page: ${session.activePageId ?? "unknown"}`);
  await request(`/sessions/${session.id}/browser/navigate`, {
    method: "POST",
    body: JSON.stringify({ url: `${fixture.url}/actions` }),
  });

  let inspection = await request<PageInspection>(`/sessions/${session.id}/browser/inspect`, { method: "POST", body: "{}" });
  const ref = (name: string) => {
    const item = inspection.targets?.find((candidate) => candidate.name === name);
    if (!item) throw new Error(`Runtime demo target not found: ${name}`);
    return { pageId: inspection.pageId, revision: inspection.revision, ref: item.ref };
  };
  const search = ref("Search");
  console.log(`target: ${search.ref}`);
  await request(`/sessions/${session.id}/browser/type`, { method: "POST", body: JSON.stringify({ target: search, value: "backend" }) });
  inspection = await request<PageInspection>(`/sessions/${session.id}/browser/inspect`, { method: "POST", body: "{}" });
  await request(`/sessions/${session.id}/browser/type`, {
    method: "POST",
    body: JSON.stringify({ target: ref("Password"), value: "ROVE_TEST_SECRET_849291" }),
  });
  inspection = await request<PageInspection>(`/sessions/${session.id}/browser/inspect`, { method: "POST", body: "{}" });
  await request(`/sessions/${session.id}/browser/click`, { method: "POST", body: JSON.stringify({ target: ref("Submit search") }) });
  const evidence = await request<{ id: string }>(`/sessions/${session.id}/browser/screenshot`, { method: "POST", body: "{}" });
  console.log(`evidence: ${evidence.id}`);
  await request(`/sessions/${session.id}/evidence`, {
    method: "POST",
    body: JSON.stringify({ type: "record", payload: { title: "Senior Backend Engineer", company: "Example" } }),
  });
  const observations = await request<{ items: unknown[] }>(`/sessions/${session.id}/observations`);
  console.log(`observations: ${observations.items.length}`);
  await request(`/sessions/${session.id}/end`, { method: "POST" });
  console.log(`persisted: ${config.home}/sessions/${session.id}/`);
} finally {
  await app.close();
  await fixture.close();
}
