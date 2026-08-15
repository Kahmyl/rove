import { RoveError, type TargetReference } from "@rove/protocol";
import type { Frame, Locator, Page } from "playwright";

import type { PageState } from "../pages/page-state.js";
import type { TargetHandle } from "../inspection/target-registration.js";
import type { TargetRegistry } from "./target-registry.js";
import { readTargetState, sameStrongIdentity, type TargetState } from "./target-state.js";

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
    throw new RoveError({ code: "PAGE_NOT_FOUND", message: "Target belongs to another page." });
  }
  if (reference.revision !== pageState.revision) {
    throw new RoveError({ code: "TARGET_STALE", message: "Target belongs to an older page revision.", retryable: true });
  }
  if (registry === undefined) {
    throw new RoveError({ code: "TARGET_NOT_FOUND", message: "Target was not found." });
  }
  const registered = registry.resolve(reference);
  const frame = resolveFrame(page, registered.handle);
  const locator = frame.locator(`[data-rove-target="${registered.handle.marker}"]`);
  const count = await locator.count();
  if (count === 0) {
    await options.onStale();
    throw new RoveError({ code: "TARGET_STALE", message: "The inspected target is no longer present.", retryable: true });
  }
  if (count !== 1) {
    throw new RoveError({ code: "TARGET_AMBIGUOUS", message: "The inspected target marker matched multiple elements." });
  }
  const state = await readTargetState(locator);
  if (!sameStrongIdentity(registered.identity, state.identity)) {
    await options.onStale();
    throw new RoveError({ code: "TARGET_STALE", message: "The inspected target no longer has the same semantic identity.", retryable: true });
  }
  if (!state.visible) throw new RoveError({ code: "TARGET_NOT_VISIBLE", message: "The target is not visible." });
  if (!state.enabled) throw new RoveError({ code: "TARGET_DISABLED", message: "The target is disabled." });
  if (!state.interactive) throw new RoveError({ code: "TARGET_NOT_INTERACTIVE", message: "The target is not interactive." });
  return { locator, state };
}

function resolveFrame(
  page: Page,
  handle: TargetHandle,
): Frame {
  const frames = page.frames();
  const indexed = frames[handle.frameIndex];

  if (indexed?.url() === handle.frameUrl) {
    return indexed;
  }

  const matchingUrl = frames.find(
    (frame) => frame.url() === handle.frameUrl,
  );

  if (matchingUrl !== undefined) {
    return matchingUrl;
  }

  throw new RoveError({
    code: "TARGET_STALE",
    message: "The inspected target frame is no longer present.",
    retryable: true,
  });
}
