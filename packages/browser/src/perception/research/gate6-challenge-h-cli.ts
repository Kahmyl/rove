import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser } from "playwright";

import { loadF1RiskModel } from "../benchmark/risk-model.js";
import { runBenchmark } from "../benchmark/runner.js";
import type {
  BenchmarkCase,
  BenchmarkReport,
  DistributionSummary,
} from "../benchmark/types.js";
import {
  collectResearchEvidence,
  PageObservationRecorder,
} from "./evidence.js";
import {
  gate6CandidateV7Strategy,
  type Gate6CandidateV7Input,
} from "./gate6-candidate-v7.js";
import {
  GATE6_CHALLENGE_H_CASES,
  challengeHDisposition,
} from "./gate6-challenge-h.js";
import { collectGate6SurfaceFactsV7 } from "./gate6-semantics-v7.js";
import { pageSignals } from "./gate6-validation.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

const CORPUS_VERSION = 6008;

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];

  if (value === undefined) {
    throw new Error(`${name} is required.`);
  }

  return resolve(value);
}

function stringArg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];

  if (value === undefined) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fileHash(path: string): Promise<string> {
  return sha256(await readFile(path));
}

function summarize(values: number[]): DistributionSummary {
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

  const percentile = (fraction: number): number =>
    sorted[
      Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(sorted.length * fraction) - 1),
      )
    ]!;

  return {
    sampleCount: sorted.length,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    median: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1)!,
  };
}

function failures(report: BenchmarkReport) {
  return report.results.filter((item) => {
    if (
      item.actual.kind !== item.expectedPrimaryState ||
      item.criticalInvariantViolation
    ) {
      return true;
    }

    return Object.entries(item.expectedPropositions ?? {}).some(
      ([name, expected]) =>
        expected !== "indeterminate" &&
        item.propositions?.[name as keyof typeof item.propositions] !==
          expected,
    );
  });
}

function exact(report: BenchmarkReport): boolean {
  return (
    report.metrics.caseCount === 18 &&
    report.metrics.primaryStateAccuracy === 1 &&
    report.metrics.macroF1 === 1 &&
    report.metrics.riskWeightedLoss === 0 &&
    report.metrics.highConfidenceErrorRate === 0 &&
    report.metrics.criticalInvariantViolationCount === 0 &&
    report.metrics.propositionAggregate.coverage === 1 &&
    report.metrics.propositionAggregate.accuracy === 1
  );
}

const out = arg("--out");
const analysis = arg("--analysis");
const candidatePath = arg("--candidate");
const semanticsPath = arg("--semantics");
const challengePath = arg("--challenge");

const candidateExpected = stringArg("--candidate-hash");
const semanticsExpected = stringArg("--semantics-hash");
const challengeExpected = stringArg("--challenge-hash");

if (
  (await fileHash(candidatePath)) !== candidateExpected ||
  (await fileHash(semanticsPath)) !== semanticsExpected ||
  (await fileHash(challengePath)) !== challengeExpected
) {
  throw new Error("Challenge H pre-execution freeze mismatch.");
}

const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
}).trim();

const browser: Browser = await chromium.launch({
  headless: true,
});

const context = await browser.newContext({
  viewport: {
    width: 1440,
    height: 900,
  },
});

try {
  const cases: BenchmarkCase<Gate6CandidateV7Input>[] = [];

  for (const definition of GATE6_CHALLENGE_H_CASES) {
    const page = await context.newPage();

    try {
      await page.setContent(
        [
          "<!doctype html><html><head><title>",
          definition.title,
          "</title></head><body>",
          definition.body,
          "</body></html>",
        ].join(""),
        {
          waitUntil: "load",
        },
      );

      const recorder = new PageObservationRecorder(page);
      const started = performance.now();

      const evidence = await collectResearchEvidence(page, recorder);

      const [signals, surfaceFacts] = await Promise.all([
        pageSignals(page, definition.httpStatus),
        collectGate6SurfaceFactsV7(page),
      ]);

      cases.push({
        id: definition.id,
        tier: "A",
        description: definition.description,
        input: {
          signals,
          evidence: evidence.evidence,
          surfaceFacts,
          acquisitionMs: performance.now() - started,
          evidenceBytes: evidence.payload.totalBytes,
        },
        expectedPropositions: definition.expectedPropositions,
        expectedPrimaryState: definition.expectedPrimaryState,
        expectedDisposition: challengeHDisposition(
          definition.expectedPrimaryState,
        ),
        criticality: definition.criticality,
        tags: [...definition.tags],
      });
    } finally {
      await page.close();
    }
  }

  const riskModel = await loadF1RiskModel();

  const report = await runBenchmark({
    corpusVersion: CORPUS_VERSION,
    cases,
    strategy: gate6CandidateV7Strategy(),
    riskModel,
  });

  const candidateAfter = await fileHash(candidatePath);
  const semanticsAfter = await fileHash(semanticsPath);
  const challengeAfter = await fileHash(challengePath);

  const candidateUnchanged =
    candidateAfter === candidateExpected &&
    semanticsAfter === semanticsExpected;

  const challengeUnchanged = challengeAfter === challengeExpected;

  const acquisition = summarize(
    cases
      .map((item) => item.input.acquisitionMs)
      .filter((value): value is number => value !== undefined),
  );

  const confirmatoryPassed =
    exact(report) && candidateUnchanged && challengeUnchanged;

  const artifact = {
    schemaVersion: 1,
    experiment: "f1-gate6-final-independent-semantic-challenge-h",
    generatedAt: new Date().toISOString(),
    metadata: {
      sourceRevision,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      chromiumVersion: browser.version(),
      hashes: {
        candidateV7: candidateAfter,
        semanticsV7: semanticsAfter,
        challengeH: challengeAfter,
      },
    },
    challengeH: report,
    acquisition,
    candidateUnchanged,
    challengeUnchanged,
    confirmatoryPassed,
  };

  await mkdir(dirname(out), {
    recursive: true,
  });

  await writeFile(out, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  const mismatch = failures(report);

  await mkdir(dirname(analysis), {
    recursive: true,
  });

  await writeFile(
    analysis,
    [
      "# F1 Gate 6 Final Independent Semantic Challenge H",
      "",
      `Confirmatory passed: **${confirmatoryPassed}**`,
      "",
      `Cases: ${report.metrics.caseCount}`,
      `Primary accuracy: ${report.metrics.primaryStateAccuracy}`,
      `Macro F1: ${report.metrics.macroF1}`,
      `Risk: ${report.metrics.riskWeightedLoss}`,
      `High-confidence error rate: ${report.metrics.highConfidenceErrorRate}`,
      `Critical violations: ${report.metrics.criticalInvariantViolationCount}`,
      `Proposition coverage: ${report.metrics.propositionAggregate.coverage}`,
      `Proposition accuracy: ${report.metrics.propositionAggregate.accuracy}`,
      "",
      "## Failures",
      "",
      ...(mismatch.length === 0
        ? ["- none"]
        : mismatch.map(
            (item) =>
              `- ${item.id}: expected ${item.expectedPrimaryState}, got ${item.actual.kind} (${item.actual.confidence}), risk=${item.riskCost}, critical=${item.criticalInvariantViolation}.`,
          )),
      "",
    ].join("\n"),
    "utf8",
  );
} finally {
  await context.close();
  await browser.close();
}
