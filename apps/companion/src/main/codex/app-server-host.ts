import { execFile as execFileCallback, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { restartDelayMs, type RestartPolicy } from "../host/restart-policy.js";
import type {
  CodexExecutableResolver,
  ResolvedCodexExecutable,
} from "./compatibility.js";
import { CodexRpcConnection } from "./rpc-connection.js";
import type {
  CodexMethod,
  CodexRequestMap,
  CodexRpcPort,
  CodexServerEventListener,
  JsonRpcError,
  JsonRpcId,
  InitializeResponse,
} from "./protocol.js";

const execFile = promisify(execFileCallback);

function sanitizedEnvironment(
  additions: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SystemRoot",
  ] as const;
  return Object.fromEntries([
    ...allowed.flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]!]],
    ),
    ...Object.entries(additions),
  ]);
}

export async function readCodexVersion(
  executablePath: string,
): Promise<string> {
  const { stdout, stderr } = await execFile(executablePath, ["--version"], {
    timeout: 5_000,
    env: sanitizedEnvironment(),
  });
  const match = `${stdout}\n${stderr}`.match(/codex(?:-cli)?\s+(\S+)/i);
  if (match?.[1] === undefined) {
    throw new Error("Codex version probe returned an unrecognized response.");
  }
  return match[1];
}

export type CodexHostState =
  | "stopped"
  | "resolving"
  | "starting"
  | "initializing"
  | "ready"
  | "degraded"
  | "failed"
  | "stopping";

export interface CodexHostHealth {
  state: CodexHostState;
  ready: boolean;
  connectionId?: string;
  restartAttempt: number;
  lastError?: string;
  stderrTail: readonly string[];
  executable?: Pick<ResolvedCodexExecutable, "source" | "baseline">;
}

export interface CodexAppServerHostOptions {
  resolver: CodexExecutableResolver;
  clientVersion: string;
  requestTimeoutMs?: number;
  restartPolicy?: RestartPolicy;
  spawnProcess?: (
    path: string,
    args: readonly string[],
  ) => ChildProcessWithoutNullStreams;
  sleep?: (ms: number) => Promise<void>;
  environment?: Readonly<Record<string, string>>;
}

export class CodexAppServerHost implements CodexRpcPort {
  private state: CodexHostState = "stopped";
  private process: ChildProcessWithoutNullStreams | undefined;
  private connection: CodexRpcConnection | undefined;
  private connectionId: string | undefined;
  private executable: ResolvedCodexExecutable | undefined;
  private intentionalStop = false;
  private restartAttempt = 0;
  private recovery: Promise<void> | undefined;
  private lastError: string | undefined;
  private readonly stderrTail: string[] = [];
  private readonly listeners = new Set<(health: CodexHostHealth) => void>();
  private readonly rpcListeners = new Set<CodexServerEventListener>();
  private negotiated: InitializeResponse | undefined;
  private connectionReplacement: Promise<void> | undefined;

  constructor(private readonly options: CodexAppServerHostOptions) {}

  getHealth(): CodexHostHealth {
    return {
      state: this.state,
      ready: this.state === "ready",
      ...(this.connection === undefined ||
      this.state !== "ready" ||
      this.connectionId === undefined
        ? {}
        : { connectionId: this.connectionId }),
      restartAttempt: this.restartAttempt,
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
      stderrTail: [...this.stderrTail],
      ...(this.executable === undefined
        ? {}
        : {
            executable: {
              source: this.executable.source,
              baseline: this.executable.baseline,
            },
          }),
    };
  }

  getNegotiatedIdentity(): InitializeResponse | undefined {
    return this.negotiated === undefined
      ? undefined
      : structuredClone(this.negotiated);
  }

  /** Bounded diagnostic identity used by local process qualification. */
  getProcessId(): number | undefined {
    return this.process?.pid;
  }

  onHealth(listener: (health: CodexHostHealth) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  rpc(): CodexRpcPort {
    return this;
  }

  request<M extends CodexMethod>(
    method: M,
    params: CodexRequestMap[M]["params"],
    timeoutMs?: number,
  ): Promise<CodexRequestMap[M]["result"]> {
    if (this.state !== "ready" || this.connection === undefined) {
      return Promise.reject(new Error("Codex App Server is not ready."));
    }
    return this.connection.request(method, params, timeoutMs);
  }

  notify(method: string, params?: Record<string, unknown>): void {
    if (this.state !== "ready" || this.connection === undefined) {
      throw new Error("Codex App Server is not ready.");
    }
    this.connection.notify(method, params);
  }

  respond(id: JsonRpcId, result: unknown, error?: JsonRpcError): Promise<void> {
    if (this.state !== "ready" || this.connection === undefined) {
      throw new Error("Codex App Server is not ready.");
    }
    return this.connection.respond(id, result, error);
  }

  onEvent(listener: CodexServerEventListener): () => void {
    this.rpcListeners.add(listener);
    return () => this.rpcListeners.delete(listener);
  }

  drainEvents(): Promise<void> {
    return this.connection?.drainEvents() ?? Promise.resolve();
  }

  async start(): Promise<CodexRpcPort> {
    if (this.state !== "stopped" && this.state !== "failed") {
      throw new Error("Codex App Server host is already active.");
    }
    this.intentionalStop = false;
    this.restartAttempt = 0;
    this.setState("resolving");
    this.executable = await this.options.resolver.resolve().catch((error) => {
      this.fail(error);
      throw error;
    });
    await this.spawnAndInitialize();
    return this;
  }

  async stop(): Promise<void> {
    this.intentionalStop = true;
    this.setState("stopping");
    const child = this.process;
    const connection = this.connection;
    await connection?.closeUncertain("host stopping");
    if (this.connection === connection) {
      this.connection = undefined;
      this.connectionId = undefined;
      this.negotiated = undefined;
      this.process = undefined;
    }
    if (child !== undefined && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2_000);
        timer.unref();
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }
    await this.recovery?.catch(() => undefined);
    this.setState("stopped");
  }

