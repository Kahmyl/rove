import { describe, expect, it, vi } from "vitest";

import { OrderedAttentionQueue } from "./attention.js";
import {
  assertRendererProductIntent,
  LOCAL_PRODUCT_API_VERSION,
  LocalProductApi,
  validateTrustedExternalUrl,
} from "./local-product-api.js";
import type {
  ProductTaskIntent,
  ProductTaskPort,
} from "./product-task-port.js";
import {
  taskActionMaterialDigest,
  type ResultStore,
  type TaskResult,
} from "./results.js";
import {
  emptyWorkflowConfiguration,
  type WorkflowEnvironment,
  type WorkflowStore,
} from "./workflows.js";

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
  accountState: unknown = account(),
  workflows?: WorkflowStore,
  results?: ResultStore,
  recordingRuntime?: ConstructorParameters<typeof LocalProductApi>[12],
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
  const interruptTurn = vi.fn(
    async (_taskId?: string, _operationId?: string) => undefined,
  );
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
    acceptedTaskMessage: vi.fn(async () => null),
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
      } else if (input.type === "interrupt") {
        await interruptTurn(taskId, input.operationId);
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
    authorizeTaskResultAction: vi.fn(async () => ({ state: "prepared" })),
  };
  const api = new LocalProductApi(
    () => ({
      state: "ready",
      ready: true,
      restartAttempt: 0,
      stderrTail: ["token=host-secret"],
    }),
    accountState as never,
    tasks as never,
    broker as never,
    attention,
    "/host-owned/cwd",
    () => warnings,
    attachments as never,
    {} as never,
    legacyEffects,
    workflows,
    results,
    recordingRuntime,
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
    recordingRuntime,
  };
}

function taskResult(overrides: Partial<TaskResult> = {}): TaskResult {
  const revision = {
    resultId: "result_local_1",
    revision: 1,
    title: "Reviewed draft",
    body: "Use this exact reviewed material.",
    artifactIds: [],
    digest: "c".repeat(64),
    createdAt: "2026-09-13T10:00:00.000Z",
  };
  return {
    resultId: "result_local_1",
    taskId: "task_existing",
    turnId: "turn_1",
    kind: "draft",
    lifecycle: "prepared",
    selected: true,
    selectedRevision: { ...revision },
    currentRevision: 1,
    revision,
    source: {
      conversationItemId: "item_1",
      conversationTextDigest: "d".repeat(64),
      evidenceIds: [],
    },
    createdAt: "2026-09-13T10:00:00.000Z",
    updatedAt: "2026-09-13T10:00:00.000Z",
    ...overrides,
  };
}

function resultStore(initial = taskResult()): ResultStore & {
  createResult: ReturnType<typeof vi.fn>;
  reviseDraft: ReturnType<typeof vi.fn>;
  setResultSelected: ReturnType<typeof vi.fn>;
  transitionAction: ReturnType<typeof vi.fn>;
} {
  let current = initial;
  return {
    listResults: (taskId) =>
      taskId === undefined || taskId === current.taskId ? [current] : [],
    result: (taskId, resultId) =>
      taskId === current.taskId && resultId === current.resultId
        ? current
        : null,
    createResult: vi.fn((input) => ({
      ...current,
      taskId: input.taskId,
      kind: input.kind,
      revision: {
        ...current.revision,
        title: input.title,
        body: input.body,
      },
      source: input.source,
    })),
    reviseDraft: vi.fn((input) => {
      current = {
        ...current,
        currentRevision: input.expectedRevision + 1,
        revision: {
          ...current.revision,
          revision: input.expectedRevision + 1,
          title: input.title,
          body: input.body,
        },
      };
      return current;
    }),
    setResultSelected: vi.fn((input) => {
      if (input.selected)
        current = {
          ...current,
          selected: true,
          selectedRevision: current.revision,
        };
      else {
        const unselected = { ...current };
        delete unselected.selectedRevision;
        current = { ...unselected, selected: false };
      }
      return current;
    }),
    createAction: vi.fn(() => current),
    transitionAction: vi.fn((input) => {
      current = {
        ...current,
        lifecycle: input.lifecycle,
        source: {
          ...current.source,
          evidenceIds: [
            ...new Set([
              ...current.source.evidenceIds,
              ...(input.evidenceIds ?? []),
            ]),
          ],
        },
      };
      return current;
    }),
  };
}

function workflowEnvironment(): WorkflowEnvironment {
  const configuration = {
    purpose: "Find suitable roles",
    preferences: [
      {
        id: "preference_1",
        text: "Prefer remote roles.",
        appliesTo: ["roles"],
      },
    ],
    criteria: [],
    guidance: [],
    procedures: [],
    resourceRequirements: [],
    resultConventions: [],
    approvedKnowledge: [],
  };
  return {
    workflowId: "workflow_job_search",
    name: "Job search",
    archived: false,
    currentRevision: 1,
    revision: {
      workflowId: "workflow_job_search",
      revision: 1,
      configuration,
      digest: "a".repeat(64),
      approvedAt: "2026-09-13T10:00:00.000Z",
    },
    createdAt: "2026-09-13T10:00:00.000Z",
    updatedAt: "2026-09-13T10:00:00.000Z",
  };
}

