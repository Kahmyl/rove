import { spawn, type ChildProcess } from "node:child_process";

export interface RuntimeProcessOptions {
  runtimeDirectory: string;
  home: string;
  host: string;
  port: number;
  token: string;
  browserHeadless: boolean;
  browser: "chrome" | "chromium";
  nodeExecutable?: string;
}

export interface RuntimeExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export class RuntimeProcess {
  private child: ChildProcess | undefined;

  private readonly exitListeners = new Set<(exit: RuntimeExit) => void>();

  constructor(private readonly options: RuntimeProcessOptions) {}

  start(): void {
    if (this.child !== undefined) {
      throw new Error("Rove Runtime is already running.");
    }

    const nodeExecutable =
      this.options.nodeExecutable ?? process.env.npm_node_execpath ?? "node";

    const baseUrl = `http://${this.options.host}:${this.options.port}`;

    const child = spawn(nodeExecutable, ["--import", "tsx", "src/main.ts"], {
      cwd: this.options.runtimeDirectory,
      env: {
        ...process.env,
        ROVE_HOME: this.options.home,
        ROVE_RUNTIME_HOST: this.options.host,
        ROVE_RUNTIME_PORT: String(this.options.port),
        ROVE_RUNTIME_URL: baseUrl,
        ROVE_RUNTIME_TOKEN: this.options.token,
        ROVE_BROWSER_HEADLESS: String(this.options.browserHeadless),
        ROVE_BROWSER: this.options.browser,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.child = child;

    child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(`[runtime] ${chunk.toString()}`);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[runtime] ${chunk.toString()}`);
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
