import type {
  BrowserTargetGeometry,
  BrowserViewport,
  PerceivedControl,
  StructuralScope,
  TargetCapability,
} from "@rove/protocol";

import type { Frame, Locator } from "playwright";

export interface TargetSnapshot {
  geometry: BrowserTargetGeometry;
  perceived: PerceivedControl;
  state: {
    checked?: boolean;
    selectedValues?: string[];
  };
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
        const html = element as HTMLElement;
        const field = element instanceof HTMLInputElement ? element : undefined;
        const tag = element.tagName.toLowerCase();
        const role = normalize(element.getAttribute("role"))?.toLowerCase();
        const capabilities: TargetCapability[] = [];
        const addCapability = (capability: TargetCapability) => {
          if (!capabilities.includes(capability)) capabilities.push(capability);
        };
        if (
          tag === "button" ||
          tag === "a" ||
          role === "button" ||
          role === "link" ||
          role === "tab" ||
          role === "menuitem"
        )
          addCapability("activate");
        if (
          tag === "textarea" ||
          html.isContentEditable ||
          (field !== undefined &&
            ![
              "button",
              "submit",
              "reset",
              "checkbox",
              "radio",
              "file",
              "hidden",
            ].includes(field.type))
        )
          addCapability("fill");
        if (tag === "select") addCapability("select");
        if (
          field?.type === "checkbox" ||
          role === "checkbox" ||
          role === "switch"
        ) {
          addCapability("check");
          addCapability("uncheck");
        }
        if (field?.type === "radio" || role === "radio") addCapability("check");
        if (field?.type === "file") addCapability("upload");
        addCapability("hover");
        addCapability("scroll");
        if (html.draggable || element.getAttribute("draggable") === "true")
          addCapability("drag");

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

        const state: TargetSnapshot["state"] = {};
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
        return [
          {
            marker,
            geometry,
            perceived: {
              capabilities: dedupe(capabilities, (item) => item),
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

  return new Map(
    snapshots.map((snapshot) => [
      snapshot.marker,
      {
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
        state: snapshot.state,
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
