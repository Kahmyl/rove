import { createHash } from "node:crypto";

import type {
  NativeCodexTruth,
  NativeRuntimeTruth,
  TaskAggregate,
  TaskCommand,
  TaskEngineStore,
  TaskLaunchConfiguration,
  TaskObservedFact,
  TaskSelectedResultContextSnapshot,
} from "@rove/protocol";
import {
  canonicalRoveToolDefinitionsJsonWire,
  ROVE_TOOL_CATALOG,
  ROVE_TOOL_DEFINITIONS_SHA256,
} from "@rove/protocol";

import { browserRouteDeveloperInstructions } from "./browser-route-policy.js";
import type { RoveMcpLaunch, TaskRuntimePort } from "./task-coordinator.js";
import type {
  AttachmentRuntimeMaterializer,
  TaskAttachmentAuthority,
} from "./task-attachments.js";
import type { PersistedTaskCapabilityIssuer } from "./task-launch-boundary.js";
import type { CodexRpcPort, CodexThread } from "./protocol.js";
import { APPROVED_CODEX_CLI_VERSION } from "./compatibility.js";
import type { UserInput } from "./protocol.js";
import {
  CodexThreadCompatibilityError,
  CodexThreadSessionSupervisor,
  type CodexMessageDeliveryEvidence,
} from "./codex-thread-session-supervisor.js";
import {
  ExactTaskCommandAdapter,
  type ExactTaskCommandHandler,
  type ExactTaskCommandHandlers,
} from "./exact-task-command-adapter.js";
import {
  isPinnedEmptyTurnHistoryFailure,
  isPinnedThreadMissingFailure,
  isPinnedThreadNotLoadedFailure,
} from "./history-compatibility.js";
import type { TaskCommandResult } from "./task-engine-worker.js";

interface RuntimeInventoryLike {
  session: {
    id: string;
    bootstrapId?: string;
    status: NativeRuntimeTruth["status"];
    controller: NativeRuntimeTruth["controller"];
    workspace?: { id: string };
    ownershipGeneration?: number;
    activeHandoffId?: string;
    activeHandoffGeneration?: number;
    lastReturnedHandoffId?: string;
  };
  browserIdentity?: NativeRuntimeTruth["browserIdentity"];
  attachment?: NativeRuntimeTruth["attachment"];
  recovery?: NativeRuntimeTruth["recovery"];
  profileOwnership?: NativeRuntimeTruth["profileLock"];
  legacyEffects?: NativeRuntimeTruth["legacyEffects"];
  ownershipGeneration?: number;
  handoffId?: string;
  handoffGeneration?: number;
  lastReturnedHandoffId?: string;
  observationSeq?: number;
}

type FactPayload<T = TaskObservedFact> = T extends TaskObservedFact
  ? Omit<T, "schemaVersion" | "eventId" | "taskId" | "source" | "observedAt">
  : never;
type BoundAggregate = TaskAggregate & { launch: TaskLaunchConfiguration };

export interface CodexRuntimeTaskAdapterOptions {
  rpc: CodexRpcPort;
  sessionSupervisor?: CodexThreadSessionSupervisor;
  runtime: TaskRuntimePort;
  store: TaskEngineStore;
  mcpLaunch: RoveMcpLaunch;
  capabilityIssuer: PersistedTaskCapabilityIssuer;
  expectedToolDefinitionDigest?: string;
  attachments?: {
    authority: TaskAttachmentAuthority;
    runtime: AttachmentRuntimeMaterializer;
  };
  now?: () => string;
}

