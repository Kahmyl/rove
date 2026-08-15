import { performance } from "node:perf_hooks";

import type { PageStateAssessment, PageStateKind } from "@rove/protocol";

import {
  classifyPageState,
  type PageSignals,
} from "../../safety/page-state-classifier.js";
import type { BenchmarkStrategy, PropositionSet } from "../benchmark/types.js";
import type { ResearchEvidence } from "./evidence.js";

export type Gate5StrategyName =
  | "s0-frozen-baseline"
  | "s1-presentation-gated-current"
  | "s2-proposition-first-structural"
  | "s3-proposition-first-accessibility"
  | "s4-proposition-first-stabilized"
  | "s5-structural-visual-escalation";

export interface Gate5Input {
  signals: PageSignals;
  evidence?: ResearchEvidence;
  acquisitionMs?: number;
  evidenceBytes?: number;
  visual?: {
    available: boolean;
    materiallyPainted: boolean;
    acquisitionMs: number;
    payloadBytes: number;
  };
}

interface BoundedFeatures {
  documentUnstable: boolean;
  hasOrdinaryContent: boolean;
  hasRichContent: boolean;
  explicitVerificationInstruction: boolean;
  credentialFormPresent: boolean;
  loginSurfaceTitle: boolean;
  explicitAuthenticationInstruction: boolean;
  explicitRestrictionCopy: boolean;
  restrictionStatus: boolean;
  errorStatus: boolean;
  presentedFrame: boolean;
  providerPresenceOnly: boolean;
  materialCanvasSurface: boolean;
  accessibleInterstitialLabel: boolean;
}

function includesAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}

function framePresented(evidence: ResearchEvidence | undefined): boolean {
  if (evidence === undefined) return false;
  return evidence.frames.some((frame) => {
    const element = frame.element;
    return (
      frame.depth > 0 &&
      frame.elementAcquisition === "available" &&
      element !== null &&
      element.cssVisible &&
      element.area > 4 &&
      element.viewportIntersectionRatio > 0 &&
      element.ancestorClipRatio > 0 &&
      element.topmostSampleRatio !== null &&
      element.topmostSampleRatio >= 0.5
    );
  });
}

function extractFeatures(input: Gate5Input): BoundedFeatures {
  const text =
    `${input.signals.title ?? ""}\n${input.signals.text ?? ""}`.toLowerCase();
  const html = (input.signals.rawHtml ?? "").toLowerCase();
  const visibleChars = (input.signals.text ?? "").trim().length;
  const targetCount = input.signals.targetCount ?? 0;
  const explicitVerificationInstruction = includesAny(text, [
    "verify you are human",
    "confirm you are human",
    "complete the security check",
    "complete the captcha",
    "solve the captcha",
    "captcha required",
  ]);
  const explicitAuthenticationInstruction = includesAny(text, [
    "sign in to continue",
    "log in to continue",
    "authentication required",
    "account selection",
  ]);
  const explicitRestrictionCopy = includesAny(text, [
    "access is temporarily restricted",
    "unusual activity from your device or network",
    "your access has been restricted",
  ]);
  const presentedFrame = framePresented(input.evidence);

  return {
    documentUnstable:
      input.signals.readyState === "loading" ||
      input.signals.readyState === "interactive",
    hasOrdinaryContent: visibleChars > 0 || targetCount > 0,
    hasRichContent: visibleChars >= 500 || targetCount > 10,
    explicitVerificationInstruction,
    credentialFormPresent: /<input[^>]+type=["'](?:email|password)["']/i.test(
      html,
    ),
    loginSurfaceTitle: /^(?:log|sign) in(?:\s|$)/i.test(
      (input.signals.title ?? "").trim(),
    ),
    explicitAuthenticationInstruction,
    explicitRestrictionCopy,
    restrictionStatus:
      input.signals.httpStatus === 403 || input.signals.httpStatus === 429,
    errorStatus: (input.signals.httpStatus ?? 0) >= 500,
    presentedFrame,
    providerPresenceOnly:
      !explicitVerificationInstruction &&
      ((input.signals.frameUrls?.length ?? 0) > 0 ||
        /<(?:iframe|script)[^>]+(?:captcha|recaptcha|turnstile|cf-chl-)/i.test(
          html,
        )),
    materialCanvasSurface:
      (input.evidence?.document.canvasCount ?? 0) > 0 && visibleChars === 0,
    accessibleInterstitialLabel:
      /aria-label=["'][^"']*(?:intervening|challenge|verification)[^"']*["']/i.test(
        html,
      ),
  };
}

function derivePrimaryState(propositions: PropositionSet): PageStateKind {
  if (propositions.humanVerificationPresented === true)
    return "human_verification";
  if (propositions.authenticationRequired === true)
    return "authentication_required";
  if (propositions.accessRestricted === true) return "access_restricted";
  if (propositions.errorPresented === true) return "error";
  if (propositions.documentUnstable === true) return "loading";
  if (propositions.interstitialPresented === true)
    return "unknown_interstitial";
  return "ready";
}

function recommendedAction(
  kind: PageStateKind,
): PageStateAssessment["recommendedAction"] {
  if (kind === "ready") return "continue";
  if (kind === "loading") return "wait_and_inspect";
  if (kind === "error") return "stop";
  return "request_human";
}

