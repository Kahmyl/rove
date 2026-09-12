import { loadConfig } from "@rove/config";
import {
  ROVE_HUB_PROTOCOL_VERSION,
  ROVE_PROTOCOL_VERSION,
  componentCompatibilityError,
} from "@rove/protocol";
import { MCP_PROVENANCE } from "./component-provenance.js";
import { BearerTokenVerifier } from "./auth/bearer-auth.js";
import { stderrLogger } from "./logging/logger.js";
import { RuntimeHttpClient } from "./runtime/runtime-client.js";
import { ControlPlaneRuntimeClient } from "./runtime/control-plane-runtime-client.js";
import {
  scopeRuntimeClient,
  taskRuntimeScopeFromEnvironment,
} from "./runtime/task-scoped-runtime-client.js";
import { createMcpServer } from "./server/create-mcp-server.js";
import { startStdioServer } from "./transports/stdio.js";
import { startStreamableHttpServer } from "./transports/streamable-http.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const controlPlaneUrl = process.env.ROVE_CONTROL_PLANE_URL;
  const expectedBuildIdentity = process.env.ROVE_EXPECTED_BUILD_ID?.trim();
  const expectedDevelopmentCommit =
    process.env.ROVE_EXPECTED_DEVELOPMENT_COMMIT?.trim();
  const expectedRuntime = {
    runtimeApi: ROVE_PROTOCOL_VERSION,
    hub: ROVE_HUB_PROTOCOL_VERSION,
    ...(expectedBuildIdentity === undefined || expectedBuildIdentity === ""
      ? {}
      : { buildIdentity: expectedBuildIdentity }),
    ...(expectedDevelopmentCommit === undefined ||
    expectedDevelopmentCommit === ""
      ? {}
      : {
          developmentGitCommit: expectedDevelopmentCommit,
        }),
  };
  const ownMismatch = componentCompatibilityError(
    MCP_PROVENANCE,
    expectedRuntime,
  );
  if (ownMismatch !== undefined) {
    throw new Error(
      `MCP build does not satisfy its configured compatibility requirement: ${ownMismatch}.`,
    );
  }
  const unscopedRuntime =
    controlPlaneUrl === undefined
      ? new RuntimeHttpClient(
          config.runtime.url,
          config.runtime.token,
          expectedRuntime,
        )
      : new ControlPlaneRuntimeClient({
          controlPlaneUrl,
          deviceId: process.env.ROVE_HUB_DEVICE_ID ?? "local-dev",
          serviceToken:
            process.env.ROVE_CONTROL_PLANE_SERVICE_TOKEN ??
            "rove-local-service-token-change-me",
          expectedRuntime,
        });
  // A deployed MCP service must remain available while a user's Hub is
  // offline. Direct development still fails fast when its local Runtime is
  // unavailable; relay mode reports Hub readiness through /health instead.
  const taskScope = taskRuntimeScopeFromEnvironment();
  if (controlPlaneUrl === undefined && taskScope === undefined) {
    await unscopedRuntime.healthCheck();
  }
  const runtime =
    taskScope === undefined
      ? unscopedRuntime
      : scopeRuntimeClient(unscopedRuntime, taskScope);

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
    ...(config.mcp.allowedHosts === undefined
      ? {}
      : { allowedHosts: config.mcp.allowedHosts }),
  });
}

void main().catch((error: unknown) => {
  // stdout is reserved exclusively for MCP protocol frames.
  process.stderr.write(
    `${error instanceof Error ? error.message : "Rove MCP failed."}\n`,
  );
  process.exitCode = 1;
});
