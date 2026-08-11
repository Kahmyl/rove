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
  takeControl(): Promise<CompanionSnapshot | null>;
  returnControl(): Promise<CompanionSnapshot | null>;
  finishSession(): Promise<CompanionSnapshot | null>;
}

export const companionIpcChannels = {
  snapshot: "rove:snapshot",
  notice: "rove:notice",
  takeControl: "rove:take-control",
  returnControl: "rove:return-control",
  finishSession: "rove:finish",
} as const;
