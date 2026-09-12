import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { describe, expect, it } from "vitest";

import {
  buildRuntimeProcessEnvironment,
  RuntimeProcess,
} from "./runtime-process.js";

function processAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function loopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose())),
  );
  return port;
}

describe("buildRuntimeProcessEnvironment", () => {
  it("passes the resolved native browser to Runtime", () => {
    const environment = buildRuntimeProcessEnvironment(
      {
        runtimeDirectory: "/tmp/runtime",
        home: "/tmp/rove",
        host: "127.0.0.1",
        port: 51001,
        token: "runtime-secret",
        browserHeadless: false,
        browser: "chrome",
        browserExecutablePath:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      },
      {
        HOME: "/tmp/home",
      },
    );

    expect(environment).toMatchObject({
      HOME: "/tmp/home",
      ROVE_RUNTIME_HOST: "127.0.0.1",
      ROVE_RUNTIME_PORT: "51001",
      ROVE_BROWSER: "chrome",
      ROVE_BROWSER_EXECUTABLE_PATH:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
    expect(environment.ROVE_RUNTIME_OWNER_PROCESS_ID).toBeUndefined();
  });

  it("omits an executable path for bundled Chromium", () => {
    const environment = buildRuntimeProcessEnvironment(
      {
        runtimeDirectory: "/tmp/runtime",
        home: "/tmp/rove",
        host: "127.0.0.1",
        port: 51001,
        token: "runtime-secret",
        browserHeadless: false,
        browser: "chromium",
      },
      {},
    );

    expect(environment.ROVE_BROWSER).toBe("chromium");

    expect(environment.ROVE_BROWSER_EXECUTABLE_PATH).toBeUndefined();
  });

  it("configures Electron's Node mode and packaged Playwright browsers", () => {
    const environment = buildRuntimeProcessEnvironment(
      {
        runtimeDirectory: "/resources/services/runtime",
        home: "/tmp/rove",
        host: "127.0.0.1",
        port: 51_001,
        token: "runtime-secret",
        browserHeadless: false,
        browser: "chromium",
        playwrightBrowsersPath: "/resources/browsers",
        electronRunAsNode: true,
      },
      {},
    );

    expect(environment).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      PLAYWRIGHT_BROWSERS_PATH: "/resources/browsers",
    });
  });

  it("passes the Desktop owner identity to a managed Runtime at spawn", () => {
    const environment = buildRuntimeProcessEnvironment(
      {
        runtimeDirectory: "/tmp/runtime",
        home: "/tmp/rove",
        host: "127.0.0.1",
        port: 51_001,
        token: "runtime-secret",
        browserHeadless: false,
        browser: "chromium",
        runtimeInstanceId: `runtime_${"a".repeat(32)}`,
      },
      {},
    );
    expect(environment.ROVE_RUNTIME_OWNER_PROCESS_ID).toBe(String(process.pid));
  });
});

