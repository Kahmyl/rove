import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { SupabaseWorkflowConfigurationProvider } from "./supabase-workflow-provider.js";
import {
  toPortableWorkflowSnapshot,
  WorkflowProviderError,
} from "./workflow-portability.js";
import type { WorkflowEnvironment } from "./workflows.js";

function success<T>(data: T) {
  return {
    success: true,
    data,
    error: null,
    count: null,
    status: 200,
    statusText: "OK",
  } as const;
}

function rpcFailure(error: { message: string; code?: string }, status = 400) {
  return {
    success: false,
    data: null,
    error,
    count: null,
    status,
    statusText: "Error",
  } as const;
}

const malformedEnvelopes = [
  ["null", null],
  ["undefined", undefined],
  ["number", 42],
  ["string", "invalid"],
  ["array", []],
  ["empty object", {}],
  [
    "missing data",
    {
      success: true,
      error: null,
      count: null,
      status: 200,
      statusText: "OK",
    },
  ],
  [
    "contradictory success",
    {
      success: true,
      data: null,
      error: { message: "unexpected error" },
      count: null,
      status: 200,
      statusText: "OK",
    },
  ],
] as const;

function remote(workflowId: string, remoteRevision: number) {
  const workflow: WorkflowEnvironment = {
    workflowId,
    name: workflowId,
    archived: false,
    currentRevision: 1,
    revision: {
      workflowId,
      revision: 1,
      configuration: {
        purpose: "Portable provider test",
        preferences: [],
        criteria: [],
        guidance: [],
        procedures: [],
        resourceRequirements: [],
        resultConventions: [],
        approvedKnowledge: [],
      },
      digest: "a".repeat(64),
      approvedAt: "2026-09-13T12:00:00.000Z",
    },
    createdAt: "2026-09-13T12:00:00.000Z",
    updatedAt: "2026-09-13T12:00:00.000Z",
  };
  return {
    schemaVersion: 1,
    ownerId: "00000000-0000-4000-8000-000000000001",
    workflowId,
    remoteRevision,
    state: "active",
    snapshot: toPortableWorkflowSnapshot(workflow),
    updatedAt: "2026-09-13T12:00:00.000Z",
  };
}

