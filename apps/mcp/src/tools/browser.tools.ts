import {
  clickRequestSchema,
  inspectOptionsSchema,
  navigateRequestSchema,
  pressRequestSchema,
  screenshotRequestSchema,
  scrollRequestSchema,
  typeRequestSchema,
  targetResolutionRequestSchema,
  verifiedInteractionRequestSchema,
} from "@rove/protocol";
import { z } from "zod";
import type { RuntimeClient } from "../runtime/runtime-client.types.js";
import type { ToolDefinition } from "../server/register-tools.js";
import { toolSuccessWithImage } from "../server/tool-result.js";
import {
  sessionIdJsonSchema,
  sessionIdSchema,
  targetJsonSchema,
  targetSchema,
} from "./schemas.js";

const dialogDirectiveJsonSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        action: {
          const: "dismiss",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        action: {
          const: "accept",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        action: {
          const: "accept_prompt",
        },
        value: {
          type: "string",
          maxLength: 10000,
        },
      },
      required: ["action", "value"],
      additionalProperties: false,
    },
  ],
} as const;

const browserInteractionActionJsonSchema = {
  oneOf: [
    ...["click", "hover", "clear", "check", "uncheck"].map((kind) => ({
      type: "object",
      properties: {
        kind: {
          const: kind,
        },
        target: targetJsonSchema,
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "target"],
      additionalProperties: false,
    })),
    {
      type: "object",
      properties: {
        kind: {
          const: "fill",
        },
        target: targetJsonSchema,
        value: {
          type: "string",
          maxLength: 100000,
        },
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "target", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: {
          const: "select",
        },
        target: targetJsonSchema,
        values: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "string",
            maxLength: 5000,
          },
        },
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "target", "values"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: {
          const: "drag",
        },
        target: targetJsonSchema,
        destination: targetJsonSchema,
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "target", "destination"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: {
          const: "upload",
        },
        target: targetJsonSchema,
        evidenceId: {
          type: "string",
          pattern: "^ev_",
        },
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "target", "evidenceId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: {
          const: "precise_scroll",
        },
        target: targetJsonSchema,
        deltaX: {
          type: "number",
          minimum: -100000,
          maximum: 100000,
        },
        deltaY: {
          type: "number",
          minimum: -100000,
          maximum: 100000,
        },
      },
      required: ["kind", "deltaX", "deltaY"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: {
          const: "coordinate_click",
        },
        target: targetJsonSchema,
        observationId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
        },
        offsetX: {
          type: "number",
        },
        offsetY: {
          type: "number",
        },
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "target", "observationId", "offsetX", "offsetY"],
      additionalProperties: false,
    },
  ],
} as const;

const expectedTargetJsonSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 500,
    },
    kind: {
      type: "string",
      enum: [
        "button",
        "link",
        "input",
        "textarea",
        "select",
        "checkbox",
        "radio",
        "tab",
        "menuitem",
        "option",
        "control",
      ],
    },
  },
  required: ["name"],
  additionalProperties: false,
} as const;

const expectedEffectJsonSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: {
          const: "url_equals",
        },
        url: {
          type: "string",
          format: "uri",
        },
      },
      required: ["kind", "url"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: {
          const: "url_changed",
        },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    ...["text_present", "text_absent"].map((kind) => ({
      type: "object",
      properties: {
        kind: {
          const: kind,
        },
        text: {
          type: "string",
          minLength: 1,
          maxLength: 5000,
        },
      },
      required: ["kind", "text"],
      additionalProperties: false,
    })),
    ...[
      "target_present",
      "target_absent",
      "target_enabled",
      "target_disabled",
      "target_checked",
      "target_unchecked",
    ].map((kind) => ({
      type: "object",
      properties: {
        kind: {
          const: kind,
        },
        target: expectedTargetJsonSchema,
      },
      required: ["kind", "target"],
      additionalProperties: false,
    })),
    {
      type: "object",
      properties: {
        kind: {
          const: "selected_value",
        },
        target: expectedTargetJsonSchema,
        value: {
          type: "string",
          maxLength: 5000,
        },
      },
      required: ["kind", "target", "value"],
      additionalProperties: false,
    },
    ...["page_opened", "page_closed"].map((kind) => ({
      type: "object",
      properties: {
        kind: {
          const: kind,
        },
      },
      required: ["kind"],
      additionalProperties: false,
    })),
  ],
} as const;

