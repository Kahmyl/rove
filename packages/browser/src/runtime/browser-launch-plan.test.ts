import { describe, expect, it } from "vitest";

import type { BrowserLaunchConfig } from "@rove/protocol";

import { resolveBrowserLaunchPlan } from "./browser-launch-plan.js";

const config: BrowserLaunchConfig = {
  browser: "chromium",
  headless: true,
  profile: {
    mode: "temporary",
  },
};

describe("resolveBrowserLaunchPlan", () => {
  it("resolves the default temporary Chromium launch plan", () => {
    expect(resolveBrowserLaunchPlan(config)).toMatchObject({
      browserFamily: "chromium",
      distribution: "chromium",
      headless: true,
      sandbox: true,
      profile: {
        mode: "temporary",
      },
      viewport: {
        width: 1440,
        height: 900,
      },
      args: [],
      ignoreDefaultArgs: expect.arrayContaining([
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ]),
    });
  });

  it("resolves persistent profile directories", () => {
    expect(
      resolveBrowserLaunchPlan({
        ...config,
        profile: {
          mode: "persistent",
          name: "default",
        },
        profileUserDataDir: ".rove/profiles/default",
      }),
    ).toMatchObject({
      profile: {
        mode: "persistent",
        userDataDir: ".rove/profiles/default",
      },
    });
  });

  it("reports advanced caller-supplied launch modifications", () => {
    const plan = resolveBrowserLaunchPlan({
      ...config,
      executablePath: "C:/Chrome/chrome.exe",
      launchArgs: ["--proxy-server=http://127.0.0.1:8888"],
    });

    expect(plan.args).toContain("--proxy-server=http://127.0.0.1:8888");
    expect(plan.ignoreDefaultArgs).toContain("--no-sandbox");
    expect(plan.argDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          arg: "--proxy-server=http://127.0.0.1:8888",
          action: "pass_to_browser",
          source: "user_supplied",
        }),
      ]),
    );
    expect(plan.diagnostics.map((item) => item.code)).toEqual([
      "CUSTOM_LAUNCH_ARGS",
      "CUSTOM_EXECUTABLE_PATH",
    ]);
    expect(
      plan.argDiagnostics
        .map((item) => item.reason)
        .join("\n"),
    ).not.toMatch(/pre-F4|F4 must replace/i);
  });

  it("reports disabled requested sandbox policy from explicit launch args", () => {
    const plan = resolveBrowserLaunchPlan({
      ...config,
      launchArgs: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    expect(plan.sandbox).toBe(false);
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SANDBOX_DISABLED_BY_LAUNCH_ARGS",
        }),
      ]),
    );
  });

  it("carries launch timeout into the plan", () => {
    expect(
      resolveBrowserLaunchPlan({
        ...config,
        timeouts: {
          launchMs: 12_345,
        },
      }),
    ).toMatchObject({
      timeoutMs: 12_345,
    });
  });

  it("reports existing profiles as unsupported", () => {
    expect(
      resolveBrowserLaunchPlan({
        ...config,
        profile: {
          mode: "existing",
          userDataDir: "C:/Users/me/AppData/Chrome",
        },
      }).diagnostics,
    ).toEqual([
      expect.objectContaining({
        code: "EXISTING_PROFILE_UNSUPPORTED",
      }),
    ]);
  });
});
