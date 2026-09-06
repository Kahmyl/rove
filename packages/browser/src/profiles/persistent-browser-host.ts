import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { RoveError, type BrowserHostIdentity } from "@rove/protocol";

import {
  attachExternalChrome,
  type ExternalChromeRuntime,
} from "../runtime/external-chrome-runtime.js";

const execFileAsync = promisify(execFile);
const HOST_FILE = "rove-browser-host.json";
const CLAIM_FILE = "rove-browser-host.claim";

export interface PersistentBrowserHostMetadata {
  schemaVersion: 1;
  browserHostId: string;
  nonce: string;
  processId: number;
  processIdentity: string;
  endpoint: string;
  port: number;
  profileName: string;
  userDataDir: string;
  runtimeInstanceId: string;
  runtimeProcessId: number;
  sessionId: string;
  ownershipGeneration: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersistentBrowserHostDependencies {
  processAlive(pid: number): boolean;
  processIdentity(pid: number): Promise<string | undefined>;
  processCommand(pid: number): Promise<string | undefined>;
  endpointWebSocket(endpoint: string): Promise<string | undefined>;
}

export interface PersistentBrowserHostOptions {
  profileName: string;
  userDataDir: string;
  runtimeInstanceId: string;
  runtimeProcessId: number;
  sessionId: string;
  launch(
    ownershipArguments: string[],
  ): Promise<ExternalChromeRuntime>;
  dependencies?: Partial<PersistentBrowserHostDependencies>;
}

export interface PersistentBrowserHost {
  runtime: ExternalChromeRuntime;
  identity: BrowserHostIdentity;
  reused: boolean;
  release(): Promise<void>;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    );
  }
}

async function psValue(
  pid: number,
  field: "lstart" | "command",
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-p", String(pid), "-o", `${field}=`],
      { encoding: "utf8", timeout: 2_000 },
    );
    const value = stdout.trim();
    return value.length === 0 ? undefined : value;
  } catch {
    return undefined;
  }
}

