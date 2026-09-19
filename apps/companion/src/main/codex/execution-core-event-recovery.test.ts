import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import {
  emptyTaskAggregate,
  projectTaskAggregate,
  type TaskAggregate,
} from "@rove/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexExecutionCore } from "./execution-core.js";
import { SqliteTaskEngineStore } from "./sqlite-task-engine-store.js";
import type {
  CodexRpcPort,
  CodexServerEvent,
  CodexServerEventListener,
  CodexThread,
} from "./protocol.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("CodexExecutionCore event recovery ownership", () => {
  it("routes only its own failed ingestion by semantic recovery class", async () => {
    const stateDirectory = await mkdtemp(
      join(tmpdir(), "rove-event-recovery-"),
    );
    roots.push(stateDirectory);
    const databasePath = join(stateDirectory, "task-process.v1.sqlite3");
    const taskId = "task_33333333-3333-4333-8333-333333333333";
    const threadId = "thread_event_recovery";
    const bootstrapId = `boot_${"3".repeat(32)}`;
    const aggregate = seededAggregate(taskId, threadId, bootstrapId);
    const initialized = new SqliteTaskEngineStore({ path: databasePath });
    initialized.close();
    seed(databasePath, aggregate);

    const thread = historyThread(taskId, threadId, bootstrapId);
    const listeners = new Set<CodexServerEventListener>();
    const rpc = {
      request: vi.fn(async (method: string) => {
        if (method === "thread/read") return { thread };
        if (method === "thread/list")
          return { data: [thread], nextCursor: null };
        throw new Error(`Unavailable test account call ${method}`);
      }),
      notify: vi.fn(),
      respond: vi.fn(),
      onEvent(listener: CodexServerEventListener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as CodexRpcPort;
    const core = new CodexExecutionCore({
      isPackaged: false,
      developmentExecutablePath: "/unused/codex",
      clientVersion: "test",
      stateDirectory,
      runtime: {} as never,
      mcpLaunch: { command: "unused", args: [], environment: {} },
    });
    vi.spyOn(core.host, "start").mockResolvedValue(rpc);
    vi.spyOn(core.host, "stop").mockResolvedValue(undefined);
    vi.spyOn(core.host, "getHealth").mockReturnValue({
      state: "ready",
      ready: true,
      connectionId: "connection_event_recovery",
      restartAttempt: 0,
      stderrTail: [],
    });
    await core.start();

    thread.turns = [completedTurn("assistant_repaired")];
    blockCodexSourcePosition(databasePath, taskId, 1);
    await emit(listeners, {
      method: "item/completed",
      params: {
        threadId,
        turnId: "turn_repaired",
        item: {
          type: "agentMessage",
          id: "assistant_repaired",
          text: "Recovered from exact history",
          phase: "final_answer",
        },
      },
    });
    await expect(core.workflowStore().aggregate(taskId)).resolves.toMatchObject(
      {
        conversation: {
          items: {
            assistant_repaired: {
              status: "completed",
              text: "Recovered from exact history",
            },
          },
        },
        codexRecoveryBlockers: {},
      },
    );

    blockCodexSourcePosition(databasePath, taskId, 2);
    const resolution: CodexServerEvent = {
      method: "serverRequest/resolved",
      params: { threadId, requestId: 41 },
    };
    await emit(listeners, resolution);
    let current = await core.workflowStore().aggregate(taskId);
    expect(Object.values(current?.codexRecoveryBlockers ?? {})).toEqual([
      expect.objectContaining({
        recoveryClass: "live_attention",
        family: "serverRequest/resolved",
      }),
    ]);
    await core.recover("App Server");
    current = await core.workflowStore().aggregate(taskId);
    expect(Object.values(current?.codexRecoveryBlockers ?? {})).toEqual([
      expect.objectContaining({ recoveryClass: "live_attention" }),
    ]);
    await emit(listeners, resolution);
    current = await core.workflowStore().aggregate(taskId);
    expect(current?.codexRecoveryBlockers).toEqual({});
    expect(current?.attentions).toEqual([
      expect.objectContaining({
        requestId: "connection:server:number:41",
        status: "resolved",
      }),
    ]);

    blockCodexSourcePosition(databasePath, taskId, 4);
    const archived: CodexServerEvent = {
      method: "thread/archived",
      params: { threadId },
    };
    await emit(listeners, archived);
    await core.recover("App Server");
    current = await core.workflowStore().aggregate(taskId);
    expect(Object.values(current?.codexRecoveryBlockers ?? {})).toEqual([
      expect.objectContaining({
        recoveryClass: "provider_other_authority",
        family: "thread_archive_membership",
      }),
    ]);
    expect(current?.codex.archived).toBe(false);
    await emit(listeners, archived);
    current = await core.workflowStore().aggregate(taskId);
    expect(current?.codex.archived).toBe(true);
    expect(current?.codexRecoveryBlockers).toEqual({});

    blockCodexSourcePosition(databasePath, taskId, 6);
    await emit(listeners, {
      method: "item/commandExecution/outputDelta",
      params: {
        threadId,
        turnId: "turn_progress",
        itemId: "command_progress",
        item: {
          type: "commandExecution",
          id: "command_progress",
          command: "true",
          status: "inProgress",
        },
      },
    });
    expect(
      (await core.workflowStore().aggregate(taskId))?.codexRecoveryBlockers,
    ).toEqual({});

    thread.turns = [
      ...thread.turns,
      completedTurn("assistant_unrelated_listener"),
    ];
    rpc.onEvent(async () => {
      throw new Error("unrelated listener failed");
    });
    const listenerErrors = await emit(listeners, {
      method: "item/completed",
      params: {
        threadId,
        turnId: "turn_assistant_unrelated_listener",
        item: {
          type: "agentMessage",
          id: "assistant_unrelated_listener",
          text: "Task ingestion committed first",
          phase: "final_answer",
        },
      },
    });
    expect(listenerErrors).toEqual(["unrelated listener failed"]);
    current = await core.workflowStore().aggregate(taskId);
    expect(
      current?.conversation.items.assistant_unrelated_listener,
    ).toMatchObject({
      status: "completed",
      text: "Task ingestion committed first",
    });
    expect(current?.codexRecoveryBlockers).toEqual({});

    await core.stop();
  });
});

