import { randomBytes } from "node:crypto";

import {
  discoverBrowser,
  type BrowserDiscoveryOptions,
  type BrowserInstallation,
} from "../browser/browser-discovery.js";
import { allocateLoopbackPort } from "./port-allocation.js";
import {
  defaultRestartPolicy,
  restartDelayMs,
  type RestartPolicy,
} from "./restart-policy.js";
import {
  RuntimeProcess,
  type RuntimeExit,
  type RuntimeProcessOptions,
} from "./runtime-process.js";
import { waitForRuntimeReady } from "./runtime-readiness.js";

export type DesktopHostState =
  | "starting"
  | "ready"
  | "degraded"
  | "stopping"
  | "failed";

export interface DesktopServiceConnection {
  baseUrl: string;
  token: string;
  port: number;
}

export interface DesktopHostConnection {
  runtime: DesktopServiceConnection;
  browser: BrowserInstallation;
}

export type DesktopHostEvent =
  | { type: "runtime-exited"; exit: RuntimeExit }
  | { type: "runtime-restarting"; attempt: number; delayMs: number }
  | { type: "runtime-recovered" }
  | { type: "runtime-recovery-failed"; message: string };

export interface ManagedProcess<TExit> {
  start(): void;
  stop(): Promise<void>;
  isRunning(): boolean;
  onExit(listener: (exit: TExit) => void): () => void;
}

export interface DesktopHostDependencies {
  discoverBrowser(
    options: BrowserDiscoveryOptions,
  ): Promise<BrowserInstallation>;
  allocateLoopbackPort(): Promise<number>;
  createRuntimeProcess(
    options: RuntimeProcessOptions,
  ): ManagedProcess<RuntimeExit>;
  waitForRuntimeReady(
    baseUrl: string,
    options: { timeoutMs: number },
  ): Promise<void>;
  sleep(ms: number): Promise<void>;
  token(): string;
}

export interface DesktopHostOptions {
  runtimeDirectory: string;
  home: string;
  browserHeadless: boolean;
  browser: "chrome" | "chromium";
  browserExecutablePath?: string;
  startupTimeoutMs?: number;
  restartPolicy?: RestartPolicy;
  dependencies?: Partial<DesktopHostDependencies>;
  runtimeNodeExecutable?: string;
  runtimeEntrypoint?: string;
  electronRunAsNode?: boolean;
  playwrightBrowsersPath?: string;
}

