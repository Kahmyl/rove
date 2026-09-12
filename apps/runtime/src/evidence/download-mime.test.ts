import { describe, expect, it } from "vitest";

import { detectDownloadMimeType } from "./download-mime.js";

describe("detectDownloadMimeType", () => {
  it("prefers a content signature over a misleading filename", async () => {
    const detected = await detectDownloadMimeType(
      Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"),
      "download.bin",
    );

    expect(detected).toEqual({
      mimeType: "application/pdf",
      basis: "content_signature",
      detectedExtension: "pdf",
    });
  });

  it("falls back to the filename for formats without a binary signature", async () => {
    const detected = await detectDownloadMimeType(
      Buffer.from("plain text"),
      "notes.txt",
    );

    expect(detected).toEqual({
      mimeType: "text/plain",
      basis: "filename_extension",
    });
  });

  it("records an honest binary fallback when neither source identifies a type", async () => {
    const detected = await detectDownloadMimeType(
      Buffer.from("unknown"),
      "download",
    );

    expect(detected).toEqual({
      mimeType: "application/octet-stream",
      basis: "fallback",
    });
  });
});
