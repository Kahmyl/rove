import type { SupabaseClient } from "@supabase/supabase-js";

import {
  validateRemoteWorkflowRecord,
  validatePortableWorkflowSnapshot,
  portableDigest,
  type RemoteWorkflowRecord,
  type WorkflowConfigurationProvider,
  type WorkflowProviderListInput,
  type WorkflowProviderListPage,
  WorkflowSyncCursorExpiredError,
  WorkflowProviderError,
} from "./workflow-portability.js";

interface PageCursor {
  mode: "full" | "incremental";
  position: string | number;
  highWatermark: number;
  snapshotAt: string;
}

interface SupabaseRpcError {
  message: string;
  code?: string;
  status?: number;
  [key: string]: unknown;
}

export interface SupabaseRpcResponseEnvelope {
  data: unknown;
  error: SupabaseRpcError | null;
}

function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): PageCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as PageCursor;
    if (
      (parsed.mode !== "full" && parsed.mode !== "incremental") ||
      (typeof parsed.position !== "string" &&
        typeof parsed.position !== "number") ||
      !Number.isSafeInteger(parsed.highWatermark) ||
      parsed.highWatermark < 0 ||
      typeof parsed.snapshotAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.snapshotAt)) ||
      (parsed.mode === "incremental" &&
        (typeof parsed.position !== "number" ||
          !Number.isSafeInteger(parsed.position) ||
          parsed.position < 0)) ||
      (parsed.mode === "full" && typeof parsed.position !== "string")
    )
      throw new Error();
    return parsed;
  } catch {
    throw new Error("Workflow synchronization cursor is invalid.");
  }
}

function supabaseOwnerId(ownerId: string): string {
  const match = /^owner_([a-f0-9]{32})$/i.exec(ownerId);
  if (!match) throw new Error("Rove owner identity is not a Supabase subject.");
  const subject = match[1]!;
  return `${subject.slice(0, 8)}-${subject.slice(8, 12)}-${subject.slice(12, 16)}-${subject.slice(16, 20)}-${subject.slice(20)}`;
}

function ownedRecord(value: unknown, ownerId: string): RemoteWorkflowRecord {
  return providerContract(() => {
    if (typeof value !== "object" || value === null)
      throw new Error("The record is not an object.");
    if ((value as Record<string, unknown>).ownerId !== supabaseOwnerId(ownerId))
      throw new Error("The record belongs to another owner.");
    return validateRemoteWorkflowRecord({
      ...(value as Record<string, unknown>),
      ownerId,
    });
  }, "Supabase Workflow provider returned an invalid record.");
}

export function providerFailure(
  error: unknown,
  outcomeMayBeUncertain = false,
): Error {
  if (
    error instanceof WorkflowProviderError ||
    error instanceof WorkflowSyncCursorExpiredError
  )
    return error;
  const value =
    typeof error === "object" && error !== null
      ? (error as { message?: unknown; code?: unknown; status?: unknown })
      : {};
  const message =
    typeof value.message === "string" ? value.message : String(error);
  const code = typeof value.code === "string" ? value.code : undefined;
  const status = typeof value.status === "number" ? value.status : undefined;
  if (message.includes("WORKFLOW_SYNC_CURSOR_EXPIRED"))
    return new WorkflowSyncCursorExpiredError();
  if (
    code === "40001" ||
    /revision conflict|cannot be resurrected/i.test(message)
  )
    return new WorkflowProviderError("conflict", message);
  if (
    code === "42501" ||
    code === "PGRST301" ||
    code === "PGRST302" ||
    status === 401 ||
    status === 403 ||
    /jwt|session.*(?:expired|revoked)|not authenticated/i.test(message)
  )
    return new WorkflowProviderError("auth_required", message);
  if (code === "22023")
    return new WorkflowProviderError("schema_rejected", message);
  if (code === "23505") return new WorkflowProviderError("definitive", message);
  if (
    status === 0 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    code === "57P01" ||
    /unavailable|paused|failed to fetch|fetch failed|network|timeout|timed out/i.test(
      message,
    )
  )
    return new WorkflowProviderError(
      outcomeMayBeUncertain ? "transport_uncertain" : "unavailable",
      message,
    );
  return new WorkflowProviderError(
    outcomeMayBeUncertain ? "transport_uncertain" : "definitive",
    message,
  );
}

export function invalidProviderResponse(
  message: string,
): WorkflowProviderError {
  return new WorkflowProviderError("definitive", message);
}

