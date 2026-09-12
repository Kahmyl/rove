import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { resolveDesktopProductHome } from "./desktop-product-home.js";

describe("Desktop product home", () => {
  const appData = resolve("/stable-user-app-data");

  it("gives source and packaged Desktop the same fixed product home", () => {
    const source = resolveDesktopProductHome({ appDataDirectory: appData });
    const packaged = resolveDesktopProductHome({ appDataDirectory: appData });
    expect(source).toBe(packaged);
    expect(source).toBe(resolve(appData, "Rove", "product"));
  });

  it("does not depend on process cwd", () => {
    const cwd = vi.spyOn(process, "cwd");
    cwd.mockReturnValueOnce(resolve("/repository/apps/companion"));
    const fromSourceCwd = resolveDesktopProductHome({
      appDataDirectory: appData,
    });
    cwd.mockReturnValueOnce(resolve("/Applications/Rove.app"));
    const fromPackagedCwd = resolveDesktopProductHome({
      appDataDirectory: appData,
    });
    expect(fromSourceCwd).toBe(fromPackagedCwd);
    expect(cwd).not.toHaveBeenCalled();
    cwd.mockRestore();
  });

  it("does not accept or derive from mutable Electron user-data", () => {
    const result = resolveDesktopProductHome({ appDataDirectory: appData });
    expect(result).not.toContain("qualification-electron-user-data");
    expect(result).toBe(resolve(appData, "Rove", "product"));
  });

  it("accepts an explicit absolute qualification override", () => {
    const override = resolve("/qualification/rove-home");
    expect(
      resolveDesktopProductHome({
        appDataDirectory: appData,
        qualificationOverride: override,
      }),
    ).toBe(override);
  });

  it("rejects a relative qualification override", () => {
    expect(() =>
      resolveDesktopProductHome({
        appDataDirectory: appData,
        qualificationOverride: "./qualification-home",
      }),
    ).toThrow(/absolute path/);
  });
});
