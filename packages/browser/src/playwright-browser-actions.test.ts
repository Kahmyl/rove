import { afterEach, describe, expect, it } from "vitest";
import { errors as playwrightErrors, type Page } from "playwright";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const recordingRoots: string[] = [];

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
  while (recordingRoots.length > 0)
    await rm(recordingRoots.pop()!, { recursive: true, force: true });
});

describe("browser actions", () => {
  it("records only the originally selected page and finalizes WebM", async () => {
    const { server, session } = await setup();
    const original = (await session.pages()).find((page) => page.active)!;
    const root = await mkdtemp(join(tmpdir(), "rove-page-recording-test-"));
    recordingRoots.push(root);
    const path = join(root, "page.webm");
    const recordingId = `rec_${"a".repeat(32)}`;

    await expect(
      session.startPageRecording({
        recordingId,
        pageId: original.id,
        path,
      }),
    ).resolves.toMatchObject({ recordingId, pageId: original.id });
    const other = await session.openPage(`${server.url}/capability-waves`);
    await session.switchPage(other.id);
    await testPage(session).waitForTimeout(150);
    await expect(session.stopPageRecording(recordingId)).resolves.toMatchObject(
      {
        recordingId,
        pageId: original.id,
      },
    );

    const bytes = await readFile(path);
    expect(bytes.byteLength).toBeGreaterThan(128);
    expect(bytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
  }, 15_000);

  it("executes supported interaction primitives with action evidence", async () => {
    const { session } = await setup("/capability-waves");
    let observation = await session.inspect();

    const activation = observation.targets?.find(
      (candidate) => candidate.name === "Activate with variants",
    );
    expect(activation?.perceived?.capabilities).toEqual(
      expect.arrayContaining([
        "activate",
        "double_activate",
        "secondary_activate",
        "focus",
        "press",
      ]),
    );
    expect(observation.capabilities).toMatchObject({
      capabilityAtlasVersion: "2026-09-08.1",
      humanBoundaries: expect.arrayContaining([
        "browser_permission",
        "webauthn",
        "payment",
        "human_verification",
        "closed_shadow_dom",
        "browser_owned_ui",
      ]),
      interactionKinds: expect.arrayContaining([
        "double_click",
        "secondary_click",
        "modified_click",
        "type_sequential",
        "clipboard",
      ]),
    });

    const run = async (
      action: Parameters<BrowserSession["interact"]>[0],
      expectedDataset: string,
    ) => {
      const result = await session.interact(action, {
        observationId: observation.observationId,
      });
      expect(result.phases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ phase: "preflight", status: "completed" }),
          expect.objectContaining({ phase: "commit", status: "completed" }),
          expect.objectContaining({
            phase: "synchronize",
            status: "completed",
          }),
        ]),
      );
      expect(
        await testPage(session).evaluate(
          (key) => document.body.dataset[key],
          expectedDataset,
        ),
      ).toBe("true");
      observation = await session.inspect();
    };

    await run(
      {
        kind: "double_click",
        target: target(observation, "Activate with variants"),
      },
      "double",
    );
    await run(
      {
        kind: "secondary_click",
        target: target(observation, "Activate with variants"),
      },
      "secondary",
    );
    await run(
      {
        kind: "modified_click",
        target: target(observation, "Activate with variants"),
        modifiers: ["Shift"],
      },
      "modified",
    );

    await session.interact(
      { kind: "focus", target: target(observation, "Wave editor") },
      { observationId: observation.observationId },
    );
    observation = await session.inspect();
    expect(
      observation.targets?.find((candidate) => candidate.name === "Wave editor")
        ?.state?.focused,
    ).toBe(true);
    await session.interact(
      { kind: "blur", target: target(observation, "Wave editor") },
      { observationId: observation.observationId },
    );
    observation = await session.inspect();
    expect(
      observation.targets?.find((candidate) => candidate.name === "Wave editor")
        ?.state?.focused,
    ).toBe(false);

    await session.interact(
      {
        kind: "press",
        target: target(observation, "Priority"),
        key: "ArrowRight",
      },
      { observationId: observation.observationId },
    );
    observation = await session.inspect();
    expect(
      observation.targets?.find((candidate) => candidate.name === "Priority")
        ?.state?.valueNow,
    ).toBe(5);

    const staticCell = target(observation, "Static folder cell");
    const staticCapabilities = observation.targets?.find(
      (candidate) => candidate.name === "Static folder cell",
    )?.perceived?.capabilities;
    expect(staticCapabilities).toEqual(
      expect.arrayContaining([
        "activate",
        "double_activate",
        "secondary_activate",
      ]),
    );
    expect(staticCapabilities).not.toContain("focus");
    expect(staticCapabilities).not.toContain("press");
    await expect(
      session.interact(
        { kind: "press", target: staticCell, key: "Enter" },
        { observationId: observation.observationId },
      ),
    ).rejects.toMatchObject({
      code: "TARGET_NOT_INTERACTIVE",
      details: {
        action: "press",
        reason: "target_not_focusable",
      },
    });
    expect(
      await testPage(session).evaluate(
        () => document.body.dataset.staticGridKey,
      ),
    ).toBeUndefined();

    observation = await session.inspect();
    expect(
      observation.targets?.find(
        (candidate) => candidate.name === "Roving folder cell",
      )?.perceived?.capabilities,
    ).toEqual(expect.arrayContaining(["focus", "press"]));
    await session.interact(
      {
        kind: "press",
        target: target(observation, "Roving folder cell"),
        key: "Enter",
      },
      { observationId: observation.observationId },
    );
    expect(
      await testPage(session).evaluate(
        () => document.body.dataset.rovingGridKey,
      ),
    ).toBe("Enter");
    observation = await session.inspect();

    await session.interact(
      { kind: "check", target: target(observation, "Notifications") },
      { observationId: observation.observationId },
    );
    observation = await session.inspect();
    expect(
      observation.targets?.find(
        (candidate) => candidate.name === "Notifications",
      )?.state?.checked,
    ).toBe(true);

    await session.interact(
      {
        kind: "type_sequential",
        target: target(observation, "Wave editor"),
        value: "typed as one request",
        delayMs: 0,
      },
      { observationId: observation.observationId },
    );
    expect(await testPage(session).locator("#editor").inputValue()).toBe(
      "typed as one request",
    );
    observation = await session.inspect();

    await session.interact(
      { kind: "select_text", target: target(observation, "Wave editor") },
      { observationId: observation.observationId },
    );
    observation = await session.inspect();
    await session.interact(
      {
        kind: "clipboard",
        operation: "copy",
        target: target(observation, "Wave editor"),
      },
      { observationId: observation.observationId },
    );
    expect(
      await testPage(session).evaluate(() => document.body.dataset.copied),
    ).toBe("true");
    observation = await session.inspect();
    await run(
      {
        kind: "clipboard",
        operation: "cut",
        target: target(observation, "Wave editor"),
      },
      "cut",
    );
    await run(
      {
        kind: "clipboard",
        operation: "paste",
        target: target(observation, "Wave editor"),
      },
      "pasted",
    );

    await session.interact(
      {
        kind: "upload",
        target: target(observation, "Multiple files"),
        evidenceIds: ["ev_first", "ev_second"],
      },
      {
        observationId: observation.observationId,
        uploads: [
          { filename: "first.txt", bytes: new TextEncoder().encode("one") },
          { filename: "second.txt", bytes: new TextEncoder().encode("two") },
        ],
      },
    );
    expect(
      await testPage(session).evaluate(() => document.body.dataset.files),
    ).toBe("first.txt,second.txt");
    observation = await session.inspect();

    const dragResult = await session.interact(
      {
        kind: "drag",
        target: target(observation, "Draggable card"),
        destination: target(observation, "Drop destination"),
      },
      { observationId: observation.observationId },
    );
    expect(dragResult.phases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "engage", status: "completed" }),
        expect.objectContaining({ phase: "progress", status: "completed" }),
      ]),
    );
    expect(
      await testPage(session).evaluate(() => document.body.dataset.dropped),
    ).toBe("true");
    observation = await session.inspect();

    const customDragResult = await session.interact(
      {
        kind: "drag",
        target: target(observation, "Custom draggable card"),
        destination: target(observation, "Custom drop destination"),
      },
      { observationId: observation.observationId },
    );
    expect(customDragResult.phases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "engage", status: "completed" }),
        expect.objectContaining({ phase: "progress", status: "completed" }),
      ]),
    );
    expect(
      await testPage(session).evaluate(
        () => document.body.dataset.customDropped,
      ),
    ).toBe("true");
  }, 20_000);

  it("perceives composite widget state and protects sensitive values", async () => {
    const { server, session } = await setup("/capability-waves");
    let observation = await session.inspect();
    const slider = observation.targets?.find(
      (candidate) => candidate.name === "Priority",
    );
    const toggle = observation.targets?.find(
      (candidate) => candidate.name === "Notifications",
    );
    const disclosure = observation.targets?.find(
      (candidate) => candidate.name === "Advanced controls",
    );

    expect(slider).toMatchObject({
      kind: "slider",
      state: { valueNow: 4, valueMin: 0, valueMax: 10 },
    });
    expect(toggle).toMatchObject({ kind: "switch", state: { checked: false } });
    expect(disclosure).toMatchObject({
      kind: "disclosure",
      state: { open: false, expanded: false },
    });

    await session.interact(
      { kind: "click", target: target(observation, "Advanced controls") },
      { observationId: observation.observationId },
    );
    observation = await session.inspect();
    expect(
      observation.targets?.find(
        (candidate) => candidate.name === "Advanced controls",
      ),
    ).toMatchObject({ state: { open: true, expanded: true } });

    await session.navigate(`${server.url}/actions`);
    const sensitiveObservation = await session.inspect();
    expect(
      sensitiveObservation.targets?.find(
        (candidate) => candidate.name === "Password",
      )?.state?.value,
    ).toBeUndefined();
    expect(
      sensitiveObservation.targets?.find(
        (candidate) => candidate.name === "One-time code",
      )?.state?.value,
    ).toBeUndefined();
  }, 10_000);

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

  it("preserves direct-click certainty when post-action synchronization fails", async () => {
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
      session.click(target(inspection, "Apply consequential mutation")),
    ).rejects.toMatchObject({
      dispatched: true,
      stage: "post_action_synchronization",
      result: {
        ok: true,
        url: `${server.url}/consequential-result`,
      },
    });
    expect(server.mutationCount()).toBe(1);
  });

  it("keeps proven navigation when optional metadata synchronization races", async () => {
    const { server, session } = await setup();
    const inspection = await session.inspect();
    const internal = session as unknown as {
      pageRegistry: {
        syncMetadata: (pageId: string) => Promise<unknown>;
      };
    };
    internal.pageRegistry.syncMetadata = async () => {
      throw new Error("Execution context was destroyed during navigation");
    };

    await expect(
      session.click(target(inspection, "Navigate result")),
    ).resolves.toMatchObject({
      ok: true,
      pageChanged: true,
      url: `${server.url}/result`,
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

  it("uploads through both a file input and a grounded file-chooser trigger", async () => {
    const { session } = await setup();
    let inspection = await session.inspect();
    const upload = {
      filename: "rove-live-acceptance.txt",
      bytes: new TextEncoder().encode("Rove live acceptance"),
    };

    await session.interact(
      {
        kind: "upload",
        target: target(inspection, "Direct file"),
        evidenceId: "ev_direct",
      },
      { observationId: inspection.observationId, upload },
    );

    expect(
      await testPage(session)
        .locator("#direct-file")
        .evaluate((element) =>
          element instanceof HTMLInputElement
            ? element.files?.item(0)?.name
            : undefined,
        ),
    ).toBe(upload.filename);

    inspection = await session.inspect();

    const chooserTrigger = await session.resolveTarget({
      observationId: inspection.observationId,
      intent: {
        capability: "activate",
        text: "File upload trigger",
      },
    });
    expect(chooserTrigger).toMatchObject({
      status: "selected",
      reason: "grounded",
    });
    expect(chooserTrigger.alternatives[0]?.evidence).toEqual(
      expect.arrayContaining(["capability_match", "exact_name_match"]),
    );
    if (chooserTrigger.target === undefined) {
      throw new Error("File chooser trigger was not grounded.");
    }

    await session.interact(
      {
        kind: "upload",
        target: chooserTrigger.target,
        evidenceId: "ev_trigger",
      },
      { observationId: inspection.observationId, upload },
    );

    expect(
      await testPage(session)
        .locator("#chooser-file")
        .evaluate((element) =>
          element instanceof HTMLInputElement
            ? element.files?.item(0)?.name
            : undefined,
        ),
    ).toBe(upload.filename);
    expect((await session.inspect()).text).toContain(
      `uploaded:${upload.filename}`,
    );
  });

  it("preserves target identity when CSS supplies spacing between label fragments", async () => {
    const { session } = await setup("/styled-label-identity");
    const inspection = await session.inspect();
    const repositoryName = target(inspection, "Repository name *");

    await expect(
      session.type(repositoryName, "rove-live-acceptance"),
    ).resolves.toMatchObject({ ok: true, action: "type" });

    const verified = await session.inspect();
    expect(target(verified, "Repository name *")).toBeDefined();
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

  it("scrolls the largest eligible surface inside an open shadow root", async () => {
    const { session } = await setup("/shadow-scroll");

    await session.scroll({ direction: "down", amount: 700 });

    expect((await session.inspect()).text).toMatch(/shadow-scrolled:[1-9]/);
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

  it("returns completed history truth when Playwright times out after navigation", async () => {
    const { server, session } = await setup("/history-a");
    await session.navigate(`${server.url}/history-b`);
    const page = testPage(session);
    const goBack = page.goBack.bind(page);

    Object.defineProperty(page, "goBack", {
      configurable: true,
      value: async (options?: Parameters<Page["goBack"]>[0]) => {
        await goBack(options);
        throw new playwrightErrors.TimeoutError(
          "forced timeout after completed history navigation",
        );
      },
    });

    await expect(session.back()).resolves.toMatchObject({
      action: "back",
      pageChanged: true,
      url: `${server.url}/history-a`,
    });
  });

  it("fences history replay when a dispatched timeout has no successor truth", async () => {
    const { session } = await setup("/history-a");
    const page = testPage(session);

    Object.defineProperty(page, "goBack", {
      configurable: true,
      value: async () => {
        throw new playwrightErrors.TimeoutError("forced history timeout");
      },
    });

    await expect(session.back()).rejects.toMatchObject({
      dispatched: true,
      stage: "dispatch",
      original: {
        code: "ACTION_TIMEOUT",
        retryable: true,
      },
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

  it("tags download activity with only the active interaction boundary", async () => {
    const { session } = await setup("/download");
    const activities: Array<{ type: string; data: Record<string, unknown> }> =
      [];
    session.onActivity((activity) => activities.push(activity));
    const inspection = await session.inspect();

    await session.interact(
      { kind: "click", target: target(inspection, "Download file") },
      {
        observationId: inspection.observationId,
        activityBoundaryId: "dlb_fixture_action",
      },
    );

    const deadline = Date.now() + 2_000;
    while (
      !activities.some((activity) => activity.type === "download_completed") &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(
      activities.find((activity) => activity.type === "download_completed"),
    ).toMatchObject({
      data: {
        actionBoundaryId: "dlb_fixture_action",
        correlation: "matched",
        correlationStrategy: "trusted_anchor",
      },
    });
  }, 15_000);

  it("correlates one no-href download and marks two action-bound events ambiguous", async () => {
    const { session } = await setup("/download");
    const activities: Array<{ type: string; data: Record<string, unknown> }> =
      [];
    session.onActivity((activity) => activities.push(activity));
    let inspection = await session.inspect();

    await session.interact(
      { kind: "click", target: target(inspection, "Button download") },
      {
        observationId: inspection.observationId,
        activityBoundaryId: "dlb_dynamic_one",
      },
    );
    inspection = await session.inspect();
    await session.interact(
      { kind: "click", target: target(inspection, "Button download twice") },
      {
        observationId: inspection.observationId,
        activityBoundaryId: "dlb_dynamic_two",
      },
    );

    const deadline = Date.now() + 2_000;
    while (
      activities.filter((activity) => activity.type === "download_completed")
        .length < 3 &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 10));

    expect(
      activities.find(
        (activity) => activity.data.actionBoundaryId === "dlb_dynamic_one",
      ),
    ).toMatchObject({
      data: {
        correlation: "matched",
        correlationStrategy: "trusted_action_download",
      },
    });
    expect(
      activities.filter(
        (activity) => activity.data.actionBoundaryId === "dlb_dynamic_two",
      ),
    ).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ correlation: "ambiguous" }),
      }),
      expect.objectContaining({
        data: expect.objectContaining({ correlation: "ambiguous" }),
      }),
    ]);
  }, 15_000);

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
