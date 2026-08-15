import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

import {
  installMutationTracker,
  readMaterialMutationVersion,
} from "./mutation-tracker.js";

let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({
    headless: true,
  });

  context = await browser.newContext();
  page = await context.newPage();
});

afterAll(async () => {
  await context.close();
  await browser.close();
});

describe("material mutation tracker lifecycle", () => {
  it("defers safely when the document root is transiently unavailable and installs later", async () => {
    await page.goto("about:blank");

    await page.evaluate(() => {
      document.documentElement?.remove();
    });

    expect(await page.evaluate(() => document.documentElement === null)).toBe(
      true,
    );

    await expect(installMutationTracker(page)).resolves.toBeUndefined();

    await expect(readMaterialMutationVersion(page)).resolves.toBe(0);

    await page.setContent(`
      <!doctype html>
      <html>
        <body>
          <main>
            <button id="initial">Initial</button>
          </main>
        </body>
      </html>
    `);

    await expect(installMutationTracker(page)).resolves.toBeUndefined();

    const before = await readMaterialMutationVersion(page);

    await page.evaluate(() => {
      const button = document.createElement("button");

      button.textContent = "Added";
      document.body.appendChild(button);
    });

    await page.waitForTimeout(20);

    const after = await readMaterialMutationVersion(page);

    expect(after).toBeGreaterThan(before);
  });
});