export class CodexRuntimeTaskAdapter extends ExactTaskCommandAdapter {
  constructor(options: CodexRuntimeTaskAdapterOptions) {
    const now = options.now ?? (() => new Date().toISOString());
    const session =
      options.sessionSupervisor ??
      new CodexThreadSessionSupervisor(options.rpc, now);
    const facts = (
      command: TaskCommand,
      values: readonly FactPayload[],
    ): TaskObservedFact[] =>
      values.map(
        (value, index) =>
          ({
            ...value,
            schemaVersion: 1,
            eventId: `adapter:${command.commandId}:${command.attempts}:${index}`,
            taskId: command.taskId,
            source: {
              kind: value.type.startsWith("codex_") ? "codex" : "runtime",
              id: `command:${command.commandId}:attempt:${command.attempts}`,
              generation: 1,
              position: index + 1,
            },
            observedAt: now(),
          }) as TaskObservedFact,
      );
    const success = (
      command: TaskCommand,
      values: Parameters<typeof facts>[1] = [],
    ): TaskCommandResult => ({
      status: "succeeded",
      facts: facts(command, values),
    });
    const readAggregate = async (command: TaskCommand) => {
      const aggregate = await options.store.aggregate(command.taskId);
      if (!aggregate?.launch)
        throw new Error(
          "Command lacks its durable aggregate and launch configuration.",
        );
      return aggregate as BoundAggregate;
    };
    const listThreads = () => session.listAll();
    const codexTruth = (
      thread: CodexThread | undefined,
      source?: string,
      archived = false,
    ): NativeCodexTruth => {
      if (!thread)
        return {
          availability: "available",
          threadExists: false,
          sourceLookup: "none",
          runtimeStatus: "notLoaded",
          archived: null,
          turn: "none",
        };
      const active = thread.turns.find((turn) => turn.status === "inProgress");
      const last = active ?? thread.turns.at(-1);
      const turn = !last
        ? "none"
        : last.status === "inProgress"
          ? "active"
          : last.status === "completed"
            ? "completed"
            : last.status === "failed"
              ? "failed"
              : last.status === "interrupted"
                ? "interrupted"
                : "unknown";
      return {
        availability: "available",
        threadExists: true,
        threadId: thread.id,
        ...(source ? { threadSource: source } : {}),
        sourceLookup: "exact",
        runtimeStatus: turn === "active" ? "active" : "idle",
        archived,
        turn,
        ...(active ? { turnId: active.id } : {}),
      };
    };
    const runtimeTruth = (
      entry: RuntimeInventoryLike | undefined,
      bootstrapId?: string,
    ): NativeRuntimeTruth => {
      if (!entry)
        return {
          availability: "available",
          sessionExists: false,
          bootstrapLookup: "none",
          status: "missing",
          controller: null,
          attachment: "missing",
          profileLock: "released",
          recovery: "cleanup_required",
        };
      const resolvedBootstrapId = entry.session.bootstrapId ?? bootstrapId;
      return {
        availability: "available",
        sessionExists: true,
        sessionId: entry.session.id,
        ...(resolvedBootstrapId ? { bootstrapId: resolvedBootstrapId } : {}),
        bootstrapLookup: "exact",
        status: entry.session.status,
        controller: entry.session.controller,
        attachment: entry.attachment ?? "attached",
        profileLock: entry.profileOwnership ?? "owned",
        browserIdentity:
          entry.browserIdentity ??
          (entry.session.workspace
            ? { mode: "workspace", workspaceId: entry.session.workspace.id }
            : { mode: "temporary" }),
        recovery: entry.recovery ?? "not_needed",
        ...(entry.legacyEffects === undefined
          ? {}
          : { legacyEffects: entry.legacyEffects }),
        ...(entry.ownershipGeneration === undefined
          ? {}
          : { ownershipGeneration: entry.ownershipGeneration }),
        ...(entry.handoffId === undefined
          ? {}
          : { handoffId: entry.handoffId }),
        ...(entry.handoffGeneration === undefined
          ? {}
          : { handoffGeneration: entry.handoffGeneration }),
        ...(entry.lastReturnedHandoffId === undefined
          ? {}
          : { lastReturnedHandoffId: entry.lastReturnedHandoffId }),
        ...(entry.observationSeq === undefined
          ? {}
          : { observationSeq: entry.observationSeq }),
      };
    };
    const runtimeInventory = async (
      command: TaskCommand,
    ): Promise<RuntimeInventoryLike[]> => {
      const aggregate = await readAggregate(command);
      if (options.runtime.listSessionInventory) {
        let inventory;
        try {
          inventory = await options.runtime.listSessionInventory();
        } catch (error) {
          throw new Error(
            `Runtime inventory read failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const matches = inventory.filter((entry) =>
          aggregate.record?.identity.sessionId
            ? entry.session.id === aggregate.record.identity.sessionId
            : entry.session.bootstrapId === aggregate.launch!.bootstrapId,
        ) as RuntimeInventoryLike[];
        return Promise.all(
          matches.map(async (entry) => {
            const terminal = ["completed", "failed"].includes(
              entry.session.status,
            );
            const controlReadable = !terminal;
            let control;
            try {
              control =
                controlReadable && options.runtime.getControlStatus
                  ? await options.runtime.getControlStatus(entry.session.id)
                  : undefined;
            } catch (error) {
              throw new Error(
                `Runtime control-status read failed for ${entry.session.status} session ${entry.session.id}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
            const ownershipGeneration = terminal
              ? undefined
              : (control?.generation ??
                entry.ownershipGeneration ??
                entry.session.ownershipGeneration);
            const handoffId = terminal
              ? undefined
              : (control?.activeHandoffId ??
                entry.handoffId ??
                entry.session.activeHandoffId);
            const handoffGeneration = terminal
              ? undefined
              : (control?.activeHandoffGeneration ??
                entry.handoffGeneration ??
                entry.session.activeHandoffGeneration);
            const lastReturnedHandoffId = terminal
              ? undefined
              : (control?.lastReturnedHandoffId ??
                entry.lastReturnedHandoffId ??
                entry.session.lastReturnedHandoffId);
            const observationSeq = terminal
              ? undefined
              : (control?.observationSeq ?? entry.observationSeq);
            return {
              ...entry,
              session: {
                ...entry.session,
                status: control?.status ?? entry.session.status,
                controller: control?.controller ?? entry.session.controller,
              },
              ...(ownershipGeneration === undefined
                ? {}
                : { ownershipGeneration }),
              ...(handoffId === undefined ? {} : { handoffId }),
              ...(handoffGeneration === undefined ? {} : { handoffGeneration }),
              ...(lastReturnedHandoffId === undefined
                ? {}
                : { lastReturnedHandoffId }),
              ...(observationSeq === undefined ? {} : { observationSeq }),
            };
          }),
        );
      }
      if (aggregate.record?.identity.sessionId && options.runtime.getSession) {
        const session = await options.runtime.getSession(
          aggregate.record.identity.sessionId,
        );
        return [
          {
            session,
            attachment: "attached",
            recovery: "not_needed",
            profileOwnership: session.workspace ? "owned" : "released",
          },
        ] as RuntimeInventoryLike[];
      }
      return [];
    };
    const observeRuntime = async (
      command: TaskCommand,
    ): Promise<TaskCommandResult> => {
      const aggregate = await readAggregate(command);
      const matches = await runtimeInventory(command);
      if (matches.length > 1)
        throw new Error("Runtime lookup returned conflicting identities.");
      return success(command, [
        {
          type: "runtime_inventory_observed",
          runtime: runtimeTruth(matches[0], aggregate.launch.bootstrapId),
        },
      ]);
    };
    const observeCodex = async (
      command: TaskCommand,
    ): Promise<TaskCommandResult> => {
      const aggregate = await readAggregate(command);
      const threadId = aggregate.record?.identity.threadId;
      const threadSource = `rove:${aggregate.taskId}:${aggregate.launch.bootstrapId}`;
      let thread: CodexThread | undefined;
      if (threadId) {
        try {
          thread = await session.read(threadId, true);
        } catch (error) {
          if (!isPinnedThreadMissingFailure(error, threadId)) throw error;
          const matches = (await listThreads()).filter(
            (entry) =>
              entry.thread.id === threadId ||
              entry.thread.threadSource === threadSource,
          );
          if (matches.length !== 0)
            throw new Error("Missing Codex thread has conflicting list truth.");
        }
      } else
        thread = (await listThreads()).find(
          (item) => item.thread.threadSource === threadSource,
        )?.thread;
      const archived = thread
        ? ((await listThreads()).find((item) => item.thread.id === thread.id)
            ?.archived ?? false)
        : false;
      return success(command, [
        {
          type: "codex_thread_observed",
          thread: codexTruth(thread, threadSource, archived),
          ...(thread ? { codexSessionId: thread.sessionId } : {}),
        },
      ]);
    };
    const pure: ExactTaskCommandHandler = {
      execute: async (command) => success(command),
      reconcile: async (command) => success(command),
    };
    const runtimeClose = async (
      command: TaskCommand,
    ): Promise<TaskCommandResult> => {
      const aggregate = await readAggregate(command);
      const sessionId = aggregate.record?.identity.sessionId;
      if (!sessionId) throw new Error("Runtime close lacks a session binding.");
      await options.attachments?.authority.cleanupRuntimeGrants(
        aggregate.taskId,
        sessionId,
        options.attachments.runtime,
      );
      const matches = await runtimeInventory(command);
      if (matches.length > 1)
        throw new Error("Runtime close recovery is conflicting.");
      if (
        matches[0] &&
        !["completed", "failed"].includes(matches[0].session.status)
      )
        await options.runtime.endSession(sessionId);
      await options.attachments?.authority.cleanupTask(aggregate.taskId);
      const observed = await observeRuntime(command);
      return {
        ...observed,
        facts: [
          ...observed.facts,
          ...facts(command, [
            {
              type: "attachment_state_observed",
              ready: false,
              attachmentIds: [],
            },
          ]),
        ],
      };
    };
    const returnedOwnership = (
      result: TaskCommandResult,
      handoffId: string,
    ): boolean =>
      result.facts.some(
        (fact) =>
          fact.type === "runtime_inventory_observed" &&
          fact.runtime.controller === "agent" &&
          fact.runtime.lastReturnedHandoffId === handoffId,
      );
    const returnRuntimeOwnership = async (
      command: TaskCommand,
    ): Promise<TaskCommandResult> => {
      const aggregate = await readAggregate(command);
      const sessionId = aggregate.record?.identity.sessionId;
      const handoffId = command.payload.handoffId;
      const generation = command.payload.generation;
      if (
        !sessionId ||
        typeof handoffId !== "string" ||
        typeof generation !== "number" ||
        !options.runtime.returnControlForSession
      )
        throw new Error("Return Control lacks exact durable identities.");
      let observed = await observeRuntime(command);
      if (returnedOwnership(observed, handoffId)) return observed;
      const pending = observed.facts.some(
        (fact) =>
          fact.type === "runtime_inventory_observed" &&
          fact.runtime.controller === "human" &&
          fact.runtime.handoffId === handoffId &&
          fact.runtime.handoffGeneration === generation,
      );
      if (!pending)
        return {
          status: "unresolved",
          facts: observed.facts,
          detail: { reason: "Exact Runtime handoff outcome is unresolved." },
        };
      await options.runtime.returnControlForSession(sessionId);
      observed = await observeRuntime(command);
      return returnedOwnership(observed, handoffId)
        ? observed
        : {
            status: "unresolved",
            facts: observed.facts,
            detail: {
              reason: "Runtime did not confirm the exact ownership return.",
            },
          };
    };
    const respondCodexAttention = async (
      command: TaskCommand,
    ): Promise<TaskCommandResult> => {
      const requestId = command.payload.requestId;
      const generation = command.payload.generation;
      if (typeof requestId !== "string" || typeof generation !== "number")
        throw new Error("Attention response lacks exact durable identities.");
      const aggregate = await readAggregate(command);
      const attention = aggregate.attentions.find(
        (entry) =>
          entry.requestId === requestId && entry.generation === generation,
      );
      if (
        attention &&
        ["resolved", "cancelled", "stale"].includes(attention.status)
      )
        return success(command);
      if (!attention || attention.generation !== session.connectionGeneration())
        return {
          status: "unresolved",
          facts: [],
          detail: {
            reason: "Attention is not live on the current connection.",
          },
        };
      const wireRequestId = attention.wireRequestId;
      if (
        (typeof wireRequestId !== "string" &&
          typeof wireRequestId !== "number") ||
        !attention.method
      )
        return {
          status: "unresolved",
          facts: [],
          detail: {
            reason:
              "Attention lacks a complete response descriptor for the current connection.",
          },
        };
      try {
        await options.rpc.respond(requestId, command.payload.response);
      } catch (error) {
        return {
          status: "unresolved",
          facts: [],
          detail: {
            reason:
              `Exact Codex attention response is unresolved: ${error instanceof Error ? error.message : String(error)}`.slice(
                0,
                240,
              ),
          },
        };
      }
      return observeCodex(command);
    };
    const setCodexArchive = async (
      command: TaskCommand,
      archived: boolean,
    ): Promise<TaskCommandResult> => {
      const aggregate = await readAggregate(command);
      const threadId = aggregate.record?.identity.threadId;
      if (!threadId) throw new Error("Archive change lacks a thread binding.");
      const absentArchiveTruth = async (
        error: unknown,
      ): Promise<TaskCommandResult | null> => {
        if (!archived || !isPinnedThreadMissingFailure(error, threadId))
          return null;
        const threadSource = aggregate.record?.bootstrap.threadSource;
        const matches = (await listThreads()).filter(
          (entry) =>
            entry.thread.id === threadId ||
            entry.thread.threadSource === threadSource,
        );
        if (matches.length !== 0)
          throw new Error(
            "Missing Codex archive target has conflicting truth.",
          );
        return success(command, [
          {
            type: "codex_thread_observed",
            thread: codexTruth(undefined),
          },
        ]);
      };
      let observed: TaskCommandResult;
      try {
        observed = await observeCodex(command);
      } catch (error) {
        if (archived && error instanceof CodexThreadCompatibilityError) {
          const before = (await listThreads()).find(
            (entry) => entry.thread.id === threadId,
          );
          if (!before)
            throw new Error(
              "Legacy Codex archive target is absent from authoritative lists.",
            );
          if (!before.archived) await session.setArchived(threadId, true);
          const after = (await listThreads()).find(
            (entry) => entry.thread.id === threadId,
          );
          if (!after?.archived)
            return {
              status: "unresolved",
              facts: [],
              detail: {
                reason: "Legacy Codex archive state was not confirmed.",
              },
            };
          observed = success(command, [
            {
              type: "codex_thread_observed",
              thread: codexTruth(after.thread, undefined, true),
              codexSessionId: after.thread.sessionId,
            },
          ]);
        } else if (isPinnedThreadNotLoadedFailure(error, threadId)) {
          try {
            await resumeBoundThread(options, session, aggregate, true);
            observed = await observeCodex(command);
          } catch (resumeError) {
            const absent = await absentArchiveTruth(resumeError);
            if (!absent) throw resumeError;
            observed = absent;
          }
        } else {
          const absent = await absentArchiveTruth(error);
          if (!absent) throw error;
          observed = absent;
        }
      }
      const hasState = (result: TaskCommandResult) =>
        result.facts.some(
          (fact) =>
            fact.type === "codex_thread_observed" &&
            (archived
              ? !fact.thread.threadExists ||
                (fact.thread.threadId === threadId &&
                  fact.thread.archived === true)
              : fact.thread.threadId === threadId &&
                fact.thread.archived === false),
        );
      if (hasState(observed)) return observed;
      if (!session.isAttached(threadId))
        await resumeBoundThread(options, session, aggregate, true);
      await session.setArchived(threadId, archived);
      observed = await observeCodex(command);
      return hasState(observed)
        ? observed
        : {
            status: "unresolved",
            facts: observed.facts,
            detail: { reason: "Codex archive state was not confirmed." },
          };
    };
    const continuationMessageHandler = messageHandler(
      options,
      session,
      readAggregate,
      observeCodex,
      facts,
    );
    const handlers: ExactTaskCommandHandlers = {
      persist_bootstrap_intent: pure,
      bind_runtime_identity: pure,
      bind_codex_identity: pure,
      advance_bootstrap_stage: pure,
      persist_close_intent: pure,
      settle_continuation_attention: pure,
      advance_close_stage: pure,
      record_return_event: pure,
      prepare_continuation_command: pure,
      persist_continuation_dispatch_intent: pure,
      lookup_or_start_runtime: {
        execute: async (command) => {
          const aggregate = await readAggregate(command);
          let matches = await runtimeInventory(command);
          if (matches.length === 0) {
            await options.runtime.startSession({
              bootstrapId: aggregate.launch.bootstrapId,
              mode: aggregate.launch.executionMode,
              browser: aggregate.launch.browserIdentity,
            });
            matches = await runtimeInventory(command);
          }
          if (matches.length !== 1)
            throw new Error("Runtime bootstrap lacks one correlated receipt.");
          return success(command, [
            {
              type: "runtime_inventory_observed",
              runtime: runtimeTruth(matches[0], aggregate.launch.bootstrapId),
            },
          ]);
        },
        reconcile: observeRuntime,
      },
      lookup_or_start_codex_thread: {
        execute: async (command) => {
          const aggregate = await readAggregate(command);
          const source = `rove:${aggregate.taskId}:${aggregate.launch.bootstrapId}`;
          const runtimeSessionId = aggregate.record?.identity.sessionId;
          if (aggregate.launch.attachmentIds.length > 0 && !options.attachments)
            throw new Error(
              "Selected task attachments cannot be materialized.",
            );
          if (runtimeSessionId)
            await options.attachments?.authority.bindDrafts(
              aggregate.launch.attachmentIds,
              aggregate.taskId,
              runtimeSessionId,
              options.attachments.runtime,
            );
          else
            await options.attachments?.authority.bindTaskInputs(
              aggregate.launch.attachmentIds,
              aggregate.taskId,
            );
          const capability = issueTaskCapability(options, aggregate);
          const launch = threadLaunchParams(
            options,
            aggregate,
            capability.token,
          );
          let matches = (await listThreads()).filter(
            (entry) => entry.thread.threadSource === source,
          );
          if (matches.length === 0) {
            const started = await session.start({
              ...launch,
              threadSource: source,
            });
            matches = [{ thread: started, archived: false }];
          }
          if (matches.length !== 1)
            throw new Error("Codex bootstrap lacks one correlated receipt.");
          await assertThreadMcp(options, matches[0]!.thread.id);
          return success(command, [
            {
              type: "task_capability_observed",
              fingerprint: capability.fingerprint,
            },
            {
              type: "attachment_state_observed",
              ready: true,
              attachmentIds: [...aggregate.launch.attachmentIds],
            },
            {
              type: "codex_thread_observed",
              thread: codexTruth(
                matches[0]!.thread,
                source,
                matches[0]!.archived,
              ),
              codexSessionId: matches[0]!.thread.sessionId,
            },
          ]);
        },
        reconcile: async (command) => {
          const aggregate = await readAggregate(command);
          const source = `rove:${aggregate.taskId}:${aggregate.launch.bootstrapId}`;
          const matches = (await listThreads()).filter(
            (entry) => entry.thread.threadSource === source,
          );
          if (matches.length === 0) return observeCodex(command);
          if (matches.length !== 1)
            throw new Error("Codex bootstrap recovery is conflicting.");
          const capability = issueTaskCapability(options, aggregate);
          const thread = matches[0]!.thread;
          if (!session.isAttached(thread.id)) {
            const resumed = await session.resume({
              threadId: thread.id,
              ...threadLaunchParams(options, aggregate, capability.token),
              excludeTurns: true,
            });
            if (resumed.id !== thread.id || resumed.status.type === "notLoaded")
              throw new Error(
                "Codex bootstrap recovery did not load the exact thread.",
              );
          }
          await assertThreadMcp(options, thread.id);
          return success(command, [
            {
              type: "task_capability_observed",
              fingerprint: capability.fingerprint,
            },
            {
              type: "attachment_state_observed",
              ready: true,
              attachmentIds: [...aggregate.launch.attachmentIds],
            },
            {
              type: "codex_thread_observed",
              thread: codexTruth(thread, source, matches[0]!.archived),
              codexSessionId: thread.sessionId,
            },
          ]);
        },
      },
      read_codex_thread: { execute: observeCodex, reconcile: observeCodex },
      read_runtime_inventory: {
        execute: observeRuntime,
        reconcile: observeRuntime,
      },
      read_lifecycle_truth: {
        execute: async (command) => {
          const [runtime, codex] = await Promise.all([
            observeRuntime(command),
            observeCodex(command),
          ]);
          return {
            status: "succeeded",
            facts: [...runtime.facts, ...codex.facts],
          };
        },
        reconcile: async (command) => {
          const [runtime, codex] = await Promise.all([
            observeRuntime(command),
            observeCodex(command),
          ]);
          return {
            status: "succeeded",
            facts: [...runtime.facts, ...codex.facts],
          };
        },
      },
      interrupt_codex_turn: {
        execute: async (command) => {
          const aggregate = await readAggregate(command);
          const threadId = aggregate.record?.identity.threadId;
          if (!threadId || typeof command.payload.turnId !== "string")
            throw new Error("Interrupt lacks exact identities.");
          await session.interrupt(threadId, command.payload.turnId);
          return observeCodex(command);
        },
        reconcile: observeCodex,
      },
      end_runtime_session: {
        execute: runtimeClose,
        reconcile: runtimeClose,
      },
      relaunch_named_browser: {
        execute: async (command) => {
          const aggregate = await readAggregate(command);
          const sessionId = aggregate.record?.identity.sessionId;
          if (!sessionId || !options.runtime.recoverSession)
            throw new Error("Named browser recovery is unavailable.");
          await options.runtime.recoverSession(sessionId);
          return observeRuntime(command);
        },
        reconcile: observeRuntime,
      },
      resume_codex_thread: threadResumeHandler(
        options,
        session,
        readAggregate,
        observeCodex,
      ),
      recover_codex_thread: threadResumeHandler(
        options,
        session,
        readAggregate,
        observeCodex,
      ),
      unarchive_codex_thread: {
        execute: (command) => setCodexArchive(command, false),
        reconcile: (command) => setCodexArchive(command, false),
      },
      inspect_after_return: {
        execute: async (command) => {
          const aggregate = await readAggregate(command);
          const sessionId = aggregate.record?.identity.sessionId;
          if (!sessionId || !options.runtime.inspect)
            throw new Error("Fresh Runtime inspection is unavailable.");
          await options.runtime.inspect(sessionId);
          return observeRuntime(command);
        },
        reconcile: observeRuntime,
      },
      dispatch_or_reconcile_continuation: continuationMessageHandler,
      reconcile_continuation_dispatch: continuationMessageHandler,
      respond_continuation_explicit: messageHandler(
        options,
        session,
        readAggregate,
        observeCodex,
        facts,
      ),
      reconcile_attention_response: {
        execute: observeCodex,
        reconcile: observeCodex,
      },
      start_or_steer_codex_turn: messageHandler(
        options,
        session,
        readAggregate,
        observeCodex,
        facts,
      ),
      return_runtime_ownership: {
        execute: returnRuntimeOwnership,
        reconcile: returnRuntimeOwnership,
      },
      respond_codex_attention: {
        execute: respondCodexAttention,
        reconcile: respondCodexAttention,
      },
      archive_codex_thread: {
        execute: (command) => setCodexArchive(command, true),
        reconcile: (command) => setCodexArchive(command, true),
      },
    };
    super(handlers);
  }
}

