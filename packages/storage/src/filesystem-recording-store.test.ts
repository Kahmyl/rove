import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Recording } from "@rove/protocol";

import { FileRecordingStore } from "./filesystem-recording-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rove-recording-store-test-"));
  roots.push(root);
  return { root, store: new FileRecordingStore(root) };
}

function requested(): Recording {
  return {
    schemaVersion: 1,
    id: `rec_${"a".repeat(32)}`,
    taskId: "task_recording",
    sessionId: `ses_${"b".repeat(32)}`,
    mode: "capture",
    state: "requested",
    scope: {
      kind: "page",
      pageId: `page_${"c".repeat(32)}`,
      url: "https://example.test/work",
    },
    sensitiveDataPolicy: "user_confirmed_visible_content",
    includesAudio: false,
    coverage: "Only the selected page content.",
    exclusions: ["Browser chrome", "Other tabs", "Popups", "Native dialogs"],
    requestedAt: "2026-09-13T12:00:00.000Z",
    updatedAt: "2026-09-13T12:00:00.000Z",
  };
}

describe("FileRecordingStore", () => {
  it("persists task-session recording state across replacement", async () => {
    const { root, store } = await fixture();
    let recording = await store.create(requested());
    recording = await store.update(
      recording.sessionId,
      recording.id,
      "requested",
      {
        ...recording,
        state: "recording",
        startedAt: "2026-09-13T12:00:01.000Z",
        updatedAt: "2026-09-13T12:00:01.000Z",
      },
    );

    await expect(
      new FileRecordingStore(root).list(recording.sessionId),
    ).resolves.toEqual([recording]);
    await expect(
      new FileRecordingStore(root).stagingPath(
        recording.sessionId,
        recording.id,
      ),
    ).resolves.toMatch(
      /\/recordings\/staging\/rec_[a-f0-9]{32}\.partial\.webm$/u,
    );
  });

  it("keeps identity and terminal recording facts immutable", async () => {
    const { store } = await fixture();
    let recording = await store.create(requested());
    await expect(
      store.update(recording.sessionId, recording.id, "requested", {
        ...recording,
        sessionId: `ses_${"d".repeat(32)}`,
        state: "failed",
        failure: {
          code: "SOURCE_UNAVAILABLE",
          message: "The page is unavailable.",
        },
      }),
    ).rejects.toThrow("transition is invalid");

    recording = await store.update(
      recording.sessionId,
      recording.id,
      "requested",
      {
        ...recording,
        state: "failed",
        updatedAt: "2026-09-13T12:00:01.000Z",
        failure: {
          code: "PERMISSION_REFUSED",
          message: "Recording permission was refused.",
        },
      },
    );
    await expect(
      store.update(recording.sessionId, recording.id, "failed", {
        ...recording,
        state: "requested",
        failure: undefined,
      }),
    ).rejects.toThrow("transition is invalid");
  });

  it("rejects cross-session reads and unsafe identifiers", async () => {
    const { store } = await fixture();
    const recording = await store.create(requested());
    await expect(
      store.get(`ses_${"d".repeat(32)}`, recording.id),
    ).resolves.toBeNull();
    await expect(
      store.get(recording.sessionId, "../recording"),
    ).rejects.toThrow("Invalid recording ID");
  });

  it("admits only one concurrent transition from the expected state", async () => {
    const { store } = await fixture();
    const recording = await store.create(requested());
    const next = {
      ...recording,
      state: "recording" as const,
      startedAt: "2026-09-13T12:00:01.000Z",
      updatedAt: "2026-09-13T12:00:01.000Z",
    };
    const outcomes = await Promise.allSettled([
      store.update(recording.sessionId, recording.id, "requested", next),
      store.update(recording.sessionId, recording.id, "requested", next),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
  });

  it("finalizes a validated WebM signature by atomic rename and digest", async () => {
    const { store } = await fixture();
    const recording = await store.create(requested());
    const staging = await store.stagingPath(recording.sessionId, recording.id);
    const bytes = Buffer.alloc(256, 0);
    bytes.set(Buffer.from("1a45dfa3", "hex"), 0);
    await writeFile(staging, bytes);

    const artifact = await store.finalizeArtifact(
      recording.sessionId,
      recording.id,
    );
    expect(artifact).toMatchObject({
      artifactId: recording.id,
      mimeType: "video/webm",
      sizeBytes: 256,
      playable: true,
      partial: false,
    });
    await expect(readFile(staging)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(
        await store.artifactPath(recording.sessionId, recording.id, false),
      ),
    ).resolves.toEqual(bytes);
  });

  it("keeps coverage and exclusions immutable", async () => {
    const { store } = await fixture();
    const recording = await store.create(requested());
    await expect(
      store.update(recording.sessionId, recording.id, "requested", {
        ...recording,
        state: "failed",
        coverage: "The entire browser window.",
        failure: { code: "SOURCE_UNAVAILABLE", message: "Unavailable." },
      }),
    ).rejects.toThrow("transition is invalid");
  });
});
