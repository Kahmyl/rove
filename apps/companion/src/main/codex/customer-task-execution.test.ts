import { describe, expect, it } from "vitest";
import { emptyTaskAggregate } from "@rove/protocol";

import { projectedItem } from "./codex-task-observations.js";
import { customerTaskExecution } from "./customer-task-execution.js";

const taskId = "task_12345678-1234-4123-8123-123456789abc";

function aggregate() {
  const value = emptyTaskAggregate(taskId);
  value.launch = {
    operationId: "intent_12345678-1234-4123-8123-123456789abc",
    bootstrapId: `boot_${"a".repeat(32)}`,
    requestedAt: "2026-09-20T10:00:00.000Z",
    outcome: "Initial work",
    executionMode: "agent",
    approvalsReviewer: "auto_review",
    cwd: "/work",
    attachmentIds: [],
  };
  value.record = {
    schemaVersion: 1,
    identity: { taskId, threadId: "thread-1" },
    bootstrap: {
      operationId: value.launch.bootstrapId,
      threadSource: `rove:${taskId}:${value.launch.bootstrapId}`,
      stage: "complete",
    },
    desiredState: "open",
  };
  value.codex = {
    availability: "available",
    threadExists: true,
    threadId: "thread-1",
    sourceLookup: "exact",
    runtimeStatus: "idle",
    archived: false,
    turn: "active",
    turnId: "provider-turn-2",
  };
  value.conversation.items = {
    "user:initial": {
      id: "user:initial",
      kind: "user_message",
      status: "completed",
      clientId: "initial",
      turnId: "provider-turn-1",
      acceptedAt: "2026-09-20T10:00:00.000Z",
      text: "Initial work",
    },
    commentary: {
      id: "commentary",
      kind: "assistant_message",
      phase: "commentary",
      status: "completed",
      turnId: "provider-turn-1",
      text: "I am checking the source.",
    },
    raw_tool: {
      id: "raw_tool",
      kind: "tool",
      status: "completed",
      turnId: "provider-turn-1",
      title: "mcp__runtime/browser.transaction_verify",
    },
    "user:steer": {
      id: "user:steer",
      kind: "user_message",
      status: "completed",
      clientId: "steer",
      turnId: "provider-turn-2",
      acceptedAt: "2026-09-20T10:00:06.000Z",
      text: "Focus on the newest record",
    },
    command: {
      id: "command",
      kind: "command",
      status: "started",
      turnId: "provider-turn-2",
      title: "private-shell-command --with-internal-flags",
    },
  };
  value.conversation.itemOrder = [
    "user:initial",
    "commentary",
    "raw_tool",
    "user:steer",
    "command",
  ];
  value.conversation.turnOrder = ["provider-turn-1", "provider-turn-2"];
  value.customerActiveIntervals = [
    {
      segmentId: "user:initial",
      startedAt: "2026-09-20T10:00:00.000Z",
      endedAt: "2026-09-20T10:00:05.000Z",
    },
    {
      segmentId: "user:steer",
      startedAt: "2026-09-20T10:00:06.000Z",
    },
  ];
  value.queue = {
    entries: {
      "queue:later": {
        id: "queue:later",
        operationId: "later",
        message: "Not transcript yet",
        createdAt: "2026-09-20T10:00:07.000Z",
        updatedAt: "2026-09-20T10:00:07.000Z",
        attachmentIds: [],
      },
    },
    order: ["queue:later"],
  };
  return value;
}

