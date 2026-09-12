import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";

import { readPerceivedControl } from "../inspection/perceived-control.js";

type Surface = "html5" | "pointer";
type Strategy =
  "current_drag_to" | "drag_to_steps" | "staged_pointer" | "synthetic_events";

interface GestureResult {
  moved: boolean;
  dragOverCount: number;
  eventTypes: string[];
  allEventsTrusted: boolean;
}

const EXPERIMENT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Rove drag strategy experiment</title>
    <style>
      .board { display: flex; gap: 80px; margin: 24px; }
      .item, .destination {
        align-items: center;
        border: 2px solid #444;
        display: flex;
        height: 100px;
        justify-content: center;
        width: 180px;
      }
      .destination.ready { border-color: green; }
    </style>
  </head>
  <body>
    <section class="board" aria-label="HTML drag and drop">
      <div id="html5-source" class="item" draggable="true">HTML item</div>
      <div id="html5-destination" class="destination">HTML folder</div>
    </section>
    <section class="board" aria-label="Pointer application">
      <div id="pointer-source" class="item" role="button" tabindex="0">Pointer item</div>
      <div id="pointer-destination" class="destination" role="button" tabindex="0">Pointer folder</div>
    </section>
    <section class="board" aria-label="Keyboard application">
      <button id="keyboard-source" class="item">Keyboard item</button>
      <button id="keyboard-destination" class="destination">Keyboard folder</button>
    </section>
    <script>
      const experiment = {
        html5: { moved: false, dragOverCount: 0, events: [] },
        pointer: { moved: false, dragOverCount: 0, events: [] },
        keyboard: { moved: false, cut: false },
      };
      globalThis.__roveDragExperiment = experiment;

      function record(surface, event) {
        experiment[surface].events.push({
          type: event.type,
          trusted: event.isTrusted,
        });
      }

      const htmlSource = document.querySelector("#html5-source");
      const htmlDestination = document.querySelector("#html5-destination");
      htmlSource.addEventListener("dragstart", (event) => {
        record("html5", event);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/x-rove-item", "html5-source");
      });
      htmlDestination.addEventListener("dragenter", (event) => {
        record("html5", event);
        event.preventDefault();
      });
      htmlDestination.addEventListener("dragover", (event) => {
        record("html5", event);
        experiment.html5.dragOverCount += 1;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (experiment.html5.dragOverCount >= 2) {
          htmlDestination.classList.add("ready");
        }
      });
      htmlDestination.addEventListener("drop", (event) => {
        record("html5", event);
        event.preventDefault();
        if (
          experiment.html5.dragOverCount >= 2 &&
          event.dataTransfer.getData("text/x-rove-item") === "html5-source"
        ) {
          htmlDestination.append(htmlSource);
          experiment.html5.moved = true;
        }
      });
      htmlSource.addEventListener("dragend", (event) => record("html5", event));

      const pointerSource = document.querySelector("#pointer-source");
      const pointerDestination = document.querySelector("#pointer-destination");
      let pointerActive = false;
      let pointerStartedAt = 0;
      let pointerMoves = 0;
      let pointerReady = false;

      pointerSource.addEventListener("pointerdown", (event) => {
        pointerActive = true;
        pointerStartedAt = performance.now();
        pointerMoves = 0;
        pointerReady = false;
        record("pointer", event);
      });
      document.addEventListener("pointermove", (event) => {
        if (!pointerActive) return;
        pointerMoves += 1;
        const overDestination =
          document.elementFromPoint(event.clientX, event.clientY)?.closest(
            "#pointer-destination",
          ) !== null;
        if (
          overDestination &&
          pointerMoves >= 4 &&
          performance.now() - pointerStartedAt >= 100
        ) {
          pointerReady = true;
          pointerDestination.classList.add("ready");
        }
        if (overDestination) {
          experiment.pointer.dragOverCount += 1;
        }
        record("pointer", event);
      });
      document.addEventListener("pointerup", (event) => {
        if (!pointerActive) return;
        const overDestination =
          document.elementFromPoint(event.clientX, event.clientY)?.closest(
            "#pointer-destination",
          ) !== null;
        record("pointer", event);
        if (pointerReady && overDestination) {
          pointerDestination.append(pointerSource);
          experiment.pointer.moved = true;
        }
        pointerActive = false;
      });

      const keyboardSource = document.querySelector("#keyboard-source");
      const keyboardDestination = document.querySelector(
        "#keyboard-destination",
      );
      document.addEventListener("keydown", (event) => {
        const accelerator = event.metaKey || event.ctrlKey;
        const key = event.key.toLowerCase();
        if (
          accelerator &&
          key === "x" &&
          document.activeElement === keyboardSource
        ) {
          event.preventDefault();
          experiment.keyboard.cut = true;
        }
        if (
          accelerator &&
          key === "v" &&
          experiment.keyboard.cut &&
          document.activeElement === keyboardDestination
        ) {
          event.preventDefault();
          keyboardDestination.append(keyboardSource);
          experiment.keyboard.moved = true;
          experiment.keyboard.cut = false;
        }
      });
    </script>
  </body>
