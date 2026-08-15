import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveDesktopServiceLayout } from "./service-layout.js";

describe("resolveDesktopServiceLayout", () => {
  it("uses compiled services and Electron's embedded Node when packaged", () => {
    expect(
      resolveDesktopServiceLayout({
        isPackaged: true,
        resourcesPath: "/Applications/Rove.app/Contents/Resources",
        cwd: "/ignored",
        electronExecutable: "/Applications/Rove.app/Contents/MacOS/Rove",
      }),
    ).toEqual({
      runtimeDirectory: join(
        "/Applications/Rove.app/Contents/Resources",
        "services",
        "runtime",
      ),
      runtimeEntrypoint: "dist/main.js",
      nodeExecutable: "/Applications/Rove.app/Contents/MacOS/Rove",
      electronRunAsNode: true,
      playwrightBrowsersPath: join(
        "/Applications/Rove.app/Contents/Resources",
        "browsers",
      ),
    });
  });

  it("preserves source-based development service overrides", () => {
    expect(
      resolveDesktopServiceLayout({
        isPackaged: false,
        resourcesPath: "/ignored",
        cwd: "/repo/apps/companion",
        electronExecutable: "/repo/node_modules/electron/Electron",
        runtimeDirectory: "/custom/runtime",
      }),
    ).toEqual({
      runtimeDirectory: "/custom/runtime",
      electronRunAsNode: false,
    });
  });
});
