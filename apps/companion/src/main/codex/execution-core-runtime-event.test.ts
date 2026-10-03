import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyTaskAggregate,
  foldTaskEvent,
  hasActionableTaskHandoff,
  projectTaskAggregate,
  TaskEngine,
  type NativeRuntimeTruth,
  type TaskEvent,
} from "@rove/protocol";

import {
  CodexExecutionCore,
  composeCompletedRequestHumanHandoff,
  runtimeInventoryEventId,
  runtimeInventorySourceId,
} from "./execution-core.js";
import { OrderedTaskIngress } from "./ordered-task-ingress.js";
import {
  TaskAttachmentAuthority,
  type AttachmentRuntimeMaterializer,
} from "./task-attachments.js";
import { SqliteTaskEngineStore } from "./sqlite-task-engine-store.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Runtime inventory event identity", () => {
  it("separates observations by generation, position, and state", () => {
    const first = runtimeInventoryEventId("task_1", 7, 1, "same-state");

    expect(runtimeInventoryEventId("task_1", 7, 1, "same-state")).toBe(first);
    expect(runtimeInventoryEventId("task_1", 8, 1, "same-state")).not.toBe(
      first,
    );
    expect(runtimeInventoryEventId("task_1", 7, 2, "same-state")).not.toBe(
      first,
    );
    expect(runtimeInventoryEventId("task_1", 7, 1, "other-state")).not.toBe(
      first,
    );
  });

  it("keeps one stable Runtime inventory producer independent of provider observation sequence", () => {
    expect(runtimeInventorySourceId("ses_runtime")).toBe(
      "inventory:ses_runtime",
    );
  });

  it("keeps identical truth idempotent while accepting changed same-sequence truth before a later task", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-runtime-inventory-"));
    roots.push(root);
    const store = new SqliteTaskEngineStore({
      path: join(root, "tasks.sqlite3"),
    });
    const engine = new TaskEngine(store);
    const firstTaskId = "task_11111111-1111-4111-8111-111111111111";
    const laterTaskId = "task_22222222-2222-4222-8222-222222222222";
    await engine.accept(launch(firstTaskId, 1, "1"));
    await engine.accept(launch(laterTaskId, 2, "2"));

    const firstSessionId = `ses_${"a".repeat(32)}`;
    const laterSessionId = `ses_${"b".repeat(32)}`;
    const active = runtimeTruth(firstSessionId, "active", "agent");
    const awaiting = runtimeTruth(firstSessionId, "awaiting_human", null);
    const first = runtimeEvent(firstTaskId, active, 1, "active-agent");
    const changed = runtimeEvent(firstTaskId, awaiting, 2, "awaiting-human");
    await engine.accept(first);
    await expect(engine.accept(changed)).resolves.toMatchObject({
      duplicate: false,
    });
    await expect(
      engine.accept(structuredClone(changed)),
    ).resolves.toMatchObject({ duplicate: true });

    const later = runtimeEvent(
      laterTaskId,
      runtimeTruth(laterSessionId, "active", "agent"),
      3,
      "later-active",
    );
    await expect(engine.accept(later)).resolves.toMatchObject({
      duplicate: false,
      aggregate: {
        taskId: laterTaskId,
        runtime: { sessionId: laterSessionId, status: "active" },
      },
    });
    store.close();
  });
});

function launch(
  taskId: string,
  position: number,
  seed: string,
): Extract<TaskEvent, { type: "task_launch_requested" }> {
  const operationId = `intent_${seed.repeat(8)}-${seed.repeat(4)}-4${seed.repeat(3)}-8${seed.repeat(3)}-${seed.repeat(12)}`;
  return {
    schemaVersion: 1,
    type: "task_launch_requested",
    eventId: `product:${operationId}`,
    taskId,
    source: { kind: "product", id: "runtime-test", generation: 1, position },
    observedAt: "2026-09-19T00:00:00.000Z",
    operationId,
    launch: {
      operationId,
      bootstrapId: `boot_${seed.repeat(32)}`,
      requestedAt: "2026-09-19T00:00:00.000Z",
      outcome: "Observe Runtime truth",
      executionMode: "companion",
      browserIdentity: { mode: "temporary" },
      approvalsReviewer: "auto_review",
      cwd: "/work",
      attachmentIds: [],
    },
  };
}

