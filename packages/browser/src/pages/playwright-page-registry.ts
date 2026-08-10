import type { Page } from "playwright";
import { RoveError, type PageSummary } from "@rove/protocol";
import { PageRegistry } from "./page-registry.js";
import { recordMutation, type PageState } from "./page-state.js";

/**
 * Bridges Rove page metadata (PageRegistry) with Playwright Page objects.
 * The Playwright mapping stays private to packages/browser.
 */
export class PlaywrightPageRegistry {
  private readonly registry = new PageRegistry();
  private readonly pagesById = new Map<string, Page>();
  private readonly idsByPage = new WeakMap<Page, string>();
  private onPageClosed: ((pageId: string, wasActive: boolean) => void) | undefined;

  setOnPageClosed(handler: (pageId: string, wasActive: boolean) => void): void {
    this.onPageClosed = handler;
  }

  registerPage(page: Page): PageState {
    const existing = this.idsByPage.get(page);
    if (existing !== undefined) return this.registry.get(existing);

    const state = this.registry.register(page.url());
    const pageId = state.id;
    this.pagesById.set(pageId, page);
    this.idsByPage.set(page, pageId);

    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame() || !this.registry.has(pageId)) return;
      const next = recordMutation(this.registry.get(pageId), true);
      this.registry.update(pageId, { ...next, url: page.url() });
    });
    const syncTitle = () => {
      if (!this.registry.has(pageId) || page.isClosed()) return;
      void page
        .title()
        .then((title) => {
          if (this.registry.has(pageId)) this.registry.update(pageId, { title });
        })
        .catch(() => undefined);
    };
    page.on("domcontentloaded", syncTitle);
    page.on("load", syncTitle);
    page.on("close", () => {
      if (!this.registry.has(pageId)) return;
      const wasActive = this.registry.get(pageId).active;
      this.removePage(pageId);
      this.onPageClosed?.(pageId, wasActive);
    });
    return this.registry.get(pageId);
  }

  has(pageId: string): boolean {
    return this.registry.has(pageId);
  }

  stateFor(pageId: string): PageState {
    return this.registry.get(pageId);
  }

  pageFor(pageId: string): Page {
    this.registry.get(pageId);
    const page = this.pagesById.get(pageId);
    if (!page || page.isClosed()) {
      throw new RoveError({ code: "PAGE_NOT_FOUND", message: "Browser page was not found." });
    }
    return page;
  }

  pageIdFor(page: Page): string | undefined {
    return this.idsByPage.get(page);
  }

  activeId(): string | undefined {
    return this.registry.activeId();
  }

  latestId(): string | undefined {
    return this.registry.latestId();
  }

  activate(pageId: string): PageState {
    return this.registry.activate(pageId);
  }

  update(pageId: string, update: Partial<Omit<PageState, "id">>): PageState {
    return this.registry.update(pageId, update);
  }

  /** Synchronize cheap Playwright values (URL, title) into stored metadata. */
  async syncMetadata(pageId: string): Promise<PageState> {
    const page = this.pageFor(pageId);
    const title = await page.title();
    return this.registry.update(pageId, { url: page.url(), title });
  }

  removePage(pageId: string): void {
    this.registry.get(pageId);
    const page = this.pagesById.get(pageId);
    if (page) {
      this.pagesById.delete(pageId);
      this.idsByPage.delete(page);
    }
    this.registry.remove(pageId);
  }

  summaries(): PageSummary[] {
    return this.registry.summaries();
  }

  clear(): void {
    for (const id of [...this.pagesById.keys()]) this.removePage(id);
  }
}
