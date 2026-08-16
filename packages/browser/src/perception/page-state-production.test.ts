import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PageStatePropositions } from "@rove/protocol";
import { chromium, type Browser, type BrowserContext } from "playwright";

import {
  startFixtureServer,
  type FixtureServer,
} from "../fixtures/fixture-server.js";
import { LOCAL_PERCEPTION_CASES } from "./corpus/local-corpus.js";
import { classifyObservedPageState } from "./page-state-decision.js";
import { observeStablePageState } from "./page-state-observation.js";
import { GATE6_CHALLENGE_B_CASES } from "./research/gate6-challenge-b.js";
import { GATE6_CHALLENGE_C_CASES } from "./research/gate6-challenge-c.js";
import { GATE6_CHALLENGE_D_CASES } from "./research/gate6-challenge-d.js";
import { GATE6_CHALLENGE_E_CASES } from "./research/gate6-challenge-e.js";
import { GATE6_CHALLENGE_F_CASES } from "./research/gate6-challenge-f.js";
import { GATE6_CHALLENGE_G_CASES } from "./research/gate6-challenge-g.js";
import { GATE6_CHALLENGE_H_CASES } from "./research/gate6-challenge-h.js";
import {
  GATE6_HELDOUT_CASES,
  gate6Document,
} from "./research/gate6-heldout.js";

let browser: Browser;
let context: BrowserContext;
let server: FixtureServer;

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

  server = await startFixtureServer();
});

afterAll(async () => {
  await server.close();
  await context.close();
  await browser.close();
});

function expectExpectedPropositions(
  actual: PageStatePropositions,
  expected: Partial<PageStatePropositions> | undefined,
): void {
  for (const [name, value] of Object.entries(expected ?? {})) {
    if (value === "indeterminate") {
      continue;
    }

    expect(
      actual[name as keyof PageStatePropositions],
      `proposition ${name}`,
    ).toBe(value);
  }
}

async function checkDefinition(definition: {
  id: string;
  title: string;
  body: string;
  httpStatus?: number;
  expectedPrimaryState: string;
  expectedPropositions?: Partial<PageStatePropositions>;
}): Promise<void> {
  const page = await context.newPage();

  try {
    await page.setContent(
      [
        "<!doctype html><html><head><title>",
        definition.title,
        "</title></head><body>",
        definition.body,
        "</body></html>",
      ].join(""),
      {
        waitUntil: "load",
      },
    );

    const observation = await observeStablePageState(
      page,
      definition.httpStatus,
    );

    expect(observation.assessment.kind, definition.id).toBe(
      definition.expectedPrimaryState,
    );

    expectExpectedPropositions(
      observation.propositions,
      definition.expectedPropositions,
    );
  } finally {
    await page.close();
  }
}

async function checkRoutedDefinition(definition: {
  id: string;
  path: string;
  title: string;
  body: string;
  httpStatus?: number;
  expectedPrimaryState: string;
  expectedPropositions?: Partial<PageStatePropositions>;
}): Promise<void> {
  const page = await context.newPage();

  try {
    await page.route("**/*", async (route) => {
      await route.fulfill({
        status: definition.httpStatus ?? 200,
        contentType: "text/html",
        body: [
          "<!doctype html><html><head><title>",
          definition.title,
          "</title></head><body>",
          definition.body,
          "</body></html>",
        ].join(""),
      });
    });

    const response = await page.goto(
      new URL(definition.path, server.url).toString(),
      {
        waitUntil: "load",
      },
    );

    const observation = await observeStablePageState(page, response?.status());

    expect(observation.assessment.kind, definition.id).toBe(
      definition.expectedPrimaryState,
    );

    expectExpectedPropositions(
      observation.propositions,
      definition.expectedPropositions,
    );
  } finally {
    await page.close();
  }
}

