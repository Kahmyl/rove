import { app, BrowserWindow, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DesktopSurfaceSnapshot } from "../../shared/desktop-api.js";
import { companionIpcChannels } from "../../shared/desktop-api.js";
import { RUNTIME_CONFIGURATION_WARNING } from "../runtime-failure-containment.js";
import { companionWindowOptions } from "../window-options.js";

const fixturePath = process.env.ROVE_STARTUP_HYDRATION_FIXTURE;
if (fixturePath === undefined)
  throw new Error("ROVE_STARTUP_HYDRATION_FIXTURE is required.");

const scenario =
  process.env.ROVE_STARTUP_HYDRATION_SCENARIO === "degraded"
    ? "degraded"
    : "healthy";
const mainDirectory = resolve(import.meta.dirname, "..");

const initialSnapshot: DesktopSurfaceSnapshot = {
  revision: 1,
  surface: {
    presentation: "full",
    browserContext: "windowed",
    activeHost: "control_center",
    returnPresentation: "chip",
    revision: 1,
  },
  companion: null,
  notice: null,
  workspaces: { workspaces: [] },
  product: null,
  productError: null,
};

let snapshot = initialSnapshot;
ipcMain.handle(companionIpcChannels.windowFullscreen, () => false);
ipcMain.handle(companionIpcChannels.surfaceSnapshot, () => snapshot);
ipcMain.handle(companionIpcChannels.surfaceTransition, () => snapshot);

void app.whenReady().then(async () => {
  const window = new BrowserWindow(companionWindowOptions(mainDirectory));
  await window.loadFile(resolve(mainDirectory, "../../renderer/index.html"));
  window.show();

  setTimeout(() => {
    void readFile(fixturePath, "utf8")
      .then((source) => {
        const product = JSON.parse(source) as NonNullable<
          DesktopSurfaceSnapshot["product"]
        >;
        snapshot = {
          ...initialSnapshot,
          revision: 2,
          product: {
            ...product,
            recoveryWarnings:
              scenario === "degraded" ? [RUNTIME_CONFIGURATION_WARNING] : [],
          },
        };
        window.webContents.send(companionIpcChannels.surfaceChanged, snapshot);
      })
      .catch((error: unknown) => {
        snapshot = {
          ...initialSnapshot,
          revision: 2,
          productError:
            error instanceof Error
              ? error.message
              : "Fixture hydration failed.",
        };
        window.webContents.send(companionIpcChannels.surfaceChanged, snapshot);
      });
  }, 750).unref();
});

app.on("window-all-closed", () => app.quit());
