import { contextBridge, ipcRenderer } from "electron";

import type { Session } from "@rove/protocol";

import type {
  CompanionSnapshot,
  DesktopNotice,
  FollowerPresentationMode,
  RoveDesktopApi,
} from "../shared/desktop-api.js";

const api: RoveDesktopApi = {
  getSnapshot: () =>
    ipcRenderer.invoke("rove:snapshot") as Promise<CompanionSnapshot | null>,

  getNotice: () =>
    ipcRenderer.invoke("rove:notice") as Promise<DesktopNotice | null>,

  getLiveSession: () =>
    ipcRenderer.invoke("rove:live-session") as Promise<Session | null>,

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

  finishSession: () =>
    ipcRenderer.invoke("rove:finish") as Promise<CompanionSnapshot | null>,

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
};

contextBridge.exposeInMainWorld("rove", api);
