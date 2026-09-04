import type {
  PerceivedControl,
  StructuralScope,
  TargetCapability,
} from "@rove/protocol";

import type { Locator } from "playwright";

function dedupe<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];

  for (const value of values) {
    const identity = key(value);

    if (seen.has(identity)) {
      continue;
    }

    seen.add(identity);
    output.push(value);
  }

  return output;
}

export async function readPerceivedControl(
  locator: Locator,
): Promise<PerceivedControl> {
  return locator
    .evaluate((element) => {
      const normalize = (
        value: string | null | undefined,
      ): string | undefined => {
        const result = value?.replace(/\s+/g, " ").trim();

        return result && result.length > 0 ? result.slice(0, 500) : undefined;
      };

      const html = element as HTMLElement;

      const input = element instanceof HTMLInputElement ? element : undefined;

      const tag = html.tagName.toLowerCase();

      const role = normalize(element.getAttribute("role"))?.toLowerCase();

      const capabilities: TargetCapability[] = [];

      const addCapability = (capability: TargetCapability) => {
        if (!capabilities.includes(capability)) {
          capabilities.push(capability);
        }
      };

      if (
        tag === "button" ||
        tag === "a" ||
        role === "button" ||
        role === "link" ||
        role === "tab" ||
        role === "menuitem"
      ) {
        addCapability("activate");
      }

      if (
        tag === "textarea" ||
        html.isContentEditable ||
        (input !== undefined &&
          ![
            "button",
            "submit",
            "reset",
            "checkbox",
            "radio",
            "file",
            "hidden",
          ].includes(input.type))
      ) {
        addCapability("fill");
      }

      if (tag === "select") {
        addCapability("select");
      }

      if (
        input?.type === "checkbox" ||
        role === "checkbox" ||
        role === "switch"
      ) {
        addCapability("check");
        addCapability("uncheck");
      }

      if (input?.type === "radio" || role === "radio") {
        addCapability("check");
      }

      if (input?.type === "file") {
        addCapability("upload");
      }

      addCapability("hover");
      addCapability("scroll");

      if (html.draggable || element.getAttribute("draggable") === "true") {
        addCapability("drag");
      }

      const scopes: StructuralScope[] = [];

      const addScope = (kind: StructuralScope["kind"], node: Element) => {
        const ariaLabel = normalize(node.getAttribute("aria-label"));

        const labelledby = node
          .getAttribute("aria-labelledby")
          ?.split(/\s+/)
          .filter(Boolean)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ");

        const heading = node.querySelector(
          "h1,h2,h3,h4,h5,h6,legend",
        )?.textContent;

        const label = ariaLabel ?? normalize(labelledby) ?? normalize(heading);

        scopes.push({
          kind,
          ...(label === undefined ? {} : { label }),
        });
      };

      let current: Element | null = element.parentElement;

      while (current !== null) {
        const currentRole = normalize(
          current.getAttribute("role"),
        )?.toLowerCase();

        const currentTag = current.tagName.toLowerCase();

        if (currentTag === "form") {
          addScope("form", current);
        }

        if (
          currentTag === "dialog" ||
          currentRole === "dialog" ||
          currentRole === "alertdialog"
        ) {
          addScope("dialog", current);
        }

        if (currentTag === "tr" || currentRole === "row") {
          addScope("row", current);
        }

        if (currentRole === "region" || currentTag === "section") {
          addScope("region", current);
        }

        if (
          currentTag === "article" ||
          current.getAttribute("data-card") !== null
        ) {
          addScope("card", current);
        }

        if (currentRole === "group" || currentTag === "fieldset") {
          addScope("group", current);
        }

        current = current.parentElement;
      }

      return {
        capabilities,
        scopes,
      };
    })
    .then((value) => ({
      capabilities: dedupe(value.capabilities, (item) => item),
      scopes: dedupe(
        value.scopes,
        (item) => `${item.kind}:${item.label ?? ""}`,
      ),
    }));
}

export async function readVerificationState(
  locator: Locator,
  sensitive: boolean,
): Promise<{
  checked?: boolean;
  selectedValues?: string[];
}> {
  return locator.evaluate((element, isSensitive) => {
    if (
      element instanceof HTMLInputElement &&
      (element.type === "checkbox" || element.type === "radio")
    ) {
      return {
        checked: element.checked,
      };
    }

    if (element instanceof HTMLSelectElement && !isSensitive) {
      return {
        selectedValues: Array.from(element.selectedOptions)
          .map((option) => option.value)
          .slice(0, 100),
      };
    }

    return {};
  }, sensitive);
}
