import { authoritativePreHandoffObservationSeq } from "./handoff-observation.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  TaskEngine,
  type NativeRuntimeTruth,
  type TaskConversationItem,
  type TaskEvent,
} from "@rove/protocol";
import {
  CodexAccountCatalogService,
  type CodexAccountCatalogPort,
  type CodexCatalogSnapshot,
} from "./account-catalog.js";
import { CodexAppServerHost, readCodexVersion } from "./app-server-host.js";
import { CodexRuntimeTaskAdapter } from "./codex-runtime-task-adapter.js";
import { CodexThreadSessionSupervisor } from "./codex-thread-session-supervisor.js";
import { CodexExecutableResolver } from "./compatibility.js";
import { projectUserInputAttachments } from "./conversations.js";
import { LedgerAttentionView } from "./ledger-attention-view.js";
import { LocalProductApi } from "./local-product-api.js";
import { OrderedTaskIngress } from "./ordered-task-ingress.js";
import { MemoryStateRepository } from "./persistence.js";
import { LedgerProductTaskPort } from "./product-task-port.js";
import type { CodexServerEvent } from "./protocol.js";
import { SqliteTaskEngineStore } from "./sqlite-task-engine-store.js";
import { TaskEngineWorker } from "./task-engine-worker.js";
import { PersistedTaskCapabilityIssuer } from "./task-launch-boundary.js";
import type {
  AttachmentRuntimeMaterializer,
  TaskAttachmentAuthority,
} from "./task-attachments.js";
import type { LocalFileGrantSelection } from "../host/hub-command-executor.js";
import type { RoveMcpLaunch, TaskRuntimePort } from "./task-coordinator.js";
import { resolveTaskRuntimeControlAuthority } from "./task-runtime-control-authority.js";

export const PRODUCTION_LIFECYCLE_AUTHORITY = Object.freeze({
  task: "sqlite",
  binding: "sqlite+live-observation",
  continuation: "sqlite+runtime-observation",
  attention: "sqlite+live-observation",
  projection: "sqlite",
  command: "sqlite",
} as const);

export function requiresRuntimeGenerationReconciliation(input: {
  sessionId?: string;
  status: NativeRuntimeTruth["status"];
  attachment: NativeRuntimeTruth["attachment"];
  recovery: NativeRuntimeTruth["recovery"];
}): boolean {
  if (!input.sessionId) return false;
  return !(
    ["completed", "failed"].includes(input.status) &&
    input.attachment === "missing" &&
    input.recovery === "not_needed"
  );
}

/** Legacy test fixture only; production composition never calls this helper. */
export function createProductionLifecycleRepositories() {
  return {
    conversation: new MemoryStateRepository<unknown>(),
    continuation: new MemoryStateRepository<unknown>(),
    context: new MemoryStateRepository<unknown>(),
    attention: new MemoryStateRepository<unknown>(),
  };
}

export interface CodexExecutionCoreOptions {
  isPackaged: boolean;
  developmentExecutablePath?: string;
  developmentCodeModeHostPath?: string;
  packagedExecutablePath?: string;
  clientVersion: string;
  stateDirectory: string;
  runtime: TaskRuntimePort;
  mcpLaunch: RoveMcpLaunch;
  taskWorkingDirectory?: string;
  taskWorkspaceRoot?: string;
  onProductStateChanged?: () => Promise<void> | void;
  attachmentAuthority?: TaskAttachmentAuthority;
  attachmentRuntime?: AttachmentRuntimeMaterializer;
  onFileAttention?: () => Promise<void> | void;
  appServerHost?: CodexAppServerHost;
  onCloseStagePersisted?: (
    taskId: string,
    stage:
      | "requested"
      | "codex_settled"
      | "continuation_settled"
      | "runtime_settled"
      | "attachments_settled"
      | "complete",
  ) => Promise<void> | void;
  onTaskProcessRecoveryPoint?: (
    point: "contexts_restored" | "outbox_recovery_started",
  ) => Promise<void> | void;
  onTaskEngineCut?: (
    point:
      | "before_event_commit"
      | "after_commit_before_claim"
      | "after_claim_before_dispatch"
      | "after_external_acceptance_before_outcome"
      | "after_terminal_change_before_observation"
      | "after_outcome_commit_before_notification",
    detail: { taskId?: string; commandType?: string },
  ) => Promise<void> | void;
}

export function runtimeInventoryEventId(
  taskId: string,
  generation: number,
  position: number,
  fingerprint: string,
): string {
  return `runtime:${taskId}:${generation}:${position}:${fingerprint}`;
}

/** Sole production composition root for the event-sourced task engine. */
export class CodexExecutionCore {
  readonly host: CodexAppServerHost;
  private apiValue: LocalProductApi | undefined;
  private account: CodexAccountCatalogService | undefined;
  private store: SqliteTaskEngineStore | undefined;
  private taskPort: LedgerProductTaskPort | undefined;
  private ingress: OrderedTaskIngress | undefined;
  private detachEvents: (() => void) | undefined;
  private detachHealth: (() => void) | undefined;
  private recoveryWarnings: string[] = [];
  private connectionGeneration = 0;
  private connectionId: string | undefined;
  private codexPosition = 0;
  private runtimePoll: NodeJS.Timeout | undefined;
  private runtimePollActive = false;
  private runtimeGeneration = 1;
  private readonly hostInstanceId = randomUUID();

