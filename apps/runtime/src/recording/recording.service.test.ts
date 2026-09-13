import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileRecordingStore } from "@rove/storage";
import type { SessionMode } from "@rove/protocol";
import { RecordingService } from "./recording.service.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function harness(
  mode: SessionMode,
  sensitive = false,
  observationFailure = false,
) {
  const root = await mkdtemp(join(tmpdir(), "rove-recording-service-test-"));
  roots.push(root);
  const store = new FileRecordingStore(root);
  const sessionId = `ses_${mode}_${"a".repeat(24)}`;
  let stagingPath = "";
  const browser = {
    pages: vi.fn(async () => [
      {
        id: `page_${"b".repeat(32)}`,
        url: "https://example.test/work",
        active: true,
      },
    ]),
    inspect: vi.fn(async () => ({
      id: `obs_${"c".repeat(32)}`,
      pageId: `page_${"b".repeat(32)}`,
      url: "https://example.test/work",
      title: "Work",
      revision: 1,
      targets: sensitive ? [{ sensitive: true }] : [],
    })),
    startPageRecording: vi.fn(
      async (request: {
        recordingId: string;
        pageId: string;
        path: string;
      }) => {
        stagingPath = request.path;
        return {
          recordingId: request.recordingId,
          pageId: request.pageId,
          url: "https://example.test/work",
        };
      },
    ),
    stopPageRecording: vi.fn(async (recordingId: string) => {
      const bytes = Buffer.alloc(256, 0);
      bytes.set(Buffer.from("1a45dfa3", "hex"), 0);
      await writeFile(stagingPath, bytes);
      return {
        recordingId,
        pageId: `page_${"b".repeat(32)}`,
        url: "https://example.test/work",
      };
    }),
  };
  const sessions = {
    get: vi.fn(async () => ({
      id: sessionId,
      mode,
      status: "active",
      controller: mode === "capture" ? "human" : "agent",
    })),
    assertActive: vi.fn(),
  };
  const browsers = { get: vi.fn(() => browser) };
  const observations = {
    append: vi.fn(async () => {
      if (observationFailure) throw new Error("observation unavailable");
      return {};
    }),
  };
  return {
    sessionId,
    browser,
    store,
    stagingPath: () => stagingPath,
    sessions,
    browsers,
    observations,
    service: new RecordingService(
      store,
      sessions as never,
      browsers as never,
      observations as never,
    ),
  };
}

