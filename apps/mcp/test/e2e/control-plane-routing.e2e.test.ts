import { createServer, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { HubConnector } from "../../../companion/src/main/host/hub-connector.js";
import { RelayServer } from "../../../control-plane/src/relay-server.js";
import { ControlPlaneRuntimeClient } from "../../src/runtime/control-plane-runtime-client.js";
import type { ComponentInstanceIdentity } from "@rove/protocol";

const HUB_TOKEN = "test-hub-token-123456789012345";
const SERVICE_TOKEN = "test-service-token-123456789012";
const RUNTIME_TOKEN = "test-runtime-token";
const DEVICE_ID = "device_test";

const cleanup: Array<() => Promise<void>> = [];

function identity(
  component: ComponentInstanceIdentity["component"],
  instanceId: string,
  startedAt: string,
  developmentGitCommit = "a".repeat(40),
): ComponentInstanceIdentity {
  return {
    component,
    instanceId,
    version: "0.1.0",
    startedAt,
    processId: 123,
    buildIdentity: "rove@0.1.0",
    developmentGitCommit,
    protocols: { runtimeApi: 1, hub: 1 },
  };
}

function provenanceHeaders(
  runtimeInstanceId: string,
  runtimeStartedAt: string,
  developmentGitCommit = "a".repeat(40),
) {
  const runtime = identity(
    "runtime",
    runtimeInstanceId,
    runtimeStartedAt,
    developmentGitCommit,
  );
  const companion = identity(
    "companion",
    "companion_test",
    runtimeStartedAt,
    developmentGitCommit,
  );
  return {
    "x-rove-runtime-instance-id": runtimeInstanceId,
    "x-rove-runtime-started-at": runtimeStartedAt,
    "x-rove-runtime-provenance": Buffer.from(
      JSON.stringify(runtime),
      "utf8",
    ).toString("base64url"),
    "x-rove-companion-provenance": Buffer.from(
      JSON.stringify(companion),
      "utf8",
    ).toString("base64url"),
  };
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).reverse().map((stop) => stop()));
});

