import type {
  Server,
} from "@modelcontextprotocol/sdk/server/index.js";

import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type {
  RuntimeClient,
} from "../runtime/runtime-client.types.js";

import {
  browserTools,
} from "../tools/browser.tools.js";

import {
  controlTools,
} from "../tools/control.tools.js";

import {
  evidenceTools,
} from "../tools/evidence.tools.js";

import {
  sessionTools,
} from "../tools/session.tools.js";

import {
  toolFailure,
  toolSuccess,
  type ToolResult,
} from "./tool-result.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;

  handler(
    input: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>;

  present?(
    result: unknown,
  ): ToolResult;
}

export function registerTools(
  server: Server,
  runtime: RuntimeClient,
): void {
  const tools = [
    ...sessionTools(runtime),
    ...browserTools(runtime),
    ...evidenceTools(runtime),
    ...controlTools(runtime),
  ];

  const definitions =
    new Map(
      tools.map((tool) => [
        tool.name,
        tool,
      ]),
    );

  server.setRequestHandler(
    ListToolsRequestSchema,
    async () => ({
      tools:
        tools.map(
          ({
            name,
            description,
            inputSchema,
          }) => ({
            name,
            description,
            inputSchema,
          }),
        ),
    }),
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (
      request,
      extra,
    ): Promise<ToolResult> => {
      const tool =
        definitions.get(
          request.params.name,
        );

      if (tool === undefined) {
        return toolFailure(
          new Error(
            `Unknown tool: ${request.params.name}`,
          ),
        );
      }

      try {
        const result =
          await tool.handler(
            request.params.arguments ?? {},
            extra.signal,
          );

        return tool.present === undefined
          ? toolSuccess(result)
          : tool.present(result);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );
}
