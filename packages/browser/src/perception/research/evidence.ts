import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { ElementHandle, Frame, Page, Request, Response } from "playwright";

const MAX_EVENT_RECORDS = 200;
const INTERACTIVE_SELECTOR =
  'a[href],button,input:not([type="hidden"]),textarea,select,[role],[contenteditable="true"],[tabindex]';

export interface DistributionSummary {
  sampleCount: number;
  mean: number | null;
  median: number | null;
  p95: number | null;
  max: number | null;
}

export interface DocumentEvidence {
  readyState: string;
  titleChars: number;
  titleHash: string;
  textChars: number;
  textHash: string;
  elementCount: number;
  interactiveCandidateCount: number;
  iframeElementCount: number;
  ariaBusyCount: number;
  canvasCount: number;
  viewport: {
    width: number;
    height: number;
  } | null;
}

export interface FrameElementEvidence {
  cssVisible: boolean;
  display: string;
  visibility: string;
  opacity: number;
  pointerEvents: string;
  zIndex: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  area: number;
  viewportIntersectionRatio: number;
  ancestorClipRatio: number;
  topmostSampleRatio: number | null;
}

export interface FrameEvidence {
  index: number;
  depth: number;
  parentIndex: number | null;
  scheme: string;
  origin: string | null;
  sameOriginAsMain: boolean | null;
  element: FrameElementEvidence | null;
  elementAcquisition: "available" | "not_applicable" | "unavailable";
  elementUnavailableReason: "detached" | "frame_element_race" | null;
  domOrdinal: number | null;
  titleHash: string | null;
}

export interface AccessibilityEvidence {
  snapshotChars: number;
  snapshotLines: number;
  snapshotHash: string;
  headingCount: number;
  buttonCount: number;
  linkCount: number;
  iframeCount: number;
  textboxCount: number;
}

export type ObservationPhase =
  | "frameattached"
  | "framedetached"
  | "framenavigated"
  | "request"
  | "requestfinished"
  | "requestfailed"
  | "response"
  | "domcontentloaded"
  | "load";

export interface ObservationEvent {
  phase: ObservationPhase;
  atMs: number;
  resourceType?: string;
  method?: string;
  status?: number;
  scheme?: string;
  origin?: string | null;
  isNavigationRequest?: boolean;
  frameDepth?: number | null;
}

export interface ObservationEvidence {
  events: ObservationEvent[];
  truncated: boolean;
  droppedEventCount: number;
  requestCount: number;
  responseCount: number;
  failedRequestCount: number;
  subframeDocumentRequestCount: number;
  subframeDocumentResponseCount: number;
  frameAttachedCount: number;
  frameNavigatedCount: number;
  domContentLoadedCount: number;
  loadCount: number;
}

export interface EvidenceTiming {
  documentMs: number;
  framesMs: number;
  accessibilityMs: number;
  observationSnapshotMs: number;
  totalMs: number;
}

export interface EvidencePayload {
  documentBytes: number;
  framesBytes: number;
  accessibilityBytes: number;
  observationBytes: number;
  totalBytes: number;
}

export interface ResearchEvidence {
  document: DocumentEvidence;
  frames: FrameEvidence[];
  accessibility: AccessibilityEvidence;
  observation: ObservationEvidence;
}

export interface EvidenceAcquisition {
  evidence: ResearchEvidence;
  timing: EvidenceTiming;
  payload: EvidencePayload;
}

interface SanitizedUrlFact {
  scheme: string;
  origin: string | null;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeUrlFact(raw: string): SanitizedUrlFact {
  try {
    const url = new URL(raw);
    return {
      scheme: url.protocol.replace(/:$/, ""),
      origin: url.origin === "null" ? null : url.origin,
    };
  } catch {
    return {
      scheme: "invalid",
      origin: null,
    };
  }
}

function frameDepth(frame: Frame): number {
  let depth = 0;
  let parent = frame.parentFrame();

  while (parent !== null) {
    depth += 1;
    parent = parent.parentFrame();
  }

  return depth;
}

function requestFrameDepth(request: Request): number | null {
  try {
    return frameDepth(request.frame());
  } catch {
    return null;
  }
}

function responseFrameDepth(response: Response): number | null {
  try {
    return frameDepth(response.frame());
  } catch {
    return null;
  }
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index] ?? null;
}

