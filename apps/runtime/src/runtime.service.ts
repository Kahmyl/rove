import { Inject, Injectable } from "@nestjs/common";
import type { RoveConfig } from "@rove/config";
import {
  RoveError,
  type ActionResult,
  type ClickRequest,
  type ControlState,
  type ControlTransferRequest,
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
  type StartSessionRequest,
  type TypeRequest,
} from "@rove/protocol";
import { BrowserService } from "./browser/browser.service.js";
import { BrowserCommandCoordinator } from "./control/command-coordinator.js";
import { ControlService } from "./control/control.service.js";
import { EvidenceService } from "./evidence/evidence.service.js";
import { ObservationService } from "./observation/observation.service.js";
import { SessionService } from "./session/session.service.js";
import { ROVE_CONFIG } from "./tokens.js";

@Injectable()
export class RuntimeService implements RoveRuntime {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ControlService) private readonly control: ControlService,
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
        timeouts: {
          navigationMs: this.config.timeouts.navigationMs,
          actionMs: this.config.timeouts.actionMs,
          inspectMs: this.config.timeouts.inspectMs,
        },
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
      await this.observations.append(session.id, { actor: "system", type: "session_failed", data: {} });
      throw error;
    }
  }

  getSession(sessionId: string): Promise<Session> {
    return this.sessions.get(sessionId);
  }

  async endSession(sessionId: string): Promise<Session> {
    return this.coordinator.execute(sessionId, async () => {
      const existing = await this.sessions.get(sessionId);
      if (existing.status === "completed" || existing.status === "failed") {
        throw new RoveError({ code: "SESSION_ALREADY_ENDED", message: "Rove session has already ended." });
      }
      let closeError: unknown;
      try {
        await this.browser.close(sessionId);
      } catch (error) {
        closeError = error;
      }
      const session = await this.sessions.end(sessionId);
      await this.observations.append(sessionId, { actor: "system", type: "session_completed", data: {} });
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

  async transferControl(sessionId: string, request: ControlTransferRequest): Promise<ControlState> {
    return this.coordinator.execute(sessionId, async () => {
      const session = await this.requireActive(sessionId);
      if (request.actor === "agent" && request.controller === "human") {
        throw new RoveError({ code: "HUMAN_CONTROL_REQUIRED", message: "The human must explicitly take control." });
      }
      const next = await this.sessions.update({
        ...session,
        controller: request.controller,
        status: request.controller === null ? "awaiting_human" : "active",
      });
      if (session.controller === "human" && next.controller === "agent") await this.browser.get(sessionId).invalidateTargets();
      await this.observations.append(sessionId, {
        actor: request.actor,
        type: next.controller === "agent" ? "control_returned" : "control_transferred",
        data: { previous: session.controller, current: next.controller, reason: request.reason },
      });
      return this.control.nextState(next.controller, request.reason);
    });
  }

  async getControl(sessionId: string): Promise<ControlState> {
    const session = await this.sessions.get(sessionId);
    return this.control.nextState(session.controller);
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
}
