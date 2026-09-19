import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import {
  emptyTaskAggregate,
  TaskEngine,
  type TaskAggregate,
} from "@rove/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexThreadSessionSupervisor } from "./codex-thread-session-supervisor.js";
import { CodexThreadTruthReconciler } from "./codex-thread-truth-reconciler.js";
import { OrderedTaskIngress } from "./ordered-task-ingress.js";
import type { CodexRpcPort, CodexThread } from "./protocol.js";
import { SqliteTaskEngineStore } from "./sqlite-task-engine-store.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("Codex thread truth reconciliation", () => {
  it("repairs dropped item, message, tool, turn, and handoff terminals without replay", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-codex-reconcile-"));
    roots.push(root);
    const path = join(root, "tasks.sqlite3");
    const store = new SqliteTaskEngineStore({ path });
    const taskId = "task_11111111-1111-4111-8111-111111111111";
    const otherTaskId = "task_22222222-2222-4222-8222-222222222222";
    const sessionId = `ses_${"1".repeat(32)}`;
    const handoffId = `handoff_${"2".repeat(32)}`;
    seed(path, aggregate(taskId, "thread_a", "codex_a", sessionId, handoffId));
    seed(path, aggregate(otherTaskId, "thread_b", "codex_b"));

    const thread = historyThread(taskId, sessionId, handoffId);
    const rpc = {
      request: vi.fn(async (method: string, params: unknown) => {
        if (method !== "thread/read") throw new Error(`Unexpected ${method}`);
        expect(params).toEqual({ threadId: "thread_a", includeTurns: true });
        return { thread };
      }),
      notify: vi.fn(),
      respond: vi.fn(),
      onEvent: vi.fn(() => () => undefined),
    } as unknown as CodexRpcPort;
    const engine = new TaskEngine(store);
    const ingress = new OrderedTaskIngress(engine, (error) => {
      throw error;
    });
    ingress.replaceGeneration(1);
    const acknowledgeDurableHandoff = vi.fn(async () => ({}));
    const reconciler = new CodexThreadTruthReconciler(
      new CodexThreadSessionSupervisor(rpc),
      store,
      ingress,
      {
        getControlStatus: async () => ({
          sessionId,
          generation: 2,
          status: "awaiting_human",
          controller: null,
          activeHandoffId: handoffId,
          activeHandoffGeneration: 2,
          observationSeq: 9,
          updatedAt: "2026-09-19T00:00:00.000Z",
        }),
        acknowledgeDurableHandoff,
      } as never,
      () => 1,
    );

    const liveAttentionBlocker = "codex-recovery:live-attention:lost-request";
    await engine.accept({
      schemaVersion: 1,
      type: "codex_reconciliation_observed",
      eventId: "lost-live-attention",
      taskId,
      source: {
        kind: "host",
        id: "failure-router",
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-19T00:00:00.000Z",
      diagnostic: {
        trigger: "event_delivery_failure",
        outcome: "unresolved",
        recoveryClass: "live_attention",
        blockerId: liveAttentionBlocker,
        threadId: "thread_a",
        attempt: 1,
        observedAt: "2026-09-19T00:00:00.000Z",
        eventFamily: "item/fileChange/requestApproval",
      },
    });

    await reconciler.reconcile(taskId, "authority_contradiction", 1);
    await reconciler.reconcile(taskId, "authority_contradiction", 1);
    const repaired = await store.aggregate(taskId);
    expect(repaired).toMatchObject({
      codex: { turn: "completed" },
      continuation: {
        status: "pending",
        handoffId,
        generation: 2,
      },
      attentions: [
        expect.objectContaining({
          authority: "rove_control",
          handoffId,
          status: "pending",
        }),
      ],
      conversation: {
        items: {
          user_a: { kind: "user_message", status: "completed" },
          assistant_a: {
            kind: "assistant_message",
            status: "completed",
            text: "Final answer",
          },
          tool_a: { kind: "command", status: "completed" },
          handoff_a: { kind: "tool", status: "completed" },
        },
      },
      codexReconciliation: expect.arrayContaining([
        expect.objectContaining({ outcome: "succeeded" }),
      ]),
      codexRecoveryBlockers: {
        [liveAttentionBlocker]: expect.objectContaining({
          recoveryClass: "live_attention",
        }),
      },
      recoveryRequired: expect.stringContaining("authoritative reconciliation"),
    });
    expect(acknowledgeDurableHandoff).toHaveBeenCalledWith(sessionId, {
      handoffId,
      handoffGeneration: 2,
    });
    expect((await store.aggregate(otherTaskId))?.revision).toBe(0);

    await engine.accept({
      schemaVersion: 1,
      type: "codex_item_observed",
      eventId: "late-live-assistant-start",
      taskId,
      source: {
        kind: "codex",
        id: "late-connection",
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-19T00:00:03.000Z",
      threadId: "thread_a",
      turnId: "turn_a",
      itemId: "assistant_a",
      terminal: false,
      item: {
        id: "assistant_a",
        turnId: "turn_a",
        kind: "assistant_message",
        status: "started",
        text: "partial",
      },
    });
    expect(
      (await store.aggregate(taskId))?.conversation.items.assistant_a,
    ).toMatchObject({
      status: "completed",
      text: "Final answer",
    });
    await engine.accept({
      schemaVersion: 1,
      type: "codex_turn_observed",
      eventId: "late-live-turn-start",
      taskId,
      source: {
        kind: "codex",
        id: "late-connection",
        generation: 1,
        position: 2,
      },
      observedAt: "2026-09-19T00:00:04.000Z",
      threadId: "thread_a",
      turn: { turn: "active", turnId: "turn_a", runtimeStatus: "active" },
    });
    expect((await store.aggregate(taskId))?.codex.turn).toBe("completed");
    await engine.accept({
      schemaVersion: 1,
      type: "codex_turn_observed",
      eventId: "late-live-prior-turn-terminal",
      taskId,
      source: {
        kind: "codex",
        id: "late-connection",
        generation: 1,
        position: 3,
      },
      observedAt: "2026-09-19T00:00:05.000Z",
      threadId: "thread_a",
      turn: {
        turn: "failed",
        turnId: "turn_prior",
        runtimeStatus: "idle",
      },
    });
    expect(await store.aggregate(taskId)).toMatchObject({
      codex: { turn: "completed" },
      conversation: { terminalTurns: { turn_prior: "failed" } },
    });
    await reconciler.unresolved(otherTaskId, "event_delivery_failure", 1, {
      eventFamily: "live_attention",
      errorCategory: "listener_failure",
    });
    expect(await store.aggregate(otherTaskId)).toMatchObject({
      attentions: [],
      recoveryRequired: expect.stringContaining("authoritative reconciliation"),
      codexReconciliation: [
        expect.objectContaining({
          outcome: "unresolved",
          recoveryClass: "thread_history_reconstructible",
          eventFamily: "live_attention",
        }),
      ],
    });
    store.close();
  });
});

