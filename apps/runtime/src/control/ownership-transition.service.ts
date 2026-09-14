import {
  RoveError,
  type ControlMutationAuthority,
  type ControlStatus,
  type PagePerceptionAssessment,
  type Session,
} from "@rove/protocol";
import { randomUUID } from "node:crypto";

import { BrowserService } from "../browser/browser.service.js";
import { ObservationService } from "../observation/observation.service.js";
import { InteractionPolicy } from "../policy/interaction-policy.js";
import { SessionService } from "../session/session.service.js";
import { BrowserOwnershipFence } from "./browser-ownership-fence.js";
import { ControlService } from "./control.service.js";
import { ControlWaitService } from "./control-wait.service.js";

export interface AutomaticHumanRequest {
  reason: string;
  observationType: string;
  pageState: PagePerceptionAssessment;
}

export interface EndSessionHooks {
  flushHumanActivity(): Promise<void>;
  flushBrowserEvidence(): Promise<void>;
  clearRuntimeState(): void;
  releaseProfileLock(): Promise<void>;
}

export class OwnershipTransitionService {
  constructor(
    private readonly sessions: SessionService,
    private readonly control: ControlService,
    private readonly controlWait: ControlWaitService,
    private readonly browser: BrowserService,
    private readonly observations: ObservationService,
    private readonly ownershipFence: BrowserOwnershipFence,
    private readonly interactionPolicy: InteractionPolicy,
  ) {}

  async requestHuman(
    sessionId: string,
    reason: string,
  ): Promise<ControlStatus> {
    const session = await this.sessions.get(sessionId);

    this.control.assertCanRequestHuman(session);

    if (session.status === "awaiting_human" && session.controller === null) {
      return this.toControlStatus(session);
    }

    const { session: next, observationSeq } =
      await this.transitionToAwaitingHuman(
        session,
        reason,
        "agent",
        "human_requested",
        { reason },
      );

    return this.toControlStatus(next, observationSeq);
  }

  async requestHumanForPolicy(
    sessionId: string,
    request: AutomaticHumanRequest,
  ): Promise<void> {
    const session = await this.sessions.get(sessionId);

    // Capture Mode / voluntary human ownership already has
    // the required human intervention available.
    if (session.controller === "human") {
      return;
    }

    // Repeated automatic assessment is idempotent.
    if (session.status === "awaiting_human" && session.controller === null) {
      return;
    }

    // F2 automatic handoff is valid only from active
    // agent ownership.
    if (session.status !== "active" || session.controller !== "agent") {
      return;
    }

    await this.transitionToAwaitingHuman(
      session,
      request.reason,
      "system",
      request.observationType,
      request.pageState,
    );
  }

  async takeHuman(
    sessionId: string,
    authority?: ControlMutationAuthority,
  ): Promise<ControlStatus> {
    const session = await this.sessions.get(sessionId);

    this.assertExactAuthority(session, authority);
    this.control.assertCanTakeHuman(session);

    if (session.controller === "human") {
      return this.toControlStatus(session);
    }

    const requested = session.handoff !== undefined;

    await this.browser.beginHumanControl(sessionId);

    const transition = this.ownershipFence.beginTransition(sessionId);

    await transition.waitForDrain();

    let next: Session;

    try {
      next = await this.sessions.update({
        ...session,
        status: "active",
        controller: "human",
        ownershipGeneration: transition.generation,
      });
    } catch (error) {
      this.ownershipFence.completeTransition(transition, session.controller);
      await this.browser.abortHumanControl(sessionId);

      throw error;
    }

    this.ownershipFence.completeTransition(transition, "human");

    const observation = await this.observations.append(sessionId, {
      actor: "human",
      type: "human_took_control",
      data: { requested },
    });

    await this.controlWait.publish(sessionId, observation);

    return this.toControlStatus(next, observation.seq);
  }

