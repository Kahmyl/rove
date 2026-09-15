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
import {
  emptyTaskAggregate,
  projectTaskAggregate,
  taskEventDigest,
} from "@rove/protocol";
import {
  newWorkflowEntry,
  textDigest,
  validateWorkflowConfiguration,
  validateWorkflowName,
  workflowConfigurationDigest,
  type WorkflowConfiguration,
  type WorkflowEnvironment,
  type WorkflowPromotionCategory,
  type WorkflowRevision,
  type WorkflowStore,
} from "./workflows.js";
import {
  newResultId,
  taskActionMaterialDigest,
  taskResultRevisionDigest,
  validateTaskResult,
  type ResultStore,
  type TaskResult,
  type TaskResultKind,
  type TaskResultLifecycle,
  type TaskResultSource,
} from "./results.js";
import {
  validatePortableWorkflowSnapshot,
  type PortableWorkflowSnapshot,
} from "./workflow-portability.js";

const MIGRATION_ID = "0002_task_engine_event_aggregate_outbox";
const WORKFLOW_MIGRATION_ID = "0003_add_workflow_configuration";
const RESULT_MIGRATION_ID = "0004_add_task_results";
const RESULT_SELECTION_MIGRATION_ID = "0005_bind_selected_result_revision";
const RESULT_CONTEXT_CONSUMPTION_MIGRATION_ID =
  "0006_atomically_consume_selected_results";
const PERSISTED_TASK_SCHEMA_VERSION = 3;
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
  onSelectedResultConsumption?: (input: {
    eventId: string;
    resultId: string;
    position: number;
  }) => void;
}

/** The single production lifecycle ledger. Every accepted event, aggregate,
 * projection and next command is committed by one IMMEDIATE transaction. */
