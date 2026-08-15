import { readFile } from "node:fs/promises";

import type { PageStateKind } from "@rove/protocol";

import {
  PAGE_STATE_CONFIDENCES,
  PAGE_STATE_KINDS,
  type RiskModel,
} from "./types.js";

const DEFAULT_RISK_MODEL_URL = new URL(
  "../../../../../docs/hardening/perception/f1-risk-model.json",
  import.meta.url,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPageStateKind(value: unknown): value is PageStateKind {
  return (
    typeof value === "string" &&
    PAGE_STATE_KINDS.some((state) => state === value)
  );
}

function numberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export function assertRiskModel(value: unknown): asserts value is RiskModel {
  if (!isRecord(value)) {
    throw new Error("F1 risk model must be an object.");
  }

  if (
    !Number.isInteger(value.version) ||
    typeof value.version !== "number" ||
    value.version < 1
  ) {
    throw new Error("F1 risk model version must be a positive integer.");
  }

  if (
    typeof value.description !== "string" ||
    value.description.trim().length === 0
  ) {
    throw new Error("F1 risk model description is missing.");
  }

  if (!Array.isArray(value.states)) {
    throw new Error("F1 risk model is missing states.");
  }

  if (
    value.states.length !== PAGE_STATE_KINDS.length ||
    value.states.some(
      (state, index) =>
        !isPageStateKind(state) || state !== PAGE_STATE_KINDS[index],
    )
  ) {
    throw new Error("F1 risk model states do not match the protocol.");
  }

  if (!isRecord(value.confidenceErrorMultiplier)) {
    throw new Error("F1 risk model confidence multipliers are incomplete.");
  }

  const multipliers = value.confidenceErrorMultiplier;

  for (const confidence of PAGE_STATE_CONFIDENCES) {
    const multiplier = multipliers[confidence];
    if (
      typeof multiplier !== "number" ||
      !Number.isFinite(multiplier) ||
      multiplier <= 0
    ) {
      throw new Error(
        `Invalid F1 confidence error multiplier for ${confidence}.`,
      );
    }
  }

  if (!(
    (multipliers.high as number) > (multipliers.medium as number) &&
    (multipliers.medium as number) > (multipliers.low as number)
  )) {
    throw new Error(
      "F1 confidence multipliers must satisfy high > medium > low.",
    );
  }

  if (!isRecord(value.baseCost)) {
    throw new Error("F1 risk model baseCost is missing.");
  }

  for (const actual of PAGE_STATE_KINDS) {
    const row = value.baseCost[actual];
    if (!isRecord(row)) {
      throw new Error(`F1 risk model is missing row ${actual}.`);
    }

    for (const predicted of PAGE_STATE_KINDS) {
      const cost = row[predicted];
      if (
        !numberInRange(cost, 0, 100) ||
        (actual === predicted && cost !== 0) ||
        (actual !== predicted && cost === 0)
      ) {
        throw new Error(`Invalid F1 risk cost for ${actual} -> ${predicted}.`);
      }
    }
  }

  if (!Array.isArray(value.criticalPairs)) {
    throw new Error("F1 risk model criticalPairs must be an array.");
  }

  const criticalPairKeys = new Set<string>();

  for (const pair of value.criticalPairs) {
    if (
      !isRecord(pair) ||
      !isPageStateKind(pair.actual) ||
      !isPageStateKind(pair.predicted) ||
      pair.actual === pair.predicted ||
      typeof pair.reason !== "string" ||
      pair.reason.trim().length === 0
    ) {
      throw new Error("F1 risk model contains an invalid critical pair.");
    }

    const key = `${pair.actual}->${pair.predicted}`;
    if (criticalPairKeys.has(key)) {
      throw new Error(`Duplicate F1 critical pair ${key}.`);
    }
    criticalPairKeys.add(key);
  }

  if (!isRecord(value.acceptance)) {
    throw new Error("F1 risk model acceptance metadata is missing.");
  }

  const acceptance = value.acceptance;

  if (
    typeof acceptance.requireZeroCriticalInvariantViolations !== "boolean" ||
    !numberInRange(acceptance.deterministicHighConfidenceErrorRateMax, 0, 1) ||
    !numberInRange(acceptance.deterministicPrimaryStateAccuracyMin, 0, 1) ||
    !numberInRange(acceptance.deterministicMacroF1Min, 0, 1) ||
    typeof acceptance.requireRiskWeightedLossBelowFrozenBaseline !==
      "boolean" ||
    !numberInRange(acceptance.targetRiskWeightedLossReductionFraction, 0, 1)
  ) {
    throw new Error("F1 risk model acceptance metadata is invalid.");
  }

  if (
    !Array.isArray(value.notes) ||
    value.notes.some(
      (note) => typeof note !== "string" || note.trim().length === 0,
    )
  ) {
    throw new Error("F1 risk model notes are invalid.");
  }
}

export async function loadF1RiskModel(
  source: string | URL = DEFAULT_RISK_MODEL_URL,
): Promise<RiskModel> {
  const parsed: unknown = JSON.parse(await readFile(source, "utf8"));
  assertRiskModel(parsed);
  return parsed;
}
