import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type BrowserContext } from "playwright";

import {
  startFixtureServer,
  type FixtureServer,
} from "../../fixtures/fixture-server.js";
import { runBenchmark } from "../benchmark/runner.js";
import { loadF1RiskModel } from "../benchmark/risk-model.js";
import type {
  BenchmarkCase,
  BenchmarkReport,
  DistributionSummary,
} from "../benchmark/types.js";
import {
  GATE6_HELDOUT_CASES,
  gate6Disposition,
  gate6Document,
} from "./gate6-heldout.js";
import {
  acquireHeldoutCase,
  canvasPixelFeature,
  predictS4,
  runStableThenBlockerObservation,
  runTemporalChallenges,
  withUnavailableFrameGeometry,
  withoutEvidence,
  type AccessibleSemanticAudit,
  type HeldoutAcquisition,
} from "./gate6-validation.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const HELDOUT_CORPUS_VERSION = 6001;

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

function heldoutBenchmarkCases(
  acquisitions: HeldoutAcquisition[],
): BenchmarkCase<HeldoutAcquisition["input"]>[] {
  return acquisitions.map((acquired) => ({
    id: acquired.definition.id,
    tier: "A",
    description: acquired.definition.description,
    input: acquired.input,
    expectedPropositions: acquired.definition.expectedPropositions,
    expectedPrimaryState: acquired.definition.expectedPrimaryState,
    expectedDisposition: gate6Disposition(
      acquired.definition.expectedPrimaryState,
    ),
    criticality: acquired.definition.criticality,
    tags: [...acquired.definition.tags],
    ...(acquired.definition.notes === undefined
      ? {}
      : { notes: acquired.definition.notes }),
  }));
}

function s4BenchmarkStrategy() {
  return {
    name: "gate5-s4-heldout",
    async predict(input: HeldoutAcquisition["input"], _context: unknown) {
      const strategy = (await import("./gate5-strategies.js"))
        .gate5Strategies()
        .find(
          (candidate) => candidate.name === "s4-proposition-first-stabilized",
        );

      if (strategy === undefined) {
        throw new Error("Gate 5 S4 strategy is unavailable.");
      }

      return await strategy.predict(input, {
        id: "gate6-opaque-heldout",
        tier: "A",
        description: "held-out",
        criticality: "standard",
        tags: [],
      });
    },
  };
}

async function runChannelAvailability(acquisitions: HeldoutAcquisition[]) {
  const byId = new Map(acquisitions.map((item) => [item.definition.id, item]));

  const cases = [
    {
      id: "verification-frame-without-all-research-evidence",
      source: byId.get("heldout-verification-frame-title-only")!,
      transform: withoutEvidence,
    },
    {
      id: "verification-frame-with-unavailable-geometry",
      source: byId.get("heldout-verification-frame-title-only")!,
      transform: withUnavailableFrameGeometry,
    },
    {
      id: "ordinary-iframe-with-unavailable-geometry",
      source: byId.get("heldout-ready-visible-ordinary-iframe")!,
      transform: withUnavailableFrameGeometry,
    },
    {
      id: "quoted-copy-without-research-evidence",
      source: byId.get("heldout-ready-quoted-verification-doc")!,
      transform: withoutEvidence,
    },
  ];

  return Promise.all(
    cases.map(async (item) => {
      const assessment = await predictS4(item.transform(item.source.input));

      return {
        id: item.id,
        sourceId: item.source.definition.id,
        expectedPrimaryState: item.source.definition.expectedPrimaryState,
        actual: assessment,
        correct:
          assessment.kind === item.source.definition.expectedPrimaryState,
      };
    }),
  );
}

async function runCanvasControls(
  context: BrowserContext,
  server: FixtureServer,
) {
  const legitimate = GATE6_HELDOUT_CASES.find(
    (item) => item.id === "heldout-ready-painted-canvas-app",
  )!;
  const legitimatePage = await context.newPage();
  const unknownPage = await context.newPage();

  try {
    await legitimatePage.setContent(
      gate6Document(legitimate.title, legitimate.body),
      { waitUntil: "load" },
    );
    await unknownPage.goto(
      new URL("/perception/unknown-canvas-interstitial", server.url).toString(),
      { waitUntil: "load" },
    );

    const legitimateFeature = await canvasPixelFeature(legitimatePage);
    const unknownFeature = await canvasPixelFeature(unknownPage);

    return {
      legitimateReady: {
        id: legitimate.id,
        expectedPrimaryState: "ready",
        ...legitimateFeature,
      },
      unknownInterstitial: {
        id: "unknown-canvas-interstitial",
        expectedPrimaryState: "unknown_interstitial",
        ...unknownFeature,
      },
      occupancySemanticallySeparates:
        legitimateFeature.materiallyPainted !==
        unknownFeature.materiallyPainted,
    };
  } finally {
    await legitimatePage.close();
    await unknownPage.close();
  }
}

