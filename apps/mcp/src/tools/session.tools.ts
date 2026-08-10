import {
  observationQuerySchema,
  startSessionRequestSchema,
} from "@rove/protocol";
import { z } from "zod";
import type { RuntimeClient } from "../runtime/runtime-client.types.js";
import type { ToolDefinition } from "../server/register-tools.js";
import { sessionIdJsonSchema, sessionIdSchema } from "./schemas.js";

export function sessionTools(runtime: RuntimeClient): ToolDefinition[] {
  return [
    {
      name: "session.start",
      description:
        "Start a Rove browser session. Use agent for autonomous work where human control requires an explicit handoff, companion when the human may voluntarily take over at any time, and capture for human-driven browsing that Rove observes.",
      inputSchema: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["agent", "companion", "capture"],
            description:
              "agent = autonomous with explicit human handoff; companion = collaborative with voluntary human takeover; capture = human-controlled observation",
          },
          startUrl: { type: "string" },
          profile: {
            type: "object",
            properties: {
              mode: {
                type: "string",
                enum: ["temporary", "persistent", "existing"],
              },
              name: { type: "string" },
              userDataDir: { type: "string" },
              profileDirectory: { type: "string" },
            },
            required: ["mode"],
            additionalProperties: false,
          },
        },
        required: ["mode"],
        additionalProperties: false,
      },
      handler: (input) =>
        runtime.startSession(startSessionRequestSchema.parse(input)),
    },
    {
      name: "session.status",
      description: "Read a Rove session snapshot.",
      inputSchema: sessionIdJsonSchema,
      handler: (input) => {
        const parsed = z.object({ sessionId: sessionIdSchema }).parse(input);
        return runtime.getSession(parsed.sessionId);
      },
    },
    {
      name: "session.end",
      description: "End a Rove session.",
      inputSchema: sessionIdJsonSchema,
      handler: (input) => {
        const parsed = z.object({ sessionId: sessionIdSchema }).parse(input);
        return runtime.endSession(parsed.sessionId);
      },
    },
    {
      name: "session.observations",
      description: "List session observations.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          afterSeq: { type: "integer", minimum: 0, default: 0 },
          limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
      handler: async (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            afterSeq: z.number().int().nonnegative().optional().default(0),
            limit: z.number().int().positive().max(500).optional().default(100),
          })
          .parse(input);
        const page = await runtime.getObservations(
          parsed.sessionId,
          observationQuerySchema.parse(parsed),
        );
        return { observations: page.items, nextSeq: page.nextSeq ?? null };
      },
    },
  ];
}
