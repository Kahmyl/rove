import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  RoveError,
  startRecordingRequestSchema,
  type Recording,
  type RecordingFailure,
  type StartRecordingRequest,
} from "@rove/protocol";
import type { RecordingStore } from "@rove/storage";
import { BrowserService } from "../browser/browser.service.js";
import { ObservationService } from "../observation/observation.service.js";
import { SessionService } from "../session/session.service.js";
import { RECORDING_STORE } from "../tokens.js";

const PAGE_COVERAGE = "Rendered content of the selected task-owned page.";
const PAGE_EXCLUSIONS = [
  "Browser chrome",
  "Other tabs and pages",
  "Popups opened after recording starts",
  "Native dialogs",
  "Audio",
  "Sensitive-data masking",
];

@Injectable()
export class RecordingService implements OnModuleDestroy {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly recovery: Promise<void>;

  constructor(
    @Inject(RECORDING_STORE) private readonly recordings: RecordingStore,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(BrowserService) private readonly browsers: BrowserService,
    @Inject(ObservationService)
    private readonly observations: ObservationService,
  ) {
    this.recovery = this.recoverInterrupted();
    void this.recovery.catch(() => undefined);
  }

  async start(
    sessionId: string,
    request: StartRecordingRequest,
  ): Promise<Recording> {
    await this.recovery;
    const input = startRecordingRequestSchema.parse(request);
    if (input.scope === "browser_window")
      throw new RoveError({
        code: "RECORDING_SCOPE_UNAVAILABLE",
        message:
          "Browser-window recording is unavailable because this browser window may contain pages owned by other tasks.",
        details: { supportedScopes: ["page"] },
      });

    return this.serialize(sessionId, async () => {
      const session = await this.sessions.get(sessionId);
      this.sessions.assertActive(session);
      if ((await this.recordings.list(sessionId)).some(isActive))
        throw new RoveError({
          code: "RECORDING_ALREADY_ACTIVE",
          message: "This task already has an active recording.",
        });

      const browser = this.browsers.get(sessionId);
      const pages = await browser.pages();
      const page =
        input.pageId === undefined
          ? (pages.find((candidate) => candidate.active) ?? pages[0])
          : pages.find((candidate) => candidate.id === input.pageId);
      if (page === undefined)
        throw new RoveError({
          code: "RECORDING_SCOPE_UNAVAILABLE",
          message: "The selected page does not belong to this task.",
        });

      const inspection = await browser.inspect({
        pageId: page.id,
        includeTargets: true,
      });
      if (inspection.targets?.some((target) => target.sensitive === true))
        throw new RoveError({
          code: "RECORDING_SCOPE_UNAVAILABLE",
          message:
            "Recording is unavailable while the selected page exposes a recognized sensitive input.",
          details: { reason: "sensitive_scope" },
        });

      const now = new Date().toISOString();
      const id = `rec_${randomUUID().replaceAll("-", "")}`;
      const requested = await this.recordings.create({
        schemaVersion: 1,
        id,
        taskId: input.taskId,
        sessionId,
        mode: session.mode,
        state: "requested",
        scope: { kind: "page", pageId: page.id, url: page.url },
        sensitiveDataPolicy: "user_confirmed_visible_content",
        includesAudio: false,
        coverage: PAGE_COVERAGE,
        exclusions: PAGE_EXCLUSIONS,
        requestedAt: now,
        updatedAt: now,
      });

      let current = requested;
      try {
        const path = await this.recordings.stagingPath(sessionId, id);
        const state = await browser.startPageRecording({
          recordingId: id,
          pageId: page.id,
          path,
        });
        if (state.pageId !== page.id)
          throw new Error("The browser changed the recording page binding.");
        const startedAt = new Date().toISOString();
        const recording = await this.recordings.update(
          sessionId,
          id,
          "requested",
          {
            ...requested,
            state: "recording",
            startedAt,
            updatedAt: startedAt,
          },
        );
        current = recording;
        await this.observe(recording, "recording_started").catch(
          () => undefined,
        );
        return recording;
      } catch {
        await browser.stopPageRecording(id).catch(() => undefined);
        return this.fail(current, {
          code: "SOURCE_UNAVAILABLE",
          message: "The page recording could not start.",
        });
      }
    });
  }

