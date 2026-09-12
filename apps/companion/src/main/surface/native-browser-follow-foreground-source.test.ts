import { describe, expect, it, vi } from "vitest";

import { NativeBrowserFollowForegroundSource } from "./native-browser-follow-foreground-source.js";

describe("NativeBrowserFollowForegroundSource", () => {
  it("reads only the active owner PID and suppresses macOS permission prompts", async () => {
    const lookup = vi.fn(async () => ({ owner: { processId: 4321 } }));
    const source = new NativeBrowserFollowForegroundSource("darwin", lookup);

    await expect(
      source.getForegroundProcessId(new AbortController().signal),
    ).resolves.toBe(4321);
    expect(lookup).toHaveBeenCalledWith({
      accessibilityPermission: false,
      screenRecordingPermission: false,
    });
  });

  it.each(["win32", "linux"] as const)(
    "uses the same PID contract on %s",
    async (platform) => {
      const lookup = vi.fn(async () => ({ owner: { processId: 9876 } }));
      const source = new NativeBrowserFollowForegroundSource(platform, lookup);

      await expect(
        source.getForegroundProcessId(new AbortController().signal),
      ).resolves.toBe(9876);
      expect(lookup).toHaveBeenCalledWith(undefined);
    },
  );

  it("fails closed when native foreground authority is absent, invalid, or stale", async () => {
    const missing = new NativeBrowserFollowForegroundSource(
      "linux",
      vi.fn(async () => undefined),
    );
    await expect(
      missing.getForegroundProcessId(new AbortController().signal),
    ).resolves.toBeNull();

    const invalid = new NativeBrowserFollowForegroundSource(
      "win32",
      vi.fn(async () => ({ owner: { processId: 0 } })),
    );
    await expect(
      invalid.getForegroundProcessId(new AbortController().signal),
    ).resolves.toBeNull();

    const abort = new AbortController();
    abort.abort();
    await expect(
      missing.getForegroundProcessId(abort.signal),
    ).resolves.toBeNull();
  });
});
