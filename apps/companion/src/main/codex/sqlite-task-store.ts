import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import { Kysely, SqliteDialect, type Transaction } from "kysely";
import type {
  TaskCommandStatus,
  TaskProcessCommand,
  TaskProcessDecision,
  TaskProcessProjection,
  TaskProcessState,
  TaskStore,
  TaskTransaction,
} from "@rove/protocol";
import {
  emptyTaskProcessDurableData,
  parseNativeLifecycleCommandType,
  validateTaskProcessDecision,
  validateTaskProcessDurableData,
} from "@rove/protocol";

interface LedgerDatabase {
  task_instance: {
    task_id: string;
    schema_version: number;
    sequence: number;
    ownership_generation: number;
    desired_state: string;
    reducer_state_json: string;
    frozen_launch_json: string | null;
    created_at: string;
    updated_at: string;
  };
  task_input: {
    input_id: string;
    task_id: string;
    sequence: number;
    schema_version: number;
    kind: string;
    source: string;
    source_id: string;
    payload_json: string;
    decision_json: string;
    observed_at: string;
  };
  task_command: {
    command_id: string;
    task_id: string;
    sequence: number;
    schema_version: number;
    command_type: string;
    payload_json: string;
    status: string;
    attempts: number;
    lease_owner: string | null;
    lease_generation: number | null;
    lease_expires_at: string | null;
    lease_origin: string | null;
    reconciliation_json: string | null;
    created_at: string;
    updated_at: string;
  };
  task_projection: {
    task_id: string;
    revision: number;
    schema_version: number;
    payload_json: string;
    updated_at: string;
  };
  task_binding: {
    binding_id: string;
    task_id: string;
    kind: string;
    external_id: string;
    ownership_generation: number;
    payload_json: string;
    updated_at: string;
  };
  task_handoff: {
    handoff_id: string;
    task_id: string;
    generation: number;
    status: string;
    payload_json: string;
    return_event_id: string | null;
    updated_at: string;
  };
  task_attention: {
    request_id: string;
    task_id: string;
    generation: number;
    status: string;
    payload_json: string;
    updated_at: string;
  };
  schema_migration: {
    migration_id: string;
    applied_at: string;
    compatibility_json: string;
  };
  legacy_import: {
    import_id: string;
    digest: string;
    source_revisions_json: string;
    backup_path: string;
    imported_at: string;
  };
  legacy_import_source: {
    import_id: string;
    source_name: string;
    schema_version: number;
    revision: number;
    payload_json: string;
  };
}

const MIGRATION_ID = "0001_durable_task_ledger";

function json(value: unknown): string {
  return JSON.stringify(value);
}

function parse<T>(value: string): T {
  return JSON.parse(value) as T;
}

class SqliteTaskTransaction implements TaskTransaction {
  constructor(private readonly tx: Transaction<LedgerDatabase>) {}

  async findInput(
    taskId: string,
    inputId: string,
  ): Promise<TaskProcessDecision | null> {
    const row = await this.tx
      .selectFrom("task_input")
      .select("decision_json")
      .where("task_id", "=", taskId)
      .where("input_id", "=", inputId)
      .executeTakeFirst();
    return row
      ? validateTaskProcessDecision(JSON.parse(row.decision_json))
      : null;
  }

  async currentSequence(taskId: string): Promise<number> {
    const row = await this.tx
      .selectFrom("task_instance")
      .select("sequence")
      .where("task_id", "=", taskId)
      .executeTakeFirst();
    return row?.sequence ?? 0;
  }

  async currentRecord(taskId: string) {
    const row = await this.tx
      .selectFrom("task_instance")
      .select("reducer_state_json")
      .where("task_id", "=", taskId)
      .executeTakeFirst();
    return row
      ? parse<TaskProcessDecision["record"]>(row.reducer_state_json)
      : null;
  }

