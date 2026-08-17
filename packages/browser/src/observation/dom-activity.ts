export type DomActivityType =
  | "interaction_click"
  | "form_submitted"
  | "scroll_milestone"
  | "selection_changed";

export interface NormalizedDomActivity {
  type: DomActivityType;
  data: Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(value: unknown, max = 120): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim().slice(0, max);

  return normalized.length === 0 ? undefined : normalized;
}

export function normalizeDomActivityPayload(
  payload: unknown,
): NormalizedDomActivity | null {
  const item = record(payload);

  if (item === null || typeof item.type !== "string") {
    return null;
  }

  if (item.type === "interaction_click") {
    const tag = boundedString(item.tag, 30);
    const role = boundedString(item.role, 60);
    const label = boundedString(item.label);

    return {
      type: item.type,
      data: {
        ...(tag === undefined ? {} : { tag }),
        ...(role === undefined ? {} : { role }),
        ...(label === undefined ? {} : { label }),
      },
    };
  }

  if (item.type === "form_submitted") {
    const formId = boundedString(item.formId, 80);

    const method = boundedString(item.method, 20);

    return {
      type: item.type,
      data: {
        ...(formId === undefined ? {} : { formId }),
        ...(method === undefined ? {} : { method }),
      },
    };
  }

  if (item.type === "scroll_milestone") {
    if (
      item.percent !== 25 &&
      item.percent !== 50 &&
      item.percent !== 75 &&
      item.percent !== 100
    ) {
      return null;
    }

    return {
      type: item.type,
      data: {
        percent: item.percent,
      },
    };
  }

  if (item.type === "selection_changed") {
    const tag = boundedString(item.tag, 30);
    const role = boundedString(item.role, 60);
    const label = boundedString(item.label);

    const selectedIndex =
      typeof item.selectedIndex === "number" &&
      Number.isInteger(item.selectedIndex) &&
      item.selectedIndex >= 0
        ? item.selectedIndex
        : undefined;

    return {
      type: item.type,
      data: {
        ...(tag === undefined ? {} : { tag }),
        ...(role === undefined ? {} : { role }),
        ...(label === undefined ? {} : { label }),
        ...(selectedIndex === undefined ? {} : { selectedIndex }),
      },
    };
  }

  return null;
}

export const DOM_ACTIVITY_INIT_SCRIPT = String.raw`
(() => {
  const activityWindow = window;

  if (
    activityWindow.__roveDomActivityInstalled ===
    true
  ) {
    return;
  }

  let queue =
    activityWindow.__roveDomActivityQueue;

  if (!Array.isArray(queue)) {
    queue = [];

    Object.defineProperty(
      activityWindow,
      "__roveDomActivityQueue",
      {
        value: queue,
        configurable: false,
        enumerable: false,
        writable: false,
      },
    );
  }

  Object.defineProperty(
    activityWindow,
    "__roveDomActivityInstalled",
    {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    },
  );

  function report(payload) {
    queue.push(payload);

    if (queue.length > 1000) {
      queue.splice(
        0,
        queue.length - 1000,
      );
    }
  }

  function labelFor(element) {
    const aria =
      element
        .getAttribute("aria-label")
        ?.trim();

    if (aria) {
      return aria.slice(0, 120);
    }

    if (
      element.tagName === "BUTTON" ||
      element.tagName === "A" ||
      element.getAttribute("role") ===
        "button" ||
      element.getAttribute("role") ===
        "link"
    ) {
      const text =
        element.textContent
          ?.replace(/\s+/g, " ")
          .trim();

      if (text) {
        return text.slice(0, 120);
      }
    }

    return (
      element.getAttribute("name") ||
      element.id ||
      element.tagName.toLowerCase()
    ).slice(0, 120);
  }

  document.addEventListener(
    "click",
    (event) => {
      if (
        !(event.target instanceof Element)
      ) {
        return;
      }

      const element =
        event.target.closest(
          [
            "a",
            "button",
            "summary",
            "select",
            "[role='button']",
            "[role='link']",
            "[role='tab']",
            "[role='menuitem']",
            "input[type='button']",
            "input[type='submit']",
            "input[type='checkbox']",
            "input[type='radio']",
          ].join(","),
        );

      if (element === null) {
        return;
      }

      report({
        type: "interaction_click",
        tag:
          element.tagName.toLowerCase(),
        role:
          element.getAttribute("role") ??
          "",
        label: labelFor(element),
      });
    },
    true,
  );

  document.addEventListener(
    "submit",
    (event) => {
      if (
        !(
          event.target instanceof
          HTMLFormElement
        )
      ) {
        return;
      }

      report({
        type: "form_submitted",
        formId:
          event.target.id ||
          event.target.getAttribute(
            "name",
          ) ||
          "",
        method: event.target.method,
      });
    },
    true,
  );

  const selectedIndices =
    new WeakMap();

  for (
    const element of Array.from(
      document.querySelectorAll(
        "select",
      ),
    )
  ) {
    selectedIndices.set(
      element,
      element.selectedIndex,
    );
  }

  function reportSelection(element) {
    const selectedIndex =
      element.selectedIndex;

    const previousIndex =
      selectedIndices.get(element);

    if (
      previousIndex !== undefined &&
      previousIndex === selectedIndex
    ) {
      return;
    }

    selectedIndices.set(
      element,
      selectedIndex,
    );

    report({
      type: "selection_changed",
      tag: "select",
      role:
        element.getAttribute("role") ??
        "",
      label: labelFor(element),
      selectedIndex,
    });
  }

  function observeSelection(event) {
    if (
      !(
        event.target instanceof
        HTMLSelectElement
      )
    ) {
      return;
    }

    reportSelection(event.target);
  }

  document.addEventListener(
    "input",
    observeSelection,
    true,
  );

  document.addEventListener(
    "change",
    observeSelection,
    true,
  );

  document.addEventListener(
    "keyup",
    (event) => {
      if (
        !(
          event.target instanceof
          HTMLSelectElement
        )
      ) {
        return;
      }

      reportSelection(event.target);
    },
    true,
  );

  let highestScrollMilestone = 0;
  let scrollScheduled = false;

  window.addEventListener(
    "scroll",
    () => {
      if (scrollScheduled) {
        return;
      }

      scrollScheduled = true;

      requestAnimationFrame(() => {
        scrollScheduled = false;

        const scrollHeight =
          Math.max(
            document.documentElement
              .scrollHeight,
            document.body
              ?.scrollHeight ?? 0,
          );

        const maximum =
          scrollHeight -
          window.innerHeight;

        if (maximum <= 0) {
          return;
        }

        const percentage =
          (
            window.scrollY /
            maximum
          ) * 100;

        let milestone = 0;

        if (percentage >= 100) {
          milestone = 100;
        } else if (
          percentage >= 75
        ) {
          milestone = 75;
        } else if (
          percentage >= 50
        ) {
          milestone = 50;
        } else if (
          percentage >= 25
        ) {
          milestone = 25;
        }

        if (
          milestone === 0 ||
          milestone <=
            highestScrollMilestone
        ) {
          return;
        }

        highestScrollMilestone =
          milestone;

        report({
          type: "scroll_milestone",
          percent: milestone,
        });
      });
    },
    {
      passive: true,
    },
  );
})();
`;
