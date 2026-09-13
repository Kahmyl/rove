import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  BROWSER_ENGINE,
  RoveProfileLock,
  type BrowserActivity,
  type BrowserActivityListener,
  type BrowserEngine,
  type BrowserInteractionContext,
  type BrowserSession,
  type PageRecordingStartRequest,
  type PageRecordingState,
} from "@rove/browser";
import {
  RoveError,
  type ActionResult,
  type Artifact,
  type BrowserHostIdentity,
  type BrowserInteractionRequest,
  type BrowserLaunchConfig,
  type BrowserObservation,
  type BrowserWindowState,
  type InspectOptions,
  type PageStateIdentity,
  type PageSummary,
  type ScreenshotOptions,
  type ScrollOptions,
  type TargetReference,
  type TargetResolution,
  type TargetResolutionRequest,
} from "@rove/protocol";

interface PageGroupState {
  activePageId?: string;
  ensuringPage?: Promise<void>;
  releasing?: boolean;
  readonly listeners: Set<BrowserActivityListener>;
  readonly recordings: Map<string, string>;
}

interface ManagedBrowserHost {
  readonly key: string;
  readonly browser: BrowserSession;
  readonly groups: Map<string, PageGroupState>;
  readonly pageOwners: Map<string, string>;
  readonly bufferedActivity: Map<string, BrowserActivity[]>;
  readonly drainWaiters: Set<() => void>;
  readonly contextWaiters: Set<() => void>;
  activeMutations: number;
  humanOwner?: string;
  humanReturnPrepared?: string;
  takeoverPending?: string;
  contextOwner?: string;
  contextPending?: string;
  state: "open" | "closing";
  focusTail: Promise<void>;
  contextTail: Promise<void>;
  profileLock?: RoveProfileLock;
  unsubscribe: () => void;
}

@Injectable()
export class BrowserService implements OnModuleDestroy {
  private readonly sessions = new Map<string, GroupBrowserSession>();
  private readonly hosts = new Map<string, ManagedBrowserHost>();
  private readonly lifecycleTails = new Map<string, Promise<void>>();

  constructor(@Inject(BROWSER_ENGINE) private readonly engine: BrowserEngine) {}

