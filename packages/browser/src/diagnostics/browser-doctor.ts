import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type BrowserContext } from "playwright";

type BrowserRequest = "chrome" | "chromium";
type ProfileRequest = "temporary" | "persistent";

export interface BrowserDoctorOptions {
  browser: BrowserRequest;
  headless: boolean;
  profile: ProfileRequest;
  profileDirectory?: string;
  output: "text" | "json";
  viewport: {
    width: number;
    height: number;
  };
  launchArgs: string[];
}

export interface BrowserDoctorReport {
  title: "Rove Browser Runtime";
  platform: {
    os: NodeJS.Platform;
    arch: string;
    runtime: string;
  };
  playwright: {
    version: string;
  };
  requested: {
    browser: BrowserRequest;
    headless: boolean;
    profile: ProfileRequest;
    viewport: {
      width: number;
      height: number;
    };
    customLaunchArgs: boolean;
  };
  resolved: {
    browser: "Google Chrome" | "Playwright Chromium" | "unknown";
    browserVersion?: string;
    profileDirectory?: string;
    fallbackUsed: boolean;
  };
  verified: {
    launch: "pass" | "fail";
    pageCreation: "pass" | "fail" | "not_run";
    serviceWorkers: "supported" | "unsupported" | "not_run";
    persistentStorage: "verified" | "not_requested" | "not_run";
    downloads: "not_run";
    sandbox: "enabled" | "disabled" | "unknown";
  };
  diagnostics: BrowserLaunchDiagnostic[];
}

export interface BrowserLaunchDiagnostic {
  level: "info" | "warning" | "error";
  code: string;
  message: string;
}

interface LaunchedRuntime {
  browser?: Browser;
  context: BrowserContext;
  resolvedBrowser: BrowserDoctorReport["resolved"]["browser"];
  fallbackUsed: boolean;
  profileDirectory?: string;
  cleanupDirectory?: string;
}

interface DiagnosticFixture {
  readonly url: string;
  close(): Promise<void>;
}

interface PersistentVerificationState {
  cookie: boolean;
  localStorage: boolean;
  indexedDb: boolean;
  serviceWorker: boolean;
}

const require = createRequire(import.meta.url);

function withOptionalDirectory(
  directory: string | undefined,
): Pick<LaunchedRuntime, "cleanupDirectory"> {
  return directory === undefined ? {} : { cleanupDirectory: directory };
}

function playwrightVersion(): string {
  const packageJson = require("playwright/package.json") as { version?: string };
  return packageJson.version ?? "unknown";
}

export function defaultBrowserDoctorOptions(): BrowserDoctorOptions {
  return {
    browser: "chromium",
    headless: true,
    profile: "temporary",
    output: "text",
    viewport: {
      width: 1440,
      height: 900,
    },
    launchArgs: [],
  };
}

export function parseBrowserDoctorArgs(
  args: string[],
): BrowserDoctorOptions {
  const options = defaultBrowserDoctorOptions();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--chrome") {
      options.browser = "chrome";
      continue;
    }

    if (arg === "--chromium") {
      options.browser = "chromium";
      continue;
    }

    if (arg === "--headed") {
      options.headless = false;
      continue;
    }

    if (arg === "--headless") {
      options.headless = true;
      continue;
    }

    if (arg === "--persistent") {
      options.profile = "persistent";
      continue;
    }

    if (arg === "--temporary") {
      options.profile = "temporary";
      continue;
    }

    if (arg === "--profile-dir") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error("--profile-dir requires a directory.");
      }
      options.profileDirectory = resolve(value);
      index += 1;
      continue;
    }

    if (arg === "--arg") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error("--arg requires a Chromium argument.");
      }
      options.launchArgs.push(value);
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.output = "json";
      continue;
    }

    throw new Error(`Unknown browser:doctor argument: ${arg}`);
  }

  return options;
}

function isChromeChannelUnavailable(error: unknown): boolean {
  return error instanceof Error && /not found|doesn't exist|does not exist/i.test(error.message);
}

async function startDiagnosticFixture(): Promise<DiagnosticFixture> {
  const server: Server = createServer((request, response) => {
    if (request.url === "/sw.js") {
      response.writeHead(200, {
        "content-type": "application/javascript; charset=utf-8",
      });
      response.end("self.addEventListener('fetch', () => undefined);");
      return;
    }

    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
    });
    response.end("<!doctype html><html><head><title>Rove Browser Doctor</title></head><body>ok</body></html>");
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Browser doctor fixture did not bind to a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      }),
  };
}

