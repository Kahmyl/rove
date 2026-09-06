import type { Session } from "@rove/protocol";

import {
  companionIpcChannels,
  type CompanionSnapshot,
  type DesktopNotice,
  type FollowerPresentationMode,
  type RoveDesktopApi,
} from "../shared/desktop-api.js";

export interface IpcInvoker {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

export function createDesktopApi(ipc: IpcInvoker): RoveDesktopApi {
  return {
    getSnapshot: () =>
      ipc.invoke(
        companionIpcChannels.snapshot,
      ) as Promise<CompanionSnapshot | null>,

    getNotice: () =>
      ipc.invoke(companionIpcChannels.notice) as Promise<DesktopNotice | null>,

    getLiveSession: () =>
      ipc.invoke(companionIpcChannels.liveSession) as Promise<Session | null>,

    getFollowerPresentation: () =>
      ipc.invoke(
        companionIpcChannels.followerPresentation,
      ) as Promise<FollowerPresentationMode>,

    takeControl: () =>
      ipc.invoke(
        companionIpcChannels.takeControl,
      ) as Promise<CompanionSnapshot | null>,

    returnControl: () =>
      ipc.invoke(
        companionIpcChannels.returnControl,
      ) as Promise<CompanionSnapshot | null>,

    pauseSession: () =>
      ipc.invoke(
        companionIpcChannels.pauseSession,
      ) as Promise<CompanionSnapshot | null>,

    finishSession: () =>
      ipc.invoke(
        companionIpcChannels.finishSession,
      ) as Promise<CompanionSnapshot | null>,

    setFollowerExpanded: (expanded) =>
      ipc.invoke(
        companionIpcChannels.followerExpanded,
        expanded,
      ) as Promise<FollowerPresentationMode>,

    beginFollowerDrag: () =>
      ipc.invoke(companionIpcChannels.followerDragBegin) as Promise<void>,

    updateFollowerDrag: () =>
      ipc.invoke(companionIpcChannels.followerDragUpdate) as Promise<void>,

    endFollowerDrag: () =>
      ipc.invoke(companionIpcChannels.followerDragEnd) as Promise<void>,

    openRove: () => ipc.invoke(companionIpcChannels.openRove) as Promise<void>,
  };
}
