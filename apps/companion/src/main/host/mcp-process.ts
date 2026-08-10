import { spawn, type ChildProcess } from "node:child_process";

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
}

export interface McpExit {
  code: number | null;
  signal: NodeJS.Signals | null;
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

    const child = spawn(nodeExecutable, ["--import", "tsx", "src/main.ts"], {
      cwd: this.options.mcpDirectory,
      env: buildMcpProcessEnvironment(this.options),
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.child = child;

    child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(`[mcp] ${chunk.toString()}`);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[mcp] ${chunk.toString()}`);
    });

    child.once("exit", (code, signal) => {
      this.child = undefined;

      for (const listener of this.exitListeners) {
        listener({
          code,
          signal,
        });
      }
    });
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

    child.kill("SIGTERM");

    const exited = await this.waitForExit(child, timeoutMs);

    if (exited) {
      return;
    }

    child.kill("SIGKILL");

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
