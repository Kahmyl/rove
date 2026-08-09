import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export async function connectStdio(server: Server): Promise<void> {
  await server.connect(new StdioServerTransport());
}
