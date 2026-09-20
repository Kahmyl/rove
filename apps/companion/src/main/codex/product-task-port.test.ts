import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyTaskAggregate,
  projectTaskAggregate,
  taskEventDigest,
  TaskEngine,
  type TaskCommand,
  type TaskEvent,
} from "@rove/protocol";
import { FileEffectJournalStore } from "@rove/storage";
import Database from "better-sqlite3";

import { OrderedAttentionQueue } from "./attention.js";
import { LocalProductApi } from "./local-product-api.js";
import { createProductIntentIpcHandler } from "./product-intent-ipc.js";
import { LedgerProductTaskPort } from "./product-task-port.js";
import { assembleTaskResultContext } from "./results.js";
import { SqliteTaskEngineStore } from "./sqlite-task-engine-store.js";
import { TaskEngineWorker } from "./task-engine-worker.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const seededTaskId = "task_12345678-1234-4123-8123-123456789abc";
const seededSessionId = `ses_${"a".repeat(32)}`;
const seededBootstrapId = `boot_${"b".repeat(32)}`;

function createSelectedDraft(
  store: SqliteTaskEngineStore,
  identity: string,
  body: string,
) {
  const result = store.createResult({
    operationId: `result-create-${identity}`,
    taskId: seededTaskId,
    kind: "draft",
    title: `Reviewed ${identity}`,
    body,
    source: { evidenceIds: [] },
  });
  return store.setResultSelected({
    operationId: `result-select-${identity}`,
    taskId: seededTaskId,
    resultId: result.resultId,
    expectedRevision: 1,
    selected: true,
  });
}

async function seedReadyTask(
  store: SqliteTaskEngineStore,
  options: {
    legacyEffects?:
      "not_applicable" | "acknowledgement_required" | "acknowledged";
    command?: TaskCommand;
    mutate?: (aggregate: ReturnType<typeof emptyTaskAggregate>) => void;
  } = {},
) {
  const aggregate = emptyTaskAggregate(seededTaskId);
  aggregate.revision = 1;
  aggregate.launch = {
    operationId: "intent_12345678-1234-4123-8123-123456789abc",
    bootstrapId: seededBootstrapId,
    requestedAt: "2026-09-09T12:00:00.000Z",
    outcome: "Exercise the production product route.",
    executionMode: "agent",
    browserIdentity: { mode: "temporary" },
    approvalsReviewer: "auto_review",
    cwd: "/isolated/task-workspace",
    attachmentIds: [],
  };
  aggregate.record = {
    schemaVersion: 1,
    identity: {
      taskId: seededTaskId,
      sessionId: seededSessionId,
      threadId: "thread_seeded",
      browser: { mode: "temporary" },
    },
    bootstrap: {
      operationId: seededBootstrapId,
      threadSource: `rove:${seededTaskId}:${seededBootstrapId}`,
      stage: "complete",
    },
    desiredState: "open",
  };
  aggregate.codex = {
    availability: "available",
    threadExists: true,
    threadId: "thread_seeded",
    threadSource: `rove:${seededTaskId}:${seededBootstrapId}`,
    sourceLookup: "exact",
    runtimeStatus: "idle",
    archived: false,
    turn: "completed",
  };
  aggregate.codexSessionId = "codex_session_seeded";
  aggregate.runtime = {
    availability: "available",
    sessionExists: true,
    sessionId: seededSessionId,
    bootstrapId: seededBootstrapId,
    bootstrapLookup: "exact",
    status: "active",
    controller: "agent",
    attachment: "attached",
    profileLock: "released",
    browserIdentity: { mode: "temporary" },
    recovery: "not_needed",
    ...(options.legacyEffects === undefined
      ? {}
      : { legacyEffects: options.legacyEffects }),
  };
  options.mutate?.(aggregate);
  const event: TaskEvent = {
    schemaVersion: 1,
    type: "runtime_inventory_observed",
    eventId: "runtime:seeded-product-route",
    taskId: seededTaskId,
    source: {
      kind: "runtime",
      id: "runtime:seeded-product-route",
      generation: 1,
      position: 1,
    },
    observedAt: "2026-09-09T12:00:00.000Z",
    runtime: aggregate.runtime,
  };
  const acceptance = {
    duplicate: false,
    aggregate,
    projection: projectTaskAggregate(aggregate),
    command: options.command ?? null,
  };
  await store.transact(seededTaskId, (transaction) =>
    transaction.commit({
      event,
      digest: taskEventDigest(event),
      acceptance,
    }),
  );
}

