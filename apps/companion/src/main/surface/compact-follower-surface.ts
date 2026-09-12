import type {
  BrowserFollowPlacement,
  BrowserFollowPosition,
  BrowserFollowPresentation,
  BrowserFollowPresentationMode,
  BrowserFollowRectangle,
  BrowserFollowSize,
  BrowserFollowSurface,
} from "./browser-follow-controller.js";

export interface CompactFollowerWindowHandle {
  isDestroyed(): boolean;
  isFocused(): boolean;
  isVisible(): boolean;
  getBounds(): BrowserFollowRectangle;
  setBounds(bounds: BrowserFollowRectangle, animate?: boolean): void;
  setAlwaysOnTop(flag: boolean, level?: "floating" | "screen-saver"): void;
  setVisibleOnAllWorkspaces(
    visible: boolean,
    options?: {
      visibleOnFullScreen?: boolean;
      skipTransformProcessType?: boolean;
    },
  ): void;
  showInactive(): void;
  hide(): void;
  on(event: "move", listener: () => void): void;
  once(event: "closed", listener: () => void): void;
}

export type CompactFollowerWindowFactory = () => CompactFollowerWindowHandle;

export interface CompactFollowerSurfaceOptions {
  width: number;
  height: number;
  expandedWidth: number;
  expandedHeight: number;
  fullscreenMicroWidth: number;
  fullscreenMicroHeight: number;
  enabled?: boolean;
  platform?: NodeJS.Platform;
}

function validDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validSize(size: BrowserFollowSize): boolean {
  return validDimension(size.width) && validDimension(size.height);
}

function validBounds(bounds: BrowserFollowRectangle): boolean {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    validDimension(bounds.width) &&
    validDimension(bounds.height)
  );
}

function validPosition(position: BrowserFollowPosition): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y);
}

function constrainToRegions(
  bounds: BrowserFollowRectangle,
  regions: readonly BrowserFollowRectangle[],
): BrowserFollowRectangle | null {
  const candidates = regions
    .filter(
      (region) =>
        validBounds(region) &&
        region.width >= bounds.width &&
        region.height >= bounds.height,
    )
    .map((region) => {
      const x = Math.min(
        Math.max(bounds.x, region.x),
        region.x + region.width - bounds.width,
      );
      const y = Math.min(
        Math.max(bounds.y, region.y),
        region.y + region.height - bounds.height,
      );

      return {
        bounds: { ...bounds, x, y },
        distance: (x - bounds.x) ** 2 + (y - bounds.y) ** 2,
      };
    })
    .sort((left, right) => left.distance - right.distance);

  return candidates[0]?.bounds ?? null;
}

export class CompactFollowerSurface implements BrowserFollowSurface {
  private window: CompactFollowerWindowHandle | undefined;

  private enabled: boolean;

  private readonly compactSize: BrowserFollowSize;

  private readonly expandedSize: BrowserFollowSize;

  private readonly fullscreenMicroSize: BrowserFollowSize;

  private expanded = false;

  private currentPresentation: BrowserFollowPresentationMode =
    "windowed_compact";

  private fullscreenWorkspaceVisibility = false;

  private elevatedPresentationActive = false;

  private windowedUserPosition: BrowserFollowPosition | null = null;

  private fullscreenUserPosition: BrowserFollowPosition | null = null;

  private lastAppliedBounds: BrowserFollowRectangle | null = null;

  private readonly platform: NodeJS.Platform;

  private dragState:
    | {
        origin: BrowserFollowPosition;
        bounds: BrowserFollowRectangle;
        regions: BrowserFollowRectangle[];
        pendingBounds: BrowserFollowRectangle | null;
      }
    | undefined;

