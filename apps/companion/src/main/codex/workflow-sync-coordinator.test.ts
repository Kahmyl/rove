import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { WorkflowEnvironment } from "./workflows.js";
import {
  InMemoryWorkflowConfigurationProvider,
  toPortableWorkflowSnapshot,
  WorkflowProviderError,
} from "./workflow-portability.js";
import {
  WorkflowSyncCoordinator,
  type WorkflowSyncLocalPort,
} from "./workflow-sync-coordinator.js";
import { WorkflowSyncStateStore } from "./workflow-sync-state.js";
import { SupabaseWorkflowConfigurationProvider } from "./supabase-workflow-provider.js";

const homes: string[] = [];
afterEach(() => {
  while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
});
const state = () => {
  const home = mkdtempSync(join(tmpdir(), "rove-sync-"));
  homes.push(home);
  return new WorkflowSyncStateStore(join(home, "state.sqlite3"));
};

function workflow(
  revision = 1,
  purpose = "Review launches",
): WorkflowEnvironment {
  return {
    workflowId: "workflow_12345678",
    name: "Launch review",
    archived: false,
    currentRevision: revision,
    revision: {
      workflowId: "workflow_12345678",
      revision,
      configuration: {
        purpose,
        preferences: [],
        criteria: [],
        guidance: [],
        procedures: [],
        resourceRequirements: [],
        resultConventions: [],
        approvedKnowledge: [],
      },
      digest: "a".repeat(64),
      approvedAt: `2026-09-13T12:00:0${revision}.000Z`,
    },
    createdAt: "2026-09-13T12:00:00.000Z",
    updatedAt: `2026-09-13T12:00:0${revision}.000Z`,
  };
}

class LocalWorkflows implements WorkflowSyncLocalPort {
  readonly values = new Map<string, WorkflowEnvironment>();
  readonly resolutions = new Map<
    string,
    { workflow: WorkflowEnvironment; copy: WorkflowEnvironment }
  >();
  constructor(initial: WorkflowEnvironment[] = []) {
    initial.forEach((value) => this.values.set(value.workflowId, value));
  }
  listWorkflows(): readonly WorkflowEnvironment[] {
    return [...this.values.values()];
  }
  applyPortableWorkflowSnapshot(
    snapshot: ReturnType<typeof toPortableWorkflowSnapshot>,
  ): WorkflowEnvironment {
    const value: WorkflowEnvironment = {
      workflowId: snapshot.workflowId,
      name: snapshot.name,
      archived: snapshot.archived,
      currentRevision: snapshot.configurationRevision,
      revision: {
        workflowId: snapshot.workflowId,
        revision: snapshot.configurationRevision,
        configuration: snapshot.configuration,
        digest: "b".repeat(64),
        approvedAt: snapshot.approvedAt,
      },
      createdAt: snapshot.approvedAt,
      updatedAt: snapshot.approvedAt,
    };
    this.values.set(value.workflowId, value);
    return value;
  }
  replacePortableWorkflowSnapshot(
    snapshot: ReturnType<typeof toPortableWorkflowSnapshot>,
  ): WorkflowEnvironment {
    return this.applyPortableWorkflowSnapshot(snapshot);
  }
  createPortableWorkflowCopy(
    snapshot: ReturnType<typeof toPortableWorkflowSnapshot>,
  ): WorkflowEnvironment {
    const copy = {
      ...snapshot,
      workflowId: `workflow_copy${this.values.size}0000000`,
      name: `${snapshot.name} (local copy)`,
      configurationRevision: 1,
    };
    return this.applyPortableWorkflowSnapshot({
      ...copy,
      digest: toPortableWorkflowSnapshot(workflow(1)).digest,
    });
  }
  resolvePortableWorkflowConflict(input: {
    operationId: string;
    workflowId: string;
    remote: ReturnType<typeof toPortableWorkflowSnapshot>;
  }): { workflow: WorkflowEnvironment; copy: WorkflowEnvironment } {
    const prior = this.resolutions.get(input.operationId);
    if (prior) return prior;
    const local = this.values.get(input.workflowId);
    if (!local) throw new Error("Workflow is unavailable.");
    const copy = {
      ...local,
      workflowId: `workflow_copy${this.values.size}0000000`,
      name: `${local.name} (local copy)`,
      currentRevision: 1,
      revision: { ...local.revision, revision: 1 },
    };
    copy.revision.workflowId = copy.workflowId;
    this.values.set(copy.workflowId, copy);
    const resolvedWorkflow = this.applyPortableWorkflowSnapshot({
      ...input.remote,
      configurationRevision: local.currentRevision + 1,
    });
    const result = { workflow: resolvedWorkflow, copy };
    this.resolutions.set(input.operationId, result);
    return result;
  }
}

