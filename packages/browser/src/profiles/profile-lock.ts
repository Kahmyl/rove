import { open, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

import { RoveError } from "@rove/protocol";

export interface ProfileLockMetadata {
  pid: number;
  acquiredAt: string;
}

export class RoveProfileLock {
  private released = false;

  private constructor(
    readonly lockPath: string,
    readonly metadata: ProfileLockMetadata,
  ) {}

  static async acquire(profileDirectory: string): Promise<RoveProfileLock> {
    const lockPath = resolve(profileDirectory, "profile.lock");
    const metadata: ProfileLockMetadata = {
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const file = await open(lockPath, "wx");
        try {
          await file.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, "utf8");
        } finally {
          await file.close();
        }
        return new RoveProfileLock(lockPath, metadata);
      } catch (error) {
        if (!isFileExistsError(error)) throw error;
        if (attempt === 0 && (await RoveProfileLock.removeStaleLock(lockPath))) {
          continue;
        }

        const details = await RoveProfileLock.lockDetails(lockPath);
        throw new RoveError({
          code: "PROFILE_LOCKED",
          message: "Persistent browser profile is already locked by another Rove process.",
          retryable: true,
          ...(details === undefined ? {} : { details }),
        });
      }
    }

    throw new RoveError({
      code: "PROFILE_LOCKED",
      message: "Persistent browser profile is already locked by another Rove process.",
      retryable: true,
    });
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    await unlink(this.lockPath).catch((error: unknown) => {
      if (!isNotFoundError(error)) throw error;
    });
  }

  private static async removeStaleLock(lockPath: string): Promise<boolean> {
    const details = await RoveProfileLock.lockDetails(lockPath);
    const pid = details?.pid;
    if (typeof pid !== "number" || pid <= 0 || processIsAlive(pid)) return false;

    await unlink(lockPath).catch((error: unknown) => {
      if (!isNotFoundError(error)) throw error;
    });
    return true;
  }

  private static async lockDetails(
    lockPath: string,
  ): Promise<Record<string, unknown> | undefined> {
    try {
      return JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    ) {
      return false;
    }
    return true;
  }
}

function isFileExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
