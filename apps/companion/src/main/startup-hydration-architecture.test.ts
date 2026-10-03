import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("desktop startup hydration architecture", () => {
  it("presents an IPC-backed neutral surface before provider startup completes", async () => {
    const source = await readFile(
      new URL("./main.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("async function startDesktop()");
    const startup = source.slice(start);
    const registerIpc = startup.indexOf("\n  registerIpc(");
    const presentSurface = startup.indexOf(
      "unifiedSurfaceCoordinator.present(unifiedSurfaceState.snapshot())",
    );
    const awaitProvider = startup.indexOf("await startCodexExecutionCore()");

    expect(start).toBeGreaterThanOrEqual(0);
    expect(registerIpc).toBeGreaterThanOrEqual(0);
    expect(presentSurface).toBeGreaterThan(registerIpc);
    expect(awaitProvider).toBeGreaterThan(presentSurface);
  });
});
