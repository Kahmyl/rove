import type { BrowserWindowState, Session } from "@rove/protocol";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserFollowController,
  type BrowserFollowDisplay,
  type BrowserFollowRectangle,
  type BrowserFollowSurface,
  decideBrowserFollow,
} from "./browser-follow-controller.js";

const session: Session = {
  id: "ses_follow",
  mode: "agent",
  status: "active",
  controller: "agent",
  profile: {
    mode: "temporary",
  },
  createdAt: "2026-09-05T14:00:00.000Z",
  updatedAt: "2026-09-05T14:00:00.000Z",
};

const display: BrowserFollowDisplay = {
  id: 1,
  bounds: {
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
  },
  workArea: {
    x: 0,
    y: 0,
    width: 1440,
    height: 860,
  },
};

function windowState(
  overrides: Partial<BrowserWindowState> = {},
): BrowserWindowState {
  return {
    windowId: 123,
    pageId: "page_01",
    windowState: "normal",
    bounds: {
      left: 100,
      top: 100,
      width: 800,
      height: 600,
    },
    documentFocused: true,
    ...overrides,
  };
}

class FakeSurface implements BrowserFollowSurface {
  enabled = true;
  focused = false;
  visible = false;

  size = {
    width: 240,
    height: 96,
  };

  shown: BrowserFollowRectangle[] = [];

  hideCount = 0;

  isFollowEnabled(): boolean {
    return this.enabled;
  }

  isFocused(): boolean {
    return this.focused;
  }

  isVisible(): boolean {
    return this.visible;
  }

  followSize() {
    return this.size;
  }

  showInactiveAt(bounds: BrowserFollowRectangle): void {
    this.visible = true;

    this.shown.push(bounds);
  }