describe("control-plane Runtime routing", () => {
  it("routes MCP RuntimeClient calls through the outbound Hub connection", async () => {
    const runtimePort = await availablePort();
    const controlPlanePort = await availablePort();
    const seen: Array<{ method: string; url: string; authorization?: string; body?: unknown }> = [];

    const runtime = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString("utf8");
      seen.push({
        method: request.method ?? "GET",
        url: request.url ?? "/",
        ...(typeof request.headers.authorization === "string"
          ? { authorization: request.headers.authorization }
          : {}),
        ...(text.length === 0 ? {} : { body: JSON.parse(text) }),
      });

      if (request.url === "/health") {
        writeJson(response, {
          ok: true,
          protocolVersion: 1,
          runtime: identity(
            "runtime",
            "runtime_11111111111111111111111111111111",
            "2026-09-06T12:00:00.000Z",
          ),
        });
        return;
      }
      if (request.method === "POST" && request.url === "/sessions") {
        writeJson(response, {
          id: "ses_relay",
          mode: "agent",
          status: "active",
          controller: "agent",
          profile: { mode: "temporary" },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
        return;
      }
      response.writeHead(404).end();
    });
    await listen(runtime, runtimePort);
    cleanup.push(() => close(runtime));

    const relay = new RelayServer({
      host: "127.0.0.1",
      port: controlPlanePort,
      hubToken: HUB_TOKEN,
      serviceToken: SERVICE_TOKEN,
    });
    await relay.start();
    cleanup.push(() => relay.stop());

    const connector = new HubConnector({
      controlPlaneUrl: `http://127.0.0.1:${controlPlanePort}`,
      deviceId: DEVICE_ID,
      token: HUB_TOKEN,
      runtime: {
        baseUrl: `http://127.0.0.1:${runtimePort}`,
        token: RUNTIME_TOKEN,
      },
      runtimeInstanceId: "runtime_11111111111111111111111111111111",
      runtimeStartedAt: "2026-09-06T12:00:00.000Z",
      companionIdentity: identity(
        "companion",
        "companion_test",
        "2026-09-06T12:00:00.000Z",
      ),
      retryDelayMs: 1,
    });
    connector.start();
    cleanup.push(() => connector.stop());

    const client = new ControlPlaneRuntimeClient({
      controlPlaneUrl: `http://127.0.0.1:${controlPlanePort}`,
      deviceId: DEVICE_ID,
      serviceToken: SERVICE_TOKEN,
    });

    await waitForConnectedRoute(
      `http://127.0.0.1:${String(controlPlanePort)}`,
    );

    await client.healthCheck();
    const session = await client.startSession({ mode: "agent" });

    expect(session.id).toBe("ses_relay");
    expect(seen).toEqual([
      {
        method: "GET",
        url: "/health",
        authorization: `Bearer ${RUNTIME_TOKEN}`,
      },
      {
        method: "GET",
        url: "/health",
        authorization: `Bearer ${RUNTIME_TOKEN}`,
      },
      {
        method: "POST",
        url: "/sessions",
        authorization: `Bearer ${RUNTIME_TOKEN}`,
        body: { mode: "agent" },
      },
    ]);
  });

  it("fences an older Runtime poller after newer authority arrives", async () => {
    const controlPlanePort = await availablePort();
    const relay = new RelayServer({
      host: "127.0.0.1",
      port: controlPlanePort,
      hubToken: HUB_TOKEN,
      serviceToken: SERVICE_TOKEN,
    });
    await relay.start();
    cleanup.push(() => relay.stop());
    const baseUrl = `http://127.0.0.1:${controlPlanePort}`;
    const poll = (runtimeInstanceId: string, runtimeStartedAt: string) =>
      fetch(`${baseUrl}/v1/devices/${DEVICE_ID}/poll`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${HUB_TOKEN}`,
          ...provenanceHeaders(runtimeInstanceId, runtimeStartedAt),
        },
      });

    const older = poll(
      "runtime_11111111111111111111111111111111",
      "2026-09-06T12:00:00.000Z",
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const newer = poll(
      "runtime_22222222222222222222222222222222",
      "2026-09-06T13:00:00.000Z",
    );

    await expect(older.then((response) => response.status)).resolves.toBe(409);
    await expect(
      poll(
        "runtime_11111111111111111111111111111111",
        "2026-09-06T12:00:00.000Z",
      ).then((response) => response.status),
    ).resolves.toBe(409);

    const status = await fetch(`${baseUrl}/v1/devices/${DEVICE_ID}`, {
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });
    await expect(status.json()).resolves.toMatchObject({
      runtimeInstanceId: "runtime_22222222222222222222222222222222",
      runtimeStartedAt: "2026-09-06T13:00:00.000Z",
    });

    await relay.stop();
    await newer;
  });

  it("fails immediately when no live Runtime authority owns the route", async () => {
    const controlPlanePort = await availablePort();
    const relay = new RelayServer({
      host: "127.0.0.1",
      port: controlPlanePort,
      hubToken: HUB_TOKEN,
      serviceToken: SERVICE_TOKEN,
    });
    await relay.start();
    cleanup.push(() => relay.stop());
    const client = new ControlPlaneRuntimeClient({
      controlPlaneUrl: `http://127.0.0.1:${controlPlanePort}`,
      deviceId: DEVICE_ID,
      serviceToken: SERVICE_TOKEN,
    });

    await expect(client.startSession({ mode: "agent" })).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
  });

  it("rejects a newer incompatible Runtime instead of selecting by startedAt", async () => {
    const controlPlanePort = await availablePort();
    const relay = new RelayServer({
      host: "127.0.0.1",
      port: controlPlanePort,
      hubToken: HUB_TOKEN,
      serviceToken: SERVICE_TOKEN,
    });
    await relay.start();
    cleanup.push(() => relay.stop());
    const baseUrl = `http://127.0.0.1:${String(controlPlanePort)}`;
    const first = fetch(`${baseUrl}/v1/devices/${DEVICE_ID}/poll`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${HUB_TOKEN}`,
        ...provenanceHeaders(
          "runtime_11111111111111111111111111111111",
          "2026-09-06T12:00:00.000Z",
        ),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const incompatible = await fetch(
      `${baseUrl}/v1/devices/${DEVICE_ID}/poll`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${HUB_TOKEN}`,
          ...provenanceHeaders(
            "runtime_22222222222222222222222222222222",
            "2026-09-06T13:00:00.000Z",
            "b".repeat(40),
          ),
        },
      },
    );
    expect(incompatible.status).toBe(409);
    await relay.stop();
    await first;
  });
});

async function availablePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No test port.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitForConnectedRoute(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${baseUrl}/v1/devices/${DEVICE_ID}`, {
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });
    const status = (await response.json()) as { connected?: boolean };
    if (status.connected === true) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Runtime route did not become ready.");
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function writeJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
