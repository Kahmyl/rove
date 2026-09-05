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

export interface RoveDesktopApi {
  getSnapshot(): Promise<CompanionSnapshot | null>;
  getNotice(): Promise<DesktopNotice | null>;
  getLiveSession(): Promise<Session | null>;
  takeControl(): Promise<CompanionSnapshot | null>;
  returnControl(): Promise<CompanionSnapshot | null>;
  pauseSession(): Promise<CompanionSnapshot | null>;
  finishSession(): Promise<CompanionSnapshot | null>;
  setFollowerExpanded(expanded: boolean): Promise<void>;
  openRove(): Promise<void>;
}

export const companionIpcChannels = {
  snapshot: "rove:snapshot",
  notice: "rove:notice",
  liveSession: "rove:live-session",
  takeControl: "rove:take-control",
  returnControl: "rove:return-control",
  pauseSession: "rove:pause",
  finishSession: "rove:finish",
  followerExpanded: "rove:follower-expanded",
  openRove: "rove:open",
} as const;
