import { afterEach, describe, expect, it, vi } from "vitest";

import {
  managedOwnerProcessId,
  startManagedOwnerLivenessMonitor,
} from "./managed-owner-liveness.js";

describe("managed Runtime owner liveness", () => {
  afterEach(() => vi.useRealTimers());

  it("requires a valid spawn-time owner for a managed Runtime", () => {
    expect(managedOwnerProcessId(undefined, undefined)).toBeUndefined();
    expect(managedOwnerProcessId("runtime_a", "41")).toBe(41);
    expect(() => managedOwnerProcessId("runtime_a", undefined)).toThrow(
      /owner process ID is invalid/,
    );
  });

  it("does not monitor an independently started Runtime", async () => {
    vi.useFakeTimers();
    const terminate = vi.fn();
    startManagedOwnerLivenessMonitor({ managed: false, terminate });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(terminate).not.toHaveBeenCalled();
  });

  it("terminates exactly once after the managed Runtime is re-parented", async () => {
    vi.useFakeTimers();
    let parentProcessId = 41;
    const terminate = vi.fn(async () => undefined);
    const stop = startManagedOwnerLivenessMonitor({
      managed: true,
      ownerProcessId: 41,
      currentParentProcessId: () => parentProcessId,
      pollIntervalMs: 100,
      terminate,
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(terminate).not.toHaveBeenCalled();
    parentProcessId = 1;
    await vi.advanceTimersByTimeAsync(500);
    expect(terminate).toHaveBeenCalledOnce();
    stop();
  });

  it("terminates when owner loss happened before monitor installation", async () => {
    vi.useFakeTimers();
    const terminate = vi.fn(async () => undefined);
    startManagedOwnerLivenessMonitor({
      managed: true,
      ownerProcessId: 41,
      currentParentProcessId: () => 1,
      pollIntervalMs: 100,
      terminate,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(terminate).toHaveBeenCalledOnce();
  });
});
