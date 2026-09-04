import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  errors as playwrightErrors,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright";
import {
  RoveError,
  type ActionResult,
  type Artifact,
  type BrowserLaunchConfig,
  type BrowserObservation,
  type BrowserRuntimeCapabilities,
  type BrowserViewport,
  type InspectOptions,
  type PageStateIdentity,
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
import { BrowserEvidenceRecorder } from "./observation/browser-evidence.js";
import {
  DOM_ACTIVITY_INIT_SCRIPT,
  normalizeDomActivityPayload,
} from "./observation/dom-activity.js";
import { PageInspector, readBrowserViewport } from "./inspection/inspector.js";
import { PlaywrightPageRegistry } from "./pages/playwright-page-registry.js";
import { recordMutation, type PageState } from "./pages/page-state.js";
import { actionError } from "./actions/action-errors.js";
import {
  DEFAULT_ACTION_TIMEOUT_MS,
  DEFAULT_NAVIGATION_TIMEOUT_MS,
  POPUP_GRACE_MS,
} from "./actions/action-runner.js";
import {
  readMaterialMutationVersion,
  installMutationTracker,
  setTransientTargetStyleMutationSuppression,
} from "./mutations/mutation-tracker.js";
import {
  resolveTarget,
  type ResolvedTarget,
} from "./targets/target-resolver.js";
import { isSensitiveTarget } from "./targets/target-identity.js";
import type { ResolvedDownloadRuntime } from "./downloads/download-runtime.js";
import { saveManagedDownload } from "./downloads/managed-downloads.js";
import {
  verifyChromiumSandbox,
  type BrowserSandboxVerification,
} from "./runtime/browser-sandbox.js";
import type {
  BrowserDistribution,
  BrowserLaunchPlanDiagnostic,
} from "./runtime/browser-launch-plan.js";
import {
  collectPageStateIdentity,
  observeStablePageState,
} from "./perception/page-state-observation.js";

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

const MAX_OBSERVATION_AUTHORITIES = 100;

interface ObservationAuthority {
  observationId: string;
  pageId: string;
  revision: number;
  mutationVersion: number;
  url: string;
  viewport: BrowserViewport;
}

function isBrowserClosedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /has been closed|is closed|browser.*disconnected/i.test(error.message)
  );
}

function sameTargetInlineStyles(
  before: Record<string, string | null>,
  after: Record<string, string | null>,
): boolean {
  const beforeKeys = Object.keys(before);

  const afterKeys = Object.keys(after);

  return (
    beforeKeys.length === afterKeys.length &&
    beforeKeys.every((marker) => after[marker] === before[marker])
  );
}

function browserClosedError(): RoveError {
  return new RoveError({
    code: "BROWSER_CLOSED",
    message: "The browser session is closed.",
  });
}

export class PlaywrightBrowserSession implements BrowserSession {
  private closed = false;
  private readonly pageRegistry = new PlaywrightPageRegistry();
  private readonly inspector = new PageInspector();
  private readonly observationAuthorities = new Map<
    string,
    ObservationAuthority
  >();
  private readonly activityListeners = new Set<BrowserActivityListener>();
  private recovering: Promise<void> | null = null;
  private browserCdp: CDPSession | undefined;
  private activeTabTimer: ReturnType<typeof setInterval> | undefined;
  private reconcilingActiveTab = false;
  private domActivityDrainTimer: ReturnType<typeof setInterval> | undefined;
  private drainingDomActivity = false;
  private readonly evidenceRecorder = new BrowserEvidenceRecorder(
    (pageId, evidence) => {
      const state = this.pageRegistry.has(pageId)
        ? this.pageRegistry.stateFor(pageId)
        : undefined;
      this.emitActivity({
        type: "browser_evidence",
        pageId,
        ...(state === undefined ? {} : { pageRevision: state.revision }),
        timestamp: new Date().toISOString(),
        data: { evidence },
      });
    },
  );
  private downloadSaveQueue: Promise<void> = Promise.resolve();

