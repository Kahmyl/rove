/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, structuredClone, __filename */

const { app, BrowserWindow, contextBridge } = require("electron");

const workspaceId = "wrk_00000000-0000-4000-8000-000000000001";
const snapshot = {
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
  workspaces: {
    selectedWorkspaceId: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        displayName: "Personal",
        browser: "chrome",
        storageLayout: "workspace",
        createdAt: "2026-09-13T00:00:00.000Z",
        lastUsedAt: "2026-09-13T00:00:00.000Z",
      },
    ],
  },
  product: {
    version: 9,
    host: { state: "ready", ready: true, restartAttempt: 0 },
    catalog: {
      account: { status: "logged_out", requiresOpenaiAuth: true },
      models: [
        {
          id: "gpt-fixture",
          model: "gpt-fixture",
          displayName: "Codex",
          description: "Deterministic customer-journey fixture",
          efforts: ["low"],
          defaultEffort: "low",
          isDefault: true,
          inputModalities: ["text"],
          supportsPersonality: false,
          defaultServiceTier: null,
        },
      ],
      rateLimits: null,
      usage: null,
      refreshedAt: "2026-09-13T00:00:00.000Z",
    },
    attention: [],
    tasks: [],
    workflows: [],
    recoveryWarnings: [],
    draftAttachments: [],
    fileAttention: [],
  },
  productError: null,
};

if (process.type === "renderer") {
  const calls = [];
  contextBridge.exposeInMainWorld("rove", {
    getWindowFullscreen: async () => false,
    subscribeWindowFullscreen: () => () => {},
    getSurfaceSnapshot: async () => structuredClone(snapshot),
    subscribeSurfaceSnapshot: () => () => {},
    transitionSurface: async () => structuredClone(snapshot),
    getSnapshot: async () => null,
    getNotice: async () => null,
    getLiveSession: async () => null,
    getFollowerPresentation: async () => "windowed_compact",
    takeControl: async () => null,
    returnControl: async () => null,
    pauseSession: async () => null,
    finishSession: async () => null,
    setFollowerExpanded: async () => "windowed_expanded",
    beginFollowerDrag: async () => undefined,
    updateFollowerDrag: async () => undefined,
    endFollowerDrag: async () => undefined,
    openRove: async () => undefined,
    showBrowser: async () => false,
    openTrustedExternal: async (intent) => {
      calls.push({ type: "external", intent });
    },
    openRecording: async () => undefined,
    exportLocalBackup: async () => ({ status: "cancelled" }),
    getBrowserWorkspaces: async () => structuredClone(snapshot.workspaces),
    createBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    selectBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    renameBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    deleteBrowserWorkspace: async () => structuredClone(snapshot.workspaces),
    executeProductIntent: async (intent) => {
      calls.push({ type: "product", intent });
      if (intent.type === "account.login")
        return { type: "chatgpt", loginId: "login_journey_fixture" };
      return {};
    },
    getJourneyState: async () => ({
      calls: structuredClone(calls),
      snapshot: structuredClone(snapshot),
    }),
  });
} else {
  app.whenReady().then(async () => {
    const window = new BrowserWindow({
      width: 1180,
      height: 780,
      minWidth: 1040,
      minHeight: 680,
      show: false,
      backgroundColor: "#ffffff",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: __filename,
      },
    });
    window.once("ready-to-show", () => window.show());
    await window.loadFile(
      `${process.env.ROVE_JOURNEY_RENDERER_ROOT}/index.html`,
    );
  });
  app.on("window-all-closed", () => app.quit());
}