  constructor(private readonly options: CodexExecutionCoreOptions) {
    this.host =
      options.appServerHost ??
      new CodexAppServerHost({
        resolver: new CodexExecutableResolver({
          isPackaged: options.isPackaged,
          ...(options.developmentExecutablePath
            ? { developmentExecutablePath: options.developmentExecutablePath }
            : {}),
          ...(options.developmentCodeModeHostPath
            ? {
                developmentCodeModeHostPath:
                  options.developmentCodeModeHostPath,
              }
            : {}),
          ...(options.packagedExecutablePath
            ? { packagedExecutablePath: options.packagedExecutablePath }
            : {}),
          readVersion: readCodexVersion,
        }),
        clientVersion: options.clientVersion,
        environment: { CODEX_HOME: join(options.stateDirectory, "codex-home") },
      });
  }

  async start(): Promise<LocalProductApi> {
    if (this.apiValue)
      throw new Error("Codex execution core is already started.");
    await mkdir(join(this.options.stateDirectory, "codex-home"), {
      recursive: true,
      mode: 0o700,
    });
    if (this.options.taskWorkspaceRoot)
      await mkdir(this.options.taskWorkspaceRoot, {
        recursive: true,
        mode: 0o700,
      });
    await this.options.attachmentAuthority?.restore();
    const store = new SqliteTaskEngineStore({
      path: join(this.options.stateDirectory, "task-process.v1.sqlite3"),
      ...(this.options.taskWorkspaceRoot
        ? { taskWorkspaceRoot: this.options.taskWorkspaceRoot }
        : {}),
    });
    this.store = store;
    this.connectionGeneration = store.nextHostGeneration("codex");
    this.runtimeGeneration = store.nextHostGeneration("runtime");
    const engine = new TaskEngine(store);
    let rpc;
    try {
      rpc = await this.host.start();
    } catch (error) {
      const taskPort = new LedgerProductTaskPort({
        engine,
        store,
        worker: {
          signal: () => undefined,
          cancelTask: () => false,
        },
        ...(this.options.taskWorkspaceRoot
          ? { taskWorkspaceRoot: this.options.taskWorkspaceRoot }
          : {}),
        ...(this.options.onProductStateChanged
          ? { onPublished: this.options.onProductStateChanged }
          : {}),
      });
      const attention = new LedgerAttentionView(store);
      await attention.refresh();
      this.taskPort = taskPort;
      this.apiValue = new LocalProductApi(
        () => this.host.getHealth(),
        unavailableAccountCatalog(),
        taskPort,
        {},
        attention,
        this.options.taskWorkingDirectory ?? this.options.stateDirectory,
        () => this.recoveryWarnings,
        this.options.attachmentAuthority,
        this.options.attachmentRuntime,
        undefined,
        store,
        store,
      );
      await this.options.onProductStateChanged?.();
      throw error;
    }
    const account = new CodexAccountCatalogService(rpc);
    account.start();
    await account.refresh();
    this.account = account;
    const capabilityIssuer = await persistedCapabilityIssuer(
      join(this.options.stateDirectory, "task-capability.key"),
    );
    const sessionSupervisor = new CodexThreadSessionSupervisor(rpc);
    if (this.connectionGeneration > 1)
      sessionSupervisor.replaceConnectionGeneration(this.connectionGeneration);
    const adapter = new CodexRuntimeTaskAdapter({
      rpc,
      sessionSupervisor,
      runtime: this.options.runtime,
      store,
      mcpLaunch: this.options.mcpLaunch,
      capabilityIssuer,
      ...(this.options.attachmentAuthority && this.options.attachmentRuntime
        ? {
            attachments: {
              authority: this.options.attachmentAuthority,
              runtime: this.options.attachmentRuntime,
            },
          }
        : {}),
    });
    const worker = new TaskEngineWorker({
      engine,
      store,
      adapter,
      maximumConcurrentTasks: 4,
      onBackgroundError: async (error) => {
        this.recoveryWarnings = [
          ...this.recoveryWarnings,
          `Task worker recovery: ${error.message}`,
        ].slice(-64);
        await this.options.onProductStateChanged?.();
      },
      onTaskWaitCancelled: async (command) => {
        if (
          [
            "lookup_or_start_runtime",
            "read_runtime_inventory",
            "end_runtime_session",
            "relaunch_named_browser",
            "inspect_after_return",
            "return_runtime_ownership",
          ].includes(command.type)
        )
          return;
        const anotherTurnIsActive = await Promise.all(
          (await store.projections())
            .filter((projection) => projection.taskId !== command.taskId)
            .map((projection) => store.aggregate(projection.taskId)),
        ).then((aggregates) =>
          aggregates.some((aggregate) => aggregate?.codex.turn === "active"),
        );
        if (anotherTurnIsActive) return;
        await this.host.replaceConnection();
      },
      ...(this.options.onTaskEngineCut
        ? {
            onCut: (point, command) =>
              this.options.onTaskEngineCut!(point, {
                taskId: command.taskId,
                commandType: command.type,
              }),
          }
        : {}),
    });
    const taskPort = new LedgerProductTaskPort({
      engine,
      store,
      worker,
      ...(this.options.taskWorkspaceRoot
        ? { taskWorkspaceRoot: this.options.taskWorkspaceRoot }
        : {}),
      ...(this.options.onProductStateChanged
        ? { onPublished: this.options.onProductStateChanged }
        : {}),
      ...(this.options.onTaskEngineCut
        ? {
            onCut: (point, intent) =>
              this.options.onTaskEngineCut!(point, {
                ...(intent.type === "launch" ? {} : { taskId: intent.taskId }),
              }),
          }
        : {}),
    });
    this.taskPort = taskPort;
    const attention = new LedgerAttentionView(store);
    const ingress = new OrderedTaskIngress(
      engine,
      async (error) => {
        this.recoveryWarnings = [
          ...this.recoveryWarnings,
          `Codex event recovery: ${error.message}`,
        ].slice(-64);
        await this.options.onProductStateChanged?.();
      },
      async () => {
        worker.signal();
        await attention.refresh();
        await taskPort.publish();
      },
    );
    this.ingress = ingress;
    const initial = this.host.getHealth().connectionId;
    if (initial) {
      this.connectionId = initial;
      ingress.replaceGeneration(this.connectionGeneration);
    }
    this.detachHealth = this.host.onHealth((health) => {
      if (
        !health.ready ||
        !health.connectionId ||
        health.connectionId === this.connectionId
      )
        return;
      this.connectionId = health.connectionId;
      this.connectionGeneration = store.nextHostGeneration("codex");
      sessionSupervisor.replaceConnectionGeneration(this.connectionGeneration);
      ingress.replaceGeneration(this.connectionGeneration);
      void this.recover("App Server");
    });
    this.detachEvents = rpc.onEvent(async (event) => {
      const mapped = await this.mapCodexEvent(event);
      if (mapped) await ingress.enqueue(this.connectionGeneration, mapped);
    });
    await this.options.onTaskProcessRecoveryPoint?.("contexts_restored");
    await this.recover("Desktop startup");
    await this.options.onTaskProcessRecoveryPoint?.("outbox_recovery_started");
    worker.signal();
    this.runtimePoll = setInterval(() => {
      void this.pollRuntimeTruth();
    }, 750);
    await attention.refresh();
    this.apiValue = new LocalProductApi(
      () => this.host.getHealth(),
      account,
      taskPort,
      {},
      attention,
      this.options.taskWorkingDirectory ?? this.options.stateDirectory,
      () => this.recoveryWarnings,
      this.options.attachmentAuthority,
      this.options.attachmentRuntime,
      this.options.runtime.acknowledgeLegacyEffectScope
        ? {
            acknowledgeLegacyEffectScope: (sessionId) =>
              this.options.runtime.acknowledgeLegacyEffectScope!(sessionId),
            ...(this.options.runtime.authorizeEffectRepetition
              ? {
                  authorizeEffectRepetition: (
                    sessionId: string,
                    effectId: string,
                  ) =>
                    this.options.runtime.authorizeEffectRepetition!(
                      sessionId,
                      effectId,
                    ),
                }
              : {}),
            ...(this.options.runtime.consequentialEffect
              ? {
                  consequentialEffect: (
                    sessionId: string,
                    consequenceKey: string,
                  ) =>
                    this.options.runtime.consequentialEffect!(
                      sessionId,
                      consequenceKey,
                    ),
                }
              : {}),
            ...(this.options.runtime.authorizeTaskResultAction
              ? {
                  authorizeTaskResultAction: (
                    sessionId: string,
                    consequenceKey: string,
                    materialDigest: string,
                    planId: string,
                  ) =>
                    this.options.runtime.authorizeTaskResultAction!(
                      sessionId,
                      consequenceKey,
                      materialDigest,
                      planId,
                    ),
                }
              : {}),
          }
        : undefined,
      store,
      store,
      this.options.runtime.startRecording &&
        this.options.runtime.stopRecording &&
        this.options.runtime.listRecordings
        ? {
            startRecording: async (sessionId, request) => {
              const attachedSessionId = await this.attachBrowser(
                request.taskId,
              );
              if (sessionId !== undefined && attachedSessionId !== sessionId)
                throw new Error("Task recording session binding changed.");
              return this.options.runtime.startRecording!(
                attachedSessionId,
                request,
              );
            },
            stopRecording: (sessionId, recordingId) =>
              this.options.runtime.stopRecording!(sessionId, recordingId),
            listRecordings: (sessionId) =>
              this.options.runtime.listRecordings!(sessionId),
          }
        : undefined,
    );
    await this.options.onProductStateChanged?.();
    return this.apiValue;
  }

