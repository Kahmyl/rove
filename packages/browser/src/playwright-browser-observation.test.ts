import { afterEach, describe, expect, it } from "vitest";

import type {
  BrowserEvidenceSnapshot,
  PageInspection,
  TargetKind,
  TargetReference,
} from "@rove/protocol";

import type { BrowserActivity } from "./observation/browser-activity.js";
import {
  startFixtureServer,
  type FixtureServer,
} from "./fixtures/fixture-server.js";
import { PlaywrightBrowserEngine } from "./playwright-browser-engine.js";
import type { BrowserSession } from "./engine.js";

const browsers: BrowserSession[] = [];
const servers: FixtureServer[] = [];

afterEach(async () => {
  while (browsers.length > 0) {
    await browsers.pop()?.close();
  }

  while (servers.length > 0) {
    await servers.pop()?.close();
  }
});

function target(inspection: PageInspection, name: string): TargetReference {
  const item = inspection.targets?.find((candidate) => candidate.name === name);

  if (item === undefined) {
    throw new Error(`Missing target ${name}.`);
  }

  return {
    pageId: inspection.pageId,
    revision: inspection.revision,
    ref: item.ref,
  };
}

function targetKind(
  inspection: PageInspection,
  kind: TargetKind,
): TargetReference {
  const item = inspection.targets?.find((candidate) => candidate.kind === kind);

  if (item === undefined) {
    throw new Error(`Missing target kind ${kind}.`);
  }

  return {
    pageId: inspection.pageId,
    revision: inspection.revision,
    ref: item.ref,
  };
}

async function waitForActivity(
  activities: BrowserActivity[],
  type: BrowserActivity["type"],
  predicate: (activity: BrowserActivity) => boolean = () => true,
): Promise<BrowserActivity> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const activity = activities.find(
      (item) => item.type === type && predicate(item),
    );

    if (activity !== undefined) {
      return activity;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for ${type}.`);
}

async function createBrowser() {
  const browser = await new PlaywrightBrowserEngine().start({
    headless: true,
    browser: "chromium",
    profile: {
      mode: "temporary",
    },
  });

  browsers.push(browser);

  return browser;
}

describe("Milestone 9 browser activity foundation", () => {
  it("records bounded, sanitized navigation, failure, and browser-error evidence", async () => {
    const server = await startFixtureServer();
    servers.push(server);
    const browser = await createBrowser();
    const activities: BrowserActivity[] = [];
    browser.onActivity((activity) => activities.push(activity));

    await browser.navigate(`${server.url}/evidence-redirect`);

    await waitForActivity(
      activities,
      "browser_evidence",
      (item) =>
        (item.data.evidence as { kind?: string }).kind === "request_failure",
    );

    const inspection = await browser.inspect();
    const evidence = inspection.metadata?.browserEvidence as
      BrowserEvidenceSnapshot | undefined;

    expect(evidence?.latestMainDocumentStatus).toBe(451);
    expect(evidence?.navigations).toHaveLength(2);
    expect(evidence?.navigations.map((item) => item.status)).toEqual([
      302, 451,
    ]);
    expect(
      new Set(evidence?.navigations.map((item) => item.navigationId)).size,
    ).toBe(1);
    expect(evidence?.navigations[0]).toMatchObject({
      pageId: "page_01",
      frameId: "main",
      mainFrame: true,
      redirectIndex: 0,
      provenance: "agent",
    });
    expect(evidence?.navigations[1]).toMatchObject({
      destinationUrl: `${server.url}/evidence-terminal`,
      redirectedFromUrl: `${server.url}/evidence-redirect`,
      redirectIndex: 1,
      provenance: "agent",
    });
    expect(evidence?.errors.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["console", "page_error", "request_failure"]),
    );

    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("console-secret");
    expect(serialized).not.toContain("page-secret");
    expect(serialized).not.toContain("request-secret");
    expect(serialized).not.toContain("redirect-secret");
    expect(serialized).not.toContain("url-secret");
    expect(serialized).not.toContain("cookie");
    expect(serialized).not.toContain("authorization");
  });

  it("emits normalized navigation and title activity", async () => {
    const server = await startFixtureServer();

    servers.push(server);

    const browser = await createBrowser();

    const activities: BrowserActivity[] = [];

    browser.onActivity((activity) => {
      activities.push(activity);
    });

    await browser.navigate(`${server.url}/actions`);

    const urlChanged = await waitForActivity(activities, "url_changed");

    expect(urlChanged).toMatchObject({
      type: "url_changed",
      pageId: "page_01",
      data: {
        previousUrl: "about:blank",
        url: `${server.url}/actions`,
      },
    });

    const navigation = await waitForActivity(
      activities,
      "navigation_completed",
    );

    expect(navigation).toMatchObject({
      type: "navigation_completed",
      pageId: "page_01",
      data: {
        url: `${server.url}/actions`,
      },
    });

    expect(navigation.pageRevision).toBeGreaterThan(0);

    const title = await waitForActivity(activities, "page_title_changed");

    expect(title.pageId).toBe("page_01");

    expect(title.data).toHaveProperty("title");

    expect(title.data).toHaveProperty("url", `${server.url}/actions`);
  });

  it("emits minimized interaction, scroll, selection, popup, and tab-switch activity", async () => {
    const server = await startFixtureServer();

    servers.push(server);

    const browser = await createBrowser();

    const activities: BrowserActivity[] = [];

    browser.onActivity((activity) => {
      activities.push(activity);
    });

    await browser.navigate(`${server.url}/actions`);

    await waitForActivity(activities, "navigation_completed");

    activities.length = 0;

    let inspection = await browser.inspect();

    await browser.click(target(inspection, "Change state"));

    const click = await waitForActivity(
      activities,
      "interaction_click",
      (item) => item.data.label === "Change state",
    );

    expect(click.data).toEqual({
      tag: "button",
      label: "Change state",
    });

    const secret = "DO_NOT_PERSIST_THIS_VALUE";

    inspection = await browser.inspect();

    await browser.type(target(inspection, "Password"), secret);

    inspection = await browser.inspect();

    await browser.click(target(inspection, "Submit search"));

    await waitForActivity(activities, "form_submitted");

    inspection = await browser.inspect();

    await browser.press(targetKind(inspection, "select"), "o");

    const selection = await waitForActivity(
      activities,
      "selection_changed",
      (item) => item.data.selectedIndex === 1,
    );

    expect(selection.data.selectedIndex).toBe(1);

    await browser.scroll({
      direction: "down",
      amount: 2_000,
    });

    const scroll = await waitForActivity(activities, "scroll_milestone");

    expect([25, 50, 75, 100]).toContain(scroll.data.percent);

    inspection = await browser.inspect();

    await browser.click(target(inspection, "Open popup"));

    await waitForActivity(
      activities,
      "page_opened",
      (item) => item.pageId === "page_02",
    );

    await browser.switchPage("page_01");

    const switched = await waitForActivity(
      activities,
      "page_switched",
      (item) => item.pageId === "page_01",
    );

    expect(switched.data).toHaveProperty("url");

    expect(JSON.stringify(activities)).not.toContain(secret);
  });
});
