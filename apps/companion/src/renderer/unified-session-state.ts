import type { DesktopNotice } from "../shared/desktop-api.js";
import type { Session } from "@rove/protocol";

export type UnifiedSessionInput = Pick<
  Session,
  "id" | "mode" | "status" | "controller" | "handoff"
>;

export type UnifiedSessionExperience =
  | "no_session"
  | "agent_working"
  | "handoff_waiting"
  | "human_controlling"
  | "paused"
  | "capture"
  | "session_ended"
  | "interrupted";

export type UnifiedSessionPrimaryAction =
  "take_control" | "return_control" | "resume" | "finish_capture" | null;

export interface UnifiedSessionViewModel {
  experience: UnifiedSessionExperience;
  kicker: string;
  title: string;
  description: string;
  supportingText?: string;
  primaryAction: UnifiedSessionPrimaryAction;
  primaryActionLabel?: string;
  canPause: boolean;
  canStop: boolean;
  canOpenDetails: boolean;
}

/**
 * The canonical semantic model for every Rove presentation. A chip, expanded
 * card, and full control center may reveal different amounts of this model,
 * but they must never derive different session meaning or authority.
 */
export function toUnifiedSessionViewModel(
  session: UnifiedSessionInput | null,
  notice: DesktopNotice | null = null,
): UnifiedSessionViewModel {
  if (notice !== null) {
    return {
      experience: "interrupted",
      kicker: "Session interrupted",
      title: notice.title,
      description: notice.message,
      ...(notice.supportingText === undefined
        ? {}
        : { supportingText: notice.supportingText }),
      primaryAction: null,
      canPause: false,
      canStop: false,
      canOpenDetails: true,
    };
  }

  if (session === null) {
    return {
      experience: "no_session",
      kicker: "Ready",
      title: "Waiting for a session",
      description: "Rove will appear when a browser task starts.",
      primaryAction: null,
      canPause: false,
      canStop: false,
      canOpenDetails: false,
    };
  }

  if (session.status === "completed" || session.status === "failed") {
    return {
      experience: "session_ended",
      kicker: "Ready for review",
      title:
        session.status === "completed" ? "Session complete" : "Session stopped",
      description:
        "Open the session details to review its activity and evidence.",
      primaryAction: null,
      canPause: false,
      canStop: false,
      canOpenDetails: true,
    };
  }

  if (session.status === "paused") {
    return {
      experience: "paused",
      kicker: "Paused",
      title: "Agent control is paused",
      description: "No agent browser mutations are admitted until you resume.",
      primaryAction: "resume",
      primaryActionLabel: "Resume",
      canPause: false,
      canStop: true,
      canOpenDetails: true,
    };
  }

  if (session.mode === "capture") {
    return {
      experience: "capture",
      kicker: "Capture mode",
      title: "You're in control",
      description: "Rove is observing this browser session while you work.",
      primaryAction: "finish_capture",
      primaryActionLabel: "Finish Capture",
      canPause: false,
      canStop: true,
      canOpenDetails: true,
    };
  }

  const requestedHandoff =
    session.status === "awaiting_human" &&
    session.controller === null &&
    session.handoff !== undefined;

  if (session.status === "awaiting_human" && session.controller === null) {
    const canTakeControl = session.mode === "companion" || requestedHandoff;
    return {
      experience: "handoff_waiting",
      kicker: "Your turn",
      title: "Rove needs you for one step",
      description:
        session.handoff?.reason ??
        "Rove is waiting for human input before it can continue.",
      supportingText: "Rove is paused until you take over.",
      primaryAction: canTakeControl ? "take_control" : null,
      ...(canTakeControl ? { primaryActionLabel: "Start this step" } : {}),
      canPause: false,
      canStop: true,
      canOpenDetails: true,
    };
  }

  if (session.controller === "human") {
    const requestedStep = session.handoff?.reason !== undefined;
    return {
      experience: "human_controlling",
      kicker: "You're in control",
      title: requestedStep
        ? "You're handling this step"
        : "Browser control is yours",
      description:
        session.handoff?.reason ??
        "Use the browser directly, then resume automation when you're done.",
      supportingText: "Rove is paused while you work.",
      primaryAction: "return_control",
      primaryActionLabel: requestedStep
        ? "Done — Resume Automation"
        : "Resume Automation",
      canPause: false,
      canStop: true,
      canOpenDetails: true,
    };
  }

  const canTakeControl = session.mode === "companion";
  return {
    experience: "agent_working",
    kicker: "Agent working",
    title: "Working in the browser",
    description: "No action is needed from you right now.",
    supportingText: canTakeControl
      ? "You can take over whenever you need to."
      : "Rove will ask when it needs your help.",
    primaryAction: canTakeControl ? "take_control" : null,
    ...(canTakeControl ? { primaryActionLabel: "Take over" } : {}),
    canPause: true,
    canStop: true,
    canOpenDetails: true,
  };
}