  private async mapCodexEvent(
    event: CodexServerEvent,
  ): Promise<TaskEvent | null> {
    if (!this.store) return null;
    const params = event.params;
    const nestedThread = object(params.thread);
    const nestedTurn = object(params.turn);
    const nestedItem = object(params.item);
    const threadId =
      text(params.threadId) ??
      text(nestedThread?.id) ??
      text(params.conversationId);
    if (!threadId) return null;
    let taskId: string | undefined;
    for (const projection of await this.store.projections()) {
      const aggregate = await this.store.aggregate(projection.taskId);
      if (
        aggregate?.record?.identity.threadId === threadId ||
        aggregate?.codex.threadId === threadId
      ) {
        taskId = projection.taskId;
        break;
      }
    }
    if (!taskId) return null;
    const aggregate = await this.store.aggregate(taskId);
    if (!aggregate) return null;
    this.codexPosition += 1;
    const base = {
      schemaVersion: 1 as const,
      eventId: `codex:${this.connectionGeneration}:${this.codexPosition}:${digest(event)}`,
      taskId,
      source: {
        kind: "codex" as const,
        id: this.connectionId ?? "disconnected",
        generation: Math.max(1, this.connectionGeneration),
        position: this.codexPosition,
      },
      observedAt: new Date().toISOString(),
    };
    if (event.method === "turn/started" || event.method === "turn/completed") {
      const turnId = text(params.turnId) ?? text(nestedTurn?.id);
      const status = text(params.status) ?? text(nestedTurn?.status);
      const turn =
        event.method === "turn/started"
          ? "active"
          : status === "failed"
            ? "failed"
            : status === "interrupted"
              ? "interrupted"
              : "completed";
      return {
        ...base,
        type: "codex_turn_observed",
        threadId,
        turn: {
          turn,
          ...(turn === "active" && turnId ? { turnId } : {}),
          runtimeStatus: turn === "active" ? "active" : "idle",
        },
      };
    }
    if (
      event.method === "item/completed" ||
      event.method === "item/started" ||
      event.method.endsWith("/delta") ||
      event.method === "item/mcpToolCall/progress"
    ) {
      const turnId = text(params.turnId) ?? text(nestedTurn?.id);
      const itemId = text(params.itemId) ?? text(nestedItem?.id);
      const item = projectedItem(
        nestedItem ?? params,
        turnId,
        itemId,
        event.method === "item/completed",
      );
      const completedHandoff =
        event.method === "item/completed" && nestedItem
          ? await this.completedHandoff(taskId, threadId, turnId, nestedItem)
          : undefined;
      return turnId && itemId
        ? {
            ...base,
            type: "codex_item_observed",
            threadId,
            turnId,
            itemId,
            terminal: event.method === "item/completed",
            ...(item ? { item } : {}),
            ...(completedHandoff ? { completedHandoff } : {}),
          }
        : null;
    }
    if (
      event.method === "thread/archived" ||
      event.method === "thread/unarchived"
    ) {
      return {
        ...base,
        type: "codex_thread_observed",
        thread: {
          ...aggregate.codex,
          archived: event.method === "thread/archived",
        },
        ...(aggregate.codexSessionId
          ? { codexSessionId: aggregate.codexSessionId }
          : {}),
      };
    }
    if (event.method === "serverRequest/resolved") {
      const wireRequestId =
        typeof params.requestId === "string" ||
        typeof params.requestId === "number"
          ? params.requestId
          : undefined;
      const requestId =
        wireRequestId !== undefined
          ? aggregate.attentions.find(
              (entry) =>
                entry.authority === "codex" &&
                entry.threadId === threadId &&
                entry.generation === this.connectionGeneration &&
                (entry.wireRequestId === wireRequestId ||
                  entry.requestId.endsWith(`:server:${String(wireRequestId)}`)),
            )?.requestId
          : undefined;
      return requestId
        ? {
            ...base,
            type: "codex_request_resolved",
            requestId,
            threadId,
            generation: this.connectionGeneration,
            resolution: "resolved",
          }
        : null;
    }
    if (event.requestId !== undefined) {
      if (!isResponseAttentionMethod(event.method)) return null;
      const logicalRequestId = String(event.requestId);
      const wireRequestId = event.wireRequestId;
      if (
        typeof wireRequestId !== "string" &&
        typeof wireRequestId !== "number"
      )
        throw new Error("Codex attention lacks its exact wire request id.");
      return {
        ...base,
        type: "codex_request_observed",
        attentions: [
          {
            authority: "codex",
            kind: attentionKind(event.method),
            requestId: logicalRequestId,
            method: event.method,
            wireRequestId,
            responseFields: attentionResponseFields(event.method, event.params),
            taskId,
            threadId,
            ...(text(params.turnId) ? { turnId: text(params.turnId)! } : {}),
            ...(text(params.itemId) ? { itemId: text(params.itemId)! } : {}),
            generation: this.connectionGeneration,
            status: "pending",
          },
        ],
      };
    }
    return null;
  }

