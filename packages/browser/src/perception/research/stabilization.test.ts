import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

import {
  startFixtureServer,
  type FixtureServer,
} from "../../fixtures/fixture-server.js";
import {
  TEMPORAL_PERCEPTION_SCENARIOS,
  type TemporalPerceptionScenario,
} from "../corpus/local-corpus.js";
import {
  captureReferenceSignature,
  installResearchMutationObserver,
  observeWithPolicy,
  sameStructuralSignature,
  type StabilizationPolicy,
  type StructuralSignature,
} from "./stabilization.js";

let browser: Browser;
let context: BrowserContext;
let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 900,
    },
  });
});

afterAll(async () => {
  await context.close();
  await browser.close();
  await server.close();
});

async function freshPage(scenario: TemporalPerceptionScenario): Promise<Page> {
  const page = await context.newPage();
  await installResearchMutationObserver(page);
  await page.goto(new URL(scenario.route, server.url).toString(), {
    waitUntil: "domcontentloaded",
  });
  return page;
}

async function referenceFor(
  scenario: TemporalPerceptionScenario,
): Promise<StructuralSignature> {
  const page = await freshPage(scenario);

  try {
    const lastCheckpoint = Math.max(
      ...scenario.checkpoints.map((checkpoint) => checkpoint.afterMs),
    );

    return await captureReferenceSignature(page, lastCheckpoint + 50);
  } finally {
    await page.close();
  }
}

describe("F1 Gate 4 stabilization research", () => {
  const quietPolicy: StabilizationPolicy = {
    id: "floor-300-quiet-75",
    kind: "quiet-window",
    minimumObservationMs: 300,
    quietWindowMs: 75,
    maxObservationMs: 1000,
    pollMs: 10,
  };

  it("waits through every delayed Tier-A transition with the bounded quiet policy", async () => {
    for (const scenario of TEMPORAL_PERCEPTION_SCENARIOS) {
      const reference = await referenceFor(scenario);
      const page = await freshPage(scenario);

      try {
        const observation = await observeWithPolicy(page, quietPolicy);

        expect(observation.timedOut).toBe(false);
        expect(sameStructuralSignature(observation.signature, reference)).toBe(
          true,
        );
      } finally {
        await page.close();
      }
    }
  });

  it("demonstrates that a 100ms fixed snapshot is premature for the delayed fixtures", async () => {
    let mismatches = 0;

    for (const scenario of TEMPORAL_PERCEPTION_SCENARIOS) {
      const reference = await referenceFor(scenario);
      const page = await freshPage(scenario);

      try {
        const observation = await observeWithPolicy(page, {
          id: "fixed-100",
          kind: "fixed",
          afterMs: 100,
        });

        if (!sameStructuralSignature(observation.signature, reference)) {
          mismatches += 1;
        }
      } finally {
        await page.close();
      }
    }

    expect(mismatches).toBe(TEMPORAL_PERCEPTION_SCENARIOS.length);
  });
});
