import { describe, expect, it, vi } from "vitest";

import { discoverBrowser } from "./browser-discovery.js";

describe("discoverBrowser", () => {
  it("uses an explicit executable before discovery", async () => {
    const pathExists = vi.fn(async () => true);

    await expect(
      discoverBrowser({
        preferredBrowser: "chrome",
        explicitExecutablePath: "/custom/chrome",
        platform: "darwin",
        env: {},
        pathExists,
      }),
    ).resolves.toEqual({
      kind: "chrome",
      source: "explicit",
      executablePath: "/custom/chrome",
    });
  });

  it("discovers system Chrome on macOS", async () => {
    const chromePath =
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

    const pathExists = vi.fn(
      async (executablePath: string) => executablePath === chromePath,
    );

    await expect(
      discoverBrowser({
        preferredBrowser: "chrome",
        platform: "darwin",
        env: {
          HOME: "/Users/test",
        },
        pathExists,
      }),
    ).resolves.toEqual({
      kind: "chrome",
      source: "system",
      executablePath: chromePath,
    });
  });

  it("discovers Chrome from PATH on Linux", async () => {
    const pathExists = vi.fn(
      async (executablePath: string) =>
        executablePath === "/usr/bin/google-chrome-stable",
    );

    await expect(
      discoverBrowser({
        preferredBrowser: "chrome",
        platform: "linux",
        env: {
          PATH: "/usr/local/bin:/usr/bin",
        },
        pathExists,
      }),
    ).resolves.toEqual({
      kind: "chrome",
      source: "system",
      executablePath: "/usr/bin/google-chrome-stable",
    });
  });

  it("falls back to bundled Chromium", async () => {
    const pathExists = vi.fn(async () => false);

    await expect(
      discoverBrowser({
        preferredBrowser: "chrome",
        platform: "darwin",
        env: {},
        pathExists,
      }),
    ).resolves.toEqual({
      kind: "chromium",
      source: "bundled",
    });
  });

  it("honors an explicit Chromium preference", async () => {
    const pathExists = vi.fn(async () => true);

    await expect(
      discoverBrowser({
        preferredBrowser: "chromium",
        platform: "darwin",
        env: {},
        pathExists,
      }),
    ).resolves.toEqual({
      kind: "chromium",
      source: "bundled",
    });

    expect(pathExists).not.toHaveBeenCalled();
  });

  it("rejects a missing explicit executable", async () => {
    await expect(
      discoverBrowser({
        preferredBrowser: "chrome",
        explicitExecutablePath: "/missing/chrome",
        platform: "darwin",
        env: {},
        pathExists: async () => false,
      }),
    ).rejects.toThrow("Configured browser executable does not exist");
  });
});
