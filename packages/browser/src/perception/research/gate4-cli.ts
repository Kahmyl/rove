import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import {
  LOCAL_PERCEPTION_CASES,
  LOCAL_PERCEPTION_CORPUS_VERSION,
  TEMPORAL_PERCEPTION_SCENARIOS,
  type LocalPerceptionCase,
  type TemporalPerceptionScenario,
} from "../corpus/local-corpus.js";
import {
  assertBoundedPersistedEvidence,
  collectResearchEvidence,
  firstChildFrame,
  PageObservationRecorder,
  summarize,
  type DistributionSummary,
  type EvidenceAcquisition,
  type FrameElementEvidence,
  type ResearchEvidence,
} from "./evidence.js";
import {
  captureReferenceSignature,
  installResearchMutationObserver,
  observeWithPolicy,
  sameStructuralSignature,
  type StabilizationObservation,
  type StabilizationPolicy,
  type StructuralSignature,
} from "./stabilization.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const STABLE_REPEATS = 3;
const STABILIZATION_REPEATS = 3;

interface CliPaths {
  out: string;
  analysis: string;
}

interface StableTrial {
  timing: EvidenceAcquisition["timing"];
  payload: EvidenceAcquisition["payload"];
  evidenceSignature: string;
  childFrameEvidenceAvailable: boolean;
}

interface StableCaseResult {
  id: string;
  description: string;
  expectedPrimaryState: string;
  tags: string[];
  representative: ResearchEvidence;
  repeatable: boolean;
  trials: StableTrial[];
}

interface StabilizationTrial {
  repeat: number;
  observation: StabilizationObservation;
  matchesReference: boolean;
}

interface StabilizationScenarioResult {
  id: string;
  description: string;
  referenceAfterMs: number;
  reference: StructuralSignature;
  policies: Array<{
    id: string;
    kind: StabilizationPolicy["kind"];
    trials: StabilizationTrial[];
    allTrialsMatchReference: boolean;
    elapsedMs: DistributionSummary;
  }>;
}

interface AdversaryAblation {
  id: string;
  framePresence: boolean;
  subframeNetworkPresence: boolean;
  accessibilityIframePresence: boolean;
  cssExcluded: boolean;
  outsideViewport: boolean;
  tinyArea: boolean;
  fullyClipped: boolean;
  occluded: boolean;
  geometryDistinguishes: boolean;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function commandArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (value === undefined) {
    throw new Error(`${name} requires a value.`);
  }

  return resolve(value);
}

function cliPaths(): CliPaths {
  const out = commandArg("--out");
  const analysis = commandArg("--analysis");

  if (out === undefined || analysis === undefined) {
    throw new Error("--out and --analysis are required.");
  }

  return { out, analysis };
}

async function fileHash(path: string): Promise<string> {
  return sha256(await readFile(path));
}

async function freshPage(
  context: BrowserContext,
  server: FixtureServer,
  route: string,
): Promise<{
  page: Page;
  recorder: PageObservationRecorder;
}> {
  const page = await context.newPage();
  const recorder = new PageObservationRecorder(page);

  await page.goto(new URL(route, server.url).toString(), {
    waitUntil: "load",
  });

  return { page, recorder };
}

async function freshTemporalPage(
  context: BrowserContext,
  server: FixtureServer,
  scenario: TemporalPerceptionScenario,
): Promise<Page> {
  const page = await context.newPage();
  await installResearchMutationObserver(page);

  await page.goto(new URL(scenario.route, server.url).toString(), {
    waitUntil: "domcontentloaded",
  });

  return page;
}

async function referenceForScenario(
  context: BrowserContext,
  server: FixtureServer,
  scenario: TemporalPerceptionScenario,
): Promise<{
  afterMs: number;
  signature: StructuralSignature;
}> {
  const afterMs =
    Math.max(...scenario.checkpoints.map((checkpoint) => checkpoint.afterMs)) +
    50;
  const page = await freshTemporalPage(context, server, scenario);

  try {
    return {
      afterMs,
      signature: await captureReferenceSignature(page, afterMs),
    };
  } finally {
    await page.close();
  }
}

