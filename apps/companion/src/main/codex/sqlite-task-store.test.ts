import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  MemoryTaskStore,
  TaskProcessManager,
  type NativeLifecycleInput,
  type TaskProcessInput,
} from "@rove/protocol";

import { SqliteTaskStore } from "./sqlite-task-store.js";

const directories: string[] = [];

function lifecycle(taskId: string): NativeLifecycleInput {
  const bootstrapId = `boot_${"4".repeat(32)}`;
  return {
    record: {
      schemaVersion: 1,
      identity: { taskId, browser: { mode: "temporary" } },
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
      availability: "available",
      sessionExists: false,
      bootstrapLookup: "none",
      status: "missing",
      controller: null,
      attachment: "missing",
      profileLock: "released",
      recovery: "cleanup_required",
    },
    continuation: { status: "none" },
    attentions: [],
    freshInspection: null,
    requestedOperation: { type: "observe", taskId },
  };
}

async function fixture(): Promise<{
  store: SqliteTaskStore;
  path: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "rove-ledger-"));
  directories.push(directory);
  const path = join(directory, "task-process.sqlite3");
  return {
    path,
    store: new SqliteTaskStore({
      path,
      now: () => "2026-09-09T12:00:00.000Z",
    }),
  };
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("SQLite durable task process store", () => {
  it("matches the platform-neutral in-memory store contract", async () => {
    const { store } = await fixture();
    const memory = new MemoryTaskStore();
    const taskId = "task_44444444-4444-4444-8444-444444444444";
    const input: TaskProcessInput = {
      schemaVersion: 1,
      inputId: "input_contract",
      taskId,
      kind: "fact",
      source: "contract-fixture",
      sourceId: "fixture-1",
      observedAt: "2026-09-09T12:00:00.000Z",
      lifecycle: lifecycle(taskId),
    };
    const sqliteDecision = await new TaskProcessManager(store).accept(input);
    const memoryDecision = await new TaskProcessManager(memory).accept(input);
    expect(sqliteDecision).toEqual(memoryDecision);
    expect(await store.claimDueCommands("worker", 1, 1)).toEqual(
      await memory.claimDueCommands("worker", 1, 1),
    );
    await store.close();
  });

  it("atomically records an input, reducer projection, and planned command", async () => {
    const { store } = await fixture();
    const manager = new TaskProcessManager(store);
    const taskId = "task_11111111-1111-4111-8111-111111111111";
    const input: TaskProcessInput = {
      schemaVersion: 1,
      inputId: "input_1",
      taskId,
      kind: "fact",
      source: "runtime",
      sourceId: "runtime-observation-1",
      observedAt: "2026-09-09T12:00:00.000Z",
      lifecycle: lifecycle(taskId),
      launchConfiguration: { roveTaskId: "raw-task-1", cwd: "/work" },
    };

    const first = await manager.accept(input);
    expect(first.projection.sequence).toBe(1);
    expect(first.command?.type).toBe("advance_bootstrap_stage");
    expect(first.record?.bootstrap.stage).toBe("runtime_dispatching");
    expect(await store.projection(taskId)).toEqual(first.projection);
    expect(await store.launchConfiguration(taskId)).toEqual({
      roveTaskId: "raw-task-1",
      cwd: "/work",
    });

    const replay = await manager.accept(input);
    expect(replay.duplicate).toBe(true);
    expect(replay.command?.commandId).toBe(first.command?.commandId);

    const next = await manager.accept({
      ...input,
      inputId: "input_2",
      sourceId: "runtime-observation-2",
    });
    expect(next.command?.type).toBe("advance_bootstrap_stage");
    expect(next.input.lifecycle.record?.bootstrap.stage).toBe(
      "intent_persisted",
    );

    const claimed = await store.claimDueCommands("worker-a", 3, 10);
    expect(claimed).toMatchObject([
      {
        commandId: first.command?.commandId,
        status: "leased",
        attempts: 1,
      },
      { commandId: next.command?.commandId, status: "leased", attempts: 1 },
    ]);
    await store.close();
  });

  it("turns an interrupted lease into reconcile-required on reopen", async () => {
    const { store, path } = await fixture();
    const manager = new TaskProcessManager(store);
    const taskId = "task_22222222-2222-4222-8222-222222222222";
    const decision = await manager.accept({
      schemaVersion: 1,
      inputId: "input_cut_after_claim",
      taskId,
      kind: "fact",
      source: "desktop",
      sourceId: "desktop-observation-1",
      observedAt: "2026-09-09T12:00:00.000Z",
      lifecycle: lifecycle(taskId),
    });
    await store.claimDueCommands("crashed-worker", 1, 1);
    await store.close();

    const reopened = new SqliteTaskStore({ path });
    expect(await reopened.claimDueCommands("new-worker", 2, 1)).toMatchObject([
      {
        commandId: decision.command!.commandId,
        claimedFrom: "reconcile_required",
      },
    ]);
    await reopened.close();
  });

  it("atomically grants a pending command to only one connection", async () => {
    const { store, path } = await fixture();
    const taskId = "task_55555555-5555-4555-8555-555555555555";
    await new TaskProcessManager(store).accept({
      schemaVersion: 1,
      inputId: "input_two_connection_claim",
      taskId,
      kind: "intent",
      source: "desktop",
      sourceId: "two-connection-claim",
      observedAt: "2026-09-09T12:00:00.000Z",
      lifecycle: lifecycle(taskId),
    });
    const second = new SqliteTaskStore({
      path,
      now: () => "2026-09-09T12:00:00.000Z",
    });
    const claims = await Promise.all([
      store.claimDueCommands("worker-a", 2, 1),
      second.claimDueCommands("worker-b", 2, 1),
    ]);
    expect(claims.flat()).toHaveLength(1);
    expect(claims.flat()[0]).toMatchObject({
      taskId,
      status: "leased",
      claimedFrom: "pending",
    });
    await store.markCommand(claims.flat()[0]!.commandId, "reconcile_required");
    expect(await second.claimDueCommands("stale-worker", 1, 1)).toEqual([]);
    expect(await second.claimDueCommands("new-worker", 3, 1)).toHaveLength(1);
    await second.close();
    await store.close();
  });

  it("rejects normalized continuation and attention rows that contradict authoritative bindings", async () => {
    const { store, path } = await fixture();
    const taskId = "task_66666666-6666-4666-8666-666666666666";
    const sessionId = `ses_${"6".repeat(32)}`;
    const bootstrapId = `boot_${"6".repeat(32)}`;
    const handoffId = `handoff_${"6".repeat(32)}`;
    const threadId = "thread_bound";
    const continuation = {
      schemaVersion: 1 as const,
      roveTaskId: taskId,
      codexThreadId: threadId,
      originatingCodexTurnId: "turn_bound",
      roveSessionId: sessionId,
      handoffId,
      handoffGeneration: 2,
      requestedInstruction: "Continue after return.",
      continuationPolicy: "resume_after_control_return" as const,
      status: "pending" as const,
      freshInspectionRequired: true,
      preHandoffObservationSeq: 5,
    };
    const attention = {
      schemaVersion: 1 as const,
      authority: "rove_control" as const,
      kind: "control_handoff" as const,
      requestId: "control:bound",
      taskId,
      threadId,
      turnId: "turn_bound",
      generation: 2,
      payload: { handoffId },
      status: "pending" as const,
      sequence: 1,
    };
    await new TaskProcessManager(store).accept({
      schemaVersion: 1,
      inputId: "input_bound_rows",
      taskId,
      kind: "fact",
      source: "test",
      sourceId: "bound-rows",
      observedAt: "2026-09-09T12:00:00.000Z",
      lifecycle: {
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
          controller: "human",
          attachment: "attached",
          profileLock: "released",
          browserIdentity: { mode: "temporary" },
          recovery: "not_needed",
          ownershipGeneration: 3,
          handoffId,
          handoffGeneration: 2,
          observationSeq: 5,
        },
        continuation: {
          status: "pending",
          id: "continuation_bound",
          taskId,
          sessionId,
          threadId,
          handoffId,
          generation: 2,
          policy: "resume_after_control_return",
          freshInspectionRequired: true,
          preHandoffObservationSeq: 5,
        },
        attentions: [
          {
            authority: "rove_control",
            kind: "control_handoff",
            requestId: attention.requestId,
            taskId,
            sessionId,
            threadId,
            handoffId,
            generation: 2,
            status: "pending",
          },
        ],
        freshInspection: null,
        requestedOperation: { type: "observe", taskId },
      },
      durableData: {
        schemaVersion: 1,
        continuation,
        attentions: [attention],
      },
    });

    const native = new Database(path);
    const originalHandoff = native
      .prepare(`SELECT payload_json FROM task_handoff WHERE task_id = ?`)
      .get(taskId) as { payload_json: string };
    native
      .prepare(`UPDATE task_handoff SET payload_json = ? WHERE task_id = ?`)
      .run(
        JSON.stringify({
          ...JSON.parse(originalHandoff.payload_json),
          roveSessionId: `ses_${"7".repeat(32)}`,
        }),
        taskId,
      );
    await expect(store.taskState(taskId)).rejects.toThrow(
      /Continuation identity does not match its task binding/,
    );
    native
      .prepare(`UPDATE task_handoff SET payload_json = ? WHERE task_id = ?`)
      .run(originalHandoff.payload_json, taskId);

    const originalAttention = native
      .prepare(`SELECT payload_json FROM task_attention WHERE task_id = ?`)
      .get(taskId) as { payload_json: string };
    native
      .prepare(`UPDATE task_attention SET payload_json = ? WHERE task_id = ?`)
      .run(
        JSON.stringify({
          ...JSON.parse(originalAttention.payload_json),
          threadId: "thread_foreign",
        }),
        taskId,
      );
    await expect(store.taskState(taskId)).rejects.toThrow(
      /Attention thread does not match its task binding/,
    );
    native.close();
    await store.close();
  });

  it("rolls back all lifecycle rows when a transaction fails", async () => {
    const { store } = await fixture();
    const taskId = "task_33333333-3333-4333-8333-333333333333";
    await expect(
      store.transact(async (tx) => {
        const managerDecision = await new TaskProcessManager({
          transact: async (operation) => operation(tx),
          claimDueCommands: (...args) => store.claimDueCommands(...args),
          markCommand: (...args) => store.markCommand(...args),
          projection: (...args) => store.projection(...args),
          lifecycle: (...args) => store.lifecycle(...args),
          launchConfiguration: (...args) => store.launchConfiguration(...args),
          taskState: (...args) => store.taskState(...args),
          states: () => store.states(),
        }).accept({
          schemaVersion: 1,
          inputId: "input_rollback",
          taskId,
          kind: "fact",
          source: "codex",
          sourceId: "codex-observation-1",
          observedAt: "2026-09-09T12:00:00.000Z",
          lifecycle: lifecycle(taskId),
        });
        expect(managerDecision.projection.sequence).toBe(1);
        throw new Error("controlled cut before commit");
      }),
    ).rejects.toThrow("controlled cut before commit");
    expect(await store.projection(taskId)).toBeNull();
    await store.close();
  });
});
