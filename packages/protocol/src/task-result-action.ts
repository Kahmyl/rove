import { z } from "zod";

import {
  browserInteractionRequestSchema,
  expectedEffectSchema,
} from "./verified-interaction.js";

const materialFieldSchema = z.enum(["recipient", "content"]);

export const prepareTaskResultActionRequestSchema = z.object({
  observationId: z.string().min(1).max(200),
  consequenceKey: z.string().regex(/^task-result:[^:]{1,200}:[a-f0-9]{64}$/),
  materialDigest: z.string().regex(/^[a-f0-9]{64}$/),
  fieldBindings: z
    .array(
      z.object({
        field: materialFieldSchema,
        targetRef: z.string().min(1).max(200),
      }),
    )
    .max(2),
  attachmentBindings: z
    .array(
      z.object({
        evidenceId: z.string().startsWith("ev_"),
        targetRef: z.string().min(1).max(200),
      }),
    )
    .max(64)
    .default([]),
  commitAction: browserInteractionRequestSchema,
  expectedEffects: z.array(expectedEffectSchema).min(1).max(20),
  effect: z.enum(["external_commit", "irreversible"]),
});

export type PrepareTaskResultActionRequest = z.infer<
  typeof prepareTaskResultActionRequestSchema
>;

export interface TaskResultActionPlan {
  schemaVersion: 1;
  planId: string;
  consequenceKey: string;
  materialDigest: string;
  taskScope: string;
  browserWorkspaceScope: string;
  observationId: string;
  pageId: string;
  pageRevision: number;
  url: string;
  fields: readonly {
    field: "recipient" | "content";
    targetRef: string;
    targetName: string;
    targetKind: string;
    value: string;
  }[];
  attachments: readonly {
    evidenceId: string;
    filename: string;
    size: number;
    sha256: string;
    targetRef: string;
    targetName: string;
    uploadEffectId?: string;
    uploadPlanId?: string;
    uploadReceiptId?: string;
  }[];
  commitTarget?: {
    targetRef: string;
    targetName: string;
    targetKind: string;
    scopeLabels: readonly string[];
  };
  commitAction: PrepareTaskResultActionRequest["commitAction"];
  expectedEffects: PrepareTaskResultActionRequest["expectedEffects"];
  effect: PrepareTaskResultActionRequest["effect"];
  actionFingerprint: string;
  planDigest: string;
  preparedAt: string;
}
