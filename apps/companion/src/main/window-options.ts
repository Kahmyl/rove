import type { BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";

export function companionWindowOptions(
  dirname: string,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  return {
    title: "Rove",
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: "#f3f5f1",
    icon: join(dirname, "../../../resources/rove-app-icon.png"),
    ...(platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 18, y: 18 },
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(dirname, "../preload/preload.cjs"),
    },
  };
}
