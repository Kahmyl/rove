import { describe, expect, it } from "vitest";

import { buildRuntimeProcessEnvironment } from "./runtime-process.js";

describe("buildRuntimeProcessEnvironment", () => {
  it("passes the resolved native browser to Runtime", () => {
    const environment = buildRuntimeProcessEnvironment(
      {
        runtimeDirectory: "/tmp/runtime",
        home: "/tmp/rove",
        host: "127.0.0.1",
        port: 51001,
        token: "runtime-secret",
        browserHeadless: false,
        browser: "chrome",
        browserExecutablePath:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      },
      {
        HOME: "/tmp/home",
      },
    );

    expect(environment).toMatchObject({
      HOME: "/tmp/home",
      ROVE_RUNTIME_HOST: "127.0.0.1",
      ROVE_RUNTIME_PORT: "51001",
      ROVE_BROWSER: "chrome",
      ROVE_BROWSER_EXECUTABLE_PATH:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
  });

  it("omits an executable path for bundled Chromium", () => {
    const environment = buildRuntimeProcessEnvironment(
      {
        runtimeDirectory: "/tmp/runtime",
        home: "/tmp/rove",
        host: "127.0.0.1",
        port: 51001,
        token: "runtime-secret",
        browserHeadless: false,
        browser: "chromium",
      },
      {},
    );

    expect(environment.ROVE_BROWSER).toBe("chromium");

    expect(environment.ROVE_BROWSER_EXECUTABLE_PATH).toBeUndefined();
  });
});
