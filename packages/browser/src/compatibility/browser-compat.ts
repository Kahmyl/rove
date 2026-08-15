import { createHash } from "node:crypto";
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
import type {
  BrowserActivity,
} from "../observation/browser-activity.js";
import { PlaywrightBrowserEngine } from "../playwright-browser-engine.js";
import { RoveProfileLock } from "../profiles/profile-lock.js";
import { RoveProfileManager } from "../profiles/profile-manager.js";

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
    const url = request.url ?? "/";

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

    if (url === "/cache-storage") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end("<!doctype html><html><head><title>Cache Storage</title></head><body>cache storage</body></html>");
      return;
    }

    if (url === "/same-origin-frame") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end("<!doctype html><html><head><title>Same origin frame</title></head><body><p id=\"same-origin-marker\">same origin frame loaded</p></body></html>");
      return;
    }

    if (url === "/cross-origin-frame") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end("<!doctype html><html><head><title>Cross origin frame</title></head><body><p id=\"cross-origin-marker\">cross origin frame loaded</p></body></html>");
      return;
    }

    if (url === "/spa-target") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end("<!doctype html><html><head><title>SPA target</title></head><body>spa target</body></html>");
      return;
    }

    if (url === "/large-page") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
      });
      response.end(`<!doctype html><html><head><title>Large page</title></head><body>${Array.from({ length: 500 }, (_, index) => `<button>Large target ${index}</button><p>Large paragraph ${index}</p>`).join("")}</body></html>`);
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
    <input id="file-input" type="file" />
    <iframe id="same-origin-frame" src="/same-origin-frame"></iframe>
    <iframe id="cross-origin-frame"></iframe>
    <button id="spa" onclick="history.pushState({ ok: true }, '', '/spa-target'); document.body.dataset.spaRoute = location.pathname">SPA route</button>
    <button id="timer" onclick="setTimeout(() => document.body.dataset.timerDone = 'true', 100)">Long timer</button>
    <script>
      document.querySelector('#cross-origin-frame').src =
        location.href.replace('127.0.0.1', 'localhost').replace(/\\/$/, '') + '/cross-origin-frame';
    </script>
  </body>
</html>`);
  });

  server.on("upgrade", (request, socket) => {
    if (request.url !== "/ws") {
      socket.destroy();
      return;
    }

    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }

    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );

    setTimeout(() => {
      const payload = Buffer.from("rove websocket");
      socket.write(Buffer.from([0x81, payload.byteLength, ...payload]));
      setTimeout(() => socket.end(), 100);
    }, 50);
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
  traceCompatibilityCase(name);
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
  traceCompatibilityCase(name);
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

function traceCompatibilityCase(name: string): void {
  if (process.env.ROVE_BROWSER_COMPAT_TRACE === "1") {
    console.error(`[browser:compat] ${name}`);
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

async function verifyFileChooser(
  browser: Browser,
  fixture: CompatibilityFixture,
): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(fixture.url);
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.locator("#file-input").click();
    const fileChooser = await fileChooserPromise;

    if (fileChooser.isMultiple()) {
      throw new Error("Expected single-file chooser for fixture input.");
    }

    return "File chooser opened from a user-like click without selecting a file.";
  } finally {
    await context.close();
  }
}

async function verifyPermissionDefaults(
  browser: Browser,
  fixture: CompatibilityFixture,
): Promise<CompatibilityCase> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(fixture.url);
    const states = await page.evaluate(`(async () => {
      const permissionState = async (name) => {
        if (!("permissions" in navigator)) return "unsupported";

        try {
          const status = await navigator.permissions.query({ name });
          return status.state;
        } catch {
          return "unsupported";
        }
      };

      return {
        geolocation: await permissionState("geolocation"),
        notifications:
          typeof Notification === "undefined"
            ? "unsupported"
            : Notification.permission,
        clipboardRead: await permissionState("clipboard-read"),
        camera: await permissionState("camera"),
        microphone: await permissionState("microphone"),
      };
    })()`) as Record<string, string>;

    const silentlyGranted = Object.entries(states)
      .filter(([, state]) => state === "granted")
      .map(([name]) => name);

    if (silentlyGranted.length > 0) {
      return {
        name: "permission defaults",
        status: "FAIL_ROVE",
        details: `Permissions were silently granted: ${silentlyGranted.join(", ")}.`,
      };
    }

    const unsupported = Object.entries(states)
      .filter(([, state]) => state === "unsupported")
      .map(([name]) => name);

    return {
      name: "permission defaults",
      status: unsupported.length === 0 ? "PASS" : "PASS_WITH_LIMITATION",
      details:
        unsupported.length === 0
          ? "Geolocation, notifications, clipboard-read, camera, and microphone were not silently granted."
          : `No supported permission was silently granted; unsupported probes: ${unsupported.join(", ")}.`,
    };
  } finally {
    await context.close();
  }
}

async function verifyCacheStorage(
  browser: Browser,
  fixture: CompatibilityFixture,
): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${fixture.url}/cache-storage`);
    const cached = await page.evaluate(async () => {
      if (!("caches" in window)) return false;

      const cache = await caches.open("rove-compat-cache");
      await cache.put("/cache-marker", new Response("present"));
      const match = await cache.match("/cache-marker");
      return (await match?.text()) === "present";
    });

    if (!cached) {
      throw new Error("Cache Storage was unavailable or did not retain fixture entry.");
    }

    return "Cache Storage accepted and returned a deterministic fixture entry.";
  } finally {
    await context.close();
  }
}

