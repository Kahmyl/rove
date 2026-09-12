import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { canonicalRoveToolDefinitionsJsonWire } from "@rove/protocol";

import type { RoveMcpLaunch, RoveMcpProbe } from "./task-coordinator.js";

export class StdioRoveMcpProbe implements RoveMcpProbe {
  constructor(
    private readonly launch: RoveMcpLaunch,
    private readonly timeoutMs = 10_000,
  ) {}

  async inspect(input: {
    taskId: string;
    capability: string;
    capabilityVerifier: string;
    sessionId: string;
    executionMode: "agent" | "companion" | "capture";
    browserIdentity:
      { mode: "temporary" } | { mode: "workspace"; workspaceId: string };
  }) {
    const child = spawn(this.launch.command, [...this.launch.args], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        LANG: process.env.LANG,
        TMPDIR: process.env.TMPDIR,
        ...this.launch.environment,
        ROVE_MCP_TRANSPORT: "stdio",
        ROVE_TASK_ID: input.taskId,
        ROVE_TASK_SESSION_ID: input.sessionId,
        ROVE_TASK_CAPABILITY: input.capability,
        ROVE_TASK_CAPABILITY_VERIFIER: input.capabilityVerifier,
        ROVE_TASK_EXECUTION_MODE: input.executionMode,
        ROVE_TASK_BROWSER_IDENTITY: JSON.stringify(input.browserIdentity),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let id = 0;
    const pending = new Map<
      number,
      { resolve(value: unknown): void; reject(error: Error): void }
    >();
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        if (message.id === undefined) return;
        const request = pending.get(message.id);
        if (request === undefined) return;
        pending.delete(message.id);
        if (message.error !== undefined)
          request.reject(new Error(message.error.message ?? "MCP error"));
        else request.resolve(message.result);
      } catch {
        // A malformed probe result is surfaced by its bounded timeout.
      }
    });
    const request = (method: string, params: unknown): Promise<unknown> => {
      const requestId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`,
        );
      });
    };
    const timeout = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Rove MCP probe timed out.")),
        this.timeoutMs,
      );
      timer.unref();
    });
    try {
      const initialized = (await Promise.race([
        request("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "rove-host", version: "0.1.0" },
        }),
        timeout,
      ])) as { serverInfo?: { name?: string; version?: string } };
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );
      const listed = (await Promise.race([
        request("tools/list", {}),
        timeout,
      ])) as { tools?: Array<{ name?: string; [key: string]: unknown }> };
      const bound = (await Promise.race([
        request("tools/call", {
          name: "session.status",
          arguments: { sessionId: input.sessionId },
        }),
        timeout,
      ])) as {
        isError?: boolean;
        content?: Array<{ type?: string; text?: string }>;
      };
      if (bound.isError === true)
        throw new Error("Authenticated Rove MCP bound-session call failed.");
      const text = bound.content?.find((entry) => entry.type === "text")?.text;
      const boundSession =
        text === undefined
          ? undefined
          : (JSON.parse(text) as { id?: unknown }).id;
      if (boundSession !== input.sessionId)
        throw new Error("Rove MCP bound-session identity mismatch.");
      const definitions = listed.tools ?? [];
      return {
        serverName: initialized.serverInfo?.name ?? "",
        serverVersion: initialized.serverInfo?.version ?? "",
        tools: definitions.flatMap((tool) =>
          typeof tool.name === "string" ? [tool.name] : [],
        ),
        catalogDigest: createHash("sha256")
          .update(canonicalRoveToolDefinitionsJsonWire(definitions))
          .digest("hex"),
        authenticated: true,
        boundSessionId: input.sessionId,
        ready: true,
      };
    } finally {
      lines.close();
      child.kill("SIGTERM");
    }
  }
}
