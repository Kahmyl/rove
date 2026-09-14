import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { projectTaskAggregate } from "@rove/protocol";
import type {
  TaskEngine,
  TaskAcceptance,
  TaskEngineStore,
  TaskIntent,
  TaskLaunchConfiguration,
  TaskPortableValue,
  TaskSelectedResultContextSnapshot,
} from "@rove/protocol";

import type {
  ApprovalsReviewer,
  BrowserIdentity,
  ExecutionMode,
  ProductTaskSnapshot,
} from "./task-coordinator.js";
import type { TaskEngineWorker } from "./task-engine-worker.js";

export type {
  ApprovalsReviewer,
  BrowserIdentity,
  ExecutionMode,
  ProductTaskSnapshot,
};

export type ProductTaskIntent =
  | {
      type: "launch";
      operationId: string;
      outcome: string;
      executionMode: ExecutionMode;
      browserIdentity?: BrowserIdentity;
      approvalsReviewer: ApprovalsReviewer;
      cwd: string;
      model?: string;
      reasoningEffort?: string;
      attachmentIds: readonly string[];
      workflowContext?: TaskLaunchConfiguration["workflowContext"];
      workflowAssociation?: TaskLaunchConfiguration["workflowAssociation"];
    }
  | {
      type: "message";
      taskId: string;
      operationId: string;
      message: string;
      expectedTurnId?: string;
      attachmentIds?: readonly string[];
      workflowContext?: TaskLaunchConfiguration["workflowContext"];
      selectedResultContext?: TaskSelectedResultContextSnapshot;
    }
  | { type: "interrupt"; taskId: string; operationId: string }
  | { type: "finish"; taskId: string; operationId: string }
  | { type: "retry_cleanup"; taskId: string; operationId: string }
  | { type: "return_control"; taskId: string; operationId: string }
  | { type: "archive" | "unarchive"; taskId: string; operationId: string }
  | {
      type: "attention_response";
      taskId: string;
      operationId: string;
      requestId: string;
      generation: number;
      response: TaskPortableValue;
    }
  | {
      type: "explicit_continuation_response";
      taskId: string;
      operationId: string;
      message: string;
      attachmentIds?: readonly string[];
      workflowContext?: TaskLaunchConfiguration["workflowContext"];
      selectedResultContext?: TaskSelectedResultContextSnapshot;
    };

export interface ProductTaskPort {
  submit(intent: ProductTaskIntent): Promise<TaskAcceptance>;
  productTasks(): Promise<ProductTaskSnapshot[]>;
  readTask(taskId: string): Promise<ProductTaskSnapshot | null>;
  subscribe(
    fromRevision: number,
    listener: (revision: number) => void,
  ): () => void;
  taskIdForRuntimeSession(sessionId: string): Promise<string>;
}

export interface LedgerProductTaskPortOptions {
  engine: TaskEngine;
  store: TaskEngineStore & {
    initializeTaskHistoryPreference?(taskId: string): void;
    taskHistoryArchived?(taskId: string): boolean | undefined;
    applyTaskHistoryPreference?(input: {
      taskId: string;
      operationId: string;
      archived: boolean;
    }): { duplicate: boolean; archived: boolean };
  };
  worker: Pick<TaskEngineWorker, "signal" | "cancelTask">;
  taskWorkspaceRoot?: string;
  now?: () => string;
  onPublished?: () => Promise<void> | void;
  onCut?: (
    point: "before_event_commit" | "after_commit_before_claim",
    intent: ProductTaskIntent,
  ) => Promise<void> | void;
}

function productLifecycleReason(
  phase: ProductTaskSnapshot["lifecycle"]["phase"],
  codexTurn:
    "none" | "active" | "completed" | "failed" | "interrupted" | "unknown",
  fallback: string,
): string {
  if (codexTurn === "active") return "Codex is working on this task.";
  if (phase === "cleanup_required")
    return "Resource cleanup is still pending. Retry cleanup from the task controls.";
  if (codexTurn === "interrupted")
    return "The last Codex turn was interrupted. Send a follow-up to continue.";
  if (codexTurn === "failed")
    return "The last Codex turn failed. Send a follow-up to retry.";
  if (phase === "ready" && codexTurn === "completed")
    return "Ready for a follow-up.";
  if (phase === "starting") return "Starting this task.";
  if (phase === "working") return "Waiting for Codex activity.";
  return fallback === "Observation reduced from authoritative facts."
    ? "Task state is up to date."
    : fallback;
}

