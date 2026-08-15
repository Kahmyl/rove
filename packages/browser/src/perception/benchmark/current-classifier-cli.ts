import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { classifyPageState } from "../../safety/page-state-classifier.js";
import {
  LOCAL_PERCEPTION_CASES,
  LOCAL_PERCEPTION_CORPUS_VERSION,
} from "../corpus/local-corpus.js";
import { loadF1RiskModel } from "./risk-model.js";
import { runBenchmark } from "./runner.js";
import type { BenchmarkStrategy } from "./types.js";
import type { PageSignals } from "../../safety/page-state-classifier.js";

function outputPath(): string | undefined {
  const index = process.argv.indexOf("--out");
  const value = index === -1 ? undefined : process.argv[index + 1];

  if (index !== -1 && value === undefined) {
    throw new Error("--out requires a file path.");
  }

  return value === undefined ? undefined : resolve(value);
}

const strategy: BenchmarkStrategy<PageSignals> = {
  name: "current-page-state-classifier",
  predict: (input) => {
    const started = performance.now();
    const assessment = classifyPageState(input);

    return {
      assessment,
      timing: {
        inferenceMs: performance.now() - started,
      },
      payload: {
        evidenceBytes: Buffer.byteLength(JSON.stringify(input)),
      },
    };
  },
};

const riskModel = await loadF1RiskModel();
const report = await runBenchmark({
  corpusVersion: LOCAL_PERCEPTION_CORPUS_VERSION,
  cases: LOCAL_PERCEPTION_CASES,
  strategy,
  riskModel,
});

const serialized = `${JSON.stringify(
  {
    generatedAt: new Date().toISOString(),
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
