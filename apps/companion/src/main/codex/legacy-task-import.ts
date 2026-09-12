import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  MemoryTaskStore,
  TaskProcessManager,
  validateTaskProcessDurableData,
  type NativeLifecycleInput,
  type TaskProcessDecision,
} from "@rove/protocol";

import type { SqliteTaskStore } from "./sqlite-task-store.js";
import { prepareTaskContextState } from "./task-coordinator.js";
import { prepareContinuationState } from "./continuations.js";
import { prepareConversationState } from "./conversations.js";
import { validateAttentionState } from "./attention.js";

const LIFECYCLE_FILES = [
  "codex-conversations.v2.json",
  "codex-continuations.v2.json",
  "codex-task-contexts.v2.json",
  "codex-attention.v1.json",
] as const;

interface ValidatedLegacySource {
  name: string;
  path: string;
  bytes: string;
  schemaVersion: number;
  revision: number;
  payload: unknown;
}

async function convertLegacySources(
  sources: readonly ValidatedLegacySource[],
  observedAt: string,
): Promise<TaskProcessDecision[]> {
  const byName = new Map(
    sources.map((source) => [source.name, source.payload]),
  );
  if (byName.has("codex-conversations.v2.json"))
    prepareConversationState(byName.get("codex-conversations.v2.json"));
  const contexts = byName.has("codex-task-contexts.v2.json")
    ? prepareTaskContextState(byName.get("codex-task-contexts.v2.json"))
        .contexts
    : {};
  const continuations = byName.has("codex-continuations.v2.json")
    ? prepareContinuationState(byName.get("codex-continuations.v2.json"))
    : { records: {}, returnEventFingerprints: {} };
  const attentionState = byName.has("codex-attention.v1.json")
    ? validateAttentionState(byName.get("codex-attention.v1.json"))
    : { sequence: 0, entries: [] };
  const orphanContinuations = Object.values(continuations.records).filter(
    (record) => contexts[record.roveTaskId] === undefined,
  );
  const orphanAttentions = attentionState.entries.filter(
    (entry) => contexts[entry.taskId] === undefined,
  );
  if (orphanContinuations.length || orphanAttentions.length)
    throw new Error("Legacy lifecycle state contains an orphan task binding.");
  const memory = new MemoryTaskStore();
  const manager = new TaskProcessManager(memory);
  const decisions: TaskProcessDecision[] = [];
  for (const context of Object.values(contexts)) {
    const continuation = Object.values(continuations.records).find(
      (entry) =>
        entry.roveTaskId === context.roveTaskId && entry.status === "pending",
    );
    const taskAttentions = attentionState.entries.filter(
      (entry) => entry.taskId === context.roveTaskId,
    );
    const sessionId = context.roveSessionId;
    const threadId = context.codexThreadId;
    if (continuation && (!sessionId || !threadId))
      throw new Error("Legacy continuation lacks complete task bindings.");
    const bootstrapStage = [
      "attachments_binding",
      "attachments_bound",
      "mcp_verified",
      "rollback_pending",
      "rollback_evidence_settled",
      "rollback_runtime_settled",
      "rollback_attachments_settled",
    ].includes(context.bootstrap.stage)
      ? "runtime_bound"
      : context.bootstrap.stage;
    const lifecycle: NativeLifecycleInput = {
      record: {
        schemaVersion: 1,
        identity: {
          taskId: context.roveTaskId,
          ...(sessionId ? { sessionId } : {}),
          ...(threadId ? { threadId } : {}),
          browser: context.browserIdentity,
        },
        bootstrap: {
          operationId: context.bootstrap.attemptId,
          threadSource: context.bootstrap.threadSource,
          stage: bootstrapStage as NonNullable<
            NativeLifecycleInput["record"]
          >["bootstrap"]["stage"],
        },
        desiredState: context.lifecycle?.desiredState ?? "open",
        ...(context.lifecycle?.closeOperation
          ? {
              closeOperation: {
                ...context.lifecycle.closeOperation,
                stage:
                  context.lifecycle.closeOperation.stage ===
                  "attachments_settled"
                    ? "runtime_settled"
                    : context.lifecycle.closeOperation.stage,
              },
            }
          : {}),
      },
      codex: threadId
        ? {
            availability: "available",
            threadExists: true,
            threadId,
            threadSource: context.bootstrap.threadSource,
            sourceLookup: "exact",
            runtimeStatus: "notLoaded",
            archived: false,
            turn: "unknown",
          }
        : {
            availability: "available",
            threadExists: false,
            sourceLookup: "none",
            runtimeStatus: "notLoaded",
            archived: null,
            turn: "none",
          },
      runtime: sessionId
        ? {
            availability: "available",
            sessionExists: true,
            sessionId,
            bootstrapId: context.bootstrap.attemptId,
            bootstrapLookup: "exact",
            status: "active",
            controller: continuation ? "human" : "agent",
            attachment: "attached",
            profileLock:
              context.browserIdentity.mode === "temporary"
                ? "released"
                : "owned",
            browserIdentity: context.browserIdentity,
            recovery: "not_needed",
            ...(continuation
              ? { ownershipGeneration: continuation.handoffGeneration + 1 }
              : {}),
            ...(continuation?.handoffId
              ? {
                  handoffId: continuation.handoffId,
                  handoffGeneration: continuation.handoffGeneration,
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
          },
      continuation:
        continuation && sessionId && threadId
          ? {
              status: continuation.status,
              id: `continuation:${context.roveTaskId}:${continuation.handoffGeneration}`,
              taskId: context.roveTaskId,
              sessionId,
              threadId,
              ...(continuation.handoffId
                ? { handoffId: continuation.handoffId }
                : {}),
              generation: continuation.handoffGeneration,
              policy: continuation.continuationPolicy,
              freshInspectionRequired: continuation.freshInspectionRequired,
              preHandoffObservationSeq:
                continuation.preHandoffObservationSeq ?? 0,
              ...(continuation.returnEventId
                ? { returnEventId: continuation.returnEventId }
                : {}),
              ...(continuation.returnObservationSeq === undefined
                ? {}
                : { returnObservationSeq: continuation.returnObservationSeq }),
              ...(continuation.continuationCommand
                ? {
                    command: {
                      commandId: continuation.continuationCommand.commandId,
                      returnEventId:
                        continuation.continuationCommand.returnEventId,
                      kind: continuation.continuationCommand.kind,
                      dispatchStatus:
                        continuation.continuationCommand.dispatchStatus,
                    },
                  }
                : {}),
            }
          : { status: "none" },
      attentions: taskAttentions
        .filter((entry) => entry.threadId)
        .map((entry) => ({
          authority: entry.authority,
          kind: entry.kind,
          requestId: entry.requestId,
          taskId: entry.taskId,
          ...(entry.authority === "rove_control" &&
          sessionId &&
          continuation?.handoffId
            ? { sessionId, handoffId: continuation.handoffId }
            : {}),
          threadId: entry.threadId!,
          ...(entry.turnId ? { turnId: entry.turnId } : {}),
          generation: entry.generation,
          status: entry.status,
        })),
      freshInspection: continuation?.freshInspection ?? null,
      requestedOperation: { type: "observe", taskId: context.roveTaskId },
    };
    decisions.push(
      await manager.accept({
        schemaVersion: 1,
        inputId: `legacy-import:${context.roveTaskId}`,
        taskId: context.roveTaskId,
        kind: "fact",
        source: "legacy-lifecycle-import",
        sourceId: `legacy:${context.roveTaskId}`,
        observedAt,
        lifecycle,
        launchConfiguration: {
          ...context,
          roveTaskId: context.roveTaskId,
        },
        durableData: validateTaskProcessDurableData(
          {
            schemaVersion: 1,
            continuation: continuation
              ? { schemaVersion: 1, ...continuation }
              : null,
            attentions: taskAttentions.map((entry) => ({
              schemaVersion: 1,
              ...entry,
            })),
            codexSessionId: context.codexSessionId ?? null,
          },
          {
            taskId: context.roveTaskId,
            ...(sessionId ? { sessionId } : {}),
            ...(threadId ? { threadId } : {}),
          },
        ),
      }),
    );
  }
  return decisions;
}

function validateEnvelope(name: string, bytes: string): ValidatedLegacySource {
  const parsed = JSON.parse(bytes) as unknown;
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).some(
      (key) => !["schemaVersion", "revision", "value"].includes(key),
    ) ||
    !Number.isInteger((parsed as Record<string, unknown>).schemaVersion) ||
    !Number.isInteger((parsed as Record<string, unknown>).revision) ||
    Number((parsed as Record<string, unknown>).revision) < 0 ||
    !("value" in parsed)
  )
    throw new Error(`Legacy state ${name} has an invalid envelope.`);
  const record = parsed as {
    schemaVersion: number;
    revision: number;
    value: unknown;
  };
  return {
    name,
    path: "",
    bytes,
    schemaVersion: record.schemaVersion,
    revision: record.revision,
    payload: record.value,
  };
}

