import type { Frame, Page } from "playwright";

export interface TextExtractionResult {
  text: string;
  truncated: boolean;
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
  const rawText = await page.evaluate(() => document.body?.innerText ?? "");
  const normalized = normalizeVisibleText(rawText);
  const truncated = normalized.length > maxTextChars;

  return {
    text: truncated ? normalized.slice(0, maxTextChars) : normalized,
    truncated,
  };
}
