import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  canonicalRoveToolDefinitionsJsonWire,
  emptyTaskAggregate,
  ROVE_TOOL_CATALOG,
  type TaskAggregate,
  type TaskCommand,
} from "@rove/protocol";

import { CodexRuntimeTaskAdapter } from "./codex-runtime-task-adapter.js";
import type { CodexThread } from "./protocol.js";

const taskId = "task_12345678-1234-4123-8123-123456789abc";
const sessionId = "ses_1234567890abcdef1234567890abcdef";
const threadId = "thread-recovery-test";
const bootstrapId = "boot_1234567890abcdef1234567890abcdef";
const threadSource = `rove:${taskId}:${bootstrapId}`;
const codexSessionId = "codex-session-recovery";
const capabilityFingerprint = "f".repeat(64);
const toolDefinitions = ROVE_TOOL_CATALOG.map((name) => ({
  name,
  description: name,
  inputSchema: { type: "object" },
}));
const toolDigest = createHash("sha256")
  .update(canonicalRoveToolDefinitionsJsonWire(toolDefinitions))
  .digest("hex");

function codexThread(status: CodexThread["status"]): CodexThread {
  return {
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
    historyMode: "legacy",
    modelProvider: "openai",
    model: "m1",
    reasoningEffort: "high",
    createdAt: 1,
    updatedAt: 1,
    recencyAt: 1,
    cwd: "/tmp/rove",
    cliVersion: "0.153.4",
    status,
    path: null,
    source: "appServer",
    canAcceptDirectInput: true,
    threadSource,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
}

function threadNotLoadedError(): Error {
  const message = `thread not loaded: ${threadId}`;
  return Object.assign(new Error(message), {
    rpc: { code: -32600, message, data: null },
  });
}

function threadMissingError(): Error {
  const message = `no rollout found for thread id ${threadId}`;
  return Object.assign(new Error(message), {
    rpc: { code: -32600, message, data: null },
  });
}

function mcpStatus() {
  return {
    data: [
      {
        name: "rove",
        runtimeStatus: "connected",
        pluginId: null,
        serverInfo: {
          name: "rove",
          title: null,
          version: "0.1.0",
          description: null,
          websiteUrl: null,
        },
        tools: Object.fromEntries(
          toolDefinitions.map((definition) => [definition.name, definition]),
        ),
        resources: [],
        resourceTemplates: [],
        authStatus: "unsupported",
      },
    ],
    nextCursor: null,
  };
}

function aggregate(): TaskAggregate {
  const value = emptyTaskAggregate(taskId);
  value.launch = {
    operationId: "intent_12345678-1234-4123-8123-123456789abc",
    bootstrapId,
    requestedAt: "2026-09-09T12:00:00.000Z",
    outcome: "Complete the recovery test",
    executionMode: "agent",
    browserIdentity: { mode: "temporary" },
    approvalsReviewer: "auto_review",
    cwd: "/tmp/rove",
    attachmentIds: ["attachment-1"],
  };
  value.record = {
    schemaVersion: 1,
    identity: {
      taskId,
      sessionId,
      threadId,
      browser: { mode: "temporary" },
    },
    bootstrap: { operationId: bootstrapId, threadSource, stage: "complete" },
    desiredState: "open",
  };
  value.codex = {
    availability: "available",
    threadExists: true,
    threadId,
    threadSource,
    sourceLookup: "exact",
    runtimeStatus: "idle",
    archived: false,
    turn: "completed",
  };
  value.codexSessionId = codexSessionId;
  value.capabilityFingerprint = capabilityFingerprint;
  value.runtime = {
    availability: "available",
    sessionExists: true,
    sessionId,
    bootstrapId,
    bootstrapLookup: "exact",
    status: "active",
    controller: "agent",
    attachment: "attached",
    profileLock: "owned",
    browserIdentity: { mode: "temporary" },
    recovery: "not_needed",
  };
  return value;
}

function command(
  type: TaskCommand["type"],
  payload: TaskCommand["payload"],
): TaskCommand {
  return {
    schemaVersion: 1,
    commandId: `command:${type}`,
    taskId,
    aggregateRevision: 1,
    type,
    payload,
    classification:
      type === "respond_codex_attention" ||
      type === "return_runtime_ownership" ||
      type === "archive_codex_thread" ||
      type === "end_runtime_session"
        ? { execute: "uncertain_write", reconcile: "read_truth" }
        : { execute: "repeatable_read", reconcile: "read_truth" },
    status: "leased",
    attempts: 2,
    createdAt: "2026-09-09T12:00:00.000Z",
    claimedFrom: "reconcile_required",
  };
}

function fixture(options: {
  aggregate?: TaskAggregate;
  runtime?: Record<string, unknown>;
  rpc?: Record<string, unknown>;
  attachments?: Record<string, unknown>;
  capabilityIssuer?: Record<string, unknown>;
  expectedToolDefinitionDigest?: string;
}) {
  return new CodexRuntimeTaskAdapter({
    rpc: options.rpc as never,
    runtime: options.runtime as never,
    store: {
      aggregate: vi.fn(async () => options.aggregate ?? aggregate()),
    } as never,
    mcpLaunch: { command: "node", args: [], environment: {} },
    capabilityIssuer: (options.capabilityIssuer ?? {}) as never,
    ...(options.expectedToolDefinitionDigest
      ? { expectedToolDefinitionDigest: options.expectedToolDefinitionDigest }
      : {}),
    attachments: options.attachments as never,
    now: () => "2026-09-09T12:00:00.000Z",
  });
}

describe("Codex/Runtime command reconciliation postconditions", () => {
  it("applies the durable Workflow snapshot for a new idle turn without changing the user message", async () => {
    const task = aggregate();
    task.launch!.workflowContext = {
      workflowId: "workflow_job_search",
      workflowName: "Job search",
      revision: 3,
      digest: "a".repeat(64),
      developerInstructions:
        "Workflow environment: Job search\n\nApproved preferences:\n- Earlier guidance.",
    };
    const thread = codexThread({ type: "idle" });
    const resumes: Record<string, unknown>[] = [];
    const turnStarts: Record<string, unknown>[] = [];
    const rpc = {
      respond: vi.fn(),
      request: vi.fn(
        async (method: string, params: Record<string, unknown>) => {
          if (method === "thread/read") return { thread };
          if (method === "thread/resume") {
            resumes.push(params);
            return {
              thread,
              model: "m1",
              modelProvider: "openai",
              serviceTier: null,
              cwd: "/tmp/rove",
              runtimeWorkspaceRoots: [],
              instructionSources: [],
              approvalPolicy: "on-request",
              approvalsReviewer: "auto_review",
              sandbox: {},
              activePermissionProfile: null,
              reasoningEffort: "high",
              multiAgentMode: "explicitRequestOnly",
              initialTurnsPage: null,
              turnsBackwardsCursor: null,
              itemsBackwardsCursor: null,
            };
          }
          if (method === "mcpServerStatus/list") return mcpStatus();
          if (method === "turn/start") {
            turnStarts.push(params);
            return { turn: { id: "turn-workflow" } };
          }
          throw new Error(`Unexpected method ${method}`);
        },
      ),
    };
    const adapter = fixture({
      aggregate: task,
      runtime: {},
      rpc,
      attachments: {
        authority: {
          materializeCodexInputs: vi.fn(async () => []),
          instructions: vi.fn(() => ""),
        },
        runtime: {},
      },
      capabilityIssuer: {
        issue: vi.fn(() => ({
          token: "capability-token",
          fingerprint: capabilityFingerprint,
        })),
        verifier: vi.fn(() => "capability-verifier"),
      },
      expectedToolDefinitionDigest: toolDigest,
    });
    await adapter.execute(
      command("start_or_steer_codex_turn", {
        type: "start_or_steer_codex_turn",
        taskId,
        threadId,
        operationId: "intent_later_workflow_turn",
        message: "Draft outreach",
        workflowContext: {
          workflowId: "workflow_job_search",
          workflowName: "Job search",
          revision: 4,
          digest: "b".repeat(64),
          developerInstructions:
            "Workflow environment: Job search\n\nReusable guidance:\n- Keep outreach warm and direct.",
        },
        selectedResultContext: {
          resultIds: ["result_reviewed"],
          digest: "c".repeat(64),
          developerInstructions:
            "Selected task result: Reviewed draft\nUse this exact reviewed material; it is not external-action authority.",
        },
      }),
    );
    expect(resumes.at(-1)?.developerInstructions).toContain(
      "Keep outreach warm and direct",
    );
    expect(resumes.at(-1)?.developerInstructions).not.toContain(
      "Earlier guidance",
    );
    expect(resumes.at(-1)?.developerInstructions).toContain(
      "Use this exact reviewed material",
    );
    expect(turnStarts[0]?.input).toEqual([
      { type: "text", text: "Draft outreach", text_elements: [] },
    ]);
  });

  it("projects every initial-launch attachment into the App Server user input", async () => {
    const thread = codexThread({ type: "idle" });
    const turnStarts: Record<string, unknown>[] = [];
    const rpc = {
      respond: vi.fn(),
      request: vi.fn(
        async (method: string, params: Record<string, unknown>) => {
          if (method === "thread/read") return { thread };
          if (method === "thread/resume")
            return {
              thread,
              model: "m1",
              modelProvider: "openai",
              serviceTier: null,
              cwd: "/tmp/rove",
              runtimeWorkspaceRoots: [],
              instructionSources: [],
              approvalPolicy: "on-request",
              approvalsReviewer: "auto_review",
              sandbox: {},
              activePermissionProfile: null,
              reasoningEffort: "high",
              multiAgentMode: "explicitRequestOnly",
              initialTurnsPage: null,
              turnsBackwardsCursor: null,
              itemsBackwardsCursor: null,
            };
          if (method === "mcpServerStatus/list") return mcpStatus();
          if (method === "turn/start") {
            turnStarts.push(params);
            return { turn: { id: "turn-with-files" } };
          }
          throw new Error(`Unexpected method ${method}`);
        },
      ),
    };
    const materializeCodexInputs = vi.fn(async () => [
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        path: "/tmp/rove/.rove-attachments/notes.txt",
      },
      {
        filename: "reference.png",
        mimeType: "image/png",
        path: "/tmp/rove/.rove-attachments/reference.png",
      },
    ]);
    const adapter = fixture({
      runtime: {},
      rpc,
      attachments: {
        authority: {
          materializeCodexInputs,
          instructions: vi.fn(() => ""),
        },
        runtime: {},
      },
      capabilityIssuer: {
        issue: vi.fn(() => ({
          token: "capability-token",
          fingerprint: capabilityFingerprint,
        })),
        verifier: vi.fn(() => "capability-verifier"),
      },
      expectedToolDefinitionDigest: toolDigest,
    });
    const initialOperationId = aggregate().launch!.operationId;
    const result = await adapter.execute(
      command("start_or_steer_codex_turn", {
        type: "start_or_steer_codex_turn",
        taskId,
        threadId,
        operationId: initialOperationId,
        message: "Use both files",
      }),
    );
    expect(result.status).toBe("succeeded");
    expect(materializeCodexInputs).toHaveBeenCalledWith(
      ["attachment-1"],
      taskId,
      sessionId,
      "/tmp/rove",
    );
    expect(turnStarts).toEqual([
      expect.objectContaining({
        input: [
          {
            type: "mention",
            name: "notes.txt",
            path: "/tmp/rove/.rove-attachments/notes.txt",
          },
          {
            type: "localImage",
            path: "/tmp/rove/.rove-attachments/reference.png",
          },
          { type: "text", text: "Use both files", text_elements: [] },
        ],
      }),
    ]);
  });

  it("binds and projects follow-up attachments into the same App Server input", async () => {
    const thread = codexThread({ type: "idle" });
    const turnStarts: Record<string, unknown>[] = [];
    const rpc = {
      respond: vi.fn(),
      request: vi.fn(
        async (method: string, params: Record<string, unknown>) => {
          if (method === "thread/read") return { thread };
          if (method === "thread/resume")
            return {
              thread,
              model: "m1",
              modelProvider: "openai",
              serviceTier: null,
              cwd: "/tmp/rove",
              runtimeWorkspaceRoots: [],
              instructionSources: [],
              approvalPolicy: "on-request",
              approvalsReviewer: "auto_review",
              sandbox: {},
              activePermissionProfile: null,
              reasoningEffort: "high",
              multiAgentMode: "explicitRequestOnly",
              initialTurnsPage: null,
              turnsBackwardsCursor: null,
              itemsBackwardsCursor: null,
            };
          if (method === "mcpServerStatus/list") return mcpStatus();
          if (method === "turn/start") {
            turnStarts.push(params);
            return { turn: { id: "follow-up-with-file" } };
          }
          throw new Error(`Unexpected method ${method}`);
        },
      ),
    };
    const bindDrafts = vi.fn(async () => []);
    const materializeCodexInputs = vi.fn(async () => [
      {
        filename: "follow-up.pdf",
        mimeType: "application/pdf",
        path: "/tmp/rove/.rove-attachments/follow-up.pdf",
      },
    ]);
    const adapter = fixture({
      runtime: {},
      rpc,
      attachments: {
        authority: {
          bindDrafts,
          materializeCodexInputs,
          instructions: vi.fn(() => ""),
        },
        runtime: {},
      },
      capabilityIssuer: {
        issue: vi.fn(() => ({
          token: "capability-token",
          fingerprint: capabilityFingerprint,
        })),
        verifier: vi.fn(() => "capability-verifier"),
      },
      expectedToolDefinitionDigest: toolDigest,
    });
    const operationId = "intent_follow_up_with_file";
    const result = await adapter.execute(
      command("start_or_steer_codex_turn", {
        type: "start_or_steer_codex_turn",
        taskId,
        threadId,
        operationId,
        message: "Read the attached follow-up",
        attachmentIds: ["follow-up-attachment"],
      }),
    );
    expect(result.status).toBe("succeeded");
    expect(bindDrafts).toHaveBeenCalledWith(
      ["follow-up-attachment"],
      taskId,
      sessionId,
      {},
    );
    expect(materializeCodexInputs).toHaveBeenCalledWith(
      ["follow-up-attachment"],
      taskId,
      sessionId,
      "/tmp/rove",
    );
    expect(turnStarts[0]).toMatchObject({
      input: [
        {
          type: "mention",
          name: "follow-up.pdf",
          path: "/tmp/rove/.rove-attachments/follow-up.pdf",
        },
        {
          type: "text",
          text: "Read the attached follow-up",
          text_elements: [],
        },
      ],
    });
  });

  for (const notLoadedSignal of ["status", "rpc"] as const) {
    it(`resumes an exact ${notLoadedSignal}-reported stored thread without redispatch after inconclusive history`, async () => {
      let loaded = false;
      const thread = codexThread({ type: "notLoaded" });
      const calls: string[] = [];
      const rpc = {
        respond: vi.fn(),
        request: vi.fn(
          async (method: string, params: Record<string, unknown>) => {
            calls.push(method);
            if (method === "thread/read") {
              if (!loaded) {
                if (notLoadedSignal === "rpc") throw threadNotLoadedError();
                return { thread };
              }
              return { thread };
            }
            if (method === "thread/resume") {
              expect(params).toMatchObject({
                threadId,
                excludeTurns: false,
                approvalsReviewer: "auto_review",
                permissions: "rove_task",
                runtimeWorkspaceRoots: ["/tmp/rove"],
                config: {
                  default_permissions: "rove_task",
                  permissions: {
                    rove_task: {
                      filesystem: {
                        ":root": "deny",
                        ":minimal": "read",
                        ":workspace_roots": { ".": "write" },
                        ":tmpdir": "deny",
                        ":slash_tmp": "deny",
                      },
                      network: { enabled: false },
                    },
                  },
                },
              });
              loaded = true;
              thread.status = { type: "idle" };
              return {
                thread,
                model: "m1",
                modelProvider: "openai",
                serviceTier: null,
                cwd: "/tmp/rove",
                runtimeWorkspaceRoots: [],
                instructionSources: [],
                approvalPolicy: "on-request",
                approvalsReviewer: "auto_review",
                sandbox: {},
                activePermissionProfile: null,
                reasoningEffort: "high",
                multiAgentMode: "explicitRequestOnly",
                initialTurnsPage: null,
                turnsBackwardsCursor: null,
                itemsBackwardsCursor: null,
              };
            }
            if (method === "mcpServerStatus/list") return mcpStatus();
            if (method === "turn/start") {
              thread.status = { type: "active", activeFlags: [] };
              thread.turns.push({
                id: "turn-recovery",
                items: [
                  {
                    type: "userMessage",
                    id: "item-recovery",
                    clientId: String(params.clientUserMessageId),
                    content: [],
                  },
                ],
                itemsView: "full",
                status: "inProgress",
                error: null,
                startedAt: 1,
                completedAt: null,
                durationMs: null,
              });
              return { turn: thread.turns[0] };
            }
            if (method === "thread/list")
              return {
                data: params.archived === true ? [] : [thread],
                nextCursor: null,
              };
            throw new Error(`Unexpected method ${method}`);
          },
        ),
      };
      const adapter = fixture({
        runtime: {},
        rpc,
        capabilityIssuer: {
          issue: vi.fn(() => ({
            token: "capability-token",
            fingerprint: capabilityFingerprint,
          })),
          verifier: vi.fn(() => "capability-verifier"),
        },
        expectedToolDefinitionDigest: toolDigest,
      });
      const result = await adapter.reconcile(
        command("start_or_steer_codex_turn", {
          type: "start_or_steer_codex_turn",
          taskId,
          threadId,
          operationId: "intent_52345678-1234-4123-8123-123456789abc",
          message: "Open the browser once.",
        }),
      );
      expect(result.status).toBe("unresolved");
      expect(calls.indexOf("thread/resume")).toBeGreaterThan(-1);
      expect(calls.filter((method) => method === "thread/resume")).toHaveLength(
        1,
      );
      expect(calls.filter((method) => method === "turn/start")).toHaveLength(0);
    });
  }

  it("accepts an omitted active-read source only with exact durable thread and session identity", async () => {
    const thread = codexThread({ type: "idle" });
    thread.threadSource = null;
    const rpc = {
      respond: vi.fn(),
      request: vi.fn(async (method: string) => {
        if (method === "thread/read") return { thread };
        if (method === "thread/resume")
          return {
            thread,
            model: "m1",
            modelProvider: "openai",
            serviceTier: null,
            cwd: "/tmp/rove",
            runtimeWorkspaceRoots: [],
            instructionSources: [],
            approvalPolicy: "on-request",
            approvalsReviewer: "auto_review",
            sandbox: {},
            activePermissionProfile: "rove_task",
            reasoningEffort: "high",
            multiAgentMode: "explicitRequestOnly",
            initialTurnsPage: null,
            turnsBackwardsCursor: null,
            itemsBackwardsCursor: null,
          };
        if (method === "mcpServerStatus/list") return mcpStatus();
        if (method === "thread/list")
          return { data: [thread], nextCursor: null };
        throw new Error(`Unexpected method ${method}`);
      }),
    };
    const adapter = fixture({
      runtime: {},
      rpc,
      capabilityIssuer: {
        issue: vi.fn(() => ({
          token: "capability-token",
          fingerprint: capabilityFingerprint,
        })),
        verifier: vi.fn(() => "capability-verifier"),
      },
      expectedToolDefinitionDigest: toolDigest,
    });
    await expect(
      adapter.reconcile(
        command("start_or_steer_codex_turn", {
          type: "start_or_steer_codex_turn",
          taskId,
          threadId,
          operationId: "intent_52345678-1234-4123-8123-123456789abd",
          message: "Reconcile without redispatch.",
        }),
      ),
    ).resolves.toMatchObject({ status: "unresolved" });

    thread.threadSource = "rove:another-task";
    await expect(
      adapter.reconcile(
        command("start_or_steer_codex_turn", {
          type: "start_or_steer_codex_turn",
          taskId,
          threadId,
          operationId: "intent_52345678-1234-4123-8123-123456789abe",
          message: "Reject a conflicting binding.",
        }),
      ),
    ).rejects.toThrow(/thread source/);
  });

  it("correlates a continuation reconciliation through the session supervisor", async () => {
    const continuationId = `continuation:${taskId}:2`;
    const thread = codexThread({ type: "idle" });
    thread.turns = [
      {
        id: "turn-continuation",
        items: [
          {
            type: "userMessage",
            id: "item-continuation",
            clientId: continuationId,
            content: [],
          },
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
      },
    ];
    const rpc = {
      respond: vi.fn(),
      request: vi.fn(async (method: string) => {
        if (method === "thread/read") return { thread };
        if (method === "thread/resume")
          return {
            thread,
            model: "m1",
            modelProvider: "openai",
            serviceTier: null,
            cwd: "/tmp/rove",
            runtimeWorkspaceRoots: [],
            instructionSources: [],
            approvalPolicy: "on-request",
            approvalsReviewer: "auto_review",
            sandbox: {},
            activePermissionProfile: "rove_task",
            reasoningEffort: "high",
            multiAgentMode: "explicitRequestOnly",
            initialTurnsPage: null,
            turnsBackwardsCursor: null,
            itemsBackwardsCursor: null,
          };
        if (method === "mcpServerStatus/list") return mcpStatus();
        if (method === "thread/list")
          return { data: [thread], nextCursor: null };
        throw new Error(`Unexpected method ${method}`);
      }),
    };
    const adapter = fixture({
      runtime: {},
      rpc,
      capabilityIssuer: {
        issue: vi.fn(() => ({
          token: "capability-token",
          fingerprint: capabilityFingerprint,
        })),
        verifier: vi.fn(() => "capability-verifier"),
      },
      expectedToolDefinitionDigest: toolDigest,
    });
    const result = await adapter.reconcile(
      command("reconcile_continuation_dispatch", {
        type: "reconcile_continuation_dispatch",
        taskId,
        threadId,
        commandId: continuationId,
      }),
    );
    expect(result.status).toBe("succeeded");
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        type: "codex_message_delivery_observed",
        delivery: expect.objectContaining({
          operationId: continuationId,
          state: "message_materialized",
        }),
      }),
    );
  });

  it("finishes attachment cleanup after Runtime termination was already accepted", async () => {
    let status = "active";
    let cleanupAttempts = 0;
    const endSession = vi.fn(async () => {
      status = "completed";
    });
    const cleanupTask = vi.fn(async () => {
      cleanupAttempts += 1;
      if (cleanupAttempts === 1) throw new Error("simulated process stop");
    });
    const runtime = {
      listSessionInventory: vi.fn(async () => [
        {
          session: {
            id: sessionId,
            bootstrapId,
            status,
            controller: status === "active" ? "agent" : null,
          },
          attachment: status === "active" ? "attached" : "missing",
          recovery: status === "active" ? "not_needed" : "cleanup_required",
          profileOwnership: status === "active" ? "owned" : "released",
          legacyEffects: "acknowledgement_required",
        },
      ]),
      getControlStatus: vi.fn(async () => ({
        status: "active",
        controller: "agent",
        generation: 1,
        observationSeq: 1,
      })),
      endSession,
    };
    const adapter = fixture({
      runtime,
      rpc: {},
      attachments: {
        authority: {
          cleanupRuntimeGrants: vi.fn(async () => undefined),
          cleanupTask,
        },
        runtime: {},
      },
    });
    const close = command("end_runtime_session", {
      type: "end_runtime_session",
      taskId,
      sessionId,
    });
    await expect(adapter.execute(close)).rejects.toThrow(
      /simulated process stop/,
    );
    const reconciled = await adapter.reconcile(close);
    expect(reconciled.status).toBe("succeeded");
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(cleanupTask).toHaveBeenCalledTimes(2);
    expect(reconciled.facts).toContainEqual(
      expect.objectContaining({
        type: "attachment_state_observed",
        ready: false,
        attachmentIds: [],
      }),
    );
    expect(reconciled.facts).toContainEqual(
      expect.objectContaining({
        type: "runtime_inventory_observed",
        runtime: expect.objectContaining({
          legacyEffects: "acknowledgement_required",
        }),
      }),
    );
  });

  it("reapplies an exact pending Runtime return and proves the returned handoff", async () => {
    let controller = "human";
    let lastReturnedHandoffId: string | undefined;
    const handoffId = "handoff_1234567890abcdef1234567890abcdef";
    const returnControlForSession = vi.fn(async () => {
      controller = "agent";
      lastReturnedHandoffId = handoffId;
    });
    const runtime = {
      listSessionInventory: vi.fn(async () => [
        {
          session: { id: sessionId, bootstrapId, status: "active", controller },
          attachment: "attached",
          recovery: "not_needed",
          profileOwnership: "owned",
          ownershipGeneration: 3,
          handoffId,
          handoffGeneration: 2,
          lastReturnedHandoffId,
          observationSeq: 4,
        },
      ]),
      getControlStatus: vi.fn(async () => ({
        status: "active",
        controller,
        generation: 3,
        activeHandoffId: controller === "human" ? handoffId : undefined,
        activeHandoffGeneration: controller === "human" ? 2 : undefined,
        lastReturnedHandoffId,
        observationSeq: 4,
      })),
      returnControlForSession,
    };
    const adapter = fixture({ runtime, rpc: {} });
    const result = await adapter.reconcile(
      command("return_runtime_ownership", {
        type: "return_runtime_ownership",
        taskId,
        sessionId,
        threadId,
        handoffId,
        generation: 2,
        operationId: "intent_22345678-1234-4123-8123-123456789abc",
      }),
    );
    expect(result.status).toBe("succeeded");
    expect(returnControlForSession).toHaveBeenCalledTimes(1);
  });

  it("reads durable human-control truth while a named browser is relaunchable", async () => {
    const value = aggregate();
    const workspaceId = "wrk_12345678-1234-4123-8123-123456789abc";
    const handoffId = "handoff_1234567890abcdef1234567890abcdef";
    value.launch!.browserIdentity = { mode: "workspace", workspaceId };
    value.record!.identity.browser = { mode: "workspace", workspaceId };
    const getControlStatus = vi.fn(async () => ({
      status: "active" as const,
      controller: "human" as const,
      generation: 4,
      activeHandoffId: handoffId,
      activeHandoffGeneration: 3,
      observationSeq: 11,
    }));
    const adapter = fixture({
      aggregate: value,
      runtime: {
        listSessionInventory: vi.fn(async () => [
          {
            session: {
              id: sessionId,
              bootstrapId,
              status: "active" as const,
              controller: "human" as const,
              ownershipGeneration: 4,
              activeHandoffId: handoffId,
              activeHandoffGeneration: 3,
            },
            browserIdentity: { mode: "workspace", workspaceId },
            attachment: "missing",
            recovery: "relaunchable",
            profileOwnership: "claimable",
          },
        ]),
        getControlStatus,
      },
      rpc: {},
    });

    const result = await adapter.execute(
      command("read_runtime_inventory", {
        type: "read_runtime_inventory",
        taskId,
        sessionId,
      }),
    );

    expect(getControlStatus).toHaveBeenCalledWith(sessionId);
    expect(result).toMatchObject({
      status: "succeeded",
      facts: [
        {
          type: "runtime_inventory_observed",
          runtime: {
            controller: "human",
            attachment: "missing",
            recovery: "relaunchable",
            ownershipGeneration: 4,
            handoffId,
            handoffGeneration: 3,
            observationSeq: 11,
          },
        },
      ],
    });
  });

  it("reads durable Return Control truth while a named browser is relaunchable without reporting it attached", async () => {
    const value = aggregate();
    const workspaceId = "wrk_12345678-1234-4123-8123-123456789abc";
    const handoffId = "handoff_1234567890abcdef1234567890abcdef";
    value.launch!.browserIdentity = { mode: "workspace", workspaceId };
    value.record!.identity.browser = { mode: "workspace", workspaceId };
    value.runtime = {
      ...value.runtime,
      browserIdentity: { mode: "workspace", workspaceId },
    };
    value.continuation = {
      status: "pending",
      id: `continuation:${taskId}:3`,
      taskId,
      sessionId,
      threadId,
      handoffId,
      generation: 3,
      policy: "resume_after_control_return",
      freshInspectionRequired: true,
      preHandoffObservationSeq: 10,
    };
    const getControlStatus = vi.fn(async () => ({
      status: "active" as const,
      controller: "agent" as const,
      generation: 4,
      lastReturnedHandoffId: handoffId,
      observationSeq: 12,
    }));
    const adapter = fixture({
      aggregate: value,
      runtime: {
        listSessionInventory: vi.fn(async () => [
          {
            session: {
              id: sessionId,
              bootstrapId,
              status: "active" as const,
              controller: "agent" as const,
              ownershipGeneration: 4,
              lastReturnedHandoffId: handoffId,
            },
            browserIdentity: { mode: "workspace", workspaceId },
            attachment: "missing",
            recovery: "relaunchable",
            profileOwnership: "claimable",
          },
        ]),
        getControlStatus,
      },
      rpc: {},
    });

    const result = await adapter.execute(
      command("read_runtime_inventory", {
        type: "read_runtime_inventory",
        taskId,
        sessionId,
      }),
    );

    expect(getControlStatus).toHaveBeenCalledWith(sessionId);
    expect(result).toMatchObject({
      status: "succeeded",
      facts: [
        {
          type: "runtime_inventory_observed",
          runtime: {
            sessionId,
            status: "active",
            controller: "agent",
            attachment: "missing",
            recovery: "relaunchable",
            profileLock: "claimable",
            ownershipGeneration: 4,
            lastReturnedHandoffId: handoffId,
            observationSeq: 12,
          },
        },
      ],
    });
  });

  it("does not invent matching Return Control evidence when Runtime reports another handoff", async () => {
    const value = aggregate();
    const expectedHandoffId = "handoff_1234567890abcdef1234567890abcdef";
    value.continuation = {
      status: "pending",
      id: `continuation:${taskId}:3`,
      taskId,
      sessionId,
      threadId,
      handoffId: expectedHandoffId,
      generation: 3,
      policy: "resume_after_control_return",
      freshInspectionRequired: true,
      preHandoffObservationSeq: 10,
    };
    const adapter = fixture({
      aggregate: value,
      runtime: {
        listSessionInventory: vi.fn(async () => [
          {
            session: {
              id: sessionId,
              bootstrapId,
              status: "active" as const,
              controller: "agent" as const,
              ownershipGeneration: 4,
            },
            attachment: "missing",
            recovery: "relaunchable",
            profileOwnership: "claimable",
          },
        ]),
        getControlStatus: vi.fn(async () => ({
          status: "active" as const,
          controller: "agent" as const,
          generation: 4,
          lastReturnedHandoffId: "handoff_fedcba0987654321fedcba0987654321",
          observationSeq: 12,
        })),
      },
      rpc: {},
    });

    const result = await adapter.execute(
      command("read_runtime_inventory", {
        type: "read_runtime_inventory",
        taskId,
        sessionId,
      }),
    );
    const observed = result.facts.find(
      (fact) => fact.type === "runtime_inventory_observed",
    );

    expect(observed).toMatchObject({
      type: "runtime_inventory_observed",
      runtime: {
        attachment: "missing",
        recovery: "relaunchable",
        lastReturnedHandoffId: "handoff_fedcba0987654321fedcba0987654321",
      },
    });
    expect(
      observed?.type === "runtime_inventory_observed"
        ? observed.runtime.lastReturnedHandoffId
        : undefined,
    ).not.toBe(expectedHandoffId);
  });

  it("does not read terminal sessions as recoverable control authority", async () => {
    const getControlStatus = vi.fn();
    const adapter = fixture({
      runtime: {
        listSessionInventory: vi.fn(async () => [
          {
            session: {
              id: sessionId,
              bootstrapId,
              status: "completed" as const,
              controller: null,
              ownershipGeneration: 9,
              lastReturnedHandoffId: "handoff_1234567890abcdef1234567890abcdef",
            },
            attachment: "missing",
            recovery: "cleanup_required",
            profileOwnership: "released",
          },
        ]),
        getControlStatus,
      },
      rpc: {},
    });

    const result = await adapter.execute(
      command("read_runtime_inventory", {
        type: "read_runtime_inventory",
        taskId,
        sessionId,
      }),
    );

    expect(getControlStatus).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      facts: [
        {
          type: "runtime_inventory_observed",
          runtime: {
            status: "completed",
            controller: null,
            attachment: "missing",
            recovery: "cleanup_required",
          },
        },
      ],
    });
    const observed = result.facts.find(
      (fact) => fact.type === "runtime_inventory_observed",
    );
    expect(
      observed?.type === "runtime_inventory_observed"
        ? observed.runtime.lastReturnedHandoffId
        : undefined,
    ).toBeUndefined();
  });

  it("replies only to the exact recoverable Codex attention request", async () => {
    const value = aggregate();
    value.attentions = [
      {
        authority: "codex",
        kind: "command_approval",
        requestId: "request-1",
        method: "item/commandExecution/requestApproval",
        wireRequestId: 7,
        responseFields: { command: "echo ok" },
        taskId,
        threadId,
        generation: 1,
        status: "pending",
      },
    ];
    const respond = vi.fn(async () => undefined);
    const rpc = {
      respond,
      request: vi.fn(
        async (method: string, params: Record<string, unknown>) => {
          const thread = codexThread({ type: "idle" });
          if (method === "thread/read") return { thread };
          if (method === "thread/list")
            return { data: params.archived ? [] : [thread] };
          throw new Error(`Unexpected method ${method}`);
        },
      ),
    };
    const adapter = fixture({ aggregate: value, runtime: {}, rpc });
    const result = await adapter.reconcile(
      command("respond_codex_attention", {
        type: "respond_codex_attention",
        taskId,
        threadId,
        requestId: "request-1",
        generation: 1,
        operationId: "intent_32345678-1234-4123-8123-123456789abc",
        response: { decision: "accept" },
      }),
    );
    expect(result.status).toBe("succeeded");
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith("request-1", {
      decision: "accept",
    });
  });

  it("does not answer a migrated attention without an exact wire descriptor", async () => {
    const value = aggregate();
    value.attentions = [
      {
        authority: "codex",
        kind: "command_approval",
        requestId: "legacy-request",
        taskId,
        threadId,
        generation: 1,
        status: "pending",
      },
    ];
    const respond = vi.fn(async () => undefined);
    const adapter = fixture({
      aggregate: value,
      runtime: {},
      rpc: { respond },
    });
    const result = await adapter.reconcile(
      command("respond_codex_attention", {
        type: "respond_codex_attention",
        taskId,
        threadId,
        requestId: "legacy-request",
        generation: 1,
        operationId: "intent_72345678-1234-4123-8123-123456789abc",
        response: { decision: "decline" },
      }),
    );
    expect(result.status).toBe("unresolved");
    expect(respond).not.toHaveBeenCalled();
  });

  it("reapplies archive after an unfulfilled claim and verifies the result", async () => {
    let archived = false;
    const thread = codexThread({ type: "idle" });
    const rpc = {
      respond: vi.fn(),
      request: vi.fn(
        async (method: string, params: Record<string, unknown>) => {
          if (method === "thread/read") return { thread };
          if (method === "thread/list")
            return { data: params.archived === archived ? [thread] : [] };
          if (method === "thread/resume") return { thread };
          if (method === "mcpServerStatus/list") return mcpStatus();
          if (method === "thread/archive") {
            archived = true;
            return {};
          }
          throw new Error(`Unexpected method ${method}`);
        },
      ),
    };
    const adapter = fixture({
      runtime: {},
      rpc,
      capabilityIssuer: {
        issue: vi.fn(() => ({
          token: "capability-token",
          fingerprint: capabilityFingerprint,
        })),
        verifier: vi.fn(() => "capability-verifier"),
      },
      expectedToolDefinitionDigest: toolDigest,
    });
    const result = await adapter.reconcile(
      command("archive_codex_thread", {
        type: "archive_codex_thread",
        taskId,
        threadId,
        operationId: "intent_42345678-1234-4123-8123-123456789abc",
      }),
    );
    expect(result.status).toBe("succeeded");
    expect(rpc.request).toHaveBeenCalledWith(
      "thread/resume",
      expect.objectContaining({ threadId, excludeTurns: true }),
    );
    expect(rpc.request).toHaveBeenCalledWith("thread/archive", { threadId });
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        type: "codex_thread_observed",
        thread: expect.objectContaining({ archived: true }),
      }),
    );
  });

  it("archives an exact legacy thread without authorizing its work to resume", async () => {
    let archived = false;
    const thread = {
      ...codexThread({ type: "idle" }),
      historyMode: "full" as const,
    };
    const rpc = {
      respond: vi.fn(),
      request: vi.fn(
        async (method: string, params: Record<string, unknown>) => {
          if (method === "thread/read") return { thread };
          if (method === "thread/list")
            return {
              data: params.archived === archived ? [thread] : [],
              nextCursor: null,
            };
          if (method === "thread/archive") {
            archived = true;
            return {};
          }
          throw new Error(`Unexpected method ${method}`);
        },
      ),
    };
    const adapter = fixture({ runtime: {}, rpc });

    const result = await adapter.execute(
      command("archive_codex_thread", {
        type: "archive_codex_thread",
        taskId,
        threadId,
        operationId: "intent_43345678-1234-4123-8123-123456789abc",
      }),
    );

    expect(result.status).toBe("succeeded");
    expect(rpc.request).toHaveBeenCalledWith("thread/archive", { threadId });
    expect(rpc.request).not.toHaveBeenCalledWith(
      "thread/resume",
      expect.anything(),
    );
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        type: "codex_thread_observed",
        thread: expect.objectContaining({ archived: true }),
      }),
    );
  });

  it("attaches a known unloaded thread before inspecting and archiving it", async () => {
    let attached = false;
    let archived = false;
    const thread = codexThread({ type: "notLoaded" });
    const rpc = {
      respond: vi.fn(),
      request: vi.fn(
        async (method: string, params: Record<string, unknown>) => {
          if (method === "thread/read") {
            if (!attached) throw threadNotLoadedError();
            return { thread: { ...thread, status: { type: "idle" } } };
          }
          if (method === "thread/list")
            return {
              data:
                params.archived === archived
                  ? [{ ...thread, status: { type: "idle" } }]
                  : [],
            };
          if (method === "thread/resume") {
            attached = true;
            return { thread: { ...thread, status: { type: "idle" } } };
          }
          if (method === "mcpServerStatus/list") return mcpStatus();
          if (method === "thread/archive") {
            archived = true;
            return {};
          }
          throw new Error(`Unexpected method ${method}`);
        },
      ),
    };
    const adapter = fixture({
      runtime: {},
      rpc,
      capabilityIssuer: {
        issue: vi.fn(() => ({
          token: "capability-token",
          fingerprint: capabilityFingerprint,
        })),
        verifier: vi.fn(() => "capability-verifier"),
      },
      expectedToolDefinitionDigest: toolDigest,
    });
    const result = await adapter.execute(
      command("archive_codex_thread", {
        type: "archive_codex_thread",
        taskId,
        threadId,
        operationId: "intent_52345678-1234-4123-8123-123456789abc",
      }),
    );
    expect(result.status).toBe("succeeded");
    expect(rpc.request).toHaveBeenCalledWith(
      "thread/resume",
      expect.objectContaining({ threadId, excludeTurns: true }),
    );
    expect(rpc.request).toHaveBeenCalledWith("thread/archive", { threadId });
  });

  it("settles archive when an unloaded historical thread has no rollout to resume", async () => {
    const rpc = {
      respond: vi.fn(),
      request: vi.fn(
        async (method: string, params: Record<string, unknown>) => {
          if (method === "thread/read") throw threadNotLoadedError();
          if (method === "thread/resume") throw threadMissingError();
          if (method === "thread/list")
            return { data: [], nextCursor: null, archived: params.archived };
          throw new Error(`Unexpected method ${method}`);
        },
      ),
    };
    const adapter = fixture({
      runtime: {},
      rpc,
      capabilityIssuer: {
        issue: vi.fn(() => ({
          token: "capability-token",
          fingerprint: capabilityFingerprint,
        })),
        verifier: vi.fn(() => "capability-verifier"),
      },
      expectedToolDefinitionDigest: toolDigest,
    });
    const result = await adapter.execute(
      command("archive_codex_thread", {
        type: "archive_codex_thread",
        taskId,
        threadId,
        operationId: "intent_62345678-1234-4123-8123-123456789abc",
      }),
    );
    expect(result.status).toBe("succeeded");
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        type: "codex_thread_observed",
        thread: expect.objectContaining({
          threadExists: false,
          archived: null,
        }),
      }),
    );
    expect(rpc.request).not.toHaveBeenCalledWith("thread/archive", {
      threadId,
    });
  });

  it("settles archive when the exact thread rollout is already absent", async () => {
    const rpc = {
      respond: vi.fn(),
      request: vi.fn(
        async (method: string, _params: Record<string, unknown>) => {
          if (method === "thread/read") throw threadMissingError();
          if (method === "thread/list") return { data: [], nextCursor: null };
          throw new Error(`Unexpected method ${method}`);
        },
      ),
    };
    const adapter = fixture({ runtime: {}, rpc });
    const result = await adapter.reconcile(
      command("archive_codex_thread", {
        type: "archive_codex_thread",
        taskId,
        threadId,
        operationId: "intent_62345678-1234-4123-8123-123456789abc",
      }),
    );
    expect(result.status).toBe("succeeded");
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        type: "codex_thread_observed",
        thread: expect.objectContaining({
          threadExists: false,
          archived: null,
        }),
      }),
    );
    expect(rpc.request).not.toHaveBeenCalledWith("thread/archive", {
      threadId,
    });
  });

  it("observes an exact absent rollout as missing Codex truth", async () => {
    const rpc = {
      respond: vi.fn(),
      request: vi.fn(async (method: string) => {
        if (method === "thread/read") throw threadMissingError();
        if (method === "thread/list") return { data: [], nextCursor: null };
        throw new Error(`Unexpected method ${method}`);
      }),
    };
    const adapter = fixture({ runtime: {}, rpc });
    const result = await adapter.reconcile(
      command("read_codex_thread", {
        type: "read_codex_thread",
        taskId,
        threadId,
      }),
    );
    expect(result.status).toBe("succeeded");
    expect(result.facts).toContainEqual(
      expect.objectContaining({
        type: "codex_thread_observed",
        thread: expect.objectContaining({
          threadExists: false,
          sourceLookup: "none",
        }),
      }),
    );
  });
});
