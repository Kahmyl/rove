import { z } from "zod";

export const sessionModeSchema = z.enum(["agent", "companion", "capture"]);
export const sessionStatusSchema = z.enum([
  "starting",
  "active",
  "paused",
  "awaiting_human",
  "completed",
  "failed",
]);
export const controllerSchema = z.enum(["agent", "human"]).nullable();
export const actorSchema = z.enum(["agent", "human", "browser", "system"]);
export const humanHandoffSchema = z.object({
  reason: z.string().min(1).max(500),
  requestedAt: z.string().datetime(),
});

export const temporaryProfileSchema = z.object({ mode: z.literal("temporary") });
export const persistentProfileSchema = z.object({
  mode: z.literal("persistent"),
  name: z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
});
export const existingProfileSchema = z.object({
  mode: z.literal("existing"),
  userDataDir: z.string().min(1),
  profileDirectory: z.string().min(1).optional(),
});
export const browserProfileSchema = z.discriminatedUnion("mode", [
  temporaryProfileSchema,
  persistentProfileSchema,
  existingProfileSchema,
]);

export const browserRuntimeCapabilitiesSchema = z.object({
  browserFamily: z.literal("chromium"),
  distribution: z.enum(["chrome", "chromium"]),
  browserVersion: z.string().min(1),
  headless: z.boolean(),
  profile: z.object({
    mode: z.enum(["temporary", "persistent"]),
    name: z.string().optional(),
  }),
  downloads: z.object({
    managed: z.boolean(),
    evidence: z.boolean(),
  }),
  storage: z.object({
    cookies: z.boolean(),
    localStorage: z.boolean(),
    indexedDb: z.boolean(),
    cacheStorage: z.boolean(),
    sessionStorage: z.enum(["isolated_per_context", "page_scoped"]),
    serviceWorkers: z.boolean(),
  }),
  humanInteraction: z.object({
    available: z.boolean(),
  }),
  sandbox: z.object({
    requested: z.union([z.boolean(), z.literal("unknown")]),
    verified: z.union([
      z.literal("enabled"),
      z.literal("disabled"),
      z.literal("unknown"),
    ]),
  }),
  diagnostics: z.array(z.object({
    level: z.enum(["info", "warning"]),
    code: z.string(),
    message: z.string(),
  })),
});

export const sessionSchema = z.object({
  id: z.string().startsWith("ses_"),
  mode: sessionModeSchema,
  status: sessionStatusSchema,
  controller: controllerSchema,
  activePageId: z.string().optional(),
  handoff: humanHandoffSchema.optional(),
  profile: browserProfileSchema,
  browserRuntime: browserRuntimeCapabilitiesSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
});

export const startSessionRequestSchema = z.object({
  mode: sessionModeSchema,
  profile: browserProfileSchema.optional().default({ mode: "temporary" }),
  startUrl: z.string().url().optional(),
});

export const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  }, "URL must use http or https.");

export const targetKindSchema = z.enum([
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
]);

export const targetReferenceSchema = z.object({
  pageId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  ref: z.string().min(1),
});

export const inspectOptionsSchema = z.object({
  includeText: z.boolean().optional(),
  includeTargets: z.boolean().optional(),
  includeViewport: z.boolean().optional(),
  maxTextChars: z.number().int().positive().max(50_000).optional(),
  targetLimit: z.number().int().positive().max(500).optional(),
  targetKinds: z.array(targetKindSchema).optional(),
  pageId: z.string().optional(),
});

export const navigateRequestSchema = z.object({ url: httpUrlSchema });
export const clickRequestSchema = z.object({ target: targetReferenceSchema });
export const typeRequestSchema = z.object({
  target: targetReferenceSchema,
  value: z.string().max(100_000),
});
export const pressRequestSchema = z.object({
  target: targetReferenceSchema.optional(),
  key: z.string().min(1).max(100),
});
export const scrollOptionsSchema = z.object({
  direction: z.enum(["up", "down", "left", "right"]),
  amount: z.number().int().min(1).max(10_000).optional().default(600),
});
export const scrollRequestSchema = scrollOptionsSchema;
export const screenshotOptionsSchema = z.object({
  mode: z.enum(["viewport", "full-page", "target"]).optional().default("viewport"),
  target: targetReferenceSchema.optional(),
  label: z.string().max(200).optional(),
});
export const screenshotRequestSchema = screenshotOptionsSchema;
export const switchPageRequestSchema = z.object({ pageId: z.string().min(1) });

export const observationSchema = z.object({
  id: z.string().startsWith("obs_"),
  seq: z.number().int().positive(),
  timestamp: z.string().datetime(),
  actor: actorSchema,
  type: z.string().min(1),
  pageId: z.string().optional(),
  pageRevision: z.number().int().nonnegative().optional(),
  data: z.unknown(),
});

export const observationQuerySchema = z.object({
  afterSeq: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(1_000).optional().default(100),
});

export const evidenceTypeSchema = z.enum(["screenshot", "text", "page", "record", "file"]);
export const evidenceSchema = z.object({
  id: z.string().startsWith("ev_"),
  sessionId: z.string().startsWith("ses_"),
  type: evidenceTypeSchema,
  label: z.string().max(200).optional(),
  pageId: z.string().optional(),
  pageRevision: z.number().int().nonnegative().optional(),
  url: z.string().url().optional(),
  createdAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const saveEvidenceRequestSchema = z.object({
  type: evidenceTypeSchema,
  label: z.string().max(200).optional(),
  pageId: z.string().optional(),
  pageRevision: z.number().int().nonnegative().optional(),
  url: z.string().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  payload: z.union([z.string(), z.record(z.string(), z.unknown())]),
});

export const evidenceReadResultSchema = evidenceSchema.extend({
  content: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  binary: z
    .object({
      available: z.literal(true),
      encoding: z.literal("external"),
    })
    .optional(),
});

export const requestHumanRequestSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export const controlWaitRequestSchema = z.object({
  afterSeq: z.number().int().nonnegative().optional(),
  timeoutMs: z.number().int().nonnegative().max(60_000).optional(),
});
