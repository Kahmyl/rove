import { describe, expect, it } from "vitest";

import {
  buildRuntimeProcessEnvironment,
  RuntimeProcess,
} from "./runtime-process.js";

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

  it("configures Electron's Node mode and packaged Playwright browsers", () => {
    const environment = buildRuntimeProcessEnvironment(
      {
        runtimeDirectory: "/resources/services/runtime",
        home: "/tmp/rove",
        host: "127.0.0.1",
        port: 51_001,
        token: "runtime-secret",
        browserHeadless: false,
        browser: "chromium",
        playwrightBrowsersPath: "/resources/browsers",
        electronRunAsNode: true,
      },
      {},
    );

    expect(environment).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      PLAYWRIGHT_BROWSERS_PATH: "/resources/browsers",
    });
  });
});

describe("RuntimeProcess recovery signals", () => {
  it("reports a spawn failure instead of emitting an unhandled error", async () => {
    const runtime = new RuntimeProcess({
      runtimeDirectory: "/tmp",
      home: "/tmp/rove",
      host: "127.0.0.1",
      port: 51_001,
      token: "runtime-secret",
      browserHeadless: true,
      browser: "chromium",
      nodeExecutable: "/tmp/rove-node-does-not-exist",
    });

    const exit = new Promise<Parameters<Parameters<typeof runtime.onExit>[0]>[0]>(
      (resolve) => runtime.onExit(resolve),
    );

    runtime.start();

    await expect(exit).resolves.toMatchObject({
      code: null,
      signal: null,
      error: expect.stringContaining("ENOENT"),
    });

    expect(runtime.isRunning()).toBe(false);
  });
});
