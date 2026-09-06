import { afterEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";

import {
  RoveError,
  type BrowserLaunchConfig,
  type PageInspection,
  type TargetReference,
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

async function setup(path = "/actions") {
  const server = await startFixtureServer();
  const session = await new PlaywrightBrowserEngine().start(config);
  servers.push(server);
  sessions.push(session);
  await session.navigate(`${server.url}${path}`);
  return { server, session };
}

function target(inspection: PageInspection, name: string): TargetReference {
  const found = inspection.targets?.find(
    (candidate) => candidate.name === name,
  );
  if (!found) throw new Error(`Missing fixture target: ${name}`);
  return {
    pageId: inspection.pageId,
    revision: inspection.revision,
    ref: found.ref,
  };
}

function testPage(session: BrowserSession): Page {
  const internal = session as unknown as {
    pageRegistry: {
      activeId(): string | undefined;
      pageFor(pageId: string): Page;
    };
  };

  const pageId = internal.pageRegistry.activeId();

  if (pageId === undefined) {
    throw new Error("Fixture session has no active page.");
  }

  return internal.pageRegistry.pageFor(pageId);
}

async function hideObservedTarget(session: BrowserSession): Promise<void> {
  await testPage(session).evaluate(() => {
    const element = document.querySelector<HTMLElement>("#replace-me");

    if (element === null) {
      throw new Error("Dynamic fixture target is missing.");
    }

    element.style.display = "none";
  });
}

async function replaceObservedTarget(session: BrowserSession): Promise<void> {
  await testPage(session).evaluate(() => {
    const old = document.querySelector<HTMLElement>("#replace-me");

    if (old === null) {
      throw new Error("Dynamic fixture target is missing.");
    }

    const replacement = document.createElement("button");

    replacement.id = "replace-me";
    replacement.textContent = "Replace me";

    replacement.addEventListener("click", () => {
      document.body.dataset.replacementClicked = "true";
    });

    old.replaceWith(replacement);
  });
}

async function duplicateObservedTarget(session: BrowserSession): Promise<void> {
  await testPage(session).evaluate(() => {
    const original = document.querySelector<HTMLElement>("#replace-me");

    if (original === null) {
      throw new Error("Dynamic fixture target is missing.");
    }

    const duplicate = original.cloneNode(true) as HTMLElement;

    duplicate.id = "duplicate";

    original.after(duplicate);
  });
}

async function mutateUnrelatedContent(session: BrowserSession): Promise<void> {
  await testPage(session).evaluate(() => {
    const unrelated = document.querySelector<HTMLElement>("#unrelated");

    if (unrelated === null) {
      throw new Error("Dynamic fixture unrelated node is missing.");
    }

    unrelated.textContent = "changed";
  });
}

afterEach(async () => {
  while (sessions.length > 0) await sessions.pop()?.close();
  while (servers.length > 0) await servers.pop()?.close();
});

describe("Milestone 3 browser actions", () => {
  it("clicks an inspected target and reports material state change", async () => {
    const { session } = await setup();
    const inspection = await session.inspect();
    const result = await session.click(target(inspection, "Change state"));
    expect(result).toMatchObject({
      action: "click",
      pageChanged: true,
      previousRevision: inspection.revision,
    });
    expect((await session.inspect()).text).toContain("State changed");
  }, 10_000);

  it("navigates by click, increments revision, and stales old refs", async () => {
    const { session } = await setup();
    const inspection = await session.inspect();
    const old = target(inspection, "Search");
    const result = await session.click(target(inspection, "Navigate result"));
    expect(result.pageChanged).toBe(true);
    expect(result.currentRevision).toBeGreaterThan(inspection.revision);
    await expect(session.type(old, "ignored")).rejects.toMatchObject({
      code: "TARGET_STALE",
    });
  });

  it("preserves dispatch certainty when post-action synchronization fails", async () => {
    const { server, session } = await setup("/consequential-action");
    const inspection = await session.inspect();
    const internal = session as unknown as {
      synchronizeAfterAction: (...args: unknown[]) => Promise<unknown>;
    };
    const synchronize = internal.synchronizeAfterAction.bind(session);
    let synchronizationCalls = 0;

    internal.synchronizeAfterAction = async (...args: unknown[]) => {
      synchronizationCalls += 1;
      if (synchronizationCalls === 1) {
        throw new Error("forced post-action synchronization failure");
      }
      return synchronize(...args);
    };

    await expect(
      session.interact(
        {
          kind: "click",
          target: target(inspection, "Apply consequential mutation"),
        },
        { observationId: inspection.observationId },
      ),
    ).rejects.toMatchObject({
      dispatched: true,
      stage: "post_action_synchronization",
      result: {
        ok: true,
        url: `${server.url}/consequential-result`,
      },
    });

    expect(server.mutationCount()).toBe(1);
    await expect(session.inspect()).resolves.toMatchObject({
      url: `${server.url}/consequential-result`,
      text: expect.stringContaining("Mutation applied"),
    });
  });

  it("fills instead of appending and supports targeted and page keyboard presses", async () => {
    const { session } = await setup();
    const inspection = await session.inspect();
    const search = target(inspection, "Search");
    await session.type(search, "backend");
    const next = await session.inspect();
    await session.press(target(next, "Search"), "Enter");
    expect((await session.inspect()).text).toContain("submitted:backend");
    await expect(session.press(null, "Escape")).resolves.toMatchObject({
      action: "press",
    });
  });

  it("preserves literal Markdown under deterministic replacement", async () => {
    const { session } = await setup("/reactive-editor");
    const requested = "- [ ] one\n- [ ] two\n- [ ] three";
    let inspection = await session.inspect();

    await session.type(target(inspection, "Body"), requested);

    expect(await testPage(session).locator("#body").inputValue()).toBe(
      requested,
    );

    inspection = await session.inspect();
    await session.press(target(inspection, "Body"), "Enter");
    expect(await testPage(session).locator("#body").inputValue()).toBe(
      `${requested}\n- [ ] `,
    );
  });

  it("reports exact replacement failure without exposing a sensitive value", async () => {
    const { session } = await setup("/reactive-editor");
    const inspection = await session.inspect();
    const secret = "force-mismatch-private-secret";

    let failure: unknown;
    try {
      await session.type(target(inspection, "Password"), secret);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ code: "TARGET_NOT_INTERACTIVE" });
    expect(JSON.stringify(failure)).not.toContain(secret);
  });

  it("accounts for recovered controls and dynamically mounted editor actions", async () => {
    const { session } = await setup("/interactive-reconciliation");
    const first = await session.inspect();

    expect(
      first.targets?.find((item) => item.name === "Record actions"),
    ).toMatchObject({ kind: "option", role: "option" });
    expect(
      first.targets?.filter((item) => item.kind === "checkbox"),
    ).toHaveLength(2);

    const recovered = target(first, "Record actions");
    await session.click(target(first, "Edit body"));
    const editor = await session.inspect();
    expect(editor.targets?.map((item) => item.name)).toEqual(
      expect.arrayContaining(["Body input", "Cancel", "Save"]),
    );

    await session.invalidateTargets();
    await expect(session.click(recovered)).rejects.toMatchObject({
      code: "TARGET_STALE",
      retryable: true,
    });
  });

  it("never returns or serializes sensitive typed values", async () => {
    const { session } = await setup();
    const inspection = await session.inspect();
    const secret = "super-secret-test-value";
    const result = await session.type(target(inspection, "Password"), secret);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(
      JSON.stringify(
        new RoveError({ code: "TARGET_STALE", message: "stale" }).toJSON(),
      ),
    ).not.toContain(secret);
  });

  it("scrolls in the requested direction and rejects invalid amounts", async () => {
    const { session } = await setup();
    await session.scroll({ direction: "down", amount: 700 });
    expect((await session.inspect()).text).toMatch(/scrolled:[1-9]/);
    await expect(
      session.scroll({ direction: "down", amount: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
  });

  it("supports history and treats missing history as a successful no-op", async () => {
    const { server, session } = await setup("/history-a");
    await session.navigate(`${server.url}/history-b`);
    const back = await session.back();
    expect(back).toMatchObject({ action: "back", pageChanged: true });
    expect(back.url).toContain("/history-a");
    const forward = await session.forward();
    expect(forward).toMatchObject({ action: "forward", pageChanged: true });
    expect(forward.url).toContain("/history-b");

    const fresh = await new PlaywrightBrowserEngine().start(config);
    sessions.push(fresh);
    await expect(fresh.back()).resolves.toMatchObject({
      ok: true,
      pageChanged: false,
    });
  });

  it("captures viewport, full-page, target, and masked sensitive screenshots", async () => {
    const { session } = await setup();
    let inspection = await session.inspect();
    for (const mode of ["viewport", "full-page"] as const) {
      const artifact = await session.screenshot({ mode });
      expect(artifact.mimeType).toBe("image/png");
      expect(artifact.bytes.length).toBeGreaterThan(0);
      expect(artifact.metadata).toMatchObject({
        mode,
        pageId: inspection.pageId,
      });
    }
    const targetArtifact = await session.screenshot({
      mode: "target",
      target: target(inspection, "Submit search"),
      observationId: inspection.observationId,
    });

    expect(targetArtifact.bytes.length).toBeGreaterThan(0);

    const regionArtifact = await session.screenshot({
      mode: "region",
      observationId: inspection.observationId,
      region: {
        x: 0,
        y: 0,
        width: 320,
        height: 200,
      },
    });

    expect(regionArtifact.bytes.length).toBeGreaterThan(0);

    expect(regionArtifact.metadata).toMatchObject({
      mode: "region",
      observationId: inspection.observationId,
    });
    await session.type(target(inspection, "One-time code"), "849291");
    inspection = await session.inspect();
    const sensitive = await session.screenshot({
      mode: "target",
      target: target(inspection, "One-time code"),
    });
    expect(sensitive.bytes.length).toBeGreaterThan(0);
    await expect(
      session.type(target(inspection, "One-time code"), "still-editable"),
    ).resolves.toMatchObject({ ok: true });
    await expect(session.screenshot({ mode: "target" })).rejects.toMatchObject({
      code: "TARGET_NOT_FOUND",
    });

    const staleObservationId = inspection.observationId;

    await session.invalidateTargets();

    await expect(
      session.screenshot({
        mode: "viewport",
        observationId: staleObservationId,
      }),
    ).rejects.toMatchObject({
      code: "OBSERVATION_STALE",
      retryable: true,
    });
  });

  it("reports disabled, hidden, stale, and ambiguous targets without guessing", async () => {
    const first = await setup();

    let inspection = await first.session.inspect();

    await expect(
      first.session.click(target(inspection, "Disabled action")),
    ).rejects.toMatchObject({
      code: "TARGET_DISABLED",
    });

    const hidden = await setup("/dynamic-target");

    inspection = await hidden.session.inspect();

    const hiddenRef = target(inspection, "Replace me");

    await hideObservedTarget(hidden.session);

    await expect(hidden.session.click(hiddenRef)).rejects.toMatchObject({
      code: "TARGET_NOT_VISIBLE",
    });

    const replaced = await setup("/dynamic-target");

    inspection = await replaced.session.inspect();

    const replacedRef = target(inspection, "Replace me");

    await replaceObservedTarget(replaced.session);

    await expect(replaced.session.click(replacedRef)).rejects.toMatchObject({
      code: "TARGET_STALE",
      retryable: true,
    });

    const duplicate = await setup("/dynamic-target");

    inspection = await duplicate.session.inspect();

    const duplicateRef = target(inspection, "Replace me");

    await duplicateObservedTarget(duplicate.session);

    await expect(duplicate.session.click(duplicateRef)).rejects.toMatchObject({
      code: "TARGET_AMBIGUOUS",
    });
  }, 15_000);

  it("allows an unchanged target after an unrelated mutation", async () => {
    const { session } = await setup("/dynamic-target");

    const inspection = await session.inspect();

    const ref = target(inspection, "Replace me");

    await mutateUnrelatedContent(session);

    await expect(session.click(ref)).resolves.toMatchObject({
      ok: true,
      action: "click",
    });
  });

  it("reports newly opened pages from click", async () => {
    const { session } = await setup();
    const inspection = await session.inspect();
    const result = await session.click(target(inspection, "Open popup"));
    expect(result.openedPages?.[0]).toMatchObject({
      id: "page_02",
      active: true,
    });
    expect(result.pageChanged).toBe(true);
  });

  it("dismisses JavaScript dialogs without leaking dialog text", async () => {
    const { session } = await setup();
    const activities: unknown[] = [];
    session.onActivity((activity) => activities.push(activity));

    let inspection = await session.inspect();
    await expect(
      session.click(target(inspection, "Show alert")),
    ).resolves.toMatchObject({
      ok: true,
      action: "click",
    });

    inspection = await session.inspect();
    await expect(
      session.click(target(inspection, "Show confirm")),
    ).resolves.toMatchObject({
      ok: true,
      action: "click",
    });
    expect((await session.inspect()).metadata).toBeDefined();

    inspection = await session.inspect();
    await expect(
      session.click(target(inspection, "Show prompt")),
    ).resolves.toMatchObject({
      ok: true,
      action: "click",
    });

    const serializedActivities = JSON.stringify(activities);
    expect(serializedActivities).toContain("dialog_opened");
    expect(serializedActivities).toContain('"defaultAction":"dismiss"');
    expect(serializedActivities).not.toContain("fixture alert");
    expect(serializedActivities).not.toContain("fixture confirm");
    expect(serializedActivities).not.toContain("fixture prompt");
    expect(serializedActivities).not.toContain("secret");
  }, 15_000);
});
