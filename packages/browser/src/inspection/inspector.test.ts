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
import {
  PageInspector,
  resolveInspectOptions,
} from "./inspector.js";

let browser: Browser;
let context: BrowserContext;
let page: Page;
let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
  browser = await chromium.launch({ headless: true });
});

beforeEach(async () => {
  context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 900,
    },
  });

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

async function state(revision = 1): Promise<PageState> {
  return {
    id: "page_01",
    revision,
    mutationVersion: revision,
    url: page.url(),
    title: await page.title(),
    active: true,
  };
}

describe("resolveInspectOptions", () => {
  it("uses the fixed Milestone 2 defaults", () => {
    expect(resolveInspectOptions()).toEqual({
      includeText: true,
      includeTargets: true,
      includeViewport: true,
      maxTextChars: 20_000,
      targetLimit: 200,
    });
  });
});

describe("PageInspector", () => {
  it("returns page metadata, viewport, text, and targets by default", async () => {
    const inspector = new PageInspector();

    const inspection = await inspector.inspect(
      page,
      await state(),
    );

    expect(inspection).toMatchObject({
      pageId: "page_01",
      revision: 1,
      url: page.url(),
      title: "Rove Inspection Fixture",
      viewport: {
        width: 1440,
        height: 900,
      },
      metadata: {
        textTruncated: false,
        targetsTruncated: false,
      },
    });

    expect(inspection.text).toContain(
      "Visible fixture description",
    );

    expect(inspection.text).not.toContain(
      "Hidden fixture text",
    );

    expect(inspection.targets?.length).toBeGreaterThan(0);

    expect(inspection.targets?.[0]?.ref).toBe("t1");
  });

  it("applies maxTextChars after text normalization", async () => {
    const inspector = new PageInspector();

    const inspection = await inspector.inspect(
      page,
      await state(),
      {
        maxTextChars: 50,
      },
    );

    expect(inspection.text).toHaveLength(50);

    expect(inspection.metadata).toMatchObject({
      textTruncated: true,
    });
  });

  it("applies targetLimit after eligibility filtering", async () => {
    const inspector = new PageInspector();

    const inspection = await inspector.inspect(
      page,
      await state(),
      {
        targetLimit: 2,
      },
    );

    expect(inspection.targets).toHaveLength(2);

    expect(inspection.targets?.map((target) => target.ref)).toEqual([
      "t1",
      "t2",
    ]);

    expect(inspection.metadata).toMatchObject({
      targetsTruncated: true,
    });
  });

  it("filters targetKinds without affecting text extraction", async () => {
    const inspector = new PageInspector();

    const inspection = await inspector.inspect(
      page,
      await state(),
      {
        targetKinds: ["button", "link"],
      },
    );

    expect(inspection.text).toContain(
      "Visible fixture description",
    );

    expect(
      inspection.targets?.every(
        (target) =>
          target.kind === "button" ||
          target.kind === "link",
      ),
    ).toBe(true);

    expect(
      inspection.targets?.some(
        (target) => target.kind === "input",
      ),
    ).toBe(false);
  });

  it("omits disabled inspection sections when requested", async () => {
    const inspector = new PageInspector();

    await inspector.inspect(page, await state());

    expect(
      await page.locator("[data-rove-target]").count(),
    ).toBeGreaterThan(0);

    const inspection = await inspector.inspect(
      page,
      await state(),
      {
        includeText: false,
        includeTargets: false,
        includeViewport: false,
      },
    );

    expect(inspection).not.toHaveProperty("text");
    expect(inspection).not.toHaveProperty("targets");
    expect(inspection).not.toHaveProperty("viewport");
    expect(inspection).not.toHaveProperty("metadata");

    expect(
      await page.locator("[data-rove-target]").count(),
    ).toBe(0);
  });

  it("exposes sensitive password targets without values", async () => {
    const inspector = new PageInspector();

    const inspection = await inspector.inspect(
      page,
      await state(),
    );

    const password = inspection.targets?.find(
      (target) =>
        target.kind === "input" &&
        target.sensitive === true,
    );

    expect(password).toBeDefined();

    expect(JSON.stringify(inspection)).not.toContain(
      "secret-current-value",
    );
  });

  it("registers every exposed ref in the current page registry", async () => {
    const inspector = new PageInspector();

    const inspection = await inspector.inspect(
      page,
      await state(4),
    );

    const first = inspection.targets?.[0];

    expect(first).toBeDefined();

    const registry = inspector.registryForPage("page_01");

    expect(registry).toBeDefined();

    const resolved = registry!.resolve({
      pageId: inspection.pageId,
      revision: inspection.revision,
      ref: first!.ref,
    });

    expect(resolved.identity).toBeDefined();
    expect(resolved.handle.marker).toMatch(/^r\d+$/);
  });

  it("does not increment page revision during inspection", async () => {
    const inspector = new PageInspector();
    const pageState = await state(6);

    const first = await inspector.inspect(
      page,
      pageState,
    );

    const second = await inspector.inspect(
      page,
      pageState,
    );

    expect(first.revision).toBe(6);
    expect(second.revision).toBe(6);

    expect(first.targets?.[0]?.ref).toBe("t1");
    expect(second.targets?.[0]?.ref).toBe("t1");
  });
});
