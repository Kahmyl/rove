import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskEngine, TaskProcessManager } from "@rove/protocol";

import { DurableContinuationStore } from "./continuations.js";
import { CodexExecutionCore } from "./execution-core.js";
import { FileStateRepository } from "./persistence.js";
import { SqliteTaskStore } from "./sqlite-task-store.js";
import { SqliteTaskEngineStore } from "./sqlite-task-engine-store.js";
import type { CodexRpcPort, CodexThread } from "./protocol.js";
import {
  TaskCapabilityIssuer,
  type ResolvedTaskContext,
} from "./task-coordinator.js";
import { emptyWorkflowConfiguration } from "./workflows.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("CodexExecutionCore cold-start recovery", () => {
  it("keeps local tasks, Workflows, and Outputs readable when Codex cannot start", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "rove-core-offline-"));
    temporaryDirectories.push(stateDirectory);
    const databasePath = join(stateDirectory, "task-process.v1.sqlite3");
    const taskId = "task_12345678-1234-4123-8123-123456789abc";
    const operationId = "intent_12345678-1234-4123-8123-123456789abc";
    const store = new SqliteTaskEngineStore({
      path: databasePath,
      now: () => "2026-09-14T10:00:00.000Z",
    });
    await new TaskEngine(store).accept({
      schemaVersion: 1,
      type: "task_launch_requested",
      eventId: `product:${operationId}`,
      taskId,
      source: {
        kind: "product",
        id: "offline-test",
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-14T10:00:00.000Z",
      operationId,
      launch: {
        operationId,
        bootstrapId: `boot_${"1".repeat(32)}`,
        requestedAt: "2026-09-14T10:00:00.000Z",
        outcome: "Preserve this local work",
        executionMode: "agent",
        approvalsReviewer: "auto_review",
        cwd: "/host/work",
        attachmentIds: [],
      },
    });
    const workflow = store.createWorkflow({
      operationId: "intent_22345678-1234-4123-8123-123456789abc",
      name: "Offline review",
      configuration: emptyWorkflowConfiguration(),
    });
    const result = store.createResult({
      operationId: "intent_32345678-1234-4123-8123-123456789abc",
      taskId,
      kind: "finding_collection",
      title: "Durable local finding",
      body: "This Output remains readable without Codex.",
      source: {
        conversationItemId: "item_local",
        conversationTextDigest: "a".repeat(64),
        evidenceIds: [],
      },
    });
    store.close();

    const core = new CodexExecutionCore({
      isPackaged: false,
      developmentExecutablePath: "/unused/codex",
      clientVersion: "test",
      stateDirectory,
      runtime: {} as never,
      mcpLaunch: { command: "unused", args: [], environment: {} },
    });
    vi.spyOn(core.host, "start").mockRejectedValue(
      new Error("Codex startup unavailable"),
    );
    vi.spyOn(core.host, "stop").mockResolvedValue(undefined);
    vi.spyOn(core.host, "getHealth").mockReturnValue({
      state: "failed",
      ready: false,
      restartAttempt: 1,
      stderrTail: ["private diagnostic"],
    });

    await expect(core.start()).rejects.toThrow("Codex startup unavailable");
    await expect(core.api().readSnapshot()).resolves.toMatchObject({
      host: { ready: false },
      catalog: { account: { status: "unavailable" } },
      tasks: [
        expect.objectContaining({
          taskId,
          results: [expect.objectContaining({ resultId: result.resultId })],
        }),
      ],
      workflows: [expect.objectContaining({ workflowId: workflow.workflowId })],
    });
    await expect(
      core.api().executeRendererIntent({
        type: "task.launch",
        operationId: "intent_42345678-1234-4123-8123-123456789abc",
        input: {
          outcome: "This must remain gated",
          executionMode: "agent",
          approvalsReviewer: "auto_review",
          attachmentIds: [],
          selectedResultIds: [],
        },
      }),
    ).rejects.toThrow("Codex App Server is not ready");
    await core.stop();
  });

  it("quarantines a legacy active handoff without replaying Return Control", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "rove-core-start-"));
    temporaryDirectories.push(stateDirectory);
    const capabilityKey = Buffer.alloc(32, 9);
    await writeFile(
      join(stateDirectory, "task-capability.key"),
      `${capabilityKey.toString("base64url")}\n`,
    );
    const issuer = new TaskCapabilityIssuer(capabilityKey);
    const context: ResolvedTaskContext = {
      roveTaskId: "task_cold",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      selectionSource: "user_selected",
      selectedAt: "2026-09-08T00:00:00Z",
      policy: {
        cwd: "/host/work",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandbox: "workspace-write",
      },
      bootstrap: {
        attemptId: `boot_${"c".repeat(32)}`,
        threadSource: `rove:task_cold:boot_${"c".repeat(32)}`,
        stage: "complete",
      },
      initialLaunch: {
        operationId: "intent_33333333-3333-4333-a333-333333333333",
        inputDigest: "3".repeat(64),
        stage: "turn_started",
        requestedAt: "2026-09-08T00:00:00Z",
        outcome: "Recover the returned browser handoff.",
        turnId: "turn_origin",
      },
      roveSessionId: "ses_cold",
      codexThreadId: "thread_cold",
      codexSessionId: "codex_cold",
      capabilityFingerprint: issuer.issue({
        taskId: "task_cold",
        sessionId: "ses_cold",
        executionMode: "agent",
        browserIdentity: { mode: "temporary" },
      }).fingerprint,
    };
    const legacyPolicy = { ...context.policy } as Partial<
      ResolvedTaskContext["policy"]
    >;
    delete legacyPolicy.approvalsReviewer;
    await new FileStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>(join(stateDirectory, "codex-task-contexts.v2.json"), 3).write(0, {
      contexts: {
        task_cold: { ...context, policy: legacyPolicy } as never,
      },
    });
    const continuationStore = new DurableContinuationStore(
      new FileStateRepository(
        join(stateDirectory, "codex-continuations.v2.json"),
        2,
      ),
    );
    await continuationStore.register({
      roveTaskId: "task_cold",
      codexThreadId: "thread_cold",
      originatingCodexTurnId: "turn_origin",
      roveSessionId: "ses_cold",
      handoffId: "handoff_cold",
      handoffGeneration: 4,
      requestedInstruction: "Inspect current browser truth and continue.",
      continuationPolicy: "resume_after_control_return",
      status: "pending",
      freshInspectionRequired: true,
      preHandoffObservationSeq: 10,
    });
    const ledgerTaskId = "task_bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
    const ledgerSessionId = `ses_${"b".repeat(32)}`;
    const ledgerHandoffId = `handoff_${"b".repeat(32)}`;
    const ledgerBootstrapId = `boot_${"b".repeat(32)}`;
    const ledger = new SqliteTaskStore({
      path: join(stateDirectory, "task-process.v1.sqlite3"),
    });
    await new TaskProcessManager(ledger).accept({
      schemaVersion: 1,
      inputId: "active-ledger-handoff",
      taskId: ledgerTaskId,
      kind: "fact",
      source: "startup-test",
      sourceId: "active-ledger-handoff",
      observedAt: "2026-09-08T00:00:00.000Z",
      launchConfiguration: {
        roveTaskId: ledgerTaskId,
        executionMode: "agent",
        browserIdentity: { mode: "temporary" },
        selectionSource: "user_selected",
        selectedAt: "2026-09-08T00:00:00.000Z",
        policy: {
          cwd: "/host/work",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox: "workspace-write",
        },
        bootstrap: {
          attemptId: ledgerBootstrapId,
          threadSource: `rove:${ledgerTaskId}:${ledgerBootstrapId}`,
          stage: "complete",
        },
        initialLaunch: {
          operationId: "intent_bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
          inputDigest: "b".repeat(64),
          stage: "turn_started",
          requestedAt: "2026-09-08T00:00:00.000Z",
          outcome: "Continue after control return.",
          turnId: "turn_origin",
        },
      },
      lifecycle: {
        record: {
          schemaVersion: 1,
          identity: {
            taskId: ledgerTaskId,
            sessionId: ledgerSessionId,
            threadId: "thread_cold",
            browser: { mode: "temporary" },
          },
          bootstrap: {
            operationId: ledgerBootstrapId,
            threadSource: `rove:${ledgerTaskId}:${ledgerBootstrapId}`,
            stage: "complete",
          },
          desiredState: "open",
        },
        codex: {
          availability: "available",
          threadExists: true,
          threadId: "thread_cold",
          threadSource: `rove:${ledgerTaskId}:${ledgerBootstrapId}`,
          sourceLookup: "exact",
          runtimeStatus: "idle",
          archived: false,
          turn: "completed",
        },
        runtime: {
          availability: "available",
          sessionExists: true,
          sessionId: ledgerSessionId,
          bootstrapId: ledgerBootstrapId,
          bootstrapLookup: "exact",
          status: "active",
          controller: "human",
          attachment: "attached",
          profileLock: "released",
          browserIdentity: { mode: "temporary" },
          recovery: "not_needed",
          ownershipGeneration: 5,
          handoffId: ledgerHandoffId,
          handoffGeneration: 4,
          observationSeq: 10,
        },
        continuation: {
          status: "pending",
          id: `continuation:${ledgerTaskId}:4`,
          taskId: ledgerTaskId,
          sessionId: ledgerSessionId,
          threadId: "thread_cold",
          handoffId: ledgerHandoffId,
          generation: 4,
          policy: "resume_after_control_return",
          freshInspectionRequired: true,
          preHandoffObservationSeq: 10,
        },
        attentions: [],
        freshInspection: null,
        requestedOperation: { type: "observe", taskId: ledgerTaskId },
      },
      durableData: {
        schemaVersion: 1,
        continuation: {
          schemaVersion: 1,
          roveTaskId: ledgerTaskId,
          codexThreadId: "thread_cold",
          originatingCodexTurnId: "turn_origin",
          roveSessionId: ledgerSessionId,
          handoffId: ledgerHandoffId,
          handoffGeneration: 4,
          requestedInstruction: "Inspect current browser truth and continue.",
          continuationPolicy: "resume_after_control_return",
          status: "pending",
          freshInspectionRequired: true,
          preHandoffObservationSeq: 10,
        },
        attentions: [],
        codexSessionId: "codex_cold",
      },
    });
    ledger.recordLegacyImport({
      importId: "legacy_startup_test",
      digest: "0".repeat(64),
      backupPath: join(stateDirectory, "task-process-backups", "seeded"),
      importedAt: "2026-09-08T00:00:00.000Z",
      sources: [],
    });
    await ledger.close();
    const handoffItem = {
      type: "mcpToolCall" as const,
      id: "item_handoff",
      server: "rove",
      tool: "control.request_human",
      status: "completed",
      arguments: {
        sessionId: ledgerSessionId,
        reason: "Complete the human step",
        instruction: "Inspect current browser truth and continue.",
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
              sessionId: ledgerSessionId,
              generation: 4,
              status: "awaiting_human",
              controller: null,
              activeHandoffId: ledgerHandoffId,
              observationSeq: 10,
            }),
          },
        ],
      },
      error: null,
      durationMs: 1,
    };
    const thread: CodexThread = {
      id: "thread_cold",
      extra: null,
      sessionId: "codex_cold",
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
      cwd: "/host/work",
      cliVersion: "0.154.0-alpha.6.2",
      status: { type: "idle" },
      path: null,
      source: "appServer",
      canAcceptDirectInput: true,
      threadSource: `rove:${ledgerTaskId}:${ledgerBootstrapId}`,
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
      turns: [
        {
          id: "turn_origin",
          items: [handoffItem],
          itemsView: "full",
          status: "completed",
          error: null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
        },
      ],
    };
    let returned = false;
    let inspected = false;
    const returnControlForSession = vi.fn(async (sessionId: string) => {
      expect(sessionId).toBe(ledgerSessionId);
      returned = true;
    });
    const inspect = vi.fn(async () => {
      expect(returned).toBe(true);
      inspected = true;
      return { observationSeq: 12 };
    });
    const runtime = {
      listSessionInventory: vi.fn(async () => [
        {
          schemaVersion: 1,
          session: {
            id: ledgerSessionId,
            bootstrapId: ledgerBootstrapId,
            mode: "agent",
            status: "active" as const,
            controller: returned ? ("agent" as const) : ("human" as const),
            profile: { mode: "temporary" },
            ownershipGeneration: 5,
            ...(returned
              ? { lastReturnedHandoffId: ledgerHandoffId }
              : {
                  activeHandoffId: ledgerHandoffId,
                  activeHandoffGeneration: 4,
                }),
          },
          browserIdentity: { mode: "temporary" },
          attachment: "attached",
          recovery: "not_needed",
          profileOwnership: "released",
        },
      ]),
      getSession: vi.fn(async () => ({
        id: ledgerSessionId,
        mode: "agent",
        status: "active" as const,
        controller: returned ? ("agent" as const) : ("human" as const),
        profile: { mode: "temporary" },
      })),
      getControlStatus: vi.fn(async () => ({
        sessionId: ledgerSessionId,
        generation: 5,
        status: "active" as const,
        controller: returned ? ("agent" as const) : ("human" as const),
        ...(returned
          ? { lastReturnedHandoffId: ledgerHandoffId }
          : { activeHandoffId: ledgerHandoffId }),
        observationSeq: inspected ? 12 : returned ? 11 : 10,
        updatedAt: "2026-09-08T00:01:00Z",
      })),
      returnControlForSession,
      inspect,
    };
    const detachRpcListeners: Array<ReturnType<typeof vi.fn>> = [];
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "thread/list") return { data: [thread], nextCursor: null };
      if (method === "thread/resume")
        return { thread, approvalsReviewer: "user" };
      if (method === "thread/read") return { thread };
      if (method === "turn/start") {
        const clientId = (params as { clientUserMessageId: string })
          .clientUserMessageId;
        thread.turns.push({
          id: "turn_continued",
          status: "completed",
          error: null,
          startedAt: 3,
          completedAt: 4,
          durationMs: 1,
          itemsView: "full",
          items: [
            {
              type: "userMessage",
              id: "item_continued",
              clientId,
              content: [
                {
                  type: "text",
                  text: "Continue",
                  text_elements: [],
                },
              ],
            },
          ],
        });
        return {
          turn: { id: "turn_continued", status: "inProgress", items: [] },
        };
      }
      throw new Error(`Unavailable test account call ${method}`);
    });
    const rpc = {
      request,
      notify: vi.fn(),
      respond: vi.fn(),
      onEvent: vi.fn(() => {
        const detach = vi.fn();
        detachRpcListeners.push(detach);
        return detach;
      }),
    } as unknown as CodexRpcPort;
    const stateChanges = vi.fn();
    const recoveryOrder: string[] = [];
    const core = new CodexExecutionCore({
      isPackaged: false,
      developmentExecutablePath: "/unused/codex",
      clientVersion: "test",
      stateDirectory,
      runtime: runtime as never,
      mcpLaunch: { command: "unused", args: [], environment: {} },
      onProductStateChanged: stateChanges,
      onTaskProcessRecoveryPoint: (point) => {
        recoveryOrder.push(point);
      },
    });
    vi.spyOn(core.host, "start").mockResolvedValue(rpc);
    vi.spyOn(core.host, "stop").mockResolvedValue(undefined);
    vi.spyOn(core.host, "getHealth").mockReturnValue({
      state: "ready",
      ready: true,
      connectionId: "connection_test",
      restartAttempt: 0,
      stderrTail: [],
    });

    const api = await core.start();
    await expect(api.readSnapshot()).resolves.toMatchObject({
      tasks: expect.arrayContaining([
        expect.objectContaining({ taskId: ledgerTaskId }),
      ]),
    });
    expect(returnControlForSession).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(
      request.mock.calls.filter(([method]) => method === "turn/start"),
    ).toHaveLength(0);
    const returnResult = await api.executeRendererIntent({
      type: "task.return-control",
      taskId: ledgerTaskId,
      operationId: "intent_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    });
    expect(returnResult).toMatchObject({
      projection: {
        phase: "recovering",
        recoveryRequired: expect.stringContaining("Legacy active task"),
        operationDisposition: { status: "rejected" },
      },
    });
    expect(returnControlForSession).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(
      request.mock.calls.filter(([method]) => method === "turn/start"),
    ).toHaveLength(0);
    expect(recoveryOrder).toEqual([
      "contexts_restored",
      "outbox_recovery_started",
    ]);

    await core.recover("App Server");

    expect(
      (core.host as unknown as { listeners: Set<unknown> }).listeners.size,
    ).toBeGreaterThan(0);
    await core.stop();
    expect(
      (core.host as unknown as { listeners: Set<unknown> }).listeners.size,
    ).toBe(0);
    const ledgerProbe = new SqliteTaskStore({
      path: join(stateDirectory, "task-process.v1.sqlite3"),
    });
    await expect(ledgerProbe.taskState(ledgerTaskId)).resolves.toMatchObject({
      durableData: {
        continuation: { status: "pending" },
        attentions: [],
      },
    });
    await ledgerProbe.close();
    const native = new Database(
      join(stateDirectory, "task-process.v1.sqlite3"),
      { readonly: true },
    );
    const commandTypes = (
      native
        .prepare(
          `SELECT command_type FROM task_command WHERE task_id = ? ORDER BY sequence ASC`,
        )
        .all(ledgerTaskId) as Array<{ command_type: string }>
    ).map((row) => row.command_type);
    native.close();
    expect(commandTypes).toEqual([]);

    await writeFile(
      join(stateDirectory, "codex-continuations.v2.json"),
      "{ malformed after completed migration",
    );
    const restarted = new CodexExecutionCore({
      isPackaged: false,
      developmentExecutablePath: "/unused/codex",
      clientVersion: "test",
      stateDirectory,
      runtime: runtime as never,
      mcpLaunch: { command: "unused", args: [], environment: {} },
    });
    vi.spyOn(restarted.host, "start").mockResolvedValue(rpc);
    vi.spyOn(restarted.host, "stop").mockResolvedValue(undefined);
    vi.spyOn(restarted.host, "getHealth").mockReturnValue({
      state: "ready",
      ready: true,
      connectionId: "connection_restart",
      restartAttempt: 0,
      stderrTail: [],
    });
    await restarted.start();
    expect(
      request.mock.calls.filter(([method]) => method === "turn/start"),
    ).toHaveLength(0);
    await restarted.stop();

    await Promise.all(
      [
        "codex-conversations.v2.json",
        "codex-continuations.v2.json",
        "codex-task-contexts.v2.json",
        "codex-attention.v1.json",
      ].map((name) => rm(join(stateDirectory, name), { force: true })),
    );
    const withoutLegacyFiles = new CodexExecutionCore({
      isPackaged: false,
      developmentExecutablePath: "/unused/codex",
      clientVersion: "test",
      stateDirectory,
      runtime: runtime as never,
      mcpLaunch: { command: "unused", args: [], environment: {} },
    });
    vi.spyOn(withoutLegacyFiles.host, "start").mockResolvedValue(rpc);
    vi.spyOn(withoutLegacyFiles.host, "stop").mockResolvedValue(undefined);
    vi.spyOn(withoutLegacyFiles.host, "getHealth").mockReturnValue({
      state: "ready",
      ready: true,
      connectionId: "connection_no_legacy",
      restartAttempt: 0,
      stderrTail: [],
    });
    await withoutLegacyFiles.start();
    expect(
      request.mock.calls.filter(([method]) => method === "turn/start"),
    ).toHaveLength(0);
    await withoutLegacyFiles.stop();
    expect(
      detachRpcListeners.every((detach) => detach.mock.calls.length === 1),
    ).toBe(true);
  });
});