export async function importLegacyTaskState(options: {
  stateDirectory: string;
  store: SqliteTaskStore;
  now?: () => Date;
}): Promise<{ imported: boolean; digest?: string; backupPath?: string }> {
  if (options.store.hasCompletedLegacyImport()) return { imported: false };
  const sources: ValidatedLegacySource[] = [];
  for (const name of LIFECYCLE_FILES) {
    const path = join(options.stateDirectory, name);
    try {
      const bytes = await readFile(path, "utf8");
      sources.push({ ...validateEnvelope(name, bytes), path });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  if (sources.length === 0) return { imported: false };
  const digest = createHash("sha256")
    .update(
      sources
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((source) => `${source.name}\0${source.bytes}`)
        .join("\0"),
    )
    .digest("hex");
  if (options.store.hasLegacyImport(digest)) return { imported: false, digest };

  const at = (options.now ?? (() => new Date()))();
  const decisions = await convertLegacySources(sources, at.toISOString());
  const timestamp = at.toISOString().replaceAll(":", "-");
  const backupPath = join(
    options.stateDirectory,
    "task-process-backups",
    timestamp,
  );
  await mkdir(backupPath, { recursive: true, mode: 0o700 });
  for (const source of sources) {
    const destination = join(backupPath, basename(source.path));
    await copyFile(source.path, destination);
    await chmod(destination, 0o400);
  }
  options.store.recordLegacyImport({
    importId: `legacy_${randomUUID()}`,
    digest,
    backupPath,
    importedAt: at.toISOString(),
    sources: sources.map((source) => ({
      name: source.name,
      schemaVersion: source.schemaVersion,
      revision: source.revision,
      payload: source.payload,
    })),
    decisions,
  });
  return { imported: true, digest, backupPath };
}
