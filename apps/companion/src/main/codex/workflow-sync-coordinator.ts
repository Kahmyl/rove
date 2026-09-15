import { randomUUID } from "node:crypto";
import type { WorkflowEnvironment } from "./workflows.js";
import {
  planWorkflowSynchronization,
  portableDigest,
  portableWorkflowDigest,
  toPortableWorkflowSnapshot,
  WorkflowProviderError,
  WorkflowSyncCursorExpiredError,
  type PortableWorkflowSnapshot,
  type RemoteWorkflowRecord,
  type WorkflowConfigurationProvider,
  type WorkflowProviderFailureCode,
} from "./workflow-portability.js";
import type {
  PendingWorkflowSyncOperation,
  WorkflowSyncFence,
  WorkflowSyncStateStore,
  WorkflowSyncItemStatus,
} from "./workflow-sync-state.js";

export interface WorkflowSyncLocalPort {
  listWorkflows(options?: {
    includeArchived?: boolean;
  }): readonly WorkflowEnvironment[];
  applyPortableWorkflowSnapshot(
    snapshot: PortableWorkflowSnapshot,
  ): WorkflowEnvironment;
  replacePortableWorkflowSnapshot(
    snapshot: PortableWorkflowSnapshot,
  ): WorkflowEnvironment;
  resolvePortableWorkflowConflict(input: {
    operationId: string;
    workflowId: string;
    remote: PortableWorkflowSnapshot;
  }): { workflow: WorkflowEnvironment; copy: WorkflowEnvironment };
}

export interface WorkflowSyncBindingProjection {
  eligibility: "device_only" | "owner_bound" | "detached" | "other_owner";
  status: WorkflowSyncItemStatus | null;
}

export interface WorkflowSyncProjection {
  status:
    | "signed_out"
    | "ready"
    | "syncing"
    | "account_mismatch"
    | "auth_required"
    | "transport_uncertain"
    | "unavailable"
    | "error";
  boundOwnerId: string | null;
  signedInOwnerId: string | null;
  lastError: string | null;
  lastFailureCode: WorkflowProviderFailureCode | null;
  items: Readonly<Record<string, WorkflowSyncItemStatus>>;
  bindings: Readonly<Record<string, WorkflowSyncBindingProjection>>;
  exportableWorkflowCount: number;
}

export class WorkflowSyncCoordinator {
  private syncing = false;
  private active: Promise<void> | null = null;
  private lastError: string | null = null;
  private lastFailureCode: WorkflowProviderFailureCode | null = null;
  constructor(
    private readonly local: WorkflowSyncLocalPort,
    private readonly state: WorkflowSyncStateStore,
    private readonly provider: WorkflowConfigurationProvider,
    private readonly owner: () => string | null,
    private readonly authEpoch: () => number = () => 0,
  ) {}

  invalidate(): void {
    this.state.invalidate();
  }

  private fence(ownerId: string): WorkflowSyncFence {
    return {
      ownerId,
      generation: this.state.generation(),
      authEpoch: this.authEpoch(),
    };
  }

  private assertFence(fence: WorkflowSyncFence): void {
    this.state.assertFence(fence);
    if (this.owner() !== fence.ownerId || this.authEpoch() !== fence.authEpoch)
      throw new Error(
        "Rove account identity changed during Workflow synchronization.",
      );
  }

