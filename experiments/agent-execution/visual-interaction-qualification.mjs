#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const root = resolve(import.meta.dirname, "../..");
export const catalog = JSON.parse(
  await readFile(
    join(root, "tests/fixtures/product-visual-qualification.json"),
    "utf8",
  ),
);
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export function requiredCells(kind) {
  assert.ok(["composition", "decisions"].includes(kind));
  const cells = [];
  for (const theme of catalog.themes)
    for (const [width, height] of catalog.viewports)
      for (const motion of catalog.motion)
        for (const input of catalog.input)
          for (const scenario of kind === "composition"
            ? catalog.composition
            : catalog.decisionFamilies)
            for (const state of kind === "composition"
              ? ["closed", "inspector"]
              : [
                  "pending-keyboard",
                  "submitting-pointer",
                  "resolved",
                  `actual-${input}-submitting`,
                ])
              cells.push({
                theme,
                width,
                height,
                motion,
                input,
                scenario,
                state,
                file: `${theme}-${width}-${motion}-${input}-${scenario}-${state}.png`,
              });
  return cells;
}

export function validateMatrix(kind, captures) {
  const byName = new Map(captures.map((capture) => [capture.file, capture]));
  assert.equal(byName.size, captures.length, "Duplicate capture identity");
  const cells = requiredCells(kind);
  for (const cell of cells) {
    const capture = byName.get(cell.file);
    assert.ok(capture, `Missing mandatory cell ${kind}/${cell.file}`);
    const { geometry: g, pointerEvidence: pointer } = capture;
    assert.deepEqual(
      g.viewport,
      [cell.width, cell.height],
      `${cell.file}: actual viewport`,
    );
    assert.equal(
      g.reducedMotion,
      cell.motion === "reduced",
      `${cell.file}: actual motion`,
    );
    assert.equal(
      g.documentWidth,
      cell.width,
      `${cell.file}: horizontal containment`,
    );
    assert.ok(
      g.main.width - 48 >= 680,
      `${cell.file}: primary work allocation`,
    );
    assert.ok(
      g.textContrast >= 4.5 && g.mutedContrast >= 4.5,
      `${cell.file}: theme contrast`,
    );
    assert.equal(
      pointer?.pointerEvents,
      "none",
      `${cell.file}: evidence must not intercept input`,
    );
    assert.equal(
      pointer?.ariaHidden,
      "true",
      `${cell.file}: evidence must not enter accessibility tree`,
    );
    if (kind === "composition" && cell.state === "inspector")
      assert.equal(
        g.notifications.length,
        0,
        `${cell.file}: modal drawer hides announcements`,
      );
    if (kind === "decisions" && cell.state !== "resolved") {
      assert.equal(
        g.dockMode,
        "decision",
        `${cell.file}: single decision dock`,
      );
      assert.ok(
        g.decisionActions.length > 0,
        `${cell.file}: offered actions retained`,
      );
      if (cell.scenario !== "user")
        assert.ok(
          g.decisionActions.some((action) =>
            /Decline|Deny|Cancel/.test(action.label),
          ),
          `${cell.file}: offered refusal discoverable`,
        );
      for (const action of g.decisionActions) {
        assert.ok(
          action.textContrast >= 4.5 &&
            (action.descriptionContrast === null ||
              action.descriptionContrast >= 4.5),
          `${cell.file}: actual action/consequence contrast`,
        );
        assert.ok(
          action.x >= 0 &&
            action.y >= 0 &&
            action.x + action.width <= cell.width &&
            action.y + action.height <= cell.height,
          `${cell.file}: action bounds`,
        );
        if (cell.state.includes("submitting"))
          assert.equal(
            action.disabled,
            true,
            `${cell.file}: submitting actions remain disabled`,
          );
      }
    }
  }
  return cells;
}

