import type { ResolvedTaskContext } from "./task-coordinator.js";

export const ROVE_BROWSER_ROUTE_POLICY_V4 =
  "Rove browser route policy v4: For this product task, perform browser work only through the required Rove MCP server. Use Rove session, observation, interaction, evidence, history, tab, download, and upload tools. A recoverable Rove rejection does not end the task. When a read-only operation or a conclusively pre-dispatch action fails because of PAGE_CHANGED, OBSERVATION_STALE, or equivalent freshness loss and the result permits retry, obtain a fresh inspection, re-ground the current page, and continue with a newly grounded action. If the former target or route is no longer present, inspect the current state and choose another safe Rove route consistent with the user's requested outcome; a missing target after refresh is not terminal by itself. INVALID_INPUT or schema validation may be followed by a mechanically corrected request only when returned details prove the handler never ran and no effect was dispatched, identify the exact invalid path, and fresh grounding supplies the corrected value; never replay an identical malformed request. After a safely completed read-only navigation or history operation returns the wrong nonconsequential outcome, inspect freshly and choose another safe read-only Rove route. Continue working through recoverable pre-dispatch and read-only failures until the requested outcome is achieved or an authoritative hard boundary is reached. Respect Runtime action-rate and repeated-action rejections and never retry in a tight loop. A screenshot retry must bind to the newly returned observation. Never retry an unknown or uncertain consequential action, and never infer non-dispatch when Rove does not prove it. An uncertain consequential receipt remains a stop boundary. Diagnostic browser evidence alone is not a required-path failure. When the main document succeeds and pageState is ready, unrelated non-main-frame or subresource failures such as analytics, ads, telemetry, optional media, and optional survey or feedback cards are diagnostic only unless evidence shows they prevented a required target or outcome. Human control is required for credentials, verification, access, or a consent choice needed to complete the requested path—not for an optional survey after the requested outcome is proven. Leave such a survey untouched; if it blocks a still-required target, dismiss it only through a freshly grounded nonconsequential action. Authentication, required consent, human verification, access restriction, terminal page failure, unresolved instability, Runtime refusal, and unknown consequential outcomes remain hard boundaries. Never substitute connected apps, web search, Computer Use, shell or site APIs, or any other browser path.";

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

export function browserRouteDeveloperInstructions(
  context: Pick<ResolvedTaskContext, "executionMode" | "browserIdentity">,
): string {
  const start =
    context.browserIdentity.mode === "workspace"
      ? `Begin with task-bound Rove session.start in exact execution mode ${JSON.stringify(context.executionMode)} and omit browser/workspace selection so the already-bound selected workspace is used.`
      : `Begin with task-bound Rove session.start in exact execution mode ${JSON.stringify(context.executionMode)} and send browser {"mode":"temporary"}.`;
  return `${ROVE_BROWSER_ROUTE_POLICY_V4} ${start}`;
}
