import {
  controlWaitRequestSchema,
  requestHumanRequestSchema,
} from "@rove/protocol";
import { z } from "zod";
import type { RuntimeClient } from "../runtime/runtime-client.types.js";
import type { ToolDefinition } from "../server/register-tools.js";
import { sessionIdJsonSchema, sessionIdSchema } from "./schemas.js";

export function controlTools(runtime: RuntimeClient): ToolDefinition[] {
  const explicitlyRequestedHandoffs = new Map<
    string,
    { handoffId: string; handoffGeneration: number }
  >();

  return [
    {
      name: "control.status",
      description: "Read current browser control ownership.",
      inputSchema: sessionIdJsonSchema,
      handler: (input) =>
        runtime.getControlStatus(
          z.object({ sessionId: sessionIdSchema }).parse(input).sessionId,
        ),
    },
    {
      name: "control.request_human",
      description:
        "Pause automation and request human control when an agent-controlled session requires a human-only step such as sign-in, OAuth, MFA, CAPTCHA, passkey, account selection, consent, or security confirmation. Supply the exact instruction to run after control returns and an explicit continuation policy. If the user's requested outcome requires authentication, do not substitute an unauthenticated workflow. After requesting human control, stop browser mutations and use control.wait.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1, maxLength: 500 },
          instruction: { type: "string", minLength: 1, maxLength: 4000 },
          continuationPolicy: {
            type: "string",
            enum: ["resume_after_control_return", "explicit_user_response"],
          },
        },
        required: ["sessionId", "reason", "instruction", "continuationPolicy"],
        additionalProperties: false,
      },
      handler: async (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            reason: requestHumanRequestSchema.shape.reason,
            instruction: z.string().trim().min(1).max(4000),
            continuationPolicy: z.enum([
              "resume_after_control_return",
              "explicit_user_response",
            ]),
          })
          .strict()
          .parse(input);
        const status = await runtime.requestHuman(
          parsed.sessionId,
          parsed.reason,
        );
        if (
          status.sessionId !== parsed.sessionId ||
          status.status !== "awaiting_human" ||
          status.controller !== null ||
          status.activeHandoffId === undefined ||
          status.activeHandoffGeneration === undefined
        ) {
          throw new Error(
            "control.request_human did not return an exact active handoff identity",
          );
        }
        explicitlyRequestedHandoffs.set(parsed.sessionId, {
          handoffId: status.activeHandoffId,
          handoffGeneration: status.activeHandoffGeneration,
        });
        return status;
      },
    },
    {
      name: "control.wait",
      description:
        "Wait for the next durable control or terminal-session event. After a human handoff returns control to the agent, run browser.inspect again before further browser mutations because previous target references may be stale.",
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
      handler: async (input, signal) => {
        const parsed = z
          .object({ sessionId: sessionIdSchema })
          .extend(controlWaitRequestSchema.shape)
          .parse(input);
        const requestedHandoff = explicitlyRequestedHandoffs.get(
          parsed.sessionId,
        );
        const status = await runtime.getControlStatus(parsed.sessionId);
        if (
          requestedHandoff === undefined ||
          status.activeHandoffId !== requestedHandoff.handoffId ||
          status.activeHandoffGeneration !==
            requestedHandoff.handoffGeneration ||
          status.durableHandoffId !== requestedHandoff.handoffId ||
          status.durableHandoffGeneration !== requestedHandoff.handoffGeneration
        ) {
          throw new Error(
            "control.wait requires Companion durable acknowledgement of the exact successful control.request_human handoff; retry after bounded reconciliation",
          );
        }
        return runtime.waitForControl(
          parsed.sessionId,
          {
            ...(parsed.afterSeq === undefined
              ? {}
              : { afterSeq: parsed.afterSeq }),
            ...(parsed.timeoutMs === undefined
              ? {}
              : { timeoutMs: parsed.timeoutMs }),
          },
          signal,
        );
      },
    },
  ];
}
