import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { open, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { RoveError } from "@rove/protocol";

export interface ProfileLockMetadata {
  pid: number;
  acquiredAt: string;
  nonce: string;
  processIdentity?: string;
  runtimeInstanceId?: string;
  sessionId?: string;
}

export interface ProfileLockOwner {
  runtimeInstanceId: string;
  sessionId: string;
}
export interface ProfileLockFileOperations {
  unlink(path: string): Promise<void>;
}

export type ProfileLockOwnership = "owned" | "claimable" | "conflicting";

const execFileAsync = promisify(execFile);

export class RoveProfileLock {
  private released = false;

  private constructor(
    readonly lockPath: string,
    readonly metadata: ProfileLockMetadata,
    private readonly files: ProfileLockFileOperations,
  ) {}

  static async acquire(
    profileDirectory: string,
    owner?: ProfileLockOwner,
    files: ProfileLockFileOperations = { unlink },
  ): Promise<RoveProfileLock> {
    const lockPath = resolve(profileDirectory, "profile.lock");
    const processIdentity = await readProcessIdentity(process.pid);
    const metadata: ProfileLockMetadata = {
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      nonce: randomUUID(),
      ...(processIdentity === undefined ? {} : { processIdentity }),
      ...(owner === undefined ? {} : owner),
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const file = await open(lockPath, "wx");
        try {
          await file.writeFile(
            `${JSON.stringify(metadata, null, 2)}\n`,
            "utf8",
          );
        } finally {
          await file.close();
        }
        return new RoveProfileLock(lockPath, metadata, files);
      } catch (error) {
        if (!isFileExistsError(error)) throw error;
        if (
          attempt === 0 &&
          (await RoveProfileLock.removeStaleLock(lockPath))
        ) {
          continue;
        }

        const details = await RoveProfileLock.lockDetails(lockPath);
        throw new RoveError({
          code: "PROFILE_LOCKED",
          message:
            "Persistent browser profile is already locked by another Rove process.",
          retryable: true,
          ...(details === undefined
            ? {}
            : {
                details: {
                  state: "active_runtime",
                  ...details,
                },
              }),
        });
      }
    }

    throw new RoveError({
      code: "PROFILE_LOCKED",
      message:
        "Persistent browser profile is already locked by another Rove process.",
      retryable: true,
    });
  }

  static async ownershipStatus(
    profileDirectory: string,
    owner: ProfileLockOwner,
  ): Promise<ProfileLockOwnership> {
    const details = await RoveProfileLock.lockDetails(
      resolve(profileDirectory, "profile.lock"),
    );
    if (details === undefined) return "claimable";
    if (
      details.runtimeInstanceId === owner.runtimeInstanceId &&
      details.sessionId === owner.sessionId
    ) {
      const pid = details.pid;
      const recordedIdentity = details.processIdentity;
      if (typeof pid !== "number" || typeof recordedIdentity !== "string")
        return "conflicting";
      const currentIdentity = await readProcessIdentity(pid);
      if (pid === process.pid && currentIdentity === recordedIdentity)
        return "owned";
      return currentIdentity === undefined ||
        currentIdentity !== recordedIdentity
        ? "claimable"
        : "conflicting";
    }
    const pid = details.pid;
    if (typeof pid !== "number" || pid <= 0) return "conflicting";
    if (!processIsAlive(pid)) return "claimable";
    const recordedIdentity = details.processIdentity;
    if (typeof recordedIdentity !== "string") return "conflicting";
    const currentIdentity = await readProcessIdentity(pid);
    return currentIdentity !== undefined && currentIdentity !== recordedIdentity
      ? "claimable"
      : "conflicting";
  }

  static async releaseClaimable(
    profileDirectory: string,
    owner: ProfileLockOwner,
  ): Promise<boolean> {
    if (
      (await RoveProfileLock.ownershipStatus(profileDirectory, owner)) !==
      "claimable"
    )
      return false;
    return RoveProfileLock.removeStaleLock(
      resolve(profileDirectory, "profile.lock"),
    );
  }

  async release(): Promise<void> {
    if (this.released) return;
    const current = await RoveProfileLock.lockDetails(this.lockPath);
    if (current?.nonce !== this.metadata.nonce) {
      this.released = true;
      return;
    }
    await this.files.unlink(this.lockPath).catch((error: unknown) => {
      if (!isNotFoundError(error)) throw error;
    });
    this.released = true;
  }

  private static async removeStaleLock(lockPath: string): Promise<boolean> {
    const details = await RoveProfileLock.lockDetails(lockPath);
    const pid = details?.pid;
    if (typeof pid !== "number" || pid <= 0) return false;

    if (processIsAlive(pid)) {
      const recordedIdentity = details?.processIdentity;
      if (typeof recordedIdentity !== "string") return false;
      const currentIdentity = await readProcessIdentity(pid);
      if (
        currentIdentity === undefined ||
        currentIdentity === recordedIdentity
      ) {
        return false;
      }
    }

    await unlink(lockPath).catch((error: unknown) => {
      if (!isNotFoundError(error)) throw error;
    });
    return true;
  }

  private static async lockDetails(
    lockPath: string,
  ): Promise<Record<string, unknown> | undefined> {
    try {
      return JSON.parse(await readFile(lockPath, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      return undefined;
    }
  }
}

async function readProcessIdentity(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-p", String(pid), "-o", "lstart="],
      { encoding: "utf8", timeout: 2_000 },
    );
    const value = stdout.trim();
    return value.length === 0 ? undefined : value;
  } catch {
    return undefined;
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
