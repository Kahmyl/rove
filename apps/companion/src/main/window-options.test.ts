import {
  describe,
  expect,
  it,
} from "vitest";

import { companionWindowOptions } from "./window-options.js";

describe("Companion BrowserWindow security", () => {
  it("keeps the renderer isolated from unrestricted Node APIs", () => {
    const options = companionWindowOptions(
      "/tmp/rove/main",
    );

    expect(
      options.webPreferences,
    ).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });

    expect(
      options.webPreferences?.preload,
    ).toMatch(/preload\.cjs$/);
  });
});
