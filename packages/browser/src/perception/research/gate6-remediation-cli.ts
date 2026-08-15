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

import {
  startFixtureServer,
  type FixtureServer,
} from "../../fixtures/fixture-server.js";
import { loadF1RiskModel } from "../benchmark/risk-model.js";
import { runBenchmark } from "../benchmark/runner.js";
import type {
  BenchmarkCase,
  BenchmarkReport,
  DistributionSummary,
} from "../benchmark/types.js";
import {
  LOCAL_PERCEPTION_CASES,
  LOCAL_PERCEPTION_CORPUS_VERSION,
} from "../corpus/local-corpus.js";
import {
  collectResearchEvidence,
  PageObservationRecorder,
} from "./evidence.js";
import {
  gate6CandidateStrategy,
  type Gate6CandidateInput,
} from "./gate6-candidate.js";
import {
  GATE6_HELDOUT_CASES,
  gate6Disposition,
  gate6Document,
} from "./gate6-heldout.js";
import {
  collectAccessibleSemanticAudit,
  collectGate6DomSemantics,
  pageSignals,
} from "./gate6-validation.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const CHALLENGE_A_VERSION = 6001;

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

async function candidateInputForPage(
  page: Page,
  httpStatus?: number,
): Promise<Gate6CandidateInput> {
  const recorder = new PageObservationRecorder(page);
  const started = performance.now();
  const evidence = await collectResearchEvidence(page, recorder);
  const [signals, accessibility, dom] = await Promise.all([
    pageSignals(page, httpStatus),
    collectAccessibleSemanticAudit(page),
    collectGate6DomSemantics(page),
  ]);
  const acquisitionMs = performance.now() - started;

  return {
    signals,
    evidence: evidence.evidence,
    accessibilitySemantics: {
      available: accessibility.available,
      verificationCue: accessibility.verificationCue,
      authenticationCue: accessibility.authenticationCue,
      restrictionCue: accessibility.restrictionCue,
      errorCue: accessibility.errorCue,
      interstitialCue: accessibility.interstitialCue,
    },
    domSemantics: dom,
    acquisitionMs,
    evidenceBytes: evidence.payload.totalBytes,
  };
}

async function challengeACases(
  context: BrowserContext,
): Promise<BenchmarkCase<Gate6CandidateInput>[]> {
  const cases: BenchmarkCase<Gate6CandidateInput>[] = [];

  for (const definition of GATE6_HELDOUT_CASES) {
    const page = await context.newPage();
    try {
      await page.setContent(gate6Document(definition.title, definition.body), {
        waitUntil: "load",
      });
      cases.push({
        id: definition.id,
        tier: "A",
        description: definition.description,
        input: await candidateInputForPage(page, definition.httpStatus),
        expectedPropositions: definition.expectedPropositions,
        expectedPrimaryState: definition.expectedPrimaryState,
        expectedDisposition: gate6Disposition(definition.expectedPrimaryState),
        criticality: definition.criticality,
        tags: [...definition.tags],
      });
    } finally {
      await page.close();
    }
  }

  return cases;
}

async function frozenCases(
  context: BrowserContext,
  server: FixtureServer,
): Promise<BenchmarkCase<Gate6CandidateInput>[]> {
  const cases: BenchmarkCase<Gate6CandidateInput>[] = [];

  for (const item of LOCAL_PERCEPTION_CASES) {
    let input: Gate6CandidateInput;

    if (item.pipelineEligible && item.route !== undefined) {
      const page = await context.newPage();
      try {
        const response = await page.goto(
          new URL(item.route, server.url).toString(),
          { waitUntil: "load" },
        );
        input = await candidateInputForPage(page, response?.status());
      } finally {
        await page.close();
      }
    } else {
      input = {
        signals: item.input,
      };
    }

    cases.push({
      id: item.id,
      tier: item.tier,
      description: item.description,
      input,
      expectedPropositions: item.expectedPropositions,
      expectedPrimaryState: item.expectedPrimaryState,
      expectedDisposition: item.expectedDisposition,
      criticality: item.criticality,
      tags: [...item.tags],
      ...(item.notes === undefined ? {} : { notes: item.notes }),
    });
  }

  return cases;
}

