import { describe, expect, it } from "vitest";

import { GATE6_CHALLENGE_F_CASES } from "./gate6-challenge-f.js";

describe("F1 Gate 6 independent Challenge F definitions", () => {
  it("contains 20 unique cases arranged as 10 metamorphic pairs", () => {
    expect(GATE6_CHALLENGE_F_CASES).toHaveLength(20);

    const ids = GATE6_CHALLENGE_F_CASES.map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);

    const pairs = new Map<string, number>();

    for (const item of GATE6_CHALLENGE_F_CASES) {
      pairs.set(item.pair, (pairs.get(item.pair) ?? 0) + 1);
    }

    expect(pairs.size).toBe(10);
    expect([...pairs.values()].every((count) => count === 2)).toBe(true);
  });

  it("is local, deterministic, and confirmatory-only", () => {
    for (const item of GATE6_CHALLENGE_F_CASES) {
      expect(item.id).toMatch(/^confirmf-/);
      expect(item.tags).toContain("confirmatory-f");
      expect(item.tags).toContain("metamorphic");
      expect(item.body).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\//i);
    }
  });

  it("covers all stable compatibility states needed by the final semantic confirmation", () => {
    const states = new Set(
      GATE6_CHALLENGE_F_CASES.map((item) => item.expectedPrimaryState),
    );

    expect(states).toEqual(
      new Set([
        "ready",
        "authentication_required",
        "human_verification",
        "access_restricted",
      ]),
    );
  });
});