</html>`;

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
});

async function experimentPage(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
  await page.setContent(EXPERIMENT_HTML);
  return page;
}

async function stagedPointerDrag(
  page: Page,
  sourceSelector: string,
  destinationSelector: string,
): Promise<void> {
  const source = await page.locator(sourceSelector).boundingBox();
  const destination = await page.locator(destinationSelector).boundingBox();
  if (source === null || destination === null) {
    throw new Error("Experiment source or destination has no visible bounds.");
  }

  const sourceCenter = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
  };
  const destinationCenter = {
    x: destination.x + destination.width / 2,
    y: destination.y + destination.height / 2,
  };

  await page.mouse.move(sourceCenter.x, sourceCenter.y);
  await page.mouse.down();
  await page.mouse.move(sourceCenter.x + 12, sourceCenter.y, { steps: 2 });
  await page.waitForTimeout(125);
  await page.mouse.move(destinationCenter.x, destinationCenter.y, { steps: 8 });
  // Playwright documents the repeated target move as necessary for pages that
  // gate acceptance on dragover in every browser.
  await page.mouse.move(destinationCenter.x, destinationCenter.y);
  await page.waitForTimeout(50);
  await page.mouse.up();
}

async function syntheticDrag(
  page: Page,
  sourceSelector: string,
  destinationSelector: string,
): Promise<void> {
  await page.evaluate(
    ({ sourceSelector, destinationSelector }) => {
      const source = document.querySelector(sourceSelector);
      const destination = document.querySelector(destinationSelector);
      if (source === null || destination === null) return;
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, dataTransfer }),
      );
      destination.dispatchEvent(
        new DragEvent("dragenter", { bubbles: true, dataTransfer }),
      );
      destination.dispatchEvent(
        new DragEvent("dragover", { bubbles: true, dataTransfer }),
      );
      destination.dispatchEvent(
        new DragEvent("dragover", { bubbles: true, dataTransfer }),
      );
      destination.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer }),
      );
      source.dispatchEvent(
        new DragEvent("dragend", { bubbles: true, dataTransfer }),
      );
    },
    { sourceSelector, destinationSelector },
  );
}

async function runGesture(
  strategy: Strategy,
  surface: Surface,
): Promise<GestureResult> {
  const page = await experimentPage();
  const source = `#${surface}-source`;
  const destination = `#${surface}-destination`;

  try {
    if (strategy === "current_drag_to") {
      await page.locator(source).dragTo(page.locator(destination));
    } else if (strategy === "drag_to_steps") {
      await page
        .locator(source)
        .dragTo(page.locator(destination), { steps: 8 });
    } else if (strategy === "staged_pointer") {
      await stagedPointerDrag(page, source, destination);
    } else {
      await syntheticDrag(page, source, destination);
    }

    return await page.evaluate((surface) => {
      const result = (
        globalThis as unknown as {
          __roveDragExperiment: Record<
            string,
            {
              moved: boolean;
              dragOverCount: number;
              events: Array<{ type: string; trusted: boolean }>;
            }
          >;
        }
      ).__roveDragExperiment[surface];
      return {
        moved: result.moved,
        dragOverCount: result.dragOverCount,
        eventTypes: result.events.map((event) => event.type),
        allEventsTrusted:
          result.events.length > 0 &&
          result.events.every((event) => event.trusted),
      };
    }, surface);
  } finally {
    await page.close();
  }
}

