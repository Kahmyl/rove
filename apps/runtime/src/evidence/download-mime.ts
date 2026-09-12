import { fileTypeFromBuffer } from "file-type";
import { lookup as lookupMimeType } from "mime-types";

export interface DownloadMimeDetection {
  mimeType: string;
  basis: "content_signature" | "filename_extension" | "fallback";
  detectedExtension?: string;
}

export async function detectDownloadMimeType(
  bytes: Uint8Array,
  filename: string,
): Promise<DownloadMimeDetection> {
  const detected = await fileTypeFromBuffer(bytes).catch(() => undefined);

  if (detected !== undefined) {
    return {
      mimeType: detected.mime,
      basis: "content_signature",
      detectedExtension: detected.ext,
    };
  }

  const filenameMimeType = lookupMimeType(filename);

  if (filenameMimeType !== false) {
    return {
      mimeType: filenameMimeType,
      basis: "filename_extension",
    };
  }

  return {
    mimeType: "application/octet-stream",
    basis: "fallback",
  };
}
