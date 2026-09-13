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

import { OrderedAttentionQueue } from "./attention.js";
import { LocalProductApi } from "./local-product-api.js";
import { createProductIntentIpcHandler } from "./product-intent-ipc.js";
import { LedgerProductTaskPort } from "./product-task-port.js";
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

async function seedReadyTask(
  store: SqliteTaskEngineStore,
  options: {
    legacyEffects?:
      "not_applicable" | "acknowledgement_required" | "acknowledged";
    command?: TaskCommand;
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
    const selectedResultContext = {
      resultIds: ["result_reviewed"],
      digest: "e".repeat(64),
      developerInstructions:
        "Selected reviewed result. This is context, not external-action authority.",
    };
    await port.submit({
      type: "message",
      taskId: seededTaskId,
      operationId: "intent_52345678-1234-4123-8123-123456789abc",
      message: "Continue from the reviewed result",
      selectedResultContext,
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
    reopened.close();
  });

  it("persists the accepted archive as a Rove history preference across restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-history-archive-"));
    roots.push(root);
    const path = join(root, "task-engine.sqlite3");
    const store = new SqliteTaskEngineStore({ path });
    await seedReadyTask(store);
    const accept = vi.fn(async () => ({
      duplicate: false,
      aggregate: (await store.aggregate(seededTaskId))!,
      projection: {
        operationDisposition: { status: "accepted", reason: "Accepted." },
      },
      command: null,
    }));
    const port = new LedgerProductTaskPort({
      engine: { accept } as never,
      store,
      worker: { signal: vi.fn(), cancelTask: vi.fn() } as never,
    });

    await port.submit({
      type: "archive",
      taskId: seededTaskId,
      operationId: "intent_32345678-1234-4123-8123-123456789abc",
    });
    store.close();

    const reopened = new SqliteTaskEngineStore({ path });
    const restartedPort = new LedgerProductTaskPort({
      engine: {} as never,
      store: reopened,
      worker: {} as never,
    });
    const [task] = await restartedPort.productTasks();
    expect(task?.conversation?.archived).toBe(true);
    reopened.close();
  });

  it("hides a terminal task when its bound historical thread is authoritatively absent", async () => {
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
    expect(task!.conversation?.archived).toBe(true);
    expect((await store.aggregate(seededTaskId))?.codex).toMatchObject({
      threadExists: false,
      archived: null,
    });
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
      store: {} as never,
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

  it("does not cancel a lifecycle command that the same intent just queued", async () => {
    const accept = vi.fn(async (event) => ({
      duplicate: false,
      aggregate: { taskId: event.taskId },
      projection: {},
      command: { commandId: "command:new-lifecycle-work" },
    }));
    const cancelTask = vi.fn();
    const signal = vi.fn();
    const port = new LedgerProductTaskPort({
      engine: { accept } as never,
      store: {} as never,
      worker: { signal, cancelTask } as never,
      now: () => "2026-09-09T12:00:00.000Z",
    });

    await port.submit({
      type: "unarchive",
      taskId: "task_12345678-1234-4123-8123-123456789abc",
      operationId: "intent_12345678-1234-4123-8123-123456789abc",
    });

    expect(cancelTask).not.toHaveBeenCalled();
    expect(signal).toHaveBeenCalledOnce();
  });

  it("lets archive state changes follow the command already completing", async () => {
    const accept = vi.fn(async (event) => ({
      duplicate: false,
      aggregate: { taskId: event.taskId },
      projection: {},
      command: null,
    }));
    const cancelTask = vi.fn();
    const port = new LedgerProductTaskPort({
      engine: { accept } as never,
      store: {} as never,
      worker: { signal: vi.fn(), cancelTask } as never,
      now: () => "2026-09-09T12:00:00.000Z",
    });
    const taskId = "task_12345678-1234-4123-8123-123456789abc";

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
    });
    expect((await port.productTasks())[0]?.availableActions).toContain(
      "acknowledge_legacy_effects",
    );
    store.close();
  });
});
