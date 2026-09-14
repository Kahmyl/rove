import { describe, expect, it, vi } from "vitest";
import type { ControlStatus } from "@rove/protocol";

import { OrderedAttentionQueue, type AttentionState } from "./attention.js";
import { DurableContinuationStore } from "./continuations.js";
import type { ContinuationState } from "./continuations.js";
import { LocalProductApi } from "./local-product-api.js";
import { MemoryStateRepository } from "./persistence.js";
import type { CodexRpcPort, CodexThread } from "./protocol.js";
import {
  ContextAuthority,
  RoveTaskCoordinator,
  TaskCapabilityIssuer,
} from "./task-coordinator.js";

describe("request-human production composition", () => {
  it("keeps Rove handoff attention pending when its originating Codex turn completes", () => {
    const attention = new OrderedAttentionQueue();
    attention.enqueue({
      authority: "rove_control",
      kind: "control_handoff",
      requestId: "control:ses_waiting:handoff_waiting",
      taskId: "task_waiting",
      threadId: "thread_waiting",
      turnId: "turn_origin",
      generation: 2,
      payload: {},
    });
    attention.enqueue({
      authority: "codex",
      kind: "file_approval",
      requestId: "c1:server:7",
      taskId: "task_waiting",
      threadId: "thread_waiting",
      turnId: "turn_origin",
      itemId: "item_approval",
      generation: 2,
      payload: {},
      method: "item/fileChange/requestApproval",
    });

    attention.markTurnTerminal("thread_waiting", "turn_origin");

    expect(attention.list()).toEqual([
      expect.objectContaining({
        authority: "rove_control",
        status: "pending",
      }),
      expect.objectContaining({ authority: "codex", status: "stale" }),
    ]);
  });

  it("repairs a previously corrupted stale Rove handoff from durable continuation truth", async () => {
    const repository = new MemoryStateRepository<AttentionState>();
    await repository.write(0, {
      sequence: 1,
      entries: [
        {
          authority: "rove_control",
          kind: "control_handoff",
          requestId: "control:ses_waiting:handoff_waiting",
          taskId: "task_waiting",
          threadId: "thread_waiting",
          turnId: "turn_origin",
          generation: 2,
          payload: {},
          status: "stale",
          sequence: 1,
        },
      ],
    });
    const attention = new OrderedAttentionQueue(100, repository);
    await attention.restore();

    attention.reconcileRovePending(
      new Set(["control:ses_waiting:handoff_waiting"]),
    );

    expect(attention.list()[0]?.status).toBe("pending");
  });

  it("derives one durable continuation from a bound MCP completion and resumes once after Return", async () => {
    const authority = new ContextAuthority();
    authority.restore({
      task_bound: {
        roveTaskId: "task_bound",
        executionMode: "agent",
        browserIdentity: { mode: "temporary" },
        selectionSource: "user_selected",
        selectedAt: "2026-09-08T00:00:00Z",
        policy: {
          cwd: "/work",
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
        },
        bootstrap: {
          attemptId: `boot_${"a".repeat(32)}`,
          threadSource: `rove:task_bound:boot_${"a".repeat(32)}`,
          stage: "complete",
        },
        initialLaunch: {
          operationId: "intent_44444444-4444-4444-a444-444444444444",
          inputDigest: "4".repeat(64),
          stage: "turn_started",
          requestedAt: "2026-09-08T00:00:00Z",
          outcome: "Complete the browser handoff.",
          turnId: "turn_origin",
        },
        roveSessionId: "ses_bound",
        codexThreadId: "thread_bound",
        codexSessionId: "codex_bound",
        capabilityFingerprint: "f".repeat(64),
      },
    });
    const toolItem = {
      type: "mcpToolCall" as const,
      id: "item_handoff",
      server: "rove",
      tool: "control.request_human",
      status: "completed",
      arguments: {
        sessionId: "ses_bound",
        reason: "Sign in",
        instruction: "Inspect the signed-in page and finish the booking.",
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
              sessionId: "ses_bound",
              generation: 10,
              status: "awaiting_human",
              controller: null,
              activeHandoffId: "handoff_exact",
              observationSeq: 40,
            }),
          },
        ],
      },
      error: null,
      durationMs: 1,
    };
    const thread: CodexThread = {
      id: "thread_bound",
      extra: null,
      sessionId: "codex_bound",
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
      cliVersion: "0.154.0-alpha.6.2",
      status: { type: "idle" },
      path: null,
      source: "appServer",
      canAcceptDirectInput: true,
      threadSource: `rove:task_bound:boot_${"a".repeat(32)}`,
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
      turns: [
        {
          id: "turn_origin",
          items: [toolItem],
          itemsView: "full",
          status: "completed",
          error: null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
        },
      ],
    };
    let control: ControlStatus = {
      sessionId: "ses_bound",
      generation: 10,
      status: "awaiting_human" as const,
      controller: null,
      activeHandoffId: "handoff_exact",
      activeHandoffGeneration: 10,
      observationSeq: 40,
      updatedAt: "2026-09-08T00:00:00Z",
    };
    const runtime = {
      getControlStatus: vi.fn(async () => control),
      inspect: vi.fn(async () => ({})),
    };
    const rpc = {
      request: vi.fn(async (method: string) => {
        if (method === "thread/read") return { thread };
        if (method === "turn/start") return { turn: { id: "turn_next" } };
        throw new Error(`Unexpected request ${method}`);
      }),
      notify: vi.fn(),
      respond: vi.fn(),
      onEvent: vi.fn(() => () => undefined),
    } as unknown as CodexRpcPort;
    const continuations = new DurableContinuationStore(
      new MemoryStateRepository(),
    );
    const coordinator = new RoveTaskCoordinator(
      rpc,
      runtime as never,
      {} as never,
      authority,
      new TaskCapabilityIssuer(Buffer.alloc(32, 1)),
      () => ({ status: "logged_in" }),
      { command: "mcp", args: [], environment: {} },
      undefined,
      undefined,
      undefined,
      continuations,
    );
    const attention = new OrderedAttentionQueue();
    coordinator.onContinuationRegistered((record) => {
      attention.enqueue({
        authority: "rove_control",
        kind: "control_handoff",
        requestId: `control:${record.roveSessionId}:${record.handoffId}`,
        taskId: record.roveTaskId,
        threadId: record.codexThreadId,
        turnId: record.originatingCodexTurnId,
        generation: record.handoffGeneration,
        payload: {
          instruction: record.requestedInstruction,
          policy: record.continuationPolicy,
        },
      });
    });
    const event = {
      method: "item/completed",
      params: {
        threadId: "thread_bound",
        turnId: "turn_origin",
        item: toolItem,
      },
    } as never;
    await Promise.all([
      coordinator.reconcileHandoffEvent(event),
      coordinator.reconcileHandoffEvent(event),
    ]);
    expect(await continuations.pending()).toHaveLength(1);
    expect(attention.list()).toHaveLength(1);

    control = {
      ...control,
      generation: 11,
      status: "active",
      controller: "human",
      observationSeq: 41,
    };
    const taskPort = {
      taskIdForRuntimeSession: async (sessionId: string) =>
        coordinator.taskIdForRuntimeSession(sessionId),
      submit: vi.fn(
        async (intent: {
          type: string;
          taskId: string;
          operationId: string;
        }) => {
          if (intent.type !== "return_control")
            throw new Error("Unexpected task intent.");
          return {
            duplicate: false,
            aggregate: { taskId: intent.taskId },
            projection: {
              operationDisposition: {
                operationId: intent.operationId,
                type: "return_control",
                status: "accepted",
                reason: "Accepted for durable processing.",
              },
            },
            command: null,
          };
        },
      ),
    };
    const api = new LocalProductApi(
      () => ({
        state: "ready",
        ready: true,
        restartAttempt: 0,
        stderrTail: [],
      }),
      {} as never,
      taskPort,
      {} as never,
      attention,
    );
    await expect(api.prepareReturnControl("ses_bound")).resolves.toBe(
      "task_bound",
    );
    control = {
      sessionId: "ses_bound",
      generation: 12,
      status: "active",
      controller: "agent",
      lastReturnedHandoffId: "handoff_exact",
      observationSeq: 41,
      updatedAt: "2026-09-08T00:01:00Z",
    };
    thread.turns.push({
      id: "turn_competing",
      items: [],
      itemsView: "full",
      status: "inProgress",
      error: null,
      startedAt: 3,
      completedAt: null,
      durationMs: null,
    });
    await expect(api.completeReturnControl("ses_bound")).resolves.toBe(
      "dispatched",
    );
    expect(taskPort.submit).toHaveBeenCalledOnce();
    expect(
      (rpc.request as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([method]) => method === "turn/start",
      ),
    ).toHaveLength(0);
    thread.turns[1] = {
      ...thread.turns[1]!,
      status: "completed",
      completedAt: 4,
      durationMs: 1,
    };
    const restarted = new RoveTaskCoordinator(
      rpc,
      runtime as never,
      {} as never,
      authority,
      new TaskCapabilityIssuer(Buffer.alloc(32, 1)),
      () => ({ status: "logged_in" }),
      { command: "mcp", args: [], environment: {} },
      undefined,
      undefined,
      undefined,
      continuations,
    );
    const terminal = {
      method: "turn/completed",
      params: {
        threadId: "thread_bound",
        turnId: "turn_competing",
        turn: thread.turns[1],
      },
    } as never;
    await Promise.all([
      restarted.reconcileHandoffEvent(terminal),
      restarted.reconcileHandoffEvent(terminal),
    ]);
    await restarted.reconcileHandoffEvent(event);
    expect(
      (rpc.request as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([method]) => method === "turn/start",
      ),
    ).toHaveLength(1);
    expect(attention.list()).toHaveLength(1);

    control = { ...control, lastReturnedHandoffId: "handoff_newer" };
    await restarted.reconcileHandoffEvent(event);
    await restarted.reconcileHandoffEvent(terminal);
    expect(runtime.inspect).toHaveBeenCalledOnce();
    expect(
      (rpc.request as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([method]) => method === "turn/start",
      ),
    ).toHaveLength(1);

    const dispatched = (await continuations.pending())[0]!;
    const commandId = dispatched.continuationCommand!.commandId;
    thread.turns.push({
      id: "turn_next",
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: 5,
      completedAt: 6,
      durationMs: 1,
      items: [
        {
          type: "userMessage",
          id: "item_continue",
          clientId: commandId,
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
    await continuations.reconcile(dispatched, thread);
    const nextItem = structuredClone(toolItem);
    nextItem.id = "item_handoff_next";
    nextItem.result!.content[0]!.text = JSON.stringify({
      sessionId: "ses_bound",
      generation: 14,
      status: "awaiting_human",
      controller: null,
      activeHandoffId: "handoff_newer",
      observationSeq: 50,
    });
    thread.turns.push({
      id: "turn_handoff_next",
      items: [nextItem],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: 7,
      completedAt: 8,
      durationMs: 1,
    });
    control = {
      sessionId: "ses_bound",
      generation: 14,
      status: "awaiting_human",
      controller: null,
      activeHandoffId: "handoff_newer",
      activeHandoffGeneration: 14,
      lastReturnedHandoffId: "handoff_exact",
      observationSeq: 50,
      updatedAt: "2026-09-08T00:02:00Z",
    };
    await restarted.readTaskProjection("task_bound");
    await restarted.readTaskProjection("task_bound");
    expect(await continuations.pending()).toEqual([
      expect.objectContaining({ handoffId: "handoff_newer" }),
    ]);
    const lostItem = structuredClone(toolItem);
    lostItem.id = "item_handoff_lost";
    lostItem.result!.content[0]!.text = JSON.stringify({
      sessionId: "ses_bound",
      generation: 12,
      status: "awaiting_human",
      controller: null,
      activeHandoffId: "handoff_lost",
      observationSeq: 45,
    });
    thread.turns.push({
      id: "turn_handoff_lost",
      items: [lostItem],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: 6,
      completedAt: 7,
      durationMs: 1,
    });
    await expect(restarted.readTaskProjection("task_bound")).rejects.toThrow(
      /not corroborated by authoritative Runtime control truth/,
    );
    expect(await continuations.pending()).toEqual([
      expect.objectContaining({ handoffId: "handoff_newer" }),
    ]);
  });

  it.each([
    [
      "awaiting-human persistence",
      {
        sessionId: "ses_cut",
        generation: 10,
        status: "awaiting_human" as const,
        controller: null,
        activeHandoffId: "handoff_cut",
        activeHandoffGeneration: 10,
        observationSeq: 30,
        updatedAt: "2026-09-08T00:00:00Z",
      },
    ],
    [
      "human takeover",
      {
        sessionId: "ses_cut",
        generation: 11,
        status: "active" as const,
        controller: "human" as const,
        activeHandoffId: "handoff_cut",
        activeHandoffGeneration: 10,
        observationSeq: 31,
        updatedAt: "2026-09-08T00:01:00Z",
      },
    ],
    [
      "agent Return",
      {
        sessionId: "ses_cut",
        generation: 12,
        status: "active" as const,
        controller: "agent" as const,
        lastReturnedHandoffId: "handoff_cut",
        observationSeq: 32,
        updatedAt: "2026-09-08T00:02:00Z",
      },
    ],
  ])(
    "recovers first observation after %s across Desktop, App Server, and Runtime restarts",
    async (_label, control) => {
      const authority = new ContextAuthority();
      authority.restore({
        task_cut: {
          roveTaskId: "task_cut",
          executionMode: "agent",
          browserIdentity: { mode: "temporary" },
          selectionSource: "user_selected",
          selectedAt: "2026-09-08T00:00:00Z",
          policy: {
            cwd: "/work",
            approvalPolicy: "on-request",
            sandbox: "workspace-write",
          },
          bootstrap: {
            attemptId: `boot_${"b".repeat(32)}`,
            threadSource: `rove:task_cut:boot_${"b".repeat(32)}`,
            stage: "complete",
          },
          initialLaunch: {
            operationId: "intent_55555555-5555-4555-a555-555555555555",
            inputDigest: "5".repeat(64),
            stage: "turn_started",
            requestedAt: "2026-09-08T00:00:00Z",
            outcome: "Recover the browser handoff after restart.",
            turnId: "turn_cut",
          },
          roveSessionId: "ses_cut",
          codexThreadId: "thread_cut",
          codexSessionId: "codex_cut",
          capabilityFingerprint: "a".repeat(64),
        },
      });
      const item = {
        type: "mcpToolCall" as const,
        id: "item_cut",
        server: "rove",
        tool: "control.request_human",
        status: "completed",
        arguments: {
          sessionId: "ses_cut",
          reason: "Authenticate",
          instruction: "Inspect the authenticated page and continue.",
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
                sessionId: "ses_cut",
                generation: 10,
                status: "awaiting_human",
                controller: null,
                activeHandoffId: "handoff_cut",
                observationSeq: 30,
              }),
            },
          ],
        },
        error: null,
        durationMs: 1,
      };
      const cutThread: CodexThread = {
        id: "thread_cut",
        extra: null,
        sessionId: "codex_cut",
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
        cliVersion: "0.154.0-alpha.6.2",
        status: { type: "idle" },
        path: null,
        source: "appServer",
        canAcceptDirectInput: true,
        threadSource: `rove:task_cut:boot_${"b".repeat(32)}`,
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: null,
        turns: [
          {
            id: "turn_cut",
            items: [item],
            itemsView: "full",
            status: "completed",
            error: null,
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
          },
        ],
      };
      const rpc = {
        request: vi.fn(async (method: string) => {
          if (method === "thread/read") return { thread: cutThread };
          throw new Error(`Unexpected request ${method}`);
        }),
        notify: vi.fn(),
        respond: vi.fn(),
        onEvent: vi.fn(() => () => undefined),
      } as unknown as CodexRpcPort;
      const repository = new MemoryStateRepository<ContinuationState>();
      const create = (store: DurableContinuationStore) =>
        new RoveTaskCoordinator(
          rpc,
          {
            getControlStatus: vi.fn(async () => control),
            inspect: vi.fn(async () => ({})),
          } as never,
          {} as never,
          authority,
          new TaskCapabilityIssuer(Buffer.alloc(32, 2)),
          () => ({ status: "logged_in" }),
          { command: "mcp", args: [], environment: {} },
          undefined,
          undefined,
          undefined,
          store,
        );

      const firstStore = new DurableContinuationStore(repository);
      await create(firstStore).readTaskProjection("task_cut");
      expect(await firstStore.pending()).toEqual([
        expect.objectContaining({
          handoffId: "handoff_cut",
          observationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]);
      const restartedStore = new DurableContinuationStore(repository);
      const restartedCoordinator = create(restartedStore);
      await restartedCoordinator.readTaskProjection("task_cut");
      await restartedCoordinator.readTaskProjection("task_cut");
      expect(await restartedStore.pending()).toHaveLength(1);
    },
  );
});
