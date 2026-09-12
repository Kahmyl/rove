import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { chromium } from "playwright";

import { RoveError } from "@rove/protocol";

import { BrowserWorkspaceRegistry } from "./browser-workspace-registry.js";
import { RoveProfileLock } from "./profile-lock.js";
import { startFixtureServer } from "../fixtures/fixture-server.js";

async function home(): Promise<string> {
  return mkdtemp(resolve(tmpdir(), "rove-workspace-experiment-"));
}

async function legacyProfile(
  directory: string,
  name: string,
  browserDistribution: "chrome" | "chromium" = "chrome",
): Promise<string> {
  const profile = resolve(directory, "profiles", name);
  await mkdir(profile, { recursive: true });
  await writeFile(
    resolve(profile, "profile.json"),
    JSON.stringify({
      name,
      createdAt: "2026-09-01T00:00:00.000Z",
      lastUsedAt: "2026-09-06T00:00:00.000Z",
      browserDistribution,
    }),
  );
  return profile;
}

describe("durable browser workspace registry", () => {
  it("persists the selected identity across registry/runtime reconstruction", async () => {
    const directory = await home();
    const firstRuntime = new BrowserWorkspaceRegistry(directory);
    const workspace = await firstRuntime.create({ displayName: "Personal" });

    const restartedRuntime = new BrowserWorkspaceRegistry(directory);
    const resolved = await restartedRuntime.resolveForSession();

    expect(resolved).toMatchObject({
      id: workspace.id,
      displayName: "Personal",
      browser: "chrome",
      userDataDir: workspace.userDataDir,
      storageLayout: "workspace",
    });
    expect(resolved.userDataDir).toContain(workspace.id);
  });

  it("never creates a browser identity while resolving a task request", async () => {
    const directory = await home();
    const registry = new BrowserWorkspaceRegistry(directory);

    await expect(
      registry.resolveForSession("wrk_00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ code: "PROFILE_NOT_FOUND" });

    await expect(
      readdir(resolve(directory, "browser-workspaces")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires the app to create/select the first workspace", async () => {
    const directory = await home();
    const registry = new BrowserWorkspaceRegistry(directory);

    await expect(registry.resolveForSession()).rejects.toMatchObject({
      code: "PROFILE_NOT_FOUND",
    });
  });

  it("switches identities only through explicit selection", async () => {
    const directory = await home();
    const registry = new BrowserWorkspaceRegistry(directory);
    const personal = await registry.create({ displayName: "Personal" });
    const work = await registry.create({ displayName: "Work" });

    expect((await registry.resolveForSession()).id).toBe(personal.id);
    await registry.select(work.id);
    expect((await registry.resolveForSession()).id).toBe(work.id);
  });

  it("renames a workspace without changing its durable identity or data path", async () => {
    const directory = await home();
    const registry = new BrowserWorkspaceRegistry(directory);
    const workspace = await registry.create({ displayName: "Personal" });
    await writeFile(resolve(workspace.userDataDir, "identity.txt"), "kept");

    const renamed = await registry.rename(workspace.id, "Work");

    expect(renamed).toMatchObject({
      id: workspace.id,
      displayName: "Work",
      userDataDir: workspace.userDataDir,
    });
    await expect(
      readFile(resolve(workspace.userDataDir, "identity.txt"), "utf8"),
    ).resolves.toBe("kept");
  });

  it("deletes local profile data and selects a safe remaining default", async () => {
    const directory = await home();
    const registry = new BrowserWorkspaceRegistry(directory);
    const personal = await registry.create({ displayName: "Personal" });
    const work = await registry.create({ displayName: "Work" });
    await registry.select(work.id);
    await writeFile(resolve(work.userDataDir, "identity.txt"), "remove");

    const status = await registry.delete(work.id);

    expect(status.selectedWorkspaceId).toBe(personal.id);
    expect(status.workspaces.map((item) => item.id)).toEqual([personal.id]);
    await expect(readFile(work.userDataDir, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("keeps workspace metadata separate from Chrome's durable data", async () => {
    const directory = await home();
    const registry = new BrowserWorkspaceRegistry(directory);
    const workspace = await registry.create({ displayName: "Google account" });
    const catalog = JSON.parse(
      await readFile(resolve(directory, "browser-workspaces.json"), "utf8"),
    ) as { selectedWorkspaceId: string; workspaces: unknown[] };

    expect(catalog.selectedWorkspaceId).toBe(workspace.id);
    expect(catalog.workspaces).toHaveLength(1);
    expect(workspace.userDataDir.endsWith("chrome-data")).toBe(true);
  });

  it("migrates every valid legacy profile in place and selects legacy default", async () => {
    const directory = await home();
    const defaultDirectory = await legacyProfile(directory, "default");
    const githubDirectory = await legacyProfile(
      directory,
      "github",
      "chromium",
    );
    const registry = new BrowserWorkspaceRegistry(directory);

    const status = await registry.status();
    expect(status.workspaces).toHaveLength(2);
    expect(status.workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: "Default",
          userDataDir: defaultDirectory,
          storageLayout: "legacy_profile",
          browser: "chrome",
        }),
        expect.objectContaining({
          displayName: "github",
          userDataDir: githubDirectory,
          storageLayout: "legacy_profile",
          browser: "chromium",
        }),
      ]),
    );
    expect(
      status.workspaces.find((item) => item.id === status.selectedWorkspaceId),
    ).toMatchObject({ displayName: "Default" });

    const restarted = await new BrowserWorkspaceRegistry(directory).status();
    expect(restarted).toEqual(status);
    await expect(
      readdir(resolve(directory, "browser-workspaces")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects catalog paths outside Rove-owned workspace and legacy roots", async () => {
    const directory = await home();
    await writeFile(
      resolve(directory, "browser-workspaces.json"),
      JSON.stringify({
        schemaVersion: 1,
        selectedWorkspaceId: "wrk_00000000-0000-0000-0000-000000000000",
        workspaces: [
          {
            id: "wrk_00000000-0000-0000-0000-000000000000",
            displayName: "Escaped",
            browser: "chrome",
            userDataDir: resolve(directory, "..", "outside"),
            storageLayout: "legacy_profile",
            createdAt: "2026-09-01T00:00:00.000Z",
            lastUsedAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      }),
    );

    await expect(
      new BrowserWorkspaceRegistry(directory).status(),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
  });

  it("uses the existing profile lease to reject concurrent writers", async () => {
    const directory = await home();
    const registry = new BrowserWorkspaceRegistry(directory);
    const workspace = await registry.create({ displayName: "Personal" });
    const first = await RoveProfileLock.acquire(workspace.userDataDir, {
      runtimeInstanceId: "runtime_first",
      sessionId: "ses_first",
    });

    try {
      await expect(
        RoveProfileLock.acquire(workspace.userDataDir, {
          runtimeInstanceId: "runtime_second",
          sessionId: "ses_second",
        }),
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof RoveError && error.code === "PROFILE_LOCKED",
      );
    } finally {
      await first.release();
    }
  });

  it("preserves cookies and local storage across a real browser restart", async () => {
    const directory = await home();
    const registry = new BrowserWorkspaceRegistry(directory);
    const workspace = await registry.create({ displayName: "Durability" });
    const server = await startFixtureServer();

    try {
      const first = await chromium.launchPersistentContext(
        workspace.userDataDir,
        { headless: true },
      );
      try {
        const page = await first.newPage();
        await page.goto(`${server.url}/actions`);
        await page.evaluate(() => {
          localStorage.setItem("rove-workspace-proof", "survived");
          document.cookie =
            "rove_workspace_cookie=survived; Max-Age=3600; SameSite=Lax";
        });
      } finally {
        await first.close();
      }

      const restartedRegistry = new BrowserWorkspaceRegistry(directory);
      const sameWorkspace = await restartedRegistry.resolveForSession();
      const second = await chromium.launchPersistentContext(
        sameWorkspace.userDataDir,
        { headless: true },
      );
      try {
        const page = await second.newPage();
        await page.goto(`${server.url}/actions`);
        const state = await page.evaluate(() => ({
          local: localStorage.getItem("rove-workspace-proof"),
          cookie: document.cookie,
        }));
        expect(state).toEqual({
          local: "survived",
          cookie: expect.stringContaining("rove_workspace_cookie=survived"),
        });
      } finally {
        await second.close();
      }
    } finally {
      await server.close();
    }
  }, 20_000);
});
