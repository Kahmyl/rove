import { createInterface } from "node:readline/promises";
import type { AddressInfo } from "node:net";
import { NestFactory } from "@nestjs/core";
import { startFixtureServer } from "@rove/browser";
import { loadConfig } from "@rove/config";
import type {
  BrowserWorkspace,
  ControlMutationAuthority,
  ControlStatus,
  ControlWaitResult,
  PageInspection,
  Session,
} from "@rove/protocol";
import { AppModule } from "../app.module.js";

const config = loadConfig();
const fixture = await startFixtureServer();
const app = await NestFactory.create(AppModule, { logger: ["error"] });
await app.listen(0, config.runtime.host);
const address = app.getHttpServer().address() as AddressInfo;
const baseUrl = `http://${config.runtime.host}:${address.port}`;
const headers = {
  "content-type": "application/json",
  ...(config.runtime.token === undefined
    ? {}
    : { authorization: `Bearer ${config.runtime.token}` }),
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  const body = (await response.json()) as T & {
    error?: { code?: string; message?: string };
  };
  if (!response.ok)
    throw Object.assign(
      new Error(body.error?.message ?? "Runtime request failed."),
      { code: body.error?.code },
    );
  return body;
}

async function pauseForHuman(): Promise<void> {
  if (process.env.ROVE_CONTROL_DEMO_WAIT !== "1") return;
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await readline.question(
    "Use the visible browser to update the fixture, then press Enter...",
  );
  readline.close();
}

