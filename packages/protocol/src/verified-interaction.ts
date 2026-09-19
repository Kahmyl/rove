import { z } from "zod";
import type { BrowserActionEffect } from "./action-authorization.js";

import { targetKindSchema, targetReferenceSchema } from "./schemas.js";

export const targetCapabilitySchema = z.enum([
  "activate",
  "double_activate",
  "secondary_activate",
  "fill",
  "set_value",
  "select",
  "select_text",
  "check",
  "uncheck",
  "expand",
  "collapse",
  "focus",
  "press",
  "clipboard",
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
  "list",
  "listbox",
  "tree",
  "grid",
  "table",
  "menu",
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
    kind: targetKindSchema.optional(),
    capability: targetCapabilitySchema.optional(),
    text: z.string().trim().min(1).max(500).optional(),
    scope: structuralScopeSchema.optional(),
    frameLabel: z.string().trim().min(1).max(500).optional(),
  })
  .refine(
    (value) =>
      value.capability !== undefined ||
      value.kind !== undefined ||
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

export const expectedTargetSchema = z.object({
  name: z.string().trim().min(1).max(500),
  kind: targetKindSchema.optional(),
});

export type ExpectedTarget = z.infer<typeof expectedTargetSchema>;

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
    kind: z.literal("target_focused"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("target_blurred"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("target_expanded"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("target_collapsed"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("target_pressed"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("target_unpressed"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("target_selected"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("target_unselected"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("target_open"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("target_closed"),
    target: expectedTargetSchema,
  }),
  z.object({
    kind: z.literal("target_value"),
    target: expectedTargetSchema,
    value: z.string().max(100_000),
  }),
  z.object({
    kind: z.literal("target_files"),
    target: expectedTargetSchema,
    files: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(500),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .min(1)
      .max(100),
  }),
  z.object({
    kind: z.literal("target_numeric_value"),
    target: expectedTargetSchema,
    value: z.number().finite(),
  }),
  z.object({
    kind: z.literal("target_within_scope"),
    target: expectedTargetSchema,
    scope: structuralScopeSchema,
  }),
  z.object({
    kind: z.literal("target_outside_scope"),
    target: expectedTargetSchema,
    scope: structuralScopeSchema,
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
  z.object({
    kind: z.literal("download_completed"),
    filename: z.string().trim().min(1).max(500).optional(),
  }),
]);

export type ExpectedEffect = z.infer<typeof expectedEffectSchema>;

export const reconcileConsequentialEffectRequestSchema = z
  .object({
    consequenceKey: z.string().trim().min(1).max(500),
    observationId: z.string().min(1).max(200),
  })
  .strict();

export type ReconcileConsequentialEffectRequest = z.infer<
  typeof reconcileConsequentialEffectRequestSchema
>;

export interface ConsequentialEffectReconciliationResult {
  effectId: string;
  consequenceKey: string;
  state: "applied" | "not_applied" | "unresolved";
  version: number;
  observationId?: string;
  settled: boolean;
}

const targetActionBase = {
  target: targetReferenceSchema,
  dialog: dialogDirectiveSchema.optional(),
};

export const keyboardModifierSchema = z.enum([
  "Alt",
  "Control",
  "Meta",
  "Shift",
]);

export type KeyboardModifier = z.infer<typeof keyboardModifierSchema>;

const browserInteractionRequestBaseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("click"),
    ...targetActionBase,
  }),
  z.object({
    kind: z.literal("double_click"),
    ...targetActionBase,
  }),
  z.object({
    kind: z.literal("secondary_click"),
    ...targetActionBase,
  }),
  z.object({
    kind: z.literal("modified_click"),
    ...targetActionBase,
    modifiers: z.array(keyboardModifierSchema).min(1).max(4),
  }),
  z.object({
    kind: z.literal("hover"),
    ...targetActionBase,
  }),
  z.object({
    kind: z.literal("focus"),
    ...targetActionBase,
  }),
  z.object({
    kind: z.literal("blur"),
    ...targetActionBase,
  }),
  z.object({
    kind: z.literal("press"),
    target: targetReferenceSchema.optional(),
    dialog: dialogDirectiveSchema.optional(),
    key: z.string().trim().min(1).max(100),
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
    kind: z.literal("type_sequential"),
    ...targetActionBase,
    value: z.string().max(100_000),
    delayMs: z.number().int().min(0).max(1_000).optional().default(0),
  }),
  z.object({
    kind: z.literal("select_text"),
    ...targetActionBase,
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
    evidenceId: z.string().startsWith("ev_").optional(),
    evidenceIds: z
      .array(z.string().startsWith("ev_"))
      .min(1)
      .max(100)
      .optional(),
  }),
  z.object({
    kind: z.literal("clipboard"),
    target: targetReferenceSchema.optional(),
    dialog: dialogDirectiveSchema.optional(),
    operation: z.enum(["copy", "cut", "paste"]),
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

export const browserInteractionRequestSchema =
  browserInteractionRequestBaseSchema.superRefine((value, context) => {
    if (value.kind !== "upload") return;
    const count =
      (value.evidenceId === undefined ? 0 : 1) +
      (value.evidenceIds === undefined ? 0 : 1);
    if (count !== 1) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIds"],
        message: "Upload requires exactly one of evidenceId or evidenceIds.",
      });
    }
  });

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
    effect: z
      .enum([
        "observe",
        "recover",
        "navigate",
        "reversible_ui",
        "edit_content",
        "external_commit",
        "irreversible",
        "credential_entry",
      ] satisfies BrowserActionEffect[])
      .optional(),
    consequenceKey: z.string().trim().min(1).max(500).optional(),
    authorizationDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    authorizedPlanId: z
      .string()
      .regex(/^plan_[a-f0-9]{32}$/)
      .optional(),
  })
  .superRefine((value, context) => {
    if (
      value.expectedEffects.filter(
        (effect) => effect.kind === "download_completed",
      ).length > 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedEffects"],
        message:
          "A verified interaction supports at most one download_completed effect.",
      });
    }
    if (
      value.expectedEffects.some(
        (effect) => effect.kind === "download_completed",
      ) &&
      value.action.kind !== "click"
    ) {
      context.addIssue({
        code: "custom",
        path: ["action", "kind"],
        message:
          "download_completed currently requires a grounded click action.",
      });
    }
    if (value.consequential && value.consequenceKey === undefined) {
      context.addIssue({
        code: "custom",
        path: ["consequenceKey"],
        message: "Consequential actions require a stable consequence key.",
      });
    }
    if (
      value.consequenceKey?.startsWith("task-result:") &&
      !value.consequential
    ) {
      context.addIssue({
        code: "custom",
        path: ["consequential"],
        message: "Task-result actions must be marked consequential.",
      });
    }
    if (
      value.consequenceKey?.startsWith("task-result:") &&
      (value.authorizationDigest === undefined ||
        value.authorizedPlanId === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path:
          value.authorizationDigest === undefined
            ? ["authorizationDigest"]
            : ["authorizedPlanId"],
        message:
          "Task-result actions require the exact registered authorization and concrete plan.",
      });
    }
    if (
      (value.effect === "external_commit" || value.effect === "irreversible") &&
      !value.consequential
    ) {
      context.addIssue({
        code: "custom",
        path: ["consequential"],
        message:
          "External or irreversible interactions must be marked consequential.",
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
  observationId?: string;
  evidenceId?: string;
  code?: string;
}

export type ActionExecutionPhase =
  "preflight" | "engage" | "progress" | "commit" | "synchronize";

export interface ActionPhaseRecord {
  phase: ActionExecutionPhase;
  status: "completed" | "skipped" | "uncertain";
  strategy?: string;
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
  phases?: ActionPhaseRecord[];
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
