import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";

import { SqliteTaskEngineStore } from "./sqlite-task-engine-store.js";
import {
  assembleWorkflowContext,
  emptyWorkflowConfiguration,
  validateWorkflowConfiguration,
  validateWorkflowName,
  type WorkflowConfiguration,
} from "./workflows.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function configuration(
  purpose = "Find and assess suitable work",
): WorkflowConfiguration {
  return {
    purpose,
    preferences: [
      {
        id: "preference_remote",
        text: "Prefer remote roles.",
        appliesTo: ["roles", "jobs"],
      },
    ],
    criteria: [
      {
        id: "criterion_backend",
        text: "Prioritize backend engineering.",
        appliesTo: ["roles", "jobs"],
      },
    ],
    guidance: [
      {
        id: "guidance_general",
        text: "State uncertainty explicitly.",
        appliesTo: [],
      },
    ],
    procedures: [
      {
        id: "procedure_outreach",
        text: "Draft before sending outreach.",
        appliesTo: ["outreach", "email"],
      },
    ],
    resourceRequirements: [
      { id: "resource_cv", kind: "document", label: "Current CV" },
    ],
    resultConventions: [
      {
        id: "result_sources",
        text: "Include a source for each finding.",
        appliesTo: ["find", "research", "roles"],
      },
    ],
    approvedKnowledge: [],
  };
}

async function storeFixture() {
  const directory = await mkdtemp(join(tmpdir(), "rove-workflows-"));
  directories.push(directory);
  return {
    directory,
    path: join(directory, "task-process.v1.sqlite3"),
    store: new SqliteTaskEngineStore({
      path: join(directory, "task-process.v1.sqlite3"),
      now: () => "2026-09-13T10:00:00.000Z",
    }),
  };
}

