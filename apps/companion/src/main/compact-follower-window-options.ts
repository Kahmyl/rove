import type { BrowserWindowConstructorOptions } from "electron";

import { join } from "node:path";

export const MICRO_FOLLOWER_WIDTH = 64;

export const MICRO_FOLLOWER_HEIGHT = 56;

export const COMPACT_FOLLOWER_WIDTH = MICRO_FOLLOWER_WIDTH;

export const COMPACT_FOLLOWER_HEIGHT = MICRO_FOLLOWER_HEIGHT;

export const EXPANDED_FOLLOWER_WIDTH = 360;

export const EXPANDED_FOLLOWER_HEIGHT = 240;

export const FULLSCREEN_MICRO_FOLLOWER_WIDTH = MICRO_FOLLOWER_WIDTH;

export const FULLSCREEN_MICRO_FOLLOWER_HEIGHT = MICRO_FOLLOWER_HEIGHT;

export function compactFollowerWindowOptions(
  dirname: string,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  return {
    title: "Rove",
    width: COMPACT_FOLLOWER_WIDTH,
    height: COMPACT_FOLLOWER_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    ...(platform === "linux" ? { focusable: false } : {}),
    skipTaskbar: true,
    backgroundColor: "#f3f5f1",
    ...(platform === "darwin"
      ? { type: "panel" }
      : platform === "linux"
        ? { type: "dock" }
        : {}),
    icon: join(dirname, "../../../resources/rove-app-icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(dirname, "../preload/preload.cjs"),
    },
  };
}
