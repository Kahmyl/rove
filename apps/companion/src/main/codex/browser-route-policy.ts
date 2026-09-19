import type {
  BrowserIdentity,
  ResolvedTaskContext,
} from "./task-coordinator.js";
import { MAX_BROWSER_RECOVERY_ATTEMPTS_PER_OPERATION } from "@rove/protocol";

export const ROVE_BROWSER_ROUTE_POLICY =
  "Rove browser route policy: Browser operations for this product task must use the task-bound Rove MCP browser authority. Use its session, observation, interaction, evidence, history, tab, download, and upload tools; never use another browser path to evade access, consent, service restrictions, task ownership, or Runtime refusal. When a read-only operation or conclusively pre-dispatch action loses freshness and the receipt permits retry, obtain a fresh inspection, re-ground the current page, and retry only within the small per-step recovery budget. Every recovery retry must carry the same stable recovery operation identity; Runtime persists two admitted attempts and refuses the third. A screenshot retry must bind to the newly returned observation. A missing target after refresh may be replaced by another freshly grounded safe Rove route consistent with the requested outcome. An INVALID_INPUT or schema-validation failure may use a mechanically corrected request only when details prove the handler never ran and nothing was dispatched, identify the invalid path, and fresh grounding supplies a different valid request; never replay an identical malformed request. A safely completed read-only operation with the wrong nonconsequential outcome may use another freshly grounded safe Rove route within the same budget. When that budget is exhausted, stop browser recovery truthfully. Never retry an unknown or uncertain consequential action, and never infer non-dispatch when Rove does not prove it; an uncertain consequential receipt is an immediate no-replay mutation boundary across every capability. It is not a stop on read-only investigation: when useful, wait, inspect freshly, scroll or search read-only, open or navigate to an authorized read view, gather permitted screenshot evidence, then call browser.reconcile_outcome with the exact existing consequence key and a fresh observation. None of those reads may replay the mutation through another capability, expand authorization, or turn uncertainty into inferred non-dispatch. If reconciliation still cannot settle the effect, leave it unresolved or request human reconciliation where appropriate. A conclusively pre-dispatch or read-only browser failure does not globally prohibit a separately authorized integration, plugin, API, or suitable CLI when it is a legitimate capability for the requested outcome and applicable service rules permit it. Such a capability must not bypass a restriction, expand authorization, or replay an unresolved effect. Diagnostic browser evidence alone is not a required-path failure. When the main document succeeds and pageState is ready, unrelated non-main-frame or subresource failures such as analytics, ads, telemetry, optional media, and optional survey or feedback cards are diagnostic only unless evidence shows they prevented a required target or outcome. Human control is required for credentials, verification, access, or a consent choice needed to complete the requested path—not for an optional survey after the requested outcome is proven. Leave such a survey untouched; if it blocks a still-required target, dismiss it only through a freshly grounded nonconsequential action. Authentication, required consent, human verification, access restriction, terminal page failure, unresolved instability, and Runtime refusal remain hard boundaries.";

export const MAX_BROWSER_RECOVERY_ATTEMPTS_PER_STEP =
  MAX_BROWSER_RECOVERY_ATTEMPTS_PER_OPERATION;

export type BrowserRouteRecoveryInput = {
  kind: "freshness" | "invalid_input" | "read_only_outcome";
  attemptsForStep: number;
  retryable: boolean;
  readOnly: boolean;
  conclusivelyPreDispatch: boolean;
  handlerRan: boolean;
  dispatchStatus: "not_dispatched" | "completed" | "unknown";
  sameRequest: boolean;
  validationPath?: readonly string[] | undefined;
  freshGrounding: boolean;
  blockingBoundary: boolean;
  consequential: boolean;
};

export type BrowserRouteRecoveryDisposition =
  "fresh_retry" | "corrected_request" | "alternate_read_only_route" | "stop";

