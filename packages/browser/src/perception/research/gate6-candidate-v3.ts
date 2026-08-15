import { performance } from "node:perf_hooks";

import type { PageStateAssessment, PageStateKind } from "@rove/protocol";

import type { BenchmarkStrategy, PropositionSet } from "../benchmark/types.js";
import type { ResearchEvidence } from "./evidence.js";
import type { Gate5Input } from "./gate5-strategies.js";
import type { Gate6SurfaceFactsV3 } from "./gate6-semantics-v3.js";

type Truth = true | false | "indeterminate";

export interface Gate6CandidateV3Input extends Gate5Input {
  surfaceFacts?: Gate6SurfaceFactsV3;
}

function presented(element: {
  cssVisible: boolean;
  area: number;
  viewportIntersectionRatio: number;
  ancestorClipRatio: number;
  topmostSampleRatio: number | null;
}): boolean {
  return (
    element.cssVisible &&
    element.area > 4 &&
    element.viewportIntersectionRatio > 0 &&
    element.ancestorClipRatio > 0 &&
    element.topmostSampleRatio !== null &&
    element.topmostSampleRatio >= 0.5
  );
}

function framePresentation(
  evidence: ResearchEvidence | undefined,
  domOrdinals: ReadonlySet<number>,
  expectedFrameCount: number,
): Truth {
  if (domOrdinals.size === 0) {
    return false;
  }

  if (evidence === undefined) {
    return "indeterminate";
  }

  let matched = 0;
  let unavailable = false;

  for (const frame of evidence.frames) {
    if (
      frame.depth === 0 ||
      frame.domOrdinal === null ||
      !domOrdinals.has(frame.domOrdinal)
    ) {
      continue;
    }

    matched += 1;

    if (frame.elementAcquisition === "unavailable") {
      unavailable = true;
      continue;
    }

    if (
      frame.elementAcquisition === "available" &&
      frame.element !== null &&
      presented(frame.element)
    ) {
      return true;
    }
  }

  if (unavailable || matched < Math.min(domOrdinals.size, expectedFrameCount)) {
    return "indeterminate";
  }

  return false;
}

function statusRestriction(status: number | undefined): boolean {
  return status === 403 || status === 429 || status === 451;
}

function statusAuthentication(status: number | undefined): boolean {
  return status === 401 || status === 407;
}

function statusError(status: number | undefined): boolean {
  return (
    status === 404 || status === 410 || (status !== undefined && status >= 500)
  );
}

function anyTrue(values: Truth[]): boolean {
  return values.some((value) => value === true);
}

function anyIndeterminate(values: Truth[]): boolean {
  return values.some((value) => value === "indeterminate");
}

