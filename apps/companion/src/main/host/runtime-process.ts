import { spawn, type ChildProcess } from "node:child_process";

import {
  shouldDetachManagedChild,
  terminateProcessTree,
} from "./process-tree.js";
import {
  removeManagedRuntimeRecord,
  writeManagedRuntimeRecord,
} from "./managed-runtime-registry.js";

export interface RuntimeProcessOptions {
  runtimeDirectory: string;
  home: string;
  host: string;
  port: number;
  token: string;
  browserHeadless: boolean;
  browser: "chrome" | "chromium";
  browserExecutablePath?: string;
  playwrightBrowsersPath?: string;
  nodeExecutable?: string;
  entrypoint?: string;
  electronRunAsNode?: boolean;
  runtimeInstanceId?: string;
  runtimeStartedAt?: string;
}

export function buildRuntimeProcessEnvironment(
  options: RuntimeProcessOptions,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const baseUrl = `http://${options.host}:${options.port}`;

  return {
    ...baseEnvironment,
    ROVE_HOME: options.home,
    ROVE_RUNTIME_HOST: options.host,
    ROVE_RUNTIME_PORT: String(options.port),
    ROVE_RUNTIME_URL: baseUrl,
    ROVE_RUNTIME_TOKEN: options.token,
    ROVE_BROWSER_HEADLESS: String(options.browserHeadless),
    ROVE_BROWSER: options.browser,
    ...(options.runtimeInstanceId === undefined
      ? {}
      : {
          ROVE_RUNTIME_INSTANCE_ID: options.runtimeInstanceId,
          ROVE_RUNTIME_OWNER_PROCESS_ID: String(process.pid),
        }),
    ...(options.runtimeStartedAt === undefined
      ? {}
      : { ROVE_RUNTIME_STARTED_AT: options.runtimeStartedAt }),
    ...(options.browserExecutablePath === undefined
      ? {}
      : {
          ROVE_BROWSER_EXECUTABLE_PATH: options.browserExecutablePath,
        }),
    ...(options.playwrightBrowsersPath === undefined
      ? {}
      : {
          PLAYWRIGHT_BROWSERS_PATH: options.playwrightBrowsersPath,
        }),
    ...(options.electronRunAsNode === true
      ? {
          ELECTRON_RUN_AS_NODE: "1",
        }
      : {}),
  };
}

export interface RuntimeExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
}

function appendOutputTail(existing: string, chunk: Buffer): string {
  const next = `${existing}${chunk.toString()}`;

  return next.length > 4_000 ? next.slice(-4_000) : next;
}

export class RuntimeProcess {
  private child: ChildProcess | undefined;
  private registryWrite: Promise<void> = Promise.resolve();

  private readonly exitListeners = new Set<(exit: RuntimeExit) => void>();

  constructor(private readonly options: RuntimeProcessOptions) {}

  start(): void {
    if (this.child !== undefined) {
      throw new Error("Rove Runtime is already running.");
    }

    const nodeExecutable =
      this.options.nodeExecutable ?? process.env.npm_node_execpath ?? "node";

    const args =
      this.options.entrypoint === undefined
        ? ["--import", "tsx", "src/main.ts"]
        : [this.options.entrypoint];
    if (this.options.runtimeInstanceId !== undefined) {
      args.push(`--rove-runtime-instance=${this.options.runtimeInstanceId}`);
    }

    const child = spawn(nodeExecutable, args, {
      cwd: this.options.runtimeDirectory,
      env: buildRuntimeProcessEnvironment(this.options),
      stdio: ["ignore", "pipe", "pipe"],
      detached: shouldDetachManagedChild(),
    });

    this.child = child;

    if (
      child.pid !== undefined &&
      this.options.runtimeInstanceId !== undefined &&
      this.options.runtimeStartedAt !== undefined
    ) {
      this.registryWrite = writeManagedRuntimeRecord({
        home: this.options.home,
        runtimeDirectory: this.options.runtimeDirectory,
        baseUrl: `http://${this.options.host}:${this.options.port}`,
        runtimeInstanceId: this.options.runtimeInstanceId,
        runtimeProcessId: child.pid,
        startedAt: this.options.runtimeStartedAt,
      }).catch((error: unknown) => {
        process.stderr.write(
          `[runtime] Failed to record managed Runtime ownership: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      });
    }

    let outputTail = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      outputTail = appendOutputTail(outputTail, chunk);
      process.stdout.write(`[runtime] ${chunk.toString()}`);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      outputTail = appendOutputTail(outputTail, chunk);
      process.stderr.write(`[runtime] ${chunk.toString()}`);
    });

    let exitReported = false;

    const reportExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
      error?: Error,
    ) => {
      if (exitReported) {
        return;
      }

      exitReported = true;

      const pid = child.pid;

      if (this.child === child) {
        this.child = undefined;
      }

      if (pid !== undefined) {
        void terminateProcessTree(pid, "SIGKILL").catch(() => undefined);
      }
      if (this.options.runtimeInstanceId !== undefined) {
        void this.registryWrite
          .then(() =>
            removeManagedRuntimeRecord(
              this.options.home,
              this.options.runtimeInstanceId!,
            ),
          )
          .catch(() => undefined);
      }

      for (const listener of this.exitListeners) {
        const output = outputTail.trim();
        const exitError =
          error?.message ??
          (code === 0 && signal === null
            ? undefined
            : [
                `Runtime process exited with ${code === null ? "no exit code" : `code ${code}`}${
                  signal === null ? "" : ` and signal ${signal}`
                }.`,
                output.length === 0 ? undefined : output,
              ]
                .filter((value): value is string => value !== undefined)
                .join("\n"));

        listener({
          code,
          signal,
          ...(exitError === undefined ? {} : { error: exitError }),
        });
      }
    };

    child.once("error", (error) => {
      if (child.pid === undefined) {
        reportExit(null, null, error);
        return;
      }

      process.stderr.write(`[runtime] ${error.message}\n`);
    });

    child.once("exit", (code, signal) => {
      reportExit(code, signal);
    });
  }

  isRunning(): boolean {
    return (
      this.child !== undefined &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    );
  }

  getPid(): number | undefined {
    return this.child?.pid;
  }

  onExit(listener: (exit: RuntimeExit) => void): () => void {
    this.exitListeners.add(listener);

    return () => {
      this.exitListeners.delete(listener);
    };
  }

  async stop(timeoutMs = 5_000): Promise<void> {
    const child = this.child;

    if (child === undefined) {
      return;
    }

    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    const pid = child.pid;

    if (pid === undefined) {
      child.kill("SIGTERM");
    } else {
      await terminateProcessTree(pid, "SIGTERM");
    }

    const exited = await this.waitForExit(child, timeoutMs);

    if (exited) {
      return;
    }

    if (pid === undefined) {
      child.kill("SIGKILL");
    } else {
      await terminateProcessTree(pid, "SIGKILL");
    }

    await this.waitForExit(child, 1_000);
  }

  private waitForExit(
    child: ChildProcess,
    timeoutMs: number,
  ): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      let settled = false;

      const finish = (exited: boolean) => {
        if (settled) {
          return;
        }

        settled = true;

        clearTimeout(timer);
        child.off("exit", onExit);

        resolve(exited);
      };

      const onExit = () => {
        finish(true);
      };

      const timer = setTimeout(() => {
        finish(false);
      }, timeoutMs);

      child.once("exit", onExit);
    });
  }
}
