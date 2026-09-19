import { describe, expect, it } from "vitest";

import {
  browserOutcomeSchema,
  compileBrowserOutcomes,
} from "./browser-outcome.js";

describe("browser outcome compiler", () => {
  it("compiles create and scoped-move intents without model verifier vocabulary", () => {
    expect(
      compileBrowserOutcomes([
        browserOutcomeSchema.parse({
          kind: "target",
          target: { name: "Project Alpha" },
          state: "present",
        }),
        browserOutcomeSchema.parse({
          kind: "target_location",
          target: { name: "Quarterly report" },
          relation: "within",
          scope: { kind: "region", label: "Archive" },
        }),
      ]),
    ).toEqual([
      { kind: "target_present", target: { name: "Project Alpha" } },
      {
        kind: "target_within_scope",
        target: { name: "Quarterly report" },
        scope: { kind: "region", label: "Archive" },
      },
    ]);
  });

  it("compiles every semantic outcome family to Runtime effects", () => {
    const target = { name: "Publish", kind: "button" as const };
    const digest = "a".repeat(64);
    const outcomes = [
      { kind: "url", state: "changed" },
      { kind: "url", state: "equals", url: "https://example.test/done" },
      { kind: "visible_text", state: "present", text: "Saved" },
      { kind: "visible_text", state: "absent", text: "Draft" },
      {
        kind: "target_location",
        target,
        relation: "within",
        scope: { kind: "dialog", label: "Published" },
      },
      {
        kind: "target_location",
        target,
        relation: "outside",
        scope: { kind: "dialog", label: "Draft" },
      },
      { kind: "target_value", target, value: "final" },
      { kind: "target_value", target, value: 3 },
      { kind: "selection", target, value: "Public" },
      {
        kind: "target_files",
        state: "equals",
        target,
        files: [{ name: "report.pdf", sha256: digest }],
      },
      { kind: "page", state: "opened" },
      { kind: "page", state: "closed" },
      { kind: "download" },
      { kind: "download", filename: "report.pdf" },
    ].map((outcome) => browserOutcomeSchema.parse(outcome));

    expect(compileBrowserOutcomes(outcomes)).toEqual([
      { kind: "url_changed" },
      { kind: "url_equals", url: "https://example.test/done" },
      { kind: "text_present", text: "Saved" },
      { kind: "text_absent", text: "Draft" },
      {
        kind: "target_within_scope",
        target,
        scope: { kind: "dialog", label: "Published" },
      },
      {
        kind: "target_outside_scope",
        target,
        scope: { kind: "dialog", label: "Draft" },
      },
      { kind: "target_value", target, value: "final" },
      { kind: "target_numeric_value", target, value: 3 },
      { kind: "selected_value", target, value: "Public" },
      {
        kind: "target_files",
        target,
        files: [{ name: "report.pdf", sha256: digest }],
      },
      { kind: "page_opened" },
      { kind: "page_closed" },
      { kind: "download_completed" },
      { kind: "download_completed", filename: "report.pdf" },
    ]);
  });

  it("compiles every target state without changing its semantic target", () => {
    const target = { name: "Newsletter", kind: "checkbox" as const };
    const states = [
      "present",
      "absent",
      "enabled",
      "disabled",
      "checked",
      "unchecked",
      "focused",
      "blurred",
      "expanded",
      "collapsed",
      "pressed",
      "unpressed",
      "selected",
      "unselected",
      "open",
      "closed",
    ] as const;

    const compiled = states.flatMap((state) =>
      compileBrowserOutcomes([
        browserOutcomeSchema.parse({ kind: "target", target, state }),
      ]),
    );

    expect(compiled.map((effect) => effect.kind)).toEqual(
      states.map((state) => `target_${state}`),
    );
    expect(compiled.every((effect) => "target" in effect)).toBe(true);
  });
});
