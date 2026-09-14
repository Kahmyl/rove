import { describe, expect, it } from "vitest";
import type { RuntimeSessionInventory, Session } from "@rove/protocol";

import {
  resolveTaskRuntimeControlAuthority,
  type TaskRuntimeAuthorityAggregate,
} from "./task-runtime-control-authority.js";

function session(
  id: string,
  bootstrapId: string,
  overrides: Partial<Session> = {},
): Session {
  return {
    id,
    bootstrapId,
    mode: "agent",
    status: "active",
    controller: "agent",
    ownershipGeneration: 4,
    profile: { mode: "temporary" },
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    ...overrides,
  };
}

function inventory(value: Session): RuntimeSessionInventory {
  return {
    schemaVersion: 1,
    session: value,
    browserIdentity: { mode: "temporary" },
    attachment: "attached",
    recovery: "not_needed",
    profileOwnership: "owned",
  };
}

function aggregate(
  taskId: string,
  sessionId: string,
  bootstrapId: string,
  overrides: Partial<TaskRuntimeAuthorityAggregate> = {},
): TaskRuntimeAuthorityAggregate {
  return {
    taskId,
    launch: { bootstrapId },
    desiredState: "open",
    record: {
      bootstrap: { stage: "complete" },
      identity: { sessionId },
    },
    runtime: { sessionId },
    continuation: { status: "none" },
    ...overrides,
  };
}

describe("task Runtime control authority", () => {
  it("routes an older Task A handoff despite a newer Task B session", () => {
    const handoffId = `handoff_${"a".repeat(32)}`;
    const taskA = aggregate("task_a", "ses_a", "boot_a", {
      continuation: {
        status: "pending",
        taskId: "task_a",
        sessionId: "ses_a",
        handoffId,
        generation: 7,
      },
    });
    const olderA = session("ses_a", "boot_a", {
      status: "awaiting_human",
      controller: null,
      ownershipGeneration: 7,
      activeHandoffId: handoffId,
      activeHandoffGeneration: 7,
      updatedAt: "2026-09-14T00:00:00.000Z",
    });
    const newerB = session("ses_b", "boot_b", {
      updatedAt: "2026-09-14T01:00:00.000Z",
    });

    expect(
      resolveTaskRuntimeControlAuthority(
        "task_a",
        taskA,
        [inventory(newerB), inventory(olderA)],
        7,
      ),
    ).toEqual({
      sessionId: "ses_a",
      ownershipGeneration: 7,
      handoffId,
      handoffGeneration: 7,
    });
  });

  it("rejects wrong sessions, stale handoffs, and mismatched generations", () => {
    const handoffId = `handoff_${"b".repeat(32)}`;
    const taskA = aggregate("task_a", "ses_a", "boot_a", {
      continuation: {
        status: "pending",
        taskId: "task_a",
        sessionId: "ses_a",
        handoffId,
        generation: 3,
      },
    });
    const liveA = inventory(
      session("ses_a", "boot_a", {
        status: "awaiting_human",
        controller: null,
        activeHandoffId: handoffId,
        activeHandoffGeneration: 3,
      }),
    );

    expect(() =>
      resolveTaskRuntimeControlAuthority(
        "task_a",
        taskA,
        [inventory(session("ses_b", "boot_b"))],
        3,
      ),
    ).toThrow(/missing or conflicting/);
    expect(() =>
      resolveTaskRuntimeControlAuthority("task_a", taskA, [liveA], 2),
    ).toThrow(/handoff is stale or mismatched/);
    expect(() =>
      resolveTaskRuntimeControlAuthority(
        "task_a",
        taskA,
        [
          inventory(
            session("ses_a", "boot_a", {
              status: "awaiting_human",
              controller: null,
              activeHandoffId: handoffId,
              activeHandoffGeneration: 4,
            }),
          ),
        ],
      ),
    ).toThrow(/handoff is stale or mismatched/);
    expect(() =>
      resolveTaskRuntimeControlAuthority("task_a", taskA, [liveA]),
    ).not.toThrow();
    expect(() =>
      resolveTaskRuntimeControlAuthority(
        "task_a",
        aggregate("task_a", "ses_a", "boot_a"),
        [liveA],
      ),
    ).toThrow(/handoff is stale or mismatched/);
    expect(() =>
      resolveTaskRuntimeControlAuthority(
        "task_a",
        taskA,
        [inventory(session("ses_a", "boot_a"))],
      ),
    ).toThrow(/handoff is stale or mismatched/);
  });
});
