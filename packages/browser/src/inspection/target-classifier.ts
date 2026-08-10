import type { TargetKind } from "@rove/protocol";

import type {
  DomCandidate,
  SemanticCandidate,
} from "./dom-types.js";

const INTERACTIVE_ROLES = new Set([
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
]);

function normalizeName(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();

  if (!normalized) return undefined;

  return normalized.slice(0, 500);
}

function classifyKind(candidate: DomCandidate): TargetKind | undefined {
  // Native semantics have priority.
  if (candidate.tag === "a") return "link";
  if (candidate.tag === "button") return "button";
  if (candidate.tag === "textarea") return "textarea";
  if (candidate.tag === "select") return "select";

  if (candidate.tag === "input") {
    if (candidate.type === "checkbox") return "checkbox";
    if (candidate.type === "radio") return "radio";
    return "input";
  }

  if (candidate.tag === "option") return "option";

  // Then supported ARIA semantics.
  switch (candidate.role) {
    case "button":
      return "button";
    case "link":
      return "link";
    case "checkbox":
      return "checkbox";
    case "radio":
      return "radio";
    case "tab":
      return "tab";
    case "menuitem":
      return "menuitem";
    case "option":
      return "option";
  }

  if (
    candidate.role !== undefined &&
    INTERACTIVE_ROLES.has(candidate.role)
  ) {
    return "control";
  }

  if (candidate.contentEditable) {
    return "control";
  }

  // Generic keyboard-focusable nodes are plausible controls.
  if (candidate.tabIndex >= 0) {
    return "control";
  }

  return undefined;
}

export function resolveAccessibleName(
  candidate: DomCandidate,
): string | undefined {
  const candidates = [
    candidate.ariaLabel,
    candidate.ariaLabelledbyText,
    candidate.labelText,
    candidate.alt,
    candidate.title,
    candidate.placeholder,
    candidate.text,
    candidate.buttonValue,
  ];

  for (const value of candidates) {
    const normalized = normalizeName(value);

    if (normalized !== undefined) {
      return normalized;
    }
  }

  return undefined;
}

export function classifyTargetCandidate(
  candidate: DomCandidate,
): SemanticCandidate | undefined {
  if (!candidate.visible) return undefined;

  const kind = classifyKind(candidate);
  if (kind === undefined) return undefined;

  const name = resolveAccessibleName(candidate);

  return {
    ...candidate,
    kind,
    ...(name === undefined ? {} : { name }),
    enabled: !candidate.disabled,
  };
}

export function classifyTargetCandidates(
  candidates: DomCandidate[],
): SemanticCandidate[] {
  return candidates.flatMap((candidate) => {
    const classified = classifyTargetCandidate(candidate);
    return classified === undefined ? [] : [classified];
  });
}
