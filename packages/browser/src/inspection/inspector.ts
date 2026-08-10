import type {
  InspectOptions,
  PageInspection,
  PageTarget,
  TargetKind,
} from "@rove/protocol";
import type { Page } from "playwright";

import type { PageState } from "../pages/page-state.js";
import { classifyTargetCandidates } from "./target-classifier.js";
import {
  clearTargetMarkers,
  discoverTargetCandidates,
} from "./target-discovery.js";
import { identifyTargetCandidates } from "./target-identity-builder.js";
import {
  PageTargetRegistryStore,
  registerIdentifiedTargets,
  type TargetHandle,
} from "./target-registration.js";
import { extractVisibleText } from "./text-extractor.js";
import type { TargetRegistry } from "../targets/target-registry.js";

const DEFAULT_MAX_TEXT_CHARS = 20_000;
const DEFAULT_TARGET_LIMIT = 200;

interface ResolvedInspectOptions {
  includeText: boolean;
  includeTargets: boolean;
  includeViewport: boolean;
  maxTextChars: number;
  targetLimit: number;
  targetKinds?: TargetKind[];
}

export function resolveInspectOptions(
  options: InspectOptions = {},
): ResolvedInspectOptions {
  return {
    includeText: options.includeText ?? true,
    includeTargets: options.includeTargets ?? true,
    includeViewport: options.includeViewport ?? true,
    maxTextChars: options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS,
    targetLimit: options.targetLimit ?? DEFAULT_TARGET_LIMIT,
    ...(options.targetKinds === undefined
      ? {}
      : { targetKinds: options.targetKinds }),
  };
}

export class PageInspector {
  constructor(
    private readonly registries = new PageTargetRegistryStore(),
  ) {}

  registryForPage(
    pageId: string,
  ): TargetRegistry<TargetHandle> | undefined {
    return this.registries.get(pageId);
  }

  async invalidatePage(
    page: Page,
    pageId: string,
    nextRevision: number,
  ): Promise<void> {
    this.registries.get(pageId)?.invalidate(nextRevision);
    await clearTargetMarkers(page);
  }

  forgetPage(pageId: string): void {
    this.registries.delete(pageId);
  }

  clear(): void {
    this.registries.clear();
  }

  async inspect(
    page: Page,
    pageState: PageState,
    options: InspectOptions = {},
  ): Promise<PageInspection> {
    const resolved = resolveInspectOptions(options);

    const result: PageInspection = {
      pageId: pageState.id,
      revision: pageState.revision,
      url: page.url(),
      title: await page.title(),
    };

    const metadata: Record<string, unknown> = {};

    if (resolved.includeViewport) {
      const viewport = page.viewportSize();

      if (viewport !== null) {
        result.viewport = viewport;
      }
    }

    if (resolved.includeText) {
      const extracted = await extractVisibleText(
        page,
        resolved.maxTextChars,
      );

      result.text = extracted.text;
      metadata.textTruncated = extracted.truncated;
    }

    const registry = this.registries.beginInspection(
      pageState.id,
      pageState.revision,
    );

    if (resolved.includeTargets) {
      const discovered = await discoverTargetCandidates(page);
      const classified = classifyTargetCandidates(discovered);
      const identified = identifyTargetCandidates(classified);

      const eligible =
        resolved.targetKinds === undefined
          ? identified
          : identified.filter((candidate) =>
              resolved.targetKinds!.includes(candidate.kind),
            );

      const targetsTruncated =
        eligible.length > resolved.targetLimit;

      const limited = eligible.slice(0, resolved.targetLimit);

      const registered = registerIdentifiedTargets(
        page,
        registry,
        limited,
      );

      result.targets = registered.map(
        ({ candidate, registered: target }): PageTarget => ({
          ref: target.reference.ref,
          kind: candidate.kind,
          ...(candidate.role === undefined
            ? {}
            : { role: candidate.role }),
          ...(candidate.name === undefined
            ? {}
            : { name: candidate.name }),
          visible: true,
          enabled: candidate.enabled,
          ...(candidate.sensitive
            ? { sensitive: true }
            : {}),
        }),
      );

      metadata.targetsTruncated = targetsTruncated;
    } else {
      await clearTargetMarkers(page);
    }

    if (Object.keys(metadata).length > 0) {
      result.metadata = metadata;
    }

    return result;
  }
}

export {
  DEFAULT_MAX_TEXT_CHARS,
  DEFAULT_TARGET_LIMIT,
};