describe("RecordingService", () => {
  for (const mode of ["agent", "companion", "capture"] as const) {
    it(`records and finalizes the exact page in ${mode} mode`, async () => {
      const { service, sessionId, browser } = await harness(mode);
      const started = await service.start(sessionId, {
        scope: "page",
        taskId: `task_${mode}`,
        sensitiveDataPolicy: "user_confirmed_visible_content",
        confirmUnmaskedSensitiveContent: true,
      });
      expect(started).toMatchObject({
        taskId: `task_${mode}`,
        sessionId,
        mode,
        state: "recording",
        includesAudio: false,
        scope: { kind: "page", pageId: `page_${"b".repeat(32)}` },
      });

      const stopped = await service.stop(sessionId, started.id);
      expect(stopped).toMatchObject({
        state: "available",
        artifact: { playable: true, partial: false, mimeType: "video/webm" },
      });
      expect(browser.stopPageRecording).toHaveBeenCalledWith(started.id);
      expect(browser.pages).toHaveBeenCalledTimes(1);
    });
  }

  it("refuses window scope without invoking browser capture", async () => {
    const { service, sessionId, browser } = await harness("agent");
    await expect(
      service.start(sessionId, {
        scope: "browser_window",
        taskId: "task_window",
        sensitiveDataPolicy: "user_confirmed_visible_content",
        confirmUnmaskedSensitiveContent: true,
      }),
    ).rejects.toMatchObject({ code: "RECORDING_SCOPE_UNAVAILABLE" });
    expect(browser.startPageRecording).not.toHaveBeenCalled();
  });

  it("refuses a recognized sensitive page before recording begins", async () => {
    const { service, sessionId, browser } = await harness("companion", true);
    await expect(
      service.start(sessionId, {
        scope: "page",
        taskId: "task_sensitive",
        sensitiveDataPolicy: "user_confirmed_visible_content",
        confirmUnmaskedSensitiveContent: true,
      }),
    ).rejects.toMatchObject({ code: "RECORDING_SCOPE_UNAVAILABLE" });
    expect(browser.startPageRecording).not.toHaveBeenCalled();
  });

  it("keeps authoritative recording state when lifecycle observation publication fails", async () => {
    const { service, sessionId } = await harness("agent", false, true);
    const started = await service.start(sessionId, {
      scope: "page",
      taskId: "task_observation_failure",
      sensitiveDataPolicy: "user_confirmed_visible_content",
      confirmUnmaskedSensitiveContent: true,
    });
    expect(started.state).toBe("recording");
    await expect(service.stop(sessionId, started.id)).resolves.toMatchObject({
      state: "available",
      artifact: { playable: true },
    });
  });

  it("persists an honest failure without leaking browser diagnostics", async () => {
    const { service, sessionId, browser } = await harness("capture");
    browser.startPageRecording.mockRejectedValueOnce(
      new Error("secret path /Users/example/private.webm"),
    );
    const failed = await service.start(sessionId, {
      scope: "page",
      taskId: "task_start_failure",
      sensitiveDataPolicy: "user_confirmed_visible_content",
      confirmUnmaskedSensitiveContent: true,
    });
    expect(failed).toMatchObject({
      state: "failed",
      failure: {
        code: "SOURCE_UNAVAILABLE",
        message: "The page recording could not start.",
      },
    });
    expect(JSON.stringify(failed)).not.toContain("/Users/example");
  });

  it("stops before an agent types into a recognized sensitive target", async () => {
    const { service, sessionId, browser } = await harness("agent");
    const started = await service.start(sessionId, {
      scope: "page",
      taskId: "task_sensitive_type",
      sensitiveDataPolicy: "user_confirmed_visible_content",
      confirmUnmaskedSensitiveContent: true,
    });
    browser.inspect.mockResolvedValueOnce({
      id: `obs_${"d".repeat(32)}`,
      pageId: `page_${"b".repeat(32)}`,
      url: "https://example.test/work",
      title: "Work",
      revision: 2,
      targets: [{ ref: "secret", sensitive: true }],
    });
    await service.stopBeforeSensitiveType(
      sessionId,
      `page_${"b".repeat(32)}`,
      "secret",
    );
    await expect(service.get(sessionId, started.id)).resolves.toMatchObject({
      state: "available",
      artifact: { playable: true },
    });
  });

  it("preserves a failed finalization only as an unplayable partial", async () => {
    const { service, sessionId, browser, stagingPath } = await harness("agent");
    const started = await service.start(sessionId, {
      scope: "page",
      taskId: "task_partial",
      sensitiveDataPolicy: "user_confirmed_visible_content",
      confirmUnmaskedSensitiveContent: true,
    });
    browser.stopPageRecording.mockImplementationOnce(async () => {
      const bytes = Buffer.alloc(256, 0);
      bytes.set(Buffer.from("1a45dfa3", "hex"), 0);
      await writeFile(stagingPath(), bytes);
      throw new Error("encoder failed");
    });
    await expect(service.stop(sessionId, started.id)).resolves.toMatchObject({
      state: "failed",
      failure: { code: "FINALIZATION_FAILED" },
      artifact: { playable: false, partial: true },
    });
  });

  it("marks a page-close interruption failed with its task association intact", async () => {
    const { service, sessionId } = await harness("companion");
    const started = await service.start(sessionId, {
      scope: "page",
      taskId: "task_interrupted_page",
      sensitiveDataPolicy: "user_confirmed_visible_content",
      confirmUnmaskedSensitiveContent: true,
    });
    await service.interruptForPage(sessionId, `page_${"b".repeat(32)}`);
    await expect(service.get(sessionId, started.id)).resolves.toMatchObject({
      taskId: "task_interrupted_page",
      state: "failed",
      failure: { code: "CAPTURE_INTERRUPTED" },
      artifact: { playable: false, partial: true },
    });
  });

  it("recovers a persisted active record as interrupted after restart", async () => {
    const { service, sessionId, store, sessions, browsers, observations } =
      await harness("capture");
    const started = await service.start(sessionId, {
      scope: "page",
      taskId: "task_restart_recording",
      sensitiveDataPolicy: "user_confirmed_visible_content",
      confirmUnmaskedSensitiveContent: true,
    });
    const restarted = new RecordingService(
      store,
      sessions as never,
      browsers as never,
      observations as never,
    );
    await expect(restarted.get(sessionId, started.id)).resolves.toMatchObject({
      taskId: "task_restart_recording",
      sessionId,
      state: "failed",
      failure: { code: "CAPTURE_INTERRUPTED" },
    });
  });
});
