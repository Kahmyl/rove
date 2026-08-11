import { join, resolve } from "node:path";

export interface DesktopServiceLayoutOptions {
  isPackaged: boolean;
  resourcesPath: string;
  cwd: string;
  electronExecutable: string;
  runtimeDirectory?: string;
}

export interface DesktopServiceLayout {
  runtimeDirectory: string;
  runtimeEntrypoint?: string;
  nodeExecutable?: string;
  electronRunAsNode: boolean;
  playwrightBrowsersPath?: string;
}

export function resolveDesktopServiceLayout(
  options: DesktopServiceLayoutOptions,
): DesktopServiceLayout {
  if (options.isPackaged) {
    return {
      runtimeDirectory: join(options.resourcesPath, "services", "runtime"),
      runtimeEntrypoint: "dist/main.js",
      nodeExecutable: options.electronExecutable,
      electronRunAsNode: true,
      playwrightBrowsersPath: join(options.resourcesPath, "browsers"),
    };
  }

  return {
    runtimeDirectory:
      options.runtimeDirectory ?? resolve(options.cwd, "../runtime"),
    electronRunAsNode: false,
  };
}
