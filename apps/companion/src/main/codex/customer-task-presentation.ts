import type { Recording } from "@rove/protocol";

import type { CustomerTaskCollaborationProjection } from "./customer-task-collaboration.js";
import type { CustomerTaskExecutionProjection } from "./customer-task-execution.js";
import type { ProductTaskCapabilities } from "./task-coordinator.js";

export type CustomerTaskPresentationState =
  | "ready"
  | "working"
  | "needs_input"
  | "human_control"
  | "checking"
  | "stopping"
  | "stopped"
  | "capturing"
  | "failed"
  | "outcome_unclear";

export interface CustomerTaskPresentation {
  state: CustomerTaskPresentationState;
  sidebar?: {
    label:
      | "Working"
      | "Needs input"
      | "You're in control"
      | "Checking state"
      | "Stopping"
      | "Stopped"
      | "Capturing"
      | "Couldn't continue";
    tone: "neutral" | "attention" | "muted" | "danger";
  };
  conversationStatus?: {
    title: string;
    description: string;
    tone: "neutral" | "muted" | "danger";
  };
  terminalWorkLabel: "Worked" | "Stopped" | "Couldn't continue";
  retry?: { kind: "cleanup"; label: "Retry cleanup" };
}

export interface CustomerTaskPresentationFacts {
  execution: CustomerTaskExecutionProjection;
  collaboration?: CustomerTaskCollaborationProjection;
  capabilities?: ProductTaskCapabilities;
  latestDelivery?: "pending" | "materialized" | "not_sent" | "uncertain";
  recordings?: readonly Recording[];
}

function latestActivityOutcomes(
  execution: CustomerTaskExecutionProjection,
): ReadonlySet<string> {
  return new Set(
    (execution.segments.at(-1)?.activities ?? []).map(
      (activity) => activity.state,
    ),
  );
}

/**
 * Customer Task status is a presentation-only projection. It does not grant
 * an operation, settle recovery/effect truth, or change lifecycle ownership.
 */
export function customerTaskPresentation(
  facts: CustomerTaskPresentationFacts,
): CustomerTaskPresentation {
  const outcomes = latestActivityOutcomes(facts.execution);
  const retry = facts.capabilities?.canRetry
    ? ({ kind: "cleanup", label: "Retry cleanup" } as const)
    : undefined;
  const result = (
    state: CustomerTaskPresentationState,
    values: Omit<CustomerTaskPresentation, "state" | "terminalWorkLabel"> & {
      terminalWorkLabel?: CustomerTaskPresentation["terminalWorkLabel"];
    } = {},
  ): CustomerTaskPresentation => ({
    state,
    terminalWorkLabel: values.terminalWorkLabel ?? "Worked",
    ...(values.sidebar ? { sidebar: values.sidebar } : {}),
    ...(values.conversationStatus
      ? { conversationStatus: values.conversationStatus }
      : {}),
    ...(retry ? { retry } : {}),
  });

  if (facts.execution.state === "stopping")
    return result("stopping", {
      sidebar: { label: "Stopping", tone: "muted" },
    });
  if (facts.execution.state === "checking")
    return result("checking", {
      sidebar: { label: "Checking state", tone: "neutral" },
      conversationStatus: {
        title: "Checking task state…",
        description: "Rove is confirming the latest task activity.",
        tone: "neutral",
      },
    });
  if (facts.collaboration?.browser.state === "checking_after_return")
    return result("checking", {
      sidebar: { label: "Checking state", tone: "neutral" },
      conversationStatus: {
        title: facts.collaboration.browser.title,
        description: facts.collaboration.browser.description,
        tone: "neutral",
      },
    });
  if (facts.collaboration?.browser.state === "human_control")
    return result("human_control", {
      sidebar: { label: "You're in control", tone: "attention" },
    });
  if (facts.collaboration?.needsCustomerAction)
    return result("needs_input", {
      sidebar: { label: "Needs input", tone: "attention" },
    });
  if (
    facts.recordings?.some((recording) =>
      ["requested", "recording", "finalizing"].includes(recording.state),
    )
  )
    return result("capturing", {
      sidebar: { label: "Capturing", tone: "neutral" },
    });
  if (facts.execution.state === "working")
    return result("working", {
      sidebar: { label: "Working", tone: "neutral" },
    });
  if (outcomes.has("unresolved") || facts.latestDelivery === "uncertain")
    return result("outcome_unclear", {
      conversationStatus: {
        title: "Outcome unclear",
        description:
          "Rove could not confirm what happened. It will not repeat the affected action automatically.",
        tone: "danger",
      },
      terminalWorkLabel: "Couldn't continue",
    });
  if (facts.execution.state === "stopped")
    return result("stopped", {
      sidebar: { label: "Stopped", tone: "muted" },
      terminalWorkLabel: "Stopped",
    });
  if (
    facts.execution.state === "failed" ||
    outcomes.has("failed") ||
    facts.latestDelivery === "not_sent"
  )
    return result("failed", {
      sidebar: { label: "Couldn't continue", tone: "danger" },
      terminalWorkLabel: "Couldn't continue",
    });
  return result("ready");
}