  replaceConnection(): Promise<void> {
    if (this.connectionReplacement) return this.connectionReplacement;
    this.connectionReplacement = (async () => {
      await this.stop();
      await this.start();
    })().finally(() => {
      this.connectionReplacement = undefined;
    });
    return this.connectionReplacement;
  }

  private async spawnAndInitialize(): Promise<CodexRpcPort> {
    if (this.executable === undefined)
      throw new Error("Executable unresolved.");
    this.negotiated = undefined;
    this.setState("starting");
    const connectionId = `codex_${randomUUID().replaceAll("-", "")}`;
    const child = (
      this.options.spawnProcess ??
      ((path, args) =>
        spawn(path, [...args], {
          env: sanitizedEnvironment(this.options.environment),
          stdio: ["pipe", "pipe", "pipe"],
        }))
    )(this.executable.executablePath, ["app-server"]);
    this.process = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        this.stderrTail.push(line.slice(0, 2_000));
        if (this.stderrTail.length > 40) this.stderrTail.shift();
      }
      this.emit();
    });
    const connection = new CodexRpcConnection({
      stdin: child.stdin,
      stdout: child.stdout,
      connectionId,
      ...(this.options.requestTimeoutMs === undefined
        ? {}
        : { defaultTimeoutMs: this.options.requestTimeoutMs }),
      onProtocolFailure: (error) => {
        this.lastError = error.message;
        child.kill("SIGTERM");
      },
      onEventFailure: (error) => {
        if (this.connection !== connection) return;
        this.lastError = `Codex event delivery failed: ${error.message}`;
        this.emit();
      },
    });
    this.connection = connection;
    this.connectionId = connectionId;
    connection.onEvent(async (event) => {
      if (this.connection !== connection || this.connectionId !== connectionId)
        return;
      let firstFailure: Error | undefined;
      for (const listener of [...this.rpcListeners]) {
        try {
          await listener(event);
        } catch (error) {
          firstFailure ??=
            error instanceof Error ? error : new Error(String(error));
        }
      }
      if (firstFailure) throw firstFailure;
    });
    child.once("error", (error) => {
      this.lastError = `Codex App Server process error: ${error.message}`;
      connection.closeUncertain(this.lastError);
      child.kill("SIGTERM");
    });
    child.once("exit", (code, signal) => {
      void this.finishExitedConnection(child, connection, code, signal).catch(
        (error) => this.fail(error),
      );
    });
    this.setState("initializing");
    try {
      const negotiated = await connection.request("initialize", {
        clientInfo: {
          name: "rove",
          title: "Rove",
          version: this.options.clientVersion,
        },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      if (
        this.executable !== undefined &&
        !negotiated.userAgent.includes(this.executable.baseline.cliVersion)
      ) {
        throw new Error(
          "Codex initialize identity does not match the compatibility baseline.",
        );
      }
      this.negotiated = negotiated;
      connection.notify("initialized");
      this.restartAttempt = 0;
      this.lastError = undefined;
      this.setState("ready");
      return connection;
    } catch (error) {
      child.kill("SIGTERM");
      this.fail(error);
      throw error;
    }
  }

  private async finishExitedConnection(
    child: ChildProcessWithoutNullStreams,
    connection: CodexRpcConnection,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    await connection.closeUncertain(
      `process exited (${code ?? signal ?? "unknown"})`,
    );
    if (this.process !== child || this.connection !== connection) return;
    this.process = undefined;
    this.connection = undefined;
    this.connectionId = undefined;
    this.negotiated = undefined;
    this.onUnexpectedExit(code, signal);
  }

  private onUnexpectedExit(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.intentionalStop) return;
    this.lastError ??= `Codex App Server exited (${code ?? signal ?? "unknown"}).`;
    this.setState("degraded");
    if (this.recovery !== undefined) return;
    this.recovery = this.recover().finally(() => {
      this.recovery = undefined;
    });
  }

  private async recover(): Promise<void> {
    const policy = this.options.restartPolicy ?? {
      maxAttempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 2_000,
    };
    while (!this.intentionalStop) {
      this.restartAttempt += 1;
      const delay = restartDelayMs(this.restartAttempt, policy);
      if (delay === null) {
        this.setState("failed");
        return;
      }
      await (
        this.options.sleep ??
        ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
      )(delay);
      if (this.intentionalStop) return;
      try {
        await this.spawnAndInitialize();
        return;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  private fail(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    this.setState("failed");
  }

  private setState(state: CodexHostState): void {
    this.state = state;
    this.emit();
  }

  private emit(): void {
    const health = this.getHealth();
    for (const listener of this.listeners) listener(health);
  }
}
