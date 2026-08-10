import { resolve } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import type { RoveConfig } from "@rove/config";
import {
  RoveError,
  type ActionResult,
  type ClickRequest,
  type ControlStatus,
  type ControlWaitRequest,
  type ControlWaitResult,
  type Evidence,
  type EvidenceReadResult,
  type InspectOptions,
  type NavigateRequest,
  type ObservationPage,
  type ObservationQuery,
  type PageInspection,
  type PageSummary,
  type PressRequest,
  type RoveRuntime,
  type SaveEvidenceRequest,
  type ScreenshotOptions,
  type ScrollOptions,
  type Session,
  type SessionMode,
  type StartSessionRequest,
  type TypeRequest,
  type RequestHumanRequest,
  requestHumanRequestSchema,
  controlWaitRequestSchema,
} from "@rove/protocol";
import type { BrowserActivity } from "@rove/browser";
import { BrowserService } from "./browser/browser.service.js";
import { BrowserCommandCoordinator } from "./control/command-coordinator.js";
import { ControlService } from "./control/control.service.js";
import { ControlWaitService } from "./control/control-wait.service.js";
import { EvidenceService } from "./evidence/evidence.service.js";
import { ObservationService } from "./observation/observation.service.js";
import { SessionService } from "./session/session.service.js";
import { ROVE_CONFIG } from "./tokens.js";