  private async completedHandoff(
    taskId: string,
    threadId: string,
    turnId: string | undefined,
    item: Record<string, unknown>,
  ): Promise<
    | NonNullable<
        Extract<TaskEvent, { type: "codex_item_observed" }>["completedHandoff"]
      >
    | undefined
  > {
    if (
      !turnId ||
      item.type !== "mcpToolCall" ||
      item.server !== "rove" ||
      item.tool !== "control.request_human" ||
      item.status !== "completed" ||
      item.error !== null
    )
      return undefined;
    const args = object(item.arguments);
    const result = handoffResult(item.result);
    const aggregate = await this.store?.aggregate(taskId);
    const sessionId = text(args?.sessionId);
    const instruction = text(args?.instruction);
    const policy = args?.continuationPolicy;
    if (
      !aggregate ||
      !sessionId ||
      sessionId !== aggregate.record?.identity.sessionId ||
      !instruction ||
      (policy !== "resume_after_control_return" &&
        policy !== "explicit_user_response") ||
      !result ||
      result.sessionId !== sessionId ||
      !this.options.runtime.getControlStatus
    )
      throw new Error("Completed handoff item lacks exact trusted bindings.");
    const control = await this.options.runtime.getControlStatus(sessionId);
    const preHandoffObservationSeq = authoritativePreHandoffObservationSeq({
      result: {
        handoffId: result.handoffId,
        generation: result.generation,
        ...(result.observationSeq === undefined
          ? {}
          : { observationSeq: result.observationSeq }),
      },
      runtime: control,
    });
    return {
      sessionId,
      handoffId: result.handoffId,
      handoffGeneration: result.generation,
      ownershipGeneration: control.generation,
      controller: control.controller,
      status: control.status,
      continuation: {
        status: "pending",
        id: `continuation:${taskId}:${result.generation}`,
        taskId,
        sessionId,
        threadId,
        handoffId: result.handoffId,
        generation: result.generation,
        policy,
        freshInspectionRequired: true,
        preHandoffObservationSeq,
      },
      attention: {
        authority: "rove_control",
        kind: "control_handoff",
        requestId: `control:${String(item.id)}`,
        taskId,
        sessionId,
        threadId,
        turnId,
        handoffId: result.handoffId,
        generation: result.generation,
        status: "pending",
      },
    };
  }