  async returnAgent(
    sessionId: string,
    flushHumanActivity: () => Promise<void>,
    authority?: ControlMutationAuthority,
  ): Promise<ControlStatus> {
    const session = await this.sessions.get(sessionId);

    this.assertExactAuthority(session, authority);
    this.control.assertCanReturnAgent(session);

    if (session.controller === "agent" && session.handoff === undefined) {
      return this.toControlStatus(session);
    }

    const transition = this.ownershipFence.beginTransition(sessionId);

    await transition.waitForDrain();

    let ownershipCompleted = false;

    try {
      // Agent admission remains closed throughout all
      // human-activity flushing and browser invalidation.
      await flushHumanActivity();

      const browser = this.browser.get(sessionId);
      const pages = await browser.pages();

      const activePageId = pages.find((page) => page.active)?.id;

      const invalidatedPages =
        session.controller === "human"
          ? await this.browser.prepareHumanControlReturn(sessionId)
          : await browser.invalidateAllTargets();

      // No inspection from the previous ownership era may
      // authorize a mutation in the new agent generation.
      this.interactionPolicy.requireInspection(sessionId);

      const next: Session = {
        ...session,
        status: "active",
        controller: "agent",
        ownershipGeneration: transition.generation,
        ...(session.activeHandoffId === undefined
          ? {}
          : { lastReturnedHandoffId: session.activeHandoffId }),
        ...(activePageId === undefined ? {} : { activePageId }),
      };

      delete next.handoff;
      delete next.activeHandoffId;
      delete next.activeHandoffGeneration;

      const persisted = await this.sessions.update(next);

      // Establish the new agent generation only after
      // target + policy invalidation is complete.
      this.browser.endHumanControl(sessionId);
      this.ownershipFence.completeTransition(transition, "agent");

      ownershipCompleted = true;

      const observation = await this.observations.append(sessionId, {
        actor: "human",
        type: "human_returned_control",
        data: {
          activePageId,
          invalidatedPages,
        },
      });

      await this.controlWait.publish(sessionId, observation);

      return this.toControlStatus(persisted, observation.seq);
    } catch (error) {
      if (error instanceof RoveError && error.code === "BROWSER_CLOSED") {
        await this.failClosedBrowser(session);

        throw error;
      }

      if (!ownershipCompleted) {
        this.ownershipFence.completeTransition(transition, session.controller);
      }

      throw error;
    }
  }

  async pauseAgent(
    sessionId: string,
    authority?: ControlMutationAuthority,
  ): Promise<ControlStatus> {
    const session = await this.sessions.get(sessionId);

    this.assertExactAuthority(session, authority);
    this.control.assertCanPauseAgent(session);

    if (session.status === "paused") {
      return this.toControlStatus(session);
    }

    const transition = this.ownershipFence.beginTransition(sessionId);

    await transition.waitForDrain();

    let next: Session;

    try {
      next = {
        ...session,
        status: "paused",
        controller: null,
        ownershipGeneration: transition.generation,
      };
      delete next.handoff;
      next = await this.sessions.update(next);
    } catch (error) {
      this.ownershipFence.completeTransition(transition, session.controller);
      throw error;
    }

    this.ownershipFence.completeTransition(transition, null);

    const observation = await this.observations.append(sessionId, {
      actor: "human",
      type: "session_paused",
      data: {},
    });

    return this.toControlStatus(next, observation.seq);
  }

  private assertExactAuthority(
    session: Session,
    authority: ControlMutationAuthority | undefined,
  ): void {
    if (authority === undefined) return;
    if (
      session.ownershipGeneration !== authority.ownershipGeneration ||
      session.activeHandoffId !== authority.handoffId ||
      session.activeHandoffGeneration !== authority.handoffGeneration
    )
      throw new RoveError({
        code: "CONTROL_NOT_OWNED",
        message: "Runtime control authority is stale or mismatched.",
      });
  }

