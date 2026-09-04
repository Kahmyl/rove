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
  setTransientTargetStyleMutationSuppression,
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
  it("keeps ordinary marked-target style changes material", async () => {
    const testPage =
      await context.newPage();

    try {
      await testPage.setContent(`
        <!doctype html>
        <html>
          <body>
            <button
              data-rove-target="r1"
              style="display: block"
            >
              Action
            </button>
          </body>
        </html>
      `);

      await installMutationTracker(
        testPage,
      );

      const before =
        await readMaterialMutationVersion(
          testPage,
        );

      await testPage.evaluate(() => {
        document
          .querySelector<HTMLElement>(
            '[data-rove-target="r1"]',
          )!
          .style.display = "none";
      });

      await testPage.waitForTimeout(20);

      expect(
        await readMaterialMutationVersion(
          testPage,
        ),
      ).toBeGreaterThan(before);
    } finally {
      await testPage.close();
    }
  });

  it("suppresses target style churn only inside the explicit capture scope", async () => {
    const testPage =
      await context.newPage();

    try {
      await testPage.setContent(`
        <!doctype html>
        <html>
          <body>
            <button
              data-rove-target="r1"
              style="display: block"
            >
              Action
            </button>
          </body>
        </html>
      `);

      await installMutationTracker(
        testPage,
      );

      const before =
        await readMaterialMutationVersion(
          testPage,
        );

      await setTransientTargetStyleMutationSuppression(
        testPage,
        true,
      );

      try {
        await testPage.evaluate(() => {
          const element =
            document.querySelector<HTMLElement>(
              '[data-rove-target="r1"]',
            )!;

          const original =
            element.getAttribute(
              "style",
            );

          element.style.opacity =
            "0";

          element.setAttribute(
            "style",
            original!,
          );
        });

        await testPage.waitForTimeout(
          20,
        );
      } finally {
        await setTransientTargetStyleMutationSuppression(
          testPage,
          false,
        );
      }

      expect(
        await readMaterialMutationVersion(
          testPage,
        ),
      ).toBe(before);

      await testPage.evaluate(() => {
        document
          .querySelector<HTMLElement>(
            '[data-rove-target="r1"]',
          )!
          .style.display = "none";
      });

      await testPage.waitForTimeout(20);

      expect(
        await readMaterialMutationVersion(
          testPage,
        ),
      ).toBeGreaterThan(before);
    } finally {
      await testPage.close();
    }
  });

});
