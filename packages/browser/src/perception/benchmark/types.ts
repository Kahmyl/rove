import type {
  PageStateAssessment,
  PageStateKind,
  PageStateRecommendedAction,
} from "@rove/protocol";

export const PAGE_STATE_KINDS = [
  "ready",
  "loading",
  "authentication_required",
  "human_verification",
  "access_restricted",
  "unknown_interstitial",
  "error",
] as const satisfies readonly PageStateKind[];

export const PAGE_STATE_RECOMMENDED_ACTIONS = [
  "continue",
  "wait_and_inspect",
  "request_human",
  "stop",
] as const satisfies readonly PageStateRecommendedAction[];

export const PAGE_STATE_CONFIDENCES = [
  "high",
  "medium",
  "low",
] as const satisfies readonly PageStateAssessment["confidence"][];

export const PROPOSITION_NAMES = [
  "primaryContentAvailable",
  "documentUnstable",
  "authenticationRequired",
  "humanVerificationPresented",
  "accessRestricted",
  "errorPresented",
  "interstitialPresented",
] as const;

export type PropositionName = (typeof PROPOSITION_NAMES)[number];
export type PropositionTruth = boolean | "indeterminate";
export type PropositionSet = Record<PropositionName, PropositionTruth>;

export type CorpusTier = "A" | "B" | "C" | "D";
export type BenchmarkCriticality = "critical" | "standard";

export interface BenchmarkCase<TInput> {
  id: string;
  tier: CorpusTier;
  description: string;
  input: TInput;
  expectedPropositions: PropositionSet;
  expectedPrimaryState: PageStateKind;
  expectedDisposition: PageStateRecommendedAction;
  criticality: BenchmarkCriticality;
  tags: string[];
  notes?: string;
}

export interface BenchmarkCaseContext {
  id: string;
  tier: CorpusTier;
  description: string;
  criticality: BenchmarkCriticality;
  tags: string[];
}

export interface BenchmarkTiming {
  acquisitionMs?: number;
  inferenceMs?: number;
  totalMs?: number;
}

export interface BenchmarkPayloadMeasurement {
  evidenceBytes?: number;
  persistedArtifactBytes?: number;
}

export interface BenchmarkPrediction {
  assessment: PageStateAssessment;
  propositions?: Partial<Record<PropositionName, PropositionTruth>>;
  timing?: BenchmarkTiming;
  payload?: BenchmarkPayloadMeasurement;
}

export interface BenchmarkStrategy<TInput> {
  name: string;
  predict(
    input: TInput,
    context: BenchmarkCaseContext,
  ): BenchmarkPrediction | Promise<BenchmarkPrediction>;
}

export interface RiskCriticalPair {
  actual: PageStateKind;
  predicted: PageStateKind;
  reason: string;
}

export interface RiskModel {
  version: number;
  description: string;
  states: PageStateKind[];
  confidenceErrorMultiplier: Record<PageStateAssessment["confidence"], number>;
  baseCost: Record<PageStateKind, Record<PageStateKind, number>>;
  criticalPairs: RiskCriticalPair[];
  acceptance: {
    requireZeroCriticalInvariantViolations: boolean;
    deterministicHighConfidenceErrorRateMax: number;
    deterministicPrimaryStateAccuracyMin: number;
    deterministicMacroF1Min: number;
    requireRiskWeightedLossBelowFrozenBaseline: boolean;
    targetRiskWeightedLossReductionFraction: number;
  };
  notes: string[];
}

export interface StateMetric {
  state: PageStateKind;
  actualSupport: number;
  predictedSupport: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface PropositionMetric {
  proposition: PropositionName;
  eligible: number;
  assessed: number;
  correct: number;
  coverage: number | null;
  accuracy: number | null;
}

export interface DistributionSummary {
  sampleCount: number;
  mean: number | null;
  median: number | null;
  p95: number | null;
  max: number | null;
}

export interface BenchmarkMetrics {
  caseCount: number;
  primaryStateAccuracy: number;
  dispositionAccuracy: number;
  dispositionErrorCount: number;
  perState: StateMetric[];
  macroF1: number;
  confusionMatrix: Record<PageStateKind, Record<PageStateKind, number>>;
  propositions: PropositionMetric[];
  propositionAggregate: {
    eligible: number;
    assessed: number;
    correct: number;
    coverage: number | null;
    accuracy: number | null;
  };
  totalRiskWeightedLoss: number;
  riskWeightedLoss: number;
  highConfidencePredictionCount: number;
  highConfidenceErrorCount: number;
  highConfidenceErrorRate: number;
  criticalInvariantViolationCount: number;
  unknownCount: number;
  unknownRate: number;
  timing: {
    acquisitionMs: DistributionSummary;
    inferenceMs: DistributionSummary;
    totalMs: DistributionSummary;
  };
  payload: {
    evidenceBytes: DistributionSummary;
    persistedArtifactBytes: DistributionSummary;
  };
}

export interface BenchmarkCaseResult {
  id: string;
  tier: CorpusTier;
  criticality: BenchmarkCriticality;
  tags: string[];
  expectedPrimaryState: PageStateKind;
  expectedDisposition: PageStateRecommendedAction;
  expectedPropositions: PropositionSet;
  actual: PageStateAssessment;
  propositions?: Partial<Record<PropositionName, PropositionTruth>>;
  riskCost: number;
  criticalInvariantViolation: boolean;
  timing: BenchmarkTiming;
  payload: BenchmarkPayloadMeasurement;
}

export interface BenchmarkReport {
  schemaVersion: 1;
  corpusVersion: number;
  strategy: string;
  riskModelVersion: number;
  metrics: BenchmarkMetrics;
  results: BenchmarkCaseResult[];
}
