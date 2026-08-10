import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { BearerTokenVerifier } from "../auth/bearer-auth.js";
import { unauthorizedBody } from "../auth/bearer-auth.js";
import type { McpLogger } from "../logging/logger.js";
import type { RuntimeClient } from "../runtime/runtime-client.types.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface StreamableHttpOptions {
  host: string;
  port: number;
  path: string;
  allowedHosts?: string[];
  auth: BearerTokenVerifier;
  runtime: RuntimeClient;
  createServer: () => Server;
  logger: McpLogger;
}

interface TransportSession {
  server: Server;
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

export async function startStreamableHttpServer(options: StreamableHttpOptions): Promise<HttpServer> {
  const sessions = new Map<string, TransportSession>();
  const allowedHosts = new Set(options.allowedHosts ?? [hostHeader(options.host, options.port)]);

  const httpServer = createServer((request, response) => {
    void handleRequest(request, response, options, sessions, allowedHosts);
  });

  const cleanup = setInterval(() => cleanupExpiredSessions(sessions, options.logger), 60_000);
  cleanup.unref();

  process.once("SIGINT", () => void shutdown(httpServer, sessions, cleanup));
  process.once("SIGTERM", () => void shutdown(httpServer, sessions, cleanup));

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.off("error", reject);
      options.logger.info("Rove MCP HTTP listening.", { host: options.host, port: options.port, path: options.path });
      resolve();
    });
  }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      process.stderr.write(`Rove MCP HTTP failed to bind ${options.host}:${options.port}: address already in use\n`);
      process.exitCode = 1;
    }
    throw error;
  });

  return httpServer;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: StreamableHttpOptions,
  sessions: Map<string, TransportSession>,
  allowedHosts: Set<string>,
): Promise<void> {
  if (!isAllowedHost(request, allowedHosts)) {
    writeJson(response, 403, { error: { code: "FORBIDDEN", message: "Forbidden." } });
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    await handleHealth(response, options.runtime);
    return;
  }
  if (url.pathname !== options.path) {
    writeJson(response, 404, { error: { code: "NOT_FOUND", message: "Not found." } });
    return;
  }

  try {
    options.auth.authenticate(request.headers.authorization);
  } catch {
    writeJson(response, 401, unauthorizedBody());
    return;
  }

  const body = request.method === "POST" ? await readJsonBody(request) : undefined;
  if (body === TOO_LARGE) {
    writeJson(response, 413, { error: { code: "REQUEST_TOO_LARGE", message: "Request body exceeds 2 MiB." } });
    return;
  }

  const sessionId = typeof request.headers["mcp-session-id"] === "string" ? request.headers["mcp-session-id"] : undefined;
  let session = sessionId === undefined ? undefined : sessions.get(sessionId);
  if (session === undefined) {
    const server = options.createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (createdSessionId: string) => {
        sessions.set(createdSessionId, { server, transport, lastSeen: Date.now() });
      },
    });
    transport.onclose = () => {
      for (const [id, entry] of sessions) {
        if (entry.transport === transport) sessions.delete(id);
      }
    };
    await server.connect(transport as Parameters<Server["connect"]>[0]);
    session = { server, transport, lastSeen: Date.now() };
  }
  session.lastSeen = Date.now();
  await session.transport.handleRequest(request, response, body);
}

async function handleHealth(response: ServerResponse, runtime: RuntimeClient): Promise<void> {
  try {
    await runtime.healthCheck(2_000);
    writeJson(response, 200, { status: "ok", service: "rove-mcp", transport: "http" });
  } catch {
    writeJson(response, 503, { status: "unavailable", service: "rove-mcp", transport: "http", dependency: "runtime" });
  }
}

const TOO_LARGE = Symbol("too-large");

async function readJsonBody(request: IncomingMessage): Promise<unknown | typeof TOO_LARGE> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) return TOO_LARGE;
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function isAllowedHost(request: IncomingMessage, allowedHosts: Set<string>): boolean {
  const host = request.headers.host;
  return typeof host === "string" && allowedHosts.has(host);
}

function hostHeader(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}

function cleanupExpiredSessions(sessions: Map<string, TransportSession>, logger: McpLogger): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.lastSeen < cutoff) {
      sessions.delete(id);
      void closeServer(session.server);
      logger.debug("Expired MCP HTTP transport session.", { sessionId: id });
    }
  }
}

async function shutdown(httpServer: HttpServer, sessions: Map<string, TransportSession>, cleanup: NodeJS.Timeout): Promise<void> {
  clearInterval(cleanup);
  for (const session of sessions.values()) await closeServer(session.server);
  sessions.clear();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  process.exitCode = 0;
}

async function closeServer(server: Server): Promise<void> {
  const closable = server as Server & { close?: () => Promise<void> };
  if (closable.close !== undefined) await closable.close();
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
