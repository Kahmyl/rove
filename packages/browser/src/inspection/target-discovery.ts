import type { Frame, Page } from "playwright";

import type { DomCandidate } from "./dom-types.js";

const TARGET_MARKER_ATTRIBUTE = "data-rove-target";

const CANDIDATE_SELECTOR = [
  "a[href]",
  "button",
  'input:not([type="hidden"])',
  "textarea",
  "select",
  "[role]",
  '[contenteditable="true"]',
  "[tabindex]",
].join(",");

const IDENTITY_ATTRIBUTES = [
  "name",
  "autocomplete",
  "aria-label",
  "aria-labelledby",
  "aria-disabled",
  "href",
  "placeholder",
  "data-testid",
] as const;

export async function clearTargetMarkers(
  page: Page,
): Promise<void> {
  await Promise.all(
    page.frames().map(async (frame) => {
      await clearFrameTargetMarkers(frame).catch(() => undefined);
    }),
  );
}

export async function discoverTargetCandidates(
  page: Frame | Page,
): Promise<DomCandidate[]> {
  return page.evaluate(
    ({ candidateSelector, markerAttribute, identityAttributes }) => {
      type Located = {
        element: HTMLElement;
        shadowRootDepth: number;
      };

      const normalize = (
        value: string | null | undefined,
      ): string | undefined => {
        const result = value?.replace(/\s+/g, " ").trim();
        return result && result.length > 0 ? result : undefined;
      };

      const clear = (root: Document | ShadowRoot): void => {
        root
          .querySelectorAll(`[${markerAttribute}]`)
          .forEach((element) =>
            element.removeAttribute(markerAttribute),
          );

        for (const element of Array.from(
          root.querySelectorAll<HTMLElement>("*"),
        )) {
          if (element.shadowRoot !== null) {
            clear(element.shadowRoot);
          }
        }
      };

      const collect = (
        root: Document | ShadowRoot,
        depth: number,
      ): Located[] => {
        const found = Array.from(
          root.querySelectorAll<HTMLElement>(candidateSelector),
        ).map((element) => ({
          element,
          shadowRootDepth: depth,
        }));

        for (const element of Array.from(
          root.querySelectorAll<HTMLElement>("*"),
        )) {
          if (element.shadowRoot !== null) {
            found.push(...collect(element.shadowRoot, depth + 1));
          }
        }

        return found;
      };

      clear(document);

      return collect(document, 0).map(
        ({ element, shadowRootDepth }, index) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();

          const visible =
            element.isConnected &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.visibility !== "collapse" &&
            Number.parseFloat(style.opacity || "1") !== 0 &&
            rect.width > 0 &&
            rect.height > 0;

          const marker = `r${index + 1}`;
          element.setAttribute(markerAttribute, marker);

          const input =
            element instanceof HTMLInputElement ? element : undefined;

          const type = input?.type.toLowerCase();
          const role = normalize(element.getAttribute("role"))?.toLowerCase();

          const nativeDisabled =
            element instanceof HTMLButtonElement ||
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement
              ? element.disabled
              : false;

          const ariaDisabled =
            element.getAttribute("aria-disabled")?.trim().toLowerCase() ===
            "true";

          const semanticRoot = element.getRootNode();

          const queryRoot =
            semanticRoot instanceof Document ||
            semanticRoot instanceof ShadowRoot
              ? semanticRoot
              : document;

          const ariaLabel = normalize(
            element.getAttribute("aria-label"),
          );

          let ariaLabelledbyText: string | undefined;

          const labelledbyIds = element
            .getAttribute("aria-labelledby")
            ?.split(/\s+/)
            .filter(Boolean);

          if (labelledbyIds?.length) {
            ariaLabelledbyText = normalize(
              labelledbyIds
                .map(
                  (id) =>
                    queryRoot.getElementById(id)?.textContent ?? "",
                )
                .join(" "),
            );
          }

          let labelText: string | undefined;

          if (element.id) {
            const label = Array.from(
              queryRoot.querySelectorAll<HTMLLabelElement>("label"),
            ).find((candidate) => candidate.htmlFor === element.id);

            labelText = normalize(label?.innerText);
          }

          if (labelText === undefined) {
            labelText = normalize(element.closest("label")?.innerText);
          }

          const attributes: Record<string, string> = {};

          for (const name of identityAttributes) {
            const value = normalize(element.getAttribute(name));
            if (value !== undefined) {
              attributes[name] = value;
            }
          }

          const pathSegments: string[] = [];
          let current: HTMLElement | null = element;

          while (current !== null) {
            let segment = current.tagName.toLowerCase();

            const parent: HTMLElement | null =
              current.parentElement;

            if (parent !== null) {
              const tag = current.tagName;

              const siblings: HTMLElement[] = Array.from(
                parent.children,
              ).filter(
                (sibling): sibling is HTMLElement =>
                  sibling instanceof HTMLElement &&
                  sibling.tagName === tag,
              );

              if (siblings.length > 1) {
                segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
              }
            }

            pathSegments.unshift(segment);
            current = parent;
          }

          const buttonLikeInput =
            input !== undefined &&
            ["button", "submit", "reset", "image"].includes(input.type);

          const alt = normalize(element.getAttribute("alt"));
          const title = normalize(element.getAttribute("title"));
          const placeholder = normalize(
            element.getAttribute("placeholder"),
          );
          const buttonValue = buttonLikeInput
            ? normalize(input.value)
            : undefined;
          const id = normalize(element.id);
          const testId = normalize(
            element.getAttribute("data-testid"),
          );

          return {
            marker,
            tag: element.tagName.toLowerCase(),
            ...(type === undefined ? {} : { type }),
            ...(role === undefined ? {} : { role }),
            text: element.innerText.replace(/\s+/g, " ").trim(),
            visible,
            disabled: nativeDisabled || ariaDisabled,
            contentEditable:
              element.getAttribute("contenteditable") === "true",
            tabIndex: element.tabIndex,
            shadowRootDepth,
            ...(ariaLabel === undefined ? {} : { ariaLabel }),
            ...(ariaLabelledbyText === undefined
              ? {}
              : { ariaLabelledbyText }),
            ...(labelText === undefined ? {} : { labelText }),
            ...(alt === undefined ? {} : { alt }),
            ...(title === undefined ? {} : { title }),
            ...(placeholder === undefined ? {} : { placeholder }),
            ...(buttonValue === undefined ? {} : { buttonValue }),
            ...(id === undefined ? {} : { id }),
            ...(testId === undefined ? {} : { testId }),
            ...(Object.keys(attributes).length === 0
              ? {}
              : { attributes }),
            domPathHint: pathSegments.join(">"),
          };
        },
      );
    },
    {
      candidateSelector: CANDIDATE_SELECTOR,
      markerAttribute: TARGET_MARKER_ATTRIBUTE,
      identityAttributes: IDENTITY_ATTRIBUTES,
    },
  );
}

export {
  CANDIDATE_SELECTOR,
  IDENTITY_ATTRIBUTES,
  TARGET_MARKER_ATTRIBUTE,
};

async function clearFrameTargetMarkers(
  frame: Frame,
): Promise<void> {
  await frame.evaluate((markerAttribute) => {
    const clear = (root: Document | ShadowRoot): void => {
      root
        .querySelectorAll(`[${markerAttribute}]`)
        .forEach((element) =>
          element.removeAttribute(markerAttribute),
        );

      for (const element of Array.from(
        root.querySelectorAll<HTMLElement>("*"),
      )) {
        if (element.shadowRoot !== null) {
          clear(element.shadowRoot);
        }
      }
    };

    clear(document);
  }, TARGET_MARKER_ATTRIBUTE);
}
