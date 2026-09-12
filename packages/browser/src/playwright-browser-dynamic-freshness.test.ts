import { afterEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";

import type {
  BrowserLaunchConfig,
  BrowserObservation,
  TargetReference,
} from "@rove/protocol";

import type { BrowserSession } from "./engine.js";
import {
  startFixtureServer,
  type FixtureServer,
} from "./fixtures/fixture-server.js";
import { PlaywrightBrowserEngine } from "./playwright-browser-engine.js";

const config: BrowserLaunchConfig = {
  headless: true,
  browser: "chromium",
  profile: { mode: "temporary" },
};
const sessions: BrowserSession[] = [];
const servers: FixtureServer[] = [];

async function setup() {
  const server = await startFixtureServer();
  const session = await new PlaywrightBrowserEngine().start(config);
  servers.push(server);
  sessions.push(session);
  await session.navigate(`${server.url}/dynamic-freshness`);
  return { server, session, page: testPage(session) };
}

function testPage(session: BrowserSession): Page {
  const internal = session as unknown as {
    pageRegistry: {
      activeId(): string | undefined;
      pageFor(pageId: string): Page;
    };
  };
  const pageId = internal.pageRegistry.activeId();
  if (pageId === undefined) throw new Error("Fixture session has no page.");
  return internal.pageRegistry.pageFor(pageId);
}

function target(
  observation: BrowserObservation,
  name: string,
): TargetReference {
  const found = observation.targets?.find((item) => item.name === name);
  if (found === undefined) throw new Error(`Missing target: ${name}`);
  return {
    pageId: observation.pageId,
    revision: observation.revision,
    ref: found.ref,
  };
}

async function dispatchCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number((window as unknown as { __dispatchCount?: number }).__dispatchCount),
  );
}

afterEach(async () => {
  while (sessions.length > 0) await sessions.pop()?.close();
  while (servers.length > 0) await servers.pop()?.close();
});

