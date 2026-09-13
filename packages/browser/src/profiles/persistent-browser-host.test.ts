import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { browserHostIdentitySchema } from "@rove/protocol";

import type { ExternalChromeRuntime } from "../runtime/external-chrome-runtime.js";
import {
  acquirePersistentBrowserHost,
  type PersistentBrowserHostDependencies,
} from "./persistent-browser-host.js";

const directories: string[] = [];

async function profileDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rove-browser-host-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  while (directories.length > 0) {
    await rm(directories.pop()!, { recursive: true, force: true });
  }
});

function fakeRuntime(
  userDataDir: string,
  processId: number,
  alive: () => boolean,
): ExternalChromeRuntime {
  return {
    endpoint: "http://127.0.0.1:43123",
    port: 43123,
    processId,
    currentProcessId: () => (alive() ? processId : undefined),
    userDataDir,
    temporaryProfile: false,
    close: vi.fn(async () => undefined),
    closeGracefully: vi.fn(async () => undefined),
  };
}

function dependencies(
  alive: Set<number>,
  commands: Map<number, string>,
): PersistentBrowserHostDependencies {
  return {
    processAlive: (pid) => alive.has(pid),
    processIdentity: async (pid) => `identity:${pid}`,
    processCommand: async (pid) => commands.get(pid),
    endpointWebSocket: async () =>
      "ws://127.0.0.1:43123/devtools/browser/rove-test",
  };
}

