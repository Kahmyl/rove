import { describe, expect, it } from "vitest";

import type { WorkflowEnvironment } from "./workflows.js";
import {
  InMemoryWorkflowConfigurationProvider,
  planWorkflowSynchronization,
  toPortableWorkflowSnapshot,
  validatePortableWorkflowSnapshot,
  validateRemoteWorkflowRecord,
  WorkflowSyncCursorExpiredError,
} from "./workflow-portability.js";

const workflow = (
  purpose = "Review launches",
  workflowId = "workflow_12345678",
): WorkflowEnvironment => ({
  workflowId,
  name: "Launch review",
  archived: false,
  currentRevision: 3,
  revision: {
    workflowId,
    revision: 3,
    configuration: {
      purpose,
      preferences: [{ id: "e1", text: "Prefer evidence", appliesTo: [] }],
      criteria: [],
      guidance: [],
      procedures: [],
      resourceRequirements: [
        { id: "r1", kind: "account", label: "Publishing account" },
      ],
      resultConventions: [],
      approvedKnowledge: [],
    },
    digest: "a".repeat(64),
    approvedAt: "2026-09-13T12:00:00.000Z",
  },
  createdAt: "2026-09-13T11:00:00.000Z",
  updatedAt: "2026-09-13T12:00:00.000Z",
});

