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

  it("retains retry eligibility after a transient unlink failure", async () => {
    const directory = await profileDirectory();
    let attempts = 0;
    const lock = await RoveProfileLock.acquire(directory, undefined, {
      unlink: async (path) => {
        attempts += 1;
        if (attempts === 1) throw new Error("injected unlink failure");
        await rm(path);
      },
    });

    await expect(lock.release()).rejects.toThrow(/injected unlink failure/);
    await expect(readFile(lock.lockPath, "utf8")).resolves.toContain(
      lock.metadata.nonce,
    );
    await expect(lock.release()).resolves.toBeUndefined();
    await expect(readFile(lock.lockPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(attempts).toBe(2);
  });

  it("treats an exact logical owner from a dead predecessor process as claimable", async () => {
    const directory = await profileDirectory();
    await writeFile(
      join(directory, "profile.lock"),
      `${JSON.stringify({
        schemaVersion: 1,
        nonce: "lock_dead_predecessor",
        runtimeInstanceId: "runtime_same_logical_instance",
        sessionId: "ses_recoverable",
        pid: 9_999_999,
        processIdentity: "dead predecessor",
        acquiredAt: "2026-09-08T00:00:00.000Z",
      })}\n`,
    );

    await expect(
      RoveProfileLock.ownershipStatus(directory, {
        runtimeInstanceId: "runtime_same_logical_instance",
        sessionId: "ses_recoverable",
      }),
    ).resolves.toBe("claimable");

    await expect(
      RoveProfileLock.releaseClaimable(directory, {
        runtimeInstanceId: "runtime_same_logical_instance",
        sessionId: "ses_recoverable",
      }),
    ).resolves.toBe(true);
    await expect(
      readFile(join(directory, "profile.lock"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
