import { describe, expect, it } from "vitest";

import { GATE6_CHALLENGE_H_CASES } from "./gate6-challenge-h.js";

describe("F1 Gate 6 final independent Challenge H definitions", () => {
  it("contains 18 unique cases arranged as 9 metamorphic pairs", () => {
    expect(GATE6_CHALLENGE_H_CASES).toHaveLength(18);

    const ids = GATE6_CHALLENGE_H_CASES.map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);

    const pairs = new Map<string, number>();

    for (const item of GATE6_CHALLENGE_H_CASES) {
      pairs.set(item.pair, (pairs.get(item.pair) ?? 0) + 1);
    }

    expect(pairs.size).toBe(9);
    expect([...pairs.values()].every((count) => count === 2)).toBe(true);
  });

  it("is local, deterministic, and authored as confirmatory-only evidence", () => {
    for (const item of GATE6_CHALLENGE_H_CASES) {
      expect(item.id).toMatch(/^confirmh-/);
      expect(item.tags).toContain("confirmatory-h");
      expect(item.tags).toContain("metamorphic");

      expect(item.body).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\//i);
    }
  });

  it("covers ownership, presentation, ordinal mapping, and frozen precedence", () => {
    const tags = new Set(GATE6_CHALLENGE_H_CASES.flatMap((item) => item.tags));

    expect(tags).toContain("frame-ownership");
    expect(tags).toContain("presentation");
    expect(tags).toContain("ordinal-mapping");
    expect(tags).toContain("precedence");
  });
});