describe("production page-state semantic conformance", () => {
  it("classifies the production query-invisible verification frame failure mode", async () => {
    const page = await context.newPage();

    try {
      await page.setContent(`
        <main>
          <h1>Performing security verification</h1>
          <p>This website is verifying you are not a bot.</p>
          <div id="challenge-host"></div>
        </main>
      `);
      await page.locator("#challenge-host").evaluate((host) => {
        const root = host.attachShadow({ mode: "closed" });
        const frame = document.createElement("iframe");
        frame.title = "Security verification challenge";
        frame.srcdoc = "<!doctype html><p>Verification control</p>";
        frame.style.width = "300px";
        frame.style.height = "65px";
        root.append(frame);
      });
      expect(await page.locator("iframe").count()).toBe(0);
      await expect.poll(() => page.frames().length).toBe(2);

      const observation = await observeStablePageState(page, 403);
      const frame = observation.diagnostics?.frames[0];
      const primary = observation.diagnostics?.surfaces.find(
        (surface) => surface.kind === "primary",
      );

      expect(frame).toMatchObject({
        domOrdinal: null,
        verificationIdentity: true,
        elementAcquisition: "available",
        presentation: true,
      });
      expect(primary).toMatchObject({
        verificationCue: true,
        verificationDirective: false,
        verificationControl: false,
        frameOrdinals: [],
        identifiedVerificationFrame: false,
      });
      expect(observation.assessment.kind).toBe("human_verification");
      expect(observation.propositions).toMatchObject({
        humanVerificationPresented: true,
        accessRestricted: true,
      });
      expect(observation.assessment.signals).toContain(
        "verification:primary_cue_presented_frame_restrictive_status",
      );
    } finally {
      await page.close();
    }
  });

  it("covers the F1 challenge, restriction, terminal-failure, and negative-control corpus", async () => {
    const cases = [
      {
        id: "f1-himalayas-visible-cloudflare-challenge",
        title: "Just a moment...",
        httpStatus: 403,
        body: `<main><h1>Performing security verification</h1>
          <iframe title="Security challenge" src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/" srcdoc="Challenge"></iframe>
        </main>`,
        expectedPrimaryState: "human_verification",
        expectedPropositions: {
          humanVerificationPresented: true,
          accessRestricted: true,
        },
      },
      {
        id: "f1-interactive-verification",
        title: "Verify",
        body: `<main><h1>Verify that you are human</h1><label><input type="checkbox"> I am human</label></main>`,
        expectedPrimaryState: "human_verification",
      },
      {
        id: "f1-completed-challenge",
        title: "Jobs",
        body: `<main><h1>Open roles</h1><button>Apply</button></main>`,
        expectedPrimaryState: "ready",
      },
      {
        id: "f1-hard-access-denied",
        title: "Access denied",
        httpStatus: 403,
        body: `<main><h1>Access denied</h1><p>Your network is blocked from this resource.</p></main>`,
        expectedPrimaryState: "access_restricted",
      },
      {
        id: "f1-ordinary-403",
        title: "Forbidden",
        httpStatus: 403,
        body: `<main><h1>Forbidden</h1></main>`,
        expectedPrimaryState: "access_restricted",
      },
      {
        id: "f1-rate-limit",
        title: "Slow down",
        httpStatus: 429,
        body: `<main><h1>Too many requests</h1></main>`,
        expectedPrimaryState: "access_restricted",
      },
      {
        id: "f1-remotive-captcha-text-negative",
        title: "Automation engineer",
        body: `<main><h1>Automation engineer</h1><p>${"Role responsibilities and qualifications. ".repeat(20)} Familiarity with proxy management, CAPTCHA handling, and IP rotation strategies.</p><button>Apply</button></main>`,
        expectedPrimaryState: "ready",
      },
      {
        id: "f1-passive-provider-negative",
        title: "Dashboard",
        body: `<main><h1>Dashboard</h1><p>${"Ordinary account content. ".repeat(30)}</p><button>Continue</button>
          <iframe title="Provider integration" src="https://captcha.example.test/widget" srcdoc="passive"></iframe>
        </main>`,
        expectedPrimaryState: "ready",
      },
      {
        id: "f1-google-terminal-signin-rejection",
        title: "Couldn't sign you in",
        body: `<main><h1>Couldn't sign you in</h1><p>This browser or app may not be secure.</p><a href="/help">Learn more</a></main>`,
        expectedPrimaryState: "error",
        expectedPropositions: { errorPresented: true },
      },
      {
        id: "f1-invalid-password-remains-operable-auth",
        title: "Sign in",
        body: `<main><h1>Invalid password</h1><p>Try again.</p><label>Password <input type="password"></label><button>Sign in</button></main>`,
        expectedPrimaryState: "authentication_required",
      },
      {
        id: "f1-account-locked-terminal",
        title: "Account locked",
        body: `<main><h1>Account locked</h1><p>Contact your administrator.</p></main>`,
        expectedPrimaryState: "error",
      },
      {
        id: "f1-unsupported-browser-terminal",
        title: "Unsupported browser",
        body: `<main><h1>This browser is not supported</h1><p>Use a compatible client.</p></main>`,
        expectedPrimaryState: "error",
      },
      {
        id: "f1-expired-session-auth",
        title: "Session expired",
        body: `<main><h1>Session expired</h1><p>Sign in to continue.</p><button>Sign in</button></main>`,
        expectedPrimaryState: "authentication_required",
      },
      {
        id: "f1-authorization-denied-terminal",
        title: "Authorization denied",
        body: `<main><h1>Authorization denied</h1><p>Consent was not granted.</p></main>`,
        expectedPrimaryState: "error",
      },
      {
        id: "f1-generic-application-error",
        title: "Application error",
        body: `<main><h1>Something went wrong</h1><p>The application could not load.</p></main>`,
        expectedPrimaryState: "error",
      },
      {
        id: "f1-not-found-terminal",
        title: "Not found",
        httpStatus: 404,
        body: `<main><h1>Page not found</h1></main>`,
        expectedPrimaryState: "error",
      },
      {
        id: "f1-gone-terminal",
        title: "Gone",
        httpStatus: 410,
        body: `<main><h1>Resource removed</h1></main>`,
        expectedPrimaryState: "error",
      },
      {
        id: "f1-server-error-terminal",
        title: "Unavailable",
        httpStatus: 503,
        body: `<main><h1>Service unavailable</h1></main>`,
        expectedPrimaryState: "error",
      },
      {
        id: "f1-terminal-keyword-negative",
        title: "Security incident guide",
        body: `<main><h1>Security incident guide</h1><p>${"Learn how secure systems report an error or denied request. ".repeat(12)}</p><button>Continue reading</button></main>`,
        expectedPrimaryState: "ready",
      },
      {
        id: "f1-unknown-abnormal-interstitial",
        title: "Attention required",
        body: `<main><h1>Attention required</h1><p>Review the current state before proceeding.</p></main>`,
        expectedPrimaryState: "unknown_interstitial",
      },
    ];

    for (const definition of cases) await checkDefinition(definition);
  }, 30_000);

  it("attaches exact status and positive ready provenance to decisions", async () => {
    const restricted = classifyObservedPageState({
      signals: { readyState: "complete", httpStatus: 451 },
    });
    expect(restricted.assessment.signals).toContain(
      "restriction:http_status:451",
    );

    const unsupportedReady = classifyObservedPageState({
      signals: { readyState: "complete" },
    });
    expect(unsupportedReady.assessment.kind).toBe("unknown_interstitial");
    expect(unsupportedReady.assessment.signals).toContain(
      "evidence:surface_unavailable",
    );

    const page = await context.newPage();
    try {
      await page.setContent(
        "<main><h1>Workspace</h1><button>Continue</button></main>",
      );
      const ready = await observeStablePageState(page, 200);
      expect(ready.assessment.kind).toBe("ready");
      expect(ready.assessment.signals).toEqual(
        expect.arrayContaining([
          "ready:primary_content",
          "ready:http_status:200",
        ]),
      );
    } finally {
      await page.close();
    }
  });

  it("matches all 166 frozen, remedial, and independent deterministic cases", async () => {
    let count = 0;

    for (const item of LOCAL_PERCEPTION_CASES) {
      if (item.pipelineEligible && item.route !== undefined) {
        const page = await context.newPage();

        try {
          const response = await page.goto(
            new URL(item.route, server.url).toString(),
            {
              waitUntil: "load",
            },
          );

          const observation = await observeStablePageState(
            page,
            response?.status(),
          );

          expect(observation.assessment.kind, item.id).toBe(
            item.expectedPrimaryState,
          );

          expectExpectedPropositions(
            observation.propositions,
            item.expectedPropositions,
          );
        } finally {
          await page.close();
        }
      } else {
        const result = classifyObservedPageState({
          signals: {
            ...(item.input.readyState === undefined
              ? {}
              : {
                  readyState: item.input.readyState,
                }),
            ...(item.input.httpStatus === undefined
              ? {}
              : {
                  httpStatus: item.input.httpStatus,
                }),
          },
        });

        expect(result.assessment.kind, item.id).toBe(item.expectedPrimaryState);

        expectExpectedPropositions(
          result.propositions,
          item.expectedPropositions,
        );
      }

      count += 1;
    }

    for (const definition of GATE6_HELDOUT_CASES) {
      const page = await context.newPage();

      try {
        await page.setContent(
          gate6Document(definition.title, definition.body),
          {
            waitUntil: "load",
          },
        );

        const observation = await observeStablePageState(
          page,
          definition.httpStatus,
        );

        expect(observation.assessment.kind, definition.id).toBe(
          definition.expectedPrimaryState,
        );

        expectExpectedPropositions(
          observation.propositions,
          definition.expectedPropositions,
        );
      } finally {
        await page.close();
      }

      count += 1;
    }

    for (const definitions of [
      GATE6_CHALLENGE_B_CASES,
      GATE6_CHALLENGE_C_CASES,
      GATE6_CHALLENGE_D_CASES,
      GATE6_CHALLENGE_E_CASES,
      GATE6_CHALLENGE_F_CASES,
      GATE6_CHALLENGE_G_CASES,
      GATE6_CHALLENGE_H_CASES,
    ]) {
      for (const definition of definitions) {
        await checkDefinition(definition);
        count += 1;
      }
    }

    expect(count).toBe(166);
  }, 180_000);

  it("generalizes document-role suppression without masking stronger blockers", async () => {
    const definitions = [
      {
        id: "production-doc-role-429-reference-copy",
        path: "/docs/Web/HTTP/Reference/Status/429",
        title: "429 Too Many Requests - HTTP | Product",
        body: `
          <main>
            <h1>429 Too Many Requests</h1>
            <section>
              <p>
                Requests may be limited when too many requests are sent
                in a given amount of time.
              </p>
              <h2>Syntax</h2>
              <pre><code>429 Too Many Requests</code></pre>
            </section>
            <section>
              <h2>Examples</h2>
              <p>A client can retry after an appropriate delay.</p>
            </section>
            <section>
              <h2>See also</h2>
              <p>Related HTTP response status documentation.</p>
            </section>
          </main>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          primaryContentAvailable: true,
          authenticationRequired: false,
          humanVerificationPresented: false,
          accessRestricted: false,
          errorPresented: false,
          interstitialPresented: false,
        },
      },
      {
        id: "production-doc-path-alone-does-not-suppress-restriction",
        path: "/docs/workspace/access",
        title: "Workspace",
        body: `
          <main>
            <h1>Access restricted</h1>
            <p>Workspace access has been restricted.</p>
          </main>
        `,
        expectedPrimaryState: "access_restricted",
        expectedPropositions: {
          accessRestricted: true,
        },
      },
      {
        id: "production-doc-role-does-not-suppress-blocking-dialog",
        path: "/docs/platform/reference",
        title: "Platform HTTP | Product",
        body: `
          <main>
            <h1>Platform HTTP</h1>
            <h2>Requests</h2>
            <pre><code>GET /resource</code></pre>
            <h2>Responses</h2>
            <h2>Examples</h2>
          </main>
          <div role="dialog" aria-modal="true">
            <h2>Access restricted</h2>
            <p>Workspace access has been restricted.</p>
          </div>
        `,
        expectedPrimaryState: "access_restricted",
        expectedPropositions: {
          accessRestricted: true,
        },
      },
      {
        id: "production-doc-role-does-not-suppress-structural-auth",
        path: "/docs/api/client",
        title: "API Client | Product",
        body: `
          <main>
            <h1>API Client</h1>
            <h2>Authentication example</h2>
            <pre><code>client.connect()</code></pre>
            <h2>Sign in to continue</h2>
            <label>
              Email
              <input type="email" autocomplete="username">
            </label>
            <label>
              Password
              <input type="password" autocomplete="current-password">
            </label>
            <button>Sign in</button>
            <h2>Reference</h2>
          </main>
        `,
        expectedPrimaryState: "authentication_required",
        expectedPropositions: {
          authenticationRequired: true,
        },
      },
      {
        id: "production-doc-role-does-not-suppress-http-restriction",
        path: "/docs/Web/HTTP/Reference/Status/429",
        title: "429 Too Many Requests - HTTP | Product",
        body: `
          <main>
            <h1>429 Too Many Requests</h1>
            <p>
              Requests may be limited when too many requests are sent.
            </p>
            <h2>Syntax</h2>
            <pre><code>429 Too Many Requests</code></pre>
            <h2>Examples</h2>
            <h2>See also</h2>
          </main>
        `,
        httpStatus: 429,
        expectedPrimaryState: "access_restricted",
        expectedPropositions: {
          accessRestricted: true,
        },
      },
    ];

    for (const definition of definitions) {
      await checkRoutedDefinition(definition);
    }

    expect(definitions).toHaveLength(5);
  }, 30_000);
  it("recognizes ordinary labeled username/password credential gates without autocomplete hints", async () => {
    const definitions = [
      {
        id: "production-labeled-username-password-auth",
        title: "The Internet",
        body: `
            <main>
              <h2>Login Page</h2>
              <p>
                This is where you can log into the secure area.
              </p>
              <form>
                <label for="username">Username</label>
                <input id="username" type="text">

                <label for="password">Password</label>
                <input id="password" type="password">

                <button type="submit">Login</button>
              </form>
            </main>
          `,
        expectedPrimaryState: "authentication_required",
        expectedPropositions: {
          authenticationRequired: true,
          humanVerificationPresented: false,
          accessRestricted: false,
          errorPresented: false,
        },
      },
      {
        id: "production-profile-settings-labeled-credentials-not-auth",
        title: "Profile settings",
        body: `
            <main>
              <h1>Profile settings</h1>

              <label for="profile-username">Username</label>
              <input id="profile-username" type="text">

              <label for="profile-password">Password</label>
              <input id="profile-password" type="password">

              <button>Save profile</button>
            </main>
          `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          authenticationRequired: false,
          humanVerificationPresented: false,
          accessRestricted: false,
          errorPresented: false,
        },
      },
    ];

    for (const definition of definitions) {
      await checkDefinition(definition);
    }

    expect(definitions).toHaveLength(2);
  }, 30_000);
  it("keeps generic workflow sections eligible for blockers and requires explicit settings workflow evidence", async () => {
    const definitions = [
      {
        id: "production-section-wrapped-structural-auth",
        title: "Sign in",
        body: `
          <main>
            <section>
              <h1>Sign in to continue</h1>

              <label for="email">Email</label>
              <input
                id="email"
                type="email"
                autocomplete="username"
              >

              <label for="password">Password</label>
              <input
                id="password"
                type="password"
                autocomplete="current-password"
              >

              <button type="submit">Sign in</button>
            </section>
          </main>
        `,
        expectedPrimaryState: "authentication_required",
        expectedPropositions: {
          authenticationRequired: true,
        },
      },
      {
        id: "production-section-wrapped-restriction",
        title: "Workspace",
        body: `
          <main>
            <section>
              <h1>Access restricted</h1>
              <p>
                Workspace access has been restricted.
              </p>
            </section>
          </main>
        `,
        expectedPrimaryState: "access_restricted",
        expectedPropositions: {
          accessRestricted: true,
        },
      },
      {
        id: "production-billing-purpose-login-is-auth",
        title: "Billing",
        body: `
          <main>
            <h1>Sign in to manage billing</h1>

            <label for="billing-email">
              Email
            </label>
            <input
              id="billing-email"
              type="email"
              autocomplete="username"
            >

            <label for="billing-password">
              Password
            </label>
            <input
              id="billing-password"
              type="password"
              autocomplete="current-password"
            >

            <button type="submit">Sign in</button>
          </main>
        `,
        expectedPrimaryState: "authentication_required",
        expectedPropositions: {
          authenticationRequired: true,
        },
      },
      {
        id: "production-profile-purpose-login-is-auth",
        title: "Profile",
        body: `
          <main>
            <h1>Log in to view your profile</h1>

            <label for="profile-login-username">
              Username
            </label>
            <input
              id="profile-login-username"
              type="text"
            >

            <label for="profile-login-password">
              Password
            </label>
            <input
              id="profile-login-password"
              type="password"
            >

            <button type="submit">Log in</button>
          </main>
        `,
        expectedPrimaryState: "authentication_required",
        expectedPropositions: {
          authenticationRequired: true,
        },
      },
      {
        id: "production-preferences-purpose-login-is-auth",
        title: "Preferences",
        body: `
          <main>
            <h1>Sign in to manage preferences</h1>

            <label for="preferences-email">
              Email
            </label>
            <input
              id="preferences-email"
              type="email"
              autocomplete="username"
            >

            <label for="preferences-password">
              Password
            </label>
            <input
              id="preferences-password"
              type="password"
              autocomplete="current-password"
            >

            <button type="submit">Sign in</button>
          </main>
        `,
        expectedPrimaryState: "authentication_required",
        expectedPropositions: {
          authenticationRequired: true,
        },
      },
      {
        id: "production-profile-settings-remains-ready",
        title: "Profile settings",
        body: `
          <main>
            <h1>Profile settings</h1>

            <label for="profile-settings-username">
              Username
            </label>
            <input
              id="profile-settings-username"
              type="text"
            >

            <label for="profile-settings-password">
              Password
            </label>
            <input
              id="profile-settings-password"
              type="password"
            >

            <button type="submit">
              Save profile
            </button>
          </main>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          authenticationRequired: false,
        },
      },
    ];

    for (const definition of definitions) {
      await checkDefinition(definition);
    }

    expect(definitions).toHaveLength(6);
  }, 30_000);
  it("scopes busy instability to the active workflow and distinguishes native modal dialogs", async () => {
    const definitions = [
      {
        id: "production-hidden-supplementary-busy-remains-ready",
        title: "Workspace",
        body: `
          <main>
            <h1>Workspace</h1>
            <p>The active workflow is available.</p>
            <button>Save document</button>
          </main>

          <aside
            aria-busy="true"
            style="display: none"
          >
            Background recommendations are refreshing.
          </aside>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          documentUnstable: false,
          primaryContentAvailable: true,
        },
      },
      {
        id: "production-offscreen-busy-remains-ready",
        title: "Workspace",
        body: `
          <main>
            <h1>Workspace</h1>
            <button>Save document</button>
          </main>

          <div
            aria-busy="true"
            style="
              position: absolute;
              left: -10000px;
              top: 0;
              width: 100px;
              height: 100px;
            "
          >
            Background refresh.
          </div>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          documentUnstable: false,
          primaryContentAvailable: true,
        },
      },
      {
        id: "production-visible-supplementary-busy-remains-ready",
        title: "Workspace",
        body: `
          <main>
            <h1>Workspace</h1>
            <button>Save document</button>
          </main>

          <aside aria-busy="true">
            <h2>Recommendations</h2>
            <p>Refreshing suggestions.</p>
          </aside>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          documentUnstable: false,
          primaryContentAvailable: true,
        },
      },
      {
        id: "production-primary-wrapper-busy-remains-loading",
        title: "Workspace",
        body: `
          <div aria-busy="true">
            <main>
              <h1>Loading workspace</h1>
              <p>Please wait while the workspace refreshes.</p>
            </main>
          </div>
        `,
        expectedPrimaryState: "loading",
        expectedPropositions: {
          documentUnstable: true,
        },
      },
      {
        id: "production-visible-primary-busy-remains-loading",
        title: "Workspace",
        body: `
          <main aria-busy="true">
            <h1>Loading workspace</h1>
            <p>Please wait while the workspace refreshes.</p>
          </main>
        `,
        expectedPrimaryState: "loading",
        expectedPropositions: {
          documentUnstable: true,
        },
      },
      {
        id: "production-small-nonmodal-dialog-remains-ready",
        title: "Editor",
        body: `
          <main>
            <h1>Editor</h1>
            <p>The document remains editable.</p>
            <button>Save document</button>
          </main>

          <dialog
            open
            style="
              width: 240px;
              height: 120px;
              padding: 12px;
            "
          >
            <p>Formatting help</p>
            <button>Got it</button>
          </dialog>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          interstitialPresented: false,
          primaryContentAvailable: true,
        },
      },
      {
        id: "production-large-nonmodal-dialog-remains-blocking",
        title: "Editor",
        body: `
          <main>
            <h1>Editor</h1>
            <button>Save document</button>
          </main>

          <dialog
            open
            style="
              width: 900px;
              height: 500px;
              padding: 12px;
            "
          >
            <p>Review this large intervening surface.</p>
            <button>Continue</button>
          </dialog>
        `,
        expectedPrimaryState: "unknown_interstitial",
        expectedPropositions: {
          interstitialPresented: true,
        },
      },
    ];

    for (const definition of definitions) {
      await checkDefinition(definition);
    }

    const page = await context.newPage();

    try {
      await page.setContent(
        `
          <!doctype html>
          <html>
            <head>
              <title>Native modal dialog</title>
            </head>
            <body>
              <main>
                <h1>Editor</h1>
                <button>Save document</button>
              </main>

              <dialog
                id="production-native-modal"
                style="
                  width: 240px;
                  height: 120px;
                  padding: 12px;
                "
              >
                <p>
                  Review this dialog before continuing.
                </p>
                <button>Continue</button>
              </dialog>
            </body>
          </html>
        `,
        {
          waitUntil: "load",
        },
      );

      await page.evaluate(() => {
        const dialog = document.getElementById(
          "production-native-modal",
        ) as HTMLDialogElement | null;

        if (dialog === null) {
          throw new Error("production native modal dialog missing");
        }

        dialog.showModal();
      });

      const observation = await observeStablePageState(page, 200);

      expect(observation.assessment.kind).toBe("unknown_interstitial");

      expect(observation.propositions.interstitialPresented).toBe(true);
    } finally {
      await page.close();
    }

    expect(definitions).toHaveLength(7);
  }, 30_000);
  it("keeps lexical blockers message-local and recognizes multi-step authentication", async () => {
    const definitions = [
      {
        id: "production-inline-user-not-found-remains-ready",
        title: "User management",
        body: `
          <main>
            <h1>User management</h1>
            <p>
              Search for a user and update their
              workspace membership.
            </p>

            <label for="user-search">
              User email
            </label>
            <input
              id="user-search"
              type="email"
            >

            <button>Search users</button>

            <p>User not found</p>

            <button>Edit search</button>
          </main>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          errorPresented: false,
          accessRestricted: false,
          authenticationRequired: false,
          primaryContentAvailable: true,
        },
      },
      {
        id: "production-unrelated-restriction-labels-remain-ready",
        title: "Admin dashboard",
        body: `
          <main>
            <h1>Admin dashboard</h1>

            <h2>Blocked users</h2>
            <p>
              Review accounts blocked by administrators.
            </p>
            <button>Review blocked users</button>

            <h2>Workspace access</h2>
            <p>
              Manage workspace roles and permissions.
            </p>
            <button>Manage workspace access</button>
          </main>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          accessRestricted: false,
          errorPresented: false,
          primaryContentAvailable: true,
        },
      },
      {
        id: "production-identifier-only-auth-step",
        title: "Authentication",
        body: `
          <main>
            <form>
              <h1>Welcome back</h1>
              <p>Enter your email to continue.</p>

              <label for="step-email">
                Email
              </label>
              <input
                id="step-email"
                type="email"
                autocomplete="username"
              >

              <button type="submit">
                Continue
              </button>
            </form>
          </main>
        `,
        expectedPrimaryState: "authentication_required",
        expectedPropositions: {
          authenticationRequired: true,
          humanVerificationPresented: false,
        },
      },
      {
        id: "production-password-only-auth-step",
        title: "Authentication",
        body: `
          <main>
            <form>
              <h1>Enter your password</h1>
              <p>
                Use the password for your account
                to continue.
              </p>

              <label for="step-password">
                Password
              </label>
              <input
                id="step-password"
                type="password"
                autocomplete="current-password"
              >

              <button type="submit">
                Continue
              </button>
            </form>
          </main>
        `,
        expectedPrimaryState: "authentication_required",
        expectedPropositions: {
          authenticationRequired: true,
          humanVerificationPresented: false,
        },
      },
      {
        id: "production-newsletter-email-remains-ready",
        title: "Product updates",
        body: `
          <main>
            <h1>Product updates</h1>
            <p>
              Subscribe to our newsletter.
            </p>

            <label for="newsletter-email">
              Email
            </label>
            <input
              id="newsletter-email"
              type="email"
            >

            <button type="submit">
              Subscribe
            </button>
          </main>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          authenticationRequired: false,
          errorPresented: false,
          accessRestricted: false,
        },
      },
      {
        id: "production-same-message-dashboard-copy-not-restriction",
        title: "Admin dashboard",
        body: `
          <main>
            <h1>Admin dashboard</h1>
            <p>
              Blocked users can be reviewed from
              Workspace access settings.
            </p>
            <button>
              Manage workspace
            </button>
          </main>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          accessRestricted: false,
          primaryContentAvailable: true,
        },
      },
      {
        id: "production-split-explicit-restriction-remains-blocking",
        title: "Workspace",
        body: `
          <main>
            <h1>Workspace access</h1>
            <p>
              Restricted by administrator policy.
            </p>
          </main>
        `,
        expectedPrimaryState: "access_restricted",
        expectedPropositions: {
          accessRestricted: true,
        },
      },
      {
        id: "production-welcome-back-email-flow-not-auth-without-corroboration",
        title: "Welcome",
        body: `
          <main>
            <form>
              <h1>Welcome back</h1>
              <p>
                Subscribe for product updates.
              </p>

              <label for="returning-email">
                Email
              </label>
              <input
                id="returning-email"
                type="email"
              >

              <button type="submit">
                Continue
              </button>
            </form>
          </main>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          authenticationRequired: false,
          primaryContentAvailable: true,
        },
      },
      {
        id: "production-provider-google-auth-control",
        title: "Welcome",
        body: `
          <main>
            <h1>Welcome</h1>
            <p>
              Choose how you would like to continue.
            </p>

            <button type="button">
              Continue with Google
            </button>
          </main>
        `,
        expectedPrimaryState: "authentication_required",
        expectedPropositions: {
          authenticationRequired: true,
          humanVerificationPresented: false,
        },
      },
      {
        id: "production-provider-apple-auth-control",
        title: "Welcome",
        body: `
          <main>
            <h1>Welcome</h1>

            <button type="button">
              Sign in with Apple
            </button>
          </main>
        `,
        expectedPrimaryState: "authentication_required",
        expectedPropositions: {
          authenticationRequired: true,
          humanVerificationPresented: false,
        },
      },
      {
        id: "production-integration-connect-controls-remain-ready",
        title: "Integrations",
        body: `
          <main>
            <h1>Integrations</h1>
            <p>
              Connect services to your workspace.
            </p>

            <button type="button">
              Connect Google
            </button>

            <button type="button">
              Connect Slack
            </button>
          </main>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          authenticationRequired: false,
          primaryContentAvailable: true,
        },
      },
      {
        id: "production-explicit-page-not-found-remains-error",
        title: "Page not found",
        body: `
          <main>
            <h1>Page not found</h1>
            <p>
              The page you requested does not exist.
            </p>
          </main>
        `,
        expectedPrimaryState: "error",
        expectedPropositions: {
          errorPresented: true,
        },
      },
      {
        id: "production-explicit-access-restriction-remains-blocking",
        title: "Workspace",
        body: `
          <main>
            <h1>Access restricted</h1>
            <p>
              Workspace access has been restricted.
            </p>
          </main>
        `,
        expectedPrimaryState: "access_restricted",
        expectedPropositions: {
          accessRestricted: true,
        },
      },
    ];

    for (const definition of definitions) {
      await checkDefinition(definition);
    }

    expect(definitions).toHaveLength(13);
  }, 30_000);

  it("closes final-review semantic regressions without broadening frozen semantics", async () => {
    const definitions = [
      {
        id: "production-verify-email-control-remains-ready",
        title: "Profile",
        body: `
          <main>
            <h1>Profile</h1>
            <p>Your account is active.</p>
            <button>Verify email</button>
            <button>Save profile</button>
          </main>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          humanVerificationPresented: false,
          authenticationRequired: false,
          primaryContentAvailable: true,
        },
      },
      {
        id: "production-real-human-check-remains-blocking",
        title: "Security check",
        body: `
          <main>
            <h1>Verify you are human</h1>
            <p>Complete the human check to continue.</p>
            <button>Verify</button>
          </main>
        `,
        expectedPrimaryState: "human_verification",
        expectedPropositions: {
          humanVerificationPresented: true,
        },
      },
      {
        id: "production-recipient-email-buttons-remain-ready",
        title: "Recipients",
        body: `
          <main>
            <h1>Choose recipients</h1>
            <p>Select team members for this message.</p>
            <button>Ada — ada@example.test</button>
            <button>Lin — lin@example.test</button>
            <button>Continue</button>
          </main>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          authenticationRequired: false,
          humanVerificationPresented: false,
          primaryContentAvailable: true,
        },
      },
      {
        id: "production-account-chooser-remains-auth",
        title: "Choose an account",
        body: `
          <main>
            <h1>Choose an account</h1>
            <p>Select an account to continue.</p>
            <button>Ada — ada@example.test</button>
            <button>Lin — lin@example.test</button>
          </main>
        `,
        expectedPrimaryState: "authentication_required",
        expectedPropositions: {
          authenticationRequired: true,
        },
      },
      {
        id: "production-fullscreen-auth-sibling-is-page-owning",
        title: "Workspace",
        body: `
          <main>
            <h1>Workspace</h1>
            <p>Your dashboard remains mounted.</p>
            <button>Save</button>
          </main>

          <div
            style="
              position: fixed;
              inset: 0;
              z-index: 9999;
              background: white;
            "
          >
            <h1>Sign in to continue</h1>

            <label>
              Email
              <input
                type="email"
                autocomplete="username"
              >
            </label>

            <label>
              Password
              <input
                type="password"
                autocomplete="current-password"
              >
            </label>

            <button type="submit">Sign in</button>
          </div>
        `,
        expectedPrimaryState: "authentication_required",
        expectedPropositions: {
          authenticationRequired: true,
        },
      },
      {
        id: "production-nested-fullscreen-auth-sibling-is-page-owning",
        title: "Workspace",
        body: `
          <div id="app-shell">
            <main>
              <h1>Workspace</h1>
              <p>Your dashboard remains mounted.</p>
              <button>Save</button>
            </main>

            <div
              style="
                position: fixed;
                inset: 0;
                z-index: 9999;
                background: white;
              "
            >
              <h1>Sign in to continue</h1>

              <label>
                Email
                <input
                  type="email"
                  autocomplete="username"
                >
              </label>

              <label>
                Password
                <input
                  type="password"
                  autocomplete="current-password"
                >
              </label>

              <button type="submit">Sign in</button>
            </div>
          </div>
        `,
        expectedPrimaryState: "authentication_required",
        expectedPropositions: {
          authenticationRequired: true,
        },
      },
      {
        id: "production-large-fixed-background-behind-main-remains-ready",
        title: "Workspace",
        body: `
          <div
            aria-hidden="true"
            style="
              position: fixed;
              inset: 0;
              z-index: 0;
              background: #eee;
            "
          ></div>

          <main
            style="
              position: relative;
              z-index: 1;
            "
          >
            <h1>Workspace</h1>
            <p>The active workflow is available.</p>
            <button>Save</button>
          </main>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          authenticationRequired: false,
          interstitialPresented: false,
          primaryContentAvailable: true,
        },
      },
      {
        id: "production-small-fixed-sibling-remains-ready",
        title: "Workspace",
        body: `
          <main>
            <h1>Workspace</h1>
            <p>The active workflow is available.</p>
            <button>Save</button>
          </main>

          <div
            style="
              position: fixed;
              left: 0;
              right: 0;
              bottom: 0;
              height: 100px;
              background: white;
            "
          >
            <p>Need help?</p>
            <button>Open help</button>
          </div>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          authenticationRequired: false,
          interstitialPresented: false,
          primaryContentAvailable: true,
        },
      },
      {
        id: "production-documentation-blocker-is-not-meta",
        title: "Documentation",
        body: `
          <main>
            <h1>Documentation access denied</h1>
            <p>
              Your access to this resource
              has been denied.
            </p>
          </main>
        `,
        expectedPrimaryState: "access_restricted",
        expectedPropositions: {
          accessRestricted: true,
        },
      },
      {
        id: "production-blocker-title-ending-in-reference-is-not-meta",
        title: "Access Denied Reference",
        body: `
          <main>
            <h1>Access denied</h1>
            <p>
              Your access to this resource
              has been denied.
            </p>
          </main>
        `,
        expectedPrimaryState: "access_restricted",
        expectedPropositions: {
          accessRestricted: true,
        },
      },
      {
        id: "production-error-title-ending-in-tutorial-is-not-meta",
        title: "Something Went Wrong Tutorial",
        body: `
          <main>
            <h1>Something went wrong</h1>
            <p>
              The application could not load.
              Reload this page to continue.
            </p>
          </main>
        `,
        expectedPrimaryState: "error",
        expectedPropositions: {
          errorPresented: true,
        },
      },
      {
        id: "production-structured-documentation-remains-ready",
        title: "HTTP 429 Documentation",
        body: `
          <main>
            <h1>HTTP 429 Documentation</h1>
            <h2>Overview</h2>
            <p>
              This guide explains access
              restriction responses.
            </p>
            <h2>Examples</h2>
            <p>
              An application may display
              "Access restricted" after
              excessive requests.
            </p>
            <pre><code>429 Too Many Requests</code></pre>
          </main>
        `,
        expectedPrimaryState: "ready",
        expectedPropositions: {
          accessRestricted: false,
          errorPresented: false,
          primaryContentAvailable: true,
        },
      },
    ];

    for (const definition of definitions) {
      await checkDefinition(definition);
    }

    expect(definitions).toHaveLength(12);
  }, 30_000);
});
