import {
  toUnifiedSessionViewModel,
  type UnifiedSessionInput,
} from "./unified-session-state.js";

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

/** Compact presentation adapter over the one canonical Rove session model. */
export function toCompactFollowerViewModel(
  session: UnifiedSessionInput | null,
): CompactFollowerViewModel {
  const unified = toUnifiedSessionViewModel(session);

  if (unified.experience === "no_session") {
    return {
      experience: "ready",
      kicker: unified.kicker,
      title: unified.title,
      primaryAction: null,
      description: "Rove will appear beside its browser when a session starts.",
      canPause: false,
      canStop: false,
    };
  }

  if (
    unified.experience === "session_ended" ||
    unified.experience === "interrupted"
  ) {
    return {
      experience: "ready_for_review",
      kicker: unified.kicker,
      title: unified.title,
      primaryAction: null,
      description: unified.description,
      canPause: false,
      canStop: false,
    };
  }

  if (unified.experience === "paused") {
    return {
      experience: "paused",
      kicker: unified.kicker,
      title: unified.title,
      primaryAction: "return_control",
      primaryActionLabel: "Resume",
      description: unified.description,
      canPause: false,
      canStop: unified.canStop,
    };
  }

  if (unified.experience === "capture") {
    return {
      experience: "capture",
      kicker: unified.kicker,
      title: unified.title,
      primaryAction: null,
      description: unified.description,
      canPause: false,
      canStop: false,
    };
  }

  if (unified.experience === "handoff_waiting") {
    return {
      experience: "human_required",
      kicker: unified.kicker,
      title: unified.title,
      primaryAction:
        unified.primaryAction === "take_control" ? "take_control" : null,
      ...(unified.primaryActionLabel === undefined
        ? {}
        : { primaryActionLabel: unified.primaryActionLabel }),
      description: unified.description,
      canPause: false,
      canStop: unified.canStop,
    };
  }

  if (unified.experience === "human_controlling") {
    return {
      experience: "human_controlling",
      kicker: unified.kicker,
      title: unified.title,
      primaryAction: "return_control",
      primaryActionLabel: unified.primaryActionLabel ?? "Resume Automation",
      description: unified.description,
      canPause: false,
      canStop: unified.canStop,
    };
  }

  return {
    experience: "agent_working",
    kicker: unified.kicker,
    title: unified.title,
    primaryAction:
      unified.primaryAction === "take_control" ? "take_control" : null,
    ...(unified.primaryActionLabel === undefined
      ? {}
      : { primaryActionLabel: unified.primaryActionLabel }),
    description: unified.description,
    canPause: unified.canPause,
    canStop: unified.canStop,
  };
}
