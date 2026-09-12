import type { BrowserWindowState, Session } from "@rove/protocol";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserFollowController,
  type BrowserFollowDisplay,
  type BrowserFollowPlacement,
  type BrowserFollowPresentationMode,
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
    width: 64,
    height: 56,
  };

  shown: BrowserFollowRectangle[] = [];

  presentations: {
    placement: BrowserFollowPlacement;
    presentation: BrowserFollowPresentationMode;
  }[] = [];

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

  followPresentation(windowState: BrowserWindowState["windowState"] | null) {
    return windowState === "fullscreen"
      ? {
          mode: "fullscreen_micro" as const,
          size: { width: 64, height: 56 },
        }
      : {
          mode: "windowed_compact" as const,
          size: this.size,
        };
  }

  preferredPosition(): null {
    return null;
  }

  resetUserPlacement(): void {}

  showInactiveAt(
    bounds: BrowserFollowRectangle,
    placement: BrowserFollowPlacement,
    presentation: BrowserFollowPresentationMode,
  ): void {
    this.visible = true;

    this.shown.push(bounds);
    this.presentations.push({ placement, presentation });
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
  it("places the universal micro follower inside the browser top-right", () => {
    expect(
      decideBrowserFollow({
        sessionId: session.id,
        state: windowState(),
        displays: [display],
        surfaceEnabled: true,
        surfaceFocused: false,
        surfaceSize: {
          width: 64,
          height: 56,
        },
      }),
    ).toMatchObject({
      kind: "visible",
      displayId: 1,
      placement: "browser_top_right",
      bounds: {
        x: 826,
        y: 110,
        width: 64,
        height: 56,
      },
    });
  });

  it("anchors inside the browser regardless of outside desktop space", () => {
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
      placement: "browser_top_right",
      bounds: {
        x: 1050,
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
      placement: "browser_top_right",
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

  it("hides minimized and unrelated-background browser state", () => {
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

  it("places the fullscreen micro follower inside the display top-right", () => {
    expect(
      decideBrowserFollow({
        sessionId: session.id,
        state: windowState({
          windowState: "fullscreen",
          bounds: {
            left: 0,
            top: 0,
            width: 1440,
            height: 900,
          },
        }),
        displays: [display],
        surfaceEnabled: true,
        surfaceFocused: false,
        surfaceSize: {
          width: 64,
          height: 56,
        },
        presentation: "fullscreen_micro",
      }),
    ).toMatchObject({
      kind: "visible",
      placement: "browser_top_right",
      presentation: "fullscreen_micro",
      bounds: {
        x: 1366,
        y: 10,
        width: 64,
        height: 56,
      },
    });
  });

  it("fails closed when the fullscreen presentation cannot fit", () => {
    expect(
      decideBrowserFollow({
        sessionId: session.id,
        state: windowState({
          windowState: "fullscreen",
          bounds: {
            left: -1000,
            top: 0,
            width: 40,
            height: 40,
          },
        }),
        displays: [
          {
            id: 2,
            bounds: { x: -1000, y: 0, width: 40, height: 40 },
            workArea: { x: -1000, y: 0, width: 40, height: 40 },
          },
        ],
        surfaceEnabled: true,
        surfaceFocused: false,
        surfaceSize: { width: 64, height: 56 },
        presentation: "fullscreen_micro",
      }),
    ).toEqual({
      kind: "hidden",
      reason: "placement_unavailable",
    });
  });

  it("falls back from fullscreen expanded to micro on a constrained display", () => {
    expect(
      decideBrowserFollow({
        sessionId: session.id,
        state: windowState({
          windowState: "fullscreen",
          bounds: { left: -800, top: 0, width: 300, height: 200 },
        }),
        displays: [
          {
            id: 2,
            bounds: { x: -800, y: 0, width: 300, height: 200 },
            workArea: { x: -800, y: 0, width: 300, height: 200 },
          },
        ],
        surfaceEnabled: true,
        surfaceFocused: true,
        surfaceSize: { width: 360, height: 240 },
        presentation: "fullscreen_expanded",
        fallbackSurfaceSize: { width: 64, height: 56 },
        fallbackPresentation: "fullscreen_micro",
      }),
    ).toMatchObject({
      kind: "visible",
      placement: "browser_top_right",
      presentation: "fullscreen_micro",
      bounds: { x: -574, y: 10, width: 64, height: 56 },
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
  it("transfers the unified surface back to the follower when the owned browser regains foreground", async () => {
    const surface = new FakeSurface();
    surface.enabled = false;
    const onOwnedBrowserForeground = vi.fn(() => {
      surface.enabled = true;
    });
    const controller = new BrowserFollowController(
      {
        getBrowserWindowState: vi.fn(async () =>
          windowState({ documentFocused: false }),
        ),
      },
      { getAllDisplays: () => [display] },
      surface,
      {
        browserIdentity: {
          getBrowserHostIdentity: vi.fn(async () => ({
            kind: "owned_process" as const,
            processId: 410,
          })),
        },
        foreground: {
          getForegroundProcessId: vi.fn(async () => 410),
        },
        followerProcessId: 411,
        onOwnedBrowserForeground,
      },
    );

    controller.setSession(session);
    await controller.reconcileNow();

    expect(onOwnedBrowserForeground).toHaveBeenCalledOnce();
    expect(surface.shown).toHaveLength(1);
    expect(surface.visible).toBe(true);
  });

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
      x: 846,
      y: 130,
    });
  });

  it("recomputes fresh presentation across normal and fullscreen transitions", async () => {
    let state = windowState();

    const source = {
      getBrowserWindowState: vi.fn(async () => state),
    };

    const surface = new FakeSurface();
    const controller = new BrowserFollowController(
      source,
      { getAllDisplays: () => [display] },
      surface,
    );

    controller.setSession(session);
    await controller.reconcileNow();

    state = windowState({
      windowState: "fullscreen",
      bounds: { left: 0, top: 0, width: 1440, height: 900 },
    });
    await controller.reconcileNow();

    state = windowState({
      bounds: { left: 120, top: 120, width: 800, height: 600 },
    });
    await controller.reconcileNow();

    expect(surface.presentations).toEqual([
      { placement: "browser_top_right", presentation: "windowed_compact" },
      {
        placement: "browser_top_right",
        presentation: "fullscreen_micro",
      },
      { placement: "browser_top_right", presentation: "windowed_compact" },
    ]);
    expect(surface.shown[2]).toEqual({
      x: 846,
      y: 130,
      width: 64,
      height: 56,
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
  it("hides on an unrelated native foreground process and restores from a fresh decision", async () => {
    let foregroundProcessId = 4321;
    const source = {
      getBrowserWindowState: vi.fn(async () => windowState()),
      getBrowserHostIdentity: vi.fn(async () => ({
        kind: "owned_process" as const,
        processId: 4321,
      })),
    };
    const surface = new FakeSurface();
    const controller = new BrowserFollowController(
      source,
      { getAllDisplays: () => [display] },
      surface,
      {
        browserIdentity: source,
        foreground: {
          getForegroundProcessId: vi.fn(async () => foregroundProcessId),
        },
      },
    );

    controller.setSession(session);
    await controller.reconcileNow();
    expect(surface.visible).toBe(true);

    foregroundProcessId = 9876;
    await controller.reconcileNow();
    expect(surface.visible).toBe(false);

    foregroundProcessId = 4321;
    await controller.reconcileNow();
    expect(surface.visible).toBe(true);
    expect(source.getBrowserHostIdentity).toHaveBeenCalledTimes(3);
  });

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
      x: 866,
      y: 150,
    });
  });

  it("uses exact native foreground PID authority and keeps the follower-focus exception", () => {
    const base = {
      sessionId: session.id,
      state: windowState(),
      displays: [display],
      surfaceEnabled: true,
      surfaceSize: { width: 64, height: 56 },
      enforceNativeForeground: true,
      ownedBrowserProcessId: 4321,
    };

    expect(
      decideBrowserFollow({
        ...base,
        surfaceFocused: false,
        foregroundProcessId: 9876,
      }),
    ).toEqual({ kind: "hidden", reason: "browser_not_foreground" });

    expect(
      decideBrowserFollow({
        ...base,
        surfaceFocused: false,
        foregroundProcessId: null,
      }),
    ).toEqual({ kind: "hidden", reason: "foreground_unavailable" });

    expect(
      decideBrowserFollow({
        ...base,
        state: windowState({ documentFocused: false }),
        surfaceFocused: false,
        foregroundProcessId: 4321,
      }),
    ).toMatchObject({ kind: "visible" });

    expect(
      decideBrowserFollow({
        ...base,
        state: windowState({ documentFocused: false }),
        surfaceFocused: false,
        foregroundProcessId: 4321,
      }),
    ).toMatchObject({ kind: "visible" });

    expect(
      decideBrowserFollow({
        ...base,
        state: windowState({ documentFocused: false }),
        surfaceFocused: true,
        foregroundProcessId: 9876,
      }),
    ).toMatchObject({ kind: "visible" });

    expect(
      decideBrowserFollow({
        ...base,
        state: windowState({ documentFocused: false }),
        surfaceFocused: false,
        followerProcessId: 2468,
        foregroundProcessId: 2468,
      }),
    ).toMatchObject({ kind: "visible" });
  });

  it("accepts main-owned user placement across displays and clamps fullscreen placement", () => {
    const secondDisplay: BrowserFollowDisplay = {
      id: 2,
      bounds: { x: -1200, y: -100, width: 1200, height: 900 },
      workArea: { x: -1200, y: -100, width: 1200, height: 860 },
    };

    expect(
      decideBrowserFollow({
        sessionId: session.id,
        state: windowState(),
        displays: [display, secondDisplay],
        surfaceEnabled: true,
        surfaceFocused: false,
        surfaceSize: { width: 64, height: 56 },
        preferredPosition: { x: -700, y: 300 },
      }),
    ).toMatchObject({
      kind: "visible",
      displayId: 2,
      placement: "user_positioned",
      bounds: { x: -700, y: 300 },
    });

    expect(
      decideBrowserFollow({
        sessionId: session.id,
        state: windowState({
          windowState: "fullscreen",
          bounds: { left: 0, top: 0, width: 1440, height: 900 },
        }),
        displays: [display, secondDisplay],
        surfaceEnabled: true,
        surfaceFocused: true,
        surfaceSize: { width: 64, height: 56 },
        preferredPosition: { x: -700, y: 900 },
      }),
    ).toMatchObject({
      kind: "visible",
      displayId: 1,
      placement: "user_positioned",
      bounds: { x: 0, y: 844 },
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
