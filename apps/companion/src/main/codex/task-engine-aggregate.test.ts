import { describe, expect, it } from "vitest";

import {
  applySuccessfulTaskCommand,
  emptyTaskAggregate,
  foldTaskEvent,
  projectTaskAggregate,
  TaskEngine,
  type TaskAggregate,
  type TaskCommand,
  type TaskEngineStore,
  type TaskEngineTransaction,
  type TaskEvent,
  type TaskObservedFact,
} from "@rove/protocol";

const taskId = "task_12345678-1234-4123-8123-123456789abc";
const sessionId = "ses_1234567890abcdef1234567890abcdef";
const threadId = "thread-1";
const handoffId = "handoff_1234567890abcdef1234567890abcdef";

function aggregate(): TaskAggregate {
  const value = emptyTaskAggregate(taskId);
  value.record = {
    schemaVersion: 1,
    identity: { taskId, sessionId, threadId, browser: { mode: "temporary" } },
    bootstrap: {
      operationId: "boot_1234567890abcdef1234567890abcdef",
      threadSource: `rove:${taskId}:boot_1234567890abcdef1234567890abcdef`,
      stage: "complete",
    },
    desiredState: "open",
  };
  value.codex = {
    availability: "available",
    threadExists: true,
    threadId,
    threadSource: `rove:${taskId}:boot_1234567890abcdef1234567890abcdef`,
    sourceLookup: "exact",
    runtimeStatus: "idle",
    archived: false,
    turn: "completed",
  };
  value.runtime = {
    availability: "available",
    sessionExists: true,
    sessionId,
    bootstrapId: "boot_1234567890abcdef1234567890abcdef",
    bootstrapLookup: "exact",
    status: "active",
    controller: "agent",
    attachment: "attached",
    profileLock: "owned",
    browserIdentity: { mode: "temporary" },
    recovery: "not_needed",
  };
  return value;
}

function event(position: number, patch: Partial<TaskEvent>): TaskEvent {
  return {
    schemaVersion: 1,
    type: "codex_request_observed",
    eventId: `event-${position}`,
    taskId,
    source: { kind: "codex", id: "connection", generation: 2, position },
    observedAt: "2026-09-09T12:00:00.000Z",
    attentions: [],
    ...patch,
  } as TaskEvent;
}