export function browserRouteRecoveryDisposition(
  input: BrowserRouteRecoveryInput,
): BrowserRouteRecoveryDisposition {
  if (
    input.blockingBoundary ||
    input.dispatchStatus === "unknown" ||
    (input.consequential && input.dispatchStatus !== "not_dispatched")
  )
    return "stop";
  if (
    !Number.isSafeInteger(input.attemptsForStep) ||
    input.attemptsForStep < 0 ||
    input.attemptsForStep >= MAX_BROWSER_RECOVERY_ATTEMPTS_PER_STEP
  )
    return "stop";

  if (input.kind === "invalid_input")
    return !input.handlerRan &&
      input.dispatchStatus === "not_dispatched" &&
      input.conclusivelyPreDispatch &&
      !input.sameRequest &&
      Boolean(input.validationPath?.length) &&
      input.freshGrounding
      ? "corrected_request"
      : "stop";

  if (input.kind === "read_only_outcome")
    return input.readOnly &&
      !input.consequential &&
      input.dispatchStatus === "completed" &&
      input.freshGrounding
      ? "alternate_read_only_route"
      : "stop";

  return input.retryable &&
    (input.readOnly || input.conclusivelyPreDispatch) &&
    input.freshGrounding
    ? "fresh_retry"
    : "stop";
}

export type BrowserAlternateCapabilityInput = {
  browserFailure: "read_only" | "conclusively_pre_dispatch" | "hard_boundary";
  authorized: boolean;
  suitableForRequestedOutcome: boolean;
  serviceRulesPermit: boolean;
  wouldBypassRestriction: boolean;
  wouldExpandAuthorization: boolean;
  wouldReplayUnresolvedEffect: boolean;
  consequentialOutcome: "not_dispatched" | "completed" | "unknown";
};

export function browserAlternateCapabilityDisposition(
  input: BrowserAlternateCapabilityInput,
): "use_authorized_alternate" | "stop" {
  if (
    input.browserFailure === "hard_boundary" ||
    !input.authorized ||
    !input.suitableForRequestedOutcome ||
    !input.serviceRulesPermit ||
    input.wouldBypassRestriction ||
    input.wouldExpandAuthorization ||
    input.wouldReplayUnresolvedEffect ||
    input.consequentialOutcome === "unknown" ||
    (input.browserFailure === "conclusively_pre_dispatch" &&
      input.consequentialOutcome !== "not_dispatched")
  )
    return "stop";
  return "use_authorized_alternate";
}

export type BrowserRoutePageInput = {
  pageReady: boolean;
  primaryContentAvailable: boolean;
  authenticationRequired: boolean;
  humanVerificationPresented: boolean;
  accessRestricted: boolean;
  terminalErrorPresented: boolean;
  requiredConsentPresented: boolean;
  optionalSurveyPresented: boolean;
  requiredOutcomeProven: boolean;
  optionalSurveyBlocksRequiredTarget: boolean;
  freshDismissTargetGrounded: boolean;
};

export function browserRoutePageDisposition(
  input: BrowserRoutePageInput,
): "continue" | "dismiss_optional" | "request_human" | "stop" {
  if (input.authenticationRequired || input.humanVerificationPresented)
    return "request_human";
  if (input.accessRestricted || input.terminalErrorPresented) return "stop";
  if (input.requiredConsentPresented) return "request_human";
  if (!input.pageReady || !input.primaryContentAvailable) return "stop";
  if (!input.optionalSurveyPresented) return "continue";
  if (input.requiredOutcomeProven) return "continue";
  return input.optionalSurveyBlocksRequiredTarget &&
    input.freshDismissTargetGrounded
    ? "dismiss_optional"
    : "stop";
}

export function browserRouteDeveloperInstructions(context: {
  executionMode: ResolvedTaskContext["executionMode"];
  browserIdentity?: BrowserIdentity;
}): string {
  const start =
    context.browserIdentity?.mode === "workspace"
      ? `Begin with task-bound Rove session.start in exact execution mode ${JSON.stringify(context.executionMode)} and omit browser/workspace selection so the already-bound selected workspace is used.`
      : context.browserIdentity?.mode === "temporary"
        ? `Begin with task-bound Rove session.start in exact execution mode ${JSON.stringify(context.executionMode)} and send browser {"mode":"temporary"}.`
        : `Only when browser work is actually needed, begin with task-bound Rove session.start in exact execution mode ${JSON.stringify(context.executionMode)}; omit browser selection to acquire the currently selected Rove browser profile then.`;
  return `${ROVE_BROWSER_ROUTE_POLICY} Browser resources are on-demand and must not be started for non-browser work. ${start}`;
}
