import { describe, expect, it } from "vitest";

import {
  targetResolutionRequestSchema,
  verifiedInteractionRequestSchema,
} from "../src/index.js";

describe("Phase 2 interaction contracts", () => {
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
});
