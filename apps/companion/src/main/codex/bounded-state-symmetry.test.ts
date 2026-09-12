import { describe, expect, it } from "vitest";

import { OrderedAttentionQueue, type AttentionState } from "./attention.js";
import {
  DurableContinuationStore,
  type ContinuationIdentity,
  type ContinuationState,
  type PendingContinuation,
} from "./continuations.js";
import {
  PersistentConversationStore,
  reduceConversationEvent,
  type ConversationAssociation,
  type ConversationReducerState,
  type NormalizedConversationEvent,
} from "./conversations.js";
import { MemoryStateRepository } from "./persistence.js";
import {
  ContextAuthority,
  type ResolvedTaskContext,
} from "./task-coordinator.js";

function context(index: number): ResolvedTaskContext {
  const roveTaskId = `task_${index}`;
  const attemptId = `boot_${index.toString(16).padStart(32, "0")}`;
  return {
    roveTaskId,
    executionMode: "agent",
    browserIdentity: { mode: "temporary" },
    selectionSource: "user_selected",
    selectedAt: "2026-09-07T00:00:00Z",
    policy: {
      cwd: "/tmp/rove",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
    },
    bootstrap: {
      attemptId,
      threadSource: `rove:${roveTaskId}:${attemptId}`,
      stage: "intent_persisted",
    },
  };
}

function association(index: number): ConversationAssociation {
  return {
    roveTaskId: `task_${index}`,
    codexThreadId: `thread_${index}`,
    codexSessionId: `codex_session_${index}`,
    roveSessionId: `ses_${index}`,
    turnStatus: "unknown",
    archived: false,
    lastEventSequence: 0,
    items: {},
    turnOrder: [],
  };
}

function continuation(index: number): PendingContinuation {
  return {
    roveTaskId: `task_${index}`,
    codexThreadId: `thread_${index}`,
    originatingCodexTurnId: `turn_${index}`,
    roveSessionId: `ses_${index}`,
    handoffGeneration: 1,
    requestedInstruction: "Continue",
    continuationPolicy: "explicit_user_response",
    status: "pending",
    freshInspectionRequired: false,
  };
}