  private constructor(
    readonly id: string,
    readonly capabilities: BrowserRuntimeCapabilities,
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly actionTimeoutMs: number,
    private readonly navigationTimeoutMs: number,
    private readonly typingDelayMs: number,
    private readonly headless: boolean,
    private readonly downloadRuntime?: ResolvedDownloadRuntime,
    private readonly ownedRuntimeCleanup?: () => Promise<void>,
  ) {
    this.pageRegistry.setOnPageClosed((pageId, wasActive) => {
      this.inspector.forgetPage(pageId);
      this.evidenceRecorder.forget(pageId);

      if (this.closed || !wasActive) return;

      void this.recoverActivePage();
    });

    this.pageRegistry.setOnPageNavigated(
      ({ pageId, previousUrl, url, revision }) => {
        if (previousUrl !== url) {
          this.emitActivity({
            type: "url_changed",
            pageId,
            pageRevision: revision,
            timestamp: new Date().toISOString(),
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
          timestamp: new Date().toISOString(),
          data: {
            url,
          },
        });
      },
    );
  }

  static async create(
    browser: Browser,
    config: BrowserLaunchConfig,
    runtime: BrowserRuntimeSnapshot,
    downloadRuntime?: ResolvedDownloadRuntime,
    sessionId = `browser_${randomUUID()}`,
  ): Promise<PlaywrightBrowserSession> {
    const context = await browser.newContext({
      acceptDownloads: true,
      ...(downloadRuntime === undefined
        ? {}
        : { downloadsPath: downloadRuntime.directory }),
      viewport: config.viewport ?? DEFAULT_VIEWPORT,
    });
    const sandbox = await verifyChromiumSandbox(context);
    return this.createFromContext(
      browser,
      context,
      config,
      false,
      runtime,
      sandbox,
      downloadRuntime,
      sessionId,
    );
  }

  static async createPersistent(
    context: BrowserContext,
    config: BrowserLaunchConfig,
    runtime: BrowserRuntimeSnapshot,
    downloadRuntime?: ResolvedDownloadRuntime,
    sessionId = `browser_${randomUUID()}`,
    ownedRuntimeCleanup?: () => Promise<void>,
  ): Promise<PlaywrightBrowserSession> {
    const browser = context.browser();

    if (browser === null) {
      throw new RoveError({
        code: "BROWSER_LAUNCH_FAILED",
        message: "Persistent browser context has no owning browser.",
      });
    }

    const sandbox = await verifyChromiumSandbox(context);

    return this.createFromContext(
      browser,
      context,
      config,
      true,
      runtime,
      sandbox,
      downloadRuntime,
      sessionId,
      ownedRuntimeCleanup,
    );
  }

  private static async createFromContext(
    browser: Browser,
    context: BrowserContext,
    config: BrowserLaunchConfig,
    preserveExistingPages: boolean,
    runtime: BrowserRuntimeSnapshot,
    sandbox: BrowserSandboxVerification,
    downloadRuntime?: ResolvedDownloadRuntime,
    sessionId = `browser_${randomUUID()}`,
    ownedRuntimeCleanup?: () => Promise<void>,
  ): Promise<PlaywrightBrowserSession> {
    const session = new PlaywrightBrowserSession(
      sessionId,
      runtimeCapabilities(browser, config, runtime, sandbox, downloadRuntime),
      browser,
      context,
      config.timeouts?.actionMs ?? DEFAULT_ACTION_TIMEOUT_MS,
      config.timeouts?.navigationMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS,
      config.interaction?.typingDelayMs ?? 0,
      config.headless,
      downloadRuntime,
      ownedRuntimeCleanup,
    );

    await session.installDomActivityBridge();

    context.on("page", (page) => session.registerNewPage(page));

    if (preserveExistingPages) {
      for (const page of context.pages()) {
        session.registerNewPage(page);
      }
    }

    if (context.pages().length === 0) {
      await context.newPage();
    }

    session.startDomActivityDrain();

    await session.startActiveTabObservation();

    return session;
  }

  private async installDomActivityBridge(): Promise<void> {
    await this.context.addInitScript({
      content: DOM_ACTIVITY_INIT_SCRIPT,
    });

    await Promise.all(
      this.context.pages().flatMap((page) =>
        page.frames().map(async (frame) => {
          await frame.evaluate(DOM_ACTIVITY_INIT_SCRIPT).catch(() => undefined);
        }),
      ),
    );
  }

  private startDomActivityDrain(): void {
    if (this.domActivityDrainTimer !== undefined) {
      return;
    }

    this.domActivityDrainTimer = setInterval(() => {
      void this.drainDomActivityQueues();
    }, 500);
  }

  private async drainDomActivityQueues(): Promise<void> {
    if (this.closed || this.drainingDomActivity) {
      return;
    }

    this.drainingDomActivity = true;

    try {
      for (const page of this.context.pages()) {
        if (page.isClosed()) {
          continue;
        }

        const pageId = this.pageRegistry.pageIdFor(page);

        if (pageId === undefined || !this.pageRegistry.has(pageId)) {
          continue;
        }

        for (const frame of page.frames()) {
          let payloads: unknown[];

          try {
            payloads = await frame.evaluate(() => {
              const queue = (
                window as unknown as {
                  __roveDomActivityQueue?: unknown[];
                }
              ).__roveDomActivityQueue;

              if (!Array.isArray(queue) || queue.length === 0) {
                return [];
              }

              return queue.splice(0, 100);
            });
          } catch {
            continue;
          }

          for (const payload of payloads) {
            this.handleDomActivity(page, payload);
          }
        }
      }
    } finally {
      this.drainingDomActivity = false;
    }
  }

  private async startActiveTabObservation(): Promise<void> {
    if (this.browserCdp !== undefined) {
      return;
    }

    if (this.headless) {
      return;
    }

    this.browserCdp = await this.browser.newBrowserCDPSession();

    await this.reconcileActiveTab();

    this.activeTabTimer = setInterval(() => {
      void this.reconcileActiveTab();
    }, 250);
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
      const result = (await this.browserCdp.send("Target.getTargets", {
        filter: [
          {
            type: "tab",
            exclude: false,
          },
          {
            exclude: true,
          },
        ],
      })) as {
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

      const activeTarget = result.targetInfos.find(
        (target) =>
          target.type === "tab" && target.embedderData?.tabActive === true,
      );

      if (activeTarget === undefined) {
        return;
      }

      const pageId = this.resolveTabTargetPageId(activeTarget);

      if (pageId === undefined || this.pageRegistry.activeId() === pageId) {
        return;
      }

      const state = this.pageRegistry.activate(pageId);

      this.emitActivity({
        type: "page_switched",
        pageId,
        pageRevision: state.revision,
        timestamp: new Date().toISOString(),
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

  private resolveTabTargetPageId(target: {
    title: string;
    url: string;
    embedderData?: {
      tabStripIndex?: number;
    };
  }): string | undefined {
    const summaries = this.pageRegistry.summaries();

    const exact = summaries.filter(
      (summary) => summary.url === target.url && summary.title === target.title,
    );

    if (exact.length === 1) {
      return exact[0]?.id;
    }

    const matchingUrl = summaries.filter(
      (summary) => summary.url === target.url,
    );

    if (matchingUrl.length === 1) {
      return matchingUrl[0]?.id;
    }

    const tabStripIndex = target.embedderData?.tabStripIndex;

    if (
      typeof tabStripIndex !== "number" ||
      !Number.isInteger(tabStripIndex) ||
      tabStripIndex < 0
    ) {
      return undefined;
    }

    const page = this.context.pages()[tabStripIndex];

    if (page === undefined) {
      return undefined;
    }

    return this.pageRegistry.pageIdFor(page);
  }

  private handleDomActivity(page: Page, payload: unknown): void {
    if (this.closed) {
      return;
    }

    const pageId = this.pageRegistry.pageIdFor(page);

    if (pageId === undefined || !this.pageRegistry.has(pageId)) {
      return;
    }

    const activity = normalizeDomActivityPayload(payload);

    if (activity === null) {
      return;
    }

    if (activity.type === "interaction_click") {
      this.evidenceRecorder.markHumanNavigation(page);
    }

    // DOM activity is evidence from the page that produced it.
    // Queue delivery may be delayed, so it must not establish
    // active-tab authority or override a later explicit/tab-observed switch.
    const state = this.pageRegistry.stateFor(pageId);

    this.emitActivity({
      type: activity.type,
      pageId,
      pageRevision: state.revision,
      timestamp: new Date().toISOString(),
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

  onActivity(listener: BrowserActivityListener): () => void {
    this.activityListeners.add(listener);

    return () => {
      this.activityListeners.delete(listener);
    };
  }

  private observePage(page: Page, pageId: string): void {
    this.evidenceRecorder.observe(page, pageId);
    let previousTitle: string | undefined;

    const observeTitle = () => {
      if (page.isClosed() || !this.pageRegistry.has(pageId)) {
        return;
      }

      void page
        .title()
        .then((title) => {
          if (title === previousTitle || !this.pageRegistry.has(pageId)) {
            return;
          }

          previousTitle = title;

          const state = this.pageRegistry.stateFor(pageId);

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
    page.on("dialog", (dialog) => {
      const state = this.pageRegistry.has(pageId)
        ? this.pageRegistry.stateFor(pageId)
        : undefined;

      this.emitActivity({
        type: "dialog_opened",
        pageId,
        ...(state === undefined ? {} : { pageRevision: state.revision }),
        timestamp: new Date().toISOString(),
        data: {
          type: dialog.type(),
          defaultAction: "dismiss",
        },
      });

      void dialog.dismiss().catch(() => undefined);
    });
    page.on("download", (download) => {
      if (this.downloadRuntime === undefined) {
        return;
      }

      this.downloadSaveQueue = this.downloadSaveQueue
        .then(async () => {
          if (this.downloadRuntime === undefined) {
            return;
          }

          const saved = await saveManagedDownload(
            download,
            this.downloadRuntime.directory,
          );
          const state = this.pageRegistry.has(pageId)
            ? this.pageRegistry.stateFor(pageId)
            : undefined;

          this.emitActivity({
            type: "download_completed",
            pageId,
            ...(state === undefined ? {} : { pageRevision: state.revision }),
            timestamp: new Date().toISOString(),
            data: {
              filename: saved.filename,
              path: saved.path,
              directory: saved.directory,
              sizeBytes: saved.sizeBytes,
              suggestedFilename: download.suggestedFilename(),
              url: page.url(),
            },
          });
        })
        .catch((error: unknown) => {
          this.emitActivity({
            type: "download_failed",
            pageId,
            timestamp: new Date().toISOString(),
            data: {
              reason:
                error instanceof Error
                  ? error.message
                  : "Unknown download failure.",
              suggestedFilename: download.suggestedFilename(),
              url: page.url(),
            },
          });
        });
    });
  }

  private emitActivity(activity: BrowserActivity): void {
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
      throw new RoveError({
        code: "PAGE_NOT_FOUND",
        message: "The browser session has no active page.",
      });
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
      await this.evidenceRecorder.withAgentAction(page, () =>
        page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: this.navigationTimeoutMs,
        }),
      );
    } catch (error) {
      if (error instanceof playwrightErrors.TimeoutError) {
        throw new RoveError({
          code: "ACTION_TIMEOUT",
          message: `Navigation to ${url} timed out.`,
          retryable: true,
        });
      }
      if (isBrowserClosedError(error)) throw browserClosedError();
      throw new RoveError({
        code: "NAVIGATION_FAILED",
        message: `Navigation to ${url} failed.`,
      });
    }
    try {
      await this.pageRegistry.syncMetadata(pageId);
    } catch (error) {
      if (isBrowserClosedError(error)) throw browserClosedError();
      throw error;
    }
    const state = this.pageRegistry.stateFor(pageId);

    await this.inspector.invalidatePage(page, pageId, state.revision);

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

    const previousActivePageId = this.pageRegistry.activeId();

    const page = this.pageRegistry.pageFor(pageId);

    this.pageRegistry.activate(pageId);

    try {
      await page.bringToFront();
    } catch (error) {
      if (isBrowserClosedError(error)) {
        throw browserClosedError();
      }

      throw error;
    }

    const state = await this.pageRegistry.syncMetadata(pageId);

    if (previousActivePageId !== pageId) {
      this.emitActivity({
        type: "page_switched",
        pageId,
        pageRevision: state.revision,
        timestamp: new Date().toISOString(),
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

  async inspect(options: InspectOptions = {}): Promise<BrowserObservation> {
    this.ensureOpen();

    const pageId = options.pageId ?? this.requireActivePageId();

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

    const browserEvidence = this.evidenceRecorder.snapshot(pageId);

    const pageStateObservation = await observeStablePageState(
      page,
      browserEvidence.latestMainDocumentStatus,
    );

    state = this.pageRegistry.update(pageId, {
      mutationVersion: await readMaterialMutationVersion(page),
    });

    const inspection = await this.inspector.inspect(page, state, options);

    const finalState = this.pageRegistry.stateFor(pageId);

    const finalMutationVersion = await readMaterialMutationVersion(page);

    if (
      finalState.revision !== state.revision ||
      finalMutationVersion !== state.mutationVersion ||
      page.url() !== inspection.url
    ) {
      await this.inspector
        .invalidatePage(page, pageId, finalState.revision)
        .catch(() => undefined);

      throw new RoveError({
        code: "PAGE_CHANGED",
        message:
          "The browser changed while the observation was being collected.",
        retryable: true,
      });
    }

    const pageState = pageStateObservation.assessment;

    const accessRestriction =
      pageState.kind === "access_restricted"
        ? {
            kind: "access_restricted" as const,
            reason: "The site has restricted access and requires human review.",
            signals: pageState.signals,
          }
        : pageState.kind === "human_verification"
          ? {
              kind: "human_verification" as const,
              reason: "The site requires a human verification step.",
              signals: pageState.signals,
            }
          : undefined;

    const observation: BrowserObservation = {
      ...inspection,

      capabilities: {
        connection:
          this.capabilities.distribution === "chrome" ? "cdp" : "playwright",
        semanticHierarchy: true,
        targetGeometry: true,
        occlusion: true,
        frameProvenance: true,
        openShadowDom: true,
        screenshotModes: ["viewport", "full-page", "target", "region"],
      },

      metadata: {
        ...inspection.metadata,
        pageState,
        pageStatePropositions: pageStateObservation.propositions,
        pageStateFingerprint: pageStateObservation.fingerprint,
        ...(pageStateObservation.diagnostics === undefined
          ? {}
          : {
              pageStateDiagnostics: pageStateObservation.diagnostics,
            }),
        browserEvidence,
        ...(accessRestriction === undefined ? {} : { accessRestriction }),
      },
    };

    await this.rememberObservation(page, observation);

    return observation;
  }

  async pageStateIdentity(
    pageId = this.requireActivePageId(),
  ): Promise<PageStateIdentity> {
    this.ensureOpen();

    const page = this.pageRegistry.pageFor(pageId);

    return collectPageStateIdentity(
      page,
      pageId,
      this.evidenceRecorder.latestMainDocumentStatus(pageId),
    );
  }

  private async rememberObservation(
    page: Page,
    observation: BrowserObservation,
  ): Promise<void> {
    const viewport = observation.viewport ?? (await readBrowserViewport(page));

    this.observationAuthorities.set(observation.observationId, {
      observationId: observation.observationId,
      pageId: observation.pageId,
      revision: observation.revision,
      mutationVersion: observation.mutationVersion,
      url: observation.url,
      viewport,
    });

    while (this.observationAuthorities.size > MAX_OBSERVATION_AUTHORITIES) {
      const oldest = this.observationAuthorities.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.observationAuthorities.delete(oldest);
    }
  }

  private async assertObservationCurrent(
    observationId: string,
  ): Promise<ObservationAuthority> {
    const authority = this.observationAuthorities.get(observationId);

    if (authority === undefined) {
      throw new RoveError({
        code: "OBSERVATION_STALE",
        message: "The referenced browser observation is no longer current.",
        retryable: true,
      });
    }

    if (!this.pageRegistry.has(authority.pageId)) {
      this.observationAuthorities.delete(observationId);

      throw new RoveError({
        code: "OBSERVATION_STALE",
        message: "The observed page no longer exists.",
        retryable: true,
      });
    }

    const page = this.pageRegistry.pageFor(authority.pageId);

    await installMutationTracker(page);

    const state = this.pageRegistry.stateFor(authority.pageId);

    const mutationVersion = await readMaterialMutationVersion(page);

    const viewport = await readBrowserViewport(page);

    const viewportChanged =
      viewport.width !== authority.viewport.width ||
      viewport.height !== authority.viewport.height ||
      viewport.deviceScaleFactor !== authority.viewport.deviceScaleFactor ||
      Math.abs(viewport.scrollX - authority.viewport.scrollX) > 0.5 ||
      Math.abs(viewport.scrollY - authority.viewport.scrollY) > 0.5;

    if (
      state.revision !== authority.revision ||
      mutationVersion !== authority.mutationVersion ||
      page.url() !== authority.url ||
      viewportChanged
    ) {
      this.observationAuthorities.delete(observationId);

      throw new RoveError({
        code: "OBSERVATION_STALE",
        message: "The browser changed after the referenced observation.",
        retryable: true,
        details: {
          observationId,
          expectedRevision: authority.revision,
          currentRevision: state.revision,
          expectedMutationVersion: authority.mutationVersion,
          currentMutationVersion: mutationVersion,
          urlChanged: page.url() !== authority.url,
          viewportChanged,
        },
      });
    }

    return authority;
  }

  async invalidateTargets(): Promise<void> {
    this.ensureOpen();
    this.observationAuthorities.clear();

    const pageId = this.requireActivePageId();
    const page = this.pageRegistry.pageFor(pageId);

    const current = this.pageRegistry.stateFor(pageId);
    const next = recordMutation(current, true);

    const state = this.pageRegistry.update(pageId, next);

    await this.inspector.invalidatePage(page, pageId, state.revision);
  }

  async invalidateAllTargets(): Promise<number> {
    this.ensureOpen();
    this.observationAuthorities.clear();
    let invalidated = 0;
    for (const summary of this.pageRegistry.summaries()) {
      if (!this.pageRegistry.has(summary.id)) continue;
      const page = this.pageRegistry.pageFor(summary.id);
      const current = this.pageRegistry.stateFor(summary.id);
      const next = this.pageRegistry.update(
        summary.id,
        recordMutation(current, true),
      );
      await this.inspector.invalidatePage(page, summary.id, next.revision);
      invalidated += 1;
    }
    return invalidated;
  }

  async click(target: TargetReference): Promise<ActionResult> {
    this.ensureOpen();
    const page = this.pageRegistry.pageFor(target.pageId);
    const beforePages = this.pageRegistry.summaries();
    const resolved = await this.resolveActionTarget(target);
    const previous = this.pageRegistry.stateFor(target.pageId);
    const popup = this.context
      .waitForEvent("page", { timeout: POPUP_GRACE_MS })
      .catch(() => null);
    try {
      await this.evidenceRecorder.withAgentAction(page, () =>
        resolved.locator.click({ timeout: this.actionTimeoutMs }),
      );
      if (this.pageRegistry.summaries().length === beforePages.length)
        await popup;
    } catch (error) {
      throw actionError(error, "Click");
    }
    return this.synchronizeAfterAction(
      "click",
      target.pageId,
      previous,
      beforePages,
    );
  }

  async type(target: TargetReference, value: string): Promise<ActionResult> {
    this.ensureOpen();
    const beforePages = this.pageRegistry.summaries();
    const resolved = await this.resolveActionTarget(target);
    if (!resolved.state.editable) {
      throw new RoveError({
        code: "TARGET_NOT_INTERACTIVE",
        message: "The target does not accept text.",
      });
    }
    void isSensitiveTarget(resolved.state.identity);
    const previous = this.pageRegistry.stateFor(target.pageId);
    try {
      if (this.typingDelayMs > 0 && value.length <= 500) {
        await resolved.locator.fill("", { timeout: this.actionTimeoutMs });
        await resolved.locator.pressSequentially(value, {
          delay: this.typingDelayMs,
          timeout: this.actionTimeoutMs + value.length * this.typingDelayMs,
        });
      } else {
        await resolved.locator.fill(value, { timeout: this.actionTimeoutMs });
      }
    } catch (error) {
      throw actionError(error, "Type");
    }
    return this.synchronizeAfterAction(
      "type",
      target.pageId,
      previous,
      beforePages,
    );
  }

  async press(
    target: TargetReference | null,
    key: string,
  ): Promise<ActionResult> {
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
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Scroll amount must be positive.",
      });
    }
    const pageId = this.requireActivePageId();
    const page = this.pageRegistry.pageFor(pageId);
    const previous = this.pageRegistry.stateFor(pageId);
    const beforePages = this.pageRegistry.summaries();
    const deltas: Record<
      ScrollOptions["direction"],
      readonly [number, number]
    > = {
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

    const authority =
      options.observationId === undefined
        ? undefined
        : await this.assertObservationCurrent(options.observationId);

    const pageId =
      options.target?.pageId ?? authority?.pageId ?? this.requireActivePageId();

    if (authority !== undefined && authority.pageId !== pageId) {
      throw new RoveError({
        code: "OBSERVATION_STALE",
        message: "The screenshot target belongs to another observed page.",
        retryable: true,
      });
    }

    const page = this.pageRegistry.pageFor(pageId);

    let target: ResolvedTarget | undefined;

    if (mode === "target") {
      if (options.target === undefined) {
        throw new RoveError({
          code: "TARGET_NOT_FOUND",
          message: "Target screenshot requires a TargetReference.",
        });
      }

      target = await this.resolveActionTarget(options.target);
    }

    if (mode === "region" && options.region === undefined) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Region screenshot requires a viewport-relative region.",
      });
    }

    await this.applySensitiveMask(page);

    try {
      const targetStylesBefore =
        options.observationId === undefined
          ? undefined
          : await this.captureTargetInlineStyles(page);

      let bytes: Buffer;

      await setTransientTargetStyleMutationSuppression(page, true);

      try {
        if (mode === "target") {
          bytes = await target!.locator.screenshot({
            type: "png",
            timeout: this.actionTimeoutMs,
          });
        } else if (mode === "region") {
          const viewport = await readBrowserViewport(page);

          const region = options.region!;

          if (
            region.x + region.width > viewport.width ||
            region.y + region.height > viewport.height
          ) {
            throw new RoveError({
              code: "INVALID_CONFIGURATION",
              message:
                "Screenshot region must fit inside the current viewport.",
            });
          }

          bytes = await page.screenshot({
            type: "png",
            clip: {
              x: viewport.scrollX + region.x,
              y: viewport.scrollY + region.y,
              width: region.width,
              height: region.height,
            },
            timeout: this.actionTimeoutMs,
          });
        } else {
          bytes = await page.screenshot({
            type: "png",
            fullPage: mode === "full-page",
            timeout: this.actionTimeoutMs,
          });
        }
      } finally {
        await setTransientTargetStyleMutationSuppression(page, false).catch(
          () => undefined,
        );
      }

      if (options.observationId !== undefined) {
        const targetStylesAfter = await this.captureTargetInlineStyles(page);

        if (!sameTargetInlineStyles(targetStylesBefore!, targetStylesAfter)) {
          throw new RoveError({
            code: "OBSERVATION_STALE",
            message:
              "An observed target style changed while the screenshot was being captured.",
            retryable: true,
            details: {
              observationId: options.observationId,
              targetStylesChanged: true,
            },
          });
        }

        await this.assertObservationCurrent(options.observationId);
      }

      const state = await this.pageRegistry.syncMetadata(pageId);

      const viewport = await readBrowserViewport(page);

      const mutationVersion = await readMaterialMutationVersion(page);

      const targetBounds =
        target === undefined
          ? undefined
          : await target.locator.boundingBox().catch(() => null);

      return {
        mimeType: "image/png",
        bytes,
        metadata: {
          pageId,
          revision: state.revision,
          mutationVersion,
          url: state.url,
          mode,
          viewport,
          ...(options.observationId === undefined
            ? {}
            : {
                observationId: options.observationId,
              }),
          ...(options.region === undefined
            ? {}
            : {
                region: options.region,
              }),
          ...(targetBounds == null
            ? {}
            : {
                targetBounds: {
                  x: targetBounds.x,
                  y: targetBounds.y,
                  width: targetBounds.width,
                  height: targetBounds.height,
                },
              }),
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof RoveError) {
        throw error;
      }

      throw actionError(error, "Screenshot");
    } finally {
      await this.removeSensitiveMask(page).catch(() => undefined);
    }
  }

  private async captureTargetInlineStyles(
    page: Page,
  ): Promise<Record<string, string | null>> {
    return page.evaluate(() => {
      const result: Record<string, string | null> = {};

      for (const element of Array.from(
        document.querySelectorAll<HTMLElement>("[data-rove-target]"),
      )) {
        const marker = element.getAttribute("data-rove-target");

        if (marker === null) {
          continue;
        }

        result[marker] = element.getAttribute("style");
      }

      return result;
    });
  }

  private async resolveActionTarget(
    target: TargetReference,
  ): Promise<ResolvedTarget> {
    const page = this.pageRegistry.pageFor(target.pageId);
    await installMutationTracker(page);
    let state = this.pageRegistry.stateFor(target.pageId);
    const browserMutationVersion = await readMaterialMutationVersion(page);
    if (browserMutationVersion !== state.mutationVersion) {
      state = this.pageRegistry.update(target.pageId, {
        mutationVersion: browserMutationVersion,
      });
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
    this.observationAuthorities.clear();
    let current = await this.pageRegistry.syncMetadata(pageId);
    const mutationVersion = await readMaterialMutationVersion(page);
    if (
      current.revision === previous.revision &&
      mutationVersion !== previous.mutationVersion
    ) {
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
    const openedPages = afterPages.filter(
      (summary) => !beforeIds.has(summary.id),
    );
    const activeChanged =
      beforePages.find((summary) => summary.active)?.id !==
      afterPages.find((summary) => summary.active)?.id;
    const pageChanged =
      current.url !== previous.url ||
      current.revision !== previous.revision ||
      openedPages.length > 0 ||
      activeChanged;
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

  private async historyAction(
    action: "back" | "forward",
  ): Promise<ActionResult> {
    const pageId = this.requireActivePageId();
    const page = this.pageRegistry.pageFor(pageId);
    const previous = this.pageRegistry.stateFor(pageId);
    const beforePages = this.pageRegistry.summaries();
    try {
      const response = await this.evidenceRecorder.withAgentAction(page, () =>
        action === "back"
          ? page.goBack({
              waitUntil: "domcontentloaded",
              timeout: this.navigationTimeoutMs,
            })
          : page.goForward({
              waitUntil: "domcontentloaded",
              timeout: this.navigationTimeoutMs,
            }),
      );
      if (response === null) {
        return {
          ok: true,
          action,
          sessionId: this.id,
          pageId,
          pageChanged: false,
          previousRevision: previous.revision,
          currentRevision: previous.revision,
          url: previous.url,
        };
      }
      return this.synchronizeAfterAction(action, pageId, previous, beforePages);
    } catch (error) {
      if (error instanceof playwrightErrors.TimeoutError) {
        throw new RoveError({
          code: "ACTION_TIMEOUT",
          message: `Browser ${action} timed out.`,
          retryable: true,
        });
      }
      if (isBrowserClosedError(error)) throw browserClosedError();
      throw new RoveError({
        code: "NAVIGATION_FAILED",
        message: `Browser ${action} failed.`,
      });
    }
  }

  private async applySensitiveMask(page: Page): Promise<void> {
    await Promise.all(
      page.frames().map(async (frame) => {
        await frame
          .evaluate(() => {
            const visit = (root: Document | ShadowRoot): void => {
              if (
                root.querySelector("style[data-rove-sensitive-style]") === null
              ) {
                const style = document.createElement("style");

                style.setAttribute("data-rove-sensitive-style", "");

                style.textContent =
                  "[data-rove-sensitive-mask]{-webkit-text-security:disc!important;color:transparent!important;text-shadow:0 0 0 currentColor!important}";

                if (root instanceof Document) {
                  (root.head ?? root.documentElement).append(style);
                } else {
                  root.append(style);
                }
              }

              for (const element of Array.from(
                root.querySelectorAll<HTMLInputElement>("input"),
              )) {
                const semantic =
                  `${element.type} ${element.autocomplete} ${element.name} ${element.id} ${element.getAttribute("aria-label") ?? ""}`.toLowerCase();

                if (
                  element.type === "password" ||
                  element.autocomplete === "one-time-code" ||
                  /password|passcode|otp|one.?time|secret|token/.test(semantic)
                ) {
                  element.setAttribute("data-rove-sensitive-mask", "");
                }
              }

              for (const host of Array.from(
                root.querySelectorAll<HTMLElement>("*"),
              )) {
                if (host.shadowRoot !== null) {
                  visit(host.shadowRoot);
                }
              }
            };

            visit(document);
          })
          .catch(() => undefined);
      }),
    );
  }

  private async removeSensitiveMask(page: Page): Promise<void> {
    await Promise.all(
      page.frames().map(async (frame) => {
        await frame
          .evaluate(() => {
            const visit = (root: Document | ShadowRoot): void => {
              root
                .querySelectorAll("[data-rove-sensitive-mask]")
                .forEach((element) =>
                  element.removeAttribute("data-rove-sensitive-mask"),
                );

              for (const host of Array.from(
                root.querySelectorAll<HTMLElement>("*"),
              )) {
                if (host.shadowRoot !== null) {
                  visit(host.shadowRoot);
                }
              }
            };

            visit(document);
          })
          .catch(() => undefined);
      }),
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.activeTabTimer !== undefined) {
      clearInterval(this.activeTabTimer);
      this.activeTabTimer = undefined;
    }

    if (this.domActivityDrainTimer !== undefined) {
      clearInterval(this.domActivityDrainTimer);

      this.domActivityDrainTimer = undefined;
    }

    const browserCdp = this.browserCdp;

    this.browserCdp = undefined;
    this.activityListeners.clear();

    const ownsExternalChrome =
      this.capabilities.distribution === "chrome" &&
      this.ownedRuntimeCleanup !== undefined;

    if (ownsExternalChrome) {
      await this.downloadSaveQueue.catch(() => undefined);

      const shutdownCdp =
        browserCdp ??
        (await this.browser.newBrowserCDPSession().catch(() => undefined));

      if (shutdownCdp !== undefined) {
        await shutdownCdp.send("Browser.close").catch(() => undefined);
        await shutdownCdp.detach().catch(() => undefined);
      }

      await this.ownedRuntimeCleanup().catch(() => undefined);
    } else {
      if (browserCdp !== undefined) {
        await browserCdp.detach().catch(() => undefined);
      }

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

      await this.downloadSaveQueue.catch(() => undefined);

      if (this.ownedRuntimeCleanup !== undefined) {
        await this.ownedRuntimeCleanup().catch(() => undefined);
      }
    }

    this.observationAuthorities.clear();
    this.pageRegistry.clear();
    this.inspector.clear();

    if (this.downloadRuntime?.temporary === true) {
      await rm(this.downloadRuntime.root, {
        recursive: true,
        force: true,
      }).catch(() => undefined);
    }
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

function runtimeCapabilities(
  browser: Browser,
  config: BrowserLaunchConfig,
  runtime: BrowserRuntimeSnapshot,
  sandbox: BrowserSandboxVerification,
  downloadRuntime?: ResolvedDownloadRuntime,
): BrowserRuntimeCapabilities {
  return {
    browserFamily: "chromium",
    distribution: runtime.distribution,
    browserVersion: browser.version(),
    headless: config.headless,
    profile:
      config.profile.mode === "persistent"
        ? {
            mode: "persistent",
            name: config.profile.name,
          }
        : { mode: "temporary" },
    downloads: {
      managed: downloadRuntime !== undefined,
      evidence: downloadRuntime !== undefined,
    },
    storage: {
      cookies: true,
      localStorage: true,
      indexedDb: true,
      cacheStorage: true,
      sessionStorage: "page_scoped",
      serviceWorkers: true,
    },
    humanInteraction: {
      available: !config.headless,
    },
    sandbox: {
      requested: runtime.sandbox,
      verified: sandbox.status,
      verificationMethod: sandbox.method,
      diagnostic: sandbox.details,
    },
    diagnostics: runtime.diagnostics,
  };
}

export interface BrowserRuntimeSnapshot {
  distribution: BrowserDistribution;
  sandbox: boolean;
  diagnostics: BrowserLaunchPlanDiagnostic[];
}
