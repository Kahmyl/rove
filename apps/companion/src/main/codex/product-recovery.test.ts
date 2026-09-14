import { describe, expect, it, vi } from "vitest";

import {
  DurableContinuationStore,
  type ContinuationState,
  type PendingContinuation,
} from "./continuations.js";
import { PersistentConversationStore } from "./conversations.js";
import { MemoryStateRepository } from "./persistence.js";
import type { CodexRpcPort, CodexThread } from "./protocol.js";
import {
  ContextAuthority,
  RoveTaskCoordinator,
  TaskCapabilityIssuer,
} from "./task-coordinator.js";

const taskId = "task_recovery";
const workspaceId = "wrk_00000000-0000-4000-8000-000000000001";
const attemptId = `boot_${"a".repeat(32)}`;

function thread(): CodexThread {
  return {
    id: "thread_recovery",
    extra: null,
    sessionId: "codex_session_recovery",
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
    model: "model_a",
    reasoningEffort: "low",
    createdAt: 1,
    updatedAt: 1,
    recencyAt: 1,
    cwd: "/work",
    cliVersion: "0.154.0-alpha.6.2",
    status: { type: "idle" },
    path: null,
    source: "appServer",
    canAcceptDirectInput: true,
    turns: [],
    threadSource: `rove:${taskId}:${attemptId}`,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
  };
}

function settledInitialLaunch() {
  return {
    operationId: "intent_77777777-7777-4777-a777-777777777777",
    inputDigest: "7".repeat(64),
    stage: "turn_started" as const,
    requestedAt: "2026-09-07T00:00:00Z",
    turnId: "turn_existing",
  };
}

