import type { Locator } from "playwright";

import type { TargetIdentity } from "./target-identity.js";

export interface TargetState {
  identity: TargetIdentity;
  visible: boolean;
  enabled: boolean;
  interactive: boolean;
  editable: boolean;
}

function normalize(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : undefined;
}

function normalizeLower(value: string | undefined): string | undefined {
  return normalize(value)?.toLowerCase();
}

export function sameStrongIdentity(expected: TargetIdentity, actual: TargetIdentity): boolean {
  const normalizedFields: (keyof TargetIdentity)[] = ["tag", "type", "role"];
  for (const field of normalizedFields) {
    if (expected[field] !== undefined && normalizeLower(expected[field] as string) !== normalizeLower(actual[field] as string | undefined)) {
      return false;
    }
  }
  for (const field of ["id", "testId", "name"] as const) {
    if (expected[field] !== undefined && normalize(expected[field]) !== normalize(actual[field])) return false;
  }
  return true;
}

export async function readTargetState(locator: Locator): Promise<TargetState> {
  return locator.evaluate((element) => {
    const html = element as HTMLElement;
    const input = element instanceof HTMLInputElement ? element : undefined;
    const normalizeText = (value: string | null | undefined): string | undefined => {
      const normalized = value?.replace(/\s+/g, " ").trim();
      return normalized ? normalized : undefined;
    };
    const labelledby = element.getAttribute("aria-labelledby")
      ?.split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    const explicitLabel = html.id
      ? Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find((label) => label.htmlFor === html.id)?.innerText
      : undefined;
    const labelText = explicitLabel ?? html.closest("label")?.textContent;
    const name = [
      element.getAttribute("aria-label"),
      labelledby,
      labelText,
      element.getAttribute("alt"),
      element.getAttribute("title"),
      element.getAttribute("placeholder"),
      html.innerText,
      input && ["button", "submit", "reset", "image"].includes(input.type) ? input.value : undefined,
    ].map(normalizeText).find((value) => value !== undefined);
    const style = window.getComputedStyle(html);
    const rect = html.getBoundingClientRect();
    const visible = html.isConnected && style.display !== "none" && style.visibility !== "hidden" &&
      style.visibility !== "collapse" && Number.parseFloat(style.opacity || "1") !== 0 && rect.width > 0 && rect.height > 0;
    const nativeDisabled =
      (element instanceof HTMLButtonElement || element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) && element.disabled;
    const enabled = !nativeDisabled && element.getAttribute("aria-disabled")?.toLowerCase() !== "true";
    const tag = html.tagName.toLowerCase();
    const role = normalizeText(element.getAttribute("role"))?.toLowerCase();
    const editable = tag === "input" || tag === "textarea" || html.isContentEditable;
    const interactive = editable || tag === "button" || tag === "a" || tag === "select" ||
      role !== undefined || html.tabIndex >= 0;
    const attributes: Record<string, string> = {};
    for (const attribute of ["name", "autocomplete", "aria-label", "aria-labelledby", "aria-disabled", "href", "placeholder", "data-testid"]) {
      const value = normalizeText(element.getAttribute(attribute));
      if (value !== undefined) attributes[attribute] = value;
    }
    const id = normalizeText(html.id);
    const testId = normalizeText(element.getAttribute("data-testid"));
    return {
      identity: {
        tag,
        ...(input === undefined ? {} : { type: input.type.toLowerCase() }),
        ...(role === undefined ? {} : { role }),
        ...(name === undefined ? {} : { name }),
        ...(id === undefined ? {} : { id }),
        ...(testId === undefined ? {} : { testId }),
        ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
      },
      visible,
      enabled,
      interactive,
      editable,
    };
  });
}
