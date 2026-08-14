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
  type ResearchEvidence,
} from "./evidence.js";
import {
  gate6CandidateV2Strategy,
  type Gate6CandidateV2Input,
} from "./gate6-candidate-v2.js";
import {
  GATE6_CHALLENGE_B_CASES,
  challengeBDisposition,
} from "./gate6-challenge-b.js";
import {
  GATE6_HELDOUT_CASES,
  gate6Disposition,
  gate6Document,
} from "./gate6-heldout.js";
import {
  collectGate6AccessibilityFactsV2,
  collectGate6SurfaceFactsV2,
} from "./gate6-semantics-v2.js";
import { pageSignals } from "./gate6-validation.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const CHALLENGE_A_VERSION = 6001;
const CHALLENGE_B_VERSION = 6002;

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

async function frozenCases(
  context: BrowserContext,
  server: FixtureServer,
): Promise<BenchmarkCase<Gate6CandidateV2Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV2Input>[] = [];

  for (const item of LOCAL_PERCEPTION_CASES) {
    let input: Gate6CandidateV2Input;

    if (item.pipelineEligible && item.route !== undefined) {
      const page = await context.newPage();

      try {
        const response = await page.goto(
          new URL(item.route, server.url).toString(),
          { waitUntil: "load" },
        );

        input = await acquire(page, response?.status());
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

async function challengeACases(
  context: BrowserContext,
): Promise<BenchmarkCase<Gate6CandidateV2Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV2Input>[] = [];

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
        input: await acquire(page, definition.httpStatus),
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

async function challengeBCases(
  context: BrowserContext,
): Promise<BenchmarkCase<Gate6CandidateV2Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV2Input>[] = [];

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
        input: await acquire(page, definition.httpStatus),
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

function unavailableGeometry(evidence: ResearchEvidence): ResearchEvidence {
  const copy = structuredClone(evidence);

  for (const frame of copy.frames) {
    if (frame.depth === 0) continue;

    frame.element = null;
    frame.elementAcquisition = "unavailable";
    frame.elementUnavailableReason = "frame_element_race";
  }

  return copy;
}

async function channelStudy(context: BrowserContext) {
  const page = await context.newPage();

  try {
    await page.setContent(
      `<!doctype html><html><body>
        <iframe
          title="Human verification"
          style="width:340px;height:150px"
          srcdoc="<!doctype html><html><body><button>Continue</button></body></html>"
        ></iframe>
      </body></html>`,
      { waitUntil: "load" },
    );

    const full = await acquire(page);

    if (full.evidence === undefined) {
      throw new Error("S4R2 channel study requires research evidence.");
    }

    const strategy = gate6CandidateV2Strategy();

    const complete = await strategy.predict(full, {
      id: "s4r2-channel-complete",
      tier: "A",
      description: "complete",
      criticality: "critical",
      tags: [],
    });

    const geometryUnavailable = await strategy.predict(
      {
        ...full,
        evidence: unavailableGeometry(full.evidence),
      },
      {
        id: "s4r2-channel-geometry-unavailable",
        tier: "A",
        description: "geometry unavailable",
        criticality: "critical",
        tags: [],
      },
    );

    const accessibilityUnavailable = await strategy.predict(
      {
        ...full,
        accessibilityFacts: {
          available: false,
          verificationCue: false,
          authenticationCue: false,
          restrictionCue: false,
          errorCue: false,
          dialogCount: 0,
          iframeCount: 0,
        },
      },
      {
        id: "s4r2-channel-accessibility-unavailable",
        tier: "A",
        description: "accessibility unavailable",
        criticality: "critical",
        tags: [],
      },
    );

    return {
      complete,
      geometryUnavailable,
      accessibilityUnavailable,
      observations: {
        completeCorrect: complete.assessment.kind === "human_verification",
        geometryUnavailableIndeterminate:
          geometryUnavailable.propositions?.humanVerificationPresented ===
          "indeterminate",
        geometryUnavailableNotHigh:
          geometryUnavailable.assessment.confidence !== "high",
        geometryUnavailableReadyNeedsPolicyGate:
          geometryUnavailable.assessment.kind === "ready" &&
          geometryUnavailable.assessment.confidence !== "high",
        accessibilityUnavailableCorrect:
          accessibilityUnavailable.assessment.kind === "human_verification",
      },
    };
  } finally {
    await page.close();
  }
}

function exactPass(report: BenchmarkReport): boolean {
  return (
    report.metrics.primaryStateAccuracy === 1 &&
    report.metrics.macroF1 === 1 &&
    report.metrics.riskWeightedLoss === 0 &&
    report.metrics.highConfidenceErrorRate === 0 &&
    report.metrics.criticalInvariantViolationCount === 0 &&
    report.metrics.propositionAggregate.coverage === 1 &&
    report.metrics.propositionAggregate.accuracy === 1
  );
}

function failureSummary(report: BenchmarkReport) {
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
        item.propositions?.[name as keyof typeof item.propositions] !== expected
      ) {
        return true;
      }
    }

    return false;
  });
}

