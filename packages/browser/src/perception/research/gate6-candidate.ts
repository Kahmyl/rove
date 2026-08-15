import { performance } from "node:perf_hooks";

import type { PageStateAssessment, PageStateKind } from "@rove/protocol";

import type { BenchmarkStrategy, PropositionSet } from "../benchmark/types.js";
import type { Gate5Input } from "./gate5-strategies.js";
import type { ResearchEvidence } from "./evidence.js";

export interface Gate6AccessibilitySemantics {
  available: boolean;
  verificationCue: boolean;
  authenticationCue: boolean;
  restrictionCue: boolean;
  errorCue: boolean;
  interstitialCue: boolean;
}

export interface Gate6DomSemantics {
  available: boolean;
  visibleChars: number;
  interactiveCount: number;
  ariaBusyCount: number;
  verificationHeadingDirective: boolean;
  authenticationHeadingCue: boolean;
  restrictionHeadingOrAlertCue: boolean;
  errorHeadingOrAlertCue: boolean;
  credentialInputCount: number;
  passwordInputCount: number;
  accountChooserPresent: boolean;
  blockingDialogPresent: boolean;
  semanticVerificationFrameOrdinals: number[];
  visibleCanvasCount: number;
  interstitialCanvasPresented: boolean;
  nonInterstitialCanvasPresented: boolean;
}

export interface Gate6CandidateInput extends Gate5Input {
  accessibilitySemantics?: Gate6AccessibilitySemantics;
  domSemantics?: Gate6DomSemantics;
}

