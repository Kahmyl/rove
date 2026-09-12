import { describe, expect, it, vi } from "vitest";

import { OrderedAttentionQueue } from "./attention.js";
import {
  assertRendererProductIntent,
  LOCAL_PRODUCT_API_VERSION,
  LocalProductApi,
  validateTrustedExternalUrl,
} from "./local-product-api.js";
import type { ProductTaskIntent } from "./product-task-port.js";

const workspaceId = "wrk_00000000-0000-4000-8000-000000000001";

function account() {
  return {
    snapshot: () => ({
      account: { status: "logged_in" as const, authMode: "chatgpt" as const },
      models: [],
      rateLimits: null,
      usage: null,
      refreshedAt: "2026-09-07T00:00:00Z",
    }),
    trustedLoginUrl: vi.fn((loginId: string) => {
      if (loginId !== "login_current") throw new Error("Stale login request.");
      return "https://auth.example/current";
    }),
  };
}

function context(mode: "agent" | "companion" | "capture" = "agent") {
  return {
    roveTaskId: "task_existing",
    executionMode: mode,
    browserIdentity: { mode: "workspace" as const, workspaceId },
    selectionSource: "user_selected" as const,
    selectedAt: "2026-09-07T00:00:00Z",
    policy: {
      cwd: "/secret/local/path",
      approvalPolicy: "on-request" as const,
      approvalsReviewer: "auto_review" as const,
      sandbox: "workspace-write" as const,
    },
    bootstrap: {
      attemptId: `boot_${"a".repeat(32)}`,
      threadSource: `rove:task_existing:boot_${"a".repeat(32)}`,
      stage: "complete" as const,
    },
    roveSessionId: "ses_existing",
    codexThreadId: "thread_existing",
    codexSessionId: "codex_session_existing",
    capabilityFingerprint: "f".repeat(64),
  };
}

function fixture(
  mode: "agent" | "capture" = "agent",
  attachments?: {
    listDrafts(): unknown[];
    listAttention(): unknown[];
    listForTask?(taskId: string): unknown[];
    selectDrafts(): Promise<unknown>;
    removeDraft(id: string): Promise<void>;
    replaceDraft(id: string): Promise<unknown>;
    selectPending(identity: unknown): Promise<void>;
    cancelPending(identity: unknown): Promise<void>;
    cleanupTask(taskId: string): Promise<void>;
    reselectTaskAttachment?(
      id: string,
      taskId: string,
      sessionId: string,
      runtime: unknown,
    ): Promise<unknown>;
  },
) {
  const start = vi.fn(async (input) => ({
    context: { ...context(mode), ...input },
  }));
  const startTurn = vi.fn(async (_input?: unknown) => ({
    turn: { id: "turn_new", status: "inProgress" },
  }));
  const launch = vi.fn(async (input) => {
    const started = await start({
      ...input,
      roveTaskId: `task_${crypto.randomUUID()}`,
    });
    if (input.executionMode === "capture") return started;
    const turn = await startTurn({
      taskId: started.context.roveTaskId,
      text: input.outcome,
      clientIntentId: input.operationId,
    });
    return {
      ...started,
      turnId: turn.turn.id,
      status: turn.turn.status,
    };
  });
  const steerTurn = vi.fn(async (_input?: unknown) => ({ turnId: "turn_1" }));
  const interruptTurn = vi.fn(async () => undefined);
  const closeTask = vi.fn(
    async (_taskId?: string, _operationId?: string) => undefined,
  );
  const reselectTaskAttachment = vi.fn(async () => ({
    id: `att_${"c".repeat(32)}`,
    filename: "replacement.txt",
    mimeType: "text/plain",
    size: 3,
    sha256: "c".repeat(64),
    status: "bound" as const,
  }));
  const broker = {
    respond: vi.fn(async (_identity?: unknown, _result?: unknown) => undefined),
  };
  const attention = new OrderedAttentionQueue();
  const tasks = {
    submit: vi.fn(async (input: ProductTaskIntent) => {
      let taskId = input.type === "launch" ? "task_existing" : input.taskId;
      if (input.type === "launch") {
        const started = await launch({
          ...input,
          selectionSource: "user_selected",
        });
        taskId = started.context.roveTaskId;
      } else if (input.type === "message") {
        await steerTurn({ taskId, text: input.message });
      } else if (input.type === "explicit_continuation_response") {
        await steerTurn({ taskId, text: input.message });
        if (await tasks.acknowledgeExplicitResponse(taskId)) {
          const entry = attention
            .list()
            .find(
              (candidate) =>
                candidate.authority === "rove_control" &&
                candidate.taskId === taskId &&
                candidate.status === "pending",
            );
          if (entry)
            attention.resolveExact({
              authority: entry.authority,
              requestId: entry.requestId,
              taskId: entry.taskId,
              ...(entry.threadId ? { threadId: entry.threadId } : {}),
              ...(entry.turnId ? { turnId: entry.turnId } : {}),
              ...(entry.itemId ? { itemId: entry.itemId } : {}),
              generation: entry.generation,
            });
        }
      } else if (input.type === "finish") {
        await closeTask(taskId, input.operationId);
      } else if (input.type === "attention_response") {
        const entry = attention
          .list()
          .find(
            (candidate) =>
              candidate.taskId === taskId &&
              candidate.requestId === input.requestId &&
              candidate.generation === input.generation,
          );
        await tasks.respondAttention({
          taskId,
          requestId: input.requestId,
          generation: input.generation,
          ...(entry?.threadId ? { threadId: entry.threadId } : {}),
          ...(entry?.turnId ? { turnId: entry.turnId } : {}),
          ...(entry?.itemId ? { itemId: entry.itemId } : {}),
          result: input.response,
        });
      }
      return {
        duplicate: false,
        aggregate: { taskId },
        projection: {},
        command: null,
      };
    }),
    launch,
    start,
    startTurn,
    steerTurn,
    interruptTurn,
    closeTask,
    reselectTaskAttachment,
    readTaskProjection: vi.fn(async () => ({
      turnStatus: "in_progress" as const,
      activeTurnId: "turn_1",
    })),
    acknowledgeExplicitResponse: vi.fn(async (_taskId?: string) => false),
    observeTaskLifecycle: vi.fn(async () => undefined),
    respondAttention: vi.fn(async (input) =>
      broker.respond(
        {
          requestId: input.requestId,
          taskId: input.taskId,
          ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
          ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
          ...(input.itemId === undefined ? {} : { itemId: input.itemId }),
          generation: input.generation,
        },
        input.result,
      ),
    ),
    productTasks: vi.fn(async () => [
      {
        context: context(mode),
        lifecycle: { phase: "working" as const, reason: "Codex is working." },
        availableActions: ["message", "interrupt", "finish"] as const,
        runtime: {
          status: "active" as const,
          controller: "agent" as const,
          attachment: "attached" as const,
          recovery: "not_needed" as const,
          profileOwnership: "owned" as const,
        },
        conversation: {
          roveTaskId: "task_existing",
          codexThreadId: "thread_existing",
          codexSessionId: "codex_session_existing",
          roveSessionId: "ses_existing",
          activeTurnId: "turn_1",
          turnStatus: "in_progress",
          explicitSummary: "Safe summary",
          archived: false,
          lastEventSequence: 9,
          items: {
            item_1: {
              id: "item_1",
              turnId: "turn_1",
              kind: "assistant_message",
              status: "completed",
              phase: "commentary",
              startedAt: "2026-09-07T00:00:01.000Z",
              completedAt: "2026-09-07T00:00:02.000Z",
              text: "Safe visible text",
            },
          },
          turnOrder: ["turn_1"],
        },
      },
    ]),
    readTask: vi.fn(async (taskId: string) => {
      const item = (await tasks.productTasks()).find(
        (candidate) => candidate.context.roveTaskId === taskId,
      );
      return item ?? null;
    }),
    taskIdForRuntimeSession: vi.fn(async () => "task_existing"),
    returnControlForTask: vi.fn(async () => "dispatched" as const),
  };
  const warnings: string[] = [];
  const legacyEffects = {
    acknowledgeLegacyEffectScope: vi.fn(async () => undefined),
  };
  const api = new LocalProductApi(
    () => ({
      state: "ready",
      ready: true,
      restartAttempt: 0,
      stderrTail: ["token=host-secret"],
    }),
    account() as never,
    tasks as never,
    broker as never,
    attention,
    "/host-owned/cwd",
    () => warnings,
    attachments as never,
    {} as never,
    legacyEffects,
  );
  return {
    api,
    start,
    startTurn,
    steerTurn,
    interruptTurn,
    closeTask,
    tasks,
    attention,
    broker,
    warnings,
    legacyEffects,
  };
}

