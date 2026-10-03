import { describe, expect, it, vi } from "vitest";

import {
  RUNTIME_CONFIGURATION_WARNING,
  runContainedRuntimeProbe,
  withRuntimeDependencyWarning,
} from "./runtime-failure-containment.js";

describe("Runtime failure containment", () => {
  const degraded = {
    state: "degraded" as const,
    classification: "permanent_configuration" as const,
    code: "INVALID_CONFIGURATION",
    retryable: false,
    firstFailureAt: 1_000,
    lastFailureAt: 1_000,
    nextProbeAt: 31_000,
    failureCount: 1,
  };

  it("skips closed-circuit monitor ticks and contains probe and publication rejection", async () => {
    const probe = vi.fn(async () => {
      throw new Error("Runtime unavailable");
    });
    const publish = vi.fn(async () => {
      throw new Error("surface unavailable");
    });

    await expect(
      runContainedRuntimeProbe({
        health: degraded,
        now: 2_000,
        probe,
        onFailure: publish,
      }),
    ).resolves.toBe("skipped");
    expect(probe).not.toHaveBeenCalled();

    await expect(
      runContainedRuntimeProbe({
        health: degraded,
        now: 31_000,
        probe,
        onFailure: publish,
      }),
    ).resolves.toBe("failed");
    expect(probe).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("projects one customer-safe state and removes it after recovery", () => {
    const product = {
      recoveryWarnings: ["Retained warning", RUNTIME_CONFIGURATION_WARNING],
    } as never;
    const contained = withRuntimeDependencyWarning(product, degraded)!;
    expect(contained.recoveryWarnings).toEqual([
      "Retained warning",
      RUNTIME_CONFIGURATION_WARNING,
    ]);
    expect(
      withRuntimeDependencyWarning(contained, { state: "ready" })!
        .recoveryWarnings,
    ).toEqual(["Retained warning"]);
  });
});