describe("Workflow synchronization qualification", () => {
  it("upgrades the prior sync ledger additively without losing owner metadata", () => {
    const home = mkdtempSync(join(tmpdir(), "rove-sync-upgrade-"));
    homes.push(home);
    const path = join(home, "state.sqlite3");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE workflow_sync_profile (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1), owner_id TEXT NOT NULL,
        sync_cursor TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE workflow_sync_item (
        owner_id TEXT NOT NULL, workflow_id TEXT NOT NULL, remote_revision INTEGER,
        local_digest TEXT, status TEXT NOT NULL, remote_json TEXT, error TEXT,
        updated_at TEXT NOT NULL, PRIMARY KEY(owner_id,workflow_id)
      );
      CREATE TABLE workflow_sync_binding (
        workflow_id TEXT PRIMARY KEY, owner_id TEXT, sync_enabled INTEGER NOT NULL,
        origin TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO workflow_sync_profile VALUES
        (1,'owner_12345678',NULL,'2026-09-13T12:00:00.000Z');
      INSERT INTO workflow_sync_item VALUES(
        'owner_12345678','workflow_12345678',1,
        '${"a".repeat(64)}','synchronized',NULL,NULL,
        '2026-09-13T12:00:00.000Z'
      );
      INSERT INTO workflow_sync_binding VALUES(
        'workflow_12345678','owner_12345678',1,'enabled',
        '2026-09-13T12:00:00.000Z','2026-09-13T12:00:00.000Z'
      );
    `);
    legacy.close();
    const upgraded = new WorkflowSyncStateStore(path);
    expect(upgraded.boundOwnerId()).toBe("owner_12345678");
    expect(upgraded.binding("workflow_12345678")).toMatchObject({
      ownerId: "owner_12345678",
      remoteWorkflowId: "workflow_12345678",
      syncEnabled: true,
    });
    expect(
      upgraded.state("owner_12345678", "workflow_12345678")?.cursor,
    ).toMatchObject({ acknowledgedRemoteRevision: 1 });
    upgraded.close();
  });

  it("does not enable synchronization merely because an account is signed in", async () => {
    const local = new LocalWorkflows([workflow()]);
    const sync = new WorkflowSyncCoordinator(
      local,
      state(),
      new InMemoryWorkflowConfigurationProvider(),
      () => "owner_12345678",
    );
    await expect(sync.synchronize()).rejects.toThrow(/Enable Workflow sync/);
    expect(sync.projection().boundOwnerId).toBeNull();
    expect(local.values.size).toBe(1);
  });

  it("converges two devices through offline edits without synchronizing local task data", async () => {
    const provider = new InMemoryWorkflowConfigurationProvider();
    const owner = () => "owner_12345678";
    const first = new LocalWorkflows([workflow()]);
    const second = new LocalWorkflows();
    const firstSync = new WorkflowSyncCoordinator(
      first,
      state(),
      provider,
      owner,
    );
    const secondSync = new WorkflowSyncCoordinator(
      second,
      state(),
      provider,
      owner,
    );
    firstSync.bindCurrentAccount();
    secondSync.bindCurrentAccount();
    await firstSync.synchronize();
    await secondSync.synchronize();
    expect(
      second.values.get("workflow_12345678")?.revision.configuration.purpose,
    ).toBe("Review launches");
    second.values.set(
      "workflow_12345678",
      workflow(2, "Review launches while offline"),
    );
    await secondSync.synchronize();
    await firstSync.synchronize();
    expect(
      first.values.get("workflow_12345678")?.revision.configuration.purpose,
    ).toBe("Review launches while offline");
    const portable = toPortableWorkflowSnapshot(
      first.values.get("workflow_12345678")!,
    );
    expect(Object.keys(portable).sort()).toEqual([
      "approvedAt",
      "archived",
      "configuration",
      "configurationRevision",
      "digest",
      "name",
      "schemaVersion",
      "workflowId",
    ]);
    expect(portable).not.toHaveProperty("tasks");
    expect(portable).not.toHaveProperty("results");
  });

  it("blocks account switching until explicit confirmation and discards only prior sync metadata", async () => {
    let owner = "owner_12345678";
    const local = new LocalWorkflows([workflow()]);
    const provider = new InMemoryWorkflowConfigurationProvider();
    const store = state();
    const sync = new WorkflowSyncCoordinator(
      local,
      store,
      provider,
      () => owner,
    );
    sync.bindCurrentAccount();
    await sync.synchronize();
    owner = "owner_87654321";
    expect(sync.projection().status).toBe("account_mismatch");
    await expect(sync.synchronize()).rejects.toThrow(
      /Confirm the account switch/,
    );
    sync.bindCurrentAccount(true);
    expect(local.values.size).toBe(1);
    await sync.synchronize();
    expect(sync.projection().boundOwnerId).toBe(owner);
    expect(await provider.read(owner, "workflow_12345678")).toBeNull();
    expect(store.states("owner_12345678")).toHaveLength(1);
    const bWorkflow = workflow(1, "Owner B Workflow");
    bWorkflow.workflowId = "workflow_bbbbbbbb";
    bWorkflow.revision.workflowId = "workflow_bbbbbbbb";
    local.values.set(bWorkflow.workflowId, bWorkflow);
    sync.noticeLocalChanges();
    await sync.synchronize();
    expect(await provider.read(owner, bWorkflow.workflowId)).not.toBeNull();
    owner = "owner_12345678";
    sync.bindCurrentAccount(true);
    await sync.synchronize();
    expect(await provider.read(owner, "workflow_12345678")).not.toBeNull();
    expect(await provider.read(owner, bWorkflow.workflowId)).toBeNull();
  });

  it("does not assign a Workflow created while signed out to the next account", async () => {
    let owner: string | null = "owner_12345678";
    const local = new LocalWorkflows([workflow()]);
    const provider = new InMemoryWorkflowConfigurationProvider();
    const store = state();
    const sync = new WorkflowSyncCoordinator(
      local,
      store,
      provider,
      () => owner,
    );
    sync.bindCurrentAccount();
    await sync.synchronize();

    owner = null;
    const signedOutWorkflow = workflow(1, "Created while signed out");
    signedOutWorkflow.workflowId = "workflow_signedout";
    signedOutWorkflow.revision.workflowId = signedOutWorkflow.workflowId;
    local.values.set(signedOutWorkflow.workflowId, signedOutWorkflow);
    expect(sync.noticeLocalChanges()).toBe(false);
    expect(store.binding(signedOutWorkflow.workflowId)).toMatchObject({
      ownerId: null,
      syncEnabled: false,
      origin: "device",
    });

    owner = "owner_87654321";
    sync.bindCurrentAccount(true);
    await sync.synchronize();
    expect(await provider.read(owner, signedOutWorkflow.workflowId)).toBeNull();
    expect(store.binding(signedOutWorkflow.workflowId)?.ownerId).toBeNull();
  });

  it("keeps colliding owner-scoped cloud identities as distinct local Workflows", async () => {
    let owner = "owner_12345678";
    const local = new LocalWorkflows([workflow(1, "Owner A local")]);
    const provider = new InMemoryWorkflowConfigurationProvider();
    const store = state();
    const sync = new WorkflowSyncCoordinator(
      local,
      store,
      provider,
      () => owner,
    );
    sync.bindCurrentAccount();
    await sync.synchronize();

    const ownerBSnapshot = toPortableWorkflowSnapshot(
      workflow(1, "Owner B remote"),
    );
    await provider.write({
      ownerId: "owner_87654321",
      operationId: "sync_owner_b_sameid",
      expectedRemoteRevision: null,
      snapshot: ownerBSnapshot,
      updatedAt: "2026-09-13T12:00:00.000Z",
    });
    owner = "owner_87654321";
    sync.bindCurrentAccount(true);
    await sync.synchronize();

    const ownerBLocal = [...local.values.values()].find(
      (entry) => entry.revision.configuration.purpose === "Owner B remote",
    );
    expect(ownerBLocal?.workflowId).not.toBe("workflow_12345678");
    expect(
      local.values.get("workflow_12345678")?.revision.configuration.purpose,
    ).toBe("Owner A local");
    expect(store.binding(ownerBLocal!.workflowId)).toMatchObject({
      ownerId: "owner_87654321",
      remoteWorkflowId: "workflow_12345678",
      syncEnabled: true,
    });
    expect(sync.projection().items[ownerBLocal!.workflowId]).toBe(
      "synchronized",
    );
    expect(sync.exportableWorkflows()).toMatchObject([
      { workflowId: "workflow_12345678" },
    ]);
  });

  it("keeps local configuration during remote deletion and requires a deletion choice", async () => {
    const provider = new InMemoryWorkflowConfigurationProvider();
    const local = new LocalWorkflows([workflow()]);
    const sync = new WorkflowSyncCoordinator(
      local,
      state(),
      provider,
      () => "owner_12345678",
    );
    sync.bindCurrentAccount();
    await sync.synchronize();
    const remote = await provider.read("owner_12345678", "workflow_12345678");
    await provider.delete({
      ownerId: "owner_12345678",
      workflowId: "workflow_12345678",
      operationId: "sync_delete123",
      expectedRemoteRevision: remote!.remoteRevision,
      deletedAt: "2026-09-13T13:00:00.000Z",
    });
    await sync.synchronize();
    expect(sync.projection().items.workflow_12345678).toBe("deleted_remotely");
    expect(local.values.has("workflow_12345678")).toBe(true);
    await sync.resolve("workflow_12345678", "keep_device_only");
    expect(sync.projection().items.workflow_12345678).toBe("local_only");
    await sync.synchronize();
    expect(sync.projection().items.workflow_12345678).toBe("local_only");
    sync.unbindAfterCloudDeletion();
    expect(sync.projection().boundOwnerId).toBeNull();
    expect(local.values.has("workflow_12345678")).toBe(true);
  });

  it("surfaces concurrent edits and applies an explicit cloud choice", async () => {
    const provider = new InMemoryWorkflowConfigurationProvider();
    const owner = () => "owner_12345678";
    const first = new LocalWorkflows([workflow()]);
    const second = new LocalWorkflows();
    const firstSync = new WorkflowSyncCoordinator(
      first,
      state(),
      provider,
      owner,
    );
    const secondSync = new WorkflowSyncCoordinator(
      second,
      state(),
      provider,
      owner,
    );
    firstSync.bindCurrentAccount();
    secondSync.bindCurrentAccount();
    await firstSync.synchronize();
    await secondSync.synchronize();
    first.values.set("workflow_12345678", workflow(2, "First device edit"));
    second.values.set("workflow_12345678", workflow(2, "Second device edit"));
    await secondSync.synchronize();
    await firstSync.synchronize();
    expect(firstSync.projection().items.workflow_12345678).toBe("conflicted");
    await firstSync.resolve("workflow_12345678", "keep_remote");
    expect(
      first.values.get("workflow_12345678")?.revision.configuration.purpose,
    ).toBe("Second device edit");
    expect(firstSync.projection().items.workflow_12345678).toBe("synchronized");
  });

  it("turns a compare-and-set race into a conflict instead of an outage", async () => {
    const provider = new InMemoryWorkflowConfigurationProvider();
    const local = new LocalWorkflows([workflow()]);
    const sync = new WorkflowSyncCoordinator(
      local,
      state(),
      provider,
      () => "owner_12345678",
    );
    sync.bindCurrentAccount();
    await sync.synchronize();
    local.values.set("workflow_12345678", workflow(2, "Local edit"));
    const write = provider.write.bind(provider);
    let raced = false;
    provider.write = async (input) => {
      if (!raced) {
        raced = true;
        await write({
          ...input,
          operationId: "sync_competitor123",
          snapshot: toPortableWorkflowSnapshot(workflow(2, "Remote edit")),
        });
      }
      return write(input);
    };
    const projection = await sync.synchronize();
    expect(projection.status).toBe("ready");
    expect(projection.items.workflow_12345678).toBe("conflicted");
    expect(
      local.values.get("workflow_12345678")?.revision.configuration.purpose,
    ).toBe("Local edit");
  });

  it("reports provider outage without disabling or mutating local Workflows", async () => {
    const local = new LocalWorkflows([workflow()]);
    const provider = new InMemoryWorkflowConfigurationProvider();
    provider.list = async () => {
      throw new Error("provider unavailable");
    };
    const sync = new WorkflowSyncCoordinator(
      local,
      state(),
      provider,
      () => "owner_12345678",
    );
    sync.bindCurrentAccount();
    const projection = await sync.synchronize();
    expect(projection.status).toBe("unavailable");
    expect(projection.items.workflow_12345678).toBe("unavailable");
    expect(local.values.size).toBe(1);
  });

  it("reuses a durable operation identity after a commit-lost response", async () => {
    const local = new LocalWorkflows([workflow()]);
    const backing = new InMemoryWorkflowConfigurationProvider();
    const operationIds: string[] = [];
    let loseResponse = true;
    const provider = {
      ...backing,
      list: backing.list.bind(backing),
      read: backing.read.bind(backing),
      delete: backing.delete.bind(backing),
      async write(input: Parameters<typeof backing.write>[0]) {
        operationIds.push(input.operationId);
        const result = await backing.write(input);
        if (loseResponse) {
          loseResponse = false;
          throw new Error("connection closed after commit");
        }
        return result;
      },
    };
    const sync = new WorkflowSyncCoordinator(
      local,
      state(),
      provider,
      () => "owner_12345678",
    );
    sync.bindCurrentAccount();
    expect((await sync.synchronize()).status).toBe("transport_uncertain");
    expect((await sync.synchronize()).status).toBe("ready");
    expect(operationIds).toHaveLength(2);
    expect(new Set(operationIds).size).toBe(1);
    expect(sync.projection().items.workflow_12345678).toBe("synchronized");
  });

  it("persists an owner-bound cursor and uses it after restart", async () => {
    const home = mkdtempSync(join(tmpdir(), "rove-sync-cursor-restart-"));
    homes.push(home);
    const path = join(home, "state.sqlite3");
    const local = new LocalWorkflows([workflow()]);
    const backing = new InMemoryWorkflowConfigurationProvider();
    const calls: Array<{ ownerId: string; sinceCursor?: string }> = [];
    const provider = {
      list: async (input: Parameters<typeof backing.list>[0]) => {
        calls.push({
          ownerId: input.ownerId,
          ...(input.sinceCursor ? { sinceCursor: input.sinceCursor } : {}),
        });
        return backing.list(input);
      },
      read: backing.read.bind(backing),
      write: backing.write.bind(backing),
      delete: backing.delete.bind(backing),
    };
    const firstState = new WorkflowSyncStateStore(path);
    const first = new WorkflowSyncCoordinator(
      local,
      firstState,
      provider,
      () => "owner_12345678",
    );
    first.bindCurrentAccount();
    await first.synchronize();
    const cursor = firstState.syncCursor("owner_12345678");
    expect(cursor).not.toBeNull();
    firstState.close();

    const reopenedState = new WorkflowSyncStateStore(path);
    const reopened = new WorkflowSyncCoordinator(
      local,
      reopenedState,
      provider,
      () => "owner_12345678",
    );
    await reopened.synchronize();
    expect(calls.at(-1)).toMatchObject({
      ownerId: "owner_12345678",
      sinceCursor: cursor,
    });
    expect(reopened.projection().status).toBe("ready");

    const expiringCursor = reopenedState.syncCursor("owner_12345678")!;
    backing.expireCursor(expiringCursor);
    const beforeRecovery = calls.length;
    await reopened.synchronize();
    expect(calls.slice(beforeRecovery)).toEqual([
      { ownerId: "owner_12345678", sinceCursor: expiringCursor },
      { ownerId: "owner_12345678" },
    ]);
    expect(reopenedState.syncCursor("owner_12345678")).not.toBe(expiringCursor);
    reopenedState.close();
  });

  it("applies every page from a bounded incremental scan before advancing its cursor", async () => {
    const ownerId = "owner_12345678";
    const local = new LocalWorkflows();
    const backing = new InMemoryWorkflowConfigurationProvider();
    const ledger = state();
    const listCalls: Array<{ sinceCursor?: string; pageCursor?: string }> = [];
    const provider = {
      list: async (input: Parameters<typeof backing.list>[0]) => {
        listCalls.push({
          ...(input.sinceCursor ? { sinceCursor: input.sinceCursor } : {}),
          ...(input.pageCursor ? { pageCursor: input.pageCursor } : {}),
        });
        return backing.list(input);
      },
      read: backing.read.bind(backing),
      write: backing.write.bind(backing),
      delete: backing.delete.bind(backing),
    };
    const sync = new WorkflowSyncCoordinator(
      local,
      ledger,
      provider,
      () => ownerId,
    );
    sync.bindCurrentAccount();
    await sync.synchronize();
    const baselineCursor = ledger.syncCursor(ownerId)!;
    for (let index = 0; index < 101; index += 1) {
      const workflowId = `workflow_page_${String(index).padStart(3, "0")}`;
      const value = workflow(1, `Remote change ${index}`);
      value.workflowId = workflowId;
      value.name = `Remote ${index}`;
      value.revision.workflowId = workflowId;
      await backing.write({
        ownerId,
        operationId: `sync_incremental_${String(index).padStart(3, "0")}`,
        expectedRemoteRevision: null,
        snapshot: toPortableWorkflowSnapshot(value),
        updatedAt: "2026-09-13T12:30:00.000Z",
      });
    }
    const beforeIncremental = listCalls.length;
    await sync.synchronize();
    const incrementalCalls = listCalls.slice(beforeIncremental);
    expect(incrementalCalls).toHaveLength(2);
    expect(incrementalCalls[0]).toEqual({ sinceCursor: baselineCursor });
    expect(incrementalCalls[1]?.pageCursor).toBeTruthy();
    expect(local.values.size).toBe(101);
    expect(ledger.syncCursor(ownerId)).not.toBe(baselineCursor);
  });

  it("propagates a local deletion as a server-timed tombstone", async () => {
    const provider = new InMemoryWorkflowConfigurationProvider(
      () => "2026-09-13T14:00:00.000Z",
    );
    const local = new LocalWorkflows([workflow()]);
    const sync = new WorkflowSyncCoordinator(
      local,
      state(),
      provider,
      () => "owner_12345678",
    );
    sync.bindCurrentAccount();
    await sync.synchronize();
    local.values.delete("workflow_12345678");
    await sync.synchronize();
    expect(
      await provider.read("owner_12345678", "workflow_12345678"),
    ).toMatchObject({
      state: "deleted",
      deletedAt: "2026-09-13T14:00:00.000Z",
    });
  });

  it("prevents a stale second device from resurrecting a cloud deletion", async () => {
    const provider = new InMemoryWorkflowConfigurationProvider();
    const owner = () => "owner_12345678";
    const firstLocal = new LocalWorkflows([workflow()]);
    const staleLocal = new LocalWorkflows();
    const first = new WorkflowSyncCoordinator(
      firstLocal,
      state(),
      provider,
      owner,
    );
    const stale = new WorkflowSyncCoordinator(
      staleLocal,
      state(),
      provider,
      owner,
    );
    first.bindCurrentAccount();
    stale.bindCurrentAccount();
    await first.synchronize();
    await stale.synchronize();
    staleLocal.values.set(
      "workflow_12345678",
      workflow(2, "Stale offline edit after the other device deletes"),
    );
    firstLocal.values.delete("workflow_12345678");
    await first.synchronize();
    await stale.synchronize();
    expect(stale.projection().items.workflow_12345678).toBe("deleted_remotely");
    expect(
      await provider.read("owner_12345678", "workflow_12345678"),
    ).toMatchObject({ state: "deleted" });
    expect(staleLocal.values.has("workflow_12345678")).toBe(true);
  });

  it("drops an in-flight old-owner page after an account switch", async () => {
    let owner = "owner_12345678";
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const backing = new InMemoryWorkflowConfigurationProvider();
    const provider = {
      list: async (input: Parameters<typeof backing.list>[0]) => {
        await wait;
        return backing.list(input);
      },
      read: backing.read.bind(backing),
      write: backing.write.bind(backing),
      delete: backing.delete.bind(backing),
    };
    const local = new LocalWorkflows([workflow()]);
    const sync = new WorkflowSyncCoordinator(
      local,
      state(),
      provider,
      () => owner,
    );
    sync.bindCurrentAccount();
    const stale = sync.synchronize();
    owner = "owner_87654321";
    sync.bindCurrentAccount(true);
    release();
    await stale;
    expect(await backing.read(owner, "workflow_12345678")).toBeNull();
    expect(sync.projection().boundOwnerId).toBe(owner);
  });

  it("drops all accumulated pages when identity changes during pagination", async () => {
    let owner = "owner_12345678";
    const backing = new InMemoryWorkflowConfigurationProvider();
    for (const id of ["workflow_pageaaaa", "workflow_pagebbbb"]) {
      const value = workflow();
      value.workflowId = id;
      value.revision.workflowId = id;
      await backing.write({
        ownerId: owner,
        operationId: `sync_${id.slice(9)}00000000`,
        expectedRemoteRevision: null,
        snapshot: toPortableWorkflowSnapshot(value),
        updatedAt: "2026-09-13T12:00:00.000Z",
      });
    }
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let enteredSecondPage!: () => void;
    const secondPageStarted = new Promise<void>((resolve) => {
      enteredSecondPage = resolve;
    });
    const provider = {
      async list(input: Parameters<typeof backing.list>[0]) {
        if (input.pageCursor) {
          enteredSecondPage();
          await wait;
        }
        return backing.list({ ...input, limit: 1 });
      },
      read: backing.read.bind(backing),
      write: backing.write.bind(backing),
      delete: backing.delete.bind(backing),
    };
    const local = new LocalWorkflows();
    const store = state();
    const sync = new WorkflowSyncCoordinator(
      local,
      store,
      provider,
      () => owner,
    );
    sync.bindCurrentAccount();
    const stale = sync.synchronize();
    await secondPageStarted;
    owner = "owner_87654321";
    sync.bindCurrentAccount(true);
    release();
    await stale;
    expect(local.values.size).toBe(0);
    expect(store.states(owner)).toEqual([]);
  });

  it("exports only Workflows bound to the active signed-in owner", async () => {
    let owner = "owner_12345678";
    const local = new LocalWorkflows([workflow()]);
    const sync = new WorkflowSyncCoordinator(
      local,
      state(),
      new InMemoryWorkflowConfigurationProvider(),
      () => owner,
    );
    sync.bindCurrentAccount();
    await sync.synchronize();
    owner = "owner_87654321";
    sync.bindCurrentAccount(true);
    expect(sync.exportableWorkflows()).toEqual([]);
    owner = "owner_12345678";
    expect(() => sync.exportableWorkflows()).toThrow(/linked Rove account/);
    sync.bindCurrentAccount(true);
    expect(
      sync.exportableWorkflows().map(({ workflowId }) => workflowId),
    ).toEqual(["workflow_12345678"]);
  });

  it("survives restart with the same uncertain write operation and reviewed snapshot", async () => {
    const home = mkdtempSync(join(tmpdir(), "rove-sync-restart-"));
    homes.push(home);
    const path = join(home, "state.sqlite3");
    const local = new LocalWorkflows([workflow()]);
    const backing = new InMemoryWorkflowConfigurationProvider();
    const operationIds: string[] = [];
    let loseResponse = true;
    const provider = {
      list: backing.list.bind(backing),
      read: backing.read.bind(backing),
      delete: backing.delete.bind(backing),
      async write(input: Parameters<typeof backing.write>[0]) {
        operationIds.push(input.operationId);
        const result = await backing.write(input);
        if (loseResponse) {
          loseResponse = false;
          throw new Error("response lost after commit");
        }
        return result;
      },
    };
    const firstState = new WorkflowSyncStateStore(path);
    const first = new WorkflowSyncCoordinator(
      local,
      firstState,
      provider,
      () => "owner_12345678",
    );
    first.bindCurrentAccount();
    expect((await first.synchronize()).status).toBe("transport_uncertain");
    const reviewedDigest = firstState.pending(
      "owner_12345678",
      "workflow_12345678",
    )?.snapshot?.digest;
    firstState.close();
    local.values.set(
      "workflow_12345678",
      workflow(2, "Edited after the uncertain response"),
    );

    const reopenedState = new WorkflowSyncStateStore(path);
    const reopened = new WorkflowSyncCoordinator(
      local,
      reopenedState,
      provider,
      () => "owner_12345678",
    );
    expect((await reopened.synchronize()).status).toBe("ready");
    expect(operationIds).toHaveLength(2);
    expect(new Set(operationIds).size).toBe(1);
    const replayed = await backing.read("owner_12345678", "workflow_12345678");
    expect(replayed?.state === "active" ? replayed.snapshot.digest : null).toBe(
      reviewedDigest,
    );
    await reopened.synchronize();
    expect(operationIds).toHaveLength(3);
    expect(operationIds[2]).not.toBe(operationIds[1]);
    expect(
      await backing.read("owner_12345678", "workflow_12345678"),
    ).toMatchObject({
      state: "active",
      snapshot: {
        configuration: { purpose: "Edited after the uncertain response" },
      },
    });
    reopenedState.close();
  });

  it("journals an offline deletion before network access and replays it after restart", async () => {
    const home = mkdtempSync(join(tmpdir(), "rove-delete-restart-"));
    homes.push(home);
    const path = join(home, "state.sqlite3");
    const local = new LocalWorkflows([workflow()]);
    const backing = new InMemoryWorkflowConfigurationProvider(
      () => "2026-09-13T15:00:00.000Z",
    );
    const firstState = new WorkflowSyncStateStore(path);
    const first = new WorkflowSyncCoordinator(
      local,
      firstState,
      backing,
      () => "owner_12345678",
    );
    first.bindCurrentAccount();
    await first.synchronize();
    local.values.delete("workflow_12345678");
    expect(first.noticeLocalChanges()).toBe(true);
    const pending = firstState.pending("owner_12345678", "workflow_12345678");
    expect(pending).toMatchObject({ kind: "delete", status: "pending" });
    firstState.close();

    const operationIds: string[] = [];
    let loseDeleteResponse = true;
    const provider = {
      list: backing.list.bind(backing),
      read: backing.read.bind(backing),
      write: backing.write.bind(backing),
      async delete(input: Parameters<typeof backing.delete>[0]) {
        operationIds.push(input.operationId);
        const result = await backing.delete(input);
        if (loseDeleteResponse) {
          loseDeleteResponse = false;
          throw new Error("delete response lost after commit");
        }
        return result;
      },
    };
    const reopenedState = new WorkflowSyncStateStore(path);
    const reopened = new WorkflowSyncCoordinator(
      local,
      reopenedState,
      provider,
      () => "owner_12345678",
    );
    expect((await reopened.synchronize()).status).toBe("transport_uncertain");
    reopenedState.close();
    const finalState = new WorkflowSyncStateStore(path);
    const final = new WorkflowSyncCoordinator(
      local,
      finalState,
      provider,
      () => "owner_12345678",
    );
    expect((await final.synchronize()).status).toBe("ready");
    expect(operationIds).toEqual([pending!.operationId, pending!.operationId]);
    expect(
      await backing.read("owner_12345678", "workflow_12345678"),
    ).toMatchObject({ state: "deleted" });
    expect(finalState.binding("workflow_12345678")?.syncEnabled).toBe(false);
    await final.synchronize();
    expect(operationIds).toHaveLength(2);
    finalState.close();
  });

  it("durably removes only the cloud copy while preserving the local Workflow", async () => {
    const home = mkdtempSync(join(tmpdir(), "rove-cloud-remove-restart-"));
    homes.push(home);
    const path = join(home, "state.sqlite3");
    const local = new LocalWorkflows([workflow()]);
    const backing = new InMemoryWorkflowConfigurationProvider();
    const initialState = new WorkflowSyncStateStore(path);
    const initial = new WorkflowSyncCoordinator(
      local,
      initialState,
      backing,
      () => "owner_12345678",
    );
    initial.bindCurrentAccount();
    await initial.synchronize();
    initial.removeFromCloud("workflow_12345678");
    const operationId = initialState.pending(
      "owner_12345678",
      "workflow_12345678",
    )?.operationId;
    initialState.close();

    const operationIds: string[] = [];
    let loseResponse = true;
    const provider = {
      list: backing.list.bind(backing),
      read: backing.read.bind(backing),
      write: backing.write.bind(backing),
      async delete(input: Parameters<typeof backing.delete>[0]) {
        operationIds.push(input.operationId);
        const result = await backing.delete(input);
        if (loseResponse) {
          loseResponse = false;
          throw new Error("delete response lost after commit");
        }
        return result;
      },
    };
    const uncertainState = new WorkflowSyncStateStore(path);
    const uncertain = new WorkflowSyncCoordinator(
      local,
      uncertainState,
      provider,
      () => "owner_12345678",
    );
    expect((await uncertain.synchronize()).status).toBe("transport_uncertain");
    uncertainState.close();

    const finalState = new WorkflowSyncStateStore(path);
    const final = new WorkflowSyncCoordinator(
      local,
      finalState,
      provider,
      () => "owner_12345678",
    );
    expect((await final.synchronize()).status).toBe("ready");
    expect(operationIds).toEqual([operationId, operationId]);
    expect(local.values.has("workflow_12345678")).toBe(true);
    expect(finalState.binding("workflow_12345678")).toMatchObject({
      syncEnabled: false,
      origin: "detached",
    });
    expect(final.projection().items.workflow_12345678).toBe("local_only");
    finalState.close();
  });

  it("keeps delete replay durable when the process stops before atomic local completion", async () => {
    const local = new LocalWorkflows([workflow()]);
    const backing = new InMemoryWorkflowConfigurationProvider();
    const ledger = state();
    const operationIds: string[] = [];
    const provider = {
      list: backing.list.bind(backing),
      read: backing.read.bind(backing),
      write: backing.write.bind(backing),
      async delete(input: Parameters<typeof backing.delete>[0]) {
        operationIds.push(input.operationId);
        return backing.delete(input);
      },
    };
    const sync = new WorkflowSyncCoordinator(
      local,
      ledger,
      provider,
      () => "owner_12345678",
    );
    sync.bindCurrentAccount();
    await sync.synchronize();
    sync.removeFromCloud("workflow_12345678");
    const atomicComplete = ledger.completeDelete.bind(ledger);
    let injectFailure = true;
    ledger.completeDelete = (input) => {
      if (injectFailure) {
        injectFailure = false;
        throw new Error("injected stop before local delete completion");
      }
      atomicComplete(input);
    };

    expect((await sync.synchronize()).status).toBe("transport_uncertain");
    expect(ledger.binding("workflow_12345678")?.syncEnabled).toBe(true);
    expect(ledger.pending("owner_12345678", "workflow_12345678")).toMatchObject(
      { status: "uncertain" },
    );
    expect(local.values.has("workflow_12345678")).toBe(true);

    expect((await sync.synchronize()).status).toBe("ready");
    expect(new Set(operationIds).size).toBe(1);
    expect(operationIds).toHaveLength(2);
    expect(ledger.binding("workflow_12345678")).toMatchObject({
      syncEnabled: false,
      origin: "detached",
    });
    expect(ledger.pending("owner_12345678", "workflow_12345678")).toBeNull();
  });

  it("models authoritative post-purge absence without partially applying invalid choices", async () => {
    const local = new LocalWorkflows([workflow()]);
    const backing = new InMemoryWorkflowConfigurationProvider();
    let absent = false;
    const provider = {
      async list(input: Parameters<typeof backing.list>[0]) {
        if (!absent) return backing.list(input);
        return {
          items: [],
          nextPageCursor: null,
          syncCursor: "workflow_cursor_absent",
          authoritative: true,
        };
      },
      read: backing.read.bind(backing),
      write: backing.write.bind(backing),
      delete: backing.delete.bind(backing),
    };
    const sync = new WorkflowSyncCoordinator(
      local,
      state(),
      provider,
      () => "owner_12345678",
    );
    sync.bindCurrentAccount();
    await sync.synchronize();
    absent = true;
    await sync.synchronize();
    expect(sync.projection().items.workflow_12345678).toBe("absent_remotely");
    const count = local.values.size;
    await expect(
      sync.resolve("workflow_12345678", "keep_remote"),
    ).rejects.toThrow(/only remain on this device/);
    await expect(
      sync.resolve("workflow_12345678", "create_copy"),
    ).rejects.toThrow(/only remain on this device/);
    expect(local.values.size).toBe(count);
    await sync.resolve("workflow_12345678", "keep_device_only");
    expect(sync.projection().items.workflow_12345678).toBe("local_only");
  });

  it("fences a stale write response after switching owners", async () => {
    let owner = "owner_12345678";
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let enteredWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      enteredWrite = resolve;
    });
    const backing = new InMemoryWorkflowConfigurationProvider();
    const provider = {
      list: backing.list.bind(backing),
      read: backing.read.bind(backing),
      delete: backing.delete.bind(backing),
      async write(input: Parameters<typeof backing.write>[0]) {
        enteredWrite();
        await wait;
        return backing.write(input);
      },
    };
    const local = new LocalWorkflows([workflow()]);
    const store = state();
    const sync = new WorkflowSyncCoordinator(
      local,
      store,
      provider,
      () => owner,
    );
    sync.bindCurrentAccount();
    const stale = sync.synchronize();
    await writeStarted;
    owner = "owner_87654321";
    sync.bindCurrentAccount(true);
    release();
    await stale;
    expect(store.states(owner)).toEqual([]);
    expect(sync.projection().boundOwnerId).toBe(owner);
  });

  it("fences a stale delete response before local acknowledgement", async () => {
    let owner = "owner_12345678";
    const backing = new InMemoryWorkflowConfigurationProvider();
    const local = new LocalWorkflows([workflow()]);
    const store = state();
    const initial = new WorkflowSyncCoordinator(
      local,
      store,
      backing,
      () => owner,
    );
    initial.bindCurrentAccount();
    await initial.synchronize();
    local.values.delete("workflow_12345678");

    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let enteredDelete!: () => void;
    const deleteStarted = new Promise<void>((resolve) => {
      enteredDelete = resolve;
    });
    const provider = {
      list: backing.list.bind(backing),
      read: backing.read.bind(backing),
      write: backing.write.bind(backing),
      async delete(input: Parameters<typeof backing.delete>[0]) {
        enteredDelete();
        await wait;
        return backing.delete(input);
      },
    };
    const sync = new WorkflowSyncCoordinator(
      local,
      store,
      provider,
      () => owner,
    );
    const stale = sync.synchronize();
    await deleteStarted;
    owner = "owner_87654321";
    sync.bindCurrentAccount(true);
    release();
    await stale;
    expect(store.states(owner)).toEqual([]);
    expect(store.binding("workflow_12345678")).toMatchObject({
      ownerId: "owner_12345678",
      syncEnabled: true,
    });
  });

  it("fences a stale conflict-read response after switching owners", async () => {
    let owner = "owner_12345678";
    const backing = new InMemoryWorkflowConfigurationProvider();
    const local = new LocalWorkflows([workflow()]);
    const store = state();
    const initial = new WorkflowSyncCoordinator(
      local,
      store,
      backing,
      () => owner,
    );
    initial.bindCurrentAccount();
    await initial.synchronize();
    local.values.set("workflow_12345678", workflow(2, "Local conflict edit"));

    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let enteredRead!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      enteredRead = resolve;
    });
    const provider = {
      list: backing.list.bind(backing),
      async read(ownerId: string, workflowId: string) {
        enteredRead();
        await wait;
        return backing.read(ownerId, workflowId);
      },
      async write() {
        throw new WorkflowProviderError("conflict", "revision conflict");
      },
      delete: backing.delete.bind(backing),
    };
    const sync = new WorkflowSyncCoordinator(
      local,
      store,
      provider,
      () => owner,
    );
    const stale = sync.synchronize();
    await readStarted;
    owner = "owner_87654321";
    sync.bindCurrentAccount(true);
    release();
    await stale;
    expect(store.states(owner)).toEqual([]);
    expect(
      local.values.get("workflow_12345678")?.revision.configuration.purpose,
    ).toBe("Local conflict edit");
  });

  it("reconciles rather than accepting a response from an expired session epoch", async () => {
    let epoch = 1;
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    let enteredWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      enteredWrite = resolve;
    });
    const backing = new InMemoryWorkflowConfigurationProvider();
    const operationIds: string[] = [];
    let pause = true;
    const provider = {
      list: backing.list.bind(backing),
      read: backing.read.bind(backing),
      delete: backing.delete.bind(backing),
      async write(input: Parameters<typeof backing.write>[0]) {
        operationIds.push(input.operationId);
        if (pause) {
          enteredWrite();
          await wait;
        }
        return backing.write(input);
      },
    };
    const local = new LocalWorkflows([workflow()]);
    const store = state();
    const sync = new WorkflowSyncCoordinator(
      local,
      store,
      provider,
      () => "owner_12345678",
      () => epoch,
    );
    sync.bindCurrentAccount();
    const stale = sync.synchronize();
    await writeStarted;
    epoch += 1;
    sync.invalidate();
    release();
    await stale;
    const pending = store.pending("owner_12345678", "workflow_12345678");
    expect(pending).not.toBeNull();

    pause = false;
    await sync.synchronize();
    expect(operationIds).toEqual([pending!.operationId, pending!.operationId]);
    expect(sync.projection().items.workflow_12345678).toBe("synchronized");
  });

  it("never replays a durable old-owner operation after switching accounts", async () => {
    let owner = "owner_12345678";
    const local = new LocalWorkflows([workflow()]);
    const backing = new InMemoryWorkflowConfigurationProvider();
    let offline = true;
    const provider = {
      list: backing.list.bind(backing),
      read: backing.read.bind(backing),
      delete: backing.delete.bind(backing),
      async write(input: Parameters<typeof backing.write>[0]) {
        if (offline) throw new Error("offline before commit");
        return backing.write(input);
      },
    };
    const store = state();
    const sync = new WorkflowSyncCoordinator(
      local,
      store,
      provider,
      () => owner,
    );
    sync.bindCurrentAccount();
    expect((await sync.synchronize()).status).toBe("transport_uncertain");
    const oldOperation = store.pending(owner, "workflow_12345678");
    expect(oldOperation).toMatchObject({ ownerId: owner, status: "uncertain" });

    owner = "owner_87654321";
    offline = false;
    sync.bindCurrentAccount(true);
    await sync.synchronize();
    expect(await backing.read(owner, "workflow_12345678")).toBeNull();
    expect(
      store.pending("owner_12345678", "workflow_12345678")?.operationId,
    ).toBe(oldOperation?.operationId);
    expect(store.pending(owner, "workflow_12345678")).toBeNull();
  });

  it("classifies definitive schema rejection separately and does not blindly retry", async () => {
    const local = new LocalWorkflows([workflow()]);
    const backing = new InMemoryWorkflowConfigurationProvider();
    let writes = 0;
    const provider = {
      list: backing.list.bind(backing),
      read: backing.read.bind(backing),
      delete: backing.delete.bind(backing),
      async write() {
        writes += 1;
        throw new WorkflowProviderError(
          "schema_rejected",
          "server rejected schema",
        );
      },
    };
    const sync = new WorkflowSyncCoordinator(
      local,
      state(),
      provider,
      () => "owner_12345678",
    );
    sync.bindCurrentAccount();
    expect((await sync.synchronize()).status).toBe("error");
    expect((await sync.synchronize()).status).toBe("error");
    expect(writes).toBe(1);
  });

  it("persists a malformed fulfilled mutation as definitive and does not blindly retry it", async () => {
    const local = new LocalWorkflows([workflow()]);
    const backing = new InMemoryWorkflowConfigurationProvider();
    let writes = 0;
    const supabase = new SupabaseWorkflowConfigurationProvider({
      async rpc() {
        writes += 1;
        return null;
      },
    } as unknown as SupabaseClient);
    const provider = {
      list: backing.list.bind(backing),
      read: backing.read.bind(backing),
      delete: backing.delete.bind(backing),
      write: supabase.write.bind(supabase),
    };
    const ownerId = "owner_00000000000040008000000000000001";
    const ledger = state();
    const sync = new WorkflowSyncCoordinator(
      local,
      ledger,
      provider,
      () => ownerId,
    );
    sync.bindCurrentAccount();
    expect((await sync.synchronize()).status).toBe("error");
    expect(sync.projection()).toMatchObject({
      status: "error",
      lastFailureCode: "definitive",
      items: { workflow_12345678: "error" },
    });
    expect(ledger.pending(ownerId, "workflow_12345678")).toMatchObject({
      status: "failed",
      failureCode: "definitive",
    });
    expect((await sync.synchronize()).status).toBe("error");
    expect(writes).toBe(1);
  });

  it("does not report malformed provider scan data as an outage", async () => {
    const local = new LocalWorkflows();
    const backing = new InMemoryWorkflowConfigurationProvider();
    const provider = {
      read: backing.read.bind(backing),
      write: backing.write.bind(backing),
      delete: backing.delete.bind(backing),
      async list() {
        throw new WorkflowProviderError(
          "definitive",
          "provider returned malformed scan data",
        );
      },
    };
    const sync = new WorkflowSyncCoordinator(
      local,
      state(),
      provider,
      () => "owner_12345678",
    );
    sync.bindCurrentAccount();
    expect((await sync.synchronize()).status).toBe("error");
    expect(sync.projection()).toMatchObject({
      status: "error",
      lastFailureCode: "definitive",
    });
  });
});
