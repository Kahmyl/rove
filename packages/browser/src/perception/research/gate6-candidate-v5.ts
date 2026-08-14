import { performance } from "node:perf_hooks";

import type { PageStateAssessment, PageStateKind } from "@rove/protocol";

import type { BenchmarkStrategy, PropositionSet } from "../benchmark/types.js";
import type { ResearchEvidence } from "./evidence.js";
import type { Gate5Input } from "./gate5-strategies.js";
import type {
  Gate6SemanticSurfaceV5,
  Gate6SurfaceFactsV5,
} from "./gate6-semantics-v5.js";

type Truth = true | false | "indeterminate";

export interface Gate6CandidateV5Input extends Gate5Input {
  surfaceFacts?: Gate6SurfaceFactsV5;
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

function surfaceEligibleForKnownBlocker(
  surface: Gate6SemanticSurfaceV5,
  primaryInteractiveCount: number,
): boolean {
  if (surface.kind === "blocking_dialog") {
    return true;
  }

  if (surface.kind === "primary") {
    return true;
  }

  if (surface.kind === "alert" && primaryInteractiveCount === 0) {
    return true;
  }

  return false;
}

export function gate6CandidateV5Strategy(): BenchmarkStrategy<Gate6CandidateV5Input> {
  return {
    name: "gate6-s4r5-surface-ownership-title-role",
    predict(input) {
      const started = performance.now();
      const facts = input.surfaceFacts;

      const surfaces = facts?.surfaces ?? [];

      const primary = surfaces.find((surface) => surface.kind === "primary");

      let verificationTrue = false;
      let verificationIndeterminate = false;
      let authTrue = false;
      let restrictionTrue = false;
      let errorTrue = false;

      const signals: string[] = [];

      for (const surface of surfaces) {
        if (
          !surfaceEligibleForKnownBlocker(
            surface,
            facts?.primaryInteractiveCount ?? 0,
          )
        ) {
          continue;
        }

        const isPrimary = surface.kind === "primary";
        const suppressLexical = isPrimary && surface.metaContext;
        const suppressAuth =
          suppressLexical || (isPrimary && surface.settingsContext);

        const semanticFrame = framePresentation(
          input.evidence,
          new Set(surface.semanticVerificationFrameOrdinals),
          facts?.iframeCount ?? 0,
        );

        const localFrame = framePresentation(
          input.evidence,
          new Set(surface.localVerificationFrameOrdinals),
          facts?.iframeCount ?? 0,
        );

        if (!suppressLexical) {
          if (
            surface.verificationDirective ||
            surface.verificationControl ||
            semanticFrame === true ||
            localFrame === true
          ) {
            verificationTrue = true;
            signals.push(
              surface.kind === "blocking_dialog"
                ? "verification:blocking_surface"
                : "verification:primary_surface",
            );
          } else if (
            semanticFrame === "indeterminate" ||
            localFrame === "indeterminate"
          ) {
            verificationIndeterminate = true;
          }

          if (surface.restrictionCue) {
            restrictionTrue = true;
            signals.push(
              surface.kind === "blocking_dialog"
                ? "restriction:blocking_surface"
                : "restriction:primary_surface",
            );
          }

          if (surface.errorCue) {
            errorTrue = true;
            signals.push(
              surface.kind === "blocking_dialog"
                ? "error:blocking_surface"
                : "error:primary_surface",
            );
          }
        }

        if (
          !suppressAuth &&
          (surface.authenticationDirective ||
            surface.credentialGate ||
            surface.identityChooser ||
            surface.passkeyGate)
        ) {
          authTrue = true;
          signals.push(
            surface.kind === "blocking_dialog"
              ? "auth:blocking_surface"
              : "auth:primary_surface",
          );
        }
      }

      const humanVerificationPresented: Truth = verificationTrue
        ? true
        : verificationIndeterminate
          ? "indeterminate"
          : false;

      const authenticationRequired: Truth =
        statusAuthentication(input.signals.httpStatus) || authTrue;

      const accessRestricted: Truth =
        statusRestriction(input.signals.httpStatus) || restrictionTrue;

      const errorPresented: Truth =
        statusError(input.signals.httpStatus) || errorTrue;

      if (statusAuthentication(input.signals.httpStatus)) {
        signals.push("auth:http_status");
      }

      if (statusRestriction(input.signals.httpStatus)) {
        signals.push("restriction:http_status");
      }

      if (statusError(input.signals.httpStatus)) {
        signals.push("error:http_status");
      }

      const knownBlockers = [
        humanVerificationPresented,
        authenticationRequired,
        accessRestricted,
        errorPresented,
      ];

      const knownBlockerTrue = anyTrue(knownBlockers);

      const blockingUnknownSurface =
        surfaces.some(
          (surface) =>
            surface.kind === "blocking_dialog" &&
            !(
              surface.verificationDirective ||
              surface.verificationControl ||
              surface.authenticationDirective ||
              surface.credentialGate ||
              surface.identityChooser ||
              surface.passkeyGate ||
              surface.restrictionCue ||
              surface.errorCue
            ),
        ) || facts?.interstitialCanvasPresented === true;

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

      const ordinaryPrimarySurface =
        (facts?.primaryVisibleChars ?? 0) > 0 ||
        (facts?.primaryInteractiveCount ?? 0) > 0 ||
        facts?.nonInterstitialCanvasPresented === true;

      const richPrimarySurface =
        (facts?.primaryVisibleChars ?? 0) >= 500 ||
        (facts?.primaryInteractiveCount ?? 0) > 10;

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

      const assessment: PageStateAssessment = {
        kind,
        confidence,
        signals: [
          documentUnstable ? "document:unstable" : "document:stable",
          ...(primary?.metaContext ? ["scope:primary_meta"] : []),
          ...(primary?.settingsContext ? ["scope:primary_settings"] : []),
          ...new Set(signals),
          ...(humanVerificationPresented === "indeterminate"
            ? ["verification:presentation_indeterminate"]
            : []),
          ...(blockingUnknownSurface && !knownBlockerTrue
            ? ["interstitial:blocking_unknown_surface"]
            : []),
        ],
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
