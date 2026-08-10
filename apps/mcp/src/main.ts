import { loadConfig } from "@rove/config";
import { BearerTokenVerifier } from "./auth/bearer-auth.js";
import { stderrLogger } from "./logging/logger.js";
import { RuntimeHttpClient } from "./runtime/runtime-client.js";
import { createMcpServer } from "./server/create-mcp-server.js";
import { startStdioServer } from "./transports/stdio.js";
import { startStreamableHttpServer } from "./transports/streamable-http.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const runtime = new RuntimeHttpClient(config.runtime.url, config.runtime.token);
  await runtime.healthCheck();

  if (config.mcp.transport === "stdio") {
    await startStdioServer(createMcpServer(runtime), stderrLogger);
    return;
  }
  await startStreamableHttpServer({
    host: config.mcp.host,
    port: config.mcp.port,
    path: config.mcp.path,
    auth: new BearerTokenVerifier(config.mcp.bearerToken),
    runtime,
    createServer: () => createMcpServer(runtime),
    logger: stderrLogger,
    ...(config.mcp.allowedHosts === undefined ? {} : { allowedHosts: config.mcp.allowedHosts }),
  });
}

void main().catch((error: unknown) => {
  // stdout is reserved exclusively for MCP protocol frames.
  process.stderr.write(`${error instanceof Error ? error.message : "Rove MCP failed."}\n`);
  process.exitCode = 1;
});
