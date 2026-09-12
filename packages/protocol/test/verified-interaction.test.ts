import { describe, expect, it } from "vitest";

import {
  browserInteractionRequestSchema,
  targetResolutionRequestSchema,
  verifiedInteractionRequestSchema,
  expectedEffectSchema,
} from "../src/index.js";

describe("interaction contracts", () => {
  it("requires a stable consequence key for consequential requests", () => {
    expect(
      verifiedInteractionRequestSchema.safeParse({
        consequential: true,
        action: {
          kind: "click",
          target: {
            pageId: "page_01",
            revision: 1,
            ref: "t1",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      verifiedInteractionRequestSchema.safeParse({
        observationId: "bobs_current",
        action: { kind: "press", key: "Enter" },
        expectedEffects: [{ kind: "download_completed" }],
      }).success,
    ).toBe(false);
  });

  it("accepts neutral grounding intent without numeric scoring fields", () => {
    expect(
      targetResolutionRequestSchema.parse({
        observationId: "bobs_current",
        intent: {
          capability: "activate",
          text: "Save",
          scope: {
            kind: "form",
            label: "Billing address",
          },
        },
      }),
    ).toEqual({
      observationId: "bobs_current",
      intent: {
        capability: "activate",
        text: "Save",
        scope: {
          kind: "form",
          label: "Billing address",
        },
      },
    });
  });

  it("requires an observation authority for verified interaction", () => {
    expect(
      verifiedInteractionRequestSchema.safeParse({
        action: {
          kind: "click",
          target: {
            pageId: "page_01",
            revision: 1,
            ref: "t1",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("requires external and irreversible effects to be consequential", () => {
    for (const effect of ["external_commit", "irreversible"] as const) {
      expect(
        verifiedInteractionRequestSchema.safeParse({
          observationId: "bobs_current",
          effect,
          action: {
            kind: "click",
            target: {
              pageId: "page_01",
              revision: 1,
              ref: "t1",
            },
          },
        }).success,
      ).toBe(false);
    }
  });

  it("requires exactly one single- or multi-file evidence form", () => {
    const target = { pageId: "page_01", revision: 1, ref: "t1" };
    expect(
      browserInteractionRequestSchema.safeParse({ kind: "upload", target })
        .success,
    ).toBe(false);
    expect(
      browserInteractionRequestSchema.safeParse({
        kind: "upload",
        target,
        evidenceId: "ev_one",
        evidenceIds: ["ev_two"],
      }).success,
    ).toBe(false);
    expect(
      browserInteractionRequestSchema.safeParse({
        kind: "upload",
        target,
        evidenceIds: ["ev_one", "ev_two"],
      }).success,
    ).toBe(true);
  });

  it("accepts only the canonical download completion effect and bounded filename", () => {
    expect(
      expectedEffectSchema.parse({
        kind: "download_completed",
        filename: "report.pdf",
      }),
    ).toEqual({ kind: "download_completed", filename: "report.pdf" });
    expect(expectedEffectSchema.safeParse({ kind: "downloaded" }).success).toBe(
      false,
    );
    expect(
      expectedEffectSchema.safeParse({
        kind: "download_completed",
        filename: "",
      }).success,
    ).toBe(false);
    expect(
      verifiedInteractionRequestSchema.safeParse({
        observationId: "bobs_current",
        action: {
          kind: "click",
          target: { pageId: "page_01", revision: 1, ref: "t1" },
        },
        expectedEffects: [
          { kind: "download_completed" },
          { kind: "download_completed", filename: "second.pdf" },
        ],
      }).success,
    ).toBe(false);
  });
});
