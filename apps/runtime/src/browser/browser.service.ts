import { Inject, Injectable } from "@nestjs/common";
import { BROWSER_ENGINE, type BrowserEngine, type BrowserSession } from "@rove/browser";
import { RoveError, type BrowserLaunchConfig } from "@rove/protocol";

@Injectable()
export class BrowserService {
  private readonly sessions = new Map<string, BrowserSession>();

  constructor(@Inject(BROWSER_ENGINE) private readonly engine: BrowserEngine) {}

  async start(sessionId: string, config: BrowserLaunchConfig): Promise<BrowserSession> {
    const browser = await this.engine.start(config);
    this.sessions.set(sessionId, browser);
    return browser;
  }

  get(sessionId: string): BrowserSession {
    const browser = this.sessions.get(sessionId);
    if (!browser) {
      throw new RoveError({ code: "BROWSER_CLOSED", message: "No browser is attached to this session." });
    }
    return browser;
  }

  async close(sessionId: string): Promise<void> {
    const browser = this.sessions.get(sessionId);
    if (!browser) return;
    this.sessions.delete(sessionId);
    await browser.close();
  }
}
