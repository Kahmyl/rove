import { z } from "zod";

import { targetKindSchema, targetReferenceSchema } from "./schemas.js";

export const targetCapabilitySchema = z.enum([
  "activate",
  "fill",
  "select",
  "check",
  "uncheck",
  "hover",
  "drag",
  "upload",
  "scroll",
]);

export type TargetCapability = z.infer<typeof targetCapabilitySchema>;

export const structuralScopeKindSchema = z.enum([
  "form",
  "dialog",
  "card",
  "row",
  "region",
  "group",
]);

export type StructuralScopeKind = z.infer<typeof structuralScopeKindSchema>;

export const structuralScopeSchema = z.object({
  kind: structuralScopeKindSchema,
  label: z.string().max(500).optional(),
});

export type StructuralScope = z.infer<typeof structuralScopeSchema>;

export interface PerceivedControl {
  capabilities: TargetCapability[];
  scopes: StructuralScope[];
}

export const targetIntentSchema = z
  .object({
    capability: targetCapabilitySchema.optional(),
    text: z.string().trim().min(1).max(500).optional(),
    scope: structuralScopeSchema.optional(),
    frameLabel: z.string().trim().min(1).max(500).optional(),
  })
  .refine(
    (value) =>
      value.capability !== undefined ||
      value.text !== undefined ||
      value.scope !== undefined ||
      value.frameLabel !== undefined,
    {
      message: "Target intent requires at least one grounding constraint.",
    },
  );

export type TargetIntent = z.infer<typeof targetIntentSchema>;

export const targetResolutionRequestSchema = z.object({
  observationId: z.string().min(1).max(200),
  intent: targetIntentSchema,
});

export type TargetResolutionRequest = z.infer<
  typeof targetResolutionRequestSchema
>;

export interface TargetResolutionAlternative {
  target: {
    pageId: string;
    revision: number;
    ref: string;
  };
  actionable: boolean;
  evidence: string[];
}

export interface TargetResolution {
  observationId: string;
  status: "selected" | "ambiguous" | "unresolved";
  target?: {
    pageId: string;
    revision: number;
    ref: string;
  };
  alternatives: TargetResolutionAlternative[];
  reason:
    | "grounded"
    | "no_candidate"
    | "best_candidate_not_actionable"
    | "insufficient_separation"
    | "semantic_gap";
}

export const dialogDirectiveSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("dismiss"),
  }),
  z.object({
    action: z.literal("accept"),
  }),
  z.object({
    action: z.literal("accept_prompt"),
    value: z.string().max(10_000),
  }),
]);

export type DialogDirective = z.infer<typeof dialogDirectiveSchema>;

const expectedTargetSchema = z.object({
  name: z.string().trim().min(1).max(500),
  kind: targetKindSchema.optional(),
});

export const expectedEffectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url_equals"),
    url: z.string().url(),
  }),
  z.object({
    kind: z.literal("url_changed"),
  }),
  z.object({
    kind: z.literal("text_present"),
    text: z.string().min(1).max(5_000),
  }),
  z.object({
    kind: z.literal("text_absent"),
    text: z.string().min(1).max(5_000),
  }),
  z.object({
    kind: z.literal("target_present"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("target_absent"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("target_enabled"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("target_disabled"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("target_checked"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("target_unchecked"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("selected_value"),
    target: expectedTargetSchema,
    value: z.string().max(5_000),
  }),
  z.object({
    kind: z.literal("page_opened"),
  }),
  z.object({
    kind: z.literal("page_closed"),
  }),
]);

export type ExpectedEffect = z.infer<typeof expectedEffectSchema>;

const targetActionBase = {
  target: targetReferenceSchema,
  dialog: dialogDirectiveSchema.optional(),
};

export const browserInteractionRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("click"),
    ...targetActionBase,
  }),
  z.object({
    kind: z.literal("hover"),
    ...targetActionBase,
  }),
  z.object({
    kind: z.literal("clear"),
    ...targetActionBase,
  }),
  z.object({
    kind: z.literal("fill"),
    ...targetActionBase,
    value: z.string().max(100_000),
  }),
  z.object({
    kind: z.literal("select"),
    ...targetActionBase,
    values: z.array(z.string().max(5_000)).min(1).max(100),
  }),
  z.object({
    kind: z.literal("check"),
    ...targetActionBase,
  }),
  z.object({
    kind: z.literal("uncheck"),
    ...targetActionBase,
  }),
  z.object({
    kind: z.literal("drag"),
    ...targetActionBase,
    destination: targetReferenceSchema,
  }),
  z.object({
    kind: z.literal("upload"),
    ...targetActionBase,
    evidenceId: z.string().startsWith("ev_"),
  }),
  z.object({
    kind: z.literal("precise_scroll"),
    target: targetReferenceSchema.optional(),
    deltaX: z.number().finite().min(-100_000).max(100_000),
    deltaY: z.number().finite().min(-100_000).max(100_000),
  }),
  z.object({
    kind: z.literal("coordinate_click"),
    ...targetActionBase,
    observationId: z.string().min(1).max(200),
    offsetX: z.number().finite(),
    offsetY: z.number().finite(),
  }),
]);

export type BrowserInteractionRequest = z.infer<
  typeof browserInteractionRequestSchema
>;

export const verifiedInteractionRequestSchema = z
  .object({
    observationId: z.string().min(1).max(200),
    action: browserInteractionRequestSchema,
    expectedEffects: z
      .array(expectedEffectSchema)
      .max(20)
      .optional()
      .default([]),
    consequential: z.boolean().optional().default(false),
    consequenceKey: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((value, context) => {
    if (value.consequential && value.consequenceKey === undefined) {
      context.addIssue({
        code: "custom",
        path: ["consequenceKey"],
        message: "Consequential actions require a stable consequence key.",
      });
    }
  });

export type VerifiedInteractionRequest = z.infer<
  typeof verifiedInteractionRequestSchema
>;

export type ActionOutcome = "applied" | "not_applied" | "unknown";

export interface EffectVerification {
  effect: ExpectedEffect;
  state: "observed" | "contradicted" | "unresolved";
}

export interface ActionReceipt {
  receiptId: string;
  sessionId: string;
  action: BrowserInteractionRequest["kind"];
  dispatched: boolean;
  dispatchStatus: "completed" | "uncertain";
  outcome: ActionOutcome;
  consequential: boolean;
  consequenceKey?: string;
  predecessorObservationId?: string;
  successorObservationId?: string;
  target?: {
    pageId: string;
    revision: number;
    ref: string;
  };
  effects: EffectVerification[];
  pageChanged?: boolean;
  previousRevision?: number;
  currentRevision?: number;
  url?: string;
  openedPages?: Array<{
    id: string;
    url: string;
    title?: string;
    active: boolean;
    revision: number;
  }>;
  degradations?: Array<{
    stage:
      | "action_dispatch"
      | "page_synchronization"
      | "successor_inspection"
      | "page_inventory"
      | "receipt_persistence"
      | "page_policy";
    code: string;
  }>;
}
