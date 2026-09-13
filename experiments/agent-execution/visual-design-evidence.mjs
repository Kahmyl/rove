#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputRoot = join(repositoryRoot, "artifacts/visual-design");
const referenceRoot = join(outputRoot, "reference-c931de3");
const beforeRoot = join(outputRoot, "current-before");
const afterRoot = join(outputRoot, "current-after");
const requireBrowserDependency = createRequire(
  join(repositoryRoot, "packages/browser/package.json"),
);
const { chromium } = requireBrowserDependency("playwright");

const referenceManifest = JSON.parse(
  await readFile(join(referenceRoot, "manifest.json"), "utf8"),
);
const candidateManifest = JSON.parse(
  await readFile(join(afterRoot, "manifest.json"), "utf8"),
);
const referenceCommit = execFileSync("git", ["rev-parse", "c931de3^{commit}"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();
const referenceSubject = execFileSync(
  "git",
  ["show", "-s", "--format=%s", referenceCommit],
  { cwd: repositoryRoot, encoding: "utf8" },
).trim();

const referencePatterns = {
  "task composition and navigation": "c931de3 full-composer",
  "conversation, attention, and inspector": "c931de3 full-active-handoff",
  "modal framing": "unchanged Settings and profile-modal patterns",
  "compact companion": "c931de3 compact-active and expanded-attention",
};

const surfaceGroups = [
  {
    area: "Tasks and transitions",
    scenarios: "T01–T08",
    reference: "full-composer; full-active-handoff",
    result:
      "Conversation remains the primary canvas; task selection, execution authority, attention, and continuation retain the approved three-column hierarchy.",
  },
  {
    area: "Workflows and Save to Workflow",
    scenarios: "W01–W04",
    reference:
      "sidebar task-history rows; composer summary controls; profile-modal",
    result:
      "Workflow navigation now uses the sidebar's quiet row grammar, its composer selector matches neighboring controls, and promotion uses standard horizontal modal actions.",
  },
  {
    area: "Structured results and action lifecycle",
    scenarios: "R01–R02, A01–A05",
    reference: "conversation result/approval cards; established status colors",
    result:
      "Results remain persistent working material without replacing conversation; primary content and action metadata no longer use inspector-scale typography, and lifecycle states use established neutral/warning/success/danger roles.",
  },
  {
    area: "Browser collaboration and participation modes",
    scenarios: "B01–B02, C01–C04",
    reference: "full-active-handoff browser inspector and attention card",
    result:
      "Agent, Companion, and Capture remain task modes; browser ownership and control stay in the existing right inspector rather than creating a new main-surface language.",
  },
  {
    area: "Recording",
    scenarios: "V01–V04",
    reference: "browser inspector sections and result-state cards",
    result:
      "Recording moved from the top of every conversation into a task-scoped inspector panel. Idle recording is collapsed; active, finalizing, available, and failed states open with truthful scope and controls.",
  },
  {
    area: "Backup/export",
    scenarios: "D01–D03",
    reference: "unchanged Settings modal and theme-option hierarchy",
    result:
      "Local export remains a secondary Settings section with truthful success, cancellation, exclusion, and unavailable-restore language.",
  },
];

const corrections = [
  [
    "Workflow empty state",
    "Generic button specificity produced a bordered, two-line form-control treatment.",
    "Reused sidebar row spacing, typography, hover, and truncation; made the accessible name begin with the visible Create Workflow label.",
  ],
  [
    "Workflow composer selector",
    "A bordered 12px select interrupted the approved borderless composer control rail.",
    "Rendered as a borderless 30px, 11.5px sibling control with the existing subtle hover surface.",
  ],
  [
    "Recording placement",
    "A large recording disclosure preceded every conversation and displaced task content even when idle.",
    "Moved into the browser inspector; idle is a compact disclosure and active/history states expand in place.",
  ],
  [
    "Result density",
    "New cards used 9–10px status/action text, 30px controls, and a 340px minimum intended for secondary metadata.",
    "Aligned primary result material to 10–13px hierarchy, 34px controls, 420–560px cards, and established 14px card radii.",
  ],
  [
    "Action state emphasis",
    "Prepared, authorized, dispatched, confirmed, unresolved, and failed all had the same neutral pill.",
    "Mapped authoritative states to Rove's existing neutral, warning, success, and danger roles without changing lifecycle semantics.",
  ],
  [
    "Workflow/result modal actions",
    "Forms reused the stacked authentication action layout.",
    "Added the established right-aligned secondary/primary modal action row, with archive separated to the left.",
  ],
  [
    "Sign-in error transition",
    "The same failure appeared in both the local sign-in panel and global error region.",
    "Separated login failures from general local-operation failures: sign-in errors stay contextual while Workflow and other local errors remain globally visible when signed out.",
  ],
  [
    "Compact composer transitions",
    "Workflow insertion exposed stale tab-order assertions and pushed popovers outside the 590px qualification viewport.",
    "Required Workflow in keyboard order and reused fixed 380px/280px setup/model popovers through the 640px compact breakpoint.",
  ],
];

function metric(manifest, artifactId, selector) {
  const artifact = manifest.artifacts.find((entry) => entry.id === artifactId);
  return artifact?.visualMetrics?.find((entry) => entry.selector === selector);
}

const computedComparison = {
  generatedAt: new Date().toISOString(),
  referenceHead: referenceCommit,
  referenceSubject,
  referenceCheckout: "/private/tmp/rove-visual-reference-c931de3",
  referenceGeneration:
    "git archive c931de3 into an isolated temporary checkout; pnpm install --offline; companion build; historical visual harness render",
  referencePatterns,
  samples: [
    {
      pattern: "composer shell",
      reference: metric(
        referenceManifest,
        "full-composer",
        ".composer-input-shell",
      ),
      candidate: metric(
        candidateManifest,
        "ui-truth-t01",
        ".composer-input-shell",
      ),
    },
    {
      pattern: "Workflow navigation row → approved task-history row",
      reference: metric(
        referenceManifest,
        "full-active-handoff",
        ".task-history-row",
      ),
      candidate: metric(
        candidateManifest,
        "ui-truth-w02",
        ".workflow-list-row",
      ),
    },
    {
      pattern: "Workflow composer choice → approved composer summary control",
      reference: metric(
        referenceManifest,
        "full-composer",
        ".composer-menu > summary",
      ),
      candidate: metric(
        candidateManifest,
        "ui-truth-t01",
        ".workflow-task-choice select",
      ),
    },
    {
      pattern: "browser inspector",
      reference: metric(
        referenceManifest,
        "full-active-handoff",
        ".inspector-panel",
      ),
      candidate: metric(candidateManifest, "ui-truth-c02", ".inspector-panel"),
    },
    {
      pattern: "structured result → approved inline attention card",
      reference: metric(
        referenceManifest,
        "full-active-handoff",
        ".attention-card",
      ),
      candidate: metric(candidateManifest, "ui-truth-r01", ".result-card"),
    },
    {
      pattern: "action material → approved inline attention card",
      reference: metric(
        referenceManifest,
        "full-active-handoff",
        ".attention-card",
      ),
      candidate: metric(
        candidateManifest,
        "ui-truth-a01",
        ".result-action-material",
      ),
    },
    {
      pattern: "recording → approved browser inspector panel",
      reference: metric(
        referenceManifest,
        "full-active-handoff",
        ".inspector-panel",
      ),
      candidate: metric(candidateManifest, "ui-truth-v01", ".recording-panel"),
    },
    {
      pattern: "Save to Workflow → unchanged Settings modal",
      reference: metric(candidateManifest, "ui-truth-d03", ".settings-modal"),
      candidate: metric(candidateManifest, "ui-truth-w04", ".profile-modal"),
    },
    {
      pattern: "Save to Workflow actions → unchanged Settings secondary action",
      reference: metric(
        candidateManifest,
        "ui-truth-d03",
        ".settings-data button",
      ),
      candidate: metric(
        candidateManifest,
        "ui-truth-w04",
        ".modal-actions button",
      ),
    },
    {
      pattern: "backup section → unchanged theme-option hierarchy",
      reference: metric(candidateManifest, "ui-truth-d03", ".theme-options"),
      candidate: metric(candidateManifest, "ui-truth-d01", ".settings-data"),
    },
  ],
};

await writeFile(
  join(outputRoot, "reference-provenance.json"),
  `${JSON.stringify(
    {
      commit: referenceCommit,
      subject: referenceSubject,
      isolatedCheckout: "/private/tmp/rove-visual-reference-c931de3",
      generatedFrom: "git archive",
      manifest: "reference-c931de3/manifest.json",
    },
    null,
    2,
  )}\n`,
);

await mkdir(outputRoot, { recursive: true });
await writeFile(
  join(outputRoot, "computed-style-comparison.json"),
  `${JSON.stringify(computedComparison, null, 2)}\n`,
);

function tableRows(rows) {
  return rows
    .map(
      (row) =>
        `| ${row.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`,
    )
    .join("\n");
}

const report = `# Rove visual-design fidelity audit

Reference boundary: \`c931de3\` (last task-first UI before Workflow, result, recording, and backup surfaces), descended from the polished companion redesign at \`209f675\`. Current unchanged authority includes the composer, task timeline, task sidebar rows, browser inspector, attention cards, profile/settings modals, and compact follower.

## Extracted visual grammar

- System/SF Pro typography; 13–14px primary UI text, 10–12px metadata, restrained 600–650 emphasis, and uppercase 10px/0.075–0.1em section labels.
- White main canvas, \`#f7f7f5\` navigation surface, near-black primary controls, hairline neutral borders, and semantic warning/danger/success accents only for authoritative state.
- 58px top navigation; 272px sidebar and 286px inspector at the qualified desktop viewport; centered conversation content with a persistent bottom composer.
- 8–10px compact-control radii, 14px content cards, 18–20px elevated panels/modals, and 999px status pills.
- Quiet sidebar rows and composer controls use borderless default states with subtle hover fills; borders denote fields, cards, and explicit boundaries rather than every action.
- Conversation stays primary. Persistent browser/recording state belongs in the right inspector; review/approval material may sit above the timeline; account/data management belongs in Settings.

## Surface audit

| Area | Scenarios | Approved sibling/reference | Candidate result |
| --- | --- | --- | --- |
${tableRows(surfaceGroups.map((entry) => [entry.area, entry.scenarios, entry.reference, entry.result]))}

## Meaningful inconsistencies and corrections

| Surface | Starting divergence | Correction |
| --- | --- | --- |
${tableRows(corrections)}

## Evidence

- \`reference-c931de3/\`: isolated historical render and computed-style manifest.
- \`current-before/\`: starting screenshots for all 32 UI Truth scenarios.
- \`current-after/\`: corrected screenshots, traces, computed styles, and full interaction manifest.
- \`reference-current-contact-sheet.png\`: reference/current comparison across core grammar.
- \`feature-before-after-contact-sheet.png\`: before/after comparison of the feature surfaces most affected.
- \`computed-style-comparison.json\`: browser-computed geometry, typography, color, border, radius, shadow, spacing, overflow, opacity, and transition samples.
- \`reference-provenance.json\`: resolved historical commit, subject, isolated checkout, and render provenance.
- \`interaction-state-contact-sheet.png\`: explicit default/hover/focus/disabled evidence for new controls.
- \`feature-dark-state-contact-sheet.png\`: dark-theme qualification for Workflow, result, action, recording, and backup surfaces.

All 32 canonical UI Truth scenarios remain individually represented. Supplementary dark variants reuse their semantic assertions but are not counted as additional canonical scenarios. Recorded transitions cover Workflow list→editor, task→promotion review, result→follow-up selection, collaboration control changes, recording lifecycle entry/exit states, and Settings→export outcomes. Geometry assertions require the recording header to remain contained/non-overlapping and the selected-result chip to remain readable.

## Remaining subjective questions

- The Workflow editor is intentionally comprehensive and scrollable. Human review should decide whether future progressive disclosure would improve first-use ease; no fields were hidden or reordered in this fidelity pass.
- Structured results remain above the conversation because they are persistent follow-up material. Human review should confirm that this prominence is preferable to a separately opened result drawer for result-heavy tasks.
- Recording is collapsed while idle and expanded when a recording or recording outcome exists. Human review should confirm that this makes the on-request capability discoverable enough.

## Status

READY_FOR_HUMAN_VISUAL_APPROVAL
`;
await writeFile(join(outputRoot, "audit.md"), report);

async function imageData(path) {
  const bytes = await readFile(path);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

async function makeSheet(filename, columns, rows) {
  const prepared = [];
  for (const row of rows) {
    prepared.push({
      label: row.label,
      cells: await Promise.all(
        row.cells.map(async (cell) => ({
          label: cell.label,
          src: await imageData(cell.path),
        })),
      ),
    });
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 900 },
    });
    await page.setContent(`<!doctype html><style>
      *{box-sizing:border-box} body{margin:0;padding:28px;background:#efefec;color:#20201e;font:14px -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif}
      h1{margin:0 0 22px;font-size:24px;letter-spacing:-.03em}.row{margin:0 0 28px}.row>h2{margin:0 0 10px;font-size:13px;font-weight:650;color:#565653}
      .grid{display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:14px}.cell{overflow:hidden;border:1px solid #d9d9d4;border-radius:14px;background:white;box-shadow:0 8px 24px rgba(0,0,0,.06)}
      .cell h3{margin:0;padding:10px 12px;border-bottom:1px solid #eaeae6;font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.08em;color:#6f6f6b}.cell img{display:block;width:100%;height:auto}
    </style><h1>Rove visual-design evidence</h1>${prepared
      .map(
        (row) =>
          `<section class="row"><h2>${row.label}</h2><div class="grid">${row.cells
            .map(
              (cell) =>
                `<article class="cell"><h3>${cell.label}</h3><img src="${cell.src}"></article>`,
            )
            .join("")}</div></section>`,
      )
      .join("")}`);
    await page.screenshot({ path: join(outputRoot, filename), fullPage: true });
  } finally {
    await browser.close();
  }
}

