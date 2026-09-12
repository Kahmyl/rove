import { describe, expect, it } from "vitest";

import {
  generatedFileArtifactRequestSchema,
  localFileGrantRequestSchema,
  MAX_GENERATED_FILE_BYTES,
} from "../src/index.js";

describe("file artifact authority contracts", () => {
  it("accepts bounded generated content without accepting a host path", () => {
    const request = generatedFileArtifactRequestSchema.parse({
      filename: "acceptance.txt",
      content: "Rove acceptance",
    });

    expect(request).toEqual({
      filename: "acceptance.txt",
      mimeType: "text/plain",
      encoding: "utf8",
      content: "Rove acceptance",
    });
    expect(
      generatedFileArtifactRequestSchema.safeParse({
        filename: "/tmp/secret.txt",
        content: "not read from disk",
      }).success,
    ).toBe(false);
  });

  it("validates base64 and applies the decoded-byte limit", () => {
    expect(
      generatedFileArtifactRequestSchema.safeParse({
        filename: "data.bin",
        encoding: "base64",
        content: "not base64",
      }).success,
    ).toBe(false);

    expect(
      generatedFileArtifactRequestSchema.safeParse({
        filename: "large.txt",
        content: "x".repeat(MAX_GENERATED_FILE_BYTES + 1),
      }).success,
    ).toBe(false);
  });

  it("requires a visible reason for a user file grant", () => {
    expect(
      localFileGrantRequestSchema.parse({
        reason: "Select the report requested for upload",
      }),
    ).toEqual({
      reason: "Select the report requested for upload",
      allowMultiple: false,
    });
    expect(localFileGrantRequestSchema.safeParse({ reason: "" }).success).toBe(
      false,
    );
  });
});
