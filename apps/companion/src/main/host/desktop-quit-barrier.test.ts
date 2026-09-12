import { describe, expect, it } from "vitest";

import { DesktopQuitBarrier } from "./desktop-quit-barrier.js";

describe("DesktopQuitBarrier", () => {
  it("keeps reentrant quit prevented until managed shutdown completes", () => {
    const barrier = new DesktopQuitBarrier();

    expect(barrier.request(true)).toEqual({
      preventQuit: true,
      startShutdown: true,
    });
    expect(barrier.request(true)).toEqual({
      preventQuit: true,
      startShutdown: false,
    });

    barrier.complete();

    expect(barrier.request(true)).toEqual({
      preventQuit: false,
      startShutdown: false,
    });
  });

  it("allows immediate quit when no managed component exists", () => {
    const barrier = new DesktopQuitBarrier();

    expect(barrier.request(false)).toEqual({
      preventQuit: false,
      startShutdown: false,
    });
  });
});
