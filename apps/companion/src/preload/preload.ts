import { contextBridge, ipcRenderer } from "electron";
import type { SessionSnapshot } from "@rove/protocol";

export interface RoveDesktopApi {
  getSession(): Promise<SessionSnapshot | null>;
  takeControl(): Promise<void>;
  returnControl(): Promise<void>;
  finishSession(): Promise<void>;
}

const api: RoveDesktopApi = {
  getSession: () => ipcRenderer.invoke("rove:session") as Promise<SessionSnapshot | null>,
  takeControl: () => ipcRenderer.invoke("rove:take-control") as Promise<void>,
  returnControl: () => ipcRenderer.invoke("rove:return-control") as Promise<void>,
  finishSession: () => ipcRenderer.invoke("rove:finish") as Promise<void>,
};

contextBridge.exposeInMainWorld("rove", api);