function inferPropositions(
  features: BoundedFeatures,
  options: { accessibility: boolean; visual: boolean; visualPainted: boolean },
): { propositions: PropositionSet; signals: string[]; escalated: boolean } {
  const humanVerificationPresented = features.explicitVerificationInstruction;
  const authenticationRequired =
    features.explicitAuthenticationInstruction &&
    (features.credentialFormPresent || features.loginSurfaceTitle);
  const accessRestricted =
    features.restrictionStatus || features.explicitRestrictionCopy;
  const errorPresented = features.errorStatus;
  const semanticInterstitial =
    humanVerificationPresented ||
    authenticationRequired ||
    accessRestricted ||
    errorPresented;
  const accessibilityInterstitial =
    options.accessibility &&
    features.materialCanvasSurface &&
    features.accessibleInterstitialLabel;
  const escalated = options.visual && features.materialCanvasSurface;
  const visualInterstitial = escalated && options.visualPainted;
  const interstitialPresented =
    semanticInterstitial || accessibilityInterstitial || visualInterstitial;
  const primaryContentAvailable =
    features.hasOrdinaryContent &&
    (!semanticInterstitial || features.hasRichContent);

  const signals = [
    features.documentUnstable ? "document:unstable" : "document:stable",
    ...(features.providerPresenceOnly
      ? ["verification:provider_presence_only"]
      : []),
    ...(features.explicitVerificationInstruction
      ? ["verification:explicit_instruction"]
      : []),
    ...(features.presentedFrame ? ["verification:presented_frame"] : []),
    ...(authenticationRequired ? ["auth:credential_form_present"] : []),
    ...(features.restrictionStatus ? ["restriction:http_status"] : []),
    ...(features.explicitRestrictionCopy ? ["restriction:explicit_copy"] : []),
    ...(errorPresented ? ["error:http_5xx"] : []),
    ...(accessibilityInterstitial
      ? ["interstitial:accessible_surface_label"]
      : []),
    ...(visualInterstitial ? ["interstitial:painted_visual_surface"] : []),
  ];

  return {
    propositions: {
      primaryContentAvailable,
      documentUnstable: features.documentUnstable && !semanticInterstitial,
      authenticationRequired,
      humanVerificationPresented,
      accessRestricted,
      errorPresented,
      interstitialPresented,
    },
    signals,
    escalated,
  };
}

function propositionStrategy(
  name: Gate5StrategyName,
  options: { accessibility: boolean; visual: boolean },
): BenchmarkStrategy<Gate5Input> {
  return {
    name,
    predict(input) {
      const started = performance.now();
      const features = extractFeatures(input);
      const inferred = inferPropositions(features, {
        ...options,
        visualPainted: input.visual?.materiallyPainted === true,
      });
      const kind = derivePrimaryState(inferred.propositions);
      const inferenceMs = performance.now() - started;
      const assessment: PageStateAssessment = {
        kind,
        confidence:
          kind === "unknown_interstitial" ||
          (kind === "ready" && !features.hasOrdinaryContent)
            ? "medium"
            : inferred.signals.length > 1
              ? "high"
              : "medium",
        signals: inferred.signals,
        recommendedAction: recommendedAction(kind),
      };
      const persisted = { assessment, propositions: inferred.propositions };

      return {
        assessment,
        propositions: inferred.propositions,
        timing: {
          ...(input.acquisitionMs === undefined
            ? {}
            : { acquisitionMs: input.acquisitionMs }),
          inferenceMs,
          totalMs:
            (input.acquisitionMs ?? 0) +
            inferenceMs +
            (inferred.escalated ? (input.visual?.acquisitionMs ?? 0) : 0),
        },
        payload: {
          ...(input.evidenceBytes === undefined
            ? {}
            : { evidenceBytes: input.evidenceBytes }),
          persistedArtifactBytes: Buffer.byteLength(JSON.stringify(persisted)),
        },
      };
    },
  };
}

export function gate5Strategies(): BenchmarkStrategy<Gate5Input>[] {
  return [
    {
      name: "s0-frozen-baseline",
      predict: (input) => ({ assessment: classifyPageState(input.signals) }),
    },
    {
      name: "s1-presentation-gated-current",
      predict(input) {
        const baseline = classifyPageState(input.signals);
        const features = extractFeatures(input);
        if (
          baseline.kind === "human_verification" &&
          !features.explicitVerificationInstruction
        ) {
          return {
            assessment: {
              kind: "ready",
              confidence: "medium",
              signals: [
                "verification:provider_presence_only",
                "document:stable",
              ],
              recommendedAction: "continue",
            },
          };
        }
        return { assessment: baseline };
      },
    },
    propositionStrategy("s2-proposition-first-structural", {
      accessibility: false,
      visual: false,
    }),
    propositionStrategy("s3-proposition-first-accessibility", {
      accessibility: true,
      visual: false,
    }),
    propositionStrategy("s4-proposition-first-stabilized", {
      accessibility: true,
      visual: false,
    }),
    propositionStrategy("s5-structural-visual-escalation", {
      accessibility: false,
      visual: true,
    }),
  ];
}

export const gate5Internals = {
  extractFeatures,
  inferPropositions,
  derivePrimaryState,
};
