import type {
  BrowserSemanticFrame,
  BrowserSemanticStructure,
} from "@rove/protocol";

import type { Frame } from "playwright";

export interface AriaInspectableFrame {
  frame: Frame;
  index: number;
  url: string;
  name: string;
  main: boolean;
}

const EDITABLE_VALUE_LINE =
  /^(\s*-\s+(?:textbox|searchbox|combobox|spinbutton|slider)\b.*):\s.*$/gm;

const NESTED_VALUE_LINE =
  /^(\s+value:)\s.*$/gm;

const URL_LINE =
  /^(\s*-\s+\/url:)\s.*$/gm;

export function redactAriaSnapshot(
  snapshot: string,
): string {
  return snapshot
    .replace(
      EDITABLE_VALUE_LINE,
      "$1: [value omitted]",
    )
    .replace(
      NESTED_VALUE_LINE,
      "$1 [value omitted]",
    )
    .replace(
      URL_LINE,
      "$1 [url omitted]",
    );
}

export async function collectAriaStructure(
  frames: AriaInspectableFrame[],
  maxChars: number,
): Promise<BrowserSemanticStructure> {
  const output: BrowserSemanticFrame[] = [];

  let remaining = maxChars;
  let truncated = false;

  for (const frame of frames) {
    let raw = "";

    try {
      const body = frame.frame.locator("body");

      if ((await body.count()) > 0) {
        raw = await body.ariaSnapshot();
      }
    } catch {
      raw = "";
    }

    const safe = redactAriaSnapshot(raw);
    const snapshot = safe.slice(0, Math.max(0, remaining));
    const frameTruncated = snapshot.length < safe.length;

    truncated ||= frameTruncated;
    remaining -= snapshot.length;

    output.push({
      index: frame.index,
      url: frame.url,
      ...(frame.name.length === 0
        ? {}
        : { name: frame.name }),
      main: frame.main,
      snapshot,
      truncated: frameTruncated,
    });
  }

  return {
    source: "playwright_aria_snapshot",
    frames: output,
    truncated,
    characterLimit: maxChars,
  };
}