function threadResumeHandler(
  options: CodexRuntimeTaskAdapterOptions,
  session: CodexThreadSessionSupervisor,
  readAggregate: (command: TaskCommand) => Promise<BoundAggregate>,
  observeCodex: (command: TaskCommand) => Promise<TaskCommandResult>,
): ExactTaskCommandHandler {
  return {
    execute: async (command) => {
      const aggregate = await readAggregate(command);
      await resumeBoundThread(options, session, aggregate, true);
      return observeCodex(command);
    },
    reconcile: observeCodex,
  };
}

function assertBoundThreadIdentity(
  aggregate: BoundAggregate,
  thread: CodexThread,
): void {
  const threadId = aggregate.record?.identity.threadId;
  const threadSource = aggregate.record?.bootstrap.threadSource;
  const mismatches: string[] = [];
  if (!threadId) mismatches.push("missing durable thread ID");
  else if (thread.id !== threadId) mismatches.push("thread ID");
  if (!threadSource) mismatches.push("missing durable thread source");
  // The approved App Server can temporarily omit threadSource from a direct
  // thread/read while the exact loaded thread is active. The durable thread
  // ID plus App Server session ID remain authoritative in that state. A
  // present but different source is still a binding conflict.
  else if (thread.threadSource !== null && thread.threadSource !== threadSource)
    mismatches.push("thread source");
  if (
    aggregate.codexSessionId !== null &&
    thread.sessionId !== aggregate.codexSessionId
  )
    mismatches.push("session ID");
  if (thread.cliVersion !== APPROVED_CODEX_CLI_VERSION)
    mismatches.push("CLI version");
  if (thread.historyMode !== "legacy") mismatches.push("history profile");
  if (mismatches.length > 0)
    throw new Error(
      `Codex bound thread identity mismatch: ${mismatches.join(", ")}.`,
    );
}

