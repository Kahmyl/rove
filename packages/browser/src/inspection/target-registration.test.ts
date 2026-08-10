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
import { classifyTargetCandidates } from "./target-classifier.js";
import { discoverTargetCandidates } from "./target-discovery.js";
import { identifyTargetCandidates } from "./target-identity-builder.js";
import {
  PageTargetRegistryStore,
  registerIdentifiedTargets,
} from "./target-registration.js";

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

async function identifiedTargets() {
  const discovered = await discoverTargetCandidates(page);
  const classified = classifyTargetCandidates(discovered);

  return identifyTargetCandidates(classified);
}

describe("PageTargetRegistryStore", () => {
  it("creates one current registry per page", () => {
    const store = new PageTargetRegistryStore();

    const first = store.beginInspection("page_01", 1);

    expect(store.get("page_01")).toBe(first);

    const second = store.beginInspection("page_02", 3);

    expect(store.get("page_01")).toBe(first);
    expect(store.get("page_02")).toBe(second);
  });

  it("replaces the page registry for a fresh inspection", () => {
    const store = new PageTargetRegistryStore();

    const first = store.beginInspection("page_01", 1);
    const second = store.beginInspection("page_01", 1);

    expect(second).not.toBe(first);
    expect(store.get("page_01")).toBe(second);
  });

  it("can remove page registries", () => {
    const store = new PageTargetRegistryStore();

    store.beginInspection("page_01", 1);

    store.delete("page_01");

    expect(store.get("page_01")).toBeUndefined();
  });
});

describe("target registration", () => {
  it("generates sequential short tN references", async () => {
    const targets = await identifiedTargets();
    const store = new PageTargetRegistryStore();

    const registry = store.beginInspection("page_01", 1);

    const registered = registerIdentifiedTargets(
      page,
      registry,
      targets,
    );

    expect(registered.length).toBeGreaterThan(0);

    expect(
      registered.slice(0, 3).map(
        (item) => item.registered.reference.ref,
      ),
    ).toEqual(["t1", "t2", "t3"]);
  });

  it("binds every ref to the page and current revision", async () => {
    const targets = await identifiedTargets();
    const store = new PageTargetRegistryStore();

    const registry = store.beginInspection("page_01", 7);

    const registered = registerIdentifiedTargets(
      page,
      registry,
      targets,
    );

    for (const item of registered) {
      expect(item.registered.reference).toMatchObject({
        pageId: "page_01",
        revision: 7,
      });
    }
  });

  it("resolves exposed refs back to identity and DOM marker", async () => {
    const targets = await identifiedTargets();
    const store = new PageTargetRegistryStore();

    const registry = store.beginInspection("page_01", 1);

    const registered = registerIdentifiedTargets(
      page,
      registry,
      targets,
    );

    const submit = registered.find(
      (item) => item.candidate.name === "Submit",
    );

    expect(submit).toBeDefined();

    const resolved = registry.resolve(
      submit!.registered.reference,
    );

    expect(resolved.identity).toMatchObject({
      tag: "button",
      name: "Submit",
    });

    expect(resolved.handle.marker).toMatch(/^r\d+$/);

    const matchingNodeCount = await page
      .locator(
        `[data-rove-target="${resolved.handle.marker}"]`,
      )
      .count();

    expect(matchingNodeCount).toBe(1);
  });

  it("keeps registries isolated between pages", async () => {
    const targets = await identifiedTargets();
    const store = new PageTargetRegistryStore();

    const page1Registry = store.beginInspection("page_01", 1);
    const page2Registry = store.beginInspection("page_02", 1);

    const [page1Target] = registerIdentifiedTargets(
      page,
      page1Registry,
      targets.slice(0, 1),
    );

    const [page2Target] = registerIdentifiedTargets(
      page,
      page2Registry,
      targets.slice(0, 1),
    );

    expect(page1Target?.registered.reference.ref).toBe("t1");
    expect(page2Target?.registered.reference.ref).toBe("t1");

    expect(page1Target?.registered.reference.pageId).toBe(
      "page_01",
    );

    expect(page2Target?.registered.reference.pageId).toBe(
      "page_02",
    );
  });

  it("preserves TargetRegistry stale-revision protection", async () => {
    const targets = await identifiedTargets();
    const store = new PageTargetRegistryStore();

    const registry = store.beginInspection("page_01", 5);

    const [target] = registerIdentifiedTargets(
      page,
      registry,
      targets.slice(0, 1),
    );

    expect(target).toBeDefined();

    expect(() =>
      registry.resolve({
        ...target!.registered.reference,
        revision: 4,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "TARGET_STALE",
      }),
    );
  });
});
