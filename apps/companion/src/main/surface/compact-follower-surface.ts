import type {
  BrowserFollowPlacement,
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
  showInactive(): void;
  hide(): void;
  once(event: "closed", listener: () => void): void;
}

export type CompactFollowerWindowFactory = () => CompactFollowerWindowHandle;

export interface CompactFollowerSurfaceOptions {
  width: number;
  height: number;
  enabled?: boolean;
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

  private size: BrowserFollowSize;

  constructor(
    private readonly createWindow: CompactFollowerWindowFactory,
    options: CompactFollowerSurfaceOptions,
  ) {
    const size = {
      width: options.width,
      height: options.height,
    };

    if (!validSize(size)) {
      throw new Error("Compact follower size must be positive and finite.");
    }

    this.size = size;

    this.enabled = options.enabled ?? false;
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

  setFollowSize(size: BrowserFollowSize): void {
    if (!validSize(size)) {
      throw new Error("Compact follower size must be positive and finite.");
    }

    if (size.width === this.size.width && size.height === this.size.height) {
      return;
    }

    this.size = {
      ...size,
    };

    this.hideFollower();
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

  followSize(): BrowserFollowSize {
    return {
      ...this.size,
    };
  }

  showInactiveAt(
    bounds: BrowserFollowRectangle,
    placement: BrowserFollowPlacement = "right",
  ): void {
    if (!this.enabled) {
      this.hideFollower();

      return;
    }

    if (
      !validBounds(bounds) ||
      bounds.width !== this.size.width ||
      bounds.height !== this.size.height
    ) {
      this.hideFollower();

      return;
    }

    const window = this.ensure();

    window.setBounds(bounds, false);

    const overlay = placement === "overlay_top_right";

    // A maximized cross-process Chrome window otherwise covers a regular
    // Electron window. Lift only for the presentation operation, then return
    // immediately to the normal level so Rove is not globally pinned.
    window.setAlwaysOnTop(overlay, overlay ? "floating" : undefined);

    if (!window.isVisible()) {
      window.showInactive();
    }

    if (overlay) {
      window.setAlwaysOnTop(false);
    }
  }

  hideFollower(): void {
    const window = this.window;

    if (window === undefined || window.isDestroyed() || !window.isVisible()) {
      return;
    }

    window.hide();
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
      }
    });

    return window;
  }
}
