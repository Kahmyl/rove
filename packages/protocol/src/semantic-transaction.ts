import { z } from "zod";

import type { BrowserActionEffect } from "./action-authorization.js";
import type { RoveErrorCode } from "./errors.js";
import {
  browserInteractionRequestSchema,
  expectedEffectSchema,
  structuralScopeSchema,
  type ActionOutcome,
  type ActionReceipt,
  type EffectVerification,
  type ExpectedTarget,
} from "./verified-interaction.js";
import { targetReferenceSchema } from "./schemas.js";

export const semanticTransactionKindSchema = z.enum(["transfer"]);

export type SemanticTransactionKind = z.infer<
  typeof semanticTransactionKindSchema
>;

export const semanticTransactionMechanismSchema = z.enum([
  "menu",
  "keyboard",
  "drag",
  "file_picker",
  "direct",
]);

export type SemanticTransactionMechanism = z.infer<
  typeof semanticTransactionMechanismSchema
>;

const namedDestinationScopeSchema = structuralScopeSchema.extend({
  label: z.string().trim().min(1).max(500),
});

export const semanticTransactionDestinationSchema = z.discriminatedUnion(
  "verification",
  [
    z.object({
      verification: z.literal("within_scope"),
      scope: namedDestinationScopeSchema,
    }),
    z.object({
      verification: z.literal("destination_observation"),
      label: z.string().trim().min(1).max(500),
    }),
  ],
);

export type SemanticTransactionDestination = z.infer<
  typeof semanticTransactionDestinationSchema
>;

const compatibleSemanticTransactionDestinationSchema = z.union([
  semanticTransactionDestinationSchema,
  namedDestinationScopeSchema.transform((scope) => ({
    verification: "within_scope" as const,
    scope,
  })),
]);

export const beginSemanticTransactionRequestSchema = z.object({
  observationId: z.string().min(1).max(200),
  kind: semanticTransactionKindSchema,
  sourceTarget: targetReferenceSchema,
  destination: compatibleSemanticTransactionDestinationSchema,
  mechanism: semanticTransactionMechanismSchema,
  consequenceKey: z.string().trim().min(1).max(500),
});

export type BeginSemanticTransactionRequest = z.infer<
  typeof beginSemanticTransactionRequestSchema
>;

export const semanticTransactionPhaseSchema = z.enum(["prepare", "commit"]);

export type SemanticTransactionPhase = z.infer<
  typeof semanticTransactionPhaseSchema
>;

const transactionEffectSchema = z.enum([
  "navigate",
  "reversible_ui",
  "edit_content",
  "external_commit",
  "irreversible",
]);

export const advanceSemanticTransactionRequestSchema = z
  .object({
    transactionId: z.string().startsWith("tx_"),
    observationId: z.string().min(1).max(200),
    phase: semanticTransactionPhaseSchema,
    action: browserInteractionRequestSchema,
    expectedEffects: z.array(expectedEffectSchema).max(20),
    effect: transactionEffectSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.phase === "commit" && value.expectedEffects.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["expectedEffects"],
        message: "Commit phases require at least one verifiable effect.",
      });
    }
    if (
      value.phase === "prepare" &&
      value.expectedEffects.length === 0 &&
      !(
        value.action.kind === "clipboard" &&
        (value.action.operation === "copy" || value.action.operation === "cut")
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedEffects"],
        message:
          "Effect-free prepare is reserved for trusted clipboard staging.",
      });
    }
    if (
      value.phase === "prepare" &&
      (value.effect === "external_commit" || value.effect === "irreversible")
    ) {
      context.addIssue({
        code: "custom",
        path: ["effect"],
        message: "Prepare phases cannot declare a commit-level effect.",
      });
    }
  });

export type AdvanceSemanticTransactionRequest = z.infer<
  typeof advanceSemanticTransactionRequestSchema
>;

export const verifySemanticTransactionRequestSchema = z.object({
  transactionId: z.string().startsWith("tx_"),
  observationId: z.string().min(1).max(200),
  additionalExpectedEffects: z
    .array(expectedEffectSchema)
    .max(19)
    .optional()
    .default([]),
});

export type VerifySemanticTransactionRequest = z.infer<
  typeof verifySemanticTransactionRequestSchema
>;

export const semanticTransactionReferenceSchema = z.object({
  transactionId: z.string().startsWith("tx_"),
});

export type SemanticTransactionReference = z.infer<
  typeof semanticTransactionReferenceSchema
>;

export type SemanticTransactionStatus =
  | "prepared"
  | "in_progress"
  | "committed"
  | "verified"
  | "not_applied"
  | "uncertain"
  | "cancelled";

export interface SemanticTransactionStep {
  phase: SemanticTransactionPhase;
  receiptId: string;
  action: ActionReceipt["action"];
  outcome: ActionOutcome;
  dispatchStatus: ActionReceipt["dispatchStatus"];
  evidenceBasis: "verified_effect" | "trusted_dispatch" | "unverified";
  predecessorObservationId?: string;
  successorObservationId?: string;
}

export interface SemanticTransactionSnapshot {
  transactionId: string;
  sessionId: string;
  kind: SemanticTransactionKind;
  status: SemanticTransactionStatus;
  mechanism: SemanticTransactionMechanism;
  sourceAuthority: z.infer<typeof targetReferenceSchema>;
  source: ExpectedTarget;
  destination: SemanticTransactionDestination;
  consequenceKey: string;
  createdAt: string;
  updatedAt: string;
  steps: SemanticTransactionStep[];
  degradations?: Array<{
    stage: "transaction_persistence";
    code: RoveErrorCode;
  }>;
  verification?: {
    observationId: string;
    outcome: ActionOutcome;
    effects: EffectVerification[];
  };
}

export interface SemanticTransactionAdvanceResult {
  transaction: SemanticTransactionSnapshot;
  receipt: ActionReceipt;
}

export interface SemanticTransactionVerificationResult {
  transaction: SemanticTransactionSnapshot;
  outcome: ActionOutcome;
  effects: EffectVerification[];
}

export function transactionCommitEffect(
  declared: BrowserActionEffect | undefined,
): BrowserActionEffect {
  return declared === "irreversible" ? "irreversible" : "external_commit";
}