function disposition(
  kind: PageStateKind,
): PageStateAssessment["recommendedAction"] {
  if (kind === "ready") {
    return "continue";
  }

  if (kind === "loading") {
    return "wait_and_inspect";
  }

  if (kind === "error") {
    return "stop";
  }

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

export function gate6CandidateV3Strategy(): BenchmarkStrategy<Gate6CandidateV3Input> {
  return {
    name: "gate6-s4r3-workflow-scope",
    predict(input) {
      const started = performance.now();
      const facts = input.surfaceFacts;

      const semanticFramePresentation = framePresentation(
        input.evidence,
        new Set(facts?.semanticVerificationFrameOrdinals ?? []),
        facts?.iframeCount ?? 0,
      );

      const localFramePresentation = framePresentation(
        input.evidence,
        new Set(facts?.localVerificationFrameOrdinals ?? []),
        facts?.iframeCount ?? 0,
      );

      let humanVerificationPresented: Truth = false;

      if (
        facts?.blockingDialogVerificationCue === true ||
        facts?.activeVerificationDirective === true ||
        semanticFramePresentation === true ||
        localFramePresentation === true
      ) {
        humanVerificationPresented = true;
      } else if (
        semanticFramePresentation === "indeterminate" ||
        localFramePresentation === "indeterminate"
      ) {
        humanVerificationPresented = "indeterminate";
      }

      const authenticationRequired: Truth =
        statusAuthentication(input.signals.httpStatus) ||
        facts?.authenticationDirectiveActive === true ||
        facts?.credentialGateActive === true ||
        facts?.identityChooserPresent === true ||
        facts?.passkeyGateActive === true;

      const accessRestricted: Truth =
        statusRestriction(input.signals.httpStatus) ||
        facts?.restrictionBlockingCue === true;

      const errorPresented: Truth =
        statusError(input.signals.httpStatus) ||
        facts?.errorBlockingCue === true;

      const knownBlockers = [
        humanVerificationPresented,
        authenticationRequired,
        accessRestricted,
        errorPresented,
      ];

      const knownBlockerTrue = anyTrue(knownBlockers);

      const blockingUnknownSurface =
        facts?.blockingDialogPresent === true ||
        facts?.interstitialCanvasPresented === true;

      let interstitialPresented: Truth;

      if (knownBlockerTrue || blockingUnknownSurface) {
        interstitialPresented = true;
      } else if (anyIndeterminate(knownBlockers)) {
        interstitialPresented = "indeterminate";
      } else {
        interstitialPresented = false;
      }

      const rawUnstable =
        input.signals.readyState === "loading" ||
        (facts?.ariaBusyCount ?? 0) > 0;

      const documentUnstable = rawUnstable && !knownBlockerTrue;

      const visibleChars =
        facts?.visibleChars ?? (input.signals.text ?? "").trim().length;

      const interactiveCount =
        facts?.interactiveCount ?? input.signals.targetCount ?? 0;

      const ordinaryPrimarySurface =
        visibleChars > 0 ||
        interactiveCount > 0 ||
        facts?.nonInterstitialCanvasPresented === true;

      const richPrimarySurface =
        visibleChars >= 500 || (facts?.primaryInteractiveCount ?? 0) > 10;

      const primaryContentAvailable =
        knownBlockerTrue || blockingUnknownSurface
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

      const unresolvedBlocker = anyIndeterminate([
        humanVerificationPresented,
        authenticationRequired,
        accessRestricted,
        errorPresented,
        interstitialPresented,
      ]);

      let confidence: PageStateAssessment["confidence"];

      if (kind === "loading" || kind === "unknown_interstitial") {
        confidence = "medium";
      } else if (kind === "ready") {
        confidence =
          facts?.available === true && !unresolvedBlocker ? "high" : "medium";
      } else {
        confidence = "high";
      }

      const signals = [
        documentUnstable ? "document:unstable" : "document:stable",

        ...(facts?.metaContentContext === true ? ["scope:meta_content"] : []),

        ...(facts?.settingsContext === true ? ["scope:settings"] : []),

        ...(humanVerificationPresented === true
          ? [
              facts?.blockingDialogVerificationCue === true
                ? "verification:blocking_dialog"
                : facts?.activeVerificationDirective === true
                  ? "verification:active_workflow_directive"
                  : semanticFramePresentation === true
                    ? "verification:presented_semantic_frame"
                    : "verification:local_directive_presented_frame",
            ]
          : []),

        ...(humanVerificationPresented === "indeterminate"
          ? ["verification:presentation_indeterminate"]
          : []),

        ...(authenticationRequired === true
          ? [
              statusAuthentication(input.signals.httpStatus)
                ? "auth:http_status"
                : facts?.passkeyGateActive
                  ? "auth:passkey_gate"
                  : facts?.identityChooserPresent
                    ? "auth:identity_chooser"
                    : facts?.credentialGateActive
                      ? "auth:credential_gate"
                      : "auth:workflow_directive",
            ]
          : []),

        ...(accessRestricted === true
          ? [
              statusRestriction(input.signals.httpStatus)
                ? "restriction:http_status"
                : "restriction:workflow_blocking_surface",
            ]
          : []),

        ...(errorPresented === true
          ? [
              statusError(input.signals.httpStatus)
                ? "error:http_status"
                : "error:workflow_blocking_surface",
            ]
          : []),

        ...(blockingUnknownSurface && !knownBlockerTrue
          ? ["interstitial:blocking_unknown_surface"]
          : []),
      ];

      const assessment: PageStateAssessment = {
        kind,
        confidence,
        signals,
        recommendedAction: disposition(kind),
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
            : {
                acquisitionMs: input.acquisitionMs,
              }),
          inferenceMs,
          totalMs: (input.acquisitionMs ?? 0) + inferenceMs,
        },
        payload: {
          ...(input.evidenceBytes === undefined
            ? {}
            : {
                evidenceBytes: input.evidenceBytes,
              }),
          persistedArtifactBytes: Buffer.byteLength(JSON.stringify(persisted)),
        },
      };
    },
  };
}