describe("persistent browser host workspace", () => {
  it("keeps host lease identifiers out of the task session identity field", async () => {
    const userDataDir = await profileDirectory();
    const alive = new Set([200, 100]);
    const commands = new Map<number, string>();
    const host = await acquirePersistentBrowserHost({
      profileName: "default",
      userDataDir,
      runtimeInstanceId: "runtime_first",
      runtimeProcessId: 100,
      sessionId: "browser_host_managed",
      dependencies: dependencies(alive, commands),
      launch: async (args) => {
        commands.set(
          200,
          `chrome --remote-debugging-port=43123 --user-data-dir=${userDataDir} ${args.join(" ")}`,
        );
        return fakeRuntime(userDataDir, 200, () => true);
      },
    });

    expect(host.identity.sessionId).toBeUndefined();
    expect(browserHostIdentitySchema.parse(host.identity)).toEqual(
      host.identity,
    );
    alive.delete(200);
    await host.release();
  });

  it("retains live-host metadata until shutdown is positively verified", async () => {
    const userDataDir = await profileDirectory();
    const alive = new Set([200, 100]);
    const commands = new Map<number, string>();
    const host = await acquirePersistentBrowserHost({
      profileName: "default",
      userDataDir,
      runtimeInstanceId: "runtime_first",
      runtimeProcessId: 100,
      sessionId: "browser_host_managed",
      dependencies: dependencies(alive, commands),
      launch: async (args) => {
        commands.set(
          200,
          `chrome --remote-debugging-port=43123 --user-data-dir=${userDataDir} ${args.join(" ")}`,
        );
        return fakeRuntime(userDataDir, 200, () => alive.has(200));
      },
    });
    const metadataPath = join(userDataDir, "rove-browser-host.json");

    await expect(host.release()).rejects.toMatchObject({
      code: "PROFILE_LOCKED",
      retryable: true,
      details: { state: "shutdown_incomplete", processId: 200 },
    });
    await expect(readFile(metadataPath, "utf8")).resolves.toContain(
      host.identity.browserHostId,
    );

    alive.delete(200);
    await expect(host.release()).resolves.toBeUndefined();
    await expect(readFile(metadataPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("records a strong owned-host tuple for the full browser lifetime", async () => {
    const userDataDir = await profileDirectory();
    const alive = new Set([200, 100]);
    const commands = new Map<number, string>();
    let browserAlive = true;

    const host = await acquirePersistentBrowserHost({
      profileName: "default",
      userDataDir,
      runtimeInstanceId: "runtime_first",
      runtimeProcessId: 100,
      sessionId: "ses_first",
      dependencies: dependencies(alive, commands),
      launch: async (args) => {
        commands.set(
          200,
          `chrome --remote-debugging-port=43123 --user-data-dir=${userDataDir} ${args.join(" ")}`,
        );
        return fakeRuntime(userDataDir, 200, () => browserAlive);
      },
    });

    expect(host.reused).toBe(false);
    expect(host.identity).toMatchObject({
      processId: 200,
      browserHostId: expect.stringMatching(/^host_/),
      runtimeInstanceId: "runtime_first",
      sessionId: "ses_first",
      ownershipGeneration: 1,
      profileName: "default",
    });
    expect(
      JSON.parse(
        await readFile(join(userDataDir, "rove-browser-host.json"), "utf8"),
      ),
    ).toMatchObject({ processId: 200, runtimeProcessId: 100 });

    browserAlive = false;
    alive.delete(200);
    await host.release();
    await expect(
      readFile(join(userDataDir, "rove-browser-host.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reattaches a verified live host after its Runtime dies with fresh authority", async () => {
    const userDataDir = await profileDirectory();
    const alive = new Set([100, 200]);
    const commands = new Map<number, string>();
    const deps = dependencies(alive, commands);
    const first = await acquirePersistentBrowserHost({
      profileName: "default",
      userDataDir,
      runtimeInstanceId: "runtime_first",
      runtimeProcessId: 100,
      sessionId: "ses_first",
      dependencies: deps,
      launch: async (args) => {
        commands.set(
          200,
          `chrome --remote-debugging-port=43123 --user-data-dir=${userDataDir} ${args.join(" ")}`,
        );
        return fakeRuntime(userDataDir, 200, () => alive.has(200));
      },
    });

    alive.delete(100);
    alive.add(300);
    const adopted = await acquirePersistentBrowserHost({
      profileName: "default",
      userDataDir,
      runtimeInstanceId: "runtime_second",
      runtimeProcessId: 300,
      sessionId: "ses_second",
      dependencies: deps,
      launch: async () => {
        throw new Error("must not launch a second writable browser");
      },
    });

    expect(adopted.reused).toBe(true);
    expect(adopted.identity).toMatchObject({
      browserHostId: first.identity.browserHostId,
      processId: 200,
      runtimeInstanceId: "runtime_second",
      sessionId: "ses_second",
      ownershipGeneration: 2,
      reused: true,
    });
  });

  it("returns a precise busy state for a verified host leased to a live Runtime", async () => {
    const userDataDir = await profileDirectory();
    const alive = new Set([100, 200, 300]);
    const commands = new Map<number, string>();
    const deps = dependencies(alive, commands);
    await acquirePersistentBrowserHost({
      profileName: "default",
      userDataDir,
      runtimeInstanceId: "runtime_first",
      runtimeProcessId: 100,
      sessionId: "ses_first",
      dependencies: deps,
      launch: async (args) => {
        commands.set(
          200,
          `chrome --remote-debugging-port=43123 --user-data-dir=${userDataDir} ${args.join(" ")}`,
        );
        return fakeRuntime(userDataDir, 200, () => true);
      },
    });

    await expect(
      acquirePersistentBrowserHost({
        profileName: "default",
        userDataDir,
        runtimeInstanceId: "runtime_second",
        runtimeProcessId: 300,
        sessionId: "ses_second",
        dependencies: deps,
        launch: async () => fakeRuntime(userDataDir, 400, () => true),
      }),
    ).rejects.toMatchObject({
      code: "PROFILE_LOCKED",
      details: {
        state: "active_session",
        sessionId: "ses_first",
        runtimeInstanceId: "runtime_first",
      },
    });
  });

  it("fails closed rather than attaching when ownership proof is incomplete", async () => {
    const userDataDir = await profileDirectory();
    await writeFile(
      join(userDataDir, "rove-browser-host.json"),
      `${JSON.stringify({ schemaVersion: 1, processId: 200 })}\n`,
      "utf8",
    );

    await expect(
      acquirePersistentBrowserHost({
        profileName: "default",
        userDataDir,
        runtimeInstanceId: "runtime_current",
        runtimeProcessId: 300,
        sessionId: "ses_current",
        dependencies: dependencies(new Set([200, 300]), new Map()),
        launch: async () => fakeRuntime(userDataDir, 400, () => true),
      }),
    ).rejects.toMatchObject({
      code: "PROFILE_LOCKED",
      details: { state: "ownership_unproven" },
    });
  });
});