function seed(path: string, value: TaskAggregate): void {
  const db = new Database(path);
  db.prepare(
    "INSERT INTO task_engine_aggregate(task_id, schema_version, revision, payload_json, updated_at) VALUES (?, 3, ?, ?, ?)",
  ).run(
    value.taskId,
    value.revision,
    JSON.stringify(value),
    "2026-09-19T00:00:00.000Z",
  );
  db.close();
}

function aggregate(
  taskId: string,
  threadId: string,
  codexSessionId: string,
  sessionId?: string,
  handoffId?: string,
): TaskAggregate {
  const value = emptyTaskAggregate(taskId);
  const bootstrapId = `boot_${(taskId ===
  "task_11111111-1111-4111-8111-111111111111"
    ? "1"
    : "2"
  ).repeat(32)}`;
  value.launch = {
    operationId: `intent_${taskId.slice(5)}`,
    bootstrapId,
    requestedAt: "2026-09-19T00:00:00.000Z",
    outcome: "Test reconciliation",
    executionMode: "agent",
    browserIdentity: { mode: "temporary" },
    approvalsReviewer: "auto_review",
    cwd: "/work",
    attachmentIds: [],
  };
  value.record = {
    schemaVersion: 1,
    identity: {
      taskId,
      threadId,
      ...(sessionId
        ? { sessionId, browser: { mode: "temporary" as const } }
        : {}),
    },
    bootstrap: {
      operationId: bootstrapId,
      threadSource: `rove:${taskId}:${bootstrapId}`,
      stage: "complete",
    },
    desiredState: "open",
  };
  value.codexSessionId = codexSessionId;
  value.codex = {
    availability: "available",
    threadExists: true,
    threadId,
    threadSource: value.record.bootstrap.threadSource,
    sourceLookup: "exact",
    runtimeStatus: "active",
    archived: false,
    turn: "active",
    turnId: "turn_a",
  };
  if (sessionId && handoffId)
    value.runtime = {
      availability: "available",
      sessionExists: true,
      sessionId,
      bootstrapId,
      bootstrapLookup: "exact",
      status: "awaiting_human",
      controller: null,
      attachment: "attached",
      profileLock: "released",
      browserIdentity: { mode: "temporary" },
      recovery: "not_needed",
      ownershipGeneration: 2,
      handoffId,
      handoffGeneration: 2,
      observationSeq: 9,
    };
  return value;
}

function historyThread(
  taskId: string,
  sessionId: string,
  handoffId: string,
): CodexThread {
  const bootstrapId = `boot_${"1".repeat(32)}`;
  return {
    id: "thread_a",
    extra: null,
    sessionId: "codex_a",
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
    turns: [
      {
        id: "turn_a",
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
        items: [
          {
            type: "userMessage",
            id: "user_a",
            clientId: "intent_user_a",
            content: [{ type: "text", text: "Do it", text_elements: [] }],
          },
          {
            type: "agentMessage",
            id: "assistant_a",
            text: "Final answer",
            phase: "final_answer",
            memoryCitation: null,
            delivery: null,
            questions: null,
          },
          {
            type: "commandExecution",
            id: "tool_a",
            pluginId: null,
            scriptPath: null,
            command: "true",
            cwd: "/work",
            processId: null,
            source: null,
            status: "completed",
            commandActions: [],
            aggregatedOutput: "done",
            exitCode: 0,
            durationMs: 1,
          },
          {
            type: "mcpToolCall",
            id: "handoff_a",
            server: "rove",
            tool: "control.request_human",
            status: "completed",
            arguments: {
              sessionId,
              reason: "Sign in",
              instruction: "Inspect and continue",
              continuationPolicy: "resume_after_control_return",
            },
            appContext: null,
            pluginId: null,
            readOnlyHint: false,
            result: {
              _meta: null,
              structuredContent: null,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    sessionId,
                    generation: 2,
                    status: "awaiting_human",
                    controller: null,
                    activeHandoffId: handoffId,
                    observationSeq: 9,
                  }),
                },
              ],
            },
            error: null,
            durationMs: 1,
          },
        ],
      },
    ],
  };
}
