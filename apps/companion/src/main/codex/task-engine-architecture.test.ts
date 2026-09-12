import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../../..");
const read = (path: string) => readFile(resolve(root, path), "utf8");

describe("task engine static source gates", () => {
  it("has one production engine and one SQLite task store", async () => {
    const source = await read(
      "apps/companion/src/main/codex/execution-core.ts",
    );
    expect(source.match(/new TaskEngine\(/g)).toHaveLength(1);
    expect(source.match(/new SqliteTaskEngineStore\(/g)).toHaveLength(1);
  });

  it("makes all launch, attachment, live-ingress, convergence, and publication dependencies reachable from the core", async () => {
    const source = await read(
      "apps/companion/src/main/codex/execution-core.ts",
    );
    for (const dependency of [
      "mcpLaunch: this.options.mcpLaunch",
      "persistedCapabilityIssuer(",
      "attachmentAuthority",
      "attachmentRuntime",
      "pollRuntimeTruth",
      "worker.signal()",
      "taskPort.publish()",
      "onProductStateChanged",
    ])
      expect(source).toContain(dependency);
  });

  it("uses only the real CodexExecutionCore process harness in product traces", async () => {
    const source = await read(
      "apps/companion/src/main/codex/task-engine-production-traces.test.ts",
    );
    expect(source).toContain("ProcessProductHarness");
    expect(source).not.toMatch(
      /new TaskEngine|SqliteTaskEngineStore|LedgerProductTaskPort|engine\.accept/,
    );
  });

  it("cuts the old coordinator and optional lifecycle driver out of production", async () => {
    const source = await read(
      "apps/companion/src/main/codex/execution-core.ts",
    );
    expect(source).not.toMatch(
      /new RoveTaskCoordinator|taskProcessDriver|compareLifecycleDecision/,
    );
  });

  it("makes LocalProductApi depend on ProductTaskPort and submit one intent", async () => {
    const source = await read(
      "apps/companion/src/main/codex/local-product-api.ts",
    );
    expect(source).toContain("private readonly tasks: ProductTaskPort");
    expect(source).not.toMatch(
      /RoveTaskCoordinator|TaskProcessDriver|NativeLifecycleInput/,
    );
    expect(source).not.toMatch(/attention\.(cancel|resolveExact|flush)\(/);
  });

  it("keeps lifecycle snapshots out of the closed TaskEvent union", async () => {
    const source = await read("packages/protocol/src/task-engine.ts");
    const union = source.slice(
      source.indexOf("export type TaskEvent ="),
      source.indexOf("export type TaskIntent ="),
    );
    expect(union).not.toContain("NativeLifecycleInput");
    expect(union).not.toContain("aggregate:");
  });

  it("contains no fire-and-forget durable acceptance or ordered delivery", async () => {
    const sources = await Promise.all([
      read("apps/companion/src/main/codex/execution-core.ts"),
      read("apps/companion/src/main/codex/ordered-task-ingress.ts"),
      read("apps/companion/src/main/codex/task-engine-worker.ts"),
    ]);
    expect(sources.join("\n")).not.toMatch(
      /void\s+(?:this\.)?(?:engine\.accept|ingress\.enqueue|acceptFact)/,
    );
  });
});
