import type { BrowserEngine, BrowserSession } from "@rove/browser";

import type { BrowserLaunchConfig, BrowserWindowState } from "@rove/protocol";

import { describe, expect, it, vi } from "vitest";

import { BrowserService } from "./browser.service.js";

const liveState: BrowserWindowState = {
  windowId: 123,
  pageId: "page_01",
  windowState: "normal",
  bounds: {
    left: 20,
    top: 40,
    width: 1200,
    height: 800,
  },
  documentFocused: true,
};

describe("BrowserService live window state", () => {
  it("queries the current live BrowserSession", async () => {
    const browserWindowState = vi.fn(async () => liveState);

    const browser = {
      id: "browser_window_state",
      capabilities: {},
      hostIdentity: () => null,
      browserWindowState,
      close: vi.fn(async () => undefined),
    } as unknown as BrowserSession;

    const engine = {
      start: vi.fn(async () => browser),
    } as unknown as BrowserEngine;

    const service = new BrowserService(engine);

    await service.start("ses_window_state", {} as BrowserLaunchConfig);

    await expect(service.windowState("ses_window_state")).resolves.toEqual(
      liveState,
    );

    expect(browserWindowState).toHaveBeenCalledTimes(1);

    await service.close("ses_window_state");
  });

  it("preserves null when no headed window state exists", async () => {
    const browser = {
      id: "browser_no_window_state",
      capabilities: {},
      hostIdentity: () => null,
      browserWindowState: async () => null,
      close: vi.fn(async () => undefined),
    } as unknown as BrowserSession;

    const engine = {
      start: vi.fn(async () => browser),
    } as unknown as BrowserEngine;

    const service = new BrowserService(engine);

    await service.start("ses_no_window_state", {} as BrowserLaunchConfig);

    await expect(
      service.windowState("ses_no_window_state"),
    ).resolves.toBeNull();

    await service.close("ses_no_window_state");
  });
});