function runtimeTruth(
  sessionId: string,
  status: NativeRuntimeTruth["status"],
  controller: NativeRuntimeTruth["controller"],
): NativeRuntimeTruth {
  return {
    availability: "available",
    sessionExists: true,
    sessionId,
    bootstrapLookup: "exact",
    status,
    controller,
    attachment: "attached",
    profileLock: "released",
    browserIdentity: { mode: "temporary" },
    recovery: "not_needed",
    ownershipGeneration: 2,
    observationSeq: 2,
  };
}

function runtimeEvent(
  taskId: string,
  runtime: NativeRuntimeTruth,
  position: number,
  fingerprint: string,
): Extract<TaskEvent, { type: "runtime_inventory_observed" }> {
  return {
    schemaVersion: 1,
    type: "runtime_inventory_observed",
    eventId: runtimeInventoryEventId(taskId, 1, position, fingerprint),
    taskId,
    source: {
      kind: "runtime",
      id: runtimeInventorySourceId(runtime.sessionId!),
      generation: 1,
      position,
    },
    observedAt: "2026-09-19T00:00:01.000Z",
    runtime,
  };
}

describe("request-human live event composition", () => {
  const taskId = "task_11111111-1111-4111-8111-111111111111";
  const sessionId = `ses_${"1".repeat(32)}`;
  const threadId = "thread_live";
  const handoffId = `handoff_${"2".repeat(32)}`;
  const bootstrapId = `boot_${"3".repeat(32)}`;
  const item = {
    type: "dynamicToolCall",
    id: "item_live_handoff",
    namespace: "rove",
    tool: "control.request_human",
    status: "completed",
    arguments: {
      sessionId,
      reason: "Sign in",
      instruction: "Inspect the authenticated page and continue.",
      continuationPolicy: "resume_after_control_return",
    },
    contentItems: [
      {
        type: "inputText",
        text: JSON.stringify({
          sessionId,
          generation: 2,
          status: "awaiting_human",
          controller: null,
          activeHandoffId: handoffId,
          observationSeq: 9,
        }),
      },
    ],
    success: true,
    durationMs: 1,
  };

  it("turns a corroborated dynamic completion into one actionable task handoff", async () => {
    const completedHandoff = await composeCompletedRequestHumanHandoff({
      taskId,
      threadId,
      turnId: "turn_live",
      item,
      boundRuntimeSessionId: sessionId,
      getControlStatus: async () => ({
        sessionId,
        generation: 2,
        status: "awaiting_human",
        controller: null,
        activeHandoffId: handoffId,
        activeHandoffGeneration: 2,
        observationSeq: 9,
        updatedAt: "2026-09-19T00:00:00.000Z",
      }),
    });
    expect(completedHandoff).toBeDefined();
    const seeded = emptyTaskAggregate(taskId);
    seeded.launch = {
      operationId: "intent_11111111-1111-4111-8111-111111111112",
      bootstrapId,
      requestedAt: "2026-09-19T00:00:00.000Z",
      outcome: "Complete the authenticated task.",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      approvalsReviewer: "auto_review",
      cwd: "/work",
      attachmentIds: [],
    };
    seeded.record = {
      schemaVersion: 1,
      identity: {
        taskId,
        sessionId,
        threadId,
        browser: { mode: "temporary" },
      },
      bootstrap: {
        operationId: bootstrapId,
        threadSource: `rove:${taskId}:${bootstrapId}`,
        stage: "complete",
      },
      desiredState: "open",
    };
    seeded.codex = {
      availability: "available",
      threadExists: true,
      threadId,
      threadSource: `rove:${taskId}:${bootstrapId}`,
      sourceLookup: "exact",
      runtimeStatus: "active",
      archived: false,
      turn: "active",
      turnId: "turn_live",
    };
    seeded.runtime = {
      availability: "available",
      sessionExists: true,
      sessionId,
      bootstrapId,
      bootstrapLookup: "exact",
      status: "active",
      controller: "agent",
      attachment: "attached",
      profileLock: "released",
      browserIdentity: { mode: "temporary" },
      recovery: "not_needed",
      ownershipGeneration: 1,
      observationSeq: 8,
    };
    const aggregate = foldTaskEvent(seeded, {
      schemaVersion: 1,
      type: "codex_item_observed",
      eventId: "codex:live:item:item_live_handoff:completed",
      taskId,
      source: {
        kind: "codex",
        id: "connection_live",
        generation: 1,
        position: 1,
      },
      observedAt: "2026-09-19T00:00:00.000Z",
      threadId,
      turnId: "turn_live",
      itemId: "item_live_handoff",
      terminal: true,
      item: {
        id: "item_live_handoff",
        kind: "tool",
        status: "completed",
        turnId: "turn_live",
        title: "control.request_human",
      },
      completedHandoff: completedHandoff!,
    });

    expect(aggregate.continuation).toMatchObject({
      status: "pending",
      sessionId,
      handoffId,
      generation: 2,
    });
    expect(aggregate.attentions).toEqual([
      expect.objectContaining({
        authority: "rove_control",
        kind: "control_handoff",
        status: "pending",
        taskId,
        sessionId,
        handoffId,
        generation: 2,
      }),
    ]);
    expect(hasActionableTaskHandoff(aggregate)).toBe(true);
    expect(projectTaskAggregate(aggregate).runtime).toMatchObject({
      status: "awaiting_human",
      controller: null,
    });

    const interrupted = structuredClone(seeded);
    interrupted.codex = {
      ...interrupted.codex,
      runtimeStatus: "idle",
      turn: "interrupted",
    };
    interrupted.conversation.terminalTurns = {
      turn_live: "interrupted",
    };
    const afterLateHandoff = foldTaskEvent(interrupted, {
      schemaVersion: 1,
      type: "codex_item_observed",
      eventId: "codex:late:item:item_live_handoff:completed",
      taskId,
      source: {
        kind: "codex",
        id: "connection_late",
        generation: 2,
        position: 1,
      },
      observedAt: "2026-09-19T00:00:01.000Z",
      threadId,
      turnId: "turn_live",
      itemId: "item_live_handoff",
      terminal: true,
      item: {
        id: "item_live_handoff",
        kind: "tool",
        status: "completed",
        turnId: "turn_live",
        title: "control.request_human",
      },
      completedHandoff: completedHandoff!,
    });
    expect(afterLateHandoff.conversation.itemOrder).toContain(
      "item_live_handoff",
    );
    expect(afterLateHandoff.codex.turn).toBe("interrupted");
    expect(afterLateHandoff.runtime.status).toBe("active");
    expect(afterLateHandoff.continuation).toEqual({ status: "none" });
    expect(afterLateHandoff.attentions).toEqual([]);
  });

  it("refuses composition when Runtime reports a different handoff", async () => {
    await expect(
      composeCompletedRequestHumanHandoff({
        taskId,
        threadId,
        turnId: "turn_live",
        item,
        boundRuntimeSessionId: sessionId,
        getControlStatus: async () => ({
          sessionId,
          generation: 2,
          status: "awaiting_human",
          controller: null,
          activeHandoffId: "handoff_other",
          activeHandoffGeneration: 2,
          observationSeq: 9,
          updatedAt: "2026-09-19T00:00:00.000Z",
        }),
      }),
    ).rejects.toThrow(/not corroborated/);
  });
});

