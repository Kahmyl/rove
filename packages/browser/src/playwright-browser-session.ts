import { randomUUID } from "node:crypto";
import { errors as playwrightErrors, type Browser, type BrowserContext, type Page } from "playwright";
import {
  RoveError,
  type ActionResult,
  type Artifact,
  type BrowserLaunchConfig,
  type InspectOptions,
  type PageInspection,
  type PageSummary,
  type ScreenshotOptions,
  type ScrollOptions,
  type TargetReference,
} from "@rove/protocol";
import type { BrowserSession } from "./engine.js";
import { PlaywrightPageRegistry } from "./pages/playwright-page-registry.js";
import type { PageState } from "./pages/page-state.js";

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const NAVIGATION_TIMEOUT_MS = 30_000;

function isBrowserClosedError(error: unknown): boolean {
  return error instanceof Error && /has been closed|is closed|browser.*disconnected/i.test(error.message);
}

function browserClosedError(): RoveError {
  return new RoveError({ code: "BROWSER_CLOSED", message: "The browser session is closed." });
}

export class PlaywrightBrowserSession implements BrowserSession {
  readonly id = `browser_${randomUUID()}`;

  private closed = false;
  private readonly pages = new PlaywrightPageRegistry();
  private recovering: Promise<void> | null = null;

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
  ) {
    this.pages.setOnPageClosed((_pageId, wasActive) => {
      if (this.closed || !wasActive) return;
      void this.recoverActivePage();
    });
  }

  static async create(browser: Browser, config: BrowserLaunchConfig): Promise<PlaywrightBrowserSession> {
    const context = await browser.newContext({ viewport: config.viewport ?? DEFAULT_VIEWPORT });
    const session = new PlaywrightBrowserSession(browser, context);
    context.on("page", (page) => session.registerNewPage(page));
    await context.newPage();
    return session;
  }

  private registerNewPage(page: Page): void {
    const state = this.pages.registerPage(page);
    // A newly opened page becomes the active page (application-level state).
    this.pages.activate(state.id);
  }

  private ensureOpen(): void {
    if (this.closed) throw browserClosedError();
  }

  private requireActivePageId(): string {
    const pageId = this.pages.activeId();
    if (pageId === undefined) {
      throw new RoveError({ code: "PAGE_NOT_FOUND", message: "The browser session has no active page." });
    }
    return pageId;
  }

  /** A live session always keeps an active page until close() begins. */
  private recoverActivePage(): Promise<void> {
    this.recovering ??= (async () => {
      try {
        if (this.closed || this.pages.activeId() !== undefined) return;
        const latest = this.pages.latestId();
        if (latest !== undefined) {
          this.pages.activate(latest);
          return;
        }
        await this.context.newPage();
      } finally {
        this.recovering = null;
      }
    })();
    return this.recovering;
  }

  async navigate(url: string): Promise<ActionResult> {
    this.ensureOpen();
    const pageId = this.requireActivePageId();
    const page = this.pages.pageFor(pageId);
    const previousRevision = this.pages.stateFor(pageId).revision;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      if (error instanceof playwrightErrors.TimeoutError) {
        throw new RoveError({
          code: "ACTION_TIMEOUT",
          message: `Navigation to ${url} timed out.`,
          retryable: true,
        });
      }
      if (isBrowserClosedError(error)) throw browserClosedError();
      throw new RoveError({ code: "NAVIGATION_FAILED", message: `Navigation to ${url} failed.` });
    }
    try {
      await this.pages.syncMetadata(pageId);
    } catch (error) {
      if (isBrowserClosedError(error)) throw browserClosedError();
      throw error;
    }
    const state = this.pages.stateFor(pageId);
    return {
      ok: true,
      action: "navigate",
      sessionId: this.id,
      pageId,
      pageChanged: true,
      previousRevision,
      currentRevision: state.revision,
      url: state.url,
    };
  }

  async pages(): Promise<PageSummary[]> {
    this.ensureOpen();
    await Promise.all(
      this.pages.summaries().map(async (summary) => {
        try {
          await this.pages.syncMetadata(summary.id);
        } catch {
          // Page disappeared concurrently; the registry is re-read below.
        }
      }),
    );
    return this.pages.summaries();
  }

  async switchPage(pageId: string): Promise<PageSummary> {
    this.ensureOpen();
    const page = this.pages.pageFor(pageId);
    this.pages.activate(pageId);
    try {
      await page.bringToFront();
    } catch (error) {
      if (isBrowserClosedError(error)) throw browserClosedError();
      throw error;
    }
    const state = await this.pages.syncMetadata(pageId);
    return this.toSummary(state);
  }

  async closePage(pageId: string): Promise<void> {
    this.ensureOpen();
    const page = this.pages.pageFor(pageId);
    await page.close();
    await this.recoverActivePage();
  }

  async inspect(_options?: InspectOptions): Promise<PageInspection> {
    this.ensureOpen();
    throw new RoveError({
      code: "NOT_IMPLEMENTED",
      message: "BrowserSession.inspect is implemented in Milestone 2.",
    });
  }

  async invalidateTargets(): Promise<void> {
    this.ensureOpen();
    throw new RoveError({
      code: "NOT_IMPLEMENTED",
      message: "BrowserSession.invalidateTargets is implemented in Milestone 2.",
    });
  }

  async click(_target: TargetReference): Promise<ActionResult> {
    this.ensureOpen();
    throw this.notImplemented("click");
  }

  async type(_target: TargetReference, _value: string): Promise<ActionResult> {
    this.ensureOpen();
    throw this.notImplemented("type");
  }

  async press(_target: TargetReference | null, _key: string): Promise<ActionResult> {
    this.ensureOpen();
    throw this.notImplemented("press");
  }

  async scroll(_options: ScrollOptions): Promise<ActionResult> {
    this.ensureOpen();
    throw this.notImplemented("scroll");
  }

  async back(): Promise<ActionResult> {
    this.ensureOpen();
    throw this.notImplemented("back");
  }

  async forward(): Promise<ActionResult> {
    this.ensureOpen();
    throw this.notImplemented("forward");
  }

  async screenshot(_options?: ScreenshotOptions): Promise<Artifact> {
    this.ensureOpen();
    throw this.notImplemented("screenshot");
  }

  private notImplemented(method: string): RoveError {
    return new RoveError({
      code: "NOT_IMPLEMENTED",
      message: `BrowserSession.${method} is implemented in Milestone 3.`,
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.context.close();
    } catch {
      // Context already closed; continue shutdown.
    }
    try {
      await this.browser.close();
    } catch {
      // Browser already closed; continue shutdown.
    }
    this.pages.clear();
  }

  private toSummary(state: PageState): PageSummary {
    return {
      id: state.id,
      url: state.url,
      active: state.active,
      revision: state.revision,
      ...(state.title === undefined ? {} : { title: state.title }),
    };
  }
}
