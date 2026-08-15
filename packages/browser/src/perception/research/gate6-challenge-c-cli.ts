import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

import { loadF1RiskModel } from "../benchmark/risk-model.js";
import { runBenchmark } from "../benchmark/runner.js";
import type {
  BenchmarkCase,
  BenchmarkReport,
  DistributionSummary,
  PropositionSet,
} from "../benchmark/types.js";
import {
  collectResearchEvidence,
  PageObservationRecorder,
} from "./evidence.js";
import {
  gate6CandidateV2Strategy,
  type Gate6CandidateV2Input,
} from "./gate6-candidate-v2.js";
import {
  GATE6_CHALLENGE_C_CASES,
  challengeCDisposition,
} from "./gate6-challenge-c.js";
import {
  collectGate6AccessibilityFactsV2,
  collectGate6SurfaceFactsV2,
} from "./gate6-semantics-v2.js";
import { pageSignals } from "./gate6-validation.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const CHALLENGE_C_VERSION = 6003;

function rawArg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];

  if (value === undefined) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function pathArg(name: string): string {
  return resolve(rawArg(name));
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
  const percentile = (fraction: number) =>
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

async function acquire(
  page: Page,
  httpStatus?: number,
): Promise<Gate6CandidateV2Input> {
  const recorder = new PageObservationRecorder(page);
  const started = performance.now();

  const evidence = await collectResearchEvidence(page, recorder);

  const [signals, surfaceFacts, accessibilityFacts] = await Promise.all([
    pageSignals(page, httpStatus),
    collectGate6SurfaceFactsV2(page),
    collectGate6AccessibilityFactsV2(page),
  ]);

  return {
    signals,
    evidence: evidence.evidence,
    surfaceFacts,
    accessibilityFacts,
    acquisitionMs: performance.now() - started,
    evidenceBytes: evidence.payload.totalBytes,
  };
}

async function challengeCCases(
  context: BrowserContext,
): Promise<BenchmarkCase<Gate6CandidateV2Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV2Input>[] = [];

  for (const definition of GATE6_CHALLENGE_C_CASES) {
    const page = await context.newPage();

    try {
      await page.setContent(
        `<!doctype html><html><head><title>${definition.title}</title></head><body>${definition.body}</body></html>`,
        { waitUntil: "load" },
      );

      cases.push({
        id: definition.id,
        tier: "A",
        description: definition.description,
        input: await acquire(page, definition.httpStatus),
        expectedPropositions: definition.expectedPropositions,
        expectedPrimaryState: definition.expectedPrimaryState,
        expectedDisposition: challengeCDisposition(
          definition.expectedPrimaryState,
        ),
        criticality: definition.criticality,
        tags: [...definition.tags],
      });
    } finally {
      await page.close();
    }
  }

  return cases;
}

function confirmatoryPass(report: BenchmarkReport): boolean {
  return (
    report.metrics.primaryStateAccuracy >= 0.98 &&
    report.metrics.macroF1 >= 0.98 &&
    report.metrics.riskWeightedLoss === 0 &&
    report.metrics.highConfidenceErrorRate === 0 &&
    report.metrics.criticalInvariantViolationCount === 0 &&
    report.metrics.propositionAggregate.coverage === 1 &&
    report.metrics.propositionAggregate.accuracy === 1
  );
}

function failures(report: BenchmarkReport) {
  return report.results.filter((item) => {
    if (
      item.actual.kind !== item.expectedPrimaryState ||
      item.criticalInvariantViolation
    ) {
      return true;
    }

    for (const [name, expected] of Object.entries(
      item.expectedPropositions ?? {},
    )) {
      if (
        expected !== "indeterminate" &&
        item.propositions?.[name as keyof PropositionSet] !== expected
      ) {
        return true;
      }
    }

    return false;
  });
}