const STABILIZATION_POLICIES: StabilizationPolicy[] = [
  {
    id: "load-only",
    kind: "load-only",
  },
  {
    id: "fixed-100",
    kind: "fixed",
    afterMs: 100,
  },
  {
    id: "fixed-250",
    kind: "fixed",
    afterMs: 250,
  },
  {
    id: "fixed-350",
    kind: "fixed",
    afterMs: 350,
  },
  {
    id: "floor-200-quiet-100",
    kind: "quiet-window",
    minimumObservationMs: 200,
    quietWindowMs: 100,
    maxObservationMs: 1000,
    pollMs: 10,
  },
  {
    id: "floor-300-quiet-75",
    kind: "quiet-window",
    minimumObservationMs: 300,
    quietWindowMs: 75,
    maxObservationMs: 1000,
    pollMs: 10,
  },
];

async function runStabilizationStudy(
  context: BrowserContext,
  server: FixtureServer,
): Promise<StabilizationScenarioResult[]> {
  const results: StabilizationScenarioResult[] = [];

  for (const scenario of TEMPORAL_PERCEPTION_SCENARIOS) {
    const reference = await referenceForScenario(context, server, scenario);
    const policies: StabilizationScenarioResult["policies"] = [];

    for (const policy of STABILIZATION_POLICIES) {
      const trials: StabilizationTrial[] = [];

      for (let repeat = 0; repeat < STABILIZATION_REPEATS; repeat += 1) {
        const page = await freshTemporalPage(context, server, scenario);

        try {
          const observation = await observeWithPolicy(page, policy);

          trials.push({
            repeat,
            observation,
            matchesReference: sameStructuralSignature(
              observation.signature,
              reference.signature,
            ),
          });
        } finally {
          await page.close();
        }
      }

      policies.push({
        id: policy.id,
        kind: policy.kind,
        trials,
        allTrialsMatchReference: trials.every(
          (trial) => trial.matchesReference,
        ),
        elapsedMs: summarize(
          trials.map((trial) => trial.observation.elapsedMs),
        ),
      });
    }

    results.push({
      id: scenario.id,
      description: scenario.description,
      referenceAfterMs: reference.afterMs,
      reference: reference.signature,
      policies,
    });
  }

  return results;
}

function pipelineCases(): LocalPerceptionCase[] {
  const cases = LOCAL_PERCEPTION_CASES.filter(
    (benchmarkCase): benchmarkCase is LocalPerceptionCase & { route: string } =>
      benchmarkCase.pipelineEligible && benchmarkCase.route !== undefined,
  );
  if (cases.length !== 21) {
    throw new Error(
      `Expected 21 pipeline-eligible Gate 4 cases, found ${cases.length}.`,
    );
  }
  return cases;
}

function stableEvidenceSignature(evidence: ResearchEvidence): string {
  const observationCounts: Partial<ResearchEvidence["observation"]> = {
    ...evidence.observation,
  };
  delete observationCounts.events;
  return sha256(
    JSON.stringify({
      document: evidence.document,
      frames: evidence.frames,
      accessibility: evidence.accessibility,
      observation: observationCounts,
    }),
  );
}