export class SqliteTaskEngineStore
  implements TaskEngineStore, WorkflowStore, ResultStore
{
  private readonly db: Database.Database;
  private readonly now: () => string;
  private readonly leaseMilliseconds: number;
  private readonly taskWorkspaceRoot: string | undefined;
  private readonly onSelectedResultConsumption:
    SqliteTaskEngineStoreOptions["onSelectedResultConsumption"] | undefined;
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
    this.onSelectedResultConsumption = options.onSelectedResultConsumption;
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
          "SELECT task_id, schema_version, payload_json, updated_at FROM task_engine_aggregate",
        )
        .all() as Array<{
        task_id: string;
        schema_version: number;
        payload_json: string;
        updated_at: string;
      }>;
      for (const row of aggregates) {
        if (![1, 2, PERSISTED_TASK_SCHEMA_VERSION].includes(row.schema_version))
          throw new Error("Unsupported persisted task aggregate version.");
        const aggregate = normalizeAggregate(row.payload_json);
        if (
          aggregate.desiredState === "closed" &&
          aggregate.record?.desiredState === "closed" &&
          aggregate.record.closeOperation?.stage === "complete"
        ) {
          aggregate.desiredState = "open";
          aggregate.record.desiredState = "open";
          delete aggregate.record.closeOperation;
        }
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
        this.db
          .prepare(
            `INSERT OR IGNORE INTO task_history_preference(task_id, archived, updated_at)
             VALUES (?, 0, ?)`,
          )
          .run(row.task_id, row.updated_at);
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
        if (![1, 2, PERSISTED_TASK_SCHEMA_VERSION].includes(row.schema_version))
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
      CREATE TABLE IF NOT EXISTS task_history_operation (
        operation_id TEXT PRIMARY KEY,
        request_digest TEXT NOT NULL,
        task_id TEXT NOT NULL,
        archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
        accepted_at TEXT NOT NULL,
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
      CREATE TABLE IF NOT EXISTS workflow_conflict_resolution (
        operation_id TEXT PRIMARY KEY REFERENCES workflow_operation(operation_id) ON DELETE RESTRICT,
        request_digest TEXT NOT NULL,
        workflow_id TEXT NOT NULL REFERENCES workflow_environment(workflow_id) ON DELETE RESTRICT,
        copy_workflow_id TEXT NOT NULL REFERENCES workflow_environment(workflow_id) ON DELETE RESTRICT,
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
      CREATE TABLE IF NOT EXISTS task_result (
        result_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES task_engine_aggregate(task_id) ON DELETE RESTRICT,
        turn_id TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('finding_collection', 'draft', 'report', 'journey', 'artifact', 'action')),
        lifecycle TEXT NOT NULL CHECK (lifecycle IN ('prepared', 'authorized', 'dispatched', 'confirmed', 'failed', 'unresolved')),
        selected INTEGER NOT NULL CHECK (selected IN (0, 1)),
        current_revision INTEGER NOT NULL CHECK (current_revision > 0),
        source_json TEXT NOT NULL CHECK (json_valid(source_json)),
        action_material_json TEXT CHECK (action_material_json IS NULL OR json_valid(action_material_json)),
        material_digest TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS task_result_by_task
        ON task_result(task_id, updated_at, result_id);
      CREATE TABLE IF NOT EXISTS task_result_revision (
        result_id TEXT NOT NULL REFERENCES task_result(result_id) ON DELETE RESTRICT,
        revision INTEGER NOT NULL CHECK (revision > 0),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        artifact_ids_json TEXT NOT NULL CHECK (json_valid(artifact_ids_json)),
        digest TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(result_id, revision)
      );
      CREATE TABLE IF NOT EXISTS task_result_operation (
        operation_id TEXT PRIMARY KEY,
        request_digest TEXT NOT NULL,
        result_id TEXT NOT NULL REFERENCES task_result(result_id) ON DELETE RESTRICT,
        result_revision INTEGER NOT NULL,
        accepted_at TEXT NOT NULL,
        FOREIGN KEY(result_id, result_revision) REFERENCES task_result_revision(result_id, revision) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS task_result_selection (
        result_id TEXT PRIMARY KEY REFERENCES task_result(result_id) ON DELETE RESTRICT,
        task_id TEXT NOT NULL REFERENCES task_engine_aggregate(task_id) ON DELETE RESTRICT,
        revision INTEGER NOT NULL CHECK (revision > 0),
        digest TEXT NOT NULL,
        selected_at TEXT NOT NULL,
        FOREIGN KEY(result_id, revision)
          REFERENCES task_result_revision(result_id, revision) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS task_result_context_consumption (
        task_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        result_id TEXT NOT NULL,
        result_revision INTEGER NOT NULL CHECK (result_revision > 0),
        result_digest TEXT NOT NULL,
        consumed_at TEXT NOT NULL,
        PRIMARY KEY(task_id, event_id, result_id),
        UNIQUE(task_id, event_id, position),
        FOREIGN KEY(task_id, event_id)
          REFERENCES task_engine_event(task_id, event_id) ON DELETE RESTRICT,
        FOREIGN KEY(result_id, result_revision)
          REFERENCES task_result_revision(result_id, revision) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS workflow_result_promotion_provenance (
        operation_id TEXT PRIMARY KEY REFERENCES workflow_operation(operation_id) ON DELETE RESTRICT,
        workflow_id TEXT NOT NULL REFERENCES workflow_environment(workflow_id) ON DELETE RESTRICT,
        revision INTEGER NOT NULL,
        source_task_id TEXT NOT NULL REFERENCES task_engine_aggregate(task_id) ON DELETE RESTRICT,
        source_result_id TEXT NOT NULL REFERENCES task_result(result_id) ON DELETE RESTRICT,
        source_result_revision INTEGER NOT NULL,
        source_text_digest TEXT NOT NULL,
        promoted_at TEXT NOT NULL,
        FOREIGN KEY(workflow_id, revision) REFERENCES workflow_revision(workflow_id, revision) ON DELETE RESTRICT,
        FOREIGN KEY(source_result_id, source_result_revision)
          REFERENCES task_result_revision(result_id, revision) ON DELETE RESTRICT
      );
      INSERT OR IGNORE INTO schema_migration(migration_id, applied_at, compatibility_json)
      VALUES ('${MIGRATION_ID}', datetime('now'), '{"minReader":2,"minWriter":2}');
      INSERT OR IGNORE INTO schema_migration(migration_id, applied_at, compatibility_json)
      VALUES ('${WORKFLOW_MIGRATION_ID}', datetime('now'), '{"minReader":2,"minWriter":2}');
      INSERT OR IGNORE INTO schema_migration(migration_id, applied_at, compatibility_json)
      VALUES ('${RESULT_MIGRATION_ID}', datetime('now'), '{"minReader":2,"minWriter":2}');
      INSERT OR IGNORE INTO task_result_selection(result_id, task_id, revision, digest, selected_at)
      SELECT result.result_id, result.task_id, result.current_revision, revision.digest, result.updated_at
      FROM task_result result
      JOIN task_result_revision revision
        ON revision.result_id = result.result_id
       AND revision.revision = result.current_revision
      WHERE result.selected = 1;
      INSERT OR IGNORE INTO schema_migration(migration_id, applied_at, compatibility_json)
      VALUES ('${RESULT_SELECTION_MIGRATION_ID}', datetime('now'), '{"minReader":2,"minWriter":2}');
      INSERT OR IGNORE INTO schema_migration(migration_id, applied_at, compatibility_json)
      VALUES ('${RESULT_CONTEXT_CONSUMPTION_MIGRATION_ID}', datetime('now'), '{"minReader":2,"minWriter":2}');
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

  /** Applies only the allowlisted portable Workflow projection. Task, result,
   * attachment, browser and execution tables are intentionally unreachable. */
  applyPortableWorkflowSnapshot(
    input: PortableWorkflowSnapshot,
  ): WorkflowEnvironment {
    const snapshot = validatePortableWorkflowSnapshot(input);
    const current = this.workflow(snapshot.workflowId);
    if (current && current.currentRevision === snapshot.configurationRevision) {
      if (
        current.name === snapshot.name &&
        current.archived === snapshot.archived &&
        current.revision.approvedAt === snapshot.approvedAt &&
        workflowConfigurationDigest(current.revision.configuration) ===
          workflowConfigurationDigest(snapshot.configuration)
      )
        return current;
      throw new Error(
        "Portable Workflow revision conflicts with local configuration.",
      );
    }
    if (current && snapshot.configurationRevision < current.currentRevision)
      throw new Error(
        "Portable Workflow revision is older than local configuration.",
      );
    const apply = this.db.transaction(() => {
      if (!current) {
        this.db
          .prepare(
            `INSERT INTO workflow_environment(workflow_id,name,current_revision,archived,created_at,updated_at)
          VALUES(?,?,?,?,?,?)`,
          )
          .run(
            snapshot.workflowId,
            snapshot.name,
            snapshot.configurationRevision,
            snapshot.archived ? 1 : 0,
            snapshot.approvedAt,
            snapshot.approvedAt,
          );
      } else {
        this.db
          .prepare(
            `UPDATE workflow_environment SET name=?,current_revision=?,archived=?,updated_at=?
          WHERE workflow_id=? AND current_revision=?`,
          )
          .run(
            snapshot.name,
            snapshot.configurationRevision,
            snapshot.archived ? 1 : 0,
            snapshot.approvedAt,
            snapshot.workflowId,
            current.currentRevision,
          );
      }
      this.db
        .prepare(
          `INSERT INTO workflow_revision(workflow_id,revision,configuration_json,digest,approved_at)
        VALUES(?,?,?,?,?)`,
        )
        .run(
          snapshot.workflowId,
          snapshot.configurationRevision,
          json(snapshot.configuration),
          workflowConfigurationDigest(snapshot.configuration),
          snapshot.approvedAt,
        );
    });
    apply.immediate();
    return this.workflow(snapshot.workflowId)!;
  }

  replacePortableWorkflowSnapshot(
    input: PortableWorkflowSnapshot,
  ): WorkflowEnvironment {
    const snapshot = validatePortableWorkflowSnapshot(input);
    const current = this.workflow(snapshot.workflowId);
    if (!current || snapshot.configurationRevision > current.currentRevision)
      return this.applyPortableWorkflowSnapshot(snapshot);
    const revision = current.currentRevision + 1;
    const approvedAt = this.now();
    const replace = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO workflow_revision(workflow_id,revision,configuration_json,digest,approved_at) VALUES(?,?,?,?,?)`,
        )
        .run(
          snapshot.workflowId,
          revision,
          json(snapshot.configuration),
          workflowConfigurationDigest(snapshot.configuration),
          approvedAt,
        );
      this.db
        .prepare(
          `UPDATE workflow_environment SET name=?,current_revision=?,archived=?,updated_at=? WHERE workflow_id=? AND current_revision=?`,
        )
        .run(
          snapshot.name,
          revision,
          snapshot.archived ? 1 : 0,
          approvedAt,
          snapshot.workflowId,
          current.currentRevision,
        );
    });
    replace.immediate();
    return this.workflow(snapshot.workflowId)!;
  }

  createPortableWorkflowCopy(
    input: PortableWorkflowSnapshot,
  ): WorkflowEnvironment {
    const snapshot = validatePortableWorkflowSnapshot(input);
    const suffix = " (local copy)";
    const name =
      snapshot.name.length + suffix.length <= 120
        ? `${snapshot.name}${suffix}`
        : `${snapshot.name.slice(0, 120 - suffix.length)}${suffix}`;
    return this.createWorkflow({
      operationId: `workflow_operation_${randomUUID()}`,
      name,
      configuration: snapshot.configuration,
    });
  }

  resolvePortableWorkflowConflict(input: {
    operationId: string;
    workflowId: string;
    remote: PortableWorkflowSnapshot;
  }): { workflow: WorkflowEnvironment; copy: WorkflowEnvironment } {
    const remote = validatePortableWorkflowSnapshot(input.remote);
    if (remote.workflowId !== input.workflowId)
      throw new Error("Portable Workflow conflict identity is invalid.");
    const current = this.workflow(input.workflowId);
    if (!current) throw new Error("Workflow is unavailable.");
    const requestDigest = this.workflowRequestDigest({
      type: "resolve_portable_conflict_keep_both",
      workflowId: input.workflowId,
      remoteDigest: remote.digest,
    });
    const prior = this.db
      .prepare(
        `SELECT request_digest,workflow_id,copy_workflow_id
         FROM workflow_conflict_resolution WHERE operation_id=?`,
      )
      .get(input.operationId) as
      | {
          request_digest: string;
          workflow_id: string;
          copy_workflow_id: string;
        }
      | undefined;
    if (prior) {
      if (
        prior.request_digest !== requestDigest ||
        prior.workflow_id !== input.workflowId
      )
        throw new Error(
          "Workflow conflict resolution identity was reused with different input.",
        );
      const workflow = this.workflow(prior.workflow_id);
      const copy = this.workflow(prior.copy_workflow_id);
      if (!workflow || !copy)
        throw new Error("Workflow conflict resolution result is unavailable.");
      return { workflow, copy };
    }

    const copyWorkflowId = `workflow_${randomUUID()}`;
    const suffix = " (local copy)";
    const copyName =
      current.name.length + suffix.length <= 120
        ? `${current.name}${suffix}`
        : `${current.name.slice(0, 120 - suffix.length)}${suffix}`;
    const copyDigest = workflowConfigurationDigest(
      current.revision.configuration,
    );
    const nextRevision = current.currentRevision + 1;
    const remoteDigest = workflowConfigurationDigest(remote.configuration);
    const now = this.now();
    const resolve = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO workflow_environment(workflow_id,name,current_revision,archived,created_at,updated_at)
           VALUES(?,?,1,?,?,?)`,
        )
        .run(copyWorkflowId, copyName, current.archived ? 1 : 0, now, now);
      this.db
        .prepare(
          `INSERT INTO workflow_revision(workflow_id,revision,configuration_json,digest,approved_at)
           VALUES(?,1,?,?,?)`,
        )
        .run(
          copyWorkflowId,
          json(current.revision.configuration),
          copyDigest,
          now,
        );
      this.db
        .prepare(
          `INSERT INTO workflow_revision(workflow_id,revision,configuration_json,digest,approved_at)
           VALUES(?,?,?,?,?)`,
        )
        .run(
          input.workflowId,
          nextRevision,
          json(remote.configuration),
          remoteDigest,
          now,
        );
      const changed = this.db
        .prepare(
          `UPDATE workflow_environment SET name=?,current_revision=?,archived=?,updated_at=?
           WHERE workflow_id=? AND current_revision=?`,
        )
        .run(
          remote.name,
          nextRevision,
          remote.archived ? 1 : 0,
          now,
          input.workflowId,
          current.currentRevision,
        );
      if (changed.changes !== 1) throw new Error("Workflow revision conflict.");
      this.db
        .prepare(
          `INSERT INTO workflow_operation(operation_id,request_digest,workflow_id,result_revision,accepted_at)
           VALUES(?,?,?,?,?)`,
        )
        .run(input.operationId, requestDigest, copyWorkflowId, 1, now);
      this.db
        .prepare(
          `INSERT INTO workflow_conflict_resolution(operation_id,request_digest,workflow_id,copy_workflow_id,accepted_at)
           VALUES(?,?,?,?,?)`,
        )
        .run(
          input.operationId,
          requestDigest,
          input.workflowId,
          copyWorkflowId,
          now,
        );
    });
    resolve.immediate();
    return {
      workflow: this.workflow(input.workflowId)!,
      copy: this.workflow(copyWorkflowId)!,
    };
  }

  promoteToWorkflow(input: {
    operationId: string;
    workflowId: string;
    expectedRevision: number;
    category: WorkflowPromotionCategory;
    text: string;
    appliesTo: readonly string[];
    sourceTaskId: string;
    sourceItemId?: string;
    sourceResultId?: string;
    sourceResultRevision?: number;
    sourceTextDigest: string;
  }): WorkflowEnvironment {
    if (Boolean(input.sourceItemId) === Boolean(input.sourceResultId))
      throw new Error("Workflow promotion requires exactly one source.");
    if (
      input.sourceResultId &&
      (!Number.isSafeInteger(input.sourceResultRevision) ||
        input.sourceResultRevision! < 1)
    )
      throw new Error("Workflow result promotion revision is invalid.");
    if (input.sourceResultId) {
      const source = this.result(input.sourceTaskId, input.sourceResultId);
      if (
        !source ||
        source.currentRevision !== input.sourceResultRevision ||
        textDigest(source.revision.body) !== input.sourceTextDigest
      )
        throw new Error(
          "Workflow result promotion source is stale or belongs to another task.",
        );
    }
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
          input.sourceItemId ?? `result:${input.sourceResultId}`,
          input.sourceTextDigest,
          now,
        );
      if (input.sourceResultId)
        this.db
          .prepare(
            `INSERT INTO workflow_result_promotion_provenance(operation_id, workflow_id, revision,
             source_task_id, source_result_id, source_result_revision, source_text_digest, promoted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.operationId,
            input.workflowId,
            nextRevision,
            input.sourceTaskId,
            input.sourceResultId,
            input.sourceResultRevision,
            input.sourceTextDigest,
            now,
          );
    });
    promote.immediate();
    return this.workflow(input.workflowId)!;
  }

  private resultFromRow(row: {
    result_id: string;
    task_id: string;
    turn_id: string | null;
    kind: TaskResultKind;
    lifecycle: TaskResultLifecycle;
    selected: number;
    current_revision: number;
    source_json: string;
    action_material_json: string | null;
    material_digest: string | null;
    created_at: string;
    updated_at: string;
    title: string;
    body: string;
    artifact_ids_json: string;
    digest: string;
    revision_created_at: string;
    selected_revision: number | null;
    selected_digest: string | null;
    selected_title: string | null;
    selected_body: string | null;
    selected_artifact_ids_json: string | null;
    selected_revision_created_at: string | null;
  }): TaskResult {
    return validateTaskResult({
      resultId: row.result_id,
      taskId: row.task_id,
      ...(row.turn_id ? { turnId: row.turn_id } : {}),
      kind: row.kind,
      lifecycle: row.lifecycle,
      selected: row.selected === 1,
      currentRevision: row.current_revision,
      revision: {
        resultId: row.result_id,
        revision: row.current_revision,
        title: row.title,
        body: row.body,
        artifactIds: parse<string[]>(row.artifact_ids_json),
        digest: row.digest,
        createdAt: row.revision_created_at,
      },
      ...(row.selected_revision &&
      row.selected_digest &&
      row.selected_title &&
      row.selected_body &&
      row.selected_artifact_ids_json &&
      row.selected_revision_created_at
        ? {
            selectedRevision: {
              resultId: row.result_id,
              revision: row.selected_revision,
              title: row.selected_title,
              body: row.selected_body,
              artifactIds: parse<string[]>(row.selected_artifact_ids_json),
              digest: row.selected_digest,
              createdAt: row.selected_revision_created_at,
            },
          }
        : {}),
      source: parse<TaskResultSource>(row.source_json),
      ...(row.action_material_json
        ? { actionMaterial: parse(row.action_material_json) }
        : {}),
      ...(row.material_digest ? { materialDigest: row.material_digest } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  listResults(taskId?: string): readonly TaskResult[] {
    const rows = this.db
      .prepare(
        `SELECT result.*, revision.title, revision.body, revision.artifact_ids_json,
                revision.digest, revision.created_at AS revision_created_at,
                selection.revision AS selected_revision,
                selection.digest AS selected_digest,
                selected_revision.title AS selected_title,
                selected_revision.body AS selected_body,
                selected_revision.artifact_ids_json AS selected_artifact_ids_json,
                selected_revision.created_at AS selected_revision_created_at
         FROM task_result result
         JOIN task_result_revision revision
           ON revision.result_id = result.result_id
          AND revision.revision = result.current_revision
         LEFT JOIN task_result_selection selection
           ON selection.result_id = result.result_id
          AND selection.task_id = result.task_id
         LEFT JOIN task_result_revision selected_revision
           ON selected_revision.result_id = selection.result_id
          AND selected_revision.revision = selection.revision
         ${taskId ? "WHERE result.task_id = ?" : ""}
         ORDER BY result.updated_at DESC, result.result_id ASC`,
      )
      .all(...(taskId ? [taskId] : [])) as Parameters<
      SqliteTaskEngineStore["resultFromRow"]
    >[0][];
    return rows.map((row) => this.resultFromRow(row));
  }

  result(taskId: string, resultId: string): TaskResult | null {
    return (
      this.listResults(taskId).find((entry) => entry.resultId === resultId) ??
      null
    );
  }

  private priorResultOperation(
    operationId: string,
    requestDigest: string,
  ): TaskResult | null {
    const row = this.db
      .prepare(
        `SELECT operation.request_digest, result.task_id, operation.result_id
         FROM task_result_operation operation
         JOIN task_result result ON result.result_id = operation.result_id
         WHERE operation.operation_id = ?`,
      )
      .get(operationId) as
      | { request_digest: string; task_id: string; result_id: string }
      | undefined;
    if (!row) return null;
    if (row.request_digest !== requestDigest)
      throw new Error(
        "Result operation identity was reused with different input.",
      );
    const result = this.result(row.task_id, row.result_id);
    if (!result) throw new Error("Result operation outcome is unavailable.");
    return result;
  }

  private createStoredResult(input: {
    operationId: string;
    taskId: string;
    turnId?: string;
    kind: TaskResultKind;
    title: string;
    body: string;
    artifactIds?: readonly string[];
    source: TaskResultSource;
    actionMaterial?: NonNullable<TaskResult["actionMaterial"]>;
  }): TaskResult {
    const title = input.title.trim();
    const body = input.body.trim();
    const artifactIds = [...(input.artifactIds ?? [])];
    const materialDigest = input.actionMaterial
      ? taskActionMaterialDigest(input.actionMaterial)
      : undefined;
    const requestDigest = this.workflowRequestDigest({
      type: "result.create",
      ...input,
      title,
      body,
      artifactIds,
      materialDigest,
    });
    const prior = this.priorResultOperation(input.operationId, requestDigest);
    if (prior) return prior;
    const resultId = newResultId();
    const now = this.now();
    const digest = taskResultRevisionDigest({ title, body, artifactIds });
    const candidate = validateTaskResult({
      resultId,
      taskId: input.taskId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      kind: input.kind,
      lifecycle: "prepared",
      selected: false,
      currentRevision: 1,
      revision: {
        resultId,
        revision: 1,
        title,
        body,
        artifactIds,
        digest,
        createdAt: now,
      },
      source: input.source,
      ...(input.actionMaterial
        ? {
            actionMaterial: input.actionMaterial,
            materialDigest: taskActionMaterialDigest(input.actionMaterial),
          }
        : {}),
      createdAt: now,
      updatedAt: now,
    });
    const create = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO task_result(result_id, task_id, turn_id, kind, lifecycle, selected,
           current_revision, source_json, action_material_json, material_digest, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'prepared', 0, 1, ?, ?, ?, ?, ?)`,
        )
        .run(
          resultId,
          candidate.taskId,
          candidate.turnId ?? null,
          candidate.kind,
          json(candidate.source),
          candidate.actionMaterial ? json(candidate.actionMaterial) : null,
          candidate.materialDigest ?? null,
          now,
          now,
        );
      this.db
        .prepare(
          `INSERT INTO task_result_revision(result_id, revision, title, body, artifact_ids_json, digest, created_at)
           VALUES (?, 1, ?, ?, ?, ?, ?)`,
        )
        .run(resultId, title, body, json(artifactIds), digest, now);
      this.db
        .prepare(
          `INSERT INTO task_result_operation(operation_id, request_digest, result_id, result_revision, accepted_at)
           VALUES (?, ?, ?, 1, ?)`,
        )
        .run(input.operationId, requestDigest, resultId, now);
    });
    create.immediate();
    return this.result(candidate.taskId, resultId)!;
  }

  createResult(input: Parameters<ResultStore["createResult"]>[0]): TaskResult {
    return this.createStoredResult(input);
  }

  createAction(input: Parameters<ResultStore["createAction"]>[0]): TaskResult {
    return this.createStoredResult({
      ...input,
      kind: "action",
      actionMaterial: input.material,
    });
  }

  reviseDraft(input: Parameters<ResultStore["reviseDraft"]>[0]): TaskResult {
    const requestDigest = this.workflowRequestDigest(input);
    const prior = this.priorResultOperation(input.operationId, requestDigest);
    if (prior) return prior;
    const current = this.result(input.taskId, input.resultId);
    if (!current) throw new Error("Result is unavailable for this task.");
    if (current.kind !== "draft")
      throw new Error("Only drafts can be revised.");
    if (current.currentRevision !== input.expectedRevision)
      throw new Error("Result revision conflict. Refresh before saving.");
    const title = input.title.trim();
    const body = input.body.trim();
    const artifactIds = [...current.revision.artifactIds];
    const revision = current.currentRevision + 1;
    const digest = taskResultRevisionDigest({ title, body, artifactIds });
    validateTaskResult({
      ...current,
      currentRevision: revision,
      revision: {
        resultId: current.resultId,
        revision,
        title,
        body,
        artifactIds,
        digest,
        createdAt: this.now(),
      },
    });
    const now = this.now();
    const revise = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO task_result_revision(result_id, revision, title, body, artifact_ids_json, digest, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.resultId,
          revision,
          title,
          body,
          json(artifactIds),
          digest,
          now,
        );
      const changed = this.db
        .prepare(
          `UPDATE task_result SET current_revision = ?, updated_at = ?
           WHERE result_id = ? AND task_id = ? AND current_revision = ?`,
        )
        .run(
          revision,
          now,
          input.resultId,
          input.taskId,
          input.expectedRevision,
        );
      if (changed.changes !== 1) throw new Error("Result revision conflict.");
      this.db
        .prepare(
          `INSERT INTO task_result_operation(operation_id, request_digest, result_id, result_revision, accepted_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(input.operationId, requestDigest, input.resultId, revision, now);
    });
    revise.immediate();
    return this.result(input.taskId, input.resultId)!;
  }

  setResultSelected(
    input: Parameters<ResultStore["setResultSelected"]>[0],
  ): TaskResult {
    const requestDigest = this.workflowRequestDigest(input);
    const prior = this.priorResultOperation(input.operationId, requestDigest);
    if (prior) return prior;
    const current = this.result(input.taskId, input.resultId);
    if (!current) throw new Error("Result is unavailable for this task.");
    if (current.currentRevision !== input.expectedRevision)
      throw new Error("Result revision conflict. Refresh before selecting.");
    const now = this.now();
    const update = this.db.transaction(() => {
      if (input.selected) {
        this.db
          .prepare(
            `INSERT INTO task_result_selection(result_id, task_id, revision, digest, selected_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(result_id) DO UPDATE SET
               task_id = excluded.task_id,
               revision = excluded.revision,
               digest = excluded.digest,
               selected_at = excluded.selected_at`,
          )
          .run(
            input.resultId,
            input.taskId,
            input.expectedRevision,
            current.revision.digest,
            now,
          );
      } else {
        this.db
          .prepare(
            `DELETE FROM task_result_selection
             WHERE result_id = ? AND task_id = ?`,
          )
          .run(input.resultId, input.taskId);
      }
      const changed = this.db
        .prepare(
          `UPDATE task_result SET selected = ?, updated_at = ?
           WHERE result_id = ? AND task_id = ? AND current_revision = ?`,
        )
        .run(
          input.selected ? 1 : 0,
          now,
          input.resultId,
          input.taskId,
          input.expectedRevision,
        );
      if (changed.changes !== 1) throw new Error("Result revision conflict.");
      this.db
        .prepare(
          `INSERT INTO task_result_operation(operation_id, request_digest, result_id, result_revision, accepted_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.operationId,
          requestDigest,
          input.resultId,
          input.expectedRevision,
          now,
        );
    });
    update.immediate();
    return this.result(input.taskId, input.resultId)!;
  }

  transitionAction(
    input: Parameters<ResultStore["transitionAction"]>[0],
  ): TaskResult {
    const requestDigest = this.workflowRequestDigest(input);
    const prior = this.priorResultOperation(input.operationId, requestDigest);
    if (prior) return prior;
    const current = this.result(input.taskId, input.resultId);
    if (!current || current.kind !== "action")
      throw new Error("Action result is unavailable for this task.");
    if (current.lifecycle !== input.expectedLifecycle)
      throw new Error("Action result lifecycle conflict.");
    if (
      input.lifecycle === "authorized" &&
      input.materialDigest !== current.materialDigest
    )
      throw new Error("Action authorization does not match current material.");
    const allowed: Record<TaskResultLifecycle, readonly TaskResultLifecycle[]> =
      {
        prepared: ["authorized"],
        authorized: ["dispatched", "failed", "unresolved"],
        dispatched: ["confirmed", "failed", "unresolved"],
        unresolved: ["confirmed", "failed"],
        confirmed: [],
        failed: [],
      };
    if (!allowed[current.lifecycle].includes(input.lifecycle))
      throw new Error("Action result lifecycle transition is invalid.");
    if (
      ["dispatched", "confirmed"].includes(input.lifecycle) &&
      !input.evidenceIds?.length
    )
      throw new Error(
        "Dispatched and confirmed actions require host evidence.",
      );
    const now = this.now();
    const source = {
      ...current.source,
      evidenceIds: [
        ...new Set([
          ...current.source.evidenceIds,
          ...(input.evidenceIds ?? []),
        ]),
      ],
    };
    const transition = this.db.transaction(() => {
      const changed = this.db
        .prepare(
          `UPDATE task_result SET lifecycle = ?, source_json = ?, updated_at = ?
           WHERE result_id = ? AND task_id = ? AND lifecycle = ?`,
        )
        .run(
          input.lifecycle,
          json(source),
          now,
          input.resultId,
          input.taskId,
          input.expectedLifecycle,
        );
      if (changed.changes !== 1)
        throw new Error("Action result lifecycle conflict.");
      this.db
        .prepare(
          `INSERT INTO task_result_operation(operation_id, request_digest, result_id, result_revision, accepted_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.operationId,
          requestDigest,
          input.resultId,
          current.currentRevision,
          now,
        );
    });
    transition.immediate();
    return this.result(input.taskId, input.resultId)!;
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

  initializeTaskHistoryPreference(taskId: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO task_history_preference(
           task_id, archived, updated_at
         ) VALUES (?, 0, ?)`,
      )
      .run(taskId, this.now());
  }

  applyTaskHistoryPreference(input: {
    taskId: string;
    operationId: string;
    archived: boolean;
  }): { duplicate: boolean; archived: boolean } {
    const requestDigest = createHash("sha256")
      .update(json({ taskId: input.taskId, archived: input.archived }))
      .digest("hex");
    const apply = this.db.transaction(() => {
      const prior = this.db
        .prepare(
          `SELECT request_digest, archived
           FROM task_history_operation WHERE operation_id = ?`,
        )
        .get(input.operationId) as
        { request_digest: string; archived: number } | undefined;
      if (prior) {
        if (prior.request_digest !== requestDigest)
          throw new Error(
            "Task history operation identity was reused with different content.",
          );
        return { duplicate: true, archived: prior.archived === 1 };
      }
      const task = this.db
        .prepare(
          "SELECT payload_json FROM task_engine_aggregate WHERE task_id = ?",
        )
        .get(input.taskId) as { payload_json: string } | undefined;
      if (!task)
        throw new Error("Task history preference targets an unknown task.");
      if (
        input.archived &&
        normalizeAggregate(task.payload_json).codex.turn === "active"
      )
        throw new Error("Stop the current work before archiving this task.");
      const acceptedAt = this.now();
      this.db
        .prepare(
          `INSERT INTO task_history_preference(task_id, archived, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(task_id) DO UPDATE SET
             archived = excluded.archived,
             updated_at = excluded.updated_at`,
        )
        .run(input.taskId, input.archived ? 1 : 0, acceptedAt);
      this.db
        .prepare(
          `INSERT INTO task_history_operation(
             operation_id, request_digest, task_id, archived, accepted_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.operationId,
          requestDigest,
          input.taskId,
          input.archived ? 1 : 0,
          acceptedAt,
        );
      return { duplicate: false, archived: input.archived };
    });
    return apply.immediate();
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
        this.consumeAcceptedSelectedResults(event, acceptance, now);
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

  private consumeAcceptedSelectedResults(
    event: TaskEvent,
    acceptance: TaskAcceptance,
    consumedAt: string,
  ): void {
    if (
      (event.type !== "task_message_requested" &&
        event.type !== "explicit_continuation_response_requested") ||
      !event.selectedResultContext ||
      acceptance.projection.operationDisposition?.status === "rejected"
    )
      return;
    const references = event.selectedResultContext.references;
    for (const reference of references) {
      const row = this.db
        .prepare(
          `SELECT selection.revision, selection.digest,
                  revision.digest AS revision_digest, result.selected
           FROM task_result_selection selection
           JOIN task_result result
             ON result.result_id = selection.result_id
            AND result.task_id = selection.task_id
           JOIN task_result_revision revision
             ON revision.result_id = selection.result_id
            AND revision.revision = selection.revision
           WHERE selection.task_id = ? AND selection.result_id = ?`,
        )
        .get(event.taskId, reference.resultId) as
        | {
            revision: number;
            digest: string;
            revision_digest: string;
            selected: number;
          }
        | undefined;
      if (
        !row ||
        row.selected !== 1 ||
        row.revision !== reference.revision ||
        row.digest !== reference.digest ||
        row.revision_digest !== reference.digest
      )
        throw new Error(
          "Selected result changed before task acceptance. Refresh and select it again.",
        );
    }
    for (const [position, reference] of references.entries()) {
      const removed = this.db
        .prepare(
          `DELETE FROM task_result_selection
           WHERE task_id = ? AND result_id = ? AND revision = ? AND digest = ?`,
        )
        .run(
          event.taskId,
          reference.resultId,
          reference.revision,
          reference.digest,
        );
      const changed = this.db
        .prepare(
          `UPDATE task_result SET selected = 0, updated_at = ?
           WHERE task_id = ? AND result_id = ? AND selected = 1`,
        )
        .run(consumedAt, event.taskId, reference.resultId);
      if (removed.changes !== 1 || changed.changes !== 1)
        throw new Error(
          "Selected result changed before task acceptance. Refresh and select it again.",
        );
      this.db
        .prepare(
          `INSERT INTO task_result_context_consumption(
             task_id, event_id, operation_id, position, result_id,
             result_revision, result_digest, consumed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.taskId,
          event.eventId,
          event.operationId,
          position,
          reference.resultId,
          reference.revision,
          reference.digest,
          consumedAt,
        );
      this.onSelectedResultConsumption?.({
        eventId: event.eventId,
        resultId: reference.resultId,
        position,
      });
    }
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

  async acceptedEvent(
    taskId: string,
    eventId: string,
  ): Promise<{
    event: TaskEvent;
    digest: string;
    acceptance: TaskAcceptance;
  } | null> {
    const row = this.db
      .prepare(
        `SELECT digest, payload_json, acceptance_json
         FROM task_engine_event WHERE task_id = ? AND event_id = ?`,
      )
      .get(taskId, eventId) as
      | {
          digest: string;
          payload_json: string;
          acceptance_json: string;
        }
      | undefined;
    if (!row) return null;
    const event = parse<TaskEvent>(row.payload_json);
    if (taskEventDigest(event) !== row.digest)
      throw new Error("Stored task event digest is invalid.");
    return {
      event,
      digest: row.digest,
      acceptance: normalizeAcceptance(row.acceptance_json),
    };
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