  api(): LocalProductApi {
    if (!this.apiValue) throw new Error("Codex execution core is not started.");
    return this.apiValue;
  }

  async resolveTaskRuntimeControl(
    taskId: string,
    expectedHandoffGeneration?: number,
  ): Promise<{
    sessionId: string;
    ownershipGeneration: number;
    handoffId?: string;
    handoffGeneration?: number;
  }> {
    if (!this.store) throw new Error("Codex execution core is not started.");
    const aggregate = await this.store.aggregate(taskId);
    const inventory = await this.options.runtime.listSessionInventory?.();
    return resolveTaskRuntimeControlAuthority(
      taskId,
      aggregate,
      inventory ?? [],
      expectedHandoffGeneration,
    );
  }

  async attachBrowser(taskId: string): Promise<string> {
    if (!this.store) throw new Error("Codex execution core is not started.");
    const aggregate = await this.store.aggregate(taskId);
    if (
      !aggregate?.launch ||
      aggregate.record?.bootstrap.stage !== "complete" ||
      aggregate.desiredState !== "open"
    )
      throw new Error("Browser attachment requires an open, ready task.");
    const inventory = await this.options.runtime.listSessionInventory?.();
    const matches = (inventory ?? []).filter((entry) =>
      aggregate.record?.identity.sessionId
        ? entry.session.id === aggregate.record.identity.sessionId
        : entry.session.bootstrapId === aggregate.launch!.bootstrapId,
    );
    if (matches.length > 1)
      throw new Error("Browser attachment lookup is conflicting.");
    let session = matches[0]?.session;
    if (!session || ["completed", "failed"].includes(session.status))
      session = await this.options.runtime.startSession({
        bootstrapId: aggregate.launch.bootstrapId,
        mode: aggregate.launch.executionMode,
        ...(aggregate.launch.browserIdentity
          ? { browser: aggregate.launch.browserIdentity }
          : {}),
      });
    else if (
      (matches[0]!.attachment !== "attached" ||
        matches[0]!.recovery !== "not_needed") &&
      this.options.runtime.recoverSession
    )
      session = (await this.options.runtime.recoverSession(session.id)).session;
    if (session.bootstrapId !== aggregate.launch.bootstrapId)
      throw new Error(
        "Browser attachment returned a conflicting task receipt.",
      );
    await this.pollRuntimeTruth();
    return session.id;
  }

