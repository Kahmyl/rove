import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium, type Browser, type BrowserContext } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrowserLaunchConfig } from "@rove/protocol";

import type { BrowserSession } from "./engine.js";
import { PlaywrightBrowserEngine } from "./playwright-browser-engine.js";
import { PlaywrightBrowserSession } from "./playwright-browser-session.js";
import * as externalChromeRuntime from "./runtime/external-chrome-runtime.js";

const temporaryDirectories: string[] = [];

const baseConfig: BrowserLaunchConfig = {
  headless: true,
  browser: "chrome",
  profile: {
    mode: "temporary",
  },
};

afterEach(async () => {
  vi.restoreAllMocks();

  while (temporaryDirectories.length > 0) {
    await rm(temporaryDirectories.pop()!, {
      recursive: true,
      force: true,
    });
  }
});

describe("external Chrome engine integration", () => {
  it("launches Chrome externally, attaches over CDP, and transfers process cleanup ownership to the session", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "rove-external-engine-"));

    temporaryDirectories.push(userDataDir);

    const fakeContext = {} as BrowserContext;

    const fakeBrowser = {
      contexts: () => [fakeContext],
    } as unknown as Browser;

    const fakeSession = {} as BrowserSession;

    const close = vi.fn(async () => undefined);

    const discover = vi
      .spyOn(externalChromeRuntime, "discoverExternalChromeExecutable")
      .mockResolvedValue("/custom/chrome");

    const launch = vi
      .spyOn(externalChromeRuntime, "launchExternalChrome")
      .mockResolvedValue({
        endpoint: "http://127.0.0.1:9222",
        port: 9222,
        processId: 1234,
        userDataDir,
        temporaryProfile: false,
        close,
      });

    const connect = vi
      .spyOn(chromium, "connectOverCDP")
      .mockResolvedValue(fakeBrowser);

    const create = vi
      .spyOn(PlaywrightBrowserSession, "createPersistent")
      .mockResolvedValue(fakeSession as unknown as PlaywrightBrowserSession);

    const result = await new PlaywrightBrowserEngine().start({
      ...baseConfig,
      profile: {
        mode: "persistent",
        name: "integration",
      },
      profileUserDataDir: userDataDir,
      executablePath: "/custom/chrome",
      launchArgs: ["--proxy-server=http://127.0.0.1:8888"],
      timeouts: {
        launchMs: 12_345,
      },
    });

    expect(result).toBe(fakeSession);

    expect(discover).toHaveBeenCalledWith({
      explicitExecutablePath: "/custom/chrome",
    });

    expect(launch).toHaveBeenCalledWith({
      executablePath: "/custom/chrome",
      userDataDir,
      headless: true,
      launchArgs: ["--proxy-server=http://127.0.0.1:8888"],
      timeoutMs: 12_345,
    });

    expect(connect).toHaveBeenCalledWith("http://127.0.0.1:9222", {
      timeout: 12_345,
    });

    const call = create.mock.calls[0];

    expect(call?.[0]).toBe(fakeContext);

    expect(call?.[2]).toMatchObject({
      distribution: "chrome",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "EXTERNAL_CHROME_CDP_ATTACH",
        }),
      ]),
    });

    expect(call?.[5]).toBe(close);
  });

  it("falls back to bundled Chromium when system Chrome is unavailable", async () => {
    const fakeBrowser = {} as Browser;

    const fakeSession = {} as BrowserSession;

    vi.spyOn(
      externalChromeRuntime,
      "discoverExternalChromeExecutable",
    ).mockResolvedValue(undefined);

    const externalLaunch = vi.spyOn(
      externalChromeRuntime,
      "launchExternalChrome",
    );

    const managedLaunch = vi
      .spyOn(chromium, "launch")
      .mockResolvedValue(fakeBrowser);

    const create = vi
      .spyOn(PlaywrightBrowserSession, "create")
      .mockResolvedValue(fakeSession as unknown as PlaywrightBrowserSession);

    const result = await new PlaywrightBrowserEngine().start(baseConfig);

    expect(result).toBe(fakeSession);

    expect(externalLaunch).not.toHaveBeenCalled();

    expect(managedLaunch).toHaveBeenCalledTimes(1);

    expect(managedLaunch.mock.calls[0]?.[0]).not.toHaveProperty("channel");

    expect(create.mock.calls[0]?.[2]).toMatchObject({
      distribution: "chromium",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "BROWSER_DISTRIBUTION_FALLBACK",
        }),
      ]),
    });

    const downloadRuntime = create.mock.calls[0]?.[3];

    if (downloadRuntime !== undefined) {
      temporaryDirectories.push(downloadRuntime.root);
    }
  });

  it("runs an owned runtime cleanup hook exactly once when a session closes", async () => {
    const userDataDir = await mkdtemp(
      join(tmpdir(), "rove-owned-runtime-close-"),
    );

    temporaryDirectories.push(userDataDir);

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
    });

    const cleanup = vi.fn(async () => undefined);

    const session = await PlaywrightBrowserSession.createPersistent(
      context,
      {
        headless: true,
        browser: "chromium",
        profile: {
          mode: "persistent",
          name: "owned-runtime-close",
        },
        profileUserDataDir: userDataDir,
      },
      {
        distribution: "chromium",
        sandbox: true,
        diagnostics: [],
      },
      undefined,
      "browser_owned_runtime_test",
      cleanup,
    );

    await session.close();
    await session.close();

    expect(cleanup).toHaveBeenCalledTimes(1);
  }, 15_000);
});
