import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RoveProfileManager } from "./profile-manager.js";

const homes: string[] = [];

async function home(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rove-profile-manager-"));
  homes.push(directory);
  return directory;
}

afterEach(async () => {
  while (homes.length > 0) {
    await rm(homes.pop()!, {
      recursive: true,
      force: true,
    });
  }
});

describe("RoveProfileManager", () => {
  it("creates Rove-managed persistent profile metadata", async () => {
    const roveHome = await home();
    const manager = new RoveProfileManager(roveHome);

    const resolved = await manager.resolvePersistentProfile(
      {
        mode: "persistent",
        name: "job-search",
      },
      "chromium",
    );

    expect(resolved).toMatchObject({
      name: "job-search",
      userDataDir: join(roveHome, "profiles", "job-search"),
      metadataPath: join(roveHome, "profiles", "job-search", "profile.json"),
      metadata: {
        name: "job-search",
        browserDistribution: "chromium",
      },
    });

    const metadata = JSON.parse(await readFile(resolved!.metadataPath, "utf8"));
    expect(metadata).toMatchObject({
      name: "job-search",
      browserDistribution: "chromium",
    });
    expect(metadata.createdAt).toEqual(expect.any(String));
    expect(metadata.lastUsedAt).toEqual(expect.any(String));
  });

  it("preserves createdAt and updates lastUsedAt on reuse", async () => {
    const roveHome = await home();
    const manager = new RoveProfileManager(roveHome);

    const first = await manager.resolvePersistentProfile(
      {
        mode: "persistent",
        name: "default",
      },
      "chromium",
    );
    const second = await manager.resolvePersistentProfile(
      {
        mode: "persistent",
        name: "default",
      },
      "chrome",
    );

    expect(second!.metadata.createdAt).toBe(first!.metadata.createdAt);
    expect(second!.metadata.lastUsedAt >= first!.metadata.lastUsedAt).toBe(true);
    expect(second!.metadata.browserDistribution).toBe("chrome");
  });

  it("does not resolve temporary profiles", async () => {
    await expect(
      new RoveProfileManager(await home()).resolvePersistentProfile(
        { mode: "temporary" },
        "chromium",
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects path traversal profile names", async () => {
    await expect(
      new RoveProfileManager(await home()).resolvePersistentProfile(
        {
          mode: "persistent",
          name: "../escape",
        },
        "chromium",
      ),
    ).rejects.toMatchObject({
      code: "INVALID_CONFIGURATION",
    });
  });
});
