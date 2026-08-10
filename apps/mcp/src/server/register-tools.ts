import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { RuntimeClient } from "../runtime/runtime-client.types.js";
import { browserTools } from "../tools/browser.tools.js";
import { controlTools } from "../tools/control.tools.js";
import { evidenceTools } from "../tools/evidence.tools.js";
import { sessionTools } from "../tools/session.tools.js";
import { toolFailure, toolSuccess, type ToolResult } from "./tool-result.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler(input: unknown): Promise<unknown>;
}

export function registerTools(server: Server, runtime: RuntimeClient): void {
  const tools = [...sessionTools(runtime), ...browserTools(runtime), ...evidenceTools(runtime), ...controlTools(runtime)];
  const handlers = new Map(tools.map((tool) => [tool.name, tool.handler]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<ToolResult> => {
    const handler = handlers.get(request.params.name);
    if (handler === undefined) {
      return toolFailure(new Error(`Unknown tool: ${request.params.name}`));
    }
    try {
      return toolSuccess(await handler(request.params.arguments ?? {}));
    } catch (error) {
      return toolFailure(error);
    }
  });
}
