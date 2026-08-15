import { randomUUID } from "node:crypto";

import type {
  BrowserErrorEvidence,
  BrowserEvidenceSnapshot,
  BrowserNavigationEvidence,
  BrowserNavigationProvenance,
} from "@rove/protocol";
import type { ConsoleMessage, Page, Request, Response } from "playwright";

const MAX_NAVIGATIONS_PER_PAGE = 100;
const MAX_ERRORS_PER_PAGE = 100;
const MAX_PERSISTED_ITEMS_PER_PAGE = 200;
const MAX_SUMMARY_CHARS = 500;
const HUMAN_PROVENANCE_WINDOW_MS = 2_000;

type EvidenceItem = BrowserNavigationEvidence | BrowserErrorEvidence;
type EvidenceListener = (pageId: string, item: EvidenceItem) => void;

interface RequestContext {
  navigationId: string;
  sourceUrl: string;
  redirectIndex: number;
  provenance: BrowserNavigationProvenance;
}

interface PendingProvenance {
  provenance: BrowserNavigationProvenance;
  expiresAt: number;
}

function boundedPush<T>(items: T[], item: T, limit: number): void {
  items.push(item);
  if (items.length > limit) items.splice(0, items.length - limit);
}

/** Removes URL credentials/query data and common secret-bearing assignments. */
export function sanitizeEvidenceText(value: string): string {
  const withoutSensitiveUrls = value.replace(
    /https?:\/\/[^\s"'<>]+/giu,
    (candidate) => sanitizeEvidenceUrl(candidate),
  );

  return withoutSensitiveUrls
    .replace(
      /\b(authorization)\s*[:=]\s*(?:(?:bearer|basic)\s+)?[^\s,;]+/giu,
      "$1=[redacted]",
    )
    .replace(
      /\b(cookie|set-cookie|password|passwd|passcode|secret|token|api[-_]?key)\s*[:=]\s*[^\s,;]+/giu,
      "$1=[redacted]",
    )
    .replace(
      /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/giu,
      "[redacted authorization]",
    )
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_SUMMARY_CHARS);
}

export function sanitizeEvidenceUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value
      .replace(/[?#].*$/u, "")
      .trim()
      .slice(0, MAX_SUMMARY_CHARS);
  }
}

function frameId(page: Page, request: Request): string {
  const frame = request.frame();
  if (frame === page.mainFrame()) return "main";
  const ordinal = page.frames().indexOf(frame);
  return ordinal < 0 ? "frame:unknown" : `frame:${ordinal}`;
}

export class BrowserEvidenceRecorder {
  private readonly snapshots = new Map<string, BrowserEvidenceSnapshot>();
  private readonly requests = new WeakMap<Request, RequestContext>();
  private readonly agentActions = new Set<Page>();
  private readonly pendingProvenance = new Map<Page, PendingProvenance>();
  private readonly emittedCounts = new Map<string, number>();

  constructor(private readonly onEvidence?: EvidenceListener) {}

  observe(page: Page, pageId: string): void {
    this.snapshots.set(pageId, { navigations: [], errors: [] });
    this.emittedCounts.set(pageId, 0);

    page.on("request", (request) => this.onRequest(page, request));
    page.on("response", (response) => this.onResponse(page, pageId, response));
    page.on("requestfailed", (request) =>
      this.onRequestFailure(page, pageId, request),
    );
    page.on("pageerror", (error) => {
      this.recordError(pageId, {
        timestamp: new Date().toISOString(),
        pageId,
        kind: "page_error",
        severity: "error",
        summary: sanitizeEvidenceText(error.message),
        url: sanitizeEvidenceUrl(page.url()),
      });
    });
    page.on("console", (message) => this.onConsole(page, pageId, message));
  }

  forget(pageId: string): void {
    this.snapshots.delete(pageId);
    this.emittedCounts.delete(pageId);
  }

  markHumanNavigation(page: Page): void {
    if (this.agentActions.has(page)) return;
    this.pendingProvenance.set(page, {
      provenance: "human",
      expiresAt: Date.now() + HUMAN_PROVENANCE_WINDOW_MS,
    });
  }

  async withAgentAction<T>(page: Page, action: () => Promise<T>): Promise<T> {
    this.agentActions.add(page);
    try {
      return await action();
    } finally {
      this.agentActions.delete(page);
    }
  }

  snapshot(pageId: string): BrowserEvidenceSnapshot {
    const snapshot = this.snapshots.get(pageId);
    if (snapshot === undefined) return { navigations: [], errors: [] };
    return {
      navigations: snapshot.navigations.map((item) => ({ ...item })),
      errors: snapshot.errors.map((item) => ({ ...item })),
      ...(snapshot.latestMainDocumentStatus === undefined
        ? {}
        : { latestMainDocumentStatus: snapshot.latestMainDocumentStatus }),
    };
  }

  latestMainDocumentStatus(pageId: string): number | undefined {
    return this.snapshots.get(pageId)?.latestMainDocumentStatus;
  }

