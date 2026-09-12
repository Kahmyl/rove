import type { Readable, Writable } from "node:stream";

import type {
  CodexMethod,
  CodexRequestMap,
  CodexRpcPort,
  CodexServerEvent,
  CodexServerEventListener,
  CodexServerRequestMethod,
  JsonRpcError,
  JsonRpcId,
} from "./protocol.js";
import {
  parseCodexServerEvent,
  validateCodexRequestParams,
  validateCodexResponse,
  validateServerRequestResponse,
} from "./protocol.js";

export class CodexProtocolError extends Error {}
export class CodexTransportUncertainError extends Error {
  readonly outcome = "transport_uncertain" as const;
}

interface PendingRequest {
  method: CodexMethod;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export interface CodexRpcConnectionOptions {
  stdin: Writable;
  stdout: Readable;
  connectionId: string;
  defaultTimeoutMs?: number;
  onProtocolFailure?: (error: CodexProtocolError) => void;
  onEventFailure?: (error: Error) => void;
}

function isId(value: unknown): value is JsonRpcId {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  );
}

function rpcError(value: unknown): JsonRpcError {
  if (value === null || typeof value !== "object") {
    return { code: -32603, message: "Unknown App Server error." };
  }
  const error = value as Record<string, unknown>;
  return {
    code: typeof error.code === "number" ? error.code : -32603,
    message:
      typeof error.message === "string"
        ? error.message
        : "Unknown App Server error.",
    ...(error.data === undefined ? {} : { data: error.data }),
  };
}

export class CodexRpcConnection implements CodexRpcPort {
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly inboundRequests = new Map<
    JsonRpcId,
    { wireId: JsonRpcId; method: CodexServerRequestMethod }
  >();
  private readonly listeners = new Set<CodexServerEventListener>();
  private eventDelivery = Promise.resolve();
  private sequence = 0;
  private buffer = "";
  private closed = false;

  constructor(private readonly options: CodexRpcConnectionOptions) {
    options.stdout.setEncoding("utf8");
    options.stdout.on("data", (chunk: string) => this.consume(chunk));
    options.stdout.once("end", () => this.closeUncertain("stdout ended"));
    options.stdout.once("error", (error) =>
      this.closeUncertain(`stdout error: ${error.message}`),
    );
    options.stdin.once("error", (error) =>
      this.closeUncertain(`stdin error: ${error.message}`),
    );
  }

