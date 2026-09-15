import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type {
  PortableWorkflowSnapshot,
  RemoteWorkflowRecord,
  WorkflowProviderFailureCode,
  WorkflowSyncCursor,
} from "./workflow-portability.js";

export type WorkflowSyncItemStatus =
  | "synchronized"
  | "pending_upload"
  | "pending_delete"
  | "conflicted"
  | "deleted_remotely"
  | "absent_remotely"
  | "local_only"
  | "auth_required"
  | "transport_uncertain"
  | "unavailable"
  | "error";

export interface StoredWorkflowSyncState {
  workflowId: string;
  cursor: WorkflowSyncCursor | null;
  status: WorkflowSyncItemStatus;
  remote: RemoteWorkflowRecord | null;
  error: string | null;
  failureCode: WorkflowProviderFailureCode | null;
}

export interface WorkflowSyncFence {
  ownerId: string;
  generation: number;
  authEpoch: number;
}

export interface WorkflowOwnerBinding {
  workflowId: string;
  remoteWorkflowId: string;
  ownerId: string | null;
  syncEnabled: boolean;
  origin: "device" | "enabled" | "created" | "downloaded" | "detached";
}

export interface PendingWorkflowSyncOperation {
  operationId: string;
  ownerId: string;
  workflowId: string;
  kind: "write" | "delete";
  expectedRemoteRevision: number | null;
  requestDigest: string;
  snapshot: PortableWorkflowSnapshot | null;
  status: "pending" | "uncertain" | "failed";
  error: string | null;
  failureCode: WorkflowProviderFailureCode | null;
}

