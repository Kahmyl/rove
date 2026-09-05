import { describe, expect, it } from "vitest";

import {
  CompactFollowerSurface,
  type CompactFollowerWindowHandle,
} from "./compact-follower-surface.js";

class FakeFollowerWindow implements CompactFollowerWindowHandle {
  destroyed = false;
  focused = false;
  visible = false;

  setBoundsCalls: {
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    animate: boolean | undefined;
  }[] = [];

  showInactiveCount = 0;
  hideCount = 0;
  alwaysOnTopCalls: { flag: boolean; level?: "floating" }[] = [];
  workspaceCalls: {
    visible: boolean;
    options?: {
      visibleOnFullScreen?: boolean;
      skipTransformProcessType?: boolean;
    };
  }[] = [];

  private closedListener: (() => void) | undefined;

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isFocused(): boolean {
    return this.focused;
  }

  isVisible(): boolean {
    return this.visible;
  }

  setBounds(
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    },
    animate?: boolean,
  ): void {
    this.setBoundsCalls.push({
      bounds,
      animate,
    });
  }

  setAlwaysOnTop(flag: boolean, level?: "floating"): void {
    this.alwaysOnTopCalls.push({
      flag,
      ...(level === undefined ? {} : { level }),
    });
  }

  setVisibleOnAllWorkspaces(
    visible: boolean,
    options?: {
      visibleOnFullScreen?: boolean;
      skipTransformProcessType?: boolean;
    },
  ): void {
    this.workspaceCalls.push({
      visible,
      ...(options === undefined ? {} : { options }),
    });
  }

  showInactive(): void {
    this.visible = true;
    this.showInactiveCount += 1;
  }

  hide(): void {
    this.visible = false;
    this.hideCount += 1;
  }

  once(event: "closed", listener: () => void): void {
    if (event === "closed") {
      this.closedListener = listener;
    }
  }

  emitClosed(): void {
    this.destroyed = true;

    this.closedListener?.();
  }
}

function surface(window: FakeFollowerWindow, enabled = false) {
  return new CompactFollowerSurface(() => window, {
    width: 240,
    height: 96,
    expandedWidth: 360,
    expandedHeight: 240,
    fullscreenMicroWidth: 64,
    fullscreenMicroHeight: 56,
    enabled,
    platform: "darwin",
  });
}