export function browserTools(runtime: RuntimeClient): ToolDefinition[] {
  return [
    {
      name: "browser.resolve_target",
      description:
        "Resolve an intended browser control against one exact current BrowserObservation. Returns selected, ambiguous, or unresolved grounding and never bypasses the existing TargetReference authority.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            minLength: 1,
          },
          observationId: {
            type: "string",
            minLength: 1,
            maxLength: 200,
          },
          intent: {
            type: "object",
            properties: {
              capability: {
                type: "string",
                enum: [
                  "activate",
                  "fill",
                  "select",
                  "check",
                  "uncheck",
                  "hover",
                  "drag",
                  "upload",
                  "scroll",
                ],
              },
              text: {
                type: "string",
                minLength: 1,
                maxLength: 500,
              },
              scope: {
                type: "object",
                properties: {
                  kind: {
                    type: "string",
                    enum: ["form", "dialog", "card", "row", "region", "group"],
                  },
                  label: {
                    type: "string",
                    maxLength: 500,
                  },
                },
                required: ["kind"],
                additionalProperties: false,
              },
              frameLabel: {
                type: "string",
                minLength: 1,
                maxLength: 500,
              },
            },
            additionalProperties: false,
          },
        },
        required: ["sessionId", "observationId", "intent"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            observationId: z.string().min(1).max(200),
            intent: z.unknown(),
          })
          .parse(input);

        return runtime.resolveTarget(
          parsed.sessionId,
          targetResolutionRequestSchema.parse({
            observationId: parsed.observationId,
            intent: parsed.intent,
          }),
        );
      },
    },
    {
      name: "browser.interact",
      description:
        "Perform a grounded Phase 2 browser interaction through Playwright, collect a successor observation, verify bounded expected effects, and return an ActionReceipt. Consequential actions require a stable consequenceKey; an unknown consequential outcome blocks automatic replay of that same key.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            minLength: 1,
          },
          observationId: {
            type: "string",
            minLength: 1,
            maxLength: 200,
          },
          action: browserInteractionActionJsonSchema,
          expectedEffects: {
            type: "array",
            maxItems: 20,
            items: expectedEffectJsonSchema,
          },
          consequential: {
            type: "boolean",
            default: false,
          },
          consequenceKey: {
            type: "string",
            minLength: 1,
            maxLength: 500,
          },
        },
        required: ["sessionId", "observationId", "action"],
        allOf: [
          {
            if: {
              properties: {
                consequential: {
                  const: true,
                },
              },
              required: ["consequential"],
            },
            then: {
              required: ["consequenceKey"],
            },
          },
        ],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            observationId: z.string().min(1).max(200),
            action: z.unknown(),
            expectedEffects: z
              .array(z.unknown())
              .max(20)
              .optional()
              .default([]),
            consequential: z.boolean().optional().default(false),
            consequenceKey: z.string().min(1).max(500).optional(),
          })
          .parse(input);

        return runtime.interact(
          parsed.sessionId,
          verifiedInteractionRequestSchema.parse({
            observationId: parsed.observationId,
            action: parsed.action,
            expectedEffects: parsed.expectedEffects,
            consequential: parsed.consequential,
            consequenceKey: parsed.consequenceKey,
          }),
        );
      },
    },
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
          includeViewport: { type: "boolean", default: true },
          includeStructure: { type: "boolean", default: true },
          maxTextChars: {
            type: "integer",
            minimum: 1,
            maximum: 50000,
            default: 20000,
          },
          maxStructureChars: {
            type: "integer",
            minimum: 1,
            maximum: 30000,
            default: 12000,
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
            includeViewport: z.boolean().optional().default(true),
            includeStructure: z.boolean().optional().default(true),
            maxTextChars: z
              .number()
              .int()
              .positive()
              .max(50_000)
              .optional()
              .default(20_000),
            maxStructureChars: z
              .number()
              .int()
              .positive()
              .max(30_000)
              .optional()
              .default(12_000),
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
      description:
        "Capture browser visual evidence. Viewport and region captures can include bounded inline PNG content while preserving durable screenshot evidence. Pass observationId to bind capture to an exact current observation.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            minLength: 1,
          },
          mode: {
            type: "string",
            enum: ["viewport", "full-page", "target", "region"],
            default: "viewport",
          },
          target: targetJsonSchema,

          region: {
            type: "object",
            properties: {
              x: {
                type: "number",
                minimum: 0,
              },
              y: {
                type: "number",
                minimum: 0,
              },
              width: {
                type: "number",
                exclusiveMinimum: 0,
              },
              height: {
                type: "number",
                exclusiveMinimum: 0,
              },
            },
            required: ["x", "y", "width", "height"],
            additionalProperties: false,
          },
          observationId: {
            type: "string",
            minLength: 1,
            maxLength: 200,
          },
          label: {
            type: "string",
            maxLength: 200,
          },
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
      present: toolSuccessWithImage,
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            mode: z
              .enum(["viewport", "full-page", "target", "region"])
              .optional()
              .default("viewport"),
            target: targetSchema.optional(),

            region: z
              .object({
                x: z.number().finite().nonnegative(),
                y: z.number().finite().nonnegative(),
                width: z.number().finite().positive(),
                height: z.number().finite().positive(),
              })
              .optional(),
            observationId: z.string().min(1).max(200).optional(),
            label: z.string().max(200).optional(),
          })
          .parse(input);

        return runtime.screenshot(
          parsed.sessionId,
          screenshotRequestSchema.parse({
            mode: parsed.mode,
            target: parsed.target,
            region: parsed.region,
            observationId: parsed.observationId,
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