  projection(): WorkflowSyncProjection {
    const signedInOwnerId = this.owner();
    const boundOwnerId = this.state.boundOwnerId();
    const boundStates = boundOwnerId ? this.state.states(boundOwnerId) : [];
    const durableFailure = boundStates.find(
      (item) => item.failureCode !== null,
    );
    const projectedFailureCode =
      this.lastFailureCode ?? durableFailure?.failureCode ?? null;
    const projectedError = this.lastError ?? durableFailure?.error ?? null;
    const status =
      signedInOwnerId === null
        ? "signed_out"
        : boundOwnerId !== null && boundOwnerId !== signedInOwnerId
          ? "account_mismatch"
          : this.syncing
            ? "syncing"
            : boundStates.some((item) => item.status === "auth_required") ||
                projectedFailureCode === "auth_required"
              ? "auth_required"
              : boundStates.some(
                    (item) => item.status === "transport_uncertain",
                  ) || projectedFailureCode === "transport_uncertain"
                ? "transport_uncertain"
                : boundStates.some((item) => item.status === "error")
                  ? "error"
                  : projectedFailureCode === "schema_rejected" ||
                      projectedFailureCode === "definitive"
                    ? "error"
                    : projectedError
                      ? "unavailable"
                      : "ready";
    const items = boundOwnerId
      ? Object.fromEntries(
          boundStates.map((item) => [
            this.state.bindingByRemote(boundOwnerId, item.workflowId)
              ?.workflowId ?? item.workflowId,
            item.status,
          ]),
        )
      : {};
    const localIds = new Set(
      this.local
        .listWorkflows({ includeArchived: true })
        .map(({ workflowId }) => workflowId),
    );
    const bindings = Object.fromEntries(
      [...localIds].map((workflowId) => {
        const binding = this.state.binding(workflowId);
        const itemStatus =
          binding?.ownerId && binding.ownerId === boundOwnerId
            ? (items[workflowId] ?? null)
            : null;
        const eligibility: WorkflowSyncBindingProjection["eligibility"] =
          !binding || binding.origin === "device"
            ? "device_only"
            : binding.origin === "detached" || !binding.syncEnabled
              ? "detached"
              : binding.ownerId === signedInOwnerId &&
                  binding.ownerId === boundOwnerId
                ? "owner_bound"
                : "other_owner";
        return [workflowId, { eligibility, status: itemStatus }];
      }),
    );
    const exportableWorkflowCount = Object.values(bindings).filter(
      (binding) => binding.eligibility === "owner_bound",
    ).length;
    return {
      status,
      boundOwnerId,
      signedInOwnerId,
      lastError: projectedError,
      lastFailureCode: projectedFailureCode,
      items,
      bindings,
      exportableWorkflowCount,
    };
  }

  exportableWorkflows(): readonly PortableWorkflowSnapshot[] {
    const ownerId = this.owner();
    if (!ownerId || this.state.boundOwnerId() !== ownerId)
      throw new Error(
        "Sign in to the linked Rove account before exporting synchronized Workflows.",
      );
    const bindings = new Map(
      this.state
        .bindings(ownerId)
        .map((binding) => [binding.workflowId, binding]),
    );
    return this.local
      .listWorkflows({ includeArchived: true })
      .filter((workflow) => bindings.has(workflow.workflowId))
      .map((workflow) =>
        this.snapshotForRemote(
          workflow,
          bindings.get(workflow.workflowId)!.remoteWorkflowId,
        ),
      );
  }

  bindCurrentAccount(confirmSwitch = false): void {
    const ownerId = this.owner();
    if (!ownerId)
      throw new Error(
        "Sign in to a Rove account before enabling Workflow sync.",
      );
    const firstBinding = this.state.boundOwnerId() === null;
    for (const workflow of this.local.listWorkflows({ includeArchived: true }))
      this.state.inventoryDeviceWorkflow(workflow.workflowId);
    this.state.bind(ownerId, confirmSwitch);
    if (firstBinding) this.state.claimDeviceWorkflows(ownerId);
    this.lastError = null;
    this.lastFailureCode = null;
  }

  unbindAfterCloudDeletion(): void {
    const ownerId = this.state.boundOwnerId();
    if (ownerId) this.state.detachDeletedOwner(ownerId);
    this.lastError = null;
    this.lastFailureCode = null;
  }

