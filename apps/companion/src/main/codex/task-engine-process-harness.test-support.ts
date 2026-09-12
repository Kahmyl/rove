import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const root = resolve(import.meta.dirname, "../../../../..");
const executable = join(root, "apps/companion/node_modules/.bin/tsx");
const driver = join(
  root,
  "experiments/agent-execution/recovery-harness/desktop-host-driver.mjs",
);
const sourceTsconfig = join(
  root,
  "experiments/agent-execution/recovery-harness/tsconfig.source.json",
);

export type ProductValue = Record<string, unknown>;

export class ProcessProductHarness {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private stderrTail = "";
  private readonly pending = new Map<
    number,
    { resolve(value: ProductValue): void; reject(error: Error): void }
  >();

  constructor(
    readonly home: string,
    private readonly options: {
      badCatalog?: boolean;
      cutPoint?: string;
      cutCommand?: string;
    } = {},
  ) {
    if (
      options.cutCommand &&
      ["before_event_commit", "after_commit_before_claim"].includes(
        options.cutPoint ?? "",
      )
    )
      throw new Error(
        `Cut point ${options.cutPoint} occurs before Task Engine command creation and cannot use a cutCommand filter.`,
      );
  }

  async start(): Promise<void> {
    if (this.child) return;
    const child = spawn(executable, ["--tsconfig", sourceTsconfig, driver], {
      cwd: root,
      // Give every process-backed product its own process group. The harness
      // deliberately replaces Runtime and App Server children, so a startup
      // PID snapshot cannot safely identify the complete tree at a later
      // crash cut (and a recycled PID could belong to another parallel test).
      detached: true,
      env: {
        ...process.env,
        ROVE_L2_HOME: this.home,
        ...(this.options.badCatalog ? { ROVE_L2_BAD_MCP_CATALOG: "1" } : {}),
        ...(this.options.cutPoint
          ? { ROVE_TASK_ENGINE_CUT_POINT: this.options.cutPoint }
          : {}),
        ...(this.options.cutCommand
          ? { ROVE_TASK_ENGINE_CUT_COMMAND: this.options.cutCommand }
          : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stderr.on("data", (chunk: Buffer | string) => {
      this.stderrTail = `${this.stderrTail}${String(chunk)}`.slice(-16_000);
    });
    child.once("exit", () => {
      for (const pending of this.pending.values())
        pending.reject(new Error("Product host was interrupted."));
      this.pending.clear();
    });
    const ready = new Promise<void>((resolveReady, rejectReady) => {
      const timeout = setTimeout(
        () => rejectReady(new Error("Process-backed product host timed out.")),
        60_000,
      );
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (!line.startsWith("ROVE_L2:")) return;
        const message = JSON.parse(line.slice(8)) as {
          event?: string;
          id?: number;
          result?: ProductValue;
          error?: string;
          desktopPid?: number;
          runtimePid?: number;
          appServerPid?: number;
        };
        if (message.event === "ready") {
          clearTimeout(timeout);
          resolveReady();
          return;
        }
        if (message.id === undefined) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve(message.result ?? {});
      });
      child.once("error", rejectReady);
      child.once("exit", (code) => {
        if (this.child === child && code && code !== 0)
          rejectReady(
            new Error(
              `Product host exited with ${code}.${this.stderrTail ? `\nChild stderr:\n${this.stderrTail}` : ""}`,
            ),
          );
      });
    });
    await ready;
  }

  request(command: ProductValue): Promise<ProductValue> {
    const child = this.child;
    if (!child) throw new Error("Process-backed product host is not running.");
    const id = this.nextId++;
    return new Promise<ProductValue>((resolveRequest, rejectRequest) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(
          new Error(
            `${String(command.type)} timed out.${this.stderrTail ? `\nChild stderr:\n${this.stderrTail}` : ""}`,
          ),
        );
      }, 60_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolveRequest(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          rejectRequest(error);
        },
      });
      child.stdin.write(`${JSON.stringify({ id, command })}\n`);
    });
  }

  snapshot(): Promise<ProductValue> {
    return this.request({ type: "snapshot" });
  }

  async until(
    predicate: (snapshot: ProductValue) => boolean,
    timeoutMs = 45_000,
  ): Promise<ProductValue> {
    const deadline = Date.now() + timeoutMs;
    let lastSnapshot: ProductValue | undefined;
    while (Date.now() < deadline) {
      const current = await this.snapshot();
      lastSnapshot = current;
      if (predicate(current)) return current;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(
      `Timed out waiting for process-backed product state.${lastSnapshot ? `\nLast snapshot:\n${JSON.stringify(lastSnapshot, null, 2)}` : ""}${this.stderrTail ? `\nChild stderr:\n${this.stderrTail}` : ""}`,
    );
  }

  async untilResult(
    command: ProductValue,
    predicate: (result: ProductValue) => boolean,
    timeoutMs = 45_000,
  ): Promise<ProductValue> {
    const deadline = Date.now() + timeoutMs;
    let lastResult: ProductValue | undefined;
    while (Date.now() < deadline) {
      const current = await this.request(command);
      lastResult = current;
      if (predicate(current)) return current;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(
      `Timed out waiting for process-backed command evidence.${lastResult ? `\nLast result:\n${JSON.stringify(lastResult, null, 2)}` : ""}${this.stderrTail ? `\nChild stderr:\n${this.stderrTail}` : ""}`,
    );
  }

  async waitForCut(timeoutMs = 60_000): Promise<ProductValue> {
    const path = join(this.home, "task-engine-cut.json");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        return JSON.parse(await readFile(path, "utf8")) as ProductValue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    throw new Error("Timed out waiting for a real process cut point.");
  }

  async stop(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    child.kill(signal);
    let exited = child.exitCode !== null || child.signalCode !== null;
    if (!exited)
      await Promise.race([
        new Promise<void>((resolveStop) =>
          child.once("exit", () => {
            exited = true;
            resolveStop();
          }),
        ),
        new Promise<void>((resolveStop) => setTimeout(resolveStop, 5_000)),
      ]);
    if (!exited && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The process group may have exited between the timeout and signal.
      }
      if (child.exitCode === null && child.signalCode === null)
        await Promise.race([
          new Promise<void>((resolveStop) =>
            child.once("exit", () => resolveStop()),
          ),
          new Promise<void>((resolveStop) => setTimeout(resolveStop, 5_000)),
        ]);
    }
  }

  async stopAllHard(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The product process group may already have exited at the cut.
      }
    }
    if (child)
      await Promise.race([
        new Promise<void>((resolveStop) =>
          child.once("exit", () => resolveStop()),
        ),
        new Promise<void>((resolveStop) => setTimeout(resolveStop, 5_000)),
      ]);
  }
}

export function task(snapshot: ProductValue, taskId: string): ProductValue {
  const tasks = snapshot.tasks as ProductValue[];
  const result = tasks.find((entry) => entry.taskId === taskId);
  if (!result) throw new Error(`Product task ${taskId} is missing.`);
  return result;
}

export function taskId(operationId: string): string {
  return `task_${operationId.slice("intent_".length)}`;
}

export function launchIntent(
  operationId: string,
  overrides: ProductValue = {},
): ProductValue {
  return {
    type: "task.launch",
    operationId,
    input: {
      outcome: "Complete the bounded process-backed lifecycle trace.",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      approvalsReviewer: "auto_review",
      model: "l2-model",
      reasoningEffort: "low",
      attachmentIds: [],
      ...overrides,
    },
  };
}
