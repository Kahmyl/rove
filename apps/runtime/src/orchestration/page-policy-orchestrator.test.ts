import { describe, expect, it, vi } from "vitest";

import type {
  PagePerceptionAssessment,
  PagePolicyDecision,
} from "@rove/protocol";

import { OwnershipTransitionService } from "../control/ownership-transition.service.js";
import { PagePolicyOrchestrator } from "./page-policy-orchestrator.js";

const authentication: PagePerceptionAssessment = {
  kind: "authentication_required",
  confidence: "high",
  signals: ["test:authentication"],
};

const verification: PagePerceptionAssessment = {
  kind: "human_verification",
  confidence: "high",
  signals: ["test:verification"],
};

const authenticationDecision: PagePolicyDecision = {
  disposition: "request_human",
  reason: "authentication_required",
  mutationAllowed: false,
  retryable: false,
  errorCode: "AUTHENTICATION_REQUIRED",
  message:
    "The page requires authentication that must be completed by a human.",
};

const verificationDecision: PagePolicyDecision = {
  disposition: "request_human",
  reason: "human_verification_required",
  mutationAllowed: false,
  retryable: false,
  errorCode: "HUMAN_VERIFICATION_REQUIRED",
  message: "The page requires a human verification step.",
};

function harness() {
  const requestHumanForPolicy = vi.fn(async () => undefined);

  const ownershipTransitions = {
    requestHumanForPolicy,
  } as unknown as OwnershipTransitionService;

  return {
    requestHumanForPolicy,
    orchestrator: new PagePolicyOrchestrator(ownershipTransitions),
  };
}

describe("PagePolicyOrchestrator", () => {
  it.each([
    {
      disposition: "continue",
      reason: "page_ready",
      mutationAllowed: true,
      retryable: false,
      message: "ready",
    },
    {
      disposition: "wait_and_inspect",
      reason: "page_unstable",
      mutationAllowed: false,
      retryable: true,
      errorCode: "PAGE_NOT_READY",
      message: "wait",
    },
    {
      disposition: "stop",
      reason: "access_restricted",
      mutationAllowed: false,
      retryable: false,
      errorCode: "SITE_ACCESS_RESTRICTED",
      message: "stop",
    },
  ] satisfies PagePolicyDecision[])(
    "$disposition does not request an ownership transition",
    async (decision) => {
      const test = harness();

      await test.orchestrator.orchestrate(
        "ses_test",
        decision,
        authentication,
        "session_start",
      );

      expect(test.requestHumanForPolicy).not.toHaveBeenCalled();
    },
  );

  it("routes authentication handoff intent to F3 transition semantics", async () => {
    const test = harness();

    await test.orchestrator.orchestrate(
      "ses_test",
      authenticationDecision,
      authentication,
      "session_start",
    );

    expect(test.requestHumanForPolicy).toHaveBeenCalledWith("ses_test", {
      reason: authenticationDecision.message,
      observationType: "authentication_required",
      pageState: authentication,
    });
  });

  it("routes presented human verification to F3 transition semantics", async () => {
    const test = harness();

    await test.orchestrator.orchestrate(
      "ses_test",
      verificationDecision,
      verification,
      "post_action",
    );

    expect(test.requestHumanForPolicy).toHaveBeenCalledWith("ses_test", {
      reason: verificationDecision.message,
      observationType: "human_verification_required",
      pageState: verification,
    });
  });
});