function markdown(report: {
  frozen: BenchmarkReport;
  challengeA: BenchmarkReport;
  challengeB: BenchmarkReport;
  channel: Awaited<ReturnType<typeof channelStudy>>;
  acquisition: {
    frozenMs: DistributionSummary;
    challengeAMs: DistributionSummary;
    challengeBMs: DistributionSummary;
  };
}) {
  const row = (name: string, item: BenchmarkReport) =>
    `| ${name} | ${item.metrics.caseCount} | ${(item.metrics.primaryStateAccuracy * 100).toFixed(2)}% | ${item.metrics.macroF1.toFixed(6)} | ${item.metrics.riskWeightedLoss.toFixed(3)} | ${(item.metrics.highConfidenceErrorRate * 100).toFixed(2)}% | ${item.metrics.criticalInvariantViolationCount} | ${((item.metrics.propositionAggregate.accuracy ?? 0) * 100).toFixed(2)}% |`;

  const failures = (item: BenchmarkReport) => {
    const values = failureSummary(item);

    return values.length === 0
      ? "- none"
      : values
          .map(
            (result) =>
              `- \`${result.id}\`: expected \`${result.expectedPrimaryState}\`, got \`${result.actual.kind}\` (${result.actual.confidence}), risk=${result.riskCost}, critical=${result.criticalInvariantViolation}.`,
          )
          .join("\n");
  };

  const channel = report.channel.observations;

  return `# F1 Gate 6 S4R2 Surface-Gated Remediation

## Status

Research-only architecture remediation after Challenge B falsified S4R.

Challenge B is now a fixed known set. Its ground truth is unchanged.

S4R2 changes the architecture rather than extending top-level phrase matching:

1. determine whether there is a blocking/presentation-qualified surface;
2. classify semantics using direct HTTP families, control/form structure, and
   bounded semantic cues only on relevant surfaces;
3. preserve frame presentation as a separate evidence truth;
4. emit \`indeterminate\` when presentation evidence is unavailable;
5. derive compatibility state after propositions;
6. reserve high-confidence \`ready\` for complete evidence with no unresolved
   blocker proposition.

## Results

| Set | Cases | Accuracy | Macro F1 | Risk | HC error | Critical | Proposition accuracy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${row("Frozen Tier A", report.frozen)}
${row("Challenge A", report.challengeA)}
${row("Challenge B", report.challengeB)}

### Frozen failures

${failures(report.frozen)}

### Challenge A failures

${failures(report.challengeA)}

### Challenge B failures

${failures(report.challengeB)}

## Channel degradation

- complete verification evidence correct: ${channel.completeCorrect}
- unavailable presentation geometry -> verification indeterminate:
  ${channel.geometryUnavailableIndeterminate}
- unavailable geometry avoids high confidence:
  ${channel.geometryUnavailableNotHigh}
- compatibility result is ready/non-high and therefore requires a policy gate:
  ${channel.geometryUnavailableReadyNeedsPolicyGate}
- accessibility unavailable still recognizes a presentation-qualified semantic
  frame:
  ${channel.accessibilityUnavailableCorrect}

Channel acceptance: **${Object.values(channel).every(
    (value) => value === true,
  )}**

## Mutation-authorization dependency

The compatibility taxonomy has no generic stable "uncertain" state. Therefore a
stable observation may legitimately derive \`ready\` while a blocker proposition
is \`indeterminate\`.

Production authorization must not treat all \`ready\` assessments equally.

The implementation runbook must require mutation authorization to have:

- \`kind === "ready"\`;
- \`confidence === "high"\`;
- no unresolved blocker-evidence signal/proposition;
- a fresh inspection after decision-relevant browser activity.

This is an architecture dependency, not a reason to mislabel stable uncertainty
as \`loading\` or \`unknown_interstitial\`.

## Acquisition cost

- Frozen mean/p95: ${report.acquisition.frozenMs.mean?.toFixed(3) ?? "n/a"} / ${report.acquisition.frozenMs.p95?.toFixed(3) ?? "n/a"} ms
- Challenge A mean/p95: ${report.acquisition.challengeAMs.mean?.toFixed(3) ?? "n/a"} / ${report.acquisition.challengeAMs.p95?.toFixed(3) ?? "n/a"} ms
- Challenge B mean/p95: ${report.acquisition.challengeBMs.mean?.toFixed(3) ?? "n/a"} / ${report.acquisition.challengeBMs.p95?.toFixed(3) ?? "n/a"} ms

These are still research-harness costs.

## Next decision

Known-set acceptance: **${
    exactPass(report.frozen) &&
    exactPass(report.challengeA) &&
    exactPass(report.challengeB) &&
    Object.values(channel).every((value) => value === true)
  }**

If true, S4R2 has recovered all fixed deterministic evidence and the required
channel-degradation semantics. That is still not final generalization evidence:
the next action is a new Challenge C / metamorphic confirmatory run with S4R2
frozen, followed by S4R2-specific temporal validation and runtime inspection
freshness validation.
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

const server = await startFixtureServer();

try {
  const [frozen, challengeA, challengeB] = await Promise.all([
    frozenCases(context, server),
    challengeACases(context),
    challengeBCases(context),
  ]);

  const riskModel = await loadF1RiskModel();

  const strategy = gate6CandidateV2Strategy();

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

  const challengeBReport = await runBenchmark({
    corpusVersion: CHALLENGE_B_VERSION,
    cases: challengeB,
    strategy,
    riskModel,
  });

  const channel = await channelStudy(context);

  const acquisition = {
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
    challengeBMs: summarize(
      challengeB
        .map((item) => item.input.acquisitionMs)
        .filter((value): value is number => value !== undefined),
    ),
  };

  const channelPassed = Object.values(channel.observations).every(
    (value) => value === true,
  );

  const knownSetAccepted =
    exactPass(frozenReport) &&
    exactPass(challengeAReport) &&
    exactPass(challengeBReport) &&
    channelPassed;

  const artifact = {
    schemaVersion: 1,
    experiment: "f1-gate6-s4r2-surface-gated-remediation",
    generatedAt: new Date().toISOString(),
    metadata: {
      sourceRevision,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
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
        challengeB: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-challenge-b.ts",
          ),
        ),
        candidateV2: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-candidate-v2.ts",
          ),
        ),
        semanticsV2: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-semantics-v2.ts",
          ),
        ),
      },
    },
    frozen: frozenReport,
    challengeA: challengeAReport,
    challengeB: challengeBReport,
    channel,
    acquisition,
    channelPassed,
    knownSetAccepted,
    productionDependencies: [
      "Mutation authorization must require high-confidence ready rather than any ready state.",
      "Mutation authorization must reject unresolved blocker evidence even when compatibility state is ready.",
      "Decision-relevant browser activity must invalidate prior inspection before mutation authorization.",
      "S4R2 must receive confirmatory Challenge C evidence before architecture freeze.",
      "S4R2-specific temporal validation remains outstanding.",
      "Recorded/live Tier C/D evidence remains outstanding where safely available.",
      "Final production-path latency/payload remains outstanding.",
    ],
  };

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  await mkdir(dirname(analysis), { recursive: true });
  await writeFile(
    analysis,
    markdown({
      frozen: frozenReport,
      challengeA: challengeAReport,
      challengeB: challengeBReport,
      channel,
      acquisition,
    }),
    "utf8",
  );
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