describe("LocalProductApi native product seam", () => {
  it("preserves display phase and real item timing through the renderer projection", async () => {
    const { api } = fixture();
    const item = (await api.readSnapshot()).tasks[0]!.conversation!.items
      .item_1!;
    expect(item).toMatchObject({
      phase: "commentary",
      startedAt: "2026-09-07T00:00:01.000Z",
      completedAt: "2026-09-07T00:00:02.000Z",
    });
  });

  it("projects attachment metadata and routes exact renderer attachment intents", async () => {
    const attachments = {
      listDrafts: vi.fn(() => [
        {
          id: `att_${"a".repeat(32)}`,
          filename: "upload.txt",
          mimeType: "text/plain",
          size: 74,
          sha256: "f".repeat(64),
          status: "ready",
        },
      ]),
      listAttention: vi.fn(() => [
        {
          requestId: "file_request_a",
          taskId: "task_existing",
          sessionId: "ses_existing",
          reason: "Choose a file",
          allowMultiple: false,
          status: "waiting",
        },
      ]),
      listForTask: vi.fn(() => []),
      selectDrafts: vi.fn(async () => ({ status: "selected" })),
      removeDraft: vi.fn(async () => undefined),
      replaceDraft: vi.fn(async () => ({ status: "selected" })),
      selectPending: vi.fn(async () => undefined),
      cancelPending: vi.fn(async () => undefined),
      cleanupTask: vi.fn(async () => undefined),
      reselectTaskAttachment: vi.fn(async () => ({
        id: `att_${"c".repeat(32)}`,
        filename: "replacement.txt",
        mimeType: "text/plain",
        size: 3,
        sha256: "c".repeat(64),
        status: "bound",
      })),
    };
    const { api } = fixture("agent", attachments);
    const snapshot = await api.readSnapshot();
    expect(snapshot.draftAttachments[0]?.filename).toBe("upload.txt");
    expect(snapshot.fileAttention[0]?.requestId).toBe("file_request_a");

    await api.executeRendererIntent({ type: "attachments.pick" });
    await api.executeRendererIntent({
      type: "attachments.replace",
      attachmentId: `att_${"a".repeat(32)}`,
    });
    await api.executeRendererIntent({
      type: "file-attention.select",
      requestId: "file_request_a",
      taskId: "task_existing",
      sessionId: "ses_existing",
    });
    await api.executeRendererIntent({
      type: "task.attachment.reselect",
      taskId: "task_existing",
      attachmentId: `att_${"b".repeat(32)}`,
    });
    expect(attachments.selectDrafts).toHaveBeenCalledTimes(1);
    expect(attachments.replaceDraft).toHaveBeenCalledWith(
      `att_${"a".repeat(32)}`,
    );
    expect(attachments.selectPending).toHaveBeenCalledWith({
      requestId: "file_request_a",
      taskId: "task_existing",
      sessionId: "ses_existing",
    });
    expect(attachments.reselectTaskAttachment).toHaveBeenCalledWith(
      `att_${"b".repeat(32)}`,
      "task_existing",
      "ses_existing",
      expect.anything(),
    );
  });

  it("keeps the versioned command and snapshot boundary JSON-serializable", async () => {
    const commandEnvelope = {
      version: LOCAL_PRODUCT_API_VERSION,
      kind: "command" as const,
      payload: {
        type: "task.launch" as const,
        input: {
          outcome: "Book the requested appointment",
          executionMode: "agent" as const,
          browserIdentity: { mode: "workspace" as const, workspaceId },
          approvalsReviewer: "auto_review" as const,
          model: "gpt-test",
          reasoningEffort: "medium",
        },
      },
    };
    const decodedCommand = JSON.parse(JSON.stringify(commandEnvelope)) as {
      version: number;
      kind: string;
      payload: unknown;
    };
    expect(decodedCommand).toEqual(commandEnvelope);
    expect(decodedCommand.version).toBe(LOCAL_PRODUCT_API_VERSION);
    expect(() =>
      assertRendererProductIntent(decodedCommand.payload),
    ).not.toThrow();

    const { api } = fixture();
    const snapshot = await api.readSnapshot();
    const eventEnvelope = {
      version: LOCAL_PRODUCT_API_VERSION,
      sequence: 1,
      kind: "snapshot" as const,
      payload: snapshot,
    };
    const decodedEvent = JSON.parse(JSON.stringify(eventEnvelope)) as {
      version: number;
      sequence: number;
      kind: string;
      payload: { version: number };
    };
    expect(decodedEvent).toEqual(eventEnvelope);
    expect(decodedEvent.version).toBe(LOCAL_PRODUCT_API_VERSION);
    expect(decodedEvent.payload.version).toBe(LOCAL_PRODUCT_API_VERSION);
  });

  it("launches an ordinary task from outcome-only UI input with host-owned policy", async () => {
    const { api, start, startTurn, tasks } = fixture();
    tasks.productTasks.mockResolvedValueOnce([]);
    await api.execute({
      type: "task.launch",
      operationId: "intent_11111111-1111-4111-8111-111111111111",
      input: {
        outcome: "Book the requested appointment",
        executionMode: "agent",
        browserIdentity: { mode: "workspace", workspaceId },
        approvalsReviewer: "auto_review",
      },
    });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        executionMode: "agent",
        browserIdentity: { mode: "workspace", workspaceId },
        selectionSource: "user_selected",
        cwd: "/host-owned/cwd",
        approvalsReviewer: "auto_review",
      }),
    );
    expect(start.mock.calls[0]?.[0].roveTaskId).toMatch(/^task_/);
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Book the requested appointment" }),
    );
  });

  it("carries only opaque attachment ids while coordinator owns finish cleanup", async () => {
    const attachmentId = `att_${"b".repeat(32)}`;
    const attachments = {
      listDrafts: vi.fn(() => [{ id: attachmentId }]),
      listAttention: vi.fn(() => []),
      selectDrafts: vi.fn(async () => ({})),
      removeDraft: vi.fn(async () => undefined),
      replaceDraft: vi.fn(async () => ({})),
      selectPending: vi.fn(async () => undefined),
      cancelPending: vi.fn(async () => undefined),
      cleanupTask: vi.fn(async () => undefined),
    };
    const { api, start, tasks } = fixture("agent", attachments);
    tasks.productTasks.mockResolvedValueOnce([]);
    await api.execute({
      type: "task.launch",
      operationId: "intent_31111111-1111-4111-8111-111111111111",
      input: {
        outcome: "Upload the fixture",
        executionMode: "agent",
        browserIdentity: { mode: "temporary" },
        approvalsReviewer: "auto_review",
        attachmentIds: [attachmentId],
      },
    });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ attachmentIds: [attachmentId] }),
    );
    expect(JSON.stringify(start.mock.calls[0]?.[0])).not.toContain("/tmp");

    await api.executeRendererIntent({
      type: "task.message",
      taskId: "task_existing",
      operationId: "intent_32222222-2222-4222-8222-222222222222",
      outcome: "Use the follow-up attachment",
      attachmentIds: [attachmentId],
    });
    expect(tasks.submit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "message",
        attachmentIds: [attachmentId],
      }),
    );

    await api.execute({
      type: "task.close",
      taskId: "task_existing",
      operationId: "intent_41111111-1111-4111-8111-111111111111",
    });
    expect(attachments.cleanupTask).not.toHaveBeenCalled();
  });

  it("treats Archive on an open task as a durable finish-and-archive request", async () => {
    const { api, tasks } = fixture();
    const operationId = "intent_42222222-2222-4222-8222-222222222222";

    await api.executeRendererIntent({
      type: "task.archive",
      taskId: "task_existing",
      operationId,
    });

    expect(tasks.submit).toHaveBeenLastCalledWith({
      type: "finish",
      taskId: "task_existing",
      operationId,
    });
  });

  it("lets Archive recover and close a cleanup-only task", async () => {
    const { api, tasks } = fixture();
    const operationId = "intent_43222222-2222-4222-8222-222222222222";
    const task = (await tasks.productTasks())[0]!;
    tasks.productTasks.mockResolvedValueOnce([
      {
        ...task,
        lifecycle: {
          phase: "cleanup_required" as const,
          reason: "Interrupted cleanup is pending.",
        },
        availableActions: ["retry_cleanup"] as const,
      },
    ] as never);

    await api.executeRendererIntent({
      type: "task.archive",
      taskId: "task_existing",
      operationId,
    });

    expect(tasks.submit).toHaveBeenLastCalledWith({
      type: "retry_cleanup",
      taskId: "task_existing",
      operationId,
    });
  });

  it("forwards Always ask and rejects omitted or unsupported review choices", async () => {
    const { api, start, tasks } = fixture();
    tasks.productTasks.mockResolvedValue([]);
    await api.execute({
      type: "task.launch",
      operationId: "intent_21111111-1111-4111-8111-111111111111",
      input: {
        outcome: "Ask before permissions",
        executionMode: "agent",
        browserIdentity: { mode: "temporary" },
        approvalsReviewer: "user",
      },
    });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ approvalsReviewer: "user" }),
    );
    for (const approvalsReviewer of [undefined, null, "automatic"]) {
      await expect(
        api.execute({
          type: "task.launch",
          operationId: `intent_${crypto.randomUUID()}`,
          input: {
            outcome: "Reject invalid review",
            executionMode: "agent",
            browserIdentity: { mode: "temporary" },
            approvalsReviewer,
          } as never,
        }),
      ).rejects.toThrow(/approvals reviewer/);
    }
  });

  it("starts Capture human-owned without starting a Codex agent turn", async () => {
    const { api, start, startTurn, tasks } = fixture("capture");
    tasks.productTasks.mockResolvedValueOnce([]);
    await api.execute({
      type: "task.launch",
      operationId: "intent_22222222-2222-4222-8222-222222222222",
      input: {
        outcome: "Show how I reconcile this page",
        executionMode: "capture",
        browserIdentity: { mode: "temporary" },
        approvalsReviewer: "auto_review",
      },
    });
    expect(start).toHaveBeenCalledOnce();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("allows another task while an existing task is working when it uses a fresh browser profile", async () => {
    const { api, start } = fixture();

    await api.execute({
      type: "task.launch",
      operationId: "intent_23222222-2222-4222-8222-222222222222",
      input: {
        outcome: "Run independently",
        executionMode: "agent",
        browserIdentity: { mode: "temporary" },
        approvalsReviewer: "auto_review",
      },
    });

    expect(start).toHaveBeenCalledOnce();
  });

  it("rejects reuse of a saved browser profile still owned by another open task", async () => {
    const { api, start } = fixture();

    await expect(
      api.execute({
        type: "task.launch",
        operationId: "intent_24222222-2222-4222-8222-222222222222",
        input: {
          outcome: "Do not share the browser profile",
          executionMode: "agent",
          browserIdentity: { mode: "workspace", workspaceId },
          approvalsReviewer: "auto_review",
        },
      }),
    ).rejects.toThrow(/still attached/);
    expect(start).not.toHaveBeenCalled();
  });

  it("does not silently switch a saved profile that a dormant task still has attached", async () => {
    const { api, start, tasks } = fixture();
    const existing = (await tasks.productTasks())[0]!;
    tasks.productTasks.mockResolvedValueOnce([
      {
        ...existing,
        lifecycle: { phase: "ready", reason: "Ready." },
        conversation: {
          ...existing.conversation!,
          activeTurnId: undefined,
          turnStatus: "completed",
        },
      },
    ] as never);

    await expect(
      api.execute({
        type: "task.launch",
        operationId: "intent_25222222-2222-4222-8222-222222222222",
        input: {
          outcome: "Keep the selected saved profile",
          executionMode: "agent",
          browserIdentity: { mode: "workspace", workspaceId },
          approvalsReviewer: "auto_review",
        },
      }),
    ).rejects.toThrow(/still attached/);

    expect(start).not.toHaveBeenCalled();
  });

  it("advances a closed current task to the oldest cleanup task without blocking a fresh-profile launch", async () => {
    const { api, tasks, start } = fixture();
    await expect(api.readSnapshot()).resolves.toMatchObject({
      currentTaskId: "task_existing",
    });
    const base = (await tasks.productTasks())[0]!;
    const blocker = {
      ...base,
      context: { ...base.context, roveTaskId: "task_oldest_blocker" },
      lifecycle: {
        phase: "cleanup_required" as const,
        reason: "Runtime cleanup is unconfirmed.",
      },
      availableActions: ["retry_cleanup", "finish"] as const,
    };
    const histories = Array.from({ length: 12 }, (_, index) => ({
      ...base,
      context: { ...base.context, roveTaskId: `task_closed_${index}` },
      lifecycle: { phase: "closed" as const, reason: "Closed." },
      availableActions: [] as const,
    }));
    const all = [
      {
        ...base,
        lifecycle: { phase: "closed" as const, reason: "Closed." },
        availableActions: [] as const,
      },
      blocker,
      ...histories,
    ];
    tasks.productTasks.mockResolvedValue(all as never);

    await expect(api.readSnapshot()).resolves.toMatchObject({
      currentTaskId: "task_oldest_blocker",
      tasks: expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_oldest_blocker",
          availableActions: ["retry_cleanup", "finish"],
        }),
      ]),
    });
    await expect(
      api.executeRendererIntent({
        type: "task.launch",
        operationId: "intent_77777777-7777-4777-8777-777777777777",
        input: {
          outcome: "Must remain blocked",
          executionMode: "agent",
          browserIdentity: { mode: "temporary" },
          approvalsReviewer: "auto_review",
        },
      }),
    ).resolves.toBeDefined();
    expect(start).toHaveBeenCalledOnce();
  });

  it("omits currentTaskId when only terminal history remains", async () => {
    const { api, tasks } = fixture();
    await expect(api.readSnapshot()).resolves.toMatchObject({
      currentTaskId: "task_existing",
    });
    const base = (await tasks.productTasks())[0]!;
    tasks.productTasks.mockResolvedValue([
      {
        ...base,
        lifecycle: { phase: "closed", reason: "Closed." },
        availableActions: [],
      },
      {
        ...base,
        context: { ...base.context, roveTaskId: "task_failed_history" },
        lifecycle: { phase: "failed", reason: "Failed." },
        availableActions: [],
      },
    ] as never);

    const result = await api.readSnapshot();
    expect(result).not.toHaveProperty("currentTaskId");
    expect(result.tasks.map((task) => task.taskId)).toEqual([
      "task_existing",
      "task_failed_history",
    ]);
  });

  it("rejects every internal command at the renderer runtime boundary before mutation", async () => {
    const {
      api,
      start,
      startTurn,
      steerTurn,
      interruptTurn,
      closeTask,
      broker,
    } = fixture();
    const internalInputs: unknown[] = [
      {
        type: "task.start",
        input: {
          roveTaskId: "task_renderer_selected",
          cwd: "/renderer/selected/cwd",
          selectionSource: "recovered",
        },
      },
      { type: "task.resume", input: { roveTaskId: "task_historical" } },
      { type: "task.close", taskId: "task_historical" },
      { type: "task.thread.read", taskId: "task_historical" },
      { type: "task.thread.archive", taskId: "task_historical" },
      { type: "task.thread.unarchive", taskId: "task_historical" },
      { type: "task.turn.start", intent: { taskId: "task_historical" } },
      { type: "task.turn.steer", intent: { taskId: "task_historical" } },
      { type: "task.turn.interrupt", taskId: "task_historical" },
      { type: "continuation.reconcile", taskId: "task_historical" },
      { type: "continuation.cancel", identity: {} },
      {
        type: "attention.respond",
        requestId: "request_any",
        taskId: "task_historical",
        generation: 1,
        result: { arbitrary: "renderer-selected" },
      },
    ];
    for (const input of internalInputs)
      await expect(api.executeRendererIntent(input)).rejects.toThrow(
        /Unsupported renderer product intent/,
      );
    expect(start).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
    expect(steerTurn).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(closeTask).not.toHaveBeenCalled();
    expect(broker.respond).not.toHaveBeenCalled();
  });

  it("host-binds every allowed live renderer intent and rejects injected addressing", async () => {
    const {
      api,
      start,
      steerTurn,
      interruptTurn,
      closeTask,
      tasks,
      attention,
      broker,
      legacyEffects,
    } = fixture();
    const activeTask = (await tasks.productTasks())[0]!;
    tasks.productTasks.mockResolvedValue([
      {
        ...activeTask,
        availableActions: [
          ...activeTask.availableActions,
          "acknowledge_legacy_effects",
        ],
      },
    ] as never);
    await api.executeRendererIntent({
      type: "task.effects.acknowledge",
      taskId: "task_existing",
    });
    expect(legacyEffects.acknowledgeLegacyEffectScope).toHaveBeenCalledWith(
      "ses_existing",
    );
    tasks.productTasks.mockResolvedValueOnce([]);
    await api.executeRendererIntent({
      type: "task.launch",
      operationId: "intent_44444444-4444-4444-8444-444444444444",
      input: {
        outcome: "Host-bound launch",
        executionMode: "agent",
        browserIdentity: { mode: "temporary" },
        approvalsReviewer: "auto_review",
      },
    });
    expect(start.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        cwd: "/host-owned/cwd",
        selectionSource: "user_selected",
      }),
    );
    await api.executeRendererIntent({
      type: "task.message",
      taskId: "task_existing",
      operationId: "intent_55555555-5555-4555-8555-555555555555",
      outcome: "Continue safely",
    });
    expect(steerTurn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task_existing" }),
    );
    await api.executeRendererIntent({
      type: "task.stop",
      taskId: "task_existing",
      operationId: "intent_66666666-6666-4666-8666-666666666666",
    });
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(closeTask).toHaveBeenCalledWith(
      "task_existing",
      "intent_66666666-6666-4666-8666-666666666666",
    );

    tasks.productTasks.mockResolvedValueOnce([
      {
        ...(await tasks.productTasks())[0]!,
        lifecycle: {
          phase: "cleanup_required" as const,
          reason: "Runtime recovery requires cleanup.",
        },
        availableActions: ["retry_cleanup"] as const,
      },
    ] as never);
    await api.executeRendererIntent({
      type: "task.stop",
      taskId: "task_existing",
      operationId: "intent_67666666-6666-4666-8666-666666666666",
    });
    expect(tasks.submit).toHaveBeenLastCalledWith({
      type: "retry_cleanup",
      taskId: "task_existing",
      operationId: "intent_67666666-6666-4666-8666-666666666666",
    });

    tasks.productTasks.mockResolvedValueOnce([
      {
        ...(await tasks.productTasks())[0]!,
        lifecycle: {
          phase: "cleanup_required" as const,
          reason: "Finish may supersede recovery.",
        },
        availableActions: ["retry_cleanup", "finish"] as const,
      },
    ] as never);
    await api.executeRendererIntent({
      type: "task.stop",
      taskId: "task_existing",
      operationId: "intent_68666666-6666-4666-8666-666666666666",
    });
    expect(tasks.submit).toHaveBeenLastCalledWith({
      type: "finish",
      taskId: "task_existing",
      operationId: "intent_68666666-6666-4666-8666-666666666666",
    });

    attention.enqueue({
      authority: "codex",
      kind: "command_approval",
      method: "item/commandExecution/requestApproval",
      requestId: "approval_current",
      taskId: "task_existing",
      threadId: "thread_existing",
      turnId: "turn_1",
      generation: 4,
      payload: { command: "pnpm test" },
    });
    await expect(
      api.executeRendererIntent({
        type: "attention.decide",
        taskId: "task_existing",
        requestId: "approval_current",
        generation: 4,
        decision: "accept",
        form: { arbitrary: "renderer-selected" },
      }),
    ).rejects.toThrow(/does not accept response content/);
    expect(broker.respond).not.toHaveBeenCalled();
    await api.executeRendererIntent({
      type: "attention.decide",
      taskId: "task_existing",
      requestId: "approval_current",
      generation: 4,
      decision: "accept",
    });
    expect(broker.respond).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task_existing",
        threadId: "thread_existing",
        turnId: "turn_1",
      }),
      expect.anything(),
    );

    for (const injected of [
      {
        type: "task.message",
        taskId: "task_historical",
        outcome: "Retarget",
      },
      { type: "task.stop", taskId: "task_historical" },
      {
        type: "attention.decide",
        requestId: "approval_current",
        generation: 4,
        decision: "accept",
        taskId: "task_historical",
      },
      {
        type: "task.launch",
        input: {
          outcome: "Unsafe",
          executionMode: "agent",
          browserIdentity: { mode: "temporary" },
          cwd: "/renderer/cwd",
          roveTaskId: "task_renderer",
          selectionSource: "recovered",
          approvalPolicy: "never",
          sandbox: "danger-full-access",
        },
      },
    ] as unknown[])
      await expect(api.executeRendererIntent(injected)).rejects.toThrow(
        /unsupported field|invalid|not found|stale or mismatched/i,
      );
  });

  it("routes visible pre-thread bootstrap cleanup without requiring a complete Codex projection", async () => {
    const { api, tasks, closeTask, interruptTurn } = fixture();
    tasks.productTasks.mockResolvedValue([
      {
        context: {
          ...context(),
          bootstrap: {
            ...context().bootstrap,
            stage: "thread_dispatching",
          },
          codexThreadId: undefined,
          codexSessionId: undefined,
          initialLaunch: {
            operationId: "intent_77777777-7777-4777-a777-777777777777",
            inputDigest: "7".repeat(64),
            stage: "requested",
            requestedAt: "2026-09-07T00:00:00Z",
            outcome: "Pending initial launch",
          },
        },
        lifecycle: { phase: "starting", reason: "Still converging." },
        availableActions: ["finish"],
        runtime: {
          status: "active",
          controller: "agent",
          attachment: "attached",
          recovery: "not_needed",
          profileOwnership: "owned",
        },
      },
    ] as never);

    await api.executeRendererIntent({
      type: "task.stop",
      taskId: "task_existing",
      operationId: "intent_88888888-8888-4888-a888-888888888888",
    });

    expect(tasks.readTaskProjection).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(closeTask).toHaveBeenCalledWith(
      "task_existing",
      "intent_88888888-8888-4888-a888-888888888888",
    );
  });

  it("redacts host diagnostics, task policy, capability, and raw attention payload", async () => {
    const { api, attention } = fixture();
    attention.enqueue({
      authority: "rove_control",
      kind: "control_handoff",
      requestId: "control:ses_existing:1",
      taskId: "task_existing",
      generation: 1,
      payload: {
        instruction: "Complete sign-in",
        token: "renderer-must-not-see-this",
        cookies: "renderer-must-not-see-this",
        userDataDir: "/secret/browser/profile",
      },
    });
    const serialized = JSON.stringify(await api.readSnapshot());
    expect(serialized).toContain("Complete sign-in");
    for (const forbidden of [
      "renderer-must-not-see-this",
      "userDataDir",
      "capabilityFingerprint",
      "codexSessionId",
      "/secret/local/path",
      "token=host-secret",
      "lastEventSequence",
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it("enforces finite renderer projection bounds on conversations, attention, and recovery", async () => {
    const { api, tasks, attention, warnings } = fixture();
    const huge = "x".repeat(4_000);
    const attentionHuge = "y".repeat(400);
    const manyItems = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [
        `item_${index}`,
        {
          id: `item_${index}${huge}`,
          turnId: `turn_${index}${huge}`,
          kind: "assistant_message",
          status: "completed",
          text: huge,
        },
      ]),
    );
    tasks.productTasks.mockResolvedValue([
      {
        context: context(),
        conversation: {
          roveTaskId: "task_existing",
          codexThreadId: "thread_existing",
          codexSessionId: "never-render",
          roveSessionId: "ses_existing",
          turnStatus: "completed",
          explicitSummary: huge,
          archived: false,
          lastEventSequence: 999,
          items: manyItems,
          turnOrder: Array.from(
            { length: 100 },
            (_, index) => `turn_${index}${huge}`,
          ),
        },
      },
    ] as never);
    for (let index = 0; index < 6; index += 1)
      attention.enqueue({
        authority: "codex",
        kind: "user_input",
        method: "item/tool/requestUserInput",
        requestId: `question_${index}`,
        taskId: "task_existing",
        generation: 1,
        payload: {
          prompt: attentionHuge,
          questions: Array.from({ length: 7 }, (_, question) => ({
            id: `q_${question}`,
            header: attentionHuge,
            question: attentionHuge,
            isOther: true,
            isSecret: false,
            options: Array.from({ length: 8 }, (_, option) => ({
              label: `option_${option}`,
              description: attentionHuge,
            })),
          })),
        },
      });
    warnings.push(
      ...Array.from(
        { length: 100 },
        (_, index) => `${index}:${"warning".repeat(200)}`,
      ),
    );
    const projected = await api.readSnapshot();
    const conversation = projected.tasks[0]!.conversation!;
    expect(Object.keys(conversation.items)).toHaveLength(128);
    expect(conversation.turnOrder).toHaveLength(64);
    expect(conversation.explicitSummary).toHaveLength(2_000);
    expect(JSON.stringify(conversation)).not.toContain("never-render");
    expect(projected.attention[0]!.questions).toHaveLength(3);
    expect(projected.attention[0]!.questions![0]!.options).toHaveLength(3);
    expect(
      projected.attention[0]!.questions![0]!.header.length,
    ).toBeLessThanOrEqual(80);
    expect(projected.recoveryWarnings).toHaveLength(64);
    expect(projected.recoveryWarnings[0]!.length).toBeLessThanOrEqual(500);
  });

  it("carries exact attention identity and rejects a stale decision before response", async () => {
    const { api, attention, broker } = fixture();
    attention.enqueue({
      authority: "codex",
      kind: "file_approval",
      method: "item/fileChange/requestApproval",
      requestId: "approval_1",
      taskId: "task_existing",
      threadId: "thread_existing",
      turnId: "turn_1",
      itemId: "item_1",
      generation: 4,
      payload: {},
    });
    const command = {
      type: "attention.decide" as const,
      requestId: "approval_1",
      taskId: "task_existing",
      threadId: "thread_existing",
      turnId: "turn_1",
      itemId: "item_1",
      generation: 3,
      decision: "decline" as const,
    };
    await expect(api.execute(command)).rejects.toThrow(/Stale or mismatched/);
    expect(broker.respond).not.toHaveBeenCalled();
    await api.execute({ ...command, generation: 4 });
    expect(broker.respond).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "approval_1",
        taskId: "task_existing",
        generation: 4,
      }),
      { decision: "decline" },
    );
  });

  it("does not alias opaque attention identities sharing the first 200 characters", async () => {
    const { api, attention, broker } = fixture();
    const prefix = "r".repeat(200);
    for (const suffix of ["_left", "_right"])
      attention.enqueue({
        authority: "codex",
        kind: "file_approval",
        method: "item/fileChange/requestApproval",
        requestId: `${prefix}${suffix}`,
        taskId: "task_existing",
        generation: 5,
        payload: {},
      });
    expect(
      (await api.readSnapshot()).attention.map((entry) => entry.requestId),
    ).toEqual([`${prefix}_left`, `${prefix}_right`]);
    await api.execute({
      type: "attention.decide",
      requestId: `${prefix}_right`,
      taskId: "task_existing",
      generation: 5,
      decision: "decline",
    });
    expect(broker.respond).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: `${prefix}_right` }),
      { decision: "decline" },
    );
  });

  it("keeps explicit-response handoff attention until the user response is dispatched", async () => {
    const { api, attention, tasks } = fixture();
    tasks.acknowledgeExplicitResponse.mockResolvedValue(true);
    attention.enqueue({
      authority: "rove_control",
      kind: "control_handoff",
      requestId: "control:ses_existing:handoff_explicit",
      taskId: "task_existing",
      threadId: "thread_existing",
      turnId: "turn_1",
      generation: 4,
      payload: {
        instruction: "Wait for the user's answer.",
        policy: "explicit_user_response",
      },
    });
    expect((await api.readSnapshot()).attention[0]).toMatchObject({
      status: "pending",
      continuationPolicy: "explicit_user_response",
    });
    await api.execute({
      type: "task.message",
      taskId: "task_existing",
      operationId: "intent_33333333-3333-4333-8333-333333333333",
      outcome: "Use the confirmed address.",
    });
    expect(tasks.steerTurn).toHaveBeenCalledOnce();
    expect(tasks.acknowledgeExplicitResponse).toHaveBeenCalledWith(
      "task_existing",
    );
    expect(attention.list()[0]!.status).toBe("resolved");
  });

  it("projects and answers every user-input question by exact id, including Other and secret", async () => {
    const { api, attention, broker } = fixture();
    attention.enqueue({
      authority: "codex",
      kind: "user_input",
      method: "item/tool/requestUserInput",
      requestId: "questions_1",
      taskId: "task_existing",
      threadId: "thread_existing",
      turnId: "turn_1",
      itemId: "item_1",
      generation: 2,
      payload: {
        questions: [
          {
            id: "region",
            header: "Region",
            question: "Which region?",
            isOther: false,
            isSecret: false,
            options: [{ label: "West", description: "Western region" }],
          },
          {
            id: "note",
            header: "Private note",
            question: "Enter the private note",
            isOther: true,
            isSecret: true,
            options: null,
          },
        ],
      },
    });
    const projected = (await api.readSnapshot()).attention[0]!;
    expect(projected.questions).toEqual([
      expect.objectContaining({
        id: "region",
        isOther: false,
        isSecret: false,
      }),
      expect.objectContaining({ id: "note", isOther: true, isSecret: true }),
    ]);
    await api.execute({
      type: "attention.decide",
      requestId: "questions_1",
      taskId: "task_existing",
      threadId: "thread_existing",
      turnId: "turn_1",
      itemId: "item_1",
      generation: 2,
      decision: "accept",
      answers: { region: ["West"], note: ["keep private"] },
    });
    expect(broker.respond).toHaveBeenCalledWith(expect.anything(), {
      answers: {
        region: { answers: ["West"] },
        note: { answers: ["keep private"] },
      },
    });
  });

  it("preserves distinct MCP form accept, decline, cancel, and trusted URL identities", async () => {
    for (const decision of ["accept", "decline", "cancel"] as const) {
      const { api, attention, broker } = fixture();
      attention.enqueue({
        authority: "codex",
        kind: "mcp_elicitation",
        method: "mcpServer/elicitation/request",
        requestId: `form_${decision}`,
        taskId: "task_existing",
        generation: 3,
        payload: {
          mode: "form",
          message: "Supply shipping preferences",
          serverName: "shipping",
          requestedSchema: {
            type: "object",
            required: ["speed"],
            properties: {
              speed: { type: "string", title: "Speed", enum: ["slow", "fast"] },
              insured: { type: "boolean", title: "Insured" },
            },
          },
        },
      });
      await api.execute({
        type: "attention.decide",
        requestId: `form_${decision}`,
        taskId: "task_existing",
        generation: 3,
        decision,
        ...(decision === "accept"
          ? { form: { speed: "fast", insured: true } }
          : {}),
      });
      expect(broker.respond).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: decision,
          content:
            decision === "accept" ? { speed: "fast", insured: true } : null,
        }),
      );
    }

    const { api, attention } = fixture();
    attention.enqueue({
      authority: "codex",
      kind: "mcp_elicitation",
      method: "mcpServer/elicitation/request",
      requestId: "url_current",
      taskId: "task_existing",
      threadId: "thread_existing",
      turnId: "turn_1",
      generation: 7,
      payload: {
        mode: "url",
        message: "Connect account",
        url: "https://tool.example/connect",
      },
    });
    await expect(
      api.resolveTrustedExternalUrl({
        purpose: "mcp_elicitation",
        taskId: "task_existing",
        requestId: "url_current",
        generation: 7,
      }),
    ).resolves.toBe("https://tool.example/connect");
    expect(JSON.stringify((await api.readSnapshot()).attention)).not.toContain(
      "https://tool.example/connect",
    );
    await expect(
      api.resolveTrustedExternalUrl({
        purpose: "mcp_elicitation",
        taskId: "task_existing",
        requestId: "url_current",
        generation: 6,
      }),
    ).rejects.toThrow(/Stale or mismatched/);
    attention.cancel("codex", "url_current");
    await expect(
      api.resolveTrustedExternalUrl({
        purpose: "mcp_elicitation",
        taskId: "task_existing",
        requestId: "url_current",
        generation: 7,
      }),
    ).rejects.toThrow(/no longer active/);
    await expect(
      api.resolveTrustedExternalUrl({
        purpose: "account_login",
        loginId: "login_current",
      }),
    ).resolves.toBe("https://auth.example/current");
    await expect(
      api.resolveTrustedExternalUrl({
        purpose: "account_login",
        loginId: "old",
      }),
    ).rejects.toThrow(/Stale/);
    expect(validateTrustedExternalUrl("https://valid.example/path")).toBe(
      "https://valid.example/path",
    );
    expect(() => validateTrustedExternalUrl("http://valid.example")).toThrow(
      /HTTPS/,
    );
    expect(() => validateTrustedExternalUrl("not a url")).toThrow(/malformed/);
  });

  it("preserves MCP form constraints and defaults without clamping or partial projection", async () => {
    const { api, attention, broker } = fixture();
    attention.enqueue({
      authority: "codex",
      kind: "mcp_elicitation",
      method: "mcpServer/elicitation/request",
      requestId: "form_semantics",
      taskId: "task_existing",
      generation: 8,
      payload: {
        mode: "form",
        message: "Exact values",
        requestedSchema: {
          type: "object",
          required: ["quantity", "recipients"],
          properties: {
            quantity: {
              type: "number",
              minimum: -25.5,
              maximum: 1_000_000_000,
              default: -2,
            },
            email: { type: "string", format: "email", default: "a@b.test" },
            recipients: {
              type: "array",
              items: { type: "string", enum: ["alpha", "beta", "gamma"] },
              minItems: 1,
              maxItems: 2,
              default: ["alpha"],
            },
          },
        },
      },
    });
    const projected = (await api.readSnapshot()).attention[0]!.elicitation!;
    expect(projected.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "quantity",
          minimum: -25.5,
          maximum: 1_000_000_000,
          default: -2,
        }),
        expect.objectContaining({
          id: "recipients",
          minItems: 1,
          maxItems: 2,
          default: ["alpha"],
        }),
      ]),
    );
    await api.execute({
      type: "attention.decide",
      requestId: "form_semantics",
      taskId: "task_existing",
      generation: 8,
      decision: "accept",
      form: {},
    });
    expect(broker.respond).toHaveBeenCalledWith(expect.anything(), {
      _meta: null,
      action: "accept",
      content: {
        quantity: -2,
        email: "a@b.test",
        recipients: ["alpha"],
      },
    });

    const oversized = fixture();
    oversized.attention.enqueue({
      authority: "codex",
      kind: "mcp_elicitation",
      method: "mcpServer/elicitation/request",
      requestId: "form_oversized",
      taskId: "task_existing",
      generation: 9,
      payload: {
        mode: "form",
        message: "Too many fields",
        requestedSchema: {
          type: "object",
          properties: Object.fromEntries(
            Array.from({ length: 17 }, (_, index) => [
              `field_${index}`,
              { type: "string" },
            ]),
          ),
        },
      },
    });
    expect(
      (await oversized.api.readSnapshot()).attention[0]!.elicitation,
    ).toEqual(
      expect.objectContaining({
        fields: [],
        unsupportedReason: expect.any(String),
      }),
    );
    await expect(
      oversized.api.execute({
        type: "attention.decide",
        requestId: "form_oversized",
        taskId: "task_existing",
        generation: 9,
        decision: "accept",
        form: {},
      }),
    ).rejects.toThrow(/more than 16 fields/);
  });

  it("preserves empty-string options and rejects impossible defaults and calendar values", async () => {
    const valid = fixture();
    valid.attention.enqueue({
      authority: "codex",
      kind: "mcp_elicitation",
      method: "mcpServer/elicitation/request",
      requestId: "form_exact_dates",
      taskId: "task_existing",
      generation: 10,
      payload: {
        mode: "form",
        message: "Exact schema",
        requestedSchema: {
          type: "object",
          required: ["empty", "leap", "instant"],
          properties: {
            empty: { type: "string", enum: [""], default: "" },
            leap: { type: "string", format: "date", default: "2024-02-29" },
            instant: {
              type: "string",
              format: "date-time",
              default: "2026-09-08T12:34:56+01:00",
            },
          },
        },
      },
    });
    const projected = (await valid.api.readSnapshot()).attention[0]!
      .elicitation!;
    expect(projected.unsupportedReason).toBeUndefined();
    expect(projected.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "empty",
          options: [{ value: "", label: "" }],
          default: "",
        }),
        expect.objectContaining({
          id: "instant",
          default: "2026-09-08T12:34:56+01:00",
        }),
      ]),
    );
    await valid.api.execute({
      type: "attention.decide",
      requestId: "form_exact_dates",
      taskId: "task_existing",
      generation: 10,
      decision: "accept",
      form: {},
    });
    expect(valid.broker.respond).toHaveBeenCalledWith(expect.anything(), {
      _meta: null,
      action: "accept",
      content: {
        empty: "",
        leap: "2024-02-29",
        instant: "2026-09-08T12:34:56+01:00",
      },
    });

    for (const [requestId, field] of [
      ["empty_enum", { type: "string", enum: [] }],
      ["bad_number_default", { type: "number", minimum: 2, default: 1 }],
      ["bad_option_default", { type: "string", enum: ["a"], default: "b" }],
      ["bad_day", { type: "string", format: "date", default: "2023-02-29" }],
      [
        "bad_datetime_day",
        {
          type: "string",
          format: "date-time",
          default: "2026-02-30T12:00:00Z",
        },
      ],
      [
        "local_datetime",
        { type: "string", format: "date-time", default: "2026-09-08T12:00" },
      ],
    ] as const) {
      const invalid = fixture();
      invalid.attention.enqueue({
        authority: "codex",
        kind: "mcp_elicitation",
        method: "mcpServer/elicitation/request",
        requestId,
        taskId: "task_existing",
        generation: 11,
        payload: {
          mode: "form",
          message: "Invalid schema",
          requestedSchema: {
            type: "object",
            properties: { value: field },
          },
        },
      });
      expect(
        (await invalid.api.readSnapshot()).attention[0]!.elicitation,
      ).toEqual(
        expect.objectContaining({
          fields: [],
          unsupportedReason: expect.any(String),
        }),
      );
    }

    for (const [requestId, format, value] of [
      ["submitted_bad_day", "date", "2025-04-31"],
      ["submitted_local_time", "date-time", "2026-09-08T12:00"],
    ] as const) {
      const submitted = fixture();
      submitted.attention.enqueue({
        authority: "codex",
        kind: "mcp_elicitation",
        method: "mcpServer/elicitation/request",
        requestId,
        taskId: "task_existing",
        generation: 12,
        payload: {
          mode: "form",
          message: "Calendar value",
          requestedSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "string", format } },
          },
        },
      });
      await expect(
        submitted.api.execute({
          type: "attention.decide",
          requestId,
          taskId: "task_existing",
          generation: 12,
          decision: "accept",
          form: { value },
        }),
      ).rejects.toThrow(/must be a date/);
      expect(submitted.broker.respond).not.toHaveBeenCalled();
    }
  });

  it("projects and submits every generated 0.153.4 elicitation field variant exactly", async () => {
    const { api, attention, broker } = fixture();
    const defaults = {
      flag: true,
      ratio: 1.5,
      count: 3,
      email: "person@example.test",
      uri: "https://example.test/a?b=c",
      date: "2026-09-08",
      instant: "2026-09-08T12:34:56+01:00",
      unicode: "🧭",
      legacy: "red",
      untitledSingle: "",
      titledSingle: "quick",
      untitledMulti: [""],
      titledMulti: ["north"],
    } as const;
    attention.enqueue({
      authority: "codex",
      kind: "mcp_elicitation",
      method: "mcpServer/elicitation/request",
      requestId: "generated_form_matrix",
      taskId: "task_existing",
      generation: 14,
      payload: {
        mode: "openai/form",
        message: "Generated schema matrix",
        requestedSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          required: Object.keys(defaults),
          properties: {
            flag: { type: "boolean", default: defaults.flag },
            ratio: {
              type: "number",
              minimum: -2.5,
              maximum: 2.5,
              default: defaults.ratio,
            },
            count: {
              type: "integer",
              minimum: 1,
              maximum: 5,
              default: defaults.count,
            },
            email: { type: "string", format: "email", default: defaults.email },
            uri: { type: "string", format: "uri", default: defaults.uri },
            date: { type: "string", format: "date", default: defaults.date },
            instant: {
              type: "string",
              format: "date-time",
              default: defaults.instant,
            },
            unicode: {
              type: "string",
              title: "  Unicode title  ",
              minLength: 1,
              maxLength: 1,
              default: defaults.unicode,
            },
            legacy: {
              type: "string",
              enum: ["red", "blue"],
              enumNames: ["  Rouge  ", "Bleu"],
              default: defaults.legacy,
            },
            untitledSingle: {
              type: "string",
              enum: ["", "present"],
              default: defaults.untitledSingle,
            },
            titledSingle: {
              type: "string",
              oneOf: [
                { const: "quick", title: "  Quick  " },
                { const: "careful", title: "Careful" },
              ],
              default: defaults.titledSingle,
            },
            untitledMulti: {
              type: "array",
              items: { type: "string", enum: ["", "beta"] },
              minItems: 1,
              maxItems: 2,
              default: defaults.untitledMulti,
            },
            titledMulti: {
              type: "array",
              items: {
                anyOf: [
                  { const: "north", title: "  North  " },
                  { const: "south", title: "South" },
                ],
              },
              minItems: 1,
              maxItems: 2,
              default: defaults.titledMulti,
            },
          },
        },
      },
    });
    const projected = (await api.readSnapshot()).attention[0]!.elicitation!;
    expect(projected.unsupportedReason).toBeUndefined();
    expect(projected.fields).toHaveLength(13);
    expect(projected.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "unicode",
          title: "  Unicode title  ",
          minLength: 1,
          maxLength: 1,
          default: "🧭",
          required: true,
        }),
        expect.objectContaining({
          id: "legacy",
          options: [
            { value: "red", label: "  Rouge  " },
            { value: "blue", label: "Bleu" },
          ],
        }),
        expect.objectContaining({
          id: "titledSingle",
          type: "single_select",
          options: [
            { value: "quick", label: "  Quick  " },
            { value: "careful", label: "Careful" },
          ],
        }),
        expect.objectContaining({
          id: "titledMulti",
          type: "multi_select",
          options: [
            { value: "north", label: "  North  " },
            { value: "south", label: "South" },
          ],
        }),
      ]),
    );
    await api.execute({
      type: "attention.decide",
      requestId: "generated_form_matrix",
      taskId: "task_existing",
      generation: 14,
      decision: "accept",
      form: { unicode: "🧭" },
    });
    expect(broker.respond).toHaveBeenCalledWith(expect.anything(), {
      _meta: null,
      action: "accept",
      content: defaults,
    });
  });

  it("rejects malformed or lossy generated-form shapes before broker response", async () => {
    const cases: readonly [string, Record<string, unknown>][] = [
      ["required_string", { required: "value" }],
      ["required_null", { required: null }],
      ["required_mixed", { required: ["value", 1] }],
      ["required_unknown", { required: ["missing"] }],
      ["required_duplicate", { required: ["value", "value"] }],
      ["schema_null", { $schema: null }],
      ["schema_oversized", { $schema: "x".repeat(2_001) }],
      ["extra_top_level", { additionalProperties: false }],
      [
        "hybrid_string",
        {
          properties: { value: { type: "string", enum: ["a"], minLength: 1 } },
        },
      ],
      [
        "titled_missing_title",
        { properties: { value: { type: "string", oneOf: [{ const: "a" }] } } },
      ],
      [
        "titled_duplicate",
        {
          properties: {
            value: {
              type: "array",
              items: {
                anyOf: [
                  { const: "a", title: "A" },
                  { const: "a", title: "Again" },
                ],
              },
            },
          },
        },
      ],
      [
        "multi_duplicate_default",
        {
          properties: {
            value: {
              type: "array",
              items: { type: "string", enum: ["a", "b"] },
              default: ["a", "a"],
            },
          },
        },
      ],
      [
        "multi_default_below_minimum",
        {
          properties: {
            value: {
              type: "array",
              items: { type: "string", enum: ["a"] },
              minItems: 1,
              default: [],
            },
          },
        },
      ],
    ];
    for (const [name, overrides] of cases) {
      const current = fixture();
      current.attention.enqueue({
        authority: "codex",
        kind: "mcp_elicitation",
        method: "mcpServer/elicitation/request",
        requestId: `malformed_${name}`,
        taskId: "task_existing",
        generation: 15,
        payload: {
          mode: "form",
          message: "Malformed generated schema",
          requestedSchema: {
            type: "object",
            properties: { value: { type: "string" } },
            ...overrides,
          },
        },
      });
      expect(
        (await current.api.readSnapshot()).attention[0]!.elicitation,
      ).toEqual(
        expect.objectContaining({
          fields: [],
          unsupportedReason: expect.any(String),
        }),
      );
      await expect(
        current.api.execute({
          type: "attention.decide",
          requestId: `malformed_${name}`,
          taskId: "task_existing",
          generation: 15,
          decision: "accept",
          form: {},
        }),
      ).rejects.toThrow();
      expect(current.broker.respond).not.toHaveBeenCalled();
    }

    for (const [requestId, value] of [
      ["unicode_too_long", "🧭a"],
      ["duplicate_submission", ["a", "a"]],
    ] as const) {
      const current = fixture();
      current.attention.enqueue({
        authority: "codex",
        kind: "mcp_elicitation",
        method: "mcpServer/elicitation/request",
        requestId,
        taskId: "task_existing",
        generation: 16,
        payload: {
          mode: "form",
          message: "Invalid submitted value",
          requestedSchema: {
            type: "object",
            required: ["value"],
            properties:
              typeof value === "string"
                ? { value: { type: "string", maxLength: 1 } }
                : {
                    value: {
                      type: "array",
                      items: { type: "string", enum: ["a"] },
                    },
                  },
          },
        },
      });
      await expect(
        current.api.execute({
          type: "attention.decide",
          requestId,
          taskId: "task_existing",
          generation: 16,
          decision: "accept",
          form: { value },
        }),
      ).rejects.toThrow();
      expect(current.broker.respond).not.toHaveBeenCalled();
    }
  });

  it("makes openai/form schemas with unpreserved constraints visible but non-submittable", async () => {
    const cases: readonly [string, unknown][] = [
      ["non_object", ["not", "an", "object"]],
      [
        "pattern",
        {
          type: "object",
          properties: {
            code: { type: "string", pattern: "^A$", default: "B" },
          },
        },
      ],
      [
        "composition",
        {
          type: "object",
          allOf: [{ properties: { code: { type: "string" } } }],
          properties: { code: { type: "string" } },
        },
      ],
      [
        "numeric",
        {
          type: "object",
          properties: {
            quantity: { type: "number", multipleOf: 5, default: 7 },
          },
        },
      ],
      [
        "array",
        {
          type: "object",
          properties: {
            values: {
              type: "array",
              uniqueItems: true,
              items: { type: "string", enum: ["a", "b"] },
            },
          },
        },
      ],
      [
        "array_items",
        {
          type: "object",
          properties: {
            values: {
              type: "array",
              items: { type: "string", enum: ["a"], minLength: 2 },
            },
          },
        },
      ],
      [
        "bounded_reason",
        {
          type: "object",
          properties: {
            value: {
              type: "string",
              [`token=constraint-secret-${"x".repeat(400)}`]: true,
            },
          },
        },
      ],
    ];
    for (const [name, requestedSchema] of cases) {
      const current = fixture();
      current.attention.enqueue({
        authority: "codex",
        kind: "mcp_elicitation",
        method: "mcpServer/elicitation/request",
        requestId: `unsupported_${name}`,
        taskId: "task_existing",
        generation: 13,
        payload: {
          mode: "openai/form",
          message: "Unsupported schema remains visible",
          requestedSchema,
        },
      });
      const elicitation = (await current.api.readSnapshot()).attention[0]!
        .elicitation!;
      expect(elicitation).toEqual(
        expect.objectContaining({
          mode: "form",
          message: "Unsupported schema remains visible",
          fields: [],
          unsupportedReason: expect.any(String),
        }),
      );
      expect(elicitation.unsupportedReason!.length).toBeLessThanOrEqual(280);
      expect(elicitation.unsupportedReason).not.toContain("constraint-secret");
      await expect(
        current.api.execute({
          type: "attention.decide",
          requestId: `unsupported_${name}`,
          taskId: "task_existing",
          generation: 13,
          decision: "accept",
          form: {},
        }),
      ).rejects.toThrow();
      expect(current.broker.respond).not.toHaveBeenCalled();
    }
  });

  it("projects type-specific approval context without raw approval payloads", async () => {
    const { api, attention } = fixture();
    attention.enqueue({
      authority: "codex",
      kind: "command_approval",
      method: "item/commandExecution/requestApproval",
      requestId: "command",
      taskId: "task_existing",
      generation: 1,
      payload: {
        command: "pnpm test",
        reason: "Run checks",
        availableDecisions: ["accept", "decline"],
        token: "hidden",
      },
    });
    attention.enqueue({
      authority: "codex",
      kind: "network_approval",
      method: "item/commandExecution/requestApproval",
      requestId: "network",
      taskId: "task_existing",
      generation: 1,
      payload: {
        networkApprovalContext: {
          host: "api.example",
          protocol: "https",
          headers: { authorization: "hidden" },
        },
        reason: "Fetch data",
      },
    });
    attention.enqueue({
      authority: "codex",
      kind: "permission_approval",
      method: "item/permissions/requestApproval",
      requestId: "permission",
      taskId: "task_existing",
      generation: 1,
      payload: {
        permissions: {
          network: { hosts: ["api.example"] },
          fileSystem: { read: ["/secret"] },
        },
        reason: "Use sources",
      },
    });
    const projected = (await api.readSnapshot()).attention;
    expect(
      projected.find((entry) => entry.requestId === "command")?.context,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Command", value: "pnpm test" }),
      ]),
    );
    expect(
      projected.find((entry) => entry.requestId === "network")?.context,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Host", value: "api.example" }),
      ]),
    );
    expect(
      projected.find((entry) => entry.requestId === "permission")?.context,
    ).toEqual(
      expect.arrayContaining([
        { label: "Permission", value: "Additional network access" },
        { label: "Permission", value: "Additional filesystem access" },
      ]),
    );
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("/secret");
  });

  it("maps each approval type to its exact App Server response shape", async () => {
    const cases = [
      {
        kind: "command_approval" as const,
        method: "item/commandExecution/requestApproval" as const,
        payload: { command: "pnpm test" },
        expected: { decision: "accept" },
      },
      {
        kind: "network_approval" as const,
        method: "item/commandExecution/requestApproval" as const,
        payload: { networkApprovalContext: { host: "api.example" } },
        expected: { decision: "accept" },
      },
      {
        kind: "file_approval" as const,
        method: "applyPatchApproval" as const,
        payload: { reason: "Update file" },
        expected: { decision: "approved" },
      },
      {
        kind: "permission_approval" as const,
        method: "item/permissions/requestApproval" as const,
        payload: { permissions: { network: { hosts: ["api.example"] } } },
        expected: {
          permissions: { network: { hosts: ["api.example"] } },
          scope: "turn",
          strictAutoReview: false,
        },
      },
    ];
    for (const item of cases) {
      const { api, attention, broker } = fixture();
      attention.enqueue({
        authority: "codex",
        kind: item.kind,
        method: item.method,
        requestId: item.kind,
        taskId: "task_existing",
        generation: 1,
        payload: item.payload,
      });
      await api.execute({
        type: "attention.decide",
        requestId: item.kind,
        taskId: "task_existing",
        generation: 1,
        decision: "accept",
      });
      expect(broker.respond).toHaveBeenCalledWith(
        expect.anything(),
        item.expected,
      );
    }
  });
});