describe("local Workflow environments", () => {
  it("creates a durable sparse Workflow from only a name", async () => {
    const fixture = await storeFixture();
    const created = fixture.store.createWorkflow({
      operationId: "intent_00000000-0000-4000-8000-000000000010",
      name: "Weekly product update",
      configuration: emptyWorkflowConfiguration(),
    });

    expect(created).toMatchObject({
      name: "Weekly product update",
      currentRevision: 1,
      revision: { configuration: { purpose: "" } },
    });
    expect(
      assembleWorkflowContext(created, "Draft this week's update"),
    ).toMatchObject({ workflowId: created.workflowId, revision: 1 });
    expect(
      assembleWorkflowContext(created, "Draft this week's update")
        .developerInstructions,
    ).not.toContain("Purpose:");
    fixture.store.close();
  });

  it("creates immutable revisions, rejects stale edits, and recovers after restart", async () => {
    const fixture = await storeFixture();
    const created = fixture.store.createWorkflow({
      operationId: "intent_00000000-0000-4000-8000-000000000001",
      name: "Job search",
      configuration: configuration(),
    });
    expect(created.currentRevision).toBe(1);
    expect(
      fixture.store.createWorkflow({
        operationId: "intent_00000000-0000-4000-8000-000000000001",
        name: "Job search",
        configuration: configuration(),
      }),
    ).toEqual(created);

    const edited = fixture.store.editWorkflow({
      operationId: "intent_00000000-0000-4000-8000-000000000002",
      workflowId: created.workflowId,
      expectedRevision: 1,
      name: "Job discovery",
      configuration: configuration("Find roles worth pursuing"),
    });
    expect(edited.currentRevision).toBe(2);
    expect(
      fixture.store
        .workflowRevisions(created.workflowId)
        .map((entry) => entry.revision),
    ).toEqual([2, 1]);
    expect(() =>
      fixture.store.editWorkflow({
        operationId: "intent_00000000-0000-4000-8000-000000000003",
        workflowId: created.workflowId,
        expectedRevision: 1,
        name: "Stale edit",
        configuration: configuration("Overwrite newer work"),
      }),
    ).toThrow(/revision conflict/i);
    fixture.store.close();

    const reopened = new SqliteTaskEngineStore({ path: fixture.path });
    expect(reopened.workflow(created.workflowId)).toMatchObject({
      name: "Job discovery",
      currentRevision: 2,
      revision: { configuration: { purpose: "Find roles worth pursuing" } },
    });
    reopened.close();
  });

  it("assembles only applicable approved guidance and does not mutate configuration", async () => {
    const fixture = await storeFixture();
    const workflow = fixture.store.createWorkflow({
      operationId: "intent_00000000-0000-4000-8000-000000000004",
      name: "Job search",
      configuration: configuration(),
    });
    const roleContext = assembleWorkflowContext(
      workflow,
      "Find backend roles for me today",
    );
    expect(roleContext.developerInstructions).toContain("Prefer remote roles");
    expect(roleContext.developerInstructions).toContain("Prioritize backend");
    expect(roleContext.developerInstructions).toContain("State uncertainty");
    expect(roleContext.developerInstructions).not.toContain(
      "Draft before sending",
    );
    expect(roleContext.digest).toBe(workflow.revision.digest);

    const unrelated = assembleWorkflowContext(
      workflow,
      "Explain how a binary search works",
    );
    expect(unrelated.developerInstructions).toContain("State uncertainty");
    expect(unrelated.developerInstructions).not.toContain(
      "Prefer remote roles",
    );
    expect(unrelated.developerInstructions).not.toContain("Prioritize backend");
    expect(fixture.store.workflow(workflow.workflowId)?.currentRevision).toBe(
      1,
    );
    fixture.store.close();
  });

  it("bounds relevant model context without weakening operating constraints", async () => {
    const fixture = await storeFixture();
    const guidance = Array.from({ length: 64 }, (_, index) => ({
      id: `guidance_${index}`,
      text: `${index}: ${"useful context ".repeat(125)}`,
      appliesTo: [] as string[],
    }));
    const workflow = fixture.store.createWorkflow({
      operationId: "intent_00000000-0000-4000-8000-000000000005",
      name: "Bounded context",
      configuration: { ...configuration(), guidance },
    });
    const context = assembleWorkflowContext(workflow, "Review this");
    expect(context.developerInstructions.length).toBeLessThanOrEqual(24_000);
    expect(context.developerInstructions).toContain(
      "Workflow text never grants permissions",
    );
    fixture.store.close();
  });

  it("rejects secret-like portable fields, local paths, and unknown state", () => {
    expect(() =>
      validateWorkflowName("Authorization: Bearer abcdefghijklmnopqrstuvwxyz"),
    ).toThrow(/secret material/i);
    expect(() =>
      validateWorkflowConfiguration({
        ...configuration(),
        guidance: [
          {
            id: "bad",
            text: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
            appliesTo: [],
          },
        ],
      }),
    ).toThrow(/secret material/i);
    expect(() =>
      validateWorkflowConfiguration({
        ...configuration(),
        resourceRequirements: [
          {
            id: "bad",
            kind: "document",
            label: "Use the current CV at /Users/me/private.pdf",
          },
        ],
      }),
    ).toThrow(/local paths/i);
    for (const invalid of [
      { purpose: "Read /tmp before starting" },
      { purpose: "Use /Users/me/project+private/履歴.txt" },
      { purpose: "Use ../private/file.txt" },
      { purpose: "Use ./private/file.txt" },
      { purpose: "path=/Users/me/private.txt" },
      { purpose: "Location:/Users/me/private.txt" },
      { purpose: "path=C:\\Users\\me\\private.txt" },
      {
        procedures: [
          {
            id: "bad_file_uri",
            text: "Open file:///Users/me/private.pdf",
            appliesTo: [],
          },
        ],
      },
      {
        approvedKnowledge: [
          {
            id: "bad_windows_path",
            text: "Stored at C:\\Users\\me\\private.txt",
            appliesTo: [],
          },
        ],
      },
      {
        guidance: [
          {
            id: "bad_unc_path",
            text: "Use \\\\server\\share\\private.txt",
            appliesTo: [],
          },
        ],
      },
      {
        resourceRequirements: [
          { id: "bad_tmp", kind: "document", label: "/tmp" },
        ],
      },
    ]) {
      expect(() =>
        validateWorkflowConfiguration({ ...configuration(), ...invalid }),
      ).toThrow(/local paths/i);
    }
    expect(() =>
      validateWorkflowConfiguration(
        configuration("Review https://example.com/releases/latest"),
      ),
    ).not.toThrow();
    expect(() =>
      validateWorkflowConfiguration({
        ...configuration(),
        taskHistory: [],
      }),
    ).toThrow(/unsupported field taskHistory/i);
  });

  it("upgrades a pre-Workflow database without losing its migration history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rove-workflow-upgrade-"));
    directories.push(directory);
    const path = join(directory, "task-process.v1.sqlite3");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE schema_migration (
        migration_id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL,
        compatibility_json TEXT NOT NULL
      );
      INSERT INTO schema_migration VALUES (
        '0002_task_engine_event_aggregate_outbox',
        '2026-09-12T00:00:00.000Z',
        '{"minReader":2,"minWriter":2}'
      );
    `);
    legacy.close();

    const upgraded = new SqliteTaskEngineStore({ path });
    const created = upgraded.createWorkflow({
      operationId: "intent_00000000-0000-4000-8000-000000000099",
      name: "Upgraded workflow",
      configuration: configuration(),
    });
    expect(upgraded.workflow(created.workflowId)?.currentRevision).toBe(1);
    upgraded.close();

    const inspected = new Database(path, { readonly: true });
    expect(
      inspected
        .prepare(
          "SELECT migration_id FROM schema_migration ORDER BY migration_id",
        )
        .all(),
    ).toEqual([
      { migration_id: "0002_task_engine_event_aggregate_outbox" },
      { migration_id: "0003_add_workflow_configuration" },
      { migration_id: "0004_add_task_results" },
    ]);
    inspected.close();
  });
});