async function runKeyboardMove(): Promise<boolean> {
  const page = await experimentPage();
  try {
    await page.locator("#keyboard-source").focus();
    await page.keyboard.press("Meta+X");
    await page.locator("#keyboard-destination").focus();
    await page.keyboard.press("Meta+V");
    return await page.evaluate(
      () =>
        (
          globalThis as unknown as {
            __roveDragExperiment: { keyboard: { moved: boolean } };
          }
        ).__roveDragExperiment.keyboard.moved,
    );
  } finally {
    await page.close();
  }
}

async function perceivedDragCapabilities(): Promise<{
  html5: string[];
  pointer: string[];
}> {
  const page = await experimentPage();
  try {
    const html5 = await readPerceivedControl(page.locator("#html5-source"));
    const pointer = await readPerceivedControl(page.locator("#pointer-source"));
    return {
      html5: html5.capabilities,
      pointer: pointer.capabilities,
    };
  } finally {
    await page.close();
  }
}

describe("isolated drag and semantic-move strategy experiment", () => {
  it("compares current, staged-pointer, synthetic, and keyboard strategies", async () => {
    const matrix = {
      current: {
        html5: await runGesture("current_drag_to", "html5"),
        pointer: await runGesture("current_drag_to", "pointer"),
      },
      steppedDragTo: {
        html5: await runGesture("drag_to_steps", "html5"),
        pointer: await runGesture("drag_to_steps", "pointer"),
      },
      stagedPointer: {
        html5: await runGesture("staged_pointer", "html5"),
        pointer: await runGesture("staged_pointer", "pointer"),
      },
      synthetic: {
        html5: await runGesture("synthetic_events", "html5"),
        pointer: await runGesture("synthetic_events", "pointer"),
      },
      keyboardMove: await runKeyboardMove(),
      perceivedCapabilities: await perceivedDragCapabilities(),
    };

    // One-shot drag timing is environment-dependent: under load it can
    // accidentally satisfy a dwell threshold. Its result is recorded for
    // comparison, but only the bounded staged strategy is a production gate.
    expect(typeof matrix.current.pointer.moved).toBe("boolean");
    expect(matrix.steppedDragTo.html5.moved).toBe(true);
    expect(typeof matrix.steppedDragTo.pointer.moved).toBe("boolean");
    expect(matrix.stagedPointer.html5.moved).toBe(true);
    expect(matrix.stagedPointer.pointer.moved).toBe(true);
    expect(matrix.stagedPointer.html5.dragOverCount).toBeGreaterThanOrEqual(2);
    expect(matrix.stagedPointer.html5.allEventsTrusted).toBe(true);
    expect(matrix.synthetic.html5.moved).toBe(true);
    expect(matrix.synthetic.html5.allEventsTrusted).toBe(false);
    expect(matrix.synthetic.pointer.moved).toBe(false);
    expect(matrix.keyboardMove).toBe(true);
    expect(matrix.perceivedCapabilities.html5).toContain("drag");
    expect(matrix.perceivedCapabilities.pointer).not.toContain("drag");

    process.stdout.write(
      `\nROVE_DRAG_MOVE_EXPERIMENT=${JSON.stringify(matrix)}\n`,
    );
  });
});
