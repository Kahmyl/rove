import { describe, expect, it } from "vitest";

import { restartDelayMs } from "./restart-policy.js";

describe("restartDelayMs", () => {
  it("uses bounded exponential recovery delays", () => {
    const policy = {
      maxAttempts: 4,
      baseDelayMs: 250,
      maxDelayMs: 1_000,
    };

    expect(restartDelayMs(1, policy)).toBe(250);
    expect(restartDelayMs(2, policy)).toBe(500);
    expect(restartDelayMs(3, policy)).toBe(1_000);
    expect(restartDelayMs(4, policy)).toBe(1_000);
  });

  it("stops after the configured attempt budget", () => {
    expect(restartDelayMs(4)).toBeNull();
    expect(restartDelayMs(0)).toBeNull();
  });
});
