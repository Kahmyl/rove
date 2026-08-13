import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import type { PageStateAssessment } from "@rove/protocol";

import {
  startFixtureServer,
  type FixtureServer,
} from "../../fixtures/fixture-server.js";
import { PlaywrightBrowserEngine } from "../../playwright-browser-engine.js";
import {
  LOCAL_PERCEPTION_CASES,
  LOCAL_PERCEPTION_CORPUS_VERSION,
} from "../corpus/local-corpus.js";
import { loadF1RiskModel } from "./risk-model.js";
import { runBenchmark } from "./runner.js";
import {
  PAGE_STATE_CONFIDENCES,
  PAGE_STATE_KINDS,
  PAGE_STATE_RECOMMENDED_ACTIONS,
  type BenchmarkCase,
  type BenchmarkStrategy,
} from "./types.js";

interface BrowserInspectInput {
  route: string;
}

function outputPath(): string | undefined {
  const index = process.argv.indexOf("--out");
  const value = index === -1 ? undefined : process.argv[index + 1];

  if (index !== -1 && value === undefined) {
    throw new Error("--out requires a file path.");
  }

  return value === undefined ? undefined : resolve(value);
}

function isPageStateAssessment(value: unknown): value is PageStateAssessment {
  if (typeof value !== "object" || value === null) return false;

  const assessment = value as Record<string, unknown>;

  return (
    PAGE_STATE_KINDS.some((kind) => kind === assessment.kind) &&
    PAGE_STATE_CONFIDENCES.some(
      (confidence) => confidence === assessment.confidence,
    ) &&
    Array.isArray(assessment.signals) &&
    assessment.signals.every((signal) => typeof signal === "string") &&
    PAGE_STATE_RECOMMENDED_ACTIONS.some(
      (action) => action === assessment.recommendedAction,
    )
  );
}

function pipelineCases(): BenchmarkCase<BrowserInspectInput>[] {
  return LOCAL_PERCEPTION_CASES.flatMap((benchmarkCase) => {
    if (!benchmarkCase.pipelineEligible || benchmarkCase.route === undefined) {
      return [];
    }

    return [
      {
        id: benchmarkCase.id,
        tier: benchmarkCase.tier,
        description: benchmarkCase.description,
        input: {
          route: benchmarkCase.route,
        },
        expectedPropositions: benchmarkCase.expectedPropositions,
        expectedPrimaryState: benchmarkCase.expectedPrimaryState,
        expectedDisposition: benchmarkCase.expectedDisposition,
        criticality: benchmarkCase.criticality,
        tags: [...benchmarkCase.tags, "browser-inspect"],
        ...(benchmarkCase.notes === undefined
          ? {}
          : { notes: benchmarkCase.notes }),
      },
    ];
  });
}

const fixture: FixtureServer = await startFixtureServer();
const engine = new PlaywrightBrowserEngine();
const session = await engine.start({
  headless: true,
  browser: "chromium",
  profile: {
    mode: "temporary",
  },
});

try {
  const strategy: BenchmarkStrategy<BrowserInspectInput> = {
    name: "current-browser-inspect-pipeline",
    predict: async (input) => {
      await session.navigate(new URL(input.route, fixture.url).toString());

      const started = performance.now();
      const inspection = await session.inspect();
      const inspectTotalMs = performance.now() - started;
      const pageState = inspection.metadata?.pageState;

      if (!isPageStateAssessment(pageState)) {
        throw new Error(
          `browser.inspect() did not return valid page-state metadata for ${input.route}.`,
        );
      }

      return {
        assessment: pageState,
        timing: {
          totalMs: inspectTotalMs,
        },
        payload: {
          evidenceBytes: Buffer.byteLength(JSON.stringify(inspection)),
        },
      };
    },
  };

  const report = await runBenchmark({
    corpusVersion: LOCAL_PERCEPTION_CORPUS_VERSION,
    cases: pipelineCases(),
    strategy,
    riskModel: await loadF1RiskModel(),
  });

  const serialized = `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      measurementScope: {
        path: "PlaywrightBrowserSession.inspect()",
        navigationExcludedFromLatency: true,
        latencySemantics:
          "total browser.inspect() wall time; acquisition/inference are not separately observable in the frozen production API",
        pipelineEligibleCasesOnly: true,
      },
      ...report,
    },
    null,
    2,
  )}\n`;

  const out = outputPath();

  if (out !== undefined) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, serialized, "utf8");
  }

  process.stdout.write(serialized);
} finally {
  await session.close();
  await fixture.close();
}
