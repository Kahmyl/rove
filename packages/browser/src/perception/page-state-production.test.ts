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
});
