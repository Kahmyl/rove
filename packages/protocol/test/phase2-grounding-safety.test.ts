import { describe, expect, it } from "vitest";

import { targetIntentSchema } from "../src/phase2-interaction.js";

describe("Phase 2 target intent safety", () => {
  it("requires at least one grounding constraint", () => {
    expect(targetIntentSchema.safeParse({}).success).toBe(false);

    expect(
      targetIntentSchema.safeParse({
        capability: "activate",
      }).success,
    ).toBe(true);

    expect(
      targetIntentSchema.safeParse({
        text: "Save",
      }).success,
    ).toBe(true);

    expect(
      targetIntentSchema.safeParse({
        scope: {
          kind: "form",
          label: "Billing",
        },
      }).success,
    ).toBe(true);

    expect(
      targetIntentSchema.safeParse({
        frameLabel: "Checkout",
      }).success,
    ).toBe(true);
  });
});