describe("LedgerProductTaskPort protected workspace boundary", () => {
  it("keeps an ordered queue durable and outside conversation truth until one atomic promotion", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-durable-queue-"));
    roots.push(root);
    const path = join(root, "task-engine.sqlite3");
    let store = new SqliteTaskEngineStore({ path });
    await seedReadyTask(store, {
      mutate: (aggregate) => {
        aggregate.codex.turn = "active";
        aggregate.codex.turnId = "turn_active";
        aggregate.codex.runtimeStatus = "active";
        aggregate.conversation.items = {
          ["user:intent_12345678-1234-4123-8123-123456789abc"]: {
            id: "user:intent_12345678-1234-4123-8123-123456789abc",
            kind: "user_message",
            status: "completed",
            clientId: "intent_12345678-1234-4123-8123-123456789abc",
            acceptedAt: "2026-09-09T12:00:00.000Z",
            text: "Initial work",
          },
        };
        aggregate.conversation.itemOrder = Object.keys(
          aggregate.conversation.items,
        );
        aggregate.conversation.turnOrder = ["turn_active"];
      },
    });
    const worker = { signal: vi.fn(), cancelTask: vi.fn() };
    const port = new LedgerProductTaskPort({
      engine: new TaskEngine(store),
      store,
      worker: worker as never,
      now: () => "2026-09-09T12:01:00.000Z",
    });
    expect((await port.readTask(seededTaskId))?.capabilities).toMatchObject({
      canSubmit: false,
      canQueue: true,
      canSteer: true,
    });
    const firstOperation = "intent_22345678-1234-4123-8123-123456789abc";
    const secondOperation = "intent_32345678-1234-4123-8123-123456789abc";
    const firstAdd = {
      type: "queue_add",
      taskId: seededTaskId,
      operationId: firstOperation,
      message: "First queued instruction",
    } as const;
    await port.submit(firstAdd);
    expect((await port.submit(firstAdd)).duplicate).toBe(true);
    await port.submit({
      type: "queue_add",
      taskId: seededTaskId,
      operationId: secondOperation,
      message: "Second queued instruction",
    });
    const queued = await store.aggregate(seededTaskId);
    expect(queued?.queue.order).toEqual([
      `queue:${firstOperation}`,
      `queue:${secondOperation}`,
    ]);
    expect(
      queued?.conversation.items[`user:${firstOperation}`],
    ).toBeUndefined();
    expect(await store.claimDueCommands("restart-check", 1, 10)).toEqual([]);
    store.close();

    store = new SqliteTaskEngineStore({ path });
    expect((await store.aggregate(seededTaskId))?.queue.order).toEqual([
      `queue:${firstOperation}`,
      `queue:${secondOperation}`,
    ]);
    expect(await store.claimDueCommands("restart-check", 2, 10)).toEqual([]);
    let engine = new TaskEngine(store);
    const terminal: TaskEvent = {
      schemaVersion: 1,
      type: "codex_turn_observed",
      eventId: "codex:turn-active:completed",
      taskId: seededTaskId,
      source: { kind: "codex", id: "connection", generation: 2, position: 1 },
      observedAt: "2026-09-09T12:02:00.000Z",
      threadId: "thread_seeded",
      turn: {
        turn: "completed",
        turnId: "turn_active",
        runtimeStatus: "idle",
      },
    };
    const promoted = await engine.accept(terminal);
    expect(promoted.command?.type).toBe("start_or_steer_codex_turn");
    expect(promoted.aggregate.queue.order).toEqual([
      `queue:${secondOperation}`,
    ]);
    expect(promoted.aggregate.customerActiveIntervals[0]).toMatchObject({
      segmentId: "user:intent_12345678-1234-4123-8123-123456789abc",
      startedAt: "2026-09-09T12:01:00.000Z",
      endedAt: "2026-09-09T12:02:00.000Z",
    });
    expect(
      promoted.aggregate.conversation.items[`user:${firstOperation}`],
    ).toMatchObject({
      clientId: firstOperation,
      text: "First queued instruction",
    });
    const duplicate = await engine.accept(terminal);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.aggregate.queue.order).toEqual([
      `queue:${secondOperation}`,
    ]);
    expect(
      Object.values(duplicate.aggregate.conversation.items).filter(
        (item) => item.clientId === firstOperation,
      ),
    ).toHaveLength(1);

    // Cut the process immediately after the atomic promotion commit. The
    // promoted item and remaining queue entry recover without another
    // promotion, while the one normal delivery command remains claimable.
    store.close();
    store = new SqliteTaskEngineStore({ path });
    engine = new TaskEngine(store);
    const afterPromotionRestart = await store.aggregate(seededTaskId);
    expect(afterPromotionRestart?.queue.order).toEqual([
      `queue:${secondOperation}`,
    ]);
    expect(
      Object.values(afterPromotionRestart!.conversation.items).filter(
        (item) => item.clientId === firstOperation,
      ),
    ).toHaveLength(1);
    const claimed = await store.claimDueCommands("promotion-cut", 3, 10);
    expect(claimed).toHaveLength(1);
    const promotedCommandId = claimed[0]!.commandId;

    // Provider materialization reconciles into the same accepted item key.
    await engine.accept({
      schemaVersion: 1,
      type: "codex_item_observed",
      eventId: "codex:promoted-user:materialized",
      taskId: seededTaskId,
      source: { kind: "codex", id: "connection", generation: 2, position: 2 },
      observedAt: "2026-09-09T12:02:01.000Z",
      threadId: "thread_seeded",
      turnId: "turn_promoted",
      itemId: "provider-promoted-user",
      terminal: true,
      item: {
        id: "provider-promoted-user",
        turnId: "turn_promoted",
        clientId: firstOperation,
        kind: "user_message",
        status: "completed",
        text: "First queued instruction",
      },
    });
    const materialized = await store.aggregate(seededTaskId);
    expect(materialized?.queue.order).toEqual([`queue:${secondOperation}`]);
    expect(
      materialized?.conversation.items[`user:${firstOperation}`],
    ).toMatchObject({
      clientId: firstOperation,
      providerItemId: "provider-promoted-user",
      turnId: "turn_promoted",
    });

    // A second cut after dispatch may have started retains exactly the same
    // command/delivery identity and never consumes the next queue entry.
    store.close();
    store = new SqliteTaskEngineStore({ path });
    expect((await store.aggregate(seededTaskId))?.queue.order).toEqual([
      `queue:${secondOperation}`,
    ]);
    const recoveryClaim = await store.claimDueCommands(
      "promotion-cut-restart",
      4,
      10,
    );
    expect(recoveryClaim).toHaveLength(1);
    expect(recoveryClaim[0]).toMatchObject({
      commandId: promotedCommandId,
      claimedFrom: "pending",
      classification: { reconcile: "correlate_receipt" },
    });
    const outbox = new Database(path, { readonly: true });
    expect(
      (
        outbox
          .prepare(
            "SELECT command_id FROM task_engine_outbox WHERE task_id = ? ORDER BY aggregate_revision",
          )
          .all(seededTaskId) as { command_id: string }[]
      ).map((row) => row.command_id),
    ).toEqual([promotedCommandId]);
    outbox.close();
    expect(
      Object.values(
        (await store.aggregate(seededTaskId))!.conversation.items,
      ).filter((item) => item.clientId === firstOperation),
    ).toHaveLength(1);
    store.close();
  });

  it("bounds queue growth and keeps edits, removal, and reorder exact-task and idempotent", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-queue-operations-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "task-engine.sqlite3"),
    });
    await seedReadyTask(store, {
      mutate: (aggregate) => {
        aggregate.codex.turn = "active";
        aggregate.codex.turnId = "turn_active";
        aggregate.codex.runtimeStatus = "active";
      },
    });
    const port = new LedgerProductTaskPort({
      engine: new TaskEngine(store),
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });
    const operations = Array.from(
      { length: 16 },
      (_, index) =>
        `intent_${String(index + 10).padStart(8, "0")}-1234-4123-8123-123456789abc`,
    );
    for (const [index, operationId] of operations.entries())
      await port.submit({
        type: "queue_add",
        taskId: seededTaskId,
        operationId,
        message: `Queued ${index}`,
      });
    expect((await port.readTask(seededTaskId))?.capabilities).toMatchObject({
      canQueue: false,
      canSteer: true,
    });
    await expect(
      port.submit({
        type: "queue_add",
        taskId: seededTaskId,
        operationId: "intent_99345678-1234-4123-8123-123456789abc",
        message: "Overflow",
      }),
    ).rejects.toThrow(/queue is full/i);
    const firstId = `queue:${operations[0]}`;
    const secondId = `queue:${operations[1]}`;
    const edit = {
      type: "queue_edit" as const,
      taskId: seededTaskId,
      operationId: "intent_88345678-1234-4123-8123-123456789abc",
      entryId: firstId,
      message: "Edited once",
    };
    await port.submit(edit);
    const duplicate = await port.submit(edit);
    expect(duplicate.duplicate).toBe(true);
    const current = await store.aggregate(seededTaskId);
    await port.submit({
      type: "queue_reorder",
      taskId: seededTaskId,
      operationId: "intent_77345678-1234-4123-8123-123456789abc",
      entryIds: [secondId, firstId, ...current!.queue.order.slice(2)],
    });
    const remove = {
      type: "queue_remove",
      taskId: seededTaskId,
      operationId: "intent_66345678-1234-4123-8123-123456789abc",
      entryId: firstId,
    } as const;
    await port.submit(remove);
    expect((await port.submit(remove)).duplicate).toBe(true);
    await expect(
      port.submit({
        type: "queue_remove",
        taskId: "task_22345678-1234-4123-8123-123456789abc",
        operationId: "intent_67345678-1234-4123-8123-123456789abc",
        entryId: secondId,
      }),
    ).rejects.toThrow(/not found on this task/i);
    const final = await store.aggregate(seededTaskId);
    expect(final?.queue.entries[firstId]).toBeUndefined();
    expect(final?.queue.order[0]).toBe(secondId);
    expect(final?.queue.order).toHaveLength(15);
    const stopped = await port.submit({
      type: "interrupt",
      taskId: seededTaskId,
      operationId: "intent_65345678-1234-4123-8123-123456789abc",
    });
    expect(stopped.aggregate.queue.order).toEqual(final?.queue.order);
    expect(
      stopped.aggregate.conversation.items[`user:${operations[1]}`],
    ).toBeUndefined();
    store.close();
  });

  it("accepts explicit Steer only for the exact active turn and deduplicates its user item", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-explicit-steer-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "task-engine.sqlite3"),
    });
    await seedReadyTask(store, {
      mutate: (aggregate) => {
        aggregate.codex.turn = "active";
        aggregate.codex.turnId = "turn_active";
        aggregate.codex.runtimeStatus = "active";
      },
    });
    const port = new LedgerProductTaskPort({
      engine: new TaskEngine(store),
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });
    const staleOperation = "intent_44345678-1234-4123-8123-123456789abc";
    await expect(
      port.submit({
        type: "steer",
        taskId: seededTaskId,
        operationId: staleOperation,
        expectedTurnId: "turn_stale",
        message: "Do not send this",
      }),
    ).rejects.toThrow(/stale or mismatched active turn/i);
    expect(
      (await store.aggregate(seededTaskId))?.conversation.items[
        `user:${staleOperation}`
      ],
    ).toBeUndefined();
    const operationId = "intent_55345678-1234-4123-8123-123456789abc";
    const accepted = await port.submit({
      type: "steer",
      taskId: seededTaskId,
      operationId,
      expectedTurnId: "turn_active",
      message: "Send this now",
    });
    expect(accepted.command?.type).toBe("start_or_steer_codex_turn");
    expect(
      accepted.aggregate.conversation.items[`user:${operationId}`],
    ).toMatchObject({
      clientId: operationId,
      text: "Send this now",
    });
    const duplicate = await port.submit({
      type: "steer",
      taskId: seededTaskId,
      operationId,
      expectedTurnId: "turn_active",
      message: "Send this now",
    });
    expect(duplicate.duplicate).toBe(true);
    expect(
      Object.values(duplicate.aggregate.conversation.items).filter(
        (item) => item.clientId === operationId,
      ),
    ).toHaveLength(1);
    store.close();
  });

  it("does not manufacture a transcript item for a rejected customer message", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-rejected-message-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "task-engine.sqlite3"),
    });
    await seedReadyTask(store, {
      mutate: (aggregate) => {
        aggregate.desiredState = "closed";
        aggregate.record!.desiredState = "closed";
        aggregate.record!.closeOperation = {
          operationId: "intent_11345678-1234-4123-8123-123456789abc",
          requestedAt: "2026-09-09T12:00:00.000Z",
          stage: "complete",
        };
        aggregate.codex.archived = true;
      },
    });
    const port = new LedgerProductTaskPort({
      engine: new TaskEngine(store),
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });
    const rejected = await port.submit({
      type: "message",
      taskId: seededTaskId,
      operationId: "intent_22345678-1234-4123-8123-123456789abc",
      message: "This must not look sent",
    });
    expect(rejected.projection.operationDisposition.status).toBe("rejected");
    expect(rejected.aggregate.conversation.items).toEqual({});
    store.close();
  });

  it("creates the same immediate local item for an explicit customer continuation response", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-explicit-response-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "task-engine.sqlite3"),
    });
    await seedReadyTask(store);
    const engine = new TaskEngine(store);
    await engine.accept({
      schemaVersion: 1,
      type: "runtime_handoff_observed",
      eventId: "runtime:explicit-response",
      taskId: seededTaskId,
      source: { kind: "runtime", id: "runtime", generation: 2, position: 1 },
      observedAt: "2026-09-09T12:01:00.000Z",
      sessionId: seededSessionId,
      handoffId: `handoff_${"e".repeat(32)}`,
      handoffGeneration: 2,
      ownershipGeneration: 3,
      controller: "human",
      status: "active",
      continuation: {
        status: "pending",
        id: "continuation_explicit",
        taskId: seededTaskId,
        sessionId: seededSessionId,
        threadId: "thread_seeded",
        handoffId: `handoff_${"e".repeat(32)}`,
        generation: 2,
        policy: "explicit_user_response",
        freshInspectionRequired: false,
        preHandoffObservationSeq: 1,
      },
      attention: {
        authority: "rove_control",
        kind: "control_handoff",
        requestId: "control_explicit",
        taskId: seededTaskId,
        sessionId: seededSessionId,
        threadId: "thread_seeded",
        handoffId: `handoff_${"e".repeat(32)}`,
        generation: 2,
        status: "pending",
      },
    });
    await engine.accept({
      schemaVersion: 1,
      type: "runtime_inventory_observed",
      eventId: "runtime:explicit-response:return",
      taskId: seededTaskId,
      source: { kind: "runtime", id: "runtime", generation: 2, position: 2 },
      observedAt: "2026-09-09T12:01:01.000Z",
      runtime: {
        availability: "available",
        sessionExists: true,
        sessionId: seededSessionId,
        bootstrapId: seededBootstrapId,
        bootstrapLookup: "exact",
        status: "active",
        controller: "agent",
        attachment: "attached",
        profileLock: "released",
        browserIdentity: { mode: "temporary" },
        recovery: "not_needed",
        ownershipGeneration: 4,
        lastReturnedHandoffId: `handoff_${"e".repeat(32)}`,
        observationSeq: 2,
      },
    });
    const port = new LedgerProductTaskPort({
      engine,
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });
    const operationId = "intent_25345678-1234-4123-8123-123456789abc";
    const accepted = await port.submit({
      type: "explicit_continuation_response",
      taskId: seededTaskId,
      operationId,
      message: "Use the confirmed address.",
    });
    expect(accepted.projection.operationDisposition).toMatchObject({
      status: "accepted",
    });
    expect(
      accepted.aggregate.conversation.items[`user:${operationId}`],
    ).toMatchObject({
      clientId: operationId,
      text: "Use the confirmed address.",
    });
    store.close();
  });

  it("keeps uncertain delivery on the same item and retains the redispatch fence", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-uncertain-message-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "task-engine.sqlite3"),
    });
    await seedReadyTask(store);
    const engine = new TaskEngine(store);
    const port = new LedgerProductTaskPort({
      engine,
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });
    const operationId = "intent_26345678-1234-4123-8123-123456789abc";
    const accepted = await port.submit({
      type: "message",
      taskId: seededTaskId,
      operationId,
      message: "Send this only once.",
    });
    const [claimed] = await store.claimDueCommands("worker", 1, 1);
    expect(claimed?.commandId).toBe(accepted.command?.commandId);
    await store.markPossiblyStarted(claimed!.commandId);
    await engine.accept({
      schemaVersion: 1,
      type: "command_outcome_observed",
      eventId: "worker:uncertain-message",
      taskId: seededTaskId,
      source: { kind: "worker", id: "worker", generation: 1, position: 1 },
      observedAt: "2026-09-09T12:01:01.000Z",
      commandId: accepted.command!.commandId,
      status: "unresolved",
      facts: [
        {
          schemaVersion: 1,
          type: "codex_message_delivery_observed",
          eventId: "delivery:may-have-received",
          taskId: seededTaskId,
          source: {
            kind: "worker",
            id: "delivery",
            generation: 1,
            position: 1,
          },
          observedAt: "2026-09-09T12:01:01.000Z",
          delivery: {
            operationId,
            threadId: "thread_seeded",
            state: "transport_may_have_received",
            connectionGeneration: 1,
            observedAt: "2026-09-09T12:01:01.000Z",
          },
        },
      ],
    });
    const itemId = `user:${operationId}`;
    expect(
      (await port.readTask(seededTaskId))?.conversation?.items[itemId],
    ).toMatchObject({
      text: "Send this only once.",
      deliveryState: "uncertain",
    });
    expect((await store.aggregate(seededTaskId))?.recoveryRequired).toContain(
      "reconciliation",
    );
    expect(await store.claimDueCommands("worker-retry", 2, 1)).toEqual([
      expect.objectContaining({
        commandId: accepted.command!.commandId,
        claimedFrom: "reconcile_required",
      }),
    ]);
    store.close();
  });

  it("keeps one full 16,000-character accepted follow-up through customer projection and provider materialization", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-accepted-message-"));
    roots.push(root);
    const path = join(root, "task-engine.sqlite3");
    const store = new SqliteTaskEngineStore({ path });
    await seedReadyTask(store);
    const engine = new TaskEngine(store);
    const port = new LedgerProductTaskPort({
      engine,
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
      now: () => "2026-09-09T12:01:00.000Z",
    });
    const operationId = "intent_32345678-1234-4123-8123-123456789abc";
    const itemId = `user:${operationId}`;
    const tail = "accepted-message-boundary-tail";
    const longMessage = `${"x".repeat(16_000 - tail.length)}${tail}`;
    const accepted = await port.submit({
      type: "message",
      taskId: seededTaskId,
      operationId,
      message: longMessage,
      attachmentIds: ["attachment-safe"],
      attachmentMetadata: [{ filename: "reference.png", kind: "image" }],
    });
    expect(accepted.aggregate.conversation.items[itemId]).toMatchObject({
      id: itemId,
      clientId: operationId,
      text: longMessage,
      attachments: [{ filename: "reference.png", kind: "image" }],
    });
    expect(accepted.aggregate.conversation.items[itemId]?.text).toHaveLength(
      16_000,
    );
    expect(
      accepted.aggregate.conversation.items[itemId]?.turnId,
    ).toBeUndefined();
    const api = new LocalProductApi(
      () => ({
        state: "ready",
        ready: true,
        restartAttempt: 0,
        stderrTail: [],
      }),
      {
        snapshot: () => ({
          account: { status: "logged_in", authMode: "chatgpt" },
          models: [],
          rateLimits: null,
          usage: null,
          refreshedAt: "2026-09-09T12:00:00.000Z",
        }),
      } as never,
      port,
      {},
      new OrderedAttentionQueue(),
      "/isolated/task-workspace",
      () => [],
    );
    const beforeMaterialization = (await api.readSnapshot()).tasks.find(
      (task) => task.taskId === seededTaskId,
    )!;
    expect(beforeMaterialization.conversation?.items[itemId]?.text).toBe(
      longMessage,
    );
    expect(
      Object.values(beforeMaterialization.conversation!.items).filter(
        (item) => item.kind === "user_message",
      ),
    ).toHaveLength(1);

    await engine.accept({
      schemaVersion: 1,
      type: "codex_message_delivery_observed",
      eventId: "codex-delivery:not-submitted",
      taskId: seededTaskId,
      source: { kind: "worker", id: "delivery", generation: 1, position: 1 },
      observedAt: "2026-09-09T12:01:00.500Z",
      delivery: {
        operationId,
        threadId: "thread_seeded",
        state: "non_submission_established",
        connectionGeneration: 1,
        observedAt: "2026-09-09T12:01:00.500Z",
      },
    });
    expect(
      (await port.readTask(seededTaskId))?.conversation?.items[itemId],
    ).toMatchObject({
      text: longMessage,
      deliveryState: "not_sent",
    });

    const duplicate = await port.submit({
      type: "message",
      taskId: seededTaskId,
      operationId,
      message: longMessage,
      attachmentIds: ["attachment-safe"],
      attachmentMetadata: [{ filename: "reference.png", kind: "image" }],
    });
    expect(duplicate.duplicate).toBe(true);
    expect(Object.values(duplicate.aggregate.conversation.items)).toHaveLength(
      1,
    );

    await engine.accept({
      schemaVersion: 1,
      type: "codex_item_observed",
      eventId: "codex-live:user-materialized",
      taskId: seededTaskId,
      source: { kind: "codex", id: "connection", generation: 2, position: 1 },
      observedAt: "2026-09-09T12:01:01.000Z",
      threadId: "thread_seeded",
      turnId: "turn_provider",
      itemId: "provider-item-1",
      terminal: true,
      item: {
        id: "provider-item-1",
        turnId: "turn_provider",
        clientId: operationId,
        kind: "user_message",
        status: "completed",
        text: `Provider-only selected result context\n${longMessage}`,
        attachments: [
          { filename: "/private/path/reference.png", kind: "image" },
        ],
      },
    });
    await engine.accept({
      schemaVersion: 1,
      type: "codex_item_observed",
      eventId: "codex-history:user-materialized",
      taskId: seededTaskId,
      source: {
        kind: "codex",
        id: "history:thread_seeded:provider-item-1",
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-09T12:01:02.000Z",
      threadId: "thread_seeded",
      turnId: "turn_provider",
      itemId: "provider-item-1",
      terminal: true,
      item: {
        id: "provider-item-1",
        turnId: "turn_provider",
        clientId: operationId,
        kind: "user_message",
        status: "completed",
        text: `Provider-only selected result context\n${longMessage}`,
      },
    });
    const afterMaterialization = await store.aggregate(seededTaskId);
    expect(afterMaterialization?.conversation.items[itemId]).toMatchObject({
      id: itemId,
      providerItemId: "provider-item-1",
      turnId: "turn_provider",
      text: longMessage,
      attachments: [{ filename: "reference.png", kind: "image" }],
    });
    expect(
      Object.values(afterMaterialization!.conversation.items),
    ).toHaveLength(1);
    expect(afterMaterialization?.messageDeliveries[operationId]?.state).toBe(
      "message_materialized",
    );
    const materializedProjection = (await api.readSnapshot()).tasks.find(
      (task) => task.taskId === seededTaskId,
    )!;
    expect(materializedProjection.conversation?.items[itemId]).toMatchObject({
      id: itemId,
      providerItemId: "provider-item-1",
      turnId: "turn_provider",
      text: longMessage,
      attachments: [{ filename: "reference.png", kind: "image" }],
      deliveryState: "materialized",
    });
    expect(
      Object.values(materializedProjection.conversation!.items).filter(
        (item) => item.kind === "user_message",
      ),
    ).toHaveLength(1);
    store.close();

    const reopened = new SqliteTaskEngineStore({ path });
    expect(
      (await reopened.aggregate(seededTaskId))?.conversation.items[itemId],
    ).toMatchObject({
      id: itemId,
      providerItemId: "provider-item-1",
      text: longMessage,
    });
    reopened.close();
  });

  it("persists the exact applied Workflow revision with a later turn across restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-workflow-turn-"));
    roots.push(root);
    const path = join(root, "task-engine.sqlite3");
    const store = new SqliteTaskEngineStore({ path });
    await seedReadyTask(store);
    const port = new LedgerProductTaskPort({
      engine: new TaskEngine(store),
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });
    await port.submit({
      type: "message",
      taskId: seededTaskId,
      operationId: "intent_42345678-1234-4123-8123-123456789abc",
      message: "Draft outreach",
      workflowContext: {
        workflowId: "workflow_jobs",
        workflowName: "Job search",
        revision: 4,
        digest: "d".repeat(64),
        developerInstructions: "Use approved outreach guidance.",
      },
    });
    store.close();

    const reopened = new SqliteTaskEngineStore({ path });
    const [command] = await reopened.claimDueCommands(
      "worker_workflow_test",
      1,
      1,
    );
    expect(command?.payload.workflowContext).toEqual({
      workflowId: "workflow_jobs",
      workflowName: "Job search",
      revision: 4,
      digest: "d".repeat(64),
      developerInstructions: "Use approved outreach guidance.",
    });
    reopened.close();
  });

  it("persists the exact selected-result snapshot with a later turn across restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-result-turn-"));
    roots.push(root);
    const path = join(root, "task-engine.sqlite3");
    const store = new SqliteTaskEngineStore({ path });
    await seedReadyTask(store);
    const port = new LedgerProductTaskPort({
      engine: new TaskEngine(store),
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });
    const result = store.createResult({
      operationId: "intent_42345678-1234-4123-8123-123456789abc",
      taskId: seededTaskId,
      kind: "draft",
      title: "Reviewed result",
      body: "Selected reviewed result. This is context, not external-action authority.",
      source: { evidenceIds: [] },
    });
    const selected = store.setResultSelected({
      operationId: "intent_47345678-1234-4123-8123-123456789abc",
      taskId: seededTaskId,
      resultId: result.resultId,
      expectedRevision: 1,
      selected: true,
    });
    const selectedResultContext = assembleTaskResultContext([selected]);
    await port.submit({
      type: "message",
      taskId: seededTaskId,
      operationId: "intent_52345678-1234-4123-8123-123456789abc",
      message: "Continue from the reviewed result",
      selectedResultContext,
    });
    expect(store.result(seededTaskId, result.resultId)).toMatchObject({
      selected: false,
      currentRevision: 1,
    });
    store.close();

    const reopened = new SqliteTaskEngineStore({ path });
    const [command] = await reopened.claimDueCommands(
      "worker_result_test",
      1,
      1,
    );
    expect(command?.payload.selectedResultContext).toEqual(
      selectedResultContext,
    );
    expect(reopened.result(seededTaskId, result.resultId)).toMatchObject({
      selected: false,
    });
    const consumption = new Database(path, { readonly: true });
    expect(
      consumption
        .prepare(
          "SELECT result_revision, result_digest FROM task_result_context_consumption WHERE task_id = ? AND result_id = ?",
        )
        .get(seededTaskId, result.resultId),
    ).toEqual({
      result_revision: 1,
      result_digest: selected.revision.digest,
    });
    consumption.close();
    reopened.close();
  });

  it("rolls back selected-result consumption before acceptance and between multiple selections", async () => {
    const beforeRoot = await mkdtemp(join(tmpdir(), "rove-result-before-cut-"));
    roots.push(beforeRoot);
    const beforeStore = new SqliteTaskEngineStore({
      path: join(beforeRoot, "task-engine.sqlite3"),
    });
    await seedReadyTask(beforeStore);
    const beforeSelected = createSelectedDraft(
      beforeStore,
      "before",
      "Keep selected before acceptance.",
    );
    const beforePort = new LedgerProductTaskPort({
      engine: new TaskEngine(beforeStore),
      store: beforeStore,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
      onCut: (point) => {
        if (point === "before_event_commit") throw new Error("before cut");
      },
    });
    await expect(
      beforePort.submit({
        type: "message",
        taskId: seededTaskId,
        operationId: "intent_71345678-1234-4123-8123-123456789abc",
        message: "Use the selected draft",
        selectedResultContext: assembleTaskResultContext([beforeSelected]),
      }),
    ).rejects.toThrow("before cut");
    expect(
      beforeStore.result(seededTaskId, beforeSelected.resultId),
    ).toMatchObject({ selected: true });
    beforeStore.close();

    const betweenRoot = await mkdtemp(
      join(tmpdir(), "rove-result-between-cut-"),
    );
    roots.push(betweenRoot);
    const betweenPath = join(betweenRoot, "task-engine.sqlite3");
    const betweenStore = new SqliteTaskEngineStore({
      path: betweenPath,
      onSelectedResultConsumption: ({ position }) => {
        if (position === 0) throw new Error("between selections cut");
      },
    });
    await seedReadyTask(betweenStore);
    const first = createSelectedDraft(
      betweenStore,
      "first",
      "First selected draft.",
    );
    const second = createSelectedDraft(
      betweenStore,
      "second",
      "Second selected draft.",
    );
    const betweenPort = new LedgerProductTaskPort({
      engine: new TaskEngine(betweenStore),
      store: betweenStore,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });
    await expect(
      betweenPort.submit({
        type: "message",
        taskId: seededTaskId,
        operationId: "intent_72345678-1234-4123-8123-123456789abc",
        message: "Use both selected drafts",
        selectedResultContext: assembleTaskResultContext([first, second]),
      }),
    ).rejects.toThrow("between selections cut");
    expect(betweenStore.result(seededTaskId, first.resultId)).toMatchObject({
      selected: true,
    });
    expect(betweenStore.result(seededTaskId, second.resultId)).toMatchObject({
      selected: true,
    });
    expect(
      await betweenStore.acceptedEvent(
        seededTaskId,
        "product:v2:message:intent_72345678-1234-4123-8123-123456789abc",
      ),
    ).toBeNull();
    betweenStore.close();
  });

  it("returns the original acceptance after a post-commit lost response and rejects conflicting retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-result-retry-cut-"));
    roots.push(root);
    const path = join(root, "task-engine.sqlite3");
    const store = new SqliteTaskEngineStore({ path });
    await seedReadyTask(store);
    const selected = createSelectedDraft(
      store,
      "retry",
      "Exact selected retry material.",
    );
    const selectedResultContext = assembleTaskResultContext([selected]);
    const operationId = "intent_73345678-1234-4123-8123-123456789abc";
    const port = new LedgerProductTaskPort({
      engine: new TaskEngine(store),
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
      onCut: (point) => {
        if (point === "after_commit_before_claim")
          throw new Error("lost acceptance response");
      },
    });
    await expect(
      port.submit({
        type: "message",
        taskId: seededTaskId,
        operationId,
        message: "Use exact selected material",
        selectedResultContext,
      }),
    ).rejects.toThrow("lost acceptance response");
    expect(store.result(seededTaskId, selected.resultId)).toMatchObject({
      selected: false,
    });
    store.close();

    const reopened = new SqliteTaskEngineStore({ path });
    const retryPort = new LedgerProductTaskPort({
      engine: new TaskEngine(reopened),
      store: reopened,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });
    await expect(
      retryPort.acceptedTaskMessage({
        taskId: seededTaskId,
        operationId,
        message: "Use exact selected material",
        attachmentIds: [],
        selectedResultIds: [selected.resultId],
      }),
    ).resolves.toMatchObject({ duplicate: true });
    await expect(
      retryPort.acceptedTaskMessage({
        taskId: seededTaskId,
        operationId,
        message: "Changed retry material",
        attachmentIds: [],
        selectedResultIds: [selected.resultId],
      }),
    ).rejects.toThrow(/reused with different input/i);
    reopened.close();
  });

  it("rejects acceptance when the selected revision changes concurrently", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-result-concurrent-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "task-engine.sqlite3"),
    });
    await seedReadyTask(store);
    const selected = createSelectedDraft(
      store,
      "concurrent",
      "Initially selected revision.",
    );
    const staleContext = assembleTaskResultContext([selected]);
    const revised = store.reviseDraft({
      operationId: "result-revise-concurrent",
      taskId: seededTaskId,
      resultId: selected.resultId,
      expectedRevision: 1,
      title: "Reviewed concurrent",
      body: "Newly selected revision.",
    });
    store.setResultSelected({
      operationId: "result-reselect-concurrent",
      taskId: seededTaskId,
      resultId: selected.resultId,
      expectedRevision: revised.currentRevision,
      selected: true,
    });
    const port = new LedgerProductTaskPort({
      engine: new TaskEngine(store),
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });
    await expect(
      port.submit({
        type: "message",
        taskId: seededTaskId,
        operationId: "intent_74345678-1234-4123-8123-123456789abc",
        message: "Use stale selected material",
        selectedResultContext: staleContext,
      }),
    ).rejects.toThrow(/changed before task acceptance/i);
    expect(store.result(seededTaskId, selected.resultId)).toMatchObject({
      selected: true,
      selectedRevision: { revision: 2 },
    });
    expect(
      await store.acceptedEvent(
        seededTaskId,
        "product:v2:message:intent_74345678-1234-4123-8123-123456789abc",
      ),
    ).toBeNull();
    store.close();
  });

  it("rejects selected-result provenance that targets another task", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-result-task-boundary-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "task-engine.sqlite3"),
    });
    await seedReadyTask(store);
    const port = new LedgerProductTaskPort({
      engine: new TaskEngine(store),
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });
    await expect(
      port.submit({
        type: "message",
        taskId: seededTaskId,
        operationId: "intent_62345678-1234-4123-8123-123456789abc",
        message: "Continue from the selected result",
        selectedResultContext: {
          resultIds: ["result_reviewed"],
          references: [
            {
              taskId: "task_other",
              resultId: "result_reviewed",
              revision: 2,
              digest: "d".repeat(64),
              lifecycle: "prepared",
            },
          ],
          digest: "e".repeat(64),
          workingContext: "Selected reviewed result.",
        },
      }),
    ).rejects.toThrow(/targets another task/i);
    store.close();
  });

  it("persists the accepted archive as a Rove history preference across restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-history-archive-"));
    roots.push(root);
    const path = join(root, "task-engine.sqlite3");
    const store = new SqliteTaskEngineStore({ path });
    await seedReadyTask(store);
    const aggregateBefore = await store.aggregate(seededTaskId);
    const engine = new TaskEngine(store);
    const accept = vi.spyOn(engine, "accept");
    const port = new LedgerProductTaskPort({
      engine,
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });

    expect((await port.readTask(seededTaskId))?.capabilities).toMatchObject({
      canArchive: true,
      canRetry: false,
    });
    await port.submit({
      type: "archive",
      taskId: seededTaskId,
      operationId: "intent_32345678-1234-4123-8123-123456789abc",
    });
    expect(accept).not.toHaveBeenCalled();
    expect(await store.aggregate(seededTaskId)).toEqual(aggregateBefore);
    store.close();

    const reopened = new SqliteTaskEngineStore({ path });
    const restartedPort = new LedgerProductTaskPort({
      engine: {} as never,
      store: reopened,
      worker: {} as never,
    });
    const [task] = await restartedPort.productTasks();
    expect(task?.conversation?.archived).toBe(true);
    expect(task?.capabilities.canArchive).toBe(false);
    reopened.close();
  });

  it("changes local organization without replacing an uncertain execution fence", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-history-fence-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "task-engine.sqlite3"),
    });
    await seedReadyTask(store);
    await store.markRecoveryRequired(
      seededTaskId,
      "The exact prior message may have been submitted.",
    );
    const fenced = await store.aggregate(seededTaskId);
    const engine = new TaskEngine(store);
    const accept = vi.spyOn(engine, "accept");
    const signal = vi.fn();
    const port = new LedgerProductTaskPort({
      engine,
      store,
      worker: { signal, cancelTask: vi.fn() } as never,
    });

    const archived = await port.submit({
      type: "archive",
      taskId: seededTaskId,
      operationId: "intent_72345678-1234-4123-8123-123456789abc",
    });
    expect(archived.projection.operationDisposition).toMatchObject({
      type: "archive",
      status: "accepted",
    });
    expect(await store.aggregate(seededTaskId)).toEqual(fenced);
    expect(store.taskHistoryArchived(seededTaskId)).toBe(true);

    const restored = await port.submit({
      type: "unarchive",
      taskId: seededTaskId,
      operationId: "intent_82345678-1234-4123-8123-123456789abc",
    });
    expect(restored.projection.operationDisposition).toMatchObject({
      type: "resume",
      status: "accepted",
    });
    expect(await store.aggregate(seededTaskId)).toEqual(fenced);
    expect(store.taskHistoryArchived(seededTaskId)).toBe(false);
    expect(accept).not.toHaveBeenCalled();
    expect(signal).not.toHaveBeenCalled();
    store.close();
  });

  it("replays exact local organization receipts and rejects conflicting operation reuse", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-history-operation-"));
    roots.push(root);
    const path = join(root, "task-engine.sqlite3");
    const store = new SqliteTaskEngineStore({ path });
    await seedReadyTask(store);
    const port = new LedgerProductTaskPort({
      engine: new TaskEngine(store),
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });
    const archiveOperationId = "intent_b2345678-1234-4123-8123-123456789abc";

    expect(
      await port.submit({
        type: "archive",
        taskId: seededTaskId,
        operationId: archiveOperationId,
      }),
    ).toMatchObject({ duplicate: false });
    await port.submit({
      type: "unarchive",
      taskId: seededTaskId,
      operationId: "intent_c2345678-1234-4123-8123-123456789abc",
    });
    store.close();

    const reopened = new SqliteTaskEngineStore({ path });
    const restartedEngine = new TaskEngine(reopened);
    const restartedPort = new LedgerProductTaskPort({
      engine: restartedEngine,
      store: reopened,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });
    await restartedEngine.accept({
      schemaVersion: 1,
      type: "codex_turn_observed",
      eventId: "codex:active-after-local-restore",
      taskId: seededTaskId,
      source: {
        kind: "codex",
        id: "codex:active-after-local-restore",
        generation: 3,
        position: 1,
      },
      observedAt: "2026-09-09T12:00:03.000Z",
      threadId: "thread_seeded",
      turn: {
        turnId: "turn_after_restore",
        turn: "active",
        runtimeStatus: "active",
      },
    });
    expect(
      await restartedPort.submit({
        type: "archive",
        taskId: seededTaskId,
        operationId: archiveOperationId,
      }),
    ).toMatchObject({ duplicate: true });
    expect(reopened.taskHistoryArchived(seededTaskId)).toBe(false);
    await expect(
      restartedPort.submit({
        type: "unarchive",
        taskId: seededTaskId,
        operationId: archiveOperationId,
      }),
    ).rejects.toThrow(
      "Task history operation identity was reused with different content",
    );
    expect(reopened.taskHistoryArchived(seededTaskId)).toBe(false);
    reopened.close();
  });

  it("archives locally while resource cleanup is still converging", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-history-cleanup-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "task-engine.sqlite3"),
    });
    await seedReadyTask(store);
    const engine = new TaskEngine(store);
    const cleanup = await engine.accept({
      schemaVersion: 1,
      type: "task_finish_requested",
      eventId: "internal:cleanup:requested",
      taskId: seededTaskId,
      source: {
        kind: "product",
        id: "internal:cleanup:requested",
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-09T12:00:02.000Z",
      operationId: "intent_92345678-1234-4123-8123-123456789abc",
    });
    expect(cleanup.command).not.toBeNull();
    const cleanupAggregate = await store.aggregate(seededTaskId);
    const port = new LedgerProductTaskPort({
      engine,
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });

    const archived = await port.submit({
      type: "archive",
      taskId: seededTaskId,
      operationId: "intent_a2345678-1234-4123-8123-123456789abc",
    });

    expect(archived.projection.operationDisposition).toMatchObject({
      type: "archive",
      status: "accepted",
    });
    expect(await store.aggregate(seededTaskId)).toEqual(cleanupAggregate);
    expect(store.taskHistoryArchived(seededTaskId)).toBe(true);
    store.close();
  });

  it("keeps local history visible and restore/message usable without a provider thread", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-absent-thread-archive-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "task-engine.sqlite3"),
    });
    await seedReadyTask(store);
    const engine = new TaskEngine(store);
    await engine.accept({
      schemaVersion: 1,
      type: "codex_thread_observed",
      eventId: "codex:historical-thread-absent",
      taskId: seededTaskId,
      source: {
        kind: "codex",
        id: "codex:historical-thread-absent",
        generation: 2,
        position: 1,
      },
      observedAt: "2026-09-09T12:00:01.000Z",
      thread: {
        availability: "available",
        threadExists: false,
        sourceLookup: "none",
        runtimeStatus: "notLoaded",
        archived: null,
        turn: "none",
      },
    });
    const port = new LedgerProductTaskPort({
      engine,
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });

    const [task] = await port.productTasks();

    expect(task).toBeDefined();
    expect(task!.conversation?.archived).toBe(false);
    expect(task!.availableActions).toContain("archive");
    expect((await store.aggregate(seededTaskId))?.codex).toMatchObject({
      threadExists: false,
      archived: null,
    });

    await port.submit({
      type: "archive",
      taskId: seededTaskId,
      operationId: "intent_42345678-1234-4123-8123-123456789abc",
    });
    expect((await port.readTask(seededTaskId))?.conversation?.archived).toBe(
      true,
    );
    await port.submit({
      type: "unarchive",
      taskId: seededTaskId,
      operationId: "intent_52345678-1234-4123-8123-123456789abc",
    });
    expect((await port.readTask(seededTaskId))?.conversation?.archived).toBe(
      false,
    );
    const later = await port.submit({
      type: "message",
      taskId: seededTaskId,
      operationId: "intent_62345678-1234-4123-8123-123456789abc",
      message: "Continue with a new provider association if needed.",
    });
    expect(later).toMatchObject({
      projection: { operationDisposition: { status: "accepted" } },
      command: { type: "prepare_codex_reassociation" },
    });
    expect(later.aggregate.conversation.items).toEqual({
      "user:intent_62345678-1234-4123-8123-123456789abc":
        expect.objectContaining({
          text: "Continue with a new provider association if needed.",
        }),
    });
    expect(
      later.aggregate.conversation.items[
        "user:intent_62345678-1234-4123-8123-123456789abc"
      ]?.turnId,
    ).toBeUndefined();
    store.close();
  });

  it("does not derive local archive from provider archival and rejects archive during an active turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-provider-archive-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "task-engine.sqlite3"),
    });
    await seedReadyTask(store);
    const engine = new TaskEngine(store);
    await engine.accept({
      schemaVersion: 1,
      type: "codex_thread_observed",
      eventId: "codex:provider-archived-active",
      taskId: seededTaskId,
      source: {
        kind: "codex",
        id: "codex:provider-archived-active",
        generation: 2,
        position: 1,
      },
      observedAt: "2026-09-09T12:00:01.000Z",
      thread: {
        availability: "available",
        threadExists: true,
        threadId: "thread_seeded",
        threadSource: `rove:${seededTaskId}:${seededBootstrapId}`,
        sourceLookup: "exact",
        runtimeStatus: "active",
        archived: true,
        turn: "active",
        turnId: "turn_active",
      },
    });
    const port = new LedgerProductTaskPort({
      engine,
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });

    expect((await port.readTask(seededTaskId))?.conversation?.archived).toBe(
      false,
    );
    expect((await port.readTask(seededTaskId))?.availableActions).not.toContain(
      "archive",
    );
    expect((await port.readTask(seededTaskId))?.capabilities.canArchive).toBe(
      false,
    );
    await expect(
      port.submit({
        type: "archive",
        taskId: seededTaskId,
        operationId: "intent_72345678-1234-4123-8123-123456789abc",
      }),
    ).rejects.toThrow("Stop the current work before archiving this task");
    store.close();
  });

  it("routes legacy-effect acknowledgement from IPC through the product projection and durable ledger", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-legacy-product-route-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "task-engine.sqlite3"),
    });
    await seedReadyTask(store, {
      legacyEffects: "acknowledgement_required",
    });
    const engine = new TaskEngine(store);
    const port = new LedgerProductTaskPort({
      engine,
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });
    const journal = new FileEffectJournalStore(join(root, "effect-journal"));
    await journal.establishCutover(
      "phase5-effect-journal-v1",
      "2026-09-09T12:00:00.000Z",
      [`task:${seededBootstrapId}`, `workspace:${seededSessionId}`],
    );
    const acknowledgeLegacyEffectScope = vi.fn(async (sessionId: string) => {
      expect(sessionId).toBe(seededSessionId);
      await journal.acknowledgeLegacyScope(
        `task:${seededBootstrapId}`,
        "2026-09-09T12:00:01.000Z",
      );
      await journal.acknowledgeLegacyScope(
        `workspace:${seededSessionId}`,
        "2026-09-09T12:00:01.000Z",
      );
      await engine.accept({
        schemaVersion: 1,
        type: "runtime_inventory_observed",
        eventId: "runtime:legacy-acknowledged",
        taskId: seededTaskId,
        source: {
          kind: "runtime",
          id: "runtime:seeded-product-route",
          generation: 1,
          position: 2,
        },
        observedAt: "2026-09-09T12:00:02.000Z",
        runtime: {
          ...(await store.aggregate(seededTaskId))!.runtime,
          legacyEffects: "acknowledged",
        },
      });
    });
    const authorizeEffectRepetition = vi.fn(
      async (sessionId: string, effectId: string) => ({
        sessionId,
        effectId,
        authorizationId: "effect_repeat_12345678-1234-4123-8123-123456789abc",
      }),
    );
    const api = new LocalProductApi(
      () => ({
        state: "ready",
        ready: true,
        restartAttempt: 0,
        stderrTail: [],
      }),
      {
        snapshot: () => ({
          account: { status: "logged_in", authMode: "chatgpt" },
          models: [],
          rateLimits: null,
          usage: null,
          refreshedAt: "2026-09-09T12:00:00.000Z",
        }),
      } as never,
      port,
      {},
      new OrderedAttentionQueue(),
      "/isolated/task-workspace",
      () => [],
      undefined,
      undefined,
      { acknowledgeLegacyEffectScope, authorizeEffectRepetition },
    );
    const publish = vi.fn(async () => undefined);
    const ipc = createProductIntentIpcHandler(() => api, publish);

    const restricted = (await api.readSnapshot()).tasks.find(
      (task) => task.taskId === seededTaskId,
    );
    expect(restricted?.availableActions).toContain(
      "acknowledge_legacy_effects",
    );

    await ipc({}, { type: "task.effects.acknowledge", taskId: seededTaskId });

    expect(acknowledgeLegacyEffectScope).toHaveBeenCalledOnce();
    await expect(
      ipc(
        {},
        {
          type: "task.effects.authorize-repeat",
          taskId: seededTaskId,
          effectId: "a".repeat(64),
        },
      ),
    ).resolves.toMatchObject({
      sessionId: seededSessionId,
      effectId: "a".repeat(64),
    });
    expect(authorizeEffectRepetition).toHaveBeenCalledWith(
      seededSessionId,
      "a".repeat(64),
    );
    await expect(
      ipc(
        {},
        {
          type: "task.effects.authorize-repeat",
          taskId: seededTaskId,
          effectId: "a".repeat(64),
          authorizationId: "caller-cannot-supply-this",
        },
      ),
    ).rejects.toThrow("unsupported field");
    expect(publish).toHaveBeenCalledTimes(2);
    expect((await store.aggregate(seededTaskId))?.runtime.legacyEffects).toBe(
      "acknowledged",
    );
    expect(
      (await api.readSnapshot()).tasks.find(
        (task) => task.taskId === seededTaskId,
      )?.availableActions,
    ).not.toContain("acknowledge_legacy_effects");
    expect((await journal.cutover())?.legacyScopes).toMatchObject({
      [`task:${seededBootstrapId}`]: {
        acknowledgedAt: "2026-09-09T12:00:01.000Z",
      },
      [`workspace:${seededSessionId}`]: {
        acknowledgedAt: "2026-09-09T12:00:01.000Z",
      },
    });
    expect((await store.aggregate(seededTaskId))?.desiredState).toBe("open");
    expect((await store.aggregate(seededTaskId))?.requestedOperation).toEqual({
      type: "observe",
      taskId: seededTaskId,
    });
    expect(await store.claimDueCommands("ack-probe", 2, 8)).toEqual([]);

    await expect(
      ipc({}, { type: "task.effects.acknowledge", taskId: seededTaskId }),
    ).rejects.toThrow("not available");
    await expect(
      ipc(
        {},
        {
          type: "task.effects.acknowledge",
          taskId: "task_ffffffff-ffff-4fff-8fff-ffffffffffff",
        },
      ),
    ).rejects.toThrow("not found");
    expect(acknowledgeLegacyEffectScope).toHaveBeenCalledOnce();
    store.close();
  });

  it("accepts same-task Finish while its external command is held and cancels only that wait", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-urgent-task-control-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "task-engine.sqlite3"),
    });
    const heldCommand: TaskCommand = {
      schemaVersion: 1,
      commandId: "command:held-same-task-read",
      taskId: seededTaskId,
      aggregateRevision: 1,
      type: "read_lifecycle_truth",
      payload: { type: "read_lifecycle_truth", taskId: seededTaskId },
      classification: { execute: "repeatable_read", reconcile: "read_truth" },
      status: "pending",
      attempts: 0,
      createdAt: "2026-09-09T12:00:00.000Z",
    };
    await seedReadyTask(store, { command: heldCommand });
    const engine = new TaskEngine(store);
    const execute = vi.fn(() => new Promise<never>(() => undefined));
    const onTaskWaitCancelled = vi.fn(async () => undefined);
    const worker = new TaskEngineWorker({
      engine,
      store,
      adapter: { execute, reconcile: vi.fn() },
      onTaskWaitCancelled,
      maximumConcurrentTasks: 4,
    });
    const port = new LedgerProductTaskPort({
      engine,
      store,
      worker: {
        cancelTask: (taskId: string) => worker.cancelTask(taskId),
        signal: vi.fn(),
      } as never,
      now: () => "2026-09-09T12:00:01.000Z",
    });

    const running = worker.runUntilIdle();
    for (
      let attempt = 0;
      attempt < 50 && execute.mock.calls.length === 0;
      attempt += 1
    )
      await new Promise((resolve) => setTimeout(resolve, 1));
    expect(execute).toHaveBeenCalledOnce();

    const accepted = await port.submit({
      type: "finish",
      taskId: seededTaskId,
      operationId: "intent_22345678-1234-4123-8123-123456789abc",
    });
    await running;

    expect(accepted.duplicate).toBe(false);
    expect(accepted.aggregate.requestedOperation.type).toBe("finish");
    expect(onTaskWaitCancelled).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: seededTaskId,
        commandId: heldCommand.commandId,
      }),
    );
    expect((await store.aggregate(seededTaskId))?.requestedOperation).toEqual(
      expect.objectContaining({ type: "finish" }),
    );
    expect((await store.aggregate(seededTaskId))?.desiredState).toBe("open");
    store.close();
  });

  it("uses distinct ledger producer identities for Finish and its cleanup retry", async () => {
    const accept = vi.fn(async (event) => ({
      duplicate: false,
      aggregate: { taskId: event.taskId },
      projection: {},
      command: null,
    }));
    const cancelTask = vi.fn();
    const port = new LedgerProductTaskPort({
      engine: { accept } as never,
      store: { aggregate: vi.fn(async () => null) } as never,
      worker: { signal: vi.fn(), cancelTask } as never,
      now: () => "2026-09-09T12:00:00.000Z",
    });
    const operationId = "intent_12345678-1234-4123-8123-123456789abc";
    const taskId = "task_12345678-1234-4123-8123-123456789abc";

    await port.submit({ type: "finish", taskId, operationId });
    await port.submit({ type: "retry_cleanup", taskId, operationId });

    expect(accept.mock.calls.map(([event]) => event.eventId)).toEqual([
      `product:v2:finish:${operationId}`,
      `product:v2:retry_cleanup:${operationId}`,
    ]);
    expect(accept.mock.calls.map(([event]) => event.source.id)).toEqual([
      `operation:v2:finish:${operationId}`,
      `operation:v2:retry_cleanup:${operationId}`,
    ]);
    expect(cancelTask).toHaveBeenCalledTimes(2);
  });

  it("does not signal execution when restoring local history", async () => {
    const aggregate = emptyTaskAggregate(
      "task_12345678-1234-4123-8123-123456789abc",
    );
    const cancelTask = vi.fn();
    const signal = vi.fn();
    const port = new LedgerProductTaskPort({
      engine: { accept: vi.fn() } as never,
      store: {
        aggregate: vi.fn(async () => aggregate),
        taskHistoryArchived: vi.fn(() => true),
        applyTaskHistoryPreference: vi.fn(() => ({
          duplicate: false,
          archived: false,
        })),
      } as never,
      worker: { signal, cancelTask } as never,
      now: () => "2026-09-09T12:00:00.000Z",
    });

    await port.submit({
      type: "unarchive",
      taskId: "task_12345678-1234-4123-8123-123456789abc",
      operationId: "intent_12345678-1234-4123-8123-123456789abc",
    });

    expect(cancelTask).not.toHaveBeenCalled();
    expect(signal).not.toHaveBeenCalled();
  });

  it("lets archive state changes proceed independently of execution acceptance", async () => {
    const taskId = "task_12345678-1234-4123-8123-123456789abc";
    const aggregate = emptyTaskAggregate(taskId);
    const accept = vi.fn(() => {
      throw new Error("execution acceptance must not be consulted");
    });
    const cancelTask = vi.fn();
    const applyTaskHistoryPreference = vi.fn(
      (input: { archived: boolean }) => ({
        duplicate: false,
        archived: input.archived,
      }),
    );
    const port = new LedgerProductTaskPort({
      engine: { accept } as never,
      store: {
        aggregate: vi.fn(async () => aggregate),
        taskHistoryArchived: vi.fn(() => false),
        applyTaskHistoryPreference,
      } as never,
      worker: { signal: vi.fn(), cancelTask } as never,
      now: () => "2026-09-09T12:00:00.000Z",
    });

    await port.submit({
      type: "unarchive",
      taskId,
      operationId: "intent_12345678-1234-4123-8123-123456789abc",
    });
    await port.submit({
      type: "archive",
      taskId,
      operationId: "intent_22345678-1234-4123-8123-123456789abc",
    });

    expect(cancelTask).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
    expect(applyTaskHistoryPreference).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ taskId, archived: false }),
    );
    expect(applyTaskHistoryPreference).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ taskId, archived: true }),
    );
  });

  it("freezes a host-owned per-task cwd and ignores the caller cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-task-workspaces-"));
    roots.push(root);
    const taskWorkspaceRoot = join(root, "task-workspaces");
    const store = new SqliteTaskEngineStore({
      path: join(root, "protected-product", "task-engine.sqlite3"),
    });
    const engine = new TaskEngine(store);
    const port = new LedgerProductTaskPort({
      engine,
      store,
      worker: { signal: vi.fn() } as never,
      taskWorkspaceRoot,
      now: () => "2026-09-09T12:00:00.000Z",
    });
    const operationId = "intent_12345678-1234-4123-8123-123456789abc";

    const accepted = await port.submit({
      type: "launch",
      operationId,
      outcome: "Use the protected task workspace.",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      approvalsReviewer: "auto_review",
      cwd: "/caller/controlled/path",
      attachmentIds: [],
    });

    const expected = join(taskWorkspaceRoot, accepted.aggregate.taskId);
    expect(accepted.aggregate.launch?.cwd).toBe(expected);
    expect((await stat(expected)).mode & 0o777).toBe(0o700);
    expect(
      accepted.aggregate.conversation.items[`user:${operationId}`],
    ).toMatchObject({
      text: "Use the protected task workspace.",
      clientId: operationId,
    });
    expect(
      accepted.aggregate.conversation.items[`user:${operationId}`]?.turnId,
    ).toBeUndefined();

    await engine.accept({
      schemaVersion: 1,
      type: "runtime_inventory_observed",
      eventId: "runtime:awaiting-handoff",
      taskId: accepted.aggregate.taskId,
      source: {
        kind: "runtime",
        id: "runtime:awaiting-handoff",
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-09T12:00:01.000Z",
      runtime: {
        availability: "available",
        sessionExists: true,
        sessionId: `ses_${"a".repeat(32)}`,
        bootstrapId: accepted.aggregate.launch!.bootstrapId,
        bootstrapLookup: "exact",
        status: "awaiting_human",
        controller: null,
        attachment: "attached",
        profileLock: "released",
        browserIdentity: { mode: "temporary" },
        recovery: "not_needed",
        legacyEffects: "acknowledgement_required",
        ownershipGeneration: 2,
        handoffId: `handoff_${"b".repeat(32)}`,
        handoffGeneration: 2,
        observationSeq: 3,
      },
    });
    expect((await port.productTasks())[0]?.runtime).toEqual({
      status: "awaiting_human",
      controller: null,
      attachment: "attached",
      recovery: "not_needed",
      profileOwnership: "released",
      legacyEffects: "acknowledgement_required",
      handoffActionable: false,
      handoffGeneration: 2,
    });
    expect((await port.productTasks())[0]?.availableActions).toContain(
      "acknowledge_legacy_effects",
    );
    store.close();
  });

  it("projects customer controls independently before a provider turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-task-capabilities-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "task-engine.sqlite3"),
    });
    const operationId = "intent_62345678-1234-4123-8123-123456789abc";
    await seedReadyTask(store, {
      mutate: (aggregate) => {
        aggregate.codex.turn = "none";
        aggregate.conversation.items = {
          [`user:${operationId}`]: {
            id: `user:${operationId}`,
            clientId: operationId,
            acceptedAt: "2026-09-09T12:00:00.000Z",
            kind: "user_message",
            status: "completed",
            text: "Accepted before provider turn creation.",
          },
        };
        aggregate.conversation.itemOrder = [`user:${operationId}`];
        aggregate.messageDeliveries = {
          [operationId]: {
            operationId,
            state: "dispatch_not_started",
            observedAt: "2026-09-09T12:00:00.000Z",
            threadId: "thread_seeded",
            connectionGeneration: 1,
          },
        };
      },
    });
    const worker = { signal: vi.fn(), cancelTask: vi.fn() };
    const port = new LedgerProductTaskPort({
      engine: new TaskEngine(store),
      store,
      worker: worker as never,
    });

    const beforeTurn = await port.readTask(seededTaskId);
    expect(beforeTurn?.capabilities).toMatchObject({
      canSubmit: false,
      canQueue: false,
      canSteer: false,
      canStop: true,
    });
    expect(beforeTurn?.availableActions).not.toContain("finish");

    const stopped = await port.submit({
      type: "interrupt",
      taskId: seededTaskId,
      operationId: "intent_72345678-1234-4123-8123-123456789abc",
    });
    expect(stopped.projection.operationDisposition).toMatchObject({
      type: "interrupt",
      status: "accepted",
    });
    expect(stopped.command).toBeNull();
    expect(worker.cancelTask).toHaveBeenCalledWith(seededTaskId);
    expect((await port.readTask(seededTaskId))?.capabilities.canStop).toBe(
      false,
    );
    store.close();
  });

  it("retains safe Stop through recovery without exposing diagnostics as attention", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-recovery-controls-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "task-engine.sqlite3"),
    });
    const operationId = "intent_82345678-1234-4123-8123-123456789abc";
    await seedReadyTask(store, {
      mutate: (aggregate) => {
        aggregate.codex.turn = "active";
        aggregate.codex.turnId = "turn_recovering";
        aggregate.codex.runtimeStatus = "active";
        aggregate.recoveryRequired =
          "Codex external truth requires authoritative reconciliation.";
        aggregate.conversation.items = {
          [`user:${operationId}`]: {
            id: `user:${operationId}`,
            clientId: operationId,
            acceptedAt: "2026-09-09T12:00:00.000Z",
            turnId: "turn_recovering",
            kind: "user_message",
            status: "completed",
            text: "Keep this accepted work interruptible.",
          },
        };
        aggregate.conversation.itemOrder = [`user:${operationId}`];
        aggregate.messageDeliveries = {
          [operationId]: {
            operationId,
            state: "message_materialized",
            observedAt: "2026-09-09T12:00:00.000Z",
            turnId: "turn_recovering",
            threadId: "thread_seeded",
            connectionGeneration: 1,
          },
        };
      },
    });
    const port = new LedgerProductTaskPort({
      engine: new TaskEngine(store),
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });

    const task = await port.readTask(seededTaskId);
    expect(task?.lifecycle).toEqual({
      phase: "recovering",
      reason: "Checking task state.",
    });
    expect(task?.capabilities).toMatchObject({
      canStop: true,
      canRespond: false,
    });
    expect(task?.availableActions).toContain("interrupt");
    expect(task?.lifecycle.reason).not.toContain(
      "authoritative reconciliation",
    );
    expect(
      projectTaskAggregate((await store.aggregate(seededTaskId))!).attention,
    ).toBeNull();
    const stopped = await port.submit({
      type: "interrupt",
      taskId: seededTaskId,
      operationId: "intent_92345678-1234-4123-8123-123456789abc",
    });
    expect(stopped.command).toMatchObject({
      type: "interrupt_codex_turn",
      payload: { turnId: "turn_recovering" },
    });
    store.close();
  });
});
