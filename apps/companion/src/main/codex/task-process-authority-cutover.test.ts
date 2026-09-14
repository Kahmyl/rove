import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import {
  MemoryTaskStore,
  TaskProcessManager,
  type NativeLifecycleInput,
} from "@rove/protocol";

import { TaskProcessWorker } from "./task-process-worker.js";
import { CodexExecutionCore } from "./execution-core.js";
import { SqliteTaskStore } from "./sqlite-task-store.js";
import type {
  CodexRpcPort,
  CodexServerEvent,
  CodexThread,
} from "./protocol.js";

describe("ledger-only lifecycle authority", () => {
  it("converges an awaiting-human handoff through Return Control and one durable continuation", async () => {
    const store = new MemoryTaskStore();
    const taskId = "task_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const sessionId = `ses_${"a".repeat(32)}`;
    const handoffId = `handoff_${"a".repeat(32)}`;
    const continuationId = "continuation_a";
    const lifecycle: NativeLifecycleInput = {
      record: {
        schemaVersion: 1,
        identity: {
          taskId,
          sessionId,
          threadId: "thread_a",
          browser: { mode: "temporary" },
        },
        bootstrap: {
          operationId: `boot_${"a".repeat(32)}`,
          threadSource: `rove:${taskId}:boot_${"a".repeat(32)}`,
          stage: "complete",
        },
        desiredState: "open",
      },
      codex: {
        availability: "available",
        threadExists: true,
        threadId: "thread_a",
        threadSource: `rove:${taskId}:boot_${"a".repeat(32)}`,
        sourceLookup: "exact",
        runtimeStatus: "idle",
        archived: false,
        turn: "completed",
      },
      runtime: {
        availability: "available",
        sessionExists: true,
        sessionId,
        bootstrapId: `boot_${"a".repeat(32)}`,
        bootstrapLookup: "exact",
        status: "active",
        controller: "human",
        attachment: "attached",
        profileLock: "owned",
        browserIdentity: { mode: "temporary" },
        recovery: "not_needed",
        ownershipGeneration: 2,
        handoffId,
        handoffGeneration: 1,
        observationSeq: 10,
      },
      continuation: {
        status: "pending",
        id: continuationId,
        taskId,
        sessionId,
        threadId: "thread_a",
        handoffId,
        generation: 1,
        policy: "resume_after_control_return",
        freshInspectionRequired: true,
        preHandoffObservationSeq: 10,
      },
      attentions: [
        {
          authority: "rove_control",
          kind: "control_handoff",
          requestId: "control:a",
          taskId,
          sessionId,
          threadId: "thread_a",
          handoffId,
          generation: 1,
          status: "pending",
        },
      ],
      freshInspection: null,
      requestedOperation: {
        type: "return_control",
        taskId,
        operationId: "intent_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        generation: 1,
      },
    };
    await new TaskProcessManager(store).accept({
      schemaVersion: 1,
      inputId: "return-intent",
      taskId,
      kind: "intent",
      source: "test",
      sourceId: "return-intent",
      observedAt: "2026-09-09T12:00:00.000Z",
      lifecycle,
      launchConfiguration: { roveTaskId: taskId },
      durableData: { schemaVersion: 1, attentions: [] },
    });
    const effects: string[] = [];
    const worker = new TaskProcessWorker({
      store,
      workerId: "authority-test",
      generation: 1,
      adapter: {
        execute: async (command, context) => {
          const next = structuredClone(context.lifecycle);
          effects.push(`${command.type}:${command.commandId}`);
          if (command.type === "return_runtime_ownership") {
            next.runtime.controller = "agent";
            next.runtime.lastReturnedHandoffId = handoffId;
            next.runtime.observationSeq = 11;
            delete next.runtime.handoffId;
            delete next.runtime.handoffGeneration;
            next.attentions = next.attentions.map((entry) => ({
              ...entry,
              status: "resolved",
            }));
          } else if (command.type === "inspect_after_return") {
            next.freshInspection = {
              inspectionId: "inspection_a",
              sessionId,
              handoffId,
              generation: 1,
              afterObservationSeq: 11,
            };
          } else if (command.type === "record_return_event") {
            next.continuation.freshInspectionRequired = false;
            next.continuation.returnEventId = command.payload
              .returnEventId as string;
            next.continuation.returnObservationSeq = 11;
          } else if (command.type === "prepare_continuation_command") {
            next.continuation.command = {
              commandId: "continue_authority_test",
              returnEventId: next.continuation.returnEventId!,
              kind: "turn/start",
              dispatchStatus: "not_started",
            };
          } else if (
            command.type === "persist_continuation_dispatch_intent" &&
            next.continuation.command
          ) {
            next.continuation.command.dispatchStatus = "possibly_started";
          } else if (command.type === "dispatch_or_reconcile_continuation") {
            next.continuation.status = "consumed";
            if (next.continuation.command)
              next.continuation.command.dispatchStatus = "terminal";
          }
          next.requestedOperation = { type: "observe", taskId };
          return { status: "succeeded", lifecycle: next };
        },
        reconcile: async (_command, context) => ({
          status: "succeeded",
          lifecycle: context.lifecycle,
        }),
      },
    });

    await worker.runUntilIdle();
    expect((await store.taskState(taskId))?.projection.phase).toBe("ready");
    expect(
      effects.filter((entry) => entry.startsWith("return_runtime")),
    ).toHaveLength(1);
    expect(
      effects.filter((entry) => entry.startsWith("dispatch_or_reconcile")),
    ).toHaveLength(1);
    expect(
      new Set(effects.map((entry) => entry.split(":").slice(1).join(":"))).size,
    ).toBe(effects.length);
  });

  it("quarantines legacy active attention state instead of accepting new responses", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rove-attention-cutover-"));
    const ledgerPath = join(directory, "task-process.v1.sqlite3");
    const taskId = "task_dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const sessionId = `ses_${"d".repeat(32)}`;
    const bootstrapId = `boot_${"d".repeat(32)}`;
    const threadId = "thread_attention";
    const codexSessionId = "codex_attention";
    let core: CodexExecutionCore | undefined;
    let restarted: CodexExecutionCore | undefined;
    try {
      await writeFile(
        join(directory, "task-capability.key"),
        `${Buffer.alloc(32, 13).toString("base64url")}\n`,
      );
      const lifecycle: NativeLifecycleInput = {
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
          ownershipGeneration: 1,
          observationSeq: 1,
        },
        continuation: { status: "none" },
        attentions: [],
        freshInspection: null,
        requestedOperation: { type: "observe", taskId },
      };
      const ledger = new SqliteTaskStore({ path: ledgerPath });
      await new TaskProcessManager(ledger).accept({
        schemaVersion: 1,
        inputId: "attention-seed",
        taskId,
        kind: "fact",
        source: "test",
        sourceId: "attention-seed",
        observedAt: "2026-09-09T12:00:00.000Z",
        lifecycle,
        launchConfiguration: {
          roveTaskId: taskId,
          executionMode: "agent",
          browserIdentity: { mode: "temporary" },
          selectionSource: "user_selected",
          selectedAt: "2026-09-09T12:00:00.000Z",
          policy: {
            cwd: "/work",
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            sandbox: "workspace-write",
          },
          bootstrap: {
            attemptId: bootstrapId,
            threadSource: `rove:${taskId}:${bootstrapId}`,
            stage: "complete",
          },
          initialLaunch: {
            operationId: "intent_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            inputDigest: "d".repeat(64),
            stage: "turn_started",
            requestedAt: "2026-09-09T12:00:00.000Z",
            outcome: "Exercise attention recovery.",
            turnId: "turn_attention",
          },
          roveSessionId: sessionId,
          codexThreadId: threadId,
          codexSessionId,
        },
        durableData: {
          schemaVersion: 1,
          attentions: [],
          codexSessionId,
        },
      });
      ledger.recordLegacyImport({
        importId: "attention-cutover-seed",
        digest: "d".repeat(64),
        backupPath: join(directory, "task-process-backups", "seed"),
        importedAt: "2026-09-09T12:00:00.000Z",
        sources: [],
      });
      await ledger.close();

      const thread: CodexThread = {
        id: threadId,
        extra: null,
        sessionId: codexSessionId,
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
        updatedAt: 1,
        recencyAt: 1,
        cwd: "/work",
        cliVersion: "test",
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
            id: "turn_attention",
            items: [],
            itemsView: "full",
            status: "completed",
            error: null,
            startedAt: 1,
            completedAt: 1,
            durationMs: 0,
          },
        ],
      };
      const listeners = new Set<
        (event: CodexServerEvent) => Promise<void> | void
      >();
      let responseCount = 0;
      const rpc = {
        request: vi.fn(async (method: string) => {
          if (method === "thread/list")
            return { data: [thread], nextCursor: null };
          if (method === "thread/read") return { thread };
          throw new Error(`Unavailable test account call ${method}`);
        }),
        notify: vi.fn(),
        respond: vi.fn(async () => {
          responseCount += 1;
          const probe = new Database(ledgerPath, { readonly: true });
          const row = probe
            .prepare(
              `SELECT command_type, status FROM task_command WHERE task_id = ? ORDER BY sequence DESC LIMIT 1`,
            )
            .get(taskId) as { command_type: string; status: string };
          probe.close();
          expect(row).toEqual({
            command_type: "respond_codex_attention",
            status: "possibly_started",
          });
          throw new Error("simulated response cut");
        }),
        onEvent: vi.fn(
          (listener: (event: CodexServerEvent) => Promise<void> | void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        ),
      } as unknown as CodexRpcPort;
      const runtime = {
        listSessionInventory: vi.fn(async () => [
          {
            schemaVersion: 1 as const,
            session: {
              id: sessionId,
              bootstrapId,
              mode: "agent" as const,
              status: "active" as const,
              controller: "agent" as const,
              profile: { mode: "temporary" as const },
              ownershipGeneration: 1,
            },
            browserIdentity: { mode: "temporary" as const },
            attachment: "attached" as const,
            recovery: "not_needed" as const,
            profileOwnership: "released" as const,
          },
        ]),
        getControlStatus: vi.fn(async () => ({
          sessionId,
          generation: 1,
          status: "active" as const,
          controller: "agent" as const,
          observationSeq: 1,
          updatedAt: "2026-09-09T12:00:00.000Z",
        })),
      };
      const createCore = () => {
        const instance = new CodexExecutionCore({
          isPackaged: false,
          developmentExecutablePath: "/unused/codex",
          clientVersion: "test",
          stateDirectory: directory,
          runtime: runtime as never,
          mcpLaunch: { command: "unused", args: [], environment: {} },
        });
        vi.spyOn(instance.host, "start").mockResolvedValue(rpc);
        vi.spyOn(instance.host, "stop").mockResolvedValue(undefined);
        vi.spyOn(instance.host, "getHealth").mockReturnValue({
          state: "ready",
          ready: true,
          connectionId: "attention-connection",
          restartAttempt: 0,
          stderrTail: [],
        });
        return instance;
      };
      core = createCore();
      const api = await core.start();
      const requestEvent = {
        method: "item/fileChange/requestApproval",
        requestId: "c1:server:71",
        wireRequestId: 71,
        params: {
          threadId,
          turnId: "turn_attention",
          itemId: "item_attention",
          reason: "Approve the file change",
        },
      } as CodexServerEvent;
      await Promise.all(
        [...listeners].map((listener) => listener(requestEvent)),
      );
      const probe = new Database(ledgerPath, { readonly: true });
      const row = probe
        .prepare(
          `SELECT COUNT(*) AS count FROM task_attention WHERE task_id = ?`,
        )
        .get(taskId) as { count: number };
      probe.close();
      expect(row.count).toBe(0);
      await expect(
        api.executeRendererIntent({
          type: "attention.decide",
          taskId,
          requestId: "c1:server:71",
          generation: 1,
          decision: "decline",
        }),
      ).rejects.toThrow(/requires explicit recovery/);
      expect(responseCount).toBe(0);
      await expect(api.readSnapshot()).resolves.toMatchObject({
        tasks: expect.arrayContaining([
          expect.objectContaining({
            taskId,
            lifecycle: {
              phase: "failed",
              reason: expect.stringContaining("Legacy active task"),
            },
          }),
        ]),
      });
    } finally {
      await restarted?.stop().catch(() => undefined);
      await core?.stop().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
