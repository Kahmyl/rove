import type {
  ActionAuthorization,
  ActionAuthorizationContext,
  BrowserActionEffect,
  BrowserActionProposal,
  PageStatePropositions,
} from "@rove/protocol";

export type {
  ActionAuthorization,
  ActionAuthorizationContext,
  BrowserActionEffect,
  BrowserActionProposal,
} from "@rove/protocol";

function isLowImpact(effect: BrowserActionEffect): boolean {
  return (
    effect === "observe" ||
    effect === "recover" ||
    effect === "navigate" ||
    effect === "reversible_ui"
  );
}

function isExitOrRecovery(effect: BrowserActionEffect): boolean {
  return effect === "recover" || effect === "navigate";
}

function truth(
  propositions: PageStatePropositions | undefined,
  key: keyof PageStatePropositions,
): boolean {
  return propositions?.[key] === true;
}

/**
 * Candidate policy for Experiment A.
 *
 * Page semantics are evidence supplied to this per-action decision. They are
 * not a page-wide mutation switch. Mechanical invariants such as controller
 * ownership, page revision, target identity, and repetition budgets continue
 * to be enforced by InteractionPolicy before this decision is consumed.
 */
export class ActionAuthorizationPolicy {
  evaluate(
    proposal: BrowserActionProposal,
    context: ActionAuthorizationContext,
  ): ActionAuthorization {
    if (!proposal.freshlyGrounded) {
      return {
        decision: "wait_and_inspect",
        reason: "fresh_grounding_required",
        constraints: [],
      };
    }

    if (proposal.effect === "observe") {
      return {
        decision: "allow",
        reason: "fresh_low_impact_action",
        constraints: [],
      };
    }

    if (proposal.effect === "credential_entry") {
      return {
        decision: "require_human_control",
        reason: "credential_entry_requires_human",
        constraints: [],
      };
    }

    if (
      context.pageState.kind === "human_verification" ||
      truth(context.propositions, "humanVerificationPresented")
    ) {
      if (isExitOrRecovery(proposal.effect)) {
        return {
          decision: "allow",
          reason: "fresh_low_impact_action",
          constraints: [],
        };
      }
      return {
        decision: "require_human_control",
        reason: "human_verification_required",
        constraints: [],
      };
    }

    // A user must handle authentication itself, but Rove may still leave the
    // page, close a prompt, or switch to another page without getting trapped.
    if (
      (context.pageState.kind === "authentication_required" ||
        truth(context.propositions, "authenticationRequired")) &&
      !isExitOrRecovery(proposal.effect)
    ) {
      return {
        decision: "require_human_control",
        reason: "authentication_required",
        constraints: [],
      };
    }

    // Instability blocks ordinary mutation, but not an explicit recovery such
    // as Back, Escape, closing the page, or switching to another page.
    if (
      (context.pageState.kind === "loading" ||
        truth(context.propositions, "documentUnstable")) &&
      proposal.effect !== "recover"
    ) {
      return {
        decision: "wait_and_inspect",
        reason: "page_unstable",
        constraints: [],
      };
    }

    if (
      (context.pageState.kind === "access_restricted" ||
        truth(context.propositions, "accessRestricted")) &&
      !isLowImpact(proposal.effect)
    ) {
      return {
        decision: "deny",
        reason: "site_access_restricted",
        constraints: [],
      };
    }

    if (
      (context.pageState.kind === "error" ||
        truth(context.propositions, "errorPresented")) &&
      !isLowImpact(proposal.effect)
    ) {
      return {
        decision: "deny",
        reason: "page_error",
        constraints: [],
      };
    }

    if (proposal.effect === "irreversible") {
      return {
        decision: "require_confirmation",
        reason: "irreversible_action_requires_confirmation",
        constraints: [],
      };
    }

    if (isLowImpact(proposal.effect)) {
      return {
        decision: "allow",
        reason: "fresh_low_impact_action",
        constraints: [],
      };
    }

    if (!proposal.explicitlyAuthorized) {
      return {
        decision: "require_confirmation",
        reason: "explicit_authority_required",
        constraints: [],
      };
    }

    if (
      proposal.effect === "external_commit" &&
      !proposal.outcomeCanBeVerified
    ) {
      return {
        decision: "deny",
        reason: "outcome_verification_required",
        constraints: [],
      };
    }

    return {
      decision: "allow",
      reason: "explicit_task_action",
      constraints:
        proposal.effect === "external_commit"
          ? [
              "verify_outcome_before_next_commit",
              "do_not_retry_on_unknown_outcome",
            ]
          : [],
    };
  }
}
