import { describe, expect, it } from "vitest";

import {
  companionIpcChannels,
  toDesktopBrowserWorkspaceStatus,
  toDesktopSession,
} from "../shared/desktop-api.js";

import { createDesktopApi } from "./api.js";

describe("Companion preload API", () => {
  it("removes device-only browser paths from every renderer profile variant", () => {
    const projected = toDesktopBrowserWorkspaceStatus({
      selectedWorkspaceId: "wrk_00000000-0000-4000-8000-000000000001",
      workspaces: [
        {
          id: "wrk_00000000-0000-4000-8000-000000000001",
          displayName: "Personal",
          browser: "chrome",
          userDataDir: "/secret/browser/profile",
          storageLayout: "workspace",
          createdAt: "2026-09-07T00:00:00Z",
          lastUsedAt: "2026-09-07T00:00:00Z",
        },
      ],
    });
    expect(JSON.stringify(projected)).not.toContain("/secret/browser/profile");
    expect(projected.workspaces[0]).not.toHaveProperty("userDataDir");

    const session = toDesktopSession({
      id: "ses_privacy",
      mode: "agent",
      status: "active",
      controller: "agent",
      profile: { mode: "temporary" },
      workspace: {
        id: "wrk_00000000-0000-4000-8000-000000000001",
        displayName: "Personal",
        browser: "chrome",
        userDataDir: "/secret/live/session/profile",
        storageLayout: "workspace",
        createdAt: "2026-09-07T00:00:00.000Z",
        lastUsedAt: "2026-09-07T00:00:00.000Z",
      },
      browserRuntime: {
        browserFamily: "chromium",
        distribution: "chrome",
        browserVersion: "token=browser-version-secret /Users/private",
        headless: false,
        profile: {
          mode: "persistent",
          name: "token=runtime-profile-secret",
        },
        downloads: { managed: true, evidence: true },
        storage: {
          cookies: true,
          localStorage: true,
          indexedDb: true,
          cacheStorage: true,
          sessionStorage: "isolated_per_context",
          serviceWorkers: true,
        },
        humanInteraction: { available: true },
        sandbox: {
          requested: true,
          verified: "enabled",
          verificationMethod: "password=sandbox-secret",
          diagnostic: "/Users/private/browser token=sandbox-diagnostic",
        },
        diagnostics: [
          {
            level: "warning",
            code: "credential=diagnostic-code",
            message: "/Users/private/profile Bearer diagnostic-secret",
          },
        ],
      },
      createdAt: "2026-09-07T00:00:00.000Z",
      updatedAt: "2026-09-07T00:00:00.000Z",
    });
    const surface = JSON.stringify({ companion: { session } });
    for (const forbidden of [
      "/secret/live/session/profile",
      "/Users/private",
      "browser-version-secret",
      "runtime-profile-secret",
      "sandbox-secret",
      "sandbox-diagnostic",
      "diagnostic-code",
      "diagnostic-secret",
      "browserRuntime",
      "workspace",
      "profile",
    ])
      expect(surface).not.toContain(forbidden);
    const variants = [
      { mode: "temporary" as const },
      { mode: "persistent" as const, name: "Personal" },
      {
        mode: "existing" as const,
        userDataDir: "/secret/existing/user-data",
        profileDirectory: "/secret/existing/profile",
      },
    ];
    for (const profile of variants) {
      const projectedSession = toDesktopSession({
        ...session,
        profile,
      } as never);
      const serialized = JSON.stringify(projectedSession);
      expect(serialized).not.toContain("user-data");
      expect(serialized).not.toContain("profileDirectory");
      expect(projectedSession).not.toHaveProperty("profile");
    }
  });

  it("exposes only the intended narrow desktop IPC surface", async () => {
    const channels: string[] = [];
    const listeners = new Map<
      string,
      (event: unknown, value: unknown) => void
    >();

    const api = createDesktopApi({
      invoke: async (channel) => {
        channels.push(channel);

        return null;
      },
      on: (channel, listener) => {
        listeners.set(channel, listener);
      },
      removeListener: (channel, listener) => {
        if (listeners.get(channel) === listener) listeners.delete(channel);
      },
    });

    expect(Object.keys(api).sort()).toEqual([
      "beginFollowerDrag",
      "createBrowserWorkspace",
      "deleteBrowserWorkspace",
      "endFollowerDrag",
      "executeProductIntent",
      "finishSession",
      "getBrowserWorkspaces",
      "getFollowerPresentation",
      "getLiveSession",
      "getNotice",
      "getSnapshot",
      "getSurfaceSnapshot",
      "getWindowFullscreen",
      "openRecording",
      "openRove",
      "openTrustedExternal",
      "pauseSession",
      "renameBrowserWorkspace",
      "returnControl",
      "selectBrowserWorkspace",
      "setFollowerExpanded",
      "showBrowser",
      "subscribeSurfaceSnapshot",
      "subscribeWindowFullscreen",
      "takeControl",
      "transitionSurface",
      "updateFollowerDrag",
    ]);

    await api.getWindowFullscreen();
    const fullscreenValues: boolean[] = [];
    const unsubscribeFullscreen = api.subscribeWindowFullscreen((fullscreen) =>
      fullscreenValues.push(fullscreen),
    );
    listeners.get(companionIpcChannels.windowFullscreenChanged)?.({}, true);
    expect(fullscreenValues).toEqual([true]);
    unsubscribeFullscreen();
    expect(listeners.has(companionIpcChannels.windowFullscreenChanged)).toBe(
      false,
    );
    await api.getSurfaceSnapshot();
    const received: unknown[] = [];
    const unsubscribe = api.subscribeSurfaceSnapshot((snapshot) =>
      received.push(snapshot),
    );
    const pushed = { surface: { revision: 3 } };
    listeners.get(companionIpcChannels.surfaceChanged)?.({}, pushed);
    expect(received).toEqual([pushed]);
    unsubscribe();
    expect(listeners.has(companionIpcChannels.surfaceChanged)).toBe(false);
    await api.transitionSurface("expand");
    await api.getSnapshot();
    await api.getNotice();
    await api.getLiveSession();
    await api.getFollowerPresentation();
    await api.takeControl();
    await api.returnControl();
    await api.pauseSession();
    await api.finishSession();
    await api.setFollowerExpanded(true);
    await api.beginFollowerDrag();
    await api.updateFollowerDrag();
    await api.endFollowerDrag();
    await api.openRove();
    await api.showBrowser();
    await api.openTrustedExternal({
      purpose: "account_login",
      loginId: "login_current",
    });
    await api.openRecording("task_exact", `rec_${"a".repeat(32)}`);
    await api.getBrowserWorkspaces();
    await api.createBrowserWorkspace("Personal");
    await api.selectBrowserWorkspace(
      "wrk_00000000-0000-0000-0000-000000000000",
    );
    await api.renameBrowserWorkspace(
      "wrk_00000000-0000-0000-0000-000000000000",
      "Work",
    );
    await api.deleteBrowserWorkspace(
      "wrk_00000000-0000-0000-0000-000000000000",
    );
    await api.executeProductIntent({ type: "account.refresh" });

    expect(channels).toEqual([
      companionIpcChannels.windowFullscreen,
      companionIpcChannels.surfaceSnapshot,
      companionIpcChannels.surfaceTransition,
      companionIpcChannels.snapshot,
      companionIpcChannels.notice,
      companionIpcChannels.liveSession,
      companionIpcChannels.followerPresentation,
      companionIpcChannels.takeControl,
      companionIpcChannels.returnControl,
      companionIpcChannels.pauseSession,
      companionIpcChannels.finishSession,
      companionIpcChannels.followerExpanded,
      companionIpcChannels.followerDragBegin,
      companionIpcChannels.followerDragUpdate,
      companionIpcChannels.followerDragEnd,
      companionIpcChannels.openRove,
      companionIpcChannels.showBrowser,
      companionIpcChannels.openTrustedExternal,
      companionIpcChannels.openRecording,
      companionIpcChannels.browserWorkspaces,
      companionIpcChannels.createBrowserWorkspace,
      companionIpcChannels.selectBrowserWorkspace,
      companionIpcChannels.renameBrowserWorkspace,
      companionIpcChannels.deleteBrowserWorkspace,
      companionIpcChannels.productIntent,
    ]);
  });

  it("passes an exact unmatched session id through the normal finish IPC once", async () => {
    const calls: { channel: string; args: unknown[] }[] = [];
    const api = createDesktopApi({
      invoke: async (channel, ...args) => {
        calls.push({ channel, args });
        return null;
      },
    });
    await api.finishSession("ses_unmatched");
    expect(calls).toEqual([
      {
        channel: companionIpcChannels.finishSession,
        args: ["ses_unmatched"],
      },
    ]);
  });
});