  async currentLifecycle(taskId: string) {
    const row = await this.tx
      .selectFrom("task_input")
      .select("decision_json")
      .where("task_id", "=", taskId)
      .orderBy("sequence", "desc")
      .executeTakeFirst();
    if (!row) return null;
    const decision = validateTaskProcessDecision(JSON.parse(row.decision_json));
    return decision.lifecycle ?? decision.input.lifecycle;
  }

  async currentDurableData(taskId: string) {
    const [handoff, attentions, bindings, recordRow] = await Promise.all([
      this.tx
        .selectFrom("task_handoff")
        .select("payload_json")
        .where("task_id", "=", taskId)
        .orderBy("generation", "desc")
        .executeTakeFirst(),
      this.tx
        .selectFrom("task_attention")
        .select("payload_json")
        .where("task_id", "=", taskId)
        .orderBy("generation", "asc")
        .execute(),
      this.tx
        .selectFrom("task_binding")
        .select(["kind", "external_id"])
        .where("task_id", "=", taskId)
        .execute(),
      this.tx
        .selectFrom("task_instance")
        .select("reducer_state_json")
        .where("task_id", "=", taskId)
        .executeTakeFirst(),
    ]);
    const binding = new Map(
      bindings.map((row) => [row.kind, row.external_id] as const),
    );
    const record = recordRow
      ? parse<TaskProcessDecision["record"]>(recordRow.reducer_state_json)
      : null;
    const recordSessionId = record?.identity.sessionId;
    const recordThreadId = record?.identity.threadId;
    const boundSessionId = binding.get("runtime_session");
    const boundThreadId = binding.get("codex_thread");
    if (
      (recordSessionId &&
        boundSessionId &&
        recordSessionId !== boundSessionId) ||
      (recordThreadId && boundThreadId && recordThreadId !== boundThreadId)
    )
      throw new Error("Task bindings contradict the authoritative record.");
    const sessionId = boundSessionId ?? recordSessionId;
    const threadId = boundThreadId ?? recordThreadId;
    const codexSessionId = binding.get("codex_session");
    if (!handoff && attentions.length === 0 && !codexSessionId)
      return emptyTaskProcessDurableData();
    return validateTaskProcessDurableData(
      {
        schemaVersion: 1,
        continuation: handoff ? parse(handoff.payload_json) : null,
        attentions: attentions.map((row) => parse(row.payload_json)),
        codexSessionId: codexSessionId ?? null,
      },
      {
        taskId,
        ...(sessionId ? { sessionId } : {}),
        ...(threadId ? { threadId } : {}),
      },
    );
  }

