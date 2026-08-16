import {
  clickRequestSchema,
  inspectOptionsSchema,
  navigateRequestSchema,
  pressRequestSchema,
  screenshotRequestSchema,
  scrollRequestSchema,
  typeRequestSchema,
} from "@rove/protocol";
import { z } from "zod";
import type { RuntimeClient } from "../runtime/runtime-client.types.js";
import type { ToolDefinition } from "../server/register-tools.js";
import {
  sessionIdJsonSchema,
  sessionIdSchema,
  targetJsonSchema,
  targetSchema,
} from "./schemas.js";

export function browserTools(runtime: RuntimeClient): ToolDefinition[] {
  return [
    {
      name: "browser.navigate",
      description:
        "Navigate the active page to an absolute http or https URL. Runtime policy may reject repeated, over-budget, or unsafe mutations. Stop and follow structured policy errors; never retry them in a tight loop.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          url: { type: "string" },
        },
        required: ["sessionId", "url"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({ sessionId: sessionIdSchema, url: z.string() })
          .parse(input);
        return runtime.navigate(
          parsed.sessionId,
          navigateRequestSchema.parse({ url: parsed.url }),
        );
      },
    },
    {
      name: "browser.inspect",
      description:
        "Inspect page text, actionable targets, page perception in metadata.pageState, and Runtime policy in metadata.pagePolicy. Inspection is observational and never requests or takes human control. A pagePolicy disposition of request_human means human collaboration is appropriate; stop means do not continue autonomous mutations; wait_and_inspect means mutation remains blocked while the page is unresolved or unstable. Never guess that an ambiguous page is a CAPTCHA or attempt human-only verification.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          pageId: { type: "string" },
          includeText: { type: "boolean", default: true },
          includeTargets: { type: "boolean", default: true },
          maxTextChars: {
            type: "integer",
            minimum: 1,
            maximum: 50000,
            default: 20000,
          },
          targetLimit: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            default: 200,
          },
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            pageId: z.string().optional(),
            includeText: z.boolean().optional().default(true),
            includeTargets: z.boolean().optional().default(true),
            maxTextChars: z
              .number()
              .int()
              .positive()
              .max(50_000)
              .optional()
              .default(20_000),
            targetLimit: z
              .number()
              .int()
              .positive()
              .max(500)
              .optional()
              .default(200),
          })
          .parse(input);
        const { sessionId, ...options } = parsed;
        return runtime.inspect(sessionId, inspectOptionsSchema.parse(options));
      },
    },
    {
      name: "browser.click",
      description:
        "Click an actionable target returned by browser.inspect. Do not rapidly repeat clicks. If policy rejects the action, inspect or request human control as directed instead of bypassing the limit.",
      inputSchema: targetToolSchema(),
      handler: (input) => {
        const parsed = z
          .object({ sessionId: sessionIdSchema, target: targetSchema })
          .parse(input);
        return runtime.click(
          parsed.sessionId,
          clickRequestSchema.parse({ target: parsed.target }),
        );
      },
    },
    {
      name: "browser.type",
      description:
        "Type text into an inspected target at Runtime-controlled pacing. Authentication secrets and human-verification responses must be entered only by the human during control handoff.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          target: targetJsonSchema,
          value: { type: "string", maxLength: 100000 },
        },
        required: ["sessionId", "target", "value"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            target: targetSchema,
            value: z.string().max(100_000),
          })
          .parse(input);
        return runtime.type(
          parsed.sessionId,
          typeRequestSchema.parse({
            target: parsed.target,
            value: parsed.value,
          }),
        );
      },
    },
    {
      name: "browser.press",
      description:
        "Press a key, optionally targeting an inspected element. Runtime policy rejects unsafe or repeated mutation campaigns.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          target: targetJsonSchema,
          key: { type: "string", minLength: 1, maxLength: 100 },
        },
        required: ["sessionId", "key"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            target: targetSchema.optional(),
            key: z.string().min(1).max(100),
          })
          .parse(input);
        return runtime.press(
          parsed.sessionId,
          pressRequestSchema.parse({ target: parsed.target, key: parsed.key }),
        );
      },
    },
    {
      name: "browser.scroll",
      description:
        "Scroll the active page by CSS pixels. Use bounded increments and inspect between repeated navigation or pagination steps.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          direction: { type: "string", enum: ["up", "down", "left", "right"] },
          amount: { type: "integer", minimum: 1, maximum: 10000, default: 600 },
        },
        required: ["sessionId", "direction"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            direction: z.enum(["up", "down", "left", "right"]),
            amount: z.number().int().min(1).max(10_000).optional().default(600),
          })
          .parse(input);
        return runtime.scroll(
          parsed.sessionId,
          scrollRequestSchema.parse(parsed),
        );
      },
    },
    {
      name: "browser.back",
      description: "Navigate the active page backward.",
      inputSchema: sessionIdJsonSchema,
      handler: (input) =>
        runtime.back(
          z.object({ sessionId: sessionIdSchema }).parse(input).sessionId,
        ),
    },
    {
      name: "browser.forward",
      description: "Navigate the active page forward.",
      inputSchema: sessionIdJsonSchema,
      handler: (input) =>
        runtime.forward(
          z.object({ sessionId: sessionIdSchema }).parse(input).sessionId,
        ),
    },
    {
      name: "browser.screenshot",
      description: "Capture a screenshot and return evidence metadata.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          mode: {
            type: "string",
            enum: ["viewport", "full-page"],
            default: "viewport",
          },
          label: { type: "string", maxLength: 200 },
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            mode: z
              .enum(["viewport", "full-page"])
              .optional()
              .default("viewport"),
            label: z.string().max(200).optional(),
          })
          .parse(input);
        return runtime.screenshot(
          parsed.sessionId,
          screenshotRequestSchema.parse({
            mode: parsed.mode,
            label: parsed.label,
          }),
        );
      },
    },
  ];
}

function targetToolSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      sessionId: { type: "string", minLength: 1 },
      target: targetJsonSchema,
    },
    required: ["sessionId", "target"],
    additionalProperties: false,
  };
}
