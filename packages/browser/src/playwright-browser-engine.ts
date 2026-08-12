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
  resolveBrowserLaunchPlan,
  type ResolvedBrowserLaunchPlan,
} from "./runtime/browser-launch-plan.js";

/** The Chrome channel is unavailable when its executable cannot be found. */
function isChromeChannelUnavailable(error: unknown): boolean {
  return error instanceof Error && /not found|doesn't exist|does not exist/i.test(error.message);
}

function toLaunchError(error: unknown): RoveError {
  const roveError = new RoveError({
    code: "BROWSER_LAUNCH_FAILED",
    message: "The browser failed to launch.",
    ...(error instanceof Error
      ? { details: { cause: error.message } }
      : {}),
  });
  if (error instanceof Error) roveError.cause = error;
  return roveError;
}

export class PlaywrightBrowserEngine implements BrowserEngine {
  async start(config: BrowserLaunchConfig): Promise<BrowserSession> {
    const plan =
      resolveBrowserLaunchPlan(config);

    if (config.profile.mode === "existing") {
      throw new RoveError({
        code: "NOT_IMPLEMENTED",
        message:
          "Existing Chrome profiles are not supported yet.",
      });
    }

    if (plan.profile.mode === "persistent") {
      return this.startPersistent(config, plan);
    }

    const sessionId = `browser_${randomUUID()}`;
    const downloadRuntime =
      await resolveSessionDownloadRuntime(
        sessionId,
      );
    const browser = await this.launch(plan);

    try {
      return await PlaywrightBrowserSession.create(
        browser,
        config,
        downloadRuntime,
        sessionId,
      );
    } catch (error) {
      await browser
        .close()
        .catch(() => undefined);

      throw toLaunchError(error);
    }
  }

  private async startPersistent(
    config: BrowserLaunchConfig,
    plan: ResolvedBrowserLaunchPlan,
  ): Promise<BrowserSession> {
    const userDataDir =
      plan.profile.userDataDir;

    if (userDataDir === undefined) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message:
          "Persistent browser profile directory was not resolved.",
      });
    }

    if (config.profile.mode !== "persistent") {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message:
          "Persistent browser profile mode was not resolved.",
      });
    }

    const downloadRuntime =
      await resolveSessionDownloadRuntime(
        `profile_${config.profile.name}`,
        userDataDir,
      );

    let context: BrowserContext;

    try {
      context =
        await this.launchPersistent(
          userDataDir,
          plan,
          downloadRuntime.directory,
        );
    } catch (error) {
      throw toLaunchError(error);
    }

    try {
      return await PlaywrightBrowserSession
        .createPersistent(
          context,
          config,
          downloadRuntime,
        );
    } catch (error) {
      await context
        .close()
        .catch(() => undefined);

      throw toLaunchError(error);
    }
  }

  private async launchPersistent(
    userDataDir: string,
    plan: ResolvedBrowserLaunchPlan,
    downloadsPath: string,
  ): Promise<BrowserContext> {
    const base = {
      acceptDownloads: true,
      downloadsPath,
      headless: plan.headless,
      ...(plan.timeoutMs === undefined
        ? {}
        : { timeout: plan.timeoutMs }),
      viewport: plan.viewport,
      ignoreDefaultArgs: plan.ignoreDefaultArgs,
      ...(plan.args.length === 0 ? {} : { args: plan.args }),
    };

    if (plan.executablePath !== undefined) {
      return chromium.launchPersistentContext(
        userDataDir,
        {
          ...base,
          executablePath:
            plan.executablePath,
        },
      );
    }

    if (plan.distribution === "chrome") {
      try {
        return await chromium
          .launchPersistentContext(
            userDataDir,
            {
              ...base,
              channel: "chrome",
            },
          );
      } catch (error) {
        if (
          !isChromeChannelUnavailable(error)
        ) {
          throw error;
        }

        return chromium
          .launchPersistentContext(
            userDataDir,
            base,
          );
      }
    }

    return chromium.launchPersistentContext(
      userDataDir,
      base,
    );
  }

  private async launch(
    plan: ResolvedBrowserLaunchPlan,
  ): Promise<Browser> {
    const base: LaunchOptions = {
      headless: plan.headless,
      ...(plan.timeoutMs === undefined
        ? {}
        : { timeout: plan.timeoutMs }),
      ignoreDefaultArgs: plan.ignoreDefaultArgs,
      ...(plan.args.length === 0 ? {} : { args: plan.args }),
    };
    try {
      // Rule 1: an explicit executable path skips browser discovery entirely.
      if (plan.executablePath !== undefined) {
        return await chromium.launch({ ...base, executablePath: plan.executablePath });
      }
      // Rule 3: prefer system Google Chrome, falling back once to bundled Chromium.
      if (plan.distribution === "chrome") {
        try {
          return await chromium.launch({ ...base, channel: "chrome" });
        } catch (error) {
          if (!isChromeChannelUnavailable(error)) throw error;
          return await chromium.launch(base);
        }
      }
      // Rule 2: bundled Chromium without Chrome probing.
      return await chromium.launch(base);
    } catch (error) {
      throw toLaunchError(error);
    }
  }
}