  request<M extends CodexMethod>(
    method: M,
    params: CodexRequestMap[M]["params"],
    timeoutMs = this.options.defaultTimeoutMs ?? 15_000,
  ): Promise<CodexRequestMap[M]["result"]> {
    if (this.closed || !this.options.stdin.writable) {
      return Promise.reject(
        new CodexTransportUncertainError("Cannot write to exited App Server."),
      );
    }
    const id = `${this.options.connectionId}:${++this.sequence}`;
    validateCodexRequestParams(method, params);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`Codex request ${method} timed out after ${timeoutMs}ms.`),
        );
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { method, resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    }) as Promise<CodexRequestMap[M]["result"]>;
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.assertWritable();
    this.write({ jsonrpc: "2.0", method, params });
  }

  async respond(
    id: JsonRpcId,
    result: unknown,
    error?: JsonRpcError,
  ): Promise<void> {
    const inbound = this.inboundRequests.get(id);
    if (inbound === undefined) {
      throw new CodexProtocolError(
        `Cannot answer unknown server request ${id}.`,
      );
    }
    if (error === undefined)
      validateServerRequestResponse(inbound.method, result);
    this.assertWritable();
    await this.writeConfirmed(
      error === undefined
        ? { jsonrpc: "2.0", id: inbound.wireId, result }
        : { jsonrpc: "2.0", id: inbound.wireId, error },
    );
    this.inboundRequests.delete(id);
  }

  onEvent(listener: CodexServerEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  closeUncertain(reason: string): Promise<void> {
    if (this.closed) return this.drainEvents();
    this.closed = true;
    const error = new CodexTransportUncertainError(
      `Codex transport lost; outstanding outcomes are uncertain (${reason}).`,
    );
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.inboundRequests.clear();
    return this.drainEvents();
  }

  drainEvents(): Promise<void> {
    return this.eventDelivery;
  }

  private consume(chunk: string): void {
    if (this.closed) return;
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length === 0) continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        this.failProtocol("Malformed JSONL received from App Server.");
        return;
      }
      this.handleMessage(message);
      if (this.closed) return;
    }
  }

  private handleMessage(value: unknown): void {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      this.failProtocol("App Server message must be a JSON object.");
      return;
    }
    const message = value as Record<string, unknown>;
    if (message.jsonrpc !== undefined && message.jsonrpc !== "2.0") {
      this.failProtocol("Unsupported JSON-RPC version.");
      return;
    }
    if (typeof message.method === "string") {
      if (message.id === undefined) {
        let event: CodexServerEvent | undefined;
        try {
          event = parseCodexServerEvent(message.method, message.params);
        } catch (error) {
          this.failProtocol(
            error instanceof Error ? error.message : String(error),
          );
          return;
        }
        if (event !== undefined) this.enqueueEvent(event);
        return;
      }
      if (
        !isId(message.id) ||
        [...this.inboundRequests.values()].some(
          (request) => request.wireId === message.id,
        )
      ) {
        this.failProtocol("Duplicate or invalid App Server request id.");
        return;
      }
      const logicalId = `${this.options.connectionId}:server:${typeof message.id}:${String(message.id)}`;
      let event: CodexServerEvent | undefined;
      try {
        event = parseCodexServerEvent(
          message.method,
          message.params,
          logicalId,
          message.id,
        );
      } catch (error) {
        this.failProtocol(
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
      if (event === undefined) {
        this.write({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Unsupported App Server request." },
        });
        return;
      }
      this.inboundRequests.set(logicalId, {
        wireId: message.id,
        method: event.method as CodexServerRequestMethod,
      });
      this.enqueueEvent(event);
      return;
    }
    if (!isId(message.id)) {
      this.failProtocol("Response is missing a valid id.");
      return;
    }
    const pending = this.pending.get(message.id);
    if (pending === undefined) {
      this.failProtocol(`Orphan App Server response ${message.id}.`);
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error !== undefined) {
      const error = rpcError(message.error);
      pending.reject(Object.assign(new Error(error.message), { rpc: error }));
    } else if (Object.hasOwn(message, "result")) {
      try {
        pending.resolve(validateCodexResponse(pending.method, message.result));
      } catch (error) {
        this.failProtocol(
          error instanceof Error ? error.message : String(error),
        );
        pending.reject(
          error instanceof Error
            ? error
            : new CodexProtocolError(String(error)),
        );
      }
    } else {
      pending.reject(
        new CodexProtocolError("Response has neither result nor error."),
      );
    }
  }

  private write(message: object): void {
    this.options.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error !== null && error !== undefined) {
        this.closeUncertain(`write failed: ${error.message}`);
      }
    });
  }

  private enqueueEvent(event: CodexServerEvent): void {
    const listeners = [...this.listeners];
    const delivery = this.eventDelivery.then(async () => {
      let firstFailure: Error | undefined;
      for (const listener of listeners) {
        try {
          await listener(event);
        } catch (error) {
          firstFailure ??=
            error instanceof Error ? error : new Error(String(error));
        }
      }
      if (firstFailure) throw firstFailure;
    });
    this.eventDelivery = delivery.catch((error) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      try {
        this.options.onEventFailure?.(failure);
      } catch {
        // Event-delivery failures are already terminal diagnostics here.
      }
    });
  }

  private writeConfirmed(message: object): Promise<void> {
    return new Promise((resolve, reject) => {
      this.options.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error !== null && error !== undefined) {
          this.closeUncertain(`write failed: ${error.message}`);
          reject(
            new CodexTransportUncertainError(
              `App Server response write is uncertain: ${error.message}`,
            ),
          );
        } else resolve();
      });
    });
  }

  private assertWritable(): void {
    if (this.closed || !this.options.stdin.writable) {
      throw new CodexTransportUncertainError(
        "Cannot write to exited App Server.",
      );
    }
  }

  private failProtocol(message: string): void {
    const error = new CodexProtocolError(message);
    this.closeUncertain(message);
    this.options.onProtocolFailure?.(error);
  }
}
