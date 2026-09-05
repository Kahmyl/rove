import { describe, expect, it } from "vitest";

import {
  COMPACT_FOLLOWER_HEIGHT,
  COMPACT_FOLLOWER_WIDTH,
  EXPANDED_FOLLOWER_HEIGHT,
  EXPANDED_FOLLOWER_WIDTH,
  FULLSCREEN_MICRO_FOLLOWER_HEIGHT,
  FULLSCREEN_MICRO_FOLLOWER_WIDTH,
  compactFollowerWindowOptions,
} from "./compact-follower-window-options.js";

describe("compactFollowerWindowOptions", () => {
  it("defines the initial collapsed follower without locking programmatic expansion", () => {
    const options = compactFollowerWindowOptions("/tmp/rove/main");

    expect(options).toMatchObject({
      title: "Rove",
      width: COMPACT_FOLLOWER_WIDTH,
      height: COMPACT_FOLLOWER_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      backgroundColor: "#f3f5f1",
    });

    expect(options.minWidth).toBeUndefined();

    expect(options.minHeight).toBeUndefined();

    expect(options.maxWidth).toBeUndefined();

    expect(options.maxHeight).toBeUndefined();
  });

  it("freezes legal compact, expanded, and fullscreen micro sizes", () => {
    expect({
      compact: [COMPACT_FOLLOWER_WIDTH, COMPACT_FOLLOWER_HEIGHT],
      expanded: [EXPANDED_FOLLOWER_WIDTH, EXPANDED_FOLLOWER_HEIGHT],
      fullscreenMicro: [
        FULLSCREEN_MICRO_FOLLOWER_WIDTH,
        FULLSCREEN_MICRO_FOLLOWER_HEIGHT,
      ],
    }).toEqual({
      compact: [240, 96],
      expanded: [360, 240],
      fullscreenMicro: [64, 56],
    });
  });

  it("preserves the renderer security boundary without selecting z-order policy", () => {
    const options = compactFollowerWindowOptions("/tmp/rove/main");

    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });

    expect(options.webPreferences?.preload).toMatch(/preload\.cjs$/);

    expect(options.alwaysOnTop).toBeUndefined();
  });

  it("uses a macOS panel only where native fullscreen presentation requires it", () => {
    expect(compactFollowerWindowOptions("/tmp/rove/main", "darwin").type).toBe(
      "panel",
    );
    expect(
      compactFollowerWindowOptions("/tmp/rove/main", "win32").type,
    ).toBeUndefined();
    expect(
      compactFollowerWindowOptions("/tmp/rove/main", "linux").type,
    ).toBeUndefined();
  });
});