async function resumeBoundThread(
  options: CodexRuntimeTaskAdapterOptions,
  session: CodexThreadSessionSupervisor,
  aggregate: BoundAggregate,
  excludeTurns: boolean,
  workflowContext = aggregate.launch.workflowContext,
  selectedResultContext?: TaskSelectedResultContextSnapshot,
): Promise<CodexThread> {
  const threadId = aggregate.record?.identity.threadId;
  if (!threadId) throw new Error("Resume lacks a durable thread binding.");
  const capability = issueTaskCapability(options, aggregate);
  if (
    aggregate.capabilityFingerprint &&
    aggregate.capabilityFingerprint !== capability.fingerprint
  )
    throw new Error("Persisted task capability cannot be reproduced.");
  const resumed = await session.resume({
    threadId,
    ...threadLaunchParams(
      options,
      aggregate,
      capability.token,
      workflowContext,
      selectedResultContext,
    ),
    excludeTurns,
  });
  assertBoundThreadIdentity(aggregate, resumed);
  if (resumed.status.type === "notLoaded")
    throw new Error("Codex resume did not load the bound thread.");
  await assertThreadMcp(options, threadId);
  return resumed;
}

function issueTaskCapability(
  options: CodexRuntimeTaskAdapterOptions,
  aggregate: BoundAggregate,
): { token: string; fingerprint: string } {
  const browser = aggregate.launch.browserIdentity;
  const current = options.capabilityIssuer.issue({
    taskId: aggregate.taskId,
    bootstrapId: aggregate.launch.bootstrapId,
    executionMode: aggregate.launch.executionMode,
    ...(browser ? { browserIdentity: browser } : {}),
  });
  if (
    !aggregate.capabilityFingerprint ||
    aggregate.capabilityFingerprint === current.fingerprint
  )
    return current;
  const sessionId = aggregate.record?.identity.sessionId;
  if (sessionId && browser) {
    const legacy = options.capabilityIssuer.issue({
      taskId: aggregate.taskId,
      sessionId,
      executionMode: aggregate.launch.executionMode,
      browserIdentity: browser,
    });
    if (legacy.fingerprint === aggregate.capabilityFingerprint) return legacy;
  }
  throw new Error("Persisted task capability cannot be reproduced.");
}