async function launchRuntime(
  options: BrowserDoctorOptions,
): Promise<LaunchedRuntime> {
  const launchOptions = {
    headless: options.headless,
    args: options.launchArgs,
  };

  if (options.profile === "persistent") {
    const profileDirectory =
      options.profileDirectory ??
      (await mkdtemp(join(tmpdir(), "rove-browser-doctor-")));

    await mkdir(profileDirectory, { recursive: true });

    if (options.browser === "chrome") {
      try {
        const context = await chromium.launchPersistentContext(
          profileDirectory,
          {
            ...launchOptions,
            channel: "chrome",
            viewport: options.viewport,
          },
        );

        return {
          context,
          resolvedBrowser: "Google Chrome",
          fallbackUsed: false,
          profileDirectory,
          ...withOptionalDirectory(
            options.profileDirectory === undefined ? profileDirectory : undefined,
          ),
        };
      } catch (error) {
        if (!isChromeChannelUnavailable(error)) throw error;
      }
    }

    const context = await chromium.launchPersistentContext(profileDirectory, {
      ...launchOptions,
      viewport: options.viewport,
    });

    return {
      context,
      resolvedBrowser: "Playwright Chromium",
      fallbackUsed: options.browser === "chrome",
      profileDirectory,
      ...withOptionalDirectory(
        options.profileDirectory === undefined ? profileDirectory : undefined,
      ),
    };
  }

  if (options.browser === "chrome") {
    try {
      const browser = await chromium.launch({
        ...launchOptions,
        channel: "chrome",
      });
      const context = await browser.newContext({ viewport: options.viewport });

      return {
        browser,
        context,
        resolvedBrowser: "Google Chrome",
        fallbackUsed: false,
      };
    } catch (error) {
      if (!isChromeChannelUnavailable(error)) throw error;
    }
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: options.viewport });

  return {
    browser,
    context,
    resolvedBrowser: "Playwright Chromium",
    fallbackUsed: options.browser === "chrome",
  };
}

async function writePersistentDoctorState(
  context: BrowserContext,
  fixture: DiagnosticFixture,
): Promise<void> {
  const page = await context.newPage();
  await page.goto(fixture.url);
  await page.evaluate(async () => {
    document.cookie = "rove_browser_doctor_cookie=verified; Max-Age=3600; SameSite=Lax";
    localStorage.setItem("rove-browser-doctor-local", "verified");

    await new Promise<void>((resolveOpen, reject) => {
      const request = indexedDB.open("rove-browser-doctor-db", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("values");
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
      request.onsuccess = () => {
        const transaction = request.result.transaction("values", "readwrite");
        transaction.objectStore("values").put("verified", "marker");
        transaction.oncomplete = () => {
          request.result.close();
          resolveOpen();
        };
        transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed."));
      };
    });

    if ("serviceWorker" in navigator) {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    }
  });
}

async function readPersistentDoctorState(
  context: BrowserContext,
  fixture: DiagnosticFixture,
): Promise<PersistentVerificationState> {
  const page = await context.newPage();
  await page.goto(fixture.url);
  return page.evaluate(async () => {
    const indexedDbNames = await indexedDB.databases();
    const registrations =
      "serviceWorker" in navigator
        ? await navigator.serviceWorker.getRegistrations()
        : [];

    return {
      cookie: document.cookie.includes("rove_browser_doctor_cookie=verified"),
      localStorage:
        localStorage.getItem("rove-browser-doctor-local") === "verified",
      indexedDb: indexedDbNames.some(
        (database) => database.name === "rove-browser-doctor-db",
      ),
      serviceWorker:
        navigator.serviceWorker.controller !== null || registrations.length > 0,
    };
  });
}

async function verifyPersistentRestart(
  options: BrowserDoctorOptions,
  runtime: LaunchedRuntime,
  fixture: DiagnosticFixture,
): Promise<boolean> {
  if (runtime.profileDirectory === undefined) return false;

  await writePersistentDoctorState(runtime.context, fixture);
  await runtime.context.close();

  const restarted = await launchRuntime({
    ...options,
    profile: "persistent",
    profileDirectory: runtime.profileDirectory,
  });

  try {
    const state = await readPersistentDoctorState(restarted.context, fixture);
    return (
      state.cookie &&
      state.localStorage &&
      state.indexedDb &&
      state.serviceWorker
    );
  } finally {
    await restarted.context.close().catch(() => undefined);
    await restarted.browser?.close().catch(() => undefined);
  }
}

async function verifyPageRuntime(
  runtime: LaunchedRuntime,
  options: BrowserDoctorOptions,
): Promise<Pick<BrowserDoctorReport, "resolved" | "verified">> {
  const fixture = await startDiagnosticFixture();
  const page = await runtime.context.newPage();

  try {
    await page.goto(fixture.url);

    const serviceWorkersSupported = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const registration = await navigator.serviceWorker.register("/sw.js");
      await registration.update();
      return registration.active !== null || registration.installing !== null || registration.waiting !== null;
    });
    const browserVersion =
      runtime.browser === undefined
        ? runtime.context.browser()?.version()
        : runtime.browser.version();
    const persistentStorageVerified =
      options.profile === "persistent"
        ? await verifyPersistentRestart(options, runtime, fixture)
        : false;

    return {
      resolved: {
        browser: runtime.resolvedBrowser,
        ...(browserVersion === undefined ? {} : { browserVersion }),
        ...(runtime.profileDirectory === undefined
          ? {}
          : { profileDirectory: runtime.profileDirectory }),
        fallbackUsed: runtime.fallbackUsed,
      },
      verified: {
        launch: "pass",
        pageCreation: "pass",
        serviceWorkers: serviceWorkersSupported ? "supported" : "unsupported",
        persistentStorage:
          options.profile === "persistent"
            ? persistentStorageVerified
              ? "verified"
              : "not_run"
            : "not_requested",
        downloads: "not_run",
        sandbox: "unknown",
      },
    };
  } finally {
    await fixture.close().catch(() => undefined);
  }
}