  async endSession(
    sessionId: string,
    hooks: EndSessionHooks,
  ): Promise<Session> {
    const existing = await this.sessions.get(sessionId);

    if (existing.status === "completed" || existing.status === "failed") {
      await hooks.flushHumanActivity();
      await hooks.flushBrowserEvidence();
      hooks.clearRuntimeState();
      this.interactionPolicy.clear(sessionId);
      await this.browser.close(sessionId);
      await hooks.releaseProfileLock();
      this.ownershipFence.clear(sessionId);
      return existing;
    }

    const transition = this.ownershipFence.beginTransition(sessionId);

    await transition.waitForDrain();

    let ownershipFinalized = false;

    try {
      await hooks.flushHumanActivity();
      await hooks.flushBrowserEvidence();

      hooks.clearRuntimeState();

      this.interactionPolicy.clear(sessionId);

      let closeError: unknown;

      try {
        await this.browser.close(sessionId);
      } catch (error) {
        closeError = error;
      } finally {
        await hooks.releaseProfileLock();
      }

      const session = await this.sessions.end(sessionId);

      // The session is now terminal. No ownership
      // generation remains usable.
      this.ownershipFence.clear(sessionId);

      ownershipFinalized = true;

      const observation = await this.observations.append(sessionId, {
        actor: "system",
        type: "session_completed",
        data: {},
      });

      await this.controlWait.publish(sessionId, observation);

      if (closeError !== undefined) {
        throw closeError;
      }

      return session;
    } catch (error) {
      if (!ownershipFinalized) {
        this.ownershipFence.completeTransition(transition, existing.controller);
      }

      throw error;
    }
  }

  private async transitionToAwaitingHuman(
    session: Session,
    reason: string,
    actor: "agent" | "system",
    observationType: string,
    observationData: unknown,
  ): Promise<{
    session: Session;
    observationSeq: number;
  }> {
    const transition = this.ownershipFence.beginTransition(session.id);

    await transition.waitForDrain();

    const requestedAt = new Date().toISOString();
    const activeHandoffId = `handoff_${randomUUID().replaceAll("-", "")}`;

    let next: Session;

    try {
      next = await this.sessions.update({
        ...session,
        status: "awaiting_human",
        controller: null,
        ownershipGeneration: transition.generation,
        activeHandoffId,
        activeHandoffGeneration: transition.generation,
        handoff: {
          reason,
          requestedAt,
        },
      });
    } catch (error) {
      this.ownershipFence.completeTransition(transition, session.controller);

      throw error;
    }

    this.ownershipFence.completeTransition(transition, null);

    const observation = await this.observations.append(session.id, {
      actor,
      type: observationType,
      data: observationData,
    });

    await this.controlWait.publish(session.id, observation);

    return {
      session: next,
      observationSeq: observation.seq,
    };
  }

  private async failClosedBrowser(session: Session): Promise<void> {
    this.ownershipFence.clear(session.id);

    const now = new Date().toISOString();

    const failed: Session = {
      ...session,
      status: "failed",
      controller: null,
      endedAt: now,
      updatedAt: now,
    };

    delete failed.handoff;

    await this.sessions.update(failed);

    const observation = await this.observations.append(session.id, {
      actor: "system",
      type: "session_failed",
      data: {},
    });

    await this.controlWait.publish(session.id, observation);
  }

  private toControlStatus(
    session: Session,
    observationSeq?: number,
  ): ControlStatus {
    return {
      sessionId: session.id,
      generation: this.ownershipFence.generation(session.id),
      status: session.status,
      controller: session.controller,
      updatedAt: session.updatedAt,
      ...(session.handoff === undefined
        ? {}
        : {
            handoff: session.handoff,
          }),
      ...(session.activeHandoffId === undefined
        ? {}
        : { activeHandoffId: session.activeHandoffId }),
      ...(session.activeHandoffGeneration === undefined
        ? {}
        : { activeHandoffGeneration: session.activeHandoffGeneration }),
      ...(session.lastReturnedHandoffId === undefined
        ? {}
        : { lastReturnedHandoffId: session.lastReturnedHandoffId }),
      ...(observationSeq === undefined
        ? {}
        : {
            observationSeq,
          }),
    };
  }
}
