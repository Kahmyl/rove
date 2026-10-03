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

  it("projects exhausted recovery as a bounded inability to confirm", () => {
    expect(
      customerTaskPresentation({ execution: execution("unresolved") }),
    ).toMatchObject({
      state: "outcome_unclear",
      sidebar: { label: "Task state unclear", tone: "muted" },
      conversationStatus: { title: "Task state unclear" },
      terminalWorkLabel: "Couldn't continue",
    });
  });

  it("uses turn and consequential-effect authority instead of activity-row outcomes", () => {
    const failed = customerTaskPresentation({
      execution: execution("failed", "failed"),
    });
    const uncertain = customerTaskPresentation({
      execution: execution("idle", "unresolved"),
      consequentialOutcomeUnclear: true,
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
    expect(failed.conversationStatus).toBeUndefined();
    expect(uncertain).toMatchObject({
      state: "outcome_unclear",
      conversationStatus: { title: "Outcome unclear" },
    });
    expect(uncertain.sidebar).toBeUndefined();
    expect(uncertain.retry).toBeUndefined();
    expect(
      customerTaskPresentation({ execution: execution("idle", "failed") }),
    ).toMatchObject({ state: "ready", terminalWorkLabel: "Worked" });
    expect(
      customerTaskPresentation({ execution: execution("idle", "unresolved") }),
    ).toMatchObject({ state: "ready", terminalWorkLabel: "Worked" });
    const recoveredAfterFailedCommand = execution("idle", "failed");
    recoveredAfterFailedCommand.segments = [
      {
        ...recoveredAfterFailedCommand.segments[0]!,
        finalAnswerItemIds: ["assistant:successful-final"],
      },
    ];
    expect(
      customerTaskPresentation({ execution: recoveredAfterFailedCommand }),
    ).toMatchObject({ state: "ready", terminalWorkLabel: "Worked" });
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
  it("keeps exact unresolved markers alongside newer active work and removes only resolved facts", () => {
    const facts = {
      execution: execution("working"),
      consequentialOutcomeUnclear: true,
      unresolvedResultIds: ["result_exact"],
      uncertainInputIds: ["input_exact"],
    };
    const value = customerTaskPresentation(facts);
    expect(value.state).toBe("working");
    expect(value.markers).toHaveLength(1);
    expect(value.markers![0]!.key).toContain("result_exact");
    expect(value.markers![0]!.key).toContain("input_exact");
    expect(
      customerTaskPresentation({ execution: execution("working") }).markers,
    ).toBeUndefined();
    expect(
      customerTaskPresentation({ execution: execution("checking") }).markers,
    ).toBeUndefined();
    expect(
      customerTaskPresentation({ execution: execution("stopped") }).markers,
    ).toBeUndefined();
  });
  it("retains a legacy effect fence marker alongside active work without granting recovery", () => {
    const value = customerTaskPresentation({
      execution: execution("working"),
      legacyOutcomeUnclear: true,
    });
    expect(value.state).toBe("working");
    expect(value.markers).toMatchObject([{ title: "Outcome unclear" }]);
    expect(value.retry).toBeUndefined();
    expect(
      customerTaskPresentation({
        execution: execution("working"),
        legacyOutcomeUnclear: false,
      }).markers,
    ).toBeUndefined();
  });
  it("lets newer stopping and stopped truth win immediately without creating warning noise", () => {
    const states = ["checking", "stopping", "stopped"] as const;
    expect(
      states.map(
        (state) =>
          customerTaskPresentation({ execution: execution(state) }).state,
      ),
    ).toEqual(states);
    expect(
      states.map(
        (state) =>
          customerTaskPresentation({ execution: execution(state) }).markers,
      ),
    ).toEqual([undefined, undefined, undefined]);
  });
});
