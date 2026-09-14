import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalRoveToolDefinitionsJsonWire,
  MemoryTaskStore,
  ROVE_TOOL_CATALOG,
  ROVE_TOOL_DEFINITIONS_SHA256,
  TaskProcessManager,
  type Session,
} from "@rove/protocol";
import { TaskProcessWorker } from "./task-process-worker.js";

import { CodexAccountCatalogService } from "./account-catalog.js";
import { CodexAppServerHost } from "./app-server-host.js";
import {
  browserAlternateCapabilityDisposition,
  browserRoutePageDisposition,
  browserRouteRecoveryDisposition,
  browserRouteDeveloperInstructions,
  MAX_BROWSER_RECOVERY_ATTEMPTS_PER_STEP,
  ROVE_BROWSER_ROUTE_POLICY_V5,
} from "./browser-route-policy.js";
import {
  CodexAttentionBroker,
  OrderedAttentionQueue,
  validateAttentionState,
  type AttentionState,
} from "./attention.js";
import { CodexExecutableResolver } from "./compatibility.js";
import {
  DurableContinuationStore,
  validateContinuationRecord,
  type ContinuationState,
  type PendingContinuation,
} from "./continuations.js";
import {
  CodexConversationService,
  PersistentConversationStore,
  normalizeConversationServerEvent,
  reduceConversationEvent,
  validateConversationState,
  type ConversationAssociation,
  type ConversationAssociationStore,
  type ConversationReducerState,
} from "./conversations.js";
import {
  isPinnedEmptyLegacyThreadFailure,
  isPinnedThreadNotLoadedFailure,
} from "./history-compatibility.js";
import { LocalProductApi } from "./local-product-api.js";
import {
  MemoryStateRepository,
  type StateRepository,
  type VersionedState,
} from "./persistence.js";
import {
  CODEX_REVIEWED_METHODS,
  CODEX_SERVER_NOTIFICATION_METHODS,
  CODEX_SERVER_REQUEST_METHODS,
  CODEX_SCHEMA_SHA256,
  parseCodexServerEvent,
  validateCodexRequestParams,
  validateCodexResponse,
  validateServerRequestResponse,
  type CodexRpcPort,
  type CodexServerEvent,
  type CodexThread,
} from "./protocol.js";
import { APPROVED_CODEX_COMPONENT_SET } from "./component-set.js";
import {
  CodexProtocolError,
  CodexRpcConnection,
  CodexTransportUncertainError,
} from "./rpc-connection.js";
import {
  assertRoveMcp,
  ContextAuthority,
  RoveTaskCoordinator,
  TaskCapabilityIssuer,
  validateTaskContext,
  type ResolvedTaskContext,
  type RoveMcpInspection,
} from "./task-coordinator.js";

function fakeRpc(
  handler: (method: string, params: unknown) => unknown | Promise<unknown>,
): CodexRpcPort & { emit(event: CodexServerEvent): void } {
  const listeners = new Set<(event: CodexServerEvent) => void>();
  const request = vi.fn((method: string, params: unknown) =>
    Promise.resolve(handler(method, params)),
  );
  return {
    request: request as CodexRpcPort["request"],
    notify: vi.fn(),
    respond: vi.fn(async () => undefined),
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
const toolDefinitions: Array<{
  name: string;
  description: string;
  inputSchema: { type: string };
}> = ROVE_TOOL_CATALOG.map((name) => ({
  name,
  description: name,
  inputSchema: { type: "object" },
}));
const toolDigest = createHash("sha256")
  .update(canonicalRoveToolDefinitionsJsonWire(toolDefinitions))
  .digest("hex");
function inspection(sessionId: string): RoveMcpInspection {
  return {
    serverName: "rove",
    serverVersion: "0.1.0",
    tools: ROVE_TOOL_CATALOG,
    catalogDigest: toolDigest,
    authenticated: true,
    boundSessionId: sessionId,
    ready: true,
  };
}
function thread(id = "thread_1", source = "rove:test"): CodexThread {
  return {
    id,
    extra: null,
    sessionId: "codex_session_1",
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
    model: "m1",
    reasoningEffort: "high",
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
    threadSource: source,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
  };
}
function emptyLegacyReadError(threadId: string): Error {
  const message = `thread ${threadId} is not materialized yet; includeTurns is unavailable before first user message`;
  return Object.assign(new Error(message), {
    rpc: { code: -32600, message, data: null },
  });
}
function threadNotLoadedError(threadId: string): Error {
  const message = `thread not loaded: ${threadId}`;
  return Object.assign(new Error(message), {
    rpc: { code: -32600, message, data: null },
  });
}
async function parsedRpcErrorFromWire(
  message: string,
  data?: { present: true; value: unknown },
): Promise<Error> {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const rpc = new CodexRpcConnection({
    stdin,
    stdout,
    connectionId: "captured-pinned-error",
  });
  const pending = rpc.request("thread/read", {
    threadId: "01a083df-92e3-7410-80de-785b93150775",
    includeTurns: false,
  });
  const outbound = JSON.parse(stdin.read().toString()) as { id: string };
  stdout.write(
    `${JSON.stringify({
      id: outbound.id,
      error: {
        code: -32600,
        message,
        ...(data === undefined ? {} : { data: data.value }),
      },
    })}\n`,
  );
  try {
    await pending;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("Expected the captured App Server response to reject.");
}
function noRolloutError(threadId: string): Error {
  const message = `no rollout found for thread id ${threadId}`;
  return Object.assign(new Error(message), {
    rpc: { code: -32600, message, data: null },
  });
}
function session(id: string, bootstrapId: string): Session {
  return {
    id,
    bootstrapId,
    mode: "agent",
    status: "active",
    controller: "agent",
    profile: { mode: "temporary" },
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  };
}
function statusResult() {
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
          toolDefinitions.map((entry) => [entry.name, entry]),
        ),
        resources: [],
        resourceTemplates: [],
        authStatus: "unsupported",
      },
    ],
    nextCursor: null,
  };
}
function validContext(
  overrides: Partial<ResolvedTaskContext> = {},
): ResolvedTaskContext {
  return {
    roveTaskId: "task_a",
    executionMode: "agent",
    browserIdentity: { mode: "temporary" },
    selectionSource: "user_selected",
    selectedAt: "2026-09-07T00:00:00.000Z",
    policy: {
      cwd: "/work",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
    },
    bootstrap: {
      attemptId: "boot_11111111111111111111111111111111",
      threadSource: "rove:task_a:boot_11111111111111111111111111111111",
      stage: "complete",
    },
    roveSessionId: "ses_1",
    codexThreadId: "thread_1",
    codexSessionId: "codex_session_1",
    capabilityFingerprint: "f".repeat(64),
    ...overrides,
  };
}
function emptyAssociation(
  context: ResolvedTaskContext,
): ConversationAssociation {
  return {
    roveTaskId: context.roveTaskId,
    codexThreadId: context.codexThreadId!,
    codexSessionId: context.codexSessionId!,
    roveSessionId: context.roveSessionId!,
    turnStatus: "unknown",
    archived: false,
    lastEventSequence: 0,
    items: {},
    turnOrder: [],
  };
}

