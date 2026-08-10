import type {
  BrowserEngine,
  BrowserSession,
} from "@rove/browser";
import type {
  BrowserLaunchConfig,
} from "@rove/protocol";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  BrowserService,
} from "./browser.service.js";

describe("BrowserService shutdown", () => {
  it("closes every attached browser session during module destruction", async () => {
    const firstClose =
      vi.fn(async () => undefined);

    const secondClose =
      vi.fn(async () => {
        throw new Error(
          "browser close failed",
        );
      });

    const first =
      fakeSession(
        "browser-1",
        firstClose,
      );

    const second =
      fakeSession(
        "browser-2",
        secondClose,
      );

    const engine = {
      start: vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second),
    } as unknown as BrowserEngine;

    const service =
      new BrowserService(engine);

    const config =
      {} as BrowserLaunchConfig;

    await service.start(
      "ses_first",
      config,
    );

    await service.start(
      "ses_second",
      config,
    );

    expect(
      service.sessionIds(),
    ).toEqual([
      "ses_first",
      "ses_second",
    ]);

    await expect(
      service.onModuleDestroy(),
    ).resolves.toBeUndefined();

    expect(firstClose)
      .toHaveBeenCalledTimes(1);

    expect(secondClose)
      .toHaveBeenCalledTimes(1);

    expect(
      service.sessionIds(),
    ).toEqual([]);
  });
});

function fakeSession(
  id: string,
  close:
    () => Promise<void>,
): BrowserSession {
  return {
    id,
    close,
  } as unknown as BrowserSession;
}
