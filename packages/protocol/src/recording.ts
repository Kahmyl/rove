import { z } from "zod";

export const recordingStateSchema = z.enum([
  "requested",
  "recording",
  "finalizing",
  "available",
  "failed",
]);

export const recordingScopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("page"),
    pageId: z.string().startsWith("page_"),
    url: z.string().url(),
  }),
  z.object({
    kind: z.literal("browser_window"),
    windowId: z.number().int().positive(),
    pageId: z.string().startsWith("page_"),
  }),
]);

export const recordingArtifactSchema = z.object({
  artifactId: z.string().regex(/^rec_[a-f0-9]{32}$/u),
  filename: z.string().min(1).max(200),
  mimeType: z.literal("video/webm"),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  playable: z.boolean(),
  partial: z.boolean(),
});

export const recordingFailureSchema = z.object({
  code: z.enum([
    "PERMISSION_REFUSED",
    "SENSITIVE_SCOPE_UNSUPPORTED",
    "SOURCE_UNAVAILABLE",
    "CAPTURE_INTERRUPTED",
    "FINALIZATION_FAILED",
    "ARTIFACT_INVALID",
  ]),
  message: z.string().min(1).max(500),
});

export const recordingSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^rec_[a-f0-9]{32}$/u),
    taskId: z.string().min(1).max(255),
    sessionId: z.string().startsWith("ses_"),
    mode: z.enum(["agent", "companion", "capture"]),
    state: recordingStateSchema,
    scope: recordingScopeSchema,
    sensitiveDataPolicy: z.literal("user_confirmed_visible_content"),
    includesAudio: z.literal(false),
    coverage: z.string().min(1).max(500),
    exclusions: z.array(z.string().min(1).max(200)).min(1).max(12),
    requestedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    startedAt: z.string().datetime().optional(),
    stoppedAt: z.string().datetime().optional(),
    artifact: recordingArtifactSchema.optional(),
    failure: recordingFailureSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      ["recording", "finalizing", "available"].includes(value.state) &&
      value.startedAt === undefined
    )
      context.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "Started recordings require a start timestamp.",
      });
    if (
      ["finalizing", "available"].includes(value.state) &&
      value.stoppedAt === undefined
    )
      context.addIssue({
        code: "custom",
        path: ["stoppedAt"],
        message: "Finalized recordings require a stop timestamp.",
      });
    if (
      value.state === "requested" &&
      (value.startedAt !== undefined || value.stoppedAt !== undefined)
    )
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "Requested recordings cannot contain capture timestamps.",
      });
    if (value.artifact !== undefined && value.artifact.artifactId !== value.id)
      context.addIssue({
        code: "custom",
        path: ["artifact", "artifactId"],
        message: "Recording artifact identity must match its recording.",
      });
    if (
      value.state === "available" &&
      (value.artifact === undefined ||
        !value.artifact.playable ||
        value.artifact.partial)
    )
      context.addIssue({
        code: "custom",
        path: ["artifact"],
        message: "Available recordings require a playable artifact.",
      });
    if (value.state === "failed" && value.failure === undefined)
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "Failed recordings require a failure reason.",
      });
    if (value.state !== "failed" && value.failure !== undefined)
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "Only failed recordings may contain a failure reason.",
      });
    if (
      value.artifact !== undefined &&
      value.state !== "available" &&
      !(value.state === "failed" && value.artifact.partial)
    )
      context.addIssue({
        code: "custom",
        path: ["artifact"],
        message: "Recording artifact state is invalid.",
      });
  });

export const startRecordingRequestSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("page"),
    taskId: z.string().min(1).max(255),
    pageId: z.string().startsWith("page_").optional(),
    sensitiveDataPolicy: z.literal("user_confirmed_visible_content"),
    confirmUnmaskedSensitiveContent: z.literal(true),
  }),
  z.object({
    scope: z.literal("browser_window"),
    taskId: z.string().min(1).max(255),
    sensitiveDataPolicy: z.literal("user_confirmed_visible_content"),
    confirmUnmaskedSensitiveContent: z.literal(true),
  }),
]);

export type Recording = z.infer<typeof recordingSchema>;
export type RecordingState = z.infer<typeof recordingStateSchema>;
export type RecordingScope = z.infer<typeof recordingScopeSchema>;
export type RecordingArtifact = z.infer<typeof recordingArtifactSchema>;
export type RecordingFailure = z.infer<typeof recordingFailureSchema>;
export type StartRecordingRequest = z.input<typeof startRecordingRequestSchema>;