await makeSheet("reference-current-contact-sheet.png", 3, [
  {
    label: "Task composition",
    cells: [
      {
        label: "Approved reference",
        path: join(referenceRoot, "full-composer.png"),
      },
      {
        label: "Starting candidate",
        path: join(beforeRoot, "ui-truth-t01.png"),
      },
      {
        label: "Corrected candidate",
        path: join(afterRoot, "ui-truth-t01.png"),
      },
    ],
  },
  {
    label: "Workflow navigation → approved sidebar row grammar",
    cells: [
      {
        label: "Approved task navigation",
        path: join(referenceRoot, "full-active-handoff.png"),
      },
      {
        label: "Starting Workflow",
        path: join(beforeRoot, "ui-truth-w01.png"),
      },
      {
        label: "Corrected Workflow",
        path: join(afterRoot, "ui-truth-w01.png"),
      },
    ],
  },
  {
    label: "Structured result → approved conversation/attention hierarchy",
    cells: [
      {
        label: "Approved reference",
        path: join(referenceRoot, "full-active-handoff.png"),
      },
      { label: "Starting result", path: join(beforeRoot, "ui-truth-r01.png") },
      { label: "Corrected result", path: join(afterRoot, "ui-truth-r01.png") },
    ],
  },
  {
    label: "Save to Workflow → unchanged Settings modal grammar",
    cells: [
      {
        label: "Approved Settings sibling",
        path: join(afterRoot, "ui-truth-d03.png"),
      },
      {
        label: "Starting promotion",
        path: join(beforeRoot, "ui-truth-w04.png"),
      },
      {
        label: "Corrected promotion",
        path: join(afterRoot, "ui-truth-w04.png"),
      },
    ],
  },
  {
    label: "Recording → approved right-inspector placement",
    cells: [
      {
        label: "Approved browser inspector",
        path: join(referenceRoot, "full-active-handoff.png"),
      },
      {
        label: "Starting recording",
        path: join(beforeRoot, "ui-truth-v01.png"),
      },
      {
        label: "Corrected recording",
        path: join(afterRoot, "ui-truth-v01.png"),
      },
    ],
  },
]);

