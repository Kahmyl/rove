import { describe, expect, it } from "vitest";

import { LOCAL_PERCEPTION_CASES } from "../corpus/local-corpus.js";
import { GATE6_HELDOUT_CASES } from "./gate6-heldout.js";
import { GATE6_CHALLENGE_B_CASES } from "./gate6-challenge-b.js";

describe("F1 Gate 6 Challenge B definition", () => {
  it("is disjoint from the frozen corpus and Challenge A", () => {
    const prior = new Set([
      ...LOCAL_PERCEPTION_CASES.map((item) => item.id),
      ...GATE6_HELDOUT_CASES.map((item) => item.id),
    ]);

    expect(
      GATE6_CHALLENGE_B_CASES.every(
        (item) => item.id.startsWith("confirm-") && !prior.has(item.id),
      ),
    ).toBe(true);
  });

  it("has unique IDs", () => {
    const ids = GATE6_CHALLENGE_B_CASES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every stable compatibility state", () => {
    const states = new Set(
      GATE6_CHALLENGE_B_CASES.map((item) => item.expectedPrimaryState),
    );

    for (const state of [
      "ready",
      "authentication_required",
      "human_verification",
      "access_restricted",
      "unknown_interstitial",
      "error",
    ]) {
      expect(states.has(state as never)).toBe(true);
    }
  });

  it("contains both false-positive and false-negative semantic pressure", () => {
    expect(
      GATE6_CHALLENGE_B_CASES.filter(
        (item) => item.expectedPrimaryState === "ready",
      ).length,
    ).toBeGreaterThanOrEqual(4);

    expect(
      GATE6_CHALLENGE_B_CASES.filter(
        (item) => item.expectedPrimaryState !== "ready",
      ).length,
    ).toBeGreaterThanOrEqual(10);
  });
});