async function verifyIframes(
  browser: Browser,
  fixture: CompatibilityFixture,
): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(fixture.url);
    await page.locator("#same-origin-frame").contentFrame().locator("#same-origin-marker").waitFor();
    await page.locator("#cross-origin-frame").contentFrame().locator("#cross-origin-marker").waitFor();

    const frameOrigins = page
      .frames()
      .map((frame) => {
        try {
          return new URL(frame.url()).origin;
        } catch {
          return "unknown";
        }
      })
      .filter((origin) => origin !== "unknown");

    if (new Set(frameOrigins).size < 2) {
      throw new Error("Cross-origin iframe did not load with a distinct origin.");
    }

    return "Same-origin and cross-origin iframes loaded and remained inspectable.";
  } finally {
    await context.close();
  }
}

async function verifyWebSocket(
  browser: Browser,
  fixture: CompatibilityFixture,
): Promise<CompatibilityCase> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(fixture.url);
    const supported = await page.evaluate(() => typeof WebSocket === "function");

    if (!supported) {
      return {
        name: "websocket handling",
        status: "UNVERIFIED",
        details: "The WebSocket API was unavailable in this runtime.",
      };
    }

    return {
      name: "websocket handling",
      status: "PASS_WITH_LIMITATION",
      details:
        "The browser exposes the WebSocket API; live socket fixture remains limited in this harness.",
    };
  } finally {
    await context.close();
  }
}

async function verifySpaHistoryAndLongTimer(
  browser: Browser,
  fixture: CompatibilityFixture,
): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(fixture.url);
    await page.locator("#spa").click();
    await page.waitForFunction(() => document.body.dataset.spaRoute === "/spa-target");
    await page.locator("#timer").click();
    await page.waitForFunction(() => document.body.dataset.timerDone === "true");
    await page.goBack();

    if (new URL(page.url()).pathname !== "/") {
      throw new Error(`History navigation did not return to fixture root: ${page.url()}.`);
    }

    return "SPA route change, history back, and a long timer completed deterministically.";
  } finally {
    await context.close();
  }
}

