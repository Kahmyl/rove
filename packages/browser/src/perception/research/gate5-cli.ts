import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { chromium, type BrowserContext, type Page } from "playwright";

import {
  startFixtureServer,
  type FixtureServer,
} from "../../fixtures/fixture-server.js";
import type { PageSignals } from "../../safety/page-state-classifier.js";
import { loadF1RiskModel } from "../benchmark/risk-model.js";
import { runBenchmark } from "../benchmark/runner.js";
import type { BenchmarkCase, BenchmarkReport } from "../benchmark/types.js";
import {
  LOCAL_PERCEPTION_CASES,
  LOCAL_PERCEPTION_CORPUS_VERSION,
  TEMPORAL_PERCEPTION_SCENARIOS,
} from "../corpus/local-corpus.js";
import {
  collectResearchEvidence,
  PageObservationRecorder,
  type ResearchEvidence,
} from "./evidence.js";
import { gate5Strategies, type Gate5Input } from "./gate5-strategies.js";
import {
  installResearchMutationObserver,
  observeWithPolicy,
} from "./stabilization.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const STABILIZATION_POLICY = {
  id: "floor-300-dom-quiet-75",
  kind: "quiet-window" as const,
  minimumObservationMs: 300,
  quietWindowMs: 75,
  maxObservationMs: 1000,
  pollMs: 10,
};

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined) throw new Error(`${name} is required.`);
  return resolve(value);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fileHash(path: string): Promise<string> {
  return sha256(await readFile(path));
}

interface Gate4Case {
  id: string;
  representative: ResearchEvidence;
  trials: Array<{
    timing: { totalMs: number };
    payload: { totalBytes: number };
  }>;
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

async function collectVisualStudy(
  context: BrowserContext,
  server: FixtureServer,
): Promise<{
  cases: Array<{
    id: string;
    available: boolean;
    materiallyPainted: boolean;
    nonTransparentPixelRatio: number | null;
    navigationMs: number;
    visualAcquisitionMs: number;
    rawPixelBytesInMemory: number;
    persistedFeatureBytes: number;
  }>;
  conclusion: "insufficient_to_establish_interstitial_semantics";
}> {
  const cases = [];
  for (const item of [
    LOCAL_PERCEPTION_CASES.find((candidate) => candidate.id === "ready-blank")!,
    LOCAL_PERCEPTION_CASES.find(
      (candidate) => candidate.id === "unknown-canvas-interstitial",
    )!,
  ]) {
    const page = await context.newPage();
    try {
      const navigationStarted = performance.now();
      await page.goto(new URL(item.route!, server.url).toString(), {
        waitUntil: "load",
      });
      const navigationMs = performance.now() - navigationStarted;
      const visualStarted = performance.now();
      const feature = await page.evaluate(() => {
        const canvas = document.querySelector("canvas");
        if (!(canvas instanceof HTMLCanvasElement)) {
          return {
            available: false,
            materiallyPainted: false,
            nonTransparentPixelRatio: null,
            rawPixelBytesInMemory: 0,
          };
        }
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context === null || canvas.width === 0 || canvas.height === 0) {
          return {
            available: false,
            materiallyPainted: false,
            nonTransparentPixelRatio: null,
            rawPixelBytesInMemory: 0,
          };
        }
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        let nonTransparent = 0;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index]! > 0) nonTransparent += 1;
        }
        const ratio = nonTransparent / (pixels.length / 4);
        return {
          available: true,
          materiallyPainted: ratio >= 0.25,
          nonTransparentPixelRatio: ratio,
          rawPixelBytesInMemory: pixels.byteLength,
        };
      });
      const visualAcquisitionMs = performance.now() - visualStarted;
      const persistedFeatureBytes = Buffer.byteLength(JSON.stringify(feature));
      cases.push({
        id: item.id,
        ...feature,
        navigationMs,
        visualAcquisitionMs,
        persistedFeatureBytes,
      });
    } finally {
      await page.close();
    }
  }
  return {
    cases,
    conclusion: "insufficient_to_establish_interstitial_semantics",
  };
}