export async function verifyReport(path, sourceRoot = root) {
  const bytes = await readFile(path);
  const report = JSON.parse(bytes);
  assert.deepEqual(report.errors, [], `${path}: renderer errors`);
  assert.ok(report.captures.length > 0, `${path}: no captures`);
  for (const [file, digest] of Object.entries({
    ...report.sourceFiles,
    ...report.compiledFiles,
  })) {
    const target = resolve(sourceRoot, file);
    assert.ok(
      target.startsWith(`${resolve(sourceRoot)}/`),
      "Fingerprint outside source root",
    );
    assert.equal(
      sha256(await readFile(target)),
      digest,
      `Changed source/artifact ${file}`,
    );
  }
  for (const capture of report.captures) {
    assert.equal(
      basename(capture.file),
      capture.file,
      "Capture must stay inside its report directory",
    );
    assert.equal(
      sha256(await readFile(join(dirname(path), capture.file))),
      capture.sha256,
      `Changed capture ${capture.file}`,
    );
  }
  if (report.matrixSha256)
    assert.equal(
      sha256(await readFile(join(dirname(path), "matrix.json"))),
      report.matrixSha256,
      "Changed matrix checksum",
    );
  return { path: resolve(path), sha256: sha256(bytes), report };
}

export function validateReview(review, bundleHash, witnesses) {
  assert.equal(
    review.bundleSha256,
    bundleHash,
    "Visual review belongs to another evidence bundle",
  );
  assert.equal(
    review.reviewer,
    "Codex",
    "Machine review attribution is required",
  );
  const ids = new Set(review.judgments.map((judgment) => judgment.criterion));
  assert.equal(
    ids.size,
    catalog.rubric.length,
    "Every composition criterion needs a distinct judgment",
  );
  for (const criterion of catalog.rubric) {
    const judgment = review.judgments.find(
      (entry) => entry.criterion === criterion.id,
    );
    assert.equal(
      judgment?.result,
      "pass",
      `Unresolved visual criterion ${criterion.id}`,
    );
    assert.ok(
      judgment.observation?.length >= 20,
      `${criterion.id}: explain observed composition`,
    );
    assert.ok(
      judgment.witnesses?.length > 0,
      `${criterion.id}: no retained visual witness`,
    );
    for (const id of judgment.witnesses)
      assert.ok(witnesses.has(id), `Unknown visual witness ${id}`);
  }
}

const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");

