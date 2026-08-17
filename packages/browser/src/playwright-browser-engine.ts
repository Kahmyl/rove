import { randomUUID } from "node:crypto";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type LaunchOptions,
} from "playwright";
import { RoveError, type BrowserLaunchConfig } from "@rove/protocol";
import type { BrowserEngine, BrowserSession } from "./engine.js";
import { PlaywrightBrowserSession } from "./playwright-browser-session.js";
import { resolveSessionDownloadRuntime } from "./downloads/download-runtime.js";
import {
  discoverExternalChromeExecutable,
  launchExternalChrome,
} from "./runtime/external-chrome-runtime.js";
import {
  type BrowserDistribution,
  type BrowserLaunchPlanDiagnostic,
  resolveBrowserLaunchPlan,
  type ResolvedBrowserLaunchPlan,
} from "./runtime/browser-launch-plan.js";

function toLaunchError(error: unknown): RoveError {
  const roveError = new RoveError({
    code: "BROWSER_LAUNCH_FAILED",
    message: "The browser failed to launch.",
    ...(error instanceof Error ? { details: { cause: error.message } } : {}),
  });
  if (error instanceof Error) roveError.cause = error;
  return roveError;
}

interface LaunchedBrowser {
  browser: Browser;
  distribution: BrowserDistribution;
  sandbox: boolean;
  diagnostics: BrowserLaunchPlanDiagnostic[];
}

interface LaunchedPersistentContext {
  context: BrowserContext;
  distribution: BrowserDistribution;
  sandbox: boolean;
  diagnostics: BrowserLaunchPlanDiagnostic[];
}

export class PlaywrightBrowserEngine implements BrowserEngine {
  async start(config: BrowserLaunchConfig): Promise<BrowserSession> {
    const plan = resolveBrowserLaunchPlan(config);

    if (config.profile.mode === "existing") {
      throw new RoveError({
        code: "NOT_IMPLEMENTED",
        message: "Existing Chrome profiles are not supported yet.",
      });
    }

    if (plan.distribution === "chrome") {
      return this.startExternalChromeOrFallback(config, plan);
    }

    return this.startPlaywrightManaged(config, plan);
  }

  private async startExternalChromeOrFallback(
    config: BrowserLaunchConfig,
    plan: ResolvedBrowserLaunchPlan,
  ): Promise<BrowserSession> {
    let executablePath: string | undefined;

    try {
      executablePath = await discoverExternalChromeExecutable({
        ...(plan.executablePath === undefined
          ? {}
          : {
              explicitExecutablePath: plan.executablePath,
            }),
      });
    } catch (error) {
      throw toLaunchError(error);
    }

    if (executablePath === undefined) {
      const fallbackPlan: ResolvedBrowserLaunchPlan = {
        ...plan,
        distribution: "chromium",
        diagnostics: [...plan.diagnostics, browserFallbackDiagnostic()],
      };

      return this.startPlaywrightManaged(config, fallbackPlan);
    }

    return this.startExternalChrome(config, plan, executablePath);
  }

  private async startPlaywrightManaged(
    config: BrowserLaunchConfig,
    plan: ResolvedBrowserLaunchPlan,
  ): Promise<BrowserSession> {
    if (plan.profile.mode === "persistent") {
      return this.startPersistent(config, plan);
    }

    const sessionId = `browser_${randomUUID()}`;

    const downloadRuntime = await resolveSessionDownloadRuntime(sessionId);

    const launched = await this.launch(plan);

    try {
      return await PlaywrightBrowserSession.create(
        launched.browser,
        config,
        {
          distribution: launched.distribution,
          sandbox: launched.sandbox,
          diagnostics: [...plan.diagnostics, ...launched.diagnostics],
        },
        downloadRuntime,
        sessionId,
      );
    } catch (error) {
      await launched.browser.close().catch(() => undefined);

      throw toLaunchError(error);
    }
  }

  private async startExternalChrome(
    config: BrowserLaunchConfig,
    plan: ResolvedBrowserLaunchPlan,
    executablePath: string,
  ): Promise<BrowserSession> {
    const sessionId = `browser_${randomUUID()}`;

    let userDataDir: string | undefined;

    let downloadRuntime: Awaited<
      ReturnType<typeof resolveSessionDownloadRuntime>
    >;

    if (plan.profile.mode === "persistent") {
      if (config.profile.mode !== "persistent") {
        throw new RoveError({
          code: "INVALID_CONFIGURATION",
          message: "Persistent browser profile mode was not resolved.",
        });
      }

      userDataDir = plan.profile.userDataDir;

      if (userDataDir === undefined) {
        throw new RoveError({
          code: "INVALID_CONFIGURATION",
          message: "Persistent browser profile directory was not resolved.",
        });
      }

      downloadRuntime = await resolveSessionDownloadRuntime(
        `profile_${config.profile.name}`,
        userDataDir,
      );
    } else {
      downloadRuntime = await resolveSessionDownloadRuntime(sessionId);
    }

    let external: Awaited<ReturnType<typeof launchExternalChrome>> | undefined;

    let browser: Browser | undefined;

    try {
      external = await launchExternalChrome({
        executablePath,
        headless: plan.headless,
        ...(userDataDir === undefined
          ? {}
          : {
              userDataDir,
            }),
        ...(plan.args.length === 0
          ? {}
          : {
              launchArgs: plan.args,
            }),
        ...(plan.timeoutMs === undefined
          ? {}
          : {
              timeoutMs: plan.timeoutMs,
            }),
      });

      browser = await chromium.connectOverCDP(external.endpoint, {
        ...(plan.timeoutMs === undefined
          ? {}
          : {
              timeout: plan.timeoutMs,
            }),
      });

      const context = browser.contexts()[0];

      if (context === undefined) {
        throw new Error(
          "External Chrome CDP connection exposed no default browser context.",
        );
      }

      return await PlaywrightBrowserSession.createPersistent(
        context,
        config,
        {
          distribution: "chrome",
          sandbox: plan.sandbox,
          diagnostics: [...plan.diagnostics, externalChromeAttachDiagnostic()],
        },
        downloadRuntime,
        sessionId,
        external.closeGracefully,
      );
    } catch (error) {
      await browser?.close().catch(() => undefined);

      await external?.close().catch(() => undefined);

      throw toLaunchError(error);
    }
  }

