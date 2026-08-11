import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  ROVE_HUB_PROTOCOL_VERSION,
  hubCommandResultSchema,
  submitHubCommandSchema,
  type HubCommand,
  type HubCommandResult,
} from "@rove/protocol";

const BODY_LIMIT = 2 * 1024 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 35_000;
const POLL_TIMEOUT_MS = 25_000;

export interface RelayServerOptions {
  host: string;
  port: number;
  hubToken: string;
  serviceToken: string;
}

interface PendingCommand {
  deviceId: string;
  resolve(result: HubCommandResult): void;
  timer: NodeJS.Timeout;
}

interface PollWaiter {
  response: ServerResponse;
  timer: NodeJS.Timeout;
}

export class RelayServer {
  private readonly queues = new Map<string, HubCommand[]>();
  private readonly pollers = new Map<string, PollWaiter>();
  private readonly pending = new Map<string, PendingCommand>();
  private readonly lastSeen = new Map<string, number>();
  private server: Server | undefined;

  constructor(private readonly options: RelayServerOptions) {}

  async start(): Promise<void> {
    if (this.server !== undefined) throw new Error("Control plane is already running.");
    const server = createServer((request, response) => {
      void this.route(request, response).catch((error: unknown) => {
        if (!response.headersSent) {
          const status =
            typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            typeof error.statusCode === "number"
              ? error.statusCode
              : 500;
          writeJson(response, status, {
            error: {
              code: status === 401 ? "UNAUTHORIZED" : "CONTROL_PLANE_FAILURE",
              message: error instanceof Error ? error.message : "Control-plane request failed.",
            },
          });
        } else if (!response.writableEnded) {
          response.end();
        }
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port, this.options.host, resolve);
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server === undefined) return;
    this.server = undefined;
    for (const waiter of this.pollers.values()) {
      clearTimeout(waiter.timer);
      if (!waiter.response.writableEnded) waiter.response.end();
    }
    this.pollers.clear();
    for (const command of this.pending.values()) clearTimeout(command.timer);
    this.pending.clear();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, { ok: true, service: "rove-control-plane", protocolVersion: ROVE_HUB_PROTOCOL_VERSION });
      return;
    }

    const pollMatch = /^\/v1\/devices\/([^/]+)\/poll$/.exec(url.pathname);
    if (method === "POST" && pollMatch !== null) {
      requireBearer(request, this.options.hubToken);
      await this.poll(decodeURIComponent(pollMatch[1]!), request, response);
      return;
    }

    const submitMatch = /^\/v1\/devices\/([^/]+)\/commands$/.exec(url.pathname);
    if (method === "POST" && submitMatch !== null) {
      requireBearer(request, this.options.serviceToken);
      const input = submitHubCommandSchema.parse(await readJson(request));
      const result = await this.submit(decodeURIComponent(submitMatch[1]!), input);
      writeJson(response, 200, result);
      return;
    }

    const statusMatch = /^\/v1\/devices\/([^/]+)$/.exec(url.pathname);
    if (method === "GET" && statusMatch !== null) {
      requireBearer(request, this.options.serviceToken);
      const deviceId = decodeURIComponent(statusMatch[1]!);
      const seenAt = this.lastSeen.get(deviceId);
      writeJson(response, 200, {
        deviceId,
        connected: seenAt !== undefined && Date.now() - seenAt < POLL_TIMEOUT_MS + 10_000,
        lastSeenAt: seenAt === undefined ? null : new Date(seenAt).toISOString(),
        queuedCommands: this.queues.get(deviceId)?.length ?? 0,
      });
      return;
    }

    const resultMatch = /^\/v1\/commands\/([^/]+)\/result$/.exec(url.pathname);
    if (method === "POST" && resultMatch !== null) {
      requireBearer(request, this.options.hubToken);
      const result = hubCommandResultSchema.parse(await readJson(request));
      if (result.commandId !== decodeURIComponent(resultMatch[1]!)) {
        writeJson(response, 400, { error: { code: "COMMAND_ID_MISMATCH", message: "Command ID does not match the result route." } });
        return;
      }
      const pending = this.pending.get(result.commandId);
      if (pending === undefined) {
        writeJson(response, 202, { accepted: false, reason: "command_not_pending" });
        return;
      }
      if (pending.deviceId !== result.deviceId) {
        writeJson(response, 403, { error: { code: "DEVICE_MISMATCH", message: "Result device does not own this command." } });
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(result.commandId);
      pending.resolve(result);
      writeJson(response, 202, { accepted: true });
      return;
    }

    writeJson(response, 404, { error: { code: "NOT_FOUND", message: "Route not found." } });
  }

  private async poll(deviceId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.lastSeen.set(deviceId, Date.now());
    const queued = this.queues.get(deviceId)?.shift();
    if (queued !== undefined) {
      writeJson(response, 200, queued);
      return;
    }

    const existing = this.pollers.get(deviceId);
    if (existing !== undefined) {
      clearTimeout(existing.timer);
      if (!existing.response.writableEnded) existing.response.writeHead(409).end();
    }

    await new Promise<void>((resolve) => {
      const finish = () => {
        const current = this.pollers.get(deviceId);
        if (current?.response === response) this.pollers.delete(deviceId);
        resolve();
      };
      const timer = setTimeout(() => {
        if (!response.writableEnded) response.writeHead(204).end();
        finish();
      }, POLL_TIMEOUT_MS);
      timer.unref();
      this.pollers.set(deviceId, { response, timer });
      request.once("aborted", () => {
        clearTimeout(timer);
        finish();
      });
      response.once("close", () => {
        clearTimeout(timer);
        finish();
      });
      response.once("finish", () => {
        clearTimeout(timer);
        finish();
      });
    });
  }

  private submit(deviceId: string, input: { operation: HubCommand["operation"]; payload: unknown; timeoutMs?: number | undefined }): Promise<HubCommandResult> {
    const commandId = `cmd_${randomUUID()}`;
    const command: HubCommand = {
      protocolVersion: ROVE_HUB_PROTOCOL_VERSION,
      commandId,
      deviceId,
      operation: input.operation,
      payload: input.payload,
    };

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        const queue = this.queues.get(deviceId);
        if (queue !== undefined) {
          const remaining = queue.filter((candidate) => candidate.commandId !== commandId);
          if (remaining.length === 0) this.queues.delete(deviceId);
          else this.queues.set(deviceId, remaining);
        }
        resolve({
          protocolVersion: ROVE_HUB_PROTOCOL_VERSION,
          commandId,
          deviceId,
          ok: false,
          error: { code: "HUB_COMMAND_TIMEOUT", message: "The Hub did not complete the command before its deadline.", retryable: true },
        });
      }, input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
      timer.unref();
      this.pending.set(commandId, { deviceId, resolve, timer });
      const poller = this.pollers.get(deviceId);
      if (poller !== undefined) {
        this.pollers.delete(deviceId);
        clearTimeout(poller.timer);
        writeJson(poller.response, 200, command);
      } else {
        const queue = this.queues.get(deviceId) ?? [];
        queue.push(command);
        this.queues.set(deviceId, queue);
      }
    });
  }
}

function requireBearer(request: IncomingMessage, expected: string): void {
  const actual = request.headers.authorization ?? "";
  const wanted = `Bearer ${expected}`;
  const valid = actual.length === wanted.length && timingSafeEqual(Buffer.from(actual), Buffer.from(wanted));
  if (!valid) {
    const error = new Error("Unauthorized.");
    Object.assign(error, { statusCode: 401 });
    throw error;
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT) throw new Error("Request body exceeds the control-plane limit.");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length === 0 ? {} : JSON.parse(text);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded) return;
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  response.end(payload);
}