function workflowStore(environment = workflowEnvironment()): WorkflowStore & {
  createWorkflow: ReturnType<typeof vi.fn>;
  editWorkflow: ReturnType<typeof vi.fn>;
  setWorkflowArchived: ReturnType<typeof vi.fn>;
  promoteToWorkflow: ReturnType<typeof vi.fn>;
} {
  const workflow = environment;
  return {
    listWorkflows: () => [workflow],
    workflow: (workflowId) =>
      workflowId === workflow.workflowId ? workflow : null,
    workflowRevisions: () => [workflow.revision],
    createWorkflow: vi.fn(() => workflow),
    editWorkflow: vi.fn(() => workflow),
    setWorkflowArchived: vi.fn(() => workflow),
    promoteToWorkflow: vi.fn(() => workflow),
  };
}

describe("LocalProductApi native product seam", () => {
  it("binds recording commands to the task's exact Runtime session", async () => {
    const recording = {
      schemaVersion: 1 as const,
      id: `rec_${"a".repeat(32)}`,
      taskId: "task_existing",
      sessionId: "ses_existing",
      mode: "agent" as const,
      state: "recording" as const,
      scope: {
        kind: "page" as const,
        pageId: `page_${"b".repeat(32)}`,
        url: "https://example.test/",
      },
      sensitiveDataPolicy: "user_confirmed_visible_content" as const,
      includesAudio: false as const,
      coverage: "Selected page.",
      exclusions: ["Other tabs"],
      requestedAt: "2026-09-13T12:00:00.000Z",
      updatedAt: "2026-09-13T12:00:01.000Z",
      startedAt: "2026-09-13T12:00:01.000Z",
    };
    const recordingRuntime = {
      startRecording: vi.fn(async () => recording),
      stopRecording: vi.fn(async () => recording),
      listRecordings: vi.fn(async () => [recording]),
    };
    const { api } = fixture(
      "agent",
      undefined,
      account(),
      undefined,
      undefined,
      recordingRuntime,
    );

    await api.executeRendererIntent({
      type: "task.recording.start",
      taskId: "task_existing",
      scope: "page",
      confirmUnmaskedSensitiveContent: true,
    });
    expect(recordingRuntime.startRecording).toHaveBeenCalledWith(
      "ses_existing",
      expect.objectContaining({ taskId: "task_existing", scope: "page" }),
    );

    await api.executeRendererIntent({
      type: "task.recording.stop",
      taskId: "task_existing",
      recordingId: recording.id,
    });
    expect(recordingRuntime.stopRecording).toHaveBeenCalledWith(
      "ses_existing",
      recording.id,
    );
  });

  it("rejects a recording ID associated with another task", async () => {
    const recordingRuntime = {
      startRecording: vi.fn(),
      stopRecording: vi.fn(),
      listRecordings: vi.fn(async () => [
        {
          id: `rec_${"d".repeat(32)}`,
          taskId: "task_other",
          sessionId: "ses_existing",
        },
      ]),
    };
    const { api } = fixture(
      "agent",
      undefined,
      account(),
      undefined,
      undefined,
      recordingRuntime as never,
    );
    await expect(
      api.executeRendererIntent({
        type: "task.recording.stop",
        taskId: "task_existing",
        recordingId: `rec_${"d".repeat(32)}`,
      }),
    ).rejects.toThrow("does not belong");
    expect(recordingRuntime.stopRecording).not.toHaveBeenCalled();
  });

  it("delegates a browserless task recording so the execution core can attach it", async () => {
    const recordingRuntime = {
      startRecording: vi.fn(async () => ({}) as never),
      stopRecording: vi.fn(async () => ({}) as never),
      listRecordings: vi.fn(async () => []),
    };
    const { api, tasks } = fixture(
      "agent",
      undefined,
      account(),
      undefined,
      undefined,
      recordingRuntime,
    );
    const task = (await tasks.productTasks())[0]!;
    const browserlessTask = structuredClone(task);
    delete (browserlessTask.context as Partial<typeof task.context>)
      .roveSessionId;
    tasks.readTask.mockResolvedValue(browserlessTask);

    await api.executeRendererIntent({
      type: "task.recording.start",
      taskId: "task_existing",
      scope: "page",
      confirmUnmaskedSensitiveContent: true,
    });
    expect(recordingRuntime.startRecording).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ taskId: "task_existing" }),
    );
  });

  it("accepts name-only Workflow creation through the renderer contract", async () => {
    const workflows = workflowStore();
    const { api } = fixture("agent", undefined, account(), workflows);
    await api.executeRendererIntent({
      type: "workflow.create",
      operationId: "intent_09999999-9999-4999-8999-999999999999",
      name: "Weekly product update",
      configuration: emptyWorkflowConfiguration(),
    });
    expect(workflows.createWorkflow).toHaveBeenCalledWith({
      operationId: "intent_09999999-9999-4999-8999-999999999999",
      name: "Weekly product update",
      configuration: emptyWorkflowConfiguration(),
    });
  });

  it("associates tasks locally and shares assembled guidance only after explicit choice", async () => {
    const workflows = workflowStore();
    const { api, tasks } = fixture("agent", undefined, account(), workflows);

    const localOnly = (await api.executeRendererIntent({
      type: "task.launch",
      operationId: "intent_01111111-1111-4111-8111-111111111111",
      input: {
        outcome: "Find backend roles",
        executionMode: "agent",
        approvalsReviewer: "auto_review",
        workflowId: "workflow_job_search",
        shareWorkflowContext: false,
      },
    })) as { aggregate: { taskId: string } };
    expect(tasks.submit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workflowAssociation: {
          workflowId: "workflow_job_search",
          workflowName: "Job search",
        },
      }),
    );
    expect(tasks.submit.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "workflowContext",
    );

    const shared = (await api.executeRendererIntent({
      type: "task.launch",
      operationId: "intent_02222222-2222-4222-8222-222222222222",
      input: {
        outcome: "Find backend roles",
        executionMode: "agent",
        approvalsReviewer: "auto_review",
        workflowId: "workflow_job_search",
        shareWorkflowContext: true,
      },
    })) as { aggregate: { taskId: string } };
    expect(tasks.submit.mock.calls.at(-1)?.[0]).toMatchObject({
      workflowContext: {
        workflowId: "workflow_job_search",
        workflowName: "Job search",
        revision: 1,
      },
    });
    expect(
      (
        tasks.submit.mock.calls.at(-1)?.[0] as Extract<
          ProductTaskIntent,
          { type: "launch" }
        >
      ).workflowContext?.developerInstructions,
    ).toContain("Prefer remote roles");

    const standalone = (await api.executeRendererIntent({
      type: "task.launch",
      operationId: "intent_07777777-7777-4777-8777-777777777777",
      input: {
        outcome: "Explain binary search",
        executionMode: "agent",
        approvalsReviewer: "auto_review",
      },
    })) as { aggregate: { taskId: string } };
    expect(
      new Set([
        localOnly.aggregate.taskId,
        shared.aggregate.taskId,
        standalone.aggregate.taskId,
      ]).size,
    ).toBe(3);
    expect(tasks.submit.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "workflowAssociation",
    );
  });

  it("applies the latest relevant Workflow revision at a later idle turn without leaking into standalone tasks", async () => {
    const latest = workflowEnvironment();
    latest.currentRevision = 2;
    latest.revision = {
      ...latest.revision,
      revision: 2,
      digest: "b".repeat(64),
      configuration: {
        ...latest.revision.configuration,
        preferences: [
          {
            id: "preference_roles",
            text: "Prefer remote roles.",
            appliesTo: ["roles"],
          },
        ],
        guidance: [
          {
            id: "guidance_outreach",
            text: "Keep outreach warm and direct.",
            appliesTo: ["outreach", "email"],
          },
        ],
      },
    };
    const workflows = workflowStore(latest);
    const { api, tasks } = fixture("agent", undefined, account(), workflows);
    const [existing] = await tasks.productTasks();
    const { activeTurnId: _activeTurnId, ...idleConversation } =
      existing!.conversation!;
    void _activeTurnId;
    const workflowTask = {
      ...existing!,
      context: {
        ...existing!.context,
        workflowAssociation: {
          workflowId: latest.workflowId,
          workflowName: latest.name,
        },
        workflowContext: {
          workflowId: latest.workflowId,
          workflowName: latest.name,
          revision: 1,
          digest: "a".repeat(64),
          developerInstructions: "Earlier approved context",
        },
      },
      conversation: {
        ...idleConversation,
        turnStatus: "completed" as const,
      },
    };
    tasks.productTasks.mockResolvedValue([workflowTask as never]);

    await api.executeRendererIntent({
      type: "task.message",
      taskId: "task_existing",
      operationId: "intent_05555555-5555-4555-8555-555555555555",
      outcome: "Draft an outreach email",
    });
    const workflowMessage = tasks.submit.mock.calls.at(-1)?.[0] as Extract<
      ProductTaskIntent,
      { type: "message" }
    >;
    expect(workflowMessage.workflowContext).toMatchObject({ revision: 2 });
    expect(workflowMessage.workflowContext?.developerInstructions).toContain(
      "Keep outreach warm and direct",
    );
    expect(
      workflowMessage.workflowContext?.developerInstructions,
    ).not.toContain("Prefer remote roles");

    tasks.productTasks.mockResolvedValue([
      { ...workflowTask, context: context("agent") } as never,
    ]);
    await api.executeRendererIntent({
      type: "task.message",
      taskId: "task_existing",
      operationId: "intent_06666666-6666-4666-8666-666666666666",
      outcome: "Draft an outreach email",
    });
    expect(tasks.submit.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "workflowContext",
    );
  });

  it("promotes one exact attachment-free conversation item through an explicit revision", async () => {
    const workflows = workflowStore();
    const { api, tasks } = fixture("agent", undefined, account(), workflows);
    const [existing] = await tasks.productTasks();
    tasks.productTasks.mockResolvedValue([
      {
        ...existing!,
        conversation: {
          ...existing!.conversation!,
          items: {
            ...existing!.conversation!.items,
            item_1: {
              ...existing!.conversation!.items.item_1,
              text: `Reusable source ${"x".repeat(3_000)}`,
            },
          },
        },
      },
    ]);
    await api.executeRendererIntent({
      type: "workflow.promote",
      operationId: "intent_03333333-3333-4333-8333-333333333333",
      workflowId: "workflow_job_search",
      expectedRevision: 1,
      category: "knowledge",
      text: "Keep this reusable fact.",
      appliesTo: ["roles"],
      sourceTaskId: "task_existing",
      sourceItemId: "item_1",
    });
    expect(workflows.promoteToWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "workflow_job_search",
        sourceTaskId: "task_existing",
        sourceItemId: "item_1",
        text: "Keep this reusable fact.",
      }),
    );
    await expect(
      api.executeRendererIntent({
        type: "workflow.promote",
        operationId: "intent_04444444-4444-4444-8444-444444444444",
        workflowId: "workflow_job_search",
        expectedRevision: 1,
        category: "knowledge",
        text: "Changed",
        appliesTo: [],
        sourceTaskId: "task_existing",
        sourceItemId: "missing_item",
      }),
    ).rejects.toThrow(/stale/i);
  });

  it("creates a stable result only from an exact completed assistant response", async () => {
    const results = resultStore();
    const { api } = fixture("agent", undefined, account(), undefined, results);
    await api.executeRendererIntent({
      type: "result.create",
      operationId: "intent_14345678-1234-4123-8123-123456789abc",
      taskId: "task_existing",
      sourceItemId: "item_1",
      kind: "draft",
      title: "Reviewed draft",
      body: "Edited local material",
    });
    expect(results.createResult).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task_existing",
        turnId: "turn_1",
        kind: "draft",
        source: {
          conversationItemId: "item_1",
          conversationTextDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          evidenceIds: [],
        },
      }),
    );
    await expect(
      api.executeRendererIntent({
        type: "result.create",
        operationId: "intent_24345678-1234-4123-8123-123456789abc",
        taskId: "task_existing",
        sourceItemId: "missing_item",
        kind: "report",
        title: "Missing",
        body: "Must be rejected",
      }),
    ).rejects.toThrow(/source is stale/i);
  });

  it("binds a prepared action to renderer-reviewed material and task attachments", async () => {
    const results = resultStore();
    const reviewedAttachment = {
      id: "att_reviewed",
      filename: "reviewed.pdf",
      mimeType: "application/pdf",
      size: 12,
      sha256: "f".repeat(64),
      status: "bound",
      taskId: "task_existing",
      sessionId: "ses_existing",
    };
    const { api, tasks } = fixture(
      "agent",
      {
        listDrafts: () => [],
        listAttention: () => [],
        listForTask: () => [reviewedAttachment],
        selectDrafts: vi.fn(),
        removeDraft: vi.fn(),
        replaceDraft: vi.fn(),
        selectPending: vi.fn(),
        cancelPending: vi.fn(),
        cleanupTask: vi.fn(),
      },
      account(),
      undefined,
      results,
    );
    const [existing] = await tasks.productTasks();
    tasks.productTasks.mockResolvedValue([
      {
        ...existing!,
      },
    ]);
    tasks.readTask.mockResolvedValue((await tasks.productTasks())[0]!);
    await api.executeRendererIntent({
      type: "result.create",
      operationId: "intent_16345678-1234-4123-8123-123456789abc",
      taskId: "task_existing",
      sourceItemId: "item_1",
      kind: "action",
      title: "Send reviewed report",
      body: "Prepared email action",
      actionMaterial: {
        recipient: "ops@example.test",
        content: "Attached is the reviewed report.",
        target: "mailbox:ops",
        attachmentIds: ["att_reviewed"],
        scope: "one email",
      },
    });
    expect(results.createAction).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task_existing",
        material: {
          recipient: "ops@example.test",
          content: "Attached is the reviewed report.",
          target: "mailbox:ops",
          attachmentIds: ["att_reviewed"],
          scope: "one email",
        },
      }),
    );
  });

  it("derives action completion only from exact Runtime effect truth", async () => {
    const material = {
      recipient: "ops@example.test",
      content: "Send reviewed report",
      target: "mailbox:ops",
      attachmentIds: [] as string[],
      scope: "one email",
    };
    const action = taskResult({
      resultId: "result_action_1",
      kind: "action",
      lifecycle: "authorized",
      revision: {
        ...taskResult().revision,
        resultId: "result_action_1",
        title: "Send reviewed report",
      },
      actionMaterial: material,
      materialDigest: taskActionMaterialDigest(material),
    });
    const results = resultStore(action);
    const current = fixture("agent", undefined, account(), undefined, results);
    const consequentialEffect = vi.fn(async () => ({
      effectId: "1".repeat(64),
      state: "applied" as const,
      consequenceKey: `task-result:${action.resultId}:${action.materialDigest}`,
      observationId: "observation_after",
      evidenceId: "ev_after",
    }));
    Object.assign(current.legacyEffects, { consequentialEffect });

    const snapshot = await current.api.readSnapshot();
    expect(consequentialEffect).toHaveBeenCalledWith(
      "ses_existing",
      `task-result:${action.resultId}:${action.materialDigest}`,
    );
    expect(snapshot.tasks[0]?.results[0]).toMatchObject({
      resultId: action.resultId,
      lifecycle: "confirmed",
      source: {
        evidenceIds: ["1".repeat(64), "observation_after", "ev_after"],
      },
    });
    expect(results.transitionAction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        expectedLifecycle: "authorized",
        lifecycle: "dispatched",
      }),
    );
    expect(results.transitionAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        expectedLifecycle: "dispatched",
        lifecycle: "confirmed",
      }),
    );
  });

  it("surfaces a possibly dispatched Runtime effect as unresolved", async () => {
    const material = {
      content: "Submit the reviewed form",
      attachmentIds: [] as string[],
    };
    const action = taskResult({
      resultId: "result_action_uncertain",
      kind: "action",
      lifecycle: "authorized",
      revision: {
        ...taskResult().revision,
        resultId: "result_action_uncertain",
      },
      actionMaterial: material,
      materialDigest: taskActionMaterialDigest(material),
    });
    const results = resultStore(action);
    const current = fixture("agent", undefined, account(), undefined, results);
    Object.assign(current.legacyEffects, {
      consequentialEffect: vi.fn(async () => ({
        effectId: "2".repeat(64),
        state: "prepared" as const,
        consequenceKey: `task-result:${action.resultId}:${action.materialDigest}`,
      })),
    });

    expect(
      (await current.api.readSnapshot()).tasks[0]?.results[0],
    ).toMatchObject({
      resultId: action.resultId,
      lifecycle: "unresolved",
    });
  });

  it("durably authorizes exact material for a task without a browser session", async () => {
    const material = {
      recipient: "ops@example.test",
      content: "Send reviewed report",
      attachmentIds: [] as string[],
    };
    const action = taskResult({
      resultId: "result_action_authorize",
      kind: "action",
      lifecycle: "prepared",
      revision: {
        ...taskResult().revision,
        resultId: "result_action_authorize",
      },
      actionMaterial: material,
      materialDigest: taskActionMaterialDigest(material),
    });
    const results = resultStore(action);
    const current = fixture("agent", undefined, account(), undefined, results);
    const task = await current.tasks.readTask("task_existing");
    const { roveSessionId, ...browserlessContext } = task!.context;
    expect(roveSessionId).toBeTruthy();
    current.tasks.readTask.mockResolvedValue({
      ...task!,
      context: browserlessContext,
    } as never);

    await current.api.executeRendererIntent({
      type: "result.authorize",
      operationId: "intent_17345678-1234-4123-8123-123456789abc",
      taskId: "task_existing",
      resultId: action.resultId,
      materialDigest: action.materialDigest!,
    });
    expect(
      current.legacyEffects.authorizeTaskResultAction,
    ).not.toHaveBeenCalled();
    expect(results.transitionAction).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedLifecycle: "prepared",
        lifecycle: "authorized",
        materialDigest: action.materialDigest,
      }),
    );
  });

  it("activates only a concrete Runtime plan that matches saved material", async () => {
    const material = {
      recipient: "ops@example.test",
      recipientControl: "To",
      content: "Send reviewed report",
      contentControl: "Message",
      attachmentIds: ["att_plan"],
      attachmentControl: "Attachments",
      target: "Send",
      commitControl: "Send",
      scope: "Compose",
    };
    const action = taskResult({
      resultId: "result_action_plan",
      kind: "action",
      lifecycle: "authorized",
      revision: {
        ...taskResult().revision,
        resultId: "result_action_plan",
      },
      actionMaterial: material,
      materialDigest: taskActionMaterialDigest(material),
    });
    const current = fixture(
      "agent",
      {
        listDrafts: () => [],
        listAttention: () => [],
        listForTask: () => [
          {
            id: "att_plan",
            filename: "reviewed.pdf",
            mimeType: "application/pdf",
            size: 12,
            sha256: "f".repeat(64),
            status: "bound" as const,
            taskId: "task_existing",
            sessionId: "ses_existing",
            evidenceId: "ev_reviewed",
          },
        ],
        selectDrafts: vi.fn(),
        removeDraft: vi.fn(),
        replaceDraft: vi.fn(),
        selectPending: vi.fn(),
        cancelPending: vi.fn(),
        cleanupTask: vi.fn(),
      },
      account(),
      undefined,
      resultStore(action),
    );
    const planId = `plan_${"a".repeat(32)}`;
    let swapControls = true;
    Object.assign(current.legacyEffects, {
      consequentialEffect: vi.fn(async () => ({
        effectId: "3".repeat(64),
        state: "planned" as const,
        consequenceKey: `task-result:${action.resultId}:${action.materialDigest}`,
        taskResultPlan: {
          schemaVersion: 1 as const,
          planId,
          consequenceKey: `task-result:${action.resultId}:${action.materialDigest}`,
          materialDigest: action.materialDigest!,
          taskScope: "task_existing",
          browserWorkspaceScope: "workspace_existing",
          observationId: "obs_plan",
          pageId: "page_1",
          pageRevision: 4,
          url: "https://mail.example.test/compose",
          fields: [
            {
              field: "recipient" as const,
              targetRef: "to",
              targetName: swapControls ? "Message" : "To",
              targetKind: "textbox",
              value: material.recipient,
            },
            {
              field: "content" as const,
              targetRef: "body",
              targetName: swapControls ? "To" : "Message",
              targetKind: "textbox",
              value: material.content,
            },
          ],
          attachments: [
            {
              evidenceId: "ev_reviewed",
              filename: "reviewed.pdf",
              size: 12,
              sha256: "f".repeat(64),
              targetRef: "attachments",
              targetName: "Attachments",
            },
          ],
          commitTarget: {
            targetRef: "send",
            targetName: "Send",
            targetKind: "button",
            scopeLabels: ["Compose"],
          },
          commitAction: {
            kind: "click" as const,
            target: { pageId: "page_1", revision: 4, ref: "send" },
          },
          expectedEffects: [
            { kind: "target_absent" as const, target: { name: "Send" } },
          ],
          effect: "external_commit" as const,
          actionFingerprint: "b".repeat(64),
          planDigest: "c".repeat(64),
          preparedAt: "2026-09-13T10:00:01.000Z",
        },
      })),
    });

    await current.api.readSnapshot();
    expect(
      current.legacyEffects.authorizeTaskResultAction,
    ).not.toHaveBeenCalled();
    swapControls = false;
    await current.api.readSnapshot();
    expect(
      current.legacyEffects.authorizeTaskResultAction,
    ).toHaveBeenCalledWith(
      "ses_existing",
      `task-result:${action.resultId}:${action.materialDigest}`,
      action.materialDigest,
      planId,
    );
  });

  it("promotes one exact result revision without treating the result as permission", async () => {
    const workflows = workflowStore();
    const result = taskResult();
    const results = resultStore(result);
    const { api } = fixture("agent", undefined, account(), workflows, results);
    await api.executeRendererIntent({
      type: "workflow.promote",
      operationId: "intent_15345678-1234-4123-8123-123456789abc",
      workflowId: "workflow_job_search",
      expectedRevision: 1,
      category: "knowledge",
      text: result.revision.body,
      appliesTo: ["outreach"],
      sourceTaskId: "task_existing",
      sourceResultId: result.resultId,
      sourceResultRevision: 1,
    });
    expect(workflows.promoteToWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceTaskId: "task_existing",
        sourceResultId: result.resultId,
        sourceResultRevision: 1,
        sourceTextDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    await expect(
      api.executeRendererIntent({
        type: "workflow.promote",
        operationId: "intent_25345678-1234-4123-8123-123456789abc",
        workflowId: "workflow_job_search",
        expectedRevision: 1,
        category: "knowledge",
        text: result.revision.body,
        appliesTo: [],
        sourceTaskId: "task_existing",
        sourceResultId: result.resultId,
        sourceResultRevision: 2,
      }),
    ).rejects.toThrow(/revision is stale/i);
  });

  it("applies only persisted selected results to a later turn", async () => {
    const result = taskResult();
    const results = resultStore(result);
    const { api, tasks } = fixture(
      "agent",
      undefined,
      account(),
      undefined,
      results,
    );
    await expect(
      api.executeRendererIntent({
        type: "task.message",
        taskId: "task_existing",
        operationId: "intent_29345678-1234-4123-8123-123456789abc",
        outcome: "Do not inject mid-turn",
        selectedResultIds: [result.resultId],
      }),
    ).rejects.toThrow(/after the current turn finishes/i);
    const [existing] = await tasks.productTasks();
    tasks.productTasks.mockResolvedValue([
      {
        ...existing!,
        conversation: {
          ...existing!.conversation!,
          turnStatus: "completed" as const,
        },
      },
    ]);
    tasks.readTask.mockResolvedValue((await tasks.productTasks())[0]!);
    results.reviseDraft({
      operationId: "intent_30345678-1234-4123-8123-123456789abc",
      taskId: result.taskId,
      resultId: result.resultId,
      expectedRevision: 1,
      title: "Reviewed draft revised",
      body: "A later edit that was not selected.",
    });

    tasks.submit.mockResolvedValueOnce({
      duplicate: false,
      aggregate: { taskId: result.taskId },
      projection: {
        operationDisposition: {
          status: "rejected",
          operationId: "intent_39345678-1234-4123-8123-123456789abc",
          reason: "A newer turn is already active.",
        },
      },
      command: null,
    } as never);
    await api.executeRendererIntent({
      type: "task.message",
      taskId: "task_existing",
      operationId: "intent_39345678-1234-4123-8123-123456789abc",
      outcome: "Rejected continuation",
      selectedResultIds: [result.resultId],
    });
    expect(results.result(result.taskId, result.resultId)?.selected).toBe(true);

    const accepted = await api.executeRendererIntent({
      type: "task.message",
      taskId: "task_existing",
      operationId: "intent_34345678-1234-4123-8123-123456789abc",
      outcome: "Continue from the selected draft",
      selectedResultIds: [result.resultId],
    });
    const message = tasks.submit.mock.calls.at(-1)?.[0] as Extract<
      ProductTaskIntent,
      { type: "message" }
    >;
    expect(message.message).toBe("Continue from the selected draft");
    expect(message.selectedResultContext).toMatchObject({
      resultIds: [result.resultId],
      references: [
        {
          taskId: result.taskId,
          resultId: result.resultId,
          revision: 1,
          digest: result.revision.digest,
        },
      ],
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(message.selectedResultContext?.workingContext).toContain(
      "Use this exact reviewed material",
    );
    expect(message.selectedResultContext?.workingContext).not.toContain(
      "A later edit that was not selected",
    );
    expect(
      message.selectedResultContext?.developerInstructions,
    ).toBeUndefined();
    results.setResultSelected({
      operationId: "intent_40345678-1234-4123-8123-123456789abc",
      taskId: result.taskId,
      resultId: result.resultId,
      expectedRevision: 2,
      selected: false,
    });
    const resultReads = vi.spyOn(results, "result");
    const readsBeforeRetry = resultReads.mock.calls.length;
    const taskReadsBeforeRetry = tasks.readTask.mock.calls.length;
    const submitsBeforeRetry = tasks.submit.mock.calls.length;
    tasks.acceptedTaskMessage.mockResolvedValueOnce({
      ...(accepted as Awaited<ReturnType<ProductTaskPort["submit"]>>),
      duplicate: true,
    } as never);
    await expect(
      api.executeRendererIntent({
        type: "task.message",
        taskId: "task_existing",
        operationId: "intent_34345678-1234-4123-8123-123456789abc",
        outcome: "Continue from the selected draft",
        selectedResultIds: [result.resultId],
      }),
    ).resolves.toMatchObject({ duplicate: true });
    expect(resultReads.mock.calls).toHaveLength(readsBeforeRetry);
    expect(tasks.readTask.mock.calls).toHaveLength(taskReadsBeforeRetry);
    expect(tasks.submit.mock.calls).toHaveLength(submitsBeforeRetry);

    await expect(
      api.executeRendererIntent({
        type: "task.message",
        taskId: "task_existing",
        operationId: "intent_44345678-1234-4123-8123-123456789abc",
        outcome: "Try stale selection",
        selectedResultIds: ["result_missing"],
      }),
    ).rejects.toThrow(/stale or belongs to another task/i);
  });
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
    const { api, start, startTurn } = fixture();
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

  it("accepts an ordinary model task without browser identity", async () => {
    const { api, start } = fixture();

    await api.execute({
      type: "task.launch",
      operationId: "intent_12111111-1111-4111-8111-111111111111",
      input: {
        outcome: "Summarize the local notes",
        executionMode: "agent",
        approvalsReviewer: "auto_review",
      },
    });

    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty("browserIdentity");
  });

  it("rejects a stale selected model at the host boundary before task acceptance", async () => {
    const catalog = {
      ...account(),
      snapshot: () => ({
        account: {
          status: "logged_in" as const,
          authMode: "chatgpt" as const,
        },
        models: [{ id: "available-model", efforts: ["low"] }],
        rateLimits: null,
        usage: null,
        refreshedAt: "2026-09-07T00:00:00Z",
      }),
    };
    const { api, tasks } = fixture("agent", undefined, catalog);

    await expect(
      api.execute({
        type: "task.launch",
        operationId: "intent_13111111-1111-4111-8111-111111111111",
        input: {
          outcome: "Use a model that is no longer available",
          executionMode: "agent",
          approvalsReviewer: "auto_review",
          model: "stale-model",
        },
      }),
    ).rejects.toThrow(/selected model is stale/i);
    expect(tasks.submit).not.toHaveBeenCalled();
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

  it("routes Archive directly to local task organization without Finish", async () => {
    const { api, tasks } = fixture();
    const operationId = "intent_42222222-2222-4222-8222-222222222222";
    const task = (await tasks.productTasks())[0]!;
    tasks.productTasks.mockResolvedValueOnce([
      {
        ...task,
        lifecycle: { phase: "ready" as const, reason: "Ready." },
        availableActions: ["message", "archive"] as const,
        conversation: {
          ...task.conversation,
          activeTurnId: undefined,
          turnStatus: "completed" as const,
        },
      },
    ] as never);

    await api.executeRendererIntent({
      type: "task.archive",
      taskId: "task_existing",
      operationId,
    });

    expect(tasks.submit).toHaveBeenLastCalledWith({
      type: "archive",
      taskId: "task_existing",
      operationId,
    });
    expect(tasks.submit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "finish" }),
    );
  });

  it("keeps cleanup retry exact and does not substitute it for Archive", async () => {
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
        availableActions: ["retry_cleanup", "archive"] as const,
      },
    ] as never);

    await api.executeRendererIntent({
      type: "task.archive",
      taskId: "task_existing",
      operationId,
    });

    expect(tasks.submit).toHaveBeenLastCalledWith({
      type: "archive",
      taskId: "task_existing",
      operationId,
    });

    tasks.productTasks.mockResolvedValueOnce([
      {
        ...task,
        lifecycle: {
          phase: "cleanup_required" as const,
          reason: "Interrupted cleanup is pending.",
        },
        availableActions: ["retry_cleanup", "archive"] as const,
      },
    ] as never);
    await api.executeRendererIntent({
      type: "task.cleanup.retry",
      taskId: "task_existing",
      operationId: "intent_44222222-2222-4222-8222-222222222222",
    });
    expect(tasks.submit).toHaveBeenLastCalledWith({
      type: "retry_cleanup",
      taskId: "task_existing",
      operationId: "intent_44222222-2222-4222-8222-222222222222",
    });
  });

  it("keeps customer capabilities out of lifecycle operation authorization", async () => {
    const { api, tasks } = fixture();
    const task = (await tasks.productTasks())[0]!;
    tasks.productTasks.mockResolvedValue([
      {
        ...task,
        availableActions: [],
        capabilities: {
          canSubmit: false,
          canQueue: false,
          canSteer: false,
          canStop: true,
          canRespond: false,
          canTakeControl: false,
          canReturnToRove: false,
          canRetry: true,
          canArchive: true,
        },
      },
    ] as never);

    await expect(
      api.executeRendererIntent({
        type: "task.stop",
        taskId: "task_existing",
        operationId: "intent_45222222-2222-4222-8222-222222222221",
      }),
    ).rejects.toThrow(/only while.*executing/);
    await expect(
      api.executeRendererIntent({
        type: "task.cleanup.retry",
        taskId: "task_existing",
        operationId: "intent_45222222-2222-4222-8222-222222222222",
      }),
    ).rejects.toThrow(/retry cleanup is not available/);
    expect(tasks.submit).not.toHaveBeenCalled();
  });

  it("passes exact archive and restore retries through despite the current organization action", async () => {
    const { api, tasks } = fixture();
    const task = (await tasks.productTasks())[0]!;
    const archiveOperationId = "intent_44222222-2222-4222-8222-222222222222";
    tasks.productTasks.mockResolvedValueOnce([
      {
        ...task,
        availableActions: ["resume"] as const,
        conversation: { ...task.conversation, archived: true },
      },
    ] as never);

    await api.executeRendererIntent({
      type: "task.archive",
      taskId: "task_existing",
      operationId: archiveOperationId,
    });
    expect(tasks.submit).toHaveBeenLastCalledWith({
      type: "archive",
      taskId: "task_existing",
      operationId: archiveOperationId,
    });

    const restoreOperationId = "intent_45222222-2222-4222-8222-222222222222";
    tasks.productTasks.mockResolvedValueOnce([
      {
        ...task,
        availableActions: ["archive"] as const,
        conversation: { ...task.conversation, archived: false },
      },
    ] as never);
    await api.executeRendererIntent({
      type: "task.restore",
      taskId: "task_existing",
      operationId: restoreOperationId,
    });
    expect(tasks.submit).toHaveBeenLastCalledWith({
      type: "unarchive",
      taskId: "task_existing",
      operationId: restoreOperationId,
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
    const { api, start, startTurn } = fixture("capture");
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

  it("does not apply browser profile admission to ordinary task creation", async () => {
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
    ).resolves.toBeDefined();
    expect(start).toHaveBeenCalledOnce();
  });

  it("keeps dormant browser ownership out of model-task readiness", async () => {
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
    ).resolves.toBeDefined();

    expect(start).toHaveBeenCalledOnce();
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
    expect(interruptTurn).toHaveBeenCalledWith(
      "task_existing",
      "intent_66666666-6666-4666-8666-666666666666",
    );
    expect(closeTask).not.toHaveBeenCalled();
    await api.executeRendererIntent({
      type: "task.message",
      taskId: "task_existing",
      operationId: "intent_67666666-6666-4666-8666-666666666665",
      outcome: "Redirect the same task after stopping its turn",
    });
    expect(steerTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taskId: "task_existing",
        text: "Redirect the same task after stopping its turn",
      }),
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
    await expect(
      api.executeRendererIntent({
        type: "task.stop",
        taskId: "task_existing",
        operationId: "intent_67666666-6666-4666-8666-666666666666",
      }),
    ).rejects.toThrow(/only while.*executing/);

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
    await expect(
      api.executeRendererIntent({
        type: "task.stop",
        taskId: "task_existing",
        operationId: "intent_68666666-6666-4666-8666-666666666666",
      }),
    ).rejects.toThrow(/only while.*executing/);

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

    await expect(
      api.executeRendererIntent({
        type: "task.stop",
        taskId: "task_existing",
        operationId: "intent_88888888-8888-4888-a888-888888888888",
      }),
    ).rejects.toThrow(/only while.*executing/);

    expect(tasks.readTaskProjection).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(closeTask).not.toHaveBeenCalled();
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
    expect(conversation.items.item_199?.text).toHaveLength(2_000);
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

  it("projects and submits every approved generated elicitation field variant exactly", async () => {
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
