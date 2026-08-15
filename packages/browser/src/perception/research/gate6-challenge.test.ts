import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";

import { GATE6_HELDOUT_CASES } from "./gate6-heldout.js";
import {
  acquireHeldoutCase,
  runStableThenBlockerObservation,
  runTemporalChallenges,
} from "./gate6-validation.js";

let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
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
});

describe("F1 Gate 6 held-out challenge harness", () => {
  it("keeps held-out IDs unique and outside the frozen Gate-2 naming surface", () => {
    const ids = GATE6_HELDOUT_CASES.map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("heldout-"))).toBe(true);
  });

  it("exercises every stable compatibility state except loading", () => {
    const states = new Set(
      GATE6_HELDOUT_CASES.map((item) => item.expectedPrimaryState),
    );

    for (const state of [
      "ready",
      "authentication_required",
      "human_verification",
      "access_restricted",
      "unknown_interstitial",
      "error",
    ]) {
      expect(states.has(state as never)).toBe(true);
    }
  });

  it("observes actual browser accessibility semantics without persisting the raw snapshot", async () => {
    const dialogDefinition = GATE6_HELDOUT_CASES.find(
      (item) => item.id === "heldout-unknown-dialog-labelledby",
    )!;
    const hiddenDefinition = GATE6_HELDOUT_CASES.find(
      (item) => item.id === "heldout-ready-hidden-accessible-challenge",
    )!;
    const frameDefinition = GATE6_HELDOUT_CASES.find(
      (item) => item.id === "heldout-verification-frame-title-only",
    )!;

    const dialog = await acquireHeldoutCase(context, dialogDefinition);
    const hidden = await acquireHeldoutCase(context, hiddenDefinition);
    const frame = await acquireHeldoutCase(context, frameDefinition);

    expect(dialog.accessibilityAudit.available).toBe(true);
    expect(dialog.accessibilityAudit.dialogCount).toBeGreaterThan(0);
    expect(dialog.accessibilityAudit.interstitialCue).toBe(true);
    expect(dialog.accessibilityAudit.hash).toMatch(/^[a-f0-9]{64}$/);

    expect(hidden.accessibilityAudit.verificationCue).toBe(false);

    expect(frame.accessibilityAudit.available).toBe(true);
    expect(
      frame.accessibilityAudit.iframeCount > 0 ||
        frame.accessibilityAudit.verificationCue,
    ).toBe(true);

    expect(dialog.accessibilityAudit).not.toHaveProperty("snapshot");
    expect(dialog.accessibilityAudit).not.toHaveProperty("text");
  });

  it("demonstrates observation-point semantics for a stable page that blocks later", async () => {
    const result = await runStableThenBlockerObservation(context);

    expect(result.initial.kind).toBe("ready");
    expect(result.later.kind).toBe("human_verification");
  });

  it("compares whole-document quiet with decision-relevant stability under varied delays and noise", async () => {
    const results = await runTemporalChallenges(context);

    expect(results.length).toBeGreaterThanOrEqual(7);

    const long = results.find(
      (item) => item.id === "heldout-temporal-long-1200",
    )!;
    expect(long.relevantEvidence.observation.timedOut).toBe(true);
    expect(long.relevantEvidence.actualAtObservation.kind).toBe("loading");

    const noisy = results.find(
      (item) => item.id === "heldout-temporal-ready-noisy-200",
    )!;
    expect(noisy.wholeDocument.observation.timedOut).toBe(true);
    expect(noisy.relevantEvidence.observation.timedOut).toBe(false);
    expect(noisy.relevantEvidence.actualAtObservation.kind).toBe("ready");
  }, 20_000);
});
