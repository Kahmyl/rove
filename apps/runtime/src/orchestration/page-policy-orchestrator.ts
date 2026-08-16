import type {
  PagePerceptionAssessment,
  PagePolicyDecision,
} from "@rove/protocol";

import { OwnershipTransitionService } from "../control/ownership-transition.service.js";

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
      // Automatic handoff is intentionally
      // narrower than explicit control.request_human.
      return undefined;
  }
}

export class PagePolicyOrchestrator {
  constructor(
    private readonly ownershipTransitions: OwnershipTransitionService,
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

    // F2 decides WHY automatic human intervention
    // is required. F3 owns HOW browser ownership
    // changes safely.
    await this.ownershipTransitions.requestHumanForPolicy(sessionId, {
      reason: decision.message,
      observationType,
      pageState,
    });
  }
}
