import { createServer } from "node:net";

import { describe, expect, it, vi } from "vitest";

import {
  buildExternalChromeArguments,
  discoverExternalChromeExecutable,
  reserveLoopbackPort,
} from "./external-chrome-runtime.js";

describe("external Chrome runtime", () => {
  it("uses an explicit executable before system discovery", async () => {
    const pathExists = vi.fn(async () => true);

    await expect(
      discoverExternalChromeExecutable({
        explicitExecutablePath: "/custom/chrome",
        platform: "darwin",
        env: {},
        pathExists,
      }),
    ).resolves.toBe("/custom/chrome");

    expect(pathExists).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing explicit executable instead of silently falling back", async () => {
    await expect(
      discoverExternalChromeExecutable({
        explicitExecutablePath: "/missing/chrome",
        platform: "darwin",
        env: {},
        pathExists: async () => false,
      }),
    ).rejects.toThrow("Configured browser executable does not exist");
  });

  it("discovers system Chrome on macOS", async () => {
    const chrome =
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

    await expect(
      discoverExternalChromeExecutable({
        platform: "darwin",
        env: {
          HOME: "/Users/test",
        },
        pathExists: async (candidate) => candidate === chrome,
      }),
    ).resolves.toBe(chrome);
  });

  it("discovers Chrome from PATH on Linux", async () => {
    await expect(
      discoverExternalChromeExecutable({
        platform: "linux",
        env: {
          PATH: "/usr/local/bin:/usr/bin",
        },
        pathExists: async (candidate) =>
          candidate === "/usr/bin/google-chrome-stable",
      }),
    ).resolves.toBe("/usr/bin/google-chrome-stable");
  });

  it("discovers installed Chrome on Windows", async () => {
    const expected =
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

    await expect(
      discoverExternalChromeExecutable({
        platform: "win32",
        env: {
          PROGRAMFILES: "C:\\Program Files",
        },
        pathExists: async (candidate) => candidate === expected,
      }),
    ).resolves.toBe(expected);
  });

  it("returns undefined when system Chrome is unavailable", async () => {
    await expect(
      discoverExternalChromeExecutable({
        platform: "darwin",
        env: {},
        pathExists: async () => false,
      }),
    ).resolves.toBeUndefined();
  });

  it("builds a specific non-zero loopback CDP launch", () => {
    const args = buildExternalChromeArguments({
      port: 9222,
      userDataDir: "/tmp/rove-profile",
      headless: false,
      launchArgs: ["--proxy-server=http://127.0.0.1:8888"],
    });

    expect(args).toContain("--remote-debugging-address=127.0.0.1");

    expect(args).toContain("--remote-debugging-port=9222");

    expect(args).not.toContain("--remote-debugging-port=0");

    expect(args).toContain("--user-data-dir=/tmp/rove-profile");

    expect(args).toContain("--proxy-server=http://127.0.0.1:8888");

    expect(args).not.toContain("--headless=new");
  });

  it("uses modern Chrome headless mode when requested", () => {
    expect(
      buildExternalChromeArguments({
        port: 9223,
        userDataDir: "/tmp/rove-profile",
        headless: true,
      }),
    ).toContain("--headless=new");
  });

  it.each([
    "--remote-debugging-port=0",
    "--remote-debugging-port=9333",
    "--remote-debugging-address=0.0.0.0",
    "--user-data-dir=/tmp/other",
  ])("rejects caller override of Rove-owned launch control: %s", (arg) => {
    expect(() =>
      buildExternalChromeArguments({
        port: 9222,
        userDataDir: "/tmp/rove-profile",
        headless: false,
        launchArgs: [arg],
      }),
    ).toThrow("reserved by the Rove external-Chrome runtime");
  });

  it("rejects debugging port zero", () => {
    expect(() =>
      buildExternalChromeArguments({
        port: 0,
        userDataDir: "/tmp/rove-profile",
        headless: false,
      }),
    ).toThrow("specific non-zero TCP debugging port");
  });

  it("reserves an actual non-zero loopback port", async () => {
    const port = await reserveLoopbackPort();

    expect(port).toBeGreaterThan(0);

    expect(port).toBeLessThanOrEqual(65_535);

    await new Promise<void>((resolve, reject) => {
      const server = createServer();

      server.once("error", reject);

      server.listen(
        {
          host: "127.0.0.1",
          port,
        },
        () => {
          server.close((error) => {
            if (error) {
              reject(error);

              return;
            }

            resolve();
          });
        },
      );
    });
  });
});