async function runStableEvidenceStudy(
  context: BrowserContext,
  server: FixtureServer,
): Promise<StableCaseResult[]> {
  const results: StableCaseResult[] = [];

  for (const benchmarkCase of pipelineCases()) {
    const trials: StableTrial[] = [];
    const acquiredEvidence: ResearchEvidence[] = [];

    for (let repeat = 0; repeat < STABLE_REPEATS; repeat += 1) {
      const { page, recorder } = await freshPage(
        context,
        server,
        benchmarkCase.route!,
      );

      try {
        const acquired = await collectResearchEvidence(page, recorder);
        assertBoundedPersistedEvidence(acquired.evidence);

        acquiredEvidence.push(acquired.evidence);

        trials.push({
          timing: acquired.timing,
          payload: acquired.payload,
          evidenceSignature: stableEvidenceSignature(acquired.evidence),
          childFrameEvidenceAvailable:
            acquired.evidence.document.iframeElementCount === 0 ||
            firstChildFrame(acquired.evidence)?.elementAcquisition ===
              "available",
        });
      } finally {
        await page.close();
      }
    }

    const signatures = new Set(trials.map((trial) => trial.evidenceSignature));
    const repeatable = signatures.size === 1;
    const representativeIndex = trials.findIndex(
      (trial) => trial.childFrameEvidenceAvailable,
    );
    const representative = acquiredEvidence[representativeIndex];

    if (representative === undefined) {
      throw new Error(`No representative evidence for ${benchmarkCase.id}.`);
    }
    if (!repeatable) {
      throw new Error(`Evidence was not repeatable for ${benchmarkCase.id}.`);
    }

    results.push({
      id: benchmarkCase.id,
      description: benchmarkCase.description,
      expectedPrimaryState: benchmarkCase.expectedPrimaryState,
      tags: benchmarkCase.tags,
      representative,
      repeatable,
      trials,
    });
  }

  return results;
}

function frameFacts(
  evidence: ResearchEvidence,
): FrameElementEvidence | undefined {
  return firstChildFrame(evidence)?.element ?? undefined;
}

function boolDifference(left: boolean, right: boolean): boolean {
  return left !== right;
}

function runAblation(stableCases: StableCaseResult[]): {
  referenceId: string;
  adversaries: AdversaryAblation[];
  coverage: Record<string, number>;
} {
  const byId = new Map(stableCases.map((item) => [item.id, item]));
  const referenceId = "human-verification-visible";
  const reference = byId.get(referenceId);

  if (reference === undefined) {
    throw new Error("Missing presented verification reference.");
  }

  const referenceFrame = frameFacts(reference.representative);

  if (referenceFrame === undefined) {
    throw new Error("Presented verification reference has no frame geometry.");
  }

  const referenceFramePresence = reference.representative.frames.some(
    (frame) => frame.depth > 0,
  );
  const referenceNetworkPresence =
    reference.representative.observation.subframeDocumentRequestCount > 0;
  const referenceAccessibilityIframePresence =
    reference.representative.accessibility.iframeCount > 0;

  const adversaryIds = [
    "ready-hidden-recaptcha-empty",
    "ready-opacity-zero-recaptcha-empty",
    "ready-offscreen-recaptcha-empty",
    "ready-one-pixel-recaptcha-empty",
    "ready-clipped-recaptcha-empty",
    "ready-provider-behind-modal",
  ];

  const adversaries = adversaryIds.map((id): AdversaryAblation => {
    const item = byId.get(id);

    if (item === undefined) {
      throw new Error(`Missing ablation case ${id}.`);
    }

    const frame = frameFacts(item.representative);

    if (frame === undefined) {
      throw new Error(`Missing child frame evidence for ${id}.`);
    }

    const framePresence = item.representative.frames.some(
      (candidate) => candidate.depth > 0,
    );
    const subframeNetworkPresence =
      item.representative.observation.subframeDocumentRequestCount > 0;
    const accessibilityIframePresence =
      item.representative.accessibility.iframeCount > 0;

    const cssExcluded = boolDifference(
      frame.cssVisible,
      referenceFrame.cssVisible,
    );
    const outsideViewport =
      (frame.viewportIntersectionRatio === 0) !==
      (referenceFrame.viewportIntersectionRatio === 0);
    const tinyArea = frame.area <= 4 !== referenceFrame.area <= 4;
    const fullyClipped =
      (frame.ancestorClipRatio === 0) !==
      (referenceFrame.ancestorClipRatio === 0);
    const occluded =
      frame.topmostSampleRatio !== null &&
      referenceFrame.topmostSampleRatio !== null &&
      frame.topmostSampleRatio < 0.5 !==
        referenceFrame.topmostSampleRatio < 0.5;

    return {
      id,
      framePresence: framePresence !== referenceFramePresence,
      subframeNetworkPresence:
        subframeNetworkPresence !== referenceNetworkPresence,
      accessibilityIframePresence:
        accessibilityIframePresence !== referenceAccessibilityIframePresence,
      cssExcluded,
      outsideViewport,
      tinyArea,
      fullyClipped,
      occluded,
      geometryDistinguishes:
        cssExcluded || outsideViewport || tinyArea || fullyClipped || occluded,
    };
  });

  const count = (predicate: (item: AdversaryAblation) => boolean): number =>
    adversaries.filter(predicate).length;

  return {
    referenceId,
    adversaries,
    coverage: {
      framePresence: count((item) => item.framePresence),
      subframeNetworkPresence: count((item) => item.subframeNetworkPresence),
      accessibilityIframePresence: count(
        (item) => item.accessibilityIframePresence,
      ),
      css: count((item) => item.cssExcluded),
      viewport: count((item) => item.outsideViewport),
      area: count((item) => item.tinyArea),
      clipping: count((item) => item.fullyClipped),
      occlusion: count((item) => item.occluded),
      combinedGeometry: count((item) => item.geometryDistinguishes),
    },
  };
}

