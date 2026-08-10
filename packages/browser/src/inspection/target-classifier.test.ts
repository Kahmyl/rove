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
  resolveAccessibleName,
} from "./target-classifier.js";
import { discoverTargetCandidates } from "./target-discovery.js";
import type { DomCandidate } from "./dom-types.js";

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

async function semanticCandidates() {
  return classifyTargetCandidates(
    await discoverTargetCandidates(page),
  );
}

describe("target classification", () => {
  it("classifies native controls", async () => {
    const candidates = await semanticCandidates();

    expect(
      candidates.find((candidate) => candidate.name === "View details"),
    ).toMatchObject({
      kind: "link",
      enabled: true,
    });

    expect(
      candidates.find((candidate) => candidate.name === "Submit"),
    ).toMatchObject({
      kind: "button",
      enabled: true,
    });

    expect(
      candidates.find((candidate) => candidate.name === "Search jobs"),
    ).toMatchObject({
      kind: "input",
      enabled: true,
    });

    expect(
      candidates.find((candidate) => candidate.name === "Remote only"),
    ).toMatchObject({
      kind: "checkbox",
      enabled: true,
    });

    expect(
      candidates.find((candidate) => candidate.name === "Sort results"),
    ).toMatchObject({
      kind: "select",
      enabled: true,
    });
  });

  it("classifies interactive ARIA roles", async () => {
    const candidates = await semanticCandidates();

    expect(
      candidates.find((candidate) => candidate.name === "Custom action"),
    ).toMatchObject({
      kind: "button",
      role: "button",
    });
  });

  it("does not expose structural roles as targets", async () => {
    const candidates = await semanticCandidates();

    expect(
      candidates.some(
        (candidate) =>
          candidate.role === "heading" &&
          candidate.text === "Structural role",
      ),
    ).toBe(false);
  });

  it("drops hidden candidates but retains disabled visible controls", async () => {
    const candidates = await semanticCandidates();

    expect(
      candidates.some((candidate) => candidate.name === "Hidden action"),
    ).toBe(false);

    expect(
      candidates.find(
        (candidate) => candidate.name === "Disabled action",
      ),
    ).toMatchObject({
      kind: "button",
      enabled: false,
    });
  });

  it("classifies contenteditable and positive tabindex as controls", async () => {
    await page.setContent(`
      <main>
        <div contenteditable="true">Editable</div>
        <div tabindex="0">Keyboard target</div>
        <div tabindex="-1">Programmatic only</div>
      </main>
    `);

    const candidates = await semanticCandidates();

    expect(
      candidates.find((candidate) => candidate.name === "Editable"),
    ).toMatchObject({
      kind: "control",
    });

    expect(
      candidates.find(
        (candidate) => candidate.name === "Keyboard target",
      ),
    ).toMatchObject({
      kind: "control",
    });

    expect(
      candidates.some(
        (candidate) => candidate.name === "Programmatic only",
      ),
    ).toBe(false);
  });
});

describe("accessible name approximation", () => {
  const base: DomCandidate = {
    marker: "r1",
    tag: "button",
    text: "Visible text",
    visible: true,
    disabled: false,
    contentEditable: false,
    tabIndex: 0,
  };

  it("uses the fixed precedence order", () => {
    expect(
      resolveAccessibleName({
        ...base,
        ariaLabel: "ARIA label",
        ariaLabelledbyText: "ARIA labelledby",
        labelText: "Label",
        title: "Title",
        text: "Text",
      }),
    ).toBe("ARIA label");

    expect(
      resolveAccessibleName({
        ...base,
        text: "",
        ariaLabelledbyText: "ARIA labelledby",
        labelText: "Label",
      }),
    ).toBe("ARIA labelledby");

    expect(
      resolveAccessibleName({
        ...base,
        text: "",
        labelText: "Label",
        placeholder: "Placeholder",
      }),
    ).toBe("Label");

    expect(
      resolveAccessibleName({
        ...base,
        text: "",
        placeholder: "Placeholder",
        buttonValue: "Value",
      }),
    ).toBe("Placeholder");

    expect(
      resolveAccessibleName({
        ...base,
        text: "",
        buttonValue: "Value",
      }),
    ).toBe("Value");
  });

  it("normalizes whitespace and caps names at 500 characters", () => {
    expect(
      resolveAccessibleName({
        ...base,
        ariaLabel: "  Hello   world  ",
      }),
    ).toBe("Hello world");

    expect(
      resolveAccessibleName({
        ...base,
        ariaLabel: "x".repeat(600),
      }),
    ).toHaveLength(500);
  });

  it("never serializes current text/password input values", async () => {
    await page.setContent(`
      <main>
        <input type="text" value="private-current-value" />
        <input type="password" value="secret-current-value" />
        <input type="submit" value="Submit form" />
      </main>
    `);

    const discovered = await discoverTargetCandidates(page);

    const textInput = discovered.find(
      (candidate) =>
        candidate.tag === "input" &&
        candidate.type === "text",
    );

    const passwordInput = discovered.find(
      (candidate) => candidate.type === "password",
    );

    const submitInput = discovered.find(
      (candidate) => candidate.type === "submit",
    );

    expect(textInput?.buttonValue).toBeUndefined();
    expect(passwordInput?.buttonValue).toBeUndefined();
    expect(submitInput?.buttonValue).toBe("Submit form");

    expect(JSON.stringify(discovered)).not.toContain(
      "private-current-value",
    );

    expect(JSON.stringify(discovered)).not.toContain(
      "secret-current-value",
    );
  });
});
