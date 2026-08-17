import { spawn, type ChildProcess } from "node:child_process";
import { access, constants, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const PROCESS_EXIT_TIMEOUT_MS = 3_000;
const PROCESS_KILL_TIMEOUT_MS = 1_000;
const STDERR_TAIL_LIMIT = 6_000;

type PathExists = (executablePath: string) => Promise<boolean>;

export interface ChromeExecutableDiscoveryOptions {
  explicitExecutablePath?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  pathExists?: PathExists;
}

export interface ExternalChromeArgumentOptions {
  port: number;
  userDataDir: string;
  headless: boolean;
  launchArgs?: string[];
}

export interface ExternalChromeLaunchOptions {
  executablePath: string;
  userDataDir?: string;
  headless: boolean;
  launchArgs?: string[];
  timeoutMs?: number;
}

export interface ExternalChromeRuntime {
  readonly endpoint: string;
  readonly port: number;
  readonly processId?: number;
  readonly userDataDir: string;
  readonly temporaryProfile: boolean;
  close(): Promise<void>;
  closeGracefully(): Promise<void>;
}

async function defaultPathExists(executablePath: string): Promise<boolean> {
  try {
    await access(executablePath, constants.F_OK);

    return true;
  } catch {
    return false;
  }
}

function systemChromeCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  if (platform === "darwin") {
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ];

    if (env.HOME !== undefined) {
      candidates.push(
        `${env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      );
    }

    return candidates;
  }

  if (platform === "win32") {
    const roots = [
      env.LOCALAPPDATA,
      env.PROGRAMFILES,
      env["PROGRAMFILES(X86)"],
    ].filter(
      (value): value is string => value !== undefined && value.length > 0,
    );

    return roots.map((root) =>
      win32.join(root, "Google", "Chrome", "Application", "chrome.exe"),
    );
  }

  if (platform === "linux") {
    const directories = (env.PATH ?? "").split(":").filter(Boolean);

    const executables = ["google-chrome", "google-chrome-stable"];

    return directories.flatMap((directory) =>
      executables.map((executable) => posix.join(directory, executable)),
    );
  }

  return [];
}

export async function discoverExternalChromeExecutable(
  options: ChromeExecutableDiscoveryOptions = {},
): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;

  const env = options.env ?? process.env;

  const pathExists = options.pathExists ?? defaultPathExists;

  if (options.explicitExecutablePath !== undefined) {
    if (!(await pathExists(options.explicitExecutablePath))) {
      throw new Error(
        `Configured browser executable does not exist: ${options.explicitExecutablePath}`,
      );
    }

    return options.explicitExecutablePath;
  }

  for (const executablePath of systemChromeCandidates(platform, env)) {
    if (await pathExists(executablePath)) {
      return executablePath;
    }
  }

  return undefined;
}

function reservedExternalArgument(arg: string): boolean {
  const name = arg.split("=", 1)[0];

  return (
    name === "--remote-debugging-port" ||
    name === "--remote-debugging-address" ||
    name === "--user-data-dir"
  );
}

export function buildExternalChromeArguments(
  options: ExternalChromeArgumentOptions,
): string[] {
  if (
    !Number.isInteger(options.port) ||
    options.port <= 0 ||
    options.port > 65_535
  ) {
    throw new Error(
      "External Chrome requires a specific non-zero TCP debugging port.",
    );
  }

  const launchArgs = options.launchArgs ?? [];

  const reserved = launchArgs.find(reservedExternalArgument);

  if (reserved !== undefined) {
    throw new Error(
      `Browser launch argument is reserved by the Rove external-Chrome runtime: ${reserved}`,
    );
  }

  return [
    `--remote-debugging-address=${LOOPBACK_HOST}`,
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${options.userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(options.headless ? ["--headless=new"] : []),
    ...launchArgs,
    "about:blank",
  ];
}

export async function reserveLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.unref();

    server.once("error", reject);

    server.listen(
      {
        host: LOOPBACK_HOST,
        port: 0,
        exclusive: true,
      },
      () => {
        const address = server.address();

        if (address === null || typeof address === "string") {
          server.close();

          reject(new Error("Unable to resolve reserved loopback port."));

          return;
        }

        const port = address.port;

        server.close((error) => {
          if (error) {
            reject(error);

            return;
          }

          resolve(port);
        });
      },
    );
  });
}

function appendTail(current: string, chunk: Buffer): string {
  const next = current + chunk.toString();

  return next.slice(-STDERR_TAIL_LIMIT);
}

function processExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (processExited(child)) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (exited: boolean) => {
      if (settled) {
        return;
      }

      settled = true;

      clearTimeout(timer);

      child.off("exit", onExit);

      resolve(exited);
    };

    const onExit = () => finish(true);

    const timer = setTimeout(() => finish(false), timeoutMs);

    timer.unref();

    child.once("exit", onExit);
  });
}

async function signalProcessTree(
  pid: number,
  signal: NodeJS.Signals,
): Promise<void> {
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const args = [
        "/PID",
        String(pid),
        "/T",
        ...(signal === "SIGKILL" ? ["/F"] : []),
      ];

      const killer = spawn("taskkill", args, {
        stdio: "ignore",
        windowsHide: true,
      });

      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        resolve();
      };

      killer.once("error", finish);

      killer.once("exit", finish);
    });

    return;
  }

  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    )) {
      throw error;
    }
  }
}

async function terminateOwnedChrome(child: ChildProcess): Promise<void> {
  if (processExited(child)) {
    return;
  }

  const pid = child.pid;

  if (pid === undefined) {
    child.kill("SIGTERM");
  } else {
    await signalProcessTree(pid, "SIGTERM");
  }

  if (await waitForExit(child, PROCESS_EXIT_TIMEOUT_MS)) {
    return;
  }

  if (pid === undefined) {
    child.kill("SIGKILL");
  } else {
    await signalProcessTree(pid, "SIGKILL");
  }

  await waitForExit(child, PROCESS_KILL_TIMEOUT_MS);
}

async function waitForDevTools(
  endpoint: string,
  child: ChildProcess,
  startupError: () => Error | undefined,
  stderrTail: () => string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const spawnError = startupError();

    if (spawnError !== undefined) {
      throw spawnError;
    }

    if (processExited(child)) {
      const tail = stderrTail().trim();

      throw new Error(
        [
          `External Chrome exited before its DevTools endpoint became available.`,
          tail.length === 0 ? undefined : tail,
        ]
          .filter((value): value is string => value !== undefined)
          .join("\n"),
      );
    }

    try {
      const response = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(500),
      });

      if (response.ok) {
        const payload = (await response.json()) as {
          webSocketDebuggerUrl?: unknown;
        };

        if (
          typeof payload.webSocketDebuggerUrl === "string" &&
          payload.webSocketDebuggerUrl.length > 0
        ) {
          return;
        }
      }
    } catch {
      // Chrome is still starting.
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 100);

      timer.unref();
    });
  }

  throw new Error(
    `Timed out waiting for external Chrome DevTools endpoint: ${endpoint}`,
  );
}

export async function launchExternalChrome(
  options: ExternalChromeLaunchOptions,
): Promise<ExternalChromeRuntime> {
  const temporaryProfile = options.userDataDir === undefined;

  const userDataDir =
    options.userDataDir ??
    (await mkdtemp(join(tmpdir(), "rove-external-chrome-")));

  const port = await reserveLoopbackPort();

  const endpoint = `http://${LOOPBACK_HOST}:${port}`;

  const args = buildExternalChromeArguments({
    port,
    userDataDir,
    headless: options.headless,
    ...(options.launchArgs === undefined
      ? {}
      : { launchArgs: options.launchArgs }),
  });

  const child = spawn(options.executablePath, args, {
    env: process.env,
    stdio: ["ignore", "ignore", "pipe"],
    detached: process.platform !== "win32",
    windowsHide: true,
  });

  let spawnError: Error | undefined;

  let stderrTail = "";

  child.once("error", (error) => {
    spawnError = error;
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = appendTail(stderrTail, chunk);
  });

  let closePromise: Promise<void> | undefined;

  const closeWithGracePeriod = (allowNaturalExit: boolean): Promise<void> => {
    if (closePromise !== undefined) {
      return closePromise;
    }

    closePromise = (async () => {
      if (allowNaturalExit && !processExited(child)) {
        await waitForExit(child, PROCESS_EXIT_TIMEOUT_MS);
      }

      if (!processExited(child)) {
        await terminateOwnedChrome(child).catch(() => undefined);
      }

      if (temporaryProfile) {
        await rm(userDataDir, {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
    })();

    return closePromise;
  };

  const close = (): Promise<void> => closeWithGracePeriod(false);

  const closeGracefully = (): Promise<void> => closeWithGracePeriod(true);

  try {
    await waitForDevTools(
      endpoint,
      child,
      () => spawnError,
      () => stderrTail,
      options.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    );
  } catch (error) {
    await close();

    throw error;
  }

  return {
    endpoint,
    port,
    ...(child.pid === undefined
      ? {}
      : {
          processId: child.pid,
        }),
    userDataDir,
    temporaryProfile,
    close,
    closeGracefully,
  };
}
