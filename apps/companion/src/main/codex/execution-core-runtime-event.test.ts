import { describe, expect, it } from "vitest";
import {
  emptyTaskAggregate,
  foldTaskEvent,
  hasActionableTaskHandoff,
  projectTaskAggregate,
} from "@rove/protocol";

import {
  composeCompletedRequestHumanHandoff,
  runtimeInventoryEventId,
} from "./execution-core.js";

describe("Runtime inventory event identity", () => {
  it("separates observations by generation, position, and state", () => {
    const first = runtimeInventoryEventId("task_1", 7, 1, "same-state");

    expect(runtimeInventoryEventId("task_1", 7, 1, "same-state")).toBe(first);
    expect(runtimeInventoryEventId("task_1", 8, 1, "same-state")).not.toBe(
      first,
    );
    expect(runtimeInventoryEventId("task_1", 7, 2, "same-state")).not.toBe(
      first,
    );
    expect(runtimeInventoryEventId("task_1", 7, 1, "other-state")).not.toBe(
      first,
    );
  });
});

describe("request-human live event composition", () => {
  const taskId = "task_11111111-1111-4111-8111-111111111111";
  const sessionId = `ses_${"1".repeat(32)}`;
  const threadId = "thread_live";
  const handoffId = `handoff_${"2".repeat(32)}`;
  const bootstrapId = `boot_${"3".repeat(32)}`;
  const item = {
    type: "dynamicToolCall",
    id: "item_live_handoff",
    namespace: "rove",
    tool: "control.request_human",
    status: "completed",
    arguments: {
      sessionId,
      reason: "Sign in",
      instruction: "Inspect the authenticated page and continue.",
      continuationPolicy: "resume_after_control_return",
    },
    contentItems: [
      {
        type: "inputText",
        text: JSON.stringify({
          sessionId,
          generation: 2,
          status: "awaiting_human",
          controller: null,
          activeHandoffId: handoffId,
          observationSeq: 9,
        }),
      },
    ],
    success: true,
    durationMs: 1,
  };

  it("turns a corroborated dynamic completion into one actionable task handoff", async () => {
    const completedHandoff = await composeCompletedRequestHumanHandoff({
      taskId,
      threadId,
      turnId: "turn_live",
      item,
      boundRuntimeSessionId: sessionId,
      getControlStatus: async () => ({
        sessionId,
        generation: 2,
        status: "awaiting_human",
        controller: null,
        activeHandoffId: handoffId,
        activeHandoffGeneration: 2,
        observationSeq: 9,
        updatedAt: "2026-09-19T00:00:00.000Z",
      }),
    });
    expect(completedHandoff).toBeDefined();
    const seeded = emptyTaskAggregate(taskId);
    seeded.launch = {
      operationId: "intent_11111111-1111-4111-8111-111111111112",
      bootstrapId,
      requestedAt: "2026-09-19T00:00:00.000Z",
      outcome: "Complete the authenticated task.",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      approvalsReviewer: "auto_review",
      cwd: "/work",
      attachmentIds: [],
    };
    seeded.record = {
      schemaVersion: 1,
      identity: {
        taskId,
        sessionId,
        threadId,
        browser: { mode: "temporary" },
      },
      bootstrap: {
        operationId: bootstrapId,
        threadSource: `rove:${taskId}:${bootstrapId}`,
        stage: "complete",
      },
      desiredState: "open",
    };
    seeded.codex = {
      availability: "available",
      threadExists: true,
      threadId,
      threadSource: `rove:${taskId}:${bootstrapId}`,
      sourceLookup: "exact",
      runtimeStatus: "active",
      archived: false,
      turn: "active",
      turnId: "turn_live",
    };
    seeded.runtime = {
      availability: "available",
      sessionExists: true,
      sessionId,
      bootstrapId,
      bootstrapLookup: "exact",
      status: "active",
      controller: "agent",
      attachment: "attached",
      profileLock: "released",
      browserIdentity: { mode: "temporary" },
      recovery: "not_needed",
      ownershipGeneration: 1,
      observationSeq: 8,
    };
    const aggregate = foldTaskEvent(seeded, {
      schemaVersion: 1,
      type: "codex_item_observed",
      eventId: "codex:live:item:item_live_handoff:completed",
      taskId,
      source: {
        kind: "codex",
        id: "connection_live",
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-19T00:00:00.000Z",
      threadId,
      turnId: "turn_live",
      itemId: "item_live_handoff",
      terminal: true,
      item: {
        id: "item_live_handoff",
        kind: "tool",
        status: "completed",
        turnId: "turn_live",
        title: "control.request_human",
      },
      completedHandoff: completedHandoff!,
    });

    expect(aggregate.continuation).toMatchObject({
      status: "pending",
      sessionId,
      handoffId,
      generation: 2,
    });
    expect(aggregate.attentions).toEqual([
      expect.objectContaining({
        authority: "rove_control",
        kind: "control_handoff",
        status: "pending",
        taskId,
        sessionId,
        handoffId,
        generation: 2,
      }),
    ]);
    expect(hasActionableTaskHandoff(aggregate)).toBe(true);
    expect(projectTaskAggregate(aggregate).runtime).toMatchObject({
      status: "awaiting_human",
      controller: null,
    });

    const interrupted = structuredClone(seeded);
    interrupted.codex = {
      ...interrupted.codex,
      runtimeStatus: "idle",
      turn: "interrupted",
    };
    interrupted.conversation.terminalTurns = {
      turn_live: "interrupted",
    };
    const afterLateHandoff = foldTaskEvent(interrupted, {
      schemaVersion: 1,
      type: "codex_item_observed",
      eventId: "codex:late:item:item_live_handoff:completed",
      taskId,
      source: {
        kind: "codex",
        id: "connection_late",
        generation: 2,
        position: 1,
      },
      observedAt: "2026-09-19T00:00:01.000Z",
      threadId,
      turnId: "turn_live",
      itemId: "item_live_handoff",
      terminal: true,
      item: {
        id: "item_live_handoff",
        kind: "tool",
        status: "completed",
        turnId: "turn_live",
        title: "control.request_human",
      },
      completedHandoff: completedHandoff!,
    });
    expect(afterLateHandoff.conversation.itemOrder).toContain(
      "item_live_handoff",
    );
    expect(afterLateHandoff.codex.turn).toBe("interrupted");
    expect(afterLateHandoff.runtime.status).toBe("active");
    expect(afterLateHandoff.continuation).toEqual({ status: "none" });
    expect(afterLateHandoff.attentions).toEqual([]);
  });

  it("refuses composition when Runtime reports a different handoff", async () => {
    await expect(
      composeCompletedRequestHumanHandoff({
        taskId,
        threadId,
        turnId: "turn_live",
        item,
        boundRuntimeSessionId: sessionId,
        getControlStatus: async () => ({
          sessionId,
          generation: 2,
          status: "awaiting_human",
          controller: null,
          activeHandoffId: "handoff_other",
          activeHandoffGeneration: 2,
          observationSeq: 9,
          updatedAt: "2026-09-19T00:00:00.000Z",
        }),
      }),
    ).rejects.toThrow(/not corroborated/);
  });
});
