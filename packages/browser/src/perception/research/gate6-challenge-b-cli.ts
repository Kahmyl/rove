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
  type ResearchEvidence,
} from "./evidence.js";
import {
  gate6CandidateStrategy,
  type Gate6CandidateInput,
} from "./gate6-candidate.js";
import {
  GATE6_CHALLENGE_B_CASES,
  challengeBDisposition,
  type Gate6ChallengeBDefinition,
} from "./gate6-challenge-b.js";
import {
  collectAccessibleSemanticAudit,
  collectGate6DomSemantics,
  pageSignals,
} from "./gate6-validation.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const CHALLENGE_B_VERSION = 6002;

function rawArg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];

  if (value === undefined) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function arg(name: string): string {
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

async function candidateInput(
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
    acquisitionMs: performance.now() - started,
    evidenceBytes: evidence.payload.totalBytes,
  };
}

async function challengeCases(
  context: BrowserContext,
): Promise<BenchmarkCase<Gate6CandidateInput>[]> {
  const cases: BenchmarkCase<Gate6CandidateInput>[] = [];

  for (const definition of GATE6_CHALLENGE_B_CASES) {
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
        input: await candidateInput(page, definition.httpStatus),
        expectedPropositions: definition.expectedPropositions,
        expectedPrimaryState: definition.expectedPrimaryState,
        expectedDisposition: challengeBDisposition(
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

function withGeometryUnavailable(evidence: ResearchEvidence): ResearchEvidence {
  const copy = structuredClone(evidence);

  for (const frame of copy.frames) {
    if (frame.depth === 0) continue;
    frame.element = null;
    frame.elementAcquisition = "unavailable";
    frame.elementUnavailableReason = "frame_element_race";
  }

  return copy;
}

async function channelAvailabilityStudy(context: BrowserContext) {
  const definition: Gate6ChallengeBDefinition = {
    id: "confirm-channel-human-verification-frame",
    description:
      "Known human-verification frame used only for evidence-unavailability study.",
    title: "Security step",
    body: `
      <iframe
        title="Human verification"
        style="width:340px;height:150px"
        srcdoc="<!doctype html><html><body><button>Continue</button></body></html>"
      ></iframe>`,
    expectedPrimaryState: "human_verification",
    expectedPropositions: {
      primaryContentAvailable: false,
      documentUnstable: false,
      authenticationRequired: false,
      humanVerificationPresented: true,
      accessRestricted: false,
      errorPresented: false,
      interstitialPresented: true,
    },
    criticality: "critical",
    tags: ["confirmatory", "channel-unavailable"],
  };

  const page = await context.newPage();

  try {
    await page.setContent(
      `<!doctype html><html><head><title>${definition.title}</title></head><body>${definition.body}</body></html>`,
      { waitUntil: "load" },
    );

    const full = await candidateInput(page);
    const strategy = gate6CandidateStrategy();

    const complete = await strategy.predict(full, {
      id: "channel-complete",
      tier: "A",
      description: "channel complete",
      criticality: "critical",
      tags: [],
    });

    if (full.evidence === undefined) {
      throw new Error(
        "Challenge B channel probe requires collected research evidence.",
      );
    }

    const geometryUnavailableInput: Gate6CandidateInput = {
      ...full,
      evidence: withGeometryUnavailable(full.evidence),
    };

    const geometryUnavailable = await strategy.predict(
      geometryUnavailableInput,
      {
        id: "channel-geometry-unavailable",
        tier: "A",
        description: "presentation geometry unavailable",
        criticality: "critical",
        tags: [],
      },
    );

    const noAccessibility = await strategy.predict(
      {
        ...full,
        accessibilitySemantics: {
          available: false,
          verificationCue: false,
          authenticationCue: false,
          restrictionCue: false,
          errorCue: false,
          interstitialCue: false,
        },
      },
      {
        id: "channel-accessibility-unavailable",
        tier: "A",
        description: "accessibility semantics unavailable",
        criticality: "critical",
        tags: [],
      },
    );

    return {
      complete,
      geometryUnavailable,
      noAccessibility,
      expectations: {
        completeHumanVerification: true,
        geometryUnavailableVerificationTruth: "indeterminate",
        geometryUnavailableMustNotBeHighConfidence: true,
        noAccessibilityStillUsesPresentedSemanticFrame: true,
      },
      observations: {
        completeCorrect: complete.assessment.kind === "human_verification",
        geometryUnavailableEmitsIndeterminate:
          geometryUnavailable.propositions?.humanVerificationPresented ===
          "indeterminate",
        geometryUnavailableNotHighConfidence:
          geometryUnavailable.assessment.confidence !== "high",
        noAccessibilityCorrect:
          noAccessibility.assessment.kind === "human_verification",
      },
    };
  } finally {
    await page.close();
  }
}

function propositionExact(report: BenchmarkReport): boolean {
  return (
    report.metrics.propositionAggregate.coverage === 1 &&
    report.metrics.propositionAggregate.accuracy === 1
  );
}

function confirmatoryPass(report: BenchmarkReport): boolean {
  return (
    report.metrics.primaryStateAccuracy >= 0.98 &&
    report.metrics.macroF1 >= 0.98 &&
    report.metrics.riskWeightedLoss === 0 &&
    report.metrics.highConfidenceErrorRate === 0 &&
    report.metrics.criticalInvariantViolationCount === 0 &&
    propositionExact(report)
  );
}

function failures(report: BenchmarkReport): string {
  const rows = report.results.filter((item) => {
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

  if (rows.length === 0) return "- none";

  return rows
    .map(
      (item) =>
        `- \`${item.id}\`: expected \`${item.expectedPrimaryState}\`, got \`${item.actual.kind}\` (${item.actual.confidence}), risk=${item.riskCost}, critical=${item.criticalInvariantViolation}.`,
    )
    .join("\n");
}

function markdown(report: {
  challengeB: BenchmarkReport;
  channelAvailability: Awaited<ReturnType<typeof channelAvailabilityStudy>>;
  acquisitionMs: DistributionSummary;
  candidateUnchanged: boolean;
}): string {
  const metrics = report.challengeB.metrics;
  const channel = report.channelAvailability.observations;

  return `# F1 Gate 6 Confirmatory Challenge B

## Status

Post-remediation confirmatory validation of S4R.

Challenge B was authored after S4R reached 100% primary-state and proposition
accuracy on the frozen Tier-A corpus and Challenge A. S4R is treated as frozen
during this experiment.

## Confirmatory set

- cases: ${metrics.caseCount}
- primary accuracy: ${(metrics.primaryStateAccuracy * 100).toFixed(2)}%
- macro F1: ${metrics.macroF1.toFixed(6)}
- mean risk loss: ${metrics.riskWeightedLoss.toFixed(3)}
- high-confidence error rate: ${(metrics.highConfidenceErrorRate * 100).toFixed(2)}%
- critical invariant violations: ${metrics.criticalInvariantViolationCount}
- proposition coverage: ${((metrics.propositionAggregate.coverage ?? 0) * 100).toFixed(2)}%
- proposition accuracy: ${((metrics.propositionAggregate.accuracy ?? 0) * 100).toFixed(2)}%

Confirmatory acceptance: **${confirmatoryPass(report.challengeB)}**

### Failures

${failures(report.challengeB)}

## Evidence-unavailability probe

A known presented human-verification frame is classified under three acquisition
conditions:

- complete evidence correct: ${channel.completeCorrect}
- geometry unavailable emits \`humanVerificationPresented = indeterminate\`:
  ${channel.geometryUnavailableEmitsIndeterminate}
- geometry-unavailable result avoids high confidence:
  ${channel.geometryUnavailableNotHighConfidence}
- accessibility unavailable still recognizes the exact presented semantic frame:
  ${channel.noAccessibilityCorrect}

Gate 1 permits proposition truth to be \`indeterminate\`. Collector failure must
not silently become semantic \`false\`.

Channel-availability acceptance: **${
    channel.completeCorrect &&
    channel.geometryUnavailableEmitsIndeterminate &&
    channel.geometryUnavailableNotHighConfidence &&
    channel.noAccessibilityCorrect
  }**

## Acquisition cost

- mean: ${report.acquisitionMs.mean?.toFixed(3) ?? "n/a"} ms
- p95: ${report.acquisitionMs.p95?.toFixed(3) ?? "n/a"} ms
- max: ${report.acquisitionMs.max?.toFixed(3) ?? "n/a"} ms

These are research-harness measurements, not yet the final production budget.

## Candidate immutability

S4R source unchanged during Challenge B: **${report.candidateUnchanged}**

## Freeze implication

${
  confirmatoryPass(report.challengeB) &&
  channel.completeCorrect &&
  channel.geometryUnavailableEmitsIndeterminate &&
  channel.geometryUnavailableNotHighConfidence &&
  channel.noAccessibilityCorrect
    ? "Challenge B did not falsify S4R and the channel-degradation contract is satisfied. Gate 6 may proceed to S4R temporal validation, production inspection-freshness/invalidation validation, Tier C/D evidence where available, and final ADR/runbook freeze."
    : "Challenge B and/or the channel-degradation probe falsified the current S4R freeze candidate. Do not modify Challenge B ground truth. Remediate the architecture separately, then rerun the frozen corpus, Challenge A, and this now-fixed Challenge B before authoring any additional confirmatory set."
}
`;
}

const out = arg("--out");
const analysis = arg("--analysis");
const expectedCandidateHash = rawArg("--candidate-hash");

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

try {
  const cases = await challengeCases(context);
  const strategy = gate6CandidateStrategy();
  const riskModel = await loadF1RiskModel();

  const challengeB = await runBenchmark({
    corpusVersion: CHALLENGE_B_VERSION,
    cases,
    strategy,
    riskModel,
  });

  const channelAvailability = await channelAvailabilityStudy(context);

  const candidateHashAfter = await fileHash(
    resolve(
      REPO_ROOT,
      "packages/browser/src/perception/research/gate6-candidate.ts",
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
    experiment: "f1-gate6-confirmatory-challenge-b",
    generatedAt: new Date().toISOString(),
    metadata: {
      sourceRevision,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      chromiumVersion: browser.version(),
      challengeBCorpusVersion: CHALLENGE_B_VERSION,
      candidateSha256Before: expectedCandidateHash,
      candidateSha256After: candidateHashAfter,
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
        challengeBDefinitions: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-challenge-b.ts",
          ),
        ),
      },
    },
    challengeB,
    channelAvailability,
    acquisitionMs,
    candidateUnchanged,
    confirmatoryPassed: confirmatoryPass(challengeB),
    channelAvailabilityPassed:
      channelAvailability.observations.completeCorrect &&
      channelAvailability.observations.geometryUnavailableEmitsIndeterminate &&
      channelAvailability.observations.geometryUnavailableNotHighConfidence &&
      channelAvailability.observations.noAccessibilityCorrect,
    limitations: [
      "Challenge B is deterministic synthetic confirmatory evidence, not recorded/live Tier C/D evidence.",
      "The channel-unavailability probe currently covers verification-frame presentation geometry and accessibility availability; other evidence families remain to validate.",
      "S4R temporal behavior has not yet been rerun end-to-end with S4R-specific acquisition.",
      "Runtime inspection invalidation after decision-relevant browser activity remains unresolved.",
      "Final production-path latency/payload is not yet measured.",
    ],
  };

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  await mkdir(dirname(analysis), {
    recursive: true,
  });
  await writeFile(
    analysis,
    markdown({
      challengeB,
      channelAvailability,
      acquisitionMs,
      candidateUnchanged,
    }),
    "utf8",
  );
} finally {
  await context.close();
  await browser.close();
}