describe("CompactFollowerSurface", () => {
  it("starts fail-closed and does not create a window merely to hide it", () => {
    let created = 0;

    const follower = new CompactFollowerSurface(
      () => {
        created += 1;

        return new FakeFollowerWindow();
      },
      {
        width: 240,
        height: 96,
        expandedWidth: 360,
        expandedHeight: 240,
        fullscreenMicroWidth: 64,
        fullscreenMicroHeight: 56,
      },
    );

    expect(follower.isFollowEnabled()).toBe(false);

    follower.hideFollower();

    expect(created).toBe(0);
  });

  it("applies exact geometry and shows inactive without a focus operation", () => {
    const window = new FakeFollowerWindow();

    const follower = surface(window, true);

    follower.showInactiveAt({
      x: 910,
      y: 100,
      width: 240,
      height: 96,
    });

    expect(window.setBoundsCalls).toEqual([
      {
        bounds: {
          x: 910,
          y: 100,
          width: 240,
          height: 96,
        },
        animate: false,
      },
    ]);

    expect(window.showInactiveCount).toBe(1);

    expect(window.focused).toBe(false);
  });

  it("moves an already-visible follower without repeatedly showing it", () => {
    const window = new FakeFollowerWindow();

    const follower = surface(window, true);

    follower.showInactiveAt({
      x: 910,
      y: 100,
      width: 240,
      height: 96,
    });

    follower.showInactiveAt({
      x: 930,
      y: 120,
      width: 240,
      height: 96,
    });

    expect(window.setBoundsCalls).toHaveLength(2);

    expect(window.showInactiveCount).toBe(1);
  });

  it("uses a presentation-scoped floating lift only for overlay placement", () => {
    const window = new FakeFollowerWindow();
    const follower = surface(window, true);

    follower.showInactiveAt(
      { x: 1190, y: 43, width: 240, height: 96 },
      "overlay_top_right",
    );

    expect(window.alwaysOnTopCalls).toEqual([
      { flag: true, level: "floating" },
      { flag: false },
    ]);

    follower.showInactiveAt(
      { x: 910, y: 100, width: 240, height: 96 },
      "right",
    );

    expect(window.alwaysOnTopCalls.at(-1)).toEqual({ flag: false });
  });

  it("reports focus only from its own live native follower window", () => {
    const window = new FakeFollowerWindow();

    const follower = surface(window, true);

    expect(follower.isFocused()).toBe(false);

    follower.showInactiveAt({
      x: 910,
      y: 100,
      width: 240,
      height: 96,
    });

    window.focused = true;

    expect(follower.isFocused()).toBe(true);

    window.emitClosed();

    expect(follower.isFocused()).toBe(false);
  });

  it("reports visibility only from its own live managed follower window", () => {
    const window = new FakeFollowerWindow();

    const follower = surface(window, true);

    expect(follower.isVisible()).toBe(false);

    follower.showInactiveAt({
      x: 910,
      y: 100,
      width: 240,
      height: 96,
    });

    expect(follower.isVisible()).toBe(true);

    follower.hideFollower();

    expect(follower.isVisible()).toBe(false);

    follower.showInactiveAt({
      x: 910,
      y: 100,
      width: 240,
      height: 96,
    });

    window.emitClosed();

    expect(follower.isVisible()).toBe(false);
  });

  it("disabling follow hides a visible follower and does not auto-show on re-enable", () => {
    const window = new FakeFollowerWindow();

    const follower = surface(window, true);

    follower.showInactiveAt({
      x: 910,
      y: 100,
      width: 240,
      height: 96,
    });

    follower.setFollowEnabled(false);

    expect(window.hideCount).toBe(1);

    follower.setFollowEnabled(true);

    expect(window.showInactiveCount).toBe(1);
  });

  it("fails closed rather than applying invalid geometry to an already-managed follower", () => {
    const window = new FakeFollowerWindow();

    const follower = surface(window, true);

    follower.showInactiveAt({
      x: 910,
      y: 100,
      width: 240,
      height: 96,
    });

    expect(window.setBoundsCalls).toHaveLength(1);

    follower.showInactiveAt({
      x: 100,
      y: 100,
      width: 300,
      height: 120,
    });

    expect(window.setBoundsCalls).toHaveLength(1);

    expect(window.hideCount).toBe(1);

    expect(window.visible).toBe(false);
  });

  it("keeps focus while semantic expansion awaits a fresh controller decision", () => {
    const window = new FakeFollowerWindow();

    const follower = surface(window, true);

    follower.showInactiveAt({
      x: 910,
      y: 100,
      width: 240,
      height: 96,
    });

    expect(follower.followPresentation("normal")).toEqual({
      mode: "windowed_compact",
      size: { width: 240, height: 96 },
    });

    follower.setExpanded(true);

    expect(follower.followPresentation("normal")).toEqual({
      mode: "windowed_expanded",
      size: { width: 360, height: 240 },
    });

    expect(window.hideCount).toBe(0);
    expect(window.visible).toBe(true);
    expect(window.setBoundsCalls).toHaveLength(1);

    follower.showInactiveAt(
      {
        x: 900,
        y: 100,
        width: 360,
        height: 240,
      },
      "right",
      "windowed_expanded",
    );

    expect(window.setBoundsCalls).toHaveLength(2);

    expect(window.setBoundsCalls[1]).toMatchObject({
      bounds: {
        x: 900,
        y: 100,
        width: 360,
        height: 240,
      },
    });

    expect(window.showInactiveCount).toBe(1);
  });

  it("uses fullscreen micro and expanded sizes from semantic state", () => {
    const follower = surface(new FakeFollowerWindow(), true);

    expect(follower.followPresentation("fullscreen")).toEqual({
      mode: "fullscreen_micro",
      size: { width: 64, height: 56 },
    });

    follower.setExpanded(true);

    expect(follower.followPresentation("fullscreen")).toEqual({
      mode: "fullscreen_expanded",
      size: { width: 360, height: 240 },
      fallback: {
        mode: "fullscreen_micro",
        size: { width: 64, height: 56 },
      },
    });

    expect(follower.followPresentation("normal")).toEqual({
      mode: "windowed_expanded",
      size: { width: 360, height: 240 },
    });

    follower.setExpanded(false);

    expect(follower.followPresentation("normal")).toEqual({
      mode: "windowed_compact",
      size: { width: 240, height: 96 },
    });
  });

  it("returns an expanded fullscreen surface to normal compact sizing", () => {
    const follower = surface(new FakeFollowerWindow(), true);

    follower.followPresentation("fullscreen");
    follower.setExpanded(true);
    follower.showInactiveAt(
      { x: 1070, y: 650, width: 360, height: 240 },
      "fullscreen_bottom_right",
      "fullscreen_expanded",
    );

    expect(follower.followPresentation("normal")).toEqual({
      mode: "windowed_compact",
      size: { width: 240, height: 96 },
    });
  });

  it("preserves follower focus while expanding in fullscreen", () => {
    const window = new FakeFollowerWindow();
    const follower = surface(window, true);

    follower.showInactiveAt(
      { x: 1366, y: 834, width: 64, height: 56 },
      "fullscreen_bottom_right",
      "fullscreen_micro",
    );
    window.focused = true;

    follower.setExpanded(true);

    expect(follower.isFocused()).toBe(true);
    expect(window.visible).toBe(true);
    expect(window.hideCount).toBe(0);

    follower.showInactiveAt(
      { x: 1070, y: 650, width: 360, height: 240 },
      "fullscreen_bottom_right",
      "fullscreen_expanded",
    );

    expect(window.workspaceCalls).toHaveLength(1);
    expect(window.alwaysOnTopCalls.at(-1)).toEqual({
      flag: true,
      level: "floating",
    });
  });

  it("scopes fullscreen workspace and topmost presentation to fullscreen", () => {
    const window = new FakeFollowerWindow();
    window.visible = true;
    const follower = surface(window, true);

    follower.showInactiveAt(
      { x: 1366, y: 834, width: 64, height: 56 },
      "fullscreen_bottom_right",
      "fullscreen_micro",
    );

    expect(window.workspaceCalls).toEqual([
      {
        visible: true,
        options: {
          visibleOnFullScreen: true,
          skipTransformProcessType: true,
        },
      },
    ]);
    expect(window.showInactiveCount).toBe(1);
    expect(window.alwaysOnTopCalls.at(-1)).toEqual({
      flag: true,
      level: "floating",
    });

    follower.showInactiveAt(
      { x: 910, y: 100, width: 240, height: 96 },
      "right",
      "windowed_compact",
    );

    expect(window.workspaceCalls.at(-1)).toEqual({ visible: false });
    expect(window.alwaysOnTopCalls.at(-1)).toEqual({ flag: false });
  });

  it("revokes fullscreen presentation when hidden or disabled", () => {
    const window = new FakeFollowerWindow();
    const follower = surface(window, true);

    follower.showInactiveAt(
      { x: 1366, y: 834, width: 64, height: 56 },
      "fullscreen_bottom_right",
      "fullscreen_micro",
    );

    follower.setFollowEnabled(false);

    expect(window.workspaceCalls.at(-1)).toEqual({ visible: false });
    expect(window.alwaysOnTopCalls.at(-1)).toEqual({ flag: false });
    expect(window.visible).toBe(false);
  });
});
