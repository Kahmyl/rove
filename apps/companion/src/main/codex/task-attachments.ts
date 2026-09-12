import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { MAX_GRANTED_FILE_BYTES, type Evidence } from "@rove/protocol";

import type { LocalFileGrantSelection } from "../host/hub-command-executor.js";

export const MAX_TASK_ATTACHMENT_BYTES = 128 * 1024 * 1024;
export const MAX_TASK_ATTACHMENTS = 100;
const MANIFEST_VERSION = 2 as const;
export type AttachmentFaultPoint =
  | "before_blob_write"
  | "after_blob_write"
  | "after_blob_rename"
  | "before_manifest_write"
  | "after_manifest_write"
  | "after_runtime_materialize"
  | "before_runtime_cleanup"
  | "after_runtime_cleanup";

export type TaskAttachmentStatus =
  "ready" | "binding" | "bound" | "unavailable";

export interface TaskAttachmentDescriptor {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
  status: TaskAttachmentStatus;
  taskId?: string;
  sessionId?: string;
  evidenceId?: string;
}

export interface CodexInputAttachment {
  filename: string;
  mimeType: string;
  path: string;
}

export interface TaskAttachmentImagePreviewSource {
  mimeType: string;
  bytes: Uint8Array;
}

export interface TaskFileAttention {
  requestId: string;
  taskId: string;
  sessionId: string;
  reason: string;
  allowMultiple: boolean;
  status:
    | "waiting"
    | "selecting"
    | "materializing"
    | "reconciliation_required"
    | "cleanup_required"
    | "cancelled"
    | "failed";
  grantId?: string;
  attachmentIds?: readonly string[];
  oldGrantId?: string;
  oldAttachmentIds?: readonly string[];
  replacementAttachmentId?: string;
  error?: string;
}

export interface UserFilePicker {
  select(input: {
    reason: string;
    allowMultiple: boolean;
  }): Promise<LocalFileGrantSelection[] | null>;
}