export function validateSupabaseRpcResponse(
  value: unknown,
  operation: string,
): SupabaseRpcResponseEnvelope {
  const invalid = () =>
    invalidProviderResponse(
      `Supabase ${operation} returned an invalid response envelope.`,
    );
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw invalid();
  const envelope = value as Record<string, unknown>;
  if (
    !("success" in envelope) ||
    !("data" in envelope) ||
    !("error" in envelope) ||
    !("count" in envelope) ||
    !("status" in envelope) ||
    !("statusText" in envelope) ||
    typeof envelope.success !== "boolean" ||
    envelope.data === undefined ||
    (envelope.count !== null &&
      (!Number.isSafeInteger(envelope.count) || Number(envelope.count) < 0)) ||
    !Number.isSafeInteger(envelope.status) ||
    Number(envelope.status) < 0 ||
    typeof envelope.statusText !== "string"
  )
    throw invalid();
  if (envelope.success) {
    if (
      envelope.error !== null ||
      Number(envelope.status) < 200 ||
      Number(envelope.status) >= 300
    )
      throw invalid();
    return { data: envelope.data, error: null };
  }
  if (
    envelope.data !== null ||
    typeof envelope.error !== "object" ||
    envelope.error === null ||
    Array.isArray(envelope.error) ||
    typeof (envelope.error as Record<string, unknown>).message !== "string"
  )
    throw invalid();
  const error = envelope.error as SupabaseRpcError;
  if ("code" in error && typeof error.code !== "string") throw invalid();
  return {
    data: null,
    error: { ...error, status: Number(envelope.status) },
  };
}

function providerContract<T>(operation: () => T, message: string): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof WorkflowProviderError) throw error;
    throw invalidProviderResponse(
      `${message}${error instanceof Error ? ` ${error.message}` : ""}`,
    );
  }
}

function result<T>(
  data: T | null,
  error: { message: string; code?: string; status?: number } | null,
  outcomeMayBeUncertain = false,
): T {
  if (error?.message.includes("WORKFLOW_SYNC_CURSOR_EXPIRED"))
    throw new WorkflowSyncCursorExpiredError();
  if (error) throw providerFailure(error, outcomeMayBeUncertain);
  if (data === null)
    throw invalidProviderResponse(
      "Supabase Workflow provider returned no result.",
    );
  return data;
}

function listRows(value: unknown): Array<{
  record: unknown;
  cursor_position: number;
  workflow_id: string;
}> {
  if (!Array.isArray(value))
    throw invalidProviderResponse(
      "Supabase Workflow provider returned an invalid page.",
    );
  return value.map((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).workflow_id !== "string" ||
      !Number.isSafeInteger(
        (entry as Record<string, unknown>).cursor_position,
      ) ||
      Number((entry as Record<string, unknown>).cursor_position) < 0 ||
      !("record" in entry)
    )
      throw invalidProviderResponse(
        "Supabase Workflow provider returned an invalid page row.",
      );
    return entry as {
      record: unknown;
      cursor_position: number;
      workflow_id: string;
    };
  });
}

async function providerRequest(
  request: PromiseLike<unknown>,
  operation: string,
  outcomeMayBeUncertain = false,
): Promise<SupabaseRpcResponseEnvelope> {
  let response: unknown;
  try {
    response = await request;
  } catch (error) {
    throw providerFailure(error, outcomeMayBeUncertain);
  }
  return validateSupabaseRpcResponse(response, operation);
}

/** Supabase Data API adapter. Authentication is supplied by the caller's
 * user session; this class never accepts or embeds a service-role key. */
export class SupabaseWorkflowConfigurationProvider implements WorkflowConfigurationProvider {
  constructor(private readonly client: SupabaseClient) {}

