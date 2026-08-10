import { randomUUID } from "node:crypto";
import { errors as playwrightErrors, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
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
import type {
  BrowserActivity,
  BrowserActivityListener,
} from "./observation/browser-activity.js";
import {
  installDomActivityListeners,
  normalizeDomActivityPayload,
} from "./observation/dom-activity.js";
import { PageInspector } from "./inspection/inspector.js";
import { PlaywrightPageRegistry } from "./pages/playwright-page-registry.js";
import { recordMutation, type PageState } from "./pages/page-state.js";
import { actionError } from "./actions/action-errors.js";
import {
  DEFAULT_ACTION_TIMEOUT_MS,
  DEFAULT_NAVIGATION_TIMEOUT_MS,
  POPUP_GRACE_MS,
} from "./actions/action-runner.js";
import { readMaterialMutationVersion, installMutationTracker } from "./mutations/mutation-tracker.js";
import { resolveTarget, type ResolvedTarget } from "./targets/target-resolver.js";
import { isSensitiveTarget } from "./targets/target-identity.js";

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

function isBrowserClosedError(error: unknown): boolean {
  return error instanceof Error && /has been closed|is closed|browser.*disconnected/i.test(error.message);
}

function browserClosedError(): RoveError {
  return new RoveError({ code: "BROWSER_CLOSED", message: "The browser session is closed." });
}

export class PlaywrightBrowserSession implements BrowserSession {
  readonly id = `browser_${randomUUID()}`;

  private closed = false;
  private readonly pageRegistry = new PlaywrightPageRegistry();
  private readonly inspector = new PageInspector();
  private readonly activityListeners =
    new Set<BrowserActivityListener>();
  private recovering: Promise<void> | null = null;
  private browserCdp:
    | CDPSession
    | undefined;
  private activeTabTimer:
    | ReturnType<typeof setInterval>
    | undefined;
  private reconcilingActiveTab = false;

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly actionTimeoutMs: number,
    private readonly navigationTimeoutMs: number,
  ) {
    this.pageRegistry.setOnPageClosed((pageId, wasActive) => {
      this.inspector.forgetPage(pageId);

      if (this.closed || !wasActive) return;

      void this.recoverActivePage();
    });

    this.pageRegistry.setOnPageNavigated(
      ({
        pageId,
        previousUrl,
        url,
        revision,
      }) => {
        if (
          previousUrl !== url
        ) {
          this.emitActivity({
            type: "url_changed",
            pageId,
            pageRevision: revision,
            timestamp:
              new Date().toISOString(),
            data: {
              previousUrl,
              url,
            },
          });
        }

        this.emitActivity({
          type: "navigation_completed",
          pageId,
          pageRevision: revision,
          timestamp:
            new Date().toISOString(),
          data: {
            url,
          },
        });
      },
    );
  }

  static async create(browser: Browser, config: BrowserLaunchConfig): Promise<PlaywrightBrowserSession> {
    const context = await browser.newContext({ viewport: config.viewport ?? DEFAULT_VIEWPORT });
    return this.createFromContext(
      browser,
      context,
      config,
      false,
    );
  }

  static async createPersistent(
    context: BrowserContext,
    config: BrowserLaunchConfig,
  ): Promise<PlaywrightBrowserSession> {
    const browser = context.browser();

    if (browser === null) {
      throw new RoveError({
        code: "BROWSER_LAUNCH_FAILED",
        message:
          "Persistent browser context has no owning browser.",
      });
    }

    return this.createFromContext(
      browser,
      context,
      config,
      true,
    );
  }

  private static async createFromContext(
    browser: Browser,
    context: BrowserContext,
    config: BrowserLaunchConfig,
    preserveExistingPages: boolean,
  ): Promise<PlaywrightBrowserSession> {
    const session = new PlaywrightBrowserSession(
      browser,
      context,
      config.timeouts?.actionMs ?? DEFAULT_ACTION_TIMEOUT_MS,
      config.timeouts?.navigationMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS,
    );

    await session.installDomActivityBridge();

    context.on(
      "page",
      (page) => session.registerNewPage(page),
    );

    if (preserveExistingPages) {
      for (const page of context.pages()) {
        session.registerNewPage(page);
      }
    }

    if (context.pages().length === 0) {
      await context.newPage();
    }

    await session.startActiveTabObservation();

    return session;
  }

  private async installDomActivityBridge(): Promise<void> {
    await this.context.exposeBinding(
      "__roveReportActivity",
      ({ page }, payload: unknown) => {
        this.handleDomActivity(
          page,
          payload,
        );
      },
    );

    await this.context.addInitScript(
      installDomActivityListeners,
    );
  }

  private async startActiveTabObservation(): Promise<void> {
    if (this.browserCdp !== undefined) {
      return;
    }

    this.browserCdp =
      await this.browser.newBrowserCDPSession();

    await this.reconcileActiveTab();

    this.activeTabTimer =
      setInterval(
        () => {
          void this.reconcileActiveTab();
        },
        250,
      );
  }

  private async reconcileActiveTab(): Promise<void> {
    if (
      this.closed ||
      this.reconcilingActiveTab ||
      this.browserCdp === undefined
    ) {
      return;
    }

    this.reconcilingActiveTab = true;

    try {
      const result =
        await this.browserCdp.send(
          "Target.getTargets",
          {
            filter: [
              {
                type: "tab",
                exclude: false,
              },
              {
                exclude: true,
              },
            ],
          },
        ) as {
          targetInfos: Array<{
            type: string;
            title: string;
            url: string;
            embedderData?: {
              tabActive?: boolean;
              tabStripIndex?: number;
            };
          }>;
        };

      const activeTarget =
        result.targetInfos.find(
          target =>
            target.type === "tab" &&
            target.embedderData?.tabActive ===
              true,
        );

      if (activeTarget === undefined) {
        return;
      }

      const pageId =
        this.resolveTabTargetPageId(
          activeTarget,
        );

      if (
        pageId === undefined ||
        this.pageRegistry.activeId() ===
          pageId
      ) {
        return;
      }

      const state =
        this.pageRegistry.activate(
          pageId,
        );

      this.emitActivity({
        type: "page_switched",
        pageId,
        pageRevision: state.revision,
        timestamp:
          new Date().toISOString(),
        data: {
          url: state.url,
        },
      });
    } catch {
      return;
    } finally {
      this.reconcilingActiveTab = false;
    }
  }

  private resolveTabTargetPageId(
    target: {
      title: string;
      url: string;
      embedderData?: {
        tabStripIndex?: number;
      };
    },
  ): string | undefined {
    const summaries =
      this.pageRegistry.summaries();

    const exact =
      summaries.filter(
        summary =>
          summary.url === target.url &&
          summary.title === target.title,
      );

    if (exact.length === 1) {
      return exact[0]?.id;
    }

    const matchingUrl =
      summaries.filter(
        summary =>
          summary.url === target.url,
      );

    if (matchingUrl.length === 1) {
      return matchingUrl[0]?.id;
    }

    const tabStripIndex =
      target.embedderData
        ?.tabStripIndex;

    if (
      typeof tabStripIndex !== "number" ||
      !Number.isInteger(tabStripIndex) ||
      tabStripIndex < 0
    ) {
      return undefined;
    }

    const page =
      this.context.pages()[
        tabStripIndex
      ];

    if (page === undefined) {
      return undefined;
    }

    return this.pageRegistry.pageIdFor(
      page,
    );
  }

  private handleDomActivity(
    page: Page,
    payload: unknown,
  ): void {
    if (this.closed) {
      return;
    }

    const pageId =
      this.pageRegistry.pageIdFor(page);

    if (
      pageId === undefined ||
      !this.pageRegistry.has(pageId)
    ) {
      return;
    }

    const activity =
      normalizeDomActivityPayload(payload);

    if (activity === null) {
      return;
    }

    if (
      this.pageRegistry.activeId() !==
      pageId
    ) {
      const state =
        this.pageRegistry.activate(pageId);

      this.emitActivity({
        type: "page_switched",
        pageId,
        pageRevision: state.revision,
        timestamp:
          new Date().toISOString(),
        data: {
          url: page.url(),
        },
      });
    }

    const state =
      this.pageRegistry.stateFor(pageId);

    this.emitActivity({
      type: activity.type,
      pageId,
      pageRevision: state.revision,
      timestamp:
        new Date().toISOString(),
      data: activity.data,
    });
  }

  private registerNewPage(page: Page): void {
    const state = this.pageRegistry.registerPage(page);
    this.pageRegistry.activate(state.id);
    this.observePage(page, state.id);

    this.emitActivity({
      type: "page_opened",
      pageId: state.id,
      pageRevision: state.revision,
      timestamp: new Date().toISOString(),
      data: {
        url: state.url,
      },
    });
  }

  onActivity(
    listener: BrowserActivityListener,
  ): () => void {
    this.activityListeners.add(listener);

    return () => {
      this.activityListeners.delete(listener);
    };
  }

  private observePage(
    page: Page,
    pageId: string,
  ): void {
    let previousTitle: string | undefined;

    const observeTitle = () => {
      if (
        page.isClosed() ||
        !this.pageRegistry.has(pageId)
      ) {
        return;
      }

      void page
        .title()
        .then((title) => {
          if (
            title === previousTitle ||
            !this.pageRegistry.has(pageId)
          ) {
            return;
          }

          previousTitle = title;

          const state =
            this.pageRegistry.stateFor(pageId);

          this.emitActivity({
            type: "page_title_changed",
            pageId,
            pageRevision: state.revision,
            timestamp: new Date().toISOString(),
            data: {
              title,
              url: page.url(),
            },
          });
        })
        .catch(() => undefined);
    };

    page.on("domcontentloaded", observeTitle);
    page.on("load", observeTitle);
  }

  private emitActivity(
    activity: BrowserActivity,
  ): void {
    for (const listener of this.activityListeners) {
      try {
        listener(activity);
      } catch {
        // Browser activity observers must never break browser execution.
      }
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw browserClosedError();
  }

  private requireActivePageId(): string {
    const pageId = this.pageRegistry.activeId();
    if (pageId === undefined) {
      throw new RoveError({ code: "PAGE_NOT_FOUND", message: "The browser session has no active page." });
    }
    return pageId;
  }

  /** A live session always keeps an active page until close() begins. */
  private recoverActivePage(): Promise<void> {
    this.recovering ??= (async () => {
      try {
        if (this.closed || this.pageRegistry.activeId() !== undefined) return;
        const latest = this.pageRegistry.latestId();
        if (latest !== undefined) {
          this.pageRegistry.activate(latest);
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
    const page = this.pageRegistry.pageFor(pageId);
    const previousRevision = this.pageRegistry.stateFor(pageId).revision;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.navigationTimeoutMs });
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
      await this.pageRegistry.syncMetadata(pageId);
    } catch (error) {
      if (isBrowserClosedError(error)) throw browserClosedError();
      throw error;
    }
    const state = this.pageRegistry.stateFor(pageId);

    await this.inspector.invalidatePage(
      page,
      pageId,
      state.revision,
    );

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
      this.pageRegistry.summaries().map(async (summary) => {
        try {
          await this.pageRegistry.syncMetadata(summary.id);
        } catch {
          // Page disappeared concurrently; the registry is re-read below.
        }
      }),
    );
    return this.pageRegistry.summaries();
  }

  async switchPage(pageId: string): Promise<PageSummary> {
    this.ensureOpen();

    const previousActivePageId =
      this.pageRegistry.activeId();

    const page =
      this.pageRegistry.pageFor(pageId);

    this.pageRegistry.activate(pageId);

    try {
      await page.bringToFront();
    } catch (error) {
      if (isBrowserClosedError(error)) {
        throw browserClosedError();
      }

      throw error;
    }

    const state =
      await this.pageRegistry.syncMetadata(
        pageId,
      );

    if (
      previousActivePageId !== pageId
    ) {
      this.emitActivity({
        type: "page_switched",
        pageId,
        pageRevision: state.revision,
        timestamp:
          new Date().toISOString(),
        data: {
          url: state.url,
        },
      });
    }

    return this.toSummary(state);
  }

  async closePage(pageId: string): Promise<void> {
    this.ensureOpen();
    const page = this.pageRegistry.pageFor(pageId);
    await page.close();
    await this.recoverActivePage();
  }

  async inspect(options: InspectOptions = {}): Promise<PageInspection> {
    this.ensureOpen();

    const pageId =
      options.pageId ?? this.requireActivePageId();

    const page = this.pageRegistry.pageFor(pageId);

    let state: PageState;

    try {
      state = await this.pageRegistry.syncMetadata(pageId);
    } catch (error) {
      if (isBrowserClosedError(error)) {
        throw browserClosedError();
      }

      throw error;
    }

    await installMutationTracker(page);
    state = this.pageRegistry.update(pageId, {
      mutationVersion: await readMaterialMutationVersion(page),
    });

    return this.inspector.inspect(
      page,
      state,
      options,
    );
  }

  async invalidateTargets(): Promise<void> {
    this.ensureOpen();

    const pageId = this.requireActivePageId();
    const page = this.pageRegistry.pageFor(pageId);

    const current = this.pageRegistry.stateFor(pageId);
    const next = recordMutation(current, true);

    const state = this.pageRegistry.update(
      pageId,
      next,
    );

    await this.inspector.invalidatePage(
      page,
      pageId,
      state.revision,
    );
  }

  async invalidateAllTargets(): Promise<number> {
    this.ensureOpen();
    let invalidated = 0;
    for (const summary of this.pageRegistry.summaries()) {
      if (!this.pageRegistry.has(summary.id)) continue;
      const page = this.pageRegistry.pageFor(summary.id);
      const current = this.pageRegistry.stateFor(summary.id);
      const next = this.pageRegistry.update(summary.id, recordMutation(current, true));
      await this.inspector.invalidatePage(page, summary.id, next.revision);
      invalidated += 1;
    }
    return invalidated;
  }

  async click(target: TargetReference): Promise<ActionResult> {
    this.ensureOpen();
    const beforePages = this.pageRegistry.summaries();
    const resolved = await this.resolveActionTarget(target);
    const previous = this.pageRegistry.stateFor(target.pageId);
    const popup = this.context.waitForEvent("page", { timeout: POPUP_GRACE_MS }).catch(() => null);
    try {
      await resolved.locator.click({ timeout: this.actionTimeoutMs });
      if (this.pageRegistry.summaries().length === beforePages.length) await popup;
    } catch (error) {
      throw actionError(error, "Click");
    }
    return this.synchronizeAfterAction("click", target.pageId, previous, beforePages);
  }

  async type(target: TargetReference, value: string): Promise<ActionResult> {
    this.ensureOpen();
    const beforePages = this.pageRegistry.summaries();
    const resolved = await this.resolveActionTarget(target);
    if (!resolved.state.editable) {
      throw new RoveError({ code: "TARGET_NOT_INTERACTIVE", message: "The target does not accept text." });
    }
    void isSensitiveTarget(resolved.state.identity);
    const previous = this.pageRegistry.stateFor(target.pageId);
    try {
      await resolved.locator.fill(value, { timeout: this.actionTimeoutMs });
    } catch (error) {
      throw actionError(error, "Type");
    }
    return this.synchronizeAfterAction("type", target.pageId, previous, beforePages);
  }

  async press(target: TargetReference | null, key: string): Promise<ActionResult> {
    this.ensureOpen();
    const pageId = target?.pageId ?? this.requireActivePageId();
    const beforePages = this.pageRegistry.summaries();
    const previous = this.pageRegistry.stateFor(pageId);
    try {
      if (target === null) {
        await this.pageRegistry.pageFor(pageId).keyboard.press(key);
      } else {
        const resolved = await this.resolveActionTarget(target);
        await resolved.locator.press(key, { timeout: this.actionTimeoutMs });
      }
    } catch (error) {
      throw actionError(error, "Press");
    }
    return this.synchronizeAfterAction("press", pageId, previous, beforePages);
  }

  async scroll(options: ScrollOptions): Promise<ActionResult> {
    this.ensureOpen();
    const amount = options.amount ?? 600;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new RoveError({ code: "INVALID_CONFIGURATION", message: "Scroll amount must be positive." });
    }
    const pageId = this.requireActivePageId();
    const page = this.pageRegistry.pageFor(pageId);
    const previous = this.pageRegistry.stateFor(pageId);
    const beforePages = this.pageRegistry.summaries();
    const deltas: Record<ScrollOptions["direction"], readonly [number, number]> = {
      up: [0, -amount],
      down: [0, amount],
      left: [-amount, 0],
      right: [amount, 0],
    };
    const delta = deltas[options.direction];
    try {
      await page.mouse.wheel(delta[0], delta[1]);
    } catch (error) {
      throw actionError(error, "Scroll");
    }
    return this.synchronizeAfterAction("scroll", pageId, previous, beforePages);
  }

  async back(): Promise<ActionResult> {
    this.ensureOpen();
    return this.historyAction("back");
  }

  async forward(): Promise<ActionResult> {
    this.ensureOpen();
    return this.historyAction("forward");
  }

  async screenshot(options: ScreenshotOptions = {}): Promise<Artifact> {
    this.ensureOpen();
    const mode = options.mode ?? "viewport";
    const pageId = options.target?.pageId ?? this.requireActivePageId();
    const page = this.pageRegistry.pageFor(pageId);
    let target: ResolvedTarget | undefined;
    if (mode === "target") {
      if (options.target === undefined) {
        throw new RoveError({ code: "TARGET_NOT_FOUND", message: "Target screenshot requires a TargetReference." });
      }
      target = await this.resolveActionTarget(options.target);
    }
    await this.applySensitiveMask(page);
    try {
      const bytes = mode === "target"
        ? await target!.locator.screenshot({ type: "png", timeout: this.actionTimeoutMs })
        : await page.screenshot({ type: "png", fullPage: mode === "full-page", timeout: this.actionTimeoutMs });
      const state = await this.pageRegistry.syncMetadata(pageId);
      return {
        mimeType: "image/png",
        bytes,
        metadata: { pageId, revision: state.revision, url: state.url, mode, timestamp: new Date().toISOString() },
      };
    } catch (error) {
      throw actionError(error, "Screenshot");
    } finally {
      await this.removeSensitiveMask(page).catch(() => undefined);
    }
  }

  private async resolveActionTarget(target: TargetReference): Promise<ResolvedTarget> {
    const page = this.pageRegistry.pageFor(target.pageId);
    await installMutationTracker(page);
    let state = this.pageRegistry.stateFor(target.pageId);
    const browserMutationVersion = await readMaterialMutationVersion(page);
    if (browserMutationVersion !== state.mutationVersion) {
      state = this.pageRegistry.update(target.pageId, { mutationVersion: browserMutationVersion });
    }
    return resolveTarget({
      page,
      pageState: state,
      reference: target,
      registry: this.inspector.registryForPage(target.pageId),
      onStale: async () => this.invalidatePage(target.pageId),
    });
  }

  private async invalidatePage(pageId: string): Promise<void> {
    const page = this.pageRegistry.pageFor(pageId);
    const current = this.pageRegistry.stateFor(pageId);
    const next = this.pageRegistry.update(pageId, {
      revision: current.revision + 1,
      mutationVersion: await readMaterialMutationVersion(page),
    });
    await this.inspector.invalidatePage(page, pageId, next.revision);
  }

  private async synchronizeAfterAction(
    action: ActionResult["action"],
    pageId: string,
    previous: PageState,
    beforePages: PageSummary[],
  ): Promise<ActionResult> {
    const page = this.pageRegistry.pageFor(pageId);
    let current = await this.pageRegistry.syncMetadata(pageId);
    const mutationVersion = await readMaterialMutationVersion(page);
    if (current.revision === previous.revision && mutationVersion !== previous.mutationVersion) {
      current = this.pageRegistry.update(pageId, {
        mutationVersion,
        revision: current.revision + 1,
      });
    } else if (mutationVersion !== current.mutationVersion) {
      current = this.pageRegistry.update(pageId, { mutationVersion });
    }
    if (current.revision !== previous.revision) {
      await this.inspector.invalidatePage(page, pageId, current.revision);
    }
    const afterPages = this.pageRegistry.summaries();
    const beforeIds = new Set(beforePages.map((summary) => summary.id));
    const openedPages = afterPages.filter((summary) => !beforeIds.has(summary.id));
    const activeChanged = beforePages.find((summary) => summary.active)?.id !== afterPages.find((summary) => summary.active)?.id;
    const pageChanged = current.url !== previous.url || current.revision !== previous.revision || openedPages.length > 0 || activeChanged;
    return {
      ok: true,
      action,
      sessionId: this.id,
      pageId,
      pageChanged,
      previousRevision: previous.revision,
      currentRevision: current.revision,
      url: current.url,
      ...(openedPages.length === 0 ? {} : { openedPages }),
    };
  }

  private async historyAction(action: "back" | "forward"): Promise<ActionResult> {
    const pageId = this.requireActivePageId();
    const page = this.pageRegistry.pageFor(pageId);
    const previous = this.pageRegistry.stateFor(pageId);
    const beforePages = this.pageRegistry.summaries();
    try {
      const response = action === "back"
        ? await page.goBack({ waitUntil: "domcontentloaded", timeout: this.navigationTimeoutMs })
        : await page.goForward({ waitUntil: "domcontentloaded", timeout: this.navigationTimeoutMs });
      if (response === null) {
        return { ok: true, action, sessionId: this.id, pageId, pageChanged: false, previousRevision: previous.revision, currentRevision: previous.revision, url: previous.url };
      }
      return this.synchronizeAfterAction(action, pageId, previous, beforePages);
    } catch (error) {
      if (error instanceof playwrightErrors.TimeoutError) {
        throw new RoveError({ code: "ACTION_TIMEOUT", message: `Browser ${action} timed out.`, retryable: true });
      }
      if (isBrowserClosedError(error)) throw browserClosedError();
      throw new RoveError({ code: "NAVIGATION_FAILED", message: `Browser ${action} failed.` });
    }
  }

  private async applySensitiveMask(page: Page): Promise<void> {
    await page.evaluate(() => {
      if (!document.querySelector("style[data-rove-sensitive-style]")) {
        const style = document.createElement("style");
        style.setAttribute("data-rove-sensitive-style", "");
        style.textContent = "[data-rove-sensitive-mask]{-webkit-text-security:disc!important;color:transparent!important;text-shadow:0 0 0 currentColor!important}";
        document.head.append(style);
      }
      for (const element of Array.from(document.querySelectorAll<HTMLInputElement>("input"))) {
        const semantic = `${element.type} ${element.autocomplete} ${element.name} ${element.id} ${element.getAttribute("aria-label") ?? ""}`.toLowerCase();
        if (element.type === "password" || element.autocomplete === "one-time-code" || /password|passcode|otp|one.?time|secret|token/.test(semantic)) {
          element.setAttribute("data-rove-sensitive-mask", "");
        }
      }
    });
  }

  private async removeSensitiveMask(page: Page): Promise<void> {
    await page.evaluate(() => {
      document.querySelectorAll("[data-rove-sensitive-mask]").forEach((element) => element.removeAttribute("data-rove-sensitive-mask"));
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (
      this.activeTabTimer !== undefined
    ) {
      clearInterval(
        this.activeTabTimer,
      );
      this.activeTabTimer =
        undefined;
    }

    const browserCdp =
      this.browserCdp;

    this.browserCdp = undefined;

    if (browserCdp !== undefined) {
      await browserCdp
        .detach()
        .catch(() => undefined);
    }

    this.activityListeners.clear();
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
    this.pageRegistry.clear();
    this.inspector.clear();
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
