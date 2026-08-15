import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { chromium, type Browser, type BrowserContext } from "playwright";

import {
  collectPageStateObservation,
  observeStablePageState,
} from "./page-state-observation.js";

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

function temporalDocument(
  delayMs: number,
  finalBody: string,
  continuousNoise = false,
): string {
  const noise = continuousNoise
    ? `
      const noise =
        document.querySelector("#noise");
      setInterval(() => {
        noise.textContent =
          String(performance.now());
      }, 20);
    `
    : "";

  return `<!doctype html>
    <html>
      <head>
        <title>Temporal</title>
      </head>
      <body>
        <main
          id="content"
          aria-busy="true"
        >
          <h1>Loading workspace</h1>
        </main>
        <span
          id="noise"
          aria-hidden="true"
        ></span>
        <script>
          ${noise}
          setTimeout(() => {
            const main =
              document.querySelector("#content");
            main.removeAttribute("aria-busy");
            main.innerHTML =
              ${JSON.stringify(finalBody)};
          }, ${delayMs});
        </script>
      </body>
    </html>`;
}

describe("production decision-relevant page-state stabilization", () => {
  it("waits through loading to authentication and ignores irrelevant churn", async () => {
    const page = await context.newPage();

    try {
      await page.setContent(
        temporalDocument(
          250,
          `
              <h1>Sign in to continue</h1>
              <label>
                Email
                <input type="email">
              </label>
              <label>
                Password
                <input type="password">
              </label>
              <button>Sign in</button>
            `,
          true,
        ),
        {
          waitUntil: "domcontentloaded",
        },
      );

      const observation = await observeStablePageState(page);

      expect(observation.assessment.kind).toBe("authentication_required");

      expect(observation.stabilization.timedOut).toBe(false);

      expect(observation.stabilization.elapsedMs).toBeGreaterThanOrEqual(240);
    } finally {
      await page.close();
    }
  }, 10_000);

  it("returns bounded loading when decision-relevant instability exceeds the observation budget", async () => {
    const page = await context.newPage();

    try {
      await page.setContent(
        temporalDocument(
          1_200,
          `
              <h1>Sign in to continue</h1>
              <input type="email">
            `,
        ),
        {
          waitUntil: "domcontentloaded",
        },
      );

      const observation = await observeStablePageState(page);

      expect(observation.assessment).toMatchObject({
        kind: "loading",
        confidence: "medium",
      });
      expect(observation.assessment).not.toHaveProperty("recommendedAction");

      expect(observation.assessment.signals).toContain(
        "stabilization:bounded_timeout",
      );

      expect(observation.stabilization.timedOut).toBe(true);
    } finally {
      await page.close();
    }
  }, 10_000);

  it("preserves observation-point ready semantics and changes the fingerprint when a blocker appears later", async () => {
    const page = await context.newPage();

    try {
      await page.setContent(
        `<!doctype html>
            <html>
              <head>
                <title>Workspace</title>
              </head>
              <body>
                <main>
                  <h1>Workspace</h1>
                  <button>Continue</button>
                </main>
                <script>
                  setTimeout(() => {
                    const frame =
                      document.createElement(
                        "iframe",
                      );
                    frame.title =
                      "Human verification";
                    frame.style.width =
                      "330px";
                    frame.style.height =
                      "150px";
                    frame.srcdoc =
                      "<button>Continue</button>";
                    document.body.append(
                      frame,
                    );
                  }, 450);
                </script>
              </body>
            </html>`,
        {
          waitUntil: "load",
        },
      );

      const initial = await observeStablePageState(page);

      expect(initial.assessment.kind).toBe("ready");

      expect(initial.stabilization.elapsedMs).toBeLessThan(300);

      await page.waitForTimeout(500);

      const later = await collectPageStateObservation(page);

      expect(later.assessment.kind).toBe("human_verification");

      expect(later.fingerprint).not.toBe(initial.fingerprint);
    } finally {
      await page.close();
    }
  }, 10_000);
});
