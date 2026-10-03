import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { customerTaskCollaboration } from "../main/codex/customer-task-collaboration.js";
import { customerTaskPresentation } from "../main/codex/customer-task-presentation.js";
import type {
  ProductAttentionProjection,
  ProductTaskProjection,
} from "../main/codex/local-product-api.js";
import {
  resolveTaskDock,
  TaskInteractionDock,
  TaskStopControl,
} from "./task-interaction-dock.js";

function task(): ProductTaskProjection {
  return {
    taskId: "task_a",
    executionMode: "agent",
    selectionSource: "user_selected",
    selectedAt: "2026-10-03T12:00:00Z",
    bootstrapStage: "complete",
    approvalsReviewer: "auto_review",
    results: [],
    lifecycle: { phase: "waiting_for_human", reason: "Waiting." },
    availableActions: [],
    capabilities: {
      canSubmit: false,
      canQueue: false,
      canSteer: false,
      canStop: true,
      canRespond: true,
      canTakeControl: false,
      canReturnToRove: false,
      canRetry: false,
      canArchive: false,
    },
  };
}
function attention(
  kind: ProductAttentionProjection["kind"],
): ProductAttentionProjection {
  return {
    authority: "codex",
    taskId: "task_a",
    requestId: "request_a",
    generation: 3,
    kind,
    status: "pending",
    sequence: 1,
    title: "Review this request",
    instruction: "Choose explicitly",
    threadId: "thread_a",
    turnId: "turn_a",
    itemId: "item_a",
  };
}
function resolve(value = task(), requests: ProductAttentionProjection[] = []) {
  const collaboration = customerTaskCollaboration(value, requests);
  const presentation = customerTaskPresentation({
    execution: { state: "waiting_for_you", queue: [], segments: [] },
    collaboration,
    capabilities: value.capabilities!,
  });
  return {
    input: { task: value, presentation, collaboration, attention: requests },
    dock: resolveTaskDock({
      task: value,
      presentation,
      collaboration,
      attention: requests,
    }),
  };
}
describe("Task interaction ownership", () => {
  for (const kind of [
    "user_input",
    "command_approval",
    "file_approval",
    "network_approval",
    "permission_approval",
    "mcp_elicitation",
  ] as const) {
    it(`routes exact ${kind} projection into one decision mode while retaining Stop`, () => {
      const request = attention(kind);
      const { input, dock } = resolve(task(), [request]);
      expect(dock).toEqual({ mode: "decision", request, showStop: true });
      expect(resolveTaskDock({ ...input, stopPending: true }).mode).toBe(
        "stopping",
      );
      for (const key of [
        "taskId",
        "authority",
        "requestId",
        "generation",
        "threadId",
        "turnId",
        "itemId",
      ] as const) {
        const stale = {
          ...request,
          [key]: key === "generation" ? 4 : "different",
        } as ProductAttentionProjection;
        expect(
          resolveTaskDock({ ...input, attention: [stale] }).request,
        ).toBeUndefined();
      }
      expect(
        resolveTaskDock({
          ...input,
          attention: [{ ...request, status: "resolved" }],
        }).request,
      ).toBeUndefined();
    });
  }
  it("ignores background attention and cannot grant Stop from a presentation label", () => {
    const value = task();
    value.capabilities!.canStop = false;
    const { input } = resolve(value, [
      { ...attention("command_approval"), taskId: "task_b" },
    ]);
    expect(resolveTaskDock(input)).toMatchObject({
      mode: "compose",
      showStop: false,
    });
    expect(
      resolveTaskDock({
        ...input,
        presentation: { ...input.presentation, state: "stopping" },
      }),
    ).toMatchObject({ mode: "stopping", showStop: true });
    const html = renderToStaticMarkup(
      <TaskStopControl disabled={false} stopping onStop={() => undefined} />,
    );
    expect(html).toContain('disabled=""');
  });
  it("uses browser and checking seams without replacing explicit response composition or safe resume", () => {
    const { input } = resolve();
    for (const state of [
      "takeover_required",
      "human_control",
      "checking_after_return",
    ] as const) {
      expect(
        resolveTaskDock({
          ...input,
          collaboration: {
            ...input.collaboration,
            browser: { ...input.collaboration.browser, state },
          },
        }).mode,
      ).toBe("browser");
    }
    expect(
      resolveTaskDock({
        ...input,
        collaboration: {
          ...input.collaboration,
          browser: {
            ...input.collaboration.browser,
            state: "agent_control",
            continuationPolicy: "explicit_user_response",
          },
        },
      }).mode,
    ).toBe("compose");
    expect(
      resolveTaskDock({
        ...input,
        presentation: { ...input.presentation, state: "checking" },
      }).mode,
    ).toBe("checking");
    expect(
      resolveTaskDock({
        ...input,
        task: { ...input.task, availableActions: ["resume"] },
        presentation: { ...input.presentation, state: "checking" },
      }).mode,
    ).toBe("compose");
    expect(
      renderToStaticMarkup(
        <TaskInteractionDock mode="decision">
          Existing exact response surface
        </TaskInteractionDock>,
      ),
    ).toContain('data-dock-mode="decision"');
  });
});
