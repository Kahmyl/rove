import { createServer, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { ComponentInstanceIdentity } from "@rove/protocol";
import { RuntimeHttpClient } from "./runtime-client.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

function runtimeIdentity(
  developmentGitCommit?: string,
): ComponentInstanceIdentity {
  return {
    component: "runtime",
    instanceId: "runtime_11111111111111111111111111111111",
    version: "0.1.0",
    startedAt: "2026-09-06T12:00:00.000Z",
    processId: 123,
    buildIdentity: "rove@0.1.0",
    protocols: { runtimeApi: 1, hub: 1 },
    ...(developmentGitCommit === undefined
      ? {}
      : { developmentGitCommit }),
  };
}

describe("direct Runtime provenance validation", () => {
  it("accepts a production-compatible Runtime without requiring Git identity", async () => {
    const baseUrl = await runtimeServer(runtimeIdentity());
    const client = new RuntimeHttpClient(baseUrl, undefined, {
      runtimeApi: 1,
      buildIdentity: "rove@0.1.0",
    });

    await expect(client.healthCheck()).resolves.toMatchObject({ ok: true });
  });

  it("rejects session mutation before dispatch when the expected development commit differs", async () => {
    let sessionPosts = 0;
    const baseUrl = await runtimeServer(runtimeIdentity("a".repeat(40)), () => {
      sessionPosts += 1;
    });
    const client = new RuntimeHttpClient(baseUrl, undefined, {
      runtimeApi: 1,
      buildIdentity: "rove@0.1.0",
      developmentGitCommit: "b".repeat(40),
    });

    await expect(client.startSession({ mode: "agent" })).rejects.toMatchObject({
      code: "RUNTIME_PROVENANCE_MISMATCH",
    });
    expect(sessionPosts).toBe(0);
  });
});

async function runtimeServer(
  identity: ComponentInstanceIdentity,
  onSession = () => undefined,
): Promise<string> {
  const port = await availablePort();
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      writeJson(response, { ok: true, protocolVersion: 1, runtime: identity });
      return;
    }
    if (request.method === "POST" && request.url === "/sessions") {
      onSession();
      writeJson(response, {});
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  servers.push(server);
  return `http://127.0.0.1:${String(port)}`;
}

async function availablePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("No test port.");
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

function writeJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
