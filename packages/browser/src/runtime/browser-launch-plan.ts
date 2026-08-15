import process from "node:process";

import type { BrowserLaunchConfig, Viewport } from "@rove/protocol";

export type BrowserDistribution = "chrome" | "chromium";
export type BrowserFamily = "chromium";
export type BrowserLaunchArgumentSource =
  | "required_by_current_runtime"
  | "required_by_platform"
  | "user_supplied";
export type BrowserLaunchArgumentAction =
  | "ignore_playwright_default"
  | "pass_to_browser";

export interface BrowserLaunchArgumentDiagnostic {
  arg: string;
  action: BrowserLaunchArgumentAction;
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
  sandbox: boolean;
  profile: ResolvedProfile;
  viewport: Viewport;
  timeoutMs?: number;
  args: string[];
  ignoreDefaultArgs: string[];
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
  const ignoredDefaultArgDiagnostics = currentRuntimeArgumentDiagnostics();
  const passedArgDiagnostics: BrowserLaunchArgumentDiagnostic[] = [];

  if (config.launchArgs !== undefined && config.launchArgs.length > 0) {
    diagnostics.push({
      level: "warning",
      code: "CUSTOM_LAUNCH_ARGS",
      message:
        "Runtime modified by custom browser arguments; compatibility guarantees may not apply.",
    });
    passedArgDiagnostics.push(
      ...config.launchArgs.map((arg) => ({
        arg,
        action: "pass_to_browser" as const,
        source: "user_supplied" as const,
        reason: "Caller supplied this advanced browser launch argument.",
      })),
    );
  }

  const sandbox = requestedSandboxPolicy(config.launchArgs ?? []);

  if (!sandbox) {
    diagnostics.push({
      level: "warning",
      code: "SANDBOX_DISABLED_BY_LAUNCH_ARGS",
      message:
        "Caller-supplied launch arguments request disabled Chromium sandboxing.",
    });
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
    sandbox,
    profile,
    viewport: config.viewport ?? DEFAULT_VIEWPORT,
    ...(config.timeouts?.launchMs === undefined
      ? {}
      : { timeoutMs: config.timeouts.launchMs }),
    args: [
      ...passedArgDiagnostics.map((diagnostic) => diagnostic.arg),
    ],
    ignoreDefaultArgs: [
      ...ignoredDefaultArgDiagnostics.map((diagnostic) => diagnostic.arg),
    ],
    argDiagnostics: [
      ...ignoredDefaultArgDiagnostics,
      ...passedArgDiagnostics,
    ],
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
      action: "ignore_playwright_default",
      source: "required_by_current_runtime",
      reason:
        "Rove requests normal Chromium sandboxing by removing Playwright's default sandbox-disabling argument.",
    },
    {
      arg: "--disable-setuid-sandbox",
      action: "ignore_playwright_default",
      source: "required_by_current_runtime",
      reason:
        "Rove requests normal Chromium sandboxing by removing Playwright's default setuid-sandbox disabling argument.",
    },
    ...(process.platform === "darwin"
      ? [
          {
            arg: "--use-mock-keychain",
            action: "ignore_playwright_default" as const,
            source: "required_by_platform" as const,
            reason:
              "Current macOS launch behavior avoids interactive keychain prompts during automated browser startup.",
          },
          {
            arg: "--password-store=basic",
            action: "ignore_playwright_default" as const,
            source: "required_by_platform" as const,
            reason:
              "Current macOS launch behavior avoids OS password-store prompts during automated browser startup.",
          },
        ]
      : []),
  ];
}

function requestedSandboxPolicy(launchArgs: string[]): boolean {
  return !launchArgs.some(
    (arg) =>
      arg === "--no-sandbox" ||
      arg === "--disable-setuid-sandbox",
  );
}
