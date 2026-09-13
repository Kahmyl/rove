import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  errors as playwrightErrors,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
} from "playwright";
import {
  RoveError,
  type ActionResult,
  type Artifact,
  type BrowserLaunchConfig,
  type BrowserObservation,
  type BrowserHostIdentity,
  type BrowserWindowState,
  type BrowserRuntimeCapabilities,
  type BrowserViewport,
  type InspectOptions,
  type PageStateIdentity,
  type PageSummary,
  type ScreenshotOptions,
  type ScrollOptions,
  type TargetReference,
  type TargetResolution,
  type TargetResolutionRequest,
  type BrowserInteractionRequest,
  type DialogDirective,
  type ActionPhaseRecord,
} from "@rove/protocol";
import type { BrowserInteractionContext, BrowserSession } from "./engine.js";
import {
  InteractionDispatchError,
  InteractionNotDispatchedError,
} from "./interaction/interaction-dispatch-error.js";
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
import { groundTarget } from "./grounding/grounding.js";
import {
  BROWSER_CAPABILITY_ATLAS_VERSION,
  BROWSER_HUMAN_BOUNDARIES,
  BROWSER_INTERACTION_KINDS,
} from "./capabilities/browser-capability-registry.js";

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
const BROWSER_SHUTDOWN_STEP_TIMEOUT_MS = 3_000;

const MAX_OBSERVATION_AUTHORITIES = 100;
const CHROMIUM_PDF_VIEWER_URL =
  "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html";

interface ObservationAuthority {
  observationId: string;
  pageId: string;
  revision: number;
  mutationVersion: number;
  url: string;
  viewport: BrowserViewport;
}

export async function settleBrowserShutdownStep<T>(
  operation: () => Promise<T>,
  timeoutMs = BROWSER_SHUTDOWN_STEP_TIMEOUT_MS,
): Promise<T | undefined> {
  let cancelTimeout: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(operation)
        .catch(() => undefined),
      new Promise<undefined>((resolve) => {
        const timer = globalThis.setTimeout(resolve, timeoutMs);
        cancelTimeout = () => globalThis.clearTimeout(timer);
      }),
    ]);
  } finally {
    cancelTimeout?.();
  }
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

async function scrollDomSurface(
  page: Page,
  deltaX: number,
  deltaY: number,
): Promise<boolean> {
  for (const frame of page.frames()) {
    const moved = await frame
      .evaluate(
        async (delta) => {
          const candidates: Element[] = [];

          const visit = (root: Document | ShadowRoot) => {
            for (const element of Array.from(root.querySelectorAll("*"))) {
              candidates.push(element);
              if (element.shadowRoot !== null) visit(element.shadowRoot);
            }
          };

          visit(document);

          if (document.scrollingElement !== null) {
            candidates.push(document.scrollingElement);
          }

          const scored = candidates.flatMap((element) => {
            if (!(element instanceof HTMLElement)) return [];

            const maxX = element.scrollWidth - element.clientWidth;
            const maxY = element.scrollHeight - element.clientHeight;
            const canMoveX =
              delta.x > 0
                ? element.scrollLeft < maxX
                : delta.x < 0
                  ? element.scrollLeft > 0
                  : false;
            const canMoveY =
              delta.y > 0
                ? element.scrollTop < maxY
                : delta.y < 0
                  ? element.scrollTop > 0
                  : false;

            if (!canMoveX && !canMoveY) return [];

            const isDocumentScroller = element === document.scrollingElement;

            const rect = element.getBoundingClientRect();
            const width = isDocumentScroller
              ? innerWidth
              : Math.max(
                  0,
                  Math.min(rect.right, innerWidth) - Math.max(rect.left, 0),
                );
            const height = isDocumentScroller
              ? innerHeight
              : Math.max(
                  0,
                  Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0),
                );

            if (width === 0 || height === 0) return [];

            const visibleArea = width * height;

            // Page-scoped scroll must not silently consume the gesture in a
            // peripheral rail (for example a PDF thumbnail strip). Smaller
            // surfaces remain available through targeted precise_scroll.
            if (visibleArea < innerWidth * innerHeight * 0.5) return [];

            return [{ element, score: visibleArea }];
          });

          scored.sort((left, right) => right.score - left.score);

          const selected = scored[0]?.element;
          if (selected === undefined) return false;

          const before = {
            left: selected.scrollLeft,
            top: selected.scrollTop,
          };

          selected.scrollBy({
            left: delta.x,
            top: delta.y,
            behavior: "instant",
          });

          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );

          return (
            selected.scrollLeft !== before.left ||
            selected.scrollTop !== before.top
          );
        },
        { x: deltaX, y: deltaY },
      )
      .catch(() => false);

    if (moved) return true;
  }

  return false;
}

export class PlaywrightBrowserSession implements BrowserSession {
  private closed = false;
  private closeCompleted = false;
  private closePromise: Promise<void> | undefined;
  private readonly inspectionGenerations = new Map<string, number>();
  private readonly pageRegistry = new PlaywrightPageRegistry();
  private readonly inspector = new PageInspector();
  private readonly observationSnapshots = new Map<string, BrowserObservation>();

  private readonly observationAuthorities = new Map<
    string,
    ObservationAuthority
  >();
  private readonly activityListeners = new Set<BrowserActivityListener>();
  private readonly pendingDialogDirectives = new Map<string, DialogDirective>();
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
  private readonly downloadCorrelationWindows = new Map<
    string,
    {
      id: string;
      expectedUrl?: string;
      strategy:
        "trusted_anchor" | "chromium_pdf_viewer" | "trusted_action_download";
      dispatched: boolean;
      eventCount: number;
    }
  >();

