import { describe, expect, it } from "vitest";

import type {
  ProductAttentionProjection,
  ProductTaskProjection,
} from "./local-product-api.js";
import { customerTaskCollaboration } from "./customer-task-collaboration.js";

function task(
  taskId = "task_a",
  overrides: Partial<ProductTaskProjection> = {},
): ProductTaskProjection {
  return {
    taskId,
    executionMode: "agent",
    selectionSource: "user_selected",
    selectedAt: "2026-09-20T00:00:00.000Z",
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
    ...overrides,
  };
}

function attention(
  requestId: string,
  kind: ProductAttentionProjection["kind"],
  sequence: number,
  overrides: Partial<ProductAttentionProjection> = {},
): ProductAttentionProjection {
  return {
    authority: kind === "control_handoff" ? "rove_control" : "codex",
    kind,
    requestId,
    taskId: "task_a",
    generation: 4,
    status: "pending",
    sequence,
    title: `Title ${requestId}`,
    ...overrides,
  };
}

describe("customer Task collaboration projection", () => {
  it("prioritizes deterministically outside React and preserves exact identity", () => {
    const projected = customerTaskCollaboration(task(), [
      attention("approval_old", "file_approval", 1),
      attention("question_later", "user_input", 9, {
        threadId: "thread_a",
        turnId: "turn_a",
        itemId: "item_a",
        generation: 7,
      }),
      attention("permission_mid", "permission_approval", 2),
    ]);

    expect(projected.request).toMatchObject({
      state: "answer_required",
      kind: "user_input",
      identity: {
        requestId: "question_later",
        taskId: "task_a",
        threadId: "thread_a",
        turnId: "turn_a",
        itemId: "item_a",
        generation: 7,
      },
      actions: [{ kind: "respond", decision: "accept", label: "Send" }],
    });
  });

  it("excludes resolved, cancelled, and stale requests from actionability", () => {
    for (const status of ["resolved", "cancelled", "stale"] as const) {
      const projected = customerTaskCollaboration(task(), [
        attention(`request_${status}`, "user_input", 1, { status }),
      ]);
      expect(projected.request).toBeUndefined();
      expect(projected.needsCustomerAction).toBe(false);
    }
  });

  it("keeps response-in-flight ahead of a new request without changing identity", () => {
    const projected = customerTaskCollaboration(task(), [
      attention("new_question", "user_input", 2),
      attention("submitting_approval", "command_approval", 1, {
        status: "responding",
      }),
    ]);
    expect(projected.request).toMatchObject({
      state: "submitting",
      responseState: "submitting",
      identity: { requestId: "submitting_approval" },
      actions: [],
    });
  });

  it("preserves family-specific approval and elicitation decisions", () => {
    expect(
      customerTaskCollaboration(task(), [
        attention("permission", "permission_approval", 1),
      ]).request?.actions,
    ).toEqual([
      { kind: "respond", decision: "accept", label: "Allow" },
      { kind: "respond", decision: "decline", label: "Deny" },
    ]);
    expect(
      customerTaskCollaboration(task(), [
        attention("command", "command_approval", 1, {
          allowedDecisions: ["decline"],
        }),
      ]).request?.actions,
    ).toEqual([
      { kind: "respond", decision: "decline", label: "Decline" },
    ]);
    expect(
      customerTaskCollaboration(task(), [
        attention("url", "mcp_elicitation", 1, {
          elicitation: { mode: "url", message: "Connect the account" },
        }),
      ]).request,
    ).toMatchObject({
      state: "secure_interaction_required",
      actions: [
        { kind: "trusted_external", label: "Open secure page" },
        { kind: "respond", decision: "accept", label: "Continue" },
        { kind: "respond", decision: "decline", label: "Decline" },
        { kind: "respond", decision: "cancel", label: "Cancel" },
      ],
    });
  });

  it("keeps unsupported MCP forms visible but non-submittable", () => {
    const projected = customerTaskCollaboration(task(), [
      attention("unsupported", "mcp_elicitation", 1, {
        elicitation: {
          mode: "form",
          message: "Supply values",
          fields: [],
          unsupportedReason: "This form uses unsupported constraints.",
        },
      }),
    ]);
    expect(projected.request?.actions).toEqual([
      { kind: "respond", decision: "decline", label: "Decline" },
      { kind: "respond", decision: "cancel", label: "Cancel" },
    ]);
  });

  it("classifies secret questions without ever carrying an answer value", () => {
    const projected = customerTaskCollaboration(task(), [
      attention("secret", "user_input", 1, {
        questions: [
          {
            id: "password",
            header: "Password",
            question: "Enter the password",
            isOther: false,
            isSecret: true,
            options: null,
          },
        ],
      }),
    ]);
    expect(projected.request).toMatchObject({
      state: "secure_interaction_required",
      sensitive: true,
    });
    expect(JSON.stringify(projected)).not.toContain("answer");
  });

  it("requires the exact Task and handoff generation for Take Over", () => {
    const takeoverTask = task("task_a", {
      capabilities: {
        ...task().capabilities!,
        canTakeControl: true,
      },
      runtime: {
        status: "awaiting_human",
        controller: null,
        attachment: "attached",
        recovery: "not_needed",
        profileOwnership: "owned",
        handoffActionable: true,
        handoffGeneration: 6,
        collaborationState: "takeover_required",
      },
    });
    const exact = attention("handoff_exact", "control_handoff", 1, {
      generation: 6,
      continuationPolicy: "resume_after_control_return",
    });
    expect(customerTaskCollaboration(takeoverTask, [exact]).browser).toMatchObject(
      {
        state: "takeover_required",
        canTakeOver: true,
        handoffGeneration: 6,
      },
    );
    expect(
      customerTaskCollaboration(takeoverTask, [
        { ...exact, generation: 5 },
      ]).browser.canTakeOver,
    ).toBe(false);
    expect(
      customerTaskCollaboration(takeoverTask, [
        { ...exact, taskId: "task_b" },
      ]).browser.canTakeOver,
    ).toBe(false);
  });

  it("projects human ownership, return authority, and post-return checking", () => {
    const human = task("task_a", {
      capabilities: {
        ...task().capabilities!,
        canReturnToRove: true,
      },
      runtime: {
        status: "paused",
        controller: "human",
        attachment: "attached",
        recovery: "not_needed",
        profileOwnership: "owned",
        collaborationState: "human_control",
        continuationPolicy: "explicit_user_response",
      },
    });
    expect(customerTaskCollaboration(human, []).browser).toMatchObject({
      state: "human_control",
      canReturnToRove: true,
      continuationPolicy: "explicit_user_response",
    });

    const checking = task("task_a", {
      runtime: {
        status: "active",
        controller: "agent",
        attachment: "attached",
        recovery: "not_needed",
        profileOwnership: "owned",
        collaborationState: "checking_after_return",
        continuationPolicy: "resume_after_control_return",
      },
    });
    expect(customerTaskCollaboration(checking, []).browser).toMatchObject({
      state: "checking_after_return",
      title: "Checking the page…",
      canReturnToRove: false,
    });
  });

  it("offers voluntary takeover only for an exact active Companion browser", () => {
    const companion = task("task_a", {
      executionMode: "companion",
      capabilities: { ...task().capabilities!, canTakeControl: true },
      runtime: {
        status: "active",
        controller: "agent",
        attachment: "attached",
        recovery: "not_needed",
        profileOwnership: "owned",
        collaborationState: "agent_control",
      },
    });
    expect(customerTaskCollaboration(companion, []).browser).toMatchObject({
      state: "takeover_available",
      canTakeOver: true,
    });
    expect(
      customerTaskCollaboration(
        { ...companion, executionMode: "agent" },
        [],
      ).browser.canTakeOver,
    ).toBe(false);
  });
});