describe("target-scoped dynamic-page freshness", () => {
  it("permits one stable-target dispatch and a viewport capture during unrelated marked churn", async () => {
    const { session, page } = await setup();
    const observation = await session.inspect();
    const originalMutationVersion = observation.mutationVersion;

    await page.waitForTimeout(50);
    const resolution = await session.resolveTarget({
      observationId: observation.observationId,
      intent: { capability: "activate", text: "Stable target" },
    });
    expect(resolution).toMatchObject({ status: "selected" });

    await session.interact(
      { kind: "click", target: resolution.target! },
      { observationId: observation.observationId },
    );
    expect(await dispatchCount(page)).toBe(1);

    const screenshotObservation = await session.inspect();
    await page.waitForTimeout(50);
    const screenshot = await session.screenshot({
      mode: "viewport",
      observationId: screenshotObservation.observationId,
    });
    expect(screenshot.bytes.length).toBeGreaterThan(0);
    expect(screenshot.metadata).toMatchObject({
      observationId: screenshotObservation.observationId,
      observationMutationVersion: screenshotObservation.mutationVersion,
      mode: "viewport",
    });
    expect(Number(screenshot.metadata?.mutationVersion)).toBeGreaterThan(
      originalMutationVersion,
    );
  });

  it.each([
    "identity",
    "hidden",
    "disabled",
    "occluded",
    "moved",
    "target-replaced",
    "root-replaced",
    "frame-replaced",
    "navigation",
    "ambiguity",
  ] as const)("rejects %s before dispatch", async (scenario) => {
    const { server, session, page } = await setup();
    const observation = await session.inspect();
    const targetName =
      scenario === "root-replaced"
        ? "Shadow stable target"
        : scenario === "frame-replaced"
          ? "Frame stable target"
          : "Stable target";
    const reference = target(observation, targetName);

    if (scenario === "navigation") {
      await page.goto(`${server.url}/result`, {
        waitUntil: "domcontentloaded",
      });
    } else if (scenario === "frame-replaced") {
      await page.evaluate(() => {
        const frame =
          document.querySelector<HTMLIFrameElement>("#stable-frame")!;
        const replacement = frame.cloneNode() as HTMLIFrameElement;
        replacement.src = "/dynamic-freshness-frame";
        frame.replaceWith(replacement);
      });
      await page
        .locator("#stable-frame")
        .contentFrame()
        .getByRole("button", { name: "Frame stable target" })
        .waitFor();
    } else if (scenario === "root-replaced") {
      await page.evaluate(() => {
        const host = document.querySelector<HTMLElement>("#shadow-host")!;
        const marker = host
          .shadowRoot!.querySelector("button")!
          .getAttribute("data-rove-target");
        const replacement = document.createElement("div");
        replacement.id = "shadow-host";
        const root = replacement.attachShadow({ mode: "open" });
        root.innerHTML = `<button id="shadow-stable" data-rove-target="${marker}">Shadow stable target</button>`;
        root.querySelector("button")!.addEventListener("click", () => {
          (window as unknown as { __dispatchCount: number }).__dispatchCount +=
            1;
        });
        host.replaceWith(replacement);
      });
    } else {
      await page.evaluate((kind) => {
        const button =
          document.querySelector<HTMLButtonElement>("#stable-target")!;
        if (kind === "identity") button.setAttribute("aria-label", "Changed");
        if (kind === "hidden") button.style.display = "none";
        if (kind === "disabled") button.disabled = true;
        if (kind === "moved") button.style.transform = "translateX(40px)";
        if (kind === "target-replaced") {
          const replacement = button.cloneNode(true) as HTMLButtonElement;
          replacement.addEventListener("click", () => {
            (
              window as unknown as { __dispatchCount: number }
            ).__dispatchCount += 1;
          });
          button.replaceWith(replacement);
        }
        if (kind === "ambiguity") {
          const duplicate = button.cloneNode(true) as HTMLButtonElement;
          duplicate.id = "stable-target-duplicate";
          button.after(duplicate);
        }
        if (kind === "occluded") {
          const bounds = button.getBoundingClientRect();
          const overlay = document.createElement("div");
          Object.assign(overlay.style, {
            position: "fixed",
            left: `${bounds.left}px`,
            top: `${bounds.top}px`,
            width: `${bounds.width}px`,
            height: `${bounds.height}px`,
            zIndex: "9999",
          });
          document.body.append(overlay);
        }
      }, scenario);
    }

    await expect(
      session.interact(
        { kind: "click", target: reference },
        { observationId: observation.observationId },
      ),
    ).rejects.toMatchObject({
      code: expect.stringMatching(
        /OBSERVATION_STALE|TARGET_STALE|TARGET_NOT_VISIBLE|TARGET_DISABLED|TARGET_AMBIGUOUS/,
      ),
    });

    if (scenario !== "navigation") expect(await dispatchCount(page)).toBe(0);
  });

  it.each(["navigation", "viewport", "scroll", "page-closed"] as const)(
    "keeps %s as a hard delayed-screenshot boundary",
    async (scenario) => {
      const { server, session, page } = await setup();
      const observation = await session.inspect();
      if (scenario === "navigation") {
        await page.goto(`${server.url}/result`, {
          waitUntil: "domcontentloaded",
        });
      }
      if (scenario === "viewport") {
        await page.setViewportSize({ width: 1200, height: 800 });
      }
      if (scenario === "scroll") await page.evaluate(() => scrollTo(0, 300));
      if (scenario === "page-closed") await page.close();

      await expect(
        session.screenshot({
          mode: "viewport",
          observationId: observation.observationId,
        }),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/OBSERVATION_STALE|BROWSER_CLOSED/),
      });
    },
  );

  it("keeps coordinate actions on strict whole-observation freshness", async () => {
    const { session, page } = await setup();
    const observation = await session.inspect();
    await page.waitForTimeout(50);
    await expect(
      session.interact(
        {
          kind: "coordinate_click",
          target: target(observation, "Stable target"),
          observationId: observation.observationId,
          offsetX: 10,
          offsetY: 10,
        },
        { observationId: observation.observationId },
      ),
    ).rejects.toMatchObject({ code: "OBSERVATION_STALE" });
  });
});
