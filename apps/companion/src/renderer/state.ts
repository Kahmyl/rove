import type { CompanionSnapshot } from "../shared/desktop-api.js";

export interface CompanionViewModel {
  hasSession: boolean;
  sessionId: string;
  mode: string;
  status: string;
  controller: string;
  observationCount: number;
  evidenceCount: number;
  handoffReason?: string;
  canTakeControl: boolean;
  canReturnControl: boolean;
  canFinish: boolean;
}

export function toCompanionViewModel(
  snapshot: CompanionSnapshot | null,
): CompanionViewModel {
  if (snapshot === null) {
    return {
      hasSession: false,
      sessionId: "—",
      mode: "—",
      status: "No session",
      controller: "None",
      observationCount: 0,
      evidenceCount: 0,
      canTakeControl: false,
      canReturnControl: false,
      canFinish: false,
    };
  }

  const { session } = snapshot;

  const live =
    session.status === "active" ||
    session.status === "awaiting_human";

  const controller =
    session.controller === "human"
      ? "You"
      : session.controller === "agent"
        ? "Agent"
        : "Waiting";

  return {
    hasSession: true,
    sessionId: session.id,
    mode: session.mode,
    status: session.status.replaceAll("_", " "),
    controller,
    observationCount: snapshot.observationCount,
    evidenceCount: snapshot.evidenceCount,
    ...(session.handoff === undefined
      ? {}
      : { handoffReason: session.handoff.reason }),
    canTakeControl:
      live && session.controller !== "human",
    canReturnControl:
      live && session.controller === "human",
    canFinish: live,
  };
}
