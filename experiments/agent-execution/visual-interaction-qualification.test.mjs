import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  catalog,
  requiredCells,
  sha256,
  validateMatrix,
  validateReview,
  verifyReport,
} from "./visual-interaction-qualification.mjs";

function capture(cell) {
  return {
    file: cell.file,
    geometry: {
      viewport: [cell.width, cell.height],
      reducedMotion: cell.motion === "reduced",
      documentWidth: cell.width,
      main: { width: 740 },
      textContrast: 10,
      mutedContrast: 6,
      notifications: [],
      dockMode: "decision",
      decisionActions: [
        {
          label: "Decline",
          disabled: cell.state.includes("submitting"),
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          textContrast: 8,
          descriptionContrast: 5,
        },
      ],
    },
    pointerEvidence: { pointerEvents: "none", ariaHidden: "true" },
  };
}

test("complete Cartesian matrix cannot substitute another input or motion setting", () => {
  assert.equal(requiredCells("composition").length, 512);
  assert.equal(requiredCells("decisions").length, 448);
  const values = requiredCells("composition").map(capture);
  assert.equal(validateMatrix("composition", values).length, 512);
  assert.throws(
    () => validateMatrix("composition", values.slice(1)),
    /Missing mandatory cell/,
  );
  values[0].geometry.reducedMotion = true;
  assert.throws(() => validateMatrix("composition", values), /actual motion/);
});

test("a reachable decision with unreadable or absent refusal fails qualification", () => {
  const values = requiredCells("decisions").map(capture);
  validateMatrix("decisions", values);
  const command = values.find((value) =>
    value.file.includes("-command-pending"),
  );
  command.geometry.decisionActions[0].label = "Approve once";
  assert.throws(() => validateMatrix("decisions", values), /offered refusal/);
  command.geometry.decisionActions[0].label = "Decline";
  command.geometry.decisionActions[0].descriptionContrast = 2;
  assert.throws(
    () => validateMatrix("decisions", values),
    /action\/consequence contrast/,
  );
});

test("disabled submission and non-intercepting evidence remain independent requirements", () => {
  const values = requiredCells("decisions").map(capture);
  values.find((value) =>
    value.file.includes("-submitting-pointer"),
  ).geometry.decisionActions[0].disabled = false;
  assert.throws(() => validateMatrix("decisions", values), /remain disabled/);
  const composition = requiredCells("composition").map(capture);
  composition[0].pointerEvidence.pointerEvents = "auto";
  assert.throws(
    () => validateMatrix("composition", composition),
    /intercept input/,
  );
});

test("functional evidence cannot stand in for a current attributed visual judgment", () => {
  const review = {
    reviewer: "Codex",
    bundleSha256: "current",
    judgments: catalog.rubric.map((rule) => ({
      criterion: rule.id,
      result: "pass",
      observation: "The owning composition remains readable and stable.",
      witnesses: ["capture"],
    })),
  };
  validateReview(review, "current", new Map([["capture", {}]]));
  assert.throws(
    () => validateReview(review, "replacement", new Map([["capture", {}]])),
    /another evidence bundle/,
  );
  review.judgments[0].result = "fail";
  assert.throws(
    () => validateReview(review, "current", new Map([["capture", {}]])),
    /Unresolved visual criterion/,
  );
});

test("source and screenshot hash linkage refuses modified artifacts", async () => {
  const home = await mkdtemp(join(tmpdir(), "rove-visual-checks-"));
  try {
    await writeFile(join(home, "source.js"), "qualified");
    await writeFile(join(home, "cell.png"), "pixels");
    const report = {
      errors: [],
      sourceFiles: { "source.js": sha256("qualified") },
      captures: [{ file: "cell.png", sha256: sha256("pixels") }],
    };
    const path = join(home, "report.json");
    await writeFile(path, JSON.stringify(report));
    await verifyReport(path, home);
    await writeFile(join(home, "cell.png"), "different pixels");
    await assert.rejects(verifyReport(path, home), /Changed capture/);
    await writeFile(join(home, "cell.png"), "pixels");
    await writeFile(join(home, "source.js"), "different source");
    await assert.rejects(verifyReport(path, home), /Changed source/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
