import {
  companionIpcChannels,
  type CompanionSnapshot,
  type DesktopSurfaceSnapshot,
  type DesktopNotice,
  type FollowerPresentationMode,
  type RoveDesktopApi,
  type DesktopSession,
} from "../shared/desktop-api.js";

export interface IpcInvoker {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on?(
    channel: string,
    listener: (event: unknown, value: unknown) => void,
  ): void;
  removeListener?(
    channel: string,
    listener: (event: unknown, value: unknown) => void,
  ): void;
}

export function createDesktopApi(ipc: IpcInvoker): RoveDesktopApi {
  return {
    getWindowFullscreen: () =>
      ipc.invoke(companionIpcChannels.windowFullscreen) as Promise<boolean>,

    subscribeWindowFullscreen: (listener) => {
      const wrapped = (_event: unknown, value: unknown) => {
        listener(value === true);
      };
      ipc.on?.(companionIpcChannels.windowFullscreenChanged, wrapped);
      return () =>
        ipc.removeListener?.(
          companionIpcChannels.windowFullscreenChanged,
          wrapped,
        );
    },

    getSurfaceSnapshot: () =>
      ipc.invoke(
        companionIpcChannels.surfaceSnapshot,
      ) as Promise<DesktopSurfaceSnapshot>,

    subscribeSurfaceSnapshot: (listener) => {
      const wrapped = (_event: unknown, value: unknown) => {
        listener(value as DesktopSurfaceSnapshot);
      };
      ipc.on?.(companionIpcChannels.surfaceChanged, wrapped);
      return () =>
        ipc.removeListener?.(companionIpcChannels.surfaceChanged, wrapped);
    },

    transitionSurface: (transition) =>
      ipc.invoke(
        companionIpcChannels.surfaceTransition,
        transition,
      ) as Promise<DesktopSurfaceSnapshot>,

    getSnapshot: () =>
      ipc.invoke(
        companionIpcChannels.snapshot,
      ) as Promise<CompanionSnapshot | null>,

    getNotice: () =>
      ipc.invoke(companionIpcChannels.notice) as Promise<DesktopNotice | null>,

    getLiveSession: () =>
      ipc.invoke(
        companionIpcChannels.liveSession,
      ) as Promise<DesktopSession | null>,

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

    finishSession: (sessionId) =>
      ipc.invoke(
        companionIpcChannels.finishSession,
        sessionId,
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

    showBrowser: () =>
      ipc.invoke(companionIpcChannels.showBrowser) as Promise<boolean>,

    openTrustedExternal: (intent) =>
      ipc.invoke(
        companionIpcChannels.openTrustedExternal,
        intent,
      ) as Promise<void>,

    getBrowserWorkspaces: () =>
      ipc.invoke(companionIpcChannels.browserWorkspaces) as ReturnType<
        RoveDesktopApi["getBrowserWorkspaces"]
      >,

    createBrowserWorkspace: (displayName) =>
      ipc.invoke(
        companionIpcChannels.createBrowserWorkspace,
        displayName,
      ) as ReturnType<RoveDesktopApi["createBrowserWorkspace"]>,

    selectBrowserWorkspace: (workspaceId) =>
      ipc.invoke(
        companionIpcChannels.selectBrowserWorkspace,
        workspaceId,
      ) as ReturnType<RoveDesktopApi["selectBrowserWorkspace"]>,

    renameBrowserWorkspace: (workspaceId, displayName) =>
      ipc.invoke(
        companionIpcChannels.renameBrowserWorkspace,
        workspaceId,
        displayName,
      ) as ReturnType<RoveDesktopApi["renameBrowserWorkspace"]>,

    deleteBrowserWorkspace: (workspaceId) =>
      ipc.invoke(
        companionIpcChannels.deleteBrowserWorkspace,
        workspaceId,
      ) as ReturnType<RoveDesktopApi["deleteBrowserWorkspace"]>,

    executeProductIntent: (intent) =>
      ipc.invoke(companionIpcChannels.productIntent, intent) as ReturnType<
        RoveDesktopApi["executeProductIntent"]
      >,
  };
}
