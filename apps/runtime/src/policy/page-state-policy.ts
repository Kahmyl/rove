import type {
  PagePolicyDecision,
  PageStateAssessment,
  PageStateKind,
  PageStatePropositions,
} from "@rove/protocol";

function decisionForKnownState(
  kind: Exclude<PageStateKind, "ready">,
): PagePolicyDecision {
  switch (kind) {
    case "loading":
      return {
        disposition: "wait_and_inspect",
        reason: "page_unstable",
        mutationAllowed: false,
        retryable: true,
        errorCode: "PAGE_NOT_READY",
        message:
          "The page is still loading or unstable. Wait, then inspect it again before mutating it.",
      };

    case "authentication_required":
      return {
        disposition: "request_human",
        reason: "authentication_required",
        mutationAllowed: false,
        retryable: false,
        errorCode: "AUTHENTICATION_REQUIRED",
        message:
          "The page requires authentication that must be completed by a human.",
      };

    case "human_verification":
      return {
        disposition: "request_human",
        reason: "human_verification_required",
        mutationAllowed: false,
        retryable: false,
        errorCode: "HUMAN_VERIFICATION_REQUIRED",
        message: "The page requires a human verification step.",
      };

    case "access_restricted":
      return {
        disposition: "stop",
        reason: "access_restricted",
        mutationAllowed: false,
        retryable: false,
        errorCode: "SITE_ACCESS_RESTRICTED",
        message:
          "The site has restricted access. Stop autonomous browser mutations.",
      };

    case "unknown_interstitial":
      return {
        disposition: "stop",
        reason: "unknown_interstitial",
        mutationAllowed: false,
        retryable: false,
        errorCode: "UNKNOWN_INTERSTITIAL",
        message:
          "The page is an unrecognized blocking interstitial. Stop autonomous browser mutations.",
      };

    case "error":
      return {
        disposition: "stop",
        reason: "page_error",
        mutationAllowed: false,
        retryable: false,
        errorCode: "PAGE_NOT_READY",
        message: "The page is in an error state and cannot be mutated safely.",
      };
  }
}

function knownStateFromPropositions(
  propositions: PageStatePropositions,
): Exclude<PageStateKind, "ready"> | undefined {
  if (propositions.humanVerificationPresented === true) {
    return "human_verification";
  }

  if (propositions.authenticationRequired === true) {
    return "authentication_required";
  }

  if (propositions.accessRestricted === true) {
    return "access_restricted";
  }

  if (propositions.errorPresented === true) {
    return "error";
  }

  if (propositions.documentUnstable === true) {
    return "loading";
  }

  if (propositions.interstitialPresented === true) {
    return "unknown_interstitial";
  }

  return undefined;
}

function hasIndeterminateDecisionState(
  propositions: PageStatePropositions,
): boolean {
  return [
    propositions.documentUnstable,
    propositions.authenticationRequired,
    propositions.humanVerificationPresented,
    propositions.accessRestricted,
    propositions.errorPresented,
    propositions.interstitialPresented,
  ].some((value) => value === "indeterminate");
}

export class PageStatePolicy {
  evaluate(
    pageState: PageStateAssessment,
    propositions?: PageStatePropositions,
  ): PagePolicyDecision {
    if (propositions !== undefined) {
      const knownState = knownStateFromPropositions(propositions);

      if (knownState !== undefined) {
        return decisionForKnownState(knownState);
      }
    }

    if (pageState.kind !== "ready") {
      return decisionForKnownState(pageState.kind);
    }

    if (
      propositions === undefined ||
      hasIndeterminateDecisionState(propositions)
    ) {
      return {
        disposition: "wait_and_inspect",
        reason: "unresolved_page_state",
        mutationAllowed: false,
        retryable: true,
        message:
          "The page has unresolved decision-relevant state. Inspect it again before mutating it.",
      };
    }

    if (pageState.confidence !== "high") {
      return {
        disposition: "wait_and_inspect",
        reason: "insufficient_confidence",
        mutationAllowed: false,
        retryable: true,
        message:
          "The page is not ready with sufficient confidence. Inspect it again before mutating it.",
      };
    }

    return {
      disposition: "continue",
      reason: "page_ready",
      mutationAllowed: true,
      retryable: false,
      message: "The page is ready for autonomous mutation.",
    };
  }
}