interface StableTimingSummary {
  documentMs: DistributionSummary;
  framesMs: DistributionSummary;
  accessibilityMs: DistributionSummary;
  observationSnapshotMs: DistributionSummary;
  totalMs: DistributionSummary;
}

interface StablePayloadSummary {
  documentBytes: DistributionSummary;
  framesBytes: DistributionSummary;
  accessibilityBytes: DistributionSummary;
  observationBytes: DistributionSummary;
  totalBytes: DistributionSummary;
}

function aggregateStableTimings(
  cases: StableCaseResult[],
): StableTimingSummary {
  const trials = cases.flatMap((item) => item.trials);

  return {
    documentMs: summarize(trials.map((trial) => trial.timing.documentMs)),
    framesMs: summarize(trials.map((trial) => trial.timing.framesMs)),
    accessibilityMs: summarize(
      trials.map((trial) => trial.timing.accessibilityMs),
    ),
    observationSnapshotMs: summarize(
      trials.map((trial) => trial.timing.observationSnapshotMs),
    ),
    totalMs: summarize(trials.map((trial) => trial.timing.totalMs)),
  };
}

function aggregateStablePayload(
  cases: StableCaseResult[],
): StablePayloadSummary {
  const trials = cases.flatMap((item) => item.trials);

  return {
    documentBytes: summarize(
      trials.map((trial) => trial.payload.documentBytes),
    ),
    framesBytes: summarize(trials.map((trial) => trial.payload.framesBytes)),
    accessibilityBytes: summarize(
      trials.map((trial) => trial.payload.accessibilityBytes),
    ),
    observationBytes: summarize(
      trials.map((trial) => trial.payload.observationBytes),
    ),
    totalBytes: summarize(trials.map((trial) => trial.payload.totalBytes)),
  };
}

function policiesMatchingAllScenarios(
  study: StabilizationScenarioResult[],
): Array<{
  id: string;
  meanElapsedMs: number;
}> {
  return STABILIZATION_POLICIES.flatMap((policy) => {
    const perScenario = study.map((scenario) =>
      scenario.policies.find((candidate) => candidate.id === policy.id),
    );

    if (
      perScenario.some(
        (candidate) =>
          candidate === undefined || !candidate.allTrialsMatchReference,
      )
    ) {
      return [];
    }

    const elapsed = perScenario.flatMap(
      (candidate) =>
        candidate?.trials.map((trial) => trial.observation.elapsedMs) ?? [],
    );

    return [
      {
        id: policy.id,
        meanElapsedMs:
          elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length,
      },
    ];
  }).sort((left, right) => left.meanElapsedMs - right.meanElapsedMs);
}

function fmt(value: number | null, digits = 3): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

interface Gate4AnalysisReport {
  metadata: {
    sourceRevision: string;
    nodeVersion: string;
    playwrightVersion: string;
    chromiumVersion: string;
    stableRepeats: number;
    stabilizationRepeats: number;
  };
  gate3Baseline: {
    browserInspect: {
      meanTotalMs: number | null;
      p95TotalMs: number | null;
      meanEvidenceBytes: number | null;
    };
  };
  stabilization: {
    scenarios: StabilizationScenarioResult[];
    policiesMatchingAllSyntheticReferences: Array<{
      id: string;
      meanElapsedMs: number;
    }>;
  };
  stableEvidence: {
    aggregateTiming: ReturnType<typeof aggregateStableTimings>;
    aggregatePayload: ReturnType<typeof aggregateStablePayload>;
  };
  ablation: ReturnType<typeof runAblation>;
}