  noticeLocalChanges(): boolean {
    const ownerId = this.state.boundOwnerId();
    const activeOwner = ownerId !== null && ownerId === this.owner();
    let changed = false;
    for (const workflow of this.local.listWorkflows({
      includeArchived: true,
    })) {
      const existingBinding = this.state.binding(workflow.workflowId);
      if (!existingBinding && activeOwner)
        this.state.bindNewWorkflow(workflow.workflowId, ownerId);
      else if (!existingBinding)
        this.state.inventoryDeviceWorkflow(workflow.workflowId);
      if (!activeOwner) continue;
      const binding = this.state.binding(workflow.workflowId);
      if (binding?.ownerId !== ownerId || !binding.syncEnabled) continue;
      const remoteWorkflowId = binding.remoteWorkflowId;
      const snapshot = this.snapshotForRemote(workflow, remoteWorkflowId);
      const prior = this.saved(ownerId, remoteWorkflowId);
      const pending = this.state.pending(ownerId, remoteWorkflowId);
      if (pending?.status === "failed") {
        if (pending.snapshot?.digest === snapshot.digest) continue;
        this.state.completeOperation(this.fence(ownerId), pending.operationId);
      }
      if (
        prior?.status === "conflicted" ||
        prior?.status === "deleted_remotely" ||
        prior?.status === "local_only"
      )
        continue;
      if (!prior || prior.cursor?.acknowledgedLocalDigest !== snapshot.digest) {
        this.save(
          this.fence(ownerId),
          remoteWorkflowId,
          "pending_upload",
          prior?.cursor ?? null,
          prior?.remote ?? null,
        );
        changed = true;
      }
    }
    if (!activeOwner) return false;
    const localIds = new Set(
      this.local
        .listWorkflows({ includeArchived: true })
        .map(({ workflowId }) => workflowId),
    );
    const fence = this.fence(ownerId);
    for (const { workflowId, remoteWorkflowId } of this.state.bindings(
      ownerId,
    )) {
      if (localIds.has(workflowId)) continue;
      const prior = this.saved(ownerId, remoteWorkflowId);
      if (!prior?.cursor || prior.status === "local_only") continue;
      const pending = this.state.pending(ownerId, remoteWorkflowId);
      if (pending?.status === "failed") continue;
      if (!pending) {
        this.state.stage(
          fence,
          this.operationFor(
            fence,
            "delete",
            remoteWorkflowId,
            prior.cursor.acknowledgedRemoteRevision,
            null,
          ),
        );
      }
      this.save(
        fence,
        remoteWorkflowId,
        "pending_delete",
        prior.cursor,
        prior.remote,
      );
      changed = true;
    }
    return changed;
  }

  private snapshotForRemote(
    workflow: WorkflowEnvironment,
    remoteWorkflowId: string,
  ): PortableWorkflowSnapshot {
    const local = toPortableWorkflowSnapshot(workflow);
    if (local.workflowId === remoteWorkflowId) return local;
    const base = { ...local, workflowId: remoteWorkflowId };
    return {
      ...base,
      digest: portableWorkflowDigest(base),
    };
  }

  private snapshotForLocal(
    snapshot: PortableWorkflowSnapshot,
    localWorkflowId: string,
  ): PortableWorkflowSnapshot {
    if (snapshot.workflowId === localWorkflowId) return snapshot;
    const base = { ...snapshot, workflowId: localWorkflowId };
    return {
      ...base,
      digest: portableWorkflowDigest(base),
    };
  }

  private saved(ownerId: string, workflowId: string) {
    return this.state.state(ownerId, workflowId);
  }
  private save(
    fence: WorkflowSyncFence,
    workflowId: string,
    status: WorkflowSyncItemStatus,
    cursor: {
      acknowledgedRemoteRevision: number;
      acknowledgedLocalDigest: string;
    } | null,
    remote: RemoteWorkflowRecord | null,
    error: string | null = null,
    failureCode: WorkflowProviderFailureCode | null = null,
  ): void {
    this.assertFence(fence);
    this.state.save(fence, {
      workflowId,
      status,
      cursor,
      remote,
      error,
      failureCode,
    });
  }

