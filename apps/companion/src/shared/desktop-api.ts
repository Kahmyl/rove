import type {
  BrowserWorkspace,
  BrowserWorkspaceStatus,
  Session,
} from "@rove/protocol";
import type {
  LocalProductResult,
  LocalProductSnapshot,
  RendererProductIntent,
  TrustedExternalIntent,
} from "../main/codex/local-product-api.js";

export type DesktopBrowserWorkspace = Omit<BrowserWorkspace, "userDataDir">;
export type DesktopSession = Pick<
  Session,
  "id" | "mode" | "status" | "controller"
> & {
  handoff?: Pick<NonNullable<Session["handoff"]>, "reason" | "requestedAt">;
};

export interface CompanionSnapshot {
  session: DesktopSession;
  observationCount: number;
  evidenceCount: number;
  browserOpen?: boolean;
}

export interface DesktopNotice {
  type: "session_interrupted";
  sessionId: string;
  title: string;
  message: string;
  supportingText: string;
}

export type UnifiedSurfacePresentation = "chip" | "expanded" | "full";
export type UnifiedSurfaceBrowserContext = "windowed" | "fullscreen";
export type UnifiedSurfaceHostKind = "browser_follower" | "control_center";

export interface UnifiedSurfaceState {
  presentation: UnifiedSurfacePresentation;
  browserContext: UnifiedSurfaceBrowserContext;
  activeHost: UnifiedSurfaceHostKind;
  returnPresentation: Exclude<UnifiedSurfacePresentation, "full">;
  revision: number;
}

export interface DesktopBrowserWorkspaceStatus {
  selectedWorkspaceId?: string;
  workspaces: DesktopBrowserWorkspace[];
}

export function toDesktopBrowserWorkspaceStatus(
  value: BrowserWorkspaceStatus,
): DesktopBrowserWorkspaceStatus {
  return {
    ...(value.selectedWorkspaceId === undefined
      ? {}
      : { selectedWorkspaceId: value.selectedWorkspaceId }),
    workspaces: value.workspaces.map(
      ({ userDataDir: _userDataDir, ...workspace }) => workspace,
    ),
  };
}

export function toDesktopSession(value: Session): DesktopSession {
  return {
    id: value.id,
    mode: value.mode,
    status: value.status,
    controller: value.controller,
    ...(value.handoff === undefined
      ? {}
      : {
          handoff: {
            reason: value.handoff.reason,
            requestedAt: value.handoff.requestedAt,
          },
        }),
  };
}

export type UnifiedSurfaceTransition =
  "expand" | "collapse" | "open_full" | "close_full";

export interface DesktopSurfaceSnapshot {
  revision: number;
  surface: UnifiedSurfaceState;
  companion: CompanionSnapshot | null;
  notice: DesktopNotice | null;
  workspaces: DesktopBrowserWorkspaceStatus;
  product: LocalProductSnapshot | null;
  productError: string | null;
}

export function unmatchedRuntimeSession(
  snapshot: DesktopSurfaceSnapshot | null,
): CompanionSnapshot | null {
  const runtime = snapshot?.companion ?? null;
  if (
    runtime === null ||
    runtime.session.status === "completed" ||
    runtime.session.status === "failed"
  ) {
    return null;
  }
  const matched = snapshot?.product?.tasks.some(
    (task) => task.roveSessionId === runtime.session.id,
  );
  return matched ? null : runtime;
}

export type FollowerPresentationMode =
  | "windowed_compact"
  | "windowed_expanded"
  | "fullscreen_micro"
  | "fullscreen_expanded";

export interface RoveDesktopApi {
  getWindowFullscreen(): Promise<boolean>;
  subscribeWindowFullscreen(
    listener: (fullscreen: boolean) => void,
  ): () => void;
  getSurfaceSnapshot(): Promise<DesktopSurfaceSnapshot>;
  subscribeSurfaceSnapshot(
    listener: (snapshot: DesktopSurfaceSnapshot) => void,
  ): () => void;
  transitionSurface(
    transition: UnifiedSurfaceTransition,
  ): Promise<DesktopSurfaceSnapshot>;
  getSnapshot(): Promise<CompanionSnapshot | null>;
  getNotice(): Promise<DesktopNotice | null>;
  getLiveSession(): Promise<DesktopSession | null>;
  getFollowerPresentation(): Promise<FollowerPresentationMode>;
  takeControl(): Promise<CompanionSnapshot | null>;
  returnControl(): Promise<CompanionSnapshot | null>;
  pauseSession(): Promise<CompanionSnapshot | null>;
  finishSession(sessionId?: string): Promise<CompanionSnapshot | null>;
  setFollowerExpanded(expanded: boolean): Promise<FollowerPresentationMode>;
  beginFollowerDrag(): Promise<void>;
  updateFollowerDrag(): Promise<void>;
  endFollowerDrag(): Promise<void>;
  openRove(): Promise<void>;
  showBrowser(taskId?: string): Promise<boolean>;
  openTrustedExternal(intent: TrustedExternalIntent): Promise<void>;
  openRecording(taskId: string, recordingId: string): Promise<void>;
  getBrowserWorkspaces(): Promise<DesktopBrowserWorkspaceStatus>;
  createBrowserWorkspace(
    displayName: string,
  ): Promise<DesktopBrowserWorkspaceStatus>;
  selectBrowserWorkspace(
    workspaceId: string,
  ): Promise<DesktopBrowserWorkspaceStatus>;
  renameBrowserWorkspace(
    workspaceId: string,
    displayName: string,
  ): Promise<DesktopBrowserWorkspaceStatus>;
  deleteBrowserWorkspace(
    workspaceId: string,
  ): Promise<DesktopBrowserWorkspaceStatus>;
  executeProductIntent(
    intent: RendererProductIntent,
  ): Promise<LocalProductResult>;
  getTaskAttachmentPreview?(
    taskId: string,
    filename: string,
  ): Promise<string | null>;
}

export const companionIpcChannels = {
  windowFullscreen: "rove:window-fullscreen",
  windowFullscreenChanged: "rove:window-fullscreen-changed",
  surfaceSnapshot: "rove:surface-snapshot",
  surfaceChanged: "rove:surface-changed",
  surfaceTransition: "rove:surface-transition",
  snapshot: "rove:snapshot",
  notice: "rove:notice",
  liveSession: "rove:live-session",
  followerPresentation: "rove:follower-presentation",
  takeControl: "rove:take-control",
  returnControl: "rove:return-control",
  pauseSession: "rove:pause",
  finishSession: "rove:finish",
  followerExpanded: "rove:follower-expanded",
  followerDragBegin: "rove:follower-drag-begin",
  followerDragUpdate: "rove:follower-drag-update",
  followerDragEnd: "rove:follower-drag-end",
  openRove: "rove:open",
  showBrowser: "rove:show-browser",
  openTrustedExternal: "rove:open-trusted-external",
  openRecording: "rove:open-recording",
  browserWorkspaces: "rove:browser-workspaces",
  createBrowserWorkspace: "rove:create-browser-workspace",
  selectBrowserWorkspace: "rove:select-browser-workspace",
  renameBrowserWorkspace: "rove:rename-browser-workspace",
  deleteBrowserWorkspace: "rove:delete-browser-workspace",
  productIntent: "rove:product-intent",
  taskAttachmentPreview: "rove:task-attachment-preview",
} as const;
