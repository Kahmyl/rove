import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";

import {
  startFixtureServer,
  type FixtureServer,
} from "../../fixtures/fixture-server.js";
import { PAGE_STATE_KINDS } from "../benchmark/types.js";
import {
  LOCAL_PERCEPTION_CASES,
  LOCAL_PERCEPTION_FIXTURES,
  TEMPORAL_PERCEPTION_SCENARIOS,
} from "./local-corpus.js";
import { PROVIDER_INTEGRATION_CASES } from "./provider-cases.js";

let server: FixtureServer;
let browser: Browser;

beforeAll(async () => {
  server = await startFixtureServer();
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
  await server.close();
});

describe("F1 local perception corpus", () => {
  it("has unique IDs and represents every current primary state", () => {
    const ids = LOCAL_PERCEPTION_CASES.map((benchmarkCase) => benchmarkCase.id);

    expect(new Set(ids).size).toBe(ids.length);

    const represented = new Set(
      LOCAL_PERCEPTION_CASES.map(
        (benchmarkCase) => benchmarkCase.expectedPrimaryState,
      ),
    );

    for (const state of PAGE_STATE_KINDS) {
      expect(represented.has(state)).toBe(true);
    }
  });

  it("keeps deterministic local cases in Tier A and distinguishes case criticality", () => {
    expect(
      LOCAL_PERCEPTION_CASES.every(
        (benchmarkCase) => benchmarkCase.tier === "A",
      ),
    ).toBe(true);

    expect(
      LOCAL_PERCEPTION_CASES.every(
        (benchmarkCase) =>
          benchmarkCase.tags.length > 0 && benchmarkCase.description.length > 0,
      ),
    ).toBe(true);

    expect(
      LOCAL_PERCEPTION_CASES.some(
        (benchmarkCase) => benchmarkCase.criticality === "critical",
      ),
    ).toBe(true);

    expect(
      LOCAL_PERCEPTION_CASES.some(
        (benchmarkCase) => benchmarkCase.criticality === "standard",
      ),
    ).toBe(true);
  });

  it("serves every pipeline-eligible case locally with the declared status", async () => {
    for (const benchmarkCase of LOCAL_PERCEPTION_CASES) {
      if (!benchmarkCase.pipelineEligible) continue;

      expect(benchmarkCase.route).toBeDefined();

      const fixture = LOCAL_PERCEPTION_FIXTURES[benchmarkCase.route!];

      expect(fixture).toBeDefined();

      const response = await fetch(new URL(benchmarkCase.route!, server.url));

      expect(response.status).toBe(fixture!.status);
      expect((await response.text()).length).toBeGreaterThan(0);
    }
  });

  it("renders the unknown canvas interstitial while keeping main-frame body text empty", async () => {
    const context = await browser.newContext();

    try {
      const page = await context.newPage();
      await page.goto(
        new URL(
          "/perception/unknown-canvas-interstitial",
          server.url,
        ).toString(),
        { waitUntil: "domcontentloaded" },
      );

      expect((await page.locator("body").innerText()).trim()).toBe("");

      const painted = await page.evaluate(() => {
        const canvas = document.querySelector("#unknown-visual-surface");

        if (!(canvas instanceof HTMLCanvasElement)) return false;

        const context = canvas.getContext("2d");
        if (context === null) return false;

        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;

        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] !== 0) return true;
        }

        return false;
      });

      expect(painted).toBe(true);
    } finally {
      await context.close();
    }
  });

  it("contains no third-party network URLs in Tier A fixture markup", () => {
    for (const fixture of Object.values(LOCAL_PERCEPTION_FIXTURES)) {
      expect(fixture.body).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\//i);
    }
  });

  it("keeps temporal scenarios separate from stable benchmark snapshots", () => {
    expect(TEMPORAL_PERCEPTION_SCENARIOS.length).toBeGreaterThanOrEqual(3);

    for (const scenario of TEMPORAL_PERCEPTION_SCENARIOS) {
      expect(scenario.tier).toBe("A");
      expect(scenario.checkpoints.length).toBeGreaterThanOrEqual(2);
      expect(
        LOCAL_PERCEPTION_CASES.some(
          (benchmarkCase) => benchmarkCase.id === scenario.id,
        ),
      ).toBe(false);
    }
  });

  it("keeps provider integrations Tier B and opt-in", () => {
    expect(PROVIDER_INTEGRATION_CASES.length).toBeGreaterThan(0);

    for (const providerCase of PROVIDER_INTEGRATION_CASES) {
      expect(providerCase.tier).toBe("B");
      expect(providerCase.enabledByDefault).toBe(false);
      expect(providerCase.requiredUrlEnvironmentVariable).toMatch(/^ROVE_F1_/);
    }
  });
});
