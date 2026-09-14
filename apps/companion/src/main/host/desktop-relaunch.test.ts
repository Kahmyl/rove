import { describe, expect, it, vi } from "vitest";

import { createDesktopRelaunchRequest } from "./desktop-relaunch.js";

describe("desktop relaunch request", () => {
  it("schedules one relaunch before entering the normal quit barrier", () => {
    const order: string[] = [];
    const request = createDesktopRelaunchRequest({
      relaunch: vi.fn(() => order.push("relaunch")),
      quit: vi.fn(() => order.push("quit")),
    });

    expect(request()).toBe(true);
    expect(request()).toBe(false);
    expect(order).toEqual(["relaunch", "quit"]);
  });
});
