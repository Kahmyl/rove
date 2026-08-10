import {
  app,
  BrowserWindow,
  ipcMain,
} from "electron";
import { loadConfig } from "@rove/config";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";

import {
  companionIpcChannels,
} from "../shared/desktop-api.js";
import { CompanionRuntimeClient } from "./runtime-client.js";
import { companionWindowOptions } from "./window-options.js";

const rootEnv = resolve(process.cwd(), "../../.env");

if (existsSync(rootEnv)) {
  loadEnvFile(rootEnv);
}

const config = loadConfig();

const runtime = new CompanionRuntimeClient({
  baseUrl: config.runtime.url,
  ...(config.runtime.token === undefined
    ? {}
    : { token: config.runtime.token }),
  ...(process.env.ROVE_COMPANION_SESSION_ID === undefined
    ? {}
    : {
        sessionId:
          process.env.ROVE_COMPANION_SESSION_ID,
      }),
});

function createWindow(): void {
  const window = new BrowserWindow(
    companionWindowOptions(import.meta.dirname),
  );

  const developmentUrl =
    process.env.ROVE_COMPANION_DEV_URL;

  if (developmentUrl !== undefined) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(
      join(
        import.meta.dirname,
        "../../renderer/index.html",
      ),
    );
  }
}

function registerIpc(): void {
  ipcMain.handle(
    companionIpcChannels.snapshot,
    () => runtime.getSnapshot(),
  );

  ipcMain.handle(
    companionIpcChannels.takeControl,
    () => runtime.takeControl(),
  );

  ipcMain.handle(
    companionIpcChannels.returnControl,
    () => runtime.returnControl(),
  );

  ipcMain.handle(
    companionIpcChannels.finishSession,
    () => runtime.finishSession(),
  );
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
