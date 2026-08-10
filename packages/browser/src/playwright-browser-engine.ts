import process from "node:process";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type LaunchOptions,
} from "playwright";
import { RoveError, type BrowserLaunchConfig } from "@rove/protocol";
import type { BrowserEngine, BrowserSession } from "./engine.js";
import { PlaywrightBrowserSession } from "./playwright-browser-session.js";

/** The Chrome channel is unavailable when its executable cannot be found. */
function isChromeChannelUnavailable(error: unknown): boolean {
  return error instanceof Error && /not found|doesn't exist|does not exist/i.test(error.message);
}

function toLaunchError(error: unknown): RoveError {
  const roveError = new RoveError({
    code: "BROWSER_LAUNCH_FAILED",
    message: "The browser failed to launch.",
  });
  if (error instanceof Error) roveError.cause = error;
  return roveError;
}

export class PlaywrightBrowserEngine implements BrowserEngine {
  async start(config: BrowserLaunchConfig): Promise<BrowserSession> {
    if (config.profile.mode === "existing") {
      throw new RoveError({
        code: "NOT_IMPLEMENTED",
        message:
          "Existing Chrome profiles are not supported yet.",
      });
    }

    if (config.profile.mode === "persistent") {
      return this.startPersistent(config);
    }

    const browser = await this.launch(config);

    try {
      return await PlaywrightBrowserSession.create(
        browser,
        config,
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
  ): Promise<BrowserSession> {
    const userDataDir =
      config.profileUserDataDir;

    if (userDataDir === undefined) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message:
          "Persistent browser profile directory was not resolved.",
      });
    }

    let context: BrowserContext;

    try {
      context =
        await this.launchPersistent(
          userDataDir,
          config,
        );
    } catch (error) {
      throw toLaunchError(error);
    }

    try {
      return await PlaywrightBrowserSession
        .createPersistent(
          context,
          config,
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
    config: BrowserLaunchConfig,
  ): Promise<BrowserContext> {
    const base = {
      headless: config.headless,
      viewport:
        config.viewport ?? {
          width: 1440,
          height: 900,
        },
      ...(process.platform === "darwin"
        ? {
            ignoreDefaultArgs: [
              "--use-mock-keychain",
              "--password-store=basic",
            ],
          }
        : {}),
      ...(config.launchArgs === undefined
        ? {}
        : {
            args: config.launchArgs,
          }),
    };

    if (config.executablePath !== undefined) {
      return chromium.launchPersistentContext(
        userDataDir,
        {
          ...base,
          executablePath:
            config.executablePath,
        },
      );
    }

    if (config.browser === "chrome") {
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

  private async launch(config: BrowserLaunchConfig): Promise<Browser> {
    const base: LaunchOptions = {
      headless: config.headless,
      ...(config.launchArgs === undefined ? {} : { args: config.launchArgs }),
    };
    try {
      // Rule 1: an explicit executable path skips browser discovery entirely.
      if (config.executablePath !== undefined) {
        return await chromium.launch({ ...base, executablePath: config.executablePath });
      }
      // Rule 3: prefer system Google Chrome, falling back once to bundled Chromium.
      if (config.browser === "chrome") {
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