export class WorkflowSyncStateStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_sync_profile (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        owner_id TEXT NOT NULL,
        sync_cursor TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_sync_generation (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        generation INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO workflow_sync_generation(singleton,generation,updated_at)
      VALUES(1,0,datetime('now'));
      CREATE TABLE IF NOT EXISTS workflow_sync_cursor (
        owner_id TEXT PRIMARY KEY,
        sync_cursor TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_sync_binding (
        workflow_id TEXT PRIMARY KEY,
        remote_workflow_id TEXT,
        owner_id TEXT,
        sync_enabled INTEGER NOT NULL CHECK(sync_enabled IN (0,1)),
        origin TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_sync_item (
        owner_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        remote_revision INTEGER,
        local_digest TEXT,
        status TEXT NOT NULL,
        remote_json TEXT,
        error TEXT,
        failure_code TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, workflow_id)
      );
      CREATE TABLE IF NOT EXISTS workflow_sync_operation (
        operation_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('write','delete')),
        expected_remote_revision INTEGER,
        request_digest TEXT NOT NULL,
        snapshot_json TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending','uncertain','failed')),
        error TEXT,
        failure_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(owner_id, workflow_id)
      );
    `);
    const bindingColumns = this.db
      .prepare("PRAGMA table_info(workflow_sync_binding)")
      .all() as Array<{ name: string }>;
    if (!bindingColumns.some(({ name }) => name === "remote_workflow_id"))
      this.db.exec(
        "ALTER TABLE workflow_sync_binding ADD COLUMN remote_workflow_id TEXT",
      );
    const itemColumns = this.db
      .prepare("PRAGMA table_info(workflow_sync_item)")
      .all() as Array<{ name: string }>;
    if (!itemColumns.some(({ name }) => name === "failure_code"))
      this.db.exec(
        "ALTER TABLE workflow_sync_item ADD COLUMN failure_code TEXT",
      );
    const operationColumns = this.db
      .prepare("PRAGMA table_info(workflow_sync_operation)")
      .all() as Array<{ name: string }>;
    if (!operationColumns.some(({ name }) => name === "failure_code"))
      this.db.exec(
        "ALTER TABLE workflow_sync_operation ADD COLUMN failure_code TEXT",
      );
    this.db.exec(`
      UPDATE workflow_sync_binding SET remote_workflow_id=workflow_id
        WHERE remote_workflow_id IS NULL;
      INSERT OR IGNORE INTO workflow_sync_binding(
        workflow_id, remote_workflow_id, owner_id, sync_enabled, origin, created_at, updated_at
      ) SELECT workflow_id, workflow_id, owner_id, 1, 'enabled', updated_at, updated_at
        FROM workflow_sync_item;
      CREATE INDEX IF NOT EXISTS workflow_sync_binding_owner
        ON workflow_sync_binding(owner_id, sync_enabled, workflow_id);
      CREATE UNIQUE INDEX IF NOT EXISTS workflow_sync_binding_remote_owner
        ON workflow_sync_binding(owner_id, remote_workflow_id)
        WHERE owner_id IS NOT NULL;
      INSERT OR IGNORE INTO workflow_sync_cursor(owner_id,sync_cursor,updated_at)
        SELECT owner_id,sync_cursor,updated_at FROM workflow_sync_profile
        WHERE sync_cursor IS NOT NULL;
    `);
  }

  generation(): number {
    return Number(
      (
        this.db
          .prepare(
            "SELECT generation FROM workflow_sync_generation WHERE singleton=1",
          )
          .get() as { generation: number }
      ).generation,
    );
  }

  invalidate(): number {
    this.db
      .prepare(
        "UPDATE workflow_sync_generation SET generation=generation+1,updated_at=? WHERE singleton=1",
      )
      .run(new Date().toISOString());
    return this.generation();
  }

  assertFence(fence: WorkflowSyncFence): void {
    if (
      this.boundOwnerId() !== fence.ownerId ||
      this.generation() !== fence.generation
    )
      throw new Error(
        "Workflow synchronization identity changed during the operation.",
      );
  }

  boundOwnerId(): string | null {
    return (
      (
        this.db
          .prepare(
            "SELECT owner_id FROM workflow_sync_profile WHERE singleton=1",
          )
          .get() as { owner_id: string } | undefined
      )?.owner_id ?? null
    );
  }

  syncCursor(ownerId: string): string | null {
    return (
      (
        this.db
          .prepare(
            "SELECT sync_cursor FROM workflow_sync_cursor WHERE owner_id=?",
          )
          .get(ownerId) as { sync_cursor: string } | undefined
      )?.sync_cursor ?? null
    );
  }

  saveSyncCursor(fence: WorkflowSyncFence, cursor: string): void {
    this.assertFence(fence);
    this.db
      .prepare(
        `INSERT INTO workflow_sync_cursor(owner_id,sync_cursor,updated_at)
         VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET
         sync_cursor=excluded.sync_cursor,updated_at=excluded.updated_at`,
      )
      .run(fence.ownerId, cursor, new Date().toISOString());
  }

  clearSyncCursor(fence: WorkflowSyncFence): void {
    this.assertFence(fence);
    this.db
      .prepare("DELETE FROM workflow_sync_cursor WHERE owner_id=?")
      .run(fence.ownerId);
  }

  bind(ownerId: string, allowSwitch = false): void {
    const current = this.boundOwnerId();
    if (current && current !== ownerId && !allowSwitch)
      throw new Error(
        "This device is linked to a different Rove account. Confirm the account switch before synchronizing.",
      );
    const now = new Date().toISOString();
    this.db
      .transaction(() => {
        this.db
          .prepare(
            `INSERT INTO workflow_sync_profile(singleton,owner_id,sync_cursor,updated_at)
           VALUES(1,?,NULL,?) ON CONFLICT(singleton) DO UPDATE SET
           owner_id=excluded.owner_id,sync_cursor=NULL,updated_at=excluded.updated_at`,
          )
          .run(ownerId, now);
        this.invalidate();
      })
      .immediate();
  }

  unbind(): void {
    this.db
      .transaction(() => {
        this.db.prepare("DELETE FROM workflow_sync_profile").run();
        this.invalidate();
      })
      .immediate();
  }

  inventoryDeviceWorkflow(workflowId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO workflow_sync_binding
         (workflow_id,remote_workflow_id,owner_id,sync_enabled,origin,created_at,updated_at)
         VALUES(?,?,NULL,0,'device',?,?)`,
      )
      .run(workflowId, workflowId, now, now);
  }

  claimDeviceWorkflows(ownerId: string): void {
    this.db
      .prepare(
        `UPDATE workflow_sync_binding SET owner_id=?,sync_enabled=1,origin='enabled',updated_at=?
         WHERE owner_id IS NULL AND origin='device'`,
      )
      .run(ownerId, new Date().toISOString());
  }

  bindNewWorkflow(workflowId: string, ownerId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO workflow_sync_binding(workflow_id,remote_workflow_id,owner_id,sync_enabled,origin,created_at,updated_at)
         VALUES(?,?,?,1,'created',?,?) ON CONFLICT(workflow_id) DO NOTHING`,
      )
      .run(workflowId, workflowId, ownerId, now, now);
  }

  bindDownloaded(
    workflowId: string,
    ownerId: string,
    remoteWorkflowId = workflowId,
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO workflow_sync_binding(workflow_id,remote_workflow_id,owner_id,sync_enabled,origin,created_at,updated_at)
         VALUES(?,?,?,1,'downloaded',?,?) ON CONFLICT(workflow_id) DO UPDATE SET
         remote_workflow_id=excluded.remote_workflow_id,owner_id=excluded.owner_id,
         sync_enabled=1,origin='downloaded',updated_at=excluded.updated_at
         WHERE workflow_sync_binding.owner_id IS NULL`,
      )
      .run(workflowId, remoteWorkflowId, ownerId, now, now);
  }

  binding(workflowId: string): WorkflowOwnerBinding | null {
    const row = this.db
      .prepare("SELECT * FROM workflow_sync_binding WHERE workflow_id=?")
      .get(workflowId) as Record<string, unknown> | undefined;
    return row
      ? {
          workflowId,
          remoteWorkflowId: String(row.remote_workflow_id),
          ownerId: row.owner_id === null ? null : String(row.owner_id),
          syncEnabled: Number(row.sync_enabled) === 1,
          origin: String(row.origin) as WorkflowOwnerBinding["origin"],
        }
      : null;
  }

  bindings(ownerId: string): readonly WorkflowOwnerBinding[] {
    return (
      this.db
        .prepare(
          "SELECT workflow_id FROM workflow_sync_binding WHERE owner_id=? AND sync_enabled=1 ORDER BY workflow_id",
        )
        .all(ownerId) as Array<{ workflow_id: string }>
    ).map(({ workflow_id }) => this.binding(workflow_id)!);
  }

  allBindings(): readonly WorkflowOwnerBinding[] {
    return (
      this.db
        .prepare(
          "SELECT workflow_id FROM workflow_sync_binding ORDER BY workflow_id",
        )
        .all() as Array<{ workflow_id: string }>
    ).map(({ workflow_id }) => this.binding(workflow_id)!);
  }

  bindingByRemote(
    ownerId: string,
    remoteWorkflowId: string,
  ): WorkflowOwnerBinding | null {
    const row = this.db
      .prepare(
        "SELECT workflow_id FROM workflow_sync_binding WHERE owner_id=? AND remote_workflow_id=?",
      )
      .get(ownerId, remoteWorkflowId) as { workflow_id: string } | undefined;
    return row ? this.binding(row.workflow_id) : null;
  }

  disableBinding(workflowId: string, ownerId: string): void {
    this.db
      .prepare(
        `UPDATE workflow_sync_binding SET sync_enabled=0,origin='detached',updated_at=?
         WHERE workflow_id=? AND owner_id=?`,
      )
      .run(new Date().toISOString(), workflowId, ownerId);
  }

  detachDeletedOwner(ownerId: string): void {
    this.db
      .transaction(() => {
        this.db
          .prepare(
            `UPDATE workflow_sync_binding SET owner_id=NULL,sync_enabled=0,origin='detached',updated_at=?
           WHERE owner_id=?`,
          )
          .run(new Date().toISOString(), ownerId);
        this.db
          .prepare("DELETE FROM workflow_sync_item WHERE owner_id=?")
          .run(ownerId);
        this.db
          .prepare("DELETE FROM workflow_sync_operation WHERE owner_id=?")
          .run(ownerId);
        this.db
          .prepare("DELETE FROM workflow_sync_cursor WHERE owner_id=?")
          .run(ownerId);
        if (this.boundOwnerId() === ownerId)
          this.db.prepare("DELETE FROM workflow_sync_profile").run();
        this.invalidate();
      })
      .immediate();
  }

  state(ownerId: string, workflowId: string): StoredWorkflowSyncState | null {
    const row = this.db
      .prepare(
        "SELECT * FROM workflow_sync_item WHERE owner_id=? AND workflow_id=?",
      )
      .get(ownerId, workflowId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      workflowId,
      cursor:
        row.remote_revision === null
          ? null
          : {
              acknowledgedRemoteRevision: Number(row.remote_revision),
              acknowledgedLocalDigest: String(row.local_digest),
            },
      status: row.status as WorkflowSyncItemStatus,
      remote: row.remote_json
        ? (JSON.parse(String(row.remote_json)) as RemoteWorkflowRecord)
        : null,
      error: row.error === null ? null : String(row.error),
      failureCode:
        row.failure_code === null
          ? null
          : (String(row.failure_code) as WorkflowProviderFailureCode),
    };
  }

  states(ownerId: string): readonly StoredWorkflowSyncState[] {
    return (
      this.db
        .prepare(
          "SELECT workflow_id FROM workflow_sync_item WHERE owner_id=? ORDER BY workflow_id",
        )
        .all(ownerId) as Array<{ workflow_id: string }>
    ).map(({ workflow_id }) => this.state(ownerId, workflow_id)!);
  }

  save(fence: WorkflowSyncFence, value: StoredWorkflowSyncState): void {
    this.assertFence(fence);
    this.db
      .prepare(
        `INSERT INTO workflow_sync_item(owner_id,workflow_id,remote_revision,local_digest,status,remote_json,error,failure_code,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,workflow_id) DO UPDATE SET
         remote_revision=excluded.remote_revision,local_digest=excluded.local_digest,status=excluded.status,
         remote_json=excluded.remote_json,error=excluded.error,failure_code=excluded.failure_code,
         updated_at=excluded.updated_at`,
      )
      .run(
        fence.ownerId,
        value.workflowId,
        value.cursor?.acknowledgedRemoteRevision ?? null,
        value.cursor?.acknowledgedLocalDigest ?? null,
        value.status,
        value.remote === null ? null : JSON.stringify(value.remote),
        value.error,
        value.failureCode,
        new Date().toISOString(),
      );
  }

  pending(
    ownerId: string,
    workflowId: string,
  ): PendingWorkflowSyncOperation | null {
    const row = this.db
      .prepare(
        "SELECT * FROM workflow_sync_operation WHERE owner_id=? AND workflow_id=?",
      )
      .get(ownerId, workflowId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      operationId: String(row.operation_id),
      ownerId,
      workflowId,
      kind: String(row.kind) as PendingWorkflowSyncOperation["kind"],
      expectedRemoteRevision:
        row.expected_remote_revision === null
          ? null
          : Number(row.expected_remote_revision),
      requestDigest: String(row.request_digest),
      snapshot: row.snapshot_json
        ? (JSON.parse(String(row.snapshot_json)) as PortableWorkflowSnapshot)
        : null,
      status: String(row.status) as PendingWorkflowSyncOperation["status"],
      error: row.error === null ? null : String(row.error),
      failureCode:
        row.failure_code === null
          ? null
          : (String(row.failure_code) as WorkflowProviderFailureCode),
    };
  }

  pendingFor(ownerId: string): readonly PendingWorkflowSyncOperation[] {
    return (
      this.db
        .prepare(
          "SELECT workflow_id FROM workflow_sync_operation WHERE owner_id=? ORDER BY created_at,workflow_id",
        )
        .all(ownerId) as Array<{ workflow_id: string }>
    ).map(({ workflow_id }) => this.pending(ownerId, workflow_id)!);
  }

  stage(
    fence: WorkflowSyncFence,
    operation: PendingWorkflowSyncOperation,
  ): void {
    this.assertFence(fence);
    const existing = this.pending(fence.ownerId, operation.workflowId);
    if (existing && existing.requestDigest !== operation.requestDigest)
      throw new Error(
        "A different Workflow synchronization operation is still pending.",
      );
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO workflow_sync_operation(
          operation_id,owner_id,workflow_id,kind,expected_remote_revision,request_digest,
          snapshot_json,status,error,failure_code,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(operation_id) DO UPDATE SET
          status=excluded.status,error=excluded.error,failure_code=excluded.failure_code,
          updated_at=excluded.updated_at`,
      )
      .run(
        operation.operationId,
        fence.ownerId,
        operation.workflowId,
        operation.kind,
        operation.expectedRemoteRevision,
        operation.requestDigest,
        operation.snapshot === null ? null : JSON.stringify(operation.snapshot),
        operation.status,
        operation.error,
        operation.failureCode,
        now,
        now,
      );
  }

  markOperationUncertain(
    fence: WorkflowSyncFence,
    workflowId: string,
    error: string,
    failureCode: WorkflowProviderFailureCode,
  ): void {
    this.assertFence(fence);
    this.db
      .prepare(
        "UPDATE workflow_sync_operation SET status='uncertain',error=?,failure_code=?,updated_at=? WHERE owner_id=? AND workflow_id=?",
      )
      .run(
        error,
        failureCode,
        new Date().toISOString(),
        fence.ownerId,
        workflowId,
      );
  }

  failOperation(
    fence: WorkflowSyncFence,
    workflowId: string,
    error: string,
    failureCode: WorkflowProviderFailureCode,
  ): void {
    this.assertFence(fence);
    this.db
      .prepare(
        "UPDATE workflow_sync_operation SET status='failed',error=?,failure_code=?,updated_at=? WHERE owner_id=? AND workflow_id=?",
      )
      .run(
        error,
        failureCode,
        new Date().toISOString(),
        fence.ownerId,
        workflowId,
      );
  }

  completeOperation(fence: WorkflowSyncFence, operationId: string): void {
    this.assertFence(fence);
    this.db
      .prepare(
        "DELETE FROM workflow_sync_operation WHERE owner_id=? AND operation_id=?",
      )
      .run(fence.ownerId, operationId);
  }

  completeDelete(input: {
    fence: WorkflowSyncFence;
    operationId: string;
    localWorkflowId: string;
    remoteWorkflowId: string;
    cursor: WorkflowSyncCursor | null;
    remote: (RemoteWorkflowRecord & { state: "deleted" }) | null;
  }): void {
    const complete = this.db.transaction(() => {
      this.assertFence(input.fence);
      const removed = this.db
        .prepare(
          "DELETE FROM workflow_sync_operation WHERE owner_id=? AND operation_id=? AND workflow_id=? AND kind='delete'",
        )
        .run(input.fence.ownerId, input.operationId, input.remoteWorkflowId);
      if (removed.changes !== 1)
        throw new Error("Pending Workflow deletion is unavailable.");
      const detached = this.db
        .prepare(
          `UPDATE workflow_sync_binding SET sync_enabled=0,origin='detached',updated_at=?
           WHERE workflow_id=? AND remote_workflow_id=? AND owner_id=? AND sync_enabled=1`,
        )
        .run(
          new Date().toISOString(),
          input.localWorkflowId,
          input.remoteWorkflowId,
          input.fence.ownerId,
        );
      if (detached.changes !== 1)
        throw new Error("Workflow cloud binding is unavailable.");
      this.save(input.fence, {
        workflowId: input.remoteWorkflowId,
        status: "local_only",
        cursor: input.cursor,
        remote: input.remote,
        error: null,
        failureCode: null,
      });
    });
    complete.immediate();
  }

  close(): void {
    this.db.close();
  }
}
