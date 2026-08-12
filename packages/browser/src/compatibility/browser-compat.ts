import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  createManagedDownloadDirectory,
  saveManagedDownload,
} from "../downloads/managed-downloads.js";

type BrowserRequest = "chrome" | "chromium";
type CompatibilityStatus =
  | "PASS"
  | "PASS_WITH_LIMITATION"
  | "FAIL_ROVE"
  | "SITE_RESTRICTION"
  | "UNSUPPORTED_CONFIGURATION"
  | "UNVERIFIED";

interface BrowserCompatOptions {
  browser: BrowserRequest;
  headless: boolean;
}

interface CompatibilityFixture {
  readonly url: string;
  close(): Promise<void>;
}

interface CompatibilityCase {
  name: string;
  status: CompatibilityStatus;
  details: string;
}

interface BrowserCompatReport {
  title: "Rove Browser Compatibility";
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
    profile: "temporary + persistent";
  };
  resolved: {
    browser: "Google Chrome" | "Playwright Chromium" | "unknown";
    browserVersion?: string;
    fallbackUsed: boolean;
  };
  cases: CompatibilityCase[];
}

const require = createRequire(import.meta.url);
const LARGE_DOWNLOAD_BYTES = 1024 * 1024;

function playwrightVersion(): string {
  const packageJson = require("playwright/package.json") as { version?: string };
  return packageJson.version ?? "unknown";
}

function defaultBrowserCompatOptions(): BrowserCompatOptions {
  return {
    browser: "chromium",
    headless: true,
  };
}

export function parseBrowserCompatArgs(args: string[]): BrowserCompatOptions {
  const options = defaultBrowserCompatOptions();

  for (const arg of args) {
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

    throw new Error(`Unknown browser:compat argument: ${arg}`);
  }

  return options;
}

function isChromeChannelUnavailable(error: unknown): boolean {
  return error instanceof Error && /not found|doesn't exist|does not exist/i.test(error.message);
}

async function startCompatibilityFixture(): Promise<CompatibilityFixture> {
  const server: Server = createServer((request, response) => {
    if (request.url === "/sw.js") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/javascript; charset=utf-8",
      });
      response.end("self.addEventListener('fetch', () => undefined);");
      return;
    }

    if (request.url === "/download.txt") {
      response.writeHead(200, {
        "content-disposition": 'attachment; filename="rove-compat.txt"',
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("rove compatibility download");
      return;
    }

    if (request.url === "/large-download.bin") {
      response.writeHead(200, {
        "content-disposition": 'attachment; filename="rove-large-download.bin"',
        "content-length": String(LARGE_DOWNLOAD_BYTES),
        "content-type": "application/octet-stream",
      });
      response.end(Buffer.alloc(LARGE_DOWNLOAD_BYTES, "x"));
      return;
    }

    if (request.url === "/slow-download.bin") {
      response.writeHead(200, {
        "content-disposition": 'attachment; filename="rove-slow-download.bin"',
        "content-type": "application/octet-stream",
      });

      let chunks = 0;
      const interval = setInterval(() => {
        chunks += 1;
        response.write(Buffer.alloc(32 * 1024, "s"));

        if (chunks >= 128) {
          clearInterval(interval);
          response.end();
        }
      }, 25);

      response.on("close", () => clearInterval(interval));
      return;
    }

    if (request.url === "/popup-target") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end("<!doctype html><html><head><title>Popup target</title></head><body>popup</body></html>");
      return;
    }

    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
    });
    response.end(`<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Rove Compatibility Fixture</title></head>
  <body>
    <a id="download" href="/download.txt">Download</a>
    <a id="large-download" href="/large-download.bin">Large download</a>
    <a id="slow-download" href="/slow-download.bin">Slow download</a>
    <button id="popup" onclick="window.open('/popup-target', '_blank')">Popup</button>
    <button id="alert" onclick="alert('fixture alert')">Alert</button>
    <button id="confirm" onclick="document.body.dataset.confirmResult = String(confirm('fixture confirm'))">Confirm</button>
    <button id="prompt" onclick="document.body.dataset.promptResult = String(prompt('fixture prompt', 'secret'))">Prompt</button>
    <button id="beforeunload" onclick="window.onbeforeunload = () => 'fixture beforeunload'; document.body.dataset.beforeunloadSet = 'true'">Beforeunload</button>
  </body>
</html>`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Compatibility fixture did not bind to a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      }),
  };
}