describe("TaskAggregate exact event fold", () => {
  it("records materialized message delivery from the authoritative user item", () => {
    const operationId = "intent_52345678-1234-4123-8123-123456789abc";
    const folded = foldTaskEvent(
      aggregate(),
      event(1, {
        type: "codex_item_observed",
        threadId,
        turnId: "turn_initial",
        itemId: "item_initial",
        terminal: true,
        item: {
          id: "item_initial",
          turnId: "turn_initial",
          clientId: operationId,
          kind: "user_message",
          status: "completed",
          text: "Initial task",
        },
      }),
    );
    expect(folded.messageDeliveries[operationId]).toMatchObject({
      operationId,
      threadId,
      turnId: "turn_initial",
      state: "message_materialized",
      connectionGeneration: 2,
    });
    expect(folded.conversation.items.item_initial?.clientId).toBe(operationId);
    expect(folded.conversation.items.item_initial).toMatchObject({
      startedAt: "2026-09-09T12:00:00.000Z",
      completedAt: "2026-09-09T12:00:00.000Z",
    });
    const afterLateAcceptance = foldTaskEvent(
      folded,
      event(2, {
        type: "codex_message_delivery_observed",
        delivery: {
          operationId,
          threadId,
          turnId: "turn_initial",
          state: "acceptance_observed",
          connectionGeneration: 2,
          observedAt: "2026-09-09T12:00:01.000Z",
        },
      }),
    );
    expect(afterLateAcceptance.messageDeliveries[operationId]?.state).toBe(
      "message_materialized",
    );
  });

  it("keeps a command-failed task cleanable and clears the marker only for explicit cleanup", () => {
    const failed = aggregate();
    failed.recoveryRequired = "The prior command needs recovery.";
    failed.requestedOperation = {
      type: "message",
      taskId,
      operationId: "intent_12345678-1234-4123-8123-123456789abc",
      message: "Run the task",
    };
    expect(projectTaskAggregate(failed)).toMatchObject({
      phase: "failed",
      allowedActions: ["finish"],
      recoveryRequired: "The prior command needs recovery.",
    });
    const finishing = foldTaskEvent(
      failed,
      event(1, {
        type: "task_finish_requested",
        eventId: "product:finish-recovery",
        source: {
          kind: "product",
          id: "operation:finish-recovery",
          generation: 1,
          position: 1,
        },
        operationId: "intent_22345678-1234-4123-8123-123456789abc",
      }),
    );
    expect(finishing.recoveryRequired).toBeNull();
    expect(finishing.requestedOperation.type).toBe("finish");

    const archiveFailed = aggregate();
    archiveFailed.desiredState = "closed";
    archiveFailed.record!.desiredState = "closed";
    archiveFailed.record!.closeOperation = {
      operationId: "intent_32345678-1234-4123-8123-123456789abc",
      requestedAt: "2026-09-09T12:00:00.000Z",
      stage: "complete",
    };
    archiveFailed.recoveryRequired = "Archival needs explicit recovery.";
    expect(projectTaskAggregate(archiveFailed).allowedActions).toEqual([
      "archive",
    ]);
    const archiving = foldTaskEvent(
      archiveFailed,
      event(2, {
        type: "task_archive_requested",
        eventId: "product:archive-recovery",
        source: {
          kind: "product",
          id: "operation:archive-recovery",
          generation: 1,
          position: 1,
        },
        operationId: "intent_42345678-1234-4123-8123-123456789abc",
      }),
    );
    expect(archiving.recoveryRequired).toBeNull();
    expect(archiving.requestedOperation.type).toBe("archive");
  });

  it("upserts independent Codex requests and treats an empty observation as a no-op", () => {
    const withAttention = foldTaskEvent(
      aggregate(),
      event(1, {
        attentions: [
          {
            authority: "codex",
            kind: "command_approval",
            requestId: "req-1",
            taskId,
            threadId,
            turnId: "turn-1",
            itemId: "item-1",
            generation: 2,
            status: "pending",
          },
        ],
      }),
    );
    expect(withAttention.attentions).toHaveLength(1);
    const withBoth = foldTaskEvent(
      withAttention,
      event(2, {
        attentions: [
          {
            authority: "codex",
            kind: "file_approval",
            requestId: "req-2",
            taskId,
            threadId,
            turnId: "turn-1",
            itemId: "item-2",
            generation: 2,
            status: "pending",
          },
        ],
      }),
    );
    expect(withBoth.attentions).toMatchObject([
      { requestId: "req-1", itemId: "item-1", status: "pending" },
      { requestId: "req-2", itemId: "item-2", status: "pending" },
    ]);
    const resolvedFirst = foldTaskEvent(
      withBoth,
      event(3, {
        type: "codex_request_resolved",
        requestId: "req-1",
        threadId,
        generation: 2,
        resolution: "resolved",
      }),
    );
    expect(resolvedFirst.attentions).toMatchObject([
      { requestId: "req-1", status: "resolved" },
      { requestId: "req-2", status: "pending" },
    ]);
    expect(
      foldTaskEvent(resolvedFirst, event(4, { attentions: [] })).attentions,
    ).toEqual(resolvedFirst.attentions);
  });

  it("keeps duplicate request delivery idempotent and rejects identity collisions", () => {
    const request = {
      authority: "codex" as const,
      kind: "command_approval" as const,
      requestId: "req-1",
      method: "item/commandExecution/requestApproval",
      wireRequestId: 7,
      responseFields: { itemId: "item-1" },
      taskId,
      threadId,
      turnId: "turn-1",
      itemId: "item-1",
      generation: 2,
      status: "pending" as const,
    };
    const once = foldTaskEvent(
      aggregate(),
      event(1, { attentions: [request] }),
    );
    expect(
      foldTaskEvent(once, event(2, { attentions: [request] })).attentions,
    ).toEqual(once.attentions);
    expect(() =>
      foldTaskEvent(
        once,
        event(3, {
          attentions: [{ ...request, itemId: "item-collision" }],
        }),
      ),
    ).toThrow("identity collision");
  });

  it("stales only live Codex requests from an older connection generation", () => {
    const pending = foldTaskEvent(
      aggregate(),
      event(1, {
        attentions: [
          {
            authority: "codex",
            kind: "command_approval",
            requestId: "req-old",
            taskId,
            threadId,
            generation: 2,
            status: "pending",
          },
          {
            authority: "codex",
            kind: "file_approval",
            requestId: "req-resolved",
            taskId,
            threadId,
            generation: 2,
            status: "pending",
          },
        ],
      }),
    );
    const withResolution = foldTaskEvent(
      pending,
      event(2, {
        type: "codex_request_resolved",
        requestId: "req-resolved",
        threadId,
        generation: 2,
        resolution: "resolved",
      }),
    );
    const replaced = foldTaskEvent(
      withResolution,
      event(3, {
        type: "host_generation_changed",
        component: "codex",
        generation: 3,
      }),
    );
    expect(replaced.attentions).toMatchObject([
      { requestId: "req-old", generation: 2, status: "stale" },
      { requestId: "req-resolved", generation: 2, status: "resolved" },
    ]);
    expect(
      foldTaskEvent(
        replaced,
        event(4, {
          attentions: [
            {
              authority: "codex",
              kind: "command_approval",
              requestId: "req-new",
              taskId,
              threadId,
              generation: 3,
              status: "pending",
            },
          ],
        }),
      ).attentions,
    ).toMatchObject([
      { requestId: "req-old", status: "stale" },
      { requestId: "req-resolved", status: "resolved" },
      { requestId: "req-new", generation: 3, status: "pending" },
    ]);
  });

  it("evicts oldest terminal Codex attention before rejecting live requests at the bound", () => {
    let current = aggregate();
    for (let index = 0; index < 32; index += 1) {
      const requestId = `req-terminal-${index}`;
      current = foldTaskEvent(
        current,
        event(index * 2 + 1, {
          attentions: [
            {
              authority: "codex",
              kind: "command_approval",
              requestId,
              taskId,
              threadId,
              generation: 2,
              status: "pending",
            },
          ],
        }),
      );
      current = foldTaskEvent(
        current,
        event(index * 2 + 2, {
          type: "codex_request_resolved",
          requestId,
          threadId,
          generation: 2,
          resolution: "resolved",
        }),
      );
    }
    const withNewRequest = foldTaskEvent(
      current,
      event(65, {
        attentions: [
          {
            authority: "codex",
            kind: "file_approval",
            requestId: "req-live",
            taskId,
            threadId,
            generation: 2,
            status: "pending",
          },
        ],
      }),
    );
    expect(withNewRequest.attentions).toHaveLength(32);
    expect(
      withNewRequest.attentions.some(
        (attention) => attention.requestId === "req-terminal-0",
      ),
    ).toBe(false);
    expect(withNewRequest.attentions.at(-1)).toMatchObject({
      requestId: "req-live",
      status: "pending",
    });
  });

  it("replaces pending continuation with none", () => {
    const pending = foldTaskEvent(
      aggregate(),
      event(1, {
        type: "runtime_handoff_observed",
        sessionId,
        handoffId,
        handoffGeneration: 3,
        controller: "human",
        status: "awaiting_human",
        ownershipGeneration: 3,
        continuation: {
          status: "pending",
          id: "continuation-1",
          taskId,
          sessionId,
          threadId,
          handoffId,
          generation: 3,
          policy: "resume_after_control_return",
          freshInspectionRequired: true,
        },
        attention: {
          authority: "rove_control",
          kind: "control_handoff",
          requestId: "control-1",
          taskId,
          threadId,
          handoffId,
          generation: 3,
          status: "pending",
        },
      }),
    );
    const cleared = foldTaskEvent(
      pending,
      event(2, {
        type: "runtime_handoff_observed",
        sessionId,
        handoffId,
        handoffGeneration: 3,
        controller: "agent",
        status: "active",
        ownershipGeneration: 4,
        continuation: { status: "none" },
        attention: null,
      }),
    );
    expect(cleared.continuation).toEqual({ status: "none" });
    expect(cleared.attentions).toEqual([]);
  });

  it("replaces only the observed component", () => {
    const before = aggregate();
    const after = foldTaskEvent(
      before,
      event(1, {
        type: "runtime_inventory_observed",
        runtime: { ...before.runtime, status: "paused", controller: null },
      }),
    );
    expect(after.runtime.status).toBe("paused");
    expect(after.codex).toEqual(before.codex);
  });

  it("invalidates transient inspection proof when the Runtime generation changes", () => {
    const before = aggregate();
    before.runtime = {
      ...before.runtime,
      observationSeq: 12,
      lastReturnedHandoffId: handoffId,
    };
    before.continuation = {
      status: "pending",
      id: "continuation-1",
      taskId,
      sessionId,
      threadId,
      handoffId,
      generation: 3,
      policy: "resume_after_control_return",
      freshInspectionRequired: true,
      preHandoffObservationSeq: 9,
    };
    before.freshInspection = {
      inspectionId: "inspection-1",
      sessionId,
      handoffId,
      generation: 3,
      afterObservationSeq: 12,
    };
    const after = foldTaskEvent(
      before,
      event(1, {
        type: "host_generation_changed",
        component: "runtime",
        generation: 4,
      }),
    );
    expect(after.freshInspection).toBeNull();
    expect(after.runtime.sessionExists).toBe(false);
  });

  it("commits Runtime generation invalidation before fresh inspection is restored", async () => {
    const before = aggregate();
    before.runtime = {
      ...before.runtime,
      observationSeq: 12,
      lastReturnedHandoffId: handoffId,
    };
    before.continuation = {
      status: "pending",
      id: "continuation-1",
      taskId,
      sessionId,
      threadId,
      handoffId,
      generation: 3,
      policy: "resume_after_control_return",
      freshInspectionRequired: true,
      preHandoffObservationSeq: 9,
    };
    before.freshInspection = {
      inspectionId: "inspection-1",
      sessionId,
      handoffId,
      generation: 3,
      afterObservationSeq: 12,
    };
    const commits: TaskAggregate[] = [];
    const store = {
      async transact<T>(
        _taskId: string,
        operation: (transaction: TaskEngineTransaction) => Promise<T>,
      ): Promise<T> {
        return operation({
          event: async () => null,
          sourceEvent: async () => null,
          aggregate: async () => structuredClone(before),
          command: async () => null,
          activeCommand: async () => null,
          commit: async ({ acceptance }) => {
            commits.push(structuredClone(acceptance.aggregate));
          },
        });
      },
      claimDueCommands: async () => [],
      projection: async () => null,
      projections: async () => [],
      aggregate: async () => structuredClone(before),
      markPossiblyStarted: async () => undefined,
      markRecoveryRequired: async () => undefined,
    } satisfies TaskEngineStore;
    const engine = new TaskEngine(store);

    const accepted = await engine.accept(
      event(1, {
        type: "host_generation_changed",
        component: "runtime",
        generation: 4,
      }),
    );

    expect(accepted.command?.type).toBe("read_lifecycle_truth");
    expect(commits[0]?.freshInspection).toBeNull();
    expect(commits[0]?.runtime.availability).toBe("unavailable");
  });

  it("drops an undispatched continuation command when closeout cancels it", () => {
    const before = aggregate();
    before.continuation = {
      status: "pending",
      id: "continuation-1",
      taskId,
      sessionId,
      threadId,
      handoffId,
      generation: 3,
      policy: "resume_after_control_return",
      freshInspectionRequired: false,
      preHandoffObservationSeq: 9,
      returnEventId: `return:${sessionId}:${handoffId}:3`,
    };
    const prepare: TaskCommand = {
      schemaVersion: 1,
      commandId: "command:prepare-continuation",
      taskId,
      aggregateRevision: before.revision,
      type: "prepare_continuation_command",
      payload: {
        type: "prepare_continuation_command",
        taskId,
        continuationId: "continuation-1",
        returnEventId: `return:${sessionId}:${handoffId}:3`,
      },
      classification: { execute: "pure_ledger", reconcile: "not_required" },
      status: "leased",
      attempts: 1,
      createdAt: "2026-09-09T12:00:00.000Z",
    };
    const settle: TaskCommand = {
      schemaVersion: 1,
      commandId: "command:settle-continuation",
      taskId,
      aggregateRevision: before.revision,
      type: "settle_continuation_attention",
      payload: {
        type: "settle_continuation_attention",
        taskId,
        sessionId,
        threadId,
        continuationId: "continuation-1",
        attention: [],
      },
      classification: { execute: "pure_ledger", reconcile: "not_required" },
      status: "leased",
      attempts: 1,
      createdAt: "2026-09-09T12:00:01.000Z",
    };

    const prepared = applySuccessfulTaskCommand(before, prepare, []);
    expect(prepared.continuation.command?.dispatchStatus).toBe("not_started");
    const cancelled = applySuccessfulTaskCommand(prepared, settle, []);
    expect(cancelled.continuation.status).toBe("cancelled");
    expect(cancelled.continuation.command).toBeUndefined();
  });

  it("ignores late continuation preparation after closeout cancelled it", () => {
    const before = aggregate();
    before.continuation = {
      status: "pending",
      id: "continuation-1",
      taskId,
      sessionId,
      threadId,
      handoffId,
      generation: 3,
      policy: "resume_after_control_return",
      freshInspectionRequired: false,
      preHandoffObservationSeq: 9,
      returnEventId: `return:${sessionId}:${handoffId}:3`,
    };
    const settle = {
      schemaVersion: 1,
      commandId: "command:settle-before-prepare",
      taskId,
      aggregateRevision: before.revision,
      type: "settle_continuation_attention",
      payload: {
        type: "settle_continuation_attention",
        taskId,
        sessionId,
        threadId,
        continuationId: "continuation-1",
        attention: [],
      },
      classification: { execute: "pure_ledger", reconcile: "not_required" },
      status: "leased",
      attempts: 1,
      createdAt: "2026-09-09T12:00:00.000Z",
    } as TaskCommand;
    const prepare = {
      schemaVersion: 1,
      commandId: "command:late-prepare",
      taskId,
      aggregateRevision: before.revision,
      type: "prepare_continuation_command",
      payload: {
        type: "prepare_continuation_command",
        taskId,
        continuationId: "continuation-1",
        returnEventId: `return:${sessionId}:${handoffId}:3`,
      },
      classification: { execute: "pure_ledger", reconcile: "not_required" },
      status: "leased",
      attempts: 1,
      createdAt: "2026-09-09T12:00:01.000Z",
    } as TaskCommand;

    const cancelled = applySuccessfulTaskCommand(before, settle, []);
    const afterLatePrepare = applySuccessfulTaskCommand(cancelled, prepare, []);
    expect(afterLatePrepare.continuation.status).toBe("cancelled");
    expect(afterLatePrepare.continuation.command).toBeUndefined();
  });

  it("consumes transient inspection proof after the return event is durable", () => {
    const before = aggregate();
    before.runtime = {
      ...before.runtime,
      observationSeq: 12,
      lastReturnedHandoffId: handoffId,
    };
    before.continuation = {
      status: "pending",
      id: "continuation-1",
      taskId,
      sessionId,
      threadId,
      handoffId,
      generation: 3,
      policy: "resume_after_control_return",
      freshInspectionRequired: true,
      preHandoffObservationSeq: 9,
    };
    before.freshInspection = {
      inspectionId: "inspection-1",
      sessionId,
      handoffId,
      generation: 3,
      afterObservationSeq: 12,
    };
    const command: TaskCommand = {
      schemaVersion: 1,
      commandId: "command:record-return",
      taskId,
      aggregateRevision: before.revision,
      type: "record_return_event",
      payload: {
        type: "record_return_event",
        taskId,
        continuationId: "continuation-1",
        returnEventId: `return:${sessionId}:${handoffId}:3`,
        returnObservationSeq: 12,
        inspectionId: "inspection-1",
      },
      classification: { execute: "pure_ledger", reconcile: "not_required" },
      status: "leased",
      attempts: 1,
      createdAt: "2026-09-09T12:00:00.000Z",
    };
    const after = applySuccessfulTaskCommand(before, command, []);
    expect(after.freshInspection).toBeNull();
    expect(after.continuation).toMatchObject({
      status: "pending",
      returnEventId: `return:${sessionId}:${handoffId}:3`,
      freshInspectionRequired: false,
    });
  });

  it("retains a pending message across prerequisite recovery facts", () => {
    const before = aggregate();
    const browserIdentity = {
      mode: "workspace" as const,
      workspaceId: "wrk_12345678-1234-4123-8123-123456789abc",
    };
    before.record!.identity.browser = browserIdentity;
    before.runtime = {
      ...before.runtime,
      attachment: "missing",
      profileLock: "released",
      recovery: "relaunchable",
      browserIdentity,
    };
    before.requestedOperation = {
      type: "message",
      taskId,
      operationId: "intent_12345678-1234-4123-8123-123456789abc",
      message: "Complete the original task",
    };
    const command: TaskCommand = {
      schemaVersion: 1,
      commandId: "command:relaunch",
      taskId,
      aggregateRevision: before.revision,
      type: "relaunch_named_browser",
      payload: {
        type: "relaunch_named_browser",
        taskId,
        sessionId,
        browserIdentity,
      },
      classification: {
        execute: "uncertain_write",
        reconcile: "correlate_receipt",
      },
      status: "leased",
      attempts: 1,
      createdAt: "2026-09-09T12:00:00.000Z",
    };
    const recovered = applySuccessfulTaskCommand(before, command, [
      event(1, {
        type: "runtime_inventory_observed",
        runtime: {
          ...before.runtime,
          attachment: "attached",
          profileLock: "owned",
          recovery: "not_needed",
        },
      }) as TaskObservedFact,
    ]);
    expect(recovered.requestedOperation).toEqual(before.requestedOperation);
  });

  it("settles only the exact operation owned by a command", () => {
    const before = aggregate();
    const newerOperation = {
      type: "message" as const,
      taskId,
      operationId: "intent_22345678-1234-4123-8123-123456789abc",
      message: "Newer message",
    };
    before.requestedOperation = newerOperation;
    const olderCommand: TaskCommand = {
      schemaVersion: 1,
      commandId: "command:older-message",
      taskId,
      aggregateRevision: before.revision,
      type: "start_or_steer_codex_turn",
      payload: {
        type: "start_or_steer_codex_turn",
        taskId,
        threadId,
        operationId: "intent_12345678-1234-4123-8123-123456789abc",
        message: "Older message",
      },
      classification: {
        execute: "correlated_write",
        reconcile: "correlate_receipt",
      },
      status: "leased",
      attempts: 1,
      createdAt: "2026-09-09T12:00:00.000Z",
    };
    expect(
      applySuccessfulTaskCommand(before, olderCommand, []).requestedOperation,
    ).toEqual(newerOperation);
    expect(
      applySuccessfulTaskCommand(
        before,
        {
          ...olderCommand,
          payload: {
            ...olderCommand.payload,
            operationId: newerOperation.operationId,
          },
        },
        [],
      ).requestedOperation,
    ).toEqual({ type: "observe", taskId });
  });

  it("does not resurrect an explicitly rejected operation from later facts", () => {
    const before = aggregate();
    before.requestedOperation = {
      type: "archive",
      taskId,
      operationId: "intent_32345678-1234-4123-8123-123456789abc",
    };
    const after = foldTaskEvent(
      before,
      event(1, {
        type: "runtime_inventory_observed",
        runtime: before.runtime,
      }),
    );
    expect(after.requestedOperation).toEqual({ type: "observe", taskId });
  });

  it("accepts an overtaking terminal attention fact without downgrading it later", () => {
    const before = aggregate();
    before.attentions = [
      {
        authority: "codex",
        kind: "command_approval",
        requestId: "request-1",
        taskId,
        threadId,
        generation: 2,
        status: "pending",
      },
    ];
    before.requestedOperation = {
      type: "respond_attention",
      taskId,
      operationId: "intent_42345678-1234-4123-8123-123456789abc",
      requestId: "request-1",
      generation: 2,
      response: { decision: "accept" },
    };
    const resolved = foldTaskEvent(
      before,
      event(1, {
        type: "codex_request_resolved",
        requestId: "request-1",
        threadId,
        generation: 2,
        resolution: "resolved",
      }),
    );
    expect(resolved.requestedOperation).toEqual({ type: "observe", taskId });
    expect(resolved.attentions[0]?.status).toBe("resolved");
    const responseCommand: TaskCommand = {
      schemaVersion: 1,
      commandId: "command:attention-response",
      taskId,
      aggregateRevision: resolved.revision,
      type: "respond_codex_attention",
      payload: {
        type: "respond_codex_attention",
        taskId,
        threadId,
        requestId: "request-1",
        generation: 2,
        operationId: "intent_42345678-1234-4123-8123-123456789abc",
        response: { decision: "accept" },
      },
      classification: {
        execute: "uncertain_write",
        reconcile: "read_truth",
      },
      status: "leased",
      attempts: 1,
      createdAt: "2026-09-09T12:00:00.000Z",
    };
    const afterOutcome = applySuccessfulTaskCommand(
      resolved,
      responseCommand,
      [],
    );
    expect(afterOutcome.attentions[0]?.status).toBe("resolved");
  });

  it("preserves Finish when Codex binding completes", () => {
    const before = aggregate();
    before.launch = {
      operationId: "intent_12345678-1234-4123-8123-123456789abc",
      bootstrapId: "boot_1234567890abcdef1234567890abcdef",
      requestedAt: "2026-09-09T12:00:00.000Z",
      outcome: "Initial outcome",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      approvalsReviewer: "auto_review",
      cwd: "/tmp/rove",
      attachmentIds: [],
    };
    before.record!.bootstrap.stage = "thread_dispatching";
    delete before.record!.identity.threadId;
    before.codex = {
      availability: "available",
      threadExists: true,
      threadId,
      threadSource: before.record!.bootstrap.threadSource,
      sourceLookup: "exact",
      runtimeStatus: "idle",
      archived: false,
      turn: "none",
    };
    before.requestedOperation = {
      type: "finish",
      taskId,
      operationId: "intent_52345678-1234-4123-8123-123456789abc",
    };
    const bindCommand: TaskCommand = {
      schemaVersion: 1,
      commandId: "command:bind-codex",
      taskId,
      aggregateRevision: before.revision,
      type: "bind_codex_identity",
      payload: {
        type: "bind_codex_identity",
        taskId,
        threadSource: before.record!.bootstrap.threadSource,
        returnedThreadId: threadId,
      },
      classification: { execute: "pure_ledger", reconcile: "not_required" },
      status: "leased",
      attempts: 1,
      createdAt: "2026-09-09T12:00:00.000Z",
    };
    expect(
      applySuccessfulTaskCommand(before, bindCommand, []).requestedOperation,
    ).toEqual(before.requestedOperation);
  });

  it("dispatches a product-sized launch outcome after Codex binding", () => {
    const before = aggregate();
    const outcome = "Complete the live browser journey. "
      .repeat(470)
      .slice(0, 16_000);
    before.launch = {
      operationId: "intent_12345678-1234-4123-8123-123456789abc",
      bootstrapId: "boot_1234567890abcdef1234567890abcdef",
      requestedAt: "2026-09-09T12:00:00.000Z",
      outcome,
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      approvalsReviewer: "auto_review",
      cwd: "/tmp/rove",
      attachmentIds: [],
    };
    before.record!.bootstrap.stage = "thread_dispatching";
    delete before.record!.identity.threadId;
    before.codex = {
      availability: "available",
      threadExists: true,
      threadId,
      threadSource: before.record!.bootstrap.threadSource,
      sourceLookup: "exact",
      runtimeStatus: "idle",
      archived: false,
      turn: "none",
    };
    const bindCommand: TaskCommand = {
      schemaVersion: 1,
      commandId: "command:bind-codex-live-sized-outcome",
      taskId,
      aggregateRevision: before.revision,
      type: "bind_codex_identity",
      payload: {
        type: "bind_codex_identity",
        taskId,
        threadSource: before.record!.bootstrap.threadSource,
        returnedThreadId: threadId,
      },
      classification: { execute: "pure_ledger", reconcile: "not_required" },
      status: "leased",
      attempts: 1,
      createdAt: "2026-09-09T12:00:00.000Z",
    };

    const bound = applySuccessfulTaskCommand(before, bindCommand, []);
    expect(bound.requestedOperation).toEqual({
      type: "message",
      taskId,
      operationId: before.launch.operationId,
      message: outcome,
    });
    expect(() => projectTaskAggregate(bound)).not.toThrow();
  });

  it("fences an older source generation", () => {
    const current = foldTaskEvent(
      aggregate(),
      event(2, {
        type: "runtime_inventory_observed",
        runtime: { ...aggregate().runtime, status: "paused", controller: null },
      }),
    );
    const older = foldTaskEvent(
      current,
      event(99, {
        source: {
          kind: "codex",
          id: "connection",
          generation: 1,
          position: 99,
        },
        type: "runtime_inventory_observed",
        runtime: { ...aggregate().runtime, status: "failed" },
      }),
    );
    expect(older.runtime.status).toBe("paused");
    expect(JSON.stringify(older)).toBe(JSON.stringify(current));
    expect(JSON.stringify(projectTaskAggregate(older))).toBe(
      JSON.stringify(projectTaskAggregate(current)),
    );
  });

  it("rejects cross-record handoff identities", () => {
    expect(() =>
      foldTaskEvent(
        aggregate(),
        event(1, {
          type: "runtime_handoff_observed",
          sessionId,
          handoffId,
          handoffGeneration: 3,
          controller: "human",
          status: "awaiting_human",
          ownershipGeneration: 3,
          continuation: {
            status: "pending",
            id: "continuation-1",
            taskId,
            sessionId: "ses_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            threadId,
            handoffId,
            generation: 3,
          },
          attention: null,
        }),
      ),
    ).toThrow(/identity/);
  });

  it("reproduces projection bytes from aggregate", () => {
    const value = aggregate();
    expect(JSON.stringify(projectTaskAggregate(value))).toBe(
      JSON.stringify(projectTaskAggregate(structuredClone(value))),
    );
  });
});
