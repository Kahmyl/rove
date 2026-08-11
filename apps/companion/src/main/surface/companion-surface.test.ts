import { describe, expect, it } from "vitest";

import {
  CompanionSurface,
  type CompanionWindowHandle,
  type PreventableCloseEvent,
} from "./companion-surface.js";

class FakeWindow implements CompanionWindowHandle {
  destroyed = false;
  minimized = false;

  showCount = 0;
  hideCount = 0;
  focusCount = 0;
  restoreCount = 0;
  reloadCount = 0;

  private closeListener: ((event: PreventableCloseEvent) => void) | undefined;

  private closedListener: (() => void) | undefined;

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  restore(): void {
    this.minimized = false;
    this.restoreCount += 1;
  }

  reload(): void {
    this.reloadCount += 1;
  }

  show(): void {
    this.showCount += 1;
  }

  hide(): void {
    this.hideCount += 1;
  }

  focus(): void {
    this.focusCount += 1;
  }

  on(event: "close", listener: (event: PreventableCloseEvent) => void): void {
    if (event === "close") {
      this.closeListener = listener;
    }
  }

  once(event: "closed", listener: () => void): void {
    if (event === "closed") {
      this.closedListener = listener;
    }
  }

  emitClose(): boolean {
    let prevented = false;

    this.closeListener?.({
      preventDefault: () => {
        prevented = true;
      },
    });

    return prevented;
  }

  emitClosed(): void {
    this.destroyed = true;
    this.closedListener?.();
  }
}

describe("CompanionSurface", () => {
  it("hides instead of closing during normal use", () => {
    const window = new FakeWindow();

    const surface = new CompanionSurface(
      () => window,
      () => false,
    );

    surface.show();

    expect(window.emitClose()).toBe(true);
    expect(window.hideCount).toBe(1);
    expect(window.destroyed).toBe(false);
  });

  it("allows the window to close during application shutdown", () => {
    const window = new FakeWindow();

    const surface = new CompanionSurface(
      () => window,
      () => true,
    );

    surface.show();

    expect(window.emitClose()).toBe(false);
    expect(window.hideCount).toBe(0);
  });

  it("restores and focuses a minimized Companion", () => {
    const window = new FakeWindow();

    window.minimized = true;

    const surface = new CompanionSurface(
      () => window,
      () => false,
    );

    surface.restore();

    expect(window.restoreCount).toBe(1);
    expect(window.showCount).toBe(1);
    expect(window.focusCount).toBe(1);
  });

  it("reloads the renderer without replacing the managed surface", () => {
    const window = new FakeWindow();

    const surface = new CompanionSurface(
      () => window,
      () => false,
    );

    surface.show();
    surface.recover();

    expect(window.reloadCount).toBe(1);
    expect(window.showCount).toBe(2);
    expect(window.focusCount).toBe(2);
  });
});
