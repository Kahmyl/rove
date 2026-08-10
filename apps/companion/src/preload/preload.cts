import {
  contextBridge,
  ipcRenderer,
} from "electron";

import type {
  CompanionSnapshot,
  RoveDesktopApi,
} from "../shared/desktop-api.js";

const api: RoveDesktopApi = {
  getSnapshot: () =>
    ipcRenderer.invoke(
      "rove:snapshot",
    ) as Promise<CompanionSnapshot | null>,

  takeControl: () =>
    ipcRenderer.invoke(
      "rove:take-control",
    ) as Promise<CompanionSnapshot | null>,

  returnControl: () =>
    ipcRenderer.invoke(
      "rove:return-control",
    ) as Promise<CompanionSnapshot | null>,

  finishSession: () =>
    ipcRenderer.invoke(
      "rove:finish",
    ) as Promise<CompanionSnapshot | null>,
};

contextBridge.exposeInMainWorld(
  "rove",
  api,
);