describe("Workflow portability boundary", () => {
  it("projects only approved portable configuration and rejects internal or secret fields", () => {
    const source = workflow();
    const portable = toPortableWorkflowSnapshot(source);
    expect(portable).toMatchObject({
      schemaVersion: 1,
      workflowId: source.workflowId,
      configurationRevision: 3,
      name: "Launch review",
    });
    const serialized = JSON.stringify(portable);
    for (const forbidden of [
      "taskId",
      "resultId",
      "artifact",
      "recording",
      "approval",
      "browser",
      "createdAt",
      "updatedAt",
    ])
      expect(serialized).not.toContain(forbidden);
    expect(() =>
      validatePortableWorkflowSnapshot({ ...portable, tasks: [] }),
    ).toThrow(/fields/);
    expect(() =>
      validatePortableWorkflowSnapshot({
        ...portable,
        configuration: {
          ...portable.configuration,
          purpose: "password=super-secret-value",
        },
      }),
    ).toThrow(/secret material/);
    expect(() =>
      validateRemoteWorkflowRecord({
        schemaVersion: 1,
        ownerId: "owner_12345678",
        workflowId: portable.workflowId,
        remoteRevision: 1,
        state: "active",
        snapshot: portable,
        updatedAt: "2026-09-13T12:01:00.000Z",
        tasks: [],
      }),
    ).toThrow(/fields/);
  });

  it("enforces owner isolation, compare-and-set, and operation idempotency", async () => {
    const provider = new InMemoryWorkflowConfigurationProvider();
    const snapshot = toPortableWorkflowSnapshot(workflow());
    const input = {
      ownerId: "owner_12345678",
      operationId: "sync_12345678",
      expectedRemoteRevision: null,
      snapshot,
      updatedAt: "2026-09-13T12:01:00.000Z",
    } as const;
    const created = await provider.write(input);
    await expect(provider.write(input)).resolves.toEqual(created);
    await expect(
      provider.write({
        ...input,
        snapshot: toPortableWorkflowSnapshot(workflow("Changed purpose")),
      }),
    ).rejects.toThrow(/reused with different input/);
    await expect(
      provider.write({
        ...input,
        operationId: "sync_87654321",
      }),
    ).rejects.toThrow(/revision conflict/);
    await expect(
      provider.read("owner_87654321", snapshot.workflowId),
    ).resolves.toBeNull();
    await expect(
      provider.list({ ownerId: "owner_87654321", limit: 10 }),
    ).resolves.toMatchObject({ items: [], authoritative: true });
    await expect(
      provider.list({ ownerId: "owner_12345678", limit: 10 }),
    ).resolves.toMatchObject({ items: [created], authoritative: true });
  });

  it("provides bounded stable pages and owner-scoped incremental discovery", async () => {
    const provider = new InMemoryWorkflowConfigurationProvider();
    const ownerId = "owner_12345678";
    for (const [index, workflowId] of [
      "workflow_11111111",
      "workflow_22222222",
      "workflow_33333333",
    ].entries())
      await provider.write({
        ownerId,
        operationId: `sync_page000${index}`,
        expectedRemoteRevision: null,
        snapshot: toPortableWorkflowSnapshot(workflow("Review", workflowId)),
        updatedAt: `2026-09-13T12:0${index}:00.000Z`,
      });

    const first = await provider.list({ ownerId, limit: 1 });
    expect(first).toMatchObject({
      authoritative: true,
      syncCursor: null,
    });
    expect(first.items).toHaveLength(1);
    expect(first.nextPageCursor).not.toBeNull();

    const added = await provider.write({
      ownerId,
      operationId: "sync_page9999",
      expectedRemoteRevision: null,
      snapshot: toPortableWorkflowSnapshot(
        workflow("Added during paging", "workflow_44444444"),
      ),
      updatedAt: "2026-09-13T12:04:00.000Z",
    });
    const second = await provider.list({
      ownerId,
      limit: 100,
      pageCursor: first.nextPageCursor!,
    });
    const third = await provider.list({
      ownerId,
      limit: 100,
      pageCursor: second.nextPageCursor!,
    });
    expect([...first.items, ...second.items, ...third.items]).toHaveLength(3);
    expect(third.syncCursor).not.toBeNull();

    const incremental = await provider.list({
      ownerId,
      limit: 10,
      sinceCursor: third.syncCursor!,
    });
    expect(incremental).toMatchObject({
      items: [added],
      authoritative: false,
      nextPageCursor: null,
    });
    await expect(
      provider.list({
        ownerId: "owner_87654321",
        limit: 10,
        sinceCursor: third.syncCursor!,
      }),
    ).rejects.toBeInstanceOf(WorkflowSyncCursorExpiredError);
  });

  it("retains tombstones and rejects stale offline resurrection", async () => {
    const provider = new InMemoryWorkflowConfigurationProvider();
    const snapshot = toPortableWorkflowSnapshot(workflow());
    const created = await provider.write({
      ownerId: "owner_12345678",
      operationId: "sync_create123",
      expectedRemoteRevision: null,
      snapshot,
      updatedAt: "2026-09-13T12:01:00.000Z",
    });
    const baseline = await provider.list({
      ownerId: "owner_12345678",
      limit: 10,
    });
    const deleted = await provider.delete({
      ownerId: "owner_12345678",
      workflowId: snapshot.workflowId,
      operationId: "sync_delete123",
      expectedRemoteRevision: created.remoteRevision,
      deletedAt: "2026-09-13T12:02:00.000Z",
    });
    expect(deleted).toMatchObject({ state: "deleted", remoteRevision: 2 });
    await expect(
      provider.write({
        ownerId: "owner_12345678",
        operationId: "sync_offline12",
        expectedRemoteRevision: created.remoteRevision,
        snapshot: toPortableWorkflowSnapshot(workflow("Offline edit")),
        updatedAt: "2026-09-13T12:03:00.000Z",
      }),
    ).rejects.toThrow(/revision conflict/);

    await expect(
      provider.list({
        ownerId: "owner_12345678",
        limit: 10,
        sinceCursor: baseline.syncCursor!,
      }),
    ).resolves.toMatchObject({ items: [deleted], authoritative: false });

    const initial = await provider.list({
      ownerId: "owner_12345678",
      limit: 10,
    });
    expect(initial.items).toEqual([deleted]);
    provider.expireCursor(initial.syncCursor!);
    await expect(
      provider.list({
        ownerId: "owner_12345678",
        limit: 10,
        sinceCursor: initial.syncCursor!,
      }),
    ).rejects.toMatchObject({ code: "WORKFLOW_SYNC_CURSOR_EXPIRED" });
    await expect(
      provider.list({ ownerId: "owner_12345678", limit: 10 }),
    ).resolves.toMatchObject({ items: [deleted], authoritative: true });
  });

  it("plans upload, download, conflict, equality, and remote deletion without dispatch", async () => {
    const provider = new InMemoryWorkflowConfigurationProvider();
    const original = toPortableWorkflowSnapshot(workflow());
    expect(
      planWorkflowSynchronization({
        ownerId: "owner_12345678",
        local: original,
        cursor: null,
        remote: null,
      }),
    ).toEqual({ state: "pending_upload", expectedRemoteRevision: null });
    const remote = await provider.write({
      ownerId: "owner_12345678",
      operationId: "sync_plan1234",
      expectedRemoteRevision: null,
      snapshot: original,
      updatedAt: "2026-09-13T12:01:00.000Z",
    });
    expect(
      planWorkflowSynchronization({
        ownerId: "owner_12345678",
        local: original,
        cursor: null,
        remote,
      }),
    ).toEqual({ state: "synchronized", remoteRevision: 1 });
    expect(() =>
      planWorkflowSynchronization({
        ownerId: "owner_87654321",
        local: original,
        cursor: null,
        remote,
      }),
    ).toThrow(/ownership/);
    const localEdit = toPortableWorkflowSnapshot(workflow("Local edit"));
    expect(
      planWorkflowSynchronization({
        ownerId: "owner_12345678",
        local: localEdit,
        cursor: {
          acknowledgedRemoteRevision: 1,
          acknowledgedLocalDigest: original.digest,
        },
        remote,
      }),
    ).toEqual({ state: "pending_upload", expectedRemoteRevision: 1 });
    const remoteEdit = await provider.write({
      ownerId: "owner_12345678",
      operationId: "sync_plan5678",
      expectedRemoteRevision: 1,
      snapshot: toPortableWorkflowSnapshot(workflow("Remote edit")),
      updatedAt: "2026-09-13T12:02:00.000Z",
    });
    expect(
      planWorkflowSynchronization({
        ownerId: "owner_12345678",
        local: original,
        cursor: {
          acknowledgedRemoteRevision: 1,
          acknowledgedLocalDigest: original.digest,
        },
        remote: remoteEdit,
      }).state,
    ).toBe("pending_download");
    expect(
      planWorkflowSynchronization({
        ownerId: "owner_12345678",
        local: localEdit,
        cursor: {
          acknowledgedRemoteRevision: 1,
          acknowledgedLocalDigest: original.digest,
        },
        remote: remoteEdit,
      }).state,
    ).toBe("conflicted");
    const tombstone = await provider.delete({
      ownerId: "owner_12345678",
      workflowId: original.workflowId,
      operationId: "sync_plan9999",
      expectedRemoteRevision: 2,
      deletedAt: "2026-09-13T12:03:00.000Z",
    });
    expect(
      planWorkflowSynchronization({
        ownerId: "owner_12345678",
        local: localEdit,
        cursor: {
          acknowledgedRemoteRevision: 1,
          acknowledgedLocalDigest: original.digest,
        },
        remote: tombstone,
      }).state,
    ).toBe("deleted_remotely");
  });
});
