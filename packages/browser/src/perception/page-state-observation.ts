import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import type {
  PageStateAssessment,
  PageStateIdentity,
  PageStatePropositions,
} from "@rove/protocol";
import type { Page } from "playwright";

import {
  classifyObservedPageState,
  type PageStateClassificationResult,
} from "./page-state-decision.js";
import { collectPageStateFrameEvidence } from "./page-state-frame-evidence.js";
import { collectPageStateSurfaceFacts } from "./page-state-semantics.js";

const QUIET_WINDOW_MS = 75;
const MAX_OBSERVATION_MS = 1000;
const POLL_MS = 10;

export interface PageStateObservation extends PageStateClassificationResult {
  fingerprint: string;
  acquisitionMs: number;
}

export interface StablePageStateObservation extends PageStateObservation {
  stabilization: {
    elapsedMs: number;
    timedOut: boolean;
    quietForMs: number;
    sampleCount: number;
  };
}

function decisionFingerprint(result: PageStateClassificationResult): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: result.assessment.kind,
        confidence: result.assessment.confidence,
        signals: result.assessment.signals,
        propositions: result.propositions,
      }),
    )
    .digest("hex");
}

function unavailableResult(signal: string): PageStateClassificationResult {
  const propositions: PageStatePropositions = {
    primaryContentAvailable: false,
    documentUnstable: true,
    authenticationRequired: "indeterminate",
    humanVerificationPresented: "indeterminate",
    accessRestricted: "indeterminate",
    errorPresented: "indeterminate",
    interstitialPresented: "indeterminate",
  };

  const assessment: PageStateAssessment = {
    kind: "loading",
    confidence: "medium",
    signals: ["document:unstable", signal],
    recommendedAction: "wait_and_inspect",
  };

  return {
    assessment,
    propositions,
  };
}

function inputFor(
  readyState: string,
  httpStatus: number | undefined,
  surfaceFacts: Awaited<ReturnType<typeof collectPageStateSurfaceFacts>>,
  evidence: Awaited<ReturnType<typeof collectPageStateFrameEvidence>>,
) {
  return {
    signals: {
      readyState,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    },
    surfaceFacts,
    evidence,
  };
}

export async function collectPageStateObservation(
  page: Page,
  httpStatus?: number,
): Promise<PageStateObservation> {
  const started = performance.now();

  const before = await collectPageStateSurfaceFacts(page);

  const [evidence, readyState] = await Promise.all([
    collectPageStateFrameEvidence(page, before.iframeCount),
    page.evaluate(() => document.readyState).catch(() => "unknown"),
  ]);

  const after = await collectPageStateSurfaceFacts(page);

  const beforeResult = classifyObservedPageState(
    inputFor(readyState, httpStatus, before, evidence),
  );
  const afterResult = classifyObservedPageState(
    inputFor(readyState, httpStatus, after, evidence),
  );

  const beforeFingerprint = decisionFingerprint(beforeResult);
  const afterFingerprint = decisionFingerprint(afterResult);

  if (beforeFingerprint !== afterFingerprint) {
    throw new Error(
      "Page-state decision changed while evidence channels were acquired.",
    );
  }

  return {
    ...afterResult,
    fingerprint: afterFingerprint,
    acquisitionMs: performance.now() - started,
  };
}

export async function observeStablePageState(
  page: Page,
  httpStatus?: number,
): Promise<StablePageStateObservation> {
  const started = performance.now();

  let last: PageStateObservation;

  try {
    last = await collectPageStateObservation(page, httpStatus);
  } catch {
    const result = unavailableResult("stabilization:acquisition_unavailable");

    last = {
      ...result,
      fingerprint: decisionFingerprint(result),
      acquisitionMs: 0,
    };
  }

  let stableSince = performance.now();
  let sampleCount = 1;

  while (true) {
    const now = performance.now();
    const elapsedMs = now - started;
    const quietForMs = now - stableSince;
    const stillUnstable = last.propositions.documentUnstable === true;

    if (!stillUnstable && quietForMs >= QUIET_WINDOW_MS) {
      return {
        ...last,
        stabilization: {
          elapsedMs,
          timedOut: false,
          quietForMs,
          sampleCount,
        },
      };
    }

    if (elapsedMs >= MAX_OBSERVATION_MS) {
      if (stillUnstable) {
        const assessment: PageStateAssessment = {
          ...last.assessment,
          kind: "loading",
          confidence: "medium",
          signals: [
            ...new Set([
              ...last.assessment.signals,
              "stabilization:bounded_timeout",
            ]),
          ],
          recommendedAction: "wait_and_inspect",
        };

        const timedOutResult: PageStateClassificationResult = {
          assessment,
          propositions: last.propositions,
        };

        return {
          ...timedOutResult,
          fingerprint: decisionFingerprint(timedOutResult),
          acquisitionMs: last.acquisitionMs,
          stabilization: {
            elapsedMs,
            timedOut: true,
            quietForMs,
            sampleCount,
          },
        };
      }

      const result = unavailableResult("stabilization:decision_churn_timeout");

      return {
        ...result,
        fingerprint: decisionFingerprint(result),
        acquisitionMs: last.acquisitionMs,
        stabilization: {
          elapsedMs,
          timedOut: true,
          quietForMs,
          sampleCount,
        },
      };
    }

    await page.waitForTimeout(POLL_MS);

    let next: PageStateObservation;

    try {
      next = await collectPageStateObservation(page, httpStatus);
    } catch {
      const result = unavailableResult("stabilization:acquisition_unavailable");

      next = {
        ...result,
        fingerprint: decisionFingerprint(result),
        acquisitionMs: 0,
      };
    }

    sampleCount += 1;

    if (next.fingerprint !== last.fingerprint) {
      stableSince = performance.now();
    }

    last = next;
  }
}

export async function collectPageStateIdentity(
  page: Page,
  pageId: string,
  httpStatus?: number,
): Promise<PageStateIdentity> {
  try {
    const observation = await collectPageStateObservation(page, httpStatus);

    return {
      pageId,
      fingerprint: observation.fingerprint,
    };
  } catch {
    return {
      pageId,
      fingerprint: "unavailable",
    };
  }
}
