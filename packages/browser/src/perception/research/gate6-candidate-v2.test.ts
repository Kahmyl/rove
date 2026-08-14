import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";

import {
  collectResearchEvidence,
  PageObservationRecorder,
} from "./evidence.js";
import {
  gate6CandidateV2Strategy,
  type Gate6CandidateV2Input,
} from "./gate6-candidate-v2.js";
import {
  collectGate6AccessibilityFactsV2,
  collectGate6SurfaceFactsV2,
} from "./gate6-semantics-v2.js";
import { pageSignals } from "./gate6-validation.js";

let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  browser = await chromium.launch({
    headless: true,
  });
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

async function classify(body: string, httpStatus?: number) {
  const page = await context.newPage();
  const recorder = new PageObservationRecorder(page);

  try {
    await page.setContent(
      `<!doctype html><html><head><title>test</title></head><body>${body}</body></html>`,
      { waitUntil: "load" },
    );

    const evidence = await collectResearchEvidence(page, recorder);

    const input: Gate6CandidateV2Input = {
      signals: await pageSignals(page, httpStatus),
      evidence: evidence.evidence,
      surfaceFacts: await collectGate6SurfaceFactsV2(page),
      accessibilityFacts: await collectGate6AccessibilityFactsV2(page),
    };

    return gate6CandidateV2Strategy().predict(input, {
      id: "metamorphic",
      tier: "A",
      description: "metamorphic",
      criticality: "critical",
      tags: [],
    });
  } finally {
    await page.close();
  }
}

describe("F1 Gate 6 S4R2 surface-gated semantics", () => {
  it("does not turn blocker vocabulary in ordinary documentation into a blocker", async () => {
    const result = await classify(`
      <main>
        <h1>How to complete a security challenge integration</h1>
        <p>This article explains something went wrong messages.</p>
        <a href="#next">Next chapter</a>
      </main>
    `);

    expect((await result).assessment.kind).toBe("ready");
  });

  it("turns the same verification topic into a blocker only when interaction structure presents it", async () => {
    const result = await classify(`
      <div role="dialog" aria-modal="true" style="position:fixed;inset:0;background:white">
        <h1>Security check</h1>
        <label><input type="checkbox"> I am not a robot</label>
      </div>
    `);

    expect((await result).assessment.kind).toBe("human_verification");
  });

  it("uses credential structure for authentication instead of requiring one login phrase", async () => {
    const result = await classify(`
      <main>
        <h1>Unlock your session</h1>
        <label>User <input autocomplete="username"></label>
        <label>Secret <input type="password"></label>
      </main>
    `);

    expect((await result).assessment.kind).toBe("authentication_required");
  });

  it("uses direct HTTP semantic families", async () => {
    const restricted = await classify(`<main><h1>Unavailable</h1></main>`, 451);
    const missing = await classify(`<main><h1>Missing</h1></main>`, 404);

    expect((await restricted).assessment.kind).toBe("access_restricted");
    expect((await missing).assessment.kind).toBe("error");
  });
  it("accepts an imperative verification directive as the blocking surface without requiring an iframe", async () => {
    const result = await classify(`
      <main>
        <p>${"Account information and settings. ".repeat(20)}</p>
        <h2>Complete the CAPTCHA to continue.</h2>
      </main>
    `);

    expect((await result).assessment.kind).toBe("human_verification");
    expect((await result).propositions?.primaryContentAvailable).toBe(true);
  });

  it("correlates a nearby verification directive with a generic presented frame", async () => {
    const result = await classify(`
      <main>
        <h1>Sign in to continue</h1>
        <p>Verify you are human before submitting the login form.</p>
        <iframe
          title="Passive provider frame"
          style="width:300px;height:100px"
          srcdoc="<!doctype html><html><body></body></html>"
        ></iframe>
      </main>
    `);

    expect((await result).assessment.kind).toBe("human_verification");
    expect((await result).propositions?.authenticationRequired).toBe(true);
    expect((await result).propositions?.humanVerificationPresented).toBe(true);
  });

  it("keeps tutorial-style verification headings non-blocking", async () => {
    const result = await classify(`
      <main>
        <h1>How to complete a security challenge integration</h1>
        <p>This guide explains callbacks and retry behavior.</p>
      </main>
    `);

    expect((await result).assessment.kind).toBe("ready");
    expect((await result).propositions?.humanVerificationPresented).toBe(false);
  });
});
