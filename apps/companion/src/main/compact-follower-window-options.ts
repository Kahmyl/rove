import type { BrowserWindowConstructorOptions } from "electron";

import { join } from "node:path";

export const COMPACT_FOLLOWER_WIDTH = 240;

export const COMPACT_FOLLOWER_HEIGHT = 96;

export function compactFollowerWindowOptions(
  dirname: string,
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
    skipTaskbar: true,
    backgroundColor: "#f3f5f1",
    icon: join(dirname, "../../../resources/rove-app-icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(dirname, "../preload/preload.cjs"),
    },
  };
}
