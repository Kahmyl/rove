import { controlWaitRequestSchema, requestHumanRequestSchema } from "@rove/protocol";
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
      handler: (input) => runtime.getControlStatus(z.object({ sessionId: sessionIdSchema }).parse(input).sessionId),
    },
    {
      name: "control.request_human",
      description: "Request human control of an Agent-mode browser session.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1, maxLength: 500 },
        },
        required: ["sessionId", "reason"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z.object({ sessionId: sessionIdSchema, reason: requestHumanRequestSchema.shape.reason }).parse(input);
        return runtime.requestHuman(parsed.sessionId, parsed.reason);
      },
    },
    {
      name: "control.wait",
      description: "Wait for the next durable control or terminal-session event.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          afterSeq: { type: "integer", minimum: 0 },
          timeoutMs: { type: "integer", minimum: 0, maximum: 60_000 },
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
      handler: (input, signal) => {
        const parsed = z.object({ sessionId: sessionIdSchema }).extend(controlWaitRequestSchema.shape).parse(input);
        return runtime.waitForControl(parsed.sessionId, {
          ...(parsed.afterSeq === undefined ? {} : { afterSeq: parsed.afterSeq }),
          ...(parsed.timeoutMs === undefined ? {} : { timeoutMs: parsed.timeoutMs }),
        }, signal);
      },
    },
  ];
}
