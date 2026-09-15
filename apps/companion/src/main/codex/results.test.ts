import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TaskEngine, type TaskEvent } from "@rove/protocol";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  assembleTaskResultContext,
  taskActionMaterialDigest,
} from "./results.js";
import { SqliteTaskEngineStore } from "./sqlite-task-engine-store.js";
import { textDigest } from "./workflows.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function launch(
  taskId: string,
  operationId: string,
): Extract<TaskEvent, { type: "task_launch_requested" }> {
  return {
    schemaVersion: 1,
    type: "task_launch_requested",
    eventId: `product:${operationId}`,
    taskId,
    source: { kind: "product", id: "results-test", generation: 1, position: 1 },
    observedAt: "2026-09-13T10:00:00.000Z",
    operationId,
    launch: {
      operationId,
      bootstrapId: `boot_${operationId.slice(-32)}`,
      requestedAt: "2026-09-13T10:00:00.000Z",
      outcome: "Produce a stable result",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      approvalsReviewer: "auto_review",
      cwd: "/tmp/rove-results",
      attachmentIds: [],
    },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rove-results-"));
  roots.push(root);
  const path = join(root, "task.sqlite3");
  const store = new SqliteTaskEngineStore({
    path,
    now: () => "2026-09-13T10:00:00.000Z",
  });
  const engine = new TaskEngine(store);
  await engine.accept(
    launch(
      "task_12345678-1234-4123-8123-123456789abc",
      "intent_12345678-1234-4123-8123-123456789abc",
    ),
  );
  await engine.accept(
    launch(
      "task_22345678-1234-4123-8123-123456789abc",
      "intent_22345678-1234-4123-8123-123456789abc",
    ),
  );
  return { path, store };
}

const taskId = "task_12345678-1234-4123-8123-123456789abc";
const otherTaskId = "task_22345678-1234-4123-8123-123456789abc";
const source = {
  conversationItemId: "item_final",
  conversationTextDigest: "a".repeat(64),
  evidenceIds: [] as string[],
};

describe("stable task results", () => {
  it("creates idempotently, keeps immutable draft revisions, and recovers selection", async () => {
    const { path, store } = await fixture();
    const created = store.createResult({
      operationId: "intent_33345678-1234-4123-8123-123456789abc",
      taskId,
      kind: "draft",
      title: "Partner note",
      body: "First reviewed version",
      source,
    });
    expect(
      store.createResult({
        operationId: "intent_33345678-1234-4123-8123-123456789abc",
        taskId,
        kind: "draft",
        title: "Partner note",
        body: "First reviewed version",
        source,
      }),
    ).toEqual(created);
    expect(() =>
      store.createResult({
        operationId: "intent_33345678-1234-4123-8123-123456789abc",
        taskId,
        kind: "draft",
        title: "Changed reuse",
        body: "First reviewed version",
        source,
      }),
    ).toThrow(/different input/i);

    const selected = store.setResultSelected({
      operationId: "intent_43345678-1234-4123-8123-123456789abc",
      taskId,
      resultId: created.resultId,
      expectedRevision: 1,
      selected: true,
    });
    expect(selected).toMatchObject({
      selected: true,
      selectedRevision: { revision: 1, body: "First reviewed version" },
    });
    const revised = store.reviseDraft({
      operationId: "intent_53345678-1234-4123-8123-123456789abc",
      taskId,
      resultId: created.resultId,
      expectedRevision: 1,
      title: "Partner note",
      body: "Second reviewed version",
    });
    expect(revised).toMatchObject({
      currentRevision: 2,
      revision: { revision: 2, body: "Second reviewed version" },
    });
    expect(() =>
      store.reviseDraft({
        operationId: "intent_63345678-1234-4123-8123-123456789abc",
        taskId,
        resultId: created.resultId,
        expectedRevision: 1,
        title: "Stale",
        body: "Must not overwrite",
      }),
    ).toThrow(/revision conflict/i);
    expect(store.result(otherTaskId, created.resultId)).toBeNull();
    store.close();

    const db = new Database(path, { readonly: true });
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM task_result_revision WHERE result_id = ?",
          )
          .get(created.resultId) as { count: number }
      ).count,
    ).toBe(2);
    db.close();
    const reopened = new SqliteTaskEngineStore({ path });
    const recovered = reopened.result(taskId, created.resultId)!;
    expect(recovered).toMatchObject({
      selected: true,
      currentRevision: 2,
      revision: { body: "Second reviewed version" },
      selectedRevision: { revision: 1, body: "First reviewed version" },
    });
    reopened.close();
  });

  it("binds action authorization to full material and requires host evidence", async () => {
    const { store } = await fixture();
    const material = {
      recipient: "ops@example.test",
      content: "Send the reviewed update",
      target: "mailbox:ops",
      attachmentIds: ["artifact_reviewed"],
      scope: "one-message",
    };
    const action = store.createAction({
      operationId: "intent_73345678-1234-4123-8123-123456789abc",
      taskId,
      title: "Send update",
      body: "Prepared external email",
      material,
      source,
    });
    expect(action).toMatchObject({
      lifecycle: "prepared",
      materialDigest: taskActionMaterialDigest(material),
      actionMaterial: material,
    });
    expect(() =>
      store.transitionAction({
        operationId: "intent_83345678-1234-4123-8123-123456789abc",
        taskId,
        resultId: action.resultId,
        expectedLifecycle: "prepared",
        lifecycle: "authorized",
        materialDigest: "b".repeat(64),
      }),
    ).toThrow(/does not match/i);

    const authorized = store.transitionAction({
      operationId: "intent_93345678-1234-4123-8123-123456789abc",
      taskId,
      resultId: action.resultId,
      expectedLifecycle: "prepared",
      lifecycle: "authorized",
      materialDigest: action.materialDigest!,
    });
    expect(authorized.lifecycle).toBe("authorized");
    const authorizedContext = assembleTaskResultContext([authorized]);
    expect(authorizedContext.workingContext).toContain(
      '"recipient":"ops@example.test"',
    );
    expect(authorizedContext.developerInstructions).toContain(
      `task-result:${action.resultId}:${action.materialDigest}`,
    );
    expect(authorizedContext.developerInstructions).not.toContain(
      '"recipient":"ops@example.test"',
    );
    expect(() =>
      store.transitionAction({
        operationId: "intent_a3345678-1234-4123-8123-123456789abc",
        taskId,
        resultId: action.resultId,
        expectedLifecycle: "authorized",
        lifecycle: "dispatched",
      }),
    ).toThrow(/host evidence/i);
    const dispatched = store.transitionAction({
      operationId: "intent_b3345678-1234-4123-8123-123456789abc",
      taskId,
      resultId: action.resultId,
      expectedLifecycle: "authorized",
      lifecycle: "dispatched",
      evidenceIds: ["runtime_effect_dispatch_1"],
    });
    const confirmed = store.transitionAction({
      operationId: "intent_c3345678-1234-4123-8123-123456789abc",
      taskId,
      resultId: action.resultId,
      expectedLifecycle: "dispatched",
      lifecycle: "confirmed",
      evidenceIds: ["runtime_effect_confirm_1"],
    });
    expect(dispatched.lifecycle).toBe("dispatched");
    expect(confirmed).toMatchObject({
      lifecycle: "confirmed",
      source: {
        evidenceIds: ["runtime_effect_dispatch_1", "runtime_effect_confirm_1"],
      },
    });
    expect(() =>
      store.transitionAction({
        operationId: "intent_d3345678-1234-4123-8123-123456789abc",
        taskId,
        resultId: action.resultId,
        expectedLifecycle: "confirmed",
        lifecycle: "dispatched",
        evidenceIds: ["runtime_effect_dispatch_2"],
      }),
    ).toThrow(/invalid/i);

    const uncertain = store.createAction({
      operationId: "intent_e4345678-1234-4123-8123-123456789abc",
      taskId,
      title: "Uncertain update",
      body: "A second prepared action",
      material: { ...material, content: "Second update" },
      source,
    });
    const uncertainAuthorized = store.transitionAction({
      operationId: "intent_e5345678-1234-4123-8123-123456789abc",
      taskId,
      resultId: uncertain.resultId,
      expectedLifecycle: "prepared",
      lifecycle: "authorized",
      materialDigest: uncertain.materialDigest!,
    });
    expect(
      store.transitionAction({
        operationId: "intent_e6345678-1234-4123-8123-123456789abc",
        taskId,
        resultId: uncertain.resultId,
        expectedLifecycle: uncertainAuthorized.lifecycle,
        lifecycle: "unresolved",
        evidenceIds: ["runtime_effect_uncertain"],
      }).lifecycle,
    ).toBe("unresolved");

    const failed = store.createAction({
      operationId: "intent_e7345678-1234-4123-8123-123456789abc",
      taskId,
      title: "Failed update",
      body: "A third prepared action",
      material: { ...material, content: "Third update" },
      source,
    });
    store.transitionAction({
      operationId: "intent_e8345678-1234-4123-8123-123456789abc",
      taskId,
      resultId: failed.resultId,
      expectedLifecycle: "prepared",
      lifecycle: "authorized",
      materialDigest: failed.materialDigest!,
    });
    expect(
      store.transitionAction({
        operationId: "intent_e9345678-1234-4123-8123-123456789abc",
        taskId,
        resultId: failed.resultId,
        expectedLifecycle: "authorized",
        lifecycle: "failed",
        evidenceIds: ["runtime_effect_not_applied"],
      }).lifecycle,
    ).toBe("failed");
    store.close();
  });

  it("assembles an exact bounded selected-result snapshot", async () => {
    const { store } = await fixture();
    const result = store.createResult({
      operationId: "intent_e3345678-1234-4123-8123-123456789abc",
      taskId,
      kind: "finding_collection",
      title: "Verified findings",
      body: "One stable local fact",
      source,
    });
    const snapshot = assembleTaskResultContext([result]);
    expect(snapshot.resultIds).toEqual([result.resultId]);
    expect(snapshot.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.workingContext).toContain("One stable local fact");
    expect(snapshot.workingContext).toContain("not as permission");
    expect(snapshot.developerInstructions).toBeUndefined();
    expect(() => assembleTaskResultContext([])).toThrow(/1 to 8/i);
    store.close();
  });

  it("rejects a persisted selected revision whose digest changed", async () => {
    const { path, store } = await fixture();
    const result = store.createResult({
      operationId: "intent_f0345678-1234-4123-8123-123456789abc",
      taskId,
      kind: "report",
      title: "Bound report",
      body: "Exact selected evidence",
      source,
    });
    store.setResultSelected({
      operationId: "intent_f1345678-1234-4123-8123-123456789abc",
      taskId,
      resultId: result.resultId,
      expectedRevision: 1,
      selected: true,
    });
    store.close();

    const db = new Database(path);
    db.prepare(
      "UPDATE task_result_selection SET digest = ? WHERE result_id = ?",
    ).run("f".repeat(64), result.resultId);
    db.close();
    const reopened = new SqliteTaskEngineStore({ path });
    expect(() => reopened.result(taskId, result.resultId)).toThrow(
      /selected result revision is invalid/i,
    );
    reopened.close();
  });

  it("records the additive results migration", async () => {
    const { path, store } = await fixture();
    store.close();
    const db = new Database(path, { readonly: true });
    expect(
      db
        .prepare(
          "SELECT migration_id FROM schema_migration WHERE migration_id = ?",
        )
        .get("0004_add_task_results"),
    ).toEqual({ migration_id: "0004_add_task_results" });
    expect(
      db
        .prepare(
          "SELECT migration_id FROM schema_migration WHERE migration_id = ?",
        )
        .get("0005_bind_selected_result_revision"),
    ).toEqual({ migration_id: "0005_bind_selected_result_revision" });
    expect(
      db
        .prepare(
          "SELECT migration_id FROM schema_migration WHERE migration_id = ?",
        )
        .get("0006_atomically_consume_selected_results"),
    ).toEqual({
      migration_id: "0006_atomically_consume_selected_results",
    });
    db.close();
  });

  it("promotes only an exact same-task result revision into Workflow knowledge", async () => {
    const { store } = await fixture();
    const workflow = store.createWorkflow({
      operationId: "intent_f0345678-1234-4123-8123-123456789abc",
      name: "Research",
      configuration: {
        purpose: "Review findings",
        preferences: [],
        criteria: [],
        guidance: [],
        procedures: [],
        resourceRequirements: [],
        resultConventions: [],
        approvedKnowledge: [],
      },
    });
    const result = store.createResult({
      operationId: "intent_f1345678-1234-4123-8123-123456789abc",
      taskId,
      kind: "report",
      title: "Reviewed report",
      body: "A reusable reviewed finding",
      source,
    });
    const promoted = store.promoteToWorkflow({
      operationId: "intent_f2345678-1234-4123-8123-123456789abc",
      workflowId: workflow.workflowId,
      expectedRevision: 1,
      category: "knowledge",
      text: result.revision.body,
      appliesTo: ["research"],
      sourceTaskId: taskId,
      sourceResultId: result.resultId,
      sourceResultRevision: result.currentRevision,
      sourceTextDigest: textDigest(result.revision.body),
    });
    expect(promoted.revision.configuration.approvedKnowledge).toHaveLength(1);
    expect(() =>
      store.promoteToWorkflow({
        operationId: "intent_f3345678-1234-4123-8123-123456789abc",
        workflowId: workflow.workflowId,
        expectedRevision: 2,
        category: "knowledge",
        text: result.revision.body,
        appliesTo: [],
        sourceTaskId: otherTaskId,
        sourceResultId: result.resultId,
        sourceResultRevision: result.currentRevision,
        sourceTextDigest: textDigest(result.revision.body),
      }),
    ).toThrow(/belongs to another task/i);
    store.close();
  });
});