describe("Supabase Workflow provider", () => {
  it("uses a fixed high watermark across pages and translates the opaque owner", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      async rpc(name: string, args: Record<string, unknown> = {}) {
        calls.push({ name, args });
        if (name === "rove_purge_expired_workflow_tombstones")
          return success(0);
        if (name === "rove_workflow_sync_position")
          return success({
            highWatermark: 3,
            snapshotAt: "2026-09-13T12:00:00.000Z",
          });
        if (name === "rove_workflow_list") {
          if (args.p_after_workflow_id === null)
            return success([
              {
                record: remote("workflow_aaaaaaaa", 1),
                cursor_position: 0,
                workflow_id: "workflow_aaaaaaaa",
              },
              {
                record: remote("workflow_bbbbbbbb", 1),
                cursor_position: 0,
                workflow_id: "workflow_bbbbbbbb",
              },
            ]);
          return success([
            {
              record: remote("workflow_bbbbbbbb", 1),
              cursor_position: 0,
              workflow_id: "workflow_bbbbbbbb",
            },
          ]);
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
    } as unknown as SupabaseClient;
    const provider = new SupabaseWorkflowConfigurationProvider(client);
    const first = await provider.list({
      ownerId: "owner_00000000000040008000000000000001",
      limit: 1,
    });
    const second = await provider.list({
      ownerId: "owner_00000000000040008000000000000001",
      limit: 1,
      pageCursor: first.nextPageCursor!,
    });
    expect(first.items.map((item) => item.workflowId)).toEqual([
      "workflow_aaaaaaaa",
    ]);
    expect(second.items.map((item) => item.workflowId)).toEqual([
      "workflow_bbbbbbbb",
    ]);
    expect(second.syncCursor).not.toBeNull();
    expect(
      calls.filter((call) => call.name === "rove_workflow_sync_position"),
    ).toHaveLength(1);
    expect(
      calls
        .filter((call) => call.name === "rove_workflow_list")
        .map((call) => call.args.p_high_watermark),
    ).toEqual([3, 3]);
    expect(
      calls
        .filter((call) => call.name === "rove_workflow_list")
        .map((call) => call.args.p_snapshot_at),
    ).toEqual(["2026-09-13T12:00:00.000Z", "2026-09-13T12:00:00.000Z"]);
    expect(
      calls.find((call) => call.name === "rove_workflow_list")?.args.p_owner_id,
    ).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("rejects non-Supabase logical owner identities before an RPC", async () => {
    const client = {
      async rpc() {
        return success(0);
      },
    } as unknown as SupabaseClient;
    const provider = new SupabaseWorkflowConfigurationProvider(client);
    await expect(
      provider.read("owner_not-a-subject", "workflow_aaaaaaaa"),
    ).rejects.toThrow(/not a Supabase subject/);
  });

  it("rejects a response whose owner does not match the requested subject", async () => {
    const client = {
      async rpc(name: string) {
        if (name === "rove_workflow_read")
          return success({
            ...remote("workflow_aaaaaaaa", 1),
            ownerId: "00000000-0000-4000-8000-000000000002",
          });
        throw new Error(`Unexpected RPC ${name}`);
      },
    } as unknown as SupabaseClient;
    const provider = new SupabaseWorkflowConfigurationProvider(client);
    const failure = await provider
      .read("owner_00000000000040008000000000000001", "workflow_aaaaaaaa")
      .catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(WorkflowProviderError);
    expect((failure as WorkflowProviderError).code).toBe("definitive");
    expect((failure as Error).message).toMatch(/another owner/);
  });

  it.each(malformedEnvelopes)(
    "classifies a fulfilled read with a %s response envelope as definitive",
    async (_label, envelope) => {
      const client = {
        async rpc() {
          return envelope;
        },
      } as unknown as SupabaseClient;
      const provider = new SupabaseWorkflowConfigurationProvider(client);
      const caught = await provider
        .read("owner_00000000000040008000000000000001", "workflow_aaaaaaaa")
        .catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(WorkflowProviderError);
      expect((caught as WorkflowProviderError).code).toBe("definitive");
    },
  );

  it.each(malformedEnvelopes)(
    "classifies a fulfilled list with a %s response envelope as definitive",
    async (_label, envelope) => {
      const client = {
        async rpc() {
          return envelope;
        },
      } as unknown as SupabaseClient;
      const provider = new SupabaseWorkflowConfigurationProvider(client);
      const caught = await provider
        .list({
          ownerId: "owner_00000000000040008000000000000001",
          limit: 10,
        })
        .catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(WorkflowProviderError);
      expect((caught as WorkflowProviderError).code).toBe("definitive");
    },
  );

  it.each([
    ["create", null],
    ["update", 1],
  ] as const)(
    "classifies a fulfilled %s with a malformed response envelope as definitive",
    async (_label, expectedRemoteRevision) => {
      const client = {
        async rpc() {
          return null;
        },
      } as unknown as SupabaseClient;
      const provider = new SupabaseWorkflowConfigurationProvider(client);
      const caught = await provider
        .write({
          ownerId: "owner_00000000000040008000000000000001",
          operationId: "sync_envelope_failure000",
          expectedRemoteRevision,
          snapshot: remote("workflow_aaaaaaaa", 1).snapshot,
          updatedAt: "2026-09-13T12:00:00.000Z",
        })
        .catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(WorkflowProviderError);
      expect((caught as WorkflowProviderError).code).toBe("definitive");
    },
  );

  it("classifies a fulfilled delete with a malformed response envelope as definitive", async () => {
    const client = {
      async rpc() {
        return null;
      },
    } as unknown as SupabaseClient;
    const provider = new SupabaseWorkflowConfigurationProvider(client);
    const caught = await provider
      .delete({
        ownerId: "owner_00000000000040008000000000000001",
        workflowId: "workflow_aaaaaaaa",
        operationId: "sync_delete_envelope_failure000",
        expectedRemoteRevision: 1,
        deletedAt: "2026-09-13T12:00:00.000Z",
      })
      .catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(WorkflowProviderError);
    expect((caught as WorkflowProviderError).code).toBe("definitive");
  });

  it.each([
    ["null payload", null],
    ["non-record payload", "invalid"],
    [
      "wrong owner",
      {
        ...remote("workflow_aaaaaaaa", 1),
        ownerId: "00000000-0000-4000-8000-000000000002",
      },
    ],
    [
      "invalid revision",
      { ...remote("workflow_aaaaaaaa", 1), remoteRevision: 0 },
    ],
    [
      "invalid digest",
      {
        ...remote("workflow_aaaaaaaa", 1),
        snapshot: {
          ...remote("workflow_aaaaaaaa", 1).snapshot,
          digest: "invalid",
        },
      },
    ],
  ])(
    "classifies a successful mutation with %s as a definitive contract failure",
    async (_label, data) => {
      const client = {
        async rpc() {
          return success(data);
        },
      } as unknown as SupabaseClient;
      const provider = new SupabaseWorkflowConfigurationProvider(client);
      const failure = await provider
        .write({
          ownerId: "owner_00000000000040008000000000000001",
          operationId: "sync_contract_failure000",
          expectedRemoteRevision: null,
          snapshot: remote("workflow_aaaaaaaa", 1).snapshot,
          updatedAt: "2026-09-13T12:00:00.000Z",
        })
        .catch((caught: unknown) => caught);
      expect(failure).toBeInstanceOf(WorkflowProviderError);
      expect((failure as WorkflowProviderError).code).toBe("definitive");
    },
  );

  it.each([
    null,
    {},
    [{ workflow_id: "workflow_aaaaaaaa" }],
    [
      {
        workflow_id: "workflow_bbbbbbbb",
        cursor_position: 0,
        record: remote("workflow_aaaaaaaa", 1),
      },
    ],
  ])(
    "classifies a successful list with malformed data as definitive",
    async (data) => {
      const client = {
        async rpc(name: string) {
          if (name === "rove_purge_expired_workflow_tombstones")
            return success(0);
          if (name === "rove_workflow_sync_position")
            return success({
              highWatermark: 1,
              snapshotAt: "2026-09-13T12:00:00.000Z",
            });
          if (name === "rove_workflow_list") return success(data);
          throw new Error(`Unexpected RPC ${name}`);
        },
      } as unknown as SupabaseClient;
      const provider = new SupabaseWorkflowConfigurationProvider(client);
      const failure = await provider
        .list({
          ownerId: "owner_00000000000040008000000000000001",
          limit: 10,
        })
        .catch((caught: unknown) => caught);
      expect(failure).toBeInstanceOf(WorkflowProviderError);
      expect((failure as WorkflowProviderError).code).toBe("definitive");
    },
  );

  it.each([
    [{ code: "42501", message: "permission denied" }, "auth_required"],
    [{ code: "40001", message: "revision conflict" }, "conflict"],
    [{ code: "22023", message: "invalid snapshot" }, "schema_rejected"],
    [{ code: "23505", message: "known duplicate" }, "definitive"],
    [{ status: 503, message: "service unavailable" }, "unavailable"],
    [{ status: 0, message: "FetchError: fetch failed" }, "unavailable"],
  ] as const)("classifies read failure %o as %s", async (error, code) => {
    const client = {
      async rpc() {
        return rpcFailure(error, "status" in error ? error.status : 400);
      },
    } as unknown as SupabaseClient;
    const provider = new SupabaseWorkflowConfigurationProvider(client);
    const failure = await provider
      .read("owner_00000000000040008000000000000001", "workflow_aaaaaaaa")
      .catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(WorkflowProviderError);
    expect((failure as WorkflowProviderError).code).toBe(code);
  });

  it("classifies a rejected mutation transport as uncertain", async () => {
    const client = {
      async rpc() {
        throw new Error("connection closed after request");
      },
    } as unknown as SupabaseClient;
    const provider = new SupabaseWorkflowConfigurationProvider(client);
    const failure = await provider
      .write({
        ownerId: "owner_00000000000040008000000000000001",
        operationId: "sync_uncertain000",
        expectedRemoteRevision: null,
        snapshot: remote("workflow_aaaaaaaa", 1).snapshot,
        updatedAt: "2026-09-13T12:00:00.000Z",
      })
      .catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(WorkflowProviderError);
    expect((failure as WorkflowProviderError).code).toBe("transport_uncertain");
  });

  it("classifies the installed client's fulfilled fetch failure as uncertain for a mutation", async () => {
    const client = {
      async rpc() {
        return rpcFailure({ code: "", message: "TypeError: fetch failed" }, 0);
      },
    } as unknown as SupabaseClient;
    const provider = new SupabaseWorkflowConfigurationProvider(client);
    const caught = await provider
      .write({
        ownerId: "owner_00000000000040008000000000000001",
        operationId: "sync_fulfilled_transport_failure000",
        expectedRemoteRevision: null,
        snapshot: remote("workflow_aaaaaaaa", 1).snapshot,
        updatedAt: "2026-09-13T12:00:00.000Z",
      })
      .catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(WorkflowProviderError);
    expect((caught as WorkflowProviderError).code).toBe("transport_uncertain");
  });

  it.each([
    [{ code: "42501", message: "permission denied" }, "auth_required"],
    [{ code: "40001", message: "revision conflict" }, "conflict"],
    [{ code: "22023", message: "invalid snapshot" }, "schema_rejected"],
  ] as const)(
    "preserves definitive mutation failure %o as %s",
    async (error, code) => {
      const client = {
        async rpc() {
          return rpcFailure(error);
        },
      } as unknown as SupabaseClient;
      const provider = new SupabaseWorkflowConfigurationProvider(client);
      const failure = await provider
        .write({
          ownerId: "owner_00000000000040008000000000000001",
          operationId: "sync_known_failure000",
          expectedRemoteRevision: null,
          snapshot: remote("workflow_aaaaaaaa", 1).snapshot,
          updatedAt: "2026-09-13T12:00:00.000Z",
        })
        .catch((caught: unknown) => caught);
      expect(failure).toBeInstanceOf(WorkflowProviderError);
      expect((failure as WorkflowProviderError).code).toBe(code);
    },
  );
});