  async synchronize(): Promise<WorkflowSyncProjection> {
    if (this.active) await this.active;
    const ownerId = this.owner();
    if (!ownerId) throw new Error("Sign in to synchronize Workflows.");
    if (this.state.boundOwnerId() === null)
      throw new Error("Enable Workflow sync for this Rove account first.");
    if (this.state.boundOwnerId() !== ownerId)
      throw new Error(
        "This device is linked to a different Rove account. Confirm the account switch before synchronizing.",
      );
    this.noticeLocalChanges();
    const fence = this.fence(ownerId);
    this.syncing = true;
    this.lastError = null;
    this.lastFailureCode = null;
    const run = this.run(fence);
    this.active = run;
    try {
      await run;
    } finally {
      if (this.active === run) this.active = null;
      this.syncing = false;
    }
    return this.projection();
  }

  private async remoteScan(
    fence: WorkflowSyncFence,
    sinceCursor: string | null,
  ): Promise<{
    remote: Map<string, RemoteWorkflowRecord>;
    authoritative: boolean;
    syncCursor: string;
  }> {
    const remote = new Map<string, RemoteWorkflowRecord>();
    let pageCursor: string | undefined;
    let authoritative: boolean | null = null;
    let syncCursor: string | null = null;
    do {
      const page = await this.provider.list({
        ownerId: fence.ownerId,
        limit: 100,
        ...(pageCursor ? { pageCursor } : sinceCursor ? { sinceCursor } : {}),
      });
      this.assertFence(fence);
      if (authoritative === null) authoritative = page.authoritative;
      else if (authoritative !== page.authoritative)
        throw new WorkflowProviderError(
          "definitive",
          "Workflow synchronization pages disagree about snapshot authority.",
        );
      page.items.forEach((item) => remote.set(item.workflowId, item));
      pageCursor = page.nextPageCursor ?? undefined;
      if (!pageCursor) syncCursor = page.syncCursor;
    } while (pageCursor);
    if (syncCursor === null)
      throw new WorkflowProviderError(
        "definitive",
        "Workflow synchronization completed without a durable cursor.",
      );
    return {
      remote,
      authoritative: authoritative ?? sinceCursor === null,
      syncCursor,
    };
  }

  private async scanWithCursorRecovery(fence: WorkflowSyncFence) {
    const sinceCursor = this.state.syncCursor(fence.ownerId);
    try {
      return await this.remoteScan(fence, sinceCursor);
    } catch (error) {
      this.assertFence(fence);
      if (!(error instanceof WorkflowSyncCursorExpiredError) || !sinceCursor)
        throw error;
      this.state.clearSyncCursor(fence);
      return this.remoteScan(fence, null);
    }
  }

