import type { PageStateKind } from "@rove/protocol";

import {
  PAGE_STATE_KINDS,
  PROPOSITION_NAMES,
  type BenchmarkCaseResult,
  type BenchmarkMetrics,
  type DistributionSummary,
  type PropositionMetric,
  type RiskModel,
  type StateMetric,
} from "./types.js";

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function distribution(values: number[]): DistributionSummary {
  if (values.length === 0) {
    return {
      sampleCount: 0,
      mean: null,
      median: null,
      p95: null,
      max: null,
    };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1]! + sorted[middle]!) / 2
      : sorted[middle]!;
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);

  return {
    sampleCount: sorted.length,
    mean: sum / sorted.length,
    median,
    p95: sorted[p95Index]!,
    max: sorted.at(-1)!,
  };
}

function emptyConfusionMatrix(): Record<
  PageStateKind,
  Record<PageStateKind, number>
> {
  return Object.fromEntries(
    PAGE_STATE_KINDS.map((actual) => [
      actual,
      Object.fromEntries(PAGE_STATE_KINDS.map((predicted) => [predicted, 0])),
    ]),
  ) as Record<PageStateKind, Record<PageStateKind, number>>;
}

function stateMetrics(results: BenchmarkCaseResult[]): {
  perState: StateMetric[];
  macroF1: number;
  confusionMatrix: Record<PageStateKind, Record<PageStateKind, number>>;
} {
  const confusionMatrix = emptyConfusionMatrix();

  for (const result of results) {
    confusionMatrix[result.expectedPrimaryState][result.actual.kind] += 1;
  }

  const perState = PAGE_STATE_KINDS.map((state): StateMetric => {
    const truePositive = confusionMatrix[state][state];
    const actualSupport = PAGE_STATE_KINDS.reduce(
      (total, predicted) => total + confusionMatrix[state][predicted],
      0,
    );
    const predictedSupport = PAGE_STATE_KINDS.reduce(
      (total, actual) => total + confusionMatrix[actual][state],
      0,
    );
    const falsePositive = predictedSupport - truePositive;
    const falseNegative = actualSupport - truePositive;
    const precision = ratio(truePositive, truePositive + falsePositive);
    const recall = ratio(truePositive, truePositive + falseNegative);

    let f1: number | null = null;
    if (precision !== null && recall !== null) {
      f1 =
        precision + recall === 0
          ? 0
          : (2 * precision * recall) / (precision + recall);
    } else if (actualSupport > 0 || predictedSupport > 0) {
      f1 = 0;
    }

    return {
      state,
      actualSupport,
      predictedSupport,
      truePositive,
      falsePositive,
      falseNegative,
      precision,
      recall,
      f1,
    };
  });

  const represented = perState
    .filter((metric) => metric.actualSupport > 0)
    .map((metric) => metric.f1 ?? 0);

  return {
    perState,
    macroF1:
      represented.length === 0
        ? 0
        : represented.reduce((total, value) => total + value, 0) /
          represented.length,
    confusionMatrix,
  };
}

function propositionMetrics(results: BenchmarkCaseResult[]): {
  propositions: PropositionMetric[];
  aggregate: BenchmarkMetrics["propositionAggregate"];
} {
  const propositions = PROPOSITION_NAMES.map(
    (proposition): PropositionMetric => {
      let eligible = 0;
      let assessed = 0;
      let correct = 0;

      for (const result of results) {
        const expected = result.expectedPropositions[proposition];
        if (expected === "indeterminate") continue;

        eligible += 1;

        const actual = result.propositions?.[proposition];
        if (actual !== true && actual !== false) continue;

        assessed += 1;
        if (actual === expected) correct += 1;
      }

      return {
        proposition,
        eligible,
        assessed,
        correct,
        coverage: ratio(assessed, eligible),
        accuracy: ratio(correct, assessed),
      };
    },
  );

  const aggregate = propositions.reduce(
    (summary, metric) => ({
      eligible: summary.eligible + metric.eligible,
      assessed: summary.assessed + metric.assessed,
      correct: summary.correct + metric.correct,
      coverage: null,
      accuracy: null,
    }),
    {
      eligible: 0,
      assessed: 0,
      correct: 0,
      coverage: null as number | null,
      accuracy: null as number | null,
    },
  );

  aggregate.coverage = ratio(aggregate.assessed, aggregate.eligible);
  aggregate.accuracy = ratio(aggregate.correct, aggregate.assessed);

  return { propositions, aggregate };
}

export function calculateBenchmarkMetrics(
  results: BenchmarkCaseResult[],
  _riskModel: RiskModel,
): BenchmarkMetrics {
  const caseCount = results.length;
  const primaryCorrect = results.filter(
    (result) => result.actual.kind === result.expectedPrimaryState,
  ).length;
  const dispositionCorrect = results.filter(
    (result) => result.actual.recommendedAction === result.expectedDisposition,
  ).length;
  const highConfidence = results.filter(
    (result) => result.actual.confidence === "high",
  );
  const highConfidenceErrors = highConfidence.filter(
    (result) => result.actual.kind !== result.expectedPrimaryState,
  );
  const unknownCount = results.filter(
    (result) => result.actual.kind === "unknown_interstitial",
  ).length;
  const riskTotal = results.reduce(
    (total, result) => total + result.riskCost,
    0,
  );
  const state = stateMetrics(results);
  const proposition = propositionMetrics(results);

  return {
    caseCount,
    primaryStateAccuracy: caseCount === 0 ? 0 : primaryCorrect / caseCount,
    dispositionAccuracy: caseCount === 0 ? 0 : dispositionCorrect / caseCount,
    dispositionErrorCount: caseCount - dispositionCorrect,
    perState: state.perState,
    macroF1: state.macroF1,
    confusionMatrix: state.confusionMatrix,
    propositions: proposition.propositions,
    propositionAggregate: proposition.aggregate,
    totalRiskWeightedLoss: riskTotal,
    riskWeightedLoss: caseCount === 0 ? 0 : riskTotal / caseCount,
    highConfidencePredictionCount: highConfidence.length,
    highConfidenceErrorCount: highConfidenceErrors.length,
    highConfidenceErrorRate:
      highConfidence.length === 0
        ? 0
        : highConfidenceErrors.length / highConfidence.length,
    criticalInvariantViolationCount: results.filter(
      (result) => result.criticalInvariantViolation,
    ).length,
    unknownCount,
    unknownRate: caseCount === 0 ? 0 : unknownCount / caseCount,
    timing: {
      acquisitionMs: distribution(
        results.flatMap((result) =>
          result.timing.acquisitionMs === undefined
            ? []
            : [result.timing.acquisitionMs],
        ),
      ),
      inferenceMs: distribution(
        results.flatMap((result) =>
          result.timing.inferenceMs === undefined
            ? []
            : [result.timing.inferenceMs],
        ),
      ),
      totalMs: distribution(
        results.flatMap((result) =>
          result.timing.totalMs === undefined ? [] : [result.timing.totalMs],
        ),
      ),
    },
    payload: {
      evidenceBytes: distribution(
        results.flatMap((result) =>
          result.payload.evidenceBytes === undefined
            ? []
            : [result.payload.evidenceBytes],
        ),
      ),
      persistedArtifactBytes: distribution(
        results.flatMap((result) =>
          result.payload.persistedArtifactBytes === undefined
            ? []
            : [result.payload.persistedArtifactBytes],
        ),
      ),
    },
  };
}
