import type { BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";

export function companionWindowOptions(
  dirname: string,
): BrowserWindowConstructorOptions {
  return {
    width: 420,
    height: 680,
    minWidth: 360,
    minHeight: 520,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(
        dirname,
        "../preload/preload.cjs",
      ),
    },
  };
}
