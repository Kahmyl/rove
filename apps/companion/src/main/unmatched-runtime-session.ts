import type { DesktopSurfaceSnapshot } from "../shared/desktop-api.js";
import { unmatchedRuntimeSession } from "../shared/desktop-api.js";

export async function endUnmatchedRuntimeSession(options: {
  sessionId: string;
  snapshot: DesktopSurfaceSnapshot;
  endSession(sessionId: string): Promise<unknown>;
}): Promise<void> {
  if (options.sessionId.length === 0) {
    throw new Error("Runtime session id must be a non-empty string.");
  }
  const unmatched = unmatchedRuntimeSession(options.snapshot);
  if (unmatched?.session.id !== options.sessionId) {
    throw new Error("Runtime session is no longer an unmatched session.");
  }
  await options.endSession(options.sessionId);
}
