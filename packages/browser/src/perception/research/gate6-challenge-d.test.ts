import { describe, expect, it } from "vitest";

import {
  GATE6_CHALLENGE_D_CASES,
  challengeDDisposition,
} from "./gate6-challenge-d.js";

describe("F1 Gate 6 independent Challenge D definitions", () => {
  it("contains 20 unique post-S4R3 confirmatory cases", () => {
    expect(GATE6_CHALLENGE_D_CASES).toHaveLength(20);
    expect(new Set(GATE6_CHALLENGE_D_CASES.map((item) => item.id)).size).toBe(
      20,
    );
  });

  it("keeps every case deterministic and locally renderable", () => {
    for (const item of GATE6_CHALLENGE_D_CASES) {
      expect(item.id).toMatch(/^confirmd-/);
      expect(item.body).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\//i);
      expect(item.description.length).toBeGreaterThan(20);
      expect(item.tags).toContain("confirmatory-d");
    }
  });

  it("covers all stable compatibility states relevant to confirmation", () => {
    const states = new Set(
      GATE6_CHALLENGE_D_CASES.map((item) => item.expectedPrimaryState),
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

  it("derives the expected compatibility disposition consistently", () => {
    for (const item of GATE6_CHALLENGE_D_CASES) {
      expect(challengeDDisposition(item.expectedPrimaryState)).toMatch(
        /^(?:continue|wait_and_inspect|request_human|stop)$/,
      );
    }
  });
});