async function buildAnalysis(report: Gate4AnalysisReport): Promise<string> {
  const baseline = report.gate3Baseline.browserInspect;
  const timing = report.stableEvidence.aggregateTiming;
  const payload = report.stableEvidence.aggregatePayload;
  const stabilization = report.stabilization;
  const ablation = report.ablation;
  const matching = stabilization.policiesMatchingAllSyntheticReferences;

  const policyRows = STABILIZATION_POLICIES.map((policy) => {
    const scenarios = stabilization.scenarios.map(
      (scenario: StabilizationScenarioResult) =>
        scenario.policies.find((candidate) => candidate.id === policy.id),
    );

    const passed = scenarios.filter(
      (candidate) => candidate?.allTrialsMatchReference,
    ).length;
    const elapsed = scenarios.flatMap(
      (candidate) =>
        candidate?.trials.map((trial) => trial.observation.elapsedMs) ?? [],
    );
    const mean =
      elapsed.length === 0
        ? null
        : elapsed.reduce((sum: number, value: number) => sum + value, 0) /
          elapsed.length;

    return `| \`${policy.id}\` | ${passed}/${stabilization.scenarios.length} | ${fmt(mean)} |`;
  }).join("\n");

  const ablationRows = Object.entries(
    ablation.coverage as Record<string, number>,
  )
    .map(
      ([channel, count]) =>
        `| \`${channel}\` | ${count}/${ablation.adversaries.length} |`,
    )
    .join("\n");

  const fastestMatchingPolicy = matching.at(0);
  const matchingText =
    fastestMatchingPolicy === undefined
      ? "No tested policy matched every synthetic reference in every repeat."
      : `The lowest-latency tested policy that matched every synthetic reference in every repeat was \`${fastestMatchingPolicy.id}\` at ${fmt(fastestMatchingPolicy.meanElapsedMs)} ms mean browser-relative observation time. This is a fixture result, **not** a production timing recommendation.`;

  const geometryComplete =
    ablation.coverage.combinedGeometry === ablation.adversaries.length;

  return `# F1 Gate 4 Evidence Research

## Status

Gate 4 experimental evidence study.

This gate does **not** change the production classifier, production
\`PlaywrightBrowserSession.inspect()\` acquisition path, protocol, runtime
mutation policy, Gate-1 risk model, Gate-2 corpus ground truth, or Gate-3
baseline artifacts.

Source checkpoint:

\`\`\`text
${report.metadata.sourceRevision}
\`\`\`

Environment:

- Node: \`${report.metadata.nodeVersion}\`
- Playwright: \`${report.metadata.playwrightVersion}\`
- Chromium: \`${report.metadata.chromiumVersion}\`
- stable-case repeats: ${report.metadata.stableRepeats}
- stabilization repeats: ${report.metadata.stabilizationRepeats}

## Research questions

Gate 4 asks:

1. when is a browser observation stable enough to compare;
2. which bounded evidence channels distinguish presentation from mere provider
   presence;
3. what do those channels cost in latency and payload;
4. which channels are redundant or insufficient in isolation;
5. which evidence can be persisted without carrying raw page/user content.

It does **not** choose the final semantic inference strategy. That remains Gate
5.

## Stabilization study

The three Tier-A temporal fixtures all mutate 250 ms after their initial
document state. The reference signature is captured 50 ms after each scenario's
last declared checkpoint.

Each policy is run ${report.metadata.stabilizationRepeats} times per scenario.

| Policy | Scenarios matching reference in every repeat | Mean observation time (ms) |
| --- | ---: | ---: |
${policyRows}

${matchingText}

The important conclusion is not a magic timeout. It is that \`load\` or a short
fixed wait is not evidence that the user-facing state has stabilized. A delayed
DOM transition can occur after both DOMContentLoaded and load.

Gate 5/6 should therefore treat stabilization as an observation policy with a
bounded maximum, not as a synonym for \`document.readyState\`.

## Evidence channels

The research collector persists bounded facts only:

- document readiness and structural counts;
- hashes and lengths instead of raw visible text/title;
- frame parent/depth, scheme/origin, CSS state, geometry, viewport intersection,
  ancestor clipping, and bounded topmost-point sampling;
- accessibility snapshot hash/size and role counts, not raw accessible text;
- bounded lifecycle/network metadata containing method/resource type/status,
  origin, frame depth, and timing;
- no request/response bodies, headers, cookies, storage, typed values, raw HTML,
  screenshots, or unsanitized URLs.

The runtime probe confirmed that the installed Playwright exposes ARIA
snapshots, geometry, visibility, frame relationships, and lifecycle events, so
the experiment does not require CDP-only collection.

## Presentation ablation

Reference: \`${ablation.referenceId}\`.

Adversaries:

${ablation.adversaries.map((item: AdversaryAblation) => `- \`${item.id}\``).join("\n")}

