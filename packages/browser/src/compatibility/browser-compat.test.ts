import { describe, expect, it } from "vitest";

import {
  formatBrowserCompatReport,
  parseBrowserCompatArgs,
} from "./browser-compat.js";

describe("browser compatibility harness", () => {
  it("parses requested compatibility runtime options", () => {
    expect(parseBrowserCompatArgs(["--chrome", "--headed"])).toEqual({
      browser: "chrome",
      headless: false,
    });
  });

  it("formats compatibility cases with result taxonomy", () => {
    expect(
      formatBrowserCompatReport({
        title: "Rove Browser Compatibility",
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
          profile: "temporary + persistent",
        },
        resolved: {
          browser: "Playwright Chromium",
          browserVersion: "123.0.0.0",
          fallbackUsed: false,
        },
        cases: [
          {
            name: "temporary launch and navigation",
            status: "PASS",
            details: "Launched.",
          },
        ],
      }),
    ).toContain("[PASS] temporary launch and navigation: Launched.");
  });
});
