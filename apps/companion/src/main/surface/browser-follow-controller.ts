import type { BrowserWindowState, Session } from "@rove/protocol";

export const DEFAULT_BROWSER_FOLLOW_INTERVAL_MS = 100;
export const DEFAULT_BROWSER_FOLLOW_FRESHNESS_MS = 500;
export const DEFAULT_BROWSER_FOLLOW_GAP = 10;

export interface BrowserFollowRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserFollowSize {
  width: number;
  height: number;
}

export interface BrowserFollowDisplay {
  id: number;
  bounds: BrowserFollowRectangle;
  workArea: BrowserFollowRectangle;
}

export interface BrowserFollowWindowStateSource {
  getBrowserWindowState(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<BrowserWindowState | null>;
}

export interface BrowserFollowDisplaySource {
  getAllDisplays(): readonly BrowserFollowDisplay[];
}

export interface BrowserFollowSurface {
  isFollowEnabled(): boolean;
  isFocused(): boolean;
  isVisible(): boolean;
  followPresentation(
    windowState: BrowserWindowState["windowState"] | null,
  ): BrowserFollowPresentation;
  showInactiveAt(
    bounds: BrowserFollowRectangle,
    placement: BrowserFollowPlacement,
    presentation: BrowserFollowPresentationMode,
  ): void;
  hideFollower(): void;
}

export type BrowserFollowPlacement =
  "right" | "left" | "overlay_top_right" | "fullscreen_bottom_right";

export type BrowserFollowPresentationMode =
  | "windowed_compact"
  | "windowed_expanded"
  | "fullscreen_micro"
  | "fullscreen_expanded";

export interface BrowserFollowPresentation {
  mode: BrowserFollowPresentationMode;
  size: BrowserFollowSize;
  fallback?: {
    mode: BrowserFollowPresentationMode;
    size: BrowserFollowSize;
  };
}

export type BrowserFollowHiddenReason =
  | "no_live_session"
  | "surface_disabled"
  | "invalid_surface_size"
  | "window_state_unavailable"
  | "window_minimized"
  | "browser_not_foreground"
  | "invalid_browser_bounds"
  | "browser_off_display"
  | "ambiguous_display"
  | "placement_unavailable"
  | "runtime_error"
  | "window_state_timeout"
  | "session_changed"
  | "stopped";

export type BrowserFollowDecision =
  | {
      kind: "hidden";
      reason: BrowserFollowHiddenReason;
    }
  | {
      kind: "visible";
      sessionId: string;
      browserWindowId: number;
      pageId: string;
      displayId: number;
      placement: BrowserFollowPlacement;
      presentation: BrowserFollowPresentationMode;
      bounds: BrowserFollowRectangle;
    };

export interface BrowserFollowDecisionInput {
  sessionId: string;
  state: BrowserWindowState | null;
  displays: readonly BrowserFollowDisplay[];
  surfaceEnabled: boolean;
  surfaceFocused: boolean;
  surfaceSize: BrowserFollowSize;
  presentation?: BrowserFollowPresentationMode;
  fallbackSurfaceSize?: BrowserFollowSize;
  fallbackPresentation?: BrowserFollowPresentationMode;
  gap?: number;
}

export interface BrowserFollowControllerOptions {
  intervalMs?: number;
  freshnessMs?: number;
  gap?: number;
}

interface DisplayIntersection {
  display: BrowserFollowDisplay;
  area: number;
}

function isLiveSession(session: Session | null): session is Session {
  return (
    session !== null &&
    (session.status === "active" ||
      session.status === "paused" ||
      session.status === "awaiting_human")
  );
}

function finiteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function validRectangle(rectangle: BrowserFollowRectangle): boolean {
  return (
    finiteNumber(rectangle.x) &&
    finiteNumber(rectangle.y) &&
    finiteNumber(rectangle.width) &&
    finiteNumber(rectangle.height) &&
    rectangle.width > 0 &&
    rectangle.height > 0
  );
}

function validSize(size: BrowserFollowSize): boolean {
  return (
    finiteNumber(size.width) &&
    finiteNumber(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

function right(rectangle: BrowserFollowRectangle): number {
  return rectangle.x + rectangle.width;
}

function bottom(rectangle: BrowserFollowRectangle): number {
  return rectangle.y + rectangle.height;
}

function intersection(
  left: BrowserFollowRectangle,
  rightRectangle: BrowserFollowRectangle,
): BrowserFollowRectangle | null {
  const x = Math.max(left.x, rightRectangle.x);

  const y = Math.max(left.y, rightRectangle.y);

  const intersectionRight = Math.min(right(left), right(rightRectangle));

  const intersectionBottom = Math.min(bottom(left), bottom(rightRectangle));

  const width = intersectionRight - x;

  const height = intersectionBottom - y;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x,
    y,
    width,
    height,
  };
}

function intersectionArea(
  left: BrowserFollowRectangle,
  rightRectangle: BrowserFollowRectangle,
): number {
  const overlap = intersection(left, rightRectangle);

  if (overlap === null) {
    return 0;
  }

  return overlap.width * overlap.height;
}

function fitsInside(
  outer: BrowserFollowRectangle,
  inner: BrowserFollowRectangle,
): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    right(inner) <= right(outer) &&
    bottom(inner) <= bottom(outer)
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function selectDisplay(
  browserBounds: BrowserFollowRectangle,
  displays: readonly BrowserFollowDisplay[],
):
  | {
      kind: "selected";
      display: BrowserFollowDisplay;
    }
  | {
      kind: "none";
    }
  | {
      kind: "ambiguous";
    } {
  const intersections: DisplayIntersection[] = displays
    .filter((display) => validRectangle(display.bounds))
    .map((display) => ({
      display,
      area: intersectionArea(browserBounds, display.bounds),
    }))
    .filter((candidate) => candidate.area > 0);

  if (intersections.length === 0) {
    return {
      kind: "none",
    };
  }

  const greatest = Math.max(
    ...intersections.map((candidate) => candidate.area),
  );

  const winners = intersections.filter(
    (candidate) => candidate.area === greatest,
  );

  if (winners.length !== 1) {
    return {
      kind: "ambiguous",
    };
  }

  return {
    kind: "selected",
    display: winners[0]!.display,
  };
}

function placeFollower(
  browserBounds: BrowserFollowRectangle,
  display: BrowserFollowDisplay,
  size: BrowserFollowSize,
  gap: number,
): {
  placement: BrowserFollowPlacement;
  bounds: BrowserFollowRectangle;
} | null {
  const workArea = display.workArea;

  if (!validRectangle(workArea)) {
    return null;
  }

  if (size.width > workArea.width || size.height > workArea.height) {
    return null;
  }

  const verticalMaximum = bottom(workArea) - size.height;

  const y = clamp(browserBounds.y, workArea.y, verticalMaximum);

  const rightPlacement: BrowserFollowRectangle = {
    x: right(browserBounds) + gap,
    y,
    width: size.width,
    height: size.height,
  };

  if (fitsInside(workArea, rightPlacement)) {
    return {
      placement: "right",
      bounds: rightPlacement,
    };
  }

  const leftPlacement: BrowserFollowRectangle = {
    x: browserBounds.x - gap - size.width,
    y,
    width: size.width,
    height: size.height,
  };

  if (fitsInside(workArea, leftPlacement)) {
    return {
      placement: "left",
      bounds: leftPlacement,
    };
  }

  const browserWorkArea = intersection(browserBounds, workArea);

  if (
    browserWorkArea === null ||
    browserWorkArea.width < size.width + gap * 2 ||
    browserWorkArea.height < size.height + gap * 2
  ) {
    return null;
  }

  const overlay: BrowserFollowRectangle = {
    x: right(browserWorkArea) - size.width - gap,
    y: browserWorkArea.y + gap,
    width: size.width,
    height: size.height,
  };

  if (!fitsInside(browserWorkArea, overlay) || !fitsInside(workArea, overlay)) {
    return null;
  }

  return {
    placement: "overlay_top_right",
    bounds: overlay,
  };
}

function placeFullscreenFollower(
  browserBounds: BrowserFollowRectangle,
  display: BrowserFollowDisplay,
  size: BrowserFollowSize,
  gap: number,
): {
  placement: BrowserFollowPlacement;
  bounds: BrowserFollowRectangle;
} | null {
  const browserDisplay = intersection(browserBounds, display.bounds);

  if (
    browserDisplay === null ||
    size.width + gap * 2 > browserDisplay.width ||
    size.height + gap * 2 > browserDisplay.height
  ) {
    return null;
  }

  const bounds = {
    x: right(browserDisplay) - size.width - gap,
    y: bottom(browserDisplay) - size.height - gap,
    width: size.width,
    height: size.height,
  };

  if (
    !fitsInside(browserDisplay, bounds) ||
    !fitsInside(display.bounds, bounds)
  ) {
    return null;
  }

  return {
    placement: "fullscreen_bottom_right",
    bounds,
  };
}

export function decideBrowserFollow(
  input: BrowserFollowDecisionInput,
): BrowserFollowDecision {
  if (!input.surfaceEnabled) {
    return {
      kind: "hidden",
      reason: "surface_disabled",
    };
  }

  if (!validSize(input.surfaceSize)) {
    return {
      kind: "hidden",
      reason: "invalid_surface_size",
    };
  }

  const state = input.state;

  if (state === null) {
    return {
      kind: "hidden",
      reason: "window_state_unavailable",
    };
  }

  if (state.windowState === "minimized") {
    return {
      kind: "hidden",
      reason: "window_minimized",
    };
  }

  if (!state.documentFocused && !input.surfaceFocused) {
    return {
      kind: "hidden",
      reason: "browser_not_foreground",
    };
  }

  const browserBounds: BrowserFollowRectangle = {
    x: state.bounds.left,
    y: state.bounds.top,
    width: state.bounds.width,
    height: state.bounds.height,
  };

  if (!validRectangle(browserBounds)) {
    return {
      kind: "hidden",
      reason: "invalid_browser_bounds",
    };
  }

  const selected = selectDisplay(browserBounds, input.displays);

  if (selected.kind === "none") {
    return {
      kind: "hidden",
      reason: "browser_off_display",
    };
  }

  if (selected.kind === "ambiguous") {
    return {
      kind: "hidden",
      reason: "ambiguous_display",
    };
  }

  let effectiveSize = input.surfaceSize;
  let effectivePresentation =
    input.presentation ??
    (state.windowState === "fullscreen"
      ? "fullscreen_micro"
      : "windowed_compact");

  let placement =
    state.windowState === "fullscreen"
      ? placeFullscreenFollower(
          browserBounds,
          selected.display,
          input.surfaceSize,
          input.gap ?? DEFAULT_BROWSER_FOLLOW_GAP,
        )
      : placeFollower(
          browserBounds,
          selected.display,
          input.surfaceSize,
          input.gap ?? DEFAULT_BROWSER_FOLLOW_GAP,
        );

  if (
    placement === null &&
    state.windowState === "fullscreen" &&
    input.fallbackSurfaceSize !== undefined &&
    input.fallbackPresentation !== undefined &&
    validSize(input.fallbackSurfaceSize)
  ) {
    effectiveSize = input.fallbackSurfaceSize;
    effectivePresentation = input.fallbackPresentation;
    placement = placeFullscreenFollower(
      browserBounds,
      selected.display,
      effectiveSize,
      input.gap ?? DEFAULT_BROWSER_FOLLOW_GAP,
    );
  }

  if (placement === null) {
    return {
      kind: "hidden",
      reason: "placement_unavailable",
    };
  }

  return {
    kind: "visible",
    sessionId: input.sessionId,
    browserWindowId: state.windowId,
    pageId: state.pageId,
    displayId: selected.display.id,
    placement: placement.placement,
    presentation: effectivePresentation,
    bounds: placement.bounds,
  };
}

const WINDOW_STATE_TIMEOUT = Symbol("browser_follow_window_state_timeout");

function effectKey(decision: BrowserFollowDecision): string {
  if (decision.kind === "hidden") {
    return "hidden";
  }

  const { bounds } = decision;

  return [
    "visible",
    decision.presentation,
    decision.placement,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
  ].join(":");
}

export class BrowserFollowController {
  private interval: ReturnType<typeof setInterval> | undefined;

  private sessionId: string | null = null;

  private generation = 0;
  private inFlight = false;
  private running = false;
  private lastEffectKey: string | undefined;
  private activeRequestAbort: AbortController | undefined;

  private readonly intervalMs: number;
  private readonly freshnessMs: number;
  private readonly gap: number;

  constructor(
    private readonly windowState: BrowserFollowWindowStateSource,
    private readonly displays: BrowserFollowDisplaySource,
    private readonly surface: BrowserFollowSurface,
    options: BrowserFollowControllerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_BROWSER_FOLLOW_INTERVAL_MS;

    this.freshnessMs =
      options.freshnessMs ?? DEFAULT_BROWSER_FOLLOW_FRESHNESS_MS;

    this.gap = options.gap ?? DEFAULT_BROWSER_FOLLOW_GAP;

    if (!Number.isInteger(this.intervalMs) || this.intervalMs <= 0) {
      throw new Error("Browser follow interval must be a positive integer.");
    }

    if (!Number.isInteger(this.freshnessMs) || this.freshnessMs <= 0) {
      throw new Error(
        "Browser follow freshness deadline must be a positive integer.",
      );
    }

    if (!Number.isFinite(this.gap) || this.gap < 0) {
      throw new Error("Browser follow gap must be a non-negative number.");
    }
  }

  setSession(session: Session | null): void {
    const nextSessionId = isLiveSession(session) ? session.id : null;

    if (nextSessionId === this.sessionId) {
      return;
    }

    const previousSessionId = this.sessionId;

    this.sessionId = nextSessionId;

    this.generation += 1;

    this.activeRequestAbort?.abort();

    this.apply({
      kind: "hidden",
      reason:
        nextSessionId === null
          ? "no_live_session"
          : previousSessionId === null
            ? "window_state_unavailable"
            : "session_changed",
    });

    if (nextSessionId !== null && this.running) {
      void this.reconcileNow();
    }
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;

    void this.reconcileNow();

    this.interval = setInterval(() => {
      void this.reconcileNow();
    }, this.intervalMs);

    this.interval.unref();
  }

  stop(): void {
    if (this.interval !== undefined) {
      clearInterval(this.interval);

      this.interval = undefined;
    }

    this.running = false;
    this.sessionId = null;
    this.generation += 1;

    this.activeRequestAbort?.abort();

    this.apply({
      kind: "hidden",
      reason: "stopped",
    });
  }

  async reconcileNow(): Promise<void> {
    const sessionId = this.sessionId;

    if (sessionId === null) {
      this.apply({
        kind: "hidden",
        reason: "no_live_session",
      });

      return;
    }

    if (this.inFlight) {
      return;
    }

    const generation = this.generation;

    const requestAbort = new AbortController();

    this.activeRequestAbort = requestAbort;

    this.inFlight = true;

    let freshnessTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const request = this.windowState.getBrowserWindowState(
        sessionId,
        requestAbort.signal,
      );

      const timeout = new Promise<typeof WINDOW_STATE_TIMEOUT>((resolve) => {
        freshnessTimer = setTimeout(() => {
          resolve(WINDOW_STATE_TIMEOUT);

          requestAbort.abort();
        }, this.freshnessMs);

        freshnessTimer.unref();
      });

      const result = await Promise.race([request, timeout]);

      if (generation !== this.generation || sessionId !== this.sessionId) {
        return;
      }

      if (result === WINDOW_STATE_TIMEOUT) {
        this.apply({
          kind: "hidden",
          reason: "window_state_timeout",
        });

        return;
      }

      const presentation = this.surface.followPresentation(
        result?.windowState ?? null,
      );

      const decision = decideBrowserFollow({
        sessionId,
        state: result,
        displays: this.displays.getAllDisplays(),
        surfaceEnabled: this.surface.isFollowEnabled(),
        surfaceFocused: this.surface.isFocused(),
        surfaceSize: presentation.size,
        presentation: presentation.mode,
        ...(presentation.fallback === undefined
          ? {}
          : {
              fallbackSurfaceSize: presentation.fallback.size,
              fallbackPresentation: presentation.fallback.mode,
            }),
        gap: this.gap,
      });

      this.apply(decision);
    } catch {
      if (generation === this.generation && sessionId === this.sessionId) {
        this.apply({
          kind: "hidden",
          reason: "runtime_error",
        });
      }
    } finally {
      if (freshnessTimer !== undefined) {
        clearTimeout(freshnessTimer);
      }

      if (this.activeRequestAbort === requestAbort) {
        this.activeRequestAbort = undefined;
      }

      this.inFlight = false;

      if (
        this.running &&
        this.sessionId !== null &&
        generation !== this.generation
      ) {
        void this.reconcileNow();
      }
    }
  }

  private apply(decision: BrowserFollowDecision): void {
    const key = effectKey(decision);

    const surfaceVisible = this.surface.isVisible();

    const effectAlreadyApplied =
      key === this.lastEffectKey &&
      (decision.kind === "hidden" ? !surfaceVisible : surfaceVisible);

    if (effectAlreadyApplied) {
      return;
    }

    this.lastEffectKey = key;

    if (decision.kind === "hidden") {
      this.surface.hideFollower();

      return;
    }

    this.surface.showInactiveAt(
      decision.bounds,
      decision.placement,
      decision.presentation,
    );
  }
}