  private async run(fence: WorkflowSyncFence): Promise<void> {
    try {
      const scan = await this.scanWithCursorRecovery(fence);
      const { remote, authoritative } = scan;

      const allLocals = new Map(
        this.local
          .listWorkflows({ includeArchived: true })
          .map((workflow) => [workflow.workflowId, workflow]),
      );
      const ownerIds = this.state
        .bindings(fence.ownerId)
        .map(({ remoteWorkflowId }) => remoteWorkflowId);
      const ids = new Set([...ownerIds, ...remote.keys()]);
      for (const remoteWorkflowId of [...ids].sort()) {
        this.assertFence(fence);
        let binding = this.state.bindingByRemote(
          fence.ownerId,
          remoteWorkflowId,
        );
        let local = binding ? allLocals.get(binding.workflowId) : undefined;
        const saved = this.saved(fence.ownerId, remoteWorkflowId);
        const remoteRecord = remote.has(remoteWorkflowId)
          ? remote.get(remoteWorkflowId)!
          : authoritative
            ? null
            : (saved?.remote ?? null);
        const pending = this.state.pending(fence.ownerId, remoteWorkflowId);
        if (binding && !binding.syncEnabled) continue;
        if (saved?.status === "local_only") continue;
        if (pending?.status === "failed") continue;

        if (pending?.kind === "delete") {
          await this.performDelete(
            fence,
            remoteWorkflowId,
            pending.expectedRemoteRevision!,
          );
          continue;
        }

        if (!local) {
          if (binding?.ownerId === fence.ownerId && saved?.cursor) {
            if (remoteRecord?.state === "active")
              await this.performDelete(
                fence,
                remoteWorkflowId,
                remoteRecord.remoteRevision,
              );
            else if (remoteRecord?.state === "deleted")
              this.save(
                fence,
                remoteWorkflowId,
                "synchronized",
                saved.cursor,
                remoteRecord,
              );
            else
              this.save(
                fence,
                remoteWorkflowId,
                "local_only",
                saved.cursor,
                null,
              );
          } else if (remoteRecord?.state === "active") {
            let localWorkflowId = remoteWorkflowId;
            const existingBinding = this.state.binding(localWorkflowId);
            if (existingBinding && existingBinding.ownerId !== fence.ownerId)
              localWorkflowId = `workflow_${randomUUID().replaceAll("-", "")}`;
            this.assertFence(fence);
            this.state.bindDownloaded(
              localWorkflowId,
              fence.ownerId,
              remoteWorkflowId,
            );
            binding = this.state.binding(localWorkflowId);
            this.assertFence(fence);
            const applied = this.local.applyPortableWorkflowSnapshot(
              this.snapshotForLocal(remoteRecord.snapshot, localWorkflowId),
            );
            local = applied;
            this.assertFence(fence);
            const snapshot = this.snapshotForRemote(applied, remoteWorkflowId);
            this.save(
              fence,
              remoteWorkflowId,
              "synchronized",
              {
                acknowledgedRemoteRevision: remoteRecord.remoteRevision,
                acknowledgedLocalDigest: snapshot.digest,
              },
              remoteRecord,
            );
          }
          continue;
        }

        if (!binding || binding.ownerId !== fence.ownerId) continue;
        if (pending?.kind === "write" && pending.snapshot) {
          await this.performWrite(
            fence,
            pending.snapshot,
            pending.expectedRemoteRevision,
            remoteRecord,
          );
          continue;
        }
        const snapshot = this.snapshotForRemote(local, remoteWorkflowId);
        const plan = planWorkflowSynchronization({
          ownerId: fence.ownerId,
          local: snapshot,
          cursor: saved?.cursor ?? null,
          remote: remoteRecord,
        });
        if (plan.state === "synchronized")
          this.save(
            fence,
            remoteWorkflowId,
            "synchronized",
            {
              acknowledgedRemoteRevision: plan.remoteRevision,
              acknowledgedLocalDigest: snapshot.digest,
            },
            remoteRecord,
          );
        else if (plan.state === "pending_upload")
          await this.performWrite(
            fence,
            snapshot,
            plan.expectedRemoteRevision,
            remoteRecord,
          );
        else if (plan.state === "pending_download") {
          this.assertFence(fence);
          const applied = this.local.applyPortableWorkflowSnapshot(
            this.snapshotForLocal(plan.remote.snapshot, binding.workflowId),
          );
          this.assertFence(fence);
          const appliedSnapshot = this.snapshotForRemote(
            applied,
            remoteWorkflowId,
          );
          this.save(
            fence,
            remoteWorkflowId,
            "synchronized",
            {
              acknowledgedRemoteRevision: plan.remote.remoteRevision,
              acknowledgedLocalDigest: appliedSnapshot.digest,
            },
            plan.remote,
          );
        } else if (plan.state === "deleted_remotely")
          this.save(
            fence,
            remoteWorkflowId,
            "deleted_remotely",
            saved?.cursor ?? null,
            plan.tombstone,
          );
        else if (plan.state === "absent_remotely")
          this.save(
            fence,
            remoteWorkflowId,
            "absent_remotely",
            saved?.cursor ?? null,
            null,
          );
        else
          this.save(
            fence,
            remoteWorkflowId,
            "conflicted",
            saved?.cursor ?? null,
            plan.remote,
          );
      }
      this.assertFence(fence);
      this.state.saveSyncCursor(fence, scan.syncCursor);
    } catch (error) {
      try {
        this.assertFence(fence);
      } catch {
        return;
      }
      this.lastError = error instanceof Error ? error.message : String(error);
      this.lastFailureCode =
        error instanceof WorkflowProviderError ? error.code : "unavailable";
      const failureStatus: WorkflowSyncItemStatus =
        this.lastFailureCode === "auth_required"
          ? "auth_required"
          : this.lastFailureCode === "transport_uncertain"
            ? "transport_uncertain"
            : this.lastFailureCode === "schema_rejected" ||
                this.lastFailureCode === "definitive"
              ? "error"
              : "unavailable";
      for (const { remoteWorkflowId } of this.state.bindings(fence.ownerId)) {
        const prior = this.saved(fence.ownerId, remoteWorkflowId);
        this.save(
          fence,
          remoteWorkflowId,
          prior?.status === "conflicted" ||
            prior?.status === "deleted_remotely" ||
            prior?.status === "absent_remotely" ||
            prior?.status === "error"
            ? prior.status
            : failureStatus,
          prior?.cursor ?? null,
          prior?.remote ?? null,
          this.lastError,
          this.lastFailureCode,
        );
      }
    }
  }