  async stop(sessionId: string, recordingId: string): Promise<Recording> {
    await this.recovery;
    return this.serialize(sessionId, async () => {
      const current = await this.required(sessionId, recordingId);
      if (current.state === "available" || current.state === "failed")
        return current;
      if (current.state === "requested")
        throw new RoveError({
          code: "RECORDING_FINALIZATION_FAILED",
          message: "The recording is not ready to stop.",
        });
      const finalizing =
        current.state === "finalizing"
          ? current
          : await this.recordings.update(sessionId, recordingId, "recording", {
              ...current,
              state: "finalizing",
              stoppedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
      if (current.state === "recording")
        await this.observe(finalizing, "recording_finalizing").catch(
          () => undefined,
        );
      try {
        await this.browsers.get(sessionId).stopPageRecording(recordingId);
        const artifact = await this.recordings.finalizeArtifact(
          sessionId,
          recordingId,
        );
        const completedAt = new Date().toISOString();
        const available = await this.recordings.update(
          sessionId,
          recordingId,
          "finalizing",
          {
            ...finalizing,
            state: "available",
            artifact,
            updatedAt: completedAt,
          },
        );
        await this.observe(available, "recording_available").catch(
          () => undefined,
        );
        return available;
      } catch {
        return this.fail(finalizing, {
          code: "FINALIZATION_FAILED",
          message: "The recording could not be finalized.",
        });
      }
    });
  }

  async get(sessionId: string, recordingId: string): Promise<Recording> {
    await this.recovery;
    return this.required(sessionId, recordingId);
  }

  async list(sessionId: string): Promise<Recording[]> {
    await this.recovery;
    await this.sessions.get(sessionId);
    return this.recordings.list(sessionId);
  }

  async stopForPage(sessionId: string, pageId: string): Promise<void> {
    const active = (await this.list(sessionId)).filter(
      (recording) =>
        isActive(recording) &&
        recording.scope.kind === "page" &&
        recording.scope.pageId === pageId,
    );
    await Promise.all(
      active.map((recording) => this.stop(sessionId, recording.id)),
    );
  }

  async stopBeforeSensitiveType(
    sessionId: string,
    pageId: string,
    targetRef: string,
  ): Promise<void> {
    const active = (await this.list(sessionId)).some(
      (recording) =>
        isActive(recording) &&
        recording.scope.kind === "page" &&
        recording.scope.pageId === pageId,
    );
    if (!active) return;
    const inspection = await this.browsers.get(sessionId).inspect({
      pageId,
      includeTargets: true,
    });
    if (
      inspection.targets?.some(
        (target) => target.ref === targetRef && target.sensitive === true,
      )
    )
      await this.stopForPage(sessionId, pageId);
  }

  async stopAll(sessionId: string): Promise<void> {
    const active = (await this.list(sessionId)).filter(isActive);
    await Promise.all(
      active.map((recording) => this.stop(sessionId, recording.id)),
    );
  }

  async interruptForPage(sessionId: string, pageId: string): Promise<void> {
    await this.recovery;
    await this.serialize(sessionId, async () => {
      const active = (await this.recordings.list(sessionId)).filter(
        (recording) =>
          isActive(recording) &&
          recording.scope.kind === "page" &&
          recording.scope.pageId === pageId,
      );
      for (const recording of active) {
        await this.browsers
          .get(sessionId)
          .stopPageRecording(recording.id)
          .catch(() => undefined);
        await this.fail(recording, {
          code: "CAPTURE_INTERRUPTED",
          message: "The recorded page closed before finalization completed.",
        });
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.recovery.catch(() => undefined);
    const active = (await this.recordings.listAll()).filter(isActive);
    await Promise.all(
      active.map((recording) =>
        this.stop(recording.sessionId, recording.id).catch(() => undefined),
      ),
    );
  }

  private async required(sessionId: string, recordingId: string) {
    const recording = await this.recordings.get(sessionId, recordingId);
    if (recording === null)
      throw new RoveError({
        code: "RECORDING_NOT_FOUND",
        message: "Recording was not found in this session.",
      });
    return recording;
  }

  private async fail(
    current: Recording,
    failure: RecordingFailure,
  ): Promise<Recording> {
    const artifact = await this.recordings
      .preservePartialArtifact(current.sessionId, current.id)
      .catch(() => null);
    const now = new Date().toISOString();
    const failed = await this.recordings.update(
      current.sessionId,
      current.id,
      current.state,
      {
        ...current,
        state: "failed",
        failure,
        ...(artifact === null ? {} : { artifact }),
        updatedAt: now,
        ...(current.startedAt === undefined ? {} : { stoppedAt: now }),
      },
    );
    await this.observe(failed, "recording_failed").catch(() => undefined);
    return failed;
  }

  private observe(recording: Recording, type: string): Promise<unknown> {
    return this.observations.append(recording.sessionId, {
      actor: "system",
      type,
      pageId: recording.scope.pageId,
      data: {
        recordingId: recording.id,
        taskId: recording.taskId,
        state: recording.state,
        scope: recording.scope,
        ...(recording.failure === undefined
          ? {}
          : { failure: recording.failure }),
      },
    });
  }

  private async recoverInterrupted(): Promise<void> {
    for (const recording of await this.recordings.listAll()) {
      if (!isActive(recording)) continue;
      await this.fail(recording, {
        code: "CAPTURE_INTERRUPTED",
        message: "Recording was interrupted before Runtime could finalize it.",
      });
    }
  }

  private serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    return result.finally(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
  }
}

function isActive(recording: Recording): boolean {
  return ["requested", "recording", "finalizing"].includes(recording.state);
}
