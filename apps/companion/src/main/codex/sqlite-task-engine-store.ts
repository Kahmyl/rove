import { mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

import Database from "better-sqlite3";
import type {
  NativeBrowserIdentity,
  TaskAcceptance,
  TaskAggregate,
  TaskCommand,
  TaskEngineStore,
  TaskEngineTransaction,
  TaskEvent,
  TaskProjection,
} from "@rove/protocol";
import { emptyTaskAggregate, projectTaskAggregate } from "@rove/protocol";
import {
  newWorkflowEntry,
  validateWorkflowConfiguration,
  validateWorkflowName,
  workflowConfigurationDigest,
  type WorkflowConfiguration,
  type WorkflowEnvironment,
  type WorkflowPromotionCategory,
  type WorkflowRevision,
  type WorkflowStore,
} from "./workflows.js";

const MIGRATION_ID = "0002_task_engine_event_aggregate_outbox";
const WORKFLOW_MIGRATION_ID = "0003_add_workflow_configuration";
const PERSISTED_TASK_SCHEMA_VERSION = 2;
const MAX_AUTOMATIC_COMMAND_ATTEMPTS = 3;

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parse<T>(value: string): T {
  return JSON.parse(value) as T;
}

function normalizeAggregate(value: string): TaskAggregate {
  const aggregate = parse<TaskAggregate>(value);
  if (
    aggregate.schemaVersion !== 1 ||
    typeof aggregate.taskId !== "string" ||
    !Number.isSafeInteger(aggregate.revision) ||
    !Array.isArray(aggregate.attentions) ||
    aggregate.conversation === null ||
    typeof aggregate.conversation !== "object"
  )
    throw new Error("Persisted task aggregate is invalid.");
  aggregate.messageDeliveries ??= {};
  return aggregate;
}

function normalizeProjection(value: string): TaskProjection {
  const projection = parse<TaskProjection>(value);
  if (
    projection.schemaVersion !== 1 ||
    typeof projection.taskId !== "string" ||
    !Number.isSafeInteger(projection.revision) ||
    !Array.isArray(projection.attentions)
  )
    throw new Error("Persisted task projection is invalid.");
  projection.messageDeliveries ??= {};
  return projection;
}

function normalizeAcceptance(value: string): TaskAcceptance {
  const acceptance = parse<TaskAcceptance>(value);
  acceptance.aggregate = normalizeAggregate(
    JSON.stringify(acceptance.aggregate),
  );
  acceptance.projection = normalizeProjection(
    JSON.stringify(acceptance.projection),
  );
  return acceptance;
}

export interface SqliteTaskEngineStoreOptions {
  path: string;
  taskWorkspaceRoot?: string;
  now?: () => string;
  leaseMilliseconds?: number;
}

/** The single production lifecycle ledger. Every accepted event, aggregate,
 * projection and next command is committed by one IMMEDIATE transaction. */
export class SqliteTaskEngineStore implements TaskEngineStore, WorkflowStore {
  private readonly db: Database.Database;
  private readonly now: () => string;
  private readonly leaseMilliseconds: number;
  private readonly taskWorkspaceRoot: string | undefined;
  private readonly taskQueues = new Map<string, Promise<void>>();

  constructor(options: SqliteTaskEngineStoreOptions) {
    mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
    this.db = new Database(options.path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.now = options.now ?? (() => new Date().toISOString());
    this.leaseMilliseconds = options.leaseMilliseconds ?? 30_000;
    this.taskWorkspaceRoot = options.taskWorkspaceRoot;
    this.migrate();
    const outboxColumns = this.db
      .prepare("PRAGMA table_info(task_engine_outbox)")
      .all() as { name: string }[];
    if (!outboxColumns.some((column) => column.name === "lease_origin"))
      this.db.exec(
        "ALTER TABLE task_engine_outbox ADD COLUMN lease_origin TEXT",
      );
    this.migrateLegacyRows();
    this.migratePersistedSchema();
    this.db
      .prepare(
        `UPDATE task_engine_outbox
         SET status = CASE
               WHEN status = 'possibly_started' THEN 'reconcile_required'
               WHEN lease_origin = 'reconcile_required' THEN 'reconcile_required'
               ELSE 'pending'
             END,
             lease_owner = NULL,
             lease_generation = NULL, lease_expires_at = NULL
         WHERE status IN ('leased', 'possibly_started')`,
      )
      .run();
  }

  private migratePersistedSchema(): void {
    const migrate = this.db.transaction(() => {
      const aggregates = this.db
        .prepare(
          "SELECT task_id, schema_version, payload_json FROM task_engine_aggregate",
        )
        .all() as Array<{
        task_id: string;
        schema_version: number;
        payload_json: string;
      }>;
      for (const row of aggregates) {
        if (![1, PERSISTED_TASK_SCHEMA_VERSION].includes(row.schema_version))
          throw new Error("Unsupported persisted task aggregate version.");
        const aggregate = normalizeAggregate(row.payload_json);
        const itemEvents = this.db
          .prepare(
            `SELECT payload_json FROM task_engine_event
             WHERE task_id = ? ORDER BY accepted_at ASC, rowid ASC`,
          )
          .all(row.task_id) as Array<{ payload_json: string }>;
        for (const eventRow of itemEvents) {
          const event = parse<TaskEvent>(eventRow.payload_json);
          if (event.type !== "codex_item_observed") continue;
          const item = aggregate.conversation.items[event.itemId];
          if (!item || !Number.isFinite(Date.parse(event.observedAt))) continue;
          item.startedAt ??= event.observedAt;
          if (event.terminal) item.completedAt ??= event.observedAt;
          if (
            item.phase === undefined &&
            (event.item?.phase === "commentary" ||
              event.item?.phase === "final_answer")
          )
            item.phase = event.item.phase;
        }
        if (
          aggregate.launch &&
          this.taskWorkspaceRoot &&
          resolve(aggregate.launch.cwd) !==
            resolve(join(this.taskWorkspaceRoot, aggregate.taskId))
        )
          aggregate.recoveryRequired =
            "Persisted task workspace is outside the protected per-task root and requires explicit recovery.";
        this.db
          .prepare(
            "UPDATE task_engine_aggregate SET schema_version = ?, payload_json = ? WHERE task_id = ?",
          )
          .run(PERSISTED_TASK_SCHEMA_VERSION, json(aggregate), row.task_id);
      }
      const projections = this.db
        .prepare(
          "SELECT task_id, schema_version, payload_json FROM task_engine_projection",
        )
        .all() as Array<{
        task_id: string;
        schema_version: number;
        payload_json: string;
      }>;
      for (const row of projections) {
        if (![1, PERSISTED_TASK_SCHEMA_VERSION].includes(row.schema_version))
          throw new Error("Unsupported persisted task projection version.");
        const aggregateRow = this.db
          .prepare(
            "SELECT payload_json FROM task_engine_aggregate WHERE task_id = ?",
          )
          .get(row.task_id) as { payload_json: string };
        const projection = projectTaskAggregate(
          normalizeAggregate(aggregateRow.payload_json),
        );
        this.db
          .prepare(
            "UPDATE task_engine_projection SET schema_version = ?, payload_json = ? WHERE task_id = ?",
          )
          .run(PERSISTED_TASK_SCHEMA_VERSION, json(projection), row.task_id);
      }
    });
    migrate.immediate();
  }

  private migrate(): void {
    this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS schema_migration (
        migration_id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL,
        compatibility_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_engine_aggregate (
        task_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_engine_metadata (
        key TEXT PRIMARY KEY,
        integer_value INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_history_preference (
        task_id TEXT PRIMARY KEY,
        archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
        updated_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES task_engine_aggregate(task_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS task_engine_event (
        task_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_generation INTEGER NOT NULL,
        source_position INTEGER NOT NULL,
        digest TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        acceptance_json TEXT NOT NULL,
        accepted_at TEXT NOT NULL,
        PRIMARY KEY(task_id, event_id),
        UNIQUE(task_id, source_kind, source_id, source_generation, source_position),
        FOREIGN KEY(task_id) REFERENCES task_engine_aggregate(task_id) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS task_engine_projection (
        task_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        schema_version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES task_engine_aggregate(task_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS task_engine_outbox (
        command_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        aggregate_revision INTEGER NOT NULL,
        command_type TEXT NOT NULL,
        classification_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        lease_owner TEXT,
        lease_generation INTEGER,
        lease_expires_at TEXT,
        lease_origin TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(task_id, aggregate_revision),
        FOREIGN KEY(task_id) REFERENCES task_engine_aggregate(task_id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS task_engine_outbox_due
        ON task_engine_outbox(status, aggregate_revision);
      CREATE TABLE IF NOT EXISTS workflow_environment (
        workflow_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        current_revision INTEGER NOT NULL CHECK (current_revision > 0),
        archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_revision (
        workflow_id TEXT NOT NULL REFERENCES workflow_environment(workflow_id) ON DELETE RESTRICT,
        revision INTEGER NOT NULL CHECK (revision > 0),
        configuration_json TEXT NOT NULL CHECK (json_valid(configuration_json)),
        digest TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        PRIMARY KEY(workflow_id, revision)
      );
      CREATE TABLE IF NOT EXISTS workflow_operation (
        operation_id TEXT PRIMARY KEY,
        request_digest TEXT NOT NULL,
        workflow_id TEXT NOT NULL REFERENCES workflow_environment(workflow_id) ON DELETE RESTRICT,
        result_revision INTEGER NOT NULL,
        accepted_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_promotion_provenance (
        operation_id TEXT PRIMARY KEY REFERENCES workflow_operation(operation_id) ON DELETE RESTRICT,
        workflow_id TEXT NOT NULL REFERENCES workflow_environment(workflow_id) ON DELETE RESTRICT,
        revision INTEGER NOT NULL,
        category TEXT NOT NULL,
        source_task_id TEXT REFERENCES task_engine_aggregate(task_id) ON DELETE SET NULL,
        source_item_id TEXT NOT NULL,
        source_text_digest TEXT NOT NULL,
        promoted_at TEXT NOT NULL,
        FOREIGN KEY(workflow_id, revision) REFERENCES workflow_revision(workflow_id, revision) ON DELETE RESTRICT
      );
      INSERT OR IGNORE INTO schema_migration(migration_id, applied_at, compatibility_json)
      VALUES ('${MIGRATION_ID}', datetime('now'), '{"minReader":2,"minWriter":2}');
      INSERT OR IGNORE INTO schema_migration(migration_id, applied_at, compatibility_json)
      VALUES ('${WORKFLOW_MIGRATION_ID}', datetime('now'), '{"minReader":2,"minWriter":2}');
      COMMIT;
    `);
  }

  private workflowRequestDigest(value: unknown): string {
    return createHash("sha256").update(json(value)).digest("hex");
  }

  private workflowFromRow(row: {
    workflow_id: string;
    name: string;
    current_revision: number;
    archived: number;
    created_at: string;
    updated_at: string;
    configuration_json: string;
    digest: string;
    approved_at: string;
  }): WorkflowEnvironment {
    const configuration = validateWorkflowConfiguration(
      parse(row.configuration_json),
    );
    if (workflowConfigurationDigest(configuration) !== row.digest)
      throw new Error("Stored Workflow configuration digest is invalid.");
    return {
      workflowId: row.workflow_id,
      name: row.name,
      archived: row.archived === 1,
      currentRevision: row.current_revision,
      revision: {
        workflowId: row.workflow_id,
        revision: row.current_revision,
        configuration,
        digest: row.digest,
        approvedAt: row.approved_at,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listWorkflows(
    options: { includeArchived?: boolean } = {},
  ): readonly WorkflowEnvironment[] {
    const rows = this.db
      .prepare(
        `SELECT environment.*, revision.configuration_json, revision.digest, revision.approved_at
         FROM workflow_environment environment
         JOIN workflow_revision revision
           ON revision.workflow_id = environment.workflow_id
          AND revision.revision = environment.current_revision
         ${options.includeArchived ? "" : "WHERE environment.archived = 0"}
         ORDER BY environment.updated_at DESC, environment.workflow_id ASC`,
      )
      .all() as Parameters<SqliteTaskEngineStore["workflowFromRow"]>[0][];
    return rows.map((row) => this.workflowFromRow(row));
  }

  workflow(workflowId: string): WorkflowEnvironment | null {
    const row = this.db
      .prepare(
        `SELECT environment.*, revision.configuration_json, revision.digest, revision.approved_at
         FROM workflow_environment environment
         JOIN workflow_revision revision
           ON revision.workflow_id = environment.workflow_id
          AND revision.revision = environment.current_revision
         WHERE environment.workflow_id = ?`,
      )
      .get(workflowId) as
      Parameters<SqliteTaskEngineStore["workflowFromRow"]>[0] | undefined;
    return row ? this.workflowFromRow(row) : null;
  }

  workflowRevisions(workflowId: string): readonly WorkflowRevision[] {
    return (
      this.db
        .prepare(
          `SELECT revision, configuration_json, digest, approved_at
           FROM workflow_revision WHERE workflow_id = ? ORDER BY revision DESC`,
        )
        .all(workflowId) as Array<{
        revision: number;
        configuration_json: string;
        digest: string;
        approved_at: string;
      }>
    ).map((row) => {
      const configuration = validateWorkflowConfiguration(
        parse(row.configuration_json),
      );
      if (workflowConfigurationDigest(configuration) !== row.digest)
        throw new Error("Stored Workflow revision digest is invalid.");
      return {
        workflowId,
        revision: row.revision,
        configuration,
        digest: row.digest,
        approvedAt: row.approved_at,
      };
    });
  }

  private priorWorkflowOperation(
    operationId: string,
    requestDigest: string,
  ): WorkflowEnvironment | null {
    const row = this.db
      .prepare(
        "SELECT request_digest, workflow_id FROM workflow_operation WHERE operation_id = ?",
      )
      .get(operationId) as
      { request_digest: string; workflow_id: string } | undefined;
    if (!row) return null;
    if (row.request_digest !== requestDigest)
      throw new Error(
        "Workflow operation identity was reused with different input.",
      );
    const workflow = this.workflow(row.workflow_id);
    if (!workflow) throw new Error("Workflow operation result is unavailable.");
    return workflow;
  }

  createWorkflow(input: {
    operationId: string;
    name: string;
    configuration: WorkflowConfiguration;
  }): WorkflowEnvironment {
    const configuration = validateWorkflowConfiguration(input.configuration);
    const name = validateWorkflowName(input.name);
    const requestDigest = this.workflowRequestDigest({
      type: "create",
      name,
      configuration,
    });
    const prior = this.priorWorkflowOperation(input.operationId, requestDigest);
    if (prior) return prior;
    const workflowId = `workflow_${randomUUID()}`;
    const digest = workflowConfigurationDigest(configuration);
    const now = this.now();
    const create = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO workflow_environment(workflow_id, name, current_revision, archived, created_at, updated_at)
           VALUES (?, ?, 1, 0, ?, ?)`,
        )
        .run(workflowId, name, now, now);
      this.db
        .prepare(
          `INSERT INTO workflow_revision(workflow_id, revision, configuration_json, digest, approved_at)
           VALUES (?, 1, ?, ?, ?)`,
        )
        .run(workflowId, json(configuration), digest, now);
      this.db
        .prepare(
          `INSERT INTO workflow_operation(operation_id, request_digest, workflow_id, result_revision, accepted_at)
           VALUES (?, ?, ?, 1, ?)`,
        )
        .run(input.operationId, requestDigest, workflowId, now);
    });
    create.immediate();
    return this.workflow(workflowId)!;
  }

  editWorkflow(input: {
    operationId: string;
    workflowId: string;
    expectedRevision: number;
    name: string;
    configuration: WorkflowConfiguration;
  }): WorkflowEnvironment {
    const configuration = validateWorkflowConfiguration(input.configuration);
    const name = validateWorkflowName(input.name);
    const requestDigest = this.workflowRequestDigest({
      ...input,
      configuration,
    });
    const prior = this.priorWorkflowOperation(input.operationId, requestDigest);
    if (prior) return prior;
    const current = this.workflow(input.workflowId);
    if (!current) throw new Error("Workflow is unavailable.");
    if (current.currentRevision !== input.expectedRevision)
      throw new Error("Workflow revision conflict. Refresh before saving.");
    const nextRevision = current.currentRevision + 1;
    const digest = workflowConfigurationDigest(configuration);
    const now = this.now();
    const edit = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO workflow_revision(workflow_id, revision, configuration_json, digest, approved_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(input.workflowId, nextRevision, json(configuration), digest, now);
      const changed = this.db
        .prepare(
          `UPDATE workflow_environment SET name = ?, current_revision = ?, updated_at = ?
           WHERE workflow_id = ? AND current_revision = ?`,
        )
        .run(name, nextRevision, now, input.workflowId, input.expectedRevision);
      if (changed.changes !== 1) throw new Error("Workflow revision conflict.");
      this.db
        .prepare(
          `INSERT INTO workflow_operation(operation_id, request_digest, workflow_id, result_revision, accepted_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.operationId,
          requestDigest,
          input.workflowId,
          nextRevision,
          now,
        );
    });
    edit.immediate();
    return this.workflow(input.workflowId)!;
  }

  setWorkflowArchived(input: {
    operationId: string;
    workflowId: string;
    expectedRevision: number;
    archived: boolean;
  }): WorkflowEnvironment {
    const requestDigest = this.workflowRequestDigest(input);
    const prior = this.priorWorkflowOperation(input.operationId, requestDigest);
    if (prior) return prior;
    const current = this.workflow(input.workflowId);
    if (!current) throw new Error("Workflow is unavailable.");
    if (current.currentRevision !== input.expectedRevision)
      throw new Error("Workflow revision conflict. Refresh before saving.");
    const now = this.now();
    const archive = this.db.transaction(() => {
      const changed = this.db
        .prepare(
          `UPDATE workflow_environment SET archived = ?, updated_at = ?
           WHERE workflow_id = ? AND current_revision = ?`,
        )
        .run(
          input.archived ? 1 : 0,
          now,
          input.workflowId,
          input.expectedRevision,
        );
      if (changed.changes !== 1) throw new Error("Workflow revision conflict.");
      this.db
        .prepare(
          `INSERT INTO workflow_operation(operation_id, request_digest, workflow_id, result_revision, accepted_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.operationId,
          requestDigest,
          input.workflowId,
          input.expectedRevision,
          now,
        );
    });
    archive.immediate();
    return this.workflow(input.workflowId)!;
  }

  promoteToWorkflow(input: {
    operationId: string;
    workflowId: string;
    expectedRevision: number;
    category: WorkflowPromotionCategory;
    text: string;
    appliesTo: readonly string[];
    sourceTaskId: string;
    sourceItemId: string;
    sourceTextDigest: string;
  }): WorkflowEnvironment {
    const requestDigest = this.workflowRequestDigest(input);
    const prior = this.priorWorkflowOperation(input.operationId, requestDigest);
    if (prior) return prior;
    const current = this.workflow(input.workflowId);
    if (!current) throw new Error("Workflow is unavailable.");
    if (current.currentRevision !== input.expectedRevision)
      throw new Error("Workflow revision conflict. Refresh before saving.");
    const entry = newWorkflowEntry(input.text, input.appliesTo);
    const configuration = structuredClone(current.revision.configuration);
    const target =
      input.category === "preference"
        ? "preferences"
        : input.category === "guidance"
          ? "guidance"
          : "approvedKnowledge";
    configuration[target] = [...configuration[target], entry];
    const validated = validateWorkflowConfiguration(configuration);
    const nextRevision = current.currentRevision + 1;
    const digest = workflowConfigurationDigest(validated);
    const now = this.now();
    const promote = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO workflow_revision(workflow_id, revision, configuration_json, digest, approved_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(input.workflowId, nextRevision, json(validated), digest, now);
      const changed = this.db
        .prepare(
          `UPDATE workflow_environment SET current_revision = ?, updated_at = ?
           WHERE workflow_id = ? AND current_revision = ?`,
        )
        .run(nextRevision, now, input.workflowId, input.expectedRevision);
      if (changed.changes !== 1) throw new Error("Workflow revision conflict.");
      this.db
        .prepare(
          `INSERT INTO workflow_operation(operation_id, request_digest, workflow_id, result_revision, accepted_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.operationId,
          requestDigest,
          input.workflowId,
          nextRevision,
          now,
        );
      this.db
        .prepare(
          `INSERT INTO workflow_promotion_provenance(operation_id, workflow_id, revision, category,
           source_task_id, source_item_id, source_text_digest, promoted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.operationId,
          input.workflowId,
          nextRevision,
          input.category,
          input.sourceTaskId,
          input.sourceItemId,
          input.sourceTextDigest,
          now,
        );
    });
    promote.immediate();
    return this.workflow(input.workflowId)!;
  }

  nextHostGeneration(component: "codex" | "runtime"): number {
    const row = this.db
      .prepare(
        `INSERT INTO task_engine_metadata(key, integer_value) VALUES (?, 1)
         ON CONFLICT(key) DO UPDATE SET integer_value = integer_value + 1
         RETURNING integer_value`,
      )
      .get(`host_generation:${component}`) as { integer_value: number };
    if (!Number.isSafeInteger(row.integer_value) || row.integer_value < 1)
      throw new Error("Persisted host generation is invalid.");
    return row.integer_value;
  }

  setTaskHistoryArchived(taskId: string, archived: boolean): void {
    this.db
      .prepare(
        `INSERT INTO task_history_preference(task_id, archived, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           archived = excluded.archived,
           updated_at = excluded.updated_at`,
      )
      .run(taskId, archived ? 1 : 0, this.now());
  }

  taskHistoryArchived(taskId: string): boolean | undefined {
    const row = this.db
      .prepare("SELECT archived FROM task_history_preference WHERE task_id = ?")
      .get(taskId) as { archived: number } | undefined;
    return row === undefined ? undefined : row.archived === 1;
  }

  private migrateLegacyRows(): void {
    const hasLegacy = this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'task_instance'",
      )
      .get();
    if (!hasLegacy) return;
    const rows = this.db
      .prepare(
        `SELECT task_id, reducer_state_json, frozen_launch_json,
        desired_state, updated_at FROM task_instance
        WHERE task_id NOT IN (SELECT task_id FROM task_engine_aggregate)`,
      )
      .all() as Array<{
      task_id: string;
      reducer_state_json: string;
      frozen_launch_json: string | null;
      desired_state: string;
      updated_at: string;
    }>;
    if (rows.length === 0) return;
    const convert = this.db.transaction(() => {
      for (const row of rows) {
        const aggregate = emptyTaskAggregate(row.task_id);
        aggregate.revision = 1;
        try {
          aggregate.record = parse(row.reducer_state_json);
          const rawLaunch = row.frozen_launch_json
            ? parse<Record<string, unknown>>(row.frozen_launch_json)
            : null;
          const policy =
            rawLaunch &&
            typeof rawLaunch.policy === "object" &&
            rawLaunch.policy !== null
              ? (rawLaunch.policy as Record<string, unknown>)
              : rawLaunch;
          if (
            rawLaunch &&
            policy &&
            aggregate.record &&
            typeof (
              rawLaunch.initialLaunch as Record<string, unknown> | undefined
            )?.operationId === "string" &&
            typeof rawLaunch.executionMode === "string" &&
            typeof rawLaunch.browserIdentity === "object" &&
            typeof policy.cwd === "string" &&
            (policy.approvalsReviewer === "auto_review" ||
              policy.approvalsReviewer === "user")
          ) {
            const initial = rawLaunch.initialLaunch as Record<string, unknown>;
            aggregate.launch = {
              operationId: String(initial.operationId),
              bootstrapId: aggregate.record.bootstrap.operationId,
              requestedAt:
                typeof initial.requestedAt === "string"
                  ? initial.requestedAt
                  : row.updated_at,
              outcome:
                typeof initial.outcome === "string"
                  ? initial.outcome
                  : "Recover migrated task",
              executionMode: rawLaunch.executionMode as
                "agent" | "companion" | "capture",
              browserIdentity:
                rawLaunch.browserIdentity as NativeBrowserIdentity,
              approvalsReviewer: policy.approvalsReviewer,
              cwd: policy.cwd,
              ...(typeof policy.model === "string"
                ? { model: policy.model }
                : {}),
              ...(typeof policy.reasoningEffort === "string"
                ? { reasoningEffort: policy.reasoningEffort }
                : {}),
              attachmentIds: Array.isArray(rawLaunch.attachmentIds)
                ? rawLaunch.attachmentIds.filter(
                    (value): value is string => typeof value === "string",
                  )
                : [],
            };
          }
          aggregate.desiredState =
            row.desired_state === "closed" ? "closed" : "open";
          if (aggregate.desiredState !== "closed" || !aggregate.launch)
            aggregate.recoveryRequired =
              "Legacy active task requires authoritative Codex and Runtime recovery before dispatch.";
        } catch {
          aggregate.record = null;
          aggregate.recoveryRequired =
            "Legacy task could not be classified without guessing.";
        }
        aggregate.requestedOperation = { type: "observe", taskId: row.task_id };
        const projection = projectTaskAggregate(aggregate);
        this.db
          .prepare(
            "INSERT INTO task_engine_aggregate(task_id, schema_version, revision, payload_json, updated_at) VALUES (?, 1, 1, ?, ?)",
          )
          .run(row.task_id, json(aggregate), row.updated_at);
        this.db
          .prepare(
            "INSERT INTO task_engine_projection(task_id, revision, schema_version, payload_json, updated_at) VALUES (?, 1, 1, ?, ?)",
          )
          .run(row.task_id, json(projection), row.updated_at);
      }
    });
    convert.immediate();
  }

  transact<T>(
    taskId: string,
    operation: (tx: TaskEngineTransaction) => Promise<T>,
  ): Promise<T> {
    const prior = this.taskQueues.get(taskId) ?? Promise.resolve();
    let resolveQueue!: () => void;
    const queued = new Promise<void>((resolve) => {
      resolveQueue = resolve;
    });
    const tail = prior.then(() => queued);
    this.taskQueues.set(taskId, tail);
    return prior.then(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const tx = this.transactionView();
        const result = await operation(tx);
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      } finally {
        resolveQueue();
        if (this.taskQueues.get(taskId) === tail)
          this.taskQueues.delete(taskId);
      }
    });
  }

  private transactionView(): TaskEngineTransaction {
    return {
      event: async (taskId, eventId) => {
        const row = this.db
          .prepare(
            "SELECT digest, acceptance_json FROM task_engine_event WHERE task_id = ? AND event_id = ?",
          )
          .get(taskId, eventId) as
          { digest: string; acceptance_json: string } | undefined;
        return row
          ? {
              digest: row.digest,
              acceptance: normalizeAcceptance(row.acceptance_json),
            }
          : null;
      },
      sourceEvent: async (taskId, source) => {
        const row = this.db
          .prepare(
            `SELECT event_id, digest, acceptance_json FROM task_engine_event
             WHERE task_id = ? AND source_kind = ? AND source_id = ?
               AND source_generation = ? AND source_position = ?`,
          )
          .get(
            taskId,
            source.kind,
            source.id,
            source.generation,
            source.position,
          ) as
          | {
              event_id: string;
              digest: string;
              acceptance_json: string;
            }
          | undefined;
        return row
          ? {
              eventId: row.event_id,
              digest: row.digest,
              acceptance: normalizeAcceptance(row.acceptance_json),
            }
          : null;
      },
      aggregate: async (taskId) => {
        const row = this.db
          .prepare(
            "SELECT schema_version, payload_json FROM task_engine_aggregate WHERE task_id = ?",
          )
          .get(taskId) as
          { schema_version: number; payload_json: string } | undefined;
        if (row && row.schema_version !== PERSISTED_TASK_SCHEMA_VERSION)
          throw new Error("Unsupported persisted task aggregate version.");
        return row ? normalizeAggregate(row.payload_json) : null;
      },
      command: async (commandId) => this.readCommand(commandId),
      activeCommand: async (taskId) => {
        const row = this.db
          .prepare(
            `SELECT * FROM task_engine_outbox
             WHERE task_id = ?
               AND status IN ('pending', 'leased', 'possibly_started', 'reconcile_required')
             ORDER BY aggregate_revision ASC LIMIT 1`,
          )
          .get(taskId) as Record<string, unknown> | undefined;
        return row ? this.commandFromRow(row) : null;
      },
      commit: async ({ event, digest, acceptance }) => {
        const now = event.observedAt;
        const existing = this.db
          .prepare(
            "SELECT revision FROM task_engine_aggregate WHERE task_id = ?",
          )
          .get(event.taskId) as { revision: number } | undefined;
        if (existing) {
          if (acceptance.aggregate.revision !== existing.revision) {
            const changed = this.db
              .prepare(
                "UPDATE task_engine_aggregate SET schema_version = ?, revision = ?, payload_json = ?, updated_at = ? WHERE task_id = ? AND revision = ?",
              )
              .run(
                PERSISTED_TASK_SCHEMA_VERSION,
                acceptance.aggregate.revision,
                json(acceptance.aggregate),
                now,
                event.taskId,
                acceptance.aggregate.revision - 1,
              );
            if (changed.changes !== 1)
              throw new Error("Task aggregate revision conflict.");
          }
        } else {
          if (acceptance.aggregate.revision !== 1)
            throw new Error("New task aggregate must begin at revision one.");
          this.db
            .prepare(
              "INSERT INTO task_engine_aggregate(task_id, schema_version, revision, payload_json, updated_at) VALUES (?, ?, ?, ?, ?)",
            )
            .run(
              event.taskId,
              PERSISTED_TASK_SCHEMA_VERSION,
              acceptance.aggregate.revision,
              json(acceptance.aggregate),
              now,
            );
        }
        this.db
          .prepare(
            `INSERT INTO task_engine_event(task_id, event_id, source_kind, source_id,
            source_generation, source_position, digest, payload_json, acceptance_json, accepted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            event.taskId,
            event.eventId,
            event.source.kind,
            event.source.id,
            event.source.generation,
            event.source.position,
            digest,
            json(event),
            json({ ...acceptance, duplicate: false }),
            now,
          );
        if (!existing || acceptance.aggregate.revision !== existing.revision)
          this.db
            .prepare(
              `INSERT INTO task_engine_projection(task_id, revision, schema_version, payload_json, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(task_id) DO UPDATE SET revision = excluded.revision,
                schema_version = excluded.schema_version,
                payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
            )
            .run(
              event.taskId,
              acceptance.projection.revision,
              PERSISTED_TASK_SCHEMA_VERSION,
              json(acceptance.projection),
              now,
            );
        if (event.type === "command_outcome_observed") {
          const command = this.db
            .prepare(
              "SELECT attempts FROM task_engine_outbox WHERE command_id = ?",
            )
            .get(event.commandId) as { attempts: number } | undefined;
          if (!command)
            throw new Error("Command outcome target was not found.");
          const status =
            event.status === "unresolved"
              ? command.attempts >= MAX_AUTOMATIC_COMMAND_ATTEMPTS
                ? "failed"
                : "reconcile_required"
              : event.status;
          const changed = this.db
            .prepare(
              `UPDATE task_engine_outbox SET status = ?, lease_owner = NULL,
              lease_generation = NULL, lease_expires_at = NULL, updated_at = ?
              WHERE command_id = ? AND status IN ('leased', 'possibly_started', 'reconcile_required')`,
            )
            .run(status, now, event.commandId);
          if (changed.changes !== 1)
            throw new Error("Command outcome transition is invalid.");
        }
        if (acceptance.command) this.insertCommand(acceptance.command);
      },
    };
  }

  private insertCommand(command: TaskCommand): void {
    this.db
      .prepare(
        `INSERT INTO task_engine_outbox(command_id, task_id, aggregate_revision,
        command_type, classification_json, payload_json, status, attempts,
        lease_owner, lease_generation, lease_expires_at, lease_origin, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        command.commandId,
        command.taskId,
        command.aggregateRevision,
        command.type,
        json(command.classification),
        json(command.payload),
        command.status,
        command.createdAt,
        command.createdAt,
      );
  }

  private readCommand(commandId: string): TaskCommand | null {
    const row = this.db
      .prepare("SELECT * FROM task_engine_outbox WHERE command_id = ?")
      .get(commandId) as Record<string, unknown> | undefined;
    return row ? this.commandFromRow(row) : null;
  }

  private commandFromRow(row: Record<string, unknown>): TaskCommand {
    return {
      schemaVersion: 1,
      commandId: String(row.command_id),
      taskId: String(row.task_id),
      aggregateRevision: Number(row.aggregate_revision),
      type: String(row.command_type) as TaskCommand["type"],
      classification: parse<TaskCommand["classification"]>(
        String(row.classification_json),
      ),
      payload: parse<TaskCommand["payload"]>(String(row.payload_json)),
      status: String(row.status) as TaskCommand["status"],
      attempts: Number(row.attempts),
      createdAt: String(row.created_at),
      ...(row.lease_origin === "pending" ||
      row.lease_origin === "reconcile_required"
        ? { claimedFrom: row.lease_origin }
        : {}),
    };
  }

  async claimDueCommands(
    workerId: string,
    generation: number,
    limit: number,
    options: { excludeTaskIds?: readonly string[] } = {},
  ): Promise<TaskCommand[]> {
    if (!Number.isSafeInteger(generation) || generation < 1)
      throw new Error("Worker generation is invalid.");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Command claim limit is invalid.");
    const now = this.now();
    const expiresAt = new Date(
      Date.parse(now) + this.leaseMilliseconds,
    ).toISOString();
    const excludedTaskIds = [...new Set(options.excludeTaskIds ?? [])];
    const exclusion =
      excludedTaskIds.length === 0
        ? ""
        : ` AND task_id NOT IN (${excludedTaskIds.map(() => "?").join(", ")})`;
    const claim = this.db.transaction(() => {
      return this.db
        .prepare(
          `UPDATE task_engine_outbox
        SET lease_origin = CASE
              WHEN status = 'leased' THEN COALESCE(lease_origin, 'pending')
              ELSE status
            END,
            status = 'leased', attempts = attempts + 1, lease_owner = ?,
            lease_generation = ?, lease_expires_at = ?, updated_at = ?
        WHERE command_id IN (
          SELECT command_id FROM task_engine_outbox
          WHERE (status IN ('pending', 'reconcile_required')
             OR (status = 'leased' AND lease_expires_at <= ?))${exclusion}
          ORDER BY aggregate_revision ASC LIMIT ?
        )
        RETURNING *`,
        )
        .all(
          workerId,
          generation,
          expiresAt,
          now,
          now,
          ...excludedTaskIds,
          limit,
        ) as Record<string, unknown>[];
    });
    return claim.immediate().map((row) => this.commandFromRow(row));
  }

  async projection(taskId: string): Promise<TaskProjection | null> {
    const row = this.db
      .prepare(
        "SELECT schema_version, payload_json FROM task_engine_projection WHERE task_id = ?",
      )
      .get(taskId) as
      { schema_version: number; payload_json: string } | undefined;
    if (row && row.schema_version !== PERSISTED_TASK_SCHEMA_VERSION)
      throw new Error("Unsupported persisted task projection version.");
    return row ? normalizeProjection(row.payload_json) : null;
  }

  async projections(): Promise<TaskProjection[]> {
    return (
      this.db
        .prepare(
          "SELECT schema_version, payload_json FROM task_engine_projection ORDER BY rowid",
        )
        .all() as { schema_version: number; payload_json: string }[]
    ).map((row) => {
      if (row.schema_version !== PERSISTED_TASK_SCHEMA_VERSION)
        throw new Error("Unsupported persisted task projection version.");
      return normalizeProjection(row.payload_json);
    });
  }

  async aggregate(taskId: string): Promise<TaskAggregate | null> {
    const row = this.db
      .prepare(
        "SELECT schema_version, payload_json FROM task_engine_aggregate WHERE task_id = ?",
      )
      .get(taskId) as
      { schema_version: number; payload_json: string } | undefined;
    if (row && row.schema_version !== PERSISTED_TASK_SCHEMA_VERSION)
      throw new Error("Unsupported persisted task aggregate version.");
    return row ? normalizeAggregate(row.payload_json) : null;
  }

  async markPossiblyStarted(commandId: string): Promise<void> {
    const changed = this.db
      .prepare(
        "UPDATE task_engine_outbox SET status = 'possibly_started', updated_at = ? WHERE command_id = ? AND status = 'leased'",
      )
      .run(this.now(), commandId);
    if (changed.changes !== 1)
      throw new Error("Command dispatch transition is invalid.");
  }

  async markRecoveryRequired(taskId: string, reason: string): Promise<void> {
    const aggregate = await this.aggregate(taskId);
    if (!aggregate) throw new Error("Recovery target task was not found.");
    aggregate.recoveryRequired = reason.slice(0, 240);
    const projection = await this.projection(taskId);
    if (!projection)
      throw new Error("Recovery target projection was not found.");
    projection.phase = "failed";
    projection.recoveryRequired = aggregate.recoveryRequired;
    const now = this.now();
    const update = this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE task_engine_aggregate SET payload_json = ?, updated_at = ? WHERE task_id = ?",
        )
        .run(json(aggregate), now, taskId);
      this.db
        .prepare(
          "UPDATE task_engine_projection SET payload_json = ?, updated_at = ? WHERE task_id = ?",
        )
        .run(json(projection), now, taskId);
    });
    update.immediate();
  }

  close(): void {
    this.db.pragma("wal_checkpoint(TRUNCATE)");
    this.db.close();
  }
}
