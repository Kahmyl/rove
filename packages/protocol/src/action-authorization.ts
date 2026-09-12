import type {
  BrowserActionType,
  PagePerceptionAssessment,
  PageStatePropositions,
} from "./types.js";

/**
 * Consequence is separate from browser verb: a click can dismiss a popover,
 * submit a form, send a message, or delete an account.
 */
export type BrowserActionEffect =
  | "observe"
  | "recover"
  | "navigate"
  | "reversible_ui"
  | "edit_content"
  | "external_commit"
  | "irreversible"
  | "credential_entry";

export interface BrowserActionProposal {
  action: BrowserActionType;
  effect: BrowserActionEffect;
  explicitlyAuthorized: boolean;
  freshlyGrounded: boolean;
  outcomeCanBeVerified: boolean;
}

export type ActionAuthorizationDecision =
  | "allow"
  | "wait_and_inspect"
  | "require_confirmation"
  | "require_human_control"
  | "deny";

export type ActionAuthorizationConstraint =
  | "verify_outcome_before_next_commit"
  | "do_not_retry_on_unknown_outcome";

export interface ActionAuthorization {
  decision: ActionAuthorizationDecision;
  reason:
    | "fresh_low_impact_action"
    | "explicit_task_action"
    | "fresh_grounding_required"
    | "page_unstable"
    | "human_verification_required"
    | "authentication_required"
    | "site_access_restricted"
    | "page_error"
    | "credential_entry_requires_human"
    | "explicit_authority_required"
    | "irreversible_action_requires_confirmation"
    | "outcome_verification_required";
  constraints: ActionAuthorizationConstraint[];
}

export interface ActionAuthorizationContext {
  pageState: PagePerceptionAssessment;
  propositions?: PageStatePropositions;
}
