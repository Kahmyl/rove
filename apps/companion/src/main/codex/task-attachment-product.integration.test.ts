import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { CompanionRuntimeClient } from "../runtime-client.js";
import { TaskAttachmentAuthority } from "./task-attachments.js";

it("runs the deterministic 74-byte product-boundary attachment journey and cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "rove-attachment-product-"));
  const fixtureBytes = Buffer.alloc(74, "R");
  const picker = vi.fn(async () => [
    {
      filename: "/private/fixture/semantic-upload.txt",
      mimeType: "application/octet-stream",
      bytes: fixtureBytes,
    },
  ]);
  const uploaded: { url: string; init?: RequestInit }[] = [];
  const runtime = new CompanionRuntimeClient({
    baseUrl: "http://127.0.0.1:47820",
    token: "runtime-secret",
    fetchImpl: vi.fn(async (input, init) => {
      uploaded.push({ url: String(input), init });
      if (init?.method === "DELETE")
        return new Response(
          JSON.stringify({
            sessionId: "ses_semantic",
            grantId: new URL(String(input)).pathname.split("/").at(-1),
            deleted: 1,
          }),
          { status: 200 },
        );
      if (init?.method === undefined)
        return new Response(JSON.stringify([]), { status: 200 });
      return new Response(
        JSON.stringify({
          id: "ev_semantic_fixture",
          sessionId: "ses_semantic",
          type: "file",
          label: "semantic-upload.txt",
          createdAt: "2026-09-08T00:00:00.000Z",
          metadata: {
            filename: "semantic-upload.txt",
            mimeType: "text/plain",
            sizeBytes: 74,
            sha256:
              "ea1d77794de44efce3b4027d7599fbc688e9f55206cb562834b3244e36ab9431",
            source: "user_file_grant",
            grantId: (init?.headers as Record<string, string>)[
              "x-rove-grant-id"
            ],
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  });
  const authority = new TaskAttachmentAuthority(root, { select: picker });
  await authority.restore();

  const selected = await authority.selectDrafts();
  expect(selected.attachments).toMatchObject([
    { filename: "semantic-upload.txt", size: 74, status: "ready" },
  ]);
  const [bound] = await authority.bindDrafts(
    [selected.attachments[0]!.id],
    "task_semantic",
    "ses_semantic",
    runtime,
  );
  expect(bound).toMatchObject({
    evidenceId: "ev_semantic_fixture",
    taskId: "task_semantic",
    sessionId: "ses_semantic",
    status: "bound",
  });
  const upload = uploaded.find((request) => request.init?.method === "POST")!;
  expect(Buffer.from(upload.init!.body as Uint8Array)).toHaveLength(74);
  expect(upload.init!.headers).toMatchObject({
    "x-rove-task-id": "task_semantic",
    "x-rove-file-source": "user_file_grant",
  });
  const instructions = authority.instructions("task_semantic", "ses_semantic");
  expect(instructions).toContain("ev_semantic_fixture");
  expect(instructions).not.toContain("/private/fixture");

  await authority.cleanupTask("task_semantic");
  expect(authority.listForTask("task_semantic")).toEqual([]);
  const persisted = await readFile(join(root, "manifest.v2.json"), "utf8");
  expect(persisted).not.toContain("semantic-upload.txt");
  expect(persisted).not.toContain("/private/fixture");
});