export function summarize(values: number[]): DistributionSummary {
  if (values.length === 0) {
    return {
      sampleCount: 0,
      mean: null,
      median: null,
      p95: null,
      max: null,
    };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    sampleCount: sorted.length,
    mean: total / sorted.length,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? null,
  };
}

export class PageObservationRecorder {
  private readonly started = performance.now();
  private readonly events: ObservationEvent[] = [];
  private truncated = false;
  private droppedEventCount = 0;
  private readonly totals = {
    requestCount: 0,
    responseCount: 0,
    failedRequestCount: 0,
    subframeDocumentRequestCount: 0,
    subframeDocumentResponseCount: 0,
    frameAttachedCount: 0,
    frameNavigatedCount: 0,
    domContentLoadedCount: 0,
    loadCount: 0,
  };

  constructor(private readonly page: Page) {
    page.on("frameattached", (frame) => {
      this.totals.frameAttachedCount += 1;
      this.record({
        phase: "frameattached",
        frameDepth: safeFrameDepth(frame),
        ...safeUrlFact(frame.url()),
      });
    });

    page.on("framedetached", (frame) => {
      this.record({
        phase: "framedetached",
        frameDepth: safeFrameDepth(frame),
        ...safeUrlFact(frame.url()),
      });
    });

    page.on("framenavigated", (frame) => {
      this.totals.frameNavigatedCount += 1;
      this.record({
        phase: "framenavigated",
        frameDepth: safeFrameDepth(frame),
        ...safeUrlFact(frame.url()),
      });
    });

    page.on("request", (request) => {
      this.totals.requestCount += 1;
      if (
        request.resourceType() === "document" &&
        (requestFrameDepth(request) ?? 0) > 0
      ) {
        this.totals.subframeDocumentRequestCount += 1;
      }
      const url = safeUrlFact(request.url());
      this.record({
        phase: "request",
        resourceType: request.resourceType(),
        method: request.method(),
        isNavigationRequest: request.isNavigationRequest(),
        frameDepth: requestFrameDepth(request),
        ...url,
      });
    });

    page.on("requestfinished", (request) => {
      const url = safeUrlFact(request.url());
      this.record({
        phase: "requestfinished",
        resourceType: request.resourceType(),
        method: request.method(),
        isNavigationRequest: request.isNavigationRequest(),
        frameDepth: requestFrameDepth(request),
        ...url,
      });
    });

    page.on("requestfailed", (request) => {
      this.totals.failedRequestCount += 1;
      const url = safeUrlFact(request.url());
      this.record({
        phase: "requestfailed",
        resourceType: request.resourceType(),
        method: request.method(),
        isNavigationRequest: request.isNavigationRequest(),
        frameDepth: requestFrameDepth(request),
        ...url,
      });
    });

    page.on("response", (response) => {
      const request = response.request();
      this.totals.responseCount += 1;
      if (
        request.resourceType() === "document" &&
        (responseFrameDepth(response) ?? 0) > 0
      ) {
        this.totals.subframeDocumentResponseCount += 1;
      }
      const url = safeUrlFact(response.url());
      this.record({
        phase: "response",
        resourceType: request.resourceType(),
        method: request.method(),
        status: response.status(),
        isNavigationRequest: request.isNavigationRequest(),
        frameDepth: responseFrameDepth(response),
        ...url,
      });
    });

    page.on("domcontentloaded", () => {
      this.totals.domContentLoadedCount += 1;
      this.record({ phase: "domcontentloaded" });
    });

    page.on("load", () => {
      this.totals.loadCount += 1;
      this.record({ phase: "load" });
    });
  }

  snapshot(): ObservationEvidence {
    const events = this.events.map((event) => ({ ...event }));

    return {
      events,
      truncated: this.truncated,
      droppedEventCount: this.droppedEventCount,
      ...this.totals,
    };
  }

  private record(event: Omit<ObservationEvent, "atMs">): void {
    if (this.events.length >= MAX_EVENT_RECORDS) {
      this.truncated = true;
      this.droppedEventCount += 1;
      return;
    }

    this.events.push({
      ...event,
      atMs: performance.now() - this.started,
    });
  }
}

function safeFrameDepth(frame: Frame): number | null {
  try {
    return frameDepth(frame);
  } catch {
    return null;
  }
}