describe("round-4 bounded durable state symmetry", () => {
  it("rejects task context N+1 without changing the restorable N snapshot", () => {
    const authority = new ContextAuthority();
    for (let index = 0; index < 256; index += 1)
      authority.resolve(context(index));
    const atLimit = authority.snapshot();
    const recovered = new ContextAuthority();
    expect(() => recovered.restore(atLimit)).not.toThrow();

    expect(() => authority.resolve(context(256))).toThrow(/bound/);
    expect(authority.snapshot()).toEqual(atLimit);
    const recoveredAfterRejection = new ContextAuthority();
    expect(() =>
      recoveredAfterRejection.restore(authority.snapshot()),
    ).not.toThrow();
  });

  it("compacts derived conversation collections and remains readable after restart", async () => {
    const repository = new MemoryStateRepository<ConversationReducerState>();
    const store = new PersistentConversationStore(repository);
    await store.bind(association(0));
    let sequence = 0;
    const event = (
      value: Omit<
        NormalizedConversationEvent,
        "sequence" | "payloadFingerprint"
      >,
    ): NormalizedConversationEvent => ({
      ...value,
      sequence: ++sequence,
      payloadFingerprint: sequence.toString(16).padStart(64, "0"),
    });
    for (let index = 0; index < 65; index += 1) {
      const turnId = `turn_${index.toString().padStart(3, "0")}`;
      const itemId = `item_${index.toString().padStart(3, "0")}`;
      await store.apply(
        event({
          eventId: `start_${index}`,
          threadId: "thread_0",
          turnId,
          type: "turn_started",
        }),
      );
      await store.apply(
        event({
          eventId: `item_${index}`,
          threadId: "thread_0",
          turnId,
          itemId,
          type: "item_completed",
          item: {
            id: itemId,
            turnId,
            kind: "assistant_message",
            status: "completed",
            authoredBy: "assistant",
            text: "OK",
          },
        }),
      );
      await store.apply(
        event({
          eventId: `complete_${index}`,
          threadId: "thread_0",
          turnId,
          type: "turn_terminal",
          status: "completed",
        }),
      );
    }
    const projection = await new PersistentConversationStore(
      repository,
    ).projection("thread_0");
    expect(projection?.turnOrder).toHaveLength(64);
    expect(Object.keys(projection?.items ?? {})).toHaveLength(64);
    expect(projection?.turnOrder).not.toContain("turn_000");
    expect(projection?.items).not.toHaveProperty("item_000");

    const beforeDerivedCaps = await repository.read();
    if (!beforeDerivedCaps) throw new Error("Missing conversation snapshot.");
    let reduced = beforeDerivedCaps.value;
    for (let index = 0; index < 257; index += 1) {
      const itemId = `dense_item_${index.toString().padStart(3, "0")}`;
      reduced = reduceConversationEvent(
        reduced,
        event({
          eventId: `dense_${index}`,
          threadId: "thread_0",
          turnId: "turn_064",
          itemId,
          type: "item_completed",
          item: {
            id: itemId,
            turnId: "turn_064",
            kind: "assistant_message",
            status: "completed",
            authoredBy: "assistant",
            text: "OK",
          },
        }),
      );
    }
    while (sequence < 2049) {
      reduced = reduceConversationEvent(
        reduced,
        event({
          eventId: `fingerprint_${sequence + 1}`,
          threadId: "thread_0",
          type: sequence % 2 === 0 ? "thread_archived" : "thread_unarchived",
        }),
      );
    }
    await repository.write(beforeDerivedCaps.revision, reduced);
    const recovered = new PersistentConversationStore(repository);
    const recoveredState = await recovered.read();
    const recoveredProjection = await recovered.projection("thread_0");
    expect(Object.keys(recoveredProjection?.items ?? {})).toHaveLength(256);
    expect(recoveredProjection?.items).not.toHaveProperty("dense_item_000");
    expect(Object.keys(recoveredState.eventFingerprints)).toHaveLength(2048);
    expect(recoveredState.eventFingerprints).not.toHaveProperty("start_0");
    expect(recoveredState.eventFingerprints).toHaveProperty(
      `fingerprint_${sequence}`,
    );
  }, 30_000);

  it("rejects association and global pending-event N+1 before commit", async () => {
    const associationRepository =
      new MemoryStateRepository<ConversationReducerState>();
    const associations = new PersistentConversationStore(associationRepository);
    for (let index = 0; index < 256; index += 1)
      await associations.bind(association(index));
    const associationsAtLimit = await associationRepository.read();
    await expect(associations.bind(association(256))).rejects.toThrow(/bound/);
    expect(await associationRepository.read()).toEqual(associationsAtLimit);
    await expect(
      new PersistentConversationStore(associationRepository).read(),
    ).resolves.toMatchObject({
      associations: expect.any(Object),
    });

    const pendingRepository =
      new MemoryStateRepository<ConversationReducerState>();
    const pending = new PersistentConversationStore(pendingRepository);
    for (let index = 0; index < 128; index += 1) {
      const threadId = `pending_thread_${index}`;
      await pending.apply({
        eventId: `pending_event_${index}`,
        payloadFingerprint: (index + 1).toString(16).padStart(64, "0"),
        sequence: index + 1,
        threadId,
        type: "thread_started",
      });
    }
    const pendingAtLimit = await pendingRepository.read();
    await expect(
      pending.apply({
        eventId: "pending_event_128",
        payloadFingerprint: "f".repeat(64),
        sequence: 129,
        threadId: "pending_thread_128",
        type: "thread_started",
      }),
    ).rejects.toThrow(/pending-event bound/);
    expect(await pendingRepository.read()).toEqual(pendingAtLimit);
    await expect(
      new PersistentConversationStore(pendingRepository).read(),
    ).resolves.toMatchObject({ pendingByThread: expect.any(Object) });
  });

  it("rejects continuation N+1 and keeps create/transition snapshots readable", async () => {
    const repository = new MemoryStateRepository<ContinuationState>();
    const store = new DurableContinuationStore(repository);
    for (let index = 0; index < 256; index += 1)
      await store.register(continuation(index));
    await expect(
      new DurableContinuationStore(repository).validate(),
    ).resolves.toBeUndefined();
    const atLimit = await repository.read();
    await expect(store.register(continuation(256))).rejects.toThrow(/bound/);
    expect(await repository.read()).toEqual(atLimit);

    const identity: ContinuationIdentity = continuation(0);
    await store.cancel(identity);
    await expect(
      new DurableContinuationStore(repository).validate(),
    ).resolves.toBeUndefined();
  });

  it("rejects actionable attention N+1 unchanged and safely evicts terminal state", async () => {
    const repository = new MemoryStateRepository<AttentionState>();
    const queue = new OrderedAttentionQueue(100, repository);
    const request = (index: number) => ({
      authority: "rove_control" as const,
      kind: "control_handoff" as const,
      requestId: `control:ses_${index}:1`,
      taskId: `task_${index}`,
      generation: 1,
      payload: {},
    });
    for (let index = 0; index < 100; index += 1) queue.enqueue(request(index));
    await queue.flush();
    const atLimit = await repository.read();
    expect(() => queue.enqueue(request(100))).toThrow(/capacity/);
    await queue.flush();
    expect(await repository.read()).toEqual(atLimit);
    const recovered = new OrderedAttentionQueue(100, repository);
    await recovered.restore();
    expect(recovered.list()).toHaveLength(100);

    recovered.resolveExact({
      authority: "rove_control",
      requestId: "control:ses_0:1",
      taskId: "task_0",
      generation: 1,
    });
    recovered.enqueue(request(100));
    await recovered.flush();
    const afterSafeEviction = new OrderedAttentionQueue(100, repository);
    await afterSafeEviction.restore();
    expect(afterSafeEviction.list()).toHaveLength(100);
    expect(
      afterSafeEviction.list().map((entry) => entry.requestId),
    ).not.toContain("control:ses_0:1");
  });
});
