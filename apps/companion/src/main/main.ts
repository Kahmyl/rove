import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
  type MenuItemConstructorOptions,
} from "electron";
import { loadConfig } from "@rove/config";
import type { Session } from "@rove/protocol";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";

import { companionIpcChannels } from "../shared/desktop-api.js";
import { DesktopHost } from "./host/desktop-host.js";
import { CompanionRuntimeClient } from "./runtime-client.js";
import { CompanionSurface } from "./surface/companion-surface.js";
import { toCompanionSurfaceSignal } from "./surface/session-surface-signal.js";
import { toTrayStatusLabel } from "./surface/tray-state.js";
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

let desktopTray: Tray | undefined;

let trayStatusLabel = "";

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

function trayIconPath(): string {
  return join(import.meta.dirname, "../../../resources/rove-tray-icon.png");
}

function updateTrayMenu(
  tray: Tray,
  surface: CompanionSurface,
  session: Session | null,
): void {
  const status = toTrayStatusLabel(session);

  if (status === trayStatusLabel) {
    return;
  }

  trayStatusLabel = status;

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: `Rove — ${status}`,
        enabled: false,
      },
      {
        type: "separator",
      },
      {
        label: "Show Companion",
        click: () => surface.restore(),
      },
      {
        label: "Hide Companion",
        click: () => surface.hide(),
      },
      {
        type: "separator",
      },
      {
        label: "Quit Rove",
        click: () => app.quit(),
      },
    ]),
  );
}

function installTray(surface: CompanionSurface): Tray {
  const icon = nativeImage.createFromPath(trayIconPath());

  if (icon.isEmpty()) {
    throw new Error("Rove tray icon could not be loaded.");
  }

  if (process.platform === "darwin") {
    icon.setTemplateImage(true);
  }

  const tray = new Tray(icon);

  tray.setToolTip("Rove");

  tray.on("click", () => {
    surface.restore();
  });

  trayStatusLabel = "";
  updateTrayMenu(tray, surface, null);

  return tray;
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
  onSession?: (session: Session | null) => void,
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

      onSession?.(session);

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

  const surface = new CompanionSurface(createCompanionWindow, () => allowQuit);

  companionSurface = surface;

  installApplicationMenu(surface);

  desktopTray = installTray(surface);

  surface.show();

  startSessionSurfaceMonitor(runtime, surface, (session) => {
    if (desktopTray !== undefined) {
      updateTrayMenu(desktopTray, surface, session);
    }
  });
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

  desktopTray?.destroy();
  desktopTray = undefined;

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