Coverage means the channel differs from the truly presented reference on that
adversary. It is **not** primary-state accuracy and is not a final classifier.

| Channel/fact family | Adversaries distinguished |
| --- | ---: |
${ablationRows}

${
  geometryComplete
    ? "The combined geometry/presentation facts distinguish all six deterministic passive-frame adversaries from the presented verification reference."
    : "The combined geometry/presentation facts do not yet distinguish every deterministic passive-frame adversary; Gate 4 must not claim geometry sufficiency."
}

Frame presence and subframe network activity are measured separately because
Gate 1 explicitly says provider frame/network presence alone cannot establish
human verification.

Accessibility is also measured separately. An accessibility tree can contain
offscreen or otherwise non-presented semantic content, so accessibility remains
useful semantic evidence but is not treated as a visibility oracle.

## Cost against Gate 3

Gate-3 real \`browser.inspect()\` baseline:

- mean total inspect latency: ${fmt(baseline.meanTotalMs)} ms;
- p95 total inspect latency: ${fmt(baseline.p95TotalMs)} ms;
- mean inspection payload: ${fmt(baseline.meanEvidenceBytes)} bytes.

Gate-4 research collector on stabilized deterministic fixtures:

- mean bounded evidence acquisition: ${fmt(timing.totalMs.mean)} ms;
- p95 bounded evidence acquisition: ${fmt(timing.totalMs.p95)} ms;
- mean frame-geometry acquisition: ${fmt(timing.framesMs.mean)} ms;
- mean accessibility acquisition: ${fmt(timing.accessibilityMs.mean)} ms;
- mean bounded evidence payload: ${fmt(payload.totalBytes.mean)} bytes;
- p95 bounded evidence payload: ${fmt(payload.totalBytes.p95)} bytes.

These costs are research measurements. Gate 4 does not automatically move every
channel onto the production default path.

## Channel interpretation

### Frame/network presence

Useful for structural context and provider integration observation, but
insufficient for "presented now" semantics.

### CSS + geometry

Directly measures several distinctions frozen in Gate 1:

- hidden/display-none;
- opacity zero;
- offscreen;
- tiny/effectively 1x1;
- ancestor clipping;
- occlusion by the current topmost surface.

This is the strongest deterministic evidence family for the five frozen false
human-verification handoffs plus the existing occlusion adversary.

### Accessibility

Useful for role/name semantics and potentially for authentication or challenge
instructions. It must remain bounded and value-safe, and it must be combined
with presentation evidence when the proposition requires something to be
currently visible/presented.

### Lifecycle/network

Useful for stabilization, navigation status, frame relationships, failures, and
corroboration. It is not sufficient by itself for semantic blocker inference.

## Privacy result

The committed result contains no raw HTML, full body text, raw accessibility
snapshot, request/response bodies or headers, cookies, storage, credentials,
typed values, or unsanitized URL fields.

Synthetic fixtures permit richer data under Gate 1, but Gate 4 deliberately
uses the stricter bounded representation so the collector design does not depend
on persisting raw external content later.

## Gate 4 boundary

Gate 4 intentionally does **not**:

- modify \`classifyPageState()\`;
- modify \`PlaywrightBrowserSession.inspect()\`;
- add a production page-state protocol;
- add screenshot/OCR evidence;
- choose confidence rules;
- choose final proposition inference thresholds;
- choose a production stabilization timeout.

Those decisions belong to Gate 5 and Gate 6 after the evidence results are
reviewed.

## Gate 5 input

Gate 5 should compare inference strategies using the Gate-4 evidence, with
particular attention to:

1. proposition-first inference rather than a single flat ruleset;
2. human-verification requiring both semantic challenge evidence and current
   presentation evidence;
3. overlap precedence from Gate 1;
4. bounded escalation to visual/OCR evidence only where structural channels are
   genuinely ambiguous;
5. comparison against the frozen Gate-3 risk and accuracy baseline.
`;
}