async function launchBrowser(
  options: BrowserCompatOptions,
  downloadsPath: string,
): Promise<{
  browser: Browser;
  resolvedBrowser: BrowserCompatReport["resolved"]["browser"];
  fallbackUsed: boolean;
}> {
  const launchOptions = {
    headless: options.headless,
    downloadsPath,
  };

  if (options.browser === "chrome") {
    try {
      const browser = await chromium.launch({
        ...launchOptions,
        channel: "chrome",
      });

      return {
        browser,
        resolvedBrowser: "Google Chrome",
        fallbackUsed: false,
      };
    } catch (error) {
      if (!isChromeChannelUnavailable(error)) throw error;
    }
  }

  return {
    browser: await chromium.launch(launchOptions),
    resolvedBrowser: "Playwright Chromium",
    fallbackUsed: options.browser === "chrome",
  };
}

async function launchPersistentContext(
  options: BrowserCompatOptions,
  userDataDir: string,
): Promise<{
  context: BrowserContext;
  resolvedBrowser: BrowserCompatReport["resolved"]["browser"];
  fallbackUsed: boolean;
}> {
  const launchOptions = {
    headless: options.headless,
    viewport: {
      width: 1440,
      height: 900,
    },
  };

  if (options.browser === "chrome") {
    try {
      const context = await chromium.launchPersistentContext(userDataDir, {
        ...launchOptions,
        channel: "chrome",
      });

      return {
        context,
        resolvedBrowser: "Google Chrome",
        fallbackUsed: false,
      };
    } catch (error) {
      if (!isChromeChannelUnavailable(error)) throw error;
    }
  }

  return {
    context: await chromium.launchPersistentContext(userDataDir, launchOptions),
    resolvedBrowser: "Playwright Chromium",
    fallbackUsed: options.browser === "chrome",
  };
}

async function runCase(
  name: string,
  fn: () => Promise<string>,
): Promise<CompatibilityCase> {
  try {
    return {
      name,
      status: "PASS",
      details: await fn(),
    };
  } catch (error) {
    return {
      name,
      status: "FAIL_ROVE",
      details: error instanceof Error ? error.message : "Unknown compatibility failure.",
    };
  }
}

async function runObservedCase(
  name: string,
  fn: () => Promise<CompatibilityCase>,
): Promise<CompatibilityCase> {
  try {
    return await fn();
  } catch (error) {
    return {
      name,
      status: "FAIL_ROVE",
      details: error instanceof Error ? error.message : "Unknown compatibility failure.",
    };
  }
}

async function verifyLaunchAndNavigation(
  browser: Browser,
  fixture: CompatibilityFixture,
): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(fixture.url);
    const title = await page.title();
    if (title !== "Rove Compatibility Fixture") {
      throw new Error(`Expected fixture title, received ${title}.`);
    }
    return "Launched a temporary context and navigated to the local fixture.";
  } finally {
    await context.close();
  }
}

async function verifyTemporaryStorageIsolation(
  browser: Browser,
  fixture: CompatibilityFixture,
): Promise<string> {
  const first = await browser.newContext();
  try {
    const page = await first.newPage();
    await page.goto(fixture.url);
    await page.evaluate(async () => {
      document.cookie = "rove_compat_cookie=present; SameSite=Lax";
      localStorage.setItem("rove_compat_local", "present");
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("rove-compat-db", 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("values");
        };
        request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
        request.onsuccess = () => {
          const transaction = request.result.transaction("values", "readwrite");
          transaction.objectStore("values").put("present", "marker");
          transaction.oncomplete = () => {
            request.result.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed."));
        };
      });
    });
  } finally {
    await first.close();
  }

  const second = await browser.newContext();
  try {
    const page = await second.newPage();
    await page.goto(fixture.url);
    const state = await page.evaluate(async () => {
      const indexedDbNames = await indexedDB.databases();
      return {
        cookie: document.cookie,
        local: localStorage.getItem("rove_compat_local"),
        indexedDbPresent: indexedDbNames.some((database) => database.name === "rove-compat-db"),
      };
    });

    if (state.cookie.includes("rove_compat_cookie")) {
      throw new Error("Cookie leaked into a new temporary context.");
    }
    if (state.local !== null) {
      throw new Error("localStorage leaked into a new temporary context.");
    }
    if (state.indexedDbPresent) {
      throw new Error("IndexedDB leaked into a new temporary context.");
    }

    return "Cookies, localStorage, and IndexedDB were isolated across temporary contexts.";
  } finally {
    await second.close();
  }
}