await makeSheet("feature-before-after-contact-sheet.png", 2, [
  ...[
    ["Workflow navigation", "w01"],
    ["Save to Workflow", "w04"],
    ["Structured result", "r01"],
    ["Prepared action", "a01"],
    ["Task attention", "t06"],
    ["Capture mode", "c04"],
    ["Active recording", "v01"],
    ["Available recording", "v03"],
    ["Backup/export", "d01"],
  ].map(([label, id]) => ({
    label,
    cells: [
      { label: "Before", path: join(beforeRoot, `ui-truth-${id}.png`) },
      { label: "After", path: join(afterRoot, `ui-truth-${id}.png`) },
    ],
  })),
]);

await makeSheet("interaction-state-contact-sheet.png", 2, [
  {
    label: "Workflow empty-state hover",
    cells: [
      { label: "Default", path: join(afterRoot, "ui-truth-w01.png") },
      { label: "Hover", path: join(afterRoot, "ui-truth-w01-hover.png") },
    ],
  },
  {
    label: "Workflow composer focus",
    cells: [
      { label: "Default", path: join(afterRoot, "ui-truth-t01.png") },
      { label: "Focus", path: join(afterRoot, "ui-truth-t01-focus.png") },
    ],
  },
  {
    label: "Save to Workflow primary focus",
    cells: [
      { label: "Default", path: join(afterRoot, "ui-truth-w04.png") },
      { label: "Focus", path: join(afterRoot, "ui-truth-w04-focus.png") },
    ],
  },
  {
    label: "Recording finalization disabled",
    cells: [
      { label: "Starting", path: join(beforeRoot, "ui-truth-v02.png") },
      { label: "Corrected", path: join(afterRoot, "ui-truth-v02.png") },
    ],
  },
  {
    label: "Signed-out local-operation failure",
    cells: [
      {
        label: "Signed-out local UI",
        path: join(afterRoot, "full-onboarding.png"),
      },
      {
        label: "Contextual Workflow error",
        path: join(afterRoot, "signed-out-local-operation-error.png"),
      },
    ],
  },
]);

await makeSheet("feature-dark-state-contact-sheet.png", 2, [
  ...[
    ["Workflow navigation", "w01"],
    ["Workflow editor", "w03"],
    ["Save to Workflow", "w04"],
    ["Selected result", "r02"],
    ["Prepared action", "a01"],
    ["Available recording", "v03"],
    ["Failed recording", "v04"],
    ["Backup/export", "d01"],
  ].map(([label, id]) => ({
    label,
    cells: [
      { label: "Light", path: join(afterRoot, `ui-truth-${id}.png`) },
      { label: "Dark", path: join(afterRoot, `visual-dark-${id}.png`) },
    ],
  })),
]);

process.stdout.write(
  `${JSON.stringify({
    status: "pass",
    scenarios: candidateManifest.artifacts.filter((entry) =>
      entry.id.startsWith("ui-truth-"),
    ).length,
    outputs: [
      "audit.md",
      "computed-style-comparison.json",
      "reference-provenance.json",
      "reference-current-contact-sheet.png",
      "feature-before-after-contact-sheet.png",
      "interaction-state-contact-sheet.png",
      "feature-dark-state-contact-sheet.png",
    ],
  })}\n`,
);
