import { describe, expect, it } from "vitest";

import {
  formatAgentConnection,
  toAgentConnectionDetails,
} from "./agent-connection.js";

describe("agent connection handoff", () => {
  it("exposes only the MCP endpoint and bearer token on explicit request", () => {
    const details = toAgentConnectionDetails({
      baseUrl: "http://127.0.0.1:51002",
      endpointUrl: "http://127.0.0.1:51002/mcp",
      token: "secret-token",
      port: 51_002,
      path: "/mcp",
    });

    expect(details).toEqual({
      url: "http://127.0.0.1:51002/mcp",
      bearerToken: "secret-token",
    });

    expect(formatAgentConnection(details)).toBe(
      '{\n  "url": "http://127.0.0.1:51002/mcp",\n  "bearerToken": "secret-token"\n}\n',
    );
  });
});
