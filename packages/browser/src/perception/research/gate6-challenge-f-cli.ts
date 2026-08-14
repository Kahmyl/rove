import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type BrowserContext } from "playwright";

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
  gate6CandidateV5Strategy,
  type Gate6CandidateV5Input,
} from "./gate6-candidate-v5.js";
import {
  GATE6_CHALLENGE_F_CASES,
  challengeFDisposition,
} from "./gate6-challenge-f.js";
import { collectGate6SurfaceFactsV5 } from "./gate6-semantics-v5.js";
import { pageSignals } from "./gate6-validation.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

const CORPUS_VERSION = 6006;

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

async function acquireCases(
  context: BrowserContext,
): Promise<BenchmarkCase<Gate6CandidateV5Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV5Input>[] = [];

  for (const definition of GATE6_CHALLENGE_F_CASES) {
    const page = await context.newPage();
    const recorder = new PageObservationRecorder(page);

    try {
      await page.setContent(
        [
          "<!doctype html><html><head><title>",
          definition.title,
          "</title></head><body>",
          definition.body,
          "</body></html>",
        ].join(""),
        { waitUntil: "load" },
      );

      const started = performance.now();
      const evidence = await collectResearchEvidence(page, recorder);

      const [signals, surfaceFacts] = await Promise.all([
        pageSignals(page),
        collectGate6SurfaceFactsV5(page),
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
        expectedDisposition: challengeFDisposition(
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

function exactPass(report: BenchmarkReport): boolean {
  return (
    report.metrics.caseCount === 20 &&
    report.metrics.primaryStateAccuracy === 1 &&
    report.metrics.macroF1 === 1 &&
    report.metrics.riskWeightedLoss === 0 &&
    report.metrics.highConfidenceErrorRate === 0 &&
    report.metrics.criticalInvariantViolationCount === 0 &&
    report.metrics.propositionAggregate.coverage === 1 &&
    report.metrics.propositionAggregate.accuracy === 1
  );
}

function markdown(
  report: BenchmarkReport,
  candidateUnchanged: boolean,
  challengeUnchanged: boolean,
  acquisition: DistributionSummary,
): string {
  const mismatch = failures(report);

  const lines = [
    "# F1 Gate 6 Independent Confirmatory Challenge F",
    "",
    "## Method",
    "",
    "Challenge F was authored only after S4R5 reached exactness on all 112 accumulated fixed/remedial cases and the S4R5 hashes were frozen.",
    "",
    "The set is property/metamorphic. It stresses title-token role, alert ownership without relying on button count alone, modal ownership, viewport presentation, root-primary behavior, and blocker overlays above documentation.",
    "",
    "Challenge F is not used to modify S4R5 during this run.",
    "",
    "## Metrics",
    "",
    `- cases: ${report.metrics.caseCount}`,
    `- primary accuracy: ${(report.metrics.primaryStateAccuracy * 100).toFixed(2)}%`,
    `- macro F1: ${report.metrics.macroF1.toFixed(6)}`,
    `- risk-weighted loss: ${report.metrics.riskWeightedLoss.toFixed(6)}`,
    `- high-confidence error rate: ${(report.metrics.highConfidenceErrorRate * 100).toFixed(2)}%`,
    `- critical invariant violations: ${report.metrics.criticalInvariantViolationCount}`,
    `- proposition coverage: ${((report.metrics.propositionAggregate.coverage ?? 0) * 100).toFixed(2)}%`,
    `- proposition accuracy: ${((report.metrics.propositionAggregate.accuracy ?? 0) * 100).toFixed(2)}%`,
    "",
    "## Failures",
    "",
  ];

  if (mismatch.length === 0) {
    lines.push("- none");
  } else {
    for (const item of mismatch) {
      lines.push(
        `- ${item.id}: expected ${item.expectedPrimaryState}, got ${item.actual.kind} (${item.actual.confidence}), risk=${item.riskCost}, critical=${item.criticalInvariantViolation}.`,
      );
    }
  }

  lines.push(
    "",
    "## Freeze integrity",
    "",
    `- S4R5 candidate/semantics unchanged: ${candidateUnchanged}`,
    `- Challenge F definition unchanged: ${challengeUnchanged}`,
    "",
    "## Acquisition",
    "",
    `- samples: ${acquisition.sampleCount}`,
    `- mean: ${acquisition.mean?.toFixed(3) ?? "n/a"} ms`,
    `- median: ${acquisition.median?.toFixed(3) ?? "n/a"} ms`,
    `- p95: ${acquisition.p95?.toFixed(3) ?? "n/a"} ms`,
    `- max: ${acquisition.max?.toFixed(3) ?? "n/a"} ms`,
    "",
    "## Confirmatory status",
    "",
    `Independent Challenge F acceptance: ${exactPass(report) && candidateUnchanged && challengeUnchanged}`,
    "",
    "If false, the failure is remedial evidence; Challenge F ground truth remains frozen.",
    "",
  );

  return lines.join("\n");
}

const out = arg("--out");
const analysis = arg("--analysis");
const candidatePath = arg("--candidate");
const semanticsPath = arg("--semantics");
const challengePath = arg("--challenge");

const expectedCandidateHash = stringArg("--candidate-hash");
const expectedSemanticsHash = stringArg("--semantics-hash");
const expectedChallengeHash = stringArg("--challenge-hash");

const candidateHashBefore = await fileHash(candidatePath);
const semanticsHashBefore = await fileHash(semanticsPath);
const challengeHashBefore = await fileHash(challengePath);

if (
  candidateHashBefore !== expectedCandidateHash ||
  semanticsHashBefore !== expectedSemanticsHash
) {
  throw new Error("S4R5 hash freeze failed before Challenge F.");
}

if (challengeHashBefore !== expectedChallengeHash) {
  throw new Error("Challenge F changed before execution.");
}

const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
}).trim();

const browser: Browser = await chromium.launch({
  headless: true,
});

const context: BrowserContext = await browser.newContext({
  viewport: {
    width: 1440,
    height: 900,
  },
});

try {
  const cases = await acquireCases(context);

  const riskModel = await loadF1RiskModel();

  const report = await runBenchmark({
    corpusVersion: CORPUS_VERSION,
    cases,
    strategy: gate6CandidateV5Strategy(),
    riskModel,
  });

  const candidateHashAfter = await fileHash(candidatePath);
  const semanticsHashAfter = await fileHash(semanticsPath);
  const challengeHashAfter = await fileHash(challengePath);

  const candidateUnchanged =
    candidateHashAfter === expectedCandidateHash &&
    semanticsHashAfter === expectedSemanticsHash;

  const challengeUnchanged = challengeHashAfter === expectedChallengeHash;

  const acquisition = summarize(
    cases
      .map((item) => item.input.acquisitionMs)
      .filter((value): value is number => value !== undefined),
  );

  const artifact = {
    schemaVersion: 1,
    experiment: "f1-gate6-independent-confirmatory-challenge-f",
    generatedAt: new Date().toISOString(),
    metadata: {
      sourceRevision,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      chromiumVersion: browser.version(),
      hashes: {
        candidateV5: candidateHashAfter,
        semanticsV5: semanticsHashAfter,
        challengeF: challengeHashAfter,
        riskModel: await fileHash(
          resolve(REPO_ROOT, "docs/hardening/perception/f1-risk-model.json"),
        ),
      },
    },
    challengeF: report,
    acquisition,
    candidateUnchanged,
    challengeUnchanged,
    confirmatoryPassed:
      exactPass(report) && candidateUnchanged && challengeUnchanged,
  };

  await mkdir(dirname(out), { recursive: true });

  await writeFile(out, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  await mkdir(dirname(analysis), { recursive: true });

  await writeFile(
    analysis,
    markdown(report, candidateUnchanged, challengeUnchanged, acquisition),
    "utf8",
  );
} finally {
  await context.close();
  await browser.close();
}
