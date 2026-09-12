import { describe, expect, it, vi } from "vitest";
import type { NativeLifecycleInput, TaskProcessCommand } from "@rove/protocol";

import { MemoryStateRepository } from "./persistence.js";
import {
  ContextAuthority,
  RoveTaskCoordinator,
  TaskCapabilityIssuer,
  type ResolvedTaskContext,
} from "./task-coordinator.js";
import type { TaskProcessAdapterContext } from "./task-process-worker.js";

describe("task process context reconstruction", () => {
  it("repairs a missing JSON mirror from committed ledger state during reconciliation", async () => {
    const taskId = "task_99999999-9999-4999-8999-999999999999";
    const bootstrapId = `boot_${"9".repeat(32)}`;
    const record: NonNullable<NativeLifecycleInput["record"]> = {
      schemaVersion: 1,
      identity: { taskId, browser: { mode: "temporary" } },
      bootstrap: {
        operationId: bootstrapId,
        threadSource: `rove:${taskId}:${bootstrapId}`,
        stage: "runtime_dispatching",
      },
      desiredState: "open",
    };
    const lifecycle: NativeLifecycleInput = {
      record,
      codex: {
        availability: "available",
        threadExists: false,
        sourceLookup: "none",
        runtimeStatus: "notLoaded",
        archived: null,
        turn: "none",
      },
      runtime: {
        availability: "available",
        sessionExists: false,
        bootstrapLookup: "none",
        status: "missing",
        controller: null,
        attachment: "missing",
        profileLock: "released",
        recovery: "cleanup_required",
      },
      continuation: { status: "none" },
      attentions: [],
      freshInspection: null,
      requestedOperation: { type: "observe", taskId },
    };
    const authority = new ContextAuthority();
    const repository = new MemoryStateRepository<{
      contexts: Record<string, ResolvedTaskContext>;
    }>();
    const rpc = {
      request: vi.fn(async (method: string) => {
        if (method === "thread/list") return { data: [], nextCursor: null };
        throw new Error(`Unexpected RPC ${method}`);
      }),
      notify: vi.fn(),
      respond: vi.fn(),
      onEvent: vi.fn(() => () => undefined),
    };
    const coordinator = new RoveTaskCoordinator(
      rpc as never,
      { listSessionInventory: vi.fn(async () => []) } as never,
      { inspect: vi.fn() },
      authority,
      new TaskCapabilityIssuer(Buffer.alloc(32, 9)),
      () => ({ status: "logged_in" }),
      { command: "node", args: [], environment: {} },
      () => "2026-09-09T12:00:00.000Z",
      undefined,
      () => [],
      undefined,
      repository,
    );
    const command: TaskProcessCommand = {
      schemaVersion: 1,
      commandId: "command:test:1",
      taskId,
      sequence: 1,
      type: "advance_bootstrap_stage",
      payload: {
        type: "advance_bootstrap_stage",
        taskId,
        stage: "runtime_dispatching",
      },
      status: "leased",
      attempts: 2,
      createdAt: "2026-09-09T12:00:00.000Z",
      claimedFrom: "reconcile_required",
    };
    const processContext: TaskProcessAdapterContext = {
      lifecycle,
      launchConfiguration: {
        roveTaskId: taskId,
        executionMode: "agent",
        selectionSource: "user_selected",
        selectedAt: "2026-09-09T12:00:00.000Z",
        policy: {
          cwd: "/work",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox: "workspace-write",
        },
      },
      durableData: { schemaVersion: 1, attentions: [] },
    };

    await expect(
      coordinator.executeTaskProcessCommand(command, true, processContext),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(authority.get(taskId)?.bootstrap.stage).toBe("runtime_dispatching");
    expect((await repository.read())?.value.contexts[taskId]).toMatchObject({
      roveTaskId: taskId,
      bootstrap: { stage: "runtime_dispatching" },
    });

    const stale = {
      ...authority.get(taskId)!,
      bootstrap: {
        ...authority.get(taskId)!.bootstrap,
        stage: "intent_persisted" as const,
      },
    };
    authority.replace(taskId, stale);
    await coordinator.executeTaskProcessCommand(command, true, processContext);
    expect(authority.get(taskId)?.bootstrap.stage).toBe("runtime_dispatching");
    expect(
      (await repository.read())?.value.contexts[taskId]?.bootstrap.stage,
    ).toBe("runtime_dispatching");
  });
});