  async commitDecision(decision: TaskProcessDecision): Promise<void> {
    const { input, output, projection, command } = decision;
    const now = input.observedAt;
    const desiredState = decision.record?.desiredState ?? "open";
    if (input.commandOutcome) {
      const outcome = input.commandOutcome;
      const nextStatus =
        outcome.status === "unresolved" ? "reconcile_required" : outcome.status;
      const allowedFrom =
        outcome.status === "accepted"
          ? ["leased"]
          : outcome.status === "unresolved"
            ? ["leased", "accepted", "possibly_started"]
            : ["accepted", "possibly_started"];
      const changed = await this.tx
        .updateTable("task_command")
        .set({
          status: nextStatus,
          reconciliation_json:
            outcome.detail === undefined ? null : json(outcome.detail),
          lease_owner: null,
          lease_generation: null,
          lease_expires_at: null,
          ...(outcome.status === "accepted" ? {} : { lease_origin: null }),
          updated_at: now,
        })
        .where("command_id", "=", outcome.commandId)
        .where("status", "in", allowedFrom)
        .executeTakeFirst();
      if (Number(changed.numUpdatedRows) !== 1)
        throw new Error("Command outcome does not match a legal transition.");
    }
    await this.tx
      .insertInto("task_instance")
      .values({
        task_id: input.taskId,
        schema_version: 1,
        sequence: projection.sequence,
        ownership_generation: 1,
        desired_state: desiredState,
        reducer_state_json: json(decision.record),
        frozen_launch_json:
          input.launchConfiguration === undefined
            ? null
            : json(input.launchConfiguration),
        created_at: now,
        updated_at: now,
      })
      .onConflict((conflict) =>
        conflict.column("task_id").doUpdateSet({
          sequence: projection.sequence,
          desired_state: desiredState,
          reducer_state_json: json(decision.record),
          updated_at: now,
        }),
      )
      .execute();
    const durableDecision: TaskProcessDecision = {
      ...decision,
      duplicate: false,
    };
    await this.tx
      .insertInto("task_input")
      .values({
        input_id: input.inputId,
        task_id: input.taskId,
        sequence: projection.sequence,
        schema_version: input.schemaVersion,
        kind: input.kind,
        source: input.source,
        source_id: input.sourceId,
        payload_json: json(input),
        decision_json: json(durableDecision),
        observed_at: now,
      })
      .execute();
    await this.tx
      .insertInto("task_projection")
      .values({
        task_id: input.taskId,
        revision: projection.sequence,
        schema_version: projection.schemaVersion,
        payload_json: json(projection),
        updated_at: now,
      })
      .onConflict((conflict) =>
        conflict.column("task_id").doUpdateSet({
          revision: projection.sequence,
          payload_json: json(projection),
          updated_at: now,
        }),
      )
      .execute();
    const identities = decision.record?.identity;
    for (const binding of [
      identities?.sessionId
        ? { kind: "runtime_session", externalId: identities.sessionId }
        : undefined,
      identities?.threadId
        ? { kind: "codex_thread", externalId: identities.threadId }
        : undefined,
      decision.durableData.codexSessionId
        ? {
            kind: "codex_session",
            externalId: decision.durableData.codexSessionId,
          }
        : undefined,
    ]) {
      if (!binding) continue;
      await this.tx
        .insertInto("task_binding")
        .values({
          binding_id: `${input.taskId}:${binding.kind}`,
          task_id: input.taskId,
          kind: binding.kind,
          external_id: binding.externalId,
          ownership_generation:
            input.lifecycle.runtime.ownershipGeneration ?? 1,
          payload_json: json(binding),
          updated_at: now,
        })
        .onConflict((conflict) =>
          conflict.column("binding_id").doUpdateSet({
            external_id: binding.externalId,
            ownership_generation:
              input.lifecycle.runtime.ownershipGeneration ?? 1,
            payload_json: json(binding),
            updated_at: now,
          }),
        )
        .execute();
    }
    for (const attention of decision.durableData.attentions)
      await this.tx
        .insertInto("task_attention")
        .values({
          request_id: attention.requestId,
          task_id: input.taskId,
          generation: attention.generation,
          status: attention.status,
          payload_json: json(attention),
          updated_at: now,
        })
        .onConflict((conflict) =>
          conflict.column("request_id").doUpdateSet({
            status: attention.status,
            payload_json: json(attention),
            updated_at: now,
          }),
        )
        .execute();
    const continuation = decision.durableData.continuation;
    if (continuation && continuation.handoffId)
      await this.tx
        .insertInto("task_handoff")
        .values({
          handoff_id: continuation.handoffId,
          task_id: input.taskId,
          generation: continuation.handoffGeneration,
          status: continuation.status,
          payload_json: json(continuation),
          return_event_id: continuation.returnEventId ?? null,
          updated_at: now,
        })
        .onConflict((conflict) =>
          conflict.column("handoff_id").doUpdateSet({
            status: continuation.status,
            payload_json: json(continuation),
            return_event_id: continuation.returnEventId ?? null,
            updated_at: now,
          }),
        )
        .execute();
    if (command)
      await this.tx
        .insertInto("task_command")
        .values({
          command_id: command.commandId,
          task_id: command.taskId,
          sequence: command.sequence,
          schema_version: command.schemaVersion,
          command_type: command.type,
          payload_json: json(command.payload),
          status: command.status,
          attempts: 0,
          lease_owner: null,
          lease_generation: null,
          lease_expires_at: null,
          lease_origin: null,
          reconciliation_json: null,
          created_at: now,
          updated_at: now,
        })
        .execute();
    void output;
  }
}