async function endpointWebSocket(
  endpoint: string,
): Promise<string | undefined> {
  try {
    const response = await fetch(`${endpoint}/json/version`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as {
      webSocketDebuggerUrl?: unknown;
    };
    return typeof payload.webSocketDebuggerUrl === "string"
      ? payload.webSocketDebuggerUrl
      : undefined;
  } catch {
    return undefined;
  }
}

const defaults: PersistentBrowserHostDependencies = {
  processAlive,
  processIdentity: (pid) => psValue(pid, "lstart"),
  processCommand: (pid) => psValue(pid, "command"),
  endpointWebSocket,
};

function parsedMetadata(value: string): PersistentBrowserHostMetadata | undefined {
  try {
    const item = JSON.parse(value) as Partial<PersistentBrowserHostMetadata>;
    if (
      item.schemaVersion !== 1 ||
      typeof item.browserHostId !== "string" ||
      !item.browserHostId.startsWith("host_") ||
      typeof item.nonce !== "string" ||
      item.nonce.length < 32 ||
      typeof item.processId !== "number" ||
      typeof item.processIdentity !== "string" ||
      typeof item.endpoint !== "string" ||
      typeof item.port !== "number" ||
      typeof item.profileName !== "string" ||
      typeof item.userDataDir !== "string" ||
      typeof item.runtimeInstanceId !== "string" ||
      typeof item.runtimeProcessId !== "number" ||
      typeof item.sessionId !== "string" ||
      typeof item.ownershipGeneration !== "number" ||
      typeof item.createdAt !== "string" ||
      typeof item.updatedAt !== "string"
    ) {
      return undefined;
    }
    return item as PersistentBrowserHostMetadata;
  } catch {
    return undefined;
  }
}

async function readMetadata(
  path: string,
): Promise<PersistentBrowserHostMetadata | undefined | null> {
  try {
    return parsedMetadata(await readFile(path, "utf8")) ?? null;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

async function writeMetadata(
  path: string,
  metadata: PersistentBrowserHostMetadata,
): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
}

async function acquireClaim(path: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const file = await open(path, "wx", 0o600);
      await file.writeFile(
        `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
        "utf8",
      );
      await file.close();
      return async () => {
        await unlink(path).catch(() => undefined);
      };
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        (error as NodeJS.ErrnoException).code !== "EEXIST"
      ) {
        throw error;
      }
      let claimant: { pid?: unknown } | undefined;
      try {
        claimant = JSON.parse(await readFile(path, "utf8")) as {
          pid?: unknown;
        };
      } catch {
        claimant = undefined;
      }
      if (
        attempt === 0 &&
        typeof claimant?.pid === "number" &&
        !processAlive(claimant.pid)
      ) {
        await unlink(path).catch(() => undefined);
        continue;
      }
      throw new RoveError({
        code: "PROFILE_LOCKED",
        message: "The persistent browser workspace is being reconciled by another Rove Runtime.",
        retryable: true,
        details: { state: "reconciliation_in_progress" },
      });
    }
  }
  throw new RoveError({
    code: "PROFILE_LOCKED",
    message: "The persistent browser workspace could not be claimed.",
    retryable: true,
  });
}

async function verifiedLiveHost(
  metadata: PersistentBrowserHostMetadata,
  expected: Pick<PersistentBrowserHostOptions, "profileName" | "userDataDir">,
  dependencies: PersistentBrowserHostDependencies,
): Promise<boolean> {
  if (!dependencies.processAlive(metadata.processId)) return false;
  if (
    metadata.profileName !== expected.profileName ||
    metadata.userDataDir !== expected.userDataDir
  ) {
    return false;
  }
  const [identity, command, webSocket] = await Promise.all([
    dependencies.processIdentity(metadata.processId),
    dependencies.processCommand(metadata.processId),
    dependencies.endpointWebSocket(metadata.endpoint),
  ]);
  let verifiedWebSocket = false;
  if (webSocket !== undefined) {
    try {
      const parsed = new URL(webSocket);
      verifiedWebSocket =
        parsed.protocol === "ws:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) &&
        Number(parsed.port) === metadata.port &&
        parsed.pathname.startsWith("/devtools/browser/");
    } catch {
      verifiedWebSocket = false;
    }
  }
  return (
    identity === metadata.processIdentity &&
    command !== undefined &&
    command.includes(`--rove-browser-host-id=${metadata.browserHostId}`) &&
    command.includes(`--rove-browser-host-nonce=${metadata.nonce}`) &&
    command.includes(`--remote-debugging-port=${metadata.port}`) &&
    command.includes(`--user-data-dir=${metadata.userDataDir}`) &&
    verifiedWebSocket
  );
}

function identity(
  metadata: PersistentBrowserHostMetadata,
  reused: boolean,
): BrowserHostIdentity {
  return {
    kind: "owned_process",
    processId: metadata.processId,
    browserHostId: metadata.browserHostId,
    runtimeInstanceId: metadata.runtimeInstanceId,
    sessionId: metadata.sessionId,
    ownershipGeneration: metadata.ownershipGeneration,
    profileName: metadata.profileName,
    reused,
  };
}

export async function acquirePersistentBrowserHost(
  options: PersistentBrowserHostOptions,
): Promise<PersistentBrowserHost> {
  const dependencies = { ...defaults, ...options.dependencies };
  const metadataPath = resolve(options.userDataDir, HOST_FILE);
  const releaseClaim = await acquireClaim(
    resolve(options.userDataDir, CLAIM_FILE),
  );

  try {
    const existing = await readMetadata(metadataPath);
    if (existing === null) {
      throw new RoveError({
        code: "PROFILE_LOCKED",
        message: "Rove browser-host ownership metadata is invalid; ownership cannot be proved.",
        retryable: false,
        details: { state: "ownership_unproven" },
      });
    }

    if (existing !== undefined && dependencies.processAlive(existing.processId)) {
      if (!(await verifiedLiveHost(existing, options, dependencies))) {
        throw new RoveError({
          code: "PROFILE_LOCKED",
          message: "A live browser process exists for this profile, but Rove ownership cannot be proved.",
          retryable: false,
          details: { state: "ownership_unproven" },
        });
      }

      const sameOwner =
        existing.runtimeInstanceId === options.runtimeInstanceId &&
        existing.sessionId === options.sessionId;
      if (
        !sameOwner &&
        dependencies.processAlive(existing.runtimeProcessId)
      ) {
        throw new RoveError({
          code: "PROFILE_LOCKED",
          message: "The persistent browser workspace is in use by an active Rove session.",
          retryable: true,
          details: {
            state: "active_session",
            browserHostId: existing.browserHostId,
            sessionId: existing.sessionId,
            runtimeInstanceId: existing.runtimeInstanceId,
          },
        });
      }

      const adopted: PersistentBrowserHostMetadata = {
        ...existing,
        runtimeInstanceId: options.runtimeInstanceId,
        runtimeProcessId: options.runtimeProcessId,
        sessionId: options.sessionId,
        ownershipGeneration: existing.ownershipGeneration + 1,
        updatedAt: new Date().toISOString(),
      };
      await writeMetadata(metadataPath, adopted);
      const runtime = attachExternalChrome({
        endpoint: adopted.endpoint,
        port: adopted.port,
        processId: adopted.processId,
        userDataDir: adopted.userDataDir,
      });
      return hostResult(runtime, adopted, metadataPath, true);
    }

    if (existing !== undefined) {
      await unlink(metadataPath).catch(() => undefined);
    }

    const browserHostId = `host_${randomUUID().replaceAll("-", "")}`;
    const nonce = randomBytes(32).toString("hex");
    const runtime = await options.launch([
      `--rove-browser-host-id=${browserHostId}`,
      `--rove-browser-host-nonce=${nonce}`,
    ]);
    const processId = runtime.currentProcessId();
    if (processId === undefined) {
      await runtime.close();
      throw new RoveError({
        code: "BROWSER_LAUNCH_FAILED",
        message: "The launched browser host did not expose a live process identity.",
      });
    }
    const processIdentity = await dependencies.processIdentity(processId);
    if (processIdentity === undefined) {
      await runtime.close();
      throw new RoveError({
        code: "BROWSER_LAUNCH_FAILED",
        message: "Rove could not establish the browser process start identity.",
      });
    }
    const now = new Date().toISOString();
    const launched: PersistentBrowserHostMetadata = {
      schemaVersion: 1,
      browserHostId,
      nonce,
      processId,
      processIdentity,
      endpoint: runtime.endpoint,
      port: runtime.port,
      profileName: options.profileName,
      userDataDir: options.userDataDir,
      runtimeInstanceId: options.runtimeInstanceId,
      runtimeProcessId: options.runtimeProcessId,
      sessionId: options.sessionId,
      ownershipGeneration: 1,
      createdAt: now,
      updatedAt: now,
    };
    if (!(await verifiedLiveHost(launched, options, dependencies))) {
      await runtime.close();
      throw new RoveError({
        code: "BROWSER_LAUNCH_FAILED",
        message:
          "The launched browser did not satisfy Rove's host ownership proof.",
      });
    }
    await writeMetadata(metadataPath, launched);
    return hostResult(runtime, launched, metadataPath, false);
  } finally {
    await releaseClaim();
  }
}

function hostResult(
  runtime: ExternalChromeRuntime,
  metadata: PersistentBrowserHostMetadata,
  metadataPath: string,
  reused: boolean,
): PersistentBrowserHost {
  return {
    runtime,
    identity: identity(metadata, reused),
    reused,
    release: async () => {
      const current = await readMetadata(metadataPath);
      if (
        current !== undefined &&
        current !== null &&
        current.browserHostId === metadata.browserHostId &&
        current.nonce === metadata.nonce &&
        current.ownershipGeneration === metadata.ownershipGeneration
      ) {
        await unlink(metadataPath).catch(() => undefined);
      }
    },
  };
}
