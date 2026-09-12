import { execFile } from "node:child_process";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { terminateProcessTree } from "./process-tree.js";

const execFileAsync = promisify(execFile);
const REGISTRY_FILE = "managed-runtime.json";

interface ManagedRuntimeRecord {
  schemaVersion: 1;
  runtimeInstanceId: string;
  runtimeProcessId: number;
  runtimeProcessIdentity: string;
  ownerProcessId: number;
  ownerProcessIdentity: string;
  runtimeDirectory: string;
  baseUrl: string;
  startedAt: string;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function processValue(
  pid: number,
  field: "lstart" | "command",
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-p", String(pid), "-o", `${field}=`],
      {
        encoding: "utf8",
        timeout: 2_000,
      },
    );
    const value = stdout.trim();
    return value.length === 0 ? undefined : value;
  } catch {
    return undefined;
  }
}

function parseRecord(value: unknown): ManagedRuntimeRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const item = value as Partial<ManagedRuntimeRecord>;
  if (
    item.schemaVersion !== 1 ||
    typeof item.runtimeInstanceId !== "string" ||
    !/^runtime_[a-f0-9]{32}$/.test(item.runtimeInstanceId) ||
    typeof item.runtimeProcessId !== "number" ||
    typeof item.runtimeProcessIdentity !== "string" ||
    typeof item.ownerProcessId !== "number" ||
    typeof item.ownerProcessIdentity !== "string" ||
    typeof item.runtimeDirectory !== "string" ||
    typeof item.baseUrl !== "string" ||
    typeof item.startedAt !== "string"
  )
    return undefined;
  return item as ManagedRuntimeRecord;
}

async function readRecord(
  home: string,
): Promise<ManagedRuntimeRecord | undefined> {
  try {
    const record = parseRecord(
      JSON.parse(await readFile(resolve(home, REGISTRY_FILE), "utf8")),
    );
    if (record === undefined) {
      throw new Error(
        "Rove's managed Runtime record is invalid; refusing unsafe reconciliation.",
      );
    }
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function waitUntilDead(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 50));
  }
  return !alive(pid);
}

async function runtimeHealth(
  baseUrl: string,
): Promise<Record<string, unknown> | undefined> {
  const health = await fetch(`${baseUrl}/health`, {
    signal: AbortSignal.timeout(500),
  })
    .then(async (response) =>
      response.ok ? (response.json() as Promise<unknown>) : undefined,
    )
    .catch(() => undefined);
  if (
    typeof health !== "object" ||
    health === null ||
    !("runtime" in health) ||
    typeof health.runtime !== "object" ||
    health.runtime === null
  )
    return undefined;
  return health.runtime as Record<string, unknown>;
}

async function waitForRuntimeProofOrExit(
  record: ManagedRuntimeRecord,
  timeoutMs: number,
): Promise<"verified" | "exited" | "unproved"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(record.runtimeProcessId)) return "exited";
    const health = await runtimeHealth(record.baseUrl);
    if (
      health?.runtimeInstanceId === record.runtimeInstanceId &&
      health.processId === record.runtimeProcessId
    )
      return "verified";
    if (health !== undefined) return "unproved";
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 50));
  }
  return alive(record.runtimeProcessId) ? "unproved" : "exited";
}

export async function reconcileManagedRuntime(options: {
  home: string;
  runtimeDirectory: string;
}): Promise<void> {
  const path = resolve(options.home, REGISTRY_FILE);
  const record = await readRecord(options.home);
  if (record === undefined) return;

  const ownerIdentity = alive(record.ownerProcessId)
    ? await processValue(record.ownerProcessId, "lstart")
    : undefined;
  if (ownerIdentity === record.ownerProcessIdentity) {
    throw new Error(
      `Another Rove Companion is actively managing Runtime ${record.runtimeInstanceId}.`,
    );
  }

  if (!alive(record.runtimeProcessId)) {
    await unlink(path).catch(() => undefined);
    return;
  }

  const [runtimeIdentity, command] = await Promise.all([
    processValue(record.runtimeProcessId, "lstart"),
    processValue(record.runtimeProcessId, "command"),
  ]);
  const staticallyCorrelated =
    record.runtimeDirectory === options.runtimeDirectory &&
    runtimeIdentity === record.runtimeProcessIdentity &&
    command?.includes(`--rove-runtime-instance=${record.runtimeInstanceId}`) ===
      true;
  if (!staticallyCorrelated) {
    const mayStillBeExiting =
      runtimeIdentity === undefined ||
      runtimeIdentity === record.runtimeProcessIdentity;
    if (
      mayStillBeExiting &&
      (await waitUntilDead(record.runtimeProcessId, 1_000))
    ) {
      await unlink(path).catch(() => undefined);
      return;
    }
    throw new Error(
      "A live process is referenced by Rove's managed Runtime record, but ownership could not be proved. Refusing to terminate it.",
    );
  }

  const proof = await waitForRuntimeProofOrExit(record, 2_000);
  if (proof === "exited") {
    await unlink(path).catch(() => undefined);
    return;
  }
  if (proof !== "verified") {
    throw new Error(
      "A live process is referenced by Rove's managed Runtime record, but ownership could not be proved. Refusing to terminate it.",
    );
  }

  const terminateVerifiedRuntime = async (signal: NodeJS.Signals) => {
    try {
      await terminateProcessTree(record.runtimeProcessId, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      try {
        process.kill(record.runtimeProcessId, signal);
      } catch (directError) {
        if ((directError as NodeJS.ErrnoException).code !== "ESRCH")
          throw directError;
      }
    }
  };
  await terminateVerifiedRuntime("SIGTERM");
  if (!(await waitUntilDead(record.runtimeProcessId, 5_000))) {
    await terminateVerifiedRuntime("SIGKILL");
    if (!(await waitUntilDead(record.runtimeProcessId, 1_000))) {
      throw new Error("The verified orphaned Rove Runtime did not exit.");
    }
  }
  await unlink(path).catch(() => undefined);
}

export async function writeManagedRuntimeRecord(options: {
  home: string;
  runtimeDirectory: string;
  baseUrl: string;
  runtimeInstanceId: string;
  runtimeProcessId: number;
  startedAt: string;
}): Promise<void> {
  const [runtimeProcessIdentity, ownerProcessIdentity] = await Promise.all([
    processValue(options.runtimeProcessId, "lstart"),
    processValue(process.pid, "lstart"),
  ]);
  if (
    runtimeProcessIdentity === undefined ||
    ownerProcessIdentity === undefined
  ) {
    throw new Error("Could not establish managed Runtime process identity.");
  }
  await mkdir(options.home, { recursive: true, mode: 0o700 });
  const path = resolve(options.home, REGISTRY_FILE);
  const temporary = `${path}.${process.pid}.tmp`;
  const record: ManagedRuntimeRecord = {
    schemaVersion: 1,
    runtimeInstanceId: options.runtimeInstanceId,
    runtimeProcessId: options.runtimeProcessId,
    runtimeProcessIdentity,
    ownerProcessId: process.pid,
    ownerProcessIdentity,
    runtimeDirectory: options.runtimeDirectory,
    baseUrl: options.baseUrl,
    startedAt: options.startedAt,
  };
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}

export async function removeManagedRuntimeRecord(
  home: string,
  runtimeInstanceId: string,
): Promise<void> {
  const record = await readRecord(home);
  if (record?.runtimeInstanceId === runtimeInstanceId) {
    await unlink(resolve(home, REGISTRY_FILE)).catch(() => undefined);
  }
}