  async requestLocalFileGrant(input: {
    reason: string;
    allowMultiple: boolean;
    sessionId?: string;
  }): Promise<LocalFileGrantSelection[] | null> {
    if (!this.taskPort || !this.options.attachmentAuthority || !input.sessionId)
      throw new Error("Task attachment authority is unavailable.");
    const taskId = await this.taskPort.taskIdForRuntimeSession(input.sessionId);
    const result = this.options.attachmentAuthority.requestMidTask({
      requestId: `file_request_${randomUUID().replaceAll("-", "")}`,
      taskId,
      sessionId: input.sessionId,
      reason: input.reason,
      allowMultiple: input.allowMultiple,
    });
    await this.options.attachmentAuthority.flushState();
    await this.options.onFileAttention?.();
    await this.options.onProductStateChanged?.();
    return result.finally(() => this.options.onProductStateChanged?.());
  }

  completeLocalFileGrant(
    sessionId: string,
    materialized: readonly { attachmentId: string; evidenceId: string }[],
  ): Promise<void> {
    if (!this.options.attachmentAuthority)
      throw new Error("Task attachment authority is unavailable.");
    return this.options.attachmentAuthority.completeMidTask(
      sessionId,
      materialized,
    );
  }
  failLocalFileGrant(
    sessionId: string,
    attachmentIds: readonly string[],
  ): Promise<void> {
    if (!this.options.attachmentAuthority)
      throw new Error("Task attachment authority is unavailable.");
    return this.options.attachmentAuthority.failMidTask(
      sessionId,
      attachmentIds,
    );
  }
  markLocalFileGrantReconciliation(
    sessionId: string,
    attachmentIds: readonly string[],
  ): Promise<void> {
    if (!this.options.attachmentAuthority)
      throw new Error("Task attachment authority is unavailable.");
    return this.options.attachmentAuthority.markMidTaskReconciliation(
      sessionId,
      attachmentIds,
    );
  }

  async recover(source = "Runtime"): Promise<void> {
    if (!this.account) return;
    try {
      await this.account.refresh();
      this.recoveryWarnings = [];
    } catch (error) {
      this.recoveryWarnings = [
        `${source} recovery: ${error instanceof Error ? error.message : String(error)}`,
      ];
    }
    if (source === "Desktop startup") {
      await this.enqueueGenerationFacts(
        "codex",
        Math.max(1, this.connectionGeneration),
      );
      await this.enqueueGenerationFacts("runtime", this.runtimeGeneration);
    } else if (source.includes("App Server")) {
      await this.enqueueGenerationFacts(
        "codex",
        Math.max(1, this.connectionGeneration),
      );
    } else {
      this.runtimeGeneration =
        this.store?.nextHostGeneration("runtime") ?? this.runtimeGeneration + 1;
      await this.enqueueGenerationFacts("runtime", this.runtimeGeneration);
    }
    await this.pollRuntimeTruth();
  }

  private async enqueueGenerationFacts(
    component: "codex" | "runtime",
    generation: number,
  ): Promise<void> {
    if (!this.store || !this.ingress) return;
    for (const projection of await this.store.projections()) {
      if (projection.phase === "closed") continue;
      if (component === "runtime") {
        const aggregate = await this.store.aggregate(projection.taskId);
        if (
          !aggregate ||
          !requiresRuntimeGenerationReconciliation({
            ...(aggregate.record?.identity.sessionId
              ? { sessionId: aggregate.record.identity.sessionId }
              : {}),
            status: aggregate.runtime.status,
            attachment: aggregate.runtime.attachment,
            recovery: aggregate.runtime.recovery,
          })
        )
          continue;
      }
      await this.ingress.enqueue(Math.max(1, this.connectionGeneration), {
        schemaVersion: 1,
        type: "host_generation_changed",
        eventId: `host:${this.hostInstanceId}:${component}:${generation}:${projection.taskId}`,
        taskId: projection.taskId,
        source: {
          kind: "host",
          id: `${this.hostInstanceId}:${component}`,
          generation,
          position: 1,
        },
        observedAt: new Date().toISOString(),
        component,
        generation,
      });
    }
  }

