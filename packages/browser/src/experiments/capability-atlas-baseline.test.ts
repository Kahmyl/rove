import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";

import { classifyTargetCandidates } from "../inspection/target-classifier.js";
import {
  discoverTargetCandidates,
  recoverAccessibilityCandidates,
} from "../inspection/target-discovery.js";
import { readPerceivedControl } from "../inspection/perceived-control.js";

const EXPERIMENT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Rove capability atlas baseline</title>
    <style>
      [role], #pointer-surface { display: block; min-height: 24px; min-width: 180px; }
    </style>
  </head>
  <body>
    <button id="button">Primary action</button>
    <details id="details">
      <summary id="summary">Advanced options</summary>
      <p>Revealed content</p>
    </details>

    <label for="text">Text value</label>
    <input id="text" type="text" />
    <label for="date">Date value</label>
    <input id="date" type="date" />
    <label for="range">Range value</label>
    <input id="range" type="range" min="0" max="10" />
    <label for="color">Color value</label>
    <input id="color" type="color" />
    <label for="file">File value</label>
    <input id="file" type="file" />

    <div id="editor" role="textbox" contenteditable="true" aria-label="Editor"></div>
    <div id="switch" role="switch" tabindex="0" aria-label="Dark mode" aria-checked="false"></div>
    <div id="combobox" role="combobox" tabindex="0" aria-label="City" aria-expanded="false"></div>
    <div id="slider" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="10" aria-valuenow="5"></div>
    <div id="spinbutton" role="spinbutton" tabindex="0" aria-label="Quantity" aria-valuemin="0" aria-valuemax="10" aria-valuenow="1"></div>
    <div id="treeitem" role="treeitem" tabindex="0" aria-label="Documents" aria-expanded="false"></div>
    <div id="gridcell" role="gridcell" tabindex="0" aria-label="Budget cell"></div>
    <div id="semantic-gridcell" role="gridcell" aria-label="Static budget cell"></div>
    <canvas id="canvas" tabindex="0" aria-label="Map canvas" width="100" height="100"></canvas>

    <div id="pointer-surface">Pointer-only item</div>
    <div role="dialog" aria-label="Confirm change">
      <button id="dialog-button">Confirm</button>
    </div>

    <script>
      const results = {
        doubleClicks: 0,
        contextMenus: 0
      };
      globalThis.__roveCapabilityResults = results;

      document.querySelector("#switch").addEventListener("click", (event) => {
        const target = event.currentTarget;
        target.setAttribute(
          "aria-checked",
          target.getAttribute("aria-checked") === "true" ? "false" : "true"
        );
      });

      document.querySelector("#slider").addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight") return;
        const target = event.currentTarget;
        target.setAttribute(
          "aria-valuenow",
          String(Number(target.getAttribute("aria-valuenow")) + 1)
        );
      });

      const pointerSurface = document.querySelector("#pointer-surface");
      pointerSurface.addEventListener("dblclick", () => {
        results.doubleClicks += 1;
      });
      pointerSurface.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        results.contextMenus += 1;
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
  const page = await browser.newPage({
    viewport: { width: 1000, height: 800 },
  });
  await page.setContent(EXPERIMENT_HTML);
  return page;
}

describe("Web Capability Atlas baseline experiment", () => {
  it("measures the admitted semantic surface without treating generic visibility as operability", async () => {
    const page = await experimentPage();
    try {
      const primary = await discoverTargetCandidates(page);
      const recovery = await recoverAccessibilityCandidates(
        page,
        primary.length + 1,
      );
      const classified = classifyTargetCandidates([
        ...primary,
        ...recovery.recovered,
      ]);
      const names = new Set(classified.map((candidate) => candidate.name));

      expect(names).toContain("Primary action");
      expect(names).toContain("Volume");
      expect(names).toContain("Dark mode");
      expect(names).toContain("Map canvas");

      // Native disclosure is now explicit. An unmarked pointer-only div stays
      // outside the candidate surface because visibility alone is not agency.
      expect(names).toContain("Advanced options");
      expect(names).not.toContain("Pointer-only item");

      const slider = classified.find(
        (candidate) => candidate.name === "Volume",
      );
      const switchControl = classified.find(
        (candidate) => candidate.name === "Dark mode",
      );
      expect(slider?.kind).toBe("slider");
      expect(switchControl?.kind).toBe("switch");

      expect(
        (await readPerceivedControl(page.locator("#slider"))).capabilities,
      ).toEqual(expect.arrayContaining(["hover", "scroll", "focus", "press"]));
      expect(
        (await readPerceivedControl(page.locator("#switch"))).capabilities,
      ).toEqual(
        expect.arrayContaining([
          "check",
          "uncheck",
          "hover",
          "scroll",
          "focus",
          "press",
        ]),
      );
      expect(
        (await readPerceivedControl(page.locator("#range"))).capabilities,
      ).toEqual(expect.arrayContaining(["hover", "scroll", "focus", "press"]));
      expect(
        (await readPerceivedControl(page.locator("#semantic-gridcell")))
          .capabilities,
      ).toEqual(
        expect.arrayContaining([
          "activate",
          "double_activate",
          "secondary_activate",
        ]),
      );
      const semanticGridcellCapabilities = (
        await readPerceivedControl(page.locator("#semantic-gridcell"))
      ).capabilities;
      expect(semanticGridcellCapabilities).not.toContain("focus");
      expect(semanticGridcellCapabilities).not.toContain("press");

      const dialogButton = classified.find(
        (candidate) => candidate.name === "Confirm",
      );
      expect(dialogButton).toBeDefined();
      const dialogControl = await readPerceivedControl(
        page.locator("#dialog-button"),
      );
      expect(dialogControl.scopes).toContainEqual({
        kind: "dialog",
        label: "Confirm change",
      });
    } finally {
      await page.close();
    }
  }, 15_000);

  it("proves several gaps are protocol gaps rather than Playwright limitations", async () => {
    const page = await experimentPage();
    try {
      await page.locator("#date").fill("2026-09-07");
      await page.locator("#range").fill("7");
      await page.locator("#color").fill("#336699");
      expect(await page.locator("#date").inputValue()).toBe("2026-09-07");
      expect(await page.locator("#range").inputValue()).toBe("7");
      expect(await page.locator("#color").inputValue()).toBe("#336699");

      await page.locator("#summary").click();
      expect(
        await page.locator("#details").getAttribute("open"),
      ).not.toBeNull();

      await page.locator("#pointer-surface").dblclick();
      await page.locator("#pointer-surface").click({ button: "right" });
      await page.locator("#slider").press("ArrowRight");
      await page.locator("#switch").click();

      const results = await page.evaluate(() => {
        const measured = (
          globalThis as typeof globalThis & {
            __roveCapabilityResults: {
              doubleClicks: number;
              contextMenus: number;
            };
          }
        ).__roveCapabilityResults;
        return {
          ...measured,
          sliderValue: document
            .querySelector("#slider")
            ?.getAttribute("aria-valuenow"),
          switchChecked: document
            .querySelector("#switch")
            ?.getAttribute("aria-checked"),
        };
      });

      expect(results).toEqual({
        doubleClicks: 1,
        contextMenus: 1,
        sliderValue: "6",
        switchChecked: "true",
      });
    } finally {
      await page.close();
    }
  }, 15_000);
});