  constructor(
    private readonly createWindow: CompactFollowerWindowFactory,
    options: CompactFollowerSurfaceOptions,
  ) {
    const compactSize = {
      width: options.width,
      height: options.height,
    };

    const expandedSize = {
      width: options.expandedWidth,
      height: options.expandedHeight,
    };

    const fullscreenMicroSize = {
      width: options.fullscreenMicroWidth,
      height: options.fullscreenMicroHeight,
    };

    if (
      !validSize(compactSize) ||
      !validSize(expandedSize) ||
      !validSize(fullscreenMicroSize)
    ) {
      throw new Error("Follower sizes must be positive and finite.");
    }

    this.compactSize = compactSize;
    this.expandedSize = expandedSize;
    this.fullscreenMicroSize = fullscreenMicroSize;

    this.enabled = options.enabled ?? false;
    this.platform = options.platform ?? process.platform;
  }

  setFollowEnabled(enabled: boolean): void {
    if (enabled === this.enabled) {
      return;
    }

    this.enabled = enabled;

    if (!enabled) {
      this.hideFollower();
    }
  }

  setExpanded(expanded: boolean): void {
    if (expanded === this.expanded) {
      return;
    }

    const activeUserPosition = this.currentPresentation.startsWith(
      "fullscreen_",
    )
      ? this.fullscreenUserPosition
      : this.windowedUserPosition;

    if (activeUserPosition !== null && this.lastAppliedBounds !== null) {
      const previousSize = this.sizeForPresentation(this.currentPresentation);
      const nextSize = expanded
        ? this.expandedSize
        : this.microSizeForCurrent();
      activeUserPosition.x += previousSize.width - nextSize.width;
    }

    this.expanded = expanded;

    const fullscreen = this.currentPresentation.startsWith("fullscreen_");

    this.currentPresentation = fullscreen
      ? expanded
        ? "fullscreen_expanded"
        : "fullscreen_micro"
      : expanded
        ? "windowed_expanded"
        : "windowed_compact";

    // Keep the focused affordance alive while the controller obtains a fresh
    // authoritative browser/display decision for the new semantic size.
  }

  isFollowEnabled(): boolean {
    return this.enabled;
  }

  isFocused(): boolean {
    const window = this.window;

    return window !== undefined && !window.isDestroyed() && window.isFocused();
  }

  isVisible(): boolean {
    const window = this.window;

    return window !== undefined && !window.isDestroyed() && window.isVisible();
  }

  preferredPosition(
    windowState: "normal" | "minimized" | "maximized" | "fullscreen" | null,
  ): BrowserFollowPosition | null {
    const position =
      windowState === "fullscreen"
        ? this.fullscreenUserPosition
        : this.windowedUserPosition;

    return position === null ? null : { ...position };
  }

  resetUserPlacement(): void {
    this.endDrag();
    this.expanded = false;
    this.currentPresentation = "windowed_compact";
    this.windowedUserPosition = null;
    this.fullscreenUserPosition = null;
    this.lastAppliedBounds = null;
  }

  followPresentation(
    windowState: "normal" | "minimized" | "maximized" | "fullscreen" | null,
  ): BrowserFollowPresentation {
    const fullscreen = windowState === "fullscreen";

    if (!fullscreen && this.currentPresentation.startsWith("fullscreen_")) {
      this.expanded = false;
    }

    const mode: BrowserFollowPresentationMode = fullscreen
      ? this.expanded
        ? "fullscreen_expanded"
        : "fullscreen_micro"
      : this.expanded
        ? "windowed_expanded"
        : "windowed_compact";

    const size = fullscreen
      ? this.expanded
        ? this.expandedSize
        : this.fullscreenMicroSize
      : this.expanded
        ? this.expandedSize
        : this.compactSize;

    return {
      mode,
      size: { ...size },
      ...(mode === "fullscreen_expanded"
        ? {
            fallback: {
              mode: "fullscreen_micro" as const,
              size: { ...this.fullscreenMicroSize },
            },
          }
        : {}),
    };
  }

  presentationMode(): BrowserFollowPresentationMode {
    return this.currentPresentation;
  }

