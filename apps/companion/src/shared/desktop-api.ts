import type { Session } from "@rove/protocol";

export interface CompanionSnapshot {
  session: Session;
  observationCount: number;
  evidenceCount: number;
}

export interface RoveDesktopApi {
  getSnapshot(): Promise<CompanionSnapshot | null>;
  takeControl(): Promise<CompanionSnapshot | null>;
  returnControl(): Promise<CompanionSnapshot | null>;
  finishSession(): Promise<CompanionSnapshot | null>;
}

export const companionIpcChannels = {
  snapshot: "rove:snapshot",
  takeControl: "rove:take-control",
  returnControl: "rove:return-control",
  finishSession: "rove:finish",
} as const;
