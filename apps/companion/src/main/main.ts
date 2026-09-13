import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from "electron";
import { loadConfig } from "@rove/config";
import type { Session } from "@rove/protocol";
import { FileRecordingStore } from "@rove/storage";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";

import {
  companionIpcChannels,
  toDesktopSession,
  type DesktopSurfaceSnapshot,
  type DesktopNotice,
  type CompanionSnapshot,
  toDesktopBrowserWorkspaceStatus,
  type UnifiedSurfaceTransition,
} from "../shared/desktop-api.js";
import { DesktopHost } from "./host/desktop-host.js";
import { DesktopQuitBarrier } from "./host/desktop-quit-barrier.js";
import { stopDesktopComponents } from "./host/desktop-shutdown.js";
import { HubConnector } from "./host/hub-connector.js";
import { createLocalFileGrantAuthority } from "./host/local-file-grant.js";
import { resolveDesktopServiceLayout } from "./host/service-layout.js";
import {
  COMPACT_FOLLOWER_HEIGHT,
  COMPACT_FOLLOWER_WIDTH,
  EXPANDED_FOLLOWER_HEIGHT,
  EXPANDED_FOLLOWER_WIDTH,
  FULLSCREEN_MICRO_FOLLOWER_HEIGHT,
  FULLSCREEN_MICRO_FOLLOWER_WIDTH,
  compactFollowerWindowOptions,
} from "./compact-follower-window-options.js";
import { CompanionRuntimeClient } from "./runtime-client.js";
import { resolveDesktopProductHome } from "./desktop-product-home.js";
import { endUnmatchedRuntimeSession } from "./unmatched-runtime-session.js";
import type { RuntimeCompanionSnapshot } from "./runtime-client.js";
import {
  BrowserFollowController,
  type BrowserFollowSurface,
} from "./surface/browser-follow-controller.js";
import { CompactFollowerSurface } from "./surface/compact-follower-surface.js";
import { CompanionSurface } from "./surface/companion-surface.js";
import { createElectronBrowserFollowDisplaySource } from "./surface/electron-browser-follow-display-source.js";
import { NativeBrowserFollowForegroundSource } from "./surface/native-browser-follow-foreground-source.js";
import { toCompanionSurfaceSignal } from "./surface/session-surface-signal.js";
import { toTrayStatusLabel } from "./surface/tray-state.js";
import {
  UnifiedSurfaceCoordinator,
  UnifiedSurfaceStateMachine,
} from "./surface/unified-surface-state.js";
import { companionWindowOptions } from "./window-options.js";
import { COMPANION_PROVENANCE } from "./component-provenance.js";
import { CodexExecutionCore } from "./codex/execution-core.js";
import {
  TaskAttachmentAuthority,
  type UserFilePicker,
} from "./codex/task-attachments.js";
import {
  validateTrustedExternalUrl,
  type TrustedExternalIntent,
} from "./codex/local-product-api.js";
import { createProductIntentIpcHandler } from "./codex/product-intent-ipc.js";
import { DesktopSnapshotCoordinator } from "./desktop-snapshot-coordinator.js";

const rootEnv = resolve(process.cwd(), "../../.env");

if (existsSync(rootEnv)) {
  loadEnvFile(rootEnv);
}

const config = loadConfig();

const manageServices =
  app.isPackaged ||
  process.argv.includes("--rove-manage-services") ||
  process.argv.includes("--rove-manage-runtime");

let desktopHost: DesktopHost | undefined;

let codexExecutionCore: CodexExecutionCore | undefined;

let codexExecutionCoreStarting = false;

let codexProductError: string | null = null;

let hubConnector: HubConnector | undefined;

let companionSurface: CompanionSurface | undefined;

let companionWindow: BrowserWindow | undefined;

let browserFollowController: BrowserFollowController | undefined;

let compactFollowerSurface: CompactFollowerSurface | undefined;

let compactFollowerWindow: BrowserWindow | undefined;

let unifiedSurfaceCoordinator: UnifiedSurfaceCoordinator | undefined;

const unifiedSurfaceState = new UnifiedSurfaceStateMachine();

let desktopSurfaceSnapshot: DesktopSurfaceSnapshot | undefined;

type DesktopSurfaceSnapshotValue = Omit<DesktopSurfaceSnapshot, "revision">;

const desktopSnapshotCoordinator =
  new DesktopSnapshotCoordinator<DesktopSurfaceSnapshotValue>((snapshot) => {
    desktopSurfaceSnapshot = snapshot;
    codexProductError = snapshot.productError;
    broadcastSurfaceSnapshot(snapshot);
  });

