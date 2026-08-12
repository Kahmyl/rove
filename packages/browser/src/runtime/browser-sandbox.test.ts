import { describe, expect, it } from "vitest";

import { parseChromiumSandboxPage } from "./browser-sandbox.js";

describe("parseChromiumSandboxPage", () => {
  it("reports disabled when Chromium says the sandbox is inadequate", () => {
    expect(
      parseChromiumSandboxPage("You are not adequately sandboxed!"),
    ).toMatchObject({
      status: "disabled",
    });
  });

  it("reports enabled when Chromium exposes known sandbox status signals", () => {
    expect(
      parseChromiumSandboxPage(
        "Sandbox Status\nWin32k lockdown enabled\nAppContainer enabled",
      ),
    ).toMatchObject({
      status: "enabled",
    });
  });

  it("reports unknown when the page text has no recognized signal", () => {
    expect(parseChromiumSandboxPage("Chromium")).toMatchObject({
      status: "unknown",
    });
  });
});
