import { performance } from "node:perf_hooks";

import { calculateBenchmarkMetrics } from "./metrics.js";
import {
  PAGE_STATE_CONFIDENCES,
  PAGE_STATE_KINDS,
  PAGE_STATE_RECOMMENDED_ACTIONS,
  PROPOSITION_NAMES,
  type BenchmarkCase,
  type BenchmarkCaseResult,
  type BenchmarkPrediction,
  type BenchmarkReport,
  type BenchmarkStrategy,
  type RiskModel,
} from "./types.js";

function includesString(
  values: readonly string[],
  value: unknown,
): value is string {
  return typeof value === "string" && values.includes(value);
}

function assertNonNegativeFinite(
  value: unknown,
  label: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}

function assertPrediction(
  prediction: BenchmarkPrediction,
  caseId: string,
): void {
  const assessment = prediction.assessment;

  if (
    typeof assessment !== "object" ||
    assessment === null ||
    !includesString(PAGE_STATE_KINDS, assessment.kind) ||
    !includesString(PAGE_STATE_CONFIDENCES, assessment.confidence) ||
    !Array.isArray(assessment.signals) ||
    assessment.signals.some((signal) => typeof signal !== "string") ||
    !includesString(
      PAGE_STATE_RECOMMENDED_ACTIONS,
      assessment.recommendedAction,
    )
  ) {
    throw new Error(
      `Benchmark strategy returned an invalid assessment for ${caseId}.`,
    );
  }

  if (prediction.propositions !== undefined) {
    for (const [name, value] of Object.entries(prediction.propositions)) {
      if (
        !PROPOSITION_NAMES.some((proposition) => proposition === name) ||
        (value !== true && value !== false && value !== "indeterminate")
      ) {
        throw new Error(
          `Benchmark strategy returned an invalid proposition for ${caseId}: ${name}.`,
        );
      }
    }
  }

  for (const [name, value] of Object.entries(prediction.timing ?? {})) {
    assertNonNegativeFinite(value, `Benchmark timing ${name} for ${caseId}`);
  }

  for (const [name, value] of Object.entries(prediction.payload ?? {})) {
    assertNonNegativeFinite(value, `Benchmark payload ${name} for ${caseId}`);
  }
}

function riskCost(
  result: {
    expectedPrimaryState: BenchmarkCaseResult["expectedPrimaryState"];
    actual: BenchmarkCaseResult["actual"];
  },
  riskModel: RiskModel,
): number {
  if (result.expectedPrimaryState === result.actual.kind) return 0;

  return (
    riskModel.baseCost[result.expectedPrimaryState][result.actual.kind] *
    riskModel.confidenceErrorMultiplier[result.actual.confidence]
  );
}

function isCanonicalCriticalPair(
  actual: BenchmarkCaseResult["expectedPrimaryState"],
  predicted: BenchmarkCaseResult["actual"]["kind"],
  riskModel: RiskModel,
): boolean {
  return riskModel.criticalPairs.some(
    (pair) => pair.actual === actual && pair.predicted === predicted,
  );
}

function isKnownSemanticBlocker(
  state: BenchmarkCaseResult["expectedPrimaryState"],
): boolean {
  return (
    state === "authentication_required" ||
    state === "human_verification" ||
    state === "access_restricted" ||
    state === "error"
  );
}

function isCriticalInvariantViolation(
  expected: BenchmarkCaseResult["expectedPrimaryState"],
  predicted: BenchmarkCaseResult["actual"]["kind"],
  riskModel: RiskModel,
): boolean {
  if (expected === predicted) return false;

  if (isCanonicalCriticalPair(expected, predicted, riskModel)) {
    return true;
  }

  // Gate 1 invariant: a stable known semantic blocker must not be
  // replaced by unknown merely because inference lacks a rule.
  if (
    isKnownSemanticBlocker(expected) &&
    predicted === "unknown_interstitial"
  ) {
    return true;
  }

  // Gate 1 invariant: an explicitly unstable snapshot must not be forced
  // into a stable semantic label.
  if (expected === "loading") {
    return true;
  }

  return false;
}

export async function runBenchmark<TInput>(options: {
  corpusVersion: number;
  cases: BenchmarkCase<TInput>[];
  strategy: BenchmarkStrategy<TInput>;
  riskModel: RiskModel;
}): Promise<BenchmarkReport> {
  const results: BenchmarkCaseResult[] = [];

  for (const benchmarkCase of options.cases) {
    const started = performance.now();
    const prediction = await options.strategy.predict(benchmarkCase.input, {
      id: benchmarkCase.id,
      tier: benchmarkCase.tier,
      description: benchmarkCase.description,
      criticality: benchmarkCase.criticality,
      tags: [...benchmarkCase.tags],
    });

    assertPrediction(prediction, benchmarkCase.id);

    const wallMs = performance.now() - started;

    const result: BenchmarkCaseResult = {
      id: benchmarkCase.id,
      tier: benchmarkCase.tier,
      criticality: benchmarkCase.criticality,
      tags: [...benchmarkCase.tags],
      expectedPrimaryState: benchmarkCase.expectedPrimaryState,
      expectedDisposition: benchmarkCase.expectedDisposition,
      expectedPropositions: benchmarkCase.expectedPropositions,
      actual: prediction.assessment,
      ...(prediction.propositions === undefined
        ? {}
        : { propositions: prediction.propositions }),
      riskCost: 0,
      criticalInvariantViolation: false,
      timing: {
        ...prediction.timing,
        totalMs: prediction.timing?.totalMs ?? wallMs,
      },
      payload: {
        ...prediction.payload,
      },
    };

    result.riskCost = riskCost(result, options.riskModel);
    result.criticalInvariantViolation = isCriticalInvariantViolation(
      result.expectedPrimaryState,
      result.actual.kind,
      options.riskModel,
    );

    results.push(result);
  }

  return {
    schemaVersion: 1,
    corpusVersion: options.corpusVersion,
    strategy: options.strategy.name,
    riskModelVersion: options.riskModel.version,
    metrics: calculateBenchmarkMetrics(results, options.riskModel),
    results,
  };
}