@Injectable()
export class RuntimeService implements RoveRuntime {
  private readonly humanActivityQueues =
    new Map<string, Promise<void>>();

  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ControlService) private readonly control: ControlService,
    @Inject(ControlWaitService) private readonly controlWait: ControlWaitService,
    @Inject(BrowserCommandCoordinator) private readonly coordinator: BrowserCommandCoordinator,
    @Inject(BrowserService) private readonly browser: BrowserService,
    @Inject(ObservationService) private readonly observations: ObservationService,
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
    @Inject(ROVE_CONFIG) private readonly config: RoveConfig,
  ) {}

  async startSession(request: StartSessionRequest): Promise<Session> {
    let session = await this.sessions.start(request);
    try {
      const browser = await this.browser.start(session.id, {
        headless: this.config.browser.headless,
        browser: this.config.browser.preferredBrowser,
        profile: session.profile,
        ...(session.profile.mode === "persistent"
          ? {
              profileUserDataDir: resolve(
                this.config.home,
                "profiles",
                session.profile.name,
              ),
            }
          : {}),
        timeouts: {
          navigationMs: this.config.timeouts.navigationMs,
          actionMs: this.config.timeouts.actionMs,
          inspectMs: this.config.timeouts.inspectMs,
        },
      });

      browser.onActivity((activity) => {
        this.enqueueHumanActivity(
          session.id,
          activity,
        );
      });

      if (request.startUrl !== undefined) await browser.navigate(request.startUrl);
      const activePageId = (await browser.pages()).find((page) => page.active)?.id;
      session = await this.sessions.update({
        ...session,
        status: "active",
        ...(activePageId === undefined ? {} : { activePageId }),
      });
      await this.observations.append(session.id, {
        actor: "system",
        type: "session_started",
        data: { mode: session.mode, controller: session.controller },
      });
      return session;
    } catch (error) {
      await this.browser.close(session.id).catch(() => undefined);
      const now = new Date().toISOString();
      await this.sessions.update({ ...session, status: "failed", controller: null, endedAt: now, updatedAt: now });
      const observation = await this.observations.append(session.id, { actor: "system", type: "session_failed", data: {} });
      await this.controlWait.publish(session.id, observation);
      throw error;
    }
  }

  getSession(sessionId: string): Promise<Session> {
    return this.sessions.get(sessionId);
  }

  async listActiveSessions(
    mode?: SessionMode,
  ): Promise<Session[]> {
    const sessions = await Promise.all(
      this.browser
        .sessionIds()
        .map((sessionId) => this.sessions.get(sessionId)),
    );

    return sessions.filter(
      (session) =>
        (session.status === "active" ||
          session.status === "awaiting_human") &&
        (mode === undefined || session.mode === mode),
    );
  }

  async endSession(sessionId: string): Promise<Session> {
    return this.coordinator.execute(sessionId, async () => {
      const existing = await this.sessions.get(sessionId);
      if (existing.status === "completed" || existing.status === "failed") {
        throw new RoveError({ code: "SESSION_ALREADY_ENDED", message: "Rove session has already ended." });
      }
      await this.flushHumanActivity(sessionId);

      let closeError: unknown;
      try {
        await this.browser.close(sessionId);
      } catch (error) {
        closeError = error;
      }
      const session = await this.sessions.end(sessionId);
      const observation = await this.observations.append(sessionId, { actor: "system", type: "session_completed", data: {} });
      await this.controlWait.publish(sessionId, observation);
      if (closeError !== undefined) throw closeError;
      return session;
    });
  }

  async inspectBrowser(sessionId: string, options?: InspectOptions): Promise<PageInspection> {
    await this.requireActive(sessionId);
    return this.browser.get(sessionId).inspect(options);
  }

  navigate(sessionId: string, request: NavigateRequest): Promise<ActionResult> {
    return this.mutateAction(
      sessionId,
      () => this.browser.get(sessionId).navigate(request.url),
      (result) => ({
        type: "browser_navigated",
        data: {
          url: result.url,
          previousRevision: result.previousRevision,
          currentRevision: result.currentRevision,
        },
      }),
    );
  }

  click(sessionId: string, request: ClickRequest): Promise<ActionResult> {
    return this.mutateAction(
      sessionId,
      () => this.browser.get(sessionId).click(request.target),
      (result) => ({
        type: "agent_clicked",
        data: { targetRef: request.target.ref, pageChanged: result.pageChanged, url: result.url },
      }),
    );
  }

  type(sessionId: string, request: TypeRequest): Promise<ActionResult> {
    return this.mutateAction(
      sessionId,
      () => this.browser.get(sessionId).type(request.target, request.value),
      () => ({ type: "agent_typed", data: { targetRef: request.target.ref } }),
    );
  }

  press(sessionId: string, request: PressRequest): Promise<ActionResult> {
    return this.mutateAction(
      sessionId,
      () => this.browser.get(sessionId).press(request.target ?? null, request.key),
      () => ({
        type: "agent_pressed",
        data: { ...(request.target === undefined ? {} : { targetRef: request.target.ref }), key: request.key },
      }),
    );
  }

  scroll(sessionId: string, request: ScrollOptions): Promise<ActionResult> {
    return this.mutateAction(
      sessionId,
      () => this.browser.get(sessionId).scroll(request),
      () => ({ type: "agent_scrolled", data: { direction: request.direction, amount: request.amount ?? 600 } }),
    );
  }

  back(sessionId: string): Promise<ActionResult> {
    return this.mutateAction(sessionId, () => this.browser.get(sessionId).back(), () => ({ type: "browser_back", data: {} }));
  }

  forward(sessionId: string): Promise<ActionResult> {
    return this.mutateAction(sessionId, () => this.browser.get(sessionId).forward(), () => ({ type: "browser_forward", data: {} }));
  }

  async pages(sessionId: string): Promise<PageSummary[]> {
    await this.requireActive(sessionId);
    return this.browser.get(sessionId).pages();
  }

  switchPage(sessionId: string, pageId: string): Promise<PageSummary> {
    return this.mutateValue(sessionId, async () => {
      const page = await this.browser.get(sessionId).switchPage(pageId);
      await this.syncActivePage(sessionId);
      await this.observations.append(sessionId, { actor: "agent", type: "page_switched", data: { pageId } });
      return page;
    });
  }

  closePage(sessionId: string, pageId: string): Promise<void> {
    return this.mutateValue(sessionId, async () => {
      await this.browser.get(sessionId).closePage(pageId);
      await this.syncActivePage(sessionId);
      await this.observations.append(sessionId, { actor: "agent", type: "page_closed", data: { pageId } });
    });
  }

  captureScreenshot(sessionId: string, options: ScreenshotOptions = {}): Promise<Evidence> {
    return this.mutateValue(sessionId, async () => {
      const artifact = await this.browser.get(sessionId).screenshot(options);
      const item = await this.evidence.saveScreenshot(sessionId, artifact, options);
      await this.observations.append(sessionId, {
        actor: "agent",
        type: "screenshot_captured",
        data: { evidenceId: item.id, label: item.label },
        ...(item.pageId === undefined ? {} : { pageId: item.pageId }),
        ...(item.pageRevision === undefined ? {} : { pageRevision: item.pageRevision }),
      });
      return item;
    });
  }

  async getControlStatus(sessionId: string): Promise<ControlStatus> {
    return this.toControlStatus(await this.sessions.get(sessionId));
  }

  async requestHuman(sessionId: string, request: RequestHumanRequest): Promise<ControlStatus> {
    const input = requestHumanRequestSchema.parse(request);
    return this.coordinator.execute(sessionId, async () => {
      const session = await this.sessions.get(sessionId);
      this.control.assertCanRequestHuman(session);
      if (session.status === "awaiting_human" && session.controller === null) return this.toControlStatus(session);
      const requestedAt = new Date().toISOString();
      const next = await this.sessions.update({
        ...session,
        status: "awaiting_human",
        controller: null,
        handoff: { reason: input.reason, requestedAt },
      });
      const observation = await this.observations.append(sessionId, { actor: "agent", type: "human_requested", data: { reason: input.reason } });
      await this.controlWait.publish(sessionId, observation);
      return this.toControlStatus(next, observation.seq);
    });
  }

  async takeHumanControl(sessionId: string): Promise<ControlStatus> {
    return this.coordinator.execute(sessionId, async () => {
      const session = await this.sessions.get(sessionId);
      this.control.assertCanTakeHuman(session);
      if (session.controller === "human") return this.toControlStatus(session);
      const requested = session.handoff !== undefined;
      const next = await this.sessions.update({ ...session, status: "active", controller: "human" });
      const observation = await this.observations.append(sessionId, { actor: "human", type: "human_took_control", data: { requested } });
      await this.controlWait.publish(sessionId, observation);
      return this.toControlStatus(next, observation.seq);
    });
  }

  async returnAgentControl(sessionId: string): Promise<ControlStatus> {
    return this.coordinator.execute(sessionId, async () => {
      const session = await this.sessions.get(sessionId);
      this.control.assertCanReturnAgent(session);
      if (session.controller === "agent" && session.handoff === undefined) return this.toControlStatus(session);

      await this.flushHumanActivity(sessionId);

      try {
        const pages = await this.browser.get(sessionId).pages();
        const activePageId = pages.find((page) => page.active)?.id;
        const invalidatedPages = await this.browser.get(sessionId).invalidateAllTargets();
        const next: Session = {
          ...session,
          status: "active",
          controller: "agent",
          ...(activePageId === undefined ? {} : { activePageId }),
        };
        delete next.handoff;
        const persisted = await this.sessions.update(next);
        const observation = await this.observations.append(sessionId, {
          actor: "human",
          type: "human_returned_control",
          data: { activePageId, invalidatedPages },
        });
        await this.controlWait.publish(sessionId, observation);
        return this.toControlStatus(persisted, observation.seq);
      } catch (error) {
        if (!(error instanceof RoveError) || error.code !== "BROWSER_CLOSED") throw error;
        const now = new Date().toISOString();
        const failed: Session = { ...session, status: "failed", controller: null, endedAt: now, updatedAt: now };
        delete failed.handoff;
        await this.sessions.update(failed);
        const observation = await this.observations.append(sessionId, { actor: "system", type: "session_failed", data: {} });
        await this.controlWait.publish(sessionId, observation);
        throw error;
      }
    });
  }

  async waitForControl(sessionId: string, request: ControlWaitRequest = {}, signal?: AbortSignal): Promise<ControlWaitResult> {
    const input = controlWaitRequestSchema.parse(request);
    return this.controlWait.wait(
      sessionId,
      input.afterSeq ?? 0,
      input.timeoutMs ?? Math.min(this.config.timeouts.controlWaitMs, 60_000),
      signal,
    );
  }

  async saveEvidence(sessionId: string, request: SaveEvidenceRequest): Promise<Evidence> {
    await this.sessions.get(sessionId);
    const item = await this.evidence.save(sessionId, request);
    await this.observations.append(sessionId, {
      actor: "agent",
      type: "record_saved",
      data: { evidenceId: item.id, type: item.type, label: item.label },
    });
    return item;
  }

  async listEvidence(sessionId: string): Promise<Evidence[]> {
    await this.sessions.get(sessionId);
    return this.evidence.list(sessionId);
  }

  async readEvidence(sessionId: string, evidenceId: string): Promise<EvidenceReadResult> {
    await this.sessions.get(sessionId);
    return this.evidence.read(sessionId, evidenceId);
  }

  async getObservations(sessionId: string, query?: ObservationQuery): Promise<ObservationPage> {
    await this.sessions.get(sessionId);
    return this.observations.list(sessionId, query);
  }

  private async mutateAction(
    sessionId: string,
    operation: () => Promise<ActionResult>,
    observation: (result: ActionResult) => { type: string; data: unknown },
  ): Promise<ActionResult> {
    return this.mutateValue(sessionId, async () => {
      const result = { ...(await operation()), sessionId };
      await this.syncActivePage(sessionId);
      const event = observation(result);
      await this.observations.append(sessionId, {
        actor: "agent",
        type: event.type,
        data: event.data,
        ...(result.pageId === undefined ? {} : { pageId: result.pageId }),
        ...(result.currentRevision === undefined ? {} : { pageRevision: result.currentRevision }),
      });
      return result;
    });
  }

  private enqueueHumanActivity(
    sessionId: string,
    activity: BrowserActivity,
  ): void {
    const previous =
      this.humanActivityQueues.get(sessionId) ??
      Promise.resolve();

    const next = previous
      .then(() =>
        this.persistHumanActivity(
          sessionId,
          activity,
        ),
      )
      .catch(() => undefined)
      .finally(() => {
        if (
          this.humanActivityQueues.get(sessionId) ===
          next
        ) {
          this.humanActivityQueues.delete(sessionId);
        }
      });

    this.humanActivityQueues.set(
      sessionId,
      next,
    );
  }

  private async persistHumanActivity(
    sessionId: string,
    activity: BrowserActivity,
  ): Promise<void> {
    const session =
      await this.sessions
        .get(sessionId)
        .catch(() => null);

    if (
      session === null ||
      session.status !== "active" ||
      session.controller !== "human"
    ) {
      return;
    }

    const observationType =
      this.humanObservationType(
        activity.type,
      );

    await this.observations.append(sessionId, {
      actor: "human",
      type: observationType,
      data: activity.data,
      pageId: activity.pageId,
      ...(activity.pageRevision === undefined
        ? {}
        : {
            pageRevision:
              activity.pageRevision,
          }),
    });
  }

  private async flushHumanActivity(
    sessionId: string,
  ): Promise<void> {
    await this.humanActivityQueues.get(
      sessionId,
    );
  }

  private humanObservationType(
    type: BrowserActivity["type"],
  ): string {
    switch (type) {
      case "interaction_click":
        return "human_click";
      case "form_submitted":
        return "human_submit";
      case "scroll_milestone":
        return "human_scroll";
      case "selection_changed":
        return "human_selection";
      default:
        return type;
    }
  }

  private async mutateValue<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    return this.coordinator.execute(sessionId, async () => {
      const session = await this.requireActive(sessionId);
      this.control.assertCanMutate(session, "agent");
      return operation();
    });
  }

  private async syncActivePage(sessionId: string): Promise<void> {
    const activePageId = (await this.browser.get(sessionId).pages()).find((page) => page.active)?.id;
    const session = await this.sessions.get(sessionId);
    if (activePageId !== undefined && activePageId !== session.activePageId) {
      await this.sessions.update({ ...session, activePageId });
    }
  }

  private async requireActive(sessionId: string): Promise<Session> {
    const session = await this.sessions.get(sessionId);
    this.sessions.assertActive(session);
    return session;
  }

  private toControlStatus(session: Session, observationSeq?: number): ControlStatus {
    return {
      sessionId: session.id,
      status: session.status,
      controller: session.controller,
      updatedAt: session.updatedAt,
      ...(session.handoff === undefined ? {} : { handoff: session.handoff }),
      ...(observationSeq === undefined ? {} : { observationSeq }),
    };
  }
}
