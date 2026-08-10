import {
  companionIpcChannels,
  type CompanionSnapshot,
  type RoveDesktopApi,
} from "../shared/desktop-api.js";

export interface IpcInvoker {
  invoke(channel: string): Promise<unknown>;
}

export function createDesktopApi(
  ipc: IpcInvoker,
): RoveDesktopApi {
  return {
    getSnapshot: () =>
      ipc.invoke(
        companionIpcChannels.snapshot,
      ) as Promise<CompanionSnapshot | null>,

    takeControl: () =>
      ipc.invoke(
        companionIpcChannels.takeControl,
      ) as Promise<CompanionSnapshot | null>,

    returnControl: () =>
      ipc.invoke(
        companionIpcChannels.returnControl,
      ) as Promise<CompanionSnapshot | null>,

    finishSession: () =>
      ipc.invoke(
        companionIpcChannels.finishSession,
      ) as Promise<CompanionSnapshot | null>,
  };
}