async function collectDocumentEvidence(page: Page): Promise<DocumentEvidence> {
  const snapshot = await page.evaluate((interactiveSelector) => {
    const title = document.title;
    const text = document.body?.innerText ?? "";

    return {
      readyState: document.readyState,
      title,
      text,
      elementCount: document.querySelectorAll("*").length,
      interactiveCandidateCount:
        document.querySelectorAll(interactiveSelector).length,
      iframeElementCount: document.querySelectorAll("iframe").length,
      ariaBusyCount: document.querySelectorAll('[aria-busy="true"]').length,
      canvasCount: document.querySelectorAll("canvas").length,
    };
  }, INTERACTIVE_SELECTOR);

  return {
    readyState: snapshot.readyState,
    titleChars: snapshot.title.length,
    titleHash: hash(snapshot.title),
    textChars: snapshot.text.length,
    textHash: hash(snapshot.text),
    elementCount: snapshot.elementCount,
    interactiveCandidateCount: snapshot.interactiveCandidateCount,
    iframeElementCount: snapshot.iframeElementCount,
    ariaBusyCount: snapshot.ariaBusyCount,
    canvasCount: snapshot.canvasCount,
    viewport: page.viewportSize(),
  };
}

async function collectFrameElementEvidence(
  frame: Frame,
  anchoredHandle?: ElementHandle,
): Promise<
  Pick<
    FrameEvidence,
    | "element"
    | "elementAcquisition"
    | "elementUnavailableReason"
    | "domOrdinal"
    | "titleHash"
  >
> {
  if (frame.parentFrame() === null)
    return {
      element: null,
      elementAcquisition: "not_applicable",
      elementUnavailableReason: null,
      domOrdinal: null,
      titleHash: null,
    };

  try {
    const handle = anchoredHandle ?? (await frame.frameElement());

    const result = await handle.evaluate((element) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);

      type Rect = {
        left: number;
        top: number;
        right: number;
        bottom: number;
      };

      const intersect = (left: Rect, right: Rect): Rect => ({
        left: Math.max(left.left, right.left),
        top: Math.max(left.top, right.top),
        right: Math.min(left.right, right.right),
        bottom: Math.min(left.bottom, right.bottom),
      });

      const areaOf = (value: Rect): number =>
        Math.max(0, value.right - value.left) *
        Math.max(0, value.bottom - value.top);

      const ownRect: Rect = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };

      const viewportRect: Rect = {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
      };

      const viewportIntersection = intersect(ownRect, viewportRect);
      const viewportIntersectionRatio =
        area === 0 ? 0 : areaOf(viewportIntersection) / area;

      let ancestorClipped = ownRect;
      let ancestor = html.parentElement;
      let effectiveOpacity = Number.parseFloat(style.opacity || "1");
      let ancestorsCssVisible = true;

      while (ancestor !== null) {
        const ancestorStyle = getComputedStyle(ancestor);
        const ancestorOpacity = Number.parseFloat(ancestorStyle.opacity || "1");
        effectiveOpacity *= Number.isFinite(ancestorOpacity)
          ? ancestorOpacity
          : 1;
        ancestorsCssVisible =
          ancestorsCssVisible &&
          ancestorStyle.display !== "none" &&
          ancestorStyle.visibility !== "hidden" &&
          ancestorStyle.visibility !== "collapse";
        const clips =
          ["hidden", "clip", "scroll", "auto"].includes(
            ancestorStyle.overflow,
          ) ||
          ["hidden", "clip", "scroll", "auto"].includes(
            ancestorStyle.overflowX,
          ) ||
          ["hidden", "clip", "scroll", "auto"].includes(
            ancestorStyle.overflowY,
          );

        if (clips) {
          const ancestorRect = ancestor.getBoundingClientRect();
          ancestorClipped = intersect(ancestorClipped, {
            left: ancestorRect.left,
            top: ancestorRect.top,
            right: ancestorRect.right,
            bottom: ancestorRect.bottom,
          });
        }

        ancestor = ancestor.parentElement;
      }

      const ancestorClipRatio = area === 0 ? 0 : areaOf(ancestorClipped) / area;

      const effective = intersect(
        intersect(ownRect, viewportRect),
        ancestorClipped,
      );

      const effectiveWidth = Math.max(0, effective.right - effective.left);
      const effectiveHeight = Math.max(0, effective.bottom - effective.top);

      let topmostSampleRatio: number | null = null;

      if (effectiveWidth > 0 && effectiveHeight > 0) {
        const points = [
          [0.5, 0.5],
          [0.2, 0.2],
          [0.8, 0.2],
          [0.2, 0.8],
          [0.8, 0.8],
        ] as const;

        let topmost = 0;

        for (const [xRatio, yRatio] of points) {
          const x = effective.left + effectiveWidth * xRatio;
          const y = effective.top + effectiveHeight * yRatio;
          const atPoint = document.elementFromPoint(x, y);

          if (
            atPoint === html ||
            (atPoint !== null && html.contains(atPoint))
          ) {
            topmost += 1;
          }
        }

        topmostSampleRatio = topmost / points.length;
      }

      const opacity = Number.parseFloat(style.opacity || "1");

      return {
        cssVisible:
          html.isConnected &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.visibility !== "collapse" &&
          Number.isFinite(opacity) &&
          opacity > 0 &&
          effectiveOpacity > 0 &&
          ancestorsCssVisible &&
          rect.width > 0 &&
          rect.height > 0,
        display: style.display,
        visibility: style.visibility,
        opacity: Number.isFinite(opacity) ? opacity : 1,
        pointerEvents: style.pointerEvents,
        zIndex: style.zIndex,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        area,
        viewportIntersectionRatio,
        ancestorClipRatio,
        topmostSampleRatio,
        domOrdinal: Array.from(
          document.querySelectorAll("iframe,frame"),
        ).indexOf(html),
        title: html.getAttribute("title") ?? "",
      };
    });
    const { domOrdinal, title, ...element } = result;
    return {
      element,
      elementAcquisition: "available",
      elementUnavailableReason: null,
      domOrdinal,
      titleHash: hash(title),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      element: null,
      elementAcquisition: "unavailable",
      elementUnavailableReason: /detached/i.test(message)
        ? "detached"
        : "frame_element_race",
      domOrdinal: null,
      titleHash: null,
    };
  }
}