  beginDrag(
    cursor: BrowserFollowPosition,
    regions: readonly BrowserFollowRectangle[],
  ): void {
    const window = this.window;

    if (
      !validPosition(cursor) ||
      window === undefined ||
      window.isDestroyed() ||
      !window.isVisible()
    ) {
      this.dragState = undefined;
      return;
    }

    const bounds = window.getBounds();
    const legalRegions = regions.filter(validBounds).map((region) => ({
      ...region,
    }));

    if (legalRegions.length === 0 || !validBounds(bounds)) {
      this.dragState = undefined;
      return;
    }

    this.dragState = {
      origin: { ...cursor },
      bounds,
      regions: legalRegions,
      pendingBounds: null,
    };
  }

  updateDrag(cursor: BrowserFollowPosition): void {
    const window = this.window;
    const drag = this.dragState;

    if (
      drag === undefined ||
      !validPosition(cursor) ||
      window === undefined ||
      window.isDestroyed() ||
      !window.isVisible()
    ) {
      return;
    }

    const next = constrainToRegions(
      {
        ...drag.bounds,
        x: drag.bounds.x + cursor.x - drag.origin.x,
        y: drag.bounds.y + cursor.y - drag.origin.y,
      },
      drag.regions,
    );

    if (next === null) return;

    if (this.platform === "linux") {
      drag.pendingBounds = next;
      return;
    }

    this.applyDraggedBounds(window, next);
  }

  endDrag(): void {
    const pending = this.dragState?.pendingBounds;
    this.dragState = undefined;

    const window = this.window;
    if (
      this.platform === "linux" &&
      pending !== null &&
      pending !== undefined &&
      window !== undefined &&
      !window.isDestroyed() &&
      window.isVisible()
    ) {
      // Apply the validated final bounds while hidden, then remap the
      // non-focus-taking X11 dock once at the scoped eligible level.
      window.hide();
      this.applyDraggedBounds(window, pending);
      window.setAlwaysOnTop(true, "floating");
      this.elevatedPresentationActive = true;
      window.showInactive();
      window.setAlwaysOnTop(true, "floating");
    }
  }

  private applyDraggedBounds(
    window: CompactFollowerWindowHandle,
    bounds: BrowserFollowRectangle,
  ): void {
    this.lastAppliedBounds = { ...bounds };
    window.setBounds(bounds, false);
    const position = { x: bounds.x, y: bounds.y };
    if (this.currentPresentation.startsWith("fullscreen_")) {
      this.fullscreenUserPosition = position;
    } else {
      this.windowedUserPosition = position;
    }
  }

