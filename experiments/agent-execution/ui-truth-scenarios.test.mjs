import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIRED_UI_TRUTH_SCENARIO_IDS,
  UI_TRUTH_SCENARIO_BY_ID,
  UI_TRUTH_SCENARIOS,
  UI_TRUTH_VIEWPORTS,
} from "./ui-truth-scenarios.mjs";

test("UI Truth catalog contains every required first-pass scenario exactly once", () => {
  assert.equal(
    new Set(UI_TRUTH_SCENARIOS.map((scenario) => scenario.id)).size,
    UI_TRUTH_SCENARIOS.length,
    "scenario IDs must be unique",
  );

  assert.deepEqual(
    [...UI_TRUTH_SCENARIOS.map((scenario) => scenario.id)].sort(),
    [...REQUIRED_UI_TRUTH_SCENARIO_IDS].sort(),
  );

  for (const id of REQUIRED_UI_TRUTH_SCENARIO_IDS) {
    assert.ok(UI_TRUTH_SCENARIO_BY_ID.has(id), `missing scenario ${id}`);
  }
});

test("every scenario records positive and negative truth evidence", () => {
  const allowedCategories = new Set([
    "tasks",
    "workflows",
    "results",
    "collaboration",
    "recording",
    "data-management",
  ]);

  for (const scenario of UI_TRUTH_SCENARIOS) {
    assert.match(scenario.id, /^(?:T|W|R|A|B|C|V|D)\d{2}$/);
    assert.ok(scenario.name.length > 0, `${scenario.id}: missing name`);
    assert.ok(
      allowedCategories.has(scenario.category),
      `${scenario.id}: invalid category`,
    );
    assert.ok(
      scenario.fixture.length > 0,
      `${scenario.id}: missing fixture key`,
    );
    assert.ok(
      scenario.applicationTruth.length > 0,
      `${scenario.id}: missing application truth`,
    );
    assert.ok(
      scenario.rendererTruth.length > 0,
      `${scenario.id}: missing renderer truth`,
    );
    assert.ok(
      scenario.semanticAssertions.length > 0,
      `${scenario.id}: missing semantic assertions`,
    );
    assert.ok(
      scenario.negativeAssertions.length > 0,
      `${scenario.id}: negative assertions are first-class evidence`,
    );
    assert.ok(
      scenario.viewports.length > 0,
      `${scenario.id}: missing viewport`,
    );

    for (const viewportName of scenario.viewports) {
      assert.ok(
        Object.hasOwn(UI_TRUTH_VIEWPORTS, viewportName),
        `${scenario.id}: unknown viewport ${viewportName}`,
      );
    }

    assert.equal(typeof scenario.screenshot, "boolean");
    assert.equal(typeof scenario.trace, "boolean");
  }
});

test("catalog preserves critical non-collapsible product boundaries", () => {
  assert.match(
    UI_TRUTH_SCENARIO_BY_ID.get("T03").negativeAssertions.join(" "),
    /permanently closes/i,
  );
  assert.match(
    UI_TRUTH_SCENARIO_BY_ID.get("T07").negativeAssertions.join(" "),
    /execution|browser ownership/i,
  );
  assert.match(
    UI_TRUTH_SCENARIO_BY_ID.get("A02").negativeAssertions.join(" "),
    /dispatch|confirmation/i,
  );
  assert.match(
    UI_TRUTH_SCENARIO_BY_ID.get("A03").negativeAssertions.join(" "),
    /success|confirmation/i,
  );
  assert.match(
    UI_TRUTH_SCENARIO_BY_ID.get("A05").negativeAssertions.join(" "),
    /retry/i,
  );
  assert.match(
    UI_TRUTH_SCENARIO_BY_ID.get("B01").negativeAssertions.join(" "),
    /task failure/i,
  );
  assert.match(
    UI_TRUTH_SCENARIO_BY_ID.get("V02").negativeAssertions.join(" "),
    /playable|saved/i,
  );
  assert.match(
    UI_TRUTH_SCENARIO_BY_ID.get("V01").negativeAssertions.join(" "),
    /browser-window recording/i,
  );
  assert.match(
    UI_TRUTH_SCENARIO_BY_ID.get("D03").negativeAssertions.join(" "),
    /Restore/i,
  );
});

test("catalog retains the existing normal and follower viewport conventions", () => {
  assert.deepEqual(UI_TRUTH_VIEWPORTS.product, {
    width: 1180,
    height: 780,
  });
  assert.deepEqual(UI_TRUTH_VIEWPORTS.followerMicro, {
    width: 64,
    height: 56,
  });
  assert.deepEqual(UI_TRUTH_VIEWPORTS.followerExpanded, {
    width: 360,
    height: 240,
  });
  assert.deepEqual(UI_TRUTH_VIEWPORTS.followerLarge, {
    width: 760,
    height: 420,
  });
});
