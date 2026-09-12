import type {
  CompanionSnapshot,
  DesktopNotice,
} from "../shared/desktop-api.js";
import {
  toUnifiedSessionViewModel,
  type UnifiedSessionExperience,
  type UnifiedSessionPrimaryAction,
} from "./unified-session-state.js";

export type CompanionExperience =
  | "no_session"
  | "agent_working"
  | "handoff_waiting"
  | "human_step"
  | "paused"
  | "capture"
  | "session_ended"
  | "interrupted";

export type CompanionPrimaryAction = UnifiedSessionPrimaryAction;

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

function companionExperience(
  experience: UnifiedSessionExperience,
): CompanionExperience {
  return experience === "human_controlling" ? "human_step" : experience;
}

/** Full presentation adapter over the one canonical Rove session model. */
export function toCompanionViewModel(
  snapshot: CompanionSnapshot | null,
  notice: DesktopNotice | null = null,
): CompanionViewModel {
  const session = snapshot?.session ?? null;
  const unified = toUnifiedSessionViewModel(session, notice);
  const sessionId = notice?.sessionId ?? session?.id ?? "—";
  const handoffReason = session?.handoff?.reason;
  const controller =
    session?.controller === "human"
      ? "You"
      : session?.controller === "agent"
        ? "Agent"
        : session === null
          ? "None"
          : "Waiting";

  return {
    hasSession: session !== null,
    experience: companionExperience(unified.experience),
    kicker: unified.kicker,
    title: unified.title,
    description: unified.description,
    ...(unified.supportingText === undefined
      ? {}
      : { supportingText: unified.supportingText }),
    primaryAction: unified.primaryAction,
    ...(unified.primaryActionLabel === undefined
      ? {}
      : { primaryActionLabel: unified.primaryActionLabel }),
    sessionId,
    mode: session?.mode ?? "—",
    status:
      notice !== null
        ? "Interrupted"
        : (session?.status.replaceAll("_", " ") ?? "No session"),
    controller,
    observationCount: snapshot?.observationCount ?? 0,
    evidenceCount: snapshot?.evidenceCount ?? 0,
    ...(handoffReason === undefined ? {} : { handoffReason }),
    canTakeControl: unified.primaryAction === "take_control",
    canReturnControl:
      unified.primaryAction === "return_control" ||
      unified.primaryAction === "resume",
    canFinish: unified.canStop || unified.primaryAction === "finish_capture",
  };
}
