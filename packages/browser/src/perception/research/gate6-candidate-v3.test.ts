import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";

import {
  collectResearchEvidence,
  PageObservationRecorder,
} from "./evidence.js";
import {
  gate6CandidateV3Strategy,
  type Gate6CandidateV3Input,
} from "./gate6-candidate-v3.js";
import { collectGate6SurfaceFactsV3 } from "./gate6-semantics-v3.js";
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

    const input: Gate6CandidateV3Input = {
      signals: await pageSignals(page, httpStatus),
      evidence: evidence.evidence,
      surfaceFacts: await collectGate6SurfaceFactsV3(page),
    };

    return gate6CandidateV3Strategy().predict(input, {
      id: "s4r3-metamorphic",
      tier: "A",
      description: "S4R3 metamorphic",
      criticality: "critical",
      tags: [],
    });
  } finally {
    await page.close();
  }
}

describe("F1 Gate 6 S4R3 workflow-scope semantics", () => {
  it("keeps documentation directives beside a demo iframe non-blocking", async () => {
    const result = await classify(`
      <article>
        <h1>Embedded widget example</h1>
        <p>Verify you are human to continue.</p>
        <iframe
          title="Demo widget"
          style="width:360px;height:160px"
          srcdoc="<!doctype html><html><body><p>Example</p></body></html>"
        ></iframe>
      </article>
    `);

    expect((await result).assessment.kind).toBe("ready");
  });

  it("distinguishes a non-blocking error toast from a workflow error surface", async () => {
    const ready = await classify(`
      <main>
        <h1>Editor</h1>
        <textarea>Draft</textarea>
        <button>Save again</button>
      </main>
      <div role="alert">Something went wrong saving the draft.</div>
    `);

    const error = await classify(`
      <main role="alert">
        <h1>Dashboard unavailable</h1>
        <p>The dashboard cannot be displayed right now.</p>
      </main>
    `);

    expect((await ready).assessment.kind).toBe("ready");
    expect((await error).assessment.kind).toBe("error");
  });

  it("distinguishes account settings credentials from an authentication gate", async () => {
    const settings = await classify(`
      <main>
        <h1>Security settings</h1>
        <nav><a href="#profile">Profile</a></nav>
        <label>Email <input type="email"></label>
        <label>Current password <input type="password"></label>
        <button>Save settings</button>
      </main>
    `);

    const auth = await classify(`
      <main>
        <h1>Welcome back</h1>
        <label>Email <input type="email"></label>
        <label>Password <input type="password"></label>
        <button>Continue</button>
      </main>
    `);

    expect((await settings).assessment.kind).toBe("ready");
    expect((await auth).assessment.kind).toBe("authentication_required");
  });

  it("recognizes paragraph-level verification as an active workflow directive", async () => {
    const result = await classify(`
      <main>
        <p>Verify you are human to continue.</p>
        <button>Continue</button>
      </main>
    `);

    expect((await result).assessment.kind).toBe("human_verification");
  });

  it("recognizes passkey-only authentication", async () => {
    const result = await classify(`
      <main>
        <h1>Continue with your passkey</h1>
        <p>Use the passkey registered to this account.</p>
        <button>Use passkey</button>
      </main>
    `);

    expect((await result).assessment.kind).toBe("authentication_required");
  });

  it("preserves independent restriction and error propositions", async () => {
    const result = await classify(
      `
        <main role="alert">
          <h1>Unable to display the requested view</h1>
          <p>Requests are temporarily limited.</p>
        </main>
      `,
      429,
    );

    expect((await result).assessment.kind).toBe("access_restricted");
    expect((await result).propositions?.accessRestricted).toBe(true);
    expect((await result).propositions?.errorPresented).toBe(true);
  });
  it("does not mistake example.test identity choices for documentation", async () => {
    const result = await classify(`
      <main>
        <h1>Select an identity to continue</h1>
        <button>alice@example.test</button>
        <button>work@example.test</button>
      </main>
    `);

    expect((await result).assessment.kind).toBe("authentication_required");
    expect((await result).propositions?.authenticationRequired).toBe(true);
  });

  it("recognizes a human-readable account chooser without email-like button text", async () => {
    const result = await classify(`
      <main>
        <h1>Continue with an account</h1>
        <button>Personal account</button>
        <button>Work account</button>
      </main>
    `);

    expect((await result).assessment.kind).toBe("authentication_required");
  });

  it("does not turn restriction wording with cannot-continue into an error", async () => {
    const result = await classify(`
      <main role="alert">
        <h1>We've temporarily limited your access</h1>
        <p>Requests from this connection cannot continue right now. Try again later.</p>
      </main>
    `);

    expect((await result).assessment.kind).toBe("access_restricted");
    expect((await result).propositions?.errorPresented).toBe(false);
  });
  it("preserves restriction semantics across compact adjacent block tags", async () => {
    const verificationOverlap = await classify(
      `<main><h1>Access is temporarily restricted</h1><p>Verify you are human to continue.</p><iframe title="Passive provider frame" style="width:300px;height:100px" srcdoc="<!doctype html><html><body></body></html>"></iframe></main>`,
    );

    expect((await verificationOverlap).assessment.kind).toBe(
      "human_verification",
    );
    expect((await verificationOverlap).propositions?.accessRestricted).toBe(
      true,
    );

    const errorOverlap = await classify(
      `<main><h1>Access is temporarily restricted</h1><p>Service unavailable.</p></main>`,
      503,
    );

    expect((await errorOverlap).assessment.kind).toBe("access_restricted");
    expect((await errorOverlap).propositions?.accessRestricted).toBe(true);
    expect((await errorOverlap).propositions?.errorPresented).toBe(true);
  });

  it("does not make semantic classification depend on whitespace between block elements", async () => {
    const compact = await classify(
      `<main role="alert"><h1>We&apos;ve temporarily limited your access</h1><p>Requests from this connection cannot continue right now. Try again later.</p></main>`,
    );

    const spaced = await classify(`
      <main role="alert">
        <h1>We&apos;ve temporarily limited your access</h1>
        <p>Requests from this connection cannot continue right now. Try again later.</p>
      </main>
    `);

    expect((await compact).assessment.kind).toBe("access_restricted");
    expect((await compact).propositions).toEqual((await spaced).propositions);
  });
});