async function verifyServiceWorker(
  browser: Browser,
  fixture: CompatibilityFixture,
): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(fixture.url);
    const supported = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      await registration.update();
      return true;
    });

    if (!supported) {
      throw new Error("Service workers are unavailable in this runtime.");
    }

    return "Service-worker registration and readiness completed.";
  } finally {
    await context.close();
  }
}

async function verifyPopup(
  browser: Browser,
  fixture: CompatibilityFixture,
): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(fixture.url);
    const popupPromise = page.waitForEvent("popup");
    await page.locator("#popup").click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    const title = await popup.title();
    if (title !== "Popup target") {
      throw new Error(`Expected popup target title, received ${title}.`);
    }
    return "Popup opened and loaded as a tracked browser page.";
  } finally {
    await context.close();
  }
}

async function verifyDialog(
  browser: Browser,
  fixture: CompatibilityFixture,
): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(fixture.url);
    const alert = await clickAndDismissDialog(page, "#alert");
    const confirm = await clickAndDismissDialog(page, "#confirm");
    const prompt = await clickAndDismissDialog(page, "#prompt");

    if (alert !== "alert" || confirm !== "confirm" || prompt !== "prompt") {
      throw new Error(
        `Unexpected dialog types: ${[alert, confirm, prompt].join(", ")}.`,
      );
    }

    await page.locator("#beforeunload").click();
    const beforeUnloadPromise = page.waitForEvent("dialog").then(async (dialog) => {
      const type = dialog.type();
      await dialog.dismiss();
      return type;
    });
    await page.close({ runBeforeUnload: true });
    const beforeUnload = await beforeUnloadPromise;

    if (beforeUnload !== "beforeunload") {
      throw new Error(`Expected beforeunload dialog, received ${beforeUnload}.`);
    }

    return "Alert, confirm, prompt, and beforeunload dialogs were dismissed without deadlock.";
  } finally {
    await context.close();
  }
}

async function clickAndDismissDialog(page: Page, selector: string): Promise<string> {
  const dialogPromise = page.waitForEvent("dialog").then(async (dialog) => {
    const type = dialog.type();
    await dialog.dismiss();
    return type;
  });
  await page.locator(selector).click();
  return dialogPromise;
}

async function verifyDownload(
  browser: Browser,
  fixture: CompatibilityFixture,
  downloadsRoot: string,
): Promise<string> {
  const managedDirectory = await createManagedDownloadDirectory(
    downloadsRoot,
    "compat",
  );
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await context.newPage();
    await page.goto(fixture.url);
    const download = await triggerDownload(page, "#download");
    const saved = await saveManagedDownload(download, managedDirectory);
    const duplicate = await triggerDownload(page, "#download");
    const duplicateSaved = await saveManagedDownload(duplicate, managedDirectory);

    if (saved.filename !== "rove-compat.txt") {
      throw new Error(`Unexpected download filename: ${saved.filename}.`);
    }
    if (duplicateSaved.filename !== "rove-compat (1).txt") {
      throw new Error(`Unexpected duplicate download filename: ${duplicateSaved.filename}.`);
    }
    if (!pathInside(managedDirectory, saved.path) || !pathInside(managedDirectory, duplicateSaved.path)) {
      throw new Error("Download escaped the managed directory.");
    }
    return "Downloads were saved inside a managed directory with duplicate filenames preserved.";
  } finally {
    await context.close();
  }
}

async function verifyDownloadCancellation(
  browser: Browser,
  fixture: CompatibilityFixture,
): Promise<string> {
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await context.newPage();
    await page.goto(fixture.url);
    const download = await triggerDownload(page, "#slow-download");

    await download.cancel();

    const failure = await download.failure();
    if (failure === null || !/cancel/i.test(failure)) {
      throw new Error(`Expected cancelled download failure, received ${failure ?? "none"}.`);
    }

    return "Download cancellation produced a deterministic cancelled state.";
  } finally {
    await context.close();
  }
}

async function verifyLargeBoundedDownload(
  browser: Browser,
  fixture: CompatibilityFixture,
  downloadsRoot: string,
): Promise<string> {
  const managedDirectory = await createManagedDownloadDirectory(
    downloadsRoot,
    "compat_large",
  );
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await context.newPage();
    await page.goto(fixture.url);
    const download = await triggerDownload(page, "#large-download");
    const saved = await saveManagedDownload(download, managedDirectory);
    const contents = await readFile(saved.path);

    if (saved.filename !== "rove-large-download.bin") {
      throw new Error(`Unexpected large download filename: ${saved.filename}.`);
    }
    if (contents.byteLength !== LARGE_DOWNLOAD_BYTES) {
      throw new Error(
        `Unexpected large download size: ${contents.byteLength} bytes.`,
      );
    }
    if (!pathInside(managedDirectory, saved.path)) {
      throw new Error("Large download escaped the managed directory.");
    }

    return "A bounded large download saved with the expected filename and size.";
  } finally {
    await context.close();
  }
}

