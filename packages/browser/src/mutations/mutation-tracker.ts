import type { Page } from "playwright";

const MUTATION_VERSION_KEY = "__roveMaterialMutationVersion";
const MUTATION_OBSERVER_KEY = "__roveMaterialMutationObserver";

export async function installMutationTracker(page: Page): Promise<void> {
  // tsx names nested functions with a small `__name` helper. Playwright
  // serializes the callback without that module-scoped helper in manual demos.
  await page.evaluate("globalThis.__name ??= (value) => value");
  await page.evaluate(
    ({ observerKey, versionKey }) => {
      const state = window as unknown as Record<string, unknown>;
      if (state[observerKey] !== undefined) return;

      const root = document.documentElement;

      if (!(root instanceof Node)) {
        return;
      }

      state[versionKey] = 0;
      const markerSelector = "[data-rove-target]";
      const interactiveSelector = [
        "a[href]",
        "button",
        'input:not([type="hidden"])',
        "textarea",
        "select",
        "[role]",
        '[contenteditable="true"]',
        "[tabindex]",
      ].join(",");

      const containsInteractive = (node: Node): boolean => {
        if (!(node instanceof Element)) return false;
        return (
          node.matches(interactiveSelector) ||
          node.querySelector(interactiveSelector) !== null
        );
      };

      const isMaterial = (mutation: MutationRecord): boolean => {
        if (mutation.type === "attributes") {
          return (
            mutation.target instanceof Element &&
            mutation.target.matches(markerSelector)
          );
        }

        const parent =
          mutation.target instanceof Element
            ? mutation.target
            : mutation.target.parentElement;
        if (parent?.closest(markerSelector) !== null) return true;

        return [
          ...Array.from(mutation.addedNodes),
          ...Array.from(mutation.removedNodes),
        ].some(
          (node) =>
            containsInteractive(node) ||
            (node instanceof Element &&
              (node.matches(markerSelector) ||
                node.querySelector(markerSelector) !== null)),
        );
      };

      const observer = new MutationObserver((mutations) => {
        if (mutations.some(isMaterial)) {
          state[versionKey] = Number(state[versionKey] ?? 0) + 1;
        }
      });

      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          "disabled",
          "hidden",
          "style",
          "class",
          "role",
          "type",
          "href",
          "id",
          "name",
          "tabindex",
          "aria-label",
          "aria-labelledby",
          "aria-disabled",
          "aria-hidden",
          "contenteditable",
        ],
      });

      state[observerKey] = observer;
    },
    { observerKey: MUTATION_OBSERVER_KEY, versionKey: MUTATION_VERSION_KEY },
  );
}

export async function readMaterialMutationVersion(page: Page): Promise<number> {
  await installMutationTracker(page);
  return page.evaluate(
    (versionKey) =>
      Number((window as unknown as Record<string, unknown>)[versionKey] ?? 0),
    MUTATION_VERSION_KEY,
  );
}
