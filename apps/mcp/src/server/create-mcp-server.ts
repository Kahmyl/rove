import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ROVE_PROTOCOL_VERSION, RoveError } from "@rove/protocol";
import type { RuntimeHttpClient } from "../runtime/runtime-client.js";

const tools = [
  {
    name: "session.start",
    description: "Start a Rove browser session.",
    inputSchema: {
      type: "object" as const,
      properties: {
        mode: { type: "string", enum: ["agent", "companion", "capture"] },
        startUrl: { type: "string", format: "uri" },
      },
      required: ["mode"],
      additionalProperties: false,
    },
  },
  {
    name: "session.status",
    description: "Read a Rove session snapshot.",
    inputSchema: {
      type: "object" as const,
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
      additionalProperties: false,
    },
  },
  {
    name: "session.end",
    description: "End a Rove session and close its browser.",
    inputSchema: {
      type: "object" as const,
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
      additionalProperties: false,
    },
  },
];

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

export function createMcpServer(runtime: RuntimeHttpClient): Server {
  const server = new Server(
    { name: "rove", version: String(ROVE_PROTOCOL_VERSION) },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    try {
      switch (request.params.name) {
        case "session.start":
          return textResult(await runtime.startSession(args as { mode: "agent" | "companion" | "capture" }));
        case "session.status":
          return textResult(await runtime.getSession(String(args.sessionId)));
        case "session.end":
          return textResult(await runtime.endSession(String(args.sessionId)));
        default:
          throw new RoveError({ code: "NOT_IMPLEMENTED", message: "Tool adapter is not implemented yet." });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Rove error.";
      return { isError: true, content: [{ type: "text" as const, text: message }] };
    }
  });

  return server;
}
