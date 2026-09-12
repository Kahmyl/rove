import { describe, expect, it } from "vitest";

import {
  CompanionSurface,
  type CompanionWindowHandle,
  type PreventableCloseEvent,
} from "./companion-surface.js";

class FakeWindow implements CompanionWindowHandle {
  destroyed = false;
  minimized = false;
  visible = false;

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

  isVisible(): boolean {
    return this.visible;
  }

  restore(): void {
    this.minimized = false;
    this.restoreCount += 1;
  }

  reload(): void {
    this.reloadCount += 1;
  }

  show(): void {
    this.visible = true;
    this.showCount += 1;
  }

  hide(): void {
    this.visible = false;
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
    this.visible = false;
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

  it("returns the logical surface after an intercepted full-window close", () => {
    const window = new FakeWindow();
    let returned = 0;
    const surface = new CompanionSurface(
      () => window,
      () => false,
      () => {
        returned += 1;
      },
    );

    surface.show();
    expect(window.emitClose()).toBe(true);

    expect(returned).toBe(1);
    expect(window.visible).toBe(false);
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

  it("reports native visibility without creating the Companion merely to inspect it", () => {
    const window = new FakeWindow();

    let created = 0;

    const surface = new CompanionSurface(
      () => {
        created += 1;

        return window;
      },
      () => false,
    );

    expect(surface.isVisible()).toBe(false);

    expect(created).toBe(0);

    surface.show();

    expect(surface.isVisible()).toBe(true);

    expect(created).toBe(1);

    surface.hide();

    expect(surface.isVisible()).toBe(false);

    surface.show();
    window.emitClosed();

    expect(surface.isVisible()).toBe(false);
  });
});
