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
      sandbox: false,
      profile: {
        mode: "temporary",
      },
      viewport: {
        width: 1440,
        height: 900,
      },
      args: expect.arrayContaining([
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
    expect(plan.argDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          arg: "--proxy-server=http://127.0.0.1:8888",
          source: "user_supplied",
        }),
      ]),
    );
    expect(plan.diagnostics.map((item) => item.code)).toEqual([
      "CUSTOM_LAUNCH_ARGS",
      "CUSTOM_EXECUTABLE_PATH",
    ]);
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
