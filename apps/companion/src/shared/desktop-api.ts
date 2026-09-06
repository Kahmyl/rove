import type { Session } from "@rove/protocol";

export interface CompanionSnapshot {
  session: Session;
  observationCount: number;
  evidenceCount: number;
}

export interface DesktopNotice {
  type: "session_interrupted";
  sessionId: string;
  title: string;
  message: string;
  supportingText: string;
}

export type FollowerPresentationMode =
  | "windowed_compact"
  | "windowed_expanded"
  | "fullscreen_micro"
  | "fullscreen_expanded";

export interface RoveDesktopApi {
  getSnapshot(): Promise<CompanionSnapshot | null>;
  getNotice(): Promise<DesktopNotice | null>;
  getLiveSession(): Promise<Session | null>;
  getFollowerPresentation(): Promise<FollowerPresentationMode>;
  takeControl(): Promise<CompanionSnapshot | null>;
  returnControl(): Promise<CompanionSnapshot | null>;
  pauseSession(): Promise<CompanionSnapshot | null>;
  finishSession(): Promise<CompanionSnapshot | null>;
  setFollowerExpanded(expanded: boolean): Promise<FollowerPresentationMode>;
  beginFollowerDrag(): Promise<void>;
  updateFollowerDrag(): Promise<void>;
  endFollowerDrag(): Promise<void>;
  openRove(): Promise<void>;
}

export const companionIpcChannels = {
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
} as const;