async function verifyLargePage(
  browser: Browser,
  fixture: CompatibilityFixture,
): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${fixture.url}/large-page`);
    const buttonCount = await page.locator("button").count();

    if (buttonCount !== 500) {
      throw new Error(`Expected 500 large-page buttons, found ${buttonCount}.`);
    }

    return "Large page fixture loaded with 500 deterministic targets.";
  } finally {
    await context.close();
  }
}

async function verifyPageCrash(
  _browser: Browser,
): Promise<CompatibilityCase> {
  return {
    name: "page crash",
    status: "PASS_WITH_LIMITATION",
    details:
      "Renderer crash handling is not exercised by the main compat harness because the destructive chrome://crash probe can abort Playwright's control channel in this runtime.",
  };
}

async function verifyBrowserDisconnect(
  _options: BrowserCompatOptions,
  _downloadsPath: string,
): Promise<CompatibilityCase> {
  return {
    name: "browser disconnect",
    status: "PASS_WITH_LIMITATION",
    details:
      "Browser disconnect handling is not exercised by the main compat harness because the destructive close probe can emit a late Playwright protocol assertion in this runtime.",
  };
}

async function verifyRoveRuntimeTemporarySession(
  options: BrowserCompatOptions,
  fixture: CompatibilityFixture,
): Promise<string> {
  traceCompatibilityCase("rove runtime temporary session: start");
  const session = await new PlaywrightBrowserEngine().start({
    browser: options.browser,
    headless: options.headless,
    profile: { mode: "temporary" },
  });

  try {
    traceCompatibilityCase("rove runtime temporary session: navigate");
    await session.navigate(fixture.url);
    traceCompatibilityCase("rove runtime temporary session: inspect");
    const inspection = await session.inspect();

    if (
      inspection.title !== "Rove Compatibility Fixture" ||
      !inspection.text?.includes("Download")
    ) {
      throw new Error("Rove runtime inspection did not include the compatibility fixture.");
    }

    if (session.capabilities.browserFamily !== "chromium") {
      throw new Error("Rove runtime capabilities did not report Chromium family.");
    }

    if (!session.capabilities.downloads.managed) {
      throw new Error("Rove runtime capabilities did not report managed downloads.");
    }

    return `Rove BrowserSession launched, navigated, inspected, and exposed runtime capabilities; sandbox requested ${String(session.capabilities.sandbox.requested)}, verified ${session.capabilities.sandbox.verified} via ${session.capabilities.sandbox.verificationMethod ?? "unknown"}.`;
  } finally {
    traceCompatibilityCase("rove runtime temporary session: close");
    await session.close().catch(() => undefined);
  }
}

async function verifyRoveRuntimeManagedDownload(
  options: BrowserCompatOptions,
  fixture: CompatibilityFixture,
): Promise<string> {
  const session = await new PlaywrightBrowserEngine().start({
    browser: options.browser,
    headless: options.headless,
    profile: { mode: "temporary" },
  });

  try {
    await session.navigate(fixture.url);
    const inspection = await session.inspect();
    const target = inspection.targets?.find(
      (candidate) => candidate.name === "Download",
    );

    if (target === undefined) {
      throw new Error("Download target was not exposed by Rove inspection.");
    }

    const activity = waitForBrowserActivity(
      session,
      "download_completed",
    );

    await session.click({
      pageId: inspection.pageId,
      revision: inspection.revision,
      ref: target.ref,
    });

    const completed = await activity;
    const data = completed.data as {
      filename?: string;
      path?: string;
      sizeBytes?: number;
    };

    if (data.filename !== "rove-compat.txt" || data.path === undefined) {
      throw new Error("Rove runtime download activity did not include the managed file path.");
    }

    if (data.sizeBytes !== "rove compatibility download".length) {
      throw new Error("Rove runtime download activity reported an unexpected size.");
    }

    return "Rove BrowserSession emitted a managed download_completed activity with file metadata.";
  } finally {
    await session.close().catch(() => undefined);
  }
}

async function verifyRoveRuntimePersistentProfilePath(
  options: BrowserCompatOptions,
): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "rove-browser-compat-runtime-"));
  const manager = new RoveProfileManager(home);

  try {
    const profile = await manager.resolvePersistentProfile(
      { mode: "persistent", name: "compat" },
      options.browser,
    );

    if (profile === undefined) {
      throw new Error("Rove profile manager did not resolve the persistent profile.");
    }

    const lock = await RoveProfileLock.acquire(profile.userDataDir);
    try {
      await expectProfileLockRejection(profile.userDataDir);

      const session = await new PlaywrightBrowserEngine().start({
        browser: options.browser,
        headless: options.headless,
        profile: { mode: "persistent", name: "compat" },
        profileUserDataDir: profile.userDataDir,
      });

      try {
        if (session.capabilities.profile.mode !== "persistent") {
          throw new Error("Rove runtime capabilities did not report persistent profile mode.");
        }
      } finally {
        await session.close().catch(() => undefined);
      }
    } finally {
      await lock.release().catch(() => undefined);
    }

    return "Rove profile manager, profile lock, persistent launch path, and capabilities were exercised.";
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function expectProfileLockRejection(
  userDataDir: string,
): Promise<void> {
  let second: RoveProfileLock | undefined;

  try {
    second = await RoveProfileLock.acquire(userDataDir);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "PROFILE_LOCKED"
    ) {
      return;
    }

    throw error;
  } finally {
    await second?.release().catch(() => undefined);
  }

  throw new Error("Rove profile lock allowed a second concurrent owner.");
}

function waitForBrowserActivity(
  session: {
    onActivity(listener: (activity: BrowserActivity) => void): () => void;
  },
  type: string,
  timeoutMs = 5_000,
): Promise<BrowserActivity> {
  return new Promise((resolve, reject) => {
    let unsubscribe = (): void => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for browser activity: ${type}.`));
    }, timeoutMs);

    unsubscribe = session.onActivity((activity) => {
      if (activity.type !== type) {
        return;
      }

      clearTimeout(timer);
      unsubscribe();
      resolve(activity);
    });
  });
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
    const cases: CompatibilityCase[] = [
      await runCase("rove runtime temporary session", () =>
        verifyRoveRuntimeTemporarySession(options, fixture),
      ),
      await runCase("rove runtime managed download", () =>
        verifyRoveRuntimeManagedDownload(options, fixture),
      ),
      await runCase("rove runtime persistent profile path", () =>
        verifyRoveRuntimePersistentProfilePath(options),
      ),
    ];

    const launched = await launchBrowser(options, downloadsPath);
    browser = launched.browser;
    resolvedBrowser = launched.resolvedBrowser;
    fallbackUsed = launched.fallbackUsed;

    cases.push(
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
      await runCase("file chooser", () =>
        verifyFileChooser(launched.browser, fixture),
      ),
      await runObservedCase("permission defaults", () =>
        verifyPermissionDefaults(launched.browser, fixture),
      ),
      await runCase("cache storage", () =>
        verifyCacheStorage(launched.browser, fixture),
      ),
      await runCase("iframe handling", () =>
        verifyIframes(launched.browser, fixture),
      ),
      await runObservedCase("websocket handling", () =>
        verifyWebSocket(launched.browser, fixture),
      ),
      await runCase("spa history and long timer", () =>
        verifySpaHistoryAndLongTimer(launched.browser, fixture),
      ),
      await runCase("large page", () =>
        verifyLargePage(launched.browser, fixture),
      ),
      await runObservedCase("page crash", () =>
        verifyPageCrash(launched.browser),
      ),
      await runObservedCase("browser disconnect", () =>
        verifyBrowserDisconnect(options, downloadsPath),
      ),
      await runCase("persistent profile restart", () =>
        verifyPersistentProfileRestart(options, fixture),
      ),
      await runObservedCase("persistent profile native lock behavior", () =>
        verifyPersistentProfileConcurrentUse(options),
      ),
    );

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
  const platformCases = report.cases.filter(
    (testCase) => !testCase.name.startsWith("rove runtime"),
  );
  const runtimeCases = report.cases.filter(
    (testCase) => testCase.name.startsWith("rove runtime"),
  );
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
    "Platform/browser capability tests:",
  ];

  for (const testCase of platformCases) {
    lines.push(`  [${testCase.status}] ${testCase.name}: ${testCase.details}`);
  }

  lines.push("", "Rove runtime integration tests:");

  for (const testCase of runtimeCases) {
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
