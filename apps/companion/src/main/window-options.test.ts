import {
  describe,
  expect,
  it,
} from "vitest";

import { companionWindowOptions } from "./window-options.js";

describe("Companion BrowserWindow", () => {
  it("uses the compact Companion window defaults", () => {
    const options =
      companionWindowOptions(
        "/tmp/rove/main",
      );

    expect(options).toMatchObject({
      title: "Rove Companion",
      width: 420,
      height: 500,
      minWidth: 360,
      minHeight: 440,
      backgroundColor: "#f3f5f1",
    });

    expect(
      options.icon,
    ).toMatch(
      /rove-app-icon\.png$/,
    );
  });

  it("keeps the renderer isolated from unrestricted Node APIs", () => {
    const options =
      companionWindowOptions(
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
