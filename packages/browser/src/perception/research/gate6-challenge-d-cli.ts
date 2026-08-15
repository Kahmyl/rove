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
  gate6CandidateV3Strategy,
  type Gate6CandidateV3Input,
} from "./gate6-candidate-v3.js";
import {
  GATE6_CHALLENGE_D_CASES,
  challengeDDisposition,
} from "./gate6-challenge-d.js";
import { collectGate6SurfaceFactsV3 } from "./gate6-semantics-v3.js";
import { pageSignals } from "./gate6-validation.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

const CORPUS_VERSION = 6004;

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];

  if (value === undefined) {
    throw new Error(`${name} is required.`);
  }

  return resolve(value);
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
): Promise<BenchmarkCase<Gate6CandidateV3Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV3Input>[] = [];

  for (const definition of GATE6_CHALLENGE_D_CASES) {
    const page = await context.newPage();
    const recorder = new PageObservationRecorder(page);

    try {
      await page.setContent(
        `<!doctype html><html><head><title>${definition.title}</title></head><body>${definition.body}</body></html>`,
        { waitUntil: "load" },
      );

      const started = performance.now();

      const evidence = await collectResearchEvidence(page, recorder);

      const [signals, surfaceFacts] = await Promise.all([
        pageSignals(page, definition.httpStatus),
        collectGate6SurfaceFactsV3(page),
      ]);

      const acquisitionMs = performance.now() - started;

      cases.push({
        id: definition.id,
        tier: "A",
        description: definition.description,
        input: {
          signals,
          evidence: evidence.evidence,
          surfaceFacts,
          acquisitionMs,
          evidenceBytes: evidence.payload.totalBytes,
        },
        expectedPropositions: definition.expectedPropositions,
        expectedPrimaryState: definition.expectedPrimaryState,
        expectedDisposition: challengeDDisposition(
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

function markdown(
  report: BenchmarkReport,
  candidateUnchanged: boolean,
  acquisition: DistributionSummary,
) {
  const mismatches = failures(report);

  const mismatchText =
    mismatches.length === 0
      ? "- none"
      : mismatches
          .map(
            (item) =>
              `- \`${item.id}\`: expected \`${item.expectedPrimaryState}\`, got \`${item.actual.kind}\` (${item.actual.confidence}); risk=${item.riskCost}; critical=${item.criticalInvariantViolation}.`,
          )
          .join("\n");

  return `# F1 Gate 6 Independent Confirmatory Challenge D

## Purpose

Challenge D was authored only after S4R3 reached exactness on the fixed 68-case known set and after the accepted S4R3 candidate/semantics hashes were frozen.

Challenge D specifically pressures semantic-scope composition:

- blocker-like copy in nonblocking footers, sidebars, alerts, and partial-feature cards;
- real blockers layered over documentation or settings pages;
- restriction/error semantics in blocking dialogs;
- whole-document blocker surfaces without \`main\` or \`role=alert\`;
- product/company names that contain meta-context words such as “Example” or “Demo”;
- overlapping authentication and HTTP restriction;
- unknown modal interstitial preservation.

No Challenge D result is used to patch S4R3 during this run.

## Metrics

- cases: ${report.metrics.caseCount}
- primary accuracy: ${(report.metrics.primaryStateAccuracy * 100).toFixed(2)}%
- macro F1: ${report.metrics.macroF1.toFixed(6)}
- risk-weighted loss: ${report.metrics.riskWeightedLoss.toFixed(6)}
- high-confidence error rate: ${(report.metrics.highConfidenceErrorRate * 100).toFixed(2)}%
- critical invariant violations: ${report.metrics.criticalInvariantViolationCount}
- proposition coverage: ${report.metrics.propositionAggregate.coverage === null ? "n/a" : `${(report.metrics.propositionAggregate.coverage * 100).toFixed(2)}%`}
- proposition accuracy: ${report.metrics.propositionAggregate.accuracy === null ? "n/a" : `${(report.metrics.propositionAggregate.accuracy * 100).toFixed(2)}%`}

## Failures

${mismatchText}

## Acquisition

- sample count: ${acquisition.sampleCount}
- mean: ${acquisition.mean?.toFixed(3) ?? "n/a"} ms
- median: ${acquisition.median?.toFixed(3) ?? "n/a"} ms
- p95: ${acquisition.p95?.toFixed(3) ?? "n/a"} ms
- max: ${acquisition.max?.toFixed(3) ?? "n/a"} ms

## Freeze integrity

S4R3 candidate/semantics unchanged during Challenge D: **${candidateUnchanged}**

## Confirmatory status

Challenge D acceptance: **${confirmatoryPass(report) && candidateUnchanged}**

A failure is evidence against freezing the architecture and must not be remediated by changing Challenge D ground truth.
`;
}

const out = arg("--out");
const analysis = arg("--analysis");
const candidatePath = arg("--candidate");
const semanticsPath = arg("--semantics");
const expectedCandidateHash =
  process.argv[process.argv.indexOf("--candidate-hash") + 1];
const expectedSemanticsHash =
  process.argv[process.argv.indexOf("--semantics-hash") + 1];

if (
  expectedCandidateHash === undefined ||
  expectedSemanticsHash === undefined
) {
  throw new Error("--candidate-hash and --semantics-hash are required.");
}

const candidateHashBefore = await fileHash(candidatePath);
const semanticsHashBefore = await fileHash(semanticsPath);

if (
  candidateHashBefore !== expectedCandidateHash ||
  semanticsHashBefore !== expectedSemanticsHash
) {
  throw new Error("S4R3 hash freeze failed before Challenge D.");
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
    strategy: gate6CandidateV3Strategy(),
    riskModel,
  });

  const candidateHashAfter = await fileHash(candidatePath);
  const semanticsHashAfter = await fileHash(semanticsPath);

  const candidateUnchanged =
    candidateHashAfter === expectedCandidateHash &&
    semanticsHashAfter === expectedSemanticsHash;

  const acquisition = summarize(
    cases
      .map((item) => item.input.acquisitionMs)
      .filter((value): value is number => value !== undefined),
  );

  const artifact = {
    schemaVersion: 1,
    experiment: "f1-gate6-independent-confirmatory-challenge-d",
    generatedAt: new Date().toISOString(),
    metadata: {
      sourceRevision,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      chromiumVersion: browser.version(),
      hashes: {
        candidateV3: candidateHashAfter,
        semanticsV3: semanticsHashAfter,
        challengeD: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-challenge-d.ts",
          ),
        ),
        riskModel: await fileHash(
          resolve(REPO_ROOT, "docs/hardening/perception/f1-risk-model.json"),
        ),
      },
    },
    challengeD: report,
    acquisition,
    candidateUnchanged,
    confirmatoryPassed: confirmatoryPass(report) && candidateUnchanged,
  };

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  await mkdir(dirname(analysis), { recursive: true });
  await writeFile(
    analysis,
    markdown(report, candidateUnchanged, acquisition),
    "utf8",
  );
} finally {
  await context.close();
  await browser.close();
}
