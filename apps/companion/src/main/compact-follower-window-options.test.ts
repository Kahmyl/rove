import { describe, expect, it } from "vitest";

import {
  COMPACT_FOLLOWER_HEIGHT,
  COMPACT_FOLLOWER_WIDTH,
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
});
