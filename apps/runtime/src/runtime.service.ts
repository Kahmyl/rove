import { Injectable } from "@nestjs/common";
import {
  RoveError,
  type ActionResult,
  type ClickRequest,
  type ControlState,
  type ControlTransferRequest,
  type Evidence,
  type InspectOptions,
  type NavigateRequest,
  type ObservationPage,
  type ObservationQuery,
  type PageInspection,
  type RoveRuntime,
  type SaveEvidenceRequest,
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

@Injectable()
export class RuntimeService implements RoveRuntime {
  constructor(
    private readonly sessions: SessionService,
    private readonly control: ControlService,
    private readonly coordinator: BrowserCommandCoordinator,
    private readonly browser: BrowserService,
    private readonly observations: ObservationService,
    private readonly evidence: EvidenceService,
  ) {}

  async startSession(request: StartSessionRequest): Promise<Session> {
    const session = await this.sessions.start(request);
    await this.observations.append(session.id, {
      actor: "system",
      type: "session_started",
      data: { mode: session.mode, controller: session.controller },
    });
    return session;
  }

  getSession(sessionId: string): Promise<Session> { return this.sessions.get(sessionId); }

  async endSession(sessionId: string): Promise<Session> {
    const session = await this.sessions.end(sessionId);
    await this.browser.close(sessionId);
    await this.observations.append(sessionId, {
      actor: "system",
      type: "session_completed",
      data: {},
    });
    return session;
  }

  async inspectBrowser(sessionId: string, options?: InspectOptions): Promise<PageInspection> {
    await this.requireActive(sessionId);
    return this.browser.get(sessionId).inspect(options);
  }

  navigate(sessionId: string, request: NavigateRequest): Promise<ActionResult> {
    return this.mutate(sessionId, () => this.browser.get(sessionId).navigate(request.url));
  }

  click(sessionId: string, request: ClickRequest): Promise<ActionResult> {
    return this.mutate(sessionId, () => this.browser.get(sessionId).click(request.target));
  }

  type(sessionId: string, request: TypeRequest): Promise<ActionResult> {
    return this.mutate(sessionId, () => this.browser.get(sessionId).type(request.target, request.value));
  }

  async transferControl(sessionId: string, request: ControlTransferRequest): Promise<ControlState> {
    return this.coordinator.execute(sessionId, async () => {
      const session = await this.requireActive(sessionId);
      if (request.actor === "agent" && request.controller === "human") {
        throw new RoveError({
          code: "HUMAN_CONTROL_REQUIRED",
          message: "The human must explicitly take control.",
        });
      }
      const next = await this.sessions.update({
        ...session,
        controller: request.controller,
        status: request.controller === null ? "awaiting_human" : "active",
      });
      if (session.controller === "human" && next.controller === "agent") {
        await this.browser.get(sessionId).invalidateTargets();
      }
      await this.observations.append(sessionId, {
        actor: request.actor,
        type: next.controller === "agent" ? "control_returned" : "control_transferred",
        data: { previous: session.controller, current: next.controller, reason: request.reason },
      });
      return this.control.nextState(next.controller, request.reason);
    });
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

  async getObservations(sessionId: string, query?: ObservationQuery): Promise<ObservationPage> {
    await this.sessions.get(sessionId);
    return this.observations.list(sessionId, query);
  }

  private async mutate(sessionId: string, operation: () => Promise<ActionResult>): Promise<ActionResult> {
    return this.coordinator.execute(sessionId, async () => {
      const session = await this.requireActive(sessionId);
      this.control.assertCanMutate(session, "agent");
      return operation();
    });
  }

  private async requireActive(sessionId: string): Promise<Session> {
    const session = await this.sessions.get(sessionId);
    this.sessions.assertActive(session);
    return session;
  }
}
