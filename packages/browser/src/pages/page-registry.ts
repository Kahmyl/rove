import { RoveError, type PageSummary } from "@rove/protocol";
import { createPageState, type PageState } from "./page-state.js";

export class PageRegistry {
  private readonly states = new Map<string, PageState>();
  private counter = 0;

  register(url?: string): PageState {
    this.counter += 1;
    const id = `page_${String(this.counter).padStart(2, "0")}`;
    const state = createPageState(id, url);
    this.states.set(id, state);
    if (this.states.size === 1) this.activate(id);
    return this.get(id);
  }

  get(pageId: string): PageState {
    const state = this.states.get(pageId);
    if (!state) throw new RoveError({ code: "PAGE_NOT_FOUND", message: "Browser page was not found." });
    return state;
  }

  has(pageId: string): boolean {
    return this.states.has(pageId);
  }

  activeId(): string | undefined {
    for (const state of this.states.values()) if (state.active) return state.id;
    return undefined;
  }

  latestId(): string | undefined {
    let latest: string | undefined;
    for (const id of this.states.keys()) latest = id;
    return latest;
  }

  update(pageId: string, update: Partial<Omit<PageState, "id">>): PageState {
    const state = { ...this.get(pageId), ...update, id: pageId };
    this.states.set(pageId, state);
    return state;
  }

  activate(pageId: string): PageState {
    this.get(pageId);
    for (const [id, state] of this.states) this.states.set(id, { ...state, active: id === pageId });
    return this.get(pageId);
  }

  remove(pageId: string): void {
    this.get(pageId);
    this.states.delete(pageId);
  }

  summaries(): PageSummary[] {
    return [...this.states.values()].map((state) => ({
      id: state.id,
      url: state.url,
      active: state.active,
      revision: state.revision,
      ...(state.title === undefined ? {} : { title: state.title }),
    }));
  }
}