async function collectFrameEvidenceOnce(
  page: Page,
  anchoredChildren: Array<{ frame: Frame; handle: ElementHandle }>,
): Promise<FrameEvidence[]> {
  const frames = [
    page.mainFrame(),
    ...anchoredChildren.map(({ frame }) => frame),
    ...page
      .frames()
      .filter(
        (frame) =>
          frame !== page.mainFrame() &&
          !anchoredChildren.some((anchored) => anchored.frame === frame),
      ),
  ];
  const indexes = new Map(frames.map((frame, index) => [frame, index]));
  const mainFact = safeUrlFact(page.mainFrame().url());

  return Promise.all(
    frames.map(async (frame, index) => {
      const fact = safeUrlFact(frame.url());
      const parent = frame.parentFrame();

      const elementEvidence = await collectFrameElementEvidence(
        frame,
        anchoredChildren.find((anchored) => anchored.frame === frame)?.handle,
      );
      return {
        index,
        depth: frameDepth(frame),
        parentIndex: parent === null ? null : (indexes.get(parent) ?? null),
        scheme: fact.scheme,
        origin: fact.origin,
        sameOriginAsMain:
          fact.origin === null || mainFact.origin === null
            ? null
            : fact.origin === mainFact.origin,
        ...elementEvidence,
      };
    }),
  );
}

async function collectFrameEvidence(
  page: Page,
  expectedIframeCount: number,
): Promise<FrameEvidence[]> {
  const deadline = performance.now() + 500;
  let frames: FrameEvidence[] = [];
  do {
    const handles = await page.locator("iframe,frame").elementHandles();
    const anchoredChildren = (
      await Promise.all(
        handles.map(async (handle) => ({
          handle,
          frame: await handle.contentFrame(),
        })),
      )
    ).filter(
      (item): item is { handle: ElementHandle; frame: Frame } =>
        item.frame !== null,
    );
    frames = await collectFrameEvidenceOnce(page, anchoredChildren);
    const children = frames.filter((frame) => frame.depth > 0);
    if (
      anchoredChildren.length >= expectedIframeCount &&
      children.length >= expectedIframeCount &&
      children.every((frame) => frame.elementAcquisition === "available")
    ) {
      return frames;
    }
    await page.waitForTimeout(20);
  } while (performance.now() < deadline);
  return frames;
}

