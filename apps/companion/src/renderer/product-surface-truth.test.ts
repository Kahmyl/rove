import { describe, expect, it } from "vitest";

import type {
  LocalProductSnapshot,
  ProductTaskProjection,
} from "../main/codex/local-product-api.js";
import {
  activeProductTask,
  reconcileSelectedTaskId,
  taskControlProjection,
  terminalProductTask,
} from "./product-surface-state.js";

const selectedAt = "2026-09-13T12:00:00.000Z";

function task(
  overrides: Partial<ProductTaskProjection> & { taskId: string },
): ProductTaskProjection {
  const { taskId, ...rest } = overrides;

  return {
    taskId,
    executionMode: "agent",
    selectionSource: "user_selected",
    selectedAt,
    approvalsReviewer: "auto_review",
    bootstrapStage: "complete",
    results: [],
    lifecycle: { phase: "ready", reason: "Ready." },
    availableActions: ["message", "finish"],
    ...rest,
  };
}

function product(
  tasks: readonly ProductTaskProjection[],
): LocalProductSnapshot {
  return {
    version: 9,
    host: {
      state: "ready",
      ready: true,
      restartAttempt: 0,
    },
    catalog: {
      account: {
        status: "logged_in",
        authMode: "chatgpt",
      },
      models: [],
      rateLimits: null,
      usage: null,
      refreshedAt: "2026-09-13T12:00:00.000Z",
    },
    attention: [],
    tasks,
    workflows: [],
    recoveryWarnings: [],
    draftAttachments: [],
    fileAttention: [],
  };
}

const agentRuntime: NonNullable<ProductTaskProjection["runtime"]> = {
  status: "active",
  controller: "agent",
  attachment: "attached",
  recovery: "not_needed",
  profileOwnership: "owned",
};

