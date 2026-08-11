import { loadConfig } from "@rove/config";
import { BearerTokenVerifier } from "./auth/bearer-auth.js";
import { stderrLogger } from "./logging/logger.js";
import { RuntimeHttpClient } from "./runtime/runtime-client.js";
import { ControlPlaneRuntimeClient } from "./runtime/control-plane-runtime-client.js";
import { createMcpServer } from "./server/create-mcp-server.js";
import { startStdioServer } from "./transports/stdio.js";
import { startStreamableHttpServer } from "./transports/streamable-http.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const controlPlaneUrl = process.env.ROVE_CONTROL_PLANE_URL;
  const runtime =
    controlPlaneUrl === undefined
      ? new RuntimeHttpClient(config.runtime.url, config.runtime.token)
      : new ControlPlaneRuntimeClient({
          controlPlaneUrl,
          deviceId: process.env.ROVE_HUB_DEVICE_ID ?? "local-dev",
          serviceToken:
            process.env.ROVE_CONTROL_PLANE_SERVICE_TOKEN ??
            "rove-local-service-token-change-me",
        });
  // A deployed MCP service must remain available while a user's Hub is
  // offline. Direct development still fails fast when its local Runtime is
  // unavailable; relay mode reports Hub readiness through /health instead.
  if (controlPlaneUrl === undefined) {
    await runtime.healthCheck();
  }

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