function accessibilityRows(acquisitions: HeldoutAcquisition[]): Array<{
  id: string;
  audit: AccessibleSemanticAudit;
}> {
  return acquisitions.map((item) => ({
    id: item.definition.id,
    audit: item.accessibilityAudit,
  }));
}

function wrongHighConfidence(report: BenchmarkReport): number {
  return report.results.filter(
    (item) =>
      item.actual.kind !== item.expectedPrimaryState &&
      item.actual.confidence === "high",
  ).length;
}

function formatNumber(value: number | null, digits = 3): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

function markdown(report: {
  heldout: BenchmarkReport;
  acquisitions: {
    latencyMs: DistributionSummary;
    evidenceBytes: DistributionSummary;
  };
  accessibility: ReturnType<typeof accessibilityRows>;
  channels: Awaited<ReturnType<typeof runChannelAvailability>>;
  temporal: Awaited<ReturnType<typeof runTemporalChallenges>>;
  stableThenBlocker: Awaited<
    ReturnType<typeof runStableThenBlockerObservation>
  >;
  canvas: Awaited<ReturnType<typeof runCanvasControls>>;
}): string {
  const failures = report.heldout.results.filter(
    (item) =>
      item.actual.kind !== item.expectedPrimaryState ||
      item.criticalInvariantViolation,
  );
  const rows = report.heldout.results
    .map(
      (item) =>
        `| \`${item.id}\` | \`${item.expectedPrimaryState}\` | \`${item.actual.kind}\` | ${item.actual.confidence} | ${item.riskCost.toFixed(1)} | ${item.criticalInvariantViolation ? "yes" : "no"} |`,
    )
    .join("\n");
  const temporalRows = report.temporal
    .map((item) => {
      const wholeDocumentActual =
        item.wholeDocument.actualAtObservation === null
          ? `unavailable (${item.wholeDocument.acquisitionStatus})`
          : `\`${item.wholeDocument.actualAtObservation.kind}\``;

      return `| \`${item.id}\` | ${item.delayMs} | ${item.continuousNoise ? "yes" : "no"} | ${formatNumber(item.wholeDocument.observation.elapsedMs)} | ${item.wholeDocument.observation.timedOut ? "yes" : "no"} | \`${item.wholeDocument.expectedAtObservation}\` | ${wholeDocumentActual} | ${formatNumber(item.relevantEvidence.observation.elapsedMs)} | ${item.relevantEvidence.observation.timedOut ? "yes" : "no"} | \`${item.relevantEvidence.expectedAtObservation}\` | \`${item.relevantEvidence.actualAtObservation.kind}\` |`;
    })
    .join("\n");

  return `# F1 Gate 6 Held-Out Challenge

## Status

Pre-freeze validation challenge against the Gate-5 S4 candidate.

**Architecture is not frozen by this artifact.** Gate 6 first attempts to
falsify S4 on held-out semantics, browser accessibility, channel-unavailability,
temporal variation, irrelevant mutation, confidence, and legitimate visual
controls.

Frozen Gate 1-5 artifacts and production behavior are unchanged.

## Held-out S4 result

- cases: ${report.heldout.metrics.caseCount}
- primary accuracy: ${(report.heldout.metrics.primaryStateAccuracy * 100).toFixed(2)}%
- macro F1: ${report.heldout.metrics.macroF1.toFixed(6)}
- mean risk loss: ${report.heldout.metrics.riskWeightedLoss.toFixed(3)}
- high-confidence error rate: ${(report.heldout.metrics.highConfidenceErrorRate * 100).toFixed(2)}%
- wrong high-confidence predictions: ${wrongHighConfidence(report.heldout)}
- critical invariant violations: ${report.heldout.metrics.criticalInvariantViolationCount}
- proposition coverage: ${((report.heldout.metrics.propositionAggregate.coverage ?? 0) * 100).toFixed(2)}%
- proposition accuracy: ${((report.heldout.metrics.propositionAggregate.accuracy ?? 0) * 100).toFixed(2)}%

| Case | Expected | S4 | Confidence | Risk | Critical |
| --- | --- | --- | --- | ---: | --- |
${rows}

Held-out failures: **${failures.length}/${report.heldout.metrics.caseCount}**.

${
  failures.length === 0
    ? "The held-out set did not falsify S4. Gate 6 must still complete live/recorded validation and production dependency review before freezing."
    : "The held-out set falsifies the Gate-5 S4 implementation as a production-ready classifier. Gate 6 must remediate the architecture candidate and rerun this challenge before an ADR can freeze it."
}

## Browser accessibility audit

Gate 5's winning score used an HTML \`aria-label\` regex as an
accessibility-shaped signal. Gate 6 separately executes Playwright
\`ariaSnapshot()\` against held-out variants and persists only bounded
hash/count/boolean facts.

The audit includes:

- \`aria-labelledby\` dialog semantics;
- iframe accessible naming;
- hidden challenge-labelled content;
- authentication/restriction/error semantic variants.

Raw accessibility snapshots are not persisted.

## Channel unavailability

${report.channels
  .map(
    (item) =>
      `- \`${item.id}\`: expected \`${item.expectedPrimaryState}\`, got \`${item.actual.kind}\` (${item.actual.confidence}); ${item.correct ? "correct" : "incorrect"}.`,
  )
  .join("\n")}

