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
  gate6CandidateV5Strategy,
  type Gate6CandidateV5Input,
} from "./gate6-candidate-v5.js";
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
  GATE6_CHALLENGE_E_CASES,
  challengeEDisposition,
} from "./gate6-challenge-e.js";
import {
  GATE6_HELDOUT_CASES,
  gate6Disposition,
  gate6Document,
} from "./gate6-heldout.js";
import { collectGate6SurfaceFactsV5 } from "./gate6-semantics-v5.js";
import { pageSignals } from "./gate6-validation.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

const CHALLENGE_A_VERSION = 6001;
const CHALLENGE_B_VERSION = 6002;
const CHALLENGE_C_VERSION = 6003;
const CHALLENGE_D_VERSION = 6004;
const CHALLENGE_E_VERSION = 6005;

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

  const sorted = [...values].sort((a, b) => a - b);
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
): Promise<Gate6CandidateV5Input> {
  const recorder = new PageObservationRecorder(page);
  const started = performance.now();

  const evidence = await collectResearchEvidence(page, recorder);
  const [signals, surfaceFacts] = await Promise.all([
    pageSignals(page, httpStatus),
    collectGate6SurfaceFactsV5(page),
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
): Promise<BenchmarkCase<Gate6CandidateV5Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV5Input>[] = [];

  for (const item of LOCAL_PERCEPTION_CASES) {
    let input: Gate6CandidateV5Input;

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
      input = { signals: item.input };
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
): Promise<BenchmarkCase<Gate6CandidateV5Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV5Input>[] = [];

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

type Gate6DefinitionLike = {
  id: string;
  description: string;
  title: string;
  body: string;
  httpStatus?: number;
  expectedPropositions: BenchmarkCase<Gate6CandidateV5Input>["expectedPropositions"];
  expectedPrimaryState: BenchmarkCase<Gate6CandidateV5Input>["expectedPrimaryState"];
  criticality: BenchmarkCase<Gate6CandidateV5Input>["criticality"];
  tags: readonly string[];
};

async function definitionCases(
  context: BrowserContext,
  definitions: readonly Gate6DefinitionLike[],
  disposition: (
    state: Gate6DefinitionLike["expectedPrimaryState"],
  ) => BenchmarkCase<Gate6CandidateV5Input>["expectedDisposition"],
): Promise<BenchmarkCase<Gate6CandidateV5Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV5Input>[] = [];

  for (const definition of definitions) {
    const page = await context.newPage();

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

      cases.push({
        id: definition.id,
        tier: "A",
        description: definition.description,
        input: await acquire(page, definition.httpStatus),
        expectedPropositions: definition.expectedPropositions,
        expectedPrimaryState: definition.expectedPrimaryState,
        expectedDisposition: disposition(definition.expectedPrimaryState),
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
      throw new Error("S4R5 channel study requires research evidence.");
    }

    const strategy = gate6CandidateV5Strategy();

    const complete = await strategy.predict(full, {
      id: "s4r5-channel-complete",
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
        id: "s4r5-channel-geometry-unavailable",
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
  challengeE: BenchmarkReport;
  channel: Awaited<ReturnType<typeof channelStudy>>;
}) {
  const failureLines = (report: BenchmarkReport) => {
    const items = failures(report);
    return items.length === 0
      ? "- none"
      : items
          .map(
            (item) =>
              `- ${item.id}: expected ${item.expectedPrimaryState}, got ${item.actual.kind} (${item.actual.confidence}), risk=${item.riskCost}, critical=${item.criticalInvariantViolation}.`,
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
    exactPass(input.challengeE) &&
    channelPassed;

  return `# F1 Gate 6 S4R5 Title-Role Remediation

## Results

| Set | Cases | Accuracy | Macro F1 | Risk | HC error | Critical | Proposition accuracy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${row("Frozen Tier A", input.frozen)}
${row("Challenge A", input.challengeA)}
${row("Challenge B", input.challengeB)}
${row("Challenge C", input.challengeC)}
${row("Challenge D", input.challengeD)}
${row("Challenge E", input.challengeE)}

## Failures

### Frozen
${failureLines(input.frozen)}

### Challenge A
${failureLines(input.challengeA)}

### Challenge B
${failureLines(input.challengeB)}

### Challenge C
${failureLines(input.challengeC)}

### Challenge D
${failureLines(input.challengeD)}

### Challenge E
${failureLines(input.challengeE)}

## Channel degradation

- complete semantic-frame verification correct: ${input.channel.observations.completeCorrect}
- unavailable frame geometry -> proposition indeterminate: ${input.channel.observations.geometryUnavailableIndeterminate}
- unavailable frame geometry avoids high confidence: ${input.channel.observations.geometryUnavailableNotHigh}
- compatibility ready/medium requires later policy gate: ${input.channel.observations.geometryUnavailableReadyNeedsPolicyGate}

Channel acceptance: **${channelPassed}**

## Known/remedial status

Exact across all 112 fixed/remedial deterministic cases plus channel degradation: **${accepted}**

If true, freeze S4R5 before authoring any independent Challenge F.
`;
}

const out = arg("--out");
const analysis = arg("--analysis");

const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
}).trim();

const browser: Browser = await chromium.launch({ headless: true });
const context: BrowserContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const server = await startFixtureServer();

try {
  const [frozen, challengeA, challengeB, challengeC, challengeD, challengeE] =
    await Promise.all([
      frozenCases(context, server),
      challengeACases(context),
      definitionCases(context, GATE6_CHALLENGE_B_CASES, challengeBDisposition),
      definitionCases(context, GATE6_CHALLENGE_C_CASES, challengeCDisposition),
      definitionCases(context, GATE6_CHALLENGE_D_CASES, challengeDDisposition),
      definitionCases(context, GATE6_CHALLENGE_E_CASES, challengeEDisposition),
    ]);

  const riskModel = await loadF1RiskModel();
  const strategy = gate6CandidateV5Strategy();

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
  const challengeEReport = await runBenchmark({
    corpusVersion: CHALLENGE_E_VERSION,
    cases: challengeE,
    strategy,
    riskModel,
  });

  const channel = await channelStudy(context);
  const channelPassed = Object.values(channel.observations).every(
    (value) => value === true,
  );

  const knownSetAccepted =
    exactPass(frozenReport) &&
    exactPass(challengeAReport) &&
    exactPass(challengeBReport) &&
    exactPass(challengeCReport) &&
    exactPass(challengeDReport) &&
    exactPass(challengeEReport) &&
    channelPassed;

  const distribution = (cases: BenchmarkCase<Gate6CandidateV5Input>[]) =>
    summarize(
      cases
        .map((item) => item.input.acquisitionMs)
        .filter((value): value is number => value !== undefined),
    );

  const artifact = {
    schemaVersion: 1,
    experiment: "f1-gate6-s4r5-title-role-remediation",
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
        challengeE: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-challenge-e.ts",
          ),
        ),
        candidateV5: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-candidate-v5.ts",
          ),
        ),
        semanticsV5: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-semantics-v5.ts",
          ),
        ),
      },
    },
    frozen: frozenReport,
    challengeA: challengeAReport,
    challengeB: challengeBReport,
    challengeC: challengeCReport,
    challengeD: challengeDReport,
    challengeE: challengeEReport,
    channel,
    acquisition: {
      frozen: distribution(frozen),
      challengeA: distribution(challengeA),
      challengeB: distribution(challengeB),
      challengeC: distribution(challengeC),
      challengeD: distribution(challengeD),
      challengeE: distribution(challengeE),
    },
    channelPassed,
    knownSetAccepted,
    nextStep: knownSetAccepted
      ? "freeze_s4r5_and_author_independent_challenge_f"
      : "inspect_s4r5_failures_before_further_remediation",
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
      challengeE: challengeEReport,
      channel,
    }),
    "utf8",
  );
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
