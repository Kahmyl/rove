/**
 * Historical pre-F1 page-state classifier.
 *
 * Retained only for research and benchmark reproducibility. Production browser
 * perception must use the authoritative F1 classifier. The operational
 * recommendations emitted here are historical research data and are not
 * Runtime policy.
 */

import type { PageStateAssessment } from "@rove/protocol";

export interface PageSignals {
  url?: string;
  title?: string;
  text?: string;
  rawHtml?: string;
  readyState?: string;
  httpStatus?: number;
  frameUrls?: string[];
  targetCount?: number;
}

const RESTRICTION_SIGNALS = [
  "access is temporarily restricted",
  "unusual activity from your device or network",
  "automated (bot) activity",
  "your access has been restricted",
] as const;

const EXPLICIT_VERIFICATION_SIGNALS = [
  "verify you are human",
  "confirm you are human",
  "complete the security check",
  "complete the captcha",
  "solve the captcha",
  "captcha required",
] as const;

const VERIFICATION_PROVIDER_SIGNALS = [
  "captcha",
  "hcaptcha",
  "recaptcha",
  "turnstile",
  "cf-chl-",
] as const;

const AUTHENTICATION_SIGNALS = [
  "sign in to continue",
  "log in to continue",
  "authentication required",
  "account selection",
] as const;

function matching(content: string, candidates: readonly string[]): string[] {
  return candidates.filter((signal) => content.includes(signal));
}

function assessment(
  kind: PageStateAssessment["kind"],
  confidence: PageStateAssessment["confidence"],
  signals: string[],
  recommendedAction: PageStateAssessment["recommendedAction"],
): PageStateAssessment {
  return { kind, confidence, signals, recommendedAction };
}

/**
 * Classify only from stable, explainable browser signals. Ambiguous pages are
 * deliberately not guessed as CAPTCHA or restriction pages.
 */
export function classifyPageState(input: PageSignals): PageStateAssessment {
  const visibleContent =
    `${input.title ?? ""}\n${input.text ?? ""}`.toLowerCase();
  const rawHtml = (input.rawHtml ?? "").toLowerCase();
  const frameContent = (input.frameUrls ?? []).join("\n").toLowerCase();
  const content = `${visibleContent}\n${rawHtml}\n${frameContent}`;
  const status = input.httpStatus;
  const visibleText = (input.text ?? "").trim();
  const hasUsefulDom = visibleText.length > 0 || (input.targetCount ?? 0) > 0;
  const hasRichDom = visibleText.length >= 500 || (input.targetCount ?? 0) > 10;

  const restrictions = matching(content, RESTRICTION_SIGNALS);
  if (status === 403 || status === 429 || restrictions.length > 0) {
    const signals = [
      ...(status === 403 || status === 429 ? [`http_status:${status}`] : []),
      ...restrictions.map((value) => `text:${value}`),
    ];
    return assessment("access_restricted", "high", signals, "request_human");
  }

  const explicitVisibleVerification = matching(
    visibleContent,
    EXPLICIT_VERIFICATION_SIGNALS,
  );
  const providerVisibleVerification = hasRichDom
    ? []
    : matching(visibleContent, VERIFICATION_PROVIDER_SIGNALS);
  const frameVerification = matching(
    frameContent,
    VERIFICATION_PROVIDER_SIGNALS,
  );
  const embeddedChallenge =
    /<(?:iframe|script)[^>]+(?:hcaptcha|recaptcha|turnstile|cf-chl-)/i.test(
      rawHtml,
    );
  const verification = [
    ...explicitVisibleVerification.map((value) => `visible:${value}`),
    ...providerVisibleVerification.map((value) => `visible:${value}`),
    ...(!hasUsefulDom
      ? frameVerification.map((value) => `frame:${value}`)
      : []),
    ...(!hasUsefulDom && embeddedChallenge ? ["html:embedded_challenge"] : []),
  ];
  if (verification.length > 0) {
    return assessment(
      "human_verification",
      "high",
      verification,
      "request_human",
    );
  }

  const authentication = matching(visibleContent, AUTHENTICATION_SIGNALS);
  const urlLooksLikeLogin = /\/(?:login|sign-in|signin)(?:[/?#]|$)/i.test(
    input.url ?? "",
  );
  const titleLooksLikeLogin = /^(?:log|sign) in(?:\s|$)/i.test(
    (input.title ?? "").trim(),
  );
  if (authentication.length > 0 || (urlLooksLikeLogin && titleLooksLikeLogin)) {
    return assessment(
      "authentication_required",
      "high",
      [
        ...authentication.map((value) => `text:${value}`),
        ...(urlLooksLikeLogin && titleLooksLikeLogin
          ? ["url_and_title:login"]
          : []),
      ],
      "request_human",
    );
  }

  if (status !== undefined && status >= 500) {
    return assessment("error", "high", [`http_status:${status}`], "stop");
  }

  if (input.readyState === "loading" || input.readyState === "interactive") {
    return assessment(
      "loading",
      "high",
      [`document_ready_state:${input.readyState}`],
      "wait_and_inspect",
    );
  }

  const trimmedRawHtml = (input.rawHtml ?? "").trim();
  const isHttpPage = /^https?:/i.test(input.url ?? "");
  if (
    isHttpPage &&
    input.readyState === "complete" &&
    !hasUsefulDom &&
    trimmedRawHtml.length > 200
  ) {
    return assessment(
      "unknown_interstitial",
      "medium",
      ["dom:empty_visible_content", "document_ready_state:complete"],
      "request_human",
    );
  }

  return assessment(
    "ready",
    hasUsefulDom ? "high" : "medium",
    [hasUsefulDom ? "dom:content_available" : "document:stable"],
    "continue",
  );
}

/** Backward-compatible shape for callers that only care about handoff pages. */
export function detectAccessRestriction(
  input: Pick<PageSignals, "title" | "text">,
):
  | {
      kind: "access_restricted" | "human_verification";
      reason: string;
      signals: string[];
    }
  | undefined {
  const result = classifyPageState(input);
  if (result.kind === "access_restricted") {
    return {
      kind: result.kind,
      reason: "The site has restricted access and requires human review.",
      signals: result.signals,
    };
  }
  if (result.kind === "human_verification") {
    return {
      kind: result.kind,
      reason: "The site requires a human verification step.",
      signals: result.signals,
    };
  }
  return undefined;
}