let desktopTray: Tray | undefined;

let trayStatusLabel = "";

let desktopNotice: DesktopNotice | null = null;

let lastLiveSession: Session | null = null;

let sessionSurfaceMonitor: NodeJS.Timeout | undefined;

let sessionSurfaceMonitorBusy = false;

let followerDragTracker: NodeJS.Timeout | undefined;

let allowQuit = false;

const desktopQuitBarrier = new DesktopQuitBarrier();

const hasSingleInstanceLock = app.requestSingleInstanceLock();

function broadcastSurfaceSnapshot(snapshot: DesktopSurfaceSnapshot): void {
  for (const window of [companionWindow, compactFollowerWindow]) {
    if (window !== undefined && !window.isDestroyed()) {
      window.webContents.send(companionIpcChannels.surfaceChanged, snapshot);
    }
  }
}

function projectCompanionSnapshot(
  value: RuntimeCompanionSnapshot | null,
): CompanionSnapshot | null {
  return value === null
    ? null
    : { ...value, session: toDesktopSession(value.session) };
}

async function refreshDesktopSurfaceSnapshot(
  runtime: CompanionRuntimeClient,
  companionOverride?: RuntimeCompanionSnapshot | null,
): Promise<DesktopSurfaceSnapshot> {
  return desktopSnapshotCoordinator.refresh(async () => {
    let nextProductError = codexProductError;
    const [companion, workspaces, product] = await Promise.all([
      companionOverride === undefined
        ? runtime.getSnapshot()
        : Promise.resolve(companionOverride),
      runtime.getBrowserWorkspaceStatus(),
      codexExecutionCore === undefined ||
      codexExecutionCoreStarting ||
      nextProductError !== null
        ? Promise.resolve(null)
        : codexExecutionCore
            .api()
            .readSnapshot()
            .catch((error) => {
              nextProductError =
                error instanceof Error ? error.message : String(error);
              return null;
            }),
    ]);
    return {
      surface: unifiedSurfaceState.snapshot(),
      companion: projectCompanionSnapshot(companion),
      notice: desktopNotice,
      workspaces: toDesktopBrowserWorkspaceStatus(workspaces),
      product,
      productError: nextProductError,
    };
  });
}

function publishSurfaceState(): void {
  desktopSnapshotCoordinator.patch((current) => ({
    surface: unifiedSurfaceState.snapshot(),
    companion: current.companion,
    notice: desktopNotice,
    workspaces: current.workspaces,
    product: current.product,
    productError: current.productError,
  }));
}

function transitionSurface(transition: UnifiedSurfaceTransition): void {
  unifiedSurfaceState.dispatch({ type: transition });
  unifiedSurfaceCoordinator?.present(unifiedSurfaceState.snapshot());
  publishSurfaceState();
}

function openFullSurface(): void {
  transitionSurface("open_full");
}

function closeFullSurface(): void {
  transitionSurface("close_full");
}

function stopFollowerDragTracking(): void {
  if (followerDragTracker !== undefined) {
    clearInterval(followerDragTracker);
    followerDragTracker = undefined;
  }

  compactFollowerSurface?.endDrag();
}