  private async pollRuntimeTruth(): Promise<void> {
    if (
      this.runtimePollActive ||
      !this.store ||
      !this.ingress ||
      !this.options.runtime.listSessionInventory
    )
      return;
    this.runtimePollActive = true;
    try {
      let inventory;
      try {
        inventory = await this.options.runtime.listSessionInventory();
      } catch (error) {
        throw new Error(
          `inventory read failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      for (const projection of await this.store.projections()) {
        if (projection.phase === "closed") continue;
        const aggregate = await this.store.aggregate(projection.taskId);
        if (!aggregate?.launch) continue;
        const match = inventory.find((entry) =>
          aggregate.record?.identity.sessionId
            ? entry.session.id === aggregate.record.identity.sessionId
            : entry.session.bootstrapId === aggregate.launch!.bootstrapId,
        );
        if (
          match &&
          aggregate.launch.attachmentIds.length > 0 &&
          this.options.attachmentAuthority &&
          this.options.attachmentRuntime
        )
          await this.options.attachmentAuthority.bindDrafts(
            aggregate.launch.attachmentIds,
            aggregate.taskId,
            match.session.id,
            this.options.attachmentRuntime,
          );
        let control;
        try {
          control =
            match &&
            !["completed", "failed"].includes(match.session.status) &&
            this.options.runtime.getControlStatus
              ? await this.options.runtime.getControlStatus(match.session.id)
              : undefined;
        } catch (error) {
          throw new Error(
            `control-status read failed for ${match?.session.status ?? "missing"} session ${match?.session.id ?? "unbound"}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const runtime: NativeRuntimeTruth = match
          ? {
              availability: "available",
              sessionExists: true,
              sessionId: match.session.id,
              ...(match.session.bootstrapId
                ? { bootstrapId: match.session.bootstrapId }
                : {}),
              bootstrapLookup: "exact",
              status: match.session.status,
              controller: match.session.controller,
              attachment: match.attachment,
              profileLock: match.profileOwnership,
              browserIdentity: nativeBrowserIdentity(match.browserIdentity),
              recovery: match.recovery,
              ...(match.legacyEffects === undefined
                ? {}
                : { legacyEffects: match.legacyEffects }),
              ...(control
                ? {
                    ownershipGeneration: control.generation,
                    ...(control.activeHandoffId
                      ? { handoffId: control.activeHandoffId }
                      : {}),
                    ...(control.activeHandoffGeneration
                      ? { handoffGeneration: control.activeHandoffGeneration }
                      : {}),
                    ...(control.lastReturnedHandoffId
                      ? { lastReturnedHandoffId: control.lastReturnedHandoffId }
                      : {}),
                    ...(control.observationSeq === undefined
                      ? {}
                      : { observationSeq: control.observationSeq }),
                  }
                : {}),
            }
          : {
              availability: "available",
              sessionExists: false,
              bootstrapLookup: "none",
              status: "missing",
              controller: null,
              attachment: "missing",
              profileLock: "released",
              recovery: "cleanup_required",
            };
        const fingerprint = digest(runtime);
        const position = control?.observationSeq ?? 1;
        const sourceGeneration = this.runtimeGeneration;
        const observedAt =
          control?.updatedAt ??
          (match?.session as { updatedAt?: string } | undefined)?.updatedAt ??
          aggregate.launch.requestedAt;
        await this.ingress.enqueue(Math.max(1, this.connectionGeneration), {
          schemaVersion: 1,
          type: "runtime_inventory_observed",
          eventId: runtimeInventoryEventId(
            projection.taskId,
            sourceGeneration,
            position,
            fingerprint,
          ),
          taskId: projection.taskId,
          source: {
            kind: "runtime",
            id:
              control?.observationSeq === undefined
                ? `inventory:${match?.session.id ?? aggregate.launch.bootstrapId}:${fingerprint}`
                : `inventory:${match?.session.id ?? aggregate.launch.bootstrapId}`,
            generation: sourceGeneration,
            position,
          },
          observedAt,
          runtime,
        });
      }
    } catch (error) {
      this.recoveryWarnings = [
        ...this.recoveryWarnings,
        `Runtime observation: ${error instanceof Error ? error.message : String(error)}`,
      ].slice(-64);
      await this.options.onProductStateChanged?.();
    } finally {
      this.runtimePollActive = false;
    }
  }

  async stop(): Promise<void> {
    if (this.runtimePoll) clearInterval(this.runtimePoll);
    this.runtimePoll = undefined;
    this.detachEvents?.();
    this.detachHealth?.();
    await this.ingress?.drain();
    await this.host.drainEvents();
    this.account?.stop();
    this.apiValue = undefined;
    this.account = undefined;
    this.taskPort = undefined;
    this.ingress = undefined;
    this.store?.close();
    this.store = undefined;
    await this.host.stop();
  }
}

function unavailableAccountCatalog(): CodexAccountCatalogPort {
  const unavailable = (): never => {
    throw new Error("Codex is unavailable.");
  };
  const snapshot: CodexCatalogSnapshot = {
    account: { status: "unavailable" },
    models: [],
    rateLimits: null,
    usage: null,
    refreshedAt: new Date(0).toISOString(),
  };
  return {
    snapshot: () => structuredClone(snapshot),
    trustedLoginUrl: unavailable,
    refresh: async () => structuredClone(snapshot),
    refreshManagedToken: async () => structuredClone(snapshot),
    login: async () => unavailable(),
    cancelLogin: async () => unavailable(),
    logout: async () => unavailable(),
  };
}

async function persistedCapabilityIssuer(
  path: string,
): Promise<PersistedTaskCapabilityIssuer> {
  let encoded: string;
  try {
    encoded = (await readFile(path, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const candidate = randomBytes(32).toString("base64url");
    try {
      await writeFile(path, `${candidate}\n`, { mode: 0o600, flag: "wx" });
      encoded = candidate;
    } catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== "EEXIST")
        throw writeError;
      encoded = (await readFile(path, "utf8")).trim();
    }
  }
  return new PersistedTaskCapabilityIssuer(Buffer.from(encoded, "base64url"));
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}
function attentionKind(method: string) {
  if (method.includes("requestUserInput")) return "user_input" as const;
  if (method.includes("elicitation")) return "mcp_elicitation" as const;
  if (method.includes("permissions")) return "permission_approval" as const;
  if (method.includes("fileChange") || method.includes("applyPatch"))
    return "file_approval" as const;
  return "command_approval" as const;
}

const RESPONSE_ATTENTION_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "item/permissions/requestApproval",
  "applyPatchApproval",
  "execCommandApproval",
]);

