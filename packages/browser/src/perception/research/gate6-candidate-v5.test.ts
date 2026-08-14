import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";

import {
  collectResearchEvidence,
  PageObservationRecorder,
} from "./evidence.js";
import {
  gate6CandidateV5Strategy,
  type Gate6CandidateV5Input,
} from "./gate6-candidate-v5.js";
import { collectGate6SurfaceFactsV5 } from "./gate6-semantics-v5.js";
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

async function classify(body: string, title = "Test", httpStatus?: number) {
  const page = await context.newPage();
  const recorder = new PageObservationRecorder(page);

  try {
    await page.setContent(
      `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`,
      { waitUntil: "load" },
    );

    const evidence = await collectResearchEvidence(page, recorder);

    const input: Gate6CandidateV5Input = {
      signals: await pageSignals(page, httpStatus),
      evidence: evidence.evidence,
      surfaceFacts: await collectGate6SurfaceFactsV5(page),
    };

    return gate6CandidateV5Strategy().predict(input, {
      id: "s4r5-metamorphic",
      tier: "A",
      description: "S4R5 metamorphic",
      criticality: "critical",
      tags: [],
    });
  } finally {
    await page.close();
  }
}

describe("F1 Gate 6 S4R5 surface ownership", () => {
  it("does not promote footer verification copy over a usable primary workflow", async () => {
    const result = await classify(`
      <main>
        <h1>Workspace</h1>
        <button>Open workspace</button>
      </main>
      <footer>
        <p>Verify you are human to continue.</p>
      </footer>
    `);

    expect((await result).assessment.kind).toBe("ready");
  });

  it("does not promote an optional sign-in sidebar", async () => {
    const result = await classify(`
      <main>
        <h1>Analytics</h1>
        <button>Refresh report</button>
      </main>
      <aside>
        <h2>Sign in to continue</h2>
        <button>Connect later</button>
      </aside>
    `);

    expect((await result).assessment.kind).toBe("ready");
  });

  it("does not promote restriction or error cards inside a usable main workflow", async () => {
    const restriction = await classify(`
      <main>
        <h1>Workspace</h1>
        <button>Save</button>
        <section>
          <h2>Access is temporarily restricted</h2>
          <p>Exports only.</p>
        </section>
      </main>
    `);

    const error = await classify(`
      <main>
        <h1>Project</h1>
        <button>Create task</button>
        <section>
          <h2>Something went wrong</h2>
          <p>Recommendations could not load.</p>
        </section>
      </main>
    `);

    expect((await restriction).assessment.kind).toBe("ready");
    expect((await error).assessment.kind).toBe("ready");
  });

  it("evaluates a blocking auth dialog independently of settings or documentation beneath it", async () => {
    for (const body of [
      `
        <main><h1>Security settings</h1><button>Save</button></main>
        <div role="dialog" aria-modal="true">
          <h2>Session expired</h2>
          <label>Email <input type="email"></label>
          <label>Password <input type="password"></label>
          <button>Sign in</button>
        </div>
      `,
      `
        <main><h1>Integration guide</h1><p>Documentation.</p></main>
        <div role="dialog" aria-modal="true">
          <h2>Sign in to continue</h2>
          <label>Email <input type="email"></label>
          <label>Password <input type="password"></label>
          <button>Continue</button>
        </div>
      `,
    ]) {
      const result = await classify(body);

      expect((await result).assessment.kind).toBe("authentication_required");
    }
  });

  it("recognizes restriction and terminal error semantics inside blocking dialogs", async () => {
    const restriction = await classify(`
      <main><h1>Workspace</h1><button>Open</button></main>
      <div role="dialog" aria-modal="true">
        <h2>Workspace suspended</h2>
        <p>Your access to this workspace has been suspended.</p>
      </div>
    `);

    const error = await classify(`
      <main><h1>Editor</h1><button>Open</button></main>
      <div role="dialog" aria-modal="true">
        <h2>Cannot open workspace</h2>
        <p>The application cannot continue in this window.</p>
      </div>
    `);

    expect((await restriction).assessment.kind).toBe("access_restricted");
    expect((await error).assessment.kind).toBe("error");
  });

  it("uses the document root as the primary semantic surface when main is absent", async () => {
    const restriction = await classify(`
      <div>
        <h1>Workspace access suspended</h1>
        <p>Your access to this workspace has been suspended.</p>
      </div>
    `);

    const error = await classify(`
      <div>
        <h1>Application unavailable</h1>
        <p>The application cannot be displayed in this browser window.</p>
      </div>
    `);

    expect((await restriction).assessment.kind).toBe("access_restricted");
    expect((await error).assessment.kind).toBe("error");
  });

  it("does not treat Example or Demo product names as documentation context", async () => {
    const example = await classify(
      `
        <main>
          <h1>Welcome back</h1>
          <label>Email <input type="email"></label>
          <label>Password <input type="password"></label>
          <button>Continue</button>
        </main>
      `,
      "Example Security",
    );

    const demo = await classify(
      `
        <main>
          <h1>Unlock your account</h1>
          <label>Username <input autocomplete="username"></label>
          <label>Password <input type="password"></label>
          <button>Unlock</button>
        </main>
      `,
      "Demo Systems",
    );

    expect((await example).assessment.kind).toBe("authentication_required");
    expect((await demo).assessment.kind).toBe("authentication_required");
  });

  it("preserves auth and restriction overlap when a blocking auth dialog appears during HTTP 429", async () => {
    const result = await classify(
      `
        <main><h1>Security settings</h1></main>
        <div role="dialog" aria-modal="true">
          <h2>Session expired</h2>
          <label>Email <input type="email"></label>
          <label>Password <input type="password"></label>
          <button>Sign in</button>
        </div>
      `,
      "Security settings",
      429,
    );

    expect((await result).assessment.kind).toBe("authentication_required");
    expect((await result).propositions?.authenticationRequired).toBe(true);
    expect((await result).propositions?.accessRestricted).toBe(true);
  });
  it("uses page title as primary documentation context without poisoning product names", async () => {
    const docs = await classify(
      `
        <main>
          <h1>Understanding "Something went wrong" messages</h1>
          <p>This article explains how applications should report failures to operators.</p>
          <button>Open example</button>
        </main>
      `,
      "Troubleshooting guide",
    );

    const product = await classify(
      `
        <main>
          <h1>Welcome back</h1>
          <label>Email <input type="email"></label>
          <label>Password <input type="password"></label>
          <button>Continue</button>
        </main>
      `,
      "Example Security",
    );

    expect((await docs).assessment.kind).toBe("ready");
    expect((await product).assessment.kind).toBe("authentication_required");
  });

  it("does not infer restriction from generic workspace cannot-continue error wording", async () => {
    const error = await classify(`
      <main><h1>Editor</h1><button>Open document</button></main>
      <div role="dialog" aria-modal="true">
        <h2>Cannot open workspace</h2>
        <p>The application cannot continue in this window.</p>
        <button>Close</button>
      </div>
    `);

    const restriction = await classify(`
      <main><h1>Workspace</h1></main>
      <div role="dialog" aria-modal="true">
        <h2>Workspace suspended</h2>
        <p>Your access to this workspace has been suspended.</p>
      </div>
    `);

    expect((await error).assessment.kind).toBe("error");
    expect((await error).propositions?.accessRestricted).toBe(false);
    expect((await error).propositions?.errorPresented).toBe(true);

    expect((await restriction).assessment.kind).toBe("access_restricted");
  });
  it("distinguishes Guide product brands from guide document titles", async () => {
    const brand = await classify(
      `
        <main>
          <h1>Sign in to continue</h1>
          <label>Email <input type="email"></label>
          <label>Password <input type="password"></label>
          <button>Sign in</button>
        </main>
      `,
      "Guide Cloud",
    );

    const document = await classify(
      `
        <main>
          <h1>Troubleshooting Something went wrong</h1>
          <p>This reference explains expected failure handling.</p>
          <button>Continue reading</button>
        </main>
      `,
      "Security Guide",
    );

    const guideTo = await classify(
      `
        <main>
          <h1>Understanding Something went wrong</h1>
          <p>This reference explains expected failure handling.</p>
        </main>
      `,
      "Guide to incident response",
    );

    expect((await brand).assessment.kind).toBe("authentication_required");
    expect((await document).assessment.kind).toBe("ready");
    expect((await guideTo).assessment.kind).toBe("ready");
  });
});
