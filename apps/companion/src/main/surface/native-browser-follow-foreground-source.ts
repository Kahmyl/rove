import { activeWindow } from "get-windows";

import type { BrowserFollowForegroundSource } from "./browser-follow-controller.js";

interface ForegroundWindow {
  owner: { processId: number };
}

type ActiveWindowLookup = (options?: {
  accessibilityPermission: boolean;
  screenRecordingPermission: boolean;
}) => Promise<ForegroundWindow | undefined>;

export class NativeBrowserFollowForegroundSource implements BrowserFollowForegroundSource {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly lookup: ActiveWindowLookup = activeWindow,
  ) {}

  async getForegroundProcessId(signal: AbortSignal): Promise<number | null> {
    if (signal.aborted) return null;

    // PID ownership does not require titles, URLs, or screen contents. Disabling
    // both macOS permission checks keeps this authority narrow and non-invasive.
    const window = await this.lookup(
      this.platform === "darwin"
        ? {
            accessibilityPermission: false,
            screenRecordingPermission: false,
          }
        : undefined,
    );

    if (signal.aborted) return null;

    const processId = window?.owner.processId;

    return Number.isInteger(processId) &&
      processId !== undefined &&
      processId > 0
      ? processId
      : null;
  }
}