  private operationFor(
    fence: WorkflowSyncFence,
    kind: "write" | "delete",
    workflowId: string,
    expectedRemoteRevision: number | null,
    snapshot: PortableWorkflowSnapshot | null,
  ): PendingWorkflowSyncOperation {
    const requestDigest = portableDigest({
      kind,
      ownerId: fence.ownerId,
      workflowId,
      expectedRemoteRevision,
      snapshotDigest: snapshot?.digest ?? null,
    });
    return (
      this.state.pending(fence.ownerId, workflowId) ?? {
        operationId: `sync_${randomUUID()}`,
        ownerId: fence.ownerId,
        workflowId,
        kind,
        expectedRemoteRevision,
        requestDigest,
        snapshot,
        status: "pending",
        error: null,
        failureCode: null,
      }
    );
  }

  private mutationFailure(error: unknown): WorkflowProviderError {
    return error instanceof WorkflowProviderError
      ? error
      : new WorkflowProviderError(
          "transport_uncertain",
          error instanceof Error ? error.message : String(error),
        );
  }

  private async performWrite(
    fence: WorkflowSyncFence,
    currentSnapshot: PortableWorkflowSnapshot,
    expectedRemoteRevision: number | null,
    remote: RemoteWorkflowRecord | null,
  ): Promise<void> {
    const operation = this.operationFor(
      fence,
      "write",
      currentSnapshot.workflowId,
      expectedRemoteRevision,
      currentSnapshot,
    );
    this.state.stage(fence, operation);
    this.save(
      fence,
      currentSnapshot.workflowId,
      "pending_upload",
      this.saved(fence.ownerId, currentSnapshot.workflowId)?.cursor ?? null,
      remote,
    );
    try {
      const written = await this.provider.write({
        ownerId: fence.ownerId,
        operationId: operation.operationId,
        expectedRemoteRevision: operation.expectedRemoteRevision,
        snapshot: operation.snapshot!,
        updatedAt: new Date().toISOString(),
      });
      this.assertFence(fence);
      this.state.completeOperation(fence, operation.operationId);
      this.save(
        fence,
        operation.workflowId,
        "synchronized",
        {
          acknowledgedRemoteRevision: written.remoteRevision,
          acknowledgedLocalDigest: operation.snapshot!.digest,
        },
        written,
      );
    } catch (error) {
      this.assertFence(fence);
      const failure = this.mutationFailure(error);
      if (failure.code === "conflict") {
        this.state.completeOperation(fence, operation.operationId);
        const latest = await this.provider.read(
          fence.ownerId,
          operation.workflowId,
        );
        this.assertFence(fence);
        this.save(
          fence,
          operation.workflowId,
          latest === null ? "absent_remotely" : "conflicted",
          this.saved(fence.ownerId, operation.workflowId)?.cursor ?? null,
          latest,
        );
        return;
      }
      if (failure.code === "schema_rejected" || failure.code === "definitive") {
        this.state.failOperation(
          fence,
          operation.workflowId,
          failure.message,
          failure.code,
        );
        this.save(
          fence,
          operation.workflowId,
          "error",
          this.saved(fence.ownerId, operation.workflowId)?.cursor ?? null,
          remote,
          failure.message,
          failure.code,
        );
        return;
      }
      this.state.markOperationUncertain(
        fence,
        operation.workflowId,
        failure.message,
        failure.code,
      );
      throw failure;
    }
  }

