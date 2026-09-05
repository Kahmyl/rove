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
    enabled,
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

  it("changes follow size fail-closed so expanded placement requires a fresh controller decision", () => {
    const window = new FakeFollowerWindow();

    const follower = surface(window, true);

    follower.showInactiveAt({
      x: 910,
      y: 100,
      width: 240,
      height: 96,
    });

    expect(follower.followSize()).toEqual({
      width: 240,
      height: 96,
    });

    follower.setFollowSize({
      width: 320,
      height: 180,
    });

    expect(follower.followSize()).toEqual({
      width: 320,
      height: 180,
    });

    expect(window.hideCount).toBe(1);

    expect(window.visible).toBe(false);

    follower.showInactiveAt({
      x: 910,
      y: 100,
      width: 240,
      height: 96,
    });

    expect(window.setBoundsCalls).toHaveLength(1);

    follower.showInactiveAt({
      x: 900,
      y: 100,
      width: 320,
      height: 180,
    });

    expect(window.setBoundsCalls).toHaveLength(2);

    expect(window.setBoundsCalls[1]).toMatchObject({
      bounds: {
        x: 900,
        y: 100,
        width: 320,
        height: 180,
      },
    });

    expect(window.showInactiveCount).toBe(2);
  });
});