function verify(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Control qualification failed: ${message}`);
}

function controlAuthority(status: ControlStatus): ControlMutationAuthority {
  if (
    (status.activeHandoffId === undefined) !==
    (status.activeHandoffGeneration === undefined)
  )
    throw new Error("Runtime returned an incomplete control handoff identity.");
  return {
    ownershipGeneration: status.generation,
    ...(status.activeHandoffId === undefined
      ? {}
      : {
          handoffId: status.activeHandoffId,
          handoffGeneration: status.activeHandoffGeneration,
        }),
  };
}

try {
  const workspace = await request<BrowserWorkspace>("/browser-workspaces", {
    method: "POST",
    body: JSON.stringify({ displayName: "Control qualification" }),
  });
  await request(`/browser-workspaces/${workspace.id}/select`, {
    method: "POST",
  });
  const agent = await request<Session>("/sessions", {
    method: "POST",
    body: JSON.stringify({ mode: "agent", startUrl: `${fixture.url}/handoff` }),
  });
  const inspection = await request<PageInspection>(
    `/sessions/${agent.id}/browser/inspect`,
    { method: "POST", body: "{}" },
  );
  const update = inspection.targets?.find((item) => item.name === "Update");
  if (!update) throw new Error("Handoff target was not found.");
  const oldTarget = {
    pageId: inspection.pageId,
    revision: inspection.revision,
    ref: update.ref,
  };
  const requested = await request<ControlStatus>(
    `/sessions/${agent.id}/control/request-human`,
    {
      method: "POST",
      body: JSON.stringify({ reason: "Please manually update the fixture." }),
    },
  );
  verify(
    requested.status === "awaiting_human" && requested.controller === null,
    "requested handoff did not enter awaiting_human",
  );
  verify(
    requested.activeHandoffId !== undefined &&
      requested.activeHandoffGeneration !== undefined,
    "requested handoff lacks exact identity",
  );
  try {
    await request(`/sessions/${agent.id}/browser/click`, {
      method: "POST",
      body: JSON.stringify({ target: oldTarget }),
    });
    throw new Error(
      "Agent mutation remained available during requested handoff.",
    );
  } catch (error) {
    verify(
      error instanceof Error &&
        "code" in error &&
      error.code === "CONTROL_NOT_OWNED",
      "requested handoff did not fence agent mutation",
    );
  }
  await request(`/sessions/${agent.id}/control/acknowledge-durable-handoff`, {
    method: "POST",
    body: JSON.stringify({
      handoffId: requested.activeHandoffId,
      handoffGeneration: requested.activeHandoffGeneration,
    }),
  });
  const tookWait = request<ControlWaitResult>(
    `/sessions/${agent.id}/control/wait?afterSeq=${String(requested.observationSeq)}&timeoutMs=5000`,
  );
  const taken = await request<ControlStatus>(
    `/sessions/${agent.id}/control/take`,
    { method: "POST", body: JSON.stringify(controlAuthority(requested)) },
  );
  verify(
    (await tookWait).event === "human_took_control" &&
      taken.controller === "human",
    "takeover did not preserve the exact requested handoff",
  );
  await pauseForHuman();
  const returnWait = request<ControlWaitResult>(
    `/sessions/${agent.id}/control/wait?afterSeq=${String(taken.observationSeq)}&timeoutMs=5000`,
  );
  const returned = await request<ControlStatus>(
    `/sessions/${agent.id}/control/return`,
    { method: "POST", body: JSON.stringify(controlAuthority(taken)) },
  );
  verify(
    (await returnWait).event === "human_returned_control" &&
      returned.controller === "agent",
    "return did not restore exact Agent ownership",
  );
  try {
    await request(`/sessions/${agent.id}/browser/click`, {
      method: "POST",
      body: JSON.stringify({ target: oldTarget }),
    });
    throw new Error("Pre-handoff target remained valid after return.");
  } catch (error) {
    verify(
      error instanceof Error &&
        "code" in error &&
      error.code === "INSPECTION_REQUIRED",
      "return did not require fresh grounding",
    );
  }
  const freshInspection = await request<PageInspection>(
    `/sessions/${agent.id}/browser/inspect`,
    { method: "POST", body: "{}" },
  );
  verify(
    freshInspection.pageId === inspection.pageId,
    "fresh inspection did not preserve the exact page",
  );
  try {
    await request(`/sessions/${agent.id}/browser/click`, {
      method: "POST",
      body: JSON.stringify({ target: oldTarget }),
    });
    throw new Error("Pre-handoff target became valid after fresh inspection.");
  } catch (error) {
    verify(
      error instanceof Error &&
        "code" in error &&
        error.code === "TARGET_STALE",
      "fresh grounding did not invalidate the pre-handoff target",
    );
  }
  await request(`/sessions/${agent.id}/end`, { method: "POST" });

  const companion = await request<Session>("/sessions", {
    method: "POST",
    body: JSON.stringify({
      mode: "companion",
      startUrl: `${fixture.url}/handoff`,
    }),
  });
  const companionControl = await request<ControlStatus>(
    `/sessions/${companion.id}/control`,
  );
  verify(
    companionControl.activeHandoffId === undefined,
    "voluntary Companion takeover fabricated a handoff",
  );
  const voluntary = await request<ControlStatus>(
    `/sessions/${companion.id}/control/take`,
    {
      method: "POST",
      body: JSON.stringify(controlAuthority(companionControl)),
    },
  );
  verify(
    voluntary.controller === "human" && voluntary.activeHandoffId === undefined,
    "voluntary Companion takeover changed handoff identity",
  );
  try {
    await request(`/sessions/${companion.id}/browser/navigate`, {
      method: "POST",
      body: JSON.stringify({ url: fixture.url }),
    });
    throw new Error(
      "Agent navigation remained available during voluntary takeover.",
    );
  } catch (error) {
    verify(
      error instanceof Error &&
        "code" in error &&
      error.code === "CONTROL_NOT_OWNED",
      "voluntary takeover did not fence agent navigation",
    );
  }
  const companionReturned = await request<ControlStatus>(
    `/sessions/${companion.id}/control/return`,
    { method: "POST", body: JSON.stringify(controlAuthority(voluntary)) },
  );
  verify(
    companionReturned.controller === "agent",
    "voluntary takeover did not return to Rove",
  );
  await request(`/sessions/${companion.id}/end`, { method: "POST" });
  console.log(
    JSON.stringify({
      requestedHandoff: "qualified",
      voluntaryTakeover: "qualified",
      returnFreshness: "qualified",
      pageIdentity: inspection.pageId,
    }),
  );
} finally {
  await app.close();
  await fixture.close();
}