function accepted(report: BenchmarkReport): boolean {
  return (
    report.metrics.primaryStateAccuracy >= 0.98 &&
    report.metrics.macroF1 >= 0.98 &&
    report.metrics.highConfidenceErrorRate === 0 &&
    report.metrics.criticalInvariantViolationCount === 0 &&
    report.metrics.riskWeightedLoss < 36.81818181818182 &&
    report.metrics.propositionAggregate.coverage === 1 &&
    report.metrics.propositionAggregate.accuracy === 1
  );
}

function markdown(report: {
  frozen: BenchmarkReport;
  challengeA: BenchmarkReport;
  acquisition: {
    frozenMs: DistributionSummary;
    challengeAMs: DistributionSummary;
  };
  accepted: boolean;
}): string {
  const metricRow = (name: string, item: BenchmarkReport) =>
    `| ${name} | ${item.metrics.caseCount} | ${(item.metrics.primaryStateAccuracy * 100).toFixed(2)}% | ${item.metrics.macroF1.toFixed(6)} | ${item.metrics.riskWeightedLoss.toFixed(3)} | ${(item.metrics.highConfidenceErrorRate * 100).toFixed(2)}% | ${item.metrics.criticalInvariantViolationCount} | ${((item.metrics.propositionAggregate.coverage ?? 0) * 100).toFixed(2)}% | ${((item.metrics.propositionAggregate.accuracy ?? 0) * 100).toFixed(2)}% |`;

  const failures = (item: BenchmarkReport) =>
    item.results
      .filter(
        (result) =>
          result.actual.kind !== result.expectedPrimaryState ||
          result.criticalInvariantViolation,
      )
      .map(
        (result) =>
          `- \`${result.id}\`: expected \`${result.expectedPrimaryState}\`, got \`${result.actual.kind}\` (${result.actual.confidence}), risk ${result.riskCost}, critical=${result.criticalInvariantViolation}.`,
      )
      .join("\n") || "- none";

  return `# F1 Gate 6 S4R Remediation Study

## Status

Research-only remediation after Challenge A falsified Gate-5 S4.

Challenge A is **not held-out anymore**. Its failure classes informed S4R.
Passing this study cannot freeze the architecture. A new Challenge B is required
after S4R is fixed.

S4R does not modify the production classifier, production browser acquisition,
protocol, runtime policy, frozen Gate-2 corpus, Gate-1 risk model, or Gates 3-5
result artifacts.

## Candidate change

S4R keeps proposition-first inference and Gate-1 precedence, but replaces the
Gate-5 literal-string/accessibility stand-ins with bounded structural-semantic
evidence:

- verification directives in presented headings;
- verification semantics correlated with the exact DOM ordinal of a
  presentation-qualified iframe;
- accessibility verification semantics only when corroborated by a presented
  frame;
- authentication headings plus credential/account-chooser structure;
- restriction/error semantics anchored in visible heading/alert surfaces or
  direct HTTP status;
- actual blocking dialog structure;
- labelled visible canvas semantics without treating pixel occupancy itself as
  interstitial evidence;
- evidence-strength confidence rules rather than support-signal count.

Quoted blocker terminology without a blocking surface is treated as ambiguity,
not as a blocker, and therefore cannot receive high-confidence blocker semantics.

## Results

| Set | Cases | Accuracy | Macro F1 | Mean risk | HC error | Critical | Prop coverage | Prop accuracy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${metricRow("Frozen Tier A", report.frozen)}
${metricRow("Challenge A remediation", report.challengeA)}

### Frozen failures

${failures(report.frozen)}

### Challenge A failures

${failures(report.challengeA)}

## Acquisition cost

Frozen browser-acquired cases:

- mean: ${report.acquisition.frozenMs.mean?.toFixed(3) ?? "n/a"} ms
- p95: ${report.acquisition.frozenMs.p95?.toFixed(3) ?? "n/a"} ms

Challenge A:

- mean: ${report.acquisition.challengeAMs.mean?.toFixed(3) ?? "n/a"} ms
- p95: ${report.acquisition.challengeAMs.p95?.toFixed(3) ?? "n/a"} ms

These remain research-harness measurements, not the final production budget.

## Decision

Known-set acceptance: **${report.accepted}**.

${
  report.accepted
    ? "S4R has recovered the frozen deterministic corpus and the now-remedial Challenge A. This is necessary but not sufficient. The next Gate-6 action is a new confirmatory Challenge B authored after this candidate, plus channel-unavailability and temporal validation using S4R."
    : "S4R has not yet recovered the frozen corpus and Challenge A. Do not author Challenge B or freeze the architecture until the remaining failure is understood and remediated without weakening Gate-1 semantics."
}
`;
}

