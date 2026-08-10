import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

import type { PageState } from "../pages/page-state.js";
import {
  startFixtureServer,
  type FixtureServer,
} from "../fixtures/fixture-server.js";
import { PageInspector } from "./inspector.js";

let browser: Browser;
let context: BrowserContext;
let page: Page;
let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
  browser = await chromium.launch({
    headless: true,
  });
});

beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();

  await page.goto(server.url, {
    waitUntil: "domcontentloaded",
  });
});

afterEach(async () => {
  await context.close();
});

afterAll(async () => {
  await browser.close();
  await server.close();
});

describe("PageInspector invalidation", () => {
  it("invalidates old refs and removes DOM markers", async () => {
    const inspector = new PageInspector();

    const state: PageState = {
      id: "page_01",
      revision: 1,
      mutationVersion: 1,
      url: page.url(),
      title: await page.title(),
      active: true,
    };

    const inspection = await inspector.inspect(
      page,
      state,
    );

    const first = inspection.targets?.[0];

    expect(first).toBeDefined();

    expect(
      await page.locator("[data-rove-target]").count(),
    ).toBeGreaterThan(0);

    const registry =
      inspector.registryForPage("page_01");

    expect(registry).toBeDefined();

    await inspector.invalidatePage(
      page,
      "page_01",
      2,
    );

    expect(
      await page.locator("[data-rove-target]").count(),
    ).toBe(0);

    expect(() =>
      registry!.resolve({
        pageId: "page_01",
        revision: 1,
        ref: first!.ref,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "TARGET_STALE",
      }),
    );
  });
});