async function emit(
  listeners: ReadonlySet<CodexServerEventListener>,
  event: CodexServerEvent,
): Promise<string[]> {
  const errors: string[] = [];
  for (const listener of [...listeners])
    try {
      await listener(event);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  return errors;
}

function seededAggregate(
  taskId: string,
  threadId: string,
  bootstrapId: string,
): TaskAggregate {
  const value = emptyTaskAggregate(taskId);
  value.launch = {
    operationId: "intent_33333333-3333-4333-8333-333333333333",
    bootstrapId,
    requestedAt: "2026-09-20T00:00:00.000Z",
    outcome: "Exercise exact event recovery",
    executionMode: "agent",
    approvalsReviewer: "user",
    cwd: "/work",
    attachmentIds: [],
  };
  value.record = {
    schemaVersion: 1,
    identity: { taskId, threadId },
    bootstrap: {
      operationId: bootstrapId,
      threadSource: `rove:${taskId}:${bootstrapId}`,
      stage: "complete",
    },
    desiredState: "open",
  };
  value.codexSessionId = "codex_event_recovery";
  value.codex = {
    availability: "available",
    threadExists: true,
    threadId,
    threadSource: value.record.bootstrap.threadSource,
    sourceLookup: "exact",
    runtimeStatus: "idle",
    archived: false,
    turn: "completed",
  };
  value.attentions = [
    {
      authority: "codex",
      kind: "file_approval",
      requestId: "connection:server:number:41",
      method: "item/fileChange/requestApproval",
      wireRequestId: 41,
      responseFields: {},
      taskId,
      threadId,
      generation: 1,
      status: "pending",
    },
  ];
  return value;
}

function seed(path: string, aggregate: TaskAggregate): void {
  const db = new Database(path);
  const observedAt = "2026-09-20T00:00:00.000Z";
  db.prepare(
    "INSERT INTO task_engine_aggregate(task_id, schema_version, revision, payload_json, updated_at) VALUES (?, 3, ?, ?, ?)",
  ).run(
    aggregate.taskId,
    aggregate.revision,
    JSON.stringify(aggregate),
    observedAt,
  );
  const projection = projectTaskAggregate(aggregate);
  db.prepare(
    "INSERT INTO task_engine_projection(task_id, revision, schema_version, payload_json, updated_at) VALUES (?, ?, 1, ?, ?)",
  ).run(
    aggregate.taskId,
    aggregate.revision,
    JSON.stringify(projection),
    observedAt,
  );
  db.close();
}

function blockCodexSourcePosition(
  path: string,
  taskId: string,
  position: number,
): void {
  const db = new Database(path);
  db.prepare(
    `INSERT INTO task_engine_event(
      task_id, event_id, source_kind, source_id, source_generation,
      source_position, digest, payload_json, acceptance_json, accepted_at
    ) VALUES (?, ?, 'codex', 'connection_event_recovery', 1, ?, ?, '{}', '{}', ?)`,
  ).run(
    taskId,
    `injected-conflict-${position}`,
    position,
    `conflicting-digest-${position}`,
    "2026-09-20T00:00:00.000Z",
  );
  db.close();
}

function historyThread(
  taskId: string,
  threadId: string,
  bootstrapId: string,
): CodexThread {
  return {
    id: threadId,
    extra: null,
    sessionId: "codex_event_recovery",
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    daybreakEnabled: null,
    environments: null,
    originator: null,
    historyMode: "legacy",
    modelProvider: "openai",
    model: null,
    reasoningEffort: null,
    createdAt: 1,
    updatedAt: 2,
    recencyAt: 2,
    cwd: "/work",
    cliVersion: "0.154.0-alpha.6.2",
    status: { type: "idle" },
    path: null,
    source: "appServer",
    canAcceptDirectInput: true,
    threadSource: `rove:${taskId}:${bootstrapId}`,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}

function completedTurn(itemId: string): CodexThread["turns"][number] {
  return {
    id: `turn_${itemId}`,
    status: "completed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1,
    itemsView: "full",
    items: [
      {
        type: "agentMessage",
        id: itemId,
        text:
          itemId === "assistant_repaired"
            ? "Recovered from exact history"
            : "Task ingestion committed first",
        phase: "final_answer",
        memoryCitation: null,
        delivery: null,
        questions: null,
      },
    ],
  };
}