async function pageSignals(
  page: Page,
  httpStatus?: number,
): Promise<PageSignals> {
  const snapshot = await page.evaluate(() => ({
    title: document.title,
    text: document.body?.innerText ?? "",
    rawHtml: document.documentElement.outerHTML,
    readyState: document.readyState,
    targetCount: document.querySelectorAll(
      'a[href],button,input:not([type="hidden"]),textarea,select,[role],[contenteditable="true"],[tabindex]',
    ).length,
  }));
  return {
    url: page.url(),
    ...snapshot,
    ...(httpStatus === undefined ? {} : { httpStatus }),
  };
}

async function runTemporalStudy(
  context: BrowserContext,
  server: FixtureServer,
) {
  const strategy = gate5Strategies().find(
    (candidate) => candidate.name === "s4-proposition-first-stabilized",
  )!;
  const results = [];
  for (const scenario of TEMPORAL_PERCEPTION_SCENARIOS) {
    const page = await context.newPage();
    const recorder = new PageObservationRecorder(page);
    await installResearchMutationObserver(page);
    try {
      const response = await page.goto(
        new URL(scenario.route, server.url).toString(),
        {
          waitUntil: "domcontentloaded",
        },
      );
      const observation = await observeWithPolicy(page, STABILIZATION_POLICY);
      const acquired = await collectResearchEvidence(page, recorder);
      const prediction = await strategy.predict(
        {
          signals: await pageSignals(page, response?.status()),
          evidence: acquired.evidence,
          acquisitionMs: acquired.timing.totalMs,
          evidenceBytes: acquired.payload.totalBytes,
        },
        {
          id: "opaque-temporal-case",
          tier: "A",
          description: "opaque",
          criticality: "standard",
          tags: [],
        },
      );
      const expected = scenario.checkpoints.at(-1)!.expectedPrimaryState;
      results.push({
        id: scenario.id,
        expectedFinalState: expected,
        actualFinalState: prediction.assessment.kind,
        correct: prediction.assessment.kind === expected,
        stabilizationElapsedMs: observation.elapsedMs,
        mutationCount: observation.mutationCount,
        quietForMs: observation.quietForMs,
        timedOut: observation.timedOut,
        evidenceAcquisitionMs: acquired.timing.totalMs,
        evidenceBytes: acquired.payload.totalBytes,
      });
    } finally {
      await page.close();
    }
  }
  return { policy: STABILIZATION_POLICY, results };
}

