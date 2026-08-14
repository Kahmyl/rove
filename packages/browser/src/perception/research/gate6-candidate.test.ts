import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";

import { GATE6_HELDOUT_CASES, gate6Document } from "./gate6-heldout.js";
import {
  collectAccessibleSemanticAudit,
  collectGate6DomSemantics,
} from "./gate6-validation.js";

let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
});

afterAll(async () => {
  await context.close();
  await browser.close();
});

async function semantics(id: string) {
  const definition = GATE6_HELDOUT_CASES.find((item) => item.id === id);
  if (definition === undefined) {
    throw new Error(`Unknown challenge definition ${id}.`);
  }

  const page = await context.newPage();
  try {
    await page.setContent(gate6Document(definition.title, definition.body), {
      waitUntil: "load",
    });
    return {
      dom: await collectGate6DomSemantics(page),
      accessibility: await collectAccessibleSemanticAudit(page),
    };
  } finally {
    await page.close();
  }
}

describe("F1 Gate 6 S4R bounded structural semantics", () => {
  it("separates quoted verification prose from a challenge heading", async () => {
    const quoted = await semantics("heldout-ready-quoted-verification-doc");
    const challenge = await semantics("heldout-verification-paraphrase-frame");

    expect(quoted.accessibility.verificationCue).toBe(true);
    expect(quoted.dom.verificationHeadingDirective).toBe(false);
    expect(challenge.dom.verificationHeadingDirective).toBe(true);
  });

  it("extracts authentication from structural surfaces rather than one frozen phrase", async () => {
    const form = await semantics("heldout-auth-form-title-variant");
    const chooser = await semantics("heldout-auth-account-chooser");

    expect(form.dom.authenticationHeadingCue).toBe(true);
    expect(form.dom.credentialInputCount).toBeGreaterThan(0);
    expect(chooser.dom.authenticationHeadingCue).toBe(true);
    expect(chooser.dom.accountChooserPresent).toBe(true);
  });

  it("keeps painted canvas occupancy semantically neutral without an interstitial label", async () => {
    const canvas = await semantics("heldout-ready-painted-canvas-app");

    expect(canvas.dom.visibleCanvasCount).toBeGreaterThan(0);
    expect(canvas.dom.interstitialCanvasPresented).toBe(false);
    expect(canvas.dom.nonInterstitialCanvasPresented).toBe(true);
  });

  it("recognizes a real aria-modal surface independent of aria-label regexes", async () => {
    const dialog = await semantics("heldout-unknown-dialog-labelledby");

    expect(dialog.dom.blockingDialogPresent).toBe(true);
    expect(dialog.accessibility.interstitialCue).toBe(true);
  });
});
