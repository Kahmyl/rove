import { describe, expect, it } from "vitest";

import { GATE6_CHALLENGE_G_CASES } from "./gate6-challenge-g.js";

describe("F1 Gate 6 final independent Challenge G definitions", () => {
  it("contains 16 unique cases arranged as 8 metamorphic pairs", () => {
    expect(GATE6_CHALLENGE_G_CASES).toHaveLength(16);

    const ids = GATE6_CHALLENGE_G_CASES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);

    const pairs = new Map<string, number>();

    for (const item of GATE6_CHALLENGE_G_CASES) {
      pairs.set(item.pair, (pairs.get(item.pair) ?? 0) + 1);
    }

    expect(pairs.size).toBe(8);
    expect([...pairs.values()].every((count) => count === 2)).toBe(true);
  });

  it("is local, deterministic, and confirmatory-only", () => {
    for (const item of GATE6_CHALLENGE_G_CASES) {
      expect(item.id).toMatch(/^confirmg-/);
      expect(item.tags).toContain("confirmatory-g");
      expect(item.tags).toContain("metamorphic");
      expect(item.body).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\//i);
    }
  });

  it("covers the intended final semantic confirmation states", () => {
    const states = new Set(
      GATE6_CHALLENGE_G_CASES.map((item) => item.expectedPrimaryState),
    );

    expect(states).toEqual(
      new Set([
        "ready",
        "authentication_required",
        "human_verification",
        "access_restricted",
        "unknown_interstitial",
      ]),
    );
  });
});
