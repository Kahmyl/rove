import process from "node:process";

import type { BrowserLaunchConfig, Viewport } from "@rove/protocol";

export type BrowserDistribution = "chrome" | "chromium";
export type BrowserFamily = "chromium";
export type BrowserLaunchArgumentSource =
  | "required_by_current_runtime"
  | "required_by_platform"
  | "user_supplied";

export interface BrowserLaunchArgumentDiagnostic {
  arg: string;
  source: BrowserLaunchArgumentSource;
  reason: string;
}

export interface BrowserLaunchPlanDiagnostic {
  level: "info" | "warning";
  code: string;
  message: string;
}

export interface ResolvedProfile {
  mode: "temporary" | "persistent";
  userDataDir?: string;
}

export interface ResolvedBrowserLaunchPlan {
  browserFamily: BrowserFamily;
  distribution: BrowserDistribution;
  executablePath?: string;
  headless: boolean;
  sandbox: boolean | "unknown";
  profile: ResolvedProfile;
  viewport: Viewport;
  timeoutMs?: number;
  args: string[];
  argDiagnostics: BrowserLaunchArgumentDiagnostic[];
  diagnostics: BrowserLaunchPlanDiagnostic[];
}

const DEFAULT_VIEWPORT: Viewport = {
  width: 1440,
  height: 900,
};

export function resolveBrowserLaunchPlan(
  config: BrowserLaunchConfig,
): ResolvedBrowserLaunchPlan {
  const diagnostics: BrowserLaunchPlanDiagnostic[] = [];
  const argDiagnostics = currentRuntimeArgumentDiagnostics();

  if (config.launchArgs !== undefined && config.launchArgs.length > 0) {
    diagnostics.push({
      level: "warning",
      code: "CUSTOM_LAUNCH_ARGS",
      message:
        "Runtime modified by custom browser arguments; compatibility guarantees may not apply.",
    });
    argDiagnostics.push(
      ...config.launchArgs.map((arg) => ({
        arg,
        source: "user_supplied" as const,
        reason: "Caller supplied this advanced browser launch argument.",
      })),
    );
  }

  if (config.executablePath !== undefined) {
    diagnostics.push({
      level: "warning",
      code: "CUSTOM_EXECUTABLE_PATH",
      message:
        "Runtime modified by a caller-supplied browser executable path.",
    });
  }

  if (config.profile.mode === "existing") {
    diagnostics.push({
      level: "warning",
      code: "EXISTING_PROFILE_UNSUPPORTED",
      message:
        "Existing Chrome profiles remain unsupported by the F4 runtime contract.",
    });
  }

  const profile = resolveProfile(config);

  return {
    browserFamily: "chromium",
    distribution: config.browser,
    ...(config.executablePath === undefined
      ? {}
      : { executablePath: config.executablePath }),
    headless: config.headless,
    sandbox: false,
    profile,
    viewport: config.viewport ?? DEFAULT_VIEWPORT,
    ...(config.timeouts?.launchMs === undefined
      ? {}
      : { timeoutMs: config.timeouts.launchMs }),
    args: [
      ...argDiagnostics.map((diagnostic) => diagnostic.arg),
    ],
    argDiagnostics,
    diagnostics,
  };
}

function resolveProfile(config: BrowserLaunchConfig): ResolvedProfile {
  if (config.profile.mode === "persistent") {
    return {
      mode: "persistent",
      ...(config.profileUserDataDir === undefined
        ? {}
        : { userDataDir: config.profileUserDataDir }),
    };
  }

  return {
    mode: "temporary",
  };
}

function currentRuntimeArgumentDiagnostics(): BrowserLaunchArgumentDiagnostic[] {
  return [
    {
      arg: "--no-sandbox",
      source: "required_by_current_runtime",
      reason:
        "Current pre-F4 Playwright launch behavior disables the Chromium sandbox; F4 must replace this with an explicit sandbox policy.",
    },
    {
      arg: "--disable-setuid-sandbox",
      source: "required_by_current_runtime",
      reason:
        "Current pre-F4 Playwright launch behavior disables the Chromium setuid sandbox; F4 must replace this with an explicit sandbox policy.",
    },
    ...(process.platform === "darwin"
      ? [
          {
            arg: "--use-mock-keychain",
            source: "required_by_platform" as const,
            reason:
              "Current macOS launch behavior avoids interactive keychain prompts during automated browser startup.",
          },
          {
            arg: "--password-store=basic",
            source: "required_by_platform" as const,
            reason:
              "Current macOS launch behavior avoids OS password-store prompts during automated browser startup.",
          },
        ]
      : []),
  ];
}
