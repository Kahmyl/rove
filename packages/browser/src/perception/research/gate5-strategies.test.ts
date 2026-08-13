import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { loadF1RiskModel } from "../benchmark/risk-model.js";
import { runBenchmark } from "../benchmark/runner.js";
import type { BenchmarkCase } from "../benchmark/types.js";
import { LOCAL_PERCEPTION_CASES } from "../corpus/local-corpus.js";
import type { ResearchEvidence } from "./evidence.js";
import type { PropositionSet } from "../benchmark/types.js";
import {
  gate5Internals,
  gate5Strategies,
  type Gate5Input,
} from "./gate5-strategies.js";

const falsePropositions: PropositionSet = {
  primaryContentAvailable: false,
  documentUnstable: false,
  authenticationRequired: false,
  humanVerificationPresented: false,
  accessRestricted: false,
  errorPresented: false,
  interstitialPresented: false,
};

describe("F1 Gate 5 experimental inference", () => {
  it("derives compatibility state only after preserving overlap propositions", () => {
    expect(
      gate5Internals.derivePrimaryState({
        ...falsePropositions,
        authenticationRequired: true,
        humanVerificationPresented: true,
        accessRestricted: true,
        errorPresented: true,
        interstitialPresented: true,
      }),
    ).toBe("human_verification");
    expect(
      gate5Internals.derivePrimaryState({
        ...falsePropositions,
        accessRestricted: true,
        errorPresented: true,
        interstitialPresented: true,
      }),
    ).toBe("access_restricted");
  });

  it("does not turn provider presence into presentation", async () => {
    const input: Gate5Input = {
      signals: {
        title: "Blank",
        text: "",
        readyState: "complete",
        rawHtml: '<iframe src="/recaptcha"></iframe>',
        frameUrls: ["https://provider.invalid/recaptcha"],
      },
    };
    const structural = gate5Strategies().find(
      (strategy) => strategy.name === "s2-proposition-first-structural",
    )!;
    const prediction = await structural.predict(input, {
      id: "misleading-human-verification-id",
      tier: "A",
      description: "label-bearing metadata must be ignored",
      criticality: "critical",
      tags: ["human-verification"],
    });

    expect(prediction.assessment.kind).toBe("ready");
    expect(prediction.propositions?.humanVerificationPresented).toBe(false);
    expect(prediction.assessment.signals).toContain(
      "verification:provider_presence_only",
    );
  });

  it("keeps missing visual evidence from becoming an unknown interstitial", async () => {
    const visual = gate5Strategies().find(
      (strategy) => strategy.name === "s5-structural-visual-escalation",
    )!;
    const input: Gate5Input = {
      signals: {
        title: "Canvas app",
        text: "",
        readyState: "complete",
        rawHtml: "<canvas></canvas>",
      },
      evidence: {
        document: {
          readyState: "complete",
          titleChars: 10,
          titleHash: "0".repeat(64),
          textChars: 0,
          textHash: "0".repeat(64),
          elementCount: 3,
          interactiveCandidateCount: 0,
          iframeElementCount: 0,
          ariaBusyCount: 0,
          canvasCount: 1,
          viewport: { width: 1440, height: 900 },
        },
        frames: [],
        accessibility: {
          snapshotChars: 0,
          snapshotLines: 0,
          snapshotHash: "0".repeat(64),
          headingCount: 0,
          buttonCount: 0,
          linkCount: 0,
          iframeCount: 0,
          textboxCount: 0,
        },
        observation: {
          events: [],
          truncated: false,
          droppedEventCount: 0,
          requestCount: 0,
          responseCount: 0,
          failedRequestCount: 0,
          subframeDocumentRequestCount: 0,
          subframeDocumentResponseCount: 0,
          frameAttachedCount: 0,
          frameNavigatedCount: 0,
          domContentLoadedCount: 0,
          loadCount: 0,
        },
      },
      visual: {
        available: false,
        materiallyPainted: false,
        acquisitionMs: 0,
        payloadBytes: 0,
      },
    };
    const prediction = await visual.predict(input, {
      id: "opaque",
      tier: "A",
      description: "opaque",
      criticality: "standard",
      tags: [],
    });
    expect(prediction.assessment.kind).toBe("ready");
  });

  it("requires credential structure to establish authentication", () => {
    const features = gate5Internals.extractFeatures({
      signals: {
        title: "Article",
        text: "This article says sign in to continue in an example.",
        rawHtml: "<main><p>Example prose</p></main>",
        readyState: "complete",
      },
    });
    const inferred = gate5Internals.inferPropositions(features, {
      accessibility: true,
      visual: false,
      visualPainted: false,
    });
    expect(inferred.propositions.authenticationRequired).toBe(false);
  });

  it("meets deterministic acceptance without reading expected labels or metadata", async () => {
    const gate4 = JSON.parse(
      await readFile(
        new URL(
          "../../../../../docs/hardening/perception/experiments/f1-gate4-results.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      stableEvidence: {
        cases: Array<{ id: string; representative: ResearchEvidence }>;
      };
    };
    const evidence = new Map(
      gate4.stableEvidence.cases.map((item) => [item.id, item.representative]),
    );
    const cases: BenchmarkCase<Gate5Input>[] = LOCAL_PERCEPTION_CASES.map(
      (item) => ({
        ...item,
        input: {
          signals: item.input,
          ...(evidence.get(item.id) === undefined
            ? {}
            : { evidence: evidence.get(item.id) }),
        },
      }),
    );
    const strategy = gate5Strategies().find(
      (candidate) => candidate.name === "s3-proposition-first-accessibility",
    )!;
    const report = await runBenchmark({
      corpusVersion: 1,
      cases,
      strategy,
      riskModel: await loadF1RiskModel(),
    });

    expect(report.metrics).toMatchObject({
      primaryStateAccuracy: 1,
      macroF1: 1,
      riskWeightedLoss: 0,
      highConfidenceErrorRate: 0,
      criticalInvariantViolationCount: 0,
    });
    expect(report.metrics.propositionAggregate).toMatchObject({
      coverage: 1,
      accuracy: 1,
    });
  });
});
