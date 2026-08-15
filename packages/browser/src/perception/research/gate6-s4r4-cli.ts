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
  gate6CandidateV4Strategy,
  type Gate6CandidateV4Input,
} from "./gate6-candidate-v4.js";
import {
  GATE6_CHALLENGE_B_CASES,
  challengeBDisposition,
} from "./gate6-challenge-b.js";
import {
  GATE6_CHALLENGE_C_CASES,
  challengeCDisposition,
} from "./gate6-challenge-c.js";
import {
  GATE6_CHALLENGE_D_CASES,
  challengeDDisposition,
} from "./gate6-challenge-d.js";
import {
  GATE6_HELDOUT_CASES,
  gate6Disposition,
  gate6Document,
} from "./gate6-heldout.js";
import { collectGate6SurfaceFactsV4 } from "./gate6-semantics-v4.js";
import { pageSignals } from "./gate6-validation.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

const CHALLENGE_A_VERSION = 6001;
const CHALLENGE_B_VERSION = 6002;
const CHALLENGE_C_VERSION = 6003;
const CHALLENGE_D_VERSION = 6004;

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
): Promise<Gate6CandidateV4Input> {
  const recorder = new PageObservationRecorder(page);
  const started = performance.now();

  const evidence = await collectResearchEvidence(page, recorder);

  const [signals, surfaceFacts] = await Promise.all([
    pageSignals(page, httpStatus),
    collectGate6SurfaceFactsV4(page),
  ]);

  return {
    signals,
    evidence: evidence.evidence,
    surfaceFacts,
    acquisitionMs: performance.now() - started,
    evidenceBytes: evidence.payload.totalBytes,
  };
}

async function frozenCases(
  context: BrowserContext,
  server: FixtureServer,
): Promise<BenchmarkCase<Gate6CandidateV4Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV4Input>[] = [];

  for (const item of LOCAL_PERCEPTION_CASES) {
    let input: Gate6CandidateV4Input;

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
): Promise<BenchmarkCase<Gate6CandidateV4Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV4Input>[] = [];

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
): Promise<BenchmarkCase<Gate6CandidateV4Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV4Input>[] = [];

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

async function challengeCCases(
  context: BrowserContext,
): Promise<BenchmarkCase<Gate6CandidateV4Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV4Input>[] = [];

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

