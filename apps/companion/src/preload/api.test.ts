import { describe, expect, it } from "vitest";

import { companionIpcChannels } from "../shared/desktop-api.js";

import { createDesktopApi } from "./api.js";

describe("Companion preload API", () => {
  it("exposes only the intended narrow desktop IPC surface", async () => {
    const channels: string[] = [];

    const api = createDesktopApi({
      invoke: async (channel) => {
        channels.push(channel);

        return null;
      },
    });

    expect(Object.keys(api).sort()).toEqual([
      "finishSession",
      "getLiveSession",
      "getNotice",
      "getSnapshot",
      "openRove",
      "pauseSession",
      "returnControl",
      "setFollowerExpanded",
      "takeControl",
    ]);

    await api.getSnapshot();
    await api.getNotice();
    await api.getLiveSession();
    await api.takeControl();
    await api.returnControl();
    await api.pauseSession();
    await api.finishSession();
    await api.setFollowerExpanded(true);
    await api.openRove();

    expect(channels).toEqual([
      companionIpcChannels.snapshot,
      companionIpcChannels.notice,
      companionIpcChannels.liveSession,
      companionIpcChannels.takeControl,
      companionIpcChannels.returnControl,
      companionIpcChannels.pauseSession,
      companionIpcChannels.finishSession,
      companionIpcChannels.followerExpanded,
      companionIpcChannels.openRove,
    ]);
  });
});
