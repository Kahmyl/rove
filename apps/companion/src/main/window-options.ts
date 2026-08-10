import type { BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";

export function companionWindowOptions(
  dirname: string,
): BrowserWindowConstructorOptions {
  return {
    title: "Rove Companion",
    width: 420,
    height: 500,
    minWidth: 360,
    minHeight: 440,
    backgroundColor: "#f3f5f1",
    icon: join(
      dirname,
      "../../../resources/rove-app-icon.png",
    ),
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