export interface SqliteTaskStoreOptions {
  path: string;
  now?: () => string;
  leaseMilliseconds?: number;
}

export class SqliteTaskStore implements TaskStore {
  private readonly native: Database.Database;
  private readonly db: Kysely<LedgerDatabase>;
  private readonly now: () => string;
  private readonly leaseMilliseconds: number;

  constructor(options: SqliteTaskStoreOptions) {
    mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
    this.native = new Database(options.path);
    this.native.pragma("journal_mode = WAL");
    this.native.pragma("synchronous = FULL");
    this.native.pragma("foreign_keys = ON");
    this.native.pragma("busy_timeout = 5000");
    this.db = new Kysely({
      dialect: new SqliteDialect({ database: this.native }),
    });
    this.now = options.now ?? (() => new Date().toISOString());
    this.leaseMilliseconds = options.leaseMilliseconds ?? 30_000;
    this.migrate();
    this.native
      .prepare(
        "UPDATE task_command SET status = CASE WHEN status = 'accepted' AND lease_origin = 'pending' THEN 'pending' ELSE 'reconcile_required' END, lease_owner = NULL, lease_generation = NULL, lease_expires_at = NULL WHERE status IN ('accepted', 'possibly_started') OR (status = 'leased' AND lease_expires_at <= ?)",
      )
      .run(this.now());
  }

