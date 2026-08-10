import { access, constants } from "node:fs/promises";
import { posix, win32 } from "node:path";

export type DesktopBrowserKind = "chrome" | "chromium";

export type DesktopBrowserSource = "explicit" | "system" | "bundled";

export interface BrowserInstallation {
  kind: DesktopBrowserKind;
  source: DesktopBrowserSource;
  executablePath?: string;
}

export interface BrowserDiscoveryOptions {
  preferredBrowser: DesktopBrowserKind;
  explicitExecutablePath?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  pathExists?: (executablePath: string) => Promise<boolean>;
}

async function defaultPathExists(executablePath: string): Promise<boolean> {
  try {
    await access(executablePath, constants.F_OK);

    return true;
  } catch {
    return false;
  }
}

function systemChromeCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  if (platform === "darwin") {
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ];

    if (env.HOME !== undefined) {
      candidates.push(
        `${env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      );
    }

    return candidates;
  }

  if (platform === "win32") {
    const roots = [
      env.LOCALAPPDATA,
      env.PROGRAMFILES,
      env["PROGRAMFILES(X86)"],
    ].filter(
      (value): value is string => value !== undefined && value.length > 0,
    );

    return roots.map((root) =>
      win32.join(root, "Google", "Chrome", "Application", "chrome.exe"),
    );
  }

  if (platform === "linux") {
    const directories = (env.PATH ?? "").split(":").filter(Boolean);

    const executables = ["google-chrome", "google-chrome-stable"];

    return directories.flatMap((directory) =>
      executables.map((executable) => posix.join(directory, executable)),
    );
  }

  return [];
}

export async function discoverBrowser(
  options: BrowserDiscoveryOptions,
): Promise<BrowserInstallation> {
  const platform = options.platform ?? process.platform;

  const env = options.env ?? process.env;

  const pathExists = options.pathExists ?? defaultPathExists;

  if (options.explicitExecutablePath !== undefined) {
    const executablePath = options.explicitExecutablePath;

    if (!(await pathExists(executablePath))) {
      throw new Error(
        `Configured browser executable does not exist: ${executablePath}`,
      );
    }

    return {
      kind: options.preferredBrowser,
      source: "explicit",
      executablePath,
    };
  }

  if (options.preferredBrowser === "chromium") {
    return {
      kind: "chromium",
      source: "bundled",
    };
  }

  const candidates = systemChromeCandidates(platform, env);

  for (const executablePath of candidates) {
    if (await pathExists(executablePath)) {
      return {
        kind: "chrome",
        source: "system",
        executablePath,
      };
    }
  }

  return {
    kind: "chromium",
    source: "bundled",
  };
}
