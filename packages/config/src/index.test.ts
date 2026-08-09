import { describe, expect, it } from "vitest";
import { isLoopbackHost, loadConfig } from "./index.js";

describe("loadConfig", () => {
  it("defaults network services to loopback and MCP to stdio", () => {
    const config = loadConfig({ cwd: "/tmp/rove-test", env: {} });
    expect(config.runtime.host).toBe("127.0.0.1");
    expect(config.mcp.transport).toBe("stdio");
    expect(config.browser.headless).toBe(false);
  });

  it("requires a strong-enough token for HTTP", () => {
    expect(() =>
      loadConfig({ env: { ROVE_MCP_TRANSPORT: "http", ROVE_MCP_TOKEN: "short" } }),
    ).toThrow();
  });
});

describe("isLoopbackHost", () => {
  it.each(["127.0.0.1", "localhost", "::1"])("accepts %s", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });
});
