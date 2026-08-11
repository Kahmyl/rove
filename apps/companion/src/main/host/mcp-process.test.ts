import { describe, expect, it } from "vitest";

import {
  buildMcpProcessEnvironment,
  McpProcess,
} from "./mcp-process.js";

describe("buildMcpProcessEnvironment", () => {
  it("connects managed MCP to the managed Runtime", () => {
    const environment = buildMcpProcessEnvironment(
      {
        mcpDirectory: "/tmp/rove/mcp",
        runtimeUrl: "http://127.0.0.1:51001",
        runtimeToken: "runtime-secret",
        host: "127.0.0.1",
        port: 51002,
        path: "/mcp",
        token: "mcp-secret",
        allowedHosts: ["127.0.0.1:51002", "localhost:51002"],
      },
      {
        HOME: "/tmp/home",
      },
    );

    expect(environment).toMatchObject({
      HOME: "/tmp/home",
      ROVE_RUNTIME_URL: "http://127.0.0.1:51001",
      ROVE_RUNTIME_TOKEN: "runtime-secret",
      ROVE_MCP_TRANSPORT: "http",
      ROVE_MCP_HOST: "127.0.0.1",
      ROVE_MCP_PORT: "51002",
      ROVE_MCP_PATH: "/mcp",
      ROVE_MCP_TOKEN: "mcp-secret",
      ROVE_MCP_ALLOWED_HOSTS: "127.0.0.1:51002,localhost:51002",
    });
  });

  it("configures Electron's embedded Node for packaged MCP", () => {
    const environment = buildMcpProcessEnvironment(
      {
        mcpDirectory: "/resources/services/mcp",
        runtimeUrl: "http://127.0.0.1:51001",
        runtimeToken: "runtime-secret",
        host: "127.0.0.1",
        port: 51_002,
        path: "/mcp",
        token: "mcp-secret",
        allowedHosts: ["127.0.0.1:51002"],
        electronRunAsNode: true,
      },
      {},
    );

    expect(environment.ELECTRON_RUN_AS_NODE).toBe("1");
  });
});

describe("McpProcess recovery signals", () => {
  it("reports a spawn failure instead of emitting an unhandled error", async () => {
    const mcp = new McpProcess({
      mcpDirectory: "/tmp",
      runtimeUrl: "http://127.0.0.1:51001",
      runtimeToken: "runtime-secret",
      host: "127.0.0.1",
      port: 51_002,
      path: "/mcp",
      token: "mcp-secret",
      allowedHosts: ["127.0.0.1:51002"],
      nodeExecutable: "/tmp/rove-node-does-not-exist",
    });

    const exit = new Promise<Parameters<Parameters<typeof mcp.onExit>[0]>[0]>(
      (resolve) => mcp.onExit(resolve),
    );

    mcp.start();

    await expect(exit).resolves.toMatchObject({
      code: null,
      signal: null,
      error: expect.stringContaining("ENOENT"),
    });

    expect(mcp.isRunning()).toBe(false);
  });
});
