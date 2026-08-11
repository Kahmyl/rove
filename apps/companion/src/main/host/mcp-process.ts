import { spawn, type ChildProcess } from "node:child_process";

import {
  shouldDetachManagedChild,
  terminateProcessTree,
} from "./process-tree.js";

export interface McpProcessOptions {
  mcpDirectory: string;
  runtimeUrl: string;
  runtimeToken: string;
  host: string;
  port: number;
  path: string;
  token: string;
  allowedHosts: string[];
  nodeExecutable?: string;
  entrypoint?: string;
  electronRunAsNode?: boolean;
}

export interface McpExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
}

export function buildMcpProcessEnvironment(
  options: McpProcessOptions,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...baseEnvironment,
    ROVE_RUNTIME_URL: options.runtimeUrl,
    ROVE_RUNTIME_TOKEN: options.runtimeToken,
    ROVE_MCP_TRANSPORT: "http",
    ROVE_MCP_HOST: options.host,
    ROVE_MCP_PORT: String(options.port),
    ROVE_MCP_PATH: options.path,
    ROVE_MCP_TOKEN: options.token,
    ROVE_MCP_ALLOWED_HOSTS: options.allowedHosts.join(","),
    ...(options.electronRunAsNode === true
      ? {
          ELECTRON_RUN_AS_NODE: "1",
        }
      : {}),
  };
}

export class McpProcess {
  private child: ChildProcess | undefined;

  private readonly exitListeners = new Set<(exit: McpExit) => void>();

  constructor(private readonly options: McpProcessOptions) {}

  start(): void {
    if (this.child !== undefined) {
      throw new Error("Rove MCP is already running.");
    }

    const nodeExecutable =
      this.options.nodeExecutable ?? process.env.npm_node_execpath ?? "node";

    const args =
      this.options.entrypoint === undefined
        ? ["--import", "tsx", "src/main.ts"]
        : [this.options.entrypoint];

    const child = spawn(nodeExecutable, args, {
      cwd: this.options.mcpDirectory,
      env: buildMcpProcessEnvironment(this.options),
      stdio: ["ignore", "pipe", "pipe"],
      detached: shouldDetachManagedChild(),
    });

    this.child = child;

    child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(`[mcp] ${chunk.toString()}`);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[mcp] ${chunk.toString()}`);
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

      for (const listener of this.exitListeners) {
        listener({
          code,
          signal,
          ...(error === undefined ? {} : { error: error.message }),
        });
      }
    };

    child.once("error", (error) => {
      if (child.pid === undefined) {
        reportExit(null, null, error);
        return;
      }

      process.stderr.write(`[mcp] ${error.message}\n`);
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

  onExit(listener: (exit: McpExit) => void): () => void {
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
