import { expectedTargetSchema, structuralScopeSchema } from "@rove/protocol";
import type { ExpectedEffect } from "@rove/protocol";
import { z } from "zod";

const targetStateSchema = z.enum([
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
]);

export const browserOutcomeSchema = z.union([
  z.object({
    kind: z.literal("url"),
    state: z.literal("changed"),
  }),
  z.object({
    kind: z.literal("url"),
    state: z.literal("equals"),
    url: z.string().url(),
  }),
  z.object({
    kind: z.literal("visible_text"),
    state: z.enum(["present", "absent"]),
    text: z.string().min(1).max(5_000),
  }),
  z.object({
    kind: z.literal("target"),
    target: expectedTargetSchema,
    state: targetStateSchema,
  }),
  z.object({
    kind: z.literal("target_location"),
    target: expectedTargetSchema,
    relation: z.enum(["within", "outside"]),
    scope: structuralScopeSchema,
  }),
  z.object({
    kind: z.literal("target_value"),
    target: expectedTargetSchema,
    value: z.union([z.string().max(100_000), z.number().finite()]),
  }),
  z.object({
    kind: z.literal("selection"),
    target: expectedTargetSchema,
    value: z.string().max(5_000),
  }),
  z.object({
    kind: z.literal("target_files"),
    state: z.literal("equals"),
    target: expectedTargetSchema,
    files: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(500),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .min(1)
      .max(100),
  }),
  z.object({
    kind: z.literal("page"),
    state: z.enum(["opened", "closed"]),
  }),
  z.object({
    kind: z.literal("download"),
    filename: z.string().trim().min(1).max(500).optional(),
  }),
]);

export type BrowserOutcome = z.infer<typeof browserOutcomeSchema>;

const targetEffectKinds = {
  present: "target_present",
  absent: "target_absent",
  enabled: "target_enabled",
  disabled: "target_disabled",
  checked: "target_checked",
  unchecked: "target_unchecked",
  focused: "target_focused",
  blurred: "target_blurred",
  expanded: "target_expanded",
  collapsed: "target_collapsed",
  pressed: "target_pressed",
  unpressed: "target_unpressed",
  selected: "target_selected",
  unselected: "target_unselected",
  open: "target_open",
  closed: "target_closed",
} as const;

export function compileBrowserOutcomes(
  outcomes: readonly BrowserOutcome[],
): ExpectedEffect[] {
  return outcomes.map((outcome): ExpectedEffect => {
    switch (outcome.kind) {
      case "url":
        return outcome.state === "changed"
          ? { kind: "url_changed" }
          : { kind: "url_equals", url: outcome.url };
      case "visible_text":
        return outcome.state === "present"
          ? { kind: "text_present", text: outcome.text }
          : { kind: "text_absent", text: outcome.text };
      case "target":
        return {
          kind: targetEffectKinds[outcome.state],
          target: outcome.target,
        };
      case "target_location":
        return outcome.relation === "within"
          ? {
              kind: "target_within_scope",
              target: outcome.target,
              scope: outcome.scope,
            }
          : {
              kind: "target_outside_scope",
              target: outcome.target,
              scope: outcome.scope,
            };
      case "target_value":
        return typeof outcome.value === "number"
          ? {
              kind: "target_numeric_value",
              target: outcome.target,
              value: outcome.value,
            }
          : {
              kind: "target_value",
              target: outcome.target,
              value: outcome.value,
            };
      case "selection":
        return {
          kind: "selected_value",
          target: outcome.target,
          value: outcome.value,
        };
      case "target_files":
        return {
          kind: "target_files",
          target: outcome.target,
          files: outcome.files,
        };
      case "page":
        return outcome.state === "opened"
          ? { kind: "page_opened" }
          : { kind: "page_closed" };
      case "download":
        return {
          kind: "download_completed",
          ...(outcome.filename === undefined
            ? {}
            : { filename: outcome.filename }),
        };
    }
  });
}
