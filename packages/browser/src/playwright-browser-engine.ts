import { chromium, type Browser, type LaunchOptions } from "playwright";
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
    if (config.profile.mode !== "temporary") {
      throw new RoveError({
        code: "NOT_IMPLEMENTED",
        message: `Browser profile mode "${config.profile.mode}" is not implemented yet; only "temporary" profiles are supported.`,
      });
    }
    const browser = await this.launch(config);
    try {
      return await PlaywrightBrowserSession.create(browser, config);
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw toLaunchError(error);
    }
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