const out = arg("--out");
const analysis = arg("--analysis");
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
}).trim();

const browser: Browser = await chromium.launch({
  headless: true,
});
const context: BrowserContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const server = await startFixtureServer();

try {
  const [frozen, challengeA] = await Promise.all([
    frozenCases(context, server),
    challengeACases(context),
  ]);
  const riskModel = await loadF1RiskModel();
  const strategy = gate6CandidateStrategy();

  const frozenReport = await runBenchmark({
    corpusVersion: LOCAL_PERCEPTION_CORPUS_VERSION,
    cases: frozen,
    strategy,
    riskModel,
  });
  const challengeAReport = await runBenchmark({
    corpusVersion: CHALLENGE_A_VERSION,
    cases: challengeA,
    strategy,
    riskModel,
  });

  const acceptedResult = accepted(frozenReport) && accepted(challengeAReport);

  const report = {
    schemaVersion: 1,
    experiment: "f1-gate6-s4r-remediation",
    generatedAt: new Date().toISOString(),
    metadata: {
      sourceRevision,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      playwrightVersion: JSON.parse(
        await readFile(
          resolve(
            REPO_ROOT,
            "packages/browser/node_modules/playwright/package.json",
          ),
          "utf8",
        ),
      ).version as string,
      chromiumVersion: browser.version(),
      hashes: {
        riskModel: await fileHash(
          resolve(REPO_ROOT, "docs/hardening/perception/f1-risk-model.json"),
        ),
        frozenCorpus: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/corpus/local-corpus.ts",
          ),
        ),
        gate5Strategy: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate5-strategies.ts",
          ),
        ),
        gate6Candidate: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-candidate.ts",
          ),
        ),
      },
    },
    frozen: frozenReport,
    challengeA: challengeAReport,
    acquisition: {
      frozenMs: summarize(
        frozen
          .map((item) => item.input.acquisitionMs)
          .filter((value): value is number => value !== undefined),
      ),
      challengeAMs: summarize(
        challengeA
          .map((item) => item.input.acquisitionMs)
          .filter((value): value is number => value !== undefined),
      ),
    },
    accepted: acceptedResult,
    nextGate6Step: acceptedResult
      ? "author_confirmatory_challenge_b"
      : "remediate_s4r_known_failures",
    limitations: [
      "Challenge A informed S4R and is no longer held-out generalization evidence.",
      "S4R has not yet been tested on a post-remediation confirmatory Challenge B.",
      "Channel-unavailability behavior must be reevaluated with proposition indeterminacy and confidence degradation.",
      "Decision-relevant stabilization remains validation-only and is not yet production-integrated.",
      "Runtime inspection invalidation on decision-relevant browser activity remains a production dependency.",
      "Tier C/D recorded/live validation and final production latency/payload remain outstanding.",
    ],
  };

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await mkdir(dirname(analysis), { recursive: true });
  await writeFile(
    analysis,
    markdown({
      frozen: frozenReport,
      challengeA: challengeAReport,
      acquisition: report.acquisition,
      accepted: acceptedResult,
    }),
    "utf8",
  );
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
