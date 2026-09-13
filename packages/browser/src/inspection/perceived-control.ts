import type {
  BrowserTargetGeometry,
  BrowserViewport,
  PageTargetState,
  PerceivedControl,
  StructuralScope,
} from "@rove/protocol";

import type { Frame, Locator } from "playwright";
import { perceivedControlFor } from "../capabilities/browser-capability-registry.js";
import type { DomCandidate } from "./dom-types.js";

export interface TargetSnapshot {
  geometry: BrowserTargetGeometry;
  perceived: PerceivedControl;
  state: PageTargetState;
  nodeToken: string;
  rootToken: string;
}

export async function readTargetSnapshots(
  frame: Frame,
  viewport: BrowserViewport,
): Promise<Map<string, TargetSnapshot>> {
  const frameElement = await frame.frameElement().catch(() => undefined);
  const frameBounds =
    frame.parentFrame() === null
      ? undefined
      : await frameElement?.boundingBox().catch(() => null);
  const offset = {
    x: frameBounds?.x ?? 0,
    y: frameBounds?.y ?? 0,
  };
  const snapshots = await frame.locator("[data-rove-target]").evaluateAll(
    (elements, input) => {
      const normalize = (
        value: string | null | undefined,
      ): string | undefined => {
        const result = value?.replace(/\s+/g, " ").trim();
        return result && result.length > 0 ? result.slice(0, 500) : undefined;
      };
      const dedupe = <T>(values: T[], key: (value: T) => string): T[] => {
        const seen = new Set<string>();
        return values.filter((value) => {
          const identity = key(value);
          if (seen.has(identity)) return false;
          seen.add(identity);
          return true;
        });
      };

      return elements.flatMap((element) => {
        const marker = element.getAttribute("data-rove-target");
        if (marker === null) return [];
        const scopedWindow = window as unknown as {
          __roveNodeIdentity?: {
            counter: number;
            tokens: WeakMap<object, string>;
          };
        };
        const identities = (scopedWindow.__roveNodeIdentity ??= {
          counter: 0,
          tokens: new WeakMap<object, string>(),
        });
        const tokenFor = (value: object): string => {
          const existing = identities.tokens.get(value);
          if (existing !== undefined) return existing;
          identities.counter += 1;
          const token = `node_${identities.counter}`;
          identities.tokens.set(value, token);
          return token;
        };
        const semanticRoot = element.getRootNode();
        const nodeToken = tokenFor(element);
        const rootToken = tokenFor(semanticRoot);
        const field = element instanceof HTMLInputElement ? element : undefined;
        const tag = element.tagName.toLowerCase();
        const scopes: StructuralScope[] = [];
        const addScope = (kind: StructuralScope["kind"], node: Element) => {
          const ariaLabel = normalize(node.getAttribute("aria-label"));
          const labelledby = node
            .getAttribute("aria-labelledby")
            ?.split(/\s+/)
            .filter(Boolean)
            .map(
              (id) => node.ownerDocument.getElementById(id)?.textContent ?? "",
            )
            .join(" ");
          const heading = node.querySelector(
            "h1,h2,h3,h4,h5,h6,legend",
          )?.textContent;
          const label =
            ariaLabel ?? normalize(labelledby) ?? normalize(heading);
          scopes.push({ kind, ...(label === undefined ? {} : { label }) });
        };
        let current = element.parentElement;
        while (current !== null) {
          const currentRole = normalize(
            current.getAttribute("role"),
          )?.toLowerCase();
          const currentTag = current.tagName.toLowerCase();
          if (currentTag === "form") addScope("form", current);
          if (
            currentTag === "dialog" ||
            currentRole === "dialog" ||
            currentRole === "alertdialog"
          )
            addScope("dialog", current);
          if (currentTag === "tr" || currentRole === "row")
            addScope("row", current);
          if (currentRole === "region" || currentTag === "section")
            addScope("region", current);
          if (
            currentTag === "article" ||
            current.getAttribute("data-card") !== null
          )
            addScope("card", current);
          if (currentRole === "group" || currentTag === "fieldset")
            addScope("group", current);
          if (
            currentRole === "list" ||
            currentTag === "ul" ||
            currentTag === "ol"
          )
            addScope("list", current);
          if (currentRole === "listbox") addScope("listbox", current);
          if (currentRole === "tree") addScope("tree", current);
          if (currentRole === "grid" || currentRole === "treegrid")
            addScope("grid", current);
          if (currentRole === "table" || currentTag === "table")
            addScope("table", current);
          if (currentRole === "menu" || currentRole === "menubar")
            addScope("menu", current);
          current = current.parentElement;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const hasBox =
          element.isConnected &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.visibility !== "collapse" &&
          Number.parseFloat(style.opacity || "1") !== 0 &&
          rect.width > 0 &&
          rect.height > 0;
        let geometry: BrowserTargetGeometry;
        if (!hasBox) {
          geometry = {
            bounds: null,
            inViewport: false,
            clipped: true,
            occluded: false,
          };
        } else {
          const bounds = {
            x: rect.x + input.offset.x,
            y: rect.y + input.offset.y,
            width: rect.width,
            height: rect.height,
          };
          const right = bounds.x + bounds.width;
          const bottom = bounds.y + bounds.height;
          const root = element.getRootNode();
          const hit =
            root instanceof ShadowRoot
              ? root.elementFromPoint(
                  rect.left + rect.width / 2,
                  rect.top + rect.height / 2,
                )
              : element.ownerDocument.elementFromPoint(
                  rect.left + rect.width / 2,
                  rect.top + rect.height / 2,
                );
          geometry = {
            bounds,
            inViewport:
              right > 0 &&
              bottom > 0 &&
              bounds.x < input.viewport.width &&
              bounds.y < input.viewport.height,
            clipped:
              bounds.x < 0 ||
              bounds.y < 0 ||
              right > input.viewport.width ||
              bottom > input.viewport.height,
            occluded:
              hit instanceof Element &&
              hit !== element &&
              !element.contains(hit),
          };
        }

        const state: PageTargetState = {};
        const setState = <Key extends keyof PageTargetState>(
          key: Key,
          value: PageTargetState[Key] | undefined,
        ) => {
          if (value !== undefined) state[key] = value;
        };
        const aria = (name: string) =>
          normalize(element.getAttribute(`aria-${name}`))?.toLowerCase();
        const ariaBoolean = (name: string): boolean | undefined => {
          const value = aria(name);
          return value === "true"
            ? true
            : value === "false"
              ? false
              : undefined;
        };
        const ariaNumber = (name: string): number | undefined => {
          const value = aria(name);
          if (value === undefined) return undefined;
          const number = Number(value);
          return Number.isFinite(number) ? number : undefined;
        };
        const root = semanticRoot;
        const activeElement =
          root instanceof Document || root instanceof ShadowRoot
            ? root.activeElement
            : element.ownerDocument.activeElement;
        state.focused = activeElement === element;
        if (
          field !== undefined &&
          (field.type === "checkbox" || field.type === "radio")
        ) {
          state.checked = field.checked;
        } else if (element instanceof HTMLSelectElement) {
          state.selectedValues = Array.from(element.selectedOptions)
            .map((option) => option.value)
            .slice(0, 100);
        }
        if (state.checked === undefined)
          setState("checked", ariaBoolean("checked"));
        setState("expanded", ariaBoolean("expanded"));
        const pressed = aria("pressed");
        setState(
          "pressed",
          pressed === "mixed"
            ? "mixed"
            : pressed === "true"
              ? true
              : pressed === "false"
                ? false
                : undefined,
        );
        setState("selected", ariaBoolean("selected"));
        if (state.selected === undefined) {
          const selectionOwner = element.closest('[aria-selected="true"]');
          const selectionOwnerRole = selectionOwner
            ?.getAttribute("role")
            ?.trim()
            .toLowerCase();
          if (
            selectionOwner !== null &&
            selectionOwner !== element &&
            ["row", "option", "treeitem"].includes(selectionOwnerRole ?? "")
          ) {
            // Composite widgets commonly expose item selection on the owning
            // row while the actionable/name-bearing target is a descendant.
            // Carry that semantic item state onto the descendant target so
            // callers do not have to understand application DOM boundaries.
            state.selected = true;
          }
        }
        const ariaCurrent = aria("current");
        setState(
          "current",
          ariaCurrent === "true"
            ? true
            : ariaCurrent === "false" || ariaCurrent === undefined
              ? undefined
              : ariaCurrent,
        );
        setState("busy", ariaBoolean("busy"));
        const invalid = aria("invalid");
        setState(
          "invalid",
          invalid === "true"
            ? true
            : invalid === "false" || invalid === undefined
              ? undefined
              : invalid,
        );
        setState(
          "required",
          field?.required ??
            (element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement
              ? element.required
              : undefined) ??
            ariaBoolean("required"),
        );
        setState(
          "readOnly",
          field?.readOnly ??
            (element instanceof HTMLTextAreaElement
              ? element.readOnly
              : undefined) ??
            ariaBoolean("readonly"),
        );
        const open =
          element instanceof HTMLDetailsElement
            ? element.open
            : element.parentElement instanceof HTMLDetailsElement &&
                tag === "summary"
              ? element.parentElement.open
              : undefined;
        setState("open", open);
        if (state.expanded === undefined) setState("expanded", open);
        setState(
          "valueNow",
          field !== undefined && ["number", "range"].includes(field.type)
            ? Number.isFinite(field.valueAsNumber)
              ? field.valueAsNumber
              : undefined
            : ariaNumber("valuenow"),
        );
        setState(
          "valueMin",
          field !== undefined && ["number", "range"].includes(field.type)
            ? field.min.length > 0
              ? Number(field.min)
              : undefined
            : ariaNumber("valuemin"),
        );
        setState(
          "valueMax",
          field !== undefined && ["number", "range"].includes(field.type)
            ? field.max.length > 0
              ? Number(field.max)
              : undefined
            : ariaNumber("valuemax"),
        );
        setState(
          "valueText",
          normalize(element.getAttribute("aria-valuetext")),
        );
        const orientation = aria("orientation");
        setState(
          "orientation",
          orientation === "vertical" || orientation === "horizontal"
            ? orientation
            : undefined,
        );
        const hasPopup = aria("haspopup");
        setState(
          "hasPopup",
          hasPopup === "true"
            ? true
            : hasPopup === "false" || hasPopup === undefined
              ? undefined
              : hasPopup,
        );
        setState(
          "controls",
          element
            .getAttribute("aria-controls")
            ?.split(/\s+/)
            .filter(Boolean)
            .slice(0, 100),
        );
        setState(
          "activeDescendant",
          normalize(element.getAttribute("aria-activedescendant")),
        );
        const secretSignal = [
          field?.type,
          field?.autocomplete,
          element.getAttribute("aria-label"),
          element.getAttribute("placeholder"),
          element.getAttribute("name"),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const sensitive =
          field?.type === "password" ||
          /(?:password|passcode|one-time-code|otp|secret|token)/.test(
            secretSignal,
          );
        if (
          !sensitive &&
          field !== undefined &&
          !["checkbox", "radio", "file"].includes(field.type)
        ) {
          state.value = field.value.slice(0, 100_000);
        } else if (!sensitive && field?.type === "file") {
          state.fileNames = Array.from(field.files ?? [])
            .map((file) => file.name)
            .slice(0, 100);
        } else if (!sensitive && element instanceof HTMLTextAreaElement) {
          state.value = element.value.slice(0, 100_000);
        }
        return [
          {
            marker,
            nodeToken,
            rootToken,
            geometry,
            perceived: {
              capabilities: [],
              scopes: dedupe(
                scopes,
                (item) => `${item.kind}:${item.label ?? ""}`,
              ),
            },
            state,
          },
        ];
      });
    },
    { viewport, offset },
  );

  const fileEvidence = await frame
    .locator('input[type="file"][data-rove-target]')
    .evaluateAll(async (elements) =>
      Promise.all(
        elements.map(async (element) => {
          const input = element as HTMLInputElement;
          const files = await Promise.all(
            Array.from(input.files ?? [])
              .slice(0, 100)
              .map(async (file) => {
                const digest = await crypto.subtle.digest(
                  "SHA-256",
                  await file.arrayBuffer(),
                );
                return {
                  name: file.name,
                  size: file.size,
                  sha256: Array.from(new Uint8Array(digest), (byte) =>
                    byte.toString(16).padStart(2, "0"),
                  ).join(""),
                };
              }),
          );
          return {
            marker: input.getAttribute("data-rove-target"),
            files,
          };
        }),
      ),
    );
  const filesByMarker = new Map(
    fileEvidence.flatMap((entry) =>
      entry.marker === null ? [] : [[entry.marker, entry.files] as const],
    ),
  );

  return new Map(
    snapshots.map((snapshot) => [
      snapshot.marker,
      {
        nodeToken: snapshot.nodeToken,
        rootToken: snapshot.rootToken,
        geometry: {
          ...snapshot.geometry,
          ...(snapshot.geometry.bounds === null
            ? {}
            : {
                bounds: {
                  x: round(snapshot.geometry.bounds.x),
                  y: round(snapshot.geometry.bounds.y),
                  width: round(snapshot.geometry.bounds.width),
                  height: round(snapshot.geometry.bounds.height),
                },
              }),
        },
        perceived: snapshot.perceived,
        state: {
          ...snapshot.state,
          ...(filesByMarker.has(snapshot.marker)
            ? { files: filesByMarker.get(snapshot.marker)! }
            : {}),
        },
      },
    ]),
  );
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

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
  const value = await locator.evaluate((element) => {
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

      if (
        currentRole === "list" ||
        currentTag === "ul" ||
        currentTag === "ol"
      ) {
        addScope("list", current);
      }

      if (currentRole === "listbox") addScope("listbox", current);
      if (currentRole === "tree") addScope("tree", current);
      if (currentRole === "grid" || currentRole === "treegrid")
        addScope("grid", current);
      if (currentRole === "table" || currentTag === "table")
        addScope("table", current);
      if (currentRole === "menu" || currentRole === "menubar")
        addScope("menu", current);

      current = current.parentElement;
    }

    return {
      candidate: {
        marker: "direct",
        tag,
        ...(input === undefined ? {} : { type: input.type.toLowerCase() }),
        ...(role === undefined ? {} : { role }),
        text: (html.innerText ?? element.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        visible: true,
        disabled:
          element.getAttribute("aria-disabled")?.toLowerCase() === "true" ||
          ("disabled" in html && html.disabled === true),
        contentEditable: html.isContentEditable,
        tabIndex: html.tabIndex,
        attributes: {
          ...(element.getAttribute("aria-expanded") === null
            ? {}
            : { "aria-expanded": element.getAttribute("aria-expanded")! }),
          ...(element.getAttribute("draggable") === null
            ? {}
            : { draggable: element.getAttribute("draggable")! }),
        },
      },
      scopes,
    };
  });

  return perceivedControlFor(
    value.candidate as DomCandidate,
    dedupe(value.scopes, (item) => `${item.kind}:${item.label ?? ""}`),
  );
}

export async function readVerificationState(
  locator: Locator,
  sensitive: boolean,
): Promise<{
  checked?: boolean;
  selectedValues?: string[];
  value?: string;
  fileNames?: string[];
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

    if (
      element instanceof HTMLInputElement &&
      element.type === "file" &&
      !isSensitive
    ) {
      return {
        fileNames: Array.from(element.files ?? [])
          .map((file) => file.name)
          .slice(0, 100),
      };
    }

    if (
      !isSensitive &&
      (element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement)
    ) {
      return { value: element.value.slice(0, 100_000) };
    }

    return {};
  }, sensitive);
}
