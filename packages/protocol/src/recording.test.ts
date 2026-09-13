import { describe, expect, it } from "vitest";
import { recordingSchema, startRecordingRequestSchema } from "./recording.js";

const base = {
  schemaVersion: 1 as const,
  id: `rec_${"a".repeat(32)}`,
  taskId: "task_exact",
  sessionId: `ses_${"b".repeat(32)}`,
  mode: "agent" as const,
  scope: {
    kind: "page" as const,
    pageId: `page_${"c".repeat(32)}`,
    url: "https://example.test/",
  },
  sensitiveDataPolicy: "user_confirmed_visible_content" as const,
  includesAudio: false as const,
  coverage: "Selected page content.",
  exclusions: ["Other tabs"],
  requestedAt: "2026-09-13T12:00:00.000Z",
  updatedAt: "2026-09-13T12:00:00.000Z",
};

describe("recording protocol", () => {
  it("requires explicit acknowledgement for both recording scopes", () => {
    expect(() =>
      startRecordingRequestSchema.parse({
        scope: "page",
        taskId: "task_exact",
        sensitiveDataPolicy: "user_confirmed_visible_content",
        confirmUnmaskedSensitiveContent: false,
      }),
    ).toThrow();
    expect(
      startRecordingRequestSchema.parse({
        scope: "browser_window",
        taskId: "task_exact",
        sensitiveDataPolicy: "user_confirmed_visible_content",
        confirmUnmaskedSensitiveContent: true,
      }),
    ).toMatchObject({ scope: "browser_window" });
  });

  it("rejects false availability and dishonest artifact state", () => {
    expect(() =>
      recordingSchema.parse({ ...base, state: "available" }),
    ).toThrow("start timestamp");
    expect(() =>
      recordingSchema.parse({
        ...base,
        state: "available",
        startedAt: "2026-09-13T12:00:01.000Z",
        artifact: {
          artifactId: base.id,
          filename: `${base.id}.partial.webm`,
          mimeType: "video/webm",
          sizeBytes: 256,
          sha256: "d".repeat(64),
          playable: false,
          partial: true,
        },
      }),
    ).toThrow("playable artifact");
  });

  it("requires a typed failure only in failed state", () => {
    expect(() => recordingSchema.parse({ ...base, state: "failed" })).toThrow(
      "failure reason",
    );
    expect(() =>
      recordingSchema.parse({
        ...base,
        state: "requested",
        failure: { code: "CAPTURE_INTERRUPTED", message: "Interrupted." },
      }),
    ).toThrow("Only failed");
  });
});
