import { app, BrowserWindow, ipcMain, nativeImage } from "electron";
import { loadConfig } from "@rove/config";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";

import { companionIpcChannels } from "../shared/desktop-api.js";
import { DesktopHost } from "./host/desktop-host.js";
import { CompanionRuntimeClient } from "./runtime-client.js";
import { companionWindowOptions } from "./window-options.js";

const rootEnv = resolve(process.cwd(), "../../.env");

if (existsSync(rootEnv)) {
  loadEnvFile(rootEnv);
}

const config = loadConfig();

const manageRuntime = process.argv.includes("--rove-manage-runtime");

let companionWindow: BrowserWindow | undefined;

let desktopHost: DesktopHost | undefined;

let allowQuit = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();

function focusCompanion(): void {
  const window = companionWindow;

  if (window === undefined) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  window.focus();
}

function createWindow(): void {
  const window = new BrowserWindow(companionWindowOptions(import.meta.dirname));

  companionWindow = window;

  window.once("closed", () => {
    if (companionWindow === window) {
      companionWindow = undefined;
    }
  });

  const developmentUrl = process.env.ROVE_COMPANION_DEV_URL;

  if (developmentUrl !== undefined) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(
      join(import.meta.dirname, "../../renderer/index.html"),
    );
  }
}

function registerIpc(runtime: CompanionRuntimeClient): void {
  ipcMain.handle(companionIpcChannels.snapshot, () => runtime.getSnapshot());

  ipcMain.handle(companionIpcChannels.takeControl, () => runtime.takeControl());

  ipcMain.handle(companionIpcChannels.returnControl, () =>
    runtime.returnControl(),
  );

  ipcMain.handle(companionIpcChannels.finishSession, () =>
    runtime.finishSession(),
  );
}

function runtimeClientOptions(baseUrl: string, token?: string) {
  return {
    baseUrl,
    ...(token === undefined ? {} : { token }),
    ...(process.env.ROVE_COMPANION_SESSION_ID === undefined
      ? {}
      : {
          sessionId: process.env.ROVE_COMPANION_SESSION_ID,
        }),
  };
}

async function startDesktop(): Promise<void> {
  if (process.platform === "darwin") {
    const iconPath = join(
      import.meta.dirname,
      "../../../resources/rove-app-icon.png",
    );

    const icon = nativeImage.createFromPath(iconPath);

    if (!icon.isEmpty() && app.dock !== undefined) {
      app.dock.setIcon(icon);
    }
  }

  let runtime: CompanionRuntimeClient;

  if (manageRuntime) {
    const runtimeDirectory =
      process.env.ROVE_DESKTOP_RUNTIME_DIR ??
      resolve(process.cwd(), "../runtime");

    desktopHost = new DesktopHost({
      runtimeDirectory,
      home: config.home,
      browserHeadless: config.browser.headless,
      browser: config.browser.preferredBrowser,
    });

    const connection = await desktopHost.start();

    runtime = new CompanionRuntimeClient(
      runtimeClientOptions(connection.baseUrl, connection.token),
    );
  } else {
    runtime = new CompanionRuntimeClient(
      runtimeClientOptions(config.runtime.url, config.runtime.token),
    );
  }

  registerIpc(runtime);
  createWindow();
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (companionWindow === undefined) {
      createWindow();
    }

    focusCompanion();
  });

  app
    .whenReady()
    .then(startDesktop)
    .catch((error) => {
      console.error("Rove Desktop failed to start.", error);

      app.quit();
    });
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    return;
  }

  focusCompanion();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (desktopHost === undefined || allowQuit) {
    return;
  }

  event.preventDefault();

  allowQuit = true;

  void desktopHost
    .stop()
    .catch((error) => {
      console.error("Rove Runtime shutdown failed.", error);
    })
    .finally(() => {
      app.quit();
    });
});
