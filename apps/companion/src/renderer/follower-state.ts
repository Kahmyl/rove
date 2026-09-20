import type { CustomerBrowserCollaboration } from "../main/codex/customer-task-collaboration.js";
import { customerTaskCollaboration } from "../main/codex/customer-task-collaboration.js";
import type { ProductTaskProjection } from "../main/codex/local-product-api.js";
import type { DesktopSurfaceSnapshot } from "../shared/desktop-api.js";
import {
  toUnifiedSessionViewModel,
  type UnifiedSessionInput,
} from "./unified-session-state.js";

export type CompactFollowerExperience =
  | "ready"
  | "agent_working"
  | "human_required"
  | "human_controlling"
  | "checking_after_return"
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
  canStop: boolean;
}

export interface CompactFollowerTaskContext {
  session: UnifiedSessionInput | null;
  task?: ProductTaskProjection;
  browser?: CustomerBrowserCollaboration;
}

export interface CompactFollowerTakeControlTarget {
  taskId: string;
  handoffGeneration?: number;
}

/** Resolve follower authority from the Task bound to the exact live session. */
export function compactFollowerTaskContext(
  desktop: DesktopSurfaceSnapshot | null,
): CompactFollowerTaskContext {
  const session =
    desktop?.notice === null ? (desktop.companion?.session ?? null) : null;
  const task = desktop?.product?.tasks.find(
    (candidate) => candidate.roveSessionId === session?.id,
  );
  if (!task) return { session };

  return {
    session,
    task,
    browser:
      task.customerCollaboration?.browser ??
      customerTaskCollaboration(task, desktop?.product?.attention ?? [])
        .browser,
  };
}

export function compactFollowerTakeControlTarget(
  context: CompactFollowerTaskContext,
): CompactFollowerTakeControlTarget | null {
  if (!context.task || context.browser?.canTakeOver !== true) return null;
  if (
    context.browser.state !== "takeover_available" &&
    (context.browser.state !== "takeover_required" ||
      context.browser.handoffGeneration === undefined)
  )
    return null;
  return {
    taskId: context.task.taskId,
    ...(context.browser.handoffGeneration === undefined
      ? {}
      : { handoffGeneration: context.browser.handoffGeneration }),
  };
}

/** Compact presentation of canonical Task collaboration and session lifecycle. */
export function toCompactFollowerViewModel(
  session: UnifiedSessionInput | null,
  browser?: CustomerBrowserCollaboration,
  canStop = false,
): CompactFollowerViewModel {
  const unified = toUnifiedSessionViewModel(session);

  if (unified.experience === "no_session") {
    return {
      experience: "ready",
      kicker: unified.kicker,
      title: unified.title,
      primaryAction: null,
      description: "Rove will appear beside its browser when a session starts.",
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
      canStop: false,
    };
  }

  if (unified.experience === "capture") {
    return {
      experience: "capture",
      kicker: unified.kicker,
      title: unified.title,
      primaryAction: null,
      description: unified.description,
      canStop,
    };
  }

  if (browser?.state === "takeover_required") {
    const canTakeOver =
      browser.canTakeOver && browser.handoffGeneration !== undefined;
    return {
      experience: "human_required",
      kicker: "Your turn",
      title: browser.title,
      primaryAction: canTakeOver ? "take_control" : null,
      ...(canTakeOver ? { primaryActionLabel: "Take Over" } : {}),
      description: browser.description,
      canStop,
    };
  }

  if (browser?.state === "human_control") {
    return {
      experience: "human_controlling",
      kicker: "You're in control",
      title: browser.title,
      primaryAction: browser.canReturnToRove ? "return_control" : null,
      ...(browser.canReturnToRove
        ? { primaryActionLabel: "Return to Rove" }
        : {}),
      description: browser.description,
      canStop,
    };
  }

  if (browser?.state === "checking_after_return") {
    return {
      experience: "checking_after_return",
      kicker: "Checking",
      title: browser.title,
      primaryAction: null,
      description: browser.description,
      canStop,
    };
  }

  if (unified.experience === "paused") {
    return {
      experience: "paused",
      kicker: unified.kicker,
      title: unified.title,
      primaryAction: null,
      description: unified.description,
      canStop,
    };
  }

  const canTakeOver =
    browser?.state === "takeover_available" && browser.canTakeOver;
  return {
    experience: "agent_working",
    kicker: "Agent working",
    title: browser?.title ?? unified.title,
    primaryAction: canTakeOver ? "take_control" : null,
    ...(canTakeOver ? { primaryActionLabel: "Take Over" } : {}),
    description: browser?.description ?? unified.description,
    canStop,
  };
}