describe("RuntimeProcess recovery signals", () => {
  it("reports a spawn failure instead of emitting an unhandled error", async () => {
    const runtime = new RuntimeProcess({
      runtimeDirectory: "/tmp",
      home: "/tmp/rove",
      host: "127.0.0.1",
      port: 51_001,
      token: "runtime-secret",
      browserHeadless: true,
      browser: "chromium",
      nodeExecutable: "/tmp/rove-node-does-not-exist",
    });

    const exit = new Promise<
      Parameters<Parameters<typeof runtime.onExit>[0]>[0]
    >((resolve) => runtime.onExit(resolve));

    runtime.start();

    await expect(exit).resolves.toMatchObject({
      code: null,
      signal: null,
      error: expect.stringContaining("ENOENT"),
    });

    expect(runtime.isRunning()).toBe(false);
  });

  it("lets the real managed Runtime terminate after its Desktop owner exits during startup", async () => {
    const root = resolve(import.meta.dirname, "../../../../../");
    const home = await mkdtemp(join(tmpdir(), "rove-runtime-owner-loss-"));
    const fixture = join(
      import.meta.dirname,
      "fixtures/runtime-owner-launch.ts",
    );
    const tsxLoader = createRequire(
      join(root, "apps/companion/package.json"),
    ).resolve("tsx");
    const runtimeDirectory = join(root, "apps/runtime");
    const port = await loopbackPort();
    let ownerProcessId: number | undefined;
    let runtimeProcessId: number | undefined;
    const owner = spawn(
      process.execPath,
      ["--import", tsxLoader, fixture, runtimeDirectory, home, String(port)],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    try {
      const stderr: string[] = [];
      owner.stderr.on("data", (chunk) => stderr.push(String(chunk)));
      const handshake = await new Promise<{
        ownerProcessId: number;
        runtimeProcessId: number;
        runtimeInstanceId: string;
        startupStage: string;
      }>((resolveHandshake, rejectHandshake) => {
        const deadline = setTimeout(
          () => rejectHandshake(new Error("Runtime owner fixture timed out.")),
          10_000,
        );
        createInterface({ input: owner.stdout }).on("line", (line) => {
          const match = /^ROVE_OWNER_FIXTURE:(.+)$/.exec(line);
          if (!match) return;
          try {
            const value = JSON.parse(match[1]!) as Record<string, unknown>;
            if (
              value.schemaVersion !== 1 ||
              !Number.isSafeInteger(value.ownerProcessId) ||
              Number(value.ownerProcessId) <= 1 ||
              !Number.isSafeInteger(value.runtimeProcessId) ||
              Number(value.runtimeProcessId) <= 1 ||
              value.runtimeInstanceId !== `runtime_${"c".repeat(32)}` ||
              value.startupStage !== "runtime_spawned_pre_ready"
            )
              throw new Error("Runtime owner fixture handshake is invalid.");
            clearTimeout(deadline);
            resolveHandshake({
              ownerProcessId: Number(value.ownerProcessId),
              runtimeProcessId: Number(value.runtimeProcessId),
              runtimeInstanceId: value.runtimeInstanceId,
              startupStage: value.startupStage,
            });
          } catch (error) {
            clearTimeout(deadline);
            rejectHandshake(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        });
        owner.once("error", rejectHandshake);
        owner.once("exit", (code) => {
          if (runtimeProcessId === undefined && code !== 0) {
            clearTimeout(deadline);
            rejectHandshake(
              new Error(
                `Runtime owner fixture exited with ${code}: ${stderr.join("")}`,
              ),
            );
          }
        });
      });
      ownerProcessId = handshake.ownerProcessId;
      runtimeProcessId = handshake.runtimeProcessId;
      expect(handshake).toMatchObject({
        ownerProcessId: owner.pid,
        runtimeInstanceId: `runtime_${"c".repeat(32)}`,
        startupStage: "runtime_spawned_pre_ready",
      });
      expect(processAlive(ownerProcessId)).toBe(true);
      expect(processAlive(runtimeProcessId)).toBe(true);
      process.kill(ownerProcessId, "SIGKILL");
      const ownerDeadline = Date.now() + 10_000;
      while (processAlive(ownerProcessId) && Date.now() < ownerDeadline)
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      expect(processAlive(ownerProcessId)).toBe(false);
      const deadline = Date.now() + 20_000;
      while (processAlive(runtimeProcessId) && Date.now() < deadline)
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      expect(processAlive(runtimeProcessId)).toBe(false);
    } finally {
      if (ownerProcessId !== undefined && processAlive(ownerProcessId))
        process.kill(ownerProcessId, "SIGKILL");
      if (runtimeProcessId !== undefined && processAlive(runtimeProcessId))
        process.kill(runtimeProcessId, "SIGKILL");
      if (
        owner.pid !== undefined &&
        owner.exitCode === null &&
        owner.signalCode === null
      )
        owner.kill("SIGKILL");
      await rm(home, { recursive: true, force: true });
    }
  }, 35_000);
});
