import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { TaskEngine, type TaskEvent } from "@rove/protocol";

import { SqliteTaskEngineStore } from "./sqlite-task-engine-store.js";
import { OrderedTaskIngress } from "./ordered-task-ingress.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rove-task-engine-"));
  roots.push(root);
  const path = join(root, "task.sqlite3");
  const store = new SqliteTaskEngineStore({ path });
  return { path, store, engine: new TaskEngine(store) };
}

function launch(): Extract<TaskEvent, { type: "task_launch_requested" }> {
  const operationId = "intent_12345678-1234-4123-8123-123456789abc";
  return {
    schemaVersion: 1,
    type: "task_launch_requested",
    eventId: `product:${operationId}`,
    taskId: "task_12345678-1234-4123-8123-123456789abc",
    source: { kind: "product", id: "test", generation: 1, position: 1 },
    observedAt: "2026-09-09T12:00:00.000Z",
    operationId,
    launch: {
      operationId,
      bootstrapId: "boot_1234567890abcdef1234567890abcdef",
      requestedAt: "2026-09-09T12:00:00.000Z",
      outcome: "Open the example",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      approvalsReviewer: "auto_review",
      cwd: "/tmp/rove",
      attachmentIds: [],
    },
  };
}

describe("SQLite task engine ledger", () => {
  it("advances host generations durably across process replacement", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-host-generation-"));
    roots.push(root);
    const path = join(root, "task.sqlite3");
    const first = new SqliteTaskEngineStore({ path });
    expect(first.nextHostGeneration("codex")).toBe(1);
    expect(first.nextHostGeneration("runtime")).toBe(1);
    first.close();
    const reopened = new SqliteTaskEngineStore({ path });
    expect(reopened.nextHostGeneration("codex")).toBe(2);
    expect(reopened.nextHostGeneration("runtime")).toBe(2);
    reopened.close();
  });

  it("commits event, aggregate, projection and one command atomically", async () => {
    const { store, engine } = await fixture();
    const accepted = await engine.accept(launch());
    expect(accepted.aggregate.revision).toBe(1);
    expect(accepted.command?.type).toBe("persist_bootstrap_intent");
    expect(await store.projection(accepted.aggregate.taskId)).toEqual(
      accepted.projection,
    );
    store.close();
  });

  it("deduplicates identical input and rejects changed reuse", async () => {
    const { store, engine } = await fixture();
    const first = launch();
    await engine.accept(first);
    expect((await engine.accept(structuredClone(first))).duplicate).toBe(true);
    expect(
      (
        await engine.accept({
          ...structuredClone(first),
          observedAt: "2026-09-09T12:05:00.000Z",
          launch: {
            ...structuredClone(first.launch),
            requestedAt: "2026-09-09T12:05:00.000Z",
          },
        })
      ).duplicate,
    ).toBe(true);
    await expect(
      engine.accept({
        ...first,
        launch: { ...first.launch, outcome: "Changed" },
      } as TaskEvent),
    ).rejects.toThrow(/different content/);
    store.close();
  });

  it("reconciles an accepted source coordinate before SQLite persistence", async () => {
    const { path, store, engine } = await fixture();
    const first = launch();
    const accepted = await engine.accept(first);
    expect(accepted).toMatchObject({
      duplicate: false,
      aggregate: { revision: 1 },
      command: { type: "persist_bootstrap_intent" },
    });

    const recovered = await engine.accept({
      ...structuredClone(first),
      eventId: "recovered-with-a-new-transport-identity",
      observedAt: "2026-09-09T12:05:00.000Z",
      launch: {
        ...structuredClone(first.launch),
        requestedAt: "2026-09-09T12:05:00.000Z",
      },
    });
    expect(recovered).toEqual({ ...accepted, duplicate: true });

    const failures: string[] = [];
    const ingress = new OrderedTaskIngress(engine, (error) => {
      failures.push(error.message);
    });
    ingress.replaceGeneration(1);
    await ingress.enqueue(1, {
      ...structuredClone(first),
      eventId: "another-recovered-transport-identity",
      observedAt: "2026-09-09T12:10:00.000Z",
      launch: {
        ...structuredClone(first.launch),
        requestedAt: "2026-09-09T12:10:00.000Z",
      },
    });

    expect(failures).toEqual([]);
    expect(ingress.state()).toMatchObject({
      accepted: 1,
      recoveryRequired: null,
    });
    expect(await store.aggregate(first.taskId)).toEqual(accepted.aggregate);
    expect(await store.projection(first.taskId)).toEqual(accepted.projection);

    const database = new Database(path, { readonly: true });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM task_engine_event").get(),
    ).toEqual({ count: 1 });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM task_engine_outbox")
        .get(),
    ).toEqual({ count: 1 });
    database.close();

    await expect(
      engine.accept({
        ...structuredClone(first),
        eventId: "conflicting-source-coordinate",
        launch: { ...structuredClone(first.launch), outcome: "Changed" },
      }),
    ).rejects.toThrow(
      "Task event source coordinate was reused with different content.",
    );
    expect((await store.aggregate(first.taskId))?.revision).toBe(1);

    const unchanged = new Database(path, { readonly: true });
    expect(
      unchanged
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM task_engine_event) AS events,
             (SELECT COUNT(*) FROM task_engine_outbox) AS commands`,
        )
        .get(),
    ).toEqual({ events: 1, commands: 1 });
    unchanged.close();
    store.close();
  });

  it("migrates version-one persisted task payloads before exposing them", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-task-engine-schema-"));
    roots.push(root);
    const path = join(root, "task.sqlite3");
    const first = new SqliteTaskEngineStore({ path });
    const accepted = await new TaskEngine(first).accept(launch());
    first.close();

    const database = new Database(path);
    for (const table of ["task_engine_aggregate", "task_engine_projection"]) {
      const row = database
        .prepare(`SELECT payload_json FROM ${table} WHERE task_id = ?`)
        .get(accepted.aggregate.taskId) as { payload_json: string };
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      delete payload.messageDeliveries;
      database
        .prepare(
          `UPDATE ${table} SET schema_version = 1, payload_json = ? WHERE task_id = ?`,
        )
        .run(JSON.stringify(payload), accepted.aggregate.taskId);
    }
    database.close();

    const reopened = new SqliteTaskEngineStore({ path });
    expect(await reopened.aggregate(accepted.aggregate.taskId)).toMatchObject({
      messageDeliveries: {},
    });
    expect(await reopened.projection(accepted.aggregate.taskId)).toMatchObject({
      messageDeliveries: {},
    });
    const migrated = new Database(path, { readonly: true });
    expect(
      migrated
        .prepare(
          "SELECT schema_version FROM task_engine_aggregate WHERE task_id = ?",
        )
        .get(accepted.aggregate.taskId),
    ).toEqual({ schema_version: 2 });
    migrated.close();
    reopened.close();
  });

  it("restores legacy conversation timing and phase from immutable item events", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-task-engine-item-time-"));
    roots.push(root);
    const path = join(root, "task.sqlite3");
    const first = new SqliteTaskEngineStore({ path });
    const engine = new TaskEngine(first);
    const launched = await engine.accept(launch());
    await engine.accept({
      schemaVersion: 1,
      type: "codex_item_observed",
      eventId: "codex:item:legacy-timing",
      taskId: launched.aggregate.taskId,
      source: { kind: "codex", id: "connection", generation: 1, position: 1 },
      observedAt: "2026-09-09T12:00:03.000Z",
      threadId: "thread_legacy",
      turnId: "turn_legacy",
      itemId: "item_legacy",
      terminal: true,
      item: {
        id: "item_legacy",
        turnId: "turn_legacy",
        kind: "assistant_message",
        status: "completed",
        phase: "final_answer",
        text: "Done.",
      },
    });
    first.close();

    const database = new Database(path);
    for (const table of ["task_engine_aggregate", "task_engine_projection"]) {
      const row = database
        .prepare(`SELECT payload_json FROM ${table} WHERE task_id = ?`)
        .get(launched.aggregate.taskId) as { payload_json: string };
      const payload = JSON.parse(row.payload_json) as {
        conversation: { items: Record<string, Record<string, unknown>> };
      };
      delete payload.conversation.items.item_legacy?.startedAt;
      delete payload.conversation.items.item_legacy?.completedAt;
      delete payload.conversation.items.item_legacy?.phase;
      database
        .prepare(`UPDATE ${table} SET payload_json = ? WHERE task_id = ?`)
        .run(JSON.stringify(payload), launched.aggregate.taskId);
    }
    database.close();

    const reopened = new SqliteTaskEngineStore({ path });
    expect(
      (await reopened.aggregate(launched.aggregate.taskId))?.conversation.items
        .item_legacy,
    ).toMatchObject({
      phase: "final_answer",
      startedAt: "2026-09-09T12:00:03.000Z",
      completedAt: "2026-09-09T12:00:03.000Z",
    });
    reopened.close();
  });

  it("quarantines a persisted task whose cwd predates protected workspaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-task-engine-workspace-"));
    roots.push(root);
    const path = join(root, "task.sqlite3");
    const first = new SqliteTaskEngineStore({ path });
    const accepted = await new TaskEngine(first).accept(launch());
    first.close();

    const reopened = new SqliteTaskEngineStore({
      path,
      taskWorkspaceRoot: join(root, "protected-task-workspaces"),
    });
    expect(await reopened.projection(accepted.aggregate.taskId)).toMatchObject({
      phase: "failed",
      recoveryRequired: expect.stringContaining(
        "outside the protected per-task root",
      ),
    });
    expect(
      (await reopened.aggregate(accepted.aggregate.taskId))?.launch?.cwd,
    ).toBe("/tmp/rove");
    reopened.close();
  });

  it("rejects an unknown future persisted task schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-task-engine-future-"));
    roots.push(root);
    const path = join(root, "task.sqlite3");
    const first = new SqliteTaskEngineStore({ path });
    const accepted = await new TaskEngine(first).accept(launch());
    first.close();
    const database = new Database(path);
    database
      .prepare(
        "UPDATE task_engine_aggregate SET schema_version = 99 WHERE task_id = ?",
      )
      .run(accepted.aggregate.taskId);
    database.close();
    expect(() => new SqliteTaskEngineStore({ path })).toThrow(
      "Unsupported persisted task aggregate version",
    );
  });

  it("reclaims a possibly-started command only through reconciliation", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-task-engine-cut-"));
    roots.push(root);
    const path = join(root, "task.sqlite3");
    const first = new SqliteTaskEngineStore({ path });
    await new TaskEngine(first).accept(launch());
    const [claimed] = await first.claimDueCommands("worker-1", 1, 1);
    expect(claimed?.claimedFrom).toBe("pending");
    await first.markPossiblyStarted(claimed!.commandId);
    first.close();
    const reopened = new SqliteTaskEngineStore({ path });
    const [reconciled] = await reopened.claimDueCommands("worker-2", 2, 1);
    expect(reconciled?.claimedFrom).toBe("reconcile_required");
    expect(reconciled?.commandId).toBe(claimed?.commandId);
    reopened.close();
    const reopenedAgain = new SqliteTaskEngineStore({ path });
    const [stillReconciled] = await reopenedAgain.claimDueCommands(
      "worker-3",
      3,
      1,
    );
    expect(stillReconciled?.claimedFrom).toBe("reconcile_required");
    reopenedAgain.close();
  });

  it("redispatches only a claim known to have stopped before dispatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-task-engine-predispatch-"));
    roots.push(root);
    const path = join(root, "task.sqlite3");
    const first = new SqliteTaskEngineStore({ path });
    await new TaskEngine(first).accept(launch());
    const [claimed] = await first.claimDueCommands("worker-1", 1, 1);
    expect(claimed?.claimedFrom).toBe("pending");
    first.close();

    const reopened = new SqliteTaskEngineStore({ path });
    const [redispatchable] = await reopened.claimDueCommands("worker-2", 2, 1);
    expect(redispatchable).toMatchObject({
      commandId: claimed?.commandId,
      claimedFrom: "pending",
    });
    reopened.close();
  });

  it("stops automatically reconciling a command after three unresolved attempts", async () => {
    const { store, engine } = await fixture();
    const launched = launch();
    const accepted = await engine.accept(launched);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const [claimed] = await store.claimDueCommands(
        `worker-${attempt}`,
        attempt,
        1,
      );
      expect(claimed).toMatchObject({
        commandId: accepted.command?.commandId,
        attempts: attempt,
      });
      await engine.accept({
        schemaVersion: 1,
        type: "command_outcome_observed",
        eventId: `outcome:bounded:${attempt}`,
        taskId: launched.taskId,
        source: {
          kind: "worker",
          id: `command:${claimed!.commandId}:attempt:${attempt}`,
          generation: 1,
          position: 1,
        },
        observedAt: `2026-09-09T12:00:0${attempt}.000Z`,
        commandId: claimed!.commandId,
        status: "unresolved",
        facts: [],
        detail: { error: "simulated unresolved result" },
      });
    }
    expect(await store.claimDueCommands("worker-4", 4, 1)).toEqual([]);
    store.close();
  });

  it("accepts a new operation-bound producer identity after Desktop restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-task-engine-restart-"));
    roots.push(root);
    const path = join(root, "task.sqlite3");
    const first = new SqliteTaskEngineStore({ path });
    const launched = launch();
    await new TaskEngine(first).accept(launched);
    first.close();
    const reopened = new SqliteTaskEngineStore({ path });
    const reopenedEngine = new TaskEngine(reopened);
    const [bootstrap] = await reopened.claimDueCommands("restart-worker", 2, 1);
    await reopenedEngine.accept({
      schemaVersion: 1,
      type: "command_outcome_observed",
      eventId: "outcome:restart-bootstrap",
      taskId: launched.taskId,
      source: {
        kind: "worker",
        id: "command:restart-bootstrap",
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-09T12:00:30.000Z",
      commandId: bootstrap!.commandId,
      status: "succeeded",
      facts: [],
    });
    const operationId = "intent_22345678-1234-4123-8123-123456789abc";
    const accepted = await reopenedEngine.accept({
      schemaVersion: 1,
      type: "task_finish_requested",
      eventId: `product:${operationId}`,
      taskId: launched.taskId,
      source: {
        kind: "product",
        id: `operation:${operationId}`,
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-09T12:01:00.000Z",
      operationId,
    });
    expect(accepted.duplicate).toBe(false);
    expect(accepted.aggregate.revision).toBe(3);
    reopened.close();
  });

  it("applies a successful command outcome after intervening truth without duplicating it", async () => {
    const { store, engine } = await fixture();
    const accepted = await engine.accept(launch());
    const [command] = await store.claimDueCommands("worker", 1, 1);
    await store.markPossiblyStarted(command!.commandId);
    await engine.accept({
      schemaVersion: 1,
      type: "runtime_inventory_observed",
      eventId: "runtime:intervening-truth",
      taskId: accepted.aggregate.taskId,
      source: {
        kind: "runtime",
        id: "runtime-test",
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-09T12:00:01.000Z",
      runtime: {
        availability: "available",
        sessionExists: false,
        bootstrapLookup: "none",
        status: "missing",
        controller: null,
        attachment: "missing",
        profileLock: "released",
        recovery: "cleanup_required",
      },
    });
    const outcome = await engine.accept({
      schemaVersion: 1,
      type: "command_outcome_observed",
      eventId: "outcome:after-intervening-truth",
      taskId: accepted.aggregate.taskId,
      source: {
        kind: "worker",
        id: `command:${command!.commandId}:attempt:1`,
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-09T12:00:02.000Z",
      commandId: command!.commandId,
      status: "succeeded",
      facts: [],
    });
    expect(outcome.aggregate.record?.bootstrap.stage).toBe("intent_persisted");
    expect(outcome.command?.type).toBe("advance_bootstrap_stage");
    expect(outcome.command?.type).not.toBe("persist_bootstrap_intent");
    store.close();
  });

  it("rejects non-interrupting replacement of an outstanding product intent", async () => {
    const { store, engine } = await fixture();
    const launched = launch();
    await engine.accept(launched);
    const operationId = "intent_42345678-1234-4123-8123-123456789abc";
    await expect(
      engine.accept({
        schemaVersion: 1,
        type: "task_archive_requested",
        eventId: `product:${operationId}`,
        taskId: launched.taskId,
        source: {
          kind: "product",
          id: `operation:${operationId}`,
          generation: 1,
          position: 1,
        },
        observedAt: "2026-09-09T12:01:00.000Z",
        operationId,
      }),
    ).rejects.toThrow(/outstanding product intent/);
    store.close();
  });

  it("allows an explicit cleanup retry to supersede a stuck cleanup intent", async () => {
    const { store, engine } = await fixture();
    const launched = launch();
    await engine.accept(launched);
    await engine.accept({
      schemaVersion: 1,
      type: "task_finish_requested",
      eventId: "product:finish:cleanup-a",
      taskId: launched.taskId,
      source: {
        kind: "product",
        id: "operation:finish:cleanup-a",
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-09T12:01:00.000Z",
      operationId: "intent_52345678-1234-4123-8123-123456789abc",
    });
    const retried = await engine.accept({
      schemaVersion: 1,
      type: "task_cleanup_retry_requested",
      eventId: "product:retry_cleanup:cleanup-b",
      taskId: launched.taskId,
      source: {
        kind: "product",
        id: "operation:retry_cleanup:cleanup-b",
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-09T12:01:01.000Z",
      operationId: "intent_62345678-1234-4123-8123-123456789abc",
    });
    expect(retried.aggregate.requestedOperation).toMatchObject({
      type: "retry_cleanup",
      operationId: "intent_62345678-1234-4123-8123-123456789abc",
    });
    store.close();
  });

  it("continues an accepted Finish after its older active wait is cancelled", async () => {
    const { store, engine } = await fixture();
    const launched = await engine.accept(launch());
    const [bootstrap] = await store.claimDueCommands("worker", 1, 1);
    await store.markPossiblyStarted(bootstrap!.commandId);
    const operationId = "intent_72345678-1234-4123-8123-123456789abc";
    await engine.accept({
      schemaVersion: 1,
      type: "task_finish_requested",
      eventId: `product:v2:finish:${operationId}`,
      taskId: launched.aggregate.taskId,
      source: {
        kind: "product",
        id: `operation:v2:finish:${operationId}`,
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-09T12:01:00.000Z",
      operationId,
    });
    const cancelled = await engine.accept({
      schemaVersion: 1,
      type: "command_outcome_observed",
      eventId: `outcome:${bootstrap!.commandId}:cancelled`,
      taskId: launched.aggregate.taskId,
      source: {
        kind: "worker",
        id: `command:${bootstrap!.commandId}:cancelled`,
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-09T12:01:01.000Z",
      commandId: bootstrap!.commandId,
      status: "unresolved",
      facts: [],
      detail: { error: "Cancelled by Finish." },
    });
    expect(cancelled.aggregate.recoveryRequired).toBeNull();
    expect(cancelled.aggregate.requestedOperation).toMatchObject({
      type: "finish",
      operationId,
    });
    store.close();
  });

  it("rejects a follow-up message before bootstrap completes", async () => {
    const { store, engine } = await fixture();
    const launched = launch();
    await engine.accept(launched);
    const operationId = "intent_62345678-1234-4123-8123-123456789abc";
    await expect(
      engine.accept({
        schemaVersion: 1,
        type: "task_message_requested",
        eventId: `product:${operationId}`,
        taskId: launched.taskId,
        source: {
          kind: "product",
          id: `operation:${operationId}`,
          generation: 1,
          position: 1,
        },
        observedAt: "2026-09-09T12:01:00.000Z",
        operationId,
        message: "Too early",
      }),
    ).rejects.toThrow(/before bootstrap completes/);
    store.close();
  });

  it("clears a transient recovery marker after exact reconciliation succeeds", async () => {
    const { store, engine } = await fixture();
    const accepted = await engine.accept(launch());
    const [command] = await store.claimDueCommands("worker-1", 1, 1);
    await store.markPossiblyStarted(command!.commandId);
    await engine.accept({
      schemaVersion: 1,
      type: "command_outcome_observed",
      eventId: "outcome:unresolved",
      taskId: accepted.aggregate.taskId,
      source: {
        kind: "worker",
        id: "command:unresolved",
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-09T12:01:00.000Z",
      commandId: command!.commandId,
      status: "unresolved",
      facts: [],
    });
    expect(
      (await store.aggregate(accepted.aggregate.taskId))?.recoveryRequired,
    ).toMatch(/requires truth-based reconciliation/);
    await engine.accept({
      schemaVersion: 1,
      type: "command_outcome_observed",
      eventId: "outcome:reconciled",
      taskId: accepted.aggregate.taskId,
      source: {
        kind: "worker",
        id: "command:reconciled",
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-09T12:02:00.000Z",
      commandId: command!.commandId,
      status: "succeeded",
      facts: [],
    });
    expect(
      (await store.aggregate(accepted.aggregate.taskId))?.recoveryRequired,
    ).toBeNull();
    store.close();
  });
});
