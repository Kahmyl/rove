import { describe, expect, it } from "vitest";

import { targetIntentSchema } from "../src/verified-interaction.js";

describe("target intent safety", () => {
  it("requires at least one grounding constraint", () => {
    expect(targetIntentSchema.safeParse({}).success).toBe(false);

    expect(
      targetIntentSchema.safeParse({
        kind: "link",
      }).success,
    ).toBe(true);

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

  it("rejects unknown exact target kinds", () => {
    expect(targetIntentSchema.safeParse({ kind: "email-row" }).success).toBe(
      false,
    );
  });
});