describe("UI Truth renderer projection table", () => {
  it("T02 — working task projects active Agent control only for the current task", () => {
    const working = task({
      taskId: "task_working",
      lifecycle: {
        phase: "working",
        reason: "Working.",
      },
      conversation: {
        activeTurnId: "turn_working",
        turnStatus: "in_progress",
        archived: false,
        items: {},
        turnOrder: ["turn_working"],
      },
      runtime: agentRuntime,
      availableActions: ["message", "interrupt", "finish"],
    });

    const state = product([working]);
    state.currentTaskId = working.taskId;

    expect(activeProductTask(state)).toBe(working);
    expect(terminalProductTask(working)).toBe(false);

    expect(taskControlProjection(working, state)).toEqual({
      controllerLabel: "Agent",
      canTakeControl: false,
      canPause: true,
    });

    expect(working.availableActions).toContain("interrupt");
    expect(working.conversation?.turnStatus).toBe("in_progress");
  });

  it("T03 — completed turn remains a usable conversation rather than a permanently closed task", () => {
    const completed = task({
      taskId: "task_completed",
      lifecycle: {
        phase: "ready",
        reason: "Ready for follow-up.",
      },
      conversation: {
        turnStatus: "completed",
        archived: false,
        items: {},
        turnOrder: ["turn_completed"],
      },
      availableActions: ["message", "finish"],
    });

    const state = product([completed]);
    state.currentTaskId = completed.taskId;

    expect(terminalProductTask(completed)).toBe(false);
    expect(completed.conversation?.turnStatus).toBe("completed");

    // Application truth says the durable conversation can still accept follow-up.
    expect(completed.availableActions).toContain("message");

    // A completed turn is not still projected as active browser mutation.
    expect(taskControlProjection(completed, state)).toEqual({
      controllerLabel: "None",
      canTakeControl: false,
      canPause: false,
    });
  });

  it("T04 — stopped/interrupted work preserves an explicit continuation route without projecting active execution", () => {
    const interrupted = task({
      taskId: "task_interrupted",
      lifecycle: {
        phase: "ready",
        reason: "Stopped by the user.",
      },
      conversation: {
        turnStatus: "completed",
        archived: false,
        items: {},
        turnOrder: ["turn_interrupted"],
      },
      availableActions: ["message", "resume", "finish"],
    });

    const state = product([interrupted]);
    state.currentTaskId = interrupted.taskId;

    expect(terminalProductTask(interrupted)).toBe(false);
    expect(interrupted.availableActions).toContain("resume");
    expect(interrupted.availableActions).toContain("message");

    expect(taskControlProjection(interrupted, state)).toEqual({
      controllerLabel: "None",
      canTakeControl: false,
      canPause: false,
    });
  });

  it("T05 — failed task is terminal and cannot remain the active execution projection", () => {
    const failed = task({
      taskId: "task_failed",
      lifecycle: {
        phase: "failed",
        reason: "The task failed.",
      },
      availableActions: [],
    });

    const state = product([failed]);
    state.currentTaskId = failed.taskId;

    expect(terminalProductTask(failed)).toBe(true);

    // currentTaskId alone must never resurrect terminal execution authority.
    expect(activeProductTask(state)).toBeUndefined();

    expect(taskControlProjection(failed, state)).toEqual({
      controllerLabel: "None",
      canTakeControl: false,
      canPause: false,
    });
  });

  it("T06 — pending human attention stays task-scoped and grants takeover only to its authoritative task", () => {
    const needsAttention = task({
      taskId: "task_attention",
      executionMode: "companion",
      lifecycle: {
        phase: "waiting_for_human",
        reason: "Complete sign in.",
      },
      runtime: {
        status: "awaiting_human",
        controller: null,
        attachment: "attached",
        recovery: "not_needed",
        profileOwnership: "owned",
      },
      availableActions: ["finish"],
    });

    const unrelated = task({
      taskId: "task_unrelated",
      lifecycle: {
        phase: "ready",
        reason: "Ready.",
      },
      availableActions: ["message", "finish"],
    });

    const state = product([needsAttention, unrelated]);
    state.currentTaskId = needsAttention.taskId;
    state.attention = [
      {
        authority: "rove_control",
        kind: "control_handoff",
        requestId: "control:ses_attention:1",
        taskId: needsAttention.taskId,
        threadId: "thread_attention",
        turnId: "turn_attention",
        generation: 1,
        status: "pending",
        sequence: 1,
        title: "Browser control handoff",
        instruction: "Complete sign in.",
        continuationPolicy: "resume_after_control_return",
      },
    ];

    expect(taskControlProjection(needsAttention, state)).toEqual({
      controllerLabel: "Awaiting handoff",
      canTakeControl: true,
      canPause: false,
    });

    expect(taskControlProjection(unrelated, state)).toEqual({
      controllerLabel: "None",
      canTakeControl: false,
      canPause: false,
    });

    expect(state.attention).toHaveLength(1);
    expect(state.attention[0]?.taskId).toBe(needsAttention.taskId);
  });

  it("T07 — viewing task B while task A runs preserves A authority and does not leak A controls into B", () => {
    const activeA = task({
      taskId: "task_a",
      lifecycle: {
        phase: "working",
        reason: "Task A is working.",
      },
      conversation: {
        activeTurnId: "turn_a",
        turnStatus: "in_progress",
        archived: false,
        items: {},
        turnOrder: ["turn_a"],
      },
      runtime: agentRuntime,
      availableActions: ["message", "interrupt", "finish"],
    });

    const viewedB = task({
      taskId: "task_b",
      lifecycle: {
        phase: "ready",
        reason: "Task B is ready.",
      },
      conversation: {
        turnStatus: "completed",
        archived: false,
        items: {},
        turnOrder: ["turn_b"],
      },
      availableActions: ["message", "finish"],
    });

    const state = product([activeA, viewedB]);
    state.currentTaskId = activeA.taskId;

    expect(activeProductTask(state)).toBe(activeA);

    // Selecting B is presentation state. An update to A must not throw B away.
    expect(reconcileSelectedTaskId(viewedB.taskId, activeA.taskId, state)).toBe(
      viewedB.taskId,
    );

    state.tasks = [
      {
        ...activeA,
        lifecycle: {
          phase: "working",
          reason: "Task A received another execution event.",
        },
      },
      viewedB,
    ];

    expect(reconcileSelectedTaskId(viewedB.taskId, activeA.taskId, state)).toBe(
      viewedB.taskId,
    );

    // A keeps its execution authority.
    expect(taskControlProjection(state.tasks[0], state)).toEqual({
      controllerLabel: "Agent",
      canTakeControl: false,
      canPause: true,
    });

    // B derives controls from B, not from whichever task happens to be active.
    expect(taskControlProjection(viewedB, state)).toEqual({
      controllerLabel: "None",
      canTakeControl: false,
      canPause: false,
    });

    expect(viewedB.availableActions).not.toContain("interrupt");
    expect(viewedB.availableActions).toContain("message");
  });
});