  async list(
    input: WorkflowProviderListInput,
  ): Promise<WorkflowProviderListPage> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    )
      throw new Error("Workflow provider page size is invalid.");
    if (input.pageCursor && input.sinceCursor)
      throw new Error(
        "Workflow page and synchronization cursors are exclusive.",
      );
    const continuation = decodeCursor(input.pageCursor);
    const since = decodeCursor(input.sinceCursor);
    if (continuation === null) {
      const purge = await providerRequest(
        this.client.rpc("rove_purge_expired_workflow_tombstones"),
        "Workflow tombstone purge",
      );
      if (purge.error) throw providerFailure(purge.error);
      if (!Number.isSafeInteger(purge.data) || Number(purge.data) < 0)
        throw invalidProviderResponse(
          "Supabase Workflow provider returned an invalid purge result.",
        );
    }
    if (since && since.mode !== "incremental")
      throw new Error("Workflow synchronization cursor is invalid.");
    const incremental = continuation?.mode === "incremental" || since !== null;
    const positionResponse =
      continuation === null
        ? await providerRequest(
            this.client.rpc("rove_workflow_sync_position", {
              p_owner_id: supabaseOwnerId(input.ownerId),
            }),
            "Workflow synchronization position",
          )
        : null;
    const anchorValue =
      continuation ??
      result(positionResponse!.data as unknown, positionResponse!.error);
    if (typeof anchorValue !== "object" || anchorValue === null)
      throw invalidProviderResponse(
        "Supabase Workflow provider returned an invalid synchronization anchor.",
      );
    const anchor = anchorValue as Record<string, unknown>;
    const highWatermark = anchor.highWatermark;
    const snapshotAt = anchor.snapshotAt;
    if (
      typeof highWatermark !== "number" ||
      !Number.isSafeInteger(highWatermark) ||
      highWatermark < 0 ||
      typeof snapshotAt !== "string" ||
      !Number.isFinite(Date.parse(snapshotAt))
    )
      throw invalidProviderResponse(
        "Supabase Workflow provider returned an invalid synchronization anchor.",
      );
    const position =
      continuation?.position ?? since?.position ?? (incremental ? 0 : null);
    const response = await providerRequest(
      this.client.rpc("rove_workflow_list", {
        p_owner_id: supabaseOwnerId(input.ownerId),
        p_limit: input.limit + 1,
        p_after_workflow_id: incremental ? null : position,
        p_since_sequence: incremental ? position : null,
        p_high_watermark: highWatermark,
        p_snapshot_at: snapshotAt,
      }),
      "Workflow list",
    );
    const rows = listRows(result(response.data as unknown, response.error));
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    const items = page.map((row) => {
      const record = ownedRecord(row.record, input.ownerId);
      if (row.workflow_id !== record.workflowId)
        throw invalidProviderResponse(
          "Supabase Workflow provider returned an inconsistent page identity.",
        );
      return record;
    });
    const last = page.at(-1);
    return {
      items,
      nextPageCursor:
        hasMore && last
          ? encodeCursor({
              mode: incremental ? "incremental" : "full",
              position: incremental ? last.cursor_position : last.workflow_id,
              highWatermark,
              snapshotAt,
            })
          : null,
      syncCursor: hasMore
        ? null
        : encodeCursor({
            mode: "incremental",
            position: highWatermark,
            highWatermark,
            snapshotAt,
          }),
      authoritative: !incremental,
    };
  }

  async read(
    ownerId: string,
    workflowId: string,
  ): Promise<RemoteWorkflowRecord | null> {
    const response = await providerRequest(
      this.client.rpc("rove_workflow_read", {
        p_owner_id: supabaseOwnerId(ownerId),
        p_workflow_id: workflowId,
      }),
      "Workflow read",
    );
    if (response.error) throw providerFailure(response.error);
    return response.data === null ? null : ownedRecord(response.data, ownerId);
  }

  async write(
    input: Parameters<WorkflowConfigurationProvider["write"]>[0],
  ): Promise<RemoteWorkflowRecord & { state: "active" }> {
    const snapshot = validatePortableWorkflowSnapshot(input.snapshot);
    const ownerId = supabaseOwnerId(input.ownerId);
    const request = {
      kind: "write",
      ownerId,
      expectedRemoteRevision: input.expectedRemoteRevision,
      snapshotDigest: snapshot.digest,
    };
    const response = await providerRequest(
      this.client.rpc("rove_workflow_write", {
        p_owner_id: ownerId,
        p_operation_id: input.operationId,
        p_request_digest: portableDigest(request),
        p_expected_remote_revision: input.expectedRemoteRevision,
        p_record: snapshot,
        p_updated_at: input.updatedAt,
      }),
      "Workflow write",
      true,
    );
    const record = ownedRecord(
      result(response.data, response.error, true),
      input.ownerId,
    );
    if (record.state !== "active")
      throw invalidProviderResponse(
        "Supabase Workflow provider returned an invalid write result.",
      );
    return record;
  }

  async delete(
    input: Parameters<WorkflowConfigurationProvider["delete"]>[0],
  ): Promise<RemoteWorkflowRecord & { state: "deleted" }> {
    const request = {
      kind: "delete",
      ownerId: supabaseOwnerId(input.ownerId),
      workflowId: input.workflowId,
      expectedRemoteRevision: input.expectedRemoteRevision,
      snapshotDigest: null,
    };
    const response = await providerRequest(
      this.client.rpc("rove_workflow_delete", {
        p_owner_id: supabaseOwnerId(input.ownerId),
        p_workflow_id: input.workflowId,
        p_operation_id: input.operationId,
        p_request_digest: portableDigest(request),
        p_expected_remote_revision: input.expectedRemoteRevision,
        p_deleted_at: input.deletedAt,
      }),
      "Workflow delete",
      true,
    );
    const record = ownedRecord(
      result(response.data, response.error, true),
      input.ownerId,
    );
    if (record.state !== "deleted")
      throw invalidProviderResponse(
        "Supabase Workflow provider returned an invalid delete result.",
      );
    return record;
  }
}