function countRole(snapshot: string, role: string): number {
  const expression = new RegExp(`^\\s*-\\s+${role}(?:\\s|:|$)`, "gim");
  return snapshot.match(expression)?.length ?? 0;
}

async function collectAccessibilityEvidence(
  page: Page,
): Promise<AccessibilityEvidence> {
  const snapshot = await page.locator("body").ariaSnapshot();

  return {
    snapshotChars: snapshot.length,
    snapshotLines: snapshot.length === 0 ? 0 : snapshot.split("\n").length,
    snapshotHash: hash(snapshot),
    headingCount: countRole(snapshot, "heading"),
    buttonCount: countRole(snapshot, "button"),
    linkCount: countRole(snapshot, "link"),
    iframeCount: countRole(snapshot, "iframe"),
    textboxCount: countRole(snapshot, "textbox"),
  };
}

export async function collectResearchEvidence(
  page: Page,
  recorder: PageObservationRecorder,
): Promise<EvidenceAcquisition> {
  const totalStarted = performance.now();

  // tsx/esbuild annotates nested browser-evaluation helpers with __name.
  // Playwright serializes the callback without that runtime helper, so provide
  // the identity annotation locally before evaluating geometry.
  await page.evaluate("globalThis.__name ??= value => value");

  const documentStarted = performance.now();
  const document = await collectDocumentEvidence(page);
  const documentMs = performance.now() - documentStarted;

  const framesStarted = performance.now();
  const frames = await collectFrameEvidence(page, document.iframeElementCount);
  const framesMs = performance.now() - framesStarted;

  const accessibilityStarted = performance.now();
  const accessibility = await collectAccessibilityEvidence(page);
  const accessibilityMs = performance.now() - accessibilityStarted;

  const observationStarted = performance.now();
  const observation = recorder.snapshot();
  const observationSnapshotMs = performance.now() - observationStarted;

  const documentAfter = await collectDocumentEvidence(page);
  if (JSON.stringify(documentAfter) !== JSON.stringify(document)) {
    throw new Error(
      "Page structure changed while evidence channels were acquired.",
    );
  }

  const evidence = {
    document,
    frames,
    accessibility,
    observation,
  };

  const payload = {
    documentBytes: byteLength(document),
    framesBytes: byteLength(frames),
    accessibilityBytes: byteLength(accessibility),
    observationBytes: byteLength(observation),
    totalBytes: byteLength(evidence),
  };

  return {
    evidence,
    timing: {
      documentMs,
      framesMs,
      accessibilityMs,
      observationSnapshotMs,
      totalMs: performance.now() - totalStarted,
    },
    payload,
  };
}

const FORBIDDEN_PERSISTED_KEYS = new Set([
  "rawhtml",
  "html",
  "bodytext",
  "fulltext",
  "textcontent",
  "ariasnapshot",
  "requestbody",
  "responsebody",
  "requestheaders",
  "responseheaders",
  "headers",
  "cookie",
  "cookies",
  "authorization",
  "bearertoken",
  "password",
  "otp",
  "localstorage",
  "sessionstorage",
  "indexeddb",
  "formvalue",
  "inputvalue",
]);

function normalizedKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function assertBoundedPersistedEvidence(value: unknown): void {
  const visit = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    if (typeof current !== "object" || current === null) return;

    for (const [key, child] of Object.entries(current)) {
      const normalized = normalizedKey(key);

      if (FORBIDDEN_PERSISTED_KEYS.has(normalized)) {
        throw new Error(`Forbidden persisted evidence key at ${path}.${key}`);
      }

      if (normalized === "url" || normalized.endsWith("url")) {
        throw new Error(
          `Unsanitized URL-shaped field at ${path}.${key}; persist scheme/origin facts instead.`,
        );
      }

      visit(child, `${path}.${key}`);
    }
  };

  visit(value, "evidence");
}

export function firstChildFrame(
  evidence: ResearchEvidence,
): FrameEvidence | undefined {
  const children = evidence.frames
    .filter(
      (frame) => frame.depth === 1 && frame.elementAcquisition === "available",
    )
    .sort(
      (left, right) =>
        (left.domOrdinal ?? Number.MAX_SAFE_INTEGER) -
        (right.domOrdinal ?? Number.MAX_SAFE_INTEGER),
    );
  return children.length === 1 ? children[0] : undefined;
}
