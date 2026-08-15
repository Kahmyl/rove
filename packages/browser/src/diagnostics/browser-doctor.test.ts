import { describe, expect, it } from "vitest";

import {
  formatBrowserDoctorReport,
  parseBrowserDoctorArgs,
  type BrowserDoctorReport,
} from "./browser-doctor.js";

describe("browser doctor diagnostics", () => {
  it("parses requested runtime options", () => {
    expect(
      parseBrowserDoctorArgs([
        "--chrome",
        "--headed",
        "--persistent",
        "--profile-dir",
        ".rove/profiles/default",
        "--arg",
        "--use-mock-keychain",
        "--json",
      ]),
    ).toMatchObject({
      browser: "chrome",
      headless: false,
      profile: "persistent",
      output: "json",
      launchArgs: ["--use-mock-keychain"],
    });
  });

  it("formats requested, resolved, and verified runtime sections", () => {
    const report: BrowserDoctorReport = {
      title: "Rove Browser Runtime",
      platform: {
        os: "win32",
        arch: "x64",
        runtime: "node v22.0.0",
      },
      playwright: {
        version: "1.54.2",
      },
      requested: {
        browser: "chromium",
        headless: true,
        profile: "temporary",
        viewport: {
          width: 1440,
          height: 900,
        },
        customLaunchArgs: false,
      },
      resolved: {
        browser: "Playwright Chromium",
        browserVersion: "123.0.0.0",
        fallbackUsed: false,
      },
      verified: {
        launch: "pass",
        pageCreation: "pass",
        sandbox: "unknown",
        serviceWorkers: "supported",
        persistentStorage: "not_requested",
        downloads: "not_run",
      },
      launchPlan: {
        sandbox: true,
        args: [
          {
            arg: "--no-sandbox",
            action: "ignore_playwright_default",
            source: "required_by_current_runtime",
            reason: "test",
          },
        ],
        diagnostics: [],
      },
      sandbox: {
        status: "unknown",
        method: "chrome_sandbox_page",
        details: "test",
      },
      diagnostics: [],
    };

    expect(formatBrowserDoctorReport(report)).toContain("Requested:");
    expect(formatBrowserDoctorReport(report)).toContain("Resolved:");
    expect(formatBrowserDoctorReport(report)).toContain("Verified:");
    expect(formatBrowserDoctorReport(report)).toContain("Service workers: supported");
    expect(formatBrowserDoctorReport(report)).toContain("Sandbox Verification:");
    expect(formatBrowserDoctorReport(report)).toContain("Launch Plan:");
  });
});