describe("truth-based recovery", () => {
  it("reconciles App Server, Runtime, Desktop, and combined cuts without replaying a turn", async () => {
    const authority = new ContextAuthority();
    authority.restore({
      [taskId]: {
        roveTaskId: taskId,
        executionMode: "agent",
        browserIdentity: { mode: "workspace", workspaceId },
        selectionSource: "user_selected",
        selectedAt: "2026-09-07T00:00:00Z",
        policy: {
          cwd: "/work",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox: "workspace-write",
        },
        bootstrap: {
          attemptId,
          threadSource: `rove:${taskId}:${attemptId}`,
          stage: "complete",
        },
        initialLaunch: settledInitialLaunch(),
        roveSessionId: "ses_recovery",
        codexThreadId: "thread_recovery",
        codexSessionId: "codex_session_recovery",
        capabilityFingerprint: new TaskCapabilityIssuer(
          Buffer.alloc(32, 7),
        ).issue({
          taskId,
          sessionId: "ses_recovery",
          executionMode: "agent",
          browserIdentity: { mode: "workspace", workspaceId },
        }).fingerprint,
      },
    });
    const rpcRequest = vi.fn(async (method: string, _params: unknown) => {
      if (method === "thread/resume")
        return { thread: thread(), approvalsReviewer: "user" };
      if (method === "thread/read") return { thread: thread() };
      throw new Error(`Unexpected request ${method}`);
    });
    const rpc = {
      request: rpcRequest,
      notify: vi.fn(),
      respond: vi.fn(),
      onEvent: vi.fn(() => () => undefined),
    } as unknown as CodexRpcPort;
    const conversation = new PersistentConversationStore(
      new MemoryStateRepository(),
    );
    await conversation.bind({
      roveTaskId: taskId,
      codexThreadId: "thread_recovery",
      codexSessionId: "codex_session_recovery",
      roveSessionId: "ses_recovery",
      turnStatus: "unknown",
      archived: false,
      lastEventSequence: 0,
      items: {},
      turnOrder: [],
    });
    const runtime = {
      getSession: vi.fn(async () => ({
        id: "ses_recovery",
        mode: "agent",
        status: "active",
        controller: "agent",
        profile: { mode: "persistent", name: workspaceId },
        workspace: { id: workspaceId },
      })),
    };
    const coordinator = new RoveTaskCoordinator(
      rpc,
      runtime as never,
      {} as never,
      authority,
      new TaskCapabilityIssuer(Buffer.alloc(32, 7)),
      () => ({ status: "logged_in" }),
      { command: "mcp", args: [], environment: {} },
      () => "2026-09-07T00:00:00Z",
      conversation,
      () => [],
      new DurableContinuationStore(new MemoryStateRepository()),
    );

    const before = await coordinator.productTasks();
    for (let recoveryCut = 0; recoveryCut < 4; recoveryCut += 1)
      await expect(coordinator.recoverFromTruth()).resolves.toEqual([]);
    expect(await coordinator.productTasks()).toEqual(before);
    expect(runtime.getSession).toHaveBeenCalledTimes(4);
    expect(
      rpcRequest.mock.calls.some(([method]) => method === "turn/start"),
    ).toBe(false);
    expect(
      rpcRequest.mock.calls.filter(([method]) => method === "thread/resume"),
    ).toHaveLength(4);
  });

  it("keeps cached conversation readable while App Server is disconnected and refreshes it without replay", async () => {
    const authority = new ContextAuthority();
    const issuer = new TaskCapabilityIssuer(Buffer.alloc(32, 7));
    authority.restore({
      [taskId]: {
        roveTaskId: taskId,
        executionMode: "agent",
        browserIdentity: { mode: "workspace", workspaceId },
        selectionSource: "user_selected",
        selectedAt: "2026-09-07T00:00:00Z",
        policy: {
          cwd: "/work",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox: "workspace-write",
        },
        bootstrap: {
          attemptId,
          threadSource: `rove:${taskId}:${attemptId}`,
          stage: "complete",
        },
        initialLaunch: settledInitialLaunch(),
        roveSessionId: "ses_recovery",
        codexThreadId: "thread_recovery",
        codexSessionId: "codex_session_recovery",
        capabilityFingerprint: issuer.issue({
          taskId,
          sessionId: "ses_recovery",
          executionMode: "agent",
          browserIdentity: { mode: "workspace", workspaceId },
        }).fingerprint,
      },
    });
    const rpcRequest = vi.fn(async (method: string, _params: unknown) => {
      if (method === "thread/resume")
        return { thread: thread(), approvalsReviewer: "user" };
      if (method === "thread/read") return { thread: thread() };
      throw new Error(`Unexpected request ${method}`);
    });
    const rpc = {
      request: rpcRequest,
      notify: vi.fn(),
      respond: vi.fn(),
      onEvent: vi.fn(() => () => undefined),
    } as unknown as CodexRpcPort;
    const conversation = new PersistentConversationStore(
      new MemoryStateRepository(),
    );
    await conversation.bind({
      roveTaskId: taskId,
      codexThreadId: "thread_recovery",
      codexSessionId: "codex_session_recovery",
      roveSessionId: "ses_recovery",
      turnStatus: "completed",
      archived: false,
      lastEventSequence: 9,
      items: {},
      turnOrder: ["turn_cached"],
    });
    const session = {
      id: "ses_recovery",
      bootstrapId: attemptId,
      mode: "agent" as const,
      status: "active" as const,
      controller: "agent" as const,
      profile: { mode: "persistent" as const, name: workspaceId },
      workspace: {
        id: workspaceId,
        displayName: "Recovery",
        browser: "chrome" as const,
        storageLayout: "workspace" as const,
        createdAt: "2026-09-07T00:00:00Z",
        lastUsedAt: "2026-09-07T00:00:00Z",
      },
      createdAt: "2026-09-07T00:00:00Z",
      updatedAt: "2026-09-07T00:00:00Z",
    };
    const runtime = {
      listSessionInventory: vi.fn(async () => [
        {
          schemaVersion: 1 as const,
          session,
          browserIdentity: { mode: "workspace" as const, workspaceId },
          attachment: "attached" as const,
          recovery: "not_needed" as const,
          profileOwnership: "owned" as const,
        },
      ]),
    };
    const coordinator = new RoveTaskCoordinator(
      rpc,
      runtime as never,
      {} as never,
      authority,
      issuer,
      () => ({ status: "logged_in" }),
      { command: "mcp", args: [], environment: {} },
      () => "2026-09-07T00:00:00Z",
      conversation,
    );
    let available = false;
    coordinator.attachCodexAvailability(() => available);

    await expect(coordinator.productTasks()).resolves.toEqual([
      expect.objectContaining({
        conversation: expect.objectContaining({ turnStatus: "completed" }),
        lifecycle: expect.objectContaining({
          phase: "ready",
        }),
      }),
    ]);

    available = true;
    await expect(coordinator.recoverFromTruth()).resolves.toEqual([]);
    await expect(coordinator.productTasks()).resolves.toEqual([
      expect.objectContaining({
        lifecycle: expect.not.objectContaining({ phase: "recovering" }),
      }),
    ]);
    expect(
      rpcRequest.mock.calls
        .filter(([method]) => method === "thread/read")
        .map(([, params]) => params),
    ).toEqual([
      { threadId: "thread_recovery", includeTurns: false },
      { threadId: "thread_recovery", includeTurns: false },
      { threadId: "thread_recovery", includeTurns: true },
    ]);
    expect(
      rpcRequest.mock.calls.filter(([method]) => method === "thread/resume"),
    ).toHaveLength(1);
    expect(
      rpcRequest.mock.calls.some(([method]) =>
        ["turn/start", "turn/steer"].includes(method),
      ),
    ).toBe(false);
  });

  it("reports changed Runtime identity instead of silently switching workspace", async () => {
    const authority = new ContextAuthority();
    const issuer = new TaskCapabilityIssuer(Buffer.alloc(32, 7));
    authority.restore({
      [taskId]: {
        roveTaskId: taskId,
        executionMode: "agent",
        browserIdentity: { mode: "workspace", workspaceId },
        selectionSource: "user_selected",
        selectedAt: "2026-09-07T00:00:00Z",
        policy: {
          cwd: "/work",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox: "workspace-write",
        },
        bootstrap: {
          attemptId,
          threadSource: `rove:${taskId}:${attemptId}`,
          stage: "complete",
        },
        initialLaunch: settledInitialLaunch(),
        roveSessionId: "ses_recovery",
        codexThreadId: "thread_recovery",
        codexSessionId: "codex_session_recovery",
        capabilityFingerprint: issuer.issue({
          taskId,
          sessionId: "ses_recovery",
          executionMode: "agent",
          browserIdentity: { mode: "workspace", workspaceId },
        }).fingerprint,
      },
    });
    const coordinator = new RoveTaskCoordinator(
      {} as never,
      {
        getSession: async () => ({
          id: "ses_recovery",
          mode: "agent",
          profile: { mode: "temporary" },
        }),
      } as never,
      {} as never,
      authority,
      issuer,
      () => ({ status: "logged_in" }),
      { command: "mcp", args: [], environment: {} },
    );
    await expect(coordinator.recoverFromTruth()).resolves.toEqual([
      expect.stringMatching(/Recovered Runtime task identity changed/),
    ]);
  });

  it("coalesces overlapping post-return crash recovery and dispatches the durable continuation once", async () => {
    const authority = new ContextAuthority();
    const issuer = new TaskCapabilityIssuer(Buffer.alloc(32, 7));
    authority.restore({
      [taskId]: {
        roveTaskId: taskId,
        executionMode: "agent",
        browserIdentity: { mode: "workspace", workspaceId },
        selectionSource: "user_selected",
        selectedAt: "2026-09-07T00:00:00Z",
        policy: {
          cwd: "/work",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox: "workspace-write",
        },
        bootstrap: {
          attemptId,
          threadSource: `rove:${taskId}:${attemptId}`,
          stage: "complete",
        },
        initialLaunch: settledInitialLaunch(),
        roveSessionId: "ses_recovery",
        codexThreadId: "thread_recovery",
        codexSessionId: "codex_session_recovery",
        capabilityFingerprint: issuer.issue({
          taskId,
          sessionId: "ses_recovery",
          executionMode: "agent",
          browserIdentity: { mode: "workspace", workspaceId },
        }).fingerprint,
      },
    });
    const persisted = new DurableContinuationStore(new MemoryStateRepository());
    const pending: PendingContinuation = {
      roveTaskId: taskId,
      codexThreadId: "thread_recovery",
      originatingCodexTurnId: "turn_origin",
      roveSessionId: "ses_recovery",
      handoffGeneration: 4,
      requestedInstruction: "Continue after the human returns control.",
      continuationPolicy: "resume_after_control_return",
      status: "pending",
      freshInspectionRequired: true,
      preHandoffObservationSeq: 10,
    };
    await persisted.register(pending);
    const rpcRequest = vi.fn(async (method: string) => {
      if (method === "thread/resume")
        return { thread: thread(), approvalsReviewer: "user" };
      if (method === "thread/read") return { thread: thread() };
      if (method === "turn/start")
        return {
          turn: { id: "turn_continued", items: [], status: "inProgress" },
        };
      throw new Error(`Unexpected request ${method}`);
    });
    const rpc = {
      request: rpcRequest,
      notify: vi.fn(),
      respond: vi.fn(),
      onEvent: vi.fn(() => () => undefined),
    } as unknown as CodexRpcPort;
    const conversation = new PersistentConversationStore(
      new MemoryStateRepository(),
    );
    await conversation.bind({
      roveTaskId: taskId,
      codexThreadId: "thread_recovery",
      codexSessionId: "codex_session_recovery",
      roveSessionId: "ses_recovery",
      turnStatus: "unknown",
      archived: false,
      lastEventSequence: 0,
      items: {},
      turnOrder: [],
    });
    const runtime = {
      getSession: vi.fn(async () => ({
        id: "ses_recovery",
        mode: "agent",
        status: "active",
        controller: "agent",
        profile: { mode: "persistent", name: workspaceId },
        workspace: { id: workspaceId },
      })),
      getControlStatus: vi.fn(async () => ({
        controller: "agent",
        status: "active",
        generation: 5,
        observationSeq: 11,
        updatedAt: "2026-09-07T00:01:00Z",
      })),
      inspect: vi.fn(async () => ({ observationSeq: 11 })),
    };
    const coordinator = new RoveTaskCoordinator(
      rpc,
      runtime as never,
      {} as never,
      authority,
      issuer,
      () => ({ status: "logged_in" }),
      { command: "mcp", args: [], environment: {} },
      () => "2026-09-07T00:00:00Z",
      conversation,
      () => [],
      persisted,
    );

    await expect(
      Promise.all([
        coordinator.recoverFromTruth(),
        coordinator.recoverFromTruth(),
      ]),
    ).resolves.toEqual([[], []]);
    expect(runtime.inspect).toHaveBeenCalledOnce();
    expect(
      rpcRequest.mock.calls.filter(([method]) => method === "turn/start"),
    ).toHaveLength(1);
    expect(await persisted.pending()).toEqual([
      expect.objectContaining({
        status: "pending",
        continuationCommand: expect.objectContaining({
          dispatchStatus: "possibly_started",
        }),
      }),
    ]);
    await expect(coordinator.returnControlFromRuntime(taskId)).resolves.toBe(
      "pending",
    );
    expect(
      rpcRequest.mock.calls.filter(([method]) => method === "turn/start"),
    ).toHaveLength(1);
  });

  it("no-ops closed, wrong-session, explicit-response, stale, human-owned, cancelled, and consumed returns", async () => {
    const makeAuthority = (closed = false) => {
      const authority = new ContextAuthority();
      if (!closed)
        authority.restore({
          [taskId]: {
            roveTaskId: taskId,
            executionMode: "agent",
            browserIdentity: { mode: "workspace", workspaceId },
            selectionSource: "user_selected",
            selectedAt: "2026-09-07T00:00:00Z",
            policy: {
              cwd: "/work",
              approvalPolicy: "on-request",
              approvalsReviewer: "user",
              sandbox: "workspace-write",
            },
            bootstrap: {
              attemptId,
              threadSource: `rove:${taskId}:${attemptId}`,
              stage: "complete",
            },
            roveSessionId: "ses_recovery",
            codexThreadId: "thread_recovery",
            codexSessionId: "codex_session_recovery",
            capabilityFingerprint: "f".repeat(64),
          },
        });
      return authority;
    };
    const base: PendingContinuation = {
      roveTaskId: taskId,
      codexThreadId: "thread_recovery",
      originatingCodexTurnId: "turn_origin",
      roveSessionId: "ses_recovery",
      handoffGeneration: 4,
      requestedInstruction: "Continue",
      continuationPolicy: "resume_after_control_return",
      status: "pending",
      freshInspectionRequired: true,
    };
    const runCase = async (
      record: PendingContinuation | undefined,
      control: {
        controller: "agent" | "human";
        status: "active" | "awaiting_human";
        generation: number;
      },
      closed = false,
      prepare?: (store: DurableContinuationStore) => Promise<void>,
    ) => {
      const repository = new MemoryStateRepository<ContinuationState>();
      const store = new DurableContinuationStore(repository);
      if (record) await store.register(record);
      await prepare?.(store);
      const runtime = {
        getControlStatus: vi.fn(async () => ({
          ...control,
          updatedAt: "2026-09-07T00:01:00Z",
        })),
        inspect: vi.fn(async () => ({})),
      };
      const coordinator = new RoveTaskCoordinator(
        {} as never,
        runtime as never,
        {} as never,
        makeAuthority(closed),
        new TaskCapabilityIssuer(Buffer.alloc(32, 7)),
        () => ({ status: "logged_in" }),
        { command: "mcp", args: [], environment: {} },
        undefined,
        undefined,
        undefined,
        store,
      );
      await expect(coordinator.returnControlFromRuntime(taskId)).resolves.toBe(
        "ignored",
      );
      expect(runtime.inspect).not.toHaveBeenCalled();
    };

    await runCase(
      base,
      { controller: "agent", status: "active", generation: 5 },
      true,
    );
    await runCase(
      { ...base, roveSessionId: "ses_wrong" },
      { controller: "agent", status: "active", generation: 5 },
    );
    await runCase(
      { ...base, continuationPolicy: "explicit_user_response" },
      { controller: "agent", status: "active", generation: 5 },
    );
    await runCase(base, {
      controller: "agent",
      status: "active",
      generation: 4,
    });
    await runCase(base, {
      controller: "human",
      status: "awaiting_human",
      generation: 4,
    });
    await runCase(
      base,
      { controller: "agent", status: "active", generation: 5 },
      false,
      (store) => store.cancel(base),
    );
    await runCase(undefined, {
      controller: "agent",
      status: "active",
      generation: 5,
    });
  });
});
