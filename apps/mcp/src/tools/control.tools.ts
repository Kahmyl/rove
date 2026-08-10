import { z } from "zod";
import type { RuntimeClient } from "../runtime/runtime-client.types.js";
import type { ToolDefinition } from "../server/register-tools.js";
import { sessionIdJsonSchema, sessionIdSchema } from "./schemas.js";

export function controlTools(runtime: RuntimeClient): ToolDefinition[] {
  return [
    {
      name: "control.status",
      description: "Read current browser control ownership.",
      inputSchema: sessionIdJsonSchema,
      handler: (input) => runtime.getControl(z.object({ sessionId: sessionIdSchema }).parse(input).sessionId),
    },
  ];
}
