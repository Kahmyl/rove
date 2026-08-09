import { resolve, sep } from "node:path";
import { RoveError } from "@rove/protocol";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

export function assertSafeSegment(value: string, label: string): string {
  if (!SAFE_ID.test(value)) {
    throw new RoveError({
      code: "EVIDENCE_WRITE_FAILED",
      message: `Invalid ${label}.`,
    });
  }
  return value;
}

export function pathWithin(root: string, ...segments: string[]): string {
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...segments);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${sep}`)) {
    throw new RoveError({ code: "EVIDENCE_WRITE_FAILED", message: "Unsafe storage path." });
  }
  return target;
}