async function challengeDCases(
  context: BrowserContext,
): Promise<BenchmarkCase<Gate6CandidateV4Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV4Input>[] = [];

  for (const definition of GATE6_CHALLENGE_D_CASES) {
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

function unavailableGeometry(evidence: ResearchEvidence): ResearchEvidence {
  const copy = structuredClone(evidence);

  for (const frame of copy.frames) {
    if (frame.depth === 0) {
      continue;
    }

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
      throw new Error("S4R4 channel study requires research evidence.");
    }

    const strategy = gate6CandidateV4Strategy();

    const complete = await strategy.predict(full, {
      id: "s4r4-channel-complete",
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
        id: "s4r4-channel-geometry-unavailable",
        tier: "A",
        description: "geometry unavailable",
        criticality: "critical",
        tags: [],
      },
    );

    return {
      complete,
      geometryUnavailable,
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

function row(name: string, report: BenchmarkReport): string {
  return `| ${name} | ${report.metrics.caseCount} | ${(report.metrics.primaryStateAccuracy * 100).toFixed(2)}% | ${report.metrics.macroF1.toFixed(6)} | ${report.metrics.riskWeightedLoss.toFixed(3)} | ${(report.metrics.highConfidenceErrorRate * 100).toFixed(2)}% | ${report.metrics.criticalInvariantViolationCount} | ${((report.metrics.propositionAggregate.accuracy ?? 0) * 100).toFixed(2)}% |`;
}

function markdown(input: {
  frozen: BenchmarkReport;
  challengeA: BenchmarkReport;
  challengeB: BenchmarkReport;
  challengeC: BenchmarkReport;
  challengeD: BenchmarkReport;
  channel: Awaited<ReturnType<typeof channelStudy>>;
  acquisition: Record<string, DistributionSummary>;
}) {
  const failureLines = (report: BenchmarkReport) => {
    const items = failures(report);

    return items.length === 0
      ? "- none"
      : items
          .map(
            (item) =>
              `- \`${item.id}\`: expected \`${item.expectedPrimaryState}\`, got \`${item.actual.kind}\` (${item.actual.confidence}), risk=${item.riskCost}, critical=${item.criticalInvariantViolation}.`,
          )
          .join("\n");
  };

  const channelPassed = Object.values(input.channel.observations).every(
    (value) => value === true,
  );

  const accepted =
    exactPass(input.frozen) &&
    exactPass(input.challengeA) &&
    exactPass(input.challengeB) &&
    exactPass(input.challengeC) &&
    exactPass(input.challengeD) &&
    channelPassed;

  return `# F1 Gate 6 S4R4 Surface-Ownership Remediation

## Architecture

S4R4 is a separate research candidate created after independent Challenge D falsified S4R3.

The key change is explicit surface ownership:

- primary workflow, blocking-dialog, alert, and supplementary surfaces are collected separately;
- semantic cues are evaluated within their owning surface instead of promoted page-globally;
- documentation/settings context on the primary surface cannot veto a blocking dialog above it;
- supplementary footer/sidebar/card copy cannot become a workflow blocker by vocabulary alone;
- when no \`main\` exists, the document body becomes the primary surface;
- HTTP blocker evidence remains independent so overlapping propositions are preserved;
- frame semantic identity remains separate from frame presentation evidence.

Challenge D remains hash-frozen remedial evidence. No production classifier/runtime file is changed by this study.

## Results

| Set | Cases | Accuracy | Macro F1 | Risk | HC error | Critical | Proposition accuracy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${row("Frozen Tier A", input.frozen)}
${row("Challenge A", input.challengeA)}
${row("Challenge B", input.challengeB)}
${row("Challenge C", input.challengeC)}
${row("Challenge D", input.challengeD)}

### Frozen failures

${failureLines(input.frozen)}

### Challenge A failures

${failureLines(input.challengeA)}

### Challenge B failures

${failureLines(input.challengeB)}

### Challenge C failures

${failureLines(input.challengeC)}

### Challenge D failures

${failureLines(input.challengeD)}

## Channel degradation

- complete semantic-frame verification correct: ${input.channel.observations.completeCorrect}
- unavailable frame geometry -> proposition indeterminate: ${input.channel.observations.geometryUnavailableIndeterminate}
- unavailable frame geometry avoids high confidence: ${input.channel.observations.geometryUnavailableNotHigh}
- compatibility ready/medium requires a later policy gate: ${input.channel.observations.geometryUnavailableReadyNeedsPolicyGate}

Channel acceptance: **${channelPassed}**

## Known-set status

Exact across all 88 fixed/remedial deterministic cases plus channel degradation: **${accepted}**

If this is true, S4R4 must be frozen before any new confirmatory Challenge E is authored or executed. Challenge D is remedial evidence and no longer qualifies as independent confirmation.

## Still outstanding

- independent Challenge E after S4R4 freeze;
- S4R4-specific decision-relevant temporal validation;
- runtime activity-to-inspection invalidation validation;
- mutation authorization for low/medium-confidence ready and unresolved evidence;
- production-path acquisition/latency/payload measurement;
- recorded/live Tier C/D validation where privacy-safe;
- final ADR/runbook and production integration.
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
  const [frozen, challengeA, challengeB, challengeC, challengeD] =
    await Promise.all([
      frozenCases(context, server),
      challengeACases(context),
      challengeBCases(context),
      challengeCCases(context),
      challengeDCases(context),
    ]);

  const riskModel = await loadF1RiskModel();

  const strategy = gate6CandidateV4Strategy();

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

  const challengeCReport = await runBenchmark({
    corpusVersion: CHALLENGE_C_VERSION,
    cases: challengeC,
    strategy,
    riskModel,
  });

  const challengeDReport = await runBenchmark({
    corpusVersion: CHALLENGE_D_VERSION,
    cases: challengeD,
    strategy,
    riskModel,
  });

  const channel = await channelStudy(context);

  const distribution = (cases: BenchmarkCase<Gate6CandidateV4Input>[]) =>
    summarize(
      cases
        .map((item) => item.input.acquisitionMs)
        .filter((value): value is number => value !== undefined),
    );

  const acquisition = {
    frozen: distribution(frozen),
    challengeA: distribution(challengeA),
    challengeB: distribution(challengeB),
    challengeC: distribution(challengeC),
    challengeD: distribution(challengeD),
  };

  const channelPassed = Object.values(channel.observations).every(
    (value) => value === true,
  );

  const knownSetAccepted =
    exactPass(frozenReport) &&
    exactPass(challengeAReport) &&
    exactPass(challengeBReport) &&
    exactPass(challengeCReport) &&
    exactPass(challengeDReport) &&
    channelPassed;

  const artifact = {
    schemaVersion: 1,
    experiment: "f1-gate6-s4r4-surface-ownership-remediation",
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
        challengeC: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-challenge-c.ts",
          ),
        ),
        challengeD: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-challenge-d.ts",
          ),
        ),
        candidateV4: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-candidate-v4.ts",
          ),
        ),
        semanticsV4: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-semantics-v4.ts",
          ),
        ),
      },
    },
    frozen: frozenReport,
    challengeA: challengeAReport,
    challengeB: challengeBReport,
    challengeC: challengeCReport,
    challengeD: challengeDReport,
    channel,
    acquisition,
    channelPassed,
    knownSetAccepted,
    nextStep: knownSetAccepted
      ? "freeze_s4r4_and_author_independent_challenge_e"
      : "inspect_s4r4_failures_before_further_remediation",
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
      challengeC: challengeCReport,
      challengeD: challengeDReport,
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