  private constructor(
    readonly id: string,
    readonly capabilities: BrowserRuntimeCapabilities,
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly actionTimeoutMs: number,
    private readonly navigationTimeoutMs: number,
    private readonly headless: boolean,
    private readonly downloadRuntime?: ResolvedDownloadRuntime,
    private readonly ownedRuntimeCleanup?: () => Promise<void>,
    private readonly hostIdentityProvider?: () => BrowserHostIdentity | null,
  ) {
    this.pageRegistry.setOnPageClosed((pageId, wasActive) => {
      this.inspectionGenerations.delete(pageId);
      this.inspector.forgetPage(pageId);
      this.evidenceRecorder.forget(pageId);

      this.emitActivity({
        type: "page_closed",
        pageId,
        timestamp: new Date().toISOString(),
        data: { wasActive },
      });

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
    hostIdentityProvider?: () => BrowserHostIdentity | null,
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
      hostIdentityProvider,
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
    hostIdentityProvider?: () => BrowserHostIdentity | null,
  ): Promise<PlaywrightBrowserSession> {
    const session = new PlaywrightBrowserSession(
      sessionId,
      runtimeCapabilities(browser, config, runtime, sandbox, downloadRuntime),
      browser,
      context,
      config.timeouts?.actionMs ?? DEFAULT_ACTION_TIMEOUT_MS,
      config.timeouts?.navigationMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS,
      config.headless,
      downloadRuntime,
      ownedRuntimeCleanup,
      hostIdentityProvider,
    );

    await session.installDomActivityBridge();

    context.on("page", (page) => {
      void session.registerNewPage(page);
    });

    if (preserveExistingPages) {
      for (const page of context.pages()) {
        await session.registerNewPage(page);
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
          source: "physical_focus",
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

  private async registerNewPage(page: Page): Promise<string> {
    const existing = this.pageRegistry.pageIdFor(page);
    if (existing !== undefined) return existing;

    const state = this.pageRegistry.registerPage(page);
    this.pageRegistry.activate(state.id);
    this.observePage(page, state.id);
    const opener = await page.opener().catch(() => null);
    const openerPageId =
      opener === null ? undefined : this.pageRegistry.pageIdFor(opener);

    this.emitActivity({
      type: "page_opened",
      pageId: state.id,
      pageRevision: state.revision,
      timestamp: new Date().toISOString(),
      data: {
        url: state.url,
        ...(openerPageId === undefined ? {} : { openerPageId }),
      },
    });
    return state.id;
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

      const directive =
        dialog.type() === "beforeunload"
          ? undefined
          : this.pendingDialogDirectives.get(pageId);

      this.pendingDialogDirectives.delete(pageId);

      const action =
        directive === undefined || directive.action === "dismiss"
          ? "dismiss"
          : "accept";

      this.emitActivity({
        type: "dialog_opened",
        pageId,
        ...(state === undefined ? {} : { pageRevision: state.revision }),
        timestamp: new Date().toISOString(),
        data: {
          type: dialog.type(),
          defaultAction: action,
        },
      });

      if (action === "dismiss") {
        void dialog.dismiss().catch(() => undefined);
        return;
      }

      if (directive?.action === "accept_prompt" && dialog.type() === "prompt") {
        void dialog.accept(directive.value).catch(() => undefined);
        return;
      }

      void dialog.accept().catch(() => undefined);
    });
    page.on("download", (download) => {
      if (this.downloadRuntime === undefined) {
        return;
      }

      const pendingCandidate = this.downloadCorrelationWindows.get(pageId);
      const candidate =
        pendingCandidate?.strategy !== "trusted_action_download" ||
        pendingCandidate.dispatched
          ? pendingCandidate
          : undefined;
      if (
        candidate !== undefined &&
        candidate.strategy !== "trusted_action_download"
      ) {
        this.downloadCorrelationWindows.delete(pageId);
      }
      if (candidate?.strategy === "trusted_action_download") {
        candidate.eventCount += 1;
      }
      const downloadUrl = download.url();
      const correlation =
        candidate === undefined
          ? Promise.resolve(undefined)
          : candidate.strategy === "trusted_action_download"
            ? new Promise<"matched" | "ambiguous">((resolve) => {
                setTimeout(() => {
                  if (
                    this.downloadCorrelationWindows.get(pageId)?.id ===
                    candidate.id
                  ) {
                    this.downloadCorrelationWindows.delete(pageId);
                  }
                  resolve(candidate.eventCount === 1 ? "matched" : "ambiguous");
                }, 50);
              })
            : candidate.strategy === "chromium_pdf_viewer"
              ? Promise.resolve(
                  downloadUrl === candidate.expectedUrl
                    ? ("matched" as const)
                    : ("ambiguous" as const),
                )
              : page
                  .evaluate(
                    ({ boundaryId, expectedUrl, actualUrl }) => {
                      const state = (
                        window as unknown as {
                          __roveDownloadCorrelation?: {
                            id: string;
                            activations: Array<{
                              url: string;
                              trusted: boolean;
                            }>;
                          };
                        }
                      ).__roveDownloadCorrelation;
                      if (
                        actualUrl !== expectedUrl ||
                        state === undefined ||
                        state.id !== boundaryId
                      ) {
                        return "ambiguous" as const;
                      }
                      const matching = state.activations.filter(
                        (activation) => activation.url === actualUrl,
                      );
                      return matching.length === 1 &&
                        matching[0]?.trusted === true
                        ? ("matched" as const)
                        : ("ambiguous" as const);
                    },
                    {
                      boundaryId: candidate.id,
                      expectedUrl: candidate.expectedUrl,
                      actualUrl: downloadUrl,
                    },
                  )
                  .catch(() => "ambiguous" as const);

      this.downloadSaveQueue = this.downloadSaveQueue
        .then(async () => {
          if (this.downloadRuntime === undefined) {
            return;
          }

          const resolvedCorrelation = await correlation;

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
              downloadUrl,
              url: page.url(),
              ...(candidate === undefined
                ? {}
                : {
                    actionBoundaryId: candidate.id,
                    correlation: resolvedCorrelation,
                    correlationStrategy: candidate.strategy,
                  }),
            },
          });
        })
        .catch(async (error: unknown) => {
          const resolvedCorrelation = await correlation;
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
              downloadUrl,
              url: page.url(),
              ...(candidate === undefined
                ? {}
                : {
                    actionBoundaryId: candidate.id,
                    correlation: resolvedCorrelation,
                    correlationStrategy: candidate.strategy,
                  }),
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

  async navigate(url: string, requestedPageId?: string): Promise<ActionResult> {
    this.ensureOpen();
    const pageId = requestedPageId ?? this.requireActivePageId();
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

  async openPage(url: string): Promise<PageSummary> {
    this.ensureOpen();

    let page: Page;
    try {
      page = await this.context.newPage();
    } catch (error) {
      if (isBrowserClosedError(error)) throw browserClosedError();
      throw new RoveError({
        code: "NAVIGATION_FAILED",
        message: `Opening a new browser page for ${url} failed.`,
      });
    }

    const pageId = await this.registerNewPage(page);

    try {
      await this.evidenceRecorder.withAgentAction(page, () =>
        page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: this.navigationTimeoutMs,
        }),
      );
      await this.pageRegistry.syncMetadata(pageId);
    } catch (error) {
      if (isBrowserClosedError(error)) throw browserClosedError();
      if (error instanceof playwrightErrors.TimeoutError) {
        throw new RoveError({
          code: "ACTION_TIMEOUT",
          message: `Opening a new browser page at ${url} timed out.`,
          retryable: true,
          details: { pageId, url: page.url() },
        });
      }
      throw new RoveError({
        code: "NAVIGATION_FAILED",
        message: `Opening a new browser page at ${url} failed.`,
        details: { pageId, url: page.url() },
      });
    }

    await page.bringToFront();
    const state = this.pageRegistry.activate(pageId);
    await this.inspector.invalidatePage(page, pageId, state.revision);

    return this.pageRegistry
      .summaries()
      .find((summary) => summary.id === pageId)!;
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
          source: "explicit_switch",
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

  async inspect(
    options: InspectOptions = {},
    signal?: AbortSignal,
  ): Promise<BrowserObservation> {
    this.ensureOpen();

    const pageId = options.pageId ?? this.requireActivePageId();
    const inspectionGeneration =
      (this.inspectionGenerations.get(pageId) ?? 0) + 1;
    this.inspectionGenerations.set(pageId, inspectionGeneration);
    const assertCurrent = () => {
      signal?.throwIfAborted();
      if (inspectionGeneration !== this.inspectionGenerations.get(pageId)) {
        throw new RoveError({
          code: "PAGE_CHANGED",
          message: "A newer browser inspection superseded this request.",
          retryable: true,
        });
      }
    };
    assertCurrent();

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
    assertCurrent();

    await installMutationTracker(page);
    assertCurrent();

    state = this.pageRegistry.update(pageId, {
      mutationVersion: await readMaterialMutationVersion(page),
    });
    assertCurrent();

    const browserEvidence = this.evidenceRecorder.snapshot(pageId);

    const pageStateObservation = await observeStablePageState(
      page,
      browserEvidence.latestMainDocumentStatus,
    );
    assertCurrent();

    state = this.pageRegistry.update(pageId, {
      mutationVersion: await readMaterialMutationVersion(page),
    });
    assertCurrent();

    const inspection = await this.inspector.inspect(
      page,
      state,
      options,
      assertCurrent,
    );
    assertCurrent();

    const finalState = this.pageRegistry.stateFor(pageId);

    const finalMutationVersion = await readMaterialMutationVersion(page);
    assertCurrent();

    const targetCoverage = inspection.metadata?.targetCoverage as
      | {
          semanticInteractiveCount?: number;
          registeredTargetCount?: number;
          acquisitionErrors?: unknown[];
          semanticOutcomes?: Record<string, number>;
        }
      | undefined;
    const accountedTargets =
      (targetCoverage?.registeredTargetCount ?? 0) +
      Object.entries(targetCoverage?.semanticOutcomes ?? {})
        .filter(([reason]) => reason !== "targeted")
        .reduce((sum, [, count]) => sum + count, 0);
    const targetAcquisitionUnstable =
      (targetCoverage?.acquisitionErrors?.length ?? 0) > 0 ||
      (targetCoverage?.semanticInteractiveCount ?? 0) > accountedTargets;

    if (
      finalState.revision !== state.revision ||
      page.url() !== inspection.url ||
      (finalMutationVersion !== state.mutationVersion &&
        targetAcquisitionUnstable)
    ) {
      this.inspector.forgetObservation(inspection.observationId);
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

    if (finalMutationVersion !== state.mutationVersion) {
      state = this.pageRegistry.update(pageId, {
        mutationVersion: finalMutationVersion,
      });
      inspection.mutationVersion = finalMutationVersion;
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
      sessionId: this.id,
      ...(inspection.targets === undefined
        ? {}
        : {
            targets: inspection.targets.map((target) => ({
              ...target,
              sessionId: this.id,
            })),
          }),

      capabilities: {
        connection:
          this.capabilities.distribution === "chrome" ? "cdp" : "playwright",
        semanticHierarchy: true,
        targetGeometry: true,
        occlusion: true,
        frameProvenance: true,
        openShadowDom: true,
        screenshotModes: ["viewport", "full-page", "target", "region"],
        capabilityAtlasVersion: BROWSER_CAPABILITY_ATLAS_VERSION,
        interactionKinds: [...BROWSER_INTERACTION_KINDS],
        semanticStates: [
          "checked",
          "selectedValues",
          "value",
          "focused",
          "expanded",
          "pressed",
          "selected",
          "current",
          "busy",
          "invalid",
          "required",
          "readOnly",
          "open",
          "valueNow",
          "valueMin",
          "valueMax",
          "valueText",
          "orientation",
          "hasPopup",
          "controls",
          "activeDescendant",
        ],
        humanBoundaries: [...BROWSER_HUMAN_BOUNDARIES],
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
    assertCurrent();

    await this.rememberObservation(page, observation);
    try {
      assertCurrent();
    } catch (error) {
      this.observationAuthorities.delete(observation.observationId);
      this.observationSnapshots.delete(observation.observationId);
      this.inspector.forgetObservation(observation.observationId);
      throw error;
    }

    return observation;
  }

  async resolveTarget(
    request: TargetResolutionRequest,
  ): Promise<TargetResolution> {
    const observation = await this.readObservation(request.observationId, {
      allowMutationDrift: true,
    });

    const canonicalTargets = this.inspector.targetsForObservation(
      observation.observationId,
    );

    const authoritativeObservation =
      canonicalTargets === undefined
        ? observation
        : {
            ...observation,
            targets: canonicalTargets.map((target) => ({
              ...target,
              sessionId: this.id,
            })),
          };

    return groundTarget(authoritativeObservation, request.intent);
  }

  async readObservation(
    observationId: string,
    options: { allowMutationDrift?: boolean } = {},
  ): Promise<BrowserObservation> {
    this.ensureOpen();

    await this.assertObservationCurrent(observationId, options);

    const observation = this.observationSnapshots.get(observationId);

    if (observation === undefined) {
      throw new RoveError({
        code: "OBSERVATION_STALE",
        message: "The referenced browser observation is no longer available.",
        retryable: true,
      });
    }

    const canonicalTargets = this.inspector.targetsForObservation(
      observation.observationId,
    );

    return canonicalTargets === undefined
      ? observation
      : {
          ...observation,
          targets: canonicalTargets.map((target) => ({
            ...target,
            sessionId: this.id,
          })),
        };
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

    this.observationSnapshots.set(observation.observationId, observation);

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
      this.observationSnapshots.delete(oldest);
      this.inspector.forgetObservation(oldest);
    }
  }

  private async assertObservationCurrent(
    observationId: string,
    options: { allowMutationDrift?: boolean } = {},
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
      this.observationSnapshots.delete(observationId);
      this.inspector.forgetObservation(observationId);

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
      (!options.allowMutationDrift &&
        mutationVersion !== authority.mutationVersion) ||
      page.url() !== authority.url ||
      viewportChanged
    ) {
      this.observationAuthorities.delete(observationId);
      this.observationSnapshots.delete(observationId);
      this.inspector.forgetObservation(observationId);

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
    const pageId = this.requireActivePageId();
    this.invalidateInspectionPages(new Set([pageId]));
    this.invalidateObservationPages(new Set([pageId]));
    const page = this.pageRegistry.pageFor(pageId);

    const current = this.pageRegistry.stateFor(pageId);
    const next = recordMutation(current, true);

    const state = this.pageRegistry.update(pageId, next);

    await this.inspector.invalidatePage(page, pageId, state.revision);
  }

  async invalidateAllTargets(): Promise<number> {
    this.ensureOpen();
    const pageIds = new Set(
      this.pageRegistry.summaries().map((summary) => summary.id),
    );
    this.invalidateInspectionPages(pageIds);
    this.observationAuthorities.clear();
    this.observationSnapshots.clear();
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

  async invalidatePages(pageIds: readonly string[]): Promise<number> {
    this.ensureOpen();
    const selected = new Set(pageIds);
    this.invalidateInspectionPages(selected);
    this.invalidateObservationPages(selected);
    let invalidated = 0;
    for (const pageId of selected) {
      if (!this.pageRegistry.has(pageId)) continue;
      const page = this.pageRegistry.pageFor(pageId);
      const current = this.pageRegistry.stateFor(pageId);
      const next = this.pageRegistry.update(
        pageId,
        recordMutation(current, true),
      );
      await this.inspector.invalidatePage(page, pageId, next.revision);
      invalidated += 1;
    }
    return invalidated;
  }

  async interact(
    request: BrowserInteractionRequest,
    context: BrowserInteractionContext,
  ): Promise<ActionResult> {
    try {
      return await this.interactWithDispatchEvidence(request, context);
    } catch (error) {
      if (
        error instanceof InteractionDispatchError ||
        error instanceof InteractionNotDispatchedError
      ) {
        throw error;
      }

      // Every dispatching implementation below converts failures after its
      // activation boundary to InteractionDispatchError. Reaching this wrapper
      // with another error is Browser-owned proof that activation was not
      // entered.
      throw new InteractionNotDispatchedError(error);
    }
  }

  private async interactWithDispatchEvidence(
    request: BrowserInteractionRequest,
    context: BrowserInteractionContext,
  ): Promise<ActionResult> {
    this.ensureOpen();

    const targetScoped =
      request.kind !== "coordinate_click" &&
      "target" in request &&
      request.target !== undefined;
    const authority = await this.assertObservationCurrent(
      context.observationId,
      { allowMutationDrift: targetScoped },
    );

    try {
      if (
        request.kind === "coordinate_click" &&
        request.observationId !== context.observationId
      ) {
        throw new RoveError({
          code: "OBSERVATION_STALE",
          message:
            "Coordinate interaction must use the same current observation authority.",
          retryable: true,
        });
      }

      switch (request.kind) {
        case "click":
          return this.runTargetInteraction(
            "click",
            request.target,
            request.dialog,
            "Click",
            async (resolved) => {
              await resolved.locator.click({
                timeout: this.actionTimeoutMs,
              });
            },
            context.activityBoundaryId,
          );

        case "double_click":
          return this.runTargetInteraction(
            "double_click",
            request.target,
            request.dialog,
            "Double click",
            async (resolved) => {
              await resolved.locator.dblclick({
                timeout: this.actionTimeoutMs,
              });
            },
          );

        case "secondary_click":
          return this.runTargetInteraction(
            "secondary_click",
            request.target,
            request.dialog,
            "Secondary click",
            async (resolved) => {
              await resolved.locator.click({
                button: "right",
                timeout: this.actionTimeoutMs,
              });
            },
          );

        case "modified_click":
          return this.runTargetInteraction(
            "modified_click",
            request.target,
            request.dialog,
            "Modified click",
            async (resolved) => {
              await resolved.locator.click({
                modifiers: request.modifiers,
                timeout: this.actionTimeoutMs,
              });
            },
          );

        case "hover":
          return this.runTargetInteraction(
            "hover",
            request.target,
            request.dialog,
            "Hover",
            async (resolved) => {
              await resolved.locator.hover({
                timeout: this.actionTimeoutMs,
              });
            },
          );

        case "focus":
          return this.runTargetInteraction(
            "focus",
            request.target,
            request.dialog,
            "Focus",
            async (resolved) => {
              await resolved.locator.focus({ timeout: this.actionTimeoutMs });
            },
          );

        case "blur":
          return this.runTargetInteraction(
            "blur",
            request.target,
            request.dialog,
            "Blur",
            async (resolved) => {
              await resolved.locator.blur({ timeout: this.actionTimeoutMs });
            },
          );

        case "press":
          if (request.target !== undefined) {
            return this.runTargetInteraction(
              "press",
              request.target,
              request.dialog,
              "Press",
              async (resolved) => {
                await resolved.locator.press(request.key, {
                  timeout: this.actionTimeoutMs,
                });
              },
            );
          }
          return this.runPageKeyInteraction(
            "press",
            request.key,
            authority.pageId,
            request.dialog,
          );

        case "clear":
          return this.runTargetInteraction(
            "clear",
            request.target,
            request.dialog,
            "Clear",
            async (resolved) => {
              if (!resolved.state.editable) {
                throw new RoveError({
                  code: "TARGET_NOT_INTERACTIVE",
                  message: "The target does not accept text.",
                });
              }

              await this.replaceEditableValue(resolved.locator, "");
            },
          );

        case "fill":
          return this.runTargetInteraction(
            "fill",
            request.target,
            request.dialog,
            "Fill",
            async (resolved) => {
              if (!resolved.state.editable) {
                throw new RoveError({
                  code: "TARGET_NOT_INTERACTIVE",
                  message: "The target does not accept text.",
                });
              }

              void isSensitiveTarget(resolved.state.identity);

              await this.replaceEditableValue(resolved.locator, request.value);
            },
          );

        case "type_sequential":
          return this.runTargetInteraction(
            "type_sequential",
            request.target,
            request.dialog,
            "Sequential type",
            async (resolved) => {
              if (!resolved.state.editable) {
                throw new RoveError({
                  code: "TARGET_NOT_INTERACTIVE",
                  message: "The target does not accept text.",
                });
              }
              await resolved.locator.fill("", {
                timeout: this.actionTimeoutMs,
              });
              await resolved.locator.pressSequentially(request.value, {
                delay: request.delayMs,
                timeout: this.actionTimeoutMs,
              });
              await this.assertEditableValue(resolved.locator, request.value);
            },
          );

        case "select_text":
          return this.runTargetInteraction(
            "select_text",
            request.target,
            request.dialog,
            "Select text",
            async (resolved) => {
              if (!resolved.state.editable) {
                throw new RoveError({
                  code: "TARGET_NOT_INTERACTIVE",
                  message:
                    "The target does not contain selectable editable text.",
                });
              }
              await resolved.locator.selectText({
                timeout: this.actionTimeoutMs,
              });
            },
          );

        case "select":
          return this.runTargetInteraction(
            "select",
            request.target,
            request.dialog,
            "Select",
            async (resolved) => {
              if (resolved.state.identity.tag !== "select") {
                throw new RoveError({
                  code: "TARGET_NOT_INTERACTIVE",
                  message: "The target is not a native selectable control.",
                });
              }

              await resolved.locator.selectOption(request.values, {
                timeout: this.actionTimeoutMs,
              });
            },
          );

        case "check":
          return this.runTargetInteraction(
            "check",
            request.target,
            request.dialog,
            "Check",
            async (resolved) => {
              await this.applyCheckedState(resolved, true);
            },
          );

        case "uncheck":
          return this.runTargetInteraction(
            "uncheck",
            request.target,
            request.dialog,
            "Uncheck",
            async (resolved) => {
              await this.applyCheckedState(resolved, false);
            },
          );

        case "drag": {
          if (request.destination.pageId !== request.target.pageId) {
            throw new RoveError({
              code: "INVALID_CONFIGURATION",
              message:
                "Drag source and destination must belong to the same page.",
            });
          }

          const destination = await this.resolveActionTarget(
            request.destination,
          );

          return this.runTargetInteraction(
            "drag",
            request.target,
            request.dialog,
            "Drag",
            async (resolved, phases) => {
              await this.runTrustedStagedDrag(
                this.pageRegistry.pageFor(request.target.pageId),
                resolved.locator,
                destination.locator,
                phases,
              );
            },
          );
        }

        case "upload": {
          const uploads =
            context.uploads ??
            (context.upload === undefined ? undefined : [context.upload]);

          if (uploads === undefined || uploads.length === 0) {
            throw new RoveError({
              code: "INVALID_CONFIGURATION",
              message:
                "Upload interaction requires an internally materialized Rove file artifact.",
            });
          }

          return this.runTargetInteraction(
            "upload",
            request.target,
            request.dialog,
            "Upload",
            async (resolved) => {
              const files = uploads.map((upload) => ({
                name: upload.filename,
                mimeType: "application/octet-stream",
                buffer: Buffer.from(upload.bytes),
              }));

              if (
                resolved.state.identity.tag === "input" &&
                resolved.state.identity.type === "file"
              ) {
                await resolved.locator.setInputFiles(files, {
                  timeout: this.actionTimeoutMs,
                });

                return;
              }

              const page = this.pageRegistry.pageFor(request.target.pageId);

              const [chooser] = await Promise.all([
                page.waitForEvent("filechooser", {
                  timeout: this.actionTimeoutMs,
                }),
                resolved.locator.click({ timeout: this.actionTimeoutMs }),
              ]);

              await chooser.setFiles(files, { timeout: this.actionTimeoutMs });
            },
          );
        }

        case "clipboard": {
          const modifier = process.platform === "darwin" ? "Meta" : "Control";
          const key = `${modifier}+${request.operation === "copy" ? "C" : request.operation === "cut" ? "X" : "V"}`;
          if (request.target === undefined) {
            return this.runPageKeyInteraction(
              "clipboard",
              key,
              authority.pageId,
              request.dialog,
            );
          }
          return this.runTargetInteraction(
            "clipboard",
            request.target,
            request.dialog,
            `Clipboard ${request.operation}`,
            async (resolved) => {
              await resolved.locator.focus({ timeout: this.actionTimeoutMs });
              await resolved.locator.press(key, {
                timeout: this.actionTimeoutMs,
              });
            },
          );
        }

        case "precise_scroll":
          return this.runPreciseScroll(request, authority.pageId);

        case "coordinate_click":
          return this.runCoordinateClick(request);
      }
    } finally {
      // Dispatch-local download boundaries are armed by runTargetInteraction.
    }

    throw new RoveError({
      code: "INVALID_CONFIGURATION",
      message: "Unsupported browser interaction kind.",
    });
  }

  private async runTargetInteraction(
    action: ActionResult["action"],
    target: TargetReference,
    dialog: DialogDirective | undefined,
    actionName: string,
    operation: (
      resolved: ResolvedTarget,
      phases: ActionPhaseRecord[],
    ) => Promise<void>,
    activityBoundaryId?: string,
  ): Promise<ActionResult> {
    const page = this.pageRegistry.pageFor(target.pageId);

    const beforePages = this.pageRegistry.summaries();
    const previous = this.pageRegistry.stateFor(target.pageId);

    const resolved = await this.resolveActionTarget(target);
    if (
      (action === "focus" || action === "press" || action === "clipboard") &&
      !resolved.state.focusable
    ) {
      throw new RoveError({
        code: "TARGET_NOT_INTERACTIVE",
        message: "The target cannot receive keyboard focus.",
        details: {
          action,
          reason: "target_not_focusable",
        },
      });
    }
    const phases: ActionPhaseRecord[] = [
      {
        phase: "preflight",
        status: "completed",
        strategy: "revision_scoped_target",
      },
    ];

    const popup = this.context
      .waitForEvent("page", {
        timeout: POPUP_GRACE_MS,
      })
      .catch(() => null);

    let dispatched = false;
    let operationCompleted = false;

    if (activityBoundaryId !== undefined) {
      const href = await resolved.locator.getAttribute("href");
      const targetFrameUrl = await resolved.locator.evaluate(
        () => location.href,
      );
      const isChromiumPdfViewerDownload =
        href === null &&
        resolved.state.identity.name === "Download" &&
        targetFrameUrl === CHROMIUM_PDF_VIEWER_URL &&
        (await page.evaluate(() => document.contentType)) === "application/pdf";
      if (href !== null || isChromiumPdfViewerDownload) {
        const expectedUrl =
          href === null ? page.url() : new URL(href, page.url()).href;
        const strategy =
          href === null ? "chromium_pdf_viewer" : "trusted_anchor";
        if (strategy === "trusted_anchor") {
          await page.evaluate(
            ({ boundaryId }) => {
              const scopedWindow = window as unknown as {
                __roveDownloadCorrelation?: {
                  id: string;
                  activations: Array<{ url: string; trusted: boolean }>;
                };
                __roveDownloadCorrelationInstalled?: boolean;
              };
              scopedWindow.__roveDownloadCorrelation = {
                id: boundaryId,
                activations: [],
              };
              if (scopedWindow.__roveDownloadCorrelationInstalled === true) {
                return;
              }
              scopedWindow.__roveDownloadCorrelationInstalled = true;
              document.addEventListener(
                "click",
                (event) => {
                  const path = event.composedPath();
                  const anchor = path.find(
                    (item): item is HTMLAnchorElement =>
                      item instanceof HTMLAnchorElement && item.href !== "",
                  );
                  const current = scopedWindow.__roveDownloadCorrelation;
                  if (anchor !== undefined && current !== undefined) {
                    current.activations.push({
                      url: anchor.href,
                      trusted: event.isTrusted,
                    });
                  }
                },
                true,
              );
            },
            { boundaryId: activityBoundaryId },
          );
        }
        this.downloadCorrelationWindows.set(target.pageId, {
          id: activityBoundaryId,
          expectedUrl,
          strategy,
          dispatched: false,
          eventCount: 0,
        });
        setTimeout(() => {
          if (
            this.downloadCorrelationWindows.get(target.pageId)?.id ===
            activityBoundaryId
          ) {
            this.downloadCorrelationWindows.delete(target.pageId);
          }
        }, this.actionTimeoutMs);
      } else {
        this.downloadCorrelationWindows.set(target.pageId, {
          id: activityBoundaryId,
          strategy: "trusted_action_download",
          dispatched: false,
          eventCount: 0,
        });
        setTimeout(() => {
          if (
            this.downloadCorrelationWindows.get(target.pageId)?.id ===
            activityBoundaryId
          ) {
            this.downloadCorrelationWindows.delete(target.pageId);
          }
        }, this.actionTimeoutMs);
      }
    }

    try {
      await this.withDialogDirective(target.pageId, dialog, async () => {
        dispatched = true;
        const downloadBoundary = this.downloadCorrelationWindows.get(
          target.pageId,
        );
        if (
          downloadBoundary !== undefined &&
          downloadBoundary.id === activityBoundaryId
        ) {
          downloadBoundary.dispatched = true;
        }

        await this.evidenceRecorder.withAgentAction(page, () =>
          operation(resolved, phases),
        );
        operationCompleted = true;
        phases.push({
          phase: "commit",
          status: "completed",
          strategy: "trusted_browser_input",
        });
      });

      if (this.pageRegistry.summaries().length === beforePages.length) {
        await popup;
      }

      return await this.synchronizeAfterAction(
        action,
        target.pageId,
        previous,
        beforePages,
        phases,
      );
    } catch (error) {
      if (
        activityBoundaryId !== undefined &&
        this.downloadCorrelationWindows.get(target.pageId)?.id ===
          activityBoundaryId
      ) {
        this.downloadCorrelationWindows.delete(target.pageId);
      }
      if (!dispatched) {
        throw error;
      }

      const mapped =
        error instanceof RoveError
          ? error
          : operationCompleted
            ? new RoveError({
                code: "RUNTIME_PROTOCOL_ERROR",
                message: "Post-action browser synchronization failed.",
              })
            : actionError(error, actionName);

      const result = await this.synchronizeAfterAction(
        action,
        target.pageId,
        previous,
        beforePages,
        operationCompleted
          ? phases
          : [
              ...phases,
              {
                phase: "commit",
                status: "uncertain",
                strategy: "trusted_browser_input",
              },
            ],
      ).catch(() => undefined);

      throw new InteractionDispatchError(
        mapped,
        result,
        operationCompleted ? "post_action_synchronization" : "dispatch",
      );
    }
  }

  private async runPreciseScroll(
    request: Extract<BrowserInteractionRequest, { kind: "precise_scroll" }>,
    observedPageId?: string,
  ): Promise<ActionResult> {
    const pageId =
      request.target?.pageId ?? observedPageId ?? this.requireActivePageId();

    const page = this.pageRegistry.pageFor(pageId);

    const beforePages = this.pageRegistry.summaries();

    const previous = this.pageRegistry.stateFor(pageId);

    let dispatched = false;
    let operationCompleted = false;

    try {
      if (request.target === undefined) {
        dispatched = true;

        await page.mouse.wheel(request.deltaX, request.deltaY);
        operationCompleted = true;
      } else {
        const resolved = await this.resolveActionTarget(request.target);

        dispatched = true;

        await resolved.locator.evaluate(
          (element, delta) => {
            element.scrollBy({
              left: delta.x,
              top: delta.y,
              behavior: "instant",
            });
          },
          {
            x: request.deltaX,
            y: request.deltaY,
          },
        );
        operationCompleted = true;
      }

      return await this.synchronizeAfterAction(
        "precise_scroll",
        pageId,
        previous,
        beforePages,
      );
    } catch (error) {
      if (!dispatched) {
        throw error;
      }

      const mapped =
        error instanceof RoveError
          ? error
          : operationCompleted
            ? new RoveError({
                code: "RUNTIME_PROTOCOL_ERROR",
                message: "Post-action browser synchronization failed.",
              })
            : actionError(error, "Precise scroll");

      const result = await this.synchronizeAfterAction(
        "precise_scroll",
        pageId,
        previous,
        beforePages,
      ).catch(() => undefined);

      throw new InteractionDispatchError(
        mapped,
        result,
        operationCompleted ? "post_action_synchronization" : "dispatch",
      );
    }
  }

  private async runCoordinateClick(
    request: Extract<BrowserInteractionRequest, { kind: "coordinate_click" }>,
  ): Promise<ActionResult> {
    await this.assertObservationCurrent(request.observationId);

    const resolved = await this.resolveActionTarget(request.target);

    const bounds = await resolved.locator.boundingBox().catch(() => null);

    if (bounds === null) {
      throw new RoveError({
        code: "TARGET_NOT_VISIBLE",
        message: "The current target does not have usable interaction bounds.",
      });
    }

    if (
      request.offsetX < 0 ||
      request.offsetY < 0 ||
      request.offsetX > bounds.width ||
      request.offsetY > bounds.height
    ) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message:
          "Coordinate fallback point must remain inside the current target bounds.",
      });
    }

    const pageId = request.target.pageId;

    const page = this.pageRegistry.pageFor(pageId);

    const beforePages = this.pageRegistry.summaries();

    const previous = this.pageRegistry.stateFor(pageId);

    let dispatched = false;
    let operationCompleted = false;

    try {
      await this.withDialogDirective(pageId, request.dialog, async () => {
        dispatched = true;

        await this.evidenceRecorder.withAgentAction(page, () =>
          page.mouse.click(
            bounds.x + request.offsetX,
            bounds.y + request.offsetY,
          ),
        );
        operationCompleted = true;
      });

      return await this.synchronizeAfterAction(
        "coordinate_click",
        pageId,
        previous,
        beforePages,
      );
    } catch (error) {
      if (!dispatched) {
        throw error;
      }

      const mapped =
        error instanceof RoveError
          ? error
          : operationCompleted
            ? new RoveError({
                code: "RUNTIME_PROTOCOL_ERROR",
                message: "Post-action browser synchronization failed.",
              })
            : actionError(error, "Coordinate click");

      const result = await this.synchronizeAfterAction(
        "coordinate_click",
        pageId,
        previous,
        beforePages,
      ).catch(() => undefined);

      throw new InteractionDispatchError(
        mapped,
        result,
        operationCompleted ? "post_action_synchronization" : "dispatch",
      );
    }
  }

  private async applyCheckedState(
    resolved: ResolvedTarget,
    checked: boolean,
  ): Promise<void> {
    const tag = resolved.state.identity.tag;

    const type = resolved.state.identity.type;

    if (tag === "input" && (type === "checkbox" || type === "radio")) {
      if (checked) {
        await resolved.locator.check({
          timeout: this.actionTimeoutMs,
        });

        return;
      }

      if (type === "radio") {
        throw new RoveError({
          code: "TARGET_NOT_INTERACTIVE",
          message: "Radio controls cannot be unchecked directly.",
        });
      }

      await resolved.locator.uncheck({
        timeout: this.actionTimeoutMs,
      });

      return;
    }

    const role = resolved.state.identity.role;

    if (role !== "checkbox" && role !== "switch") {
      throw new RoveError({
        code: "TARGET_NOT_INTERACTIVE",
        message: "The target does not expose a supported checked state.",
      });
    }

    const before = await resolved.locator.getAttribute("aria-checked");

    const current = before === "true";

    if (current === checked) {
      return;
    }

    await resolved.locator.click({
      timeout: this.actionTimeoutMs,
    });

    const after = await resolved.locator.getAttribute("aria-checked");

    if ((after === "true") !== checked) {
      throw new RoveError({
        code: "TARGET_NOT_INTERACTIVE",
        message: "The target did not enter the requested checked state.",
      });
    }
  }

  private async withDialogDirective<T>(
    pageId: string,
    directive: DialogDirective | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (directive === undefined) {
      return operation();
    }

    if (this.pendingDialogDirectives.has(pageId)) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "A dialog directive is already pending for this page.",
      });
    }

    this.pendingDialogDirectives.set(pageId, directive);

    try {
      return await operation();
    } finally {
      this.pendingDialogDirectives.delete(pageId);
    }
  }

  async click(target: TargetReference): Promise<ActionResult> {
    this.ensureOpen();
    return this.runTargetInteraction(
      "click",
      target,
      undefined,
      "Click",
      async (resolved) =>
        resolved.locator.click({ timeout: this.actionTimeoutMs }),
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
      await this.replaceEditableValue(resolved.locator, value);
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

  private async replaceEditableValue(
    locator: Locator,
    value: string,
  ): Promise<void> {
    await locator.fill(value, { timeout: this.actionTimeoutMs });

    await this.assertEditableValue(locator, value);
  }

  private async assertEditableValue(
    locator: Locator,
    value: string,
  ): Promise<void> {
    const exact = await locator.evaluate((element, expected) => {
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
      ) {
        return element.value === expected;
      }

      if (element instanceof HTMLElement && element.isContentEditable) {
        return element.textContent === expected;
      }

      return null;
    }, value);

    if (exact === null) {
      throw new RoveError({
        code: "TARGET_NOT_INTERACTIVE",
        message: "The target does not support deterministic text replacement.",
      });
    }

    if (!exact) {
      throw new RoveError({
        code: "TARGET_NOT_INTERACTIVE",
        message:
          "The editable target did not retain the exact replacement value.",
      });
    }
  }

  private async runPageKeyInteraction(
    action: "press" | "clipboard",
    key: string,
    pageId: string,
    dialog: DialogDirective | undefined,
  ): Promise<ActionResult> {
    const page = this.pageRegistry.pageFor(pageId);
    const beforePages = this.pageRegistry.summaries();
    const previous = this.pageRegistry.stateFor(pageId);
    const phases: ActionPhaseRecord[] = [
      { phase: "preflight", status: "completed", strategy: "active_page" },
    ];
    let dispatched = false;
    try {
      await this.withDialogDirective(pageId, dialog, async () => {
        await this.evidenceRecorder.withAgentAction(page, async () => {
          dispatched = true;
          await page.keyboard.press(key);
        });
      });
      phases.push({
        phase: "commit",
        status: "completed",
        strategy: "trusted_keyboard_input",
      });
      return await this.synchronizeAfterAction(
        action,
        pageId,
        previous,
        beforePages,
        phases,
      );
    } catch (error) {
      if (!dispatched) throw error;
      const result = await this.synchronizeAfterAction(
        action,
        pageId,
        previous,
        beforePages,
        [
          ...phases,
          {
            phase: "commit",
            status: "uncertain",
            strategy: "trusted_keyboard_input",
          },
        ],
      ).catch(() => undefined);
      throw new InteractionDispatchError(
        actionError(error, action === "press" ? "Press" : "Clipboard"),
        result,
        "dispatch",
      );
    }
  }

  private async runTrustedStagedDrag(
    page: Page,
    source: Locator,
    destination: Locator,
    phases: ActionPhaseRecord[],
  ): Promise<void> {
    const [sourceBounds, destinationBounds] = await Promise.all([
      source.boundingBox({ timeout: this.actionTimeoutMs }),
      destination.boundingBox({ timeout: this.actionTimeoutMs }),
    ]);
    if (sourceBounds === null || destinationBounds === null) {
      throw new RoveError({
        code: "TARGET_NOT_VISIBLE",
        message:
          "Drag source and destination require visible interaction bounds.",
      });
    }

    const start = {
      x: sourceBounds.x + sourceBounds.width / 2,
      y: sourceBounds.y + sourceBounds.height / 2,
    };
    const end = {
      x: destinationBounds.x + destinationBounds.width / 2,
      y: destinationBounds.y + destinationBounds.height / 2,
    };
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const threshold = Math.min(12, Math.max(6, distance * 0.08));
    const unit =
      distance === 0
        ? { x: 1, y: 0 }
        : {
            x: (end.x - start.x) / distance,
            y: (end.y - start.y) / distance,
          };

    let pressed = false;
    let released = false;
    try {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      pressed = true;
      phases.push({
        phase: "engage",
        status: "completed",
        strategy: "pointer_down_threshold_dwell",
      });
      await page.mouse.move(
        start.x + unit.x * threshold,
        start.y + unit.y * threshold,
        { steps: 2 },
      );
      await page.waitForTimeout(125);
      await page.mouse.move(end.x, end.y, { steps: 12 });
      await page.mouse.move(end.x, end.y, { steps: 2 });
      await page.waitForTimeout(80);
      phases.push({
        phase: "progress",
        status: "completed",
        strategy: "trusted_pointer_interpolation",
      });
      await page.mouse.up();
      released = true;
    } finally {
      if (pressed && !released) await page.mouse.up().catch(() => undefined);
    }
  }

  async press(
    target: TargetReference | null,
    key: string,
    requestedPageId?: string,
  ): Promise<ActionResult> {
    this.ensureOpen();
    const pageId =
      target?.pageId ?? requestedPageId ?? this.requireActivePageId();
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

  async scroll(
    options: ScrollOptions,
    requestedPageId?: string,
  ): Promise<ActionResult> {
    this.ensureOpen();
    const amount = options.amount ?? 600;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Scroll amount must be positive.",
      });
    }
    const pageId = requestedPageId ?? this.requireActivePageId();
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
      const moved = await scrollDomSurface(page, delta[0], delta[1]);

      if (!moved) {
        const fallbackKey =
          options.direction === "down"
            ? "PageDown"
            : options.direction === "up"
              ? "PageUp"
              : options.direction === "right"
                ? "ArrowRight"
                : "ArrowLeft";

        await page.keyboard.press(fallbackKey);
      }
    } catch (error) {
      throw actionError(error, "Scroll");
    }
    return this.synchronizeAfterAction("scroll", pageId, previous, beforePages);
  }

