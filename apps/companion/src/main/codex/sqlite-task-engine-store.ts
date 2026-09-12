import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import Database from "better-sqlite3";
import type {
  TaskAcceptance,
  TaskAggregate,
  TaskCommand,
  TaskEngineStore,
  TaskEngineTransaction,
  TaskEvent,
  TaskProjection,
} from "@rove/protocol";
import { emptyTaskAggregate, projectTaskAggregate } from "@rove/protocol";

const MIGRATION_ID = "0002_task_engine_event_aggregate_outbox";
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
export class SqliteTaskEngineStore implements TaskEngineStore {
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
      INSERT OR IGNORE INTO schema_migration(migration_id, applied_at, compatibility_json)
      VALUES ('${MIGRATION_ID}', datetime('now'), '{"minReader":2,"minWriter":2}');
      COMMIT;
    `);
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
              browserIdentity: rawLaunch.browserIdentity as NonNullable<
                typeof aggregate.launch
              >["browserIdentity"],
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