export async function collectBrowserDoctorReport(
  options: BrowserDoctorOptions = defaultBrowserDoctorOptions(),
): Promise<BrowserDoctorReport> {
  const diagnostics: BrowserLaunchDiagnostic[] = [];

  if (options.launchArgs.length > 0) {
    diagnostics.push({
      level: "warning",
      code: "CUSTOM_LAUNCH_ARGS",
      message:
        "Runtime modified by custom browser arguments; compatibility guarantees may not apply.",
    });
  }

  let runtime: LaunchedRuntime | undefined;

  try {
    runtime = await launchRuntime(options);
    const measured = await verifyPageRuntime(runtime, options);

    if (measured.resolved.fallbackUsed) {
      diagnostics.push({
        level: "warning",
        code: "BROWSER_FALLBACK_USED",
        message:
          "Requested Google Chrome was unavailable, so Playwright Chromium was used.",
      });
    }

    return {
      title: "Rove Browser Runtime",
      platform: {
        os: process.platform,
        arch: process.arch,
        runtime: `node ${process.version}`,
      },
      playwright: {
        version: playwrightVersion(),
      },
      requested: {
        browser: options.browser,
        headless: options.headless,
        profile: options.profile,
        viewport: options.viewport,
        customLaunchArgs: options.launchArgs.length > 0,
      },
      resolved: measured.resolved,
      verified: measured.verified,
      diagnostics,
    };
  } catch (error) {
    diagnostics.push({
      level: "error",
      code: "BROWSER_DOCTOR_FAILED",
      message: error instanceof Error ? error.message : "Unknown browser diagnostic failure.",
    });

    return {
      title: "Rove Browser Runtime",
      platform: {
        os: process.platform,
        arch: process.arch,
        runtime: `node ${process.version}`,
      },
      playwright: {
        version: playwrightVersion(),
      },
      requested: {
        browser: options.browser,
        headless: options.headless,
        profile: options.profile,
        viewport: options.viewport,
        customLaunchArgs: options.launchArgs.length > 0,
      },
      resolved: {
        browser: "unknown",
        fallbackUsed: false,
      },
      verified: {
        launch: "fail",
        pageCreation: "not_run",
        serviceWorkers: "not_run",
        persistentStorage: "not_run",
        downloads: "not_run",
        sandbox: "unknown",
      },
      diagnostics,
    };
  } finally {
    if (runtime !== undefined) {
      await runtime.context.close().catch(() => undefined);
      await runtime.browser?.close().catch(() => undefined);
      if (runtime.cleanupDirectory !== undefined) {
        await rm(runtime.cleanupDirectory, {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
    }
  }
}

function formatBool(value: boolean): string {
  return value ? "true" : "false";
}

export function formatBrowserDoctorReport(report: BrowserDoctorReport): string {
  const lines = [
    report.title,
    "",
    "Platform:",
    `  ${report.platform.os}-${report.platform.arch}`,
    `  ${report.platform.runtime}`,
    "",
    "Playwright:",
    `  ${report.playwright.version}`,
    "",
    "Requested:",
    `  Browser: ${report.requested.browser}`,
    `  Headless: ${formatBool(report.requested.headless)}`,
    `  Profile: ${report.requested.profile}`,
    `  Viewport: ${report.requested.viewport.width}x${report.requested.viewport.height}`,
    `  Custom launch args: ${formatBool(report.requested.customLaunchArgs)}`,
    "",
    "Resolved:",
    `  Browser: ${report.resolved.browser}`,
    `  Browser version: ${report.resolved.browserVersion ?? "unknown"}`,
    `  Fallback used: ${formatBool(report.resolved.fallbackUsed)}`,
    `  Profile directory: ${report.resolved.profileDirectory ?? "not applicable"}`,
    "",
    "Verified:",
    `  Launch: ${report.verified.launch}`,
    `  Page creation: ${report.verified.pageCreation}`,
    `  Sandbox: ${report.verified.sandbox}`,
    `  Service workers: ${report.verified.serviceWorkers}`,
    `  Persistent storage: ${report.verified.persistentStorage}`,
    `  Downloads: ${report.verified.downloads}`,
  ];

  if (report.diagnostics.length > 0) {
    lines.push("", "Diagnostics:");
    for (const diagnostic of report.diagnostics) {
      lines.push(`  [${diagnostic.level}] ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parseBrowserDoctorArgs(process.argv.slice(2));
  const report = await collectBrowserDoctorReport(options);
  console.log(
    options.output === "json"
      ? JSON.stringify(report, null, 2)
      : formatBrowserDoctorReport(report),
  );

  if (report.verified.launch === "fail") {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
