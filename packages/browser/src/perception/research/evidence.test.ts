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
  assertBoundedPersistedEvidence,
  collectResearchEvidence,
  firstChildFrame,
  PageObservationRecorder,
  type ResearchEvidence,
} from "./evidence.js";

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

async function evidenceFor(route: string): Promise<ResearchEvidence> {
  const page: Page = await context.newPage();
  const recorder = new PageObservationRecorder(page);

  try {
    await page.goto(new URL(route, server.url).toString(), {
      waitUntil: "load",
    });

    const acquired = await collectResearchEvidence(page, recorder);
    assertBoundedPersistedEvidence(acquired.evidence);
    return acquired.evidence;
  } finally {
    await page.close();
  }
}

describe("F1 Gate 4 bounded evidence collectors", () => {
  it("distinguishes the six presentation adversaries with bounded geometry facts", async () => {
    const hidden = firstChildFrame(
      await evidenceFor("/perception/ready-hidden-recaptcha-empty"),
    )?.element;
    const transparent = firstChildFrame(
      await evidenceFor("/perception/ready-opacity-zero-recaptcha-empty"),
    )?.element;
    const offscreen = firstChildFrame(
      await evidenceFor("/perception/ready-offscreen-recaptcha-empty"),
    )?.element;
    const tiny = firstChildFrame(
      await evidenceFor("/perception/ready-one-pixel-recaptcha-empty"),
    )?.element;
    const clipped = firstChildFrame(
      await evidenceFor("/perception/ready-clipped-recaptcha-empty"),
    )?.element;
    const occluded = firstChildFrame(
      await evidenceFor("/perception/ready-provider-behind-modal"),
    )?.element;
    const presented = firstChildFrame(
      await evidenceFor("/perception/human-verification-visible"),
    )?.element;

    expect(hidden?.cssVisible).toBe(false);
    expect(transparent?.cssVisible).toBe(false);
    expect(offscreen?.viewportIntersectionRatio).toBe(0);
    expect(tiny?.area).toBeLessThanOrEqual(4);
    expect(clipped?.ancestorClipRatio).toBe(0);
    expect(occluded?.topmostSampleRatio).not.toBeNull();
    expect(occluded!.topmostSampleRatio!).toBeLessThan(0.5);

    expect(presented).toMatchObject({
      cssVisible: true,
    });
    expect(presented!.area).toBeGreaterThan(4);
    expect(presented!.viewportIntersectionRatio).toBeGreaterThan(0);
    expect(presented!.ancestorClipRatio).toBeGreaterThan(0);
    expect(presented!.topmostSampleRatio).not.toBeNull();
    expect(presented!.topmostSampleRatio!).toBeGreaterThanOrEqual(0.5);
  });

  it("shows why frame and network presence are not presentation evidence", async () => {
    for (const route of [
      "/perception/ready-hidden-recaptcha-empty",
      "/perception/ready-opacity-zero-recaptcha-empty",
      "/perception/ready-offscreen-recaptcha-empty",
      "/perception/ready-one-pixel-recaptcha-empty",
      "/perception/ready-clipped-recaptcha-empty",
      "/perception/ready-provider-behind-modal",
      "/perception/human-verification-visible",
    ]) {
      const evidence = await evidenceFor(route);

      expect(evidence.frames.some((frame) => frame.depth > 0)).toBe(true);
      expect(evidence.observation.subframeDocumentRequestCount).toBeGreaterThan(
        0,
      );
    }
  });

  it("persists accessibility summaries rather than raw accessible text", async () => {
    const evidence = await evidenceFor(
      "/perception/human-verification-visible",
    );

    expect(evidence.accessibility.snapshotChars).toBeGreaterThan(0);
    expect(evidence.accessibility.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.accessibility).not.toHaveProperty("snapshot");
    expect(evidence.accessibility).not.toHaveProperty("text");
  });

  it("rejects raw or sensitive evidence-shaped fields", () => {
    expect(() =>
      assertBoundedPersistedEvidence({
        requestBody: "secret",
      }),
    ).toThrow(/Forbidden persisted evidence key/);

    expect(() =>
      assertBoundedPersistedEvidence({
        documentUrl: "https://example.test/private?token=secret",
      }),
    ).toThrow(/Unsanitized URL-shaped field/);
  });
});
