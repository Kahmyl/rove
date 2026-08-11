import { describe, expect, it } from "vitest";

import { companionIpcChannels } from "../shared/desktop-api.js";
import { createDesktopApi } from "./api.js";

describe("Companion preload API", () => {
  it("exposes only the intended narrow IPC surface", async () => {
    const channels: string[] = [];

    const api = createDesktopApi({
      invoke: async (channel) => {
        channels.push(channel);
        return null;
      },
    });

    expect(Object.keys(api).sort()).toEqual([
      "finishSession",
      "getNotice",
      "getSnapshot",
      "returnControl",
      "takeControl",
    ]);

    await api.getSnapshot();
    await api.getNotice();
    await api.takeControl();
    await api.returnControl();
    await api.finishSession();

    expect(channels).toEqual([
      companionIpcChannels.snapshot,
      companionIpcChannels.notice,
      companionIpcChannels.takeControl,
      companionIpcChannels.returnControl,
      companionIpcChannels.finishSession,
    ]);
  });
});
