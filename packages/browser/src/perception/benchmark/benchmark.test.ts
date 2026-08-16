import { describe, expect, it } from "vitest";

import type { PageSignals } from "../research/legacy-page-state-classifier.js";
import {
  LOCAL_PERCEPTION_CASES,
  LOCAL_PERCEPTION_CORPUS_VERSION,
} from "../corpus/local-corpus.js";
import { assertRiskModel, loadF1RiskModel } from "./risk-model.js";
import { runBenchmark } from "./runner.js";
import type { BenchmarkStrategy, PropositionSet } from "./types.js";

function caseById(id: string) {
  const benchmarkCase = LOCAL_PERCEPTION_CASES.find(
    (candidate) => candidate.id === id,
  );

  if (benchmarkCase === undefined) {
    throw new Error(`Missing benchmark case ${id}`);
  }

  return benchmarkCase;
}

describe("F1 perception benchmark", () => {
  it("reports a perfect oracle without risk or invariant violations", async () => {
    const byId = new Map(
      LOCAL_PERCEPTION_CASES.map((benchmarkCase) => [
        benchmarkCase.id,
        benchmarkCase,
      ]),
    );

    const oracle: BenchmarkStrategy<PageSignals> = {
      name: "test-oracle",
      predict: (_input, context) => {
        const benchmarkCase = byId.get(context.id);
        if (benchmarkCase === undefined) {
          throw new Error(`Unknown benchmark case ${context.id}`);
        }

        return {
          assessment: {
            kind: benchmarkCase.expectedPrimaryState,
            confidence: "high",
            signals: ["test:oracle"],
            recommendedAction: benchmarkCase.expectedDisposition,
          },
          propositions: {
            ...benchmarkCase.expectedPropositions,
          } as PropositionSet,
          timing: {
            acquisitionMs: 1,
            inferenceMs: 2,
            totalMs: 3,
          },
          payload: {
            evidenceBytes: 100,
            persistedArtifactBytes: 50,
          },
        };
      },
    };

    const report = await runBenchmark({
      corpusVersion: LOCAL_PERCEPTION_CORPUS_VERSION,
      cases: LOCAL_PERCEPTION_CASES,
      strategy: oracle,
      riskModel: await loadF1RiskModel(),
    });

    expect(report.metrics.primaryStateAccuracy).toBe(1);
    expect(report.metrics.dispositionAccuracy).toBe(1);
    expect(report.metrics.macroF1).toBe(1);
    expect(report.metrics.riskWeightedLoss).toBe(0);
    expect(report.metrics.highConfidenceErrorCount).toBe(0);
    expect(report.metrics.criticalInvariantViolationCount).toBe(0);
    expect(report.metrics.propositionAggregate.coverage).toBe(1);
    expect(report.metrics.propositionAggregate.accuracy).toBe(1);
    expect(report.metrics.timing.acquisitionMs.mean).toBe(1);
    expect(report.metrics.timing.inferenceMs.mean).toBe(2);
    expect(report.metrics.timing.totalMs.mean).toBe(3);
    expect(report.metrics.payload.evidenceBytes.mean).toBe(100);
    expect(report.metrics.payload.persistedArtifactBytes.mean).toBe(50);
  });

  it("applies asymmetric risk and high-confidence penalties", async () => {
    const report = await runBenchmark({
      corpusVersion: LOCAL_PERCEPTION_CORPUS_VERSION,
      cases: [caseById("human-verification-visible")],
      strategy: {
        name: "unsafe-ready",
        predict: () => ({
          assessment: {
            kind: "ready",
            confidence: "high",
            signals: ["test:wrong"],
            recommendedAction: "continue",
          },
        }),
      },
      riskModel: await loadF1RiskModel(),
    });

    expect(report.metrics.totalRiskWeightedLoss).toBe(150);
    expect(report.metrics.riskWeightedLoss).toBe(150);
    expect(report.metrics.highConfidencePredictionCount).toBe(1);
    expect(report.metrics.highConfidenceErrorCount).toBe(1);
    expect(report.metrics.highConfidenceErrorRate).toBe(1);
    expect(report.metrics.criticalInvariantViolationCount).toBe(1);
  });

  it("does not promote an ordinary precedence error into a hard invariant violation", async () => {
    const report = await runBenchmark({
      corpusVersion: LOCAL_PERCEPTION_CORPUS_VERSION,
      cases: [caseById("overlap-restriction-verification")],
      strategy: {
        name: "restriction-precedence",
        predict: () => ({
          assessment: {
            kind: "access_restricted",
            confidence: "high",
            signals: ["test:precedence"],
            recommendedAction: "request_human",
          },
        }),
      },
      riskModel: await loadF1RiskModel(),
    });

    expect(report.metrics.primaryStateAccuracy).toBe(0);
    expect(report.metrics.dispositionAccuracy).toBe(1);
    expect(report.metrics.totalRiskWeightedLoss).toBe(60);
    expect(report.metrics.criticalInvariantViolationCount).toBe(0);
  });

  it("treats known blocker to unknown as a Gate 1 hard invariant violation", async () => {
    const report = await runBenchmark({
      corpusVersion: LOCAL_PERCEPTION_CORPUS_VERSION,
      cases: [caseById("authentication-required")],
      strategy: {
        name: "unknown-auth",
        predict: () => ({
          assessment: {
            kind: "unknown_interstitial",
            confidence: "high",
            signals: ["test:unknown"],
            recommendedAction: "request_human",
          },
        }),
      },
      riskModel: await loadF1RiskModel(),
    });

    expect(report.metrics.dispositionAccuracy).toBe(1);
    expect(report.metrics.criticalInvariantViolationCount).toBe(1);
  });

  it("treats an unstable snapshot forced to ready as a Gate 1 hard invariant violation", async () => {
    const report = await runBenchmark({
      corpusVersion: LOCAL_PERCEPTION_CORPUS_VERSION,
      cases: [caseById("loading-document-signal")],
      strategy: {
        name: "premature-ready",
        predict: () => ({
          assessment: {
            kind: "ready",
            confidence: "high",
            signals: ["test:premature"],
            recommendedAction: "continue",
          },
        }),
      },
      riskModel: await loadF1RiskModel(),
    });

    expect(report.metrics.criticalInvariantViolationCount).toBe(1);
  });

  it("reports disposition mismatch separately without rewriting hard-invariant semantics", async () => {
    const report = await runBenchmark({
      corpusVersion: LOCAL_PERCEPTION_CORPUS_VERSION,
      cases: [caseById("human-verification-visible")],
      strategy: {
        name: "wrong-disposition",
        predict: () => ({
          assessment: {
            kind: "human_verification",
            confidence: "high",
            signals: ["test:wrong-disposition"],
            recommendedAction: "continue",
          },
        }),
      },
      riskModel: await loadF1RiskModel(),
    });

    expect(report.metrics.primaryStateAccuracy).toBe(1);
    expect(report.metrics.dispositionAccuracy).toBe(0);
    expect(report.metrics.dispositionErrorCount).toBe(1);
    expect(report.metrics.riskWeightedLoss).toBe(0);
    expect(report.metrics.criticalInvariantViolationCount).toBe(0);
  });

  it("rejects malformed experimental strategy output", async () => {
    await expect(
      runBenchmark({
        corpusVersion: LOCAL_PERCEPTION_CORPUS_VERSION,
        cases: [caseById("ready-normal")],
        strategy: {
          name: "malformed",
          predict: () =>
            ({
              assessment: {
                kind: "not-a-state",
                confidence: "high",
                signals: [],
                recommendedAction: "continue",
              },
            }) as never,
        },
        riskModel: await loadF1RiskModel(),
      }),
    ).rejects.toThrow(/invalid assessment/i);
  });

  it("validates the complete frozen risk-model contract", async () => {
    const model = await loadF1RiskModel();

    const badMultiplier = structuredClone(model);
    badMultiplier.confidenceErrorMultiplier.high = 0.5;
    expect(() => assertRiskModel(badMultiplier)).toThrow(
      /high > medium > low/i,
    );

    const badAcceptance = structuredClone(model);
    badAcceptance.acceptance.deterministicPrimaryStateAccuracyMin = 2;
    expect(() => assertRiskModel(badAcceptance)).toThrow(
      /acceptance metadata is invalid/i,
    );
  });
});