describe("generated boundary", () => {
  it("locks the exact reviewed methods/digest and rejects raw turn overrides", () => {
    expect(CODEX_SCHEMA_SHA256).toBe(
      APPROVED_CODEX_COMPONENT_SET.component.schema.aggregateSha256,
    );
    expect(CODEX_REVIEWED_METHODS).toContain("mcpServerStatus/list");
    expect(() =>
      validateCodexRequestParams("turn/start", {
        threadId: "t",
        input: [],
        cwd: "/forged",
      } as never),
    ).toThrow(/unsupported field cwd/);
  });
  it("accepts empty generated preview and rejects malformed generated thread/turn/item shapes", () => {
    expect(() =>
      validateCodexResponse("thread/read", { thread: thread() }),
    ).not.toThrow();
    expect(() =>
      validateCodexResponse("thread/read", {
        thread: { ...thread(), status: { type: "invented" } },
      }),
    ).toThrow(/status/);
    expect(() =>
      validateCodexResponse("thread/read", {
        thread: {
          ...thread(),
          turns: [{ id: "turn_1", items: [], status: "completed" }],
        },
      }),
    ).toThrow(/required field|itemsView|unsupported/);
    expect(() =>
      validateCodexResponse("thread/read", {
        thread: {
          ...thread(),
          turns: [
            {
              id: "turn_1",
              items: [{ type: "invented", id: "item_1" }],
              itemsView: "full",
              status: "completed",
              error: null,
              startedAt: 1,
              completedAt: 2,
              durationMs: 1,
            },
          ],
        },
      }),
    ).toThrow(/generated union|Unsupported generated/);
  });
  it("rejects every independently reproduced round-3 protocol defect", () => {
    const base = thread();
    const withoutSource: Partial<CodexThread> = { ...base };
    delete withoutSource.source;
    expect(() =>
      validateCodexResponse("thread/read", { thread: withoutSource }),
    ).toThrow(/source/);
    expect(() =>
      validateCodexResponse("thread/read", {
        thread: { ...base, source: 42 },
      }),
    ).toThrow(/source/);
    expect(() =>
      validateCodexResponse("thread/read", {
        thread: { ...base, canAcceptDirectInput: "yes" },
      }),
    ).toThrow(/canAcceptDirectInput/);

    const turnWith = (item: unknown) => ({
      ...base,
      turns: [
        {
          id: "turn_1",
          items: [item],
          itemsView: "full",
          status: "completed",
          error: null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
        },
      ],
    });
    expect(() =>
      validateCodexResponse("thread/read", {
        thread: turnWith({
          type: "commandExecution",
          id: "item_1",
          command: "true",
          cwd: "/work",
          commandActions: [],
        }),
      }),
    ).toThrow(/required field/);
    expect(() =>
      validateCodexResponse("thread/read", {
        thread: turnWith({
          type: "commandExecution",
          id: "item_1",
          pluginId: null,
          scriptPath: null,
          command: "true",
          cwd: "/work",
          processId: null,
          source: "agent",
          status: "invented",
          commandActions: [],
          aggregatedOutput: null,
          exitCode: null,
          durationMs: null,
        }),
      }),
    ).toThrow(/status/);
    expect(() =>
      validateCodexResponse("thread/start", {
        thread: base,
        model: "m1",
        modelProvider: "openai",
        cwd: "/work",
        runtimeWorkspaceRoots: [],
        instructionSources: [],
      }),
    ).toThrow(/required field/);
    expect(() =>
      parseCodexServerEvent("item/started", {
        item: { type: "contextCompaction", id: "item_1" },
        threadId: "thread_1",
        turnId: "turn_1",
      }),
    ).toThrow(/startedAtMs/);
    expect(() =>
      parseCodexServerEvent(
        "item/commandExecution/requestApproval",
        {
          threadId: "thread_1",
          turnId: "turn_1",
          itemId: "item_1",
          startedAtMs: 1,
        },
        1,
      ),
    ).toThrow(/environmentId|kind/);
    expect(() =>
      validateServerRequestResponse("item/permissions/requestApproval", {
        permissions: {},
        scope: "turn",
      }),
    ).toThrow(/strictAutoReview/);
  });
  it("rejects an unknown field for every reviewed request, response, notification, server request, and server response", () => {
    for (const method of CODEX_REVIEWED_METHODS)
      expect(
        () => validateCodexRequestParams(method, { unexpected: true } as never),
        `request ${method}`,
      ).toThrow();
    for (const method of CODEX_REVIEWED_METHODS)
      expect(
        () => validateCodexResponse(method, { unexpected: true }),
        `response ${method}`,
      ).toThrow();
    for (const method of CODEX_SERVER_NOTIFICATION_METHODS)
      expect(
        () => parseCodexServerEvent(method, { unexpected: true }),
        `notification ${method}`,
      ).toThrow();
    for (const method of CODEX_SERVER_REQUEST_METHODS) {
      expect(
        () => parseCodexServerEvent(method, { unexpected: true }, 1),
        `server request ${method}`,
      ).toThrow();
      expect(
        () => validateServerRequestResponse(method, { unexpected: true }),
        `server response ${method}`,
      ).toThrow();
    }
  });
  it("validates initialize identity and transport response/event correlation", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const failures: Error[] = [];
    const rpc = new CodexRpcConnection({
      stdin,
      stdout,
      connectionId: "c1",
      onProtocolFailure: (error) => failures.push(error),
    });
    const pending = rpc.request("initialize", {
      clientInfo: { name: "rove", title: "Rove", version: "0.1.0" },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    const outbound = JSON.parse(stdin.read().toString()) as { id: string };
    stdout.write(
      `${JSON.stringify({ id: outbound.id, result: { userAgent: "codex-cli 0.154.0-alpha.6.2", codexHome: "/tmp/codex", platformFamily: "unix", platformOs: "macos" } })}\n`,
    );
    await expect(pending).resolves.toMatchObject({ platformOs: "macos" });
    stdout.write(`${JSON.stringify({ id: "orphan", result: {} })}\n`);
    expect(failures[0]).toBeInstanceOf(CodexProtocolError);
    await expect(rpc.request("account/read", {})).rejects.toBeInstanceOf(
      CodexTransportUncertainError,
    );
  });
  it("keeps numeric and string App Server request identities distinct", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const rpc = new CodexRpcConnection({
      stdin,
      stdout,
      connectionId: "typed-ids",
    });
    const events: CodexServerEvent[] = [];
    rpc.onEvent((event) => {
      events.push(event);
    });
    const params = {
      threadId: "thread_1",
      turnId: "turn_1",
      itemId: "item_1",
      startedAtMs: 1,
    };
    stdout.write(
      `${JSON.stringify({ id: 7, method: "item/fileChange/requestApproval", params })}\n`,
    );
    stdout.write(
      `${JSON.stringify({ id: "7", method: "item/fileChange/requestApproval", params: { ...params, itemId: "item_2" } })}\n`,
    );
    await rpc.drainEvents();
    expect(events).toMatchObject([
      {
        requestId: "typed-ids:server:number:7",
        wireRequestId: 7,
      },
      {
        requestId: "typed-ids:server:string:7",
        wireRequestId: "7",
      },
    ]);
    await rpc.closeUncertain("test complete");
  });
  it("records negotiated initialize identity in the supervised host", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const emitter = new EventEmitter();
    const fake = Object.assign(emitter, {
      stdin,
      stdout,
      stderr,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal: NodeJS.Signals) {
        fake.signalCode = signal;
        fake.exitCode = 0;
        emitter.emit("exit", 0, signal);
        return true;
      },
    });
    stdin.setEncoding("utf8");
    let initializeParams: unknown;
    stdin.on("data", (line: string) => {
      const message = JSON.parse(line) as {
        id?: string;
        method: string;
        params?: unknown;
      };
      if (message.method === "initialize") {
        initializeParams = message.params;
        stdout.write(
          `${JSON.stringify({ id: message.id, result: { userAgent: "codex-cli 0.154.0-alpha.6.2", codexHome: "/tmp/codex", platformFamily: "unix", platformOs: "macos" } })}\n`,
        );
      }
    });
    let hashProbeCount = 0;
    const host = new CodexAppServerHost({
      resolver: new CodexExecutableResolver({
        isPackaged: false,
        developmentExecutablePath: process.execPath,
        developmentCodeModeHostPath: process.execPath,
        platform: "darwin",
        architecture: "arm64",
        readVersion: async () => "0.154.0-alpha.6.2",
        hashFile: async () =>
          ++hashProbeCount === 1
            ? "ecad78dbf98adb89ec475edac86630406cbe59d9f3070b17d88065f136b94bcb"
            : "fd36f7c8fc53de66008b9238b5ae24eec686edaf774083fa6e0158385a886626",
        fileSize: async () => 62_787_200,
      }),
      clientVersion: "0.1.0",
      spawnProcess: () => fake as unknown as ChildProcessWithoutNullStreams,
    });
    await host.start();
    expect(initializeParams).toEqual({
      clientInfo: { name: "rove", title: "Rove", version: "0.1.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    expect(host.getNegotiatedIdentity()).toMatchObject({ platformOs: "macos" });
    await host.stop();
  });
});

describe("Codex turn interruption convergence", () => {
  it("waits for delayed authoritative interrupted truth without redispatch", async () => {
    const active = thread();
    active.status = { type: "active", activeFlags: [] };
    active.turns = [
      {
        id: "turn_delayed",
        items: [],
        itemsView: "full",
        status: "inProgress",
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null,
      },
    ];
    let interrupts = 0;
    const rpc = fakeRpc((method) => {
      if (method === "turn/interrupt") {
        interrupts += 1;
        setTimeout(() => {
          rpc.emit({
            method: "turn/completed",
            params: {
              threadId: active.id,
              turn: {
                ...active.turns[0]!,
                status: "interrupted",
                completedAt: 2,
                durationMs: 1,
              },
            },
          });
        }, 20);
        return {};
      }
      if (method === "thread/read") return { thread: active };
      throw new Error(`Unexpected request ${method}`);
    });
    const service = new CodexConversationService(rpc);
    const detach = service.attach();
    await expect(
      service.interruptTurnAndWaitForTerminal(active.id, "turn_delayed", 500),
    ).resolves.toBeUndefined();
    expect(interrupts).toBe(1);
    detach();
  });

  it.each(["completed", "interrupted"] as const)(
    "accepts immediately visible %s terminal truth",
    async (status) => {
      const settled = thread();
      settled.turns = [
        {
          id: "turn_settled",
          items: [],
          itemsView: "full",
          status,
          error: null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
        },
      ];
      const rpc = fakeRpc((method) => {
        if (method === "turn/interrupt") return {};
        if (method === "thread/read") return { thread: settled };
        throw new Error(`Unexpected request ${method}`);
      });
      await expect(
        new CodexConversationService(rpc).interruptTurnAndWaitForTerminal(
          settled.id,
          "turn_settled",
          100,
        ),
      ).resolves.toBeUndefined();
    },
  );
});

describe("Rove browser route recovery policy", () => {
  const base = {
    attemptsForStep: 0,
    retryable: false,
    readOnly: false,
    conclusivelyPreDispatch: true,
    handlerRan: false,
    dispatchStatus: "not_dispatched" as const,
    sameRequest: false,
    validationPath: ["action", "target"],
    freshGrounding: true,
    blockingBoundary: false,
    consequential: false,
  };

  it("authorizes freshly grounded corrections but never identical replay", () => {
    expect(
      browserRouteRecoveryDisposition({ ...base, kind: "invalid_input" }),
    ).toBe("corrected_request");
    expect(
      browserRouteRecoveryDisposition({
        ...base,
        kind: "invalid_input",
        sameRequest: true,
      }),
    ).toBe("stop");
    expect(
      browserRouteRecoveryDisposition({
        ...base,
        kind: "invalid_input",
        dispatchStatus: "unknown",
      }),
    ).toBe("stop");
  });

  it("bounds freshly grounded pre-dispatch recovery by the attempt budget", () => {
    expect(
      browserRouteRecoveryDisposition({
        ...base,
        kind: "freshness",
        attemptsForStep: MAX_BROWSER_RECOVERY_ATTEMPTS_PER_STEP - 1,
        retryable: true,
      }),
    ).toBe("fresh_retry");
    expect(
      browserRouteRecoveryDisposition({
        ...base,
        kind: "freshness",
        attemptsForStep: MAX_BROWSER_RECOVERY_ATTEMPTS_PER_STEP,
        retryable: true,
      }),
    ).toBe("stop");
    expect(
      browserRouteRecoveryDisposition({
        ...base,
        kind: "freshness",
        attemptsForStep: 0,
        retryable: true,
        dispatchStatus: "unknown",
      }),
    ).toBe("stop");
  });

  it("bounds safe read-only recovery and stops consequential replay", () => {
    const safe = {
      ...base,
      kind: "read_only_outcome" as const,
      readOnly: true,
      conclusivelyPreDispatch: false,
      handlerRan: true,
      dispatchStatus: "completed" as const,
      validationPath: undefined,
    };
    expect(browserRouteRecoveryDisposition(safe)).toBe(
      "alternate_read_only_route",
    );
    expect(
      browserRouteRecoveryDisposition({
        ...safe,
        attemptsForStep: MAX_BROWSER_RECOVERY_ATTEMPTS_PER_STEP,
      }),
    ).toBe("stop");
    expect(
      browserRouteRecoveryDisposition({ ...safe, consequential: true }),
    ).toBe("stop");
  });

  it("permits legitimate authorized alternates without enabling bypass or replay", () => {
    const alternate = {
      browserFailure: "read_only" as const,
      authorized: true,
      suitableForRequestedOutcome: true,
      serviceRulesPermit: true,
      wouldBypassRestriction: false,
      wouldExpandAuthorization: false,
      wouldReplayUnresolvedEffect: false,
      consequentialOutcome: "completed" as const,
    };
    expect(browserAlternateCapabilityDisposition(alternate)).toBe(
      "use_authorized_alternate",
    );
    expect(
      browserAlternateCapabilityDisposition({
        ...alternate,
        browserFailure: "conclusively_pre_dispatch",
        consequentialOutcome: "not_dispatched",
      }),
    ).toBe("use_authorized_alternate");
    for (const blocked of [
      { wouldBypassRestriction: true },
      { wouldExpandAuthorization: true },
      { wouldReplayUnresolvedEffect: true },
      { consequentialOutcome: "unknown" as const },
      { browserFailure: "hard_boundary" as const },
      {
        browserFailure: "conclusively_pre_dispatch" as const,
        consequentialOutcome: "completed" as const,
      },
      { authorized: false },
      { serviceRulesPermit: false },
    ])
      expect(
        browserAlternateCapabilityDisposition({ ...alternate, ...blocked }),
      ).toBe("stop");
  });

  it("ignores an unrelated optional survey after the requested path succeeds", () => {
    const mapsSurvey = {
      pageReady: true,
      primaryContentAvailable: true,
      authenticationRequired: false,
      humanVerificationPresented: false,
      accessRestricted: false,
      terminalErrorPresented: false,
      requiredConsentPresented: false,
      optionalSurveyPresented: true,
      requiredOutcomeProven: true,
      optionalSurveyBlocksRequiredTarget: false,
      freshDismissTargetGrounded: false,
    };
    expect(browserRoutePageDisposition(mapsSurvey)).toBe("continue");
    expect(
      browserRoutePageDisposition({
        ...mapsSurvey,
        requiredOutcomeProven: false,
        optionalSurveyBlocksRequiredTarget: true,
        freshDismissTargetGrounded: true,
      }),
    ).toBe("dismiss_optional");
    expect(
      browserRoutePageDisposition({
        ...mapsSurvey,
        humanVerificationPresented: true,
      }),
    ).toBe("request_human");
    expect(
      browserRoutePageDisposition({
        ...mapsSurvey,
        accessRestricted: true,
      }),
    ).toBe("stop");
  });
});

describe("account/catalog", () => {
  it("sends exact browser-hosted and device-code login argument shapes", async () => {
    const requests: unknown[] = [];
    const rpc = fakeRpc((method, params) => {
      if (method !== "account/login/start")
        throw new Error(`Unexpected method ${method}`);
      requests.push(params);
      return (params as { type: string }).type === "chatgptDeviceCode"
        ? {
            type: "chatgptDeviceCode",
            loginId: "login_device",
            verificationUrl: "https://example.invalid/device",
            userCode: "ABCD-EFGH",
          }
        : {
            type: "chatgpt",
            loginId: "login_browser",
            authUrl: "https://example.invalid/browser",
          };
    });
    const service = new CodexAccountCatalogService(rpc);

    await service.login("chatgpt");
    await service.login("deviceCode");

    expect(requests).toEqual([
      {
        type: "chatgpt",
        useHostedLoginSuccessPage: true,
        appBrand: "chatgpt",
      },
      { type: "chatgptDeviceCode" },
    ]);
    expect(requests[1]).not.toHaveProperty("useHostedLoginSuccessPage");
    expect(requests[1]).not.toHaveProperty("appBrand");
  });

  it("projects login-pending state into recoverable renderer-safe catalog truth", async () => {
    const rpc = fakeRpc((method) => {
      if (method === "account/login/start")
        return {
          type: "chatgptDeviceCode",
          loginId: "login_current",
          verificationUrl: "https://example.invalid/device",
          userCode: "ABCD-EFGH",
        };
      if (method === "account/login/cancel") return { status: "cancelled" };
      if (method === "account/read")
        return { account: null, requiresOpenaiAuth: true };
      if (method === "model/list") return { data: [], nextCursor: null };
      if (method === "account/rateLimits/read")
        return {
          rateLimits: {
            limitId: null,
            limitName: null,
            primary: null,
            secondary: null,
            planType: null,
          },
          rateLimitsByLimitId: null,
          accountId: null,
          rateLimitResetCredits: null,
          rateLimitUpsell: null,
        };
      return { summary: {}, dailyUsageBuckets: null };
    });
    const service = new CodexAccountCatalogService(rpc);
    const login = await service.login("deviceCode");
    expect(service.snapshot().login).toEqual(login);
    expect(JSON.stringify(service.snapshot())).not.toContain(
      "https://example.invalid/device",
    );
    expect(service.trustedLoginUrl(login.loginId)).toBe(
      "https://example.invalid/device",
    );
    expect((await service.refresh()).login).toEqual(login);
    await service.cancelLogin(login.loginId);
    expect(service.snapshot()).not.toHaveProperty("login");
    expect(() => service.trustedLoginUrl(login.loginId)).toThrow(/Stale/);
  });

  it("keeps attempt B active when attempt A, null, or foreign completion arrives late", async () => {
    let start = 0;
    const rpc = fakeRpc((method) => {
      if (method === "account/login/start") {
        const loginId = ++start === 1 ? "login_a" : "login_b";
        return {
          type: "chatgpt",
          loginId,
          authUrl: `https://example.invalid/${loginId}`,
        };
      }
      if (method === "account/read")
        return { account: null, requiresOpenaiAuth: true };
      if (method === "model/list") return { data: [], nextCursor: null };
      if (method === "account/rateLimits/read")
        return {
          rateLimits: {
            limitId: null,
            limitName: null,
            primary: null,
            secondary: null,
            planType: null,
          },
          rateLimitsByLimitId: null,
          accountId: null,
          rateLimitResetCredits: null,
          rateLimitUpsell: null,
        };
      return { summary: {}, dailyUsageBuckets: null };
    });
    const service = new CodexAccountCatalogService(rpc);
    service.start();
    await service.login("chatgpt");
    const current = await service.login("chatgpt");
    for (const loginId of ["login_a", null, "login_foreign"]) {
      rpc.emit({
        method: "account/login/completed",
        params: {
          loginId,
          success: true,
          error: null,
          onboardingEntrypoint: null,
        },
      });
      expect(service.snapshot().login).toEqual(current);
      expect(service.trustedLoginUrl(current.loginId)).toBe(
        "https://example.invalid/login_b",
      );
    }
    service.stop();
  });

  it("keeps attempt B valid when attempt A completes while B start is unresolved", async () => {
    const pendingB = deferred<{
      type: "chatgpt";
      loginId: string;
      authUrl: string;
    }>();
    let start = 0;
    const rpc = fakeRpc((method) => {
      if (method === "account/login/start") {
        if (++start === 2) return pendingB.promise;
        return {
          type: "chatgpt",
          loginId: "login_a",
          authUrl: "https://example.invalid/login_a",
        };
      }
      if (method === "account/read")
        return { account: null, requiresOpenaiAuth: true };
      if (method === "model/list") return { data: [], nextCursor: null };
      if (method === "account/rateLimits/read")
        return {
          rateLimits: {
            limitId: null,
            limitName: null,
            primary: null,
            secondary: null,
            planType: null,
          },
          rateLimitsByLimitId: null,
          accountId: null,
          rateLimitResetCredits: null,
          rateLimitUpsell: null,
        };
      return { summary: {}, dailyUsageBuckets: null };
    });
    const service = new CodexAccountCatalogService(rpc);
    service.start();
    await service.login("chatgpt");

    const loginB = service.login("chatgpt");
    rpc.emit({
      method: "account/login/completed",
      params: {
        loginId: "login_a",
        success: true,
        error: null,
        onboardingEntrypoint: null,
      },
    });
    pendingB.resolve({
      type: "chatgpt",
      loginId: "login_b",
      authUrl: "https://example.invalid/login_b",
    });

    const current = await loginB;
    expect(current.loginId).toBe("login_b");
    expect(service.snapshot().login).toEqual(current);
    expect(service.trustedLoginUrl(current.loginId)).toBe(
      "https://example.invalid/login_b",
    );
    service.stop();
  });

  it("does not let account catalog notifications supersede an unresolved login start", async () => {
    const pendingLogin = deferred<{
      type: "chatgpt";
      loginId: string;
      authUrl: string;
    }>();
    const rpc = fakeRpc((method) => {
      if (method === "account/login/start") return pendingLogin.promise;
      if (method === "account/read")
        return { account: null, requiresOpenaiAuth: true };
      if (method === "model/list") return { data: [], nextCursor: null };
      if (method === "account/rateLimits/read")
        return {
          rateLimits: {
            limitId: null,
            limitName: null,
            primary: null,
            secondary: null,
            planType: null,
          },
          rateLimitsByLimitId: null,
          accountId: null,
          rateLimitResetCredits: null,
          rateLimitUpsell: null,
        };
      return { summary: {}, dailyUsageBuckets: null };
    });
    const service = new CodexAccountCatalogService(rpc);
    service.start();

    const login = service.login("chatgpt");
    rpc.emit({
      method: "account/updated",
      params: { authMode: null, planType: null },
    });
    rpc.emit({
      method: "account/rateLimits/updated",
      params: { rateLimits: null },
    });
    pendingLogin.resolve({
      type: "chatgpt",
      loginId: "login_current",
      authUrl: "https://example.invalid/login_current",
    });

    const current = await login;
    expect(service.snapshot().login).toEqual(current);
    expect(service.trustedLoginUrl(current.loginId)).toBe(
      "https://example.invalid/login_current",
    );
    service.stop();
  });

  it("does not let a pre-logout refresh restore stale account state", async () => {
    const account = deferred<unknown>();
    const models = deferred<unknown>();
    const limits = deferred<unknown>();
    const usage = deferred<unknown>();
    const rpc = fakeRpc((method) => {
      if (method === "account/read") return account.promise;
      if (method === "model/list") return models.promise;
      if (method === "account/rateLimits/read") return limits.promise;
      if (method === "account/usage/read") return usage.promise;
      if (method === "account/logout") return {};
      throw new Error(`Unexpected method ${method}`);
    });
    const service = new CodexAccountCatalogService(rpc);

    const staleRefresh = service.refresh();
    await service.logout();
    account.resolve({
      account: { type: "chatgpt", email: "stale@example.invalid" },
      requiresOpenaiAuth: true,
    });
    models.resolve({ data: [], nextCursor: null });
    limits.resolve({ rateLimits: null });
    usage.resolve({ summary: {}, dailyUsageBuckets: null });
    await staleRefresh;

    expect(service.snapshot()).toMatchObject({
      account: { status: "logged_out" },
      models: [],
      rateLimits: null,
      usage: null,
    });
    expect(JSON.stringify(service.snapshot())).not.toContain(
      "stale@example.invalid",
    );
  });

  it("clears only matching success and projects a bounded safe matching failure", async () => {
    let start = 0;
    const rpc = fakeRpc((method) => {
      if (method === "account/login/start") {
        const loginId = ++start === 1 ? "login_success" : "login_failure";
        return {
          type: "chatgpt",
          loginId,
          authUrl: `https://example.invalid/${loginId}`,
        };
      }
      if (method === "account/read")
        return { account: null, requiresOpenaiAuth: true };
      if (method === "model/list") return { data: [], nextCursor: null };
      if (method === "account/rateLimits/read")
        return {
          rateLimits: {
            limitId: null,
            limitName: null,
            primary: null,
            secondary: null,
            planType: null,
          },
          rateLimitsByLimitId: null,
          accountId: null,
          rateLimitResetCredits: null,
          rateLimitUpsell: null,
        };
      return { summary: {}, dailyUsageBuckets: null };
    });
    const service = new CodexAccountCatalogService(rpc);
    service.start();

    const success = await service.login("chatgpt");
    rpc.emit({
      method: "account/login/completed",
      params: {
        loginId: success.loginId,
        success: true,
        error: null,
        onboardingEntrypoint: null,
      },
    });
    expect(service.snapshot()).not.toHaveProperty("login");
    expect(() => service.trustedLoginUrl(success.loginId)).toThrow(/Stale/);

    const failure = await service.login("chatgpt");
    rpc.emit({
      method: "account/login/completed",
      params: {
        loginId: failure.loginId,
        success: false,
        error:
          "token=remote-secret https://callback.invalid/?code=secret user@example.com",
        onboardingEntrypoint: null,
      },
    });
    const failed = service.snapshot();
    expect(failed).not.toHaveProperty("login");
    expect(failed.account).toMatchObject({
      status: "logged_out",
      error: "Rove sign-in did not complete. Try again or use device code.",
    });
    expect(JSON.stringify(failed)).not.toMatch(
      /remote-secret|callback\.invalid|user@example\.com/,
    );
    service.stop();
  });

  it("cannot let an old in-flight cancel remove a newer login", async () => {
    let resolveCancel!: (value: { status: string }) => void;
    const cancelResult = new Promise<{ status: string }>((resolve) => {
      resolveCancel = resolve;
    });
    let start = 0;
    const rpc = fakeRpc((method) => {
      if (method === "account/login/start") {
        const loginId = ++start === 1 ? "login_a" : "login_b";
        return {
          type: "chatgpt",
          loginId,
          authUrl: `https://example.invalid/${loginId}`,
        };
      }
      if (method === "account/login/cancel") return cancelResult;
      throw new Error(`Unexpected method ${method}`);
    });
    const service = new CodexAccountCatalogService(rpc);
    const attemptA = await service.login("chatgpt");
    const cancelA = service.cancelLogin(attemptA.loginId);
    const attemptB = await service.login("chatgpt");
    resolveCancel({ status: "cancelled" });
    await expect(cancelA).rejects.toThrow(/Superseded/);
    expect(service.snapshot().login).toEqual(attemptB);
    expect(service.trustedLoginUrl(attemptB.loginId)).toBe(
      "https://example.invalid/login_b",
    );
    await expect(service.cancelLogin(attemptA.loginId)).rejects.toThrow(
      /Stale/,
    );
  });

  it("filters hidden models, preserves defaults/capabilities, and performs managed refresh", async () => {
    const reads: unknown[] = [];
    const rpc = fakeRpc((method, params) => {
      if (method === "account/read") {
        reads.push(params);
        return {
          account: {
            type: "chatgpt",
            email: "secret@example.com",
            planType: "pro",
          },
          requiresOpenaiAuth: true,
        };
      }
      if (method === "model/list")
        return {
          data: [
            {
              id: "visible",
              model: "gpt",
              displayName: "Visible",
              description: "d",
              hidden: false,
              supportedReasoningEfforts: [
                { reasoningEffort: "high", description: "h" },
              ],
              defaultReasoningEffort: "high",
              inputModalities: ["text"],
              supportsPersonality: true,
              defaultServiceTier: null,
              isDefault: true,
            },
            {
              id: "hidden",
              model: "h",
              displayName: "Hidden",
              description: "d",
              hidden: true,
              supportedReasoningEfforts: [],
              defaultReasoningEffort: "medium",
              inputModalities: [],
              supportsPersonality: false,
              defaultServiceTier: null,
              isDefault: false,
            },
          ],
          nextCursor: null,
        };
      if (method === "account/rateLimits/read")
        return {
          rateLimits: {
            limitId: "codex",
            limitName: "Codex",
            primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 9 },
            secondary: null,
            planType: "pro",
          },
          rateLimitsByLimitId: null,
          accountId: "redacted",
          rateLimitResetCredits: null,
          rateLimitUpsell: null,
        };
      return { summary: { lifetimeTokens: 3 }, dailyUsageBuckets: null };
    });
    const service = new CodexAccountCatalogService(rpc);
    const snapshot = await service.refreshManagedToken();
    expect(reads).toEqual([{ refreshToken: true }]);
    expect(snapshot.models).toHaveLength(1);
    expect(snapshot.models[0]).toMatchObject({
      id: "visible",
      defaultEffort: "high",
      isDefault: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain("secret@example.com");
  });
  it("fences stale login and account refresh completions across logout", async () => {
    let resolveLogin!: (value: unknown) => void;
    let resolveAccount!: (value: unknown) => void;
    const loginResult = new Promise((resolve) => {
      resolveLogin = resolve;
    });
    const accountResult = new Promise((resolve) => {
      resolveAccount = resolve;
    });
    const rpc = fakeRpc((method) => {
      if (method === "account/login/start") return loginResult;
      if (method === "account/read") return accountResult;
      if (method === "account/logout") return {};
      if (method === "model/list") return { data: [], nextCursor: null };
      if (method === "account/rateLimits/read")
        return {
          rateLimits: {
            limitId: null,
            limitName: null,
            primary: null,
            secondary: null,
            planType: null,
          },
          rateLimitsByLimitId: null,
          accountId: null,
          rateLimitResetCredits: null,
          rateLimitUpsell: null,
        };
      return { summary: {}, dailyUsageBuckets: null };
    });
    const service = new CodexAccountCatalogService(rpc);
    const login = service.login("chatgpt");
    const refresh = service.refresh();
    await service.logout();
    resolveLogin({
      type: "chatgpt",
      loginId: "login_stale",
      authUrl: "https://example.invalid",
    });
    resolveAccount({
      account: { type: "chatgpt", planType: "pro" },
      requiresOpenaiAuth: true,
    });
    await expect(login).rejects.toThrow(/Superseded/);
    await refresh;
    expect(service.snapshot()).toMatchObject({
      account: { status: "logged_out" },
      models: [],
    });
    await expect(service.cancelLogin("login_stale")).rejects.toThrow(/Stale/);
  });
});

describe("bounded conversation projection", () => {
  it("retains ordered user input attachments without exposing their paths", () => {
    const event = normalizeConversationServerEvent(
      {
        method: "item/completed",
        params: {
          threadId: "thread_1",
          turnId: "turn_1",
          item: {
            type: "userMessage",
            id: "item_1",
            clientId: "intent_1",
            content: [
              {
                type: "mention",
                name: "brief.pdf",
                path: "/private/task/.rove-attachments/brief.pdf",
              },
              {
                type: "localImage",
                path: "/private/task/.rove-attachments/reference.png",
              },
              { type: "text", text: "Use these files", text_elements: [] },
            ],
          },
        },
      },
      1,
    )!;
    expect(event.item).toMatchObject({
      text: "Use these files",
      attachments: [
        { filename: "brief.pdf", kind: "file" },
        { filename: "reference.png", kind: "image" },
      ],
    });
    expect(JSON.stringify(event.item)).not.toContain("/private/task");
  });

  it("uses semantic identity and rejects conflicting terminal payloads", () => {
    const completed = normalizeConversationServerEvent(
      {
        method: "turn/completed",
        params: {
          threadId: "thread_1",
          turn: {
            id: "turn_1",
            items: [],
            itemsView: "full",
            status: "completed",
            error: null,
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
          },
        },
      },
      1,
    )!;
    const failed = normalizeConversationServerEvent(
      {
        method: "turn/completed",
        params: {
          threadId: "thread_1",
          turn: {
            id: "turn_1",
            items: [],
            itemsView: "full",
            status: "failed",
            error: null,
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
          },
        },
      },
      2,
    )!;
    expect(completed.eventId).toBe(failed.eventId);
    const state: ConversationReducerState = {
      associations: {
        thread_1: {
          roveTaskId: "task_a",
          codexThreadId: "thread_1",
          codexSessionId: "codex_session_1",
          roveSessionId: "ses_1",
          turnStatus: "unknown",
          archived: false,
          lastEventSequence: 0,
          items: {},
          turnOrder: [],
        },
      },
      eventFingerprints: {},
      pendingByThread: {},
    };
    const reduced = reduceConversationEvent(state, completed);
    expect(() => reduceConversationEvent(reduced, failed)).toThrow(
      /Conflicting/,
    );
  });
  it("reconciles a live start with completed truth idempotently before Stop cleanup", async () => {
    const conversationRepository =
      new MemoryStateRepository<ConversationReducerState>();
    const store = new PersistentConversationStore(conversationRepository);
    await store.bind({
      roveTaskId: "task_a",
      codexThreadId: "thread_1",
      codexSessionId: "codex_session_1",
      roveSessionId: "ses_1",
      turnStatus: "unknown",
      archived: false,
      lastEventSequence: 0,
      items: {},
      turnOrder: [],
    });
    await store.apply(
      normalizeConversationServerEvent(
        {
          method: "turn/started",
          params: {
            threadId: "thread_1",
            turn: {
              id: "turn_1",
              items: [],
              itemsView: "full",
              status: "inProgress",
              error: null,
              startedAt: 1,
              completedAt: null,
              durationMs: null,
            },
          },
        },
        1,
      )!,
    );
    const authoritative: CodexThread = {
      ...thread(),
      turns: [
        {
          id: "turn_1",
          items: [
            {
              type: "agentMessage",
              id: "item_1",
              text: "done",
              phase: null,
              memoryCitation: null,
              delivery: null,
              questions: null,
            },
          ],
          itemsView: "full",
          status: "completed",
          error: null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
        },
      ],
    };
    await expect(store.reconcile(authoritative)).resolves.toBeUndefined();
    await expect(store.reconcile(authoritative)).resolves.toBeUndefined();
    expect(await store.projection("thread_1")).toMatchObject({
      turnStatus: "completed",
      items: { item_1: { status: "completed", text: "done" } },
    });

    const authority = new ContextAuthority();
    authority.restore({ task_a: validContext() });
    const endSession = vi.fn(async () => undefined);
    const rpc = fakeRpc((method) => {
      if (method === "thread/read") return { thread: authoritative };
      throw new Error(`Unexpected request ${method}`);
    });
    const contextRepository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const coordinator = new RoveTaskCoordinator(
      rpc,
      { startSession: vi.fn(), endSession } as never,
      {} as never,
      authority,
      new TaskCapabilityIssuer(Buffer.alloc(32, 8)),
      () => ({ status: "logged_in" }),
      { command: "node", args: [], environment: {} },
      () => "2026-09-08T00:00:00.000Z",
      store,
      () => [],
      undefined,
      contextRepository,
    );

    await expect(
      coordinator.readTaskProjection("task_a"),
    ).resolves.toMatchObject({ turnStatus: "completed" });
    await expect(coordinator.closeTask("task_a")).resolves.toBeUndefined();
    expect(endSession).toHaveBeenCalledExactlyOnceWith("ses_1");
    expect(authority.get("task_a")?.lifecycle).toMatchObject({
      desiredState: "closed",
      closeOperation: { stage: "complete" },
    });
    expect(
      (await contextRepository.read())?.value.contexts.task_a?.lifecycle,
    ).toMatchObject({ desiredState: "closed" });
  });
  it("reconciles a post-dispatch Runtime exception through the production close executor", async () => {
    const capabilityIssuer = new TaskCapabilityIssuer(Buffer.alloc(32, 8));
    const productionContext = validContext();
    productionContext.capabilityFingerprint = capabilityIssuer.issue({
      taskId: productionContext.roveTaskId,
      sessionId: productionContext.roveSessionId!,
      executionMode: productionContext.executionMode,
      browserIdentity: productionContext.browserIdentity,
    }).fingerprint;
    const conversationStore = new PersistentConversationStore(
      new MemoryStateRepository<ConversationReducerState>(),
    );
    await conversationStore.bind(emptyAssociation(productionContext));
    const authoritative: CodexThread = {
      ...thread(),
      turns: [
        {
          id: "turn_done",
          items: [],
          itemsView: "full",
          status: "completed",
          error: null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
        },
      ],
    };
    const authority = new ContextAuthority();
    authority.restore({ task_a: productionContext });
    let ended = false;
    const listSessionInventory = vi.fn(async () => [
      {
        schemaVersion: 1 as const,
        session: {
          id: "ses_1",
          bootstrapId: validContext().bootstrap.attemptId,
          mode: "agent" as const,
          status: ended ? ("completed" as const) : ("active" as const),
          controller: ended ? null : ("agent" as const),
          profile: { mode: "temporary" as const },
          createdAt: "2026-09-07T00:00:00.000Z",
          updatedAt: "2026-09-08T00:00:00.000Z",
          ...(ended ? { endedAt: "2026-09-08T00:00:00.000Z" } : {}),
        },
        browserIdentity: { mode: "temporary" as const },
        attachment: ended ? ("missing" as const) : ("attached" as const),
        recovery: ended
          ? ("cleanup_required" as const)
          : ("not_needed" as const),
        profileOwnership: "released" as const,
      },
    ]);
    const endSession = vi.fn(async () => {
      ended = true;
      throw new Error("simulated cut after Runtime accepted close");
    });
    const commands: string[] = [];
    const reconciled: Array<{ type: string; claimedFrom?: string }> = [];
    let decisionSequence = 0;
    const taskStore = new MemoryTaskStore();
    const manager = new TaskProcessManager(taskStore);
    // The driver closes over the worker, which is initialized after the
    // coordinator that receives this driver.
    // eslint-disable-next-line prefer-const
    let worker!: TaskProcessWorker;
    const driver = {
      runUntilIdle: async () => worker.runUntilIdle(),
    };
    const coordinator = new RoveTaskCoordinator(
      fakeRpc((method) => {
        if (method === "thread/read") return { thread: authoritative };
        throw new Error(`Unexpected request ${method}`);
      }),
      { startSession: vi.fn(), endSession, listSessionInventory } as never,
      {} as never,
      authority,
      capabilityIssuer,
      () => ({ status: "logged_in" }),
      { command: "node", args: [], environment: {} },
      () => "2026-09-08T00:00:00.000Z",
      conversationStore,
      () => [],
      undefined,
      new MemoryStateRepository(),
      undefined,
      undefined,
      undefined,
      undefined,
      async (_input, output) => {
        decisionSequence += 1;
        const accepted = await manager.accept({
          schemaVersion: 1,
          inputId: `test_input_${decisionSequence}`,
          taskId: _input.record!.identity.taskId,
          kind: "fact",
          source: "test",
          sourceId: `test_source_${decisionSequence}`,
          observedAt: "2026-09-08T00:00:00.000Z",
          lifecycle: _input,
          launchConfiguration: productionContext as unknown as Readonly<
            Record<string, unknown>
          >,
          durableData: { schemaVersion: 1, attentions: [] },
        });
        void output;
        if (!accepted.output.nextCommand)
          return {
            commandId: null,
            record: accepted.record,
            output: accepted.output,
          };
        return {
          commandId: accepted.command!.commandId,
          record: accepted.record,
          output: accepted.output,
        };
      },
      undefined,
      driver,
    );
    worker = new TaskProcessWorker({
      store: taskStore,
      workerId: "production-close-test",
      generation: 1,
      adapter: {
        execute: async (command, processContext) => {
          commands.push(command.type);
          return coordinator.executeTaskProcessCommand(
            command,
            false,
            processContext,
          );
        },
        reconcile: (command, processContext) => {
          reconciled.push({
            type: command.type,
            ...(command.claimedFrom === undefined
              ? {}
              : { claimedFrom: command.claimedFrom }),
          });
          return coordinator.executeTaskProcessCommand(
            command,
            true,
            processContext,
          );
        },
      },
    });

    const operationId = "intent_11111111-1111-4111-8111-111111111111";
    await expect(coordinator.closeTask("task_a", operationId)).rejects.toThrow(
      /Durable close stopped/,
    );
    expect(endSession).toHaveBeenCalledOnce();
    await expect(
      coordinator.closeTask("task_a", operationId),
    ).resolves.toBeUndefined();
    expect(commands).toEqual([
      "persist_close_intent",
      "advance_close_stage",
      "advance_close_stage",
      "end_runtime_session",
      "advance_close_stage",
      "advance_close_stage",
      "advance_close_stage",
    ]);
    expect(endSession).toHaveBeenCalledExactlyOnceWith("ses_1");
    expect(reconciled).toContainEqual({
      type: "end_runtime_session",
      claimedFrom: "reconcile_required",
    });
    expect(authority.get("task_a")?.lifecycle?.closeOperation?.stage).toBe(
      "complete",
    );
  });
  it("keeps a bound task cleanup-required when Runtime inventory is empty", async () => {
    const authority = new ContextAuthority();
    authority.restore({ task_a: validContext() });
    const coordinator = new RoveTaskCoordinator(
      fakeRpc((method) => {
        if (method === "thread/read") return { thread: thread() };
        throw new Error(`Unexpected request ${method}`);
      }),
      {
        startSession: vi.fn(),
        listSessionInventory: vi.fn(async () => []),
        endSession: vi.fn(async () => undefined),
      } as never,
      {} as never,
      authority,
      new TaskCapabilityIssuer(Buffer.alloc(32, 8)),
      () => ({ status: "logged_in" }),
      { command: "node", args: [], environment: {} },
      () => "2026-09-08T00:00:00.000Z",
    );

    await expect(
      coordinator.closeTask(
        "task_a",
        "intent_22222222-2222-4222-8222-222222222222",
      ),
    ).rejects.toThrow(/cannot be confirmed/);
    expect(authority.get("task_a")?.lifecycle).toMatchObject({
      desiredState: "closed",
      closeOperation: { stage: "continuation_settled" },
      lastConvergence: { phase: "cleanup_required" },
    });
    const [projected] = await coordinator.productTasks();
    expect(projected?.lifecycle.phase).not.toBe("closed");
    expect(projected?.availableActions).toContain("retry_cleanup");
  });
  it("migrates the exact legacy completed-task fingerprints across restart before Stop", async () => {
    const historical = {
      taskId: "task_803cc8ee-117c-41fb-97b6-9f68418f33f1",
      sessionId: "ses_9a7e1d9fd05e4b968a07058279c89348",
      threadId: "01a08008-803c-7f53-88d5-9667b70d6d94",
      turnId: "01a08008-979b-7a41-9222-5b633b27c2f4",
      itemId: "msg_009a0a46ce233356016a9fc0baffe087d0bca715234e0647b5",
    };
    const assistantText =
      "I couldn’t inspect the browser because the browser tooling failed to start.\n\n| Service | Signed-in status |\n|---|---|\n| GitHub | Unable to verify |\n| Gmail | Unable to verify |\n| Google Calendar | Unable to verify |\n| Google Drive | Unable to verify |\n\nNothing was changed.";
    const item = {
      id: historical.itemId,
      turnId: historical.turnId,
      kind: "assistant_message" as const,
      status: "completed" as const,
      authoredBy: "assistant" as const,
      text: assistantText,
    };
    const turnStartedId = `codex:${historical.threadId}:${historical.turnId}:turn/started`;
    const itemCompletedId = `codex:${historical.threadId}:${historical.turnId}:${historical.itemId}:item/completed`;
    const turnCompletedId = `codex:${historical.threadId}:${historical.turnId}:turn/completed`;
    const legacyState: ConversationReducerState = {
      associations: {
        [historical.threadId]: {
          roveTaskId: historical.taskId,
          codexThreadId: historical.threadId,
          codexSessionId: historical.threadId,
          roveSessionId: historical.sessionId,
          turnStatus: "completed",
          archived: false,
          lastEventSequence: 85,
          items: { [historical.itemId]: item },
          turnOrder: [historical.turnId],
        },
      },
      eventFingerprints: {
        // Exact unversioned raw-transport digests recovered from the failed
        // packaged task's persisted pre-correction conversation state.
        [turnStartedId]:
          "4306e689848bd05512178a586c70132222e4da6c163fc1bf1b14356157a9fecf",
        [itemCompletedId]:
          "1d777cb38d70e999d5f4ea7129de97713825ec04bf1d364ebb471daf51672d11",
        [turnCompletedId]:
          "d7532265b36ac7869599cec59478d67c1af22ca4892e03fb3691988705555934",
      },
      pendingByThread: {},
    };
    const authoritative: CodexThread = {
      ...thread(historical.threadId),
      sessionId: historical.threadId,
      turns: [
        {
          id: historical.turnId,
          items: [
            {
              type: "agentMessage",
              id: historical.itemId,
              text: assistantText,
              phase: null,
              memoryCitation: null,
              delivery: null,
              questions: null,
            },
          ],
          itemsView: "full",
          status: "completed",
          error: null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
        },
      ],
    };
    const conversationRepository =
      new MemoryStateRepository<ConversationReducerState>();
    await conversationRepository.write(0, legacyState);

    const createCoordinator = (
      store: PersistentConversationStore,
      authority: ContextAuthority,
      endSession: ReturnType<typeof vi.fn>,
      contextRepository: MemoryStateRepository<{
        contexts: Record<string, ResolvedTaskContext>;
      }>,
    ) =>
      new RoveTaskCoordinator(
        fakeRpc((method) => {
          if (method === "thread/read") return { thread: authoritative };
          throw new Error(`Unexpected request ${method}`);
        }),
        { startSession: vi.fn(), endSession } as never,
        {} as never,
        authority,
        new TaskCapabilityIssuer(Buffer.alloc(32, 8)),
        () => ({ status: "logged_in" }),
        { command: "node", args: [], environment: {} },
        () => "2026-09-08T00:00:00.000Z",
        store,
        () => [],
        undefined,
        contextRepository,
      );
    const context = validContext({
      roveTaskId: historical.taskId,
      browserIdentity: {
        mode: "workspace",
        workspaceId: "wrk_1e34bdfc-f3cf-489c-851e-ab209fb19720",
      },
      roveSessionId: historical.sessionId,
      codexThreadId: historical.threadId,
      codexSessionId: historical.threadId,
      bootstrap: {
        attemptId: "boot_11111111111111111111111111111111",
        threadSource: `rove:${historical.taskId}:boot_11111111111111111111111111111111`,
        stage: "complete",
      },
    });
    const firstAuthority = new ContextAuthority();
    firstAuthority.restore({ [historical.taskId]: context });
    const contextRepository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const firstStore = new PersistentConversationStore(conversationRepository);
    await expect(
      createCoordinator(
        firstStore,
        firstAuthority,
        vi.fn(async () => undefined),
        contextRepository,
      ).readTaskProjection(historical.taskId),
    ).resolves.toMatchObject({ turnStatus: "completed" });
    expect((await firstStore.read()).eventFingerprintVersions).toMatchObject({
      [turnStartedId]: 2,
      [itemCompletedId]: 2,
      [turnCompletedId]: 2,
    });

    const restartedAuthority = new ContextAuthority();
    restartedAuthority.restore({ [historical.taskId]: context });
    const restartedStore = new PersistentConversationStore(
      conversationRepository,
    );
    const endSession = vi.fn(async () => undefined);
    const restarted = createCoordinator(
      restartedStore,
      restartedAuthority,
      endSession,
      contextRepository,
    );
    await expect(
      restarted.readTaskProjection(historical.taskId),
    ).resolves.toMatchObject({ turnStatus: "completed" });

    const changedItem = normalizeConversationServerEvent(
      {
        method: "item/completed",
        params: {
          threadId: historical.threadId,
          turnId: historical.turnId,
          item: {
            type: "agentMessage",
            id: historical.itemId,
            text: "changed",
            phase: null,
          },
        },
      },
      86,
    )!;
    await expect(restartedStore.apply(changedItem)).rejects.toThrow(
      /Conflicting/,
    );
    const failedTurn = normalizeConversationServerEvent(
      {
        method: "turn/completed",
        params: {
          threadId: historical.threadId,
          turn: {
            id: historical.turnId,
            items: [],
            itemsView: "full",
            status: "failed",
            error: null,
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
          },
        },
      },
      87,
    )!;
    await expect(restartedStore.apply(failedTurn)).rejects.toThrow(
      /Conflicting/,
    );
    await expect(
      restarted.closeTask(historical.taskId),
    ).resolves.toBeUndefined();
    expect(endSession).toHaveBeenCalledExactlyOnceWith(historical.sessionId);
    expect(restartedAuthority.get(historical.taskId)?.lifecycle).toMatchObject({
      desiredState: "closed",
      closeOperation: { stage: "complete" },
    });
    expect(
      (await contextRepository.read())?.value.contexts[historical.taskId]
        ?.lifecycle,
    ).toMatchObject({ desiredState: "closed" });
  });
  it("projects completed items authoritatively and excludes hidden reasoning", () => {
    const event = normalizeConversationServerEvent(
      {
        method: "item/completed",
        params: {
          threadId: "thread_1",
          turnId: "turn_1",
          completedAtMs: 1,
          item: {
            type: "reasoning",
            id: "item_1",
            summary: ["explicit"],
            content: ["hidden chain"],
          },
        },
      },
      1,
    )!;
    expect(event.item).toMatchObject({ kind: "other", text: "explicit" });
    expect(JSON.stringify(event.item)).not.toContain("hidden chain");
  });
  it("rejects changed projected content for one completed-item identity", () => {
    const item = (text: string) =>
      normalizeConversationServerEvent(
        {
          method: "item/completed",
          params: {
            threadId: "thread_1",
            turnId: "turn_1",
            item: {
              type: "agentMessage",
              id: "item_1",
              text,
              phase: null,
            },
          },
        },
        1,
      )!;
    const state: ConversationReducerState = {
      associations: {
        thread_1: {
          roveTaskId: "task_a",
          codexThreadId: "thread_1",
          codexSessionId: "codex_session_1",
          roveSessionId: "ses_1",
          turnStatus: "unknown",
          archived: false,
          lastEventSequence: 0,
          items: {},
          turnOrder: [],
        },
      },
      eventFingerprints: {},
      pendingByThread: {},
    };
    expect(() =>
      reduceConversationEvent(
        reduceConversationEvent(state, item("done")),
        item("changed"),
      ),
    ).toThrow(/Conflicting/);
  });
  it("buffers pre-bind notifications and keeps terminal item/turn truth under reordering", async () => {
    const store = new PersistentConversationStore(
      new MemoryStateRepository<ConversationReducerState>(),
    );
    const completedItem = normalizeConversationServerEvent(
      {
        method: "item/completed",
        params: {
          threadId: "thread_late",
          turnId: "turn_1",
          item: {
            type: "agentMessage",
            id: "item_1",
            text: "done",
            phase: null,
          },
        },
      },
      1,
    )!;
    const completedTurn = normalizeConversationServerEvent(
      {
        method: "turn/completed",
        params: {
          threadId: "thread_late",
          turn: {
            id: "turn_1",
            items: [],
            itemsView: "full",
            status: "completed",
            error: null,
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
          },
        },
      },
      2,
    )!;
    await store.apply(completedItem);
    await store.apply(completedTurn);
    await store.bind({
      roveTaskId: "task_a",
      codexThreadId: "thread_late",
      codexSessionId: "codex_session_1",
      roveSessionId: "ses_1",
      turnStatus: "unknown",
      archived: false,
      lastEventSequence: 0,
      items: {},
      turnOrder: [],
    });
    await store.apply(
      normalizeConversationServerEvent(
        {
          method: "item/started",
          params: {
            threadId: "thread_late",
            turnId: "turn_1",
            item: {
              type: "agentMessage",
              id: "item_1",
              text: "partial",
              phase: null,
            },
          },
        },
        3,
      )!,
    );
    await store.apply(
      normalizeConversationServerEvent(
        {
          method: "turn/started",
          params: {
            threadId: "thread_late",
            turn: {
              id: "turn_1",
              items: [],
              itemsView: "full",
              status: "inProgress",
              error: null,
              startedAt: 1,
              completedAt: null,
              durationMs: null,
            },
          },
        },
        4,
      )!,
    );
    expect(await store.projection("thread_late")).toMatchObject({
      turnStatus: "completed",
      items: { item_1: { status: "completed", text: "done" } },
    });
  });
});

describe("capability and bootstrap", () => {
  it("reports only failed MCP preflight predicate names", () => {
    const secret = "must-not-appear";
    expect(() =>
      assertRoveMcp(
        {
          ready: false,
          authenticated: false,
          serverName: secret,
          serverVersion: secret,
          boundSessionId: secret,
          catalogDigest: secret,
          tools: [secret],
        },
        "ses_expected",
        ROVE_TOOL_DEFINITIONS_SHA256,
      ),
    ).toThrow(
      "Required Rove MCP preflight failed: readiness, authentication, server identity, server version, session binding, definition digest, tool-name set.",
    );
    try {
      assertRoveMcp(
        {
          ready: false,
          authenticated: false,
          serverName: secret,
          serverVersion: secret,
          boundSessionId: secret,
          catalogDigest: secret,
          tools: [secret],
        },
        "ses_expected",
        ROVE_TOOL_DEFINITIONS_SHA256,
      );
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("cryptographically rejects a forged task capability at the MCP boundary", () => {
    const key = Buffer.alloc(32, 7);
    const issuer = new TaskCapabilityIssuer(key);
    const issued = issuer.issue({
      taskId: "task_a",
      sessionId: "ses_1",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
    });
    expect(() => issuer.verify("rtcap_forged.without_signature")).toThrow(
      /signature|Invalid/,
    );
    expect(issuer.verify(issued.token)).toMatchObject({
      taskId: "task_a",
      sessionId: "ses_1",
    });
  });
  it("rejects invalid restored task state", () => {
    expect(() =>
      validateTaskContext({
        ...validContext(),
        executionMode: "root",
        selectedAt: "never",
        bootstrap: { ...validContext().bootstrap, stage: "complete" },
      }),
    ).toThrow(/execution mode/);
  });
  it("migrates only a missing legacy reviewer to Always ask and rejects explicit invalid values", () => {
    const current = validContext();
    const legacyPolicy = { ...current.policy } as Partial<
      ResolvedTaskContext["policy"]
    >;
    delete legacyPolicy.approvalsReviewer;
    expect(
      validateTaskContext({ ...current, policy: legacyPolicy }).policy
        .approvalsReviewer,
    ).toBe("user");
    for (const approvalsReviewer of [null, "automatic", false])
      expect(() =>
        validateTaskContext({
          ...current,
          policy: { ...current.policy, approvalsReviewer },
        }),
      ).toThrow(/approvals reviewer/);
  });
  it("rejects the round-2 negative restart matrix through production restore paths", async () => {
    const taskMutations = [
      { ...validContext(), selectedAt: "2026-09-07" },
      {
        ...validContext(),
        bootstrap: {
          ...validContext().bootstrap,
          threadSource: "rove:other:boot_11111111111111111111111111111111",
        },
      },
      { ...validContext(), roveSessionId: "x" },
      { ...validContext(), capabilityFingerprint: "not-a-digest" },
    ];
    for (const value of taskMutations)
      expect(() => new ContextAuthority().restore({ task_a: value })).toThrow();
    const association = {
      roveTaskId: "task_a",
      codexThreadId: "thread_1",
      codexSessionId: "codex_session_1",
      roveSessionId: "ses_1",
      turnStatus: "unknown",
      archived: false,
      lastEventSequence: 0,
      items: {},
      turnOrder: [],
    };
    const base = {
      associations: { thread_1: association },
      eventFingerprints: {},
      pendingByThread: {},
    };
    const invalidConversations = [
      { ...base, associations: { wrong: association } },
      {
        ...base,
        associations: { thread_1: { ...association, turnStatus: "invented" } },
      },
      {
        ...base,
        associations: { thread_1: { ...association, activeTurnId: 7 } },
      },
      {
        ...base,
        associations: { thread_1: { ...association, lastEventSequence: -1 } },
      },
      {
        ...base,
        associations: {
          thread_1: { ...association, items: { item_1: { id: "item_1" } } },
        },
      },
      { ...base, eventFingerprints: { event_1: 7 } },
      { ...base, pendingByThread: { thread_1: [{ eventId: "event_1" }] } },
    ];
    for (const value of invalidConversations) {
      const repository = new MemoryStateRepository<ConversationReducerState>();
      await repository.write(0, value as never);
      await expect(
        new PersistentConversationStore(repository).read(),
      ).rejects.toThrow();
    }
    const invalidContinuations = [
      {
        roveTaskId: "task_a",
        codexThreadId: "thread_1",
        originatingCodexTurnId: "turn_1",
        roveSessionId: "ses_1",
        handoffGeneration: 1,
        requestedInstruction: "continue",
        continuationPolicy: "resume_after_control_return",
        status: "pending",
        freshInspectionRequired: false,
      },
      {
        roveTaskId: "task_a",
        codexThreadId: "thread_1",
        originatingCodexTurnId: "turn_1",
        roveSessionId: "ses_1",
        handoffGeneration: 1,
        requestedInstruction: "continue",
        continuationPolicy: "explicit_user_response",
        status: "pending",
        freshInspectionRequired: true,
        unknown: true,
      },
    ];
    for (const value of invalidContinuations) {
      const repository = new MemoryStateRepository<ContinuationState>();
      await repository.write(0, {
        records: { "task_a:thread_1:turn_1:ses_1:1": value as never },
        returnEventFingerprints: {},
      });
      await expect(
        new DurableContinuationStore(repository).validate(),
      ).rejects.toThrow();
    }
    expect(() =>
      validateAttentionState({
        sequence: 1,
        entries: [
          {
            authority: "rove_control",
            kind: "control_handoff",
            requestId: "r",
            taskId: "x",
            generation: 1,
            payload: {},
            status: "pending",
            sequence: 1,
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects the round-3 state relationship and exact-type matrix", () => {
    expect(() =>
      validateTaskContext({
        ...validContext(),
        selectedAt: "2026-02-30T00:00:00Z",
      }),
    ).toThrow(/timestamp/);

    const item = {
      id: "item_1",
      turnId: "turn_1",
      kind: "assistant_message",
      status: "completed",
      authoredBy: "assistant",
      text: "OK",
    };
    const association = {
      roveTaskId: "task_a",
      codexThreadId: "thread_1",
      codexSessionId: "codex_session_1",
      roveSessionId: "ses_1",
      turnStatus: "completed",
      archived: false,
      lastEventSequence: 2,
      items: { item_1: item },
      turnOrder: ["turn_1"],
    };
    const conversation = (next: unknown) =>
      validateConversationState({
        associations: { thread_1: next },
        eventFingerprints: {},
        pendingByThread: {},
      });
    const malformedAssociations = [
      { ...association, activeTurnId: "turn_1" },
      { ...association, turnOrder: ["turn_1", "turn_1"] },
      {
        ...association,
        items: { item_1: { ...item, turnId: "turn_2" } },
      },
      {
        ...association,
        items: { item_1: { ...item, authoredBy: "unrecognized" } },
      },
      { ...association, items: { item_1: { ...item, text: 42 } } },
    ];
    for (const malformed of malformedAssociations)
      expect(() => conversation(malformed)).toThrow();
    expect(() =>
      validateConversationState({
        associations: {},
        eventFingerprints: {},
        pendingByThread: {
          thread_1: [
            {
              eventId: "event_1",
              payloadFingerprint: "a".repeat(64),
              sequence: 1,
              threadId: "thread_1",
              type: "item_delta",
            },
          ],
        },
      }),
    ).toThrow(/delta/);

    expect(() =>
      validateContinuationRecord({
        roveTaskId: "task_a",
        codexThreadId: "thread_1",
        originatingCodexTurnId: "turn_1",
        roveSessionId: "ses_1",
        handoffGeneration: 1,
        requestedInstruction: "Continue",
        continuationPolicy: "explicit_user_response",
        status: "pending",
        freshInspectionRequired: "not-a-boolean",
      }),
    ).toThrow(/inspection/);

    const attention = {
      authority: "codex",
      kind: "command_approval",
      requestId: "c1:server:1",
      taskId: "task_a",
      threadId: "thread_1",
      turnId: "turn_1",
      itemId: "item_1",
      generation: 1,
      payload: {},
      status: "pending",
      sequence: 1,
      method: "item/commandExecution/requestApproval",
    };
    expect(() =>
      validateAttentionState({
        sequence: 1,
        entries: [{ ...attention, kind: "file_approval" }],
      }),
    ).toThrow(/method\/kind/);
    expect(() =>
      validateAttentionState({
        sequence: 1,
        entries: [
          attention,
          {
            authority: "rove_control",
            kind: "control_handoff",
            requestId: "control:ses_1:1",
            taskId: "task_a",
            generation: 1,
            payload: {},
            status: "pending",
            sequence: 1,
          },
        ],
      }),
    ).toThrow(/sequence/);
  });

  it("classifies only the exact pinned empty legacy-thread response", () => {
    const context = validateTaskContext(validContext());
    const metadata = thread(
      context.codexThreadId,
      context.bootstrap.threadSource,
    );
    const conversation = emptyAssociation(context);
    const expected = {
      taskId: context.roveTaskId,
      threadId: context.codexThreadId!,
      sessionId: context.codexSessionId!,
      threadSource: context.bootstrap.threadSource,
    };
    const exact = emptyLegacyReadError(context.codexThreadId!);
    expect(
      isPinnedEmptyLegacyThreadFailure(exact, metadata, conversation, expected),
    ).toBe(true);
    const userTurn: CodexThread["turns"][number] = {
      id: "turn_user",
      items: [
        {
          type: "userMessage",
          id: "item_user",
          clientId: "intent_user",
          content: [{ type: "text", text: "Present", text_elements: [] }],
        },
      ],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: 1,
      completedAt: 2,
      durationMs: 1,
    };
    for (const [error, changedThread, changedConversation] of [
      [new Error("timeout"), metadata, conversation],
      [new CodexTransportUncertainError("transport"), metadata, conversation],
      [
        Object.assign(new Error("generic"), {
          rpc: { code: -32603, message: "generic", data: null },
        }),
        metadata,
        conversation,
      ],
      [
        exact,
        { ...metadata, status: { type: "active", activeFlags: [] } },
        conversation,
      ],
      [exact, { ...metadata, threadSource: "rove:other" }, conversation],
      [exact, { ...metadata, turns: [userTurn] }, conversation],
      [
        exact,
        metadata,
        {
          ...conversation,
          turnOrder: ["turn_user"],
          items: {
            item_user: {
              id: "item_user",
              turnId: "turn_user",
              kind: "user_message",
              status: "completed",
              authoredBy: "user",
              text: "Present",
            },
          },
        },
      ],
    ] as const)
      expect(
        isPinnedEmptyLegacyThreadFailure(
          error,
          changedThread as CodexThread,
          changedConversation as ConversationAssociation,
          expected,
        ),
      ).toBe(false);
  });

  it("classifies pinned omitted-data wire errors after production RPC parsing", async () => {
    const context = validateTaskContext(validContext());
    const metadata = thread(
      context.codexThreadId,
      context.bootstrap.threadSource,
    );
    const conversation = emptyAssociation(context);
    const expected = {
      taskId: context.roveTaskId,
      threadId: context.codexThreadId!,
      sessionId: context.codexSessionId!,
      threadSource: context.bootstrap.threadSource,
    };
    const empty = await parsedRpcErrorFromWire(
      `thread ${expected.threadId} is not materialized yet; includeTurns is unavailable before first user message`,
    );
    const notLoaded = await parsedRpcErrorFromWire(
      `thread not loaded: ${expected.threadId}`,
    );
    expect(Object.hasOwn((empty as Error & { rpc: object }).rpc, "data")).toBe(
      false,
    );
    expect(
      isPinnedEmptyLegacyThreadFailure(empty, metadata, conversation, expected),
    ).toBe(true);
    expect(isPinnedThreadNotLoadedFailure(notLoaded, expected.threadId)).toBe(
      true,
    );
    const explicitNull = await parsedRpcErrorFromWire(
      `thread not loaded: ${expected.threadId}`,
      { present: true, value: null },
    );
    expect(
      Object.hasOwn((explicitNull as Error & { rpc: object }).rpc, "data"),
    ).toBe(true);
    expect(
      isPinnedThreadNotLoadedFailure(explicitNull, expected.threadId),
    ).toBe(true);

    const nonNull = await parsedRpcErrorFromWire(
      `thread not loaded: ${expected.threadId}`,
      { present: true, value: { unexpected: true } },
    );
    expect(isPinnedThreadNotLoadedFailure(nonNull, expected.threadId)).toBe(
      false,
    );
    const nonNullEmpty = await parsedRpcErrorFromWire(
      `thread ${expected.threadId} is not materialized yet; includeTurns is unavailable before first user message`,
      { present: true, value: "unexpected" },
    );
    expect(
      isPinnedEmptyLegacyThreadFailure(
        nonNullEmpty,
        metadata,
        conversation,
        expected,
      ),
    ).toBe(false);
    expect(
      isPinnedThreadNotLoadedFailure(
        Object.assign(new Error("extra"), {
          rpc: {
            code: -32600,
            message: `thread not loaded: ${expected.threadId}`,
            extra: true,
          },
        }),
        expected.threadId,
      ),
    ).toBe(false);
    expect(
      isPinnedThreadNotLoadedFailure(new Error("generic"), expected.threadId),
    ).toBe(false);
    expect(
      isPinnedThreadNotLoadedFailure(
        await parsedRpcErrorFromWire("different message"),
        expected.threadId,
      ),
    ).toBe(false);
  });

  class FailOnceRepository<T> implements StateRepository<T> {
    private inner = new MemoryStateRepository<T>();
    private count = 0;
    constructor(private readonly failAt: number) {}
    read(): Promise<VersionedState<T> | undefined> {
      return this.inner.read();
    }
    async write(revision: number, value: T): Promise<VersionedState<T>> {
      this.count += 1;
      if (this.count === this.failAt) throw new Error("crash cut");
      return this.inner.write(revision, value);
    }
  }
  function harness(
    repository: StateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>,
    runtime: {
      startSession: ReturnType<typeof vi.fn>;
      listSessions: ReturnType<typeof vi.fn>;
      endSession: ReturnType<typeof vi.fn>;
    },
    startedThreads: CodexThread[],
    mcpStatus = statusResult(),
    requests?: Array<{ method: string; params: unknown }>,
    conversationStore?: ConversationAssociationStore,
    approvalsReviewerResponse?:
      unknown | ((method: string, params: unknown) => unknown),
    attachments?: never,
    mcpInspection?: RoveMcpInspection,
    onInitialLaunchStagePersisted?: ConstructorParameters<
      typeof RoveTaskCoordinator
    >[15],
    startedHistoryMode: CodexThread["historyMode"] = "legacy",
    threadReadFailure?: (
      thread: CodexThread,
      includeTurns: boolean,
    ) => Error | undefined,
    hideThreadsFromList = false,
    continuationStore?: DurableContinuationStore,
    threadResumeFailure?: (thread: CodexThread) => Error | undefined,
  ) {
    const rpc = fakeRpc((method, params) => {
      requests?.push({ method, params });
      if (method === "thread/list")
        return {
          data:
            hideThreadsFromList ||
            (params as { archived?: boolean }).archived === true
              ? []
              : startedThreads,
          nextCursor: null,
          backwardsCursor: null,
        };
      if (method === "thread/start") {
        const source = (params as { threadSource: string }).threadSource;
        const created = thread(`thread_${startedThreads.length + 1}`, source);
        created.historyMode = startedHistoryMode;
        startedThreads.push(created);
        return {
          thread: created,
          model: "m1",
          modelProvider: "openai",
          serviceTier: null,
          cwd: "/work",
          runtimeWorkspaceRoots: [],
          instructionSources: [],
          approvalPolicy: "on-request",
          approvalsReviewer:
            approvalsReviewerResponse !== undefined
              ? typeof approvalsReviewerResponse === "function"
                ? approvalsReviewerResponse(method, params)
                : approvalsReviewerResponse
              : (params as { approvalsReviewer?: unknown }).approvalsReviewer,
          sandbox: {},
          activePermissionProfile: null,
          reasoningEffort: "high",
          multiAgentMode: "explicitRequestOnly",
        };
      }
      if (method === "thread/resume") {
        const resumed = startedThreads.find(
          (entry) => entry.id === (params as { threadId: string }).threadId,
        );
        if (!resumed) throw new Error("Unknown test thread.");
        const failure = threadResumeFailure?.(resumed);
        if (failure) throw failure;
        return {
          thread: resumed,
          model: "m1",
          modelProvider: "openai",
          serviceTier: null,
          cwd: "/work",
          runtimeWorkspaceRoots: [],
          instructionSources: [],
          approvalPolicy: "on-request",
          approvalsReviewer:
            approvalsReviewerResponse !== undefined
              ? typeof approvalsReviewerResponse === "function"
                ? approvalsReviewerResponse(method, params)
                : approvalsReviewerResponse
              : (params as { approvalsReviewer?: unknown }).approvalsReviewer,
          sandbox: {},
          activePermissionProfile: null,
          reasoningEffort: "high",
          multiAgentMode: "explicitRequestOnly",
          initialTurnsPage: null,
          turnsBackwardsCursor: null,
          itemsBackwardsCursor: null,
        };
      }
      if (method === "thread/read") {
        const found = startedThreads.find(
          (entry) => entry.id === (params as { threadId: string }).threadId,
        );
        if (!found) throw new Error("Unknown test thread.");
        const includeTurns =
          (params as { includeTurns?: boolean }).includeTurns === true;
        const failure = threadReadFailure?.(found, includeTurns);
        if (failure) throw failure;
        return { thread: found };
      }
      if (method === "turn/start") {
        const request = params as {
          threadId: string;
          clientUserMessageId?: string;
          input: CodexThread["turns"][number]["items"];
        };
        const found = startedThreads.find(
          (entry) => entry.id === request.threadId,
        );
        if (!found) throw new Error("Unknown test thread.");
        const created = {
          id: `turn_${found.turns.length + 1}`,
          items: [
            {
              type: "userMessage" as const,
              id: `item_${found.turns.length + 1}`,
              clientId: request.clientUserMessageId ?? null,
              content: request.input as never,
            },
          ],
          itemsView: "full" as const,
          status: "inProgress" as const,
          error: null,
          startedAt: 1,
          completedAt: null,
          durationMs: null,
        };
        found.turns.push(created);
        return { turn: created };
      }
      if (method === "turn/interrupt") {
        const request = params as { threadId: string; turnId: string };
        const found = startedThreads.find(
          (entry) => entry.id === request.threadId,
        );
        const active = found?.turns.find((turn) => turn.id === request.turnId);
        if (!found || !active) throw new Error("Unknown active test turn.");
        active.status = "interrupted";
        active.completedAt = 2;
        active.durationMs = 1;
        found.status = { type: "idle" };
        return {};
      }
      if (method === "mcpServerStatus/list") return mcpStatus;
      return {};
    });
    return new RoveTaskCoordinator(
      rpc,
      runtime as never,
      {
        inspect: async ({ sessionId }) =>
          mcpInspection ?? inspection(sessionId),
      },
      new ContextAuthority(),
      new TaskCapabilityIssuer(Buffer.alloc(32, 8)),
      () => ({ status: "logged_in" }),
      { command: "node", args: [], environment: {} },
      () => "2026-09-07T00:00:00.000Z",
      conversationStore,
      () => [],
      continuationStore,
      repository,
      toolDigest,
      undefined,
      attachments,
      onInitialLaunchStagePersisted,
    );
  }
  const startInput = {
    roveTaskId: "task_boot",
    executionMode: "agent" as const,
    browserIdentity: { mode: "temporary" as const },
    selectionSource: "user_selected" as const,
    cwd: "/work",
    approvalsReviewer: "user" as const,
  };
  it("omits optional platform tables from thread start and resume config", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const sessions: Session[] = [];
    const runtime = {
      startSession: vi.fn(async (request: { bootstrapId: string }) => {
        const created = session("ses_config", request.bootstrapId);
        sessions.push(created);
        return created;
      }),
      listSessions: vi.fn(async () => sessions),
      endSession: vi.fn(async () => undefined),
    };
    const coordinator = harness(
      new MemoryStateRepository(),
      runtime,
      [],
      statusResult(),
      requests,
    );
    const started = await coordinator.start(startInput);
    await coordinator.resume({ roveTaskId: started.context.roveTaskId });

    for (const method of ["thread/start", "thread/resume"]) {
      const params = requests.find((entry) => entry.method === method)?.params;
      expect(params).toBeDefined();
      const wire = JSON.parse(JSON.stringify(params)) as {
        config: {
          computer_use: Record<string, unknown>;
          web_search: string;
        };
      };
      expect(wire.config.web_search).toBe("disabled");
      expect(wire.config.computer_use).toEqual({
        default_app_access: "deny",
      });
      expect(wire.config.computer_use).not.toHaveProperty("macos");
      expect(wire.config.computer_use).not.toHaveProperty("windows");
      expect(params).toMatchObject({
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: "workspace-write",
      });
      expect(JSON.stringify(wire.config.computer_use)).not.toMatch(
        /"(?:macos|windows)":(?:null|"")/,
      );
    }
  });

  it("requests legacy history and cleans a nonlegacy result before dispatch", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const sessions: Session[] = [];
    const runtime = {
      startSession: vi.fn(async (request: { bootstrapId: string }) => {
        const created = session("ses_history", request.bootstrapId);
        sessions.push(created);
        return created;
      }),
      listSessions: vi.fn(async () => sessions),
      endSession: vi.fn(async () => undefined),
    };
    const coordinator = harness(
      new MemoryStateRepository(),
      runtime,
      [],
      statusResult(),
      requests,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "paginated",
    );
    await expect(coordinator.start(startInput)).rejects.toThrow(
      /ignored the required legacy history mode/,
    );
    const start = requests.find((entry) => entry.method === "thread/start");
    expect(start?.params).toMatchObject({
      historyMode: "legacy",
      experimentalRawEvents: false,
    });
    expect(start?.params).not.toHaveProperty("experimentalApi");
    expect(() =>
      validateCodexRequestParams("thread/start", start?.params as never),
    ).not.toThrow();
    expect(requests.some((entry) => entry.method === "turn/start")).toBe(false);
    expect(runtime.endSession).toHaveBeenCalledWith("ses_history");
  });

  it("starts one fresh legacy turn without a pre-turn full-history read", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    const sessions: Session[] = [];
    const threads: CodexThread[] = [];
    const runtime = {
      startSession: vi.fn(async (request: { bootstrapId: string }) => {
        const created = session("ses_legacy_launch", request.bootstrapId);
        sessions.push(created);
        return created;
      }),
      listSessions: vi.fn(async () => sessions),
      endSession: vi.fn(async () => undefined),
    };
    await harness(
      new MemoryStateRepository(),
      runtime,
      threads,
      statusResult(),
      requests,
    ).launch({
      operationId: "intent_33333333-3333-4333-a333-333333333333",
      outcome: "Launch once with legacy reconciliation.",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      selectionSource: "user_selected",
      cwd: "/work",
      approvalsReviewer: "user",
    });
    expect(
      requests
        .filter((entry) => entry.method === "thread/read")
        .map((entry) => entry.params),
    ).toEqual([
      { threadId: "thread_1", includeTurns: false },
      { threadId: "thread_1", includeTurns: true },
    ]);
    expect(
      requests.filter((entry) => entry.method === "turn/start"),
    ).toHaveLength(1);
    expect(
      requests.findIndex((entry) => entry.method === "turn/start"),
    ).toBeLessThan(
      requests.findIndex((entry) => entry.method === "thread/read"),
    );
  });

  it("reconciles the exact empty legacy condition and dispatches at most one turn", async () => {
    const repository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const context = validateTaskContext({
      ...validContext(),
      initialLaunch: {
        operationId: "intent_12121212-1212-4212-a212-121212121212",
        inputDigest: "1".repeat(64),
        stage: "turn_dispatching",
        requestedAt: "2026-09-07T00:00:00.000Z",
        outcome: "Dispatch only after exact empty legacy proof.",
      },
    });
    await repository.write(0, { contexts: { [context.roveTaskId]: context } });
    const truth = thread(context.codexThreadId, context.bootstrap.threadSource);
    const conversationStore = new PersistentConversationStore(
      new MemoryStateRepository(),
    );
    await conversationStore.bind(emptyAssociation(context));
    const requests: Array<{ method: string; params: unknown }> = [];
    const runtimeSession = session(
      context.roveSessionId!,
      context.bootstrap.attemptId,
    );
    const runtime = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => [runtimeSession]),
      getSession: vi.fn(async () => runtimeSession),
      endSession: vi.fn(async () => undefined),
    };
    const recovered = harness(
      repository,
      runtime,
      [truth],
      statusResult(),
      requests,
      conversationStore,
      undefined,
      undefined,
      undefined,
      undefined,
      "legacy",
      (current, includeTurns) =>
        includeTurns && current.turns.length === 0
          ? emptyLegacyReadError(current.id)
          : undefined,
    );
    await recovered.restore();
    await expect(recovered.recoverFromTruth()).resolves.toEqual([]);
    await expect(recovered.recoverFromTruth()).resolves.toEqual([]);
    expect(
      requests.filter((entry) => entry.method === "turn/start"),
    ).toHaveLength(1);
  });

  it.each([
    ["timeout", () => new Error("Codex request thread/read timed out.")],
    [
      "transport",
      () => new CodexTransportUncertainError("Codex transport lost."),
    ],
    [
      "generic RPC",
      () =>
        Object.assign(new Error("generic"), {
          rpc: { code: -32603, message: "generic", data: null },
        }),
    ],
    [
      "active metadata",
      (truth: CodexThread) => {
        truth.status = { type: "active", activeFlags: [] };
        return emptyLegacyReadError(truth.id);
      },
    ],
  ] as const)(
    "keeps %s empty-history uncertainty blocked without replay",
    async (_case, failure) => {
      const repository = new MemoryStateRepository<{
        contexts: Record<string, ResolvedTaskContext>;
      }>();
      const context = validateTaskContext({
        ...validContext(),
        initialLaunch: {
          operationId: "intent_13131313-1313-4313-a313-131313131313",
          inputDigest: "1".repeat(64),
          stage: "turn_dispatching",
          requestedAt: "2026-09-07T00:00:00.000Z",
          outcome: "Never replay ambiguous history.",
        },
      });
      await repository.write(0, {
        contexts: { [context.roveTaskId]: context },
      });
      const truth = thread(
        context.codexThreadId,
        context.bootstrap.threadSource,
      );
      const conversationStore = new PersistentConversationStore(
        new MemoryStateRepository(),
      );
      await conversationStore.bind(emptyAssociation(context));
      const requests: Array<{ method: string; params: unknown }> = [];
      const runtime = {
        startSession: vi.fn(),
        listSessions: vi.fn(async () => [
          session(context.roveSessionId!, context.bootstrap.attemptId),
        ]),
        getSession: vi.fn(async () =>
          session(context.roveSessionId!, context.bootstrap.attemptId),
        ),
        endSession: vi.fn(async () => undefined),
      };
      const recovered = harness(
        repository,
        runtime,
        [truth],
        statusResult(),
        requests,
        conversationStore,
        undefined,
        undefined,
        undefined,
        undefined,
        "legacy",
        (current) => failure(current),
      );
      await recovered.restore();
      expect(await recovered.recoverFromTruth()).toHaveLength(1);
      expect(requests.some((entry) => entry.method === "turn/start")).toBe(
        false,
      );
      expect(
        (await recovered.productTasks())[0]?.context.initialLaunch?.stage,
      ).toBe("reconciliation_required");
    },
  );

  it("closes and archives an exact empty legacy thread without sending a turn", async () => {
    const repository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const context = validateTaskContext({
      ...validContext(),
      initialLaunch: {
        operationId: "intent_14141414-1414-4414-a414-141414141414",
        inputDigest: "1".repeat(64),
        stage: "turn_dispatching",
        requestedAt: "2026-09-07T00:00:00.000Z",
        outcome: "Never dispatch while closing.",
      },
    });
    await repository.write(0, { contexts: { [context.roveTaskId]: context } });
    const truth = thread(context.codexThreadId, context.bootstrap.threadSource);
    const conversationStore = new PersistentConversationStore(
      new MemoryStateRepository(),
    );
    await conversationStore.bind(emptyAssociation(context));
    const requests: Array<{ method: string; params: unknown }> = [];
    const runtime = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => [
        session(context.roveSessionId!, context.bootstrap.attemptId),
      ]),
      endSession: vi.fn(async () => undefined),
    };
    const coordinator = harness(
      repository,
      runtime,
      [truth],
      statusResult(),
      requests,
      conversationStore,
      undefined,
      undefined,
      undefined,
      undefined,
      "legacy",
      (current, includeTurns) =>
        includeTurns ? emptyLegacyReadError(current.id) : undefined,
    );
    await coordinator.restore();
    await coordinator.closeTask(
      context.roveTaskId,
      "intent_15151515-1515-4515-a515-151515151515",
    );
    await coordinator.archiveTaskThread(context.roveTaskId);
    expect(runtime.endSession).toHaveBeenCalledWith(context.roveSessionId);
    expect(requests.some((entry) => entry.method === "thread/archive")).toBe(
      true,
    );
    expect(requests.some((entry) => entry.method === "turn/start")).toBe(false);
  });

  it("settles a cross-restart not-loaded no-message thread during close without a turn or full read", async () => {
    const repository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const closeOperationId = "intent_16161616-1616-4616-a616-161616161616";
    const context = validateTaskContext({
      ...validContext(),
      initialLaunch: {
        operationId: "intent_17171717-1717-4717-a717-171717171717",
        inputDigest: "1".repeat(64),
        stage: "reconciliation_required",
        requestedAt: "2026-09-07T00:00:00.000Z",
        outcome: "Never send this closing task.",
        boundedFailure:
          "Initial turn dispatch requires authoritative reconciliation.",
      },
      lifecycle: {
        schemaVersion: 1,
        desiredState: "closed",
        closeOperation: {
          operationId: closeOperationId,
          requestedAt: "2026-09-07T00:00:00.000Z",
          stage: "requested",
        },
      },
    });
    await repository.write(0, { contexts: { [context.roveTaskId]: context } });
    const truth = thread(context.codexThreadId, context.bootstrap.threadSource);
    truth.status = { type: "notLoaded" };
    const conversationStore = new PersistentConversationStore(
      new MemoryStateRepository(),
    );
    await conversationStore.bind(emptyAssociation(context));
    const parsedNotLoaded = await parsedRpcErrorFromWire(
      `thread not loaded: ${context.codexThreadId}`,
    );
    const requests: Array<{ method: string; params: unknown }> = [];
    const runtime = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => [
        session(context.roveSessionId!, context.bootstrap.attemptId),
      ]),
      endSession: vi.fn(async () => undefined),
    };
    const restarted = harness(
      repository,
      runtime,
      [truth],
      statusResult(),
      requests,
      conversationStore,
      undefined,
      undefined,
      undefined,
      undefined,
      "legacy",
      () => parsedNotLoaded,
      true,
    );
    await restarted.restore();
    await expect(
      restarted.closeTask(context.roveTaskId, closeOperationId),
    ).resolves.toBeUndefined();
    expect(runtime.endSession).toHaveBeenCalledWith(context.roveSessionId);
    expect(
      (await conversationStore.projection(context.codexThreadId!))?.archived,
    ).toBe(true);
    expect(requests.some((entry) => entry.method === "turn/start")).toBe(false);
    expect(
      requests.some(
        (entry) =>
          entry.method === "thread/read" &&
          (entry.params as { includeTurns?: boolean }).includeTurns === true,
      ),
    ).toBe(false);
  });

  it("resumes an exactly listed not-loaded open thread before empty-history reconciliation", async () => {
    const repository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const base = validContext();
    const capabilityFingerprint = new TaskCapabilityIssuer(
      Buffer.alloc(32, 8),
    ).issue({
      taskId: base.roveTaskId,
      sessionId: base.roveSessionId!,
      executionMode: base.executionMode,
      browserIdentity: base.browserIdentity,
    }).fingerprint;
    const context = validateTaskContext({
      ...base,
      capabilityFingerprint,
      initialLaunch: {
        operationId: "intent_18181818-1818-4818-a818-181818181818",
        inputDigest: "1".repeat(64),
        stage: "turn_dispatching",
        requestedAt: "2026-09-07T00:00:00.000Z",
        outcome: "Resume, prove empty, then dispatch once.",
      },
    });
    await repository.write(0, { contexts: { [context.roveTaskId]: context } });
    const truth = thread(context.codexThreadId, context.bootstrap.threadSource);
    truth.status = { type: "notLoaded" };
    const conversationStore = new PersistentConversationStore(
      new MemoryStateRepository(),
    );
    await conversationStore.bind(emptyAssociation(context));
    const requests: Array<{ method: string; params: unknown }> = [];
    let metadataFailures = 1;
    const runtime = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => [
        session(context.roveSessionId!, context.bootstrap.attemptId),
      ]),
      getSession: vi.fn(async () =>
        session(context.roveSessionId!, context.bootstrap.attemptId),
      ),
      endSession: vi.fn(async () => undefined),
    };
    const recovered = harness(
      repository,
      runtime,
      [truth],
      statusResult(),
      requests,
      conversationStore,
      undefined,
      undefined,
      undefined,
      undefined,
      "legacy",
      (current, includeTurns) => {
        if (!includeTurns && metadataFailures > 0) {
          metadataFailures -= 1;
          return threadNotLoadedError(current.id);
        }
        return includeTurns && current.turns.length === 0
          ? emptyLegacyReadError(current.id)
          : undefined;
      },
    );
    await recovered.restore();
    await expect(recovered.recoverFromTruth()).resolves.toEqual([]);
    const resumeIndex = requests.findIndex(
      (entry) => entry.method === "thread/resume",
    );
    const turnIndex = requests.findIndex(
      (entry) => entry.method === "turn/start",
    );
    expect(resumeIndex).toBeGreaterThan(-1);
    expect(resumeIndex).toBeLessThan(turnIndex);
    expect(
      requests.filter((entry) => entry.method === "turn/start"),
    ).toHaveLength(1);
  });

  it("blocks an absent not-loaded open thread when documented resume finds no rollout", async () => {
    const repository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const base = validContext();
    const capabilityFingerprint = new TaskCapabilityIssuer(
      Buffer.alloc(32, 8),
    ).issue({
      taskId: base.roveTaskId,
      sessionId: base.roveSessionId!,
      executionMode: base.executionMode,
      browserIdentity: base.browserIdentity,
    }).fingerprint;
    const context = validateTaskContext({
      ...base,
      capabilityFingerprint,
      initialLaunch: {
        operationId: "intent_21212121-2121-4121-a121-212121212121",
        inputDigest: "1".repeat(64),
        stage: "turn_dispatching",
        requestedAt: "2026-09-07T00:00:00.000Z",
        outcome: "Do not dispatch without recovered history.",
      },
    });
    await repository.write(0, { contexts: { [context.roveTaskId]: context } });
    const truth = thread(context.codexThreadId, context.bootstrap.threadSource);
    truth.status = { type: "notLoaded" };
    const conversationStore = new PersistentConversationStore(
      new MemoryStateRepository(),
    );
    await conversationStore.bind(emptyAssociation(context));
    const requests: Array<{ method: string; params: unknown }> = [];
    const runtime = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => [
        session(context.roveSessionId!, context.bootstrap.attemptId),
      ]),
      getSession: vi.fn(async () =>
        session(context.roveSessionId!, context.bootstrap.attemptId),
      ),
      endSession: vi.fn(async () => undefined),
    };
    const recovered = harness(
      repository,
      runtime,
      [truth],
      statusResult(),
      requests,
      conversationStore,
      undefined,
      undefined,
      undefined,
      undefined,
      "legacy",
      (current, includeTurns) =>
        includeTurns ? undefined : threadNotLoadedError(current.id),
      true,
      undefined,
      (current) => noRolloutError(current.id),
    );
    await recovered.restore();
    expect(await recovered.recoverFromTruth()).toHaveLength(1);
    expect(
      requests.filter((entry) => entry.method === "thread/resume"),
    ).toHaveLength(1);
    expect(requests.some((entry) => entry.method === "turn/start")).toBe(false);
  });

  it.each([
    "duplicate_list",
    "mismatched_list",
    "active_list",
    "unresolved_attention",
    "unresolved_continuation",
    "transport_failure",
  ] as const)(
    "blocks not-loaded close evidence for %s without sending a turn",
    async (variant) => {
      const repository = new MemoryStateRepository<{
        contexts: Record<string, ResolvedTaskContext>;
      }>();
      const context = validateTaskContext({
        ...validContext(),
        initialLaunch: {
          operationId: "intent_19191919-1919-4919-a919-191919191919",
          inputDigest: "1".repeat(64),
          stage: "reconciliation_required",
          requestedAt: "2026-09-07T00:00:00.000Z",
          outcome: "Never send ambiguous cleanup work.",
          boundedFailure:
            "Initial turn dispatch requires authoritative reconciliation.",
        },
      });
      await repository.write(0, {
        contexts: { [context.roveTaskId]: context },
      });
      const truth = thread(
        context.codexThreadId,
        context.bootstrap.threadSource,
      );
      truth.status = { type: "notLoaded" };
      const listed = [truth];
      if (variant === "duplicate_list")
        listed.push(thread("thread_duplicate", context.bootstrap.threadSource));
      if (variant === "mismatched_list") truth.threadSource = "rove:other";
      if (variant === "active_list")
        truth.status = { type: "active", activeFlags: [] };
      const conversationStore = new PersistentConversationStore(
        new MemoryStateRepository(),
      );
      await conversationStore.bind(emptyAssociation(context));
      const continuationStore = new DurableContinuationStore(
        new MemoryStateRepository<ContinuationState>(),
      );
      if (variant === "unresolved_continuation")
        await continuationStore.register({
          roveTaskId: context.roveTaskId,
          codexThreadId: context.codexThreadId!,
          originatingCodexTurnId: "turn_pending",
          roveSessionId: context.roveSessionId!,
          handoffId: "handoff_19191919191919191919191919191919",
          handoffGeneration: 1,
          requestedInstruction: "Pending continuation",
          continuationPolicy: "resume_after_control_return",
          status: "pending",
          freshInspectionRequired: true,
        });
      const requests: Array<{ method: string; params: unknown }> = [];
      const runtime = {
        startSession: vi.fn(),
        listSessions: vi.fn(async () => [
          session(context.roveSessionId!, context.bootstrap.attemptId),
        ]),
        endSession: vi.fn(async () => undefined),
      };
      const coordinator = harness(
        repository,
        runtime,
        listed,
        statusResult(),
        requests,
        conversationStore,
        undefined,
        undefined,
        undefined,
        undefined,
        "legacy",
        (current) =>
          variant === "transport_failure"
            ? new CodexTransportUncertainError("transport uncertain")
            : threadNotLoadedError(current.id),
        [
          "unresolved_attention",
          "unresolved_continuation",
          "transport_failure",
        ].includes(variant),
        continuationStore,
      );
      if (variant === "unresolved_attention") {
        const attention = new OrderedAttentionQueue();
        attention.enqueue({
          authority: "codex",
          kind: "command_approval",
          method: "item/commandExecution/requestApproval",
          requestId: "approval_not_loaded",
          taskId: context.roveTaskId,
          threadId: context.codexThreadId!,
          turnId: "turn_unknown",
          itemId: "item_unknown",
          generation: 1,
          payload: {},
        });
        coordinator.attachAttentionQueue(attention);
      }
      await coordinator.restore();
      await expect(
        coordinator.closeTask(
          context.roveTaskId,
          "intent_20202020-2020-4020-a020-202020202020",
        ),
      ).rejects.toThrow();
      expect(requests.some((entry) => entry.method === "turn/start")).toBe(
        false,
      );
      expect(runtime.endSession).not.toHaveBeenCalled();
    },
  );

  it("never replays an uncertain paginated initial launch and resumes with turns excluded", async () => {
    const repository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const operationId = "intent_44444444-4444-4444-a444-444444444444";
    const context = validateTaskContext({
      ...validContext(),
      initialLaunch: {
        operationId,
        inputDigest: "4".repeat(64),
        stage: "turn_dispatching",
        requestedAt: "2026-09-07T00:00:00.000Z",
        outcome: "Do not replay this uncertain launch.",
      },
    });
    await repository.write(0, { contexts: { [context.roveTaskId]: context } });
    const truth = thread(context.codexThreadId, context.bootstrap.threadSource);
    truth.historyMode = "paginated";
    const requests: Array<{ method: string; params: unknown }> = [];
    const runtime = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => [
        session(context.roveSessionId!, context.bootstrap.attemptId),
      ]),
      getSession: vi.fn(async () =>
        session(context.roveSessionId!, context.bootstrap.attemptId),
      ),
      endSession: vi.fn(async () => undefined),
    };
    const recovered = harness(
      repository,
      runtime,
      [truth],
      statusResult(),
      requests,
      new PersistentConversationStore(new MemoryStateRepository()),
    );
    await recovered.restore();
    await expect(recovered.recoverFromTruth()).resolves.toEqual([]);
    expect(requests.some((entry) => entry.method === "turn/start")).toBe(false);
    expect(
      requests
        .filter((entry) => entry.method === "thread/read")
        .every(
          (entry) =>
            (entry.params as { includeTurns?: boolean }).includeTurns === false,
        ),
    ).toBe(true);
    expect(
      requests.find((entry) => entry.method === "thread/resume")?.params,
    ).toMatchObject({ excludeTurns: true });
    expect(
      (await recovered.productTasks())[0]?.context.initialLaunch,
    ).toMatchObject({ operationId, stage: "reconciliation_required" });
  });

  it("closes and archives an idle paginated pre-journal orphan without loading turns", async () => {
    const repository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const context = validateTaskContext(validContext());
    await repository.write(0, { contexts: { [context.roveTaskId]: context } });
    const truth = thread(context.codexThreadId, context.bootstrap.threadSource);
    truth.historyMode = "paginated";
    const requests: Array<{ method: string; params: unknown }> = [];
    const runtime = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => [
        session(context.roveSessionId!, context.bootstrap.attemptId),
      ]),
      endSession: vi.fn(async () => undefined),
    };
    const recovered = harness(
      repository,
      runtime,
      [truth],
      statusResult(),
      requests,
    );
    await recovered.restore();
    await expect(recovered.recoverFromTruth()).resolves.toEqual([]);
    await recovered.archiveTaskThread(context.roveTaskId);
    expect(runtime.endSession).toHaveBeenCalledWith(context.roveSessionId);
    expect(requests.some((entry) => entry.method === "thread/archive")).toBe(
      true,
    );
    expect(
      requests
        .filter((entry) => entry.method === "thread/read")
        .every(
          (entry) =>
            (entry.params as { includeTurns?: boolean }).includeTurns === false,
        ),
    ).toBe(true);
  });

  it("keeps an active paginated thread without a durable turn identity unresolved", async () => {
    const repository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const context = validateTaskContext({
      ...validContext(),
      initialLaunch: {
        operationId: "intent_55555555-5555-4555-a555-555555555555",
        inputDigest: "5".repeat(64),
        stage: "turn_started",
        requestedAt: "2026-09-07T00:00:00.000Z",
        turnId: "turn_unknown",
      },
    });
    await repository.write(0, { contexts: { [context.roveTaskId]: context } });
    const truth = thread(context.codexThreadId, context.bootstrap.threadSource);
    truth.historyMode = "paginated";
    truth.status = { type: "active", activeFlags: [] };
    const requests: Array<{ method: string; params: unknown }> = [];
    const runtime = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => [
        session(context.roveSessionId!, context.bootstrap.attemptId),
      ]),
      endSession: vi.fn(async () => undefined),
    };
    const recovered = harness(
      repository,
      runtime,
      [truth],
      statusResult(),
      requests,
    );
    await recovered.restore();
    await expect(
      recovered.closeTask(
        context.roveTaskId,
        "intent_66666666-6666-4666-a666-666666666666",
      ),
    ).rejects.toThrow(/without an exact durable active-turn identity/);
    expect(requests.some((entry) => entry.method === "turn/interrupt")).toBe(
      false,
    );
    expect(
      (await recovered.productTasks())[0]?.context.lifecycle,
    ).toMatchObject({
      desiredState: "closed",
      lastConvergence: { phase: "cleanup_required" },
    });
    expect(
      requests
        .filter((entry) => entry.method === "thread/read")
        .every(
          (entry) =>
            (entry.params as { includeTurns?: boolean }).includeTurns === false,
        ),
    ).toBe(true);
  });

  it("freezes the reviewer across duplicate launch and rejects conflicting reuse", async () => {
    const sessions: Session[] = [];
    const runtime = {
      startSession: vi.fn(async (request: { bootstrapId: string }) => {
        const created = session("ses_reviewer", request.bootstrapId);
        sessions.push(created);
        return created;
      }),
      listSessions: vi.fn(async () => sessions),
      endSession: vi.fn(async () => undefined),
    };
    const coordinator = harness(new MemoryStateRepository(), runtime, []);
    await coordinator.start(startInput);
    await expect(coordinator.start(startInput)).resolves.toBeDefined();
    await expect(
      coordinator.start({ ...startInput, approvalsReviewer: "auto_review" }),
    ).rejects.toThrow(/immutable/);
  });

  it.each([null, "automatic", "user"])(
    "fails closed when thread/start retains %j instead of the frozen reviewer",
    async (retained) => {
      const runtime = {
        startSession: vi.fn(async (request: { bootstrapId: string }) =>
          session("ses_bad_reviewer", request.bootstrapId),
        ),
        listSessions: vi.fn(async () => []),
        endSession: vi.fn(async () => undefined),
      };
      const coordinator = harness(
        new MemoryStateRepository(),
        runtime,
        [],
        statusResult(),
        undefined,
        undefined,
        retained,
      );
      await expect(
        coordinator.start({
          ...startInput,
          approvalsReviewer: "auto_review",
        }),
      ).rejects.toThrow(/conflicting or unsupported approvals reviewer/);
    },
  );

  it("fails closed when thread/resume changes the frozen reviewer", async () => {
    const sessions: Session[] = [];
    const runtime = {
      startSession: vi.fn(async (request: { bootstrapId: string }) => {
        const created = session("ses_resume_reviewer", request.bootstrapId);
        sessions.push(created);
        return created;
      }),
      listSessions: vi.fn(async () => sessions),
      endSession: vi.fn(async () => undefined),
    };
    const coordinator = harness(
      new MemoryStateRepository(),
      runtime,
      [],
      statusResult(),
      undefined,
      undefined,
      (method: string) => (method === "thread/start" ? "auto_review" : null),
    );
    const started = await coordinator.start({
      ...startInput,
      approvalsReviewer: "auto_review",
    });
    await expect(
      coordinator.resume({ roveTaskId: started.context.roveTaskId }),
    ).rejects.toThrow(/conflicting or unsupported approvals reviewer/);
  });

  it.each([
    [
      "agent+workspace",
      "task_00000000-0000-4000-a000-000000000011",
      "agent" as const,
      {
        mode: "workspace" as const,
        workspaceId: "wrk_00000000-0000-4000-8000-000000000011",
      },
    ],
    [
      "companion+workspace",
      "task_00000000-0000-4000-a000-000000000012",
      "companion" as const,
      {
        mode: "workspace" as const,
        workspaceId: "wrk_00000000-0000-4000-8000-000000000012",
      },
    ],
    [
      "agent+temporary",
      "task_00000000-0000-4000-a000-000000000013",
      "agent" as const,
      { mode: "temporary" as const },
    ],
    [
      "companion+temporary",
      "task_00000000-0000-4000-a000-000000000014",
      "companion" as const,
      { mode: "temporary" as const },
    ],
  ])(
    "derives start and resume route policy from frozen %s selection without rewriting the user outcome",
    async (caseName, taskId, executionMode, browserIdentity) => {
      const requests: Array<{ method: string; params: unknown }> = [];
      const sessions: Session[] = [];
      const runtime = {
        startSession: vi.fn(
          async (request: { bootstrapId: string; mode: Session["mode"] }) => {
            const created = {
              ...session(taskId.replace(/^task_/, "ses_"), request.bootstrapId),
              mode: request.mode,
            };
            sessions.push(created);
            return created;
          },
        ),
        listSessions: vi.fn(async () => sessions),
        endSession: vi.fn(async () => undefined),
      };
      const coordinator = harness(
        new MemoryStateRepository(),
        runtime,
        [],
        statusResult(),
        requests,
      );
      const input = {
        ...startInput,
        roveTaskId: taskId,
        executionMode,
        browserIdentity,
      };
      const started = await coordinator.start(input);
      const outcome = `Create the requested repository for ${caseName}.`;
      await coordinator.startTurn({
        taskId: started.context.roveTaskId,
        text: outcome,
        clientIntentId: `intent_route_${caseName}`,
      });
      await coordinator.resume({ roveTaskId: started.context.roveTaskId });

      expect(ROVE_BROWSER_ROUTE_POLICY_V5).toContain("route policy v5");
      const expected = browserRouteDeveloperInstructions(started.context);
      expect(expected).toContain(
        "Diagnostic browser evidence alone is not a required-path failure.",
      );
      expect(expected).toContain(
        "When the main document succeeds and pageState is ready",
      );
      expect(expected).toContain(
        "unless evidence shows they prevented a required target or outcome",
      );
      expect(expected).toContain(
        "an uncertain consequential receipt is an immediate no-replay boundary",
      );
      expect(expected).toContain("small per-step recovery budget");
      expect(expected).toContain("When that budget is exhausted");
      expect(expected).toContain("mechanically corrected request");
      expect(expected).toContain("another freshly grounded safe Rove route");
      expect(expected).toContain(
        "A screenshot retry must bind to the newly returned observation.",
      );
      expect(expected).toContain(
        "does not globally prohibit a separately authorized integration",
      );
      expect(expected).toContain(
        "never infer non-dispatch when Rove does not prove it",
      );
      expect(expected).toContain("must not bypass a restriction");
      expect(expected).toContain(
        `exact execution mode ${JSON.stringify(executionMode)}`,
      );
      if (browserIdentity.mode === "workspace") {
        expect(expected).toContain("omit browser/workspace selection");
        expect(expected).not.toContain(browserIdentity.workspaceId);
        expect(expected).not.toContain('{"mode":"temporary"}');
      } else {
        expect(expected).toContain('send browser {"mode":"temporary"}');
      }
      expect(expected).not.toMatch(/wrk_|\/Users\/|\/work(?:\/|\b)/);

      for (const method of ["thread/start", "thread/resume"] as const) {
        const params = requests.find((entry) => entry.method === method)
          ?.params as { developerInstructions?: string } | undefined;
        expect(params?.developerInstructions).toBe(expected);
        expect(params?.developerInstructions).toContain(
          "unrelated non-main-frame or subresource failures",
        );
        expect(() =>
          validateCodexRequestParams(method, params as never),
        ).not.toThrow();
      }
      const turn = requests.find((entry) => entry.method === "turn/start")
        ?.params as { input?: unknown } | undefined;
      expect(turn?.input).toEqual([
        { type: "text", text: outcome, text_elements: [] },
      ]);
      expect(JSON.stringify(turn?.input)).not.toContain(expected);
    },
  );

  it("preserves current Codex thread and turn identities at the lifecycle boundary", async () => {
    const threadId = "01a0819a-dfa5-78e0-b725-371572a99787";
    const turnId = "01a0819a-eb7b-7fa2-9d33-29f824eb3d18";
    const context = validContext({ codexThreadId: threadId });
    const contextRepository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    await contextRepository.write(0, {
      contexts: { [context.roveTaskId]: context },
    });
    const conversationStore = new PersistentConversationStore(
      new MemoryStateRepository<ConversationReducerState>(),
    );
    await conversationStore.bind({
      roveTaskId: context.roveTaskId,
      codexThreadId: threadId,
      codexSessionId: context.codexSessionId!,
      roveSessionId: context.roveSessionId!,
      activeTurnId: turnId,
      turnStatus: "in_progress",
      archived: false,
      lastEventSequence: 0,
      items: {},
      turnOrder: [turnId],
    });
    const runtime = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => []),
      endSession: vi.fn(async () => undefined),
    };
    const coordinator = harness(
      contextRepository,
      runtime,
      [],
      statusResult(),
      undefined,
      conversationStore,
    );
    await coordinator.restore();

    const [projected] = await coordinator.productTasks();
    expect(projected?.context.codexThreadId).toBe(threadId);
    expect(projected?.conversation?.activeTurnId).toBe(turnId);
    expect(projected?.lifecycle.reason).not.toMatch(
      /Lifecycle truth was rejected/,
    );
  });

  it("projects an exact requested handoff after human takeover without conflating ownership generations", async () => {
    const context = validContext();
    const authority = new ContextAuthority();
    authority.restore({ [context.roveTaskId]: context });
    const continuations = new DurableContinuationStore(
      new MemoryStateRepository<ContinuationState>(),
    );
    const handoffId = "handoff_11111111111111111111111111111111";
    await continuations.register({
      roveTaskId: context.roveTaskId,
      codexThreadId: context.codexThreadId!,
      originatingCodexTurnId: "turn_1",
      roveSessionId: context.roveSessionId!,
      handoffId,
      handoffGeneration: 2,
      requestedInstruction: "Quick handover visibility test",
      continuationPolicy: "resume_after_control_return",
      status: "pending",
      freshInspectionRequired: true,
      preHandoffObservationSeq: 4,
    });
    const attention = new OrderedAttentionQueue();
    attention.enqueue({
      authority: "rove_control",
      kind: "control_handoff",
      requestId: `control:${context.roveSessionId}:${handoffId}`,
      taskId: context.roveTaskId,
      threadId: context.codexThreadId!,
      turnId: "turn_1",
      generation: 2,
      payload: { handoffId },
    });
    const conversationStore = new PersistentConversationStore(
      new MemoryStateRepository<ConversationReducerState>(),
    );
    await conversationStore.bind({
      roveTaskId: context.roveTaskId,
      codexThreadId: context.codexThreadId!,
      codexSessionId: context.codexSessionId!,
      roveSessionId: context.roveSessionId!,
      activeTurnId: "turn_1",
      turnStatus: "in_progress",
      archived: false,
      lastEventSequence: 0,
      items: {},
      turnOrder: ["turn_1"],
    });
    const runtimeSession: Session = {
      ...session(context.roveSessionId!, context.bootstrap.attemptId),
      status: "active",
      controller: "human",
      ownershipGeneration: 3,
      activeHandoffId: handoffId,
      activeHandoffGeneration: 2,
      handoff: {
        reason: "Quick handover visibility test",
        requestedAt: "2026-09-07T00:01:00.000Z",
      },
    };
    const runtime = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => [runtimeSession]),
      listSessionInventory: vi.fn(async () => [
        {
          schemaVersion: 1 as const,
          session: runtimeSession,
          browserIdentity: { mode: "temporary" as const },
          attachment: "attached" as const,
          recovery: "not_needed" as const,
          profileOwnership: "released" as const,
        },
      ]),
      getControlStatus: vi.fn(async () => ({
        sessionId: runtimeSession.id,
        generation: 3,
        status: "active" as const,
        controller: "human" as const,
        activeHandoffId: handoffId,
        activeHandoffGeneration: 2,
        observationSeq: 4,
        updatedAt: runtimeSession.updatedAt,
      })),
      endSession: vi.fn(async () => undefined),
    };
    const coordinator = new RoveTaskCoordinator(
      fakeRpc(() => ({})),
      runtime as never,
      { inspect: async ({ sessionId }) => inspection(sessionId) },
      authority,
      new TaskCapabilityIssuer(Buffer.alloc(32, 8)),
      () => ({ status: "logged_in" }),
      { command: "node", args: [], environment: {} },
      () => "2026-09-07T00:00:00.000Z",
      conversationStore,
      () => [],
      continuations,
    );
    coordinator.attachAttentionQueue(attention);

    await expect(coordinator.productTasks()).resolves.toMatchObject([
      {
        lifecycle: {
          phase: "waiting_for_human",
          reason: "Quick handover visibility test",
        },
        availableActions: expect.arrayContaining(["return_control"]),
        runtime: { status: "active", controller: "human" },
      },
    ]);
    const [projected] = await coordinator.productTasks();
    expect(projected?.availableActions).not.toContain("retry_cleanup");

    runtimeSession.ownershipGeneration = 8;
    await expect(coordinator.productTasks()).resolves.toMatchObject([
      {
        lifecycle: {
          phase: "cleanup_required",
          reason: expect.stringMatching(/ownership-generation transition/),
        },
        availableActions: ["retry_cleanup"],
      },
    ]);
  });

  it("reconciles the Runtime dispatch crash cut without a duplicate session", async () => {
    const repository = new FailOnceRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>(3);
    const sessions: Session[] = [];
    const runtime = {
      startSession: vi.fn(async (request: { bootstrapId: string }) => {
        const created = session("ses_once", request.bootstrapId);
        sessions.push(created);
        return created;
      }),
      listSessions: vi.fn(async () => sessions),
      endSession: vi.fn(async () => undefined),
    };
    await expect(
      harness(repository, runtime, []).start(startInput),
    ).rejects.toThrow("crash cut");
    const recovered = harness(repository, runtime, []);
    await recovered.restore();
    await expect(recovered.start(startInput)).resolves.toMatchObject({
      context: { roveSessionId: "ses_once" },
    });
    expect(runtime.startSession).toHaveBeenCalledTimes(1);
  });
  it("reconciles the thread/start persistence crash cut without a duplicate thread", async () => {
    const repository = new FailOnceRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>(6);
    const sessions: Session[] = [];
    const runtime = {
      startSession: vi.fn(async (request: { bootstrapId: string }) => {
        const created = session("ses_once", request.bootstrapId);
        sessions.push(created);
        return created;
      }),
      listSessions: vi.fn(async () => sessions),
      endSession: vi.fn(async () => undefined),
    };
    const threads: CodexThread[] = [];
    await expect(
      harness(repository, runtime, threads).start(startInput),
    ).rejects.toThrow("crash cut");
    expect(threads).toHaveLength(1);
    const requests: Array<{ method: string; params: unknown }> = [];
    const recovered = harness(
      repository,
      runtime,
      threads,
      statusResult(),
      requests,
    );
    await recovered.restore();
    await recovered.start(startInput);
    expect(threads).toHaveLength(1);
    expect(
      requests.find((entry) => entry.method === "thread/resume")?.params,
    ).toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
    });
  });

  it.each([
    "requested",
    "infrastructure_ready",
    "turn_dispatching",
    "turn_accepted",
    "turn_started",
  ] as const)(
    "recovers the initial launch cut at %s with one session, thread, and user turn",
    async (cut) => {
      const contextRepository = new MemoryStateRepository<{
        contexts: Record<string, ResolvedTaskContext>;
      }>();
      const conversationRepository =
        new MemoryStateRepository<ConversationReducerState>();
      const sessions: Session[] = [];
      const threads: CodexThread[] = [];
      const requests: Array<{ method: string; params: unknown }> = [];
      const runtime = {
        startSession: vi.fn(async (request: { bootstrapId: string }) => {
          const created = session("ses_initial_launch", request.bootstrapId);
          sessions.push(created);
          return created;
        }),
        listSessions: vi.fn(async () => sessions),
        endSession: vi.fn(async () => undefined),
      };
      let armed = true;
      const first = harness(
        contextRepository,
        runtime,
        threads,
        statusResult(),
        requests,
        new PersistentConversationStore(conversationRepository),
        undefined,
        undefined,
        undefined,
        (_taskId, point) => {
          if (armed && point === cut) {
            armed = false;
            throw new Error(`crash at ${cut}`);
          }
        },
      );
      const operationId = "intent_88888888-8888-4888-a888-888888888888";
      await expect(
        first.launch({
          operationId,
          outcome: "Perform the exact initial task once.",
          executionMode: "agent",
          browserIdentity: { mode: "temporary" },
          selectionSource: "user_selected",
          cwd: "/work",
          approvalsReviewer: "auto_review",
        }),
      ).rejects.toThrow(`crash at ${cut}`);

      const recovered = harness(
        contextRepository,
        runtime,
        threads,
        statusResult(),
        requests,
        new PersistentConversationStore(conversationRepository),
      );
      await recovered.restore();
      await recovered.recoverFromTruth();
      const [task] = await recovered.productTasks();
      expect(sessions).toHaveLength(1);
      expect(threads).toHaveLength(1);
      expect(threads[0]!.turns).toHaveLength(1);
      expect(
        threads[0]!.turns[0]!.items.filter(
          (item) =>
            item.type === "userMessage" && item.clientId === operationId,
        ),
      ).toHaveLength(1);
      expect(
        requests.filter((entry) => entry.method === "turn/start"),
      ).toHaveLength(1);
      expect(task?.context.initialLaunch).toMatchObject({
        operationId,
        stage: "turn_started",
        turnId: "turn_1",
      });
      expect(task?.context.initialLaunch).not.toHaveProperty("outcome");
    },
  );

  it("migrates a pre-journal partial launch to cleanup without replaying an unknown outcome", async () => {
    const repository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const partial = validateTaskContext({
      ...validContext({ roveTaskId: "task_pre_journal" }),
      bootstrap: {
        attemptId: `boot_${"9".repeat(32)}`,
        threadSource: `rove:task_pre_journal:boot_${"9".repeat(32)}`,
        stage: "attachments_bound",
      },
      codexThreadId: undefined,
      codexSessionId: undefined,
    });
    await repository.write(0, { contexts: { [partial.roveTaskId]: partial } });
    const requests: Array<{ method: string; params: unknown }> = [];
    const runtime = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => []),
      endSession: vi.fn(async () => undefined),
    };
    const recovered = harness(
      repository,
      runtime,
      [],
      statusResult(),
      requests,
    );
    await recovered.restore();
    const [migrated] = await recovered.productTasks();
    expect(migrated?.context.lifecycle).toMatchObject({
      desiredState: "closed",
      closeOperation: {
        stage: "requested",
        boundedFailure:
          "Pre-journal launch outcome is unavailable; cleanup is required.",
      },
    });
    await expect(recovered.recoverFromTruth()).resolves.toEqual([]);
    const [task] = await recovered.productTasks();
    expect(task?.context.lifecycle).toMatchObject({
      desiredState: "closed",
      closeOperation: { stage: "complete" },
    });
    expect(runtime.endSession).toHaveBeenCalledWith("ses_1");
    expect(requests.some((entry) => entry.method === "turn/start")).toBe(false);
    expect(task?.lifecycle.phase).toBe("ready");
    expect(task?.availableActions).toContain("message");
    expect(task?.availableActions).not.toContain("retry_cleanup");

    const restarted = harness(
      repository,
      runtime,
      [],
      statusResult(),
      requests,
    );
    await restarted.restore();
    const [afterRestart] = await restarted.productTasks();
    expect(afterRestart?.lifecycle.phase).toBe("ready");
    expect(afterRestart?.availableActions).toContain("message");
    expect(afterRestart?.availableActions).not.toContain("retry_cleanup");
  });

  it("cleans a complete pre-journal launch with no user turn exactly once", async () => {
    const repository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const context = validateTaskContext(validContext());
    await repository.write(0, { contexts: { [context.roveTaskId]: context } });
    const truth = thread(context.codexThreadId, context.bootstrap.threadSource);
    const requests: Array<{ method: string; params: unknown }> = [];
    const runtime = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => [
        session(context.roveSessionId!, context.bootstrap.attemptId),
      ]),
      getSession: vi.fn(async () =>
        session(context.roveSessionId!, context.bootstrap.attemptId),
      ),
      endSession: vi.fn(async () => undefined),
    };
    const first = harness(
      repository,
      runtime,
      [truth],
      statusResult(),
      requests,
    );
    await first.restore();
    await expect(first.recoverFromTruth()).resolves.toEqual([]);
    const [closed] = await first.productTasks();
    expect(closed?.context.lifecycle).toMatchObject({
      desiredState: "closed",
      closeOperation: {
        stage: "complete",
      },
    });
    const operationId = closed?.context.lifecycle?.closeOperation?.operationId;
    expect(operationId).toMatch(/^intent_[a-f0-9-]{36}$/);
    expect(runtime.endSession).toHaveBeenCalledTimes(1);
    expect(runtime.endSession).toHaveBeenCalledWith(context.roveSessionId);

    const restarted = harness(
      repository,
      runtime,
      [truth],
      statusResult(),
      requests,
    );
    await restarted.restore();
    await expect(restarted.recoverFromTruth()).resolves.toEqual([]);
    expect(
      (await restarted.productTasks())[0]?.context.lifecycle?.closeOperation
        ?.operationId,
    ).toBe(operationId);
    expect(runtime.endSession).toHaveBeenCalledTimes(1);
    expect(requests.filter((entry) => entry.method === "turn/start")).toEqual(
      [],
    );
  });

  it("preserves a complete pre-journal launch that already has a legitimate user turn", async () => {
    const repository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const context = validateTaskContext(validContext());
    await repository.write(0, { contexts: { [context.roveTaskId]: context } });
    const truth = thread(context.codexThreadId, context.bootstrap.threadSource);
    truth.turns.push({
      id: "turn_legacy",
      items: [
        {
          type: "userMessage",
          id: "item_legacy",
          clientId: null,
          content: [
            {
              type: "text",
              text: "A legitimate legacy task",
              text_elements: [],
            },
          ],
        },
      ],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: 1,
      completedAt: 2,
      durationMs: 1,
    });
    const requests: Array<{ method: string; params: unknown }> = [];
    const runtime = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => [
        session(context.roveSessionId!, context.bootstrap.attemptId),
      ]),
      getSession: vi.fn(async () =>
        session(context.roveSessionId!, context.bootstrap.attemptId),
      ),
      endSession: vi.fn(async () => undefined),
    };
    const recovered = harness(
      repository,
      runtime,
      [truth],
      statusResult(),
      requests,
    );
    await recovered.restore();
    await expect(recovered.recoverFromTruth()).resolves.toEqual([]);
    const [preserved] = await recovered.productTasks();
    expect(preserved?.context.lifecycle?.desiredState).toBe("open");
    expect(runtime.endSession).not.toHaveBeenCalled();
    expect(requests.filter((entry) => entry.method === "turn/start")).toEqual(
      [],
    );
  });

  it.each([
    ["unavailable", [] as CodexThread[]],
    [
      "ambiguous",
      [
        {
          ...thread("thread_1", validContext().bootstrap.threadSource),
          status: { type: "active", activeFlags: [] },
        } as CodexThread,
      ],
    ],
  ])(
    "keeps a complete pre-journal launch cleanup-required when truth is %s",
    async (_case, threads) => {
      const repository = new MemoryStateRepository<{
        contexts: Record<string, ResolvedTaskContext>;
      }>();
      const context = validateTaskContext(validContext());
      await repository.write(0, {
        contexts: { [context.roveTaskId]: context },
      });
      const requests: Array<{ method: string; params: unknown }> = [];
      const runtime = {
        startSession: vi.fn(),
        listSessions: vi.fn(async () => [
          session(context.roveSessionId!, context.bootstrap.attemptId),
        ]),
        endSession: vi.fn(async () => undefined),
      };
      const recovered = harness(
        repository,
        runtime,
        threads,
        statusResult(),
        requests,
      );
      await recovered.restore();
      const failures = await recovered.recoverFromTruth();
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatch(
        /Pre-journal launch truth is (unavailable|ambiguous)/,
      );
      const [blocked] = await recovered.productTasks();
      expect(blocked?.context.lifecycle).toMatchObject({
        desiredState: "open",
        lastConvergence: { phase: "cleanup_required" },
      });
      expect(runtime.endSession).not.toHaveBeenCalled();
      expect(requests.filter((entry) => entry.method === "turn/start")).toEqual(
        [],
      );
    },
  );

  it("restores visible Retry cleanup for a pre-thread thread_dispatching cut", async () => {
    const repository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const closeOperationId = "intent_99999999-9999-4999-a999-999999999999";
    const context = validateTaskContext({
      ...validContext(),
      bootstrap: {
        ...validContext().bootstrap,
        stage: "thread_dispatching",
      },
      codexThreadId: undefined,
      codexSessionId: undefined,
      initialLaunch: {
        operationId: "intent_aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        inputDigest: "a".repeat(64),
        stage: "requested",
        requestedAt: "2026-09-07T00:00:00.000Z",
        outcome: "A launch whose thread start outcome was never accepted.",
      },
      lifecycle: {
        schemaVersion: 1,
        desiredState: "closed",
        closeOperation: {
          operationId: closeOperationId,
          requestedAt: "2026-09-07T00:00:00.000Z",
          stage: "requested",
          boundedFailure: "App Server thread start outcome is unavailable.",
        },
        lastConvergence: {
          at: "2026-09-07T00:00:00.000Z",
          phase: "cleanup_required",
          reason: "App Server thread start outcome is unavailable.",
        },
      },
    });
    await repository.write(0, { contexts: { [context.roveTaskId]: context } });
    const requests: Array<{ method: string; params: unknown }> = [];
    const runtimeSession = session(
      context.roveSessionId!,
      context.bootstrap.attemptId,
    );
    const runtime = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => [runtimeSession]),
      getSession: vi.fn(async () => runtimeSession),
      endSession: vi.fn(async () => undefined),
    };
    const restarted = harness(
      repository,
      runtime,
      [],
      statusResult(),
      requests,
    );
    await restarted.restore();
    await expect(restarted.productTasks()).resolves.toMatchObject([
      {
        lifecycle: { phase: "recovering" },
        availableActions: ["retry_cleanup"],
      },
    ]);
    await expect(restarted.recoverFromTruth()).resolves.toEqual([]);
    expect(runtime.endSession).toHaveBeenCalledWith(context.roveSessionId);
    expect(requests.some((entry) => entry.method === "thread/start")).toBe(
      false,
    );
    expect(requests.some((entry) => entry.method === "turn/start")).toBe(false);
    expect((await restarted.productTasks())[0]?.lifecycle.phase).toBe("ready");
    expect((await restarted.productTasks())[0]?.availableActions).toContain(
      "message",
    );
  });

  it("durably resumes known-safe attachment rollback after a process cut", async () => {
    const repository = new FailOnceRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>(6);
    const sessions: Session[] = [];
    const runtime = {
      startSession: vi.fn(async (request: { bootstrapId: string }) => {
        const created = session("ses_rollback", request.bootstrapId);
        sessions.push(created);
        return created;
      }),
      listSessions: vi.fn(async () => sessions),
      endSession: vi.fn(async () => undefined),
    };
    const cleanupRuntimeGrants = vi.fn(async () => undefined);
    const cleanupTask = vi.fn(async () => undefined);
    const attachments = {
      authority: {
        listForTask: vi.fn(() => []),
        instructions: vi.fn(() => ""),
        cleanupRuntimeGrants,
        cleanupTask,
      },
      runtime: {},
    };
    const unavailableMcp = { ...inspection("ses_rollback"), ready: false };
    await expect(
      harness(
        repository,
        runtime,
        [],
        statusResult(),
        undefined,
        undefined,
        undefined,
        attachments as never,
        unavailableMcp,
      ).start(startInput),
    ).rejects.toThrow("crash cut");
    expect(cleanupRuntimeGrants).toHaveBeenCalledTimes(1);
    expect(runtime.endSession).toHaveBeenCalledTimes(1);
    expect(cleanupTask).not.toHaveBeenCalled();

    const recovered = harness(
      repository,
      runtime,
      [],
      statusResult(),
      undefined,
      undefined,
      undefined,
      attachments as never,
      unavailableMcp,
    );
    await recovered.restore();
    await expect(recovered.recoverFromTruth()).resolves.toEqual([]);
    expect(runtime.endSession).toHaveBeenCalledTimes(2);
    expect(cleanupTask).toHaveBeenCalledTimes(1);
    await expect(recovered.productTasks()).resolves.toEqual([]);
  });
  it("serializes simultaneous same-task starts", async () => {
    const repository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const sessions: Session[] = [];
    const threads: CodexThread[] = [];
    const runtime = {
      startSession: vi.fn(async (request: { bootstrapId: string }) => {
        await Promise.resolve();
        const created = session("ses_once", request.bootstrapId);
        sessions.push(created);
        return created;
      }),
      listSessions: vi.fn(async () => sessions),
      endSession: vi.fn(async () => undefined),
    };
    const coordinator = harness(repository, runtime, threads);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => coordinator.start(startInput)),
    );
    expect(
      new Set(results.map((entry) => entry.context.codexThreadId)).size,
    ).toBe(1);
    expect(runtime.startSession).toHaveBeenCalledTimes(1);
    expect(threads).toHaveLength(1);
  });
  it("rejects one-definition MCP drift against the independent production digest", async () => {
    expect(ROVE_TOOL_DEFINITIONS_SHA256).toMatch(/^[a-f0-9]{64}$/);
    const drifted = statusResult();
    drifted.data[0]!.tools[toolDefinitions[0]!.name] = {
      ...toolDefinitions[0]!,
      description: "drift",
    };
    const runtime = {
      startSession: vi.fn(async (request: { bootstrapId: string }) =>
        session("ses_once", request.bootstrapId),
      ),
      listSessions: vi.fn(async () => []),
      endSession: vi.fn(async () => undefined),
    };
    await expect(
      harness(new MemoryStateRepository(), runtime, [], drifted).start(
        startInput,
      ),
    ).rejects.toThrow(/catalog|provenance/);
  });
});

