import { describe, expect, it } from "vitest";

import {
  DesktopHost,
  type DesktopHostDependencies,
  type DesktopHostEvent,
} from "./desktop-host.js";

interface FakeExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

class FakeProcess {
  running = false;
  startCount = 0;
  stopCount = 0;
  failingStarts = 0;

  private readonly listeners = new Set<(exit: FakeExit) => void>();

  start(): void {
    this.startCount += 1;

    if (this.failingStarts > 0) {
      this.failingStarts -= 1;
      throw new Error("start failed");
    }

    this.running = true;
  }

  isRunning(): boolean {
    return this.running;
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
    this.running = false;
  }

  onExit(listener: (exit: FakeExit) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  crash(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    for (const listener of this.listeners) {
      listener({
        code: 1,
        signal: null,
      });
    }
  }
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error("Expected recovery condition was not reached.");
}

function createHarness(
  dependencyOverrides: Partial<DesktopHostDependencies> = {},
) {
  const runtime = new FakeProcess();

  let nextPort = 51_001;
  let tokenIndex = 0;

  const dependencies: Partial<DesktopHostDependencies> = {
    discoverBrowser: async () => ({
      kind: "chromium",
      source: "bundled",
    }),
    allocateLoopbackPort: async () => nextPort++,
    createRuntimeProcess: () => runtime,
    waitForRuntimeReady: async () => undefined,
    sleep: async () => undefined,
    token: () => `token-${++tokenIndex}`,
    ...dependencyOverrides,
  };

  const host = new DesktopHost({
    runtimeDirectory: "/tmp/runtime",
    home: "/tmp/rove",
    browserHeadless: true,
    browser: "chromium",
    restartPolicy: {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 1,
    },
    dependencies,
  });

  return {
    host,
    runtime,
  };
}

describe("DesktopHost recovery", () => {
  it("restarts Runtime using the existing host lifecycle", async () => {
    const { host, runtime } = createHarness();

    const events: DesktopHostEvent[] = [];

    host.onEvent((event) => {
      events.push(event);
    });

    await host.start();

    runtime.crash();

    await eventually(() => runtime.startCount === 2);

    expect(host.getState()).toBe("ready");

    expect(events.map((event) => event.type)).toContain("runtime-recovered");

    await host.stop();
  });

  it("fails closed when Runtime exhausts its restart budget", async () => {
    const { host, runtime } = createHarness();

    await host.start();

    runtime.failingStarts = 3;
    runtime.crash();

    await eventually(() => host.getState() === "failed");

    expect(runtime.startCount).toBe(4);
  });

  it("cancels a queued restart when shutdown begins", async () => {
    let resumeRestart: (() => void) | undefined;

    const restartDelay = new Promise<void>((resolve) => {
      resumeRestart = resolve;
    });

    const { host, runtime } = createHarness({
      sleep: () => restartDelay,
    });

    await host.start();

    runtime.crash();

    await host.stop();

    resumeRestart?.();

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(runtime.startCount).toBe(1);
    expect(runtime.running).toBe(false);
  });

  it("stops the managed Runtime in graceful shutdown", async () => {
    const { host, runtime } = createHarness();

    await host.start();
    await host.stop();

    expect(runtime.stopCount).toBe(1);
    expect(runtime.running).toBe(false);
  });
});
