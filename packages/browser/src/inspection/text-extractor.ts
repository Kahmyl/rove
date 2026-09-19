import type { Frame, Page } from "playwright";

export interface TextExtractionResult {
  text: string;
  truncated: boolean;
}

export interface CompleteTextExtractionResult {
  text: string;
}

export function normalizeVisibleText(rawText: string): string {
  return rawText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export async function extractVisibleText(
  page: Frame | Page,
  maxTextChars: number,
): Promise<TextExtractionResult> {
  const { text: normalized } = await extractCompleteVisibleText(page);
  const truncated = normalized.length > maxTextChars;

  return {
    text: truncated ? normalized.slice(0, maxTextChars) : normalized,
    truncated,
  };
}

export async function extractCompleteVisibleText(
  page: Frame | Page,
): Promise<CompleteTextExtractionResult> {
  const rawText = await page.evaluate(() => document.body?.innerText ?? "");
  return { text: normalizeVisibleText(rawText) };
}

export function classifyFocusedTextRead(
  query: string,
  successfullyReadFrameTexts: readonly string[],
  failedFrameCount: number,
): "present" | "absent" | "unknown" {
  if (successfullyReadFrameTexts.some((text) => text.includes(query))) {
    return "present";
  }
  if (failedFrameCount > 0) return "unknown";
  return successfullyReadFrameTexts.join("\n\n").includes(query)
    ? "present"
    : "absent";
}