  private onRequest(page: Page, request: Request): void {
    if (!request.isNavigationRequest()) return;

    const redirectedFrom = request.redirectedFrom();
    const previous =
      redirectedFrom === null ? undefined : this.requests.get(redirectedFrom);
    const pending = this.pendingProvenance.get(page);
    const pendingIsCurrent =
      pending !== undefined && pending.expiresAt >= Date.now();
    const provenance =
      previous?.provenance ??
      (this.agentActions.has(page)
        ? "agent"
        : pendingIsCurrent
          ? pending.provenance
          : "browser");

    if (redirectedFrom === null && pendingIsCurrent) {
      this.pendingProvenance.delete(page);
    }

    this.requests.set(request, {
      navigationId:
        previous?.navigationId ?? `nav_${randomUUID().replaceAll("-", "")}`,
      sourceUrl:
        previous === undefined
          ? sanitizeEvidenceUrl(page.url())
          : sanitizeEvidenceUrl(redirectedFrom!.url()),
      redirectIndex: (previous?.redirectIndex ?? -1) + 1,
      provenance,
    });
  }

  private onResponse(page: Page, pageId: string, response: Response): void {
    const request = response.request();
    if (
      request.resourceType() !== "document" ||
      request.frame() !== page.mainFrame()
    )
      return;

    const context = this.requests.get(request) ?? {
      navigationId: `nav_${randomUUID().replaceAll("-", "")}`,
      sourceUrl: sanitizeEvidenceUrl(page.url()),
      redirectIndex: 0,
      provenance: "unknown" as const,
    };

    const item: BrowserNavigationEvidence = {
      timestamp: new Date().toISOString(),
      pageId,
      frameId: "main",
      mainFrame: true,
      navigationId: context.navigationId,
      sourceUrl: context.sourceUrl,
      destinationUrl: sanitizeEvidenceUrl(response.url()),
      status: response.status(),
      redirectIndex: context.redirectIndex,
      ...(request.redirectedFrom() === null
        ? {}
        : {
            redirectedFromUrl: sanitizeEvidenceUrl(
              request.redirectedFrom()!.url(),
            ),
          }),
      provenance: context.provenance,
    };

    const snapshot = this.requireSnapshot(pageId);
    snapshot.latestMainDocumentStatus = response.status();
    boundedPush(snapshot.navigations, item, MAX_NAVIGATIONS_PER_PAGE);
    this.emitEvidence(pageId, item);
  }

  private onRequestFailure(page: Page, pageId: string, request: Request): void {
    const failureReason = sanitizeEvidenceText(
      request.failure()?.errorText ??
        "Request failed without a browser reason.",
    );
    const mainFrame =
      request.resourceType() === "document" &&
      request.frame() === page.mainFrame();
    const context = this.requests.get(request);

    if (mainFrame) {
      const item: BrowserNavigationEvidence = {
        timestamp: new Date().toISOString(),
        pageId,
        frameId: "main",
        mainFrame: true,
        navigationId:
          context?.navigationId ?? `nav_${randomUUID().replaceAll("-", "")}`,
        sourceUrl: context?.sourceUrl ?? sanitizeEvidenceUrl(page.url()),
        destinationUrl: sanitizeEvidenceUrl(request.url()),
        redirectIndex: context?.redirectIndex ?? 0,
        ...(request.redirectedFrom() === null
          ? {}
          : {
              redirectedFromUrl: sanitizeEvidenceUrl(
                request.redirectedFrom()!.url(),
              ),
            }),
        failureReason,
        provenance: context?.provenance ?? "unknown",
      };
      boundedPush(
        this.requireSnapshot(pageId).navigations,
        item,
        MAX_NAVIGATIONS_PER_PAGE,
      );
      this.emitEvidence(pageId, item);
    }

    this.recordError(pageId, {
      timestamp: new Date().toISOString(),
      pageId,
      kind: "request_failure",
      severity: "error",
      summary: failureReason,
      url: sanitizeEvidenceUrl(request.url()),
      resourceType: request.resourceType(),
      frameId: frameId(page, request),
      mainFrame,
    });
  }

  private onConsole(page: Page, pageId: string, message: ConsoleMessage): void {
    const severity = message.type();
    if (severity !== "error" && severity !== "warning") return;
    this.recordError(pageId, {
      timestamp: new Date().toISOString(),
      pageId,
      kind: "console",
      severity,
      summary: sanitizeEvidenceText(message.text()),
      url: sanitizeEvidenceUrl(message.location().url || page.url()),
    });
  }

  private recordError(pageId: string, item: BrowserErrorEvidence): void {
    boundedPush(this.requireSnapshot(pageId).errors, item, MAX_ERRORS_PER_PAGE);
    this.emitEvidence(pageId, item);
  }

  private emitEvidence(pageId: string, item: EvidenceItem): void {
    const count = this.emittedCounts.get(pageId) ?? 0;
    if (count >= MAX_PERSISTED_ITEMS_PER_PAGE) return;
    this.emittedCounts.set(pageId, count + 1);
    this.onEvidence?.(pageId, item);
  }

  private requireSnapshot(pageId: string): BrowserEvidenceSnapshot {
    let snapshot = this.snapshots.get(pageId);
    if (snapshot === undefined) {
      snapshot = { navigations: [], errors: [] };
      this.snapshots.set(pageId, snapshot);
    }
    return snapshot;
  }
}
