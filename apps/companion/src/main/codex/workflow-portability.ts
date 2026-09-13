import { createHash } from "node:crypto";

import {
  validateWorkflowConfiguration,
  validateWorkflowName,
  type WorkflowConfiguration,
  type WorkflowEnvironment,
} from "./workflows.js";

export interface PortableWorkflowSnapshot {
  schemaVersion: 1;
  workflowId: string;
  configurationRevision: number;
  name: string;
  archived: boolean;
  configuration: WorkflowConfiguration;
  digest: string;
  approvedAt: string;
}

export type RemoteWorkflowRecord =
  | {
      schemaVersion: 1;
      ownerId: string;
      workflowId: string;
      remoteRevision: number;
      state: "active";
      snapshot: PortableWorkflowSnapshot;
      updatedAt: string;
    }
  | {
      schemaVersion: 1;
      ownerId: string;
      workflowId: string;
      remoteRevision: number;
      state: "deleted";
      deletedAt: string;
      updatedAt: string;
    };

export interface WorkflowSyncCursor {
  acknowledgedRemoteRevision: number;
  acknowledgedLocalDigest: string;
}

export type WorkflowSyncPlan =
  | { state: "pending_upload"; expectedRemoteRevision: number | null }
  | {
      state: "pending_download";
      remote: RemoteWorkflowRecord & { state: "active" };
    }
  | { state: "synchronized"; remoteRevision: number }
  | { state: "conflicted"; remote: RemoteWorkflowRecord | null }
  | {
      state: "deleted_remotely";
      tombstone: RemoteWorkflowRecord & { state: "deleted" };
    };

export interface WorkflowProviderListInput {
  ownerId: string;
  limit: number;
  pageCursor?: string;
  sinceCursor?: string;
}

export interface WorkflowProviderListPage {
  items: readonly RemoteWorkflowRecord[];
  nextPageCursor: string | null;
  syncCursor: string | null;
  authoritative: boolean;
}

export class WorkflowSyncCursorExpiredError extends Error {
  readonly code = "WORKFLOW_SYNC_CURSOR_EXPIRED";

  constructor() {
    super(
      "Workflow synchronization cursor is invalid or expired; perform an authoritative refresh.",
    );
    this.name = "WorkflowSyncCursorExpiredError";
  }
}

export interface WorkflowConfigurationProvider {
  list(input: WorkflowProviderListInput): Promise<WorkflowProviderListPage>;
  read(
    ownerId: string,
    workflowId: string,
  ): Promise<RemoteWorkflowRecord | null>;
  write(input: {
    ownerId: string;
    operationId: string;
    expectedRemoteRevision: number | null;
    snapshot: PortableWorkflowSnapshot;
    updatedAt: string;
  }): Promise<RemoteWorkflowRecord & { state: "active" }>;
  delete(input: {
    ownerId: string;
    workflowId: string;
    operationId: string;
    expectedRemoteRevision: number;
    deletedAt: string;
  }): Promise<RemoteWorkflowRecord & { state: "deleted" }>;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !fields.includes(key));
  const missing = fields.find((key) => !(key in value));
  if (unexpected || missing) throw new Error(`${label} fields are invalid.`);
}

