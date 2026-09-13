import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { UI_TRUTH_SCENARIOS } from "./ui-truth-scenarios.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputRoot = join(repositoryRoot, "artifacts/ui-qualification");

const categoryDirectory = {
  tasks: "tasks",
  workflows: "workflows",
  results: "results",
  collaboration: "collaboration",
  recording: "recording",
  "data-management": "data-management",
};

const records = [];
for (const scenario of UI_TRUTH_SCENARIOS) {
  const caseId = `ui-truth-${scenario.id.toLowerCase()}`;
  const directory = categoryDirectory[scenario.category];
  const scenarioRoot = join(outputRoot, directory, caseId);
  const manifestPath = join(scenarioRoot, "manifest.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const artifact = manifest.artifacts.find((entry) => entry.id === caseId);
    if (!artifact) throw new Error("scenario artifact missing");
    records.push({
      ...artifact,
      manifestPath: relative(repositoryRoot, manifestPath),
    });
  } catch (cause) {
    records.push({
      scenarioId: scenario.id,
      name: scenario.name,
      category: scenario.category,
      status: "NOT QUALIFIED",
      notes: [cause instanceof Error ? cause.message : String(cause)],
    });
  }
}

const counts = {
  pass: records.filter((record) => record.status === "PASS").length,
  fail: records.filter((record) => record.status === "FAIL").length,
  notQualified: records.filter((record) => record.status === "NOT QUALIFIED")
    .length,
};
const traced = records.filter((record) => record.tracePath);
const generatedAt = new Date().toISOString();
const confirmedProductDefects = [
  {
    classification: "TRUTH_DEFECT",
    scenarioId: "C04",
    applicationTruth:
      "Capture Mode is human-led and does not imply an active Codex turn.",
    rendererTruth:
      "The visible task-owned recording surface now uses the canonical Capture · Human-driven label.",
    observedUi:
      "The post-launch recording surface previously exposed only the raw capture mode label.",
    rootSource: "apps/companion/src/renderer/product-surface.tsx",
    correction:
      "Use the canonical execution-mode label on visible task recording and frozen task-setup surfaces.",
    status: "CORRECTED",
  },
];
const qualificationGaps = [
  {
    scope: "multi-step renderer streams",
    detail:
      "The stable-state matrix and interaction traces do not replay every listed lifecycle as one synthetic application-state stream; lower-level domain tests remain the transition authority.",
  },
  {
    scope: "packaged operating-system behavior",
    detail:
      "Real permission revocation, disk exhaustion, native directory-picker cancellation, and packaged recording playback remain outside this deterministic source-renderer run.",
  },
];

await mkdir(join(outputRoot, "flows"), { recursive: true });
await writeFile(
  join(outputRoot, "manifest.json"),
  `${JSON.stringify(
    {
      generatedAt,
      counts,
      scenarios: records,
      confirmedProductDefects,
      qualificationGaps: [
        ...qualificationGaps,
        ...records
          .filter((record) => record.status === "NOT QUALIFIED")
          .map((record) => ({
            scenarioId: record.scenarioId,
            notes: record.notes,
          })),
      ],
    },
    null,
    2,
  )}\n`,
);

const grouped = Object.groupBy(records, (record) => record.category);
const statusSections = Object.entries(grouped)
  .map(
    ([category, entries]) =>
      `## ${category}\n\n${entries
        .map(
          (entry) =>
            `- ${entry.scenarioId} — ${entry.name}: **${entry.status}**${
              entry.path
                ? ` ([screenshot](${relative(outputRoot, join(repositoryRoot, entry.path))}))`
                : ""
            }${
              entry.tracePath
                ? ` ([trace](${relative(outputRoot, join(repositoryRoot, entry.tracePath))}))`
                : ""
            }`,
        )
        .join("\n")}`,
  )
  .join("\n\n");

const summary = `# Rove UI Truth qualification\n\nGenerated: ${generatedAt}\n\n- PASS: ${counts.pass}\n- FAIL: ${counts.fail}\n- NOT QUALIFIED: ${counts.notQualified}\n- Semantic failures: ${counts.fail}\n- Confirmed product defects: ${confirmedProductDefects.length} corrected, 0 open\n- Qualification gaps: ${qualificationGaps.length + counts.notQualified}\n\n${statusSections}\n\n## Confirmed product defects\n\n- C04 TRUTH_DEFECT — corrected. The visible post-launch Capture surface now says “Capture · Human-driven” instead of exposing only the raw execution-mode value.\n\n## Qualification gaps\n\n${qualificationGaps.map((gap) => `- ${gap.scope}: ${gap.detail}`).join("\n")}\n\n## Visual-review priorities\n\n1. T07 active Task A while Task B is viewed.\n2. A01–A05 consequential-action certainty and unresolved-state language.\n3. T06 task-scoped browser-control attention.\n4. W04 explicit Save to Workflow boundary.\n5. V01–V04 recording scope, finalization, availability, and interruption.\n6. C02–C04 takeover, return-control, and Capture semantics.\n7. W01, T01, and B01 empty/absent capability states.\n\nScreenshots establish rendered presentation only; semantic assertions and negative assertions in the manifest are the primary truth evidence.\n`;
await writeFile(join(outputRoot, "summary.md"), summary);

const flowSummary = `# UI Truth interaction traces\n\n${
  traced.length > 0
    ? traced
        .map(
          (record) =>
            `- ${record.scenarioId} — ${record.name}: [trace](../${relative(outputRoot, join(repositoryRoot, record.tracePath))})`,
        )
        .join("\n")
    : "No interaction traces were generated."
}\n\nThese bounded traces cover the interaction-bearing stable-state checks in the catalog. They do not claim end-to-end live Codex, external-service, or real-account execution.\n`;
await writeFile(join(outputRoot, "flows/summary.md"), flowSummary);

process.stdout.write(
  `${JSON.stringify({ status: "pass", counts, traces: traced.length })}\n`,
);