  private async performDelete(
    fence: WorkflowSyncFence,
    workflowId: string,
    expectedRemoteRevision: number,
  ): Promise<void> {
    const operation = this.operationFor(
      fence,
      "delete",
      workflowId,
      expectedRemoteRevision,
      null,
    );
    this.state.stage(fence, operation);
    const saved = this.saved(fence.ownerId, workflowId);
    this.save(
      fence,
      workflowId,
      "pending_delete",
      saved?.cursor ?? null,
      saved?.remote ?? null,
    );
    try {
      const deleted = await this.provider.delete({
        ownerId: fence.ownerId,
        workflowId,
        operationId: operation.operationId,
        expectedRemoteRevision: operation.expectedRemoteRevision!,
        deletedAt: new Date().toISOString(),
      });
      this.assertFence(fence);
      const binding = this.state.bindingByRemote(fence.ownerId, workflowId);
      if (!binding)
        throw new Error(
          "Workflow cloud binding is unavailable after deletion.",
        );
      this.state.completeDelete({
        fence,
        operationId: operation.operationId,
        localWorkflowId: binding.workflowId,
        remoteWorkflowId: workflowId,
        cursor: saved?.cursor ?? null,
        remote: deleted,
      });
    } catch (error) {
      this.assertFence(fence);
      const failure = this.mutationFailure(error);
      if (failure.code === "conflict") {
        const latest = await this.provider.read(fence.ownerId, workflowId);
        this.assertFence(fence);
        if (latest === null) {
          const binding = this.state.bindingByRemote(fence.ownerId, workflowId);
          if (!binding)
            throw new Error("Workflow cloud binding is unavailable.");
          this.state.completeDelete({
            fence,
            operationId: operation.operationId,
            localWorkflowId: binding.workflowId,
            remoteWorkflowId: workflowId,
            cursor: saved?.cursor ?? null,
            remote: null,
          });
          return;
        }
        this.state.completeOperation(fence, operation.operationId);
        this.save(
          fence,
          workflowId,
          "conflicted",
          saved?.cursor ?? null,
          latest,
        );
        return;
      }
      if (failure.code === "schema_rejected" || failure.code === "definitive") {
        this.state.failOperation(
          fence,
          workflowId,
          failure.message,
          failure.code,
        );
        this.save(
          fence,
          workflowId,
          "error",
          saved?.cursor ?? null,
          saved?.remote ?? null,
          failure.message,
          failure.code,
        );
        return;
      }
      this.state.markOperationUncertain(
        fence,
        workflowId,
        failure.message,
        failure.code,
      );
      throw failure;
    }
  }