function opaqueId(value: unknown, label: string, prefix: string): string {
  if (
    typeof value !== "string" ||
    !new RegExp(`^${prefix}[a-zA-Z0-9_-]{8,200}$`).test(value)
  )
    throw new Error(`${label} is invalid.`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw new Error(`${label} is invalid.`);
  return value;
}

function positiveRevision(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new Error(`${label} is invalid.`);
  return Number(value);
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error(`${label} is invalid.`);
  return value;
}

export function portableWorkflowDigest(input: {
  workflowId: string;
  configurationRevision: number;
  name: string;
  archived: boolean;
  configuration: WorkflowConfiguration;
  approvedAt: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function validatePortableWorkflowSnapshot(
  value: unknown,
): PortableWorkflowSnapshot {
  const input = object(value, "Portable Workflow snapshot");
  exact(
    input,
    [
      "schemaVersion",
      "workflowId",
      "configurationRevision",
      "name",
      "archived",
      "configuration",
      "digest",
      "approvedAt",
    ],
    "Portable Workflow snapshot",
  );
  if (input.schemaVersion !== 1 || typeof input.archived !== "boolean")
    throw new Error("Portable Workflow snapshot is invalid.");
  const base = {
    workflowId: opaqueId(input.workflowId, "Workflow identity", "workflow_"),
    configurationRevision: positiveRevision(
      input.configurationRevision,
      "Workflow configuration revision",
    ),
    name: validateWorkflowName(input.name),
    archived: input.archived,
    configuration: validateWorkflowConfiguration(input.configuration),
    approvedAt: timestamp(input.approvedAt, "Workflow approval timestamp"),
  };
  const digest = sha256(input.digest, "Portable Workflow digest");
  if (portableWorkflowDigest(base) !== digest)
    throw new Error("Portable Workflow digest does not match its content.");
  return { schemaVersion: 1, ...base, digest };
}

export function toPortableWorkflowSnapshot(
  workflow: WorkflowEnvironment,
): PortableWorkflowSnapshot {
  return validatePortableWorkflowSnapshot({
    schemaVersion: 1,
    workflowId: workflow.workflowId,
    configurationRevision: workflow.currentRevision,
    name: workflow.name,
    archived: workflow.archived,
    configuration: workflow.revision.configuration,
    approvedAt: workflow.revision.approvedAt,
    digest: portableWorkflowDigest({
      workflowId: workflow.workflowId,
      configurationRevision: workflow.currentRevision,
      name: workflow.name,
      archived: workflow.archived,
      configuration: workflow.revision.configuration,
      approvedAt: workflow.revision.approvedAt,
    }),
  });
}

export function validateRemoteWorkflowRecord(
  value: unknown,
): RemoteWorkflowRecord {
  const input = object(value, "Remote Workflow record");
  if (input.state === "active")
    exact(
      input,
      [
        "schemaVersion",
        "ownerId",
        "workflowId",
        "remoteRevision",
        "state",
        "snapshot",
        "updatedAt",
      ],
      "Remote Workflow record",
    );
  else if (input.state === "deleted")
    exact(
      input,
      [
        "schemaVersion",
        "ownerId",
        "workflowId",
        "remoteRevision",
        "state",
        "deletedAt",
        "updatedAt",
      ],
      "Remote Workflow tombstone",
    );
  else throw new Error("Remote Workflow state is invalid.");
  if (input.schemaVersion !== 1)
    throw new Error("Remote Workflow schema version is unsupported.");
  const ownerId = opaqueId(input.ownerId, "Rove owner identity", "owner_");
  const workflowId = opaqueId(
    input.workflowId,
    "Workflow identity",
    "workflow_",
  );
  const remoteRevision = positiveRevision(
    input.remoteRevision,
    "Remote Workflow revision",
  );
  const updatedAt = timestamp(input.updatedAt, "Workflow update timestamp");
  if (input.state === "deleted")
    return {
      schemaVersion: 1,
      ownerId,
      workflowId,
      remoteRevision,
      state: "deleted",
      deletedAt: timestamp(input.deletedAt, "Workflow deletion timestamp"),
      updatedAt,
    };
  const snapshot = validatePortableWorkflowSnapshot(input.snapshot);
  if (snapshot.workflowId !== workflowId)
    throw new Error("Remote Workflow snapshot identity does not match.");
  return {
    schemaVersion: 1,
    ownerId,
    workflowId,
    remoteRevision,
    state: "active",
    snapshot,
    updatedAt,
  };
}

export function planWorkflowSynchronization(input: {
  ownerId: string;
  local: PortableWorkflowSnapshot;
  cursor: WorkflowSyncCursor | null;
  remote: RemoteWorkflowRecord | null;
}): WorkflowSyncPlan {
  const ownerId = opaqueId(input.ownerId, "Rove owner identity", "owner_");
  const local = validatePortableWorkflowSnapshot(input.local);
  if (input.cursor !== null) {
    positiveRevision(
      input.cursor.acknowledgedRemoteRevision,
      "Acknowledged remote Workflow revision",
    );
    sha256(
      input.cursor.acknowledgedLocalDigest,
      "Acknowledged local Workflow digest",
    );
  }
  if (input.remote === null)
    return input.cursor === null
      ? { state: "pending_upload", expectedRemoteRevision: null }
      : { state: "conflicted", remote: null };
  const remote = validateRemoteWorkflowRecord(input.remote);
  if (remote.ownerId !== ownerId || remote.workflowId !== local.workflowId)
    throw new Error("Remote Workflow ownership or identity is invalid.");
  if (remote.state === "deleted")
    return { state: "deleted_remotely", tombstone: remote };
  const remoteSnapshot = remote.snapshot;
  if (remoteSnapshot.digest === local.digest)
    return {
      state: "synchronized",
      remoteRevision: remote.remoteRevision,
    };
  if (
    input.cursor !== null &&
    input.cursor.acknowledgedRemoteRevision === remote.remoteRevision
  )
    return {
      state: "pending_upload",
      expectedRemoteRevision: remote.remoteRevision,
    };
  if (
    input.cursor !== null &&
    input.cursor.acknowledgedLocalDigest === local.digest
  )
    return { state: "pending_download", remote };
  return { state: "conflicted", remote };
}

function requestDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class InMemoryWorkflowConfigurationProvider implements WorkflowConfigurationProvider {
  private readonly records = new Map<string, RemoteWorkflowRecord>();
  private readonly changes = new Map<string, RemoteWorkflowRecord[]>();
  private readonly operations = new Map<
    string,
    { digest: string; result: RemoteWorkflowRecord }
  >();
  private readonly cursors = new Map<
    string,
    | { kind: "sync"; ownerId: string; sequence: number }
    | {
        kind: "page";
        ownerId: string;
        items: readonly RemoteWorkflowRecord[];
        offset: number;
        limit: number;
        syncCursor: string;
        authoritative: boolean;
      }
  >();
  private nextCursor = 1;

  async list(
    input: WorkflowProviderListInput,
  ): Promise<WorkflowProviderListPage> {
    const ownerId = opaqueId(input.ownerId, "Rove owner identity", "owner_");
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    )
      throw new Error("Workflow list limit must be between 1 and 100.");
    if (input.pageCursor && input.sinceCursor)
      throw new Error(
        "Workflow page and synchronization cursors are exclusive.",
      );

    if (input.pageCursor) {
      const page = this.cursors.get(input.pageCursor);
      if (!page || page.kind !== "page" || page.ownerId !== ownerId)
        throw new WorkflowSyncCursorExpiredError();
      return this.page(page);
    }

    const changes = this.changes.get(ownerId) ?? [];
    let items: readonly RemoteWorkflowRecord[];
    let authoritative: boolean;
    if (input.sinceCursor) {
      const cursor = this.cursors.get(input.sinceCursor);
      if (!cursor || cursor.kind !== "sync" || cursor.ownerId !== ownerId)
        throw new WorkflowSyncCursorExpiredError();
      items = changes.slice(cursor.sequence);
      authoritative = false;
    } else {
      const prefix = `${ownerId}\0`;
      items = [...this.records.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => value)
        .sort((left, right) => left.workflowId.localeCompare(right.workflowId));
      authoritative = true;
    }
    const syncCursor = this.issueCursor({
      kind: "sync",
      ownerId,
      sequence: changes.length,
    });
    return this.page({
      kind: "page",
      ownerId,
      items: structuredClone(items),
      offset: 0,
      limit: input.limit,
      syncCursor,
      authoritative,
    });
  }

  expireCursor(cursor: string): void {
    this.cursors.delete(cursor);
  }

  async read(
    ownerId: string,
    workflowId: string,
  ): Promise<RemoteWorkflowRecord | null> {
    const owner = opaqueId(ownerId, "Rove owner identity", "owner_");
    const workflow = opaqueId(workflowId, "Workflow identity", "workflow_");
    const result = this.records.get(this.key(owner, workflow));
    return result === undefined ? null : structuredClone(result);
  }

  async write(input: {
    ownerId: string;
    operationId: string;
    expectedRemoteRevision: number | null;
    snapshot: PortableWorkflowSnapshot;
    updatedAt: string;
  }): Promise<RemoteWorkflowRecord & { state: "active" }> {
    const ownerId = opaqueId(input.ownerId, "Rove owner identity", "owner_");
    const operationId = opaqueId(
      input.operationId,
      "Sync operation identity",
      "sync_",
    );
    const snapshot = validatePortableWorkflowSnapshot(input.snapshot);
    const updatedAt = timestamp(input.updatedAt, "Workflow update timestamp");
    if (
      input.expectedRemoteRevision !== null &&
      (!Number.isSafeInteger(input.expectedRemoteRevision) ||
        input.expectedRemoteRevision < 1)
    )
      throw new Error("Expected remote Workflow revision is invalid.");
    const request = {
      kind: "write",
      ownerId,
      operationId,
      expectedRemoteRevision: input.expectedRemoteRevision,
      snapshot,
      updatedAt,
    };
    const repeated = this.repeated(ownerId, operationId, request);
    if (repeated) {
      if (repeated.state !== "active")
        throw new Error("Sync operation result is invalid.");
      return structuredClone(repeated);
    }
    const key = this.key(ownerId, snapshot.workflowId);
    const current = this.records.get(key);
    if (
      current?.state === "deleted" ||
      (input.expectedRemoteRevision === null
        ? current !== undefined
        : current?.remoteRevision !== input.expectedRemoteRevision)
    )
      throw new Error("Workflow remote revision conflict.");
    const result: RemoteWorkflowRecord & { state: "active" } = {
      schemaVersion: 1,
      ownerId,
      workflowId: snapshot.workflowId,
      remoteRevision: (current?.remoteRevision ?? 0) + 1,
      state: "active",
      snapshot,
      updatedAt,
    };
    this.records.set(key, result);
    this.recordChange(ownerId, result);
    this.remember(ownerId, operationId, request, result);
    return structuredClone(result);
  }

  async delete(input: {
    ownerId: string;
    workflowId: string;
    operationId: string;
    expectedRemoteRevision: number;
    deletedAt: string;
  }): Promise<RemoteWorkflowRecord & { state: "deleted" }> {
    const ownerId = opaqueId(input.ownerId, "Rove owner identity", "owner_");
    const workflowId = opaqueId(
      input.workflowId,
      "Workflow identity",
      "workflow_",
    );
    const operationId = opaqueId(
      input.operationId,
      "Sync operation identity",
      "sync_",
    );
    const deletedAt = timestamp(input.deletedAt, "Workflow deletion timestamp");
    positiveRevision(
      input.expectedRemoteRevision,
      "Expected remote Workflow revision",
    );
    const request = {
      kind: "delete",
      ...input,
      ownerId,
      workflowId,
      operationId,
      deletedAt,
    };
    const repeated = this.repeated(ownerId, operationId, request);
    if (repeated) {
      if (repeated.state !== "deleted")
        throw new Error("Sync operation result is invalid.");
      return structuredClone(repeated);
    }
    const key = this.key(ownerId, workflowId);
    const current = this.records.get(key);
    if (!current || current.remoteRevision !== input.expectedRemoteRevision)
      throw new Error("Workflow remote revision conflict.");
    const result: RemoteWorkflowRecord & { state: "deleted" } = {
      schemaVersion: 1,
      ownerId,
      workflowId,
      remoteRevision: current.remoteRevision + 1,
      state: "deleted",
      deletedAt,
      updatedAt: deletedAt,
    };
    this.records.set(key, result);
    this.recordChange(ownerId, result);
    this.remember(ownerId, operationId, request, result);
    return structuredClone(result);
  }

  private key(ownerId: string, workflowId: string): string {
    return `${ownerId}\0${workflowId}`;
  }

  private issueCursor(
    cursor:
      | { kind: "sync"; ownerId: string; sequence: number }
      | {
          kind: "page";
          ownerId: string;
          items: readonly RemoteWorkflowRecord[];
          offset: number;
          limit: number;
          syncCursor: string;
          authoritative: boolean;
        },
  ): string {
    const token = `workflow_cursor_${String(this.nextCursor++).padStart(8, "0")}`;
    this.cursors.set(token, cursor);
    return token;
  }

  private page(input: {
    kind: "page";
    ownerId: string;
    items: readonly RemoteWorkflowRecord[];
    offset: number;
    limit: number;
    syncCursor: string;
    authoritative: boolean;
  }): WorkflowProviderListPage {
    const end = Math.min(input.offset + input.limit, input.items.length);
    const items = structuredClone(input.items.slice(input.offset, end));
    const nextPageCursor =
      end < input.items.length
        ? this.issueCursor({ ...input, offset: end })
        : null;
    return {
      items,
      nextPageCursor,
      syncCursor: nextPageCursor === null ? input.syncCursor : null,
      authoritative: input.authoritative,
    };
  }

  private recordChange(ownerId: string, record: RemoteWorkflowRecord): void {
    const changes = this.changes.get(ownerId) ?? [];
    changes.push(structuredClone(record));
    this.changes.set(ownerId, changes);
  }

  private repeated(
    ownerId: string,
    operationId: string,
    request: unknown,
  ): RemoteWorkflowRecord | null {
    const prior = this.operations.get(this.key(ownerId, operationId));
    if (!prior) return null;
    if (prior.digest !== requestDigest(request))
      throw new Error(
        "Sync operation identity was reused with different input.",
      );
    return prior.result;
  }

  private remember(
    ownerId: string,
    operationId: string,
    request: unknown,
    result: RemoteWorkflowRecord,
  ): void {
    this.operations.set(this.key(ownerId, operationId), {
      digest: requestDigest(request),
      result,
    });
  }
}
