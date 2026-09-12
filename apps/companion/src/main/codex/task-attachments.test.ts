import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { MAX_GRANTED_FILE_BYTES } from "@rove/protocol";

import {
  MAX_TASK_ATTACHMENT_BYTES,
  MAX_TASK_ATTACHMENTS,
  safeFilename,
  safeMimeType,
  TaskAttachmentAuthority,
  type AttachmentRuntimeMaterializer,
  type UserFilePicker,
} from "./task-attachments.js";

const textFile = (filename: string, content: string) => ({
  filename,
  mimeType: "application/octet-stream",
  bytes: Buffer.from(content),
});

async function fixture(
  answers: Array<Awaited<ReturnType<UserFilePicker["select"]>>>,
) {
  const root = await mkdtemp(join(tmpdir(), "rove-attachments-"));
  const select = vi.fn(async () => answers.shift() ?? null);
  return {
    root,
    select,
    authority: new TaskAttachmentAuthority(
      root,
      { select },
      {
        maxFiles: 3,
        maxFileBytes: 8,
        maxTaskBytes: 12,
      },
    ),
  };
}

describe("TaskAttachmentAuthority", () => {
  it("snapshots selected bytes and exposes only safe metadata", async () => {
    const { authority, root } = await fixture([
      [textFile("/private/tmp/secret.txt", "hello")],
    ]);
    await authority.restore();
    const result = await authority.selectDrafts();
    expect(result.status).toBe("selected");
    expect(result.attachments[0]).toMatchObject({
      filename: "secret.txt",
      mimeType: "text/plain",
      size: 5,
      status: "ready",
    });
    expect(JSON.stringify(result)).not.toContain("/private/tmp");
    expect(
      await readFile(join(root, "manifest.v2.json"), "utf8"),
    ).not.toContain("/private/tmp");
  });

  it("handles picker cancellation without creating authority", async () => {
    const { authority } = await fixture([null]);
    await authority.restore();
    await expect(authority.selectDrafts()).resolves.toEqual({
      status: "cancelled",
      attachments: [],
    });
    expect(authority.listDrafts()).toEqual([]);
  });

  it("removes uncommitted blob and temporary files when no manifest exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-attachments-orphan-"));
    await writeFile(join(root, "orphan.bin"), "orphan");
    await writeFile(join(root, "manifest.v2.json.tmp"), "partial");
    const authority = new TaskAttachmentAuthority(root, {
      select: async () => null,
    });
    await authority.restore();
    await expect(readFile(join(root, "orphan.bin"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(root, "manifest.v2.json.tmp")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the prior manifest and blob when removal persistence fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-attachments-remove-cut-"));
    let armed = false;
    const authority = new TaskAttachmentAuthority(
      root,
      { select: async () => [textFile("keep.txt", "keep")] },
      undefined,
      (point) => {
        if (armed && point === "after_manifest_write")
          throw new Error("manifest cut");
      },
    );
    await authority.restore();
    const selected = await authority.selectDrafts();
    armed = true;
    await expect(
      authority.removeDraft(selected.attachments[0]!.id),
    ).rejects.toThrow("manifest cut");
    expect(authority.listDrafts()).toHaveLength(1);

    const recovered = new TaskAttachmentAuthority(root, {
      select: async () => null,
    });
    await recovered.restore();
    expect(recovered.listDrafts()).toMatchObject([
      { filename: "keep.txt", status: "ready" },
    ]);
  });

  it("enforces file count, per-file, aggregate, and duplicate-name limits", async () => {
    const count = await fixture([
      [
        textFile("a", "1"),
        textFile("b", "2"),
        textFile("c", "3"),
        textFile("d", "4"),
      ],
    ]);
    await expect(count.authority.selectDrafts()).rejects.toThrow(
      "between 1 and 3",
    );

    const size = await fixture([[textFile("large", "123456789")]]);
    await expect(size.authority.selectDrafts()).rejects.toThrow("per-file");

    const aggregate = await fixture([
      [textFile("a", "1234567"), textFile("b", "123456")],
    ]);
    await expect(aggregate.authority.selectDrafts()).rejects.toThrow(
      "aggregate",
    );

    const duplicate = await fixture([
      [textFile("/a/report.txt", "one"), textFile("/b/report.txt", "two")],
    ]);
    await expect(duplicate.authority.selectDrafts()).rejects.toThrow("unique");
  });

  it("serializes duplicate-name admission so concurrent selections cannot corrupt persistence", async () => {
    const { authority, root } = await fixture([
      [textFile("same.txt", "one")],
      [textFile("same.txt", "one")],
    ]);
    await authority.restore();

    const results = await Promise.allSettled([
      authority.selectDrafts(),
      authority.selectDrafts(),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(authority.listDrafts()).toHaveLength(1);

    const restored = new TaskAttachmentAuthority(root, {
      select: async () => null,
    });
    await expect(restored.restore()).resolves.toBeUndefined();
    expect(restored.listDrafts()).toHaveLength(1);
  });

  it("binds immutable bytes to one task/session and injects opaque evidence IDs", async () => {
    const { authority } = await fixture([[textFile("upload.txt", "74byte")]]);
    const selected = await authority.selectDrafts();
    const materializeUserFile = vi.fn(async (input) => ({
      id: "ev_attachment",
      sessionId: input.sessionId,
      type: "file" as const,
      label: input.filename,
      createdAt: "2026-09-08T00:00:00.000Z",
      metadata: {
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.byteLength,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
        source: "user_file_grant",
        grantId: input.grantId,
      },
    }));
    const [bound] = await authority.bindDrafts(
      [selected.attachments[0]!.id],
      "task_a",
      "ses_a",
      { materializeUserFile },
    );
    expect(bound).toMatchObject({
      taskId: "task_a",
      sessionId: "ses_a",
      evidenceId: "ev_attachment",
      status: "bound",
    });
    expect(materializeUserFile).toHaveBeenCalledTimes(1);
    await authority.bindDrafts(
      [selected.attachments[0]!.id],
      "task_a",
      "ses_a",
      { materializeUserFile },
    );
    expect(materializeUserFile).toHaveBeenCalledTimes(1);
    const instructions = authority.instructions("task_a", "ses_a");
    expect(instructions).toContain("ev_attachment");
    expect(instructions).toContain("upload.txt");
    expect(instructions).not.toContain("/tmp");
    await expect(
      authority.bindDrafts([selected.attachments[0]!.id], "task_b", "ses_b", {
        materializeUserFile,
      }),
    ).rejects.toThrow("Unknown or conflicting");
  });

  it("projects every bound attachment into the protected Codex task workspace", async () => {
    const { authority } = await fixture([
      [textFile("one.txt", "one"), textFile("two.txt", "two")],
    ]);
    const selected = await authority.selectDrafts();
    const materializeUserFile = vi.fn(async (input) => ({
      id: `ev_${input.filename}`,
      sessionId: input.sessionId,
      type: "file" as const,
      label: input.filename,
      createdAt: "2026-09-12T00:00:00.000Z",
      metadata: {
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.byteLength,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
        source: "user_file_grant",
        grantId: input.grantId,
      },
    }));
    await authority.bindDrafts(
      selected.attachments.map((attachment) => attachment.id),
      "task_inputs",
      "ses_inputs",
      { materializeUserFile },
    );
    const workspace = await mkdtemp(join(tmpdir(), "rove-task-inputs-"));
    const inputs = await authority.materializeCodexInputs(
      selected.attachments.map((attachment) => attachment.id),
      "task_inputs",
      "ses_inputs",
      workspace,
    );
    expect(inputs.map((input) => input.filename)).toEqual([
      "one.txt",
      "two.txt",
    ]);
    await expect(readFile(inputs[0]!.path, "utf8")).resolves.toBe("one");
    await expect(readFile(inputs[1]!.path, "utf8")).resolves.toBe("two");
  });

  it("returns verified image bytes only for the matching bound task", async () => {
    const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const { authority } = await fixture([
      [
        {
          filename: "reference.png",
          mimeType: "image/png",
          bytes: imageBytes,
        },
      ],
    ]);
    const selected = await authority.selectDrafts();
    await authority.bindDrafts(
      [selected.attachments[0]!.id],
      "task_preview",
      "ses_preview",
      {
        materializeUserFile: async (input) => ({
          id: "ev_preview",
          sessionId: input.sessionId,
          type: "file",
          label: input.filename,
          createdAt: "2026-09-12T00:00:00.000Z",
          metadata: {
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.bytes.byteLength,
            sha256: createHash("sha256").update(input.bytes).digest("hex"),
            source: "user_file_grant",
            grantId: input.grantId,
          },
        }),
      },
    );
    await expect(
      authority.readImagePreview("task_preview", "reference.png"),
    ).resolves.toMatchObject({
      mimeType: "image/png",
      bytes: imageBytes,
    });
    await expect(
      authority.readImagePreview("task_other", "reference.png"),
    ).resolves.toBeNull();
  });

  it("recovers an acknowledged Runtime upload after a manifest crash cut without duplication", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-attachments-cut-"));
    let cut = true;
    const first = new TaskAttachmentAuthority(
      root,
      { select: async () => [textFile("upload.txt", "bytes")] },
      undefined,
      (point) => {
        if (point === "after_runtime_materialize" && cut) {
          cut = false;
          throw new Error("crash cut");
        }
      },
    );
    await first.restore();
    const selected = await first.selectDrafts();
    const evidence: Array<{
      id: string;
      sessionId: string;
      type: "file";
      label: string;
      createdAt: string;
      metadata: Record<string, unknown>;
    }> = [];
    const runtime = {
      materializeUserFile: vi.fn(async (input) => {
        const item = {
          id: "ev_recovered",
          sessionId: input.sessionId,
          type: "file" as const,
          label: input.filename,
          createdAt: "2026-09-08T00:00:00.000Z",
          metadata: {
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.bytes.byteLength,
            sha256: createHash("sha256").update(input.bytes).digest("hex"),
            source: "user_file_grant",
            grantId: input.grantId,
          },
        };
        evidence.push(item);
        return item;
      }),
      listEvidence: vi.fn(async () => evidence),
      cleanupUserFileGrant: vi.fn(async () => undefined),
    };
    await expect(
      first.bindDrafts(
        [selected.attachments[0]!.id],
        "task_recovery",
        "ses_recovery",
        runtime,
      ),
    ).rejects.toThrow("crash cut");

    const recovered = new TaskAttachmentAuthority(root, {
      select: async () => null,
    });
    await recovered.restore();
    await expect(
      recovered.bindDrafts(
        [selected.attachments[0]!.id],
        "task_recovery",
        "ses_recovery",
        runtime,
      ),
    ).resolves.toMatchObject([{ evidenceId: "ev_recovered", status: "bound" }]);
    expect(runtime.materializeUserFile).toHaveBeenCalledTimes(1);
  });

  it("requires explicit reselection to replace an unavailable task snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-attachments-reselect-"));
    const answers = [
      [textFile("old.txt", "old")],
      [textFile("new.txt", "new")],
    ];
    const picker = { select: vi.fn(async () => answers.shift() ?? null) };
    let evidence: Awaited<
      ReturnType<AttachmentRuntimeMaterializer["materializeUserFile"]>
    >[] = [];
    const runtime: AttachmentRuntimeMaterializer = {
      materializeUserFile: vi.fn(async (input) => {
        const item = {
          id: `ev_${evidence.length + 1}`,
          sessionId: input.sessionId,
          type: "file" as const,
          label: input.filename,
          createdAt: "2026-09-08T00:00:00.000Z",
          metadata: {
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.bytes.byteLength,
            sha256: createHash("sha256").update(input.bytes).digest("hex"),
            source: "user_file_grant" as const,
            grantId: input.grantId,
          },
        };
        evidence.push(item);
        return item;
      }),
      listEvidence: vi.fn(async () => evidence),
      cleanupUserFileGrant: vi.fn(async (_sessionId, grantId) => {
        evidence = evidence.filter(
          (item) => item.metadata?.grantId !== grantId,
        );
      }),
    };
    const authority = new TaskAttachmentAuthority(root, picker);
    await authority.restore();
    const selected = await authority.selectDrafts();
    await authority.bindDrafts(
      [selected.attachments[0]!.id],
      "task_reselect",
      "ses_reselect",
      runtime,
    );
    await writeFile(join(root, `${selected.attachments[0]!.id}.bin`), "bad");

    const restored = new TaskAttachmentAuthority(root, picker);
    await restored.restore();
    expect(restored.listForTask("task_reselect")[0]?.status).toBe(
      "unavailable",
    );
    await expect(
      restored.reselectTaskAttachment(
        selected.attachments[0]!.id,
        "task_reselect",
        "ses_reselect",
        runtime,
      ),
    ).resolves.toMatchObject({ filename: "new.txt", status: "bound" });
    expect(runtime.cleanupUserFileGrant).toHaveBeenCalledTimes(1);
    expect(evidence).toMatchObject([{ label: "new.txt" }]);
  });

  it("commits a complete multi-file replacement grant before retiring the old grant and resumes cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-attachments-reselect-tx-"));
    const answers = [
      [textFile("old.txt", "old"), textFile("peer.txt", "peer")],
      [textFile("new.txt", "new")],
    ];
    const picker = { select: vi.fn(async () => answers.shift() ?? null) };
    const evidence: Awaited<
      ReturnType<AttachmentRuntimeMaterializer["materializeUserFile"]>
    >[] = [];
    const events: string[] = [];
    let oldGrant = "";
    let rejectOldCleanup = true;
    const runtime: AttachmentRuntimeMaterializer = {
      materializeUserFile: vi.fn(async (input) => {
        events.push(`upload:${input.grantId}:${input.filename}`);
        const item = {
          id: `ev_${evidence.length + 1}`,
          sessionId: input.sessionId,
          type: "file" as const,
          label: input.filename,
          createdAt: "2026-09-09T00:00:00.000Z",
          metadata: {
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.bytes.byteLength,
            sha256: createHash("sha256").update(input.bytes).digest("hex"),
            source: "user_file_grant" as const,
            grantId: input.grantId,
          },
        };
        evidence.push(item);
        return item;
      }),
      listEvidence: vi.fn(async () => evidence),
      cleanupUserFileGrant: vi.fn(async (_sessionId, grantId) => {
        events.push(`cleanup:${grantId}`);
        if (grantId === oldGrant && rejectOldCleanup) {
          rejectOldCleanup = false;
          throw new Error("cleanup cut");
        }
        for (let index = evidence.length - 1; index >= 0; index -= 1)
          if (evidence[index]?.metadata?.grantId === grantId)
            evidence.splice(index, 1);
      }),
    };
    const authority = new TaskAttachmentAuthority(root, picker);
    await authority.restore();
    const selected = await authority.selectDrafts();
    await authority.bindDrafts(
      selected.attachments.map((item) => item.id),
      "task_reselect_tx",
      "ses_reselect_tx",
      runtime,
    );
    oldGrant = String(evidence[0]?.metadata?.grantId);
    await writeFile(join(root, `${selected.attachments[0]!.id}.bin`), "bad");
    const restored = new TaskAttachmentAuthority(root, picker);
    await restored.restore();
    await expect(
      restored.reselectTaskAttachment(
        selected.attachments[0]!.id,
        "task_reselect_tx",
        "ses_reselect_tx",
        runtime,
      ),
    ).rejects.toThrow("cleanup cut");
    const cleanupIndex = events.indexOf(`cleanup:${oldGrant}`);
    expect(
      events
        .slice(0, cleanupIndex)
        .filter((event) => event.startsWith("upload:")),
    ).toHaveLength(4);
    expect(restored.listForTask("task_reselect_tx")).toMatchObject([
      { filename: "new.txt", status: "bound" },
      { filename: "peer.txt", status: "bound" },
    ]);
    expect(restored.listAttention()).toMatchObject([
      { status: "cleanup_required", oldGrantId: oldGrant },
    ]);

    const afterRestart = new TaskAttachmentAuthority(root, {
      select: async () => null,
    });
    await afterRestart.restore();
    const [attention] = afterRestart.listAttention();
    await afterRestart.reconcileMidTask(
      {
        requestId: attention!.requestId,
        taskId: attention!.taskId,
        sessionId: attention!.sessionId,
      },
      runtime,
      "retry",
    );
    expect(afterRestart.listAttention()).toEqual([]);
    expect(evidence.map((item) => item.label).sort()).toEqual([
      "new.txt",
      "peer.txt",
    ]);
  });

  it("resumes a mid-task grant exactly once and rejects stale identities", async () => {
    const { authority, select } = await fixture([
      [textFile("picked.txt", "ok")],
    ]);
    const result = authority.requestMidTask({
      requestId: "file_request_a",
      taskId: "task_a",
      sessionId: "ses_a",
      reason: "Choose the upload",
      allowMultiple: false,
    });
    expect(authority.listAttention()).toMatchObject([
      { status: "waiting", taskId: "task_a", sessionId: "ses_a" },
    ]);
    await expect(
      authority.selectPending({
        requestId: "file_request_a",
        taskId: "task_wrong",
        sessionId: "ses_a",
      }),
    ).rejects.toThrow("Stale or mismatched");
    await authority.selectPending({
      requestId: "file_request_a",
      taskId: "task_a",
      sessionId: "ses_a",
    });
    const grantedResult = await result;
    const granted = grantedResult![0];
    expect(granted).toMatchObject({
      filename: "picked.txt",
      attachmentId: expect.stringMatching(/^att_/),
    });
    await authority.completeMidTask("ses_a", [
      { attachmentId: granted!.attachmentId!, evidenceId: "ev_midtask" },
    ]);
    expect(authority.listForTask("task_a")).toMatchObject([
      { status: "bound", evidenceId: "ev_midtask" },
    ]);
    expect(select).toHaveBeenCalledTimes(1);
    await expect(
      authority.selectPending({
        requestId: "file_request_a",
        taskId: "task_a",
        sessionId: "ses_a",
      }),
    ).rejects.toThrow("Stale or mismatched");
  });

  it("keeps a selected mid-task grant visible and reconciles it after restart without duplicate upload", async () => {
    const { authority, root } = await fixture([[textFile("picked.txt", "ok")]]);
    const grant = authority.requestMidTask({
      requestId: "file_request_daab1e",
      taskId: "task_durable",
      sessionId: "ses_durable",
      reason: "Choose durable evidence",
      allowMultiple: false,
    });
    await authority.selectPending({
      requestId: "file_request_daab1e",
      taskId: "task_durable",
      sessionId: "ses_durable",
    });
    const [selected] = (await grant)!;
    expect(authority.listAttention()).toMatchObject([
      {
        status: "materializing",
        grantId: selected!.grantId,
        attachmentIds: [selected!.attachmentId],
      },
    ]);
    const evidence: Awaited<
      ReturnType<AttachmentRuntimeMaterializer["materializeUserFile"]>
    >[] = [];
    const runtime: AttachmentRuntimeMaterializer = {
      materializeUserFile: vi.fn(async (input) => {
        const item = {
          id: "ev_durable",
          sessionId: input.sessionId,
          type: "file" as const,
          label: input.filename,
          createdAt: "2026-09-09T00:00:00.000Z",
          metadata: {
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.bytes.byteLength,
            sha256: createHash("sha256").update(input.bytes).digest("hex"),
            source: "user_file_grant" as const,
            grantId: input.grantId,
          },
        };
        evidence.push(item);
        return item;
      }),
      listEvidence: vi.fn(async () => evidence),
      cleanupUserFileGrant: vi.fn(async () => undefined),
    };
    await runtime.materializeUserFile({
      taskId: "task_durable",
      sessionId: "ses_durable",
      grantId: selected!.grantId!,
      filename: selected!.filename,
      mimeType: selected!.mimeType,
      bytes: selected!.bytes,
    });
    const restarted = new TaskAttachmentAuthority(root, {
      select: async () => null,
    });
    await restarted.restore();
    expect(restarted.listAttention()).toMatchObject([
      { status: "reconciliation_required" },
    ]);
    await restarted.reconcileMidTask(
      {
        requestId: "file_request_daab1e",
        taskId: "task_durable",
        sessionId: "ses_durable",
      },
      runtime,
      "retry",
    );
    expect(runtime.materializeUserFile).toHaveBeenCalledTimes(1);
    expect(restarted.listAttention()).toEqual([]);
    expect(restarted.listForTask("task_durable")).toMatchObject([
      { status: "bound", evidenceId: "ev_durable" },
    ]);
  });

  it("cancels pending requests and deletes task bytes on cleanup", async () => {
    const { authority, root } = await fixture([[textFile("picked.txt", "ok")]]);
    const selected = await authority.selectDrafts();
    await authority.bindDrafts(
      [selected.attachments[0]!.id],
      "task_a",
      "ses_a",
      {
        materializeUserFile: async (input) => ({
          id: "ev_a",
          sessionId: "ses_a",
          type: "file",
          label: input.filename,
          createdAt: "2026-09-08T00:00:00.000Z",
          metadata: {
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.bytes.byteLength,
            sha256: createHash("sha256").update(input.bytes).digest("hex"),
            source: "user_file_grant",
            grantId: input.grantId,
          },
        }),
      },
    );
    const grant = authority.requestMidTask({
      requestId: "file_request_b",
      taskId: "task_a",
      sessionId: "ses_a",
      reason: "Another file",
      allowMultiple: true,
    });
    await authority.cleanupTask("task_a");
    await expect(grant).resolves.toBeNull();
    expect(authority.listForTask("task_a")).toEqual([]);
    expect(
      await readFile(join(root, "manifest.v2.json"), "utf8"),
    ).not.toContain("picked.txt");
  });

  it("persists a redacted visible failure that can be explicitly dismissed", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-attachments-"));
    const authority = new TaskAttachmentAuthority(root, {
      select: async () => {
        throw new Error("Cannot read /Users/person/private.txt");
      },
    });
    const grant = authority.requestMidTask({
      requestId: "file_request_failed",
      taskId: "task_a",
      sessionId: "ses_a",
      reason: "Choose a file",
      allowMultiple: false,
    });
    const grantRejection = grant.catch((error: unknown) => error);
    const selecting = authority.selectPending({
      requestId: "file_request_failed",
      taskId: "task_a",
      sessionId: "ses_a",
    });
    await expect(selecting).rejects.toThrow("File selection failed");
    await expect(grantRejection).resolves.toMatchObject({
      message: "File selection failed.",
    });
    expect(JSON.stringify(authority.listAttention())).not.toContain(
      "/Users/person",
    );
    await authority.cancelPending({
      requestId: "file_request_failed",
      taskId: "task_a",
      sessionId: "ses_a",
    });
    expect(authority.listAttention()).toEqual([]);
  });

  it("fails closed on corrupt bytes and unsupported manifest versions", async () => {
    const { authority, root } = await fixture([[textFile("picked.txt", "ok")]]);
    const selected = await authority.selectDrafts();
    await writeFile(
      join(root, `${selected.attachments[0]!.id}.bin`),
      "tampered",
    );
    const restored = new TaskAttachmentAuthority(root, {
      select: async () => null,
    });
    await restored.restore();
    expect(restored.listDrafts()[0]?.status).toBe("unavailable");

    await writeFile(
      join(root, "manifest.v2.json"),
      JSON.stringify({ version: 3, attachments: [], attention: [] }),
    );
    await expect(
      new TaskAttachmentAuthority(root, { select: async () => null }).restore(),
    ).rejects.toThrow("Unsupported attachment manifest version");
  });

  it("restores byte-identical historical duplicates without weakening same-name conflict checks", async () => {
    const root = await mkdtemp(join(tmpdir(), "rove-attachments-repeated-"));
    const bytes = Buffer.from("same immutable input");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const attachments = [
      {
        id: `att_${"1".repeat(32)}`,
        filename: "repeated.txt",
        mimeType: "text/plain",
        size: bytes.byteLength,
        sha256,
        status: "bound",
        taskId: "task_repeated",
        sessionId: "ses_repeated",
        evidenceId: "ev_first",
        blobName: `att_${"1".repeat(32)}.bin`,
        grantId: `grant_${"1".repeat(32)}`,
      },
      {
        id: `att_${"2".repeat(32)}`,
        filename: "repeated.txt",
        mimeType: "text/plain",
        size: bytes.byteLength,
        sha256,
        status: "bound",
        taskId: "task_repeated",
        sessionId: "ses_repeated",
        evidenceId: "ev_latest",
        blobName: `att_${"2".repeat(32)}.bin`,
        grantId: `grant_${"2".repeat(32)}`,
      },
    ];
    await writeFile(join(root, attachments[0]!.blobName), bytes);
    await writeFile(join(root, attachments[1]!.blobName), bytes);
    await writeFile(
      join(root, "manifest.v2.json"),
      JSON.stringify({ version: 2, attachments, attention: [] }),
    );

    const restored = new TaskAttachmentAuthority(root, {
      select: async () => null,
    });
    await expect(restored.restore()).resolves.toBeUndefined();
    expect(restored.listForTask("task_repeated")).toHaveLength(2);
    expect(restored.instructions("task_repeated", "ses_repeated")).toContain(
      "ev_latest",
    );
    expect(
      restored.instructions("task_repeated", "ses_repeated"),
    ).not.toContain("ev_first");

    const conflicting = attachments.map((attachment, index) =>
      index === 0 ? attachment : { ...attachment, sha256: "f".repeat(64) },
    );
    await writeFile(
      join(root, "manifest.v2.json"),
      JSON.stringify({ version: 2, attachments: conflicting, attention: [] }),
    );
    await expect(
      new TaskAttachmentAuthority(root, { select: async () => null }).restore(),
    ).rejects.toThrow("filenames are conflicting");
  });
});

describe("attachment metadata", () => {
  it("freezes the production file and aggregate limits", () => {
    expect(MAX_TASK_ATTACHMENTS).toBe(100);
    expect(MAX_GRANTED_FILE_BYTES).toBe(64 * 1024 * 1024);
    expect(MAX_TASK_ATTACHMENT_BYTES).toBe(128 * 1024 * 1024);
  });

  it("normalizes leaves and sniffs trusted content signatures", () => {
    expect(safeFilename("C:\\secret\\report.pdf")).toBe("report.pdf");
    expect(safeMimeType("text/plain", Buffer.from("%PDF-1.7"))).toBe(
      "application/pdf",
    );
    expect(safeMimeType("bad mime", Uint8Array.from([0, 1, 2]))).toBe(
      "application/octet-stream",
    );
  });
});
