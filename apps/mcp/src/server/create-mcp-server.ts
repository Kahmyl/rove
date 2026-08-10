import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { RuntimeClient } from "../runtime/runtime-client.types.js";
import { registerTools } from "./register-tools.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version: string };

export const ROVE_MCP_SERVER_NAME = "rove";
export const ROVE_MCP_SERVER_VERSION = packageJson.version;

export function createMcpServer(runtime: RuntimeClient): Server {
  const server = new Server(
    { name: ROVE_MCP_SERVER_NAME, version: ROVE_MCP_SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
  registerTools(server, runtime);
  return server;
}
