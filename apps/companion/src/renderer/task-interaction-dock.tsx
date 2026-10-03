import type { ReactNode } from "react";

import type { CustomerTaskCollaborationProjection } from "../main/codex/customer-task-collaboration.js";
import type { CustomerTaskPresentation } from "../main/codex/customer-task-presentation.js";
import type {
  ProductAttentionProjection,
  ProductTaskProjection,
} from "../main/codex/local-product-api.js";

export type TaskDockMode =
  "compose" | "decision" | "browser" | "checking" | "stopping" | "capture";

/** Presentation precedence only. Commands continue to validate their exact owning capability. */
export function resolveTaskDock(input: {
  task: ProductTaskProjection;
  presentation: CustomerTaskPresentation;
  collaboration: CustomerTaskCollaborationProjection;
  attention: readonly ProductAttentionProjection[];
  stopPending?: boolean;
}): {
  mode: TaskDockMode;
  request?: ProductAttentionProjection;
  showStop: boolean;
} {
  const { task, presentation, collaboration } = input;
  const identity =
    collaboration.taskId === task.taskId
      ? collaboration.request?.identity
      : undefined;
  const request =
    identity &&
    input.attention.find(
      (entry) =>
        entry.taskId === task.taskId &&
        (
          [
            "authority",
            "requestId",
            "generation",
            "threadId",
            "turnId",
            "itemId",
          ] as const
        ).every((key) => entry[key] === identity[key]) &&
        [
          "pending",
          "responding",
          "awaiting_confirmation",
          "resolution_unknown",
        ].includes(entry.status) &&
        (entry.status !== "pending" || task.capabilities?.canRespond === true),
    );
  const stopping = input.stopPending || presentation.state === "stopping";
  const mode: TaskDockMode = stopping
    ? "stopping"
    : request
      ? "decision"
      : collaboration.taskId === task.taskId &&
          [
            "takeover_required",
            "human_control",
            "checking_after_return",
          ].includes(collaboration.browser.state)
        ? "browser"
        : presentation.state === "checking" &&
            !task.capabilities?.canSubmit &&
            !task.capabilities?.canQueue &&
            !task.capabilities?.canSteer &&
            !task.availableActions.includes("resume")
          ? "checking"
          : task.executionMode === "capture"
            ? "capture"
            : "compose";
  return {
    mode,
    ...(request ? { request } : {}),
    showStop: stopping || task.capabilities?.canStop === true,
  };
}

export function TaskInteractionDock({
  mode,
  children,
}: {
  mode: TaskDockMode;
  children: ReactNode;
}) {
  return (
    <section
      className="task-interaction-dock"
      aria-label="Task interaction"
      data-dock-mode={mode}
    >
      {children}
    </section>
  );
}

export function TaskStopControl({
  disabled,
  stopping,
  onStop,
}: {
  disabled: boolean;
  stopping: boolean;
  onStop(): void;
}) {
  return (
    <button
      type="button"
      className="composer-submit task-stop-control"
      aria-label="Stop current work"
      title={stopping ? "Stopping…" : "Stop current work"}
      disabled={disabled || stopping}
      onClick={onStop}
    >
      <span aria-hidden="true">■</span>
    </button>
  );
}
