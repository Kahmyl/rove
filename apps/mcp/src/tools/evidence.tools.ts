import { z } from "zod";
import type { RuntimeClient } from "../runtime/runtime-client.types.js";
import type { ToolDefinition } from "../server/register-tools.js";
import { sessionIdJsonSchema, sessionIdSchema } from "./schemas.js";

const MAX_RECORD_BYTES = 1024 * 1024;

export function evidenceTools(runtime: RuntimeClient): ToolDefinition[] {
  return [
    {
      name: "evidence.save_record",
      description: "Save a structured JSON evidence record.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1, maxLength: 200 },
          record: { type: "object" },
        },
        required: ["sessionId", "label", "record"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z.object({ sessionId: sessionIdSchema, label: z.string().min(1).max(200), record: z.record(z.string(), z.unknown()) }).parse(input);
        if (new TextEncoder().encode(JSON.stringify(parsed.record)).byteLength > MAX_RECORD_BYTES) {
          throw new Error("Evidence record exceeds 1 MiB.");
        }
        return runtime.saveRecord(parsed.sessionId, { label: parsed.label, record: parsed.record });
      },
    },
    {
      name: "evidence.list",
      description: "List evidence metadata for a session.",
      inputSchema: sessionIdJsonSchema,
      handler: (input) => runtime.listEvidence(z.object({ sessionId: sessionIdSchema }).parse(input).sessionId),
    },
    {
      name: "evidence.read",
      description: "Read evidence content or binary metadata.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          evidenceId: { type: "string", minLength: 1 },
        },
        required: ["sessionId", "evidenceId"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z.object({ sessionId: sessionIdSchema, evidenceId: z.string().min(1) }).parse(input);
        return runtime.readEvidence(parsed.sessionId, parsed.evidenceId);
      },
    },
  ];
}
