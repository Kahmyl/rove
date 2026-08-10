import { randomBytes } from "node:crypto";

import { allocateLoopbackPort } from "./port-allocation.js";
import { RuntimeProcess } from "./runtime-process.js";
import { waitForRuntimeReady } from "./runtime-readiness.js";

export type DesktopHostState =
  "starting" | "ready" | "degraded" | "stopping" | "failed";

export interface DesktopRuntimeConnection {
  baseUrl: string;
  token: string;
  port: number;
}

export interface DesktopHostOptions {
  runtimeDirectory: string;
  home: string;
  browserHeadless: boolean;
  browser: "chrome" | "chromium";
  startupTimeoutMs?: number;
}

export class DesktopHost {
  private state: DesktopHostState = "starting";

  private runtime: RuntimeProcess | undefined;

  private intentionalStop = false;

  constructor(private readonly options: DesktopHostOptions) {}

  getState(): DesktopHostState {
    return this.state;
  }

  async start(): Promise<DesktopRuntimeConnection> {
    if (this.runtime !== undefined) {
      throw new Error("Rove Desktop Host is already running.");
    }

    this.state = "starting";
    this.intentionalStop = false;

    const host = "127.0.0.1";
    const port = await allocateLoopbackPort();

    const token = randomBytes(32).toString("hex");

    const baseUrl = `http://${host}:${port}`;

    const runtime = new RuntimeProcess({
      runtimeDirectory: this.options.runtimeDirectory,
      home: this.options.home,
      host,
      port,
      token,
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
      await waitForRuntimeReady(baseUrl, {
        timeoutMs: this.options.startupTimeoutMs ?? 15_000,
      });

      this.state = "ready";

      return {
        baseUrl,
        token,
        port,
      };
    } catch (error) {
      this.state = "failed";
      this.intentionalStop = true;

      await runtime.stop().catch(() => undefined);

      this.runtime = undefined;

      throw error;
    }
  }

  async stop(): Promise<void> {
    const runtime = this.runtime;

    if (runtime === undefined) {
      return;
    }

    this.state = "stopping";
    this.intentionalStop = true;

    await runtime.stop();

    this.runtime = undefined;
  }
}
