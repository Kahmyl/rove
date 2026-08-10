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
  classifyTargetCandidates,
} from "./target-classifier.js";
import {
  discoverTargetCandidates,
} from "./target-discovery.js";
import {
  buildTargetIdentity,
  identifyTargetCandidates,
} from "./target-identity-builder.js";

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

async function identifiedCandidates() {
  const discovered = await discoverTargetCandidates(page);
  const classified = classifyTargetCandidates(discovered);

  return identifyTargetCandidates(classified);
}

describe("TargetIdentity integration", () => {
  it("builds identity from semantic candidate data", async () => {
    const candidates = await identifiedCandidates();

    const search = candidates.find(
      (candidate) => candidate.name === "Search jobs",
    );

    expect(search).toBeDefined();

    expect(search?.identity).toMatchObject({
      name: "Search jobs",
      tag: "input",
      type: "text",
      id: "search",
    });

    expect(search?.identity.domPathHint).toContain(
      "html>body>main>input",
    );
  });

  it("reuses the existing sensitivity classifier for passwords", async () => {
    const candidates = await identifiedCandidates();

    const password = candidates.find(
      (candidate) => candidate.type === "password",
    );

    expect(password).toBeDefined();
    expect(password?.sensitive).toBe(true);

    expect(password?.identity).toMatchObject({
      tag: "input",
      type: "password",
      id: "password",
      attributes: {
        autocomplete: "current-password",
      },
    });
  });

  it("does not mark ordinary text inputs sensitive", async () => {
    const candidates = await identifiedCandidates();

    const search = candidates.find(
      (candidate) => candidate.name === "Search jobs",
    );

    expect(search?.sensitive).toBe(false);
  });

  it("stores data-testid separately and as an allowed attribute hint", async () => {
    await page.setContent(`
      <main>
        <button
          id="save"
          name="save-action"
          data-testid="save-button"
          data-private="must-not-be-retained"
        >
          Save
        </button>
      </main>
    `);

    const candidates = await identifiedCandidates();

    const save = candidates.find(
      (candidate) => candidate.name === "Save",
    );

    expect(save?.identity).toMatchObject({
      tag: "button",
      id: "save",
      testId: "save-button",
      attributes: {
        name: "save-action",
        "data-testid": "save-button",
      },
    });

    expect(save?.identity.attributes).not.toHaveProperty(
      "data-private",
    );
  });

  it("creates a deterministic structural DOM path hint", async () => {
    await page.setContent(`
      <main>
        <section>
          <button>First</button>
          <button>Second</button>
        </section>
      </main>
    `);

    const candidates = await identifiedCandidates();

    const first = candidates.find(
      (candidate) => candidate.name === "First",
    );

    const second = candidates.find(
      (candidate) => candidate.name === "Second",
    );

    expect(first?.identity.domPathHint).toBe(
      "html>body>main>section>button:nth-of-type(1)",
    );

    expect(second?.identity.domPathHint).toBe(
      "html>body>main>section>button:nth-of-type(2)",
    );
  });

  it("supports semantic-name sensitivity without another classifier", () => {
    const identity = buildTargetIdentity({
      marker: "r1",
      tag: "input",
      type: "text",
      text: "",
      visible: true,
      disabled: false,
      contentEditable: false,
      tabIndex: 0,
      kind: "input",
      name: "API token",
      enabled: true,
    });

    expect(identity.name).toBe("API token");
  });
});