  private migrate(): void {
    this.native.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS schema_migration (
        migration_id TEXT PRIMARY KEY, applied_at TEXT NOT NULL, compatibility_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_instance (
        task_id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, sequence INTEGER NOT NULL,
        ownership_generation INTEGER NOT NULL, desired_state TEXT NOT NULL,
        reducer_state_json TEXT NOT NULL, frozen_launch_json TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_input (
        input_id TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES task_instance(task_id) ON DELETE RESTRICT,
        sequence INTEGER NOT NULL, schema_version INTEGER NOT NULL, kind TEXT NOT NULL,
        source TEXT NOT NULL, source_id TEXT NOT NULL, payload_json TEXT NOT NULL,
        decision_json TEXT NOT NULL, observed_at TEXT NOT NULL,
        PRIMARY KEY (task_id, input_id), UNIQUE (task_id, sequence), UNIQUE (source, source_id)
      );
      CREATE TABLE IF NOT EXISTS task_command (
        command_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES task_instance(task_id) ON DELETE RESTRICT,
        sequence INTEGER NOT NULL, schema_version INTEGER NOT NULL, command_type TEXT NOT NULL,
        payload_json TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL,
        lease_owner TEXT, lease_generation INTEGER, lease_expires_at TEXT,
        lease_origin TEXT, reconciliation_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (task_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS task_command_due ON task_command(status, sequence);
      CREATE TABLE IF NOT EXISTS task_binding (
        binding_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES task_instance(task_id) ON DELETE RESTRICT,
        kind TEXT NOT NULL, external_id TEXT NOT NULL, ownership_generation INTEGER NOT NULL,
        payload_json TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(kind, external_id)
      );
      CREATE TABLE IF NOT EXISTS task_handoff (
        handoff_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES task_instance(task_id) ON DELETE RESTRICT,
        generation INTEGER NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL,
        return_event_id TEXT, updated_at TEXT NOT NULL, UNIQUE(task_id, generation)
      );
      CREATE TABLE IF NOT EXISTS task_attention (
        request_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES task_instance(task_id) ON DELETE RESTRICT,
        generation INTEGER NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_projection (
        task_id TEXT PRIMARY KEY REFERENCES task_instance(task_id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, schema_version INTEGER NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS legacy_import (
        import_id TEXT PRIMARY KEY, digest TEXT NOT NULL UNIQUE, source_revisions_json TEXT NOT NULL,
        backup_path TEXT NOT NULL, imported_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS legacy_import_source (
        import_id TEXT NOT NULL REFERENCES legacy_import(import_id) ON DELETE RESTRICT,
        source_name TEXT NOT NULL, schema_version INTEGER NOT NULL, revision INTEGER NOT NULL,
        payload_json TEXT NOT NULL, PRIMARY KEY(import_id, source_name)
      );
      INSERT OR IGNORE INTO schema_migration(migration_id, applied_at, compatibility_json)
      VALUES ('${MIGRATION_ID}', datetime('now'), '{"minReader":1,"minWriter":1}');
      COMMIT;
    `);
    const columns = this.native
      .prepare("PRAGMA table_info(task_command)")
      .all() as { name: string }[];
    if (!columns.some((column) => column.name === "lease_origin"))
      this.native.exec("ALTER TABLE task_command ADD COLUMN lease_origin TEXT");
  }

  transact<T>(operation: (tx: TaskTransaction) => Promise<T>): Promise<T> {
    return this.db
      .transaction()
      .execute((tx) => operation(new SqliteTaskTransaction(tx)));
  }

  async claimDueCommands(
    workerId: string,
    generation: number,
    limit: number,
  ): Promise<TaskProcessCommand[]> {
    if (!Number.isSafeInteger(generation) || generation < 1)
      throw new Error("Worker generation must be a positive integer.");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Command claim limit is invalid.");
    const now = this.now();
    const expiresAt = new Date(
      Date.parse(now) + this.leaseMilliseconds,
    ).toISOString();
    const claim = this.native.transaction(() => {
      const rows = this.native
        .prepare(
          `UPDATE task_command
         SET lease_origin = status, status = 'leased', attempts = attempts + 1, lease_owner = ?,
             lease_generation = ?, lease_expires_at = ?, updated_at = ?
         WHERE command_id IN (
           SELECT command_id FROM task_command
           WHERE status IN ('pending', 'reconcile_required')
              OR (status = 'leased' AND lease_expires_at <= ?)
           ORDER BY sequence ASC LIMIT ?
         )
         AND (status IN ('pending', 'reconcile_required')
              OR (status = 'leased' AND lease_expires_at <= ?))
         AND EXISTS (
           SELECT 1 FROM task_instance
           WHERE task_instance.task_id = task_command.task_id
             AND task_instance.ownership_generation <= ?
         )
         RETURNING *`,
        )
        .all(
          workerId,
          generation,
          expiresAt,
          now,
          now,
          limit,
          now,
          generation,
        ) as Array<LedgerDatabase["task_command"]>;
      const advanceGeneration = this.native.prepare(
        "UPDATE task_instance SET ownership_generation = ? WHERE task_id = ? AND ownership_generation <= ?",
      );
      for (const taskId of new Set(rows.map((row) => row.task_id)))
        advanceGeneration.run(generation, taskId, generation);
      return rows;
    });
    const rows = claim.immediate();
    return rows.map((row) => {
      const type = parseNativeLifecycleCommandType(row.command_type);
      const payload = parse<Record<string, unknown>>(row.payload_json);
      if (payload.type !== type)
        throw new Error(
          "Stored command payload does not match its command type.",
        );
      return {
        schemaVersion: 1,
        commandId: row.command_id,
        taskId: row.task_id,
        sequence: row.sequence,
        type,
        payload,
        status: "leased",
        attempts: row.attempts,
        createdAt: row.created_at,
        claimedFrom:
          row.lease_origin === "pending" ? "pending" : "reconcile_required",
      };
    });
  }

  async markCommand(
    commandId: string,
    status: TaskCommandStatus,
    fact?: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const allowedFrom: Partial<Record<TaskCommandStatus, TaskCommandStatus[]>> =
      {
        leased: ["pending", "reconcile_required"],
        accepted: ["leased"],
        possibly_started: ["accepted"],
        succeeded: ["possibly_started", "accepted"],
        failed: ["possibly_started", "accepted"],
        reconcile_required: ["leased", "accepted", "possibly_started"],
        cancelled: ["pending", "reconcile_required"],
      };
    const prior = allowedFrom[status] ?? [];
    if (prior.length === 0)
      throw new Error(`No legal transition targets ${status}.`);
    const result = await this.db
      .updateTable("task_command")
      .set({
        status,
        reconciliation_json: fact === undefined ? null : json(fact),
        lease_owner: null,
        lease_generation: null,
        lease_expires_at: null,
        lease_origin: null,
        updated_at: this.now(),
      })
      .where("command_id", "=", commandId)
      .where("status", "in", prior)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) !== 1)
      throw new Error("Task command transition was not legal.");
  }

  async projection(taskId: string): Promise<TaskProcessProjection | null> {
    const row = await this.db
      .selectFrom("task_projection")
      .select("payload_json")
      .where("task_id", "=", taskId)
      .executeTakeFirst();
    return row ? parse<TaskProcessProjection>(row.payload_json) : null;
  }

  async lifecycle(taskId: string) {
    const row = await this.db
      .selectFrom("task_input")
      .innerJoin("task_instance", "task_instance.task_id", "task_input.task_id")
      .select(["task_input.decision_json", "task_instance.reducer_state_json"])
      .where("task_input.task_id", "=", taskId)
      .orderBy("task_input.sequence", "desc")
      .executeTakeFirst();
    if (!row) return null;
    const decision = validateTaskProcessDecision(JSON.parse(row.decision_json));
    const storedRecord = JSON.parse(row.reducer_state_json) as unknown;
    if (JSON.stringify(storedRecord) !== JSON.stringify(decision.record))
      throw new Error(
        "Task reducer state does not match its validated decision.",
      );
    return {
      ...(decision.lifecycle ?? decision.input.lifecycle),
      record: decision.record,
    };
  }

  async launchConfiguration(taskId: string) {
    const row = await this.db
      .selectFrom("task_instance")
      .select("frozen_launch_json")
      .where("task_id", "=", taskId)
      .executeTakeFirst();
    return row?.frozen_launch_json
      ? parse<Readonly<Record<string, unknown>>>(row.frozen_launch_json)
      : null;
  }

  async taskState(taskId: string): Promise<TaskProcessState | null> {
    const lifecycle = await this.lifecycle(taskId);
    const projection = await this.projection(taskId);
    if (!lifecycle || !projection) return null;
    return {
      taskId,
      lifecycle,
      projection,
      launchConfiguration: await this.launchConfiguration(taskId),
      durableData: await this.transact((tx) => tx.currentDurableData(taskId)),
    };
  }

  async states(): Promise<TaskProcessState[]> {
    const rows = await this.db
      .selectFrom("task_instance")
      .select("task_id")
      .orderBy("task_id", "asc")
      .execute();
    return (
      await Promise.all(rows.map((row) => this.taskState(row.task_id)))
    ).filter((entry): entry is TaskProcessState => entry !== null);
  }

  checkpoint(): void {
    this.native.pragma("wal_checkpoint(TRUNCATE)");
  }

  hasLegacyImport(digest: string): boolean {
    return Boolean(
      this.native
        .prepare("SELECT 1 FROM legacy_import WHERE digest = ?")
        .get(digest),
    );
  }

  hasCompletedLegacyImport(): boolean {
    return Boolean(
      this.native.prepare("SELECT 1 FROM legacy_import LIMIT 1").get(),
    );
  }

  recordLegacyImport(input: {
    importId: string;
    digest: string;
    backupPath: string;
    importedAt: string;
    sources: readonly {
      name: string;
      schemaVersion: number;
      revision: number;
      payload: unknown;
    }[];
    decisions?: readonly TaskProcessDecision[];
  }): void {
    const insert = this.native.transaction(() => {
      for (const decision of input.decisions ?? []) {
        const taskId = decision.input.taskId;
        const now = decision.input.observedAt;
        this.native
          .prepare(
            `INSERT INTO task_instance(task_id, schema_version, sequence, ownership_generation, desired_state,
             reducer_state_json, frozen_launch_json, created_at, updated_at)
           VALUES (?, 1, ?, 1, ?, ?, ?, ?, ?)`,
          )
          .run(
            taskId,
            decision.projection.sequence,
            decision.record?.desiredState ?? "open",
            json(decision.record),
            decision.input.launchConfiguration
              ? json(decision.input.launchConfiguration)
              : null,
            now,
            now,
          );
        this.native
          .prepare(
            `INSERT INTO task_input(input_id, task_id, sequence, schema_version, kind, source, source_id,
             payload_json, decision_json, observed_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            decision.input.inputId,
            taskId,
            decision.projection.sequence,
            decision.input.kind,
            decision.input.source,
            decision.input.sourceId,
            json(decision.input),
            json({ ...decision, duplicate: false }),
            now,
          );
        this.native
          .prepare(
            `INSERT INTO task_projection(task_id, revision, schema_version, payload_json, updated_at)
           VALUES (?, ?, 1, ?, ?)`,
          )
          .run(
            taskId,
            decision.projection.sequence,
            json(decision.projection),
            now,
          );
        for (const binding of [
          decision.record?.identity.sessionId
            ? ["runtime_session", decision.record.identity.sessionId]
            : undefined,
          decision.record?.identity.threadId
            ? ["codex_thread", decision.record.identity.threadId]
            : undefined,
          decision.durableData.codexSessionId
            ? ["codex_session", decision.durableData.codexSessionId]
            : undefined,
        ].filter((entry): entry is string[] => entry !== undefined))
          this.native
            .prepare(
              `INSERT INTO task_binding(binding_id, task_id, kind, external_id, ownership_generation, payload_json, updated_at)
             VALUES (?, ?, ?, ?, 1, ?, ?)`,
            )
            .run(
              `${taskId}:${binding[0]}`,
              taskId,
              binding[0],
              binding[1],
              json({ kind: binding[0], externalId: binding[1] }),
              now,
            );
        const continuation = decision.durableData.continuation;
        if (continuation?.handoffId)
          this.native
            .prepare(
              `INSERT INTO task_handoff(handoff_id, task_id, generation, status, payload_json, return_event_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              continuation.handoffId,
              taskId,
              continuation.handoffGeneration,
              continuation.status,
              json(continuation),
              continuation.returnEventId ?? null,
              now,
            );
        for (const attention of decision.durableData.attentions)
          this.native
            .prepare(
              `INSERT INTO task_attention(request_id, task_id, generation, status, payload_json, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
              attention.requestId,
              taskId,
              attention.generation,
              attention.status,
              json(attention),
              now,
            );
        if (decision.command)
          this.native
            .prepare(
              `INSERT INTO task_command(command_id, task_id, sequence, schema_version, command_type, payload_json,
               status, attempts, lease_owner, lease_generation, lease_expires_at, lease_origin,
               reconciliation_json, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, ?, ?, 0, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
            )
            .run(
              decision.command.commandId,
              taskId,
              decision.command.sequence,
              decision.command.type,
              json(decision.command.payload),
              decision.command.status,
              now,
              now,
            );
      }
      this.native
        .prepare(
          `INSERT INTO legacy_import(import_id, digest, source_revisions_json, backup_path, imported_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.importId,
          input.digest,
          json(
            Object.fromEntries(
              input.sources.map((source) => [source.name, source.revision]),
            ),
          ),
          input.backupPath,
          input.importedAt,
        );
      const statement = this.native.prepare(
        `INSERT INTO legacy_import_source(import_id, source_name, schema_version, revision, payload_json)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const source of input.sources)
        statement.run(
          input.importId,
          source.name,
          source.schemaVersion,
          source.revision,
          json(source.payload),
        );
    });
    insert();
  }

  async close(): Promise<void> {
    this.checkpoint();
    await this.db.destroy();
  }
}
