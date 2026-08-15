import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RoveProfileLock } from "./profile-lock.js";

const directories: string[] = [];

async function profileDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rove-profile-lock-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  while (directories.length > 0) {
    await rm(directories.pop()!, {
      recursive: true,
      force: true,
    });
  }
});

describe("RoveProfileLock", () => {
  it("creates and releases a profile lock", async () => {
    const directory = await profileDirectory();
    const lock = await RoveProfileLock.acquire(directory);

    const metadata = JSON.parse(await readFile(lock.lockPath, "utf8"));
    expect(metadata).toMatchObject({
      pid: process.pid,
    });
    expect(metadata.acquiredAt).toEqual(expect.any(String));

    await lock.release();

    await expect(readFile(lock.lockPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects concurrent locks for the same profile", async () => {
    const directory = await profileDirectory();
    const lock = await RoveProfileLock.acquire(directory);

    try {
      await expect(RoveProfileLock.acquire(directory)).rejects.toMatchObject({
        code: "PROFILE_LOCKED",
      });
    } finally {
      await lock.release();
    }
  });

  it("recovers a stale lock when the owner process is gone", async () => {
    const directory = await profileDirectory();
    await mkdir(directory, { recursive: true });
    const lockPath = join(directory, "profile.lock");
    await writeFile(
      lockPath,
      `${JSON.stringify({ pid: 9_999_999, acquiredAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );

    const lock = await RoveProfileLock.acquire(directory);
    try {
      expect(lock.lockPath).toBe(lockPath);
    } finally {
      await lock.release();
    }
  });

  it("allows release to be called more than once", async () => {
    const lock = await RoveProfileLock.acquire(await profileDirectory());

    await expect(lock.release()).resolves.toBeUndefined();
    await expect(lock.release()).resolves.toBeUndefined();
  });
});
