import { describe, expect, it } from "vitest";

import {
  reduceTaskLifecycle as productionReducer,
  type NativeLifecycleInput,
} from "../src/native-lifecycle-contract.js";
// @ts-expect-error The experiment wrapper intentionally remains plain ESM.
import { reduceTaskLifecycle as lockedOracle } from "../../../experiments/agent-execution/native-lifecycle-contract.mjs";

describe("production lifecycle authority", () => {
  it("exports the exact locked L0 reducer rather than a second model", () => {
    expect(productionReducer).toBe(lockedOracle);
  });

  it("accepts a compile-time checked production fact set and validates it at runtime", () => {
    const taskId = "task_11111111-1111-4111-8111-111111111111";
    const sessionId = `ses_${"2".repeat(32)}`;
    const threadId = "33333333-3333-4333-8333-333333333333";
    const bootstrapId = `boot_${"4".repeat(32)}`;
    const input: NativeLifecycleInput = {
      record: {
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
      },
      codex: {
        availability: "available",
        threadExists: true,
        threadId,
        threadSource: `rove:${taskId}:${bootstrapId}`,
        sourceLookup: "exact",
        runtimeStatus: "idle",
        archived: false,
        turn: "completed",
      },
      runtime: {
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
      },
      continuation: { status: "none" },
      attentions: [],
      freshInspection: null,
      requestedOperation: { type: "observe", taskId },
    };

    expect(productionReducer(input)).toMatchObject({
      taskId,
      phase: "ready",
      allowedActions: ["finish", "message"],
    });
    expect(lockedOracle(input)).toEqual(productionReducer(input));

    const startingRuntime = structuredClone(input);
    startingRuntime.runtime.status = "starting";
    startingRuntime.requestedOperation = {
      type: "message",
      taskId,
      operationId: "intent_44444444-4444-4444-8444-444444444444",
      message: "Begin after Runtime startup converges.",
    };
    expect(productionReducer(startingRuntime)).toMatchObject({
      phase: "recovering",
      operationDisposition: { status: "deferred-for-convergence" },
      nextCommand: {
        type: "read_runtime_inventory",
        taskId,
        sessionId,
      },
    });

    const closingAfterReplacement = structuredClone(input);
    closingAfterReplacement.runtime = {
      availability: "unavailable",
      sessionExists: false,
      bootstrapLookup: "unknown",
      status: "unknown",
      controller: null,
      attachment: "unknown",
      profileLock: "unknown",
      recovery: "unknown",
    };
    closingAfterReplacement.continuation = {
      status: "pending",
      id: "continuation-1",
      taskId,
      sessionId,
      threadId,
      handoffId: `handoff_${"5".repeat(32)}`,
      generation: 2,
      policy: "resume_after_control_return",
      freshInspectionRequired: false,
      preHandoffObservationSeq: 3,
      returnEventId: `return:${sessionId}:handoff_${"5".repeat(32)}:2`,
      returnObservationSeq: 5,
    };
    closingAfterReplacement.requestedOperation = {
      type: "finish",
      taskId,
      operationId: "intent_66666666-6666-4666-8666-666666666666",
    };
    expect(productionReducer(closingAfterReplacement)).toMatchObject({
      phase: "closing",
      nextCommand: { type: "persist_close_intent" },
    });

    const closingUnknownContinuation = structuredClone(input);
    closingUnknownContinuation.record!.desiredState = "closed";
    closingUnknownContinuation.record!.closeOperation = {
      operationId: "intent_77777777-7777-4777-8777-777777777777",
      requestedAt: "2026-09-09T12:00:00.000Z",
      stage: "codex_settled",
    };
    closingUnknownContinuation.continuation = {
      status: "pending",
      id: "continuation-2",
      taskId,
      sessionId,
      threadId,
      handoffId: `handoff_${"8".repeat(32)}`,
      generation: 3,
      policy: "resume_after_control_return",
      freshInspectionRequired: false,
      preHandoffObservationSeq: 6,
      returnEventId: `return:${sessionId}:handoff_${"8".repeat(32)}:3`,
      returnObservationSeq: 8,
      command: {
        commandId: `continuation:${taskId}:3`,
        returnEventId: `return:${sessionId}:handoff_${"8".repeat(32)}:3`,
        kind: "turn/steer",
        dispatchStatus: "possibly_started",
      },
    };
    closingUnknownContinuation.requestedOperation = { type: "observe", taskId };
    expect(productionReducer(closingUnknownContinuation)).toMatchObject({
      phase: "closing",
      nextCommand: { type: "settle_continuation_attention" },
    });
  });

  it("preserves current opaque Codex thread, turn, and request identities exactly", () => {
    const taskId = "task_11111111-1111-4111-8111-111111111111";
    const sessionId = `ses_${"2".repeat(32)}`;
    const threadId = "01a0819a-dfa5-78e0-b725-371572a99787";
    const turnId = "01a0819a-eb7b-7fa2-9d33-29f824eb3d18";
    const bootstrapId = `boot_${"4".repeat(32)}`;
    const input: NativeLifecycleInput = {
      record: {
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
      },
      codex: {
        availability: "available",
        threadExists: true,
        threadId,
        threadSource: `rove:${taskId}:${bootstrapId}`,
        sourceLookup: "exact",
        runtimeStatus: "active",
        archived: false,
        turn: "active",
        turnId,
      },
      runtime: {
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
      },
      continuation: { status: "none" },
      attentions: [],
      freshInspection: null,
      requestedOperation: {
        type: "interrupt",
        taskId,
        operationId: "intent_55555555-5555-4555-8555-555555555555",
      },
    };

    expect(productionReducer(input).nextCommand).toMatchObject({
      type: "interrupt_codex_turn",
      threadId,
      turnId,
    });

    const requestId = "7.leading/request.identity";
    const attentionInput = structuredClone(input);
    attentionInput.attentions = [
      {
        authority: "codex",
        kind: "mcp_elicitation",
        requestId,
        taskId,
        threadId,
        turnId,
        generation: 1,
        status: "pending",
      },
    ];
    attentionInput.requestedOperation = {
      type: "respond_attention",
      taskId,
      operationId: "intent_66666666-6666-4666-8666-666666666666",
      requestId,
      generation: 1,
    };
    expect(productionReducer(attentionInput).nextCommand).toMatchObject({
      type: "respond_codex_attention",
      threadId,
      requestId,
    });
    expect(lockedOracle(attentionInput)).toEqual(
      productionReducer(attentionInput),
    );
  });

  it("exposes explicit unarchive for a completely closed task", () => {
    const taskId = "task_11111111-1111-4111-8111-111111111111";
    const sessionId = `ses_${"2".repeat(32)}`;
    const threadId = "01a0819a-dfa5-78e0-b725-371572a99787";
    const bootstrapId = `boot_${"4".repeat(32)}`;
    const operationId = "intent_77777777-7777-4777-8777-777777777777";
    const input: NativeLifecycleInput = {
      record: {
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
        desiredState: "closed",
        closeOperation: {
          operationId: "intent_66666666-6666-4666-8666-666666666666",
          requestedAt: "2026-09-09T12:00:00.000Z",
          stage: "complete",
        },
      },
      codex: {
        availability: "available",
        threadExists: true,
        threadId,
        threadSource: `rove:${taskId}:${bootstrapId}`,
        sourceLookup: "exact",
        runtimeStatus: "idle",
        archived: true,
        turn: "completed",
      },
      runtime: {
        availability: "available",
        sessionExists: true,
        sessionId,
        bootstrapId,
        bootstrapLookup: "exact",
        status: "completed",
        controller: null,
        attachment: "missing",
        profileLock: "released",
        browserIdentity: { mode: "temporary" },
        recovery: "cleanup_required",
      },
      continuation: { status: "none" },
      attentions: [],
      freshInspection: null,
      requestedOperation: {
        type: "resume",
        taskId,
        operationId,
      },
    };
    expect(productionReducer(input)).toMatchObject({
      phase: "closed",
      allowedActions: ["resume"],
      operationDisposition: { status: "accepted", operationId },
      nextCommand: {
        type: "unarchive_codex_thread",
        taskId,
        threadId,
        operationId,
      },
    });
  });

  it("starts Codex without Runtime and keeps the conversation usable when browser support is unavailable", () => {
    const taskId = "task_91111111-1111-4111-8111-111111111111";
    const threadId = "01a09746-5a83-7862-96df-d14a72aadef7";
    const bootstrapId = `boot_${"9".repeat(32)}`;
    const browserless: NativeLifecycleInput = {
      record: {
        schemaVersion: 1,
        identity: { taskId },
        bootstrap: {
          operationId: bootstrapId,
          threadSource: `rove:${taskId}:${bootstrapId}`,
          stage: "intent_persisted",
        },
        desiredState: "open",
      },
      codex: {
        availability: "available",
        threadExists: false,
        sourceLookup: "none",
        runtimeStatus: "notLoaded",
        archived: null,
        turn: "none",
      },
      runtime: {
        availability: "unavailable",
        sessionExists: false,
        bootstrapLookup: "unknown",
        status: "unknown",
        controller: null,
        attachment: "unknown",
        profileLock: "unknown",
        recovery: "unknown",
      },
      continuation: { status: "none" },
      attentions: [],
      freshInspection: null,
      requestedOperation: { type: "observe", taskId },
    };

    expect(productionReducer(browserless)).toMatchObject({
      phase: "starting",
      nextCommand: {
        type: "advance_bootstrap_stage",
        stage: "thread_dispatching",
      },
    });

    const ready = structuredClone(browserless);
    ready.record!.identity.threadId = threadId;
    ready.record!.bootstrap.stage = "complete";
    ready.codex = {
      availability: "available",
      threadExists: true,
      threadId,
      threadSource: `rove:${taskId}:${bootstrapId}`,
      sourceLookup: "exact",
      runtimeStatus: "idle",
      archived: false,
      turn: "completed",
    };
    ready.requestedOperation = {
      type: "message",
      taskId,
      operationId: "intent_91911111-1111-4111-8111-111111111111",
      message: "Continue without a browser.",
    };
    expect(productionReducer(ready)).toMatchObject({
      phase: "ready",
      nextCommand: {
        type: "start_or_steer_codex_turn",
        taskId,
        threadId,
      },
    });

    const afterBrowserClosure = structuredClone(ready);
    const sessionId = `ses_${"9".repeat(32)}`;
    afterBrowserClosure.record!.identity.sessionId = sessionId;
    afterBrowserClosure.record!.identity.browser = { mode: "temporary" };
    afterBrowserClosure.runtime = {
      availability: "available",
      sessionExists: true,
      sessionId,
      bootstrapId,
      bootstrapLookup: "exact",
      status: "failed",
      controller: null,
      attachment: "missing",
      profileLock: "released",
      browserIdentity: { mode: "temporary" },
      recovery: "cleanup_required",
    };
    afterBrowserClosure.requestedOperation = {
      type: "message",
      taskId,
      operationId: "intent_92911111-1111-4111-8111-111111111111",
      message: "Continue after the browser closed.",
    };
    expect(productionReducer(afterBrowserClosure)).toMatchObject({
      phase: "ready",
      allowedActions: expect.arrayContaining(["message"]),
      nextCommand: { type: "start_or_steer_codex_turn", taskId, threadId },
    });
  });

  it("rejects empty, oversized, and wrongly typed opaque Codex identities", () => {
    const taskId = "task_11111111-1111-4111-8111-111111111111";
    const sessionId = `ses_${"2".repeat(32)}`;
    const threadId = "01a0819a-dfa5-78e0-b725-371572a99787";
    const turnId = "01a0819a-eb7b-7fa2-9d33-29f824eb3d18";
    const bootstrapId = `boot_${"4".repeat(32)}`;
    const valid: NativeLifecycleInput = {
      record: {
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
      },
      codex: {
        availability: "available",
        threadExists: true,
        threadId,
        threadSource: `rove:${taskId}:${bootstrapId}`,
        sourceLookup: "exact",
        runtimeStatus: "active",
        archived: false,
        turn: "active",
        turnId,
      },
      runtime: {
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
      },
      continuation: { status: "none" },
      attentions: [],
      freshInspection: null,
      requestedOperation: { type: "observe", taskId },
    };
    const invalidValues: unknown[] = ["", "x".repeat(257), 7];

    for (const value of invalidValues) {
      const badThread = structuredClone(valid);
      badThread.record!.identity.threadId = value as string;
      expect(() => productionReducer(badThread)).toThrow(/thread id.*invalid/i);

      const badTurn = structuredClone(valid);
      badTurn.codex.turnId = value as string;
      expect(() => productionReducer(badTurn)).toThrow(/turn id.*invalid/i);

      const badRequest = structuredClone(valid);
      badRequest.attentions = [
        {
          authority: "codex",
          kind: "mcp_elicitation",
          requestId: value as string,
          taskId,
          threadId,
          turnId,
          generation: 1,
          status: "pending",
        },
      ];
      expect(() => productionReducer(badRequest)).toThrow(
        /request id.*invalid/i,
      );
    }
  });
});