describe("trusted attention and continuation", () => {
  it("restores Rove attention as actionable and Codex attention as non-actionable stale until server truth resolves it", async () => {
    const repository = new MemoryStateRepository<AttentionState>();
    const first = new OrderedAttentionQueue(100, repository);
    first.enqueue({
      authority: "rove_control",
      kind: "control_handoff",
      requestId: "control:ses_1:2",
      taskId: "task_a",
      threadId: "thread_1",
      turnId: "turn_1",
      generation: 2,
      payload: {},
    });
    first.enqueue({
      authority: "codex",
      kind: "file_approval",
      requestId: "c1:server:7",
      taskId: "task_a",
      threadId: "thread_1",
      turnId: "turn_1",
      itemId: "item_1",
      generation: 1,
      payload: {},
      method: "item/fileChange/requestApproval",
    });
    await first.flush();
    const restored = new OrderedAttentionQueue(100, repository);
    await restored.restore();
    expect(restored.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authority: "rove_control",
          status: "pending",
        }),
        expect.objectContaining({ authority: "codex", status: "stale" }),
      ]),
    );
    expect(() =>
      restored.beginResponse({
        authority: "codex",
        requestId: "c1:server:7",
        taskId: "task_a",
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "item_1",
        generation: 1,
      }),
    ).toThrow(/stale/);
    const rpc = fakeRpc(() => ({}));
    new CodexAttentionBroker(rpc, restored).attach(() => ({
      taskId: "task_a",
      threadId: "thread_1",
      generation: 2,
    }));
    rpc.emit({
      method: "serverRequest/resolved",
      params: { threadId: "thread_1", requestId: 7 },
    });
    expect(
      restored.list().find((entry) => entry.authority === "codex")?.status,
    ).toBe("resolved");
  });
  it("keeps an accepted approval awaiting authoritative server resolution", async () => {
    const rpc = fakeRpc(() => ({}));
    const queue = new OrderedAttentionQueue();
    const observed = vi.fn();
    const broker = new CodexAttentionBroker(rpc, queue, observed);
    broker.attach(() => ({
      taskId: "task_a",
      threadId: "thread_1",
      turnId: "turn_1",
      generation: 1,
    }));
    rpc.emit({
      method: "item/commandExecution/requestApproval",
      requestId: "c1:server:8",
      params: {
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "item_2",
        command: "pnpm test",
        cwd: "/work",
        availableDecisions: ["accept", "decline"],
      },
    });
    await broker.respond(
      {
        requestId: "c1:server:8",
        taskId: "task_a",
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "item_2",
        generation: 1,
      },
      { decision: "accept" },
    );
    expect(queue.list()[0]?.status).toBe("awaiting_confirmation");
    rpc.emit({
      method: "serverRequest/resolved",
      params: { threadId: "thread_1", requestId: 8 },
    });
    expect(queue.list()[0]?.status).toBe("resolved");
    expect(observed).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: "c1:server:8", status: "resolved" }),
    );
    rpc.emit({
      method: "item/fileChange/requestApproval",
      requestId: "c1:server:9",
      params: {
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "item_3",
        startedAtMs: 2,
      },
    });
    rpc.emit({
      method: "turn/completed",
      params: { threadId: "thread_1", turnId: "turn_1" },
    });
    expect(
      queue.list().find((entry) => entry.requestId === "c1:server:9")?.status,
    ).toBe("stale");
    expect(observed).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: "c1:server:9", status: "stale" }),
    );
  });
  it("keeps approval unknown after a wire failure and confirms only serverRequest/resolved", async () => {
    const rpc = fakeRpc(() => ({}));
    rpc.respond = vi.fn(async () => {
      throw new Error("wire failed");
    });
    const queue = new OrderedAttentionQueue();
    const broker = new CodexAttentionBroker(rpc, queue);
    broker.attach(() => ({
      taskId: "task_a",
      threadId: "thread_1",
      turnId: "turn_1",
      generation: 1,
    }));
    rpc.emit({
      method: "item/fileChange/requestApproval",
      requestId: "c1:server:7",
      params: {
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "item_1",
        startedAtMs: 1,
      },
    });
    await expect(
      broker.respond(
        {
          requestId: "c1:server:7",
          taskId: "task_a",
          threadId: "thread_1",
          turnId: "turn_1",
          itemId: "item_1",
          generation: 1,
        },
        { decision: "accept" },
      ),
    ).rejects.toThrow("wire failed");
    expect(queue.list()[0]?.status).toBe("resolution_unknown");
    rpc.emit({
      method: "serverRequest/resolved",
      params: { threadId: "thread_1", requestId: 7 },
    });
    expect(queue.list()[0]?.status).toBe("resolved");
  });
  it("rejects caller-authored continuation truth at the product seam", async () => {
    const api = new LocalProductApi(
      () => ({
        state: "ready",
        ready: true,
        restartAttempt: 0,
        stderrTail: [],
      }),
      {} as never,
      {} as never,
      {} as never,
      new OrderedAttentionQueue(),
    );
    await expect(
      api.execute({
        type: "continuation.return",
        taskId: "task_a",
        truth: { activeTurnId: undefined },
      } as never),
    ).rejects.toThrow(/Unsupported local product command/);
  });
  it("requires fresh inspection before continuation wire dispatch and globally rejects return collisions", async () => {
    const repository = new MemoryStateRepository<ContinuationState>();
    const store = new DurableContinuationStore(repository);
    const pending: PendingContinuation = {
      roveTaskId: "task_a",
      codexThreadId: "thread_1",
      originatingCodexTurnId: "turn_1",
      roveSessionId: "ses_1",
      handoffGeneration: 2,
      requestedInstruction: "Continue",
      continuationPolicy: "resume_after_control_return",
      status: "pending",
      freshInspectionRequired: true,
      preHandoffObservationSeq: 5,
    };
    await store.register(pending);
    const rpc = fakeRpc(() => ({ turn: { id: "turn_2" } }));
    const current = thread();
    await expect(
      store.dispatchReturn(
        { ...pending, eventId: "return_1", observationSeq: 6 },
        current,
        false,
        rpc,
      ),
    ).rejects.toThrow(/Fresh/);
    expect(rpc.request).not.toHaveBeenCalled();
    await expect(
      store.dispatchReturn(
        { ...pending, eventId: "return_1", observationSeq: 6 },
        current,
        true,
        rpc,
      ),
    ).resolves.toBe("dispatched");
    await expect(
      store.dispatchReturn(
        { ...pending, eventId: "return_1", observationSeq: 7 },
        current,
        true,
        rpc,
      ),
    ).rejects.toThrow(/collision/);
  });
  it("rejects invalid restored continuation state", async () => {
    const repository = new MemoryStateRepository<ContinuationState>();
    await repository.write(0, {
      records: {
        bad: {
          roveTaskId: "",
          codexThreadId: "",
          originatingCodexTurnId: "",
          roveSessionId: "",
          handoffGeneration: 0,
          requestedInstruction: "",
          continuationPolicy: "resume_after_control_return",
          status: "consumed",
          freshInspectionRequired: false,
        },
      },
      returnEventFingerprints: {},
    } as never);
    await expect(
      new DurableContinuationStore(repository).validate(),
    ).rejects.toThrow(/generation|continuation/);
  });
});
