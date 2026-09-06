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

export async function clearTargetMarkers(page: Page): Promise<void> {
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
        element: Element;
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
          .forEach((element) => element.removeAttribute(markerAttribute));

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
        const found = Array.from(root.querySelectorAll(candidateSelector)).map(
          (element) => ({
            element,
            shadowRootDepth: depth,
          }),
        );

        for (const element of Array.from(root.querySelectorAll("*"))) {
          if (element.shadowRoot !== null) {
            found.push(...collect(element.shadowRoot, depth + 1));
          }
        }

        return found;
      };

      clear(document);

      return collect(document, 0).map(({ element, shadowRootDepth }, index) => {
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

        const html = element instanceof HTMLElement ? element : undefined;

        const input = element instanceof HTMLInputElement ? element : undefined;

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
          semanticRoot instanceof Document || semanticRoot instanceof ShadowRoot
            ? semanticRoot
            : document;

        const ariaLabel = normalize(element.getAttribute("aria-label"));

        let ariaLabelledbyText: string | undefined;

        const labelledbyIds = element
          .getAttribute("aria-labelledby")
          ?.split(/\s+/)
          .filter(Boolean);

        if (labelledbyIds?.length) {
          ariaLabelledbyText = normalize(
            labelledbyIds
              .map((id) => queryRoot.getElementById(id)?.textContent ?? "")
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

        const labelable = [
          "button",
          "input",
          "meter",
          "output",
          "progress",
          "select",
          "textarea",
        ].includes(element.tagName.toLowerCase());

        if (labelText === undefined && labelable) {
          labelText = normalize(
            (element.closest("label") as HTMLElement | null)?.innerText,
          );
        }

        const attributes: Record<string, string> = {};

        for (const name of identityAttributes) {
          const value = normalize(element.getAttribute(name));
          if (value !== undefined) {
            attributes[name] = value;
          }
        }

        const pathSegments: string[] = [];
        let current: Element | null = element;

        while (current !== null) {
          let segment = current.tagName.toLowerCase();

          const parent: Element | null = current.parentElement;

          if (parent !== null) {
            const tag = current.tagName;

            const siblings: Element[] = Array.from(parent.children).filter(
              (sibling) => sibling.tagName === tag,
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
        const placeholder = normalize(element.getAttribute("placeholder"));
        const buttonValue = buttonLikeInput
          ? normalize(input.value)
          : undefined;
        const id = normalize(element.id);
        const testId = normalize(element.getAttribute("data-testid"));

        return {
          marker,
          tag: element.tagName.toLowerCase(),
          ...(type === undefined ? {} : { type }),
          ...(role === undefined ? {} : { role }),
          // `[role]` is valid on SVG. Reading HTMLElement-only `innerText`
          // used to throw here and discard the entire frame's discovery.
          text: (html?.innerText ?? element.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim(),
          visible,
          disabled: nativeDisabled || ariaDisabled,
          contentEditable: html?.isContentEditable === true,
          tabIndex: html?.tabIndex ?? -1,
          shadowRootDepth,
          ...(ariaLabel === undefined ? {} : { ariaLabel }),
          ...(ariaLabelledbyText === undefined ? {} : { ariaLabelledbyText }),
          ...(labelText === undefined ? {} : { labelText }),
          ...(alt === undefined ? {} : { alt }),
          ...(title === undefined ? {} : { title }),
          ...(placeholder === undefined ? {} : { placeholder }),
          ...(buttonValue === undefined ? {} : { buttonValue }),
          ...(id === undefined ? {} : { id }),
          ...(testId === undefined ? {} : { testId }),
          ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
          domPathHint: pathSegments.join(">"),
          provenance: "primary_dom" as const,
        };
      });
    },
    {
      candidateSelector: CANDIDATE_SELECTOR,
      markerAttribute: TARGET_MARKER_ATTRIBUTE,
      identityAttributes: IDENTITY_ATTRIBUTES,
    },
  );
}

const ACCESSIBILITY_INTERACTIVE_ROLES = [
  "button",
  "link",
  "checkbox",
  "radio",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "combobox",
  "listbox",
  "textbox",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "treeitem",
] as const;

export interface AccessibilityRecoveryResult {
  semanticInteractiveCount: number;
  recovered: DomCandidate[];
  ambiguousBindingCount: number;
  semanticPrimaryMarkers: string[];
}

/**
 * Recover DOM-backed controls through Playwright's user-facing role engine.
 * Existing primary markers are the deduplication key, and recovered nodes are
 * only returned after a unique marker binding has been established.
 */
export async function recoverAccessibilityCandidates(
  frame: Frame | Page,
  markerStart: number,
): Promise<AccessibilityRecoveryResult> {
  const roleResults = await Promise.all(
    ACCESSIBILITY_INTERACTIVE_ROLES.map(async (semanticRole, roleIndex) => {
      const byRole = frame.getByRole(semanticRole);
      const results = await byRole
        .evaluateAll(
          (elements, input) =>
            elements.map((element, index) => {
              const marker = `${input.markerPrefix}${index + 1}`;
              const existingMarker = element.getAttribute(
                input.markerAttribute,
              );
              if (existingMarker !== null) {
                return {
                  status: "existing" as const,
                  marker: existingMarker,
                };
              }

              const normalize = (value: string | null | undefined) => {
                const normalized = value?.replace(/\s+/g, " ").trim();
                return normalized || undefined;
              };
              const html = element instanceof HTMLElement ? element : undefined;
              const field =
                element instanceof HTMLInputElement ? element : undefined;
              const visibilityElement =
                element instanceof HTMLOptionElement
                  ? (element.closest("select") ?? element)
                  : element;
              const style = window.getComputedStyle(visibilityElement);
              const rect = visibilityElement.getBoundingClientRect();
              const visible =
                element.isConnected &&
                visibilityElement.isConnected &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                style.visibility !== "collapse" &&
                Number.parseFloat(style.opacity || "1") !== 0 &&
                rect.width > 0 &&
                rect.height > 0;

              const semanticRoot = element.getRootNode();
              const queryRoot =
                semanticRoot instanceof Document ||
                semanticRoot instanceof ShadowRoot
                  ? semanticRoot
                  : document;
              const labelledbyIds = element
                .getAttribute("aria-labelledby")
                ?.split(/\s+/)
                .filter(Boolean);
              const ariaLabelledbyText = labelledbyIds?.length
                ? normalize(
                    labelledbyIds
                      .map(
                        (id) => queryRoot.getElementById(id)?.textContent ?? "",
                      )
                      .join(" "),
                  )
                : undefined;
              let labelText: string | undefined;
              if (html?.id) {
                labelText = normalize(
                  Array.from(
                    queryRoot.querySelectorAll<HTMLLabelElement>("label"),
                  ).find((label) => label.htmlFor === html.id)?.textContent,
                );
              }
              const labelable = [
                "button",
                "input",
                "meter",
                "output",
                "progress",
                "select",
                "textarea",
              ].includes(element.tagName.toLowerCase());
              if (labelable) {
                labelText ??= normalize(element.closest("label")?.textContent);
              }

              const attributes: Record<string, string> = {};
              for (const name of input.identityAttributes) {
                const value = normalize(element.getAttribute(name));
                if (value !== undefined) attributes[name] = value;
              }

              const pathSegments: string[] = [];
              let current: Element | null = element;
              while (current !== null) {
                let segment = current.tagName.toLowerCase();
                const parent: Element | null = current.parentElement;
                if (parent !== null) {
                  const siblings: Element[] = Array.from(
                    parent.children,
                  ).filter((sibling) => sibling.tagName === current!.tagName);
                  if (siblings.length > 1) {
                    segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
                  }
                }
                pathSegments.unshift(segment);
                current = parent;
              }

              element.setAttribute(input.markerAttribute, marker);
              const nativeDisabled =
                (element instanceof HTMLButtonElement ||
                  element instanceof HTMLInputElement ||
                  element instanceof HTMLTextAreaElement ||
                  element instanceof HTMLSelectElement) &&
                element.disabled;
              const buttonLike =
                field !== undefined &&
                ["button", "submit", "reset", "image"].includes(field.type);

              return {
                status: "recovered" as const,
                candidate: {
                  marker,
                  tag: element.tagName.toLowerCase(),
                  ...(field === undefined
                    ? {}
                    : { type: field.type.toLowerCase() }),
                  semanticRole: input.semanticRole,
                  text: (html?.innerText ?? element.textContent ?? "")
                    .replace(/\s+/g, " ")
                    .trim(),
                  visible,
                  disabled:
                    nativeDisabled ||
                    element
                      .getAttribute("aria-disabled")
                      ?.trim()
                      .toLowerCase() === "true",
                  contentEditable: html?.isContentEditable === true,
                  tabIndex: html?.tabIndex ?? -1,
                  shadowRootDepth: (() => {
                    let depth = 0;
                    let root: Node = element;
                    while (root.getRootNode() instanceof ShadowRoot) {
                      depth += 1;
                      root = (root.getRootNode() as ShadowRoot).host;
                    }
                    return depth;
                  })(),
                  ...(normalize(element.getAttribute("aria-label")) ===
                  undefined
                    ? {}
                    : {
                        ariaLabel: normalize(
                          element.getAttribute("aria-label"),
                        ),
                      }),
                  ...(ariaLabelledbyText === undefined
                    ? {}
                    : { ariaLabelledbyText }),
                  ...(labelText === undefined ? {} : { labelText }),
                  ...(normalize(element.getAttribute("alt")) === undefined
                    ? {}
                    : { alt: normalize(element.getAttribute("alt")) }),
                  ...(normalize(element.getAttribute("title")) === undefined
                    ? {}
                    : { title: normalize(element.getAttribute("title")) }),
                  ...(normalize(element.getAttribute("placeholder")) ===
                  undefined
                    ? {}
                    : {
                        placeholder: normalize(
                          element.getAttribute("placeholder"),
                        ),
                      }),
                  ...(buttonLike && normalize(field.value) !== undefined
                    ? { buttonValue: normalize(field.value) }
                    : {}),
                  ...(normalize(html?.id) === undefined
                    ? {}
                    : { id: normalize(html?.id) }),
                  ...(normalize(element.getAttribute("data-testid")) ===
                  undefined
                    ? {}
                    : {
                        testId: normalize(element.getAttribute("data-testid")),
                      }),
                  ...(Object.keys(attributes).length === 0
                    ? {}
                    : { attributes }),
                  domPathHint: pathSegments.join(">"),
                  provenance: "accessibility_recovery" as const,
                },
              };
            }),
          {
            markerAttribute: TARGET_MARKER_ATTRIBUTE,
            markerPrefix: `a${markerStart}_${roleIndex}_`,
            semanticRole,
            identityAttributes: [...IDENTITY_ATTRIBUTES],
          },
        )
        .catch(() => [{ status: "ambiguous" as const }]);
      return {
        count: results.filter((result) => result.status !== "ambiguous").length,
        results,
      };
    }),
  );

  const recovered: DomCandidate[] = [];
  const semanticPrimaryMarkers = new Set<string>();
  let ambiguousBindingCount = 0;
  for (const role of roleResults) {
    for (const result of role.results) {
      if (result.status === "recovered") {
        recovered.push(result.candidate as DomCandidate);
      }
      if (result.status === "ambiguous") ambiguousBindingCount += 1;
      if (result.status === "existing") {
        semanticPrimaryMarkers.add(result.marker);
      }
    }
  }

  return {
    semanticInteractiveCount: roleResults.reduce(
      (sum, role) => sum + role.count,
      0,
    ),
    recovered,
    ambiguousBindingCount,
    semanticPrimaryMarkers: [...semanticPrimaryMarkers],
  };
}

export {
  CANDIDATE_SELECTOR,
  ACCESSIBILITY_INTERACTIVE_ROLES,
  IDENTITY_ATTRIBUTES,
  TARGET_MARKER_ATTRIBUTE,
};

async function clearFrameTargetMarkers(frame: Frame): Promise<void> {
  await frame.evaluate((markerAttribute) => {
    const clear = (root: Document | ShadowRoot): void => {
      root
        .querySelectorAll(`[${markerAttribute}]`)
        .forEach((element) => element.removeAttribute(markerAttribute));

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