function threadLaunchParams(
  options: CodexRuntimeTaskAdapterOptions,
  aggregate: BoundAggregate,
  capability: string,
  workflowContext = aggregate.launch.workflowContext,
  selectedResultContext?: TaskSelectedResultContextSnapshot,
) {
  const sessionId = aggregate.record?.identity.sessionId;
  const attachmentInstructions = sessionId
    ? options.attachments?.authority.instructions(aggregate.taskId, sessionId)
    : undefined;
  return {
    cwd: aggregate.launch.cwd,
    ...(aggregate.launch.model ? { model: aggregate.launch.model } : {}),
    approvalPolicy: "on-request",
    approvalsReviewer: aggregate.launch.approvalsReviewer,
    permissions: "rove_task",
    runtimeWorkspaceRoots: [aggregate.launch.cwd],
    // workflowContext exists only after the user explicitly chose to share the
    // approved Workflow guidance with Codex for this task. Mere Workflow
    // association remains local and never enters this transport boundary.
    developerInstructions: [
      browserRouteDeveloperInstructions(aggregate.launch),
      attachmentInstructions,
      workflowContext?.developerInstructions,
      selectedResultContext?.developerInstructions,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n\n"),
    config: {
      // App Server requires an explicit default whenever named permission
      // profiles are supplied. Keep this aligned with the top-level selector
      // so start and resume resolve the same frozen task boundary.
      default_permissions: "rove_task",
      permissions: {
        rove_task: {
          description: "Rove task workspace only",
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
      mcp_servers: {
        rove: {
          command: options.mcpLaunch.command,
          args: [...options.mcpLaunch.args],
          env: {
            ...options.mcpLaunch.environment,
            ROVE_TASK_ID: aggregate.taskId,
            ROVE_TASK_BOOTSTRAP_ID: aggregate.launch.bootstrapId,
            ...(sessionId ? { ROVE_TASK_SESSION_ID: sessionId } : {}),
            ROVE_TASK_CAPABILITY: capability,
            ROVE_TASK_CAPABILITY_VERIFIER: options.capabilityIssuer.verifier(),
            ROVE_TASK_EXECUTION_MODE: aggregate.launch.executionMode,
            ...(aggregate.launch.browserIdentity
              ? {
                  ROVE_TASK_BROWSER_IDENTITY: JSON.stringify(
                    aggregate.launch.browserIdentity,
                  ),
                }
              : {}),
          },
          enabled: true,
          required: true,
          startup_timeout_sec: 15,
        },
      },
      ...(aggregate.launch.reasoningEffort
        ? { model_reasoning_effort: aggregate.launch.reasoningEffort }
        : {}),
      web_search: "disabled",
      browser_use: {
        allow_history_access: false,
        default_origin_policy: {
          access: "deny",
          downloads: "deny",
          uploads: "deny",
          full_cdp_access: "deny",
        },
        origins: {},
      },
      computer_use: { default_app_access: "deny" },
    },
  };
}

async function assertThreadMcp(
  options: CodexRuntimeTaskAdapterOptions,
  threadId: string,
): Promise<void> {
  const status = await options.rpc.request("mcpServerStatus/list", {
    threadId,
    detail: "full",
    limit: 100,
  });
  const matches = status.data.filter((entry) => entry.name === "rove");
  const rove = matches[0];
  if (!rove || matches.length !== 1)
    throw new Error("Actual Codex thread lacks one required Rove MCP.");
  const definitions = Object.values(rove.tools);
  const definitionDigest = createHash("sha256")
    .update(canonicalRoveToolDefinitionsJsonWire(definitions))
    .digest("hex");
  const expectedDigest =
    options.expectedToolDefinitionDigest ?? ROVE_TOOL_DEFINITIONS_SHA256;
  const actualNames = definitions.map((definition) => definition.name).sort();
  const expectedNames = [...ROVE_TOOL_CATALOG].sort();
  if (
    rove.runtimeStatus !== "connected" ||
    rove.serverInfo?.name !== "rove" ||
    rove.serverInfo.version !== "0.1.0" ||
    rove.authStatus === "notLoggedIn" ||
    definitionDigest !== expectedDigest ||
    JSON.stringify(actualNames) !== JSON.stringify(expectedNames)
  )
    throw new Error(
      "Actual Codex thread Rove MCP provenance/catalog/auth gate failed.",
    );
}

function messageHandler(
  options: CodexRuntimeTaskAdapterOptions,
  session: CodexThreadSessionSupervisor,
  readAggregate: (command: TaskCommand) => Promise<BoundAggregate>,
  observeCodex: (command: TaskCommand) => Promise<TaskCommandResult>,
  facts: (
    command: TaskCommand,
    values: readonly FactPayload[],
  ) => TaskObservedFact[],
): ExactTaskCommandHandler {
  const durableInput = async (command: TaskCommand) => {
    const aggregate = await readAggregate(command);
    const threadId = aggregate.record?.identity.threadId;
    const message =
      typeof command.payload.message === "string"
        ? command.payload.message
        : [
              "dispatch_or_reconcile_continuation",
              "reconcile_continuation_dispatch",
            ].includes(command.type)
          ? "Continue after human control returned."
          : aggregate.launch?.outcome;
    const operationId =
      typeof command.payload.operationId === "string"
        ? command.payload.operationId
        : [
              "dispatch_or_reconcile_continuation",
              "reconcile_continuation_dispatch",
            ].includes(command.type) &&
            typeof command.payload.commandId === "string"
          ? command.payload.commandId
          : undefined;
    if (!threadId || !message || !operationId)
      throw new Error("Codex message lacks exact durable input.");
    const isInitialLaunch = operationId === aggregate.launch.operationId;
    const sessionId = aggregate.record?.identity.sessionId;
    const attachmentIds = isInitialLaunch
      ? aggregate.launch.attachmentIds
      : Array.isArray(command.payload.attachmentIds)
        ? command.payload.attachmentIds.filter(
            (attachmentId): attachmentId is string =>
              typeof attachmentId === "string",
          )
        : [];
    if (attachmentIds.length > 0 && !options.attachments)
      throw new Error("Selected task attachments cannot be materialized.");
    if (!isInitialLaunch && attachmentIds.length > 0) {
      if (sessionId)
        await options.attachments!.authority.bindDrafts(
          attachmentIds,
          aggregate.taskId,
          sessionId,
          options.attachments!.runtime,
        );
      else
        await options.attachments!.authority.bindTaskInputs(
          attachmentIds,
          aggregate.taskId,
        );
    }
    const attachments: UserInput[] =
      attachmentIds.length > 0 && options.attachments
        ? (
            await options.attachments.authority.materializeCodexInputs(
              attachmentIds,
              aggregate.taskId,
              sessionId,
              aggregate.launch.cwd,
            )
          ).map((attachment) =>
            attachment.mimeType.startsWith("image/")
              ? ({ type: "localImage", path: attachment.path } as const)
              : attachment.mimeType.startsWith("audio/")
                ? ({ type: "localAudio", path: attachment.path } as const)
                : ({
                    type: "mention",
                    name: attachment.filename,
                    path: attachment.path,
                  } as const),
          )
        : [];
    const workflowContext =
      command.payload.workflowContext &&
      typeof command.payload.workflowContext === "object"
        ? (structuredClone(
            command.payload.workflowContext,
          ) as BoundAggregate["launch"]["workflowContext"])
        : undefined;
    const selectedResultContext =
      command.payload.selectedResultContext &&
      typeof command.payload.selectedResultContext === "object"
        ? (structuredClone(
            command.payload.selectedResultContext,
          ) as TaskSelectedResultContextSnapshot)
        : undefined;
    return {
      aggregate,
      threadId,
      message,
      operationId,
      attachments,
      workflowContext,
      selectedResultContext,
    };
  };
  const readLoadedThread = async (
    aggregate: BoundAggregate,
    threadId: string,
    includeTurns: boolean,
  ): Promise<CodexThread> => {
    try {
      const thread = await session.read(threadId, includeTurns);
      assertBoundThreadIdentity(aggregate, thread);
      if (thread.status.type !== "notLoaded" && session.isAttached(threadId))
        return thread;
    } catch (error) {
      if (
        includeTurns &&
        isPinnedEmptyTurnHistoryFailure(error) &&
        aggregate.codex.turn === "none" &&
        aggregate.conversation.turnOrder.length === 0 &&
        Object.keys(aggregate.conversation.items).length === 0
      )
        return readLoadedThread(aggregate, threadId, false);
      if (!isPinnedThreadNotLoadedFailure(error, threadId)) throw error;
    }
    return resumeBoundThread(options, session, aggregate, !includeTurns);
  };
  const dispatch = async (command: TaskCommand) => {
    const {
      aggregate,
      threadId,
      message,
      operationId,
      attachments,
      workflowContext,
      selectedResultContext,
    } = await durableInput(command);
    let thread = await readLoadedThread(aggregate, threadId, false);
    const activeTurnId =
      thread.status.type === "active" && aggregate.codex.turn === "active"
        ? aggregate.codex.turnId
        : undefined;
    if (thread.status.type === "active" && !activeTurnId)
      throw new Error("Active Codex thread lacks an exact bound turn.");
    if (!activeTurnId && (workflowContext || selectedResultContext)) {
      thread = await resumeBoundThread(
        options,
        session,
        aggregate,
        true,
        workflowContext,
        selectedResultContext,
      );
    }
    const delivery = await session.dispatch({
      thread,
      operationId,
      message,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(activeTurnId ? { expectedActiveTurnId: activeTurnId } : {}),
    });
    const deliveryFacts = facts(command, [
      { type: "codex_message_delivery_observed", delivery },
    ]);
    if (delivery.state === "transport_may_have_received")
      return unresolvedDelivery(delivery, deliveryFacts);
    if (delivery.state === "non_submission_established")
      return {
        status: "failed" as const,
        facts: deliveryFacts,
        detail: { reason: "Codex conclusively rejected the message dispatch." },
      };
    if (delivery.state === "dispatch_not_started")
      return {
        status: "failed" as const,
        facts: deliveryFacts,
        detail: { reason: "Codex message dispatch did not start." },
      };
    // turn/start acceptance is the command result. Ordered App Server events
    // own the subsequently materialized item and turn state; an immediate
    // thread/read can temporarily expose a pre-run terminal placeholder and
    // must not outrun those events.
    return { status: "succeeded" as const, facts: deliveryFacts };
  };
  return {
    execute: dispatch,
    reconcile: async (command) => {
      const { aggregate, threadId, operationId } = await durableInput(command);
      const thread = await readLoadedThread(aggregate, threadId, true);
      const delivery = session.correlate(thread, operationId);
      const deliveryFacts = facts(command, [
        { type: "codex_message_delivery_observed", delivery },
      ]);
      if (delivery.state !== "message_materialized")
        return unresolvedDelivery(delivery, deliveryFacts);
      const observed = await observeCodex(command);
      return { ...observed, facts: [...deliveryFacts, ...observed.facts] };
    },
  };
}

function unresolvedDelivery(
  delivery: CodexMessageDeliveryEvidence,
  facts: readonly TaskObservedFact[],
): TaskCommandResult {
  return {
    status: "unresolved",
    facts,
    detail: {
      reason:
        delivery.state === "transport_may_have_received"
          ? "Codex transport may have received the message; automatic redispatch is blocked."
          : "Codex history did not conclusively establish message submission; automatic redispatch is blocked.",
      operationId: delivery.operationId,
      deliveryState: delivery.state,
      connectionGeneration: delivery.connectionGeneration,
    },
  };
}
