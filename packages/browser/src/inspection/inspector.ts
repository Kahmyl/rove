import type {
  InspectOptions,
  PageInspection,
  PageTarget,
  TargetKind,
} from "@rove/protocol";
import type { Frame, Page } from "playwright";

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

interface InspectableFrame {
  frame: Frame;
  index: number;
  url: string;
  name: string;
  main: boolean;
}

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
    const frames = inspectableFrames(page);

    if (frames.length > 1) {
      metadata.frames = frames.map((frame) => ({
        index: frame.index,
        url: frame.url,
        ...(frame.name.length === 0
          ? {}
          : { name: frame.name }),
        main: frame.main,
      }));
    }

    if (resolved.includeViewport) {
      const viewport = page.viewportSize();

      if (viewport !== null) {
        result.viewport = viewport;
      }
    }

    if (resolved.includeText) {
      const extracted = await extractFrameText(
        frames,
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
      const identified = (
        await Promise.all(
          frames.map(async (frame) => {
            const discovered =
              await discoverTargetCandidates(frame.frame).catch(
                () => [],
              );
            const classified =
              classifyTargetCandidates(discovered);
            const identified =
              identifyTargetCandidates(classified);

            return { frame, identified };
          }),
        )
      ).flatMap(({ frame, identified }) =>
        identified.map((candidate) => ({ frame, candidate })),
      );

      const eligible =
        resolved.targetKinds === undefined
          ? identified
          : identified.filter(({ candidate }) =>
              resolved.targetKinds!.includes(candidate.kind),
            );

      const targetsTruncated =
        eligible.length > resolved.targetLimit;

      const limited = eligible.slice(0, resolved.targetLimit);

      const registered = registerIdentifiedTargets(
        registry,
        limited.map(({ frame, candidate }) => ({
          candidate,
          frame: {
            index: frame.index,
            url: frame.url,
          },
        })),
      );

      result.targets = registered.map(
        ({ registered: target }, index): PageTarget => ({
          ref: target.reference.ref,
          kind: limited[index]!.candidate.kind,
          ...(limited[index]!.candidate.role === undefined
            ? {}
            : { role: limited[index]!.candidate.role }),
          ...(limited[index]!.candidate.name === undefined
            ? {}
            : { name: limited[index]!.candidate.name }),
          visible: true,
          enabled: limited[index]!.candidate.enabled,
          ...(limited[index]!.candidate.sensitive
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

function inspectableFrames(page: Page): InspectableFrame[] {
  return page.frames().map((frame, index) => ({
    frame,
    index,
    url: frame.url(),
    name: frame.name(),
    main: frame === page.mainFrame(),
  }));
}

async function extractFrameText(
  frames: InspectableFrame[],
  maxTextChars: number,
): Promise<{ text: string; truncated: boolean }> {
  const parts = await Promise.all(
    frames.map(async (frame) => {
      const extracted = await extractVisibleText(
        frame.frame,
        maxTextChars,
      ).catch(() => ({ text: "", truncated: false }));

      if (extracted.text.length === 0) {
        return {
          text: "",
          truncated: extracted.truncated,
        };
      }

      if (frame.main) {
        return extracted;
      }

      const label =
        frame.name.length > 0
          ? `Frame ${frame.index}: ${frame.name}`
          : `Frame ${frame.index}`;

      return {
        text: `[${label}]\n${extracted.text}`,
        truncated: extracted.truncated,
      };
    }),
  );

  const text = parts
    .map((part) => part.text)
    .filter((value) => value.length > 0)
    .join("\n\n");
  const truncated =
    parts.some((part) => part.truncated) ||
    text.length > maxTextChars;

  return {
    text: truncated ? text.slice(0, maxTextChars) : text,
    truncated,
  };
}
