import { describe, expect, it } from "vitest";

import { companionWindowOptions } from "./window-options.js";

describe("Companion BrowserWindow", () => {
  it("uses the spacious Rove window defaults and a minimal macOS title bar", () => {
    const options = companionWindowOptions("/tmp/rove/main", "darwin");

    expect(options).toMatchObject({
      title: "Rove",
      width: 1440,
      height: 900,
      minWidth: 1040,
      minHeight: 680,
      backgroundColor: "#f3f5f1",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 18 },
    });

    expect(options.icon).toMatch(/rove-app-icon\.png$/);
  });

  it("keeps the native title bar outside macOS", () => {
    const options = companionWindowOptions("/tmp/rove/main", "linux");

    expect(options.titleBarStyle).toBeUndefined();
    expect(options.trafficLightPosition).toBeUndefined();
  });

  it("keeps the renderer isolated from unrestricted Node APIs", () => {
    const options = companionWindowOptions("/tmp/rove/main");

    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });

    expect(options.webPreferences?.preload).toMatch(/preload\.cjs$/);
  });
});