function startFollowerDragTracking(initial: { x: number; y: number }): void {
  if (followerDragTracker !== undefined) {
    clearInterval(followerDragTracker);
    followerDragTracker = undefined;
  }

  let lastCursor = initial;
  let lastMovementAt = Date.now();
  let moved = false;
  const startedAt = lastMovementAt;

  followerDragTracker = setInterval(() => {
    const follower = compactFollowerSurface;
    if (follower === undefined || !follower.isVisible()) {
      stopFollowerDragTracking();
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    if (cursor.x !== lastCursor.x || cursor.y !== lastCursor.y) {
      moved = true;
      lastCursor = cursor;
      lastMovementAt = Date.now();
      follower.updateDrag(cursor);
      return;
    }

    const now = Date.now();
    if ((moved && now - lastMovementAt >= 750) || now - startedAt >= 30_000) {
      stopFollowerDragTracking();
    }
  }, 16);

  followerDragTracker.unref();
}

function createCompanionWindow(): BrowserWindow {
  const window = new BrowserWindow(companionWindowOptions(import.meta.dirname));
  companionWindow = window;

  const publishFullscreen = (fullscreen: boolean) => {
    if (!window.webContents.isDestroyed())
      window.webContents.send(
        companionIpcChannels.windowFullscreenChanged,
        fullscreen,
      );
  };
  window.on("enter-full-screen", () => publishFullscreen(true));
  window.on("leave-full-screen", () => publishFullscreen(false));

  window.once("closed", () => {
    if (companionWindow === window) companionWindow = undefined;
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    if (allowQuit) {
      return;
    }

    console.error(
      `[desktop] Companion renderer exited (${details.reason}). Reloading.`,
    );

    const timer = setTimeout(() => {
      if (!allowQuit) {
        companionSurface?.recover();
      }
    }, 100);

    timer.unref();
  });

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

function createCompactFollowerWindow(): BrowserWindow {
  const window = new BrowserWindow(
    compactFollowerWindowOptions(import.meta.dirname, process.platform),
  );
  compactFollowerWindow = window;

  window.once("closed", () => {
    if (compactFollowerWindow === window) compactFollowerWindow = undefined;
  });

  if (process.platform === "darwin") {
    // A panel can join native fullscreen Spaces, but normal following must
    // remain scoped to the browser's current desktop context.
    window.setVisibleOnAllWorkspaces(false, {
      skipTransformProcessType: true,
    });
  }

  window.webContents.on("render-process-gone", (_event, details) => {
    if (allowQuit || window.isDestroyed()) {
      return;
    }

    console.error(
      `[desktop] Compact follower renderer exited (${details.reason}). Recreating.`,
    );

    window.destroy();
  });

  const developmentUrl = process.env.ROVE_COMPANION_DEV_URL;

  if (developmentUrl !== undefined) {
    const followerUrl = new URL(developmentUrl);

    followerUrl.searchParams.set("surface", "follower");

    void window.loadURL(followerUrl.toString());
  } else {
    void window.loadFile(
      join(import.meta.dirname, "../../renderer/index.html"),
      {
        query: {
          surface: "follower",
        },
      },
    );
  }

  return window;
}

function registerIpc(
  runtime: CompanionRuntimeClient,
  attachmentAuthority: TaskAttachmentAuthority,
  recordingStore: FileRecordingStore,
): void {
  const refreshCompanion = async (operation: () => Promise<unknown>) => {
    await operation();
    return (await refreshDesktopSurfaceSnapshot(runtime)).companion;
  };

  ipcMain.handle(companionIpcChannels.windowFullscreen, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
  });

  ipcMain.handle(companionIpcChannels.surfaceSnapshot, () =>
    desktopSurfaceSnapshot === undefined
      ? refreshDesktopSurfaceSnapshot(runtime)
      : desktopSurfaceSnapshot,
  );

  ipcMain.handle(
    companionIpcChannels.surfaceTransition,
    async (_event, transition) => {
      if (
        transition !== "expand" &&
        transition !== "collapse" &&
        transition !== "open_full" &&
        transition !== "close_full"
      ) {
        throw new Error("Unknown Rove surface transition.");
      }
      transitionSurface(transition);
      return refreshDesktopSurfaceSnapshot(runtime);
    },
  );

  ipcMain.handle(
    companionIpcChannels.productIntent,
    createProductIntentIpcHandler(
      () => {
        if (codexProductError !== null) throw new Error(codexProductError);
        if (codexExecutionCore === undefined)
          throw new Error("Codex product service is unavailable.");
        return codexExecutionCore.api();
      },
      async () => {
        await refreshDesktopSurfaceSnapshot(runtime);
      },
    ),
  );

  ipcMain.handle(
    companionIpcChannels.taskAttachmentPreview,
    async (_event, taskId: unknown, filename: unknown) => {
      if (
        typeof taskId !== "string" ||
        taskId.length < 1 ||
        taskId.length > 255 ||
        typeof filename !== "string" ||
        filename.length < 1 ||
        filename.length > 255
      )
        throw new Error("Invalid task attachment preview request.");
      const source = await attachmentAuthority.readImagePreview(
        taskId,
        filename,
      );
      if (source === null) return null;
      const image = nativeImage.createFromBuffer(Buffer.from(source.bytes));
      if (image.isEmpty()) return null;
      const size = image.getSize();
      const scale = Math.min(1, 640 / size.width, 480 / size.height);
      const preview =
        scale < 1
          ? image.resize({
              width: Math.max(1, Math.round(size.width * scale)),
              height: Math.max(1, Math.round(size.height * scale)),
              quality: "good",
            })
          : image;
      return preview.toDataURL();
    },
  );

  ipcMain.handle(
    companionIpcChannels.openTrustedExternal,
    async (_event, intent: TrustedExternalIntent) => {
      if (codexExecutionCore === undefined || codexProductError !== null)
        throw new Error("Codex product service is unavailable.");
      const value = await codexExecutionCore
        .api()
        .resolveTrustedExternalUrl(intent);
      await shell.openExternal(validateTrustedExternalUrl(value));
    },
  );

  ipcMain.handle(
    companionIpcChannels.openRecording,
    async (_event, taskId: unknown, recordingId: unknown) => {
      if (
        typeof taskId !== "string" ||
        taskId.length < 1 ||
        taskId.length > 255 ||
        typeof recordingId !== "string" ||
        !/^rec_[a-f0-9]{32}$/.test(recordingId)
      )
        throw new Error("Invalid recording playback request.");
      if (codexExecutionCore === undefined || codexProductError !== null)
        throw new Error("Codex product service is unavailable.");
      const recording = await codexExecutionCore
        .api()
        .recordingForOpen(taskId, recordingId);
      const path = await recordingStore.artifactPath(
        recording.sessionId,
        recording.id,
        false,
      );
      const error = await shell.openPath(path);
      if (error) throw new Error("The recording could not be opened.");
    },
  );

  ipcMain.handle(companionIpcChannels.snapshot, async () =>
    projectCompanionSnapshot(await runtime.getSnapshot()),
  );

  ipcMain.handle(companionIpcChannels.notice, () => desktopNotice);

  ipcMain.handle(companionIpcChannels.browserWorkspaces, () =>
    runtime.getBrowserWorkspaceStatus().then(toDesktopBrowserWorkspaceStatus),
  );

  ipcMain.handle(
    companionIpcChannels.createBrowserWorkspace,
    async (_event, displayName) => {
      if (typeof displayName !== "string") {
        throw new Error("Browser workspace name must be a string.");
      }
      const workspace = await runtime.createBrowserWorkspace(displayName);
      await runtime.selectBrowserWorkspace(workspace.id);
      return (await refreshDesktopSurfaceSnapshot(runtime)).workspaces;
    },
  );

  ipcMain.handle(
    companionIpcChannels.selectBrowserWorkspace,
    async (_event, workspaceId) => {
      if (typeof workspaceId !== "string") {
        throw new Error("Browser workspace id must be a string.");
      }
      await runtime.selectBrowserWorkspace(workspaceId);
      return (await refreshDesktopSurfaceSnapshot(runtime)).workspaces;
    },
  );

  ipcMain.handle(
    companionIpcChannels.renameBrowserWorkspace,
    async (_event, workspaceId, displayName) => {
      if (typeof workspaceId !== "string" || typeof displayName !== "string") {
        throw new Error("Browser profile id and name must be strings.");
      }
      await runtime.renameBrowserWorkspace(workspaceId, displayName);
      return (await refreshDesktopSurfaceSnapshot(runtime)).workspaces;
    },
  );

  ipcMain.handle(
    companionIpcChannels.deleteBrowserWorkspace,
    async (_event, workspaceId) => {
      if (typeof workspaceId !== "string") {
        throw new Error("Browser profile id must be a string.");
      }
      await runtime.deleteBrowserWorkspace(workspaceId);
      return (await refreshDesktopSurfaceSnapshot(runtime)).workspaces;
    },
  );

  ipcMain.handle(companionIpcChannels.liveSession, () =>
    desktopNotice === null && lastLiveSession !== null
      ? toDesktopSession(lastLiveSession)
      : null,
  );

  ipcMain.handle(companionIpcChannels.openRove, () => {
    openFullSurface();
  });

  ipcMain.handle(companionIpcChannels.showBrowser, async (_event, taskId) => {
    if (typeof taskId === "string") {
      if (codexExecutionCore === undefined || codexProductError !== null)
        throw new Error("Codex product service is unavailable.");
      await codexExecutionCore.attachBrowser(taskId);
    }
    const shown = await runtime.showBrowser();
    if (shown) {
      closeFullSurface();
      await browserFollowController?.reconcileNow();
    }
    return shown;
  });

  ipcMain.handle(companionIpcChannels.takeControl, () =>
    refreshCompanion(() => runtime.takeControl()),
  );

  ipcMain.handle(companionIpcChannels.returnControl, async () => {
    if (codexExecutionCore === undefined || codexProductError !== null)
      throw new Error("Codex product service is unavailable.");
    const active = await runtime.getActiveSession();
    if (active === null) throw new Error("No active Runtime session.");
    await codexExecutionCore.api().prepareReturnControl(active.id);
    const companion = await runtime.returnControlForSession(active.id);
    await codexExecutionCore.api().completeReturnControl(active.id);
    return (await refreshDesktopSurfaceSnapshot(runtime, companion)).companion;
  });

  ipcMain.handle(companionIpcChannels.pauseSession, () =>
    refreshCompanion(() => runtime.pauseSession()),
  );

  ipcMain.handle(
    companionIpcChannels.followerPresentation,
    () => compactFollowerSurface?.presentationMode() ?? "windowed_compact",
  );

  ipcMain.handle(companionIpcChannels.followerExpanded, (_event, expanded) => {
    if (typeof expanded !== "boolean") {
      throw new Error("Follower expansion must be a boolean.");
    }

    transitionSurface(expanded ? "expand" : "collapse");

    return compactFollowerSurface?.presentationMode() ?? "windowed_compact";
  });

  ipcMain.handle(companionIpcChannels.followerDragBegin, () => {
    const follower = compactFollowerSurface;
    if (follower === undefined) return;

    const cursor = screen.getCursorScreenPoint();
    const regions = follower.presentationMode().startsWith("fullscreen_")
      ? [screen.getDisplayNearestPoint(cursor).bounds]
      : screen.getAllDisplays().map((display) => display.workArea);

    follower.beginDrag(cursor, regions);
    startFollowerDragTracking(cursor);
  });

  ipcMain.handle(companionIpcChannels.followerDragUpdate, () => {
    compactFollowerSurface?.updateDrag(screen.getCursorScreenPoint());
  });

  ipcMain.handle(companionIpcChannels.followerDragEnd, () => {
    compactFollowerSurface?.updateDrag(screen.getCursorScreenPoint());
    stopFollowerDragTracking();
  });

  ipcMain.handle(
    companionIpcChannels.finishSession,
    async (_event, sessionId) => {
      if (sessionId === undefined) {
        await runtime.finishSession();
      } else {
        if (typeof sessionId !== "string" || sessionId.length === 0) {
          throw new Error("Runtime session id must be a non-empty string.");
        }
        const current = await refreshDesktopSurfaceSnapshot(runtime);
        await endUnmatchedRuntimeSession({
          sessionId,
          snapshot: current,
          endSession: (exactSessionId) => runtime.endSession(exactSessionId),
        });
      }

      if (sessionId === undefined || lastLiveSession?.id === sessionId) {
        lastLiveSession = null;
      }
      desktopNotice = null;

      return (await refreshDesktopSurfaceSnapshot(runtime)).companion;
    },
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

function optionalPositiveIntegerEnv(name: string): number | undefined {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function installApplicationMenu(surface: CompanionSurface): void {
  const surfaceItems: MenuItemConstructorOptions[] = [
    {
      label: "Open Rove",
      accelerator: "CmdOrCtrl+Shift+R",
      click: () => openFullSurface(),
    },
    {
      label: "Close Rove Window",
      click: () => {
        surface.hide();
        closeFullSurface();
      },
    },
  ];
  const editMenu: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  };

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
            ...editMenu,
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
                label: "Open Rove",
                accelerator: "CmdOrCtrl+Shift+R",
                click: () => openFullSurface(),
              },
            ],
          },
        ]
      : [
          {
            ...editMenu,
          },
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
        label: "Open Rove",
        click: () => openFullSurface(),
      },
      {
        label: "Close Rove Window",
        click: () => {
          surface.hide();
          closeFullSurface();
        },
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
    openFullSurface();
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
      const companion = await runtime.getSnapshot();
      await refreshDesktopSurfaceSnapshot(runtime, companion);
      const session = companion?.session ?? null;

      const signal = toCompanionSurfaceSignal(session);

      if (signal !== null && signal.key !== previousSignalKey) {
        if (signal.action === "attention") {
          openFullSurface();
        } else {
          unifiedSurfaceCoordinator?.present(unifiedSurfaceState.snapshot());
        }
      }

      onSession?.(session);

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
  const desktopHome = resolveDesktopProductHome({
    appDataDirectory: app.getPath("appData"),
    ...(process.env.ROVE_DESKTOP_HOME === undefined
      ? {}
      : { qualificationOverride: process.env.ROVE_DESKTOP_HOME }),
  });
  const nativeFileGrant = createLocalFileGrantAuthority({
    async selectPaths(request) {
      openFullSurface();
      const options = {
        title: "Choose files for Rove",
        message: request.reason,
        properties: [
          "openFile" as const,
          ...(request.allowMultiple ? (["multiSelections"] as const) : []),
        ],
      };
      const parent =
        companionWindow !== undefined && !companionWindow.isDestroyed()
          ? companionWindow
          : undefined;
      const result =
        parent === undefined
          ? await dialog.showOpenDialog(options)
          : await dialog.showOpenDialog(parent, options);
      return result.canceled ? null : result.filePaths;
    },
  });
  const qualificationPicker = (
    globalThis as typeof globalThis & {
      __roveQualificationAttachmentPicker?: UserFilePicker;
    }
  ).__roveQualificationAttachmentPicker;
  const attachmentAuthority = new TaskAttachmentAuthority(
    join(desktopHome, "task-attachments"),
    qualificationPicker ?? {
      async select(request) {
        return (await nativeFileGrant.requestLocalFileGrant?.(request)) ?? null;
      },
    },
  );
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
  let codexMcpLaunch:
    | {
        command: string;
        args: readonly string[];
        environment: Readonly<Record<string, string>>;
      }
    | undefined;

  if (manageServices) {
    const serviceLayout = resolveDesktopServiceLayout({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      cwd: process.cwd(),
      electronExecutable: process.execPath,
      ...(process.env.ROVE_DESKTOP_RUNTIME_DIR === undefined
        ? {}
        : { runtimeDirectory: process.env.ROVE_DESKTOP_RUNTIME_DIR }),
    });

    const desktopStartupTimeoutMs = optionalPositiveIntegerEnv(
      "ROVE_DESKTOP_STARTUP_TIMEOUT_MS",
    );

    desktopHost = new DesktopHost({
      runtimeDirectory: serviceLayout.runtimeDirectory,
      home: desktopHome,
      browserHeadless: config.browser.headless,
      browser: config.browser.preferredBrowser,
      ...(desktopStartupTimeoutMs === undefined
        ? {}
        : { startupTimeoutMs: desktopStartupTimeoutMs }),
      ...(config.browser.executablePath === undefined
        ? {}
        : {
            browserExecutablePath: config.browser.executablePath,
          }),
      ...(serviceLayout.nodeExecutable === undefined
        ? {}
        : {
            runtimeNodeExecutable: serviceLayout.nodeExecutable,
          }),
      ...(serviceLayout.runtimeEntrypoint === undefined
        ? {}
        : { runtimeEntrypoint: serviceLayout.runtimeEntrypoint }),
      ...(serviceLayout.electronRunAsNode ? { electronRunAsNode: true } : {}),
      ...(serviceLayout.playwrightBrowsersPath === undefined
        ? {}
        : {
            playwrightBrowsersPath: serviceLayout.playwrightBrowsersPath,
          }),
    });

    desktopHost.onEvent((event) => {
      if (event.type === "runtime-exited") {
        console.error("[desktop] Runtime exited unexpectedly.");

        if (lastLiveSession !== null) {
          desktopNotice = {
            type: "session_interrupted",
            sessionId: lastLiveSession.id,
            title: "Session interrupted",
            message: "Rove's browser runtime stopped unexpectedly.",
            supportingText: "Rove is recovering its local services.",
          };

          companionSurface?.requestAttention();
        }

        return;
      }

      if (event.type === "runtime-restarting") {
        console.info(`[desktop] Restarting Runtime (${event.attempt}).`);
        return;
      }

      if (event.type === "runtime-recovered") {
        console.info("[desktop] Runtime recovered.");

        void codexExecutionCore?.recover("Runtime");

        if (desktopNotice !== null) {
          desktopNotice = {
            ...desktopNotice,
            supportingText:
              "Rove recovered its local services and is ready for a new session.",
          };
        }

        return;
      }

      if (event.type === "runtime-recovery-failed") {
        console.error(`[desktop] Runtime recovery failed: ${event.message}`);

        if (desktopNotice !== null) {
          desktopNotice = {
            ...desktopNotice,
            supportingText:
              "Rove could not recover the browser runtime. Restart Rove to continue.",
          };
        }

        companionSurface?.requestAttention();
        return;
      }
    });

    const connection = await desktopHost.start();

    const controlPlaneUrl = process.env.ROVE_CONTROL_PLANE_URL;

    if (controlPlaneUrl !== undefined) {
      hubConnector = new HubConnector({
        controlPlaneUrl,
        deviceId: process.env.ROVE_HUB_DEVICE_ID ?? "local-dev",
        token: process.env.ROVE_HUB_TOKEN ?? "rove-local-hub-token-change-me",
        runtime: {
          baseUrl: connection.runtime.baseUrl,
          token: connection.runtime.token,
        },
        runtimeInstanceId: connection.runtime.runtimeInstanceId,
        runtimeStartedAt: connection.runtime.startedAt,
        companionIdentity: COMPANION_PROVENANCE,
        authority: {
          requestLocalFileGrant(request) {
            if (!codexExecutionCore)
              throw new Error("Task attachment authority is unavailable.");
            return codexExecutionCore.requestLocalFileGrant(request);
          },
          completeLocalFileGrant(sessionId, materialized) {
            if (!codexExecutionCore)
              throw new Error("Task attachment authority is unavailable.");
            return codexExecutionCore.completeLocalFileGrant(
              sessionId,
              materialized,
            );
          },
          failLocalFileGrant(sessionId, attachmentIds) {
            if (!codexExecutionCore)
              throw new Error("Task attachment authority is unavailable.");
            return codexExecutionCore.failLocalFileGrant(
              sessionId,
              attachmentIds,
            );
          },
          markLocalFileGrantReconciliation(sessionId, attachmentIds) {
            if (!codexExecutionCore)
              throw new Error("Task attachment authority is unavailable.");
            return codexExecutionCore.markLocalFileGrantReconciliation(
              sessionId,
              attachmentIds,
            );
          },
        },
      });
      hubConnector.start();
      console.info("[hub] Outbound control-plane connector started.");
    }

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
    codexMcpLaunch = app.isPackaged
      ? {
          command: process.execPath,
          args: [
            join(process.resourcesPath, "services", "mcp", "dist", "main.js"),
          ],
          environment: {
            ELECTRON_RUN_AS_NODE: "1",
            ROVE_RUNTIME_URL: connection.runtime.baseUrl,
            ROVE_RUNTIME_TOKEN: connection.runtime.token,
          },
        }
      : {
          command: process.env.npm_node_execpath ?? "node",
          args: [resolve(process.cwd(), "../mcp/dist/main.js")],
          environment: {
            ROVE_RUNTIME_URL: connection.runtime.baseUrl,
            ROVE_RUNTIME_TOKEN: connection.runtime.token,
          },
        };
  } else {
    runtime = new CompanionRuntimeClient(
      runtimeClientOptions(config.runtime.url, config.runtime.token),
    );
    codexMcpLaunch = {
      command: process.env.npm_node_execpath ?? "node",
      args: [resolve(process.cwd(), "../mcp/dist/main.js")],
      environment: {
        ROVE_RUNTIME_URL: config.runtime.url,
        ...(config.runtime.token === undefined
          ? {}
          : { ROVE_RUNTIME_TOKEN: config.runtime.token }),
      },
    };
  }

  const configuredCodexExecutable =
    process.env.ROVE_CODEX_EXECUTABLE ??
    (app.isPackaged
      ? join(process.resourcesPath, "services", "codex", "codex")
      : process.platform === "darwin"
        ? "/Applications/ChatGPT.app/Contents/Resources/codex"
        : undefined);
  if (configuredCodexExecutable !== undefined && codexMcpLaunch !== undefined) {
    codexExecutionCore = new CodexExecutionCore({
      isPackaged: app.isPackaged,
      ...(app.isPackaged
        ? { packagedExecutablePath: configuredCodexExecutable }
        : { developmentExecutablePath: configuredCodexExecutable }),
      clientVersion: COMPANION_PROVENANCE.version,
      stateDirectory: join(desktopHome, "codex-product"),
      taskWorkingDirectory: desktopHome,
      taskWorkspaceRoot: join(desktopHome, "task-workspaces"),
      runtime,
      attachmentAuthority,
      attachmentRuntime: runtime,
      onFileAttention: () => openFullSurface(),
      mcpLaunch: codexMcpLaunch,
      onProductStateChanged: async () => {
        await refreshDesktopSurfaceSnapshot(runtime);
      },
    });
    codexExecutionCoreStarting = true;
    try {
      await codexExecutionCore.start();
      codexExecutionCoreStarting = false;
      codexProductError = null;
      await refreshDesktopSurfaceSnapshot(runtime);
      console.info("[codex] Trusted App Server execution core is ready.");
    } catch (error) {
      codexExecutionCoreStarting = false;
      codexProductError =
        error instanceof Error ? error.message : "Codex App Server failed.";
      console.error(`[codex] ${codexProductError}`);
    }
  } else {
    codexProductError = "No supported Codex executable is available.";
  }

  registerIpc(
    runtime,
    attachmentAuthority,
    new FileRecordingStore(desktopHome),
  );

  const surface = new CompanionSurface(
    createCompanionWindow,
    () => allowQuit,
    closeFullSurface,
  );

  companionSurface = surface;

  const followerSurface = new CompactFollowerSurface(
    createCompactFollowerWindow,
    {
      width: COMPACT_FOLLOWER_WIDTH,
      height: COMPACT_FOLLOWER_HEIGHT,
      expandedWidth: EXPANDED_FOLLOWER_WIDTH,
      expandedHeight: EXPANDED_FOLLOWER_HEIGHT,
      fullscreenMicroWidth: FULLSCREEN_MICRO_FOLLOWER_WIDTH,
      fullscreenMicroHeight: FULLSCREEN_MICRO_FOLLOWER_HEIGHT,
    },
  );

  compactFollowerSurface = followerSurface;

  unifiedSurfaceCoordinator = new UnifiedSurfaceCoordinator(
    {
      isVisible: () => followerSurface.isVisible(),
      hide: () => followerSurface.hideFollower(),
      show: (snapshot) => {
        followerSurface.setExpanded(snapshot.presentation === "expanded");
        followerSurface.setFollowEnabled(
          lastLiveSession !== null && desktopNotice === null,
        );
      },
    },
    {
      isVisible: () => surface.isVisible(),
      hide: () => surface.hide(),
      show: () => surface.show(),
    },
  );
  unifiedSurfaceCoordinator.present(unifiedSurfaceState.snapshot());

  const controlledFollowerSurface: BrowserFollowSurface = {
    isFollowEnabled: () =>
      followerSurface.isFollowEnabled() && !surface.isVisible(),
    isFocused: () => followerSurface.isFocused(),
    isVisible: () => followerSurface.isVisible(),
    followPresentation: (windowState) => {
      const browserContext =
        windowState === "fullscreen" ? "fullscreen" : "windowed";
      if (unifiedSurfaceState.snapshot().browserContext !== browserContext) {
        unifiedSurfaceState.dispatch({
          type: "browser_context",
          context: browserContext,
        });
        publishSurfaceState();
      }
      return followerSurface.followPresentation(windowState);
    },
    preferredPosition: (windowState) =>
      followerSurface.preferredPosition(windowState),
    resetUserPlacement: () => followerSurface.resetUserPlacement(),
    showInactiveAt: (bounds, placement, presentation) =>
      followerSurface.showInactiveAt(bounds, placement, presentation),
    hideFollower: () => followerSurface.hideFollower(),
  };

  const followController = new BrowserFollowController(
    runtime,
    createElectronBrowserFollowDisplaySource(screen),
    controlledFollowerSurface,
    {
      browserIdentity: runtime,
      foreground: new NativeBrowserFollowForegroundSource(),
      followerProcessId: process.pid,
      onOwnedBrowserForeground: () => {
        if (unifiedSurfaceState.snapshot().presentation === "full") {
          closeFullSurface();
        }
      },
    },
  );

  browserFollowController = followController;

  installApplicationMenu(surface);

  desktopTray = installTray(surface);

  followController.start();

  startSessionSurfaceMonitor(runtime, (session) => {
    if (session !== null) {
      if (desktopNotice !== null && desktopNotice.sessionId !== session.id) {
        desktopNotice = null;
      }

      lastLiveSession = session;
    } else if (desktopNotice === null) {
      lastLiveSession = null;
    }

    if (desktopTray !== undefined) {
      updateTrayMenu(desktopTray, surface, session);
    }

    const followerSession =
      session !== null &&
      (session.status === "active" ||
        session.status === "paused" ||
        session.status === "awaiting_human") &&
      session.mode !== "capture"
        ? session
        : null;

    followerSurface.setFollowEnabled(
      followerSession !== null && desktopNotice === null,
    );

    followController.setSession(followerSession);
  });
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    openFullSurface();
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
  openFullSurface();
});

app.on("before-quit", (event) => {
  stopFollowerDragTracking();
  stopSessionSurfaceMonitor();

  browserFollowController?.stop();
  browserFollowController = undefined;
  compactFollowerSurface = undefined;

  desktopTray?.destroy();
  desktopTray = undefined;

  if (allowQuit) return;

  const hasManagedComponents =
    desktopHost !== undefined || codexExecutionCore !== undefined;
  const quit = desktopQuitBarrier.request(hasManagedComponents);
  if (quit.preventQuit) event.preventDefault();
  if (!hasManagedComponents) {
    allowQuit = true;
    return;
  }
  if (!quit.startShutdown) return;

  void stopDesktopComponents({
    stopHub: async () => {
      await hubConnector?.stop();
    },
    stopExecutionCore: async () => {
      await codexExecutionCore?.stop();
    },
    stopDesktopHost: async () => {
      await desktopHost?.stop();
    },
    report: (stage, error) => {
      console.error(`Rove Desktop shutdown ${stage} failed.`, error);
    },
  }).finally(() => {
    desktopQuitBarrier.complete();
    allowQuit = true;
    app.quit();
  });
});
