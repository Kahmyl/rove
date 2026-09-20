import { describe, expect, it } from "vitest";

import type { CustomerTaskExecutionProjection } from "./customer-task-execution.js";
import { customerTaskPresentation } from "./customer-task-presentation.js";

function execution(
  state: CustomerTaskExecutionProjection["state"],
  outcome?: "failed" | "unresolved",
): CustomerTaskExecutionProjection {
  return {
    state,
    queue: [],
    segments: outcome
      ? [
          {
            id: "work",
            commentaryItemIds: [],
            finalAnswerItemIds: [],
            activities: [
              {
                id: "activity",
                itemId: "item",
                kind: "change",
                state: outcome,
                label: "Changing",
              },
            ],
            workOrder: [],
            status: "terminal",
            accumulatedActiveMs: 0,
          },
        ]
      : [],
  };
}

describe("customer Task presentation", () => {
  it.each([
    ["working", "Working"],
    ["stopping", "Stopping"],
    ["stopped", "Stopped"],
  ] as const)("projects %s without lifecycle copy", (state, label) => {
    expect(
      customerTaskPresentation({ execution: execution(state) }).sidebar,
    ).toMatchObject({ label });
  });

  it("keeps recovery neutral and never accepts its diagnostic as copy", () => {
    const value = customerTaskPresentation({
      execution: execution("checking"),
      capabilities: {
        canSubmit: false,
        canQueue: false,
        canSteer: false,
        canStop: true,
        canRespond: false,
        canTakeControl: false,
        canReturnToRove: false,
        canRetry: false,
        canArchive: false,
      },
    });
    expect(value).toMatchObject({
      state: "checking",
      sidebar: { label: "Checking state", tone: "neutral" },
      conversationStatus: { title: "Checking task state…" },
    });
    expect(JSON.stringify(value)).not.toContain("recoveryRequired");
    expect(JSON.stringify(value)).not.toContain("TaskEngine");
  });

  it("removes the checking label when reconciliation reaches ordinary readiness", () => {
    expect(
      customerTaskPresentation({ execution: execution("idle") }),
    ).toMatchObject({ state: "ready", terminalWorkLabel: "Worked" });
    expect(
      customerTaskPresentation({ execution: execution("idle") }).sidebar,
    ).toBeUndefined();
  });

  it("distinguishes confirmed failure from an uncertain consequential outcome", () => {
    const failed = customerTaskPresentation({
      execution: execution("failed", "failed"),
    });
    const uncertain = customerTaskPresentation({
      execution: execution("failed", "unresolved"),
      capabilities: {
        canSubmit: true,
        canQueue: false,
        canSteer: false,
        canStop: false,
        canRespond: false,
        canTakeControl: false,
        canReturnToRove: false,
        canRetry: false,
        canArchive: true,
      },
    });
    expect(failed).toMatchObject({
      state: "failed",
      sidebar: { label: "Couldn't continue" },
    });
    expect(uncertain).toMatchObject({
      state: "outcome_unclear",
      conversationStatus: { title: "Outcome unclear" },
    });
    expect(uncertain.sidebar).toBeUndefined();
    expect(uncertain.retry).toBeUndefined();
  });

  it("exposes only the exact cleanup retry already granted by capability authority", () => {
    expect(
      customerTaskPresentation({
        execution: execution("failed"),
        capabilities: {
          canSubmit: false,
          canQueue: false,
          canSteer: false,
          canStop: false,
          canRespond: false,
          canTakeControl: false,
          canReturnToRove: false,
          canRetry: true,
          canArchive: false,
        },
      }).retry,
    ).toEqual({ kind: "cleanup", label: "Retry cleanup" });
  });

  it("prioritizes each Task's collaboration state independently", () => {
    const human = customerTaskPresentation({
      execution: execution("idle"),
      collaboration: {
        taskId: "task_human",
        needsCustomerAction: true,
        browser: {
          state: "human_control",
          title: "You're in control",
          description: "Return when ready.",
          canTakeOver: false,
          canReturnToRove: true,
        },
      },
    });
    const input = customerTaskPresentation({
      execution: execution("waiting_for_you"),
      collaboration: {
        taskId: "task_input",
        needsCustomerAction: true,
        browser: {
          state: "none",
          title: "No browser collaboration needed",
          description: "No browser wait.",
          canTakeOver: false,
          canReturnToRove: false,
        },
      },
    });
    expect(human.sidebar?.label).toBe("You're in control");
    expect(input.sidebar?.label).toBe("Needs input");
  });
});