describe("customer Task execution projection", () => {
  it("retains provider mechanism failure truth before customer translation", () => {
    expect(
      projectedItem(
        {
          type: "mcpToolCall",
          tool: "private_internal_tool",
          status: "failed",
          error: { message: "private provider detail" },
        },
        "turn-1",
        "item-1",
        true,
      ),
    ).toMatchObject({ activityOutcome: "failed" });
  });

  it("segments accepted interventions without turning queued intent into transcript", () => {
    const projection = customerTaskExecution(aggregate());
    expect(projection.segments.map((segment) => segment.id)).toEqual([
      "user:initial",
      "user:steer",
    ]);
    expect(projection.queue.map((entry) => entry.message)).toEqual([
      "Not transcript yet",
    ]);
    expect(
      projection.segments.some((segment) => segment.id === "queue:later"),
    ).toBe(false);
    expect(projection.segments[0]).toMatchObject({
      status: "terminal",
      accumulatedActiveMs: 5_000,
      commentaryItemIds: ["commentary"],
    });
    expect(projection.segments[1]).toMatchObject({
      status: "active",
      activeSince: "2026-09-20T10:00:06.000Z",
    });
  });

  it("uses bounded customer activity semantics without raw mechanism names", () => {
    const projection = customerTaskExecution(aggregate());
    const serialized = JSON.stringify(
      projection.segments.flatMap((segment) => segment.activities),
    );
    expect(serialized).toContain('"kind":"verify"');
    expect(serialized).toContain('"kind":"run"');
    expect(serialized).not.toContain("mcp__runtime");
    expect(serialized).not.toContain("private-shell-command");
    expect(projection.segments[0]?.commentaryItemIds).toEqual(["commentary"]);
  });

  it("preserves explicit failure and unresolved outcomes without success copy", () => {
    const value = aggregate();
    value.conversation.items.raw_tool!.activityOutcome = "unresolved";
    value.conversation.items.command!.activityOutcome = "failed";
    const activities = customerTaskExecution(value).segments.flatMap(
      (segment) => segment.activities,
    );
    expect(
      activities.find((activity) => activity.itemId === "raw_tool"),
    ).toMatchObject({
      state: "unresolved",
      label: "Verifying the result — outcome unclear",
    });
    expect(
      activities.find((activity) => activity.itemId === "command"),
    ).toMatchObject({
      state: "failed",
      label: "Running a local operation failed",
    });
    expect(activities.some((activity) => activity.label.includes("mcp"))).toBe(
      false,
    );
  });

  it("binds late interrupted-turn activity to retained stopped history", () => {
    const value = aggregate();
    value.codex.turn = "active";
    value.codex.turnId = "provider-turn-2";
    value.conversation.terminalTurns = {
      "provider-turn-1": "interrupted",
    };
    value.conversation.items = {
      ...value.conversation.items,
      late_command: {
        id: "late_command",
        kind: "command",
        status: "completed",
        turnId: "provider-turn-1",
        activityOutcome: "failed",
        title: "late command completion",
      },
    };
    value.conversation.itemOrder = [
      ...(value.conversation.itemOrder ?? []),
      "late_command",
    ];

    const projection = customerTaskExecution(value);
    expect(projection.state).toBe("working");
    expect(
      projection.segments[0]?.activities.map((activity) => activity.itemId),
    ).toContain("late_command");
    expect(
      projection.segments[1]?.activities.map((activity) => activity.itemId),
    ).not.toContain("late_command");
  });

  it("coalesces repeated low-value activity without hiding commentary or consequence", () => {
    const value = aggregate();
    value.conversation.items = {
      ...value.conversation.items,
      repeated_read: {
        id: "repeated_read",
        kind: "tool",
        status: "completed",
        title: "read another detail",
      },
      repeated_read_again: {
        id: "repeated_read_again",
        kind: "tool",
        status: "completed",
        title: "read one more detail",
      },
      material_change: {
        id: "material_change",
        kind: "file_change",
        status: "completed",
        title: "updated customer file",
      },
      failed_read: {
        id: "failed_read",
        kind: "tool",
        status: "completed",
        title: "read final detail",
        activityOutcome: "failed",
      },
    };
    value.conversation.itemOrder = [
      "user:initial",
      "commentary",
      "raw_tool",
      "repeated_read",
      "repeated_read_again",
      "material_change",
      "failed_read",
      "user:steer",
      "command",
    ];

    const first = customerTaskExecution(value).segments[0]!;
    expect(
      first.activities.filter((activity) => activity.kind === "read"),
    ).toHaveLength(2);
    expect(first.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "change", state: "confirmed" }),
        expect.objectContaining({ kind: "read", state: "failed" }),
      ]),
    );
    expect(first.workOrder[0]).toEqual({
      type: "commentary",
      id: "commentary",
    });
  });

  it.each([
    [
      "attention waiting",
      (value: ReturnType<typeof aggregate>) => {
        value.attentions = [
          {
            authority: "codex",
            kind: "user_input",
            requestId: "request-1",
            taskId,
            threadId: "thread-1",
            generation: 1,
            status: "pending",
          },
        ];
      },
      "waiting_for_you",
    ],
    [
      "human browser ownership",
      (value: ReturnType<typeof aggregate>) => {
        value.runtime.controller = "human";
        value.runtime.status = "active";
      },
      "human_control",
    ],
    [
      "checking",
      (value: ReturnType<typeof aggregate>) => {
        value.recoveryRequired = "Reconcile exact truth";
      },
      "checking",
    ],
    [
      "stopping",
      (value: ReturnType<typeof aggregate>) => {
        value.requestedOperation = {
          type: "interrupt",
          taskId,
          operationId: "intent_92345678-1234-4123-8123-123456789abc",
        };
      },
      "stopping",
    ],
    [
      "stopped",
      (value: ReturnType<typeof aggregate>) => {
        value.codex.turn = "interrupted";
      },
      "stopped",
    ],
  ])("freezes presentation during %s", (_label, mutate, expected) => {
    const value = aggregate();
    mutate(value);
    const projection = customerTaskExecution(value);
    expect(projection.state).toBe(expected);
    expect(projection.segments[1]?.accumulatedActiveMs).toBe(0);
  });

  it("does not let a stale provider-active interval extend completed work", () => {
    const value = aggregate();
    value.codex.turn = "completed";
    const projection = customerTaskExecution(value);
    expect(projection.state).toBe("idle");
    expect(projection.segments[1]).toMatchObject({
      status: "terminal",
      accumulatedActiveMs: 0,
    });
  });
});
