import type {
  BrowserActivity,
  BrowserActivityListener,
  BrowserEngine,
  BrowserSession,
} from "@rove/browser";
import {
  RoveError,
  type BrowserObservation,
  ActionResult,
  BrowserLaunchConfig,
  BrowserRuntimeCapabilities,
  PageSummary,
} from "@rove/protocol";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserService } from "./browser.service.js";

const capabilities: BrowserRuntimeCapabilities = {
  browserFamily: "chromium",
  distribution: "chromium",
  browserVersion: "test",
  headless: true,
  profile: { mode: "temporary" },
  downloads: { managed: true, evidence: true },
  storage: {
    cookies: true,
    localStorage: true,
    indexedDb: true,
    cacheStorage: true,
    sessionStorage: "page_scoped",
    serviceWorkers: true,
  },
  humanInteraction: { available: false },
  sandbox: { requested: true, verified: "unknown" },
  diagnostics: [],
};

const temporaryConfig: BrowserLaunchConfig = {
  headless: true,
  browser: "chromium",
  profile: { mode: "temporary" },
};

interface FakeHost extends BrowserSession {
  emit(activity: BrowserActivity): void;
  physicalPages: PageSummary[];
}

const homes: string[] = [];

async function persistentConfig(
  name = "workspace",
): Promise<BrowserLaunchConfig> {
  const profileUserDataDir = await mkdtemp(join(tmpdir(), "rove-page-groups-"));
  homes.push(profileUserDataDir);
  return {
    ...temporaryConfig,
    profile: { mode: "persistent", name },
    profileUserDataDir,
    ownership: { runtimeInstanceId: "runtime", sessionId: "ignored" },
  };
}

afterEach(async () => {
  while (homes.length > 0)
    await rm(homes.pop()!, { recursive: true, force: true });
});