  async resolve(
    workflowId: string,
    choice: "keep_local" | "keep_remote" | "create_copy" | "keep_device_only",
  ): Promise<void> {
    const ownerId = this.owner();
    if (!ownerId || this.state.boundOwnerId() !== ownerId)
      throw new Error("The linked Rove account is unavailable.");
    const fence = this.fence(ownerId);
    const binding = this.state.binding(workflowId);
    if (!binding || binding.ownerId !== ownerId || !binding.syncEnabled)
      throw new Error("This Workflow is not bound to the linked Rove account.");
    const remoteWorkflowId = binding.remoteWorkflowId;
    const saved = this.saved(ownerId, remoteWorkflowId);
    const local = this.local
      .listWorkflows({ includeArchived: true })
      .find((value) => value.workflowId === workflowId);
    if (
      !saved ||
      !local ||
      (saved.status !== "conflicted" &&
        saved.status !== "deleted_remotely" &&
        saved.status !== "absent_remotely")
    )
      throw new Error(
        "This Workflow has no unresolved synchronization choice.",
      );
    if (saved.status === "absent_remotely" && choice !== "keep_device_only")
      throw new Error(
        "The cloud Workflow no longer exists. It can only remain on this device.",
      );
    if (choice === "keep_device_only") {
      this.state.disableBinding(workflowId, ownerId);
      this.save(
        fence,
        remoteWorkflowId,
        "local_only",
        saved.cursor,
        saved.remote,
      );
      return;
    }
    if (saved.remote?.state === "deleted") {
      this.state.disableBinding(workflowId, ownerId);
      this.save(
        fence,
        remoteWorkflowId,
        "local_only",
        saved.cursor,
        saved.remote,
      );
      return;
    }
    if (choice === "keep_local") {
      const snapshot = this.snapshotForRemote(local, remoteWorkflowId);
      await this.performWrite(
        fence,
        snapshot,
        saved.remote?.remoteRevision ?? null,
        saved.remote,
      );
      return;
    }
    if (!saved.remote || saved.remote.state !== "active")
      throw new Error("There is no remote Workflow configuration to keep.");
    if (choice === "create_copy") {
      const operationId = `workflow_resolution_${portableDigest({
        ownerId,
        remoteWorkflowId,
        remoteRevision: saved.remote.remoteRevision,
        remoteDigest: saved.remote.snapshot.digest,
        choice,
      }).slice(0, 48)}`;
      this.assertFence(fence);
      const resolved = this.local.resolvePortableWorkflowConflict({
        operationId,
        workflowId,
        remote: this.snapshotForLocal(saved.remote.snapshot, workflowId),
      });
      this.assertFence(fence);
      const snapshot = this.snapshotForRemote(
        resolved.workflow,
        remoteWorkflowId,
      );
      this.save(
        fence,
        remoteWorkflowId,
        "synchronized",
        {
          acknowledgedRemoteRevision: saved.remote.remoteRevision,
          acknowledgedLocalDigest: snapshot.digest,
        },
        saved.remote,
      );
      return;
    }
    this.assertFence(fence);
    const applied = this.local.replacePortableWorkflowSnapshot(
      this.snapshotForLocal(saved.remote.snapshot, workflowId),
    );
    this.assertFence(fence);
    const snapshot = this.snapshotForRemote(applied, remoteWorkflowId);
    if (snapshot.digest === saved.remote.snapshot.digest) {
      this.save(
        fence,
        remoteWorkflowId,
        "synchronized",
        {
          acknowledgedRemoteRevision: saved.remote.remoteRevision,
          acknowledgedLocalDigest: snapshot.digest,
        },
        saved.remote,
      );
      return;
    }
    await this.performWrite(
      fence,
      snapshot,
      saved.remote.remoteRevision,
      saved.remote,
    );
  }

  removeFromCloud(workflowId: string): void {
    const ownerId = this.owner();
    if (!ownerId || this.state.boundOwnerId() !== ownerId)
      throw new Error("The linked Rove account is unavailable.");
    const binding = this.state.binding(workflowId);
    if (!binding || binding.ownerId !== ownerId || !binding.syncEnabled)
      throw new Error(
        "This Workflow is not synchronized to this Rove account.",
      );
    const saved = this.saved(ownerId, binding.remoteWorkflowId);
    if (!saved?.cursor)
      throw new Error(
        "Synchronize this Workflow successfully before removing its cloud copy.",
      );
    const fence = this.fence(ownerId);
    const operation = this.operationFor(
      fence,
      "delete",
      binding.remoteWorkflowId,
      saved.cursor.acknowledgedRemoteRevision,
      null,
    );
    this.state.stage(fence, operation);
    this.save(
      fence,
      binding.remoteWorkflowId,
      "pending_delete",
      saved.cursor,
      saved.remote,
    );
  }
}
