import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpLogger } from "../logging/logger.js";

export async function startStdioServer(server: Server, logger: McpLogger): Promise<void> {
  const transport = new StdioServerTransport();
  const close = async () => {
    await closeQuietly(server);
    process.exitCode = 0;
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  process.stdin.once("end", () => void close());
  logger.info("Rove MCP stdio starting.");
  await server.connect(transport);
}

async function closeQuietly(server: Server): Promise<void> {
  const closable = server as Server & { close?: () => Promise<void> };
  if (closable.close === undefined) return;
  await closable.close();
}
