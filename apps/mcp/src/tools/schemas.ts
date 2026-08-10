import { z } from "zod";

export const sessionIdSchema = z.string().min(1);
export const targetSchema = z.object({
  pageId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  ref: z.string().min(1),
});

export const emptyJsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

export const sessionIdJsonSchema = {
  type: "object",
  properties: { sessionId: { type: "string", minLength: 1 } },
  required: ["sessionId"],
  additionalProperties: false,
} as const;

export const targetJsonSchema = {
  type: "object",
  properties: {
    pageId: { type: "string", minLength: 1 },
    revision: { type: "integer", minimum: 0 },
    ref: { type: "string", minLength: 1 },
  },
  required: ["pageId", "revision", "ref"],
  additionalProperties: false,
} as const;
