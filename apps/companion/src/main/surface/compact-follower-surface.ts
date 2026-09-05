import type {
  BrowserFollowPlacement,
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
  setBounds(bounds: BrowserFollowRectangle, animate?: boolean): void;
  setAlwaysOnTop(flag: boolean, level?: "floating"): void;
  setVisibleOnAllWorkspaces(
    visible: boolean,
    options?: {
      visibleOnFullScreen?: boolean;
      skipTransformProcessType?: boolean;
    },
  ): void;
  showInactive(): void;
  hide(): void;
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

  private fullscreenPresentationActive = false;

  private readonly platform: NodeJS.Platform;

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

  showInactiveAt(
    bounds: BrowserFollowRectangle,
    placement: BrowserFollowPlacement = "right",
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

    this.currentPresentation = presentation;

    window.setBounds(bounds, false);

    const fullscreen = presentation.startsWith("fullscreen_");
    const overlay = placement === "overlay_top_right";
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

      window.setAlwaysOnTop(true, "floating");
      this.fullscreenPresentationActive = true;
    } else {
      this.revokeFullscreenPresentation(window);

      // A maximized cross-process Chrome window otherwise covers a regular
      // Electron window. Lift only for the presentation operation, then return
      // immediately to the normal level so Rove is not globally pinned.
      window.setAlwaysOnTop(overlay, overlay ? "floating" : undefined);
    }

    // macOS may briefly hide a window while changing its process/workspace
    // collection behavior even though isVisible() still reports true.
    if (workspaceTransition || !window.isVisible()) {
      window.showInactive();
    }

    if (overlay) {
      window.setAlwaysOnTop(false);
    }
  }

  hideFollower(): void {
    this.hideManagedWindow(true);
  }

  private hideManagedWindow(revokeFullscreen: boolean): void {
    const window = this.window;

    if (window === undefined) {
      return;
    }

    if (window.isDestroyed()) {
      this.fullscreenPresentationActive = false;
      this.fullscreenWorkspaceVisibility = false;
      return;
    }

    if (revokeFullscreen) {
      this.revokeFullscreenPresentation(window);
    }

    if (window.isVisible()) {
      window.hide();
    }
  }

  private revokeFullscreenPresentation(
    window: CompactFollowerWindowHandle,
  ): void {
    if (this.fullscreenPresentationActive) {
      window.setAlwaysOnTop(false);
      this.fullscreenPresentationActive = false;
    }

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

  private ensure(): CompactFollowerWindowHandle {
    if (this.window !== undefined && !this.window.isDestroyed()) {
      return this.window;
    }

    const window = this.createWindow();

    this.window = window;

    window.once("closed", () => {
      if (this.window === window) {
        this.window = undefined;
        this.fullscreenPresentationActive = false;
        this.fullscreenWorkspaceVisibility = false;
      }
    });

    return window;
  }
}