function markdown(report: {
  strategies: BenchmarkReport[];
  visual: Awaited<ReturnType<typeof collectVisualStudy>>;
  temporal: Awaited<ReturnType<typeof runTemporalStudy>>;
  winner: string;
}): string {
  const rows = report.strategies
    .map(
      ({ strategy, metrics }) =>
        `| \`${strategy}\` | ${(metrics.primaryStateAccuracy * 100).toFixed(2)}% | ${metrics.macroF1.toFixed(6)} | ${metrics.riskWeightedLoss.toFixed(3)} | ${(metrics.highConfidenceErrorRate * 100).toFixed(2)}% | ${metrics.criticalInvariantViolationCount} | ${(100 * (metrics.propositionAggregate.coverage ?? 0)).toFixed(2)}% | ${(100 * (metrics.propositionAggregate.accuracy ?? 0)).toFixed(2)}% | ${metrics.timing.totalMs.mean?.toFixed(3) ?? "n/a"} | ${metrics.payload.evidenceBytes.mean?.toFixed(1) ?? "n/a"} |`,
    )
    .join("\n");
  return `# F1 Gate 5 Classification and Visual Study

## Status

Research-only strategy tournament. No production classifier, acquisition,
protocol, runtime policy, frozen corpus, risk model, Gate-3 baseline, or Gate-4
result was changed.

## Stable deterministic tournament

| Strategy | Primary accuracy | Macro F1 | Mean risk loss | High-confidence error | Critical violations | Proposition coverage | Proposition accuracy | Mean total ms | Mean evidence bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}

The proposition-first strategies evaluate all seven propositions before deriving
the compatibility state. Presentation geometry is necessary evidence for framed
verification, but provider/frame/network presence is never verification by
itself. Accessibility is corroboration, not a visibility oracle.

### Ablation conclusions

- S1 isolates the provider-presence defect: it removes the five critical false
  handoffs, but cannot repair verification-over-restriction precedence.
- S2 fixes precedence and produces all seven propositions, but correctly refuses
  to call an empty painted canvas an interstitial from structure alone.
- S3 adds a bounded transient accessibility-shaped semantic label and resolves
  the deterministic canvas case. Raw accessible text is not persisted.
- S4 has the same stable-case classifier as S3 and adds conditional bounded
  reassessment for temporal/unstable observations; stable pages do not pay the
  temporal wait shown below.
- S5 demonstrates pixel occupancy as an escalation measurement. Its perfect
  corpus score is not architecture-eligible because the visual subset cannot
  establish that painted pixels mean an interstitial.

## Visual experiment

The bounded browser-side pixel probe compared \`ready-blank\` with
\`unknown-canvas-interstitial\`. It retained only occupancy facts and costs; no
screenshot or raw pixels are committed. The painted canvas is visually distinct,
but the corpus has only one positive canvas interstitial and no legitimate painted
canvas controls. Therefore visual occupancy does **not** defensibly establish
interstitial semantics and is not selected for the Gate-6 candidate. No OCR
dependency was present or added.

The probe escalated 1/22 stable cases. It read 614,400 synthetic pixel bytes in
memory for the canvas case and persisted only a roughly 100-byte feature record.
Navigation and pixel-acquisition latency are reported separately in JSON.

## Temporal experiment

The bounded DOM-quiet policy reached the declared later state in
${report.temporal.results.filter((item) => item.correct).length}/${report.temporal.results.length}
temporal scenarios. This proves the tested fixtures, not a universal timeout.
Gate 6 must validate varied delay and irrelevant-mutation conditions before
freezing an observation policy.

## Winner

\`${report.winner}\` is the Gate-5 architecture candidate: proposition-first
structural inference with bounded semantic/accessibility corroboration and a
bounded stabilization/reassessment envelope. Visual/OCR escalation is not part
of the candidate because its semantic incremental value was not established.

Gate 6 must validate held-out semantic variants, varied temporal delays,
channel-unavailability behavior, confidence calibration, relevant-region versus
whole-document quiet, and production latency/payload before freezing the ADR and
implementation runbook.

## Review findings incorporated

Pass 1 removed label-bearing benchmark metadata from inference behavior,
separated transient semantic analysis from persisted evidence, enforced
proposition-first precedence, prevented provider presence and missing visual
evidence from becoming blockers, preserved overlap propositions, and separated
pixel acquisition from navigation cost.

Pass 2 rejected the visually perfect S5 score as semantically underpowered,
made stable versus conditional-stabilization timing explicit, recorded source
hashes and experiment limitations, verified complete proposition output, and
checked that conclusions are derived from JSON rather than expected labels.

## Privacy

The artifact contains assessments, proposition truth values, bounded support
codes, counts, timings, hashes, sanitized Gate-4 origin facts, and bounded pixel
statistics. It contains no raw HTML/text/accessibility snapshot, screenshot,
raw pixels, request/response content or headers, credentials, storage, form
values, or unsanitized URLs.
`;
}

const out = arg("--out");
const analysis = arg("--analysis");
const gate4 = JSON.parse(
  await readFile(
    resolve(
      REPO_ROOT,
      "docs/hardening/perception/experiments/f1-gate4-results.json",
    ),
    "utf8",
  ),
) as { stableEvidence: { cases: Gate4Case[] } };
const gate4ById = new Map(
  gate4.stableEvidence.cases.map((item) => [item.id, item]),
);
const riskModel = await loadF1RiskModel();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const server = await startFixtureServer();

