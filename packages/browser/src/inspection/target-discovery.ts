import type { Page } from "playwright";

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
  await page.evaluate((markerAttribute) => {
    document
      .querySelectorAll(`[${markerAttribute}]`)
      .forEach((element) =>
        element.removeAttribute(markerAttribute),
      );
  }, TARGET_MARKER_ATTRIBUTE);
}

export async function discoverTargetCandidates(
  page: Page,
): Promise<DomCandidate[]> {
  return page.evaluate(
    ({
      candidateSelector,
      markerAttribute,
      identityAttributes,
    }) => {
      document
        .querySelectorAll(`[${markerAttribute}]`)
        .forEach((element) =>
          element.removeAttribute(markerAttribute),
        );

      const elements = Array.from(
        document.querySelectorAll<HTMLElement>(
          candidateSelector,
        ),
      );

      return elements.map((element, index) => {
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
          element instanceof HTMLInputElement
            ? element
            : undefined;

        const type = input?.type.toLowerCase();

        const rawRole = element.getAttribute("role");
        const normalizedRole = rawRole
          ?.replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

        const role =
          normalizedRole && normalizedRole.length > 0
            ? normalizedRole
            : undefined;

        const nativeDisabled =
          element instanceof HTMLButtonElement ||
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
            ? element.disabled
            : false;

        const ariaDisabled =
          element
            .getAttribute("aria-disabled")
            ?.trim()
            .toLowerCase() === "true";

        const buttonLikeInput =
          input !== undefined &&
          ["button", "submit", "reset", "image"].includes(
            input.type,
          );

        const rawAriaLabel =
          element.getAttribute("aria-label");

        const normalizedAriaLabel = rawAriaLabel
          ?.replace(/\s+/g, " ")
          .trim();

        const ariaLabel =
          normalizedAriaLabel &&
          normalizedAriaLabel.length > 0
            ? normalizedAriaLabel
            : undefined;

        let ariaLabelledbyText: string | undefined;

        const labelledbyIds = element
          .getAttribute("aria-labelledby")
          ?.split(/\s+/)
          .filter(Boolean);

        if (labelledbyIds?.length) {
          const labelledText = labelledbyIds
            .map(
              (id) =>
                document.getElementById(id)?.textContent ??
                "",
            )
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

          if (labelledText.length > 0) {
            ariaLabelledbyText = labelledText;
          }
        }

        let labelText: string | undefined;

        if (element.id) {
          const explicitLabel = Array.from(
            document.querySelectorAll<HTMLLabelElement>(
              "label",
            ),
          ).find(
            (label) => label.htmlFor === element.id,
          );

          const explicitText = explicitLabel?.innerText
            .replace(/\s+/g, " ")
            .trim();

          if (explicitText && explicitText.length > 0) {
            labelText = explicitText;
          }
        }

        if (labelText === undefined) {
          const wrappingLabel =
            element.closest("label");

          const wrappingText = wrappingLabel?.innerText
            .replace(/\s+/g, " ")
            .trim();

          if (wrappingText && wrappingText.length > 0) {
            labelText = wrappingText;
          }
        }

        const rawAlt = element.getAttribute("alt");
        const normalizedAlt = rawAlt
          ?.replace(/\s+/g, " ")
          .trim();

        const alt =
          normalizedAlt && normalizedAlt.length > 0
            ? normalizedAlt
            : undefined;

        const rawTitle =
          element.getAttribute("title");

        const normalizedTitle = rawTitle
          ?.replace(/\s+/g, " ")
          .trim();

        const title =
          normalizedTitle && normalizedTitle.length > 0
            ? normalizedTitle
            : undefined;

        const rawPlaceholder =
          element.getAttribute("placeholder");

        const normalizedPlaceholder = rawPlaceholder
          ?.replace(/\s+/g, " ")
          .trim();

        const placeholder =
          normalizedPlaceholder &&
          normalizedPlaceholder.length > 0
            ? normalizedPlaceholder
            : undefined;

        let buttonValue: string | undefined;

        if (buttonLikeInput) {
          const normalizedButtonValue = input.value
            .replace(/\s+/g, " ")
            .trim();

          if (normalizedButtonValue.length > 0) {
            buttonValue = normalizedButtonValue;
          }
        }

        const normalizedId = element.id
          .replace(/\s+/g, " ")
          .trim();

        const id =
          normalizedId.length > 0
            ? normalizedId
            : undefined;

        const rawTestId =
          element.getAttribute("data-testid");

        const normalizedTestId = rawTestId
          ?.replace(/\s+/g, " ")
          .trim();

        const testId =
          normalizedTestId &&
          normalizedTestId.length > 0
            ? normalizedTestId
            : undefined;

        const attributes: Record<string, string> = {};

        for (const attributeName of identityAttributes) {
          const rawValue =
            element.getAttribute(attributeName);

          const normalizedValue = rawValue
            ?.replace(/\s+/g, " ")
            .trim();

          if (
            normalizedValue &&
            normalizedValue.length > 0
          ) {
            attributes[attributeName] =
              normalizedValue;
          }
        }

        const pathSegments: string[] = [];
        let current: Element | null = element;

        while (current !== null) {
          let segment =
            current.tagName.toLowerCase();

          const parent: Element | null =
            current.parentElement;

          if (parent !== null) {
            const currentTagName = current.tagName;

            const sameTagSiblings = Array.from(
              parent.children,
            ).filter(
              (sibling: Element) =>
                sibling.tagName === currentTagName,
            );

            if (sameTagSiblings.length > 1) {
              const position =
                sameTagSiblings.indexOf(current) + 1;

              segment += `:nth-of-type(${position})`;
            }
          }

          pathSegments.unshift(segment);
          current = parent;
        }

        const domPathHint =
          pathSegments.join(">");

        const normalizedText = element.innerText
          .replace(/\s+/g, " ")
          .trim();

        return {
          marker,
          tag: element.tagName.toLowerCase(),
          ...(type === undefined ? {} : { type }),
          ...(role === undefined ? {} : { role }),
          text: normalizedText,
          visible,
          disabled: nativeDisabled || ariaDisabled,
          contentEditable:
            element.getAttribute("contenteditable") ===
            "true",
          tabIndex: element.tabIndex,
          ...(ariaLabel === undefined
            ? {}
            : { ariaLabel }),
          ...(ariaLabelledbyText === undefined
            ? {}
            : { ariaLabelledbyText }),
          ...(labelText === undefined
            ? {}
            : { labelText }),
          ...(alt === undefined ? {} : { alt }),
          ...(title === undefined ? {} : { title }),
          ...(placeholder === undefined
            ? {}
            : { placeholder }),
          ...(buttonValue === undefined
            ? {}
            : { buttonValue }),
          ...(id === undefined ? {} : { id }),
          ...(testId === undefined
            ? {}
            : { testId }),
          ...(Object.keys(attributes).length === 0
            ? {}
            : { attributes }),
          domPathHint,
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

export {
  CANDIDATE_SELECTOR,
  IDENTITY_ATTRIBUTES,
  TARGET_MARKER_ATTRIBUTE,
};
