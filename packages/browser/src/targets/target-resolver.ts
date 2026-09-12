import {
  RoveError,
  type BrowserTargetGeometry,
  type TargetReference,
} from "@rove/protocol";
import type { Frame, Locator, Page } from "playwright";

import type { PageState } from "../pages/page-state.js";
import type { TargetHandle } from "../inspection/target-registration.js";
import type { TargetRegistry } from "./target-registry.js";
import { readTargetSnapshots } from "../inspection/perceived-control.js";
import {
  readTargetState,
  sameStrongIdentity,
  type TargetState,
} from "./target-state.js";

export interface ResolvedTarget {
  locator: Locator;
  state: TargetState;
}

export async function resolveTarget(options: {
  page: Page;
  pageState: PageState;
  reference: TargetReference;
  registry: TargetRegistry<TargetHandle> | undefined;
  onStale(): Promise<void>;
}): Promise<ResolvedTarget> {
  const { page, pageState, reference, registry } = options;
  if (reference.pageId !== pageState.id) {
    throw new RoveError({
      code: "PAGE_NOT_FOUND",
      message: "Target belongs to another page.",
    });
  }
  if (reference.revision !== pageState.revision) {
    throw new RoveError({
      code: "TARGET_STALE",
      message: "Target belongs to an older page revision.",
      retryable: true,
    });
  }
  if (registry === undefined) {
    throw new RoveError({
      code: "TARGET_NOT_FOUND",
      message: "Target was not found.",
    });
  }
  const registered = registry.resolve(reference);
  const frame = resolveFrame(page, registered.handle);
  const locator = frame.locator(
    `[data-rove-target="${registered.handle.marker}"]`,
  );
  const count = await locator.count();
  if (count === 0) {
    await options.onStale();
    throw new RoveError({
      code: "TARGET_STALE",
      message: "The inspected target is no longer present.",
      retryable: true,
    });
  }
  if (count !== 1) {
    throw new RoveError({
      code: "TARGET_AMBIGUOUS",
      message: "The inspected target marker matched multiple elements.",
    });
  }
  if (registered.handle.semanticRole !== undefined) {
    const semanticCount = await frame
      .getByRole(
        registered.handle.semanticRole as Parameters<Frame["getByRole"]>[0],
      )
      .and(locator)
      .count();
    if (semanticCount !== 1) {
      await options.onStale();
      throw new RoveError({
        code: "TARGET_STALE",
        message: "The inspected target no longer has the same semantic role.",
        retryable: true,
      });
    }
  }
  const state = await readTargetState(locator);
  if (!sameStrongIdentity(registered.identity, state.identity)) {
    await options.onStale();
    throw new RoveError({
      code: "TARGET_STALE",
      message: "The inspected target no longer has the same semantic identity.",
      retryable: true,
    });
  }
  if (!state.visible)
    throw new RoveError({
      code: "TARGET_NOT_VISIBLE",
      message: "The target is not visible.",
    });
  if (!state.enabled)
    throw new RoveError({
      code: "TARGET_DISABLED",
      message: "The target is disabled.",
    });
  if (!state.interactive && registered.handle.semanticRole === undefined) {
    throw new RoveError({
      code: "TARGET_NOT_INTERACTIVE",
      message: "The target is not interactive.",
    });
  }
  const expected = registered.handle.snapshot;
  if (expected !== undefined) {
    const configured = page.viewportSize();
    const live = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      deviceScaleFactor: window.devicePixelRatio,
    }));
    const current = (
      await readTargetSnapshots(frame, {
        width: configured?.width ?? live.width,
        height: configured?.height ?? live.height,
        scrollX: live.scrollX,
        scrollY: live.scrollY,
        deviceScaleFactor: live.deviceScaleFactor,
      })
    ).get(registered.handle.marker);
    if (current === undefined) {
      await options.onStale();
      throw targetStale("The inspected target can no longer be revalidated.");
    }
    if (
      current.nodeToken !== expected.nodeToken ||
      current.rootToken !== expected.rootToken
    ) {
      await options.onStale();
      throw targetStale(
        "The inspected target or its semantic root was replaced.",
      );
    }
    const expectedSemanticState = { ...expected.state };
    const currentSemanticState = { ...current.state };
    delete expectedSemanticState.focused;
    delete currentSemanticState.focused;
    if (
      JSON.stringify(currentSemanticState) !==
      JSON.stringify(expectedSemanticState)
    ) {
      await options.onStale();
      throw targetStale("The inspected target state changed.");
    }
    if (current.geometry.occluded) {
      throw new RoveError({
        code: "TARGET_NOT_VISIBLE",
        message: "The target is occluded.",
      });
    }
    if (!sameGeometry(expected.geometry, current.geometry)) {
      await options.onStale();
      throw targetStale("The inspected target moved or changed geometry.");
    }
  }
  return { locator, state };
}

function targetStale(message: string): RoveError {
  return new RoveError({ code: "TARGET_STALE", message, retryable: true });
}

function sameGeometry(
  expected: BrowserTargetGeometry,
  current: BrowserTargetGeometry,
): boolean {
  if (
    expected.inViewport !== current.inViewport ||
    expected.clipped !== current.clipped ||
    expected.occluded !== current.occluded
  )
    return false;
  if (expected.bounds === null || current.bounds === null)
    return expected.bounds === current.bounds;
  const tolerance = 2;
  return (["x", "y", "width", "height"] as const).every(
    (key) =>
      Math.abs(expected.bounds![key] - current.bounds![key]) <= tolerance,
  );
}

function resolveFrame(page: Page, handle: TargetHandle): Frame {
  const frames = page.frames();
  if (handle.frame !== undefined) {
    if (!frames.includes(handle.frame)) {
      throw targetStale("The inspected target frame was replaced.");
    }
    return handle.frame;
  }
  const indexed = frames[handle.frameIndex];

  if (indexed?.url() === handle.frameUrl) {
    return indexed;
  }

  const matchingUrl = frames.find((frame) => frame.url() === handle.frameUrl);

  if (matchingUrl !== undefined) {
    return matchingUrl;
  }

  throw new RoveError({
    code: "TARGET_STALE",
    message: "The inspected target frame is no longer present.",
    retryable: true,
  });
}