function isResponseAttentionMethod(method: string): boolean {
  return RESPONSE_ATTENTION_METHODS.has(method);
}

function attentionResponseFields(
  method: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const common = ["threadId", "turnId", "itemId"];
  const byMethod: Record<string, readonly string[]> = {
    "item/commandExecution/requestApproval": [
      "approvalId",
      "availableDecisions",
      "command",
      "commandActions",
      "cwd",
      "reason",
      "additionalPermissions",
      "networkApprovalContext",
    ],
    "item/fileChange/requestApproval": ["grantRoot", "reason"],
    "item/tool/requestUserInput": [
      "autoResolutionMs",
      "isBlocking",
      "questions",
    ],
    "mcpServer/elicitation/request": [
      "message",
      "mode",
      "requestedSchema",
      "serverName",
    ],
    "item/permissions/requestApproval": [
      "cwd",
      "environmentId",
      "permissions",
      "reason",
    ],
    applyPatchApproval: ["callId", "changes", "reason", "grantRoot"],
    execCommandApproval: [
      "callId",
      "command",
      "cwd",
      "reason",
      "proposedExecpolicyAmendment",
    ],
  };
  const result: Record<string, unknown> = {};
  for (const key of [...common, ...(byMethod[method] ?? [])]) {
    const value = params[key];
    if (value !== undefined) result[key] = structuredClone(value);
  }
  if (JSON.stringify(result).length > 65_536)
    throw new Error("Codex attention response descriptor exceeds its bound.");
  return result;
}

function projectedItem(
  value: Record<string, unknown>,
  turnId: string | undefined,
  itemId: string | undefined,
  completed: boolean,
): TaskConversationItem | undefined {
  if (!turnId || !itemId) return undefined;
  const type = text(value.type);
  const kind: TaskConversationItem["kind"] =
    type === "userMessage"
      ? "user_message"
      : type === "agentMessage"
        ? "assistant_message"
        : type === "plan"
          ? "plan"
          : type === "commandExecution"
            ? "command"
            : type === "fileChange"
              ? "file_change"
              : type === "mcpToolCall" || type === "dynamicToolCall"
                ? "tool"
                : "other";
  const content = Array.isArray(value.content)
    ? value.content
        .map((part) => text(object(part)?.text))
        .filter((part): part is string => Boolean(part))
        .join("\n")
    : undefined;
  const attachments = projectUserInputAttachments(value.content);
  const phase: TaskConversationItem["phase"] =
    value.phase === "commentary" || value.phase === "final_answer"
      ? value.phase
      : undefined;
  const item = {
    id: itemId,
    turnId,
    ...(type === "userMessage" && text(value.clientId)
      ? { clientId: text(value.clientId)! }
      : {}),
    ...(type === "userMessage" && attachments.length ? { attachments } : {}),
    kind,
    status: completed ? ("completed" as const) : ("started" as const),
    ...(phase === undefined ? {} : { phase }),
    ...(text(value.text) || content
      ? { text: (text(value.text) ?? content)!.slice(0, 16_000) }
      : {}),
    ...(text(value.command) || text(value.tool)
      ? { title: (text(value.command) ?? text(value.tool))!.slice(0, 500) }
      : {}),
    ...(text(value.aggregatedOutput) || text(value.message)
      ? {
          progress: (text(value.aggregatedOutput) ??
            text(value.message))!.slice(0, 8_000),
        }
      : {}),
  };
  return item;
}

function handoffResult(value: unknown):
  | {
      sessionId: string;
      handoffId: string;
      generation: number;
      observationSeq?: number;
    }
  | undefined {
  let payload = object(value);
  if (Array.isArray(payload?.content)) {
    const block = payload.content.find((entry) => text(object(entry)?.text));
    try {
      payload = JSON.parse(text(object(block)?.text) ?? "") as Record<
        string,
        unknown
      >;
    } catch {
      return undefined;
    }
  }
  const sessionId = text(payload?.sessionId);
  const handoffId = text(payload?.activeHandoffId);
  const generation = payload?.generation;
  if (!sessionId || !handoffId || !Number.isSafeInteger(generation))
    return undefined;
  return {
    sessionId,
    handoffId,
    generation: Number(generation),
    ...(Number.isSafeInteger(payload?.observationSeq)
      ? { observationSeq: Number(payload?.observationSeq) }
      : {}),
  };
}

function nativeBrowserIdentity(value: {
  mode: "temporary" | "workspace";
  workspaceId?: string | undefined;
}): { mode: "temporary" } | { mode: "workspace"; workspaceId: string } {
  if (value.mode === "temporary") return { mode: "temporary" };
  if (!value.workspaceId)
    throw new Error("Runtime workspace observation lacks an identity.");
  return { mode: "workspace", workspaceId: value.workspaceId };
}