/** Production product boundary. It accepts one typed intent and exposes only
 * ledger projections; no caller supplies lifecycle truth or performs a
 * follow-up lifecycle mutation. */
export class LedgerProductTaskPort implements ProductTaskPort {
  private readonly engine: TaskEngine;
  private readonly now: () => string;
  private revision = 0;
  private readonly listeners = new Set<(revision: number) => void>();

  constructor(private readonly options: LedgerProductTaskPortOptions) {
    this.engine = options.engine;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async submit(intent: ProductTaskIntent): Promise<TaskAcceptance> {
    const taskId =
      intent.type === "launch"
        ? taskIdForOperation(intent.operationId)
        : intent.taskId;
    const launchWorkspace =
      intent.type === "launch" && this.options.taskWorkspaceRoot
        ? join(this.options.taskWorkspaceRoot, taskId)
        : undefined;
    if (intent.type === "archive" || intent.type === "unarchive") {
      const aggregate = await this.options.store.aggregate(intent.taskId);
      if (!aggregate)
        throw new Error("Task history preference targets an unknown task.");
      if (!this.options.store.applyTaskHistoryPreference)
        throw new Error("Task history operation storage is unavailable.");
      await this.options.onCut?.("before_event_commit", intent);
      const archived = intent.type === "archive";
      const receipt = this.options.store.applyTaskHistoryPreference({
        taskId: intent.taskId,
        operationId: intent.operationId,
        archived,
      });
      await this.options.onCut?.("after_commit_before_claim", intent);
      const projection = {
        ...projectTaskAggregate(aggregate),
        operationDisposition: {
          type: archived ? ("archive" as const) : ("resume" as const),
          operationId: intent.operationId,
          status: "accepted" as const,
          reason: archived
            ? "Task was archived in local history."
            : "Task was restored to local history.",
        },
      };
      this.revision += 1;
      for (const listener of this.listeners) listener(this.revision);
      await this.options.onPublished?.();
      return {
        duplicate: receipt.duplicate,
        aggregate,
        projection,
        command: null,
      };
    }
    if (launchWorkspace)
      await mkdir(launchWorkspace, { recursive: true, mode: 0o700 });
    const base = {
      schemaVersion: 1 as const,
      eventId: `product:v2:${intent.type}:${intent.operationId}`,
      taskId,
      source: {
        kind: "product" as const,
        id: `operation:v2:${intent.type}:${intent.operationId}`,
        generation: 1,
        position: 1,
      },
      observedAt: this.now(),
    };
    let event: TaskIntent;
    switch (intent.type) {
      case "launch":
        event = {
          ...base,
          type: "task_launch_requested",
          operationId: intent.operationId,
          launch: {
            operationId: intent.operationId,
            bootstrapId: `boot_${createHash("sha256").update(intent.operationId).digest("hex").slice(0, 32)}`,
            requestedAt: base.observedAt,
            outcome: intent.outcome,
            executionMode: intent.executionMode,
            ...(intent.browserIdentity
              ? { browserIdentity: intent.browserIdentity }
              : {}),
            approvalsReviewer: intent.approvalsReviewer,
            cwd: launchWorkspace ?? intent.cwd,
            ...(intent.model ? { model: intent.model } : {}),
            ...(intent.reasoningEffort
              ? { reasoningEffort: intent.reasoningEffort }
              : {}),
            attachmentIds: [...intent.attachmentIds],
            ...(intent.workflowContext
              ? { workflowContext: structuredClone(intent.workflowContext) }
              : {}),
            ...(intent.workflowAssociation
              ? {
                  workflowAssociation: structuredClone(
                    intent.workflowAssociation,
                  ),
                }
              : {}),
          },
        };
        break;
      case "message":
        event = {
          ...base,
          type: "task_message_requested",
          operationId: intent.operationId,
          message: intent.message,
          ...(intent.expectedTurnId
            ? { expectedTurnId: intent.expectedTurnId }
            : {}),
          ...(intent.attachmentIds?.length
            ? { attachmentIds: [...intent.attachmentIds] }
            : {}),
          ...(intent.workflowContext
            ? { workflowContext: structuredClone(intent.workflowContext) }
            : {}),
          ...(intent.selectedResultContext
            ? {
                selectedResultContext: structuredClone(
                  intent.selectedResultContext,
                ),
              }
            : {}),
        };
        break;
      case "interrupt":
        event = {
          ...base,
          type: "task_interrupt_requested",
          operationId: intent.operationId,
        };
        break;
      case "finish":
        event = {
          ...base,
          type: "task_finish_requested",
          operationId: intent.operationId,
        };
        break;
      case "retry_cleanup":
        event = {
          ...base,
          type: "task_cleanup_retry_requested",
          operationId: intent.operationId,
        };
        break;
      case "return_control":
        event = {
          ...base,
          type: "task_return_requested",
          operationId: intent.operationId,
        };
        break;
      case "attention_response":
        event = {
          ...base,
          type: "attention_response_requested",
          operationId: intent.operationId,
          requestId: intent.requestId,
          generation: intent.generation,
          response: intent.response,
        };
        break;
      case "explicit_continuation_response":
        event = {
          ...base,
          type: "explicit_continuation_response_requested",
          operationId: intent.operationId,
          message: intent.message,
          ...(intent.attachmentIds?.length
            ? { attachmentIds: [...intent.attachmentIds] }
            : {}),
          ...(intent.workflowContext
            ? { workflowContext: structuredClone(intent.workflowContext) }
            : {}),
          ...(intent.selectedResultContext
            ? {
                selectedResultContext: structuredClone(
                  intent.selectedResultContext,
                ),
              }
            : {}),
        };
        break;
    }
    await this.options.onCut?.("before_event_commit", intent);
    const accepted = await this.engine.accept(event);
    await this.options.onCut?.("after_commit_before_claim", intent);
    if (
      intent.type === "launch" &&
      accepted.projection.operationDisposition?.status !== "rejected" &&
      this.options.store.taskHistoryArchived?.(taskId) === undefined
    )
      this.options.store.initializeTaskHistoryPreference?.(taskId);
    if (
      accepted.command === null &&
      !accepted.duplicate &&
      (intent.type === "finish" ||
        intent.type === "retry_cleanup" ||
        intent.type === "return_control")
    )
      this.options.worker.cancelTask(intent.taskId);
    this.options.worker.signal();
    this.revision += 1;
    for (const listener of this.listeners) listener(this.revision);
    await this.options.onPublished?.();
    return accepted;
  }

  async publish(): Promise<void> {
    this.revision += 1;
    for (const listener of this.listeners) listener(this.revision);
    await this.options.onPublished?.();
  }

  async productTasks(): Promise<ProductTaskSnapshot[]> {
    const projections = await this.options.store.projections();
    return Promise.all(
      projections.map(async (projection) => {
        const aggregate = await this.options.store.aggregate(projection.taskId);
        if (!aggregate?.launch)
          throw new Error("Task projection lacks frozen launch configuration.");
        const record = aggregate.record;
        const archived =
          this.options.store.taskHistoryArchived?.(aggregate.taskId) ?? false;
        const lifecyclePhase =
          projection.phase === "closed"
            ? "ready"
            : projection.phase === "failed"
              ? "recovering"
              : projection.phase;
        const executionActions = projection.allowedActions.filter(
          (action) => !["finish", "archive", "resume"].includes(action),
        );
        const organizationActions = archived
          ? (["resume"] as const)
          : aggregate.codex.turn === "active"
            ? ([] as const)
            : (["archive"] as const);
        const initialDelivery =
          aggregate.messageDeliveries[aggregate.launch.operationId];
        return {
          context: {
            roveTaskId: aggregate.taskId,
            executionMode: aggregate.launch.executionMode,
            ...(aggregate.launch.browserIdentity
              ? { browserIdentity: aggregate.launch.browserIdentity }
              : {}),
            selectionSource: "user_selected",
            selectedAt: aggregate.launch.requestedAt,
            policy: {
              cwd: aggregate.launch.cwd,
              approvalPolicy: "on-request",
              approvalsReviewer: aggregate.launch.approvalsReviewer,
              sandbox: "workspace-write",
              ...(aggregate.launch.model
                ? { model: aggregate.launch.model }
                : {}),
              ...(aggregate.launch.reasoningEffort
                ? { reasoningEffort: aggregate.launch.reasoningEffort }
                : {}),
            },
            bootstrap: {
              attemptId: aggregate.launch.bootstrapId,
              threadSource: `rove:${aggregate.taskId}:${aggregate.launch.bootstrapId}`,
              stage: record?.bootstrap.stage ?? "intent_persisted",
            },
            ...(record?.identity.sessionId
              ? { roveSessionId: record.identity.sessionId }
              : {}),
            ...(record?.identity.threadId
              ? { codexThreadId: record.identity.threadId }
              : {}),
            lifecycle: {
              schemaVersion: 1,
              desiredState: aggregate.desiredState,
              ...(record?.closeOperation
                ? { closeOperation: record.closeOperation }
                : {}),
            },
            attachmentIds: [...aggregate.launch.attachmentIds],
            ...(aggregate.launch.workflowContext
              ? {
                  workflowContext: structuredClone(
                    aggregate.launch.workflowContext,
                  ),
                }
              : {}),
            ...(aggregate.launch.workflowAssociation
              ? {
                  workflowAssociation: structuredClone(
                    aggregate.launch.workflowAssociation,
                  ),
                }
              : {}),
            initialLaunch: {
              operationId: aggregate.launch.operationId,
              inputDigest: createHash("sha256")
                .update(JSON.stringify(aggregate.launch))
                .digest("hex"),
              stage:
                record?.bootstrap.stage === "complete"
                  ? "turn_started"
                  : "intent_persisted",
              requestedAt: aggregate.launch.requestedAt,
              outcome: aggregate.launch.outcome,
              ...(initialDelivery?.turnId
                ? { turnId: initialDelivery.turnId }
                : {}),
            },
          },
          lifecycle: {
            phase: lifecyclePhase,
            reason:
              projection.recoveryRequired ??
              productLifecycleReason(
                lifecyclePhase,
                aggregate.codex.turn,
                projection.operationDisposition.reason,
              ),
          },
          availableActions: [
            ...executionActions,
            ...organizationActions,
            ...(aggregate.runtime.legacyEffects === "acknowledgement_required"
              ? (["acknowledge_legacy_effects"] as const)
              : []),
          ],
          runtime: {
            status: aggregate.runtime.status,
            controller: aggregate.runtime.controller,
            attachment: aggregate.runtime.attachment,
            recovery: aggregate.runtime.recovery,
            profileOwnership: aggregate.runtime.profileLock,
            ...(aggregate.runtime.legacyEffects === undefined
              ? {}
              : { legacyEffects: aggregate.runtime.legacyEffects }),
          },
          conversation: {
            roveTaskId: aggregate.taskId,
            ...(record?.identity.threadId
              ? { codexThreadId: record.identity.threadId }
              : {}),
            ...(aggregate.codexSessionId
              ? { codexSessionId: aggregate.codexSessionId }
              : {}),
            ...(record?.identity.sessionId
              ? { roveSessionId: record.identity.sessionId }
              : {}),
            ...(aggregate.codex.turnId
              ? { activeTurnId: aggregate.codex.turnId }
              : {}),
            turnStatus:
              aggregate.codex.turn === "active"
                ? "in_progress"
                : aggregate.codex.turn === "completed"
                  ? "completed"
                  : aggregate.codex.turn === "interrupted"
                    ? "interrupted"
                    : aggregate.codex.turn === "failed"
                      ? "failed"
                      : "unknown",
            archived,
            lastEventSequence: aggregate.revision,
            items: structuredClone(aggregate.conversation.items),
            turnOrder: [...aggregate.conversation.turnOrder],
          },
        } as ProductTaskSnapshot;
      }),
    );
  }

  async readTask(taskId: string): Promise<ProductTaskSnapshot | null> {
    return (
      (await this.productTasks()).find(
        (task) => task.context.roveTaskId === taskId,
      ) ?? null
    );
  }

  subscribe(
    fromRevision: number,
    listener: (revision: number) => void,
  ): () => void {
    if (fromRevision < this.revision)
      queueMicrotask(() => listener(this.revision));
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async taskIdForRuntimeSession(sessionId: string): Promise<string> {
    for (const projection of await this.options.store.projections()) {
      const aggregate = await this.options.store.aggregate(projection.taskId);
      if (aggregate?.record?.identity.sessionId === sessionId)
        return projection.taskId;
    }
    throw new Error("Runtime session is not bound to a task.");
  }
}

function taskIdForOperation(operationId: string): string {
  const uuid = operationId.replace(/^intent_/, "");
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      uuid,
    )
  )
    throw new Error("Launch operation identity is invalid.");
  return `task_${uuid}`;
}