  private async startPersistent(
    config: BrowserLaunchConfig,
    plan: ResolvedBrowserLaunchPlan,
  ): Promise<BrowserSession> {
    const userDataDir = plan.profile.userDataDir;

    if (userDataDir === undefined) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Persistent browser profile directory was not resolved.",
      });
    }

    if (config.profile.mode !== "persistent") {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Persistent browser profile mode was not resolved.",
      });
    }

    const downloadRuntime = await resolveSessionDownloadRuntime(
      `profile_${config.profile.name}`,
      userDataDir,
    );

    let launched: LaunchedPersistentContext;

    try {
      launched = await this.launchPersistent(
        userDataDir,
        plan,
        downloadRuntime.directory,
      );
    } catch (error) {
      throw toLaunchError(error);
    }

    try {
      return await PlaywrightBrowserSession.createPersistent(
        launched.context,
        config,
        {
          distribution: launched.distribution,
          sandbox: launched.sandbox,
          diagnostics: [...plan.diagnostics, ...launched.diagnostics],
        },
        downloadRuntime,
      );
    } catch (error) {
      await launched.context.close().catch(() => undefined);

      throw toLaunchError(error);
    }
  }

  private async launchPersistent(
    userDataDir: string,
    plan: ResolvedBrowserLaunchPlan,
    downloadsPath: string,
  ): Promise<LaunchedPersistentContext> {
    const runtimeLaunch = runtimeLaunchOptions(plan);
    const base = {
      acceptDownloads: true,
      downloadsPath,
      headless: plan.headless,
      ...(plan.timeoutMs === undefined ? {} : { timeout: plan.timeoutMs }),
      viewport: plan.viewport,
      ignoreDefaultArgs: runtimeLaunch.ignoreDefaultArgs,
      ...(plan.args.length === 0 ? {} : { args: plan.args }),
    };

    if (plan.executablePath !== undefined) {
      return {
        context: await chromium.launchPersistentContext(userDataDir, {
          ...base,
          executablePath: plan.executablePath,
        }),
        distribution: plan.distribution,
        sandbox: runtimeLaunch.sandbox,
        diagnostics: runtimeLaunch.diagnostics,
      };
    }

    return {
      context: await chromium.launchPersistentContext(userDataDir, base),
      distribution: "chromium",
      sandbox: runtimeLaunch.sandbox,
      diagnostics: runtimeLaunch.diagnostics,
    };
  }

  private async launch(
    plan: ResolvedBrowserLaunchPlan,
  ): Promise<LaunchedBrowser> {
    const runtimeLaunch = runtimeLaunchOptions(plan);
    const base: LaunchOptions = {
      headless: plan.headless,
      ...(plan.timeoutMs === undefined ? {} : { timeout: plan.timeoutMs }),
      ignoreDefaultArgs: runtimeLaunch.ignoreDefaultArgs,
      ...(plan.args.length === 0 ? {} : { args: plan.args }),
    };
    try {
      // Rule 1: an explicit executable path skips browser discovery entirely.
      if (plan.executablePath !== undefined) {
        return {
          browser: await chromium.launch({
            ...base,
            executablePath: plan.executablePath,
          }),
          distribution: plan.distribution,
          sandbox: runtimeLaunch.sandbox,
          diagnostics: runtimeLaunch.diagnostics,
        };
      }
      // Playwright-managed sessions use bundled Chromium.
      return {
        browser: await chromium.launch(base),
        distribution: "chromium",
        sandbox: runtimeLaunch.sandbox,
        diagnostics: runtimeLaunch.diagnostics,
      };
    } catch (error) {
      throw toLaunchError(error);
    }
  }
}

function externalChromeAttachDiagnostic(): BrowserLaunchPlanDiagnostic {
  return {
    level: "info",
    code: "EXTERNAL_CHROME_CDP_ATTACH",
    message:
      "Google Chrome was launched as a Rove-owned system process and attached over loopback CDP.",
  };
}

function browserFallbackDiagnostic(): BrowserLaunchPlanDiagnostic {
  return {
    level: "warning",
    code: "BROWSER_DISTRIBUTION_FALLBACK",
    message:
      "Requested Google Chrome was unavailable, so bundled Playwright Chromium was launched.",
  };
}

function runtimeLaunchOptions(plan: ResolvedBrowserLaunchPlan): {
  ignoreDefaultArgs: string[];
  sandbox: boolean;
  diagnostics: BrowserLaunchPlanDiagnostic[];
} {
  if (plan.sandbox && process.platform === "win32") {
    return {
      ignoreDefaultArgs: plan.ignoreDefaultArgs.filter(
        (arg) => arg !== "--no-sandbox" && arg !== "--disable-setuid-sandbox",
      ),
      sandbox: false,
      diagnostics: [
        {
          level: "warning",
          code: "SANDBOX_LAUNCH_FALLBACK",
          message:
            "Requested sandbox launch is not usable in this Windows Playwright Chromium runtime, so Rove used Playwright's stable sandbox defaults.",
        },
      ],
    };
  }

  return {
    ignoreDefaultArgs: plan.ignoreDefaultArgs,
    sandbox: plan.sandbox,
    diagnostics: [],
  };
}