export interface AttachmentRuntimeMaterializer {
  materializeUserFile(input: {
    taskId: string;
    sessionId: string;
    grantId: string;
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<Evidence>;
  listEvidence?(sessionId: string): Promise<Evidence[]>;
  cleanupUserFileGrant?(sessionId: string, grantId: string): Promise<void>;
}

interface StoredAttachment extends TaskAttachmentDescriptor {
  blobName: string;
  grantId?: string;
}

interface AttachmentManifest {
  version: typeof MANIFEST_VERSION;
  attachments: StoredAttachment[];
  attention: TaskFileAttention[];
}

interface PendingGrant {
  attention: TaskFileAttention;
  resolve(value: LocalFileGrantSelection[] | null): void;
  reject(error: Error): void;
}

export class TaskAttachmentAuthority {
  private readonly attachments = new Map<string, StoredAttachment>();
  private readonly pending = new Map<string, PendingGrant>();
  private recoveredAttention: TaskFileAttention[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly root: string,
    private readonly picker: UserFilePicker,
    private readonly limits: {
      maxFiles: number;
      maxFileBytes: number;
      maxTaskBytes: number;
    } = {
      maxFiles: MAX_TASK_ATTACHMENTS,
      maxFileBytes: MAX_GRANTED_FILE_BYTES,
      maxTaskBytes: MAX_TASK_ATTACHMENT_BYTES,
    },
    private readonly fault?: (
      point: AttachmentFaultPoint,
    ) => Promise<void> | void,
  ) {}

  async restore(): Promise<void> {
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      let manifest: AttachmentManifest;
      try {
        manifest = validateManifest(
          JSON.parse(await readFile(this.manifestPath(), "utf8")),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          try {
            await readFile(join(this.root, "manifest.v1.json"), "utf8");
          } catch (legacyError) {
            if ((legacyError as NodeJS.ErrnoException).code === "ENOENT") {
              await this.removeOrphans(new Set());
              return;
            }
            throw legacyError;
          }
          throw new Error(
            "Attachment manifest version 1 requires an explicit migration.",
          );
        }
        throw error;
      }
      for (const item of manifest.attachments) {
        const next = { ...item };
        try {
          const bytes = await readFile(join(this.root, next.blobName));
          if (bytes.byteLength !== next.size || digest(bytes) !== next.sha256) {
            next.status = "unavailable";
            delete next.evidenceId;
          }
        } catch {
          next.status = "unavailable";
          delete next.evidenceId;
        }
        this.attachments.set(next.id, next);
      }
      const referenced = new Set(
        manifest.attachments.map((item) => item.blobName),
      );
      await this.removeOrphans(referenced);
      this.recoveredAttention = manifest.attention.map((entry) =>
        entry.status === "materializing" ||
        entry.status === "reconciliation_required" ||
        entry.status === "cleanup_required"
          ? {
              ...entry,
              status:
                entry.status === "cleanup_required"
                  ? "cleanup_required"
                  : "reconciliation_required",
              error:
                entry.status === "cleanup_required"
                  ? "Replacement is committed; the retired grant still requires cleanup."
                  : "File materialization requires reconciliation; retry, cancel, or finish the task.",
            }
          : {
              ...entry,
              status: "failed",
              error:
                "File selection was interrupted; select files again or cancel.",
            },
      );
      await this.flush();
    } catch (error) {
      throw sanitizeAttachmentError(error, "Attachment recovery failed.");
    }
  }

  listDrafts(): TaskAttachmentDescriptor[] {
    return [...this.attachments.values()]
      .filter((item) => item.taskId === undefined)
      .map(project);
  }

  listForTask(taskId: string): TaskAttachmentDescriptor[] {
    return [...this.attachments.values()]
      .filter((item) => item.taskId === taskId)
      .map(project);
  }

  async readImagePreview(
    taskId: string,
    filename: string,
  ): Promise<TaskAttachmentImagePreviewSource | null> {
    const item = [...this.attachments.values()].find(
      (candidate) =>
        candidate.taskId === taskId &&
        candidate.filename === filename &&
        candidate.status === "bound" &&
        candidate.mimeType.startsWith("image/"),
    );
    if (!item) return null;
    return {
      mimeType: item.mimeType,
      bytes: await this.verifiedBytes(item),
    };
  }

  listAttention(): TaskFileAttention[] {
    return [
      ...this.recoveredAttention,
      ...[...this.pending.values()].map((entry) => entry.attention),
    ].map((entry) => ({ ...entry }));
  }

  flushState(): Promise<void> {
    return this.flush();
  }

  async selectDrafts(reason = "Attach files to this Rove task") {
    try {
      const selected = await this.picker.select({
        reason,
        allowMultiple: true,
      });
      if (selected === null)
        return { status: "cancelled" as const, attachments: [] };
      const added = await this.addSelections(selected);
      return { status: "selected" as const, attachments: added };
    } catch (error) {
      throw sanitizeAttachmentError(error, "File selection failed.");
    }
  }

  async replaceDraft(id: string) {
    const old = this.requireUnbound(id);
    let committed = false;
    try {
      const selected = await this.picker.select({
        reason: "Replace this Rove task attachment",
        allowMultiple: false,
      });
      if (selected === null) return { status: "cancelled" as const };
      if (selected.length !== 1)
        throw new Error("Replacing an attachment requires exactly one file.");
      this.attachments.delete(id);
      const [attachment] = await this.addSelections(selected, undefined, false);
      try {
        await this.flush();
      } catch (error) {
        this.attachments.set(id, old);
        if (attachment) this.attachments.delete(attachment.id);
        if (attachment)
          await rm(join(this.root, `${attachment.id}.bin`), { force: true });
        throw error;
      }
      committed = true;
      await rm(join(this.root, old.blobName), { force: true }).catch(
        () => undefined,
      );
      return { status: "selected" as const, attachment };
    } catch (error) {
      if (!committed && !this.attachments.has(id))
        this.attachments.set(id, old);
      throw sanitizeAttachmentError(error, "File replacement failed.");
    }
  }

  async removeDraft(id: string): Promise<void> {
    const item = this.requireUnbound(id);
    this.attachments.delete(id);
    try {
      await this.flush();
    } catch (error) {
      this.attachments.set(id, item);
      throw sanitizeAttachmentError(error, "Attachment removal failed.");
    }
    await rm(join(this.root, item.blobName), { force: true }).catch(
      () => undefined,
    );
  }

  async reselectTaskAttachment(
    id: string,
    taskId: string,
    sessionId: string,
    runtime: AttachmentRuntimeMaterializer,
  ): Promise<TaskAttachmentDescriptor | null> {
    const old = this.attachments.get(id);
    if (
      !old ||
      old.taskId !== taskId ||
      old.sessionId !== sessionId ||
      old.status !== "unavailable"
    )
      throw new Error("Unknown or available task attachment.");
    let operation: TaskFileAttention | undefined;
    let staged: TaskAttachmentDescriptor[] = [];
    let switched = false;
    try {
      const selected = await this.picker.select({
        reason: "Reselect the unavailable Rove task attachment",
        allowMultiple: false,
      });
      if (selected === null) return null;
      if (selected.length !== 1)
        throw new Error("Reselecting an attachment requires exactly one file.");
      this.validateSelections(selected);
      if (!old.grantId)
        throw new Error("Unavailable attachment has no recoverable grant.");
      const taskItems = [...this.attachments.values()].filter(
        (item) => item.taskId === taskId && item.sessionId === sessionId,
      );
      const affected = taskItems.filter((item) => item.grantId === old.grantId);
      const unaffected = taskItems.filter(
        (item) => item.grantId !== old.grantId,
      );
      const retainedSelections: LocalFileGrantSelection[] = [];
      for (const peer of affected) {
        if (peer.id === id) continue;
        if (peer.status === "unavailable")
          throw new Error(
            "Reselect every unavailable attachment in this grant before replacing it.",
          );
        retainedSelections.push({
          filename: peer.filename,
          mimeType: peer.mimeType,
          bytes: await this.verifiedBytes(peer),
        });
      }
      this.assertAggregate([
        ...unaffected,
        selectionDescriptor(selected[0]!),
        ...retainedSelections.map(selectionDescriptor),
      ]);
      const grantId = `grant_${randomUUID().replaceAll("-", "")}`;
      staged = await this.addSelections(
        [selected[0]!, ...retainedSelections],
        { taskId, sessionId, grantId },
        false,
        new Set(affected.map((item) => item.id)),
      );
      operation = {
        requestId: `file_request_${randomUUID().replaceAll("-", "")}`,
        taskId,
        sessionId,
        reason: "Replacement grant is being reconciled.",
        allowMultiple: false,
        status: "materializing",
        grantId,
        attachmentIds: staged.map((item) => item.id),
        oldGrantId: old.grantId,
        oldAttachmentIds: affected.map((item) => item.id),
        replacementAttachmentId: staged[0]!.id,
      };
      this.recoveredAttention.push(operation);
      await this.flush();
      await this.bindDrafts(
        staged.map((item) => item.id),
        taskId,
        sessionId,
        runtime,
      );
      const oldItems = affected.map((item) => ({ ...item }));
      for (const item of affected) this.attachments.delete(item.id);
      operation.status = "cleanup_required";
      operation.error =
        "Replacement is committed; the retired grant still requires cleanup.";
      try {
        await this.flush();
        switched = true;
      } catch (error) {
        for (const item of oldItems) this.attachments.set(item.id, item);
        operation.status = "reconciliation_required";
        throw error;
      }
      await this.finishReplacementCleanup(operation, runtime, oldItems);
      return project(this.attachments.get(operation.replacementAttachmentId!)!);
    } catch (error) {
      if (operation && !switched) {
        try {
          if (!runtime.cleanupUserFileGrant)
            throw new Error("Runtime file-grant cleanup is unavailable.");
          await runtime.cleanupUserFileGrant(sessionId, operation.grantId!);
          for (const item of staged) {
            const stored = this.attachments.get(item.id);
            this.attachments.delete(item.id);
            if (stored)
              await rm(join(this.root, stored.blobName), { force: true }).catch(
                () => undefined,
              );
          }
          this.removeGrantOperation(operation.requestId);
          await this.flush();
        } catch {
          operation.status = "reconciliation_required";
          operation.error =
            "Replacement grant requires reconciliation; retry, cancel, or finish the task.";
          await this.flush().catch(() => undefined);
        }
      }
      throw sanitizeAttachmentError(error, "Attachment reselection failed.");
    }
  }

  async bindDrafts(
    ids: readonly string[],
    taskId: string,
    sessionId: string,
    runtime: AttachmentRuntimeMaterializer,
  ): Promise<TaskAttachmentDescriptor[]> {
    if (new Set(ids).size !== ids.length)
      throw new Error("Duplicate attachment identity.");
    if (
      !runtime.listEvidence &&
      ids.every((id) => {
        const item = this.attachments.get(id);
        return (
          item?.taskId === taskId &&
          item.sessionId === sessionId &&
          item.status === "bound" &&
          item.evidenceId !== undefined
        );
      })
    )
      return ids.map((id) => project(this.attachments.get(id)!));
    const items = ids.map((id) => {
      const item = this.attachments.get(id);
      if (
        !item ||
        !(
          (item.taskId === undefined && item.status === "ready") ||
          (item.taskId === taskId &&
            item.sessionId === undefined &&
            item.status === "bound") ||
          (item.taskId === taskId &&
            item.sessionId === sessionId &&
            ["binding", "bound"].includes(item.status))
        )
      )
        throw new Error("Unknown or conflicting task attachment.");
      return item;
    });
    this.assertAggregate(items);
    const priorGrants = new Set(
      items.flatMap((item) => (item.grantId ? [item.grantId] : [])),
    );
    if (priorGrants.size > 1)
      throw new Error("Task attachment grant identity is conflicting.");
    const grantId =
      [...priorGrants][0] ?? `grant_${randomUUID().replaceAll("-", "")}`;
    try {
      for (const item of items) {
        if (item.status !== "bound") item.status = "binding";
        item.taskId = taskId;
        item.sessionId = sessionId;
        item.grantId = grantId;
      }
      await this.flush();
      const runtimeEvidence = (await runtime.listEvidence?.(sessionId)) ?? [];
      const grantEvidence = runtimeEvidence.filter(
        (evidence) => evidence.metadata?.grantId === grantId,
      );
      if (
        grantEvidence.some(
          (evidence) =>
            evidence.sessionId !== sessionId ||
            evidence.type !== "file" ||
            evidence.metadata?.source !== "user_file_grant" ||
            !items.some((item) => evidenceMatches(evidence, item, grantId)),
        ) ||
        new Set(grantEvidence.map((evidence) => evidence.id)).size !==
          grantEvidence.length
      ) {
        if (!runtime.cleanupUserFileGrant)
          throw new Error("Runtime file-grant cleanup is unavailable.");
        await runtime.cleanupUserFileGrant(sessionId, grantId);
        for (const item of items) {
          item.status = "binding";
          delete item.evidenceId;
        }
        await this.flush();
        throw new Error("Runtime file evidence required reconciliation.");
      }
      for (const item of items) {
        const recovered = grantEvidence.find((evidence) =>
          evidenceMatches(evidence, item, grantId),
        );
        if (recovered) {
          item.evidenceId = recovered.id;
          item.status = "bound";
          await this.flush();
          continue;
        }
        if (item.status === "bound") {
          item.status = "binding";
          delete item.evidenceId;
          await this.flush();
        }
        const bytes = await this.verifiedBytes(item);
        const evidence = await runtime.materializeUserFile({
          taskId,
          sessionId,
          grantId,
          filename: item.filename,
          mimeType: item.mimeType,
          bytes,
        });
        await this.hit("after_runtime_materialize");
        if (!evidenceMatches(evidence, item, grantId))
          throw new Error("Runtime returned mismatched file evidence.");
        item.evidenceId = evidence.id;
        item.status = "bound";
        await this.flush();
      }
      return items.map(project);
    } catch (error) {
      await this.flush().catch(() => undefined);
      throw sanitizeAttachmentError(error, "Task attachment binding failed.");
    }
  }

  async bindTaskInputs(
    ids: readonly string[],
    taskId: string,
  ): Promise<TaskAttachmentDescriptor[]> {
    if (new Set(ids).size !== ids.length)
      throw new Error("Duplicate attachment identity.");
    const items = ids.map((id) => {
      const item = this.attachments.get(id);
      if (
        !item ||
        !(
          (item.taskId === undefined && item.status === "ready") ||
          (item.taskId === taskId &&
            item.sessionId === undefined &&
            item.status === "bound")
        )
      )
        throw new Error("Unknown or conflicting task attachment.");
      return item;
    });
    this.assertAggregate(items);
    for (const item of items) {
      item.taskId = taskId;
      item.status = "bound";
    }
    await this.flush();
    return items.map(project);
  }

  instructions(taskId: string, sessionId: string): string {
    const attachments = [
      ...new Map(
        this.listForTask(taskId)
          .filter(
            (item) => item.sessionId === sessionId && item.status === "bound",
          )
          .map((item) => [`${item.filename}\0${item.sha256}`, item]),
      ).values(),
    ];
    if (attachments.length === 0) return "";
    const list = attachments
      .map(
        (item) =>
          `${item.evidenceId}: ${JSON.stringify(item.filename)}, ${item.mimeType}, ${item.size} bytes, sha256 ${item.sha256}`,
      )
      .join("; ");
    return ` User-selected task attachments are already authorized only for this task and Runtime session. Use these opaque evidence IDs for browser upload; never request or infer a host path: ${list}.`;
  }

  /**
   * Projects the immutable attachment snapshots into the protected task
   * workspace so App Server can submit them as first-class user inputs. The
   * original user path remains private and browser-upload authority continues
   * to use the separately bound Runtime evidence ID.
   */
  async materializeCodexInputs(
    attachmentIds: readonly string[],
    taskId: string,
    sessionId: string | undefined,
    taskWorkspace: string,
  ): Promise<CodexInputAttachment[]> {
    if (!isAbsolute(taskWorkspace))
      throw new Error("Codex attachment workspace must be absolute.");
    if (new Set(attachmentIds).size !== attachmentIds.length)
      throw new Error("Duplicate Codex input attachment identity.");
    const items = attachmentIds.map((attachmentId) => {
      const item = this.attachments.get(attachmentId);
      if (
        !item ||
        item.taskId !== taskId ||
        (sessionId !== undefined && item.sessionId !== sessionId) ||
        item.status !== "bound" ||
        (sessionId !== undefined && !item.evidenceId)
      )
        throw new Error("Codex input attachment is not fully bound.");
      return item;
    });
    if (items.length === 0) return [];
    const directory = join(taskWorkspace, ".rove-attachments");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const projected: CodexInputAttachment[] = [];
    for (const item of items) {
      const path = join(directory, item.filename);
      const bytes = await this.verifiedBytes(item);
      try {
        const existing = await readFile(path);
        const digest = createHash("sha256").update(existing).digest("hex");
        if (existing.byteLength !== item.size || digest !== item.sha256)
          throw new Error("Codex input attachment path is conflicting.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const temporary = join(directory, `.${item.id}.tmp`);
        await writeFile(temporary, bytes, { mode: 0o600 });
        await rename(temporary, path);
      }
      projected.push({
        filename: item.filename,
        mimeType: item.mimeType,
        path,
      });
    }
    return projected;
  }

  requestMidTask(input: {
    requestId: string;
    taskId: string;
    sessionId: string;
    reason: string;
    allowMultiple: boolean;
  }): Promise<LocalFileGrantSelection[] | null> {
    if (this.pending.has(input.requestId))
      throw new Error("Duplicate file request identity.");
    if (
      this.listAttention().some(
        (entry) =>
          [
            "waiting",
            "selecting",
            "materializing",
            "reconciliation_required",
            "cleanup_required",
          ].includes(entry.status) &&
          (entry.taskId === input.taskId ||
            entry.sessionId === input.sessionId),
      )
    )
      throw new Error("A file request is already pending for this task.");
    const attention: TaskFileAttention = {
      ...input,
      reason: boundedReason(input.reason),
      status: "waiting",
    };
    const result = new Promise<LocalFileGrantSelection[] | null>(
      (resolve, reject) => {
        this.pending.set(input.requestId, { attention, resolve, reject });
      },
    );
    const created = this.pending.get(input.requestId)!;
    return this.flush().then(
      () => result,
      (error) => {
        this.pending.delete(input.requestId);
        created.resolve(null);
        throw sanitizeAttachmentError(
          error,
          "File request could not be persisted.",
        );
      },
    );
  }

  async selectPending(identity: {
    requestId: string;
    taskId: string;
    sessionId: string;
  }): Promise<void> {
    const pending = this.requirePending(identity);
    if (pending.attention.status !== "waiting")
      throw new Error("File request is no longer selectable.");
    pending.attention.status = "selecting";
    await this.flush();
    let added: TaskAttachmentDescriptor[] = [];
    try {
      const selected = await this.picker.select({
        reason: pending.attention.reason,
        allowMultiple: pending.attention.allowMultiple,
      });
      if (
        selected !== null &&
        !pending.attention.allowMultiple &&
        selected.length !== 1
      )
        throw new Error("The file request requires exactly one file.");
      if (selected === null) {
        pending.attention.status = "cancelled";
        this.pending.delete(identity.requestId);
        try {
          await this.flush();
        } catch (error) {
          pending.attention.status = "waiting";
          this.pending.set(identity.requestId, pending);
          throw error;
        }
        pending.resolve(null);
        return;
      }
      this.validateSelections(selected);
      let granted = selected;
      {
        const grantId = `grant_${randomUUID().replaceAll("-", "")}`;
        const existing = this.listForTask(identity.taskId);
        const incoming = selected.map(selectionDescriptor);
        this.assertAggregate([...existing, ...incoming]);
        const names = new Set(existing.map((item) => item.filename));
        for (const item of incoming) {
          if (names.has(item.filename))
            throw new Error(
              "Attachment filenames must be unique within a task.",
            );
          names.add(item.filename);
        }
        added = await this.addSelections(
          selected,
          {
            taskId: identity.taskId,
            sessionId: identity.sessionId,
            grantId,
          },
          false,
        );
        pending.attention.status = "materializing";
        pending.attention.grantId = grantId;
        pending.attention.attachmentIds = added.map((item) => item.id);
        await this.flush();
        granted = selected.map((file, index) => ({
          filename: added[index]!.filename,
          mimeType: added[index]!.mimeType,
          bytes: file.bytes,
          attachmentId: added[index]!.id,
          grantId,
        }));
      }
      pending.resolve(granted);
    } catch (error) {
      for (const item of added) {
        this.attachments.delete(item.id);
        const stored = item as StoredAttachment;
        if (stored.blobName)
          await rm(join(this.root, stored.blobName), { force: true }).catch(
            () => undefined,
          );
      }
      delete pending.attention.grantId;
      delete pending.attention.attachmentIds;
      pending.attention.status = "failed";
      pending.attention.error = sanitizeAttachmentError(
        error,
        "File selection failed.",
      ).message;
      this.recoveredAttention.push({ ...pending.attention });
      this.pending.delete(identity.requestId);
      const sanitized = sanitizeAttachmentError(
        error,
        "File selection failed.",
      );
      await this.flush().catch(() => undefined);
      pending.reject(sanitized);
      throw sanitized;
    }
  }

  async cancelPending(identity: {
    requestId: string;
    taskId: string;
    sessionId: string;
  }): Promise<void> {
    const pending = this.pending.get(identity.requestId);
    if (!pending) {
      const recovered = this.recoveredAttention.findIndex(
        (entry) =>
          entry.requestId === identity.requestId &&
          entry.taskId === identity.taskId &&
          entry.sessionId === identity.sessionId,
      );
      if (recovered < 0) throw new Error("Stale or mismatched file request.");
      this.recoveredAttention.splice(recovered, 1);
      await this.flush();
      return;
    }
    this.requirePending(identity);
    if (pending.attention.status !== "waiting")
      throw new Error("File request is no longer cancellable.");
    pending.attention.status = "cancelled";
    this.pending.delete(identity.requestId);
    try {
      await this.flush();
    } catch (error) {
      pending.attention.status = "waiting";
      this.pending.set(identity.requestId, pending);
      throw sanitizeAttachmentError(error, "File request cancellation failed.");
    }
    pending.resolve(null);
  }

  async cleanupTask(taskId: string): Promise<void> {
    const pending = [...this.pending.entries()].filter(
      ([, entry]) => entry.attention.taskId === taskId,
    );
    const previousAttention = this.recoveredAttention;
    for (const [requestId] of pending) this.pending.delete(requestId);
    this.recoveredAttention = this.recoveredAttention.filter(
      (entry) => entry.taskId !== taskId,
    );
    const items = [...this.attachments.values()].filter(
      (item) => item.taskId === taskId,
    );
    for (const item of items) this.attachments.delete(item.id);
    try {
      await this.flush();
    } catch (error) {
      for (const item of items) this.attachments.set(item.id, item);
      for (const [requestId, entry] of pending)
        this.pending.set(requestId, entry);
      this.recoveredAttention = previousAttention;
      throw sanitizeAttachmentError(error, "Attachment cleanup failed.");
    }
    for (const [, entry] of pending) entry.resolve(null);
    for (const item of items)
      await rm(join(this.root, item.blobName), { force: true }).catch(
        () => undefined,
      );
  }

  async cleanupRuntimeGrants(
    taskId: string,
    sessionId: string,
    runtime: AttachmentRuntimeMaterializer,
  ): Promise<void> {
    const grants = new Set([
      ...[...this.attachments.values()].flatMap((item) =>
        item.taskId === taskId && item.sessionId === sessionId && item.grantId
          ? [item.grantId]
          : [],
      ),
      ...this.listAttention().flatMap((entry) =>
        entry.taskId === taskId && entry.sessionId === sessionId
          ? [entry.grantId, entry.oldGrantId].filter((grant): grant is string =>
              Boolean(grant),
            )
          : [],
      ),
    ]);
    for (const grantId of grants)
      try {
        if (!runtime.cleanupUserFileGrant)
          throw new Error("Runtime file-grant cleanup is unavailable.");
        await this.hit("before_runtime_cleanup");
        await runtime.cleanupUserFileGrant(sessionId, grantId);
        await this.hit("after_runtime_cleanup");
      } catch (error) {
        throw sanitizeAttachmentError(
          error,
          "Runtime file-grant cleanup failed.",
        );
      }
  }

  async rollbackKnownSafe(
    taskId: string,
    sessionId: string,
    runtime: AttachmentRuntimeMaterializer,
  ): Promise<void> {
    await this.cleanupRuntimeGrants(taskId, sessionId, runtime);
    await this.cleanupTask(taskId);
  }

  async completeMidTask(
    sessionId: string,
    materialized: readonly { attachmentId: string; evidenceId: string }[],
  ): Promise<void> {
    const resolved = materialized.map((result) => ({
      result,
      item: this.attachments.get(result.attachmentId),
    }));
    if (
      materialized.length === 0 ||
      new Set(materialized.map((entry) => entry.attachmentId)).size !==
        materialized.length ||
      resolved.some(
        ({ result, item }) =>
          !item ||
          item.sessionId !== sessionId ||
          !(
            item.status === "binding" ||
            (item.status === "bound" && item.evidenceId === result.evidenceId)
          ) ||
          !/^ev_[A-Za-z0-9_-]+$/.test(result.evidenceId),
      )
    )
      throw new Error("Stale or mismatched file materialization.");
    const operation = this.requireGrantOperation(
      sessionId,
      materialized.map((entry) => entry.attachmentId),
    );
    const before = resolved.map(({ item }) => ({ ...item! }));
    for (const { result, item } of resolved) {
      if (!item) throw new Error("Stale or mismatched file materialization.");
      item.evidenceId = result.evidenceId;
      item.status = "bound";
    }
    this.removeGrantOperation(operation.attention.requestId);
    try {
      await this.flush();
    } catch (error) {
      for (const item of before) this.attachments.set(item.id, item);
      operation.attention.status = "reconciliation_required";
      operation.attention.error =
        "File materialization requires reconciliation; retry, cancel, or finish the task.";
      this.restoreGrantOperation(operation);
      await this.flush().catch(() => undefined);
      throw sanitizeAttachmentError(
        error,
        "File materialization could not be persisted.",
      );
    }
  }

  async failMidTask(
    sessionId: string,
    attachmentIds: readonly string[],
  ): Promise<void> {
    const items = attachmentIds.map((id) => this.attachments.get(id));
    if (
      new Set(attachmentIds).size !== attachmentIds.length ||
      items.some(
        (item) =>
          !item || item.sessionId !== sessionId || item.status !== "binding",
      )
    )
      throw new Error("Stale or mismatched file materialization.");
    const operation = this.requireGrantOperation(sessionId, attachmentIds);
    for (const item of items) if (item) this.attachments.delete(item.id);
    this.removeGrantOperation(operation.attention.requestId);
    try {
      await this.flush();
    } catch (error) {
      for (const item of items) if (item) this.attachments.set(item.id, item);
      operation.attention.status = "reconciliation_required";
      operation.attention.error =
        "File grant cleanup requires reconciliation; retry, cancel, or finish the task.";
      this.restoreGrantOperation(operation);
      await this.flush().catch(() => undefined);
      throw sanitizeAttachmentError(error, "File grant cleanup failed.");
    }
    for (const item of items)
      if (item)
        await rm(join(this.root, item.blobName), { force: true }).catch(
          () => undefined,
        );
  }

  async markMidTaskReconciliation(
    sessionId: string,
    attachmentIds: readonly string[],
    message = "File grant cleanup requires reconciliation; retry, cancel, or finish the task.",
  ): Promise<void> {
    const operation = this.requireGrantOperation(sessionId, attachmentIds);
    operation.attention.status = "reconciliation_required";
    operation.attention.error = message.slice(0, 500);
    await this.flush();
  }

  async reconcileMidTask(
    identity: { requestId: string; taskId: string; sessionId: string },
    runtime: AttachmentRuntimeMaterializer,
    action: "retry" | "cancel",
  ): Promise<void> {
    const operation = this.findGrantOperation(identity.requestId);
    if (
      !operation ||
      operation.attention.taskId !== identity.taskId ||
      operation.attention.sessionId !== identity.sessionId ||
      !["reconciliation_required", "cleanup_required"].includes(
        operation.attention.status,
      ) ||
      !operation.attention.grantId ||
      !operation.attention.attachmentIds?.length
    )
      throw new Error("Stale or mismatched file reconciliation request.");
    if (operation.attention.replacementAttachmentId) {
      await this.reconcileReplacement(operation.attention, runtime, action);
      return;
    }
    if (action === "retry") {
      const bound = await this.bindDrafts(
        operation.attention.attachmentIds,
        identity.taskId,
        identity.sessionId,
        runtime,
      );
      await this.completeMidTask(
        identity.sessionId,
        bound.map((item) => ({
          attachmentId: item.id,
          evidenceId: item.evidenceId!,
        })),
      );
      return;
    }
    if (!runtime.cleanupUserFileGrant)
      throw new Error("Runtime file-grant cleanup is unavailable.");
    try {
      await runtime.cleanupUserFileGrant(
        identity.sessionId,
        operation.attention.grantId,
      );
      await this.failMidTask(
        identity.sessionId,
        operation.attention.attachmentIds,
      );
    } catch (error) {
      await this.markMidTaskReconciliation(
        identity.sessionId,
        operation.attention.attachmentIds,
      ).catch(() => undefined);
      throw sanitizeAttachmentError(error, "File reconciliation failed.");
    }
  }

  async reconcileTaskOperations(
    taskId: string,
    sessionId: string,
    runtime: AttachmentRuntimeMaterializer,
  ): Promise<void> {
    const operations = this.listAttention().filter(
      (entry) =>
        entry.taskId === taskId &&
        entry.sessionId === sessionId &&
        [
          "materializing",
          "reconciliation_required",
          "cleanup_required",
        ].includes(entry.status),
    );
    for (const operation of operations)
      await this.reconcileMidTask(
        {
          requestId: operation.requestId,
          taskId,
          sessionId,
        },
        runtime,
        "retry",
      );
  }

  private async reconcileReplacement(
    operation: TaskFileAttention,
    runtime: AttachmentRuntimeMaterializer,
    action: "retry" | "cancel",
  ): Promise<void> {
    if (
      !operation.grantId ||
      !operation.oldGrantId ||
      !operation.attachmentIds?.length ||
      !operation.oldAttachmentIds?.length ||
      !operation.replacementAttachmentId
    )
      throw new Error("Replacement reconciliation metadata is incomplete.");
    if (operation.status === "cleanup_required") {
      await this.finishReplacementCleanup(operation, runtime, []);
      return;
    }
    if (action === "cancel") {
      try {
        if (!runtime.cleanupUserFileGrant)
          throw new Error("Runtime file-grant cleanup is unavailable.");
        await runtime.cleanupUserFileGrant(
          operation.sessionId,
          operation.grantId,
        );
        const staged = operation.attachmentIds.map((id) =>
          this.attachments.get(id),
        );
        for (const item of staged) if (item) this.attachments.delete(item.id);
        this.removeGrantOperation(operation.requestId);
        await this.flush();
        for (const item of staged)
          if (item)
            await rm(join(this.root, item.blobName), { force: true }).catch(
              () => undefined,
            );
        return;
      } catch (error) {
        operation.status = "reconciliation_required";
        await this.flush().catch(() => undefined);
        throw sanitizeAttachmentError(
          error,
          "Replacement cancellation failed.",
        );
      }
    }
    await this.bindDrafts(
      operation.attachmentIds,
      operation.taskId,
      operation.sessionId,
      runtime,
    );
    const oldItems = operation.oldAttachmentIds.flatMap((id) => {
      const item = this.attachments.get(id);
      return item ? [{ ...item }] : [];
    });
    if (oldItems.length !== operation.oldAttachmentIds.length)
      throw new Error("Replacement source grant is no longer complete.");
    for (const item of oldItems) this.attachments.delete(item.id);
    operation.status = "cleanup_required";
    operation.error =
      "Replacement is committed; the retired grant still requires cleanup.";
    try {
      await this.flush();
    } catch (error) {
      for (const item of oldItems) this.attachments.set(item.id, item);
      operation.status = "reconciliation_required";
      await this.flush().catch(() => undefined);
      throw sanitizeAttachmentError(error, "Replacement switch failed.");
    }
    await this.finishReplacementCleanup(operation, runtime, oldItems);
  }

  private async finishReplacementCleanup(
    operation: TaskFileAttention,
    runtime: AttachmentRuntimeMaterializer,
    retired: readonly StoredAttachment[],
  ): Promise<void> {
    if (!operation.oldGrantId)
      throw new Error("Replacement cleanup grant is missing.");
    try {
      if (!runtime.cleanupUserFileGrant)
        throw new Error("Runtime file-grant cleanup is unavailable.");
      await this.hit("before_runtime_cleanup");
      await runtime.cleanupUserFileGrant(
        operation.sessionId,
        operation.oldGrantId,
      );
      await this.hit("after_runtime_cleanup");
      this.removeGrantOperation(operation.requestId);
      try {
        await this.flush();
      } catch (error) {
        operation.status = "cleanup_required";
        this.restoreGrantOperation({ attention: operation });
        await this.flush().catch(() => undefined);
        throw error;
      }
      for (const item of retired)
        await rm(join(this.root, item.blobName), { force: true }).catch(
          () => undefined,
        );
    } catch (error) {
      operation.status = "cleanup_required";
      operation.error =
        "Replacement is committed; the retired grant still requires cleanup.";
      this.restoreGrantOperation({ attention: operation });
      await this.flush().catch(() => undefined);
      throw sanitizeAttachmentError(error, "Replacement cleanup failed.");
    }
  }

  private async addSelections(
    selections: LocalFileGrantSelection[],
    binding?: { taskId: string; sessionId: string; grantId?: string },
    persist = true,
    ignoreExistingIds: ReadonlySet<string> = new Set(),
  ): Promise<TaskAttachmentDescriptor[]> {
    this.validateSelections(selections);
    const added: StoredAttachment[] = [];
    const temporaryFiles = new Set<string>();
    await this.serial(async () => {
      const existing =
        binding === undefined
          ? this.listDrafts()
          : this.listForTask(binding.taskId).filter(
              (item) => !ignoreExistingIds.has(item.id),
            );
      const incoming = selections.map(selectionDescriptor);
      this.assertAggregate([...existing, ...incoming]);
      const names = new Set(existing.map((item) => item.filename));
      for (const item of incoming) {
        if (names.has(item.filename))
          throw new Error("Attachment filenames must be unique within a task.");
        names.add(item.filename);
      }
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      try {
        for (const selection of selections) {
          const id = `att_${randomUUID().replaceAll("-", "")}`;
          const blobName = `${id}.bin`;
          const item: StoredAttachment = {
            ...selectionDescriptor(selection),
            id,
            blobName,
            status: binding === undefined ? "ready" : "binding",
            ...(binding === undefined ? {} : binding),
          };
          const temporary = join(this.root, `${blobName}.tmp`);
          temporaryFiles.add(temporary);
          await this.hit("before_blob_write");
          await writeFile(temporary, selection.bytes, { mode: 0o600 });
          await this.hit("after_blob_write");
          await rename(temporary, join(this.root, blobName));
          temporaryFiles.delete(temporary);
          await this.hit("after_blob_rename");
          this.attachments.set(id, item);
          added.push(item);
        }
        if (persist) await this.flushUnlocked();
      } catch (error) {
        for (const item of added) {
          this.attachments.delete(item.id);
          await rm(join(this.root, item.blobName), { force: true });
        }
        for (const temporary of temporaryFiles)
          await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    });
    return added.map(project);
  }

  private requireDraft(id: string): StoredAttachment {
    const item = this.attachments.get(id);
    if (!item || item.taskId !== undefined || item.status !== "ready")
      throw new Error("Unknown or unavailable draft attachment.");
    return item;
  }

  private requireUnbound(id: string): StoredAttachment {
    const item = this.attachments.get(id);
    if (!item || item.taskId !== undefined)
      throw new Error("Unknown or bound attachment.");
    return item;
  }

  private validateSelections(selections: LocalFileGrantSelection[]): void {
    if (selections.length === 0 || selections.length > this.limits.maxFiles)
      throw new Error(
        `Attachment selection must contain between 1 and ${this.limits.maxFiles} files.`,
      );
    for (const selection of selections) {
      if (!(selection.bytes instanceof Uint8Array))
        throw new Error("Attachment selection is not a regular file snapshot.");
      if (selection.bytes.byteLength > this.limits.maxFileBytes)
        throw new Error(
          "A selected file exceeds the per-file attachment limit.",
        );
      safeFilename(selection.filename);
    }
    this.assertAggregate(selections.map(selectionDescriptor));
  }

  private assertAggregate(items: readonly { size: number }[]): void {
    if (items.length > this.limits.maxFiles)
      throw new Error(
        `A task cannot contain more than ${this.limits.maxFiles} attachments.`,
      );
    const total = items.reduce((sum, item) => sum + item.size, 0);
    if (total > this.limits.maxTaskBytes)
      throw new Error("Task attachments exceed the aggregate limit.");
  }

  private requirePending(identity: {
    requestId: string;
    taskId: string;
    sessionId: string;
  }): PendingGrant {
    const pending = this.pending.get(identity.requestId);
    if (
      !pending ||
      pending.attention.taskId !== identity.taskId ||
      pending.attention.sessionId !== identity.sessionId
    )
      throw new Error("Stale or mismatched file request.");
    return pending;
  }

  private findGrantOperation(requestId: string):
    | {
        attention: TaskFileAttention;
        pending?: PendingGrant;
      }
    | undefined {
    const pending = this.pending.get(requestId);
    if (pending) return { attention: pending.attention, pending };
    const attention = this.recoveredAttention.find(
      (entry) => entry.requestId === requestId,
    );
    return attention ? { attention } : undefined;
  }

  private requireGrantOperation(
    sessionId: string,
    attachmentIds: readonly string[],
  ): { attention: TaskFileAttention; pending?: PendingGrant } {
    const expected = [...attachmentIds].sort().join("\0");
    const matches = [
      ...this.recoveredAttention.map((attention) => ({ attention })),
      ...[...this.pending.values()].map((pending) => ({
        attention: pending.attention,
        pending,
      })),
    ].filter(({ attention }) => {
      if (
        attention.sessionId !== sessionId ||
        (attention.status !== "materializing" &&
          attention.status !== "reconciliation_required") ||
        !attention.grantId ||
        !attention.attachmentIds?.length ||
        [...attention.attachmentIds].sort().join("\0") !== expected
      )
        return false;
      return attention.attachmentIds.every((id) => {
        const item = this.attachments.get(id);
        return (
          item?.taskId === attention.taskId &&
          item.sessionId === sessionId &&
          item.grantId === attention.grantId &&
          ["binding", "bound"].includes(item.status)
        );
      });
    });
    if (matches.length !== 1)
      throw new Error("Stale or mismatched file materialization operation.");
    return matches[0]!;
  }

  private removeGrantOperation(requestId: string): void {
    if (this.pending.delete(requestId)) return;
    const recovered = this.recoveredAttention.findIndex(
      (entry) => entry.requestId === requestId,
    );
    if (recovered >= 0) this.recoveredAttention.splice(recovered, 1);
  }

  private restoreGrantOperation(operation: {
    attention: TaskFileAttention;
    pending?: PendingGrant;
  }): void {
    if (operation.pending) {
      this.pending.set(operation.attention.requestId, operation.pending);
      return;
    }
    if (
      !this.recoveredAttention.some(
        (entry) => entry.requestId === operation.attention.requestId,
      )
    )
      this.recoveredAttention.push(operation.attention);
  }

  private async verifiedBytes(item: StoredAttachment): Promise<Uint8Array> {
    const bytes = await readFile(join(this.root, item.blobName));
    const info = await stat(join(this.root, item.blobName));
    if (
      !info.isFile() ||
      bytes.byteLength !== item.size ||
      digest(bytes) !== item.sha256
    )
      throw new Error("Attachment bytes failed integrity verification.");
    return bytes;
  }

  private manifestPath(): string {
    return join(this.root, "manifest.v2.json");
  }

  private async removeOrphans(referenced: ReadonlySet<string>): Promise<void> {
    for (const name of await readdir(this.root))
      if (
        (name.endsWith(".bin") || name.endsWith(".tmp")) &&
        !referenced.has(name)
      )
        await rm(join(this.root, name), { force: true });
  }

  private flush(): Promise<void> {
    return this.serial(() => this.flushUnlocked());
  }

  private async flushUnlocked(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const manifest: AttachmentManifest = {
      version: MANIFEST_VERSION,
      attachments: [...this.attachments.values()],
      attention: [
        ...this.recoveredAttention,
        ...[...this.pending.values()].map((entry) => entry.attention),
      ],
    };
    const temporary = `${this.manifestPath()}.tmp`;
    await this.hit("before_manifest_write");
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });
    await this.hit("after_manifest_write");
    await rename(temporary, this.manifestPath());
  }

  private async hit(point: AttachmentFaultPoint): Promise<void> {
    await this.fault?.(point);
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.chain.then(operation, operation);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function selectionDescriptor(
  selection: LocalFileGrantSelection,
): Omit<TaskAttachmentDescriptor, "id" | "status"> {
  return {
    filename: safeFilename(selection.filename),
    mimeType: safeMimeType(selection.mimeType, selection.bytes),
    size: selection.bytes.byteLength,
    sha256: digest(selection.bytes),
  };
}

export function safeFilename(value: string): string {
  const leaf = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const safe = [...leaf]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127 ? "_" : character;
    })
    .join("")
    .trim()
    .slice(0, 200);
  if (!safe || safe === "." || safe === "..")
    throw new Error("Selected file has no safe filename.");
  return safe;
}

export function safeMimeType(value: string, bytes: Uint8Array): string {
  const signature = Buffer.from(bytes.subarray(0, 12));
  if (signature.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return "image/png";
  if (signature.subarray(0, 4).toString("ascii") === "%PDF")
    return "application/pdf";
  if (signature.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")))
    return "image/jpeg";
  const bounded = /^[\w.+-]+\/[\w.+-]+$/.test(value) ? value : "";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
      [...text].every((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code === 9 || code === 10 || code === 13 || code >= 32;
      })
    )
      return bounded.startsWith("text/") ? bounded : "text/plain";
  } catch {
    // Preserve only a syntactically bounded declared MIME for unknown binary.
  }
  return bounded || "application/octet-stream";
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function boundedReason(value: string): string {
  const safe = value
    .replace(/[\r\n\0]/g, " ")
    .trim()
    .slice(0, 500);
  if (!safe) throw new Error("A file request needs a visible reason.");
  return safe;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\/[^\s]+/g, "[redacted-path]")
    .replace(/[A-Za-z]:\\[^\s]+/g, "[redacted-path]")
    .slice(0, 500);
}

export function sanitizeAttachmentError(
  error: unknown,
  fallback: string,
): Error {
  const message = safeError(error);
  return new Error(
    message && !message.includes("[redacted-path]") ? message : fallback,
  );
}

function evidenceMatches(
  evidence: Evidence,
  item: StoredAttachment,
  grantId: string,
): boolean {
  return (
    evidence.sessionId === item.sessionId &&
    evidence.type === "file" &&
    evidence.label === item.filename &&
    evidence.metadata?.filename === item.filename &&
    evidence.metadata?.mimeType === item.mimeType &&
    evidence.metadata?.sizeBytes === item.size &&
    evidence.metadata?.sha256 === item.sha256 &&
    evidence.metadata?.source === "user_file_grant" &&
    evidence.metadata?.grantId === grantId
  );
}

function project(item: StoredAttachment): TaskAttachmentDescriptor {
  return {
    id: item.id,
    filename: item.filename,
    mimeType: item.mimeType,
    size: item.size,
    sha256: item.sha256,
    status: item.status,
    ...(item.taskId === undefined ? {} : { taskId: item.taskId }),
    ...(item.sessionId === undefined ? {} : { sessionId: item.sessionId }),
    ...(item.evidenceId === undefined ? {} : { evidenceId: item.evidenceId }),
  };
}

function validateManifest(value: unknown): AttachmentManifest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid attachment manifest.");
  const record = value as Record<string, unknown>;
  if (
    record.version !== MANIFEST_VERSION ||
    !Array.isArray(record.attachments) ||
    !Array.isArray(record.attention) ||
    Object.keys(record).some(
      (key) => !["version", "attachments", "attention"].includes(key),
    )
  )
    throw new Error("Unsupported attachment manifest version.");
  const attachments = record.attachments.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("Invalid persisted attachment.");
    const item = entry as Record<string, unknown>;
    const allowed = [
      "id",
      "filename",
      "mimeType",
      "size",
      "sha256",
      "status",
      "taskId",
      "sessionId",
      "evidenceId",
      "blobName",
      "grantId",
    ];
    if (Object.keys(item).some((key) => !allowed.includes(key)))
      throw new Error("Invalid persisted attachment fields.");
    if (
      typeof item.id !== "string" ||
      !/^att_[a-f0-9]{32}$/.test(item.id) ||
      item.blobName !== `${item.id}.bin` ||
      typeof item.filename !== "string" ||
      safeFilename(item.filename) !== item.filename ||
      typeof item.mimeType !== "string" ||
      !/^[\w.+-]+\/[\w.+-]+$/.test(item.mimeType) ||
      !Number.isSafeInteger(item.size) ||
      Number(item.size) < 0 ||
      Number(item.size) > MAX_GRANTED_FILE_BYTES ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !["ready", "binding", "bound", "unavailable"].includes(
        String(item.status),
      ) ||
      (item.taskId !== undefined && typeof item.taskId !== "string") ||
      (item.sessionId !== undefined && typeof item.sessionId !== "string") ||
      (item.evidenceId !== undefined && typeof item.evidenceId !== "string") ||
      (item.grantId !== undefined &&
        (typeof item.grantId !== "string" ||
          !/^grant_[a-f0-9]{32}$/.test(item.grantId))) ||
      (item.taskId !== undefined &&
        !/^task_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(item.taskId)) ||
      (item.sessionId !== undefined &&
        !/^ses_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(item.sessionId)) ||
      (item.evidenceId !== undefined &&
        !/^ev_[A-Za-z0-9_-]+$/.test(item.evidenceId))
    )
      throw new Error("Invalid persisted attachment metadata.");
    return item as unknown as StoredAttachment;
  });
  if (attachments.length > MAX_TASK_ATTACHMENTS * 2)
    throw new Error("Persisted attachment count exceeds its bound.");
  if (
    new Set(attachments.map((item) => item.id)).size !== attachments.length ||
    attachments.reduce((total, item) => total + item.size, 0) >
      MAX_TASK_ATTACHMENT_BYTES * 2 ||
    attachments.some(
      (item) =>
        (item.status === "ready" &&
          (item.taskId !== undefined ||
            item.sessionId !== undefined ||
            item.evidenceId !== undefined)) ||
        (item.status === "binding" &&
          (!item.taskId || !item.sessionId || !item.grantId)) ||
        (item.status === "bound" &&
          (!item.taskId ||
            !item.sessionId ||
            !item.evidenceId ||
            !item.grantId)) ||
        (item.taskId !== undefined && item.sessionId === undefined),
    )
  )
    throw new Error("Persisted attachment bindings are inconsistent.");
  const attention = record.attention.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("Invalid persisted file attention.");
    const item = entry as Record<string, unknown>;
    if (
      Object.keys(item).some(
        (key) =>
          ![
            "requestId",
            "taskId",
            "sessionId",
            "reason",
            "allowMultiple",
            "status",
            "grantId",
            "attachmentIds",
            "oldGrantId",
            "oldAttachmentIds",
            "replacementAttachmentId",
            "error",
          ].includes(key),
      ) ||
      typeof item.requestId !== "string" ||
      !/^file_request_[a-f0-9]+$/.test(item.requestId) ||
      typeof item.taskId !== "string" ||
      !/^task_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(item.taskId) ||
      typeof item.sessionId !== "string" ||
      !/^ses_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(item.sessionId) ||
      typeof item.reason !== "string" ||
      boundedReason(item.reason) !== item.reason ||
      typeof item.allowMultiple !== "boolean" ||
      ![
        "waiting",
        "selecting",
        "materializing",
        "reconciliation_required",
        "cleanup_required",
        "cancelled",
        "failed",
      ].includes(String(item.status)) ||
      (item.grantId !== undefined &&
        (typeof item.grantId !== "string" ||
          !/^grant_[a-f0-9]{32}$/.test(item.grantId))) ||
      (item.oldGrantId !== undefined &&
        (typeof item.oldGrantId !== "string" ||
          !/^grant_[a-f0-9]{32}$/.test(item.oldGrantId))) ||
      (item.attachmentIds !== undefined &&
        (!Array.isArray(item.attachmentIds) ||
          item.attachmentIds.length === 0 ||
          item.attachmentIds.some(
            (id) => typeof id !== "string" || !/^att_[a-f0-9]{32}$/.test(id),
          ) ||
          new Set(item.attachmentIds).size !== item.attachmentIds.length)) ||
      (item.oldAttachmentIds !== undefined &&
        (!Array.isArray(item.oldAttachmentIds) ||
          item.oldAttachmentIds.length === 0 ||
          item.oldAttachmentIds.some(
            (id) => typeof id !== "string" || !/^att_[a-f0-9]{32}$/.test(id),
          ) ||
          new Set(item.oldAttachmentIds).size !==
            item.oldAttachmentIds.length)) ||
      (item.replacementAttachmentId !== undefined &&
        (typeof item.replacementAttachmentId !== "string" ||
          !/^att_[a-f0-9]{32}$/.test(item.replacementAttachmentId))) ||
      (item.error !== undefined && typeof item.error !== "string")
    )
      throw new Error("Invalid persisted file attention metadata.");
    return item as unknown as TaskFileAttention;
  });
  if (attention.length > MAX_TASK_ATTACHMENTS)
    throw new Error("Persisted file attention count exceeds its bound.");
  for (const entry of attention) {
    const replacement = Boolean(entry.replacementAttachmentId);
    const ownsGrant = [
      "materializing",
      "reconciliation_required",
      "cleanup_required",
    ].includes(entry.status);
    if (
      ownsGrant !== Boolean(entry.grantId && entry.attachmentIds?.length) ||
      replacement !==
        Boolean(entry.oldGrantId && entry.oldAttachmentIds?.length) ||
      (replacement &&
        !entry.attachmentIds?.includes(entry.replacementAttachmentId!)) ||
      (ownsGrant &&
        entry.status !== "cleanup_required" &&
        entry.attachmentIds?.some((id) => {
          const attachment = attachments.find((item) => item.id === id);
          return (
            attachment?.taskId !== entry.taskId ||
            attachment.sessionId !== entry.sessionId ||
            attachment.grantId !== entry.grantId ||
            !["binding", "bound"].includes(attachment.status)
          );
        })) ||
      (entry.status === "cleanup_required" &&
        entry.attachmentIds?.some((id) => {
          const attachment = attachments.find((item) => item.id === id);
          return (
            attachment?.taskId !== entry.taskId ||
            attachment.sessionId !== entry.sessionId ||
            attachment.grantId !== entry.grantId ||
            attachment.status !== "bound"
          );
        })) ||
      (replacement &&
        entry.status !== "cleanup_required" &&
        entry.oldAttachmentIds?.some((id) => {
          const attachment = attachments.find((item) => item.id === id);
          return (
            attachment?.taskId !== entry.taskId ||
            attachment.sessionId !== entry.sessionId ||
            attachment.grantId !== entry.oldGrantId
          );
        }))
    )
      throw new Error("Persisted file attention grant is inconsistent.");
  }
  const duplicateFilenameGroups = new Map<string, StoredAttachment[]>();
  for (const item of attachments) {
    const key = `${item.taskId ?? "draft"}\0${item.filename}`;
    duplicateFilenameGroups.set(key, [
      ...(duplicateFilenameGroups.get(key) ?? []),
      item,
    ]);
  }
  for (const group of duplicateFilenameGroups.values()) {
    if (group.length < 2) continue;
    const transitionalReplacement = attention.some((entry) => {
      if (!entry.replacementAttachmentId) return false;
      const transitional = new Set([
        ...(entry.attachmentIds ?? []),
        ...(entry.oldAttachmentIds ?? []),
      ]);
      return group.every((item) => transitional.has(item.id));
    });
    const first = group[0]!;
    const repeatedImmutableSnapshot = group.every(
      (item) =>
        item.taskId === first.taskId &&
        item.sessionId === first.sessionId &&
        item.filename === first.filename &&
        item.mimeType === first.mimeType &&
        item.size === first.size &&
        item.sha256 === first.sha256 &&
        item.status === first.status,
    );
    if (!transitionalReplacement && !repeatedImmutableSnapshot)
      throw new Error("Persisted attachment filenames are conflicting.");
  }
  const taskIds = new Set(
    attachments.flatMap((item) => (item.taskId ? [item.taskId] : [])),
  );
  for (const taskId of taskIds) {
    const taskItems = attachments.filter((item) => item.taskId === taskId);
    const replacements = attention.filter(
      (entry) =>
        entry.taskId === taskId &&
        entry.replacementAttachmentId &&
        entry.status !== "cleanup_required",
    );
    const stagedIds = new Set(
      replacements.flatMap((entry) => [...(entry.attachmentIds ?? [])]),
    );
    const authoritative = taskItems.filter((item) => !stagedIds.has(item.id));
    const candidates = replacements.map((entry) => [
      ...authoritative.filter(
        (item) => !(entry.oldAttachmentIds ?? []).includes(item.id),
      ),
      ...taskItems.filter((item) => entry.attachmentIds?.includes(item.id)),
    ]);
    for (const generation of [authoritative, ...candidates])
      if (
        generation.length > MAX_TASK_ATTACHMENTS ||
        generation.reduce((total, item) => total + item.size, 0) >
          MAX_TASK_ATTACHMENT_BYTES
      )
        throw new Error("Persisted attachment generation exceeds its bound.");
  }
  if (
    new Set(attention.map((entry) => entry.requestId)).size !==
      attention.length ||
    new Set(
      attention
        .filter((entry) =>
          [
            "waiting",
            "selecting",
            "materializing",
            "reconciliation_required",
            "cleanup_required",
          ].includes(entry.status),
        )
        .map((entry) => `${entry.taskId}\0${entry.sessionId}`),
    ).size !==
      attention.filter((entry) =>
        [
          "waiting",
          "selecting",
          "materializing",
          "reconciliation_required",
          "cleanup_required",
        ].includes(entry.status),
      ).length
  )
    throw new Error("Persisted file attention identities are conflicting.");
  return { version: MANIFEST_VERSION, attachments, attention };
}