async function verifyBrowserCloseDuringDownload(
  browser: Browser,
  fixture: CompatibilityFixture,
): Promise<string> {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(fixture.url);
  const download = await triggerDownload(page, "#slow-download");

  await context.close();

  const failure = await download.failure().catch((error: unknown) =>
    error instanceof Error ? error.message : "Unknown failure.",
  );
  if (failure === null) {
    throw new Error("Download unexpectedly completed after browser context close.");
  }

  return "Browser context close interrupted the in-flight download without hanging.";
}

async function triggerDownload(page: Page, selector: string) {
  const downloadPromise = page.waitForEvent("download");
  await page.locator(selector).click();
  return downloadPromise;
}

function pathInside(root: string, target: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${sep}`);
}

async function writePersistentState(
  context: BrowserContext,
  fixture: CompatibilityFixture,
): Promise<void> {
  const page = await context.newPage();
  await page.goto(fixture.url);
  await page.evaluate(async () => {
    document.cookie = "rove_persistent_cookie=present; Max-Age=3600; SameSite=Lax";
    localStorage.setItem("rove_persistent_local", "present");

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("rove-persistent-db", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("values");
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
      request.onsuccess = () => {
        const transaction = request.result.transaction("values", "readwrite");
        transaction.objectStore("values").put("present", "marker");
        transaction.oncomplete = () => {
          request.result.close();
          resolve();
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

async function readPersistentState(
  context: BrowserContext,
  fixture: CompatibilityFixture,
): Promise<{
  cookie: string;
  local: string | null;
  indexedDbPresent: boolean;
  serviceWorkerControlledOrRegistered: boolean;
}> {
  const page = await context.newPage();
  await page.goto(fixture.url);
  return page.evaluate(async () => {
    const indexedDbNames = await indexedDB.databases();
    const registrations =
      "serviceWorker" in navigator
        ? await navigator.serviceWorker.getRegistrations()
        : [];

    return {
      cookie: document.cookie,
      local: localStorage.getItem("rove_persistent_local"),
      indexedDbPresent: indexedDbNames.some(
        (database) => database.name === "rove-persistent-db",
      ),
      serviceWorkerControlledOrRegistered:
        navigator.serviceWorker.controller !== null || registrations.length > 0,
    };
  });
}

async function verifyPersistentProfileRestart(
  options: BrowserCompatOptions,
  fixture: CompatibilityFixture,
): Promise<string> {
  const profileDirectory = await mkdtemp(join(tmpdir(), "rove-browser-compat-profile-"));

  try {
    const first = await launchPersistentContext(options, profileDirectory);
    try {
      await writePersistentState(first.context, fixture);
    } finally {
      await first.context.close();
    }

    const second = await launchPersistentContext(options, profileDirectory);
    try {
      const state = await readPersistentState(second.context, fixture);

      if (!state.cookie.includes("rove_persistent_cookie=present")) {
        throw new Error("Persistent cookie was not retained across restart.");
      }
      if (state.local !== "present") {
        throw new Error("Persistent localStorage was not retained across restart.");
      }
      if (!state.indexedDbPresent) {
        throw new Error("Persistent IndexedDB was not retained across restart.");
      }
      if (!state.serviceWorkerControlledOrRegistered) {
        throw new Error("Service-worker registration was not retained across restart.");
      }

      return "Cookie, localStorage, IndexedDB, and service-worker state survived persistent-profile restart.";
    } finally {
      await second.context.close();
    }
  } finally {
    await rm(profileDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function verifyPersistentProfileConcurrentUse(
  options: BrowserCompatOptions,
): Promise<CompatibilityCase> {
  const profileDirectory = await mkdtemp(join(tmpdir(), "rove-browser-compat-lock-"));

  try {
    const first = await launchPersistentContext(options, profileDirectory);

    try {
      const rejected = await persistentSecondLaunchIsRejected(options, profileDirectory);
      return rejected
        ? {
            name: "persistent profile native lock behavior",
            status: "PASS",
            details:
              "Browser rejected concurrent writable launch against the same persistent profile.",
          }
        : {
            name: "persistent profile native lock behavior",
            status: "PASS_WITH_LIMITATION",
            details:
              "Browser allowed concurrent writable launch; F4 must enforce Rove-level profile locking.",
          };
    } finally {
      await first.context.close();
    }
  } finally {
    await rm(profileDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function persistentSecondLaunchIsRejected(
  options: BrowserCompatOptions,
  profileDirectory: string,
): Promise<boolean> {
  let second: BrowserContext | undefined;

  try {
    second = (await launchPersistentContext(options, profileDirectory)).context;
  } catch {
    return true;
  } finally {
    await second?.close().catch(() => undefined);
  }

  return false;
}

export async function collectBrowserCompatReport(
  options: BrowserCompatOptions = defaultBrowserCompatOptions(),
): Promise<BrowserCompatReport> {
  const fixture = await startCompatibilityFixture();
  const downloadsPath = await mkdtemp(join(tmpdir(), "rove-browser-compat-downloads-"));

  let browser: Browser | undefined;
  let resolvedBrowser: BrowserCompatReport["resolved"]["browser"] = "unknown";
  let fallbackUsed = false;

  try {
    await mkdir(downloadsPath, { recursive: true });
    const launched = await launchBrowser(options, downloadsPath);
    browser = launched.browser;
    resolvedBrowser = launched.resolvedBrowser;
    fallbackUsed = launched.fallbackUsed;

    const cases = [
      await runCase("temporary launch and navigation", () =>
        verifyLaunchAndNavigation(launched.browser, fixture),
      ),
      await runCase("temporary storage isolation", () =>
        verifyTemporaryStorageIsolation(launched.browser, fixture),
      ),
      await runCase("service worker registration", () =>
        verifyServiceWorker(launched.browser, fixture),
      ),
      await runCase("popup handling", () => verifyPopup(launched.browser, fixture)),
      await runCase("dialog handling", () => verifyDialog(launched.browser, fixture)),
      await runCase("download handling", () =>
        verifyDownload(launched.browser, fixture, downloadsPath),
      ),
      await runCase("download cancellation", () =>
        verifyDownloadCancellation(launched.browser, fixture),
      ),
      await runCase("large bounded download", () =>
        verifyLargeBoundedDownload(launched.browser, fixture, downloadsPath),
      ),
      await runCase("browser close during download", () =>
        verifyBrowserCloseDuringDownload(launched.browser, fixture),
      ),
      await runCase("persistent profile restart", () =>
        verifyPersistentProfileRestart(options, fixture),
      ),
      await runObservedCase("persistent profile native lock behavior", () =>
        verifyPersistentProfileConcurrentUse(options),
      ),
    ];

    if (fallbackUsed) {
      cases.unshift({
        name: "browser distribution fallback",
        status: "PASS_WITH_LIMITATION",
        details:
          "Requested Google Chrome was unavailable, so Playwright Chromium was used.",
      });
    }

    return {
      title: "Rove Browser Compatibility",
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
        profile: "temporary + persistent",
      },
      resolved: {
        browser: resolvedBrowser,
        browserVersion: launched.browser.version(),
        fallbackUsed,
      },
      cases,
    };
  } catch (error) {
    return {
      title: "Rove Browser Compatibility",
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
        profile: "temporary + persistent",
      },
      resolved: {
        browser: resolvedBrowser,
        fallbackUsed,
      },
      cases: [
        {
          name: "browser launch",
          status:
            options.browser === "chrome" && resolvedBrowser === "unknown"
              ? "UNSUPPORTED_CONFIGURATION"
              : "FAIL_ROVE",
          details:
            error instanceof Error
              ? error.message
              : "Unknown browser compatibility failure.",
        },
      ],
    };
  } finally {
    await browser?.close().catch(() => undefined);
    await fixture.close().catch(() => undefined);
    await rm(downloadsPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function formatBrowserCompatReport(report: BrowserCompatReport): string {
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
    `  Headless: ${report.requested.headless ? "true" : "false"}`,
    `  Profile: ${report.requested.profile}`,
    "",
    "Resolved:",
    `  Browser: ${report.resolved.browser}`,
    `  Browser version: ${report.resolved.browserVersion ?? "unknown"}`,
    `  Fallback used: ${report.resolved.fallbackUsed ? "true" : "false"}`,
    "",
    "Cases:",
  ];

  for (const testCase of report.cases) {
    lines.push(`  [${testCase.status}] ${testCase.name}: ${testCase.details}`);
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parseBrowserCompatArgs(process.argv.slice(2));
  const report = await collectBrowserCompatReport(options);
  console.log(formatBrowserCompatReport(report));

  if (report.cases.some((testCase) => testCase.status === "FAIL_ROVE")) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
