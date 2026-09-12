import { describe, expect, it, vi } from "vitest";

import { stopDesktopComponents } from "./desktop-shutdown.js";

describe("desktop shutdown sequencing", () => {
  it("always stops the Desktop host after a non-resolving execution-core stop", async () => {
    const calls: string[] = [];
    const report = vi.fn();

    await stopDesktopComponents({
      stopHub: async () => {
        calls.push("hub");
      },
      stopExecutionCore: async () => {
        calls.push("execution_core");
        await new Promise<void>(() => undefined);
      },
      stopDesktopHost: async () => {
        calls.push("desktop_host");
      },
      cooperativeTimeoutMs: 5,
      report,
    });

    expect(calls).toEqual(["hub", "execution_core", "desktop_host"]);
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0]?.[0]).toBe("execution_core");
    expect(report.mock.calls[0]?.[1]).toMatchObject({
      message: "Desktop shutdown execution_core stop timed out.",
    });
  });

  it("continues to the Desktop host after cooperative stop failures", async () => {
    const stopDesktopHost = vi.fn(async () => undefined);
    const report = vi.fn();

    await stopDesktopComponents({
      stopHub: async () => {
        throw new Error("hub stop failed");
      },
      stopExecutionCore: async () => {
        throw new Error("core stop failed");
      },
      stopDesktopHost,
      report,
    });

    expect(stopDesktopHost).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledTimes(2);
  });
});