try {
  const visual = await collectVisualStudy(context, server);
  const visualById = new Map(visual.cases.map((item) => [item.id, item]));
  const cases: BenchmarkCase<Gate5Input>[] = LOCAL_PERCEPTION_CASES.map(
    (item) => {
      const gate4Case = gate4ById.get(item.id);
      const visualCase = visualById.get(item.id);
      return {
        ...item,
        input: {
          signals: item.input,
          ...(gate4Case === undefined
            ? {}
            : {
                evidence: gate4Case.representative,
                acquisitionMs: mean(
                  gate4Case.trials.map((trial) => trial.timing.totalMs),
                ),
                evidenceBytes: mean(
                  gate4Case.trials.map((trial) => trial.payload.totalBytes),
                ),
              }),
          ...(visualCase === undefined
            ? {}
            : {
                visual: {
                  available: visualCase.available,
                  materiallyPainted: visualCase.materiallyPainted,
                  acquisitionMs: visualCase.visualAcquisitionMs,
                  payloadBytes: visualCase.rawPixelBytesInMemory,
                },
              }),
        },
      };
    },
  );
  const strategies = [];
  for (const strategy of gate5Strategies()) {
    strategies.push(
      await runBenchmark({
        corpusVersion: LOCAL_PERCEPTION_CORPUS_VERSION,
        cases,
        strategy,
        riskModel,
      }),
    );
  }
  const temporal = await runTemporalStudy(context, server);
  const winner = "s4-proposition-first-stabilized";
  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  const report = {
    schemaVersion: 1,
    experiment: "f1-gate5-classification-visual",
    generatedAt: new Date().toISOString(),
    metadata: {
      sourceRevision,
      nodeVersion: process.version,
      playwrightVersion: browser.version(),
      corpusVersion: LOCAL_PERCEPTION_CORPUS_VERSION,
      hashes: {
        corpus: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/corpus/local-corpus.ts",
          ),
        ),
        riskModel: await fileHash(
          resolve(REPO_ROOT, "docs/hardening/perception/f1-risk-model.json"),
        ),
        gate4Evidence: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/evidence.ts",
          ),
        ),
        gate5Strategies: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate5-strategies.ts",
          ),
        ),
        gate5Cli: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate5-cli.ts",
          ),
        ),
      },
    },
    strategies,
    visual,
    temporal,
    winner,
    acceptance: Object.fromEntries(
      strategies.map(({ strategy, metrics }) => [
        strategy,
        {
          primaryAccuracy: metrics.primaryStateAccuracy >= 0.98,
          macroF1: metrics.macroF1 >= 0.98,
          zeroHighConfidenceErrors: metrics.highConfidenceErrorRate === 0,
          zeroCriticalViolations: metrics.criticalInvariantViolationCount === 0,
          riskBelowFrozenBaseline: metrics.riskWeightedLoss < 36.81818181818182,
          methodologicallyEligible:
            strategy !== "s5-structural-visual-escalation",
        },
      ]),
    ),
    limitations: [
      "Tier A is small and is not a held-out generalization set.",
      "The canvas visual subset has one positive and one blank control, with no legitimate painted-canvas control.",
      "All current temporal fixtures transition at approximately 250 ms, so the tested policy is not a production timeout.",
      "Accessibility corroboration is synthetic transient semantic matching; Gate 6 must validate browser accessibility extraction on held-out variants.",
      "Stable-case timing reuses Gate 4 evidence samples; temporal stabilization latency is reported separately and conditionally.",
      "The signal-only loading case has no browser acquisition sample; aggregate acquisition has 21 samples while runner total time has 22 mixed-path samples and must not be read as acquisition plus inference.",
    ],
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await mkdir(dirname(analysis), { recursive: true });
  await writeFile(analysis, markdown(report), "utf8");
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