const defaultDependencies: DesktopHostDependencies = {
  discoverBrowser,
  allocateLoopbackPort,
  createRuntimeProcess: (options) => new RuntimeProcess(options),
  waitForRuntimeReady,
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  token: () => randomBytes(32).toString("hex"),
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns only the services that belong on the user's machine.
 *
 * MCP and the future public API are control-plane services and must never be
 * spawned, credentialed, or packaged by the desktop application.
 */
export class DesktopHost {
  private state: DesktopHostState = "starting";
  private runtime: ManagedProcess<RuntimeExit> | undefined;
  private connection: DesktopHostConnection | undefined;
  private intentionalStop = false;
  private recoveryEnabled = false;
  private runtimeRecovery: Promise<void> | undefined;
  private runtimeRestartAttempts = 0;
  private readonly eventListeners = new Set<
    (event: DesktopHostEvent) => void
  >();
  private readonly dependencies: DesktopHostDependencies;
  private readonly restartPolicy: RestartPolicy;

  constructor(private readonly options: DesktopHostOptions) {
    this.dependencies = {
      ...defaultDependencies,
      ...options.dependencies,
    };
    this.restartPolicy = options.restartPolicy ?? defaultRestartPolicy;
  }

  getState(): DesktopHostState {
    return this.state;
  }

  getConnection(): DesktopHostConnection | undefined {
    return this.connection;
  }

  onEvent(listener: (event: DesktopHostEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  async start(): Promise<DesktopHostConnection> {
    if (this.runtime !== undefined || this.connection !== undefined) {
      throw new Error("Rove Desktop Host is already running.");
    }

    this.state = "starting";
    this.intentionalStop = false;
    this.recoveryEnabled = false;
    this.runtimeRestartAttempts = 0;

    const browser = await this.dependencies.discoverBrowser({
      preferredBrowser: this.options.browser,
      ...(this.options.browserExecutablePath === undefined
        ? {}
        : { explicitExecutablePath: this.options.browserExecutablePath }),
    });
    const host = "127.0.0.1";
    const runtimePort = await this.dependencies.allocateLoopbackPort();
    const runtimeToken = this.dependencies.token();
    const runtimeBaseUrl = `http://${host}:${runtimePort}`;
    const connection: DesktopHostConnection = {
      browser,
      runtime: {
        baseUrl: runtimeBaseUrl,
        token: runtimeToken,
        port: runtimePort,
      },
    };
    const runtime = this.dependencies.createRuntimeProcess({
      runtimeDirectory: this.options.runtimeDirectory,
      home: this.options.home,
      host,
      port: runtimePort,
      token: runtimeToken,
      browserHeadless: this.options.browserHeadless,
      browser: browser.kind,
      ...(this.options.runtimeNodeExecutable === undefined
        ? {}
        : { nodeExecutable: this.options.runtimeNodeExecutable }),
      ...(this.options.runtimeEntrypoint === undefined
        ? {}
        : { entrypoint: this.options.runtimeEntrypoint }),
      ...(this.options.electronRunAsNode === true
        ? { electronRunAsNode: true }
        : {}),
      ...(this.options.playwrightBrowsersPath === undefined
        ? {}
        : { playwrightBrowsersPath: this.options.playwrightBrowsersPath }),
      ...(browser.executablePath === undefined
        ? {}
        : { browserExecutablePath: browser.executablePath }),
    });

    this.runtime = runtime;
    this.connection = connection;
    runtime.onExit((exit) => this.handleRuntimeExit(exit));

    try {
      runtime.start();
      await this.dependencies.waitForRuntimeReady(runtimeBaseUrl, {
        timeoutMs: this.options.startupTimeoutMs ?? 15_000,
      });
      this.state = "ready";
      this.recoveryEnabled = true;
      return connection;
    } catch (error) {
      this.state = "failed";
      this.intentionalStop = true;
      this.recoveryEnabled = false;
      await runtime.stop().catch(() => undefined);
      this.runtime = undefined;
      this.connection = undefined;
      throw error;
    }
  }

  async stop(): Promise<void> {
    const runtime = this.runtime;
    if (runtime === undefined && this.connection === undefined) return;

    this.state = "stopping";
    this.intentionalStop = true;
    this.recoveryEnabled = false;

    try {
      await runtime?.stop();
    } finally {
      this.runtime = undefined;
      this.connection = undefined;
    }
  }

  private emit(event: DesktopHostEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  private handleRuntimeExit(exit: RuntimeExit): void {
    if (
      !this.recoveryEnabled ||
      this.intentionalStop ||
      this.state === "stopping"
    ) {
      return;
    }

    this.state = "degraded";
    this.emit({ type: "runtime-exited", exit });
    this.beginRuntimeRecovery();
  }

  private beginRuntimeRecovery(): void {
    if (
      this.runtimeRecovery !== undefined ||
      !this.recoveryEnabled ||
      this.intentionalStop
    ) {
      return;
    }

    const recovery = this.recoverRuntime();
    this.runtimeRecovery = recovery;
    void recovery.finally(() => {
      if (this.runtimeRecovery === recovery) this.runtimeRecovery = undefined;
      if (
        this.recoveryEnabled &&
        !this.intentionalStop &&
        this.state !== "failed" &&
        this.runtime !== undefined &&
        !this.runtime.isRunning()
      ) {
        this.beginRuntimeRecovery();
      }
    });
  }

  private async recoverRuntime(): Promise<void> {
    const runtime = this.runtime;
    const connection = this.connection;
    if (runtime === undefined || connection === undefined) return;

    while (this.recoveryEnabled && !this.intentionalStop) {
      const attempt = this.runtimeRestartAttempts + 1;
      const delayMs = restartDelayMs(attempt, this.restartPolicy);
      if (delayMs === null) {
        await this.failRuntimeRecovery("Runtime restart budget exhausted.");
        return;
      }

      this.runtimeRestartAttempts = attempt;
      this.emit({ type: "runtime-restarting", attempt, delayMs });
      await this.dependencies.sleep(delayMs);
      if (!this.recoveryEnabled || this.intentionalStop) return;

      try {
        runtime.start();
        await this.dependencies.waitForRuntimeReady(
          connection.runtime.baseUrl,
          { timeoutMs: this.options.startupTimeoutMs ?? 15_000 },
        );
        if (!runtime.isRunning()) {
          throw new Error("Runtime exited before recovery completed.");
        }
        this.runtimeRestartAttempts = 0;
        this.state = "ready";
        this.emit({ type: "runtime-recovered" });
        return;
      } catch (error) {
        await runtime.stop().catch(() => undefined);
        if (restartDelayMs(attempt + 1, this.restartPolicy) === null) {
          await this.failRuntimeRecovery(errorMessage(error));
          return;
        }
      }
    }
  }

  private async failRuntimeRecovery(message: string): Promise<void> {
    this.recoveryEnabled = false;
    this.state = "failed";
    await this.runtime?.stop().catch(() => undefined);
    this.emit({ type: "runtime-recovery-failed", message });
  }
}
