import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import {
  BROWSER_ENGINE,
  type BrowserEngine,
  type BrowserSession,
} from "@rove/browser";
import {
  RoveError,
  type BrowserHostIdentity,
  type BrowserWindowState,
  type BrowserLaunchConfig,
} from "@rove/protocol";

@Injectable()
export class BrowserService implements OnModuleDestroy {
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly persistentProfiles = new Map<string, string>();

  constructor(@Inject(BROWSER_ENGINE) private readonly engine: BrowserEngine) {}

  async start(
    sessionId: string,
    config: BrowserLaunchConfig,
  ): Promise<BrowserSession> {
    if (this.sessions.has(sessionId)) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "A browser is already attached to this session.",
      });
    }
    if (config.profile?.mode === "persistent") {
      const owner = this.persistentProfiles.get(config.profile.name);
      if (owner !== undefined) {
        throw new RoveError({
          code: "PROFILE_LOCKED",
          message:
            "The persistent browser workspace is in use by an active Rove session.",
          retryable: true,
          details: { state: "active_session", sessionId: owner },
        });
      }
    }
    const browser = await this.engine.start(config);
    this.sessions.set(sessionId, browser);
    if (config.profile?.mode === "persistent") {
      this.persistentProfiles.set(config.profile.name, sessionId);
    }
    return browser;
  }

  get(sessionId: string): BrowserSession {
    const browser = this.sessions.get(sessionId);
    if (!browser) {
      throw new RoveError({
        code: "BROWSER_CLOSED",
        message: "No browser is attached to this session.",
      });
    }
    return browser;
  }

  hostIdentity(sessionId: string): BrowserHostIdentity | null {
    return this.get(sessionId).hostIdentity();
  }

  windowState(sessionId: string): Promise<BrowserWindowState | null> {
    return this.get(sessionId).browserWindowState();
  }

  async show(sessionId: string): Promise<boolean> {
    if (!this.sessions.has(sessionId)) return false;
    await this.get(sessionId).show();
    return true;
  }

  async close(sessionId: string): Promise<void> {
    const browser = this.sessions.get(sessionId);
    if (!browser) return;
    this.sessions.delete(sessionId);
    for (const [profileName, owner] of this.persistentProfiles) {
      if (owner === sessionId) this.persistentProfiles.delete(profileName);
    }
    await browser.close();
  }

  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async onModuleDestroy(): Promise<void> {
    const sessionIds = this.sessionIds();

    await Promise.allSettled(
      sessionIds.map((sessionId) => this.close(sessionId)),
    );
  }
}
