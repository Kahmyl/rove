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

import {
  startFixtureServer,
  type FixtureServer,
} from "../fixtures/fixture-server.js";
import {
  extractVisibleText,
  normalizeVisibleText,
} from "./text-extractor.js";

let browser: Browser;
let context: BrowserContext;
let page: Page;
let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
  browser = await chromium.launch({ headless: true });
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

describe("normalizeVisibleText", () => {
  it("normalizes line endings, whitespace, and excessive blank lines", () => {
    expect(
      normalizeVisibleText(
        "  Alpha  \r\n\r\n\r\n\r\n   Beta   \r\n",
      ),
    ).toBe("Alpha\n\n\nBeta");
  });
});

describe("extractVisibleText", () => {
  it("returns visible body text", async () => {
    const result = await extractVisibleText(page, 20_000);

    expect(result.text).toContain("Rove Inspection Fixture");
    expect(result.text).toContain("Visible fixture description");
    expect(result.text).toContain("View details");
    expect(result.truncated).toBe(false);
  });

  it("does not return display:none text", async () => {
    const result = await extractVisibleText(page, 20_000);

    expect(result.text).not.toContain("Hidden fixture text");
    expect(result.text).not.toContain("Hidden action");
  });

  it("truncates after normalization", async () => {
    const result = await extractVisibleText(page, 50);

    expect(result.text.length).toBe(50);
    expect(result.truncated).toBe(true);
  });
});
