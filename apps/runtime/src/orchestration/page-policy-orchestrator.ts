import type {
  PagePerceptionAssessment,
  PagePolicyDecision,
} from "@rove/protocol";

import { ControlWaitService } from "../control/control-wait.service.js";
import { ObservationService } from "../observation/observation.service.js";
import { SessionService } from "../session/session.service.js";

export type PagePolicyOrchestrationContext = "session_start" | "post_action";

function automaticHandoffObservationType(
  decision: PagePolicyDecision,
): string | undefined {
  if (decision.disposition !== "request_human") {
    return undefined;
  }

  switch (decision.reason) {
    case "authentication_required":
      return "authentication_required";

    case "human_verification_required":
      return "human_verification_required";

    default:
      // Automatic handoff is intentionally narrower than explicit
      // control.request_human.
      return undefined;
  }
}

export class PagePolicyOrchestrator {
  constructor(
    private readonly sessions: SessionService,
    private readonly observations: ObservationService,
    private readonly controlWait: ControlWaitService,
  ) {}

  async orchestrate(
    sessionId: string,
    decision: PagePolicyDecision,
    pageState: PagePerceptionAssessment,
    _context: PagePolicyOrchestrationContext,
  ): Promise<void> {
    const observationType = automaticHandoffObservationType(decision);

    if (observationType === undefined) {
      return;
    }

    const session = await this.sessions.get(sessionId);

    // Capture Mode / voluntary human ownership already has the required
    // intervention available.
    if (session.controller === "human") {
      return;
    }

    // Repeated assessment of an already-requested handoff is idempotent.
    if (session.status === "awaiting_human" && session.controller === null) {
      return;
    }

    // Automatic page-policy handoff is only valid from active agent ownership.
    if (session.status !== "active" || session.controller !== "agent") {
      return;
    }

    const requestedAt = new Date().toISOString();

    await this.sessions.update({
      ...session,
      status: "awaiting_human",
      controller: null,
      handoff: {
        reason: decision.message,
        requestedAt,
      },
    });

    const observation = await this.observations.append(sessionId, {
      actor: "system",
      type: observationType,
      data: pageState,
    });

    await this.controlWait.publish(sessionId, observation);
  }
}