export async function assembleQualification(paths, output, reviewPath) {
  const reports = {};
  for (const kind of ["composition", "decisions", "browser", "notifications"]) {
    assert.ok(paths[kind], `Missing ${kind} specialist report`);
    reports[kind] = await verifyReport(paths[kind]);
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  for (const witness of Object.values(reports))
    assert.equal(
      witness.report.sourceHead,
      head,
      "Report must use the accepted source checkpoint",
    );
  const mandatory = [
    ...validateMatrix("composition", reports.composition.report.captures).map(
      (cell) => ({ ...cell, kind: "composition" }),
    ),
    ...validateMatrix("decisions", reports.decisions.report.captures).map(
      (cell) => ({ ...cell, kind: "decisions" }),
    ),
  ];
  const linkage = Object.fromEntries(
    Object.entries(reports).map(([kind, witness]) => [
      kind,
      { path: witness.path, sha256: witness.sha256 },
    ]),
  );
  const bundleSha256 = sha256(JSON.stringify(linkage));
  const witnesses = new Map();
  for (const [kind, witness] of Object.entries(reports))
    for (const capture of witness.report.captures)
      witnesses.set(`${kind}/${capture.file}`, {
        ...capture,
        kind,
        directory: dirname(witness.path),
      });
  await mkdir(output, { recursive: true });
  const stateProvenance = {};
  for (const [kind, witness] of Object.entries(reports)) {
    const path = join(
      dirname(witness.path),
      "production-projection-scenarios.json",
    );
    stateProvenance[kind] = {
      path,
      sha256: sha256(await readFile(path)),
      authority:
        "Deterministic fixture snapshot using owning production projection; no live provider observation",
    };
  }
  for (const witness of witnesses.values())
    witness.domSha256 = sha256(
      await readFile(
        join(witness.directory, witness.file.replace(/\.png$/, ".html")),
      ),
    );
  const matrix = mandatory.map((cell) => {
    const witness = witnesses.get(`${cell.kind}/${cell.file}`),
      g = witness.geometry;
    return {
      ...cell,
      expected: catalog.rubric.map((rule) => rule.id),
      provenance: {
        scenario: `${cell.kind === "composition" ? "composition" : "decision"}_${cell.scenario}`,
        ...stateProvenance[cell.kind],
      },
      observed: {
        result:
          "Functional/geometry/contrast/focus assertions passed; visual judgments separately linked",
        viewport: g.viewport,
        dockMode: g.dockMode,
        bodyContrast: g.textContrast,
        secondaryContrast: g.mutedContrast,
        reducedMotion: g.reducedMotion,
        focus: g.focus,
        decisionActions: g.decisionActions,
        markers: g.markers ?? [],
      },
      witness: `${cell.kind}/${cell.file}`,
      sha256: witness.sha256,
      domSha256: witness.domSha256,
    };
  });
  await writeFile(join(output, "matrix.json"), JSON.stringify(matrix, null, 2));
  const cards = [...witnesses.entries()]
    .map(
      ([id, capture]) =>
        `<figure><a href="${escape(join(capture.directory, capture.file))}"><img loading="lazy" src="${escape(join(capture.directory, capture.file))}" alt="${escape(id)}"></a><figcaption>${escape(id)}</figcaption></figure>`,
    )
    .join("\n");
  await writeFile(
    join(output, "contact-sheet.html"),
    `<!doctype html><html><meta charset="utf-8"><title>Rove visual interaction evidence</title><style>body{font:14px system-ui;margin:24px;background:#f7f7f4;color:#20201e}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:20px}figure{margin:0}img{width:100%;height:auto}figcaption{overflow-wrap:anywhere;padding:8px}h1{font-size:24px}</style><h1>Machine qualification evidence</h1><p>Bundle ${bundleSha256}. Click any retained capture for full resolution. Functional checks and composition judgments are separate; final human acceptance remains unqualified.</p><main>${cards}</main></html>`,
  );
  let review = null;
  if (reviewPath) {
    review = JSON.parse(await readFile(reviewPath, "utf8"));
    validateReview(review, bundleSha256, witnesses);
    await writeFile(
      join(output, "visual-review.json"),
      JSON.stringify(review, null, 2),
    );
  }
  const sources = {};
  for (const file of [
    "tests/fixtures/product-visual-qualification.json",
    "experiments/agent-execution/visual-interaction-qualification.mjs",
    "experiments/agent-execution/rendered-evidence-pointer.mjs",
    "pnpm-lock.yaml",
  ])
    sources[file] = sha256(await readFile(join(root, file)));
  const result = {
    sourceHead: head,
    sourceFiles: sources,
    runtime: reports.composition.report.runtime,
    status: review
      ? "Remediation machine qualification complete; candidate ready for final human-recorded acceptance."
      : "Visual review pending; not qualified",
    bundleSha256,
    reports: linkage,
    mandatoryCells: mandatory.length,
    captures: witnesses.size,
    matrixSha256: sha256(await readFile(join(output, "matrix.json"))),
    contactSheetSha256: sha256(
      await readFile(join(output, "contact-sheet.html")),
    ),
    visualReviewSha256: review
      ? sha256(await readFile(join(output, "visual-review.json")))
      : null,
    stateProvenance,
    rubric: catalog.rubric,
    supplementalCoverage: catalog.supplementalCoverage,
    unqualified: catalog.unqualified,
  };
  await writeFile(join(output, "report.json"), JSON.stringify(result, null, 2));
  return result;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const paths = {};
  let output, review;
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].replace(/^--/, "");
    if (key === "output") output = args[index + 1];
    else if (key === "review") review = args[index + 1];
    else {
      assert.ok(
        ["composition", "decisions", "browser", "notifications"].includes(key),
        `Unknown argument ${key}`,
      );
      paths[key] = args[index + 1];
    }
  }
  assert.ok(
    output,
    "Pass --output and all four --composition/decisions/browser/notifications reports",
  );
  const result = await assembleQualification(paths, resolve(output), review);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
