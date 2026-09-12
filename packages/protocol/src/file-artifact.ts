import { z } from "zod";

import { evidenceSchema } from "./schemas.js";

export const MAX_GENERATED_FILE_BYTES = 512 * 1024;
export const MAX_GRANTED_FILE_BYTES = 64 * 1024 * 1024;

export const fileArtifactNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => value !== "." && value !== "..", {
    message: "File names must identify a leaf file.",
  })
  .refine((value) => !hasUnsafeFileNameCharacter(value), {
    message: "File names cannot contain path separators or control characters.",
  });

export const fileArtifactMimeTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/u)
  .default("application/octet-stream");

export const generatedFileArtifactRequestSchema = z
  .object({
    filename: fileArtifactNameSchema,
    mimeType: fileArtifactMimeTypeSchema.optional().default("text/plain"),
    encoding: z.enum(["utf8", "base64"]).optional().default("utf8"),
    content: z.string().max(1_500_000),
  })
  .superRefine((value, context) => {
    const size =
      value.encoding === "utf8"
        ? new TextEncoder().encode(value.content).byteLength
        : decodedBase64Size(value.content);

    if (size === undefined) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Base64 file content is malformed.",
      });
      return;
    }

    if (size > MAX_GENERATED_FILE_BYTES) {
      context.addIssue({
        code: "too_big",
        path: ["content"],
        origin: "string",
        maximum: MAX_GENERATED_FILE_BYTES,
        inclusive: true,
        message: "Generated file content exceeds 512 KiB.",
      });
    }
  });

export const localFileGrantRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  allowMultiple: z.boolean().optional().default(false),
});

export const localFileGrantResultSchema = z.object({
  status: z.enum(["selected", "cancelled"]),
  evidence: z.array(evidenceSchema).max(100),
});

export type GeneratedFileArtifactRequest = z.infer<
  typeof generatedFileArtifactRequestSchema
>;
export type LocalFileGrantRequest = z.infer<typeof localFileGrantRequestSchema>;
export type LocalFileGrantResult = z.infer<typeof localFileGrantResultSchema>;

function decodedBase64Size(value: string): number | undefined {
  if (value.length === 0) return 0;
  if (value.length % 4 !== 0) return undefined;
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    return undefined;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function hasUnsafeFileNameCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      character === "/" || character === "\\" || code <= 31 || code === 127
    );
  });
}
