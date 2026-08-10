import { describe, expect, it } from "vitest";

import { buildMcpProcessEnvironment } from "./mcp-process.js";

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
});
