import { contextBridge, ipcRenderer } from "electron";

import type {
  CompanionSnapshot,
  DesktopSurfaceSnapshot,
  DesktopBrowserWorkspaceStatus,
  DesktopNotice,
  FollowerPresentationMode,
  RoveDesktopApi,
  DesktopSession,
} from "../shared/desktop-api.js";

const api: RoveDesktopApi = {
  getWindowFullscreen: () =>
    ipcRenderer.invoke("rove:window-fullscreen") as Promise<boolean>,

  subscribeWindowFullscreen: (listener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      fullscreen: boolean,
    ) => {
      listener(fullscreen);
    };
    ipcRenderer.on("rove:window-fullscreen-changed", wrapped);
    return () =>
      ipcRenderer.removeListener("rove:window-fullscreen-changed", wrapped);
  },

  getSurfaceSnapshot: () =>
    ipcRenderer.invoke(
      "rove:surface-snapshot",
    ) as Promise<DesktopSurfaceSnapshot>,

  subscribeSurfaceSnapshot: (listener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      snapshot: DesktopSurfaceSnapshot,
    ) => {
      listener(snapshot);
    };
    ipcRenderer.on("rove:surface-changed", wrapped);
    return () => ipcRenderer.removeListener("rove:surface-changed", wrapped);
  },

  transitionSurface: (transition) =>
    ipcRenderer.invoke(
      "rove:surface-transition",
      transition,
    ) as Promise<DesktopSurfaceSnapshot>,

  getSnapshot: () =>
    ipcRenderer.invoke("rove:snapshot") as Promise<CompanionSnapshot | null>,

  getNotice: () =>
    ipcRenderer.invoke("rove:notice") as Promise<DesktopNotice | null>,

  getLiveSession: () =>
    ipcRenderer.invoke("rove:live-session") as Promise<DesktopSession | null>,

  getFollowerPresentation: () =>
    ipcRenderer.invoke(
      "rove:follower-presentation",
    ) as Promise<FollowerPresentationMode>,

  takeControl: () =>
    ipcRenderer.invoke(
      "rove:take-control",
    ) as Promise<CompanionSnapshot | null>,

  returnControl: () =>
    ipcRenderer.invoke(
      "rove:return-control",
    ) as Promise<CompanionSnapshot | null>,

  pauseSession: () =>
    ipcRenderer.invoke("rove:pause") as Promise<CompanionSnapshot | null>,

  finishSession: (sessionId) =>
    ipcRenderer.invoke(
      "rove:finish",
      sessionId,
    ) as Promise<CompanionSnapshot | null>,

  setFollowerExpanded: (expanded) =>
    ipcRenderer.invoke(
      "rove:follower-expanded",
      expanded,
    ) as Promise<FollowerPresentationMode>,

  beginFollowerDrag: () =>
    ipcRenderer.invoke("rove:follower-drag-begin") as Promise<void>,

  updateFollowerDrag: () =>
    ipcRenderer.invoke("rove:follower-drag-update") as Promise<void>,

  endFollowerDrag: () =>
    ipcRenderer.invoke("rove:follower-drag-end") as Promise<void>,

  openRove: () => ipcRenderer.invoke("rove:open") as Promise<void>,

  showBrowser: (taskId) =>
    ipcRenderer.invoke("rove:show-browser", taskId) as Promise<boolean>,

  openTrustedExternal: (intent) =>
    ipcRenderer.invoke("rove:open-trusted-external", intent) as Promise<void>,

  openRecording: (taskId, recordingId) =>
    ipcRenderer.invoke(
      "rove:open-recording",
      taskId,
      recordingId,
    ) as Promise<void>,

  getBrowserWorkspaces: () =>
    ipcRenderer.invoke(
      "rove:browser-workspaces",
    ) as Promise<DesktopBrowserWorkspaceStatus>,

  createBrowserWorkspace: (displayName) =>
    ipcRenderer.invoke(
      "rove:create-browser-workspace",
      displayName,
    ) as Promise<DesktopBrowserWorkspaceStatus>,

  selectBrowserWorkspace: (workspaceId) =>
    ipcRenderer.invoke(
      "rove:select-browser-workspace",
      workspaceId,
    ) as Promise<DesktopBrowserWorkspaceStatus>,

  renameBrowserWorkspace: (workspaceId, displayName) =>
    ipcRenderer.invoke(
      "rove:rename-browser-workspace",
      workspaceId,
      displayName,
    ) as Promise<DesktopBrowserWorkspaceStatus>,

  deleteBrowserWorkspace: (workspaceId) =>
    ipcRenderer.invoke(
      "rove:delete-browser-workspace",
      workspaceId,
    ) as Promise<DesktopBrowserWorkspaceStatus>,

  executeProductIntent: (intent) =>
    ipcRenderer.invoke("rove:product-intent", intent),

  getTaskAttachmentPreview: (taskId, filename) =>
    ipcRenderer.invoke(
      "rove:task-attachment-preview",
      taskId,
      filename,
    ) as Promise<string | null>,
};

contextBridge.exposeInMainWorld("rove", api);
