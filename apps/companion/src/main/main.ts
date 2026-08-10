import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  type MenuItemConstructorOptions,
} from "electron";
import { loadConfig } from "@rove/config";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";

import { companionIpcChannels } from "../shared/desktop-api.js";
import { DesktopHost } from "./host/desktop-host.js";
import { CompanionRuntimeClient } from "./runtime-client.js";
import { CompanionSurface } from "./surface/companion-surface.js";
import { toCompanionSurfaceSignal } from "./surface/session-surface-signal.js";
import { companionWindowOptions } from "./window-options.js";

const rootEnv = resolve(process.cwd(), "../../.env");

if (existsSync(rootEnv)) {
  loadEnvFile(rootEnv);
}

const config = loadConfig();

const manageServices =
  process.argv.includes("--rove-manage-services") ||
  process.argv.includes("--rove-manage-runtime");

let desktopHost: DesktopHost | undefined;

let companionSurface: CompanionSurface | undefined;

let sessionSurfaceMonitor: NodeJS.Timeout | undefined;

let sessionSurfaceMonitorBusy = false;

let allowQuit = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();

function createCompanionWindow(): BrowserWindow {
  const window = new BrowserWindow(companionWindowOptions(import.meta.dirname));

  const developmentUrl = process.env.ROVE_COMPANION_DEV_URL;

  if (developmentUrl !== undefined) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(
      join(import.meta.dirname, "../../renderer/index.html"),
    );
  }

  return window;
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

function installApplicationMenu(surface: CompanionSurface): void {
  const surfaceItems: MenuItemConstructorOptions[] = [
    {
      label: "Show Companion",
      accelerator: "CmdOrCtrl+Shift+R",
      click: () => surface.restore(),
    },
    {
      label: "Hide Companion",
      click: () => surface.hide(),
    },
  ];

  const template: MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          {
            label: "Rove",
            submenu: [
              {
                role: "about",
              },
              {
                type: "separator",
              },
              ...surfaceItems,
              {
                type: "separator",
              },
              {
                role: "quit",
              },
            ],
          },
          {
            label: "Window",
            submenu: [
              {
                role: "minimize",
              },
              {
                role: "zoom",
              },
              {
                type: "separator",
              },
              {
                label: "Show Companion",
                accelerator: "CmdOrCtrl+Shift+R",
                click: () => surface.restore(),
              },
            ],
          },
        ]
      : [
          {
            label: "Rove",
            submenu: [
              ...surfaceItems,
              {
                type: "separator",
              },
              {
                role: "quit",
              },
            ],
          },
        ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function stopSessionSurfaceMonitor(): void {
  if (sessionSurfaceMonitor !== undefined) {
    clearInterval(sessionSurfaceMonitor);

    sessionSurfaceMonitor = undefined;
  }
}

function startSessionSurfaceMonitor(
  runtime: CompanionRuntimeClient,
  surface: CompanionSurface,
): void {
  stopSessionSurfaceMonitor();

  let previousSignalKey: string | undefined;

  const inspect = async () => {
    if (sessionSurfaceMonitorBusy) {
      return;
    }

    sessionSurfaceMonitorBusy = true;

    try {
      const session = await runtime.getActiveSession();

      const signal = toCompanionSurfaceSignal(session);

      if (signal !== null && signal.key !== previousSignalKey) {
        if (signal.action === "attention") {
          surface.requestAttention();
        } else {
          surface.show();
        }
      }

      previousSignalKey = signal?.key;
    } catch {
      previousSignalKey = undefined;
    } finally {
      sessionSurfaceMonitorBusy = false;
    }
  };

  void inspect();

  sessionSurfaceMonitor = setInterval(() => void inspect(), 750);

  sessionSurfaceMonitor.unref();
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

  if (manageServices) {
    const runtimeDirectory =
      process.env.ROVE_DESKTOP_RUNTIME_DIR ??
      resolve(process.cwd(), "../runtime");

    const mcpDirectory =
      process.env.ROVE_DESKTOP_MCP_DIR ?? resolve(process.cwd(), "../mcp");

    desktopHost = new DesktopHost({
      runtimeDirectory,
      mcpDirectory,
      home: config.home,
      browserHeadless: config.browser.headless,
      browser: config.browser.preferredBrowser,
      ...(config.browser.executablePath === undefined
        ? {}
        : {
            browserExecutablePath: config.browser.executablePath,
          }),
    });

    const connection = await desktopHost.start();

    console.info(
      `[desktop] Browser resolved: ${connection.browser.kind} (${connection.browser.source})${
        connection.browser.executablePath === undefined
          ? ""
          : ` -> ${connection.browser.executablePath}`
      }`,
    );

    runtime = new CompanionRuntimeClient(
      runtimeClientOptions(
        connection.runtime.baseUrl,
        connection.runtime.token,
      ),
    );
  } else {
    runtime = new CompanionRuntimeClient(
      runtimeClientOptions(config.runtime.url, config.runtime.token),
    );
  }

  registerIpc(runtime);

  companionSurface = new CompanionSurface(
    createCompanionWindow,
    () => allowQuit,
  );

  installApplicationMenu(companionSurface);

  companionSurface.show();

  startSessionSurfaceMonitor(runtime, companionSurface);
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    companionSurface?.restore();
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
  companionSurface?.restore();
});

app.on("before-quit", (event) => {
  stopSessionSurfaceMonitor();

  if (allowQuit) {
    return;
  }

  allowQuit = true;

  if (desktopHost === undefined) {
    return;
  }

  event.preventDefault();

  void desktopHost
    .stop()
    .catch((error) => {
      console.error("Rove Desktop shutdown failed.", error);
    })
    .finally(() => {
      app.quit();
    });
});