  showInactiveAt(
    bounds: BrowserFollowRectangle,
    _placement: BrowserFollowPlacement = "browser_top_right",
    presentation: BrowserFollowPresentationMode = "windowed_compact",
  ): void {
    if (!this.enabled) {
      this.hideFollower();

      return;
    }

    const expected = this.sizeForPresentation(presentation);
    const presentationExpanded = presentation.endsWith("_expanded");
    const constrainedFullscreenFallback =
      this.expanded && presentation === "fullscreen_micro";

    if (
      !validBounds(bounds) ||
      (presentationExpanded !== this.expanded &&
        !constrainedFullscreenFallback) ||
      bounds.width !== expected.width ||
      bounds.height !== expected.height
    ) {
      this.hideFollower();

      return;
    }

    const window = this.ensure();

    const previousPresentation = this.currentPresentation;

    this.currentPresentation = presentation;

    this.lastAppliedBounds = { ...bounds };

    window.setBounds(bounds, false);

    const fullscreen = presentation.startsWith("fullscreen_");
    let workspaceTransition = false;

    if (fullscreen) {
      if (this.platform === "darwin" && !this.fullscreenWorkspaceVisibility) {
        window.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
          // Rove is a regular multi-window app. Transforming the whole process
          // briefly hides its windows; only this follower needs the collection
          // behavior that can join the owned browser's fullscreen Space.
          skipTransformProcessType: true,
        });

        this.fullscreenWorkspaceVisibility = true;
        workspaceTransition = true;
      }
    } else {
      this.revokeFullscreenWorkspaceVisibility(window);
    }

    // The follower now lives inside the browser bounds in every window state.
    // Elevation is therefore scoped to its eligible presentation lifetime;
    // foreground arbitration hides it and revokes this level immediately when
    // the exact owned browser is no longer the user's active context.
    const enteringFullscreen =
      fullscreen && !previousPresentation.startsWith("fullscreen_");

    if (!this.elevatedPresentationActive || enteringFullscreen) {
      window.setAlwaysOnTop(
        true,
        fullscreen && this.platform === "win32" ? "screen-saver" : "floating",
      );
      this.elevatedPresentationActive = true;
    }

    // macOS may briefly hide a window while changing its process/workspace
    // collection behavior even though isVisible() still reports true.
    if (workspaceTransition || !window.isVisible()) {
      window.showInactive();
    }

    // X11 applies the dock window's final stacking after it maps.
    // Reassert only while the exact owned-browser context is eligible; hide
    // revokes this level before the follower can appear in another context.
    if (this.platform === "linux") {
      window.setAlwaysOnTop(true, "floating");
    }
  }

  hideFollower(): void {
    this.hideManagedWindow(true);
  }

  private hideManagedWindow(revokeFullscreen: boolean): void {
    this.endDrag();
    const window = this.window;

    if (window === undefined) {
      return;
    }

    if (window.isDestroyed()) {
      this.elevatedPresentationActive = false;
      this.fullscreenWorkspaceVisibility = false;
      this.lastAppliedBounds = null;
      return;
    }

    if (revokeFullscreen) {
      this.revokePresentation(window);
    }

    if (window.isVisible()) {
      window.hide();
    }
  }

  private revokePresentation(window: CompactFollowerWindowHandle): void {
    if (this.elevatedPresentationActive) {
      window.setAlwaysOnTop(false);
      this.elevatedPresentationActive = false;
    }

    this.revokeFullscreenWorkspaceVisibility(window);
  }

  private revokeFullscreenWorkspaceVisibility(
    window: CompactFollowerWindowHandle,
  ): void {
    if (this.platform === "darwin" && this.fullscreenWorkspaceVisibility) {
      window.setVisibleOnAllWorkspaces(false);
      this.fullscreenWorkspaceVisibility = false;
    }
  }

  private sizeForPresentation(
    presentation: BrowserFollowPresentationMode,
  ): BrowserFollowSize {
    if (presentation === "fullscreen_micro") {
      return this.fullscreenMicroSize;
    }

    if (
      presentation === "fullscreen_expanded" ||
      presentation === "windowed_expanded"
    ) {
      return this.expandedSize;
    }

    return this.compactSize;
  }

  private microSizeForCurrent(): BrowserFollowSize {
    return this.currentPresentation.startsWith("fullscreen_")
      ? this.fullscreenMicroSize
      : this.compactSize;
  }

  private ensure(): CompactFollowerWindowHandle {
    if (this.window !== undefined && !this.window.isDestroyed()) {
      return this.window;
    }

    const window = this.createWindow();

    this.window = window;

    // `move` is the portable event. Electron's `moved` event is limited to
    // macOS and Windows, so listening to it strands Linux/X11 placements when
    // the user expands or collapses the surface.
    window.on("move", () => {
      if (window.isDestroyed()) return;

      const bounds = window.getBounds();
      const expected = this.lastAppliedBounds;

      if (
        expected !== null &&
        bounds.x === expected.x &&
        bounds.y === expected.y &&
        bounds.width === expected.width &&
        bounds.height === expected.height
      ) {
        return;
      }

      const position = { x: bounds.x, y: bounds.y };

      if (this.currentPresentation.startsWith("fullscreen_")) {
        this.fullscreenUserPosition = position;
      } else {
        this.windowedUserPosition = position;
      }
    });

    window.once("closed", () => {
      if (this.window === window) {
        this.window = undefined;
        this.dragState = undefined;
        this.elevatedPresentationActive = false;
        this.fullscreenWorkspaceVisibility = false;
        this.lastAppliedBounds = null;
      }
    });

    return window;
  }
}
