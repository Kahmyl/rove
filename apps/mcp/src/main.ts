import { loadConfig } from "@rove/config";
import { RuntimeHttpClient } from "./runtime/runtime-client.js";
import { createMcpServer } from "./server/create-mcp-server.js";
import { connectStdio } from "./transports/stdio.js";
import { connectStreamableHttp } from "./transports/streamable-http.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const runtime = new RuntimeHttpClient(
    `http://${config.runtime.host}:${config.runtime.port}`,
    config.runtime.token,
  );
  const server = createMcpServer(runtime);
  if (config.mcp.transport === "stdio") {
    await connectStdio(server);
    return;
  }
  await connectStreamableHttp();
}

void main().catch((error: unknown) => {
  // stdout is reserved exclusively for MCP protocol frames.
  process.stderr.write(`${error instanceof Error ? error.message : "Rove MCP failed."}\n`);
  process.exitCode = 1;
});
