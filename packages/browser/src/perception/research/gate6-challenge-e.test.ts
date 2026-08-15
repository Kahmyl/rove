import { describe, expect, it } from "vitest";

import { GATE6_CHALLENGE_E_CASES } from "./gate6-challenge-e.js";

describe("F1 Gate 6 independent Challenge E definitions", () => {
  it("contains 24 fresh unique cases arranged as 12 metamorphic pairs", () => {
    expect(GATE6_CHALLENGE_E_CASES).toHaveLength(24);

    const ids = GATE6_CHALLENGE_E_CASES.map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);

    const pairCounts = new Map<string, number>();

    for (const item of GATE6_CHALLENGE_E_CASES) {
      pairCounts.set(item.pair, (pairCounts.get(item.pair) ?? 0) + 1);
    }

    expect(pairCounts.size).toBe(12);
    expect([...pairCounts.values()].every((count) => count === 2)).toBe(true);
  });

  it("is deterministic, local, and tagged as confirmatory E", () => {
    for (const item of GATE6_CHALLENGE_E_CASES) {
      expect(item.id).toMatch(/^confirme-/);
      expect(item.tags).toContain("confirmatory-e");
      expect(item.tags).toContain("metamorphic");
      expect(item.description.length).toBeGreaterThan(30);
      expect(item.body).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\//i);
    }
  });

  it("covers the stable blocker and compatibility states needed for confirmation", () => {
    const states = new Set(
      GATE6_CHALLENGE_E_CASES.map((item) => item.expectedPrimaryState),
    );

    expect(states).toEqual(
      new Set([
        "ready",
        "authentication_required",
        "human_verification",
        "access_restricted",
        "unknown_interstitial",
        "error",
      ]),
    );
  });
});
