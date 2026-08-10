import { randomBytes } from "node:crypto";

import { McpProcess } from "./mcp-process.js";
import { waitForMcpReady } from "./mcp-readiness.js";
import { allocateLoopbackPort } from "./port-allocation.js";
import { RuntimeProcess } from "./runtime-process.js";
import { waitForRuntimeReady } from "./runtime-readiness.js";

export type DesktopHostState =
  "starting" | "ready" | "degraded" | "stopping" | "failed";

export interface DesktopServiceConnection {
  baseUrl: string;
  token: string;
  port: number;
}

export interface DesktopMcpConnection extends DesktopServiceConnection {
  path: string;
  endpointUrl: string;
}

export interface DesktopHostConnection {
  runtime: DesktopServiceConnection;
  mcp: DesktopMcpConnection;
}

export interface DesktopHostOptions {
  runtimeDirectory: string;
  mcpDirectory: string;
  home: string;
  browserHeadless: boolean;
  browser: "chrome" | "chromium";
  startupTimeoutMs?: number;
}

export class DesktopHost {
  private state: DesktopHostState = "starting";

  private runtime: RuntimeProcess | undefined;

  private mcp: McpProcess | undefined;

  private intentionalStop = false;

  constructor(private readonly options: DesktopHostOptions) {}

  getState(): DesktopHostState {
    return this.state;
  }

  async start(): Promise<DesktopHostConnection> {
    if (this.runtime !== undefined || this.mcp !== undefined) {
      throw new Error("Rove Desktop Host is already running.");
    }

    this.state = "starting";
    this.intentionalStop = false;

    const host = "127.0.0.1";

    const runtimePort = await allocateLoopbackPort();

    const runtimeToken = randomBytes(32).toString("hex");

    const runtimeBaseUrl = `http://${host}:${runtimePort}`;

    const runtime = new RuntimeProcess({
      runtimeDirectory: this.options.runtimeDirectory,
      home: this.options.home,
      host,
      port: runtimePort,
      token: runtimeToken,
      browserHeadless: this.options.browserHeadless,
      browser: this.options.browser,
    });

    this.runtime = runtime;

    runtime.onExit(() => {
      if (!this.intentionalStop && this.state !== "stopping") {
        this.state = "failed";
      }
    });

    runtime.start();

    try {
      await waitForRuntimeReady(runtimeBaseUrl, {
        timeoutMs: this.options.startupTimeoutMs ?? 15_000,
      });

      const mcpPort = await allocateLoopbackPort();

      const mcpToken = randomBytes(32).toString("hex");

      const mcpPath = "/mcp";

      const mcpBaseUrl = `http://${host}:${mcpPort}`;

      const mcp = new McpProcess({
        mcpDirectory: this.options.mcpDirectory,
        runtimeUrl: runtimeBaseUrl,
        runtimeToken,
        host,
        port: mcpPort,
        path: mcpPath,
        token: mcpToken,
        allowedHosts: [`${host}:${mcpPort}`, `localhost:${mcpPort}`],
      });

      this.mcp = mcp;

      mcp.onExit(() => {
        if (!this.intentionalStop && this.state !== "stopping") {
          this.state = "degraded";
        }
      });

      mcp.start();

      await waitForMcpReady(mcpBaseUrl, {
        timeoutMs: this.options.startupTimeoutMs ?? 15_000,
      });

      this.state = "ready";

      return {
        runtime: {
          baseUrl: runtimeBaseUrl,
          token: runtimeToken,
          port: runtimePort,
        },
        mcp: {
          baseUrl: mcpBaseUrl,
          endpointUrl: `${mcpBaseUrl}${mcpPath}`,
          token: mcpToken,
          port: mcpPort,
          path: mcpPath,
        },
      };
    } catch (error) {
      this.state = "failed";
      this.intentionalStop = true;

      await this.mcp?.stop().catch(() => undefined);

      await runtime.stop().catch(() => undefined);

      this.mcp = undefined;
      this.runtime = undefined;

      throw error;
    }
  }

  async stop(): Promise<void> {
    const mcp = this.mcp;
    const runtime = this.runtime;

    if (mcp === undefined && runtime === undefined) {
      return;
    }

    this.state = "stopping";
    this.intentionalStop = true;

    let shutdownError: unknown;

    try {
      await mcp?.stop();
    } catch (error) {
      shutdownError = error;
    }

    try {
      await runtime?.stop();
    } catch (error) {
      shutdownError ??= error;
    }

    this.mcp = undefined;
    this.runtime = undefined;

    if (shutdownError !== undefined) {
      throw shutdownError;
    }
  }
}
