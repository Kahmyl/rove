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
  gate6CandidateV6Strategy,
  type Gate6CandidateV6Input,
} from "./gate6-candidate-v6.js";
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
  GATE6_CHALLENGE_F_CASES,
  challengeFDisposition,
} from "./gate6-challenge-f.js";
import {
  GATE6_HELDOUT_CASES,
  gate6Disposition,
  gate6Document,
} from "./gate6-heldout.js";
import { collectGate6SurfaceFactsV6 } from "./gate6-semantics-v6.js";
import { pageSignals } from "./gate6-validation.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const A = 6001,
  B = 6002,
  C = 6003,
  D = 6004,
  E = 6005,
  F = 6006;

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (value === undefined) throw new Error(`${name} is required.`);
  return resolve(value);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fileHash(path: string): Promise<string> {
  return sha256(await readFile(path));
}

function summarize(values: number[]): DistributionSummary {
  if (values.length === 0)
    return { sampleCount: 0, mean: null, median: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const p = (f: number) =>
    sorted[
      Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * f) - 1))
    ]!;
  return {
    sampleCount: sorted.length,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    median: p(0.5),
    p95: p(0.95),
    max: sorted.at(-1)!,
  };
}

async function acquire(
  page: Page,
  httpStatus?: number,
): Promise<Gate6CandidateV6Input> {
  const recorder = new PageObservationRecorder(page);
  const started = performance.now();
  const evidence = await collectResearchEvidence(page, recorder);
  const [signals, surfaceFacts] = await Promise.all([
    pageSignals(page, httpStatus),
    collectGate6SurfaceFactsV6(page),
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
): Promise<BenchmarkCase<Gate6CandidateV6Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV6Input>[] = [];
  for (const item of LOCAL_PERCEPTION_CASES) {
    let input: Gate6CandidateV6Input;
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
): Promise<BenchmarkCase<Gate6CandidateV6Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV6Input>[] = [];
  for (const d of GATE6_HELDOUT_CASES) {
    const page = await context.newPage();
    try {
      await page.setContent(gate6Document(d.title, d.body), {
        waitUntil: "load",
      });
      cases.push({
        id: d.id,
        tier: "A",
        description: d.description,
        input: await acquire(page, d.httpStatus),
        expectedPropositions: d.expectedPropositions,
        expectedPrimaryState: d.expectedPrimaryState,
        expectedDisposition: gate6Disposition(d.expectedPrimaryState),
        criticality: d.criticality,
        tags: [...d.tags],
      });
    } finally {
      await page.close();
    }
  }
  return cases;
}

type Def = {
  id: string;
  description: string;
  title: string;
  body: string;
  httpStatus?: number;
  expectedPropositions: BenchmarkCase<Gate6CandidateV6Input>["expectedPropositions"];
  expectedPrimaryState: BenchmarkCase<Gate6CandidateV6Input>["expectedPrimaryState"];
  criticality: BenchmarkCase<Gate6CandidateV6Input>["criticality"];
  tags: readonly string[];
};

async function defCases(
  context: BrowserContext,
  defs: readonly Def[],
  disposition: (
    s: Def["expectedPrimaryState"],
  ) => BenchmarkCase<Gate6CandidateV6Input>["expectedDisposition"],
): Promise<BenchmarkCase<Gate6CandidateV6Input>[]> {
  const cases: BenchmarkCase<Gate6CandidateV6Input>[] = [];
  for (const d of defs) {
    const page = await context.newPage();
    try {
      await page.setContent(
        `<!doctype html><html><head><title>${d.title}</title></head><body>${d.body}</body></html>`,
        { waitUntil: "load" },
      );
      cases.push({
        id: d.id,
        tier: "A",
        description: d.description,
        input: await acquire(page, d.httpStatus),
        expectedPropositions: d.expectedPropositions,
        expectedPrimaryState: d.expectedPrimaryState,
        expectedDisposition: disposition(d.expectedPrimaryState),
        criticality: d.criticality,
        tags: [...d.tags],
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
      `<!doctype html><html><body><iframe title="Human verification" style="width:340px;height:150px" srcdoc="<!doctype html><html><body><button>Continue</button></body></html>"></iframe></body></html>`,
      { waitUntil: "load" },
    );
    const full = await acquire(page);
    if (full.evidence === undefined)
      throw new Error("S4R6 channel study requires evidence.");
    const strategy = gate6CandidateV6Strategy();
    const complete = await strategy.predict(full, {
      id: "v6-channel-complete",
      tier: "A",
      description: "complete",
      criticality: "critical",
      tags: [],
    });
    const degraded = await strategy.predict(
      { ...full, evidence: unavailableGeometry(full.evidence) },
      {
        id: "v6-channel-degraded",
        tier: "A",
        description: "degraded",
        criticality: "critical",
        tags: [],
      },
    );
    return {
      complete,
      degraded,
      observations: {
        completeCorrect: complete.assessment.kind === "human_verification",
        degradedIndeterminate:
          degraded.propositions?.humanVerificationPresented === "indeterminate",
        degradedNotHigh: degraded.assessment.confidence !== "high",
        degradedReadyNeedsPolicyGate:
          degraded.assessment.kind === "ready" &&
          degraded.assessment.confidence !== "high",
      },
    };
  } finally {
    await page.close();
  }
}

function exact(report: BenchmarkReport): boolean {
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

const out = arg("--out");
const analysis = arg("--analysis");
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
}).trim();
const browser: Browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const server = await startFixtureServer();

try {
  const [frozen, a, b, c, d, e, f] = await Promise.all([
    frozenCases(context, server),
    challengeACases(context),
    defCases(context, GATE6_CHALLENGE_B_CASES, challengeBDisposition),
    defCases(context, GATE6_CHALLENGE_C_CASES, challengeCDisposition),
    defCases(context, GATE6_CHALLENGE_D_CASES, challengeDDisposition),
    defCases(context, GATE6_CHALLENGE_E_CASES, challengeEDisposition),
    defCases(context, GATE6_CHALLENGE_F_CASES, challengeFDisposition),
  ]);

  const riskModel = await loadF1RiskModel();
  const strategy = gate6CandidateV6Strategy();
  const run = (
    version: number,
    cases: BenchmarkCase<Gate6CandidateV6Input>[],
  ) => runBenchmark({ corpusVersion: version, cases, strategy, riskModel });

  const [fr, ar, br, cr, dr, er, fr2] = await Promise.all([
    run(LOCAL_PERCEPTION_CORPUS_VERSION, frozen),
    run(A, a),
    run(B, b),
    run(C, c),
    run(D, d),
    run(E, e),
    run(F, f),
  ]);

  const channel = await channelStudy(context);
  const channelPassed = Object.values(channel.observations).every(Boolean);
  const knownSetAccepted =
    exact(fr) &&
    exact(ar) &&
    exact(br) &&
    exact(cr) &&
    exact(dr) &&
    exact(er) &&
    exact(fr2) &&
    channelPassed;

  const dist = (cases: BenchmarkCase<Gate6CandidateV6Input>[]) =>
    summarize(
      cases
        .map((x) => x.input.acquisitionMs)
        .filter((x): x is number => x !== undefined),
    );

  const artifact = {
    schemaVersion: 1,
    experiment: "f1-gate6-s4r6-evidence-precedence-alert-ownership",
    generatedAt: new Date().toISOString(),
    metadata: {
      sourceRevision,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      chromiumVersion: browser.version(),
      hashes: {
        challengeE: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-challenge-e.ts",
          ),
        ),
        challengeF: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-challenge-f.ts",
          ),
        ),
        candidateV6: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-candidate-v6.ts",
          ),
        ),
        semanticsV6: await fileHash(
          resolve(
            REPO_ROOT,
            "packages/browser/src/perception/research/gate6-semantics-v6.ts",
          ),
        ),
      },
    },
    frozen: fr,
    challengeA: ar,
    challengeB: br,
    challengeC: cr,
    challengeD: dr,
    challengeE: er,
    challengeF: fr2,
    channel,
    acquisition: {
      frozen: dist(frozen),
      challengeA: dist(a),
      challengeB: dist(b),
      challengeC: dist(c),
      challengeD: dist(d),
      challengeE: dist(e),
      challengeF: dist(f),
    },
    channelPassed,
    knownSetAccepted,
    nextStep: knownSetAccepted
      ? "freeze_s4r6_before_final_confirmation"
      : "inspect_s4r6_failures",
  };

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await mkdir(dirname(analysis), { recursive: true });
  await writeFile(
    analysis,
    `# F1 Gate 6 S4R6\n\nKnown/remedial exactness: **${knownSetAccepted}**\n\nChannel acceptance: **${channelPassed}**\n`,
    "utf8",
  );
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
