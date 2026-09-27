#!/usr/bin/env node
/* global console */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { BrowserFollowController } from "../../apps/companion/dist/main/main/surface/browser-follow-controller.js";
import { NativeBrowserFollowForegroundSource } from "../../apps/companion/dist/main/main/surface/native-browser-follow-foreground-source.js";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const rendererRoot = resolve(repositoryRoot, "apps/companion/dist/renderer");
const fixtureMain = resolve(
  repositoryRoot,
  "experiments/agent-execution/electron-private-beta-walkthrough-fixture.cjs",
);
const unrelatedFixtureMain = resolve(
  repositoryRoot,
  "experiments/agent-execution/electron-unrelated-foreground-fixture.cjs",
);
const requireBrowser = createRequire(
  resolve(repositoryRoot, "packages/browser/package.json"),
);
const requireCompanion = createRequire(
  resolve(repositoryRoot, "apps/companion/package.json"),
);
const { _electron: electron, chromium } = requireBrowser("playwright");
const electronExecutable = requireCompanion("electron");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function foregroundBrowserPid(source, page) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.bringToFront();
    const pid = await source.getForegroundProcessId({ aborted: false });
    if (pid !== null) {
      const command = execFileSync(
        "ps",
        ["-p", String(pid), "-o", "command="],
        { encoding: "utf8" },
      ).trim();
      if (/Chrom(e|ium)|playwright/i.test(command)) return pid;
    }
    await delay(100);
  }
  throw new Error(
    "Launched Chromium never became the native foreground window.",
  );
}

async function foregroundExactPid(source, page, expectedPid, label) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.bringToFront();
    const pid = await source.getForegroundProcessId({ aborted: false });
    if (pid === expectedPid) return pid;
    await delay(100);
  }
  throw new Error(`${label} never became the exact native foreground process.`);
}

const session = {
  id: "ses_native_surface",
  mode: "agent",
  status: "active",
  controller: "agent",
  profile: { mode: "temporary" },
  createdAt: "2026-09-27T10:00:00.000Z",
  updatedAt: "2026-09-27T10:00:00.000Z",
};

let application;
let unrelatedApplication;
let browser;
try {
  application = await electron.launch({
    executablePath: electronExecutable,
    cwd: repositoryRoot,
    args: [fixtureMain],
    env: { ...process.env, ROVE_JOURNEY_RENDERER_ROOT: rendererRoot },
  });
  const rovePage = await application.firstWindow({ timeout: 30_000 });
  await rovePage.locator(".product-app").waitFor();

  browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
  await page.setContent(
    "<title>Rove native surface fixture</title><main><h1>Task-owned browser fixture</h1></main>",
  );
  await page.bringToFront();
  await page.waitForTimeout(300);

  const foreground = new NativeBrowserFollowForegroundSource();
  const browserPid = await foregroundBrowserPid(foreground, page);
  const cdp = await page.context().newCDPSession(page);
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  const { bounds } = await cdp.send("Browser.getWindowBounds", { windowId });
  assert(
    typeof bounds.left === "number" &&
      typeof bounds.top === "number" &&
      typeof bounds.width === "number" &&
      typeof bounds.height === "number",
    "Chromium did not expose usable native window bounds.",
  );

  let fullSurfaceVisible = true;
  let followerVisible = false;
  const surface = {
    isFollowEnabled: () => true,
    isFocused: () => false,
    isVisible: () => followerVisible,
    followPresentation: () => ({
      mode: "windowed_compact",
      size: { width: 64, height: 56 },
    }),
    preferredPosition: () => null,
    resetUserPlacement: () => undefined,
    showInactiveAt: () => {
      followerVisible = true;
    },
    hideFollower: () => {
      followerVisible = false;
    },
  };
  const controller = new BrowserFollowController(
    {
      getBrowserWindowState: async () => ({
        windowId,
        pageId: "page_native_surface",
        windowState: "normal",
        bounds: {
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
        },
        documentFocused: true,
      }),
    },
    {
      getAllDisplays: () => [
        {
          id: 1,
          bounds: {
            x: bounds.left,
            y: bounds.top,
            width: bounds.width,
            height: bounds.height,
          },
          workArea: {
            x: bounds.left,
            y: bounds.top,
            width: bounds.width,
            height: bounds.height,
          },
        },
      ],
    },
    surface,
    {
      browserIdentity: {
        getBrowserHostIdentity: async () => ({
          kind: "owned_process",
          processId: browserPid,
        }),
      },
      foreground,
      onOwnedBrowserForeground: () => {
        fullSurfaceVisible = false;
      },
    },
  );
  controller.setSession(session);
  await controller.reconcileNow();
  assert(
    !fullSurfaceVisible,
    "Rove full surface did not yield after viable placement.",
  );
  assert(
    followerVisible,
    "Browser follower was not presented on the owned browser.",
  );

  unrelatedApplication = await electron.launch({
    executablePath: electronExecutable,
    cwd: repositoryRoot,
    args: [unrelatedFixtureMain],
  });
  const unrelatedPage = await unrelatedApplication.firstWindow({
    timeout: 30_000,
  });
  const unrelatedPid = unrelatedApplication.process().pid;
  assert(
    Number.isInteger(unrelatedPid) &&
      unrelatedPid > 0 &&
      unrelatedPid !== browserPid,
    "Unrelated application did not have an independent process identity.",
  );
  await foregroundExactPid(
    foreground,
    unrelatedPage,
    unrelatedPid,
    "Unrelated application",
  );
  await controller.reconcileNow();
  assert(
    !followerVisible,
    "Browser follower remained visible after an unrelated application became foreground.",
  );

  await foregroundBrowserPid(foreground, page);
  await controller.reconcileNow();
  assert(
    followerVisible,
    "Browser follower did not recover after the owned browser returned to foreground.",
  );

  console.log(
    JSON.stringify({
      status: "qualified",
      browserForegroundPid: browserPid,
      browserProcessQualified: true,
      exactPageId: "page_native_surface",
      viableTransfer: true,
      unrelatedForegroundPid: unrelatedPid,
      unrelatedForegroundRevocation: "qualified",
      ownedBrowserForegroundRecovery: true,
    }),
  );
} finally {
  await unrelatedApplication?.close();
  await browser?.close();
  await application?.close();
}