const paths = cliPaths();
const server = await startFixtureServer();
const browser: Browser = await chromium.launch({ headless: true });
const context: BrowserContext = await browser.newContext({
  viewport: {
    width: 1440,
    height: 900,
  },
});

try {
  const stabilizationScenarios = await runStabilizationStudy(context, server);
  const stableCases = await runStableEvidenceStudy(context, server);
  const ablation = runAblation(stableCases);

  for (const item of stableCases) {
    assertBoundedPersistedEvidence(item.representative);
  }

  const gate3Inspect = JSON.parse(
    await readFile(
      resolve(
        REPO_ROOT,
        "docs/hardening/perception/baselines/f1-gate3-browser-inspect.json",
      ),
      "utf8",
    ),
  );

  const playwrightVersion = JSON.parse(
    await readFile(
      resolve(
        REPO_ROOT,
        "packages/browser/node_modules/playwright/package.json",
      ),
      "utf8",
    ),
  ).version as string;

  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();

  const report = {
    schemaVersion: 1,
    experiment: "f1-gate4-evidence-research",
    corpusVersion: LOCAL_PERCEPTION_CORPUS_VERSION,
    generatedAt: new Date().toISOString(),
    metadata: {
      sourceRevision,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      playwrightVersion,
      chromiumVersion: browser.version(),
      stableRepeats: STABLE_REPEATS,
      stabilizationRepeats: STABILIZATION_REPEATS,
      hashes: {
        classifierSha256: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/safety/page-state-classifier.ts",
          ),
        ),
        browserSessionSha256: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/playwright-browser-session.ts",
          ),
        ),
        corpusSha256: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/corpus/local-corpus.ts",
          ),
        ),
        riskModelSha256: await fileHash(
          resolve(REPO_ROOT, "docs/hardening/perception/f1-risk-model.json"),
        ),
        evidenceCollectorSha256: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/evidence.ts",
          ),
        ),
        stabilizationResearchSha256: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/stabilization.ts",
          ),
        ),
        gate4CliSha256: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate4-cli.ts",
          ),
        ),
      },
    },
    gate3Baseline: {
      browserInspect: {
        meanTotalMs: gate3Inspect.metrics.timing.totalMs.mean,
        p95TotalMs: gate3Inspect.metrics.timing.totalMs.p95,
        meanEvidenceBytes: gate3Inspect.metrics.payload.evidenceBytes.mean,
      },
    },
    stabilization: {
      policies: STABILIZATION_POLICIES,
      scenarios: stabilizationScenarios,
      policiesMatchingAllSyntheticReferences: policiesMatchingAllScenarios(
        stabilizationScenarios,
      ),
    },
    stableEvidence: {
      caseCount: stableCases.length,
      aggregateTiming: aggregateStableTimings(stableCases),
      aggregatePayload: aggregateStablePayload(stableCases),
      cases: stableCases,
    },
    ablation,
  };

  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await mkdir(dirname(paths.out), { recursive: true });
  await writeFile(paths.out, serialized, "utf8");

  const analysis = await buildAnalysis(report);
  await mkdir(dirname(paths.analysis), { recursive: true });
  await writeFile(paths.analysis, analysis, "utf8");
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
