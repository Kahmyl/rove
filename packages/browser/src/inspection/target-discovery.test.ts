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
import { discoverTargetCandidates } from "./target-discovery.js";

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

describe("discoverTargetCandidates", () => {
  it("discovers supported candidate selectors in DOM order", async () => {
    const candidates = await discoverTargetCandidates(page);

    expect(candidates.length).toBeGreaterThan(0);

    expect(candidates[0]).toMatchObject({
      marker: "r1",
      tag: "a",
      text: "View details",
    });

    expect(candidates.some((candidate) => candidate.tag === "button")).toBe(true);
    expect(candidates.some((candidate) => candidate.tag === "input")).toBe(true);
    expect(candidates.some((candidate) => candidate.tag === "select")).toBe(true);
  });

  it("discovers role candidates without prematurely classifying them", async () => {
    const candidates = await discoverTargetCandidates(page);

    const customButton = candidates.find(
      (candidate) =>
        candidate.role === "button" &&
        candidate.text === "Custom action",
    );

    const structuralRole = candidates.find(
      (candidate) => candidate.role === "heading",
    );

    expect(customButton).toBeDefined();
    expect(structuralRole).toBeDefined();
  });

  it("records visibility instead of prematurely dropping hidden candidates", async () => {
    const candidates = await discoverTargetCandidates(page);

    const hiddenButton = candidates.find(
      (candidate) =>
        candidate.tag === "button" &&
        candidate.text === "Hidden action",
    );

    const visibleButton = candidates.find(
      (candidate) =>
        candidate.tag === "button" &&
        candidate.text === "Submit",
    );

    expect(hiddenButton?.visible).toBe(false);
    expect(visibleButton?.visible).toBe(true);
  });

  it("records disabled state", async () => {
    const candidates = await discoverTargetCandidates(page);

    const disabledButton = candidates.find(
      (candidate) =>
        candidate.tag === "button" &&
        candidate.text === "Disabled action",
    );

    const submitButton = candidates.find(
      (candidate) =>
        candidate.tag === "button" &&
        candidate.text === "Submit",
    );

    expect(disabledButton?.disabled).toBe(true);
    expect(submitButton?.disabled).toBe(false);
  });

  it("assigns unique ephemeral DOM markers", async () => {
    const candidates = await discoverTargetCandidates(page);

    const markers = candidates.map((candidate) => candidate.marker);

    expect(new Set(markers).size).toBe(markers.length);

    const markedNodeCount = await page.locator("[data-rove-target]").count();

    expect(markedNodeCount).toBe(candidates.length);
  });

  it("replaces previous inspection markers", async () => {
    await discoverTargetCandidates(page);

    await page.evaluate(() => {
      const first = document.querySelector("[data-rove-target]");
      first?.setAttribute("data-rove-target", "stale-marker");
    });

    const candidates = await discoverTargetCandidates(page);

    const staleMarkerCount = await page
      .locator('[data-rove-target="stale-marker"]')
      .count();

    expect(staleMarkerCount).toBe(0);
    expect(candidates[0]?.marker).toBe("r1");
  });

  it("covers textarea, contenteditable, and tabindex candidates", async () => {
    await page.setContent(`
      <main>
        <textarea>Notes</textarea>
        <div contenteditable="true">Editable content</div>
        <div tabindex="0">Keyboard target</div>
        <input type="hidden" value="must-not-appear" />
      </main>
    `);

    const candidates = await discoverTargetCandidates(page);

    expect(candidates.some((candidate) => candidate.tag === "textarea")).toBe(true);

    expect(
      candidates.some((candidate) => candidate.contentEditable),
    ).toBe(true);

    expect(
      candidates.some(
        (candidate) =>
          candidate.tag === "div" &&
          candidate.text === "Keyboard target",
      ),
    ).toBe(true);

    expect(
      candidates.some(
        (candidate) =>
          candidate.tag === "input" &&
          candidate.type === "hidden",
      ),
    ).toBe(false);
  });
});