  async back(pageId?: string): Promise<ActionResult> {
    this.ensureOpen();
    return this.historyAction("back", pageId);
  }

  async forward(pageId?: string): Promise<ActionResult> {
    this.ensureOpen();
    return this.historyAction("forward", pageId);
  }

  async screenshot(
    options: ScreenshotOptions = {},
    requestedPageId?: string,
  ): Promise<Artifact> {
    this.ensureOpen();

    const mode = options.mode ?? "viewport";

    const authority =
      options.observationId === undefined
        ? undefined
        : await this.assertObservationCurrent(options.observationId, {
            allowMutationDrift: true,
          });

    const pageId =
      options.target?.pageId ??
      authority?.pageId ??
      requestedPageId ??
      this.requireActivePageId();

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

        await this.assertObservationCurrent(options.observationId, {
          allowMutationDrift: true,
        });
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
          ...(authority === undefined
            ? {}
            : {
                observationMutationVersion: authority.mutationVersion,
              }),
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
    if (target.sessionId !== undefined && target.sessionId !== this.id) {
      throw new RoveError({
        code: "TARGET_STALE",
        message: "Target belongs to a superseded browser session.",
        retryable: true,
      });
    }
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
    phases?: ActionPhaseRecord[],
  ): Promise<ActionResult> {
    const page = this.pageRegistry.pageFor(pageId);
    this.invalidateObservationPages(new Set([pageId]));
    let current: PageState;
    try {
      current = await this.pageRegistry.syncMetadata(pageId);
    } catch (error) {
      if (isBrowserClosedError(error)) throw browserClosedError();
      const observed = this.pageRegistry.stateFor(pageId);
      const url = page.url();
      if (observed.revision === previous.revision && url === previous.url) {
        throw error;
      }
      current =
        observed.url === url
          ? observed
          : this.pageRegistry.update(pageId, {
              ...recordMutation(observed, true),
              url,
            });
    }
    let mutationVersion: number;
    try {
      mutationVersion = await readMaterialMutationVersion(page);
    } catch (error) {
      if (isBrowserClosedError(error)) throw browserClosedError();
      const observed = this.pageRegistry.stateFor(pageId);
      const url = page.url();
      if (observed.revision === previous.revision && url === previous.url) {
        throw error;
      }
      current =
        observed.url === url
          ? observed
          : this.pageRegistry.update(pageId, {
              ...recordMutation(observed, true),
              url,
            });
      mutationVersion = current.mutationVersion;
    }
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
      ...(phases === undefined
        ? {}
        : {
            phases: [
              ...phases,
              {
                phase: "synchronize" as const,
                status: "completed" as const,
                strategy: "revision_and_mutation_reconciliation",
              },
            ],
          }),
    };
  }

  private async historyAction(
    action: "back" | "forward",
    requestedPageId?: string,
  ): Promise<ActionResult> {
    const pageId = requestedPageId ?? this.requireActivePageId();
    const page = this.pageRegistry.pageFor(pageId);
    const previous = this.pageRegistry.stateFor(pageId);
    const beforePages = this.pageRegistry.summaries();
    let dispatched = false;
    try {
      const response = await this.evidenceRecorder.withAgentAction(page, () => {
        dispatched = true;
        return action === "back"
          ? page.goBack({
              waitUntil: "commit",
              timeout: this.actionTimeoutMs,
            })
          : page.goForward({
              waitUntil: "commit",
              timeout: this.actionTimeoutMs,
            });
      });
      if (response === null) {
        const observed = this.pageRegistry.stateFor(pageId);
        if (
          observed.revision !== previous.revision ||
          page.url() !== previous.url
        ) {
          return await this.synchronizeAfterAction(
            action,
            pageId,
            previous,
            beforePages,
          );
        }
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
      return await this.synchronizeAfterAction(
        action,
        pageId,
        previous,
        beforePages,
      );
    } catch (error) {
      const observed = this.pageRegistry.stateFor(pageId);
      if (
        observed.revision !== previous.revision ||
        page.url() !== previous.url
      ) {
        return await this.synchronizeAfterAction(
          action,
          pageId,
          previous,
          beforePages,
        );
      }

      const mapped =
        error instanceof playwrightErrors.TimeoutError
          ? new RoveError({
              code: "ACTION_TIMEOUT",
              message: `Browser ${action} timed out.`,
              retryable: true,
            })
          : isBrowserClosedError(error)
            ? browserClosedError()
            : new RoveError({
                code: "NAVIGATION_FAILED",
                message: `Browser ${action} failed.`,
              });

      if (dispatched) {
        throw new InteractionDispatchError(mapped, undefined, "dispatch");
      }

      throw mapped;
    }
  }

  private invalidateObservationPages(pageIds: ReadonlySet<string>): void {
    for (const [observationId, authority] of this.observationAuthorities) {
      if (!pageIds.has(authority.pageId)) continue;
      this.observationAuthorities.delete(observationId);
      this.observationSnapshots.delete(observationId);
      this.inspector.forgetObservation(observationId);
    }
  }

  private invalidateInspectionPages(pageIds: ReadonlySet<string>): void {
    for (const pageId of pageIds) {
      this.inspectionGenerations.set(
        pageId,
        (this.inspectionGenerations.get(pageId) ?? 0) + 1,
      );
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
    if (this.closeCompleted) return;
    if (this.closePromise !== undefined) return this.closePromise;
    this.closed = true;

    const attempt = this.closeOnce();
    this.closePromise = attempt;
    try {
      await attempt;
      this.closeCompleted = true;
    } finally {
      if (this.closePromise === attempt) this.closePromise = undefined;
    }
  }

  private async closeOnce(): Promise<void> {
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
        (await settleBrowserShutdownStep(() =>
          this.browser.newBrowserCDPSession(),
        ));

      if (shutdownCdp !== undefined) {
        await settleBrowserShutdownStep(() =>
          shutdownCdp.send("Browser.close"),
        );
        await settleBrowserShutdownStep(() => shutdownCdp.detach());
      }

      await this.ownedRuntimeCleanup();
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
        await this.ownedRuntimeCleanup();
      }
    }

    this.observationAuthorities.clear();
    this.observationSnapshots.clear();
    this.pendingDialogDirectives.clear();
    this.inspectionGenerations.clear();
    this.pageRegistry.clear();
    this.inspector.clear();

    if (this.downloadRuntime?.temporary === true) {
      await rm(this.downloadRuntime.root, {
        recursive: true,
        force: true,
      }).catch(() => undefined);
    }
  }

  async browserWindowState(): Promise<BrowserWindowState | null> {
    if (
      this.closed ||
      this.headless ||
      !this.browser.isConnected() ||
      this.browserCdp === undefined
    ) {
      return null;
    }

    try {
      const targets = (await this.browserCdp.send("Target.getTargets", {
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
          targetId: string;
          type: string;
          title: string;
          url: string;
          embedderData?: {
            tabActive?: boolean;
            tabStripIndex?: number;
          };
        }>;
      };

      const activeTargets = targets.targetInfos.filter(
        (target) =>
          target.type === "tab" && target.embedderData?.tabActive === true,
      );

      if (activeTargets.length !== 1) {
        return null;
      }

      const activeTarget = activeTargets[0]!;
      const pageId = this.resolveTabTargetPageId(activeTarget);

      if (pageId === undefined || !this.pageRegistry.has(pageId)) {
        return null;
      }

      const page = this.pageRegistry.pageFor(pageId);

      const [windowResult, documentFocused] = await Promise.all([
        this.browserCdp.send("Browser.getWindowForTarget", {
          targetId: activeTarget.targetId,
        }) as Promise<{
          windowId?: unknown;
          bounds?: {
            left?: unknown;
            top?: unknown;
            width?: unknown;
            height?: unknown;
            windowState?: unknown;
          };
        }>,
        page.evaluate(() => document.hasFocus()),
      ]);

      const windowId = windowResult.windowId;

      const bounds = windowResult.bounds;

      if (
        typeof windowId !== "number" ||
        !Number.isInteger(windowId) ||
        windowId <= 0 ||
        bounds === undefined
      ) {
        return null;
      }

      const { left, top, width, height, windowState } = bounds;

      if (
        typeof left !== "number" ||
        !Number.isFinite(left) ||
        typeof top !== "number" ||
        !Number.isFinite(top) ||
        typeof width !== "number" ||
        !Number.isFinite(width) ||
        width <= 0 ||
        typeof height !== "number" ||
        !Number.isFinite(height) ||
        height <= 0
      ) {
        return null;
      }

      if (
        windowState !== "normal" &&
        windowState !== "minimized" &&
        windowState !== "maximized" &&
        windowState !== "fullscreen"
      ) {
        return null;
      }

      return {
        windowId,
        pageId,
        windowState,
        bounds: {
          left,
          top,
          width,
          height,
        },
        documentFocused,
      };
    } catch {
      return null;
    }
  }

  async show(): Promise<void> {
    this.ensureOpen();
    const pageId =
      this.pageRegistry.activeId() ?? this.pageRegistry.summaries()[0]?.id;
    if (pageId === undefined) {
      throw new RoveError({
        code: "BROWSER_CLOSED",
        message: "The browser has no page to show.",
      });
    }
    const page = this.pageRegistry.pageFor(pageId);
    const windowState = await this.browserWindowState();
    if (
      windowState?.windowState === "minimized" &&
      this.browserCdp !== undefined
    ) {
      await this.browserCdp.send("Browser.setWindowBounds", {
        windowId: windowState.windowId,
        bounds: { windowState: "normal" },
      });
    }
    try {
      await page.bringToFront();
    } catch (error) {
      if (isBrowserClosedError(error)) throw browserClosedError();
      throw error;
    }
    this.pageRegistry.activate(pageId);
    await this.pageRegistry.syncMetadata(pageId);
  }

  hostIdentity(): BrowserHostIdentity | null {
    if (this.closed || !this.browser.isConnected()) {
      return null;
    }

    return this.hostIdentityProvider?.() ?? null;
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
