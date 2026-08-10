import { createServer, type Server as HttpServer } from "node:http";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { ControlStatus, ControlWaitResult } from "@rove/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { BearerTokenVerifier } from "./auth/bearer-auth.js";
import type { McpLogger } from "./logging/logger.js";
import type { RuntimeClient } from "./runtime/runtime-client.types.js";
import { createMcpServer } from "./server/create-mcp-server.js";
import { startStreamableHttpServer } from "./transports/streamable-http.js";

const TOKEN = "m7-control-transport-test-token";
const silentLogger: McpLogger = { debug() {}, info() {}, warn() {}, error() {} };
const openClients: Client[] = [];
const openMcpServers: Server[] = [];
const openServers: HttpServer[] = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close().catch(() => undefined)));
  await Promise.all(openMcpServers.splice(0).map((server) => server.close().catch(() => undefined)));
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("M7 MCP control tools", () => {
  it("runs status, request_human, and wait through real stdio MCP", async () => {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const server = createMcpServer(createFakeRuntimeClient());
    openMcpServers.push(server);
    await server.connect(new StdioServerTransport(clientToServer, serverToClient));
    const transport = new StreamClientTransport(clientToServer, serverToClient);
    const client = new Client({ name: "m7-stdio-test", version: "1.0.0" });
    openClients.push(client);
    await client.connect(transport);
    await assertControlWorkflow(client);
  });

  it("runs the same workflow through real Streamable HTTP MCP", async () => {
    const port = await availablePort();
    const runtime = createFakeRuntimeClient();
    const server = await startStreamableHttpServer({
      host: "127.0.0.1",
      port,
      path: "/mcp",
      allowedHosts: [`127.0.0.1:${String(port)}`],
      auth: new BearerTokenVerifier(TOKEN),
      runtime,
      createServer: () => createMcpServer(runtime),
      logger: silentLogger,
    });
    openServers.push(server);

    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${String(port)}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: "m7-http-test", version: "1.0.0" });
    openClients.push(client);
    await client.connect(transport);
    await assertControlWorkflow(client);
  });

  it("cancels a Streamable HTTP control.wait on client disconnect without changing ownership", async () => {
    const port = await availablePort();
    let waiters = 0;
    const controller: ControlStatus["controller"] = "agent";
    const runtime = {
      ...createFakeRuntimeClient(),
      waitForControl: async (_sessionId: string, _input: unknown, signal?: AbortSignal): Promise<ControlWaitResult> => {
        waiters += 1;
        try {
          await new Promise<void>((_resolve, reject) => {
            if (signal?.aborted === true) return reject(new Error("cancelled"));
            signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
          });
          throw new Error("unreachable");
        } finally {
          waiters -= 1;
        }
      },
      getControlStatus: async () => controlStatus("active", controller),
    } as RuntimeClient;
    const server = await startStreamableHttpServer({
      host: "127.0.0.1",
      port,
      path: "/mcp",
      allowedHosts: [`127.0.0.1:${String(port)}`],
      auth: new BearerTokenVerifier(TOKEN),
      runtime,
      createServer: () => createMcpServer(runtime),
      logger: silentLogger,
    });
    openServers.push(server);
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${String(port)}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: "m7-http-disconnect-test", version: "1.0.0" });
    openClients.push(client);
    await client.connect(transport);

    const abort = new AbortController();
    const pending = client.callTool(
      { name: "control.wait", arguments: { sessionId: "ses_m7", afterSeq: 12, timeoutMs: 10_000 } },
      undefined,
      { signal: abort.signal },
    );
    while (waiters === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    abort.abort();
    await expect(pending).rejects.toThrow();
    while (waiters !== 0) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(controller).toBe("agent");
  });
});

async function assertControlWorkflow(client: Client): Promise<void> {
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  expect(names).toEqual(expect.arrayContaining(["control.status", "control.request_human", "control.wait"]));
  expect(names).not.toEqual(expect.arrayContaining([
    "control.take_human",
    "control.return_agent",
    "control.transfer",
    "control.set",
  ]));

  await expect(callJson(client, "control.status", { sessionId: "ses_m7" })).resolves.toMatchObject({
    status: "active",
    controller: "agent",
  });
  const requested = await callJson(client, "control.request_human", { sessionId: "ses_m7", reason: "Authenticate" });
  expect(requested).toMatchObject({ status: "awaiting_human", controller: null, handoff: { reason: "Authenticate" } });
  await expect(callJson(client, "control.wait", { sessionId: "ses_m7", afterSeq: 11, timeoutMs: 1_000 })).resolves.toMatchObject({
    event: "human_took_control",
    controller: "human",
    observationSeq: 12,
  });
}

async function callJson(client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content[0];
  if (content?.type !== "text") throw new Error(`Expected text result from ${name}.`);
  return JSON.parse(content.text) as Record<string, unknown>;
}

function createFakeRuntimeClient(): RuntimeClient {
  const active = controlStatus("active", "agent");
  return {
    healthCheck: async () => undefined,
    getControlStatus: async () => active,
    requestHuman: async (_sessionId, reason) => ({
      ...controlStatus("awaiting_human", null),
      handoff: { reason, requestedAt: "2026-01-01T00:00:01.000Z" },
      observationSeq: 11,
    }),
    waitForControl: async (): Promise<ControlWaitResult> => ({
      event: "human_took_control",
      sessionId: "ses_m7",
      status: "active",
      controller: "human",
      observationSeq: 12,
    }),
  } as RuntimeClient;
}

function controlStatus(status: ControlStatus["status"], controller: ControlStatus["controller"]): ControlStatus {
  return {
    sessionId: "ses_m7",
    status,
    controller,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Port probe did not bind TCP.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

class StreamClientTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private readonly buffer = new ReadBuffer();
  private readonly onData = (chunk: Buffer) => {
    try {
      this.buffer.append(chunk);
      for (let message = this.buffer.readMessage(); message !== null; message = this.buffer.readMessage()) {
        this.onmessage?.(message);
      }
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error("Invalid stdio MCP frame."));
    }
  };

  constructor(
    private readonly output: PassThrough,
    private readonly input: PassThrough,
  ) {}

  async start(): Promise<void> {
    this.input.on("data", this.onData);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.output.write(serializeMessage(message));
  }

  async close(): Promise<void> {
    this.input.off("data", this.onData);
    this.buffer.clear();
    this.onclose?.();
  }
}
