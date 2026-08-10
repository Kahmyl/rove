import { describe, expect, it } from "vitest";

import { loadConfig } from "./index.js";

describe("browser executable configuration", () => {
  it("loads an explicit browser executable path", () => {
    const config = loadConfig({
      env: {
        ROVE_BROWSER_EXECUTABLE_PATH: "/custom/chrome",
      },
    });

    expect(config.browser.executablePath).toBe("/custom/chrome");
  });
});
