import type { Session } from "@rove/protocol";

export type CompactFollowerExperience =
  | "ready"
  | "agent_working"
  | "human_required"
  | "human_controlling"
  | "paused"
  | "ready_for_review"
  | "capture";

export type CompactFollowerPrimaryAction =
  "take_control" | "return_control" | null;

export interface CompactFollowerViewModel {
  experience: CompactFollowerExperience;
  kicker: string;
  title: string;
  primaryAction: CompactFollowerPrimaryAction;
  primaryActionLabel?: string;
  description: string;
  canPause: boolean;
  canStop: boolean;
}

export function toCompactFollowerViewModel(
  session: Session | null,
): CompactFollowerViewModel {
  if (session === null) {
    return {
      experience: "ready",
      kicker: "Ready",
      title: "Waiting for a session",
      primaryAction: null,
      description: "Rove will appear beside its browser when a session starts.",
      canPause: false,
      canStop: false,
    };
  }

  if (session.status === "completed" || session.status === "failed") {
    return {
      experience: "ready_for_review",
      kicker: "Ready for review",
      title:
        session.status === "completed" ? "Session complete" : "Session stopped",
      primaryAction: null,
      description: "Open Rove to review the session details.",
      canPause: false,
      canStop: false,
    };
  }

  if (session.status === "paused") {
    return {
      experience: "paused",
      kicker: "Paused",
      title: "Agent control is paused",
      primaryAction: "return_control",
      primaryActionLabel: "Resume",
      description: "No agent browser mutations are admitted until you resume.",
      canPause: false,
      canStop: true,
    };
  }

  const live =
    session.status === "active" || session.status === "awaiting_human";

  if (!live) {
    return {
      experience: "ready",
      kicker: "Ready",
      title: "Waiting for a session",
      primaryAction: null,
      description: "Open Rove for session details.",
      canPause: false,
      canStop: false,
    };
  }

  if (session.mode === "capture") {
    return {
      experience: "capture",
      kicker: "Capture mode",
      title: "Use Rove Companion",
      primaryAction: null,
      description:
        "Capture remains controlled from the full Companion surface.",
      canPause: false,
      canStop: false,
    };
  }

  const requestedHandoff =
    session.status === "awaiting_human" &&
    session.controller === null &&
    session.handoff !== undefined;

  if (session.status === "awaiting_human" && session.controller === null) {
    const canTakeControl = session.mode === "companion" || requestedHandoff;

    return {
      experience: "human_required",
      kicker: "Your turn",
      title: requestedHandoff ? "Rove needs you" : "Waiting for control",
      primaryAction: canTakeControl ? "take_control" : null,
      ...(canTakeControl
        ? {
            primaryActionLabel: "Take over",
          }
        : {}),
      description: "Rove is waiting for human input before it can continue.",
      canPause: false,
      canStop: true,
    };
  }

  if (session.controller === "human") {
    return {
      experience: "human_controlling",
      kicker: "You're in control",
      title: "Browser control is yours",
      primaryAction: "return_control",
      primaryActionLabel: "Return",
      description:
        "Use the browser directly, then return control when finished.",
      canPause: false,
      canStop: true,
    };
  }

  const canTakeControl = session.mode === "companion";

  return {
    experience: "agent_working",
    kicker: "Agent working",
    title: "Rove is working",
    primaryAction: canTakeControl ? "take_control" : null,
    ...(canTakeControl
      ? {
          primaryActionLabel: "Take over",
        }
      : {}),
    description: "Rove is actively working in the owned browser.",
    canPause: true,
    canStop: true,
  };
}
