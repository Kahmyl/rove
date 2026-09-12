import type {
  BrowserInteractionRequest,
  PerceivedControl,
  StructuralScope,
  TargetCapability,
} from "@rove/protocol";

import type { DomCandidate } from "../inspection/dom-types.js";

const ACTIVATION_ROLES = new Set([
  "button",
  "link",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "treeitem",
  "gridcell",
]);

const TEXT_INPUT_TYPES = new Set([
  "date",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
]);

function semanticRole(candidate: DomCandidate): string | undefined {
  return candidate.role ?? candidate.semanticRole;
}

function isProgrammaticallyFocusable(candidate: DomCandidate): boolean {
  return (
    !candidate.disabled &&
    (candidate.tabIndex >= 0 ||
      candidate.attributes?.tabindex !== undefined ||
      candidate.contentEditable)
  );
}

/**
 * One production registry for what a discovered target can actually do.
 * It deliberately describes browser mechanisms, never site-specific workflows.
 */
export function targetCapabilitiesFor(
  candidate: DomCandidate,
): TargetCapability[] {
  const capabilities = new Set<TargetCapability>(["hover", "scroll"]);
  const role = semanticRole(candidate);
  const inputType = candidate.type ?? "text";
  const activation =
    candidate.tag === "button" ||
    candidate.tag === "a" ||
    candidate.tag === "summary" ||
    candidate.tag === "audio" ||
    candidate.tag === "video" ||
    (role !== undefined && ACTIVATION_ROLES.has(role));

  if (isProgrammaticallyFocusable(candidate)) {
    capabilities.add("focus");
    capabilities.add("press");
  }

  if (activation) {
    capabilities.add("activate");
    capabilities.add("double_activate");
    capabilities.add("secondary_activate");
  }

  const editable =
    candidate.tag === "textarea" ||
    candidate.contentEditable ||
    (candidate.tag === "input" && TEXT_INPUT_TYPES.has(inputType));

  if (editable) {
    capabilities.add("fill");
    capabilities.add("set_value");
    capabilities.add("select_text");
    capabilities.add("clipboard");
  }

  if (candidate.tag === "select") capabilities.add("select");

  if (inputType === "checkbox" || role === "checkbox" || role === "switch") {
    capabilities.add("check");
    capabilities.add("uncheck");
  }

  if (inputType === "radio" || role === "radio") capabilities.add("check");
  if (inputType === "file") capabilities.add("upload");

  const expanded = candidate.attributes?.["aria-expanded"];
  if (candidate.tag === "summary" || expanded === "false") {
    capabilities.add("expand");
  }
  if (candidate.tag === "summary" || expanded === "true") {
    capabilities.add("collapse");
  }

  if (
    candidate.attributes?.draggable === "true" ||
    candidate.attributes?.draggable === ""
  ) {
    capabilities.add("drag");
  }

  return [...capabilities];
}

export function perceivedControlFor(
  candidate: DomCandidate,
  scopes: StructuralScope[],
): PerceivedControl {
  return {
    capabilities: targetCapabilitiesFor(candidate),
    scopes,
  };
}

export const BROWSER_CAPABILITY_ATLAS_VERSION = "2026-09-08.1";

export const BROWSER_INTERACTION_KINDS = [
  "click",
  "double_click",
  "secondary_click",
  "modified_click",
  "hover",
  "focus",
  "blur",
  "press",
  "clear",
  "fill",
  "type_sequential",
  "select_text",
  "select",
  "check",
  "uncheck",
  "drag",
  "upload",
  "clipboard",
  "precise_scroll",
  "coordinate_click",
] satisfies BrowserInteractionRequest["kind"][];

export const BROWSER_HUMAN_BOUNDARIES = [
  "browser_permission",
  "webauthn",
  "payment",
  "human_verification",
  "closed_shadow_dom",
  "browser_owned_ui",
] as const;