  hideFollower(): void {
    this.visible = false;
    this.hideCount += 1;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("decideBrowserFollow", () => {
  it("places beside the browser on the right when work area allows it", () => {
    expect(
      decideBrowserFollow({
        sessionId: session.id,
        state: windowState(),
        displays: [display],
        surfaceEnabled: true,
        surfaceFocused: false,
        surfaceSize: {
          width: 240,
          height: 96,
        },
      }),
    ).toMatchObject({
      kind: "visible",
      displayId: 1,
      placement: "right",
      bounds: {
        x: 910,
        y: 100,
        width: 240,
        height: 96,
      },
    });
  });

  it("falls back to the left and then to an in-browser overlay", () => {
    const left = decideBrowserFollow({
      sessionId: session.id,
      state: windowState({
        bounds: {
          left: 500,
          top: 100,
          width: 800,
          height: 600,
        },
      }),
      displays: [display],
      surfaceEnabled: true,
      surfaceFocused: false,
      surfaceSize: {
        width: 240,
        height: 96,
      },
    });

    expect(left).toMatchObject({
      kind: "visible",
      placement: "left",
      bounds: {
        x: 250,
      },
    });

    const overlay = decideBrowserFollow({
      sessionId: session.id,
      state: windowState({
        bounds: {
          left: 100,
          top: 100,
          width: 1240,
          height: 600,
        },
      }),
      displays: [display],
      surfaceEnabled: true,
      surfaceFocused: false,
      surfaceSize: {
        width: 240,
        height: 96,
      },
    });

    expect(overlay).toMatchObject({
      kind: "visible",
      placement: "overlay_top_right",
      bounds: {
        x: 1090,
        y: 110,
        width: 240,
        height: 96,
      },
    });
  });

  it("fails closed for off-display and equally split multi-display geometry", () => {
    expect(
      decideBrowserFollow({
        sessionId: session.id,
        state: windowState({
          bounds: {
            left: 2000,
            top: 100,
            width: 800,
            height: 600,
          },
        }),
        displays: [display],
        surfaceEnabled: true,
        surfaceFocused: false,
        surfaceSize: {
          width: 240,
          height: 96,
        },
      }),
    ).toEqual({
      kind: "hidden",
      reason: "browser_off_display",
    });

    const leftDisplay: BrowserFollowDisplay = {
      id: 1,
      bounds: {
        x: 0,
        y: 0,
        width: 500,
        height: 900,
      },
      workArea: {
        x: 0,
        y: 0,
        width: 500,
        height: 860,
      },
    };

    const rightDisplay: BrowserFollowDisplay = {
      id: 2,
      bounds: {
        x: 500,
        y: 0,
        width: 500,
        height: 900,
      },
      workArea: {
        x: 500,
        y: 0,
        width: 500,
        height: 860,
      },
    };

    expect(
      decideBrowserFollow({
        sessionId: session.id,
        state: windowState({
          bounds: {
            left: 250,
            top: 100,
            width: 500,
            height: 600,
          },
        }),
        displays: [leftDisplay, rightDisplay],
        surfaceEnabled: true,
        surfaceFocused: false,
        surfaceSize: {
          width: 240,
          height: 96,
        },
      }),
    ).toEqual({
      kind: "hidden",
      reason: "ambiguous_display",
    });
  });

  it("hides minimized, fullscreen, and unrelated-background browser state", () => {
    expect(
      decideBrowserFollow({
        sessionId: session.id,
        state: windowState({
          windowState: "minimized",
        }),
        displays: [display],
        surfaceEnabled: true,
        surfaceFocused: false,
        surfaceSize: {
          width: 240,
          height: 96,
        },
      }),
    ).toEqual({
      kind: "hidden",
      reason: "window_minimized",
    });

    expect(
      decideBrowserFollow({
        sessionId: session.id,
        state: windowState({
          windowState: "fullscreen",
        }),
        displays: [display],
        surfaceEnabled: true,
        surfaceFocused: false,
        surfaceSize: {
          width: 240,
          height: 96,
        },
      }),
    ).toEqual({
      kind: "hidden",
      reason: "window_fullscreen_unqualified",
    });

    expect(
      decideBrowserFollow({
        sessionId: session.id,
        state: windowState({
          documentFocused: false,
        }),
        displays: [display],
        surfaceEnabled: true,
        surfaceFocused: false,
        surfaceSize: {
          width: 240,
          height: 96,
        },
      }),
    ).toEqual({
      kind: "hidden",
      reason: "browser_not_foreground",
    });
  });

  it("keeps the follower eligible while the follower itself owns focus", () => {
    expect(
      decideBrowserFollow({
        sessionId: session.id,
        state: windowState({
          documentFocused: false,
        }),
        displays: [display],
        surfaceEnabled: true,
        surfaceFocused: true,
        surfaceSize: {
          width: 240,
          height: 96,
        },
      }).kind,
    ).toBe("visible");
  });
});

describe("BrowserFollowController", () => {
  it("suppresses duplicate geometry and applies movement", async () => {
    let state = windowState();

    const source = {
      getBrowserWindowState: vi.fn(async () => state),
    };

    const surface = new FakeSurface();

    const controller = new BrowserFollowController(
      source,
      {
        getAllDisplays: () => [display],
      },
      surface,
    );

    controller.setSession(session);

    await controller.reconcileNow();
    await controller.reconcileNow();

    expect(surface.shown).toHaveLength(1);

    state = windowState({
      bounds: {
        left: 120,
        top: 120,
        width: 800,
        height: 600,
      },
    });

    await controller.reconcileNow();

    expect(surface.shown).toHaveLength(2);

    expect(surface.shown[1]).toMatchObject({
      x: 930,
      y: 120,
    });
  });

  it("fails closed when Runtime has no window state or throws", async () => {
    const surface = new FakeSurface();

    const source = {
      getBrowserWindowState: vi.fn<
        (
          sessionId: string,
          signal: AbortSignal,
        ) => Promise<BrowserWindowState | null>
      >(async () => null),
    };

    const controller = new BrowserFollowController(
      source,
      {
        getAllDisplays: () => [display],
      },
      surface,
    );

    controller.setSession(session);

    await controller.reconcileNow();

    expect(surface.hideCount).toBe(1);

    source.getBrowserWindowState.mockRejectedValueOnce(
      new Error("runtime unavailable"),
    );

    await controller.reconcileNow();

    expect(surface.hideCount).toBe(1);
  });

  it("discards an in-flight result after the live session changes", async () => {
    let resolve: ((value: BrowserWindowState | null) => void) | undefined;

    const pending = new Promise<BrowserWindowState | null>((resolvePromise) => {
      resolve = resolvePromise;
    });

    const source = {
      getBrowserWindowState: vi.fn(async () => pending),
    };

    const surface = new FakeSurface();

    const controller = new BrowserFollowController(
      source,
      {
        getAllDisplays: () => [display],
      },
      surface,
    );

    controller.setSession(session);

    const reconcile = controller.reconcileNow();

    controller.setSession({
      ...session,
      id: "ses_follow_next",
    });

    resolve?.(windowState());

    await reconcile;

    expect(surface.shown).toHaveLength(0);
  });

  it("owns an independent bounded polling cadence", async () => {
    vi.useFakeTimers();

    const source = {
      getBrowserWindowState: vi.fn(async () => windowState()),
    };

    const surface = new FakeSurface();

    const controller = new BrowserFollowController(
      source,
      {
        getAllDisplays: () => [display],
      },
      surface,
      {
        intervalMs: 100,
      },
    );

    controller.setSession(session);

    controller.start();

    await vi.advanceTimersByTimeAsync(250);

    expect(
      source.getBrowserWindowState.mock.calls.length,
    ).toBeGreaterThanOrEqual(3);

    controller.stop();

    const callsAfterStop = source.getBrowserWindowState.mock.calls.length;

    await vi.advanceTimersByTimeAsync(300);

    expect(source.getBrowserWindowState).toHaveBeenCalledTimes(callsAfterStop);
  });
});

describe("BrowserFollowController authority revocation", () => {
  it("hides old follower geometry immediately when the live session changes", async () => {
    let resolvePending:
      ((value: BrowserWindowState | null) => void) | undefined;

    const source = {
      getBrowserWindowState:
        vi.fn<
          (
            sessionId: string,
            signal: AbortSignal,
          ) => Promise<BrowserWindowState | null>
        >(),
    };

    source.getBrowserWindowState
      .mockResolvedValueOnce(windowState())
      .mockImplementationOnce(
        () =>
          new Promise<BrowserWindowState | null>((resolve) => {
            resolvePending = resolve;
          }),
      );

    const surface = new FakeSurface();

    const controller = new BrowserFollowController(
      source,
      {
        getAllDisplays: () => [display],
      },
      surface,
    );

    controller.setSession(session);

    await controller.reconcileNow();

    expect(surface.shown).toHaveLength(1);

    expect(surface.hideCount).toBe(1);

    const pending = controller.reconcileNow();

    controller.setSession({
      ...session,
      id: "ses_follow_next",
    });

    expect(surface.hideCount).toBe(2);

    resolvePending?.(windowState());

    await pending;

    expect(surface.shown).toHaveLength(1);
  });

  it("aborts stale transport authority at the freshness deadline and ignores a late result", async () => {
    vi.useFakeTimers();

    let resolvePending:
      ((value: BrowserWindowState | null) => void) | undefined;

    let pendingSignal: AbortSignal | undefined;

    const source = {
      getBrowserWindowState:
        vi.fn<
          (
            sessionId: string,
            signal: AbortSignal,
          ) => Promise<BrowserWindowState | null>
        >(),
    };

    source.getBrowserWindowState
      .mockResolvedValueOnce(windowState())
      .mockImplementationOnce((_sessionId, signal) => {
        pendingSignal = signal;

        return new Promise<BrowserWindowState | null>((resolve) => {
          resolvePending = resolve;
        });
      })
      .mockResolvedValueOnce(
        windowState({
          bounds: {
            left: 140,
            top: 140,
            width: 800,
            height: 600,
          },
        }),
      );

    const surface = new FakeSurface();

    const controller = new BrowserFollowController(
      source,
      {
        getAllDisplays: () => [display],
      },
      surface,
      {
        freshnessMs: 500,
      },
    );

    controller.setSession(session);

    await controller.reconcileNow();

    expect(surface.shown).toHaveLength(1);

    const stale = controller.reconcileNow();

    await vi.advanceTimersByTimeAsync(500);

    await stale;

    expect(pendingSignal?.aborted).toBe(true);

    expect(surface.hideCount).toBe(2);

    resolvePending?.(
      windowState({
        bounds: {
          left: 180,
          top: 180,
          width: 800,
          height: 600,
        },
      }),
    );

    await Promise.resolve();

    expect(surface.shown).toHaveLength(1);

    await controller.reconcileNow();

    expect(surface.shown).toHaveLength(2);

    expect(surface.shown[1]).toMatchObject({
      x: 950,
      y: 140,
    });
  });

  it("does not reapply identical geometry when only page identity changes", async () => {
    let state = windowState();

    const source = {
      getBrowserWindowState: vi.fn(async () => state),
    };

    const surface = new FakeSurface();

    const controller = new BrowserFollowController(
      source,
      {
        getAllDisplays: () => [display],
      },
      surface,
    );

    controller.setSession(session);

    await controller.reconcileNow();

    expect(surface.shown).toHaveLength(1);

    state = windowState({
      pageId: "page_02",
    });

    await controller.reconcileNow();

    expect(surface.shown).toHaveLength(1);
  });

  it("suppresses repeated hide effects across different hidden reasons", async () => {
    const surface = new FakeSurface();

    const source = {
      getBrowserWindowState: vi.fn<
        (
          sessionId: string,
          signal: AbortSignal,
        ) => Promise<BrowserWindowState | null>
      >(async () => null),
    };

    const controller = new BrowserFollowController(
      source,
      {
        getAllDisplays: () => [display],
      },
      surface,
    );

    controller.setSession(session);

    expect(surface.hideCount).toBe(1);

    await controller.reconcileNow();

    source.getBrowserWindowState.mockRejectedValueOnce(
      new Error("runtime unavailable"),
    );

    await controller.reconcileNow();

    expect(surface.hideCount).toBe(1);
  });
});

describe("BrowserFollowController surface synchronization", () => {
  it("reapplies identical authorized geometry when the native follower is no longer visible", async () => {
    const source = {
      getBrowserWindowState: vi.fn(async () => windowState()),
    };

    const surface = new FakeSurface();

    const controller = new BrowserFollowController(
      source,
      {
        getAllDisplays: () => [display],
      },
      surface,
    );

    controller.setSession(session);

    await controller.reconcileNow();

    expect(surface.shown).toHaveLength(1);

    expect(surface.visible).toBe(true);

    surface.visible = false;

    await controller.reconcileNow();

    expect(surface.shown).toHaveLength(2);

    expect(surface.visible).toBe(true);
  });

  it("reapplies an unchanged hidden decision if the native follower becomes unexpectedly visible", async () => {
    const source = {
      getBrowserWindowState: vi.fn(async () => null),
    };

    const surface = new FakeSurface();

    const controller = new BrowserFollowController(
      source,
      {
        getAllDisplays: () => [display],
      },
      surface,
    );

    controller.setSession(session);

    expect(surface.hideCount).toBe(1);

    await controller.reconcileNow();

    expect(surface.hideCount).toBe(1);

    surface.visible = true;

    await controller.reconcileNow();

    expect(surface.hideCount).toBe(2);

    expect(surface.visible).toBe(false);
  });
});
