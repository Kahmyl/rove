import { RoveError, type BrowserLaunchConfig } from "@rove/protocol";
import type { BrowserEngine, BrowserSession } from "./engine.js";

export class NotImplementedBrowserEngine implements BrowserEngine {
  async start(_config: BrowserLaunchConfig): Promise<BrowserSession> {
    throw new RoveError({
      code: "NOT_IMPLEMENTED",
      message: "The Playwright browser engine is the next implementation slice.",
    });
  }
}
