import type { CompanionSnapshot } from "../shared/desktop-api.js";

export type CompanionExperience =
  | "no_session"
  | "agent_working"
  | "handoff_waiting"
  | "human_step"
  | "capture"
  | "session_ended";

export type CompanionPrimaryAction =
  | "take_control"
  | "return_control"
  | "finish_capture"
  | null;

export interface CompanionViewModel {
  hasSession: boolean;
  experience: CompanionExperience;

  kicker: string;
  title: string;
  description: string;
  supportingText?: string;

  primaryAction: CompanionPrimaryAction;
  primaryActionLabel?: string;

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
      experience: "no_session",

      kicker: "Ready",
      title: "Waiting for a session",
      description:
        "Rove will appear here when an agent or Capture session starts.",

      primaryAction: null,

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

  const canTakeControl =
    session.mode === "companion" &&
    live &&
    session.controller !== "human";

  const canReturnControl =
    session.mode === "companion" &&
    live &&
    session.controller === "human";

  const canFinish = live;

  const handoffReason =
    session.handoff?.reason;

  const shared = {
    hasSession: true,
    sessionId: session.id,
    mode: session.mode,
    status: session.status.replaceAll("_", " "),
    controller,
    observationCount: snapshot.observationCount,
    evidenceCount: snapshot.evidenceCount,
    ...(handoffReason === undefined
      ? {}
      : { handoffReason }),
    canTakeControl,
    canReturnControl,
    canFinish,
  };

  if (!live) {
    return {
      ...shared,

      experience: "session_ended",

      kicker: "Session ended",
      title:
        session.status === "failed"
          ? "This session stopped"
          : "Session complete",
      description:
        session.status === "failed"
          ? "Rove is waiting for the next session."
          : "The browser session has finished.",

      primaryAction: null,
    };
  }

  if (session.mode === "capture") {
    return {
      ...shared,

      experience: "capture",

      kicker: "Capture mode",
      title: "You're in control",
      description:
        "Rove is observing this browser session while you work.",
      primaryAction:
        canFinish
          ? "finish_capture"
          : null,
      ...(canFinish
        ? {
            primaryActionLabel:
              "Finish Capture",
          }
        : {}),
    };
  }

  if (
    session.status === "awaiting_human" &&
    session.controller === null
  ) {
    return {
      ...shared,

      experience: "handoff_waiting",

      kicker: "Your turn",
      title:
        "Rove needs you for one step",
      description:
        handoffReason ??
        "Complete the requested step in the browser.",
      supportingText:
        "Rove is paused until you take over.",

      primaryAction:
        canTakeControl
          ? "take_control"
          : null,
      ...(canTakeControl
        ? {
            primaryActionLabel:
              "Start this step",
          }
        : {}),
    };
  }

  if (session.controller === "human") {
    const requestedStep =
      handoffReason !== undefined;

    return {
      ...shared,

      experience: "human_step",

      kicker: "You're in control",
      title:
        requestedStep
          ? "You're handling this step"
          : "Browser control is yours",
      description:
        handoffReason ??
        "Use the browser directly, then resume automation when you're done.",
      supportingText:
        "Rove is paused while you work.",

      primaryAction:
        canReturnControl
          ? "return_control"
          : null,
      ...(canReturnControl
        ? {
            primaryActionLabel:
              requestedStep
                ? "Done — Resume Automation"
                : "Resume Automation",
          }
        : {}),
    };
  }

  return {
    ...shared,

    experience: "agent_working",

    kicker: "Agent working",
    title:
      "Working in the browser",
    description:
      "No action is needed from you right now.",
    supportingText:
      "You can take over whenever you need to.",

    primaryAction:
      canTakeControl
        ? "take_control"
        : null,
    ...(canTakeControl
      ? {
          primaryActionLabel:
            "Take over",
        }
      : {}),
  };
}