function fakeHost(id = "browser_host"): FakeHost {
  const listeners = new Set<BrowserActivityListener>();
  let nextPage = 2;
  const physicalPages: PageSummary[] = [
    { id: "page_01", url: "about:blank", active: true, revision: 0 },
  ];
  const result = (
    action: ActionResult["action"],
    pageId: string,
  ): ActionResult => ({
    ok: true,
    action,
    sessionId: id,
    pageId,
    pageChanged: true,
    previousRevision: 0,
    currentRevision: 1,
  });
  const host = {
    id,
    capabilities,
    physicalPages,
    hostIdentity: () => null,
    browserWindowState: async () => null,
    show: async () => undefined,
    onActivity(listener: BrowserActivityListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(activity: BrowserActivity) {
      for (const listener of listeners) listener(activity);
    },
    pages: async () => physicalPages.map((page) => ({ ...page })),
    openPage: async (url: string) => {
      const page: PageSummary = {
        id: `page_${String(nextPage++).padStart(2, "0")}`,
        url,
        active: true,
        revision: 0,
      };
      physicalPages.push(page);
      host.emit({
        type: "page_opened",
        pageId: page.id,
        pageRevision: 0,
        timestamp: "2026-09-12T00:00:00.000Z",
        data: { url },
      });
      return page;
    },
    navigate: async (_url: string, pageId?: string) =>
      result("navigate", pageId ?? "page_01"),
    switchPage: async (pageId: string) => {
      const page = physicalPages.find((item) => item.id === pageId)!;
      return { ...page, active: true };
    },
    closePage: async (pageId: string) => {
      const index = physicalPages.findIndex((page) => page.id === pageId);
      if (index >= 0) {
        physicalPages.splice(index, 1);
        host.emit({
          type: "page_closed",
          pageId,
          timestamp: "2026-09-12T00:00:00.000Z",
          data: { wasActive: true },
        });
      }
    },
    startPageRecording: vi.fn(async (request) => ({
      recordingId: request.recordingId,
      pageId: request.pageId,
      url:
        physicalPages.find((page) => page.id === request.pageId)?.url ??
        "about:blank",
    })),
    stopPageRecording: vi.fn(async (recordingId: string) => ({
      recordingId,
      pageId: physicalPages[0]!.id,
      url: physicalPages[0]!.url,
    })),
    invalidateTargets: async () => undefined,
    invalidateAllTargets: async () => physicalPages.length,
    invalidatePages: async (pageIds: readonly string[]) =>
      physicalPages.filter((page) => pageIds.includes(page.id)).length,
    close: vi.fn(async () => undefined),
  } as unknown as FakeHost;
  return host;
}

describe("BrowserService task page groups", () => {
  it("fences recording start and stop to the owning page group", async () => {
    const host = fakeHost();
    const service = new BrowserService({ start: async () => host });
    const config = await persistentConfig("recording-fence");
    const first = await service.start("ses_first", config);
    const second = await service.start("ses_second", config);
    const firstPage = (await first.pages())[0]!;
    const secondPage = (await second.pages())[0]!;
    const recordingId = `rec_${"a".repeat(32)}`;

    await expect(
      async () =>
        first.startPageRecording({
          recordingId,
          pageId: secondPage.id,
          path: "/tmp/should-not-start.webm",
        }),
    ).rejects.toMatchObject({ code: "PAGE_NOT_FOUND" });
    expect(host.startPageRecording).not.toHaveBeenCalled();

    await first.startPageRecording({
      recordingId,
      pageId: firstPage.id,
      path: "/tmp/owned.webm",
    });
    await expect(async () =>
      second.stopPageRecording(recordingId),
    ).rejects.toMatchObject({ code: "RECORDING_NOT_FOUND" });
    expect(host.stopPageRecording).not.toHaveBeenCalled();
    await first.stopPageRecording(recordingId);
    expect(host.stopPageRecording).toHaveBeenCalledWith(recordingId);
    await service.onModuleDestroy();
  });

  it("closes every distinct temporary host during shutdown", async () => {
    const first = fakeHost("browser-1");
    const second = fakeHost("browser-2");
    const engine = {
      start: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
    } as unknown as BrowserEngine;
    const service = new BrowserService(engine);

    await service.start("ses_first", temporaryConfig);
    await service.start("ses_second", temporaryConfig);
    await service.onModuleDestroy();

    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(service.sessionIds()).toEqual([]);
  });

  it("shares one persistent host while fencing page ownership and group release", async () => {
    const host = fakeHost();
    const engine = { start: vi.fn(async () => host) } as BrowserEngine;
    const service = new BrowserService(engine);
    const config = await persistentConfig();

    const first = await service.start("ses_first", config);
    const second = await service.start("ses_second", config);
    const firstPage = (await first.pages())[0]!;
    const secondPage = (await second.pages())[0]!;

    expect(engine.start).toHaveBeenCalledOnce();
    expect(firstPage.id).not.toBe(secondPage.id);
    await expect(first.switchPage(secondPage.id)).rejects.toMatchObject(
      expect.objectContaining({
        code: "PAGE_NOT_FOUND",
      }),
    );

    await service.close("ses_first");
    expect(host.close).not.toHaveBeenCalled();
    expect(host.physicalPages.map((page) => page.id)).toEqual([secondPage.id]);
    await expect(
      second.navigate("https://example.test/second"),
    ).resolves.toMatchObject({
      sessionId: "ses_second",
      pageId: secondPage.id,
    });

    await service.close("ses_second");
    expect(host.close).toHaveBeenCalledOnce();
  });

  it("allows independent page-group operations to overlap", async () => {
    const host = fakeHost();
    let activeNavigations = 0;
    let maximumNavigations = 0;
    let releaseBoth!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    host.navigate = async (_url: string, pageId?: string) => {
      activeNavigations += 1;
      maximumNavigations = Math.max(maximumNavigations, activeNavigations);
      if (activeNavigations === 2) releaseBoth();
      await bothStarted;
      activeNavigations -= 1;
      return {
        ok: true,
        action: "navigate",
        sessionId: host.id,
        pageId: pageId!,
        pageChanged: true,
        previousRevision: 0,
        currentRevision: 1,
      };
    };
    const service = new BrowserService({ start: async () => host });
    const config = await persistentConfig("overlap");
    const first = await service.start("ses_first", config);
    const second = await service.start("ses_second", config);

    await Promise.all([
      first.navigate("https://example.test/first"),
      second.navigate("https://example.test/second"),
    ]);

    expect(maximumNavigations).toBe(2);
    await service.onModuleDestroy();
  });

  it("coordinates human takeover at the shared host without merging task ownership", async () => {
    const host = fakeHost();
    let markMutationStarted!: () => void;
    const mutationStarted = new Promise<void>((resolve) => {
      markMutationStarted = resolve;
    });
    let releaseMutation!: () => void;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const navigate = host.navigate.bind(host);
    host.navigate = async (url: string, pageId?: string) => {
      if (url.endsWith("/in-flight")) {
        markMutationStarted();
        await mutationGate;
      }
      return navigate(url, pageId);
    };
    const service = new BrowserService({ start: async () => host });
    const config = await persistentConfig("takeover");
    const first = await service.start("ses_first", config);
    const second = await service.start("ses_second", config);

    const inFlight = second.navigate("https://example.test/in-flight");
    await mutationStarted;
    let takeoverCompleted = false;
    const takeover = service.beginHumanControl("ses_first").then(() => {
      takeoverCompleted = true;
    });
    await Promise.resolve();
    expect(takeoverCompleted).toBe(false);
    releaseMutation();
    await inFlight;
    await takeover;
    await expect(
      second.navigate("https://example.test/blocked"),
    ).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
      details: { scope: "browser_host" },
    });
    await expect(second.pages()).resolves.toHaveLength(1);
    await expect(
      first.navigate("https://example.test/human-owner"),
    ).resolves.toMatchObject({ sessionId: "ses_first" });

    await service.prepareHumanControlReturn("ses_first");
    service.endHumanControl("ses_first");
    await expect(
      second.navigate("https://example.test/resumed"),
    ).resolves.toMatchObject({ sessionId: "ses_second" });
    await expect(first.pages()).resolves.toHaveLength(1);
    await expect(second.pages()).resolves.toHaveLength(1);
    await service.onModuleDestroy();
  });

  it("presents the requesting group's logical page before granting human control", async () => {
    const host = fakeHost();
    const service = new BrowserService({ start: async () => host });
    const config = await persistentConfig("takeover-presentation");
    const first = await service.start("ses_first", config);
    const second = await service.start("ses_second", config);
    const firstPage = (await first.pages())[0]!;
    const secondPage = (await second.pages())[0]!;
    const switchPage = vi.spyOn(host, "switchPage");
    const show = vi.spyOn(host, "show");

    await second.switchPage(secondPage.id);
    switchPage.mockClear();
    await service.beginHumanControl("ses_first");

    expect(switchPage).toHaveBeenCalledExactlyOnceWith(firstPage.id);
    expect(show).toHaveBeenCalledOnce();
    await expect(
      second.navigate("https://example.test/human-blocked"),
    ).rejects.toMatchObject({ code: "CONTROL_NOT_OWNED" });
    await service.prepareHumanControlReturn("ses_first");
    service.endHumanControl("ses_first");
    await service.onModuleDestroy();
  });

  it("aborts takeover without assigning human ownership when presentation fails", async () => {
    const host = fakeHost();
    const service = new BrowserService({ start: async () => host });
    const config = await persistentConfig("takeover-presentation-failure");
    const first = await service.start("ses_first", config);
    const second = await service.start("ses_second", config);
    const firstPage = (await first.pages())[0]!;
    const secondPage = (await second.pages())[0]!;
    const switchPage = host.switchPage.bind(host);
    host.switchPage = async (pageId: string) => {
      if (pageId === firstPage.id) throw new Error("presentation failed");
      return switchPage(pageId);
    };

    await second.switchPage(secondPage.id);
    await expect(service.beginHumanControl("ses_first")).rejects.toThrow(
      "presentation failed",
    );
    await expect(
      second.navigate("https://example.test/still-independent"),
    ).resolves.toMatchObject({ pageId: secondPage.id });
    await expect(first.pages()).resolves.toHaveLength(1);
    await expect(second.pages()).resolves.toHaveLength(1);
    await service.onModuleDestroy();
  });

  it("invalidates sibling target authority before human control releases", async () => {
    const host = fakeHost();
    const service = new BrowserService({ start: async () => host });
    const config = await persistentConfig("takeover-shared-authority");
    await service.start("ses_first", config);
    const second = await service.start("ses_second", config);
    const secondPage = (await second.pages())[0]!;
    let authorityRevision = 0;
    host.inspect = async (options) => {
      authorityRevision += 1;
      return {
        observationId: `obs_${authorityRevision}`,
        pageId: options.pageId ?? secondPage.id,
        revision: authorityRevision,
        url: secondPage.url,
        title: "",
        metadata: {},
      } as BrowserObservation;
    };
    host.invalidateAllTargets = vi.fn(async () => {
      authorityRevision += 1;
      return host.physicalPages.length;
    });
    host.click = async (target) => {
      if (target.revision !== authorityRevision) {
        throw new RoveError({
          code: "TARGET_STALE",
          message: "Target authority predates shared browser-context change.",
        });
      }
      return {
        ok: true,
        action: "click",
        sessionId: host.id,
        pageId: target.pageId,
        pageChanged: false,
        previousRevision: authorityRevision,
        currentRevision: authorityRevision,
      };
    };

    const beforeTakeover = await second.inspect({ pageId: secondPage.id });
    const oldTarget = {
      pageId: secondPage.id,
      revision: beforeTakeover.revision,
      ref: "t1",
    };
    await service.beginHumanControl("ses_first");
    await service.prepareHumanControlReturn("ses_first");
    service.endHumanControl("ses_first");

    await expect(second.click(oldTarget)).rejects.toMatchObject({
      code: "TARGET_STALE",
    });
    const refreshed = await second.inspect({ pageId: secondPage.id });
    await expect(
      second.click({ ...oldTarget, revision: refreshed.revision }),
    ).resolves.toMatchObject({ pageId: secondPage.id });
    expect(host.invalidateAllTargets).toHaveBeenCalledOnce();
    await service.onModuleDestroy();
  });

  it("serializes only focus-sensitive operations across page groups", async () => {
    const host = fakeHost();
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    let active = 0;
    let maximum = 0;
    host.switchPage = async (pageId: string) => {
      calls += 1;
      active += 1;
      maximum = Math.max(maximum, active);
      if (calls === 1) {
        markFirstStarted();
        await firstGate;
      }
      active -= 1;
      return host.physicalPages.find((page) => page.id === pageId)!;
    };
    const service = new BrowserService({ start: async () => host });
    const config = await persistentConfig("focus");
    const first = await service.start("ses_first", config);
    const second = await service.start("ses_second", config);
    const firstPage = (await first.pages())[0]!;
    const secondPage = (await second.pages())[0]!;

    const firstSwitch = first.switchPage(firstPage.id);
    await firstStarted;
    const secondSwitch = second.switchPage(secondPage.id);
    await Promise.resolve();
    expect(calls).toBe(1);
    releaseFirst();
    await Promise.all([firstSwitch, secondSwitch]);

    expect(calls).toBe(2);
    expect(maximum).toBe(1);
    await service.onModuleDestroy();
  });

  it("inherits popup ownership from the opener and routes its event only to that task", async () => {
    const host = fakeHost();
    const service = new BrowserService({ start: async () => host });
    const config = await persistentConfig("shared");
    const first = await service.start("ses_first", config);
    const second = await service.start("ses_second", config);

    const firstEvents: BrowserActivity[] = [];
    const secondEvents: BrowserActivity[] = [];
    first.onActivity((activity) => firstEvents.push(activity));
    second.onActivity((activity) => secondEvents.push(activity));
    const opener = (await first.pages())[0]!;
    host.physicalPages.push({
      id: "page_popup",
      url: "https://example.test/popup",
      active: true,
      revision: 0,
    });
    host.emit({
      type: "page_opened",
      pageId: "page_popup",
      pageRevision: 0,
      timestamp: "2026-09-12T00:00:00.000Z",
      data: { openerPageId: opener.id },
    });

    expect((await first.pages()).map((page) => page.id)).toContain(
      "page_popup",
    );
    expect(firstEvents).toEqual([
      expect.objectContaining({ type: "page_opened", pageId: "page_popup" }),
    ]);
    expect(secondEvents).toEqual([]);
    await service.onModuleDestroy();
  });

  it("quarantines nonblank persistent pages whose prior task ownership is unknown", async () => {
    const host = fakeHost();
    host.physicalPages.unshift({
      id: "page_restored",
      url: "https://example.test/restored",
      active: true,
      revision: 4,
    });
    const service = new BrowserService({ start: async () => host });
    const group = await service.start(
      "ses_recovered",
      await persistentConfig("recovered"),
    );

    await expect(group.pages()).resolves.toEqual([
      expect.objectContaining({ id: "page_01", url: "about:blank" }),
    ]);
    expect(host.physicalPages.map((page) => page.id)).toContain(
      "page_restored",
    );
    await service.onModuleDestroy();
  });

  it("serializes simultaneous group release and closes the final shared host", async () => {
    const host = fakeHost();
    const service = new BrowserService({ start: async () => host });
    const config = await persistentConfig("simultaneous-close");
    await service.start("ses_first", config);
    await service.start("ses_second", config);

    await Promise.all([
      service.close("ses_first"),
      service.close("ses_second"),
    ]);

    expect(service.sessionIds()).toEqual([]);
    expect(host.close).toHaveBeenCalledOnce();
  });

  it("does not attach a new group while the previous final host is closing", async () => {
    const firstHost = fakeHost("first_host");
    const secondHost = fakeHost("second_host");
    let markCloseStarted!: () => void;
    const closeStarted = new Promise<void>((resolve) => {
      markCloseStarted = resolve;
    });
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    firstHost.close = vi.fn(async () => {
      markCloseStarted();
      await closeGate;
    });
    const engine = {
      start: vi
        .fn()
        .mockResolvedValueOnce(firstHost)
        .mockResolvedValueOnce(secondHost),
    } as unknown as BrowserEngine;
    const service = new BrowserService(engine);
    const config = await persistentConfig("close-attach");
    await service.start("ses_first", config);

    const closing = service.close("ses_first");
    await closeStarted;
    const attaching = service.start("ses_second", config);
    await Promise.resolve();
    expect(engine.start).toHaveBeenCalledOnce();
    releaseClose();
    await closing;
    await attaching;

    expect(engine.start).toHaveBeenCalledTimes(2);
    expect(service.sessionIds()).toEqual(["ses_second"]);
    await service.onModuleDestroy();
  });

  it("retries a failed physical host close before allowing reuse", async () => {
    const failedHost = fakeHost("failed_host");
    const replacementHost = fakeHost("replacement_host");
    failedHost.close = vi
      .fn()
      .mockRejectedValueOnce(new Error("injected close failure"))
      .mockResolvedValueOnce(undefined);
    const engine = {
      start: vi
        .fn()
        .mockResolvedValueOnce(failedHost)
        .mockResolvedValueOnce(replacementHost),
    } as unknown as BrowserEngine;
    const service = new BrowserService(engine);
    const config = await persistentConfig("close-retry");
    await service.start("ses_first", config);

    await expect(service.close("ses_first")).rejects.toThrow(
      "injected close failure",
    );
    await expect(service.start("ses_second", config)).resolves.toBeDefined();

    expect(failedHost.close).toHaveBeenCalledTimes(2);
    expect(engine.start).toHaveBeenCalledTimes(2);
    expect(service.sessionIds()).toEqual(["ses_second"]);
    await service.onModuleDestroy();
  });

  it("does not let passive physical focus or a failed switch change logical routing", async () => {
    const host = fakeHost();
    const service = new BrowserService({ start: async () => host });
    const group = await service.start(
      "ses_first",
      await persistentConfig("logical-focus"),
    );
    const firstPage = (await group.pages())[0]!;
    const secondPage = await group.openPage("https://example.test/second");

    host.emit({
      type: "page_switched",
      pageId: firstPage.id,
      pageRevision: 0,
      timestamp: "2026-09-12T00:00:00.000Z",
      data: { source: "physical_focus" },
    });
    await expect(
      group.navigate("https://example.test/routed"),
    ).resolves.toMatchObject({
      pageId: secondPage.id,
    });

    host.switchPage = async () => {
      throw new Error("injected switch failure");
    };
    await expect(group.switchPage(firstPage.id)).rejects.toThrow(
      "injected switch failure",
    );
    await expect(
      group.navigate("https://example.test/still-routed"),
    ).resolves.toMatchObject({
      pageId: secondPage.id,
    });
    await service.onModuleDestroy();
  });

  it("keeps a delayed blank popup with its opener while another group attaches", async () => {
    const host = fakeHost();
    const service = new BrowserService({ start: async () => host });
    const config = await persistentConfig("delayed-popup");
    const first = await service.start("ses_first", config);
    const opener = (await first.pages())[0]!;
    host.physicalPages.push({
      id: "page_delayed_popup",
      url: "about:blank",
      active: true,
      revision: 0,
    });

    const second = await service.start("ses_second", config);
    host.emit({
      type: "page_opened",
      pageId: "page_delayed_popup",
      pageRevision: 0,
      timestamp: "2026-09-12T00:00:00.000Z",
      data: { openerPageId: opener.id },
    });

    expect((await first.pages()).map((page) => page.id)).toContain(
      "page_delayed_popup",
    );
    expect((await second.pages()).map((page) => page.id)).not.toContain(
      "page_delayed_popup",
    );
    await service.onModuleDestroy();
  });

  it("does not attribute delayed popup events to a releasing or removed group", async () => {
    const host = fakeHost();
    const service = new BrowserService({ start: async () => host });
    const config = await persistentConfig("popup-release-race");
    const first = await service.start("ses_first", config);
    const second = await service.start("ses_second", config);
    const firstPage = (await first.pages())[0]!;
    const secondPage = (await second.pages())[0]!;
    host.physicalPages.push({
      id: "page_before_release",
      url: "https://example.test/before",
      active: true,
      revision: 0,
    });
    host.emit({
      type: "page_opened",
      pageId: "page_before_release",
      pageRevision: 0,
      timestamp: "2026-09-13T00:00:00.000Z",
      data: { openerPageId: firstPage.id },
    });
    await expect(first.pages()).resolves.toHaveLength(2);

    const closePage = host.closePage.bind(host);
    let markReleaseStarted!: () => void;
    const releaseStarted = new Promise<void>((resolve) => {
      markReleaseStarted = resolve;
    });
    let continueRelease!: () => void;
    const releaseGate = new Promise<void>((resolve) => {
      continueRelease = resolve;
    });
    host.closePage = async (pageId: string) => {
      if (pageId === firstPage.id) {
        markReleaseStarted();
        await releaseGate;
      }
      await closePage(pageId);
    };

    const releasing = service.close("ses_first");
    await releaseStarted;
    host.physicalPages.push({
      id: "page_during_release",
      url: "about:blank",
      active: true,
      revision: 0,
    });
    host.emit({
      type: "page_opened",
      pageId: "page_during_release",
      pageRevision: 0,
      timestamp: "2026-09-13T00:00:01.000Z",
      data: { openerPageId: firstPage.id },
    });
    continueRelease();
    await releasing;

    host.physicalPages.push({
      id: "page_after_release",
      url: "about:blank",
      active: true,
      revision: 0,
    });
    host.emit({
      type: "page_opened",
      pageId: "page_after_release",
      pageRevision: 0,
      timestamp: "2026-09-13T00:00:02.000Z",
      data: { openerPageId: firstPage.id },
    });

    const pageOwners = (
      service as unknown as {
        hosts: Map<string, { pageOwners: Map<string, string> }>;
      }
    ).hosts.get("workspace:popup-release-race")!.pageOwners;
    expect(service.has("ses_first")).toBe(false);
    expect([...pageOwners.values()]).not.toContain("ses_first");
    await expect(second.pages()).resolves.toEqual([
      expect.objectContaining({ id: secondPage.id }),
    ]);
    expect(host.physicalPages.map((page) => page.id)).not.toContain(
      "page_before_release",
    );
    expect(host.physicalPages.map((page) => page.id)).toEqual(
      expect.arrayContaining(["page_during_release", "page_after_release"]),
    );
    await service.onModuleDestroy();
  });

  it("replaces a manually closed owned page without affecting another group", async () => {
    const host = fakeHost();
    const service = new BrowserService({ start: async () => host });
    const config = await persistentConfig("manual-close");
    const first = await service.start("ses_first", config);
    const second = await service.start("ses_second", config);
    const firstPage = (await first.pages())[0]!;
    const secondPage = (await second.pages())[0]!;
    await service.beginHumanControl("ses_first");
    host.physicalPages.splice(
      host.physicalPages.findIndex((page) => page.id === firstPage.id),
      1,
    );
    host.emit({
      type: "page_closed",
      pageId: firstPage.id,
      timestamp: "2026-09-12T00:00:00.000Z",
      data: { wasActive: true },
    });

    await expect(first.pages()).resolves.toEqual([]);
    await service.prepareHumanControlReturn("ses_first");
    service.endHumanControl("ses_first");
    const replacement = (await first.pages())[0]!;
    expect(replacement.id).not.toBe(firstPage.id);
    await expect(second.pages()).resolves.toEqual([
      expect.objectContaining({ id: secondPage.id }),
    ]);
    await service.onModuleDestroy();
  });

  it("admits context-wide interactions exclusively against other group mutations", async () => {
    const host = fakeHost();
    const service = new BrowserService({ start: async () => host });
    const config = await persistentConfig("context-scope");
    const first = await service.start("ses_first", config);
    const second = await service.start("ses_second", config);
    const firstPage = (await first.pages())[0]!;
    const secondPage = (await second.pages())[0]!;
    let markContextStarted!: () => void;
    const contextStarted = new Promise<void>((resolve) => {
      markContextStarted = resolve;
    });
    let releaseContext!: () => void;
    const contextGate = new Promise<void>((resolve) => {
      releaseContext = resolve;
    });
    host.readObservation = async () => ({
      observationId: "obs_context",
      pageId: firstPage.id,
      revision: 0,
      url: firstPage.url,
      title: "",
      metadata: {},
    });
    host.interact = async () => {
      markContextStarted();
      await contextGate;
      return {
        ok: true,
        action: "fill",
        sessionId: host.id,
        pageId: firstPage.id,
        pageChanged: false,
        previousRevision: 0,
        currentRevision: 0,
      };
    };
    const invalidatePages = vi.spyOn(host, "invalidatePages");

    const contextOperation = first.interact(
      {
        kind: "fill",
        target: { pageId: firstPage.id, revision: 0, ref: "t1" },
        value: "secret",
      },
      { observationId: "obs_context", coordinationScope: "browser_context" },
    );
    await contextStarted;
    let navigationCompleted = false;
    const navigation = second
      .navigate("https://example.test/waits")
      .then(() => {
        navigationCompleted = true;
      });
    await Promise.resolve();
    expect(navigationCompleted).toBe(false);
    releaseContext();
    await Promise.all([contextOperation, navigation]);

    expect(navigationCompleted).toBe(true);
    expect(invalidatePages).toHaveBeenCalledWith([secondPage.id]);
    await service.onModuleDestroy();
  });
});
