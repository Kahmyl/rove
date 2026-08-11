import { createServer, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { HubConnector } from "../../../companion/src/main/host/hub-connector.js";
import { RelayServer } from "../../../control-plane/src/relay-server.js";
import { ControlPlaneRuntimeClient } from "../../src/runtime/control-plane-runtime-client.js";

const HUB_TOKEN = "test-hub-token-123456789012345";
const SERVICE_TOKEN = "test-service-token-123456789012";
const RUNTIME_TOKEN = "test-runtime-token";
const DEVICE_ID = "device_test";

const cleanup: Array<() => Promise<void>> = [];

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
        writeJson(response, { ok: true, protocolVersion: 1 });
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
      retryDelayMs: 1,
    });
    connector.start();
    cleanup.push(() => connector.stop());

    const client = new ControlPlaneRuntimeClient({
      controlPlaneUrl: `http://127.0.0.1:${controlPlanePort}`,
      deviceId: DEVICE_ID,
      serviceToken: SERVICE_TOKEN,
    });

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
        method: "POST",
        url: "/sessions",
        authorization: `Bearer ${RUNTIME_TOKEN}`,
        body: { mode: "agent" },
      },
    ]);
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