Missing evidence is measured explicitly. Gate 1 forbids turning collector
failure into \`unknown_interstitial\` merely because implementation evidence is
missing.

For temporal validation, whole-document cross-channel acquisition may be
reported as \`unstable_during_acquisition\` with no fabricated semantic
assessment. The decision-relevant branch is a validation-only probe: after the
decision-relevant signature stabilizes, it evaluates these authored temporal
fixtures from bounded semantic signals instead of requiring unrelated DOM noise
to become globally quiet.

## Temporal challenge

The Gate-5 whole-document quiet policy is compared with a validation-only
decision-relevant stability probe. The latter is **not yet a frozen production
algorithm**; it tests whether irrelevant DOM churn and long-lived semantic
instability invalidate whole-document quiet as the architecture primitive.

| Scenario | Delay ms | Noise | Whole-doc ms | Whole-doc timeout | Expected @ observation | S4 @ observation | Relevant ms | Relevant timeout | Expected @ observation | Candidate-safe result |
| --- | ---: | --- | ---: | --- | --- | --- | ---: | --- | --- | --- |
${temporalRows}

The 1200 ms case intentionally exceeds the bounded 1000 ms validation envelope.
A timeout while semantic instability remains is represented as \`loading\`,
not forced into a stable blocker or \`ready\`.

## Observation-point semantics

A stable public page that receives a verification overlay ${report.stableThenBlocker.delayMs} ms later produced:

- initial observation: \`${report.stableThenBlocker.initial.kind}\`;
- later re-observation: \`${report.stableThenBlocker.later.kind}\`.

Gate 1 defines state at an observation point, not as a prediction of all future
DOM changes. Production safety therefore depends on invalidating/requiring a
fresh inspection after relevant browser activity rather than universally
waiting long enough to predict future blockers.

## Painted-canvas control

Legitimate canvas:

- materially painted: ${report.canvas.legitimateReady.materiallyPainted}
- non-transparent ratio: ${report.canvas.legitimateReady.nonTransparentPixelRatio}
- expected: \`ready\`

Known unknown interstitial canvas:

- materially painted: ${report.canvas.unknownInterstitial.materiallyPainted}
- non-transparent ratio: ${report.canvas.unknownInterstitial.nonTransparentPixelRatio}
- expected: \`unknown_interstitial\`

Pixel occupancy semantically separates them: **${report.canvas.occupancySemanticallySeparates}**.

This directly tests Gate 5's limitation. If both are materially painted, pixel
occupancy is not sufficient evidence for unknown-interstitial semantics.

## Acquisition cost on held-out browser cases

- mean acquisition: ${formatNumber(report.acquisitions.latencyMs.mean)} ms
- p95 acquisition: ${formatNumber(report.acquisitions.latencyMs.p95)} ms
- mean bounded evidence: ${formatNumber(report.acquisitions.evidenceBytes.mean, 1)} bytes
- p95 bounded evidence: ${formatNumber(report.acquisitions.evidenceBytes.p95, 1)} bytes

These are research-collector costs, not yet a production default-path budget.

## Freeze decision

This artifact intentionally does not create the ADR or production runbook.

Gate 6 may freeze only after:

1. held-out failures are remediated without changing Gate-1 semantics or frozen
   ground truth;
2. confidence is calibrated to evidence strength and channel availability;
3. browser accessibility semantics replace HTML-regex stand-ins where
   accessibility is claimed;
4. temporal policy handles long-lived instability and irrelevant mutation;
5. inspection freshness after relevant browser activity is resolved as a
   production dependency;
6. recorded/live read-only validation is completed;
7. production-path latency/payload is measured;
8. the final candidate reruns deterministic, held-out, temporal, privacy, and
   regression gates.
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
  viewport: {
    width: 1440,
    height: 900,
  },
});
const fixtureServer = await startFixtureServer();

try {
  const acquisitions: HeldoutAcquisition[] = [];

  for (const definition of GATE6_HELDOUT_CASES) {
    acquisitions.push(await acquireHeldoutCase(context, definition));
  }

  const heldout = await runBenchmark({
    corpusVersion: HELDOUT_CORPUS_VERSION,
    cases: heldoutBenchmarkCases(acquisitions),
    strategy: s4BenchmarkStrategy(),
    riskModel: await loadF1RiskModel(),
  });
  const channels = await runChannelAvailability(acquisitions);
  const temporal = await runTemporalChallenges(context);
  const stableThenBlocker = await runStableThenBlockerObservation(context);
  const canvas = await runCanvasControls(context, fixtureServer);

  const report = {
    schemaVersion: 1,
    experiment: "f1-gate6-heldout-challenge",
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
      heldoutCorpusVersion: HELDOUT_CORPUS_VERSION,
      hashes: {
        gate1RiskModel: await fileHash(
          resolve(REPO_ROOT, "docs/hardening/perception/f1-risk-model.json"),
        ),
        frozenClassifier: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/safety/page-state-classifier.ts",
          ),
        ),
        frozenBrowserSession: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/playwright-browser-session.ts",
          ),
        ),
        gate2Corpus: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/corpus/local-corpus.ts",
          ),
        ),
        gate4Results: await fileHash(
          resolve(
            REPO_ROOT,
            "docs/hardening/perception/experiments/f1-gate4-results.json",
          ),
        ),
        gate5Strategies: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate5-strategies.ts",
          ),
        ),
        gate5Results: await fileHash(
          resolve(
            REPO_ROOT,
            "docs/hardening/perception/experiments/f1-gate5-strategy-results.json",
          ),
        ),
      },
    },
    heldout,
    acquisitions: {
      latencyMs: summarize(
        acquisitions.map((item) => item.acquisition.totalMs),
      ),
      evidenceBytes: summarize(
        acquisitions.map((item) => item.acquisition.evidenceBytes),
      ),
    },
    accessibility: accessibilityRows(acquisitions),
    channels,
    temporal,
    stableThenBlocker,
    canvas,
    freezeEligible:
      heldout.metrics.primaryStateAccuracy >= 0.98 &&
      heldout.metrics.macroF1 >= 0.98 &&
      heldout.metrics.highConfidenceErrorRate === 0 &&
      heldout.metrics.criticalInvariantViolationCount === 0 &&
      temporal.every(
        (item) =>
          item.relevantEvidence.actualAtObservation.kind ===
          item.relevantEvidence.expectedAtObservation,
      ) &&
      !canvas.occupancySemanticallySeparates,
    limitations: [
      "This is a held-out deterministic challenge, not Tier C or Tier D validation.",
      "The decision-relevant temporal probe is validation-only and is not yet the frozen production observation algorithm.",
      "Held-out semantic cases are synthetic and cannot substitute for recorded/live validation.",
      "Production inspection freshness after asynchronous relevant DOM activity remains a dependency to validate before freeze.",
    ],
  };

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await mkdir(dirname(analysis), { recursive: true });
  await writeFile(
    analysis,
    markdown({
      heldout,
      acquisitions: report.acquisitions,
      accessibility: report.accessibility,
      channels,
      temporal,
      stableThenBlocker,
      canvas,
    }),
    "utf8",
  );
} finally {
  await context.close();
  await browser.close();
  await fixtureServer.close();
}
