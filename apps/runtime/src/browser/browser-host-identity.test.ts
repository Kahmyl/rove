import type { BrowserEngine, BrowserSession } from "@rove/browser";
import type { BrowserLaunchConfig } from "@rove/protocol";
import { describe, expect, it, vi } from "vitest";

import { BrowserService } from "./browser.service.js";

describe("BrowserService live host identity", () => {
  it("returns identity from the current live BrowserSession only", async () => {
    const close = vi.fn(async () => undefined);

    const browser = {
      id: "browser_host_identity",
      capabilities: {},
      hostIdentity: () => ({
        kind: "owned_process",
        processId: 4321,
      }),
      onActivity: () => () => undefined,
      pages: async () => [
        { id: "page_01", url: "about:blank", active: true, revision: 0 },
      ],
      close,
    } as unknown as BrowserSession;

    const engine = {
      start: vi.fn(async () => browser),
    } as unknown as BrowserEngine;

    const service = new BrowserService(engine);

    await service.start("ses_host_identity", {} as BrowserLaunchConfig);

    expect(service.hostIdentity("ses_host_identity")).toEqual({
      kind: "owned_process",
      processId: 4321,
    });

    await service.close("ses_host_identity");

    expect(() => service.hostIdentity("ses_host_identity")).toThrow();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("returns null when the live browser has no owned-process identity", async () => {
    const browser = {
      id: "browser_no_host_identity",
      capabilities: {},
      hostIdentity: () => null,
      onActivity: () => () => undefined,
      pages: async () => [
        { id: "page_01", url: "about:blank", active: true, revision: 0 },
      ],
      close: vi.fn(async () => undefined),
    } as unknown as BrowserSession;

    const engine = {
      start: vi.fn(async () => browser),
    } as unknown as BrowserEngine;

    const service = new BrowserService(engine);

    await service.start("ses_no_host_identity", {} as BrowserLaunchConfig);

    expect(service.hostIdentity("ses_no_host_identity")).toBeNull();

    await service.close("ses_no_host_identity");
  });
});