  async start(
    sessionId: string,
    config: BrowserLaunchConfig,
  ): Promise<BrowserSession> {
    if (this.sessions.has(sessionId)) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "A browser page group is already attached to this session.",
      });
    }
    const key =
      config.profile?.mode === "persistent"
        ? `workspace:${config.profile.name}`
        : `temporary:${sessionId}`;

    return this.serializeLifecycle(key, async () => {
      if (this.sessions.has(sessionId)) return this.sessions.get(sessionId)!;
      let host = this.hosts.get(key);
      let createdHost = false;
      if (host?.state === "closing") {
        await this.closeHost(host);
        host = undefined;
      }
      if (host === undefined) {
        host = await this.createHost(key, config);
        this.hosts.set(key, host);
        createdHost = true;
      }

      const group: PageGroupState = {
        listeners: new Set(),
        recordings: new Map(),
      };
      host.groups.set(sessionId, group);
      const scoped = new GroupBrowserSession(this, host, sessionId);
      this.sessions.set(sessionId, scoped);

      try {
        const existing = await host.browser.pages();
        if (createdHost && config.profile?.mode !== "persistent") {
          for (const existingPage of existing) {
            this.assignPage(
              host,
              sessionId,
              existingPage.id,
              existingPage.active,
            );
          }
        }
        const reusable = existing.find(
          (page) =>
            createdHost &&
            !host!.pageOwners.has(page.id) &&
            page.url === "about:blank",
        );
        if (host.groups.get(sessionId)?.activePageId === undefined) {
          const page =
            reusable ??
            (await this.runHostOperation(host, sessionId, () =>
              host!.browser.openPage("about:blank"),
            ));
          if (!this.assignPage(host, sessionId, page.id, true)) {
            throw new RoveError({
              code: "BROWSER_CLOSED",
              message: "The browser page group closed while attaching.",
            });
          }
        }
        return scoped;
      } catch (error) {
        host.groups.delete(sessionId);
        this.sessions.delete(sessionId);
        if (host.groups.size === 0)
          await this.closeHost(host).catch(() => undefined);
        throw error;
      }
    });
  }

  get(sessionId: string): BrowserSession {
    const browser = this.sessions.get(sessionId);
    if (!browser) {
      throw new RoveError({
        code: "BROWSER_CLOSED",
        message: "No browser page group is attached to this session.",
      });
    }
    return browser;
  }

  hostIdentity(sessionId: string): BrowserHostIdentity | null {
    return this.get(sessionId).hostIdentity();
  }

  windowState(sessionId: string): Promise<BrowserWindowState | null> {
    return this.get(sessionId).browserWindowState();
  }

  async show(sessionId: string): Promise<boolean> {
    if (!this.sessions.has(sessionId)) return false;
    await this.get(sessionId).show();
    return true;
  }

  async beginHumanControl(sessionId: string): Promise<void> {
    const scoped = this.sessions.get(sessionId);
    if (scoped === undefined) return;
    const host = scoped.host;
    if (
      (host.humanOwner !== undefined && host.humanOwner !== sessionId) ||
      (host.takeoverPending !== undefined && host.takeoverPending !== sessionId)
    ) {
      throw new RoveError({
        code: "CONTROL_TRANSFER_PENDING",
        message:
          "Another task currently has human control of this browser host.",
        retryable: true,
        details: { scope: "browser_host" },
      });
    }
    host.takeoverPending = sessionId;
    while (
      host.activeMutations > 0 ||
      host.contextOwner !== undefined ||
      host.contextPending !== undefined
    ) {
      await new Promise<void>((resolve) => host.drainWaiters.add(resolve));
    }
    try {
      await this.queueFocus(host, async () => {
        if (
          host.state !== "open" ||
          host.takeoverPending !== sessionId ||
          !host.groups.has(sessionId)
        ) {
          throw new RoveError({
            code: "CONTROL_TRANSFER_PENDING",
            message: "The browser page group changed during human takeover.",
            retryable: true,
            details: { scope: "browser_host" },
          });
        }
        const pageId = this.activePage(host, sessionId);
        await host.browser.switchPage(pageId);
        await host.browser.show();
      });
      host.humanOwner = sessionId;
      delete host.humanReturnPrepared;
      delete host.takeoverPending;
    } catch (error) {
      if (host.takeoverPending === sessionId) delete host.takeoverPending;
      throw error;
    }
  }

  async prepareHumanControlReturn(sessionId: string): Promise<number> {
    const scoped = this.sessions.get(sessionId);
    if (scoped === undefined) return 0;
    const host = scoped.host;
    if (host.humanOwner !== sessionId) {
      throw new RoveError({
        code: "CONTROL_NOT_OWNED",
        message: "This task does not own human control of the browser host.",
        retryable: true,
        details: { scope: "browser_host" },
      });
    }
    const invalidated = await host.browser.invalidateAllTargets();
    host.humanReturnPrepared = sessionId;
    return invalidated;
  }

  endHumanControl(sessionId: string): void {
    const scoped = this.sessions.get(sessionId);
    if (scoped === undefined) return;
    const host = scoped.host;
    if (
      host.humanOwner === sessionId &&
      host.humanReturnPrepared !== sessionId
    ) {
      throw new RoveError({
        code: "CONTROL_TRANSFER_PENDING",
        message:
          "Shared browser authority must be invalidated before human control returns.",
        retryable: true,
        details: { scope: "browser_host" },
      });
    }
    if (host.humanOwner === sessionId) delete host.humanOwner;
    if (host.humanReturnPrepared === sessionId) delete host.humanReturnPrepared;
    if (host.takeoverPending === sessionId) delete host.takeoverPending;
    for (const [groupId] of host.groups) {
      if (this.ownedPageIds(host, groupId).length === 0)
        void this.ensureGroupPage(host, groupId).catch(() => undefined);
    }
  }

  async abortHumanControl(sessionId: string): Promise<void> {
    const scoped = this.sessions.get(sessionId);
    if (scoped === undefined) return;
    const host = scoped.host;
    if (host.humanOwner === sessionId) {
      await this.prepareHumanControlReturn(sessionId);
      this.endHumanControl(sessionId);
      return;
    }
    if (host.takeoverPending === sessionId) delete host.takeoverPending;
  }

  async close(sessionId: string): Promise<void> {
    const scoped = this.sessions.get(sessionId);
    if (!scoped) return;
    await this.serializeLifecycle(scoped.host.key, async () => {
      const current = this.sessions.get(sessionId);
      if (current === undefined) return;
      const host = current.host;
      if (host.humanOwner === sessionId)
        await this.prepareHumanControlReturn(sessionId);
      this.endHumanControl(sessionId);
      const group = host.groups.get(sessionId);
      if (group !== undefined) group.releasing = true;

      if (host.groups.size === 1) {
        await this.closeHost(host);
        return;
      }

      while (true) {
        const owned = this.ownedPageIds(host, sessionId);
        if (owned.length === 0) break;
        for (const pageId of owned) {
          try {
            await this.runHostOperation(host, sessionId, () =>
              host.browser.closePage(pageId),
            );
          } catch (error) {
            if (
              !(error instanceof RoveError) ||
              error.code !== "PAGE_NOT_FOUND"
            )
              throw error;
          }
          host.pageOwners.delete(pageId);
          host.bufferedActivity.delete(pageId);
        }
      }
      host.groups.delete(sessionId);
      this.sessions.delete(sessionId);
    });
  }

  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  hasWorkspace(workspaceId: string): boolean {
    return this.hosts.has(`workspace:${workspaceId}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(
      [...this.hosts.values()].map((host) => this.closeHost(host)),
    );
  }

  private async createHost(
    key: string,
    config: BrowserLaunchConfig,
  ): Promise<ManagedBrowserHost> {
    const hostId = `browser_host_${randomUUID().replaceAll("-", "")}`;
    let profileLock: RoveProfileLock | undefined;
    try {
      if (config.profile?.mode === "persistent") {
        if (
          config.profileUserDataDir === undefined ||
          config.ownership === undefined
        ) {
          throw new RoveError({
            code: "INVALID_CONFIGURATION",
            message:
              "Persistent browser hosts require resolved profile ownership.",
          });
        }
        profileLock = await RoveProfileLock.acquire(config.profileUserDataDir, {
          runtimeInstanceId: config.ownership.runtimeInstanceId,
          sessionId: hostId,
        });
      }
      const browser = await this.engine.start({
        ...config,
        ...(config.ownership === undefined
          ? {}
          : { ownership: { ...config.ownership, sessionId: hostId } }),
      });
      const host: ManagedBrowserHost = {
        key,
        browser,
        groups: new Map(),
        pageOwners: new Map(),
        bufferedActivity: new Map(),
        drainWaiters: new Set(),
        contextWaiters: new Set(),
        activeMutations: 0,
        state: "open",
        focusTail: Promise.resolve(),
        contextTail: Promise.resolve(),
        ...(profileLock === undefined ? {} : { profileLock }),
        unsubscribe: () => undefined,
      };
      host.unsubscribe = browser.onActivity((activity) =>
        this.routeActivity(host, activity),
      );
      return host;
    } catch (error) {
      await profileLock?.release().catch(() => undefined);
      throw error;
    }
  }

  private async closeHost(host: ManagedBrowserHost): Promise<void> {
    host.state = "closing";
    await host.browser.close();
    await host.profileLock?.release();
    if (this.hosts.get(host.key) === host) this.hosts.delete(host.key);
    for (const sessionId of host.groups.keys()) this.sessions.delete(sessionId);
    host.groups.clear();
    host.unsubscribe();
  }

  private serializeLifecycle<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.lifecycleTails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.lifecycleTails.set(key, tail);
    return result.finally(() => {
      if (this.lifecycleTails.get(key) === tail)
        this.lifecycleTails.delete(key);
    });
  }

  private routeActivity(
    host: ManagedBrowserHost,
    activity: BrowserActivity,
  ): void {
    let owner = host.pageOwners.get(activity.pageId);
    if (owner === undefined && activity.type === "page_opened") {
      const opener = activity.data.openerPageId;
      if (typeof opener === "string") {
        const openerOwner = host.pageOwners.get(opener);
        if (
          openerOwner !== undefined &&
          this.assignPage(host, openerOwner, activity.pageId, true)
        ) {
          owner = openerOwner;
        }
      }
    }
    if (owner === undefined) {
      if (
        !host.bufferedActivity.has(activity.pageId) &&
        host.bufferedActivity.size >= 100
      ) {
        const oldestPageId = host.bufferedActivity.keys().next().value;
        if (oldestPageId !== undefined)
          host.bufferedActivity.delete(oldestPageId);
      }
      const buffered = host.bufferedActivity.get(activity.pageId) ?? [];
      buffered.push(activity);
      host.bufferedActivity.set(activity.pageId, buffered.slice(-20));
      return;
    }
    if (activity.type === "page_closed") {
      host.pageOwners.delete(activity.pageId);
      host.bufferedActivity.delete(activity.pageId);
      const group = host.groups.get(owner);
      if (group?.activePageId === activity.pageId) {
        const replacement = this.ownedPageIds(host, owner).at(-1);
        if (replacement === undefined) delete group.activePageId;
        else group.activePageId = replacement;
      }
    } else if (activity.type === "page_opened") {
      const group = host.groups.get(owner);
      if (group !== undefined) group.activePageId = activity.pageId;
    }
    this.publish(host, owner, activity);
    if (
      activity.type === "page_closed" &&
      host.state === "open" &&
      this.ownedPageIds(host, owner).length === 0
    ) {
      void this.ensureGroupPage(host, owner).catch(() => undefined);
    }
  }

  private publish(
    host: ManagedBrowserHost,
    sessionId: string,
    activity: BrowserActivity,
  ): void {
    for (const listener of host.groups.get(sessionId)?.listeners ?? []) {
      try {
        listener(activity);
      } catch {
        // Browser activity consumers cannot break host routing.
      }
    }
  }

  private assignPage(
    host: ManagedBrowserHost,
    sessionId: string,
    pageId: string,
    active: boolean,
  ): boolean {
    const existing = host.pageOwners.get(pageId);
    if (existing !== undefined && existing !== sessionId)
      throw this.pageNotFound();
    const group = host.groups.get(sessionId);
    if (host.state !== "open" || group === undefined || group.releasing)
      return false;
    host.pageOwners.set(pageId, sessionId);
    if (active || group.activePageId === undefined) group.activePageId = pageId;
    const buffered = host.bufferedActivity.get(pageId) ?? [];
    host.bufferedActivity.delete(pageId);
    for (const activity of buffered) this.routeActivity(host, activity);
    return true;
  }

  private ownedPageIds(host: ManagedBrowserHost, sessionId: string): string[] {
    return [...host.pageOwners]
      .filter(([, owner]) => owner === sessionId)
      .map(([pageId]) => pageId);
  }

  private assertPageOwned(
    host: ManagedBrowserHost,
    sessionId: string,
    pageId: string,
  ): void {
    if (host.pageOwners.get(pageId) !== sessionId) throw this.pageNotFound();
  }

  private activePage(host: ManagedBrowserHost, sessionId: string): string {
    const pageId = host.groups.get(sessionId)?.activePageId;
    if (pageId === undefined || host.pageOwners.get(pageId) !== sessionId)
      throw this.pageNotFound();
    return pageId;
  }

  private async ensureGroupPage(
    host: ManagedBrowserHost,
    sessionId: string,
  ): Promise<void> {
    if (host.state !== "open") return;
    const group = host.groups.get(sessionId);
    if (group === undefined || group.releasing) return;
    if (host.humanOwner !== undefined || host.takeoverPending !== undefined)
      return;
    if (group.ensuringPage !== undefined) return group.ensuringPage;
    const attempt = (async () => {
      const owned = this.ownedPageIds(host, sessionId);
      if (owned.length > 0) {
        if (
          group.activePageId === undefined ||
          host.pageOwners.get(group.activePageId) !== sessionId
        )
          group.activePageId = owned.at(-1)!;
        return;
      }
      const page = await this.runHostOperation(host, sessionId, () =>
        host.browser.openPage("about:blank"),
      );
      if (!this.assignPage(host, sessionId, page.id, true)) {
        await host.browser.closePage(page.id).catch(() => undefined);
      }
    })();
    group.ensuringPage = attempt;
    try {
      await attempt;
    } finally {
      if (group.ensuringPage === attempt) delete group.ensuringPage;
    }
  }

  private pageNotFound(): RoveError {
    return new RoveError({
      code: "PAGE_NOT_FOUND",
      message: "Browser page was not found in this task's page group.",
    });
  }

  private runHostRead<T>(
    host: ManagedBrowserHost,
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (host.state !== "open")
      throw new RoveError({
        code: "BROWSER_CLOSED",
        message: "The managed browser host is closing.",
      });
    if (!host.groups.has(sessionId)) throw this.pageNotFound();
    return operation();
  }

  private async runHostOperation<T>(
    host: ManagedBrowserHost,
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (host.state !== "open") {
      throw new RoveError({
        code: "BROWSER_CLOSED",
        message: "The managed browser host is closing.",
      });
    }
    if (
      host.takeoverPending !== undefined ||
      (host.humanOwner !== undefined && host.humanOwner !== sessionId)
    ) {
      throw new RoveError({
        code: "CONTROL_NOT_OWNED",
        message: "The shared browser host is currently controlled by a human.",
        retryable: true,
        details: { scope: "browser_host" },
      });
    }
    if (!host.groups.has(sessionId)) throw this.pageNotFound();
    while (
      host.contextPending !== undefined ||
      host.contextOwner !== undefined
    ) {
      await new Promise<void>((resolve) => host.contextWaiters.add(resolve));
      if (host.state !== "open") {
        throw new RoveError({
          code: "BROWSER_CLOSED",
          message: "The managed browser host is closing.",
        });
      }
      if (!host.groups.has(sessionId)) throw this.pageNotFound();
      if (
        host.takeoverPending !== undefined ||
        (host.humanOwner !== undefined && host.humanOwner !== sessionId)
      ) {
        throw new RoveError({
          code: "CONTROL_NOT_OWNED",
          message:
            "The shared browser host is currently controlled by a human.",
          retryable: true,
          details: { scope: "browser_host" },
        });
      }
    }
    host.activeMutations += 1;
    try {
      return await operation();
    } finally {
      host.activeMutations -= 1;
      if (host.activeMutations === 0) {
        for (const resolve of host.drainWaiters) resolve();
        host.drainWaiters.clear();
      }
    }
  }

  private async runContextOperation<T>(
    host: ManagedBrowserHost,
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = host.contextTail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    host.contextTail = previous.catch(() => undefined).then(() => current);
    await previous.catch(() => undefined);
    try {
      if (host.state !== "open")
        throw new RoveError({
          code: "BROWSER_CLOSED",
          message: "The managed browser host is closing.",
        });
      if (
        host.takeoverPending !== undefined ||
        host.humanOwner !== undefined ||
        host.contextPending !== undefined ||
        host.contextOwner !== undefined
      ) {
        throw new RoveError({
          code: "CONTROL_NOT_OWNED",
          message: "The shared browser context is not available.",
          retryable: true,
          details: { scope: "browser_context" },
        });
      }
      if (!host.groups.has(sessionId)) throw this.pageNotFound();
      host.contextPending = sessionId;
      if (host.activeMutations > 0) {
        await new Promise<void>((resolve) => host.drainWaiters.add(resolve));
      }
      host.contextOwner = sessionId;
      delete host.contextPending;
      return await operation();
    } finally {
      if (host.contextOwner === sessionId) delete host.contextOwner;
      if (host.contextPending === sessionId) delete host.contextPending;
      for (const resolve of host.contextWaiters) resolve();
      host.contextWaiters.clear();
      for (const resolve of host.drainWaiters) resolve();
      host.drainWaiters.clear();
      release();
    }
  }

  private async runFocusOperation<T>(
    host: ManagedBrowserHost,
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.queueFocus(host, () =>
      this.runHostOperation(host, sessionId, operation),
    );
  }

  private async queueFocus<T>(
    host: ManagedBrowserHost,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = host.focusTail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    host.focusTail = previous.catch(() => undefined).then(() => current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

class GroupBrowserSession implements BrowserSession {
  constructor(
    private readonly service: BrowserService,
    readonly host: ManagedBrowserHost,
    readonly id: string,
  ) {}

  get capabilities() {
    return this.host.browser.capabilities;
  }
  hostIdentity() {
    return this.host.browser.hostIdentity();
  }
  async browserWindowState() {
    const state = await this.read(() => this.host.browser.browserWindowState());
    return state !== null && this.host.pageOwners.get(state.pageId) === this.id
      ? state
      : null;
  }
  show() {
    return this.service["runFocusOperation"](this.host, this.id, async () => {
      await this.host.browser.switchPage(this.activePage());
      await this.host.browser.show();
    });
  }
  onActivity(listener: BrowserActivityListener) {
    this.group().listeners.add(listener);
    return () => this.group().listeners.delete(listener);
  }
  inspect(options: InspectOptions = {}, signal?: AbortSignal) {
    const pageId = options.pageId ?? this.activePage();
    this.assertPage(pageId);
    return this.read(() =>
      this.host.browser.inspect({ ...options, pageId }, signal),
    );
  }
  async resolveTarget(
    request: TargetResolutionRequest,
  ): Promise<TargetResolution> {
    await this.readObservation(request.observationId);
    const result = await this.read(() =>
      this.host.browser.resolveTarget(request),
    );
    if (result.target !== undefined) this.assertPage(result.target.pageId);
    return result;
  }
  async readObservation(observationId: string): Promise<BrowserObservation> {
    const result = await this.read(() =>
      this.host.browser.readObservation(observationId),
    );
    this.assertPage(result.pageId);
    return result;
  }
  readTargetFiles(target: TargetReference) {
    this.assertPage(target.pageId);
    return this.read(() => this.host.browser.readTargetFiles(target));
  }
  readTargetValue(target: TargetReference) {
    this.assertPage(target.pageId);
    return this.read(() => this.host.browser.readTargetValue(target));
  }
  interact(
    request: BrowserInteractionRequest,
    context: BrowserInteractionContext,
  ) {
    const operation = async () => {
      const observation = await this.host.browser.readObservation(
        context.observationId,
      );
      this.assertPage(observation.pageId);
      if (request.target !== undefined) this.assertPage(request.target.pageId);
      return this.filterResult(
        await this.host.browser.interact(request, context),
      );
    };
    if (context.coordinationScope === "browser_context") {
      return this.service["runContextOperation"](
        this.host,
        this.id,
        async () => {
          try {
            const result = await operation();
            const otherPageIds = (await this.host.browser.pages())
              .map((page) => page.id)
              .filter((pageId) => pageId !== result.pageId);
            await this.host.browser.invalidatePages(otherPageIds);
            return result;
          } catch (error) {
            await this.host.browser
              .invalidateAllTargets()
              .catch(() => undefined);
            throw error;
          }
        },
      );
    }
    return request.kind === "clipboard" ||
      request.kind === "press" ||
      request.kind === "coordinate_click" ||
      request.kind === "focus"
      ? this.service["runFocusOperation"](this.host, this.id, operation)
      : this.run(operation);
  }
  pageStateIdentity(pageId = this.activePage()): Promise<PageStateIdentity> {
    this.assertPage(pageId);
    return this.read(() => this.host.browser.pageStateIdentity(pageId));
  }
  navigate(url: string) {
    const pageId = this.activePage();
    return this.run(async () =>
      this.filterResult(await this.host.browser.navigate(url, pageId)),
    );
  }
  async openPage(url: string): Promise<PageSummary> {
    return this.run(async () => {
      const page = await this.host.browser.openPage(url);
      if (!this.service["assignPage"](this.host, this.id, page.id, true)) {
        await this.host.browser.closePage(page.id).catch(() => undefined);
        throw new RoveError({
          code: "BROWSER_CLOSED",
          message: "The browser page group closed while opening a page.",
        });
      }
      return { ...page, active: true };
    });
  }
  click(target: TargetReference) {
    this.assertPage(target.pageId);
    return this.run(async () =>
      this.filterResult(await this.host.browser.click(target)),
    );
  }
  type(target: TargetReference, value: string) {
    this.assertPage(target.pageId);
    return this.run(async () =>
      this.filterResult(await this.host.browser.type(target, value)),
    );
  }
  press(target: TargetReference | null, key: string) {
    const pageId = target?.pageId ?? this.activePage();
    this.assertPage(pageId);
    return this.service["runFocusOperation"](this.host, this.id, async () =>
      this.filterResult(await this.host.browser.press(target, key, pageId)),
    );
  }
  scroll(options: ScrollOptions) {
    const pageId = this.activePage();
    return this.run(async () =>
      this.filterResult(await this.host.browser.scroll(options, pageId)),
    );
  }
  back() {
    const pageId = this.activePage();
    return this.run(async () =>
      this.filterResult(await this.host.browser.back(pageId)),
    );
  }
  forward() {
    const pageId = this.activePage();
    return this.run(async () =>
      this.filterResult(await this.host.browser.forward(pageId)),
    );
  }
  screenshot(options: ScreenshotOptions = {}): Promise<Artifact> {
    const pageId = options.target?.pageId ?? this.activePage();
    this.assertPage(pageId);
    return this.read(() => this.host.browser.screenshot(options, pageId));
  }
  startPageRecording(
    request: PageRecordingStartRequest,
  ): Promise<PageRecordingState> {
    this.assertPage(request.pageId);
    return this.read(async () => {
      const state = await this.host.browser.startPageRecording(request);
      this.assertPage(state.pageId);
      this.group().recordings.set(state.recordingId, state.pageId);
      return state;
    });
  }
  stopPageRecording(recordingId: string): Promise<PageRecordingState> {
    const pageId = this.group().recordings.get(recordingId);
    if (pageId === undefined)
      throw new RoveError({
        code: "RECORDING_NOT_FOUND",
        message: "The recording does not belong to this browser page group.",
      });
    return this.read(async () => {
      try {
        const state = await this.host.browser.stopPageRecording(recordingId);
        if (state.pageId !== pageId)
          throw new RoveError({
            code: "RECORDING_NOT_FOUND",
            message: "The recording page binding changed unexpectedly.",
          });
        return state;
      } finally {
        this.group().recordings.delete(recordingId);
      }
    });
  }
  async pages(): Promise<PageSummary[]> {
    let pages = await this.read(() => this.host.browser.pages());
    if (!pages.some((page) => this.host.pageOwners.get(page.id) === this.id)) {
      await this.service["ensureGroupPage"](this.host, this.id);
      pages = await this.read(() => this.host.browser.pages());
    }
    const active = this.group().activePageId;
    return pages
      .filter((page) => this.host.pageOwners.get(page.id) === this.id)
      .map((page) => ({ ...page, active: page.id === active }));
  }
  async switchPage(pageId: string): Promise<PageSummary> {
    this.assertPage(pageId);
    const page = await this.service["runFocusOperation"](
      this.host,
      this.id,
      async () => ({
        ...(await this.host.browser.switchPage(pageId)),
        active: true,
      }),
    );
    this.group().activePageId = pageId;
    return page;
  }
  async closePage(pageId: string): Promise<void> {
    this.assertPage(pageId);
    await this.run(() => this.host.browser.closePage(pageId));
    this.host.pageOwners.delete(pageId);
    this.host.bufferedActivity.delete(pageId);
    await this.service["ensureGroupPage"](this.host, this.id);
  }
  invalidateTargets() {
    return this.run(() =>
      this.host.browser.invalidatePages([this.activePage()]),
    ).then(() => undefined);
  }
  invalidateAllTargets() {
    return this.run(async () => {
      const owned = this.service["ownedPageIds"](this.host, this.id);
      const physical = await this.host.browser.pages();
      if (
        physical.length === owned.length &&
        physical.every((page) => this.host.pageOwners.get(page.id) === this.id)
      ) {
        return this.host.browser.invalidateAllTargets();
      }
      return this.host.browser.invalidatePages(owned);
    });
  }
  invalidatePages(pageIds: readonly string[]) {
    for (const pageId of pageIds) this.assertPage(pageId);
    return this.run(() => this.host.browser.invalidatePages(pageIds));
  }
  close() {
    return this.service.close(this.id);
  }

  private group(): PageGroupState {
    const group = this.host.groups.get(this.id);
    if (group === undefined)
      throw new RoveError({
        code: "BROWSER_CLOSED",
        message: "Browser page group is closed.",
      });
    return group;
  }
  private activePage() {
    return this.service["activePage"](this.host, this.id);
  }
  private assertPage(pageId: string) {
    this.service["assertPageOwned"](this.host, this.id, pageId);
  }
  private run<T>(operation: () => Promise<T>) {
    return this.service["runHostOperation"](this.host, this.id, operation);
  }
  private read<T>(operation: () => Promise<T>) {
    return this.service["runHostRead"](this.host, this.id, operation);
  }
  private filterResult(result: ActionResult): ActionResult {
    if (result.pageId !== undefined) this.assertPage(result.pageId);
    const openedPages = result.openedPages?.filter(
      (page) => this.host.pageOwners.get(page.id) === this.id,
    );
    const openedActive = openedPages?.at(-1)?.id;
    if (openedActive !== undefined) this.group().activePageId = openedActive;
    const scoped: ActionResult = {
      ...result,
      sessionId: this.id,
    };
    if (openedPages?.length) scoped.openedPages = openedPages;
    else delete scoped.openedPages;
    return scoped;
  }
}