describe("Runtime inventory after attachment cleanup", () => {
  it.each(["completed", "failed", "active"] as const)(
    "observes %s session truth without hiding active attachment conflicts",
    async (status) => {
      const root = await mkdtemp(join(tmpdir(), "rove-terminal-inventory-"));
      roots.push(root);
      const taskId = "task_11111111-1111-4111-8111-111111111111";
      const sessionId = `ses_${"a".repeat(32)}`;
      const authority = new TaskAttachmentAuthority(join(root, "attachments"), {
        select: async () => [
          {
            filename: "finish.txt",
            mimeType: "text/plain",
            bytes: Buffer.from("cleanup evidence"),
          },
        ],
      });
      const materializeUserFile = vi.fn<
        AttachmentRuntimeMaterializer["materializeUserFile"]
      >(async (input) => ({
        id: "ev_attachment",
        sessionId: input.sessionId,
        type: "file",
        label: input.filename,
        createdAt: "2026-09-19T00:00:00.000Z",
        metadata: {
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: input.bytes.byteLength,
          sha256: createHash("sha256").update(input.bytes).digest("hex"),
          source: "user_file_grant",
          grantId: input.grantId,
        },
      }));
      const attachmentRuntime = { materializeUserFile };
      const selected = await authority.selectDrafts();
      const attachmentIds = selected.attachments.map((item) => item.id);
      await authority.bindDrafts(
        attachmentIds,
        taskId,
        sessionId,
        attachmentRuntime,
      );
      await authority.cleanupTask(taskId);
      expect(authority.listForTask(taskId)).toEqual([]);
      const store = new SqliteTaskEngineStore({
        path: join(root, "tasks.sqlite3"),
      });
      const engine = new TaskEngine(store);
      const launchEvent = launch(taskId, 1, "1");
      launchEvent.launch.attachmentIds = attachmentIds;
      await engine.accept(launchEvent);
      await engine.accept(
        runtimeEvent(
          taskId,
          runtimeTruth(sessionId, "active", "human"),
          1,
          "stale-human",
        ),
      );
      const ingress = new OrderedTaskIngress(engine, (error) => {
        throw error;
      });
      ingress.replaceGeneration(1);
      let inventoryStatus: typeof status = status;
      const core = new CodexExecutionCore({
        isPackaged: false,
        clientVersion: "test",
        stateDirectory: root,
        runtime: {
          listSessionInventory: async () => [
            {
              session: {
                id: sessionId,
                bootstrapId: launchEvent.launch.bootstrapId,
                status: inventoryStatus,
                controller: inventoryStatus === "active" ? "human" : null,
              },
              attachment: inventoryStatus === "active" ? "attached" : "missing",
              profileOwnership: "released",
              recovery: "not_needed",
              browserIdentity: { mode: "temporary" },
            },
          ],
        } as never,
        attachmentAuthority: authority,
        attachmentRuntime,
        mcpLaunch: { command: "unused", args: [], environment: {} },
      });
      // Exercise the production poll boundary without starting native processes
      // or interval scheduling; its real ingress and SQLite ledger still commit.
      const poll = core as unknown as {
        store: SqliteTaskEngineStore;
        ingress: OrderedTaskIngress;
        recoveryWarnings: string[];
        runtimeObservationPosition: number;
        pollRuntimeTruth(): Promise<void>;
      };
      poll.store = store;
      poll.ingress = ingress;
      poll.runtimeObservationPosition = 1; // The seeded inventory already owns position 1.
      try {
        await poll.pollRuntimeTruth();
        await poll.pollRuntimeTruth();
        expect(materializeUserFile).toHaveBeenCalledTimes(1);
        if (status === "active") {
          expect(poll.recoveryWarnings).toHaveLength(1);
          expect((await store.aggregate(taskId))?.runtime).toMatchObject({
            status: "active",
            controller: "human",
          });
          // A stale active poll may lose the race with cleanup. The next
          // authoritative terminal inventory must still repair its projection.
          inventoryStatus = "completed";
          await poll.pollRuntimeTruth();
          expect(poll.recoveryWarnings).toEqual([]);
          expect((await store.aggregate(taskId))?.runtime).toMatchObject({
            status: "completed",
            controller: null,
          });
        } else {
          expect(poll.recoveryWarnings).toEqual([]);
          expect((await store.aggregate(taskId))?.runtime).toMatchObject({
            status,
            controller: null,
            attachment: "missing",
          });
        }
      } finally {
        await ingress.drain();
        store.close();
      }
    },
  );
});
