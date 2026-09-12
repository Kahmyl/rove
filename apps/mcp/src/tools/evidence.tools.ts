import { z } from "zod";
import {
  generatedFileArtifactRequestSchema,
  localFileGrantRequestSchema,
} from "@rove/protocol";
import type { RuntimeClient } from "../runtime/runtime-client.types.js";
import type { ToolDefinition } from "../server/register-tools.js";
import { sessionIdJsonSchema, sessionIdSchema } from "./schemas.js";

const MAX_RECORD_BYTES = 1024 * 1024;

export function evidenceTools(runtime: RuntimeClient): ToolDefinition[] {
  return [
    {
      name: "evidence.create_file",
      description:
        "Create a bounded Rove file artifact from content supplied by the agent. This tool never accepts or reads a host filesystem path. Use the returned evidence ID as browser upload evidence.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          filename: {
            type: "string",
            minLength: 1,
            maxLength: 200,
            description: "Leaf filename only; directory paths are rejected.",
          },
          mimeType: { type: "string", default: "text/plain" },
          encoding: {
            type: "string",
            enum: ["utf8", "base64"],
            default: "utf8",
          },
          content: {
            type: "string",
            maxLength: 1_500_000,
            description: "Agent-supplied content, limited to 512 KiB decoded.",
          },
        },
        required: ["sessionId", "filename", "content"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            filename: z.unknown(),
            mimeType: z.unknown().optional(),
            encoding: z.unknown().optional(),
            content: z.unknown(),
          })
          .parse(input);
        const { sessionId, ...request } = parsed;
        return runtime.createFileArtifact(
          sessionId,
          generatedFileArtifactRequestSchema.parse(request),
        );
      },
    },
    {
      name: "evidence.request_file_grant",
      description:
        "Ask the user to select one or more existing local files in Rove Companion. The native picker is the consent boundary: the agent cannot provide a path, and selected paths are not returned. Returns opaque Rove file-artifact IDs or a cancelled result.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          reason: {
            type: "string",
            minLength: 1,
            maxLength: 500,
            description:
              "Human-visible explanation of why file access is needed.",
          },
          allowMultiple: { type: "boolean", default: false },
        },
        required: ["sessionId", "reason"],
        additionalProperties: false,
      },
      handler: (input, signal) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            reason: z.unknown(),
            allowMultiple: z.unknown().optional(),
          })
          .parse(input);
        const { sessionId, ...request } = parsed;
        return runtime.requestLocalFileGrant(
          sessionId,
          localFileGrantRequestSchema.parse(request),
          signal,
        );
      },
    },
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
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            label: z.string().min(1).max(200),
            record: z.record(z.string(), z.unknown()),
          })
          .parse(input);
        if (
          new TextEncoder().encode(JSON.stringify(parsed.record)).byteLength >
          MAX_RECORD_BYTES
        ) {
          throw new Error("Evidence record exceeds 1 MiB.");
        }
        return runtime.saveRecord(parsed.sessionId, {
          label: parsed.label,
          record: parsed.record,
        });
      },
    },
    {
      name: "evidence.list",
      description: "List evidence metadata for a session.",
      inputSchema: sessionIdJsonSchema,
      handler: (input) =>
        runtime.listEvidence(
          z.object({ sessionId: sessionIdSchema }).parse(input).sessionId,
        ),
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
        const parsed = z
          .object({ sessionId: sessionIdSchema, evidenceId: z.string().min(1) })
          .parse(input);
        return runtime.readEvidence(parsed.sessionId, parsed.evidenceId);
      },
    },
  ];
}