function markdown(
  report: BenchmarkReport,
  acquisitionMs: DistributionSummary,
  candidateUnchanged: boolean,
): string {
  const failed = failures(report);

  return `# F1 Gate 6 Confirmatory Challenge C

## Status

Challenge C is a post-S4R2 confirmatory set. The S4R2 candidate was hash-frozen
before the case definitions were executed and was not modified during the run.

## Results

- cases: ${report.metrics.caseCount}
- primary accuracy: ${(report.metrics.primaryStateAccuracy * 100).toFixed(2)}%
- macro F1: ${report.metrics.macroF1.toFixed(6)}
- risk loss: ${report.metrics.riskWeightedLoss.toFixed(3)}
- high-confidence error rate: ${(report.metrics.highConfidenceErrorRate * 100).toFixed(2)}%
- critical violations: ${report.metrics.criticalInvariantViolationCount}
- proposition coverage: ${report.metrics.propositionAggregate.coverage === null ? "n/a" : `${(report.metrics.propositionAggregate.coverage * 100).toFixed(2)}%`}
- proposition accuracy: ${report.metrics.propositionAggregate.accuracy === null ? "n/a" : `${(report.metrics.propositionAggregate.accuracy * 100).toFixed(2)}%`}

Confirmatory acceptance: **${confirmatoryPass(report)}**

## Failures

${
  failed.length === 0
    ? "- none"
    : failed
        .map(
          (item) =>
            `- \`${item.id}\`: expected \`${item.expectedPrimaryState}\`, got \`${item.actual.kind}\` (${item.actual.confidence}), risk=${item.riskCost}, critical=${item.criticalInvariantViolation}.`,
        )
        .join("\n")
}

## Candidate immutability

S4R2 unchanged during Challenge C: **${candidateUnchanged}**

## Acquisition

- mean: ${acquisitionMs.mean?.toFixed(3) ?? "n/a"} ms
- p95: ${acquisitionMs.p95?.toFixed(3) ?? "n/a"} ms
- max: ${acquisitionMs.max?.toFixed(3) ?? "n/a"} ms

These remain research-harness measurements.

## Next decision

${
  confirmatoryPass(report)
    ? "Challenge C did not falsify S4R2. Proceed to S4R2-specific temporal validation, runtime inspection-freshness/invalidation validation, then final production-path integration/latency evidence before the ADR/runbook freeze."
    : "Challenge C falsified S4R2. Do not edit Challenge C ground truth. Remediate the architecture separately; Challenge C is now a fixed remedial set and a new independent confirmatory set will be required after remediation."
}
`;
}

const out = pathArg("--out");
const analysis = pathArg("--analysis");
const expectedCandidateHash = rawArg("--candidate-hash");

const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
}).trim();

const browser: Browser = await chromium.launch({
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});

try {
  const cases = await challengeCCases(context);
  const riskModel = await loadF1RiskModel();
  const strategy = gate6CandidateV2Strategy();

  const challengeC = await runBenchmark({
    corpusVersion: CHALLENGE_C_VERSION,
    cases,
    strategy,
    riskModel,
  });

  const candidateHashAfter = await fileHash(
    resolve(
      REPO_ROOT,
      "packages/browser/src/perception/research/gate6-candidate-v2.ts",
    ),
  );

  const candidateUnchanged = candidateHashAfter === expectedCandidateHash;

  const acquisitionMs = summarize(
    cases
      .map((item) => item.input.acquisitionMs)
      .filter((value): value is number => value !== undefined),
  );

  const artifact = {
    schemaVersion: 1,
    experiment: "f1-gate6-confirmatory-challenge-c",
    generatedAt: new Date().toISOString(),
    metadata: {
      sourceRevision,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      chromiumVersion: browser.version(),
      challengeCCorpusVersion: CHALLENGE_C_VERSION,
      candidateSha256Before: expectedCandidateHash,
      candidateSha256After: candidateHashAfter,
      hashes: {
        riskModel: await fileHash(
          resolve(REPO_ROOT, "docs/hardening/perception/f1-risk-model.json"),
        ),
        challengeCDefinitions: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-challenge-c.ts",
          ),
        ),
      },
    },
    challengeC,
    acquisitionMs,
    candidateUnchanged,
    confirmatoryPassed: confirmatoryPass(challengeC),
    limitations: [
      "Challenge C is deterministic synthetic confirmatory evidence, not recorded/live Tier C/D evidence.",
      "S4R2-specific temporal stabilization validation remains outstanding.",
      "Runtime mutation authorization still accepts stored ready states without a high-confidence/unresolved-evidence freshness gate.",
      "Browser activity to InteractionPolicy invalidation wiring remains outstanding.",
      "Final production-path latency/payload remains outstanding.",
    ],
  };

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  await mkdir(dirname(analysis), {
    recursive: true,
  });
  await writeFile(
    analysis,
    markdown(challengeC, acquisitionMs, candidateUnchanged),
    "utf8",
  );
} finally {
  await context.close();
  await browser.close();
}