function isFramePresented(
  evidence: ResearchEvidence | undefined,
  requiredOrdinals?: ReadonlySet<number>,
): boolean {
  if (evidence === undefined) return false;

  return evidence.frames.some((frame) => {
    if (frame.depth === 0) return false;
    if (
      requiredOrdinals !== undefined &&
      (frame.domOrdinal === null || !requiredOrdinals.has(frame.domOrdinal))
    ) {
      return false;
    }

    const element = frame.element;

    return (
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

function recommendedAction(
  kind: PageStateKind,
): PageStateAssessment["recommendedAction"] {
  if (kind === "ready") return "continue";
  if (kind === "loading") return "wait_and_inspect";
  if (kind === "error") return "stop";
  return "request_human";
}

function derivePrimaryState(propositions: PropositionSet): PageStateKind {
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
  return "ready";
}

function confidenceFor(
  kind: PageStateKind,
  facts: {
    semanticEvidenceAvailable: boolean;
    directVerification: boolean;
    directAuthentication: boolean;
    directRestriction: boolean;
    directError: boolean;
    ambiguousVerificationMention: boolean;
    unresolvedSemanticFrame: boolean;
    ordinaryPrimarySurface: boolean;
  },
): PageStateAssessment["confidence"] {
  switch (kind) {
    case "human_verification":
      return facts.directVerification ? "high" : "medium";
    case "authentication_required":
      return facts.directAuthentication ? "high" : "medium";
    case "access_restricted":
      return facts.directRestriction ? "high" : "medium";
    case "error":
      return facts.directError ? "high" : "medium";
    case "unknown_interstitial":
    case "loading":
      return "medium";
    case "ready":
      if (
        !facts.semanticEvidenceAvailable ||
        facts.ambiguousVerificationMention ||
        facts.unresolvedSemanticFrame ||
        !facts.ordinaryPrimarySurface
      ) {
        return "medium";
      }
      return "high";
  }
}

export function gate6CandidateStrategy(): BenchmarkStrategy<Gate6CandidateInput> {
  return {
    name: "gate6-s4r-structural-semantic",
    predict(input) {
      const started = performance.now();
      const dom = input.domSemantics;
      const accessibility = input.accessibilitySemantics;

      const genericPresentedFrame = isFramePresented(input.evidence);
      const semanticOrdinals = new Set(
        dom?.semanticVerificationFrameOrdinals ?? [],
      );
      const presentedSemanticVerificationFrame =
        semanticOrdinals.size > 0 &&
        isFramePresented(input.evidence, semanticOrdinals);

      const accessibilityVerificationCue =
        accessibility?.available === true && accessibility.verificationCue;
      const verificationHeadingDirective =
        dom?.verificationHeadingDirective === true;

      const humanVerificationPresented =
        verificationHeadingDirective ||
        presentedSemanticVerificationFrame ||
        (genericPresentedFrame && accessibilityVerificationCue);

      const authenticationRequired =
        dom?.authenticationHeadingCue === true ||
        (accessibility?.available === true &&
          accessibility.authenticationCue &&
          ((dom?.credentialInputCount ?? 0) > 0 ||
            dom?.accountChooserPresent === true));

      const accessRestricted =
        input.signals.httpStatus === 403 ||
        input.signals.httpStatus === 429 ||
        dom?.restrictionHeadingOrAlertCue === true;

      const errorPresented =
        (input.signals.httpStatus ?? 0) >= 500 ||
        dom?.errorHeadingOrAlertCue === true;

      const semanticBlocker =
        humanVerificationPresented ||
        authenticationRequired ||
        accessRestricted ||
        errorPresented;

      const blockingUnknownSurface =
        dom?.blockingDialogPresent === true ||
        dom?.interstitialCanvasPresented === true;

      const interstitialPresented = semanticBlocker || blockingUnknownSurface;

      const rawDocumentUnstable =
        input.signals.readyState === "loading" || (dom?.ariaBusyCount ?? 0) > 0;

      const documentUnstable = rawDocumentUnstable && !semanticBlocker;

      const visibleChars =
        dom?.visibleChars ?? (input.signals.text ?? "").trim().length;
      const interactiveCount =
        dom?.interactiveCount ?? input.signals.targetCount ?? 0;

      const ordinaryPrimarySurface =
        visibleChars > 0 ||
        interactiveCount > 0 ||
        dom?.nonInterstitialCanvasPresented === true;

      const richPrimarySurface = visibleChars >= 500 || interactiveCount > 10;

      const primaryContentAvailable =
        semanticBlocker || blockingUnknownSurface
          ? richPrimarySurface
          : ordinaryPrimarySurface;

      const propositions: PropositionSet = {
        primaryContentAvailable,
        documentUnstable,
        authenticationRequired,
        humanVerificationPresented,
        accessRestricted,
        errorPresented,
        interstitialPresented,
      };

      const kind = derivePrimaryState(propositions);

      const anyFrameEvidenceUnavailable = (input.evidence?.frames ?? []).some(
        (frame) =>
          frame.depth > 0 && frame.elementAcquisition === "unavailable",
      );
      const unresolvedSemanticFrame =
        semanticOrdinals.size > 0 &&
        (!presentedSemanticVerificationFrame || anyFrameEvidenceUnavailable);
      const ambiguousVerificationMention =
        accessibilityVerificationCue && !humanVerificationPresented;

      const directVerification =
        verificationHeadingDirective ||
        presentedSemanticVerificationFrame ||
        (genericPresentedFrame && accessibilityVerificationCue);
      const directAuthentication =
        dom?.authenticationHeadingCue === true &&
        ((dom?.credentialInputCount ?? 0) > 0 ||
          dom?.accountChooserPresent === true);
      const directRestriction =
        input.signals.httpStatus === 403 ||
        input.signals.httpStatus === 429 ||
        dom?.restrictionHeadingOrAlertCue === true;
      const directError =
        (input.signals.httpStatus ?? 0) >= 500 ||
        dom?.errorHeadingOrAlertCue === true;

      const signals = [
        documentUnstable ? "document:unstable" : "document:stable",
        ...(verificationHeadingDirective
          ? ["verification:directive_heading"]
          : []),
        ...(presentedSemanticVerificationFrame
          ? ["verification:semantic_frame_presented"]
          : []),
        ...(genericPresentedFrame && accessibilityVerificationCue
          ? ["verification:presented_frame_semantic_corroboration"]
          : []),
        ...(ambiguousVerificationMention
          ? ["verification:semantic_mention_without_blocking_surface"]
          : []),
        ...(authenticationRequired ? ["auth:structural_semantic_surface"] : []),
        ...(accessRestricted
          ? [
              input.signals.httpStatus === 403 ||
              input.signals.httpStatus === 429
                ? "restriction:http_status"
                : "restriction:heading_or_alert_semantics",
            ]
          : []),
        ...(errorPresented
          ? [
              (input.signals.httpStatus ?? 0) >= 500
                ? "error:http_5xx"
                : "error:heading_or_alert_semantics",
            ]
          : []),
        ...(blockingUnknownSurface && !semanticBlocker
          ? ["interstitial:blocking_structural_surface"]
          : []),
        ...(unresolvedSemanticFrame
          ? ["evidence:verification_presentation_unresolved"]
          : []),
      ];

      const assessment: PageStateAssessment = {
        kind,
        confidence: confidenceFor(kind, {
          semanticEvidenceAvailable:
            dom?.available === true && accessibility?.available === true,
          directVerification,
          directAuthentication,
          directRestriction,
          directError,
          ambiguousVerificationMention,
          unresolvedSemanticFrame,
          ordinaryPrimarySurface,
        }),
        signals,
        recommendedAction: recommendedAction(kind),
      };

      const inferenceMs = performance.now() - started;
      const persisted = {
        assessment,
        propositions,
      };

      return {
        assessment,
        propositions,
        timing: {
          ...(input.acquisitionMs === undefined
            ? {}
            : { acquisitionMs: input.acquisitionMs }),
          inferenceMs,
          totalMs: (input.acquisitionMs ?? 0) + inferenceMs,
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
