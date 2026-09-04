import {
  randomUUID,
} from "node:crypto";

import type {
  BrowserObservation,
  BrowserTargetGeometry,
  BrowserViewport,
  InspectOptions,
  PageTarget,
  TargetKind,
} from "@rove/protocol";

import type {
  Frame,
  Locator,
  Page,
} from "playwright";

import type {
  PageState,
} from "../pages/page-state.js";

import type {
  TargetRegistry,
} from "../targets/target-registry.js";

import {
  collectAriaStructure,
} from "./aria-structure.js";

import {
  classifyTargetCandidates,
} from "./target-classifier.js";

import {
  clearTargetMarkers,
  discoverTargetCandidates,
} from "./target-discovery.js";

import {
  identifyTargetCandidates,
} from "./target-identity-builder.js";

import {
  PageTargetRegistryStore,
  registerIdentifiedTargets,
  type TargetHandle,
} from "./target-registration.js";

import {
  extractVisibleText,
} from "./text-extractor.js";

const DEFAULT_MAX_TEXT_CHARS = 20_000;
const DEFAULT_TARGET_LIMIT = 200;
const DEFAULT_MAX_STRUCTURE_CHARS = 12_000;

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
  includeStructure: boolean;
  maxTextChars: number;
  maxStructureChars: number;
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
    includeStructure: options.includeStructure ?? true,
    maxTextChars:
      options.maxTextChars ??
      DEFAULT_MAX_TEXT_CHARS,
    maxStructureChars:
      options.maxStructureChars ??
      DEFAULT_MAX_STRUCTURE_CHARS,
    targetLimit:
      options.targetLimit ??
      DEFAULT_TARGET_LIMIT,
    ...(options.targetKinds === undefined
      ? {}
      : { targetKinds: options.targetKinds }),
  };
}

export class PageInspector {
  constructor(
    private readonly registries =
      new PageTargetRegistryStore(),
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
    this.registries
      .get(pageId)
      ?.invalidate(nextRevision);

    await clearTargetMarkers(page);
  }

  forgetPage(
    pageId: string,
  ): void {
    this.registries.delete(pageId);
  }

  clear(): void {
    this.registries.clear();
  }

  async inspect(
    page: Page,
    pageState: PageState,
    options: InspectOptions = {},
  ): Promise<BrowserObservation> {
    const resolved =
      resolveInspectOptions(options);

    const frames =
      inspectableFrames(page);

    const viewport =
      await readBrowserViewport(page);

    const result: BrowserObservation = {
      observationId:
        `bobs_${randomUUID().replaceAll("-", "")}`,
      observedAt:
        new Date().toISOString(),
      pageId:
        pageState.id,
      revision:
        pageState.revision,
      mutationVersion:
        pageState.mutationVersion,
      document: {
        url: page.url(),
        revision:
          pageState.revision,
      },
      url:
        page.url(),
      title:
        await page.title(),
    };

    const metadata: Record<string, unknown> = {};

    if (frames.length > 1) {
      metadata.frames =
        frames.map((frame) => ({
          index: frame.index,
          url: frame.url,
          ...(frame.name.length === 0
            ? {}
            : { name: frame.name }),
          main: frame.main,
        }));
    }

    if (resolved.includeViewport) {
      result.viewport = viewport;
    }

    if (resolved.includeText) {
      const extracted =
        await extractFrameText(
          frames,
          resolved.maxTextChars,
        );

      result.text = extracted.text;
      metadata.textTruncated =
        extracted.truncated;
    }

    if (resolved.includeStructure) {
      result.structure =
        await collectAriaStructure(
          frames,
          resolved.maxStructureChars,
        );
    }

    const registry =
      this.registries.beginInspection(
        pageState.id,
        pageState.revision,
      );

    if (resolved.includeTargets) {
      const identified = (
        await Promise.all(
          frames.map(async (frame) => {
            const discovered =
              await discoverTargetCandidates(
                frame.frame,
              ).catch(() => []);

            return {
              frame,
              identified:
                identifyTargetCandidates(
                  classifyTargetCandidates(
                    discovered,
                  ),
                ),
            };
          }),
        )
      ).flatMap(({ frame, identified }) =>
        identified.map((candidate) => ({
          frame,
          candidate,
        })),
      );

      const eligible =
        resolved.targetKinds === undefined
          ? identified
          : identified.filter(
              ({ candidate }) =>
                resolved.targetKinds!.includes(
                  candidate.kind,
                ),
            );

      const targetsTruncated =
        eligible.length >
        resolved.targetLimit;

      const limited =
        eligible.slice(
          0,
          resolved.targetLimit,
        );

      const registered =
        registerIdentifiedTargets(
          registry,
          limited.map(
            ({ frame, candidate }) => ({
              candidate,
              frame: {
                index: frame.index,
                url: frame.url,
              },
            }),
          ),
        );

      result.targets =
        await Promise.all(
          registered.map(
            async (
              { registered: target },
              index,
            ): Promise<PageTarget> => {
              const item = limited[index]!;

              const geometry =
                await readGeometry(
                  item.frame.frame.locator(
                    `[data-rove-target="${target.handle.marker}"]`,
                  ),
                  viewport,
                );

              return {
                ref: target.reference.ref,
                kind: item.candidate.kind,
                ...(item.candidate.role === undefined
                  ? {}
                  : { role: item.candidate.role }),
                ...(item.candidate.name === undefined
                  ? {}
                  : { name: item.candidate.name }),
                visible: true,
                enabled:
                  item.candidate.enabled,
                ...(item.candidate.sensitive
                  ? { sensitive: true }
                  : {}),
                frame: {
                  index: item.frame.index,
                  url: item.frame.url,
                  ...(item.frame.name.length === 0
                    ? {}
                    : { name: item.frame.name }),
                  main: item.frame.main,
                },
                shadowRootDepth:
                  item.candidate.shadowRootDepth ??
                  0,
                geometry,
              };
            },
          ),
        );

      metadata.targetsTruncated =
        targetsTruncated;
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
  DEFAULT_MAX_STRUCTURE_CHARS,
  DEFAULT_MAX_TEXT_CHARS,
  DEFAULT_TARGET_LIMIT,
};

export async function readBrowserViewport(
  page: Page,
): Promise<BrowserViewport> {
  const configured =
    page.viewportSize();

  const live =
    await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      deviceScaleFactor:
        window.devicePixelRatio,
    }));

  return {
    width:
      configured?.width ??
      live.width,
    height:
      configured?.height ??
      live.height,
    scrollX:
      live.scrollX,
    scrollY:
      live.scrollY,
    deviceScaleFactor:
      live.deviceScaleFactor,
  };
}

function inspectableFrames(
  page: Page,
): InspectableFrame[] {
  return page.frames().map(
    (
      frame,
      index,
    ) => ({
      frame,
      index,
      url: frame.url(),
      name: frame.name(),
      main:
        frame ===
        page.mainFrame(),
    }),
  );
}

async function readGeometry(
  locator: Locator,
  viewport: BrowserViewport,
): Promise<BrowserTargetGeometry> {
  const raw =
    await locator
      .boundingBox()
      .catch(() => null);

  if (raw === null) {
    return {
      bounds: null,
      inViewport: false,
      clipped: true,
      occluded: false,
    };
  }

  const bounds = {
    x: round(raw.x),
    y: round(raw.y),
    width: round(raw.width),
    height: round(raw.height),
  };

  const right =
    bounds.x +
    bounds.width;

  const bottom =
    bounds.y +
    bounds.height;

  const inViewport =
    right > 0 &&
    bottom > 0 &&
    bounds.x < viewport.width &&
    bounds.y < viewport.height;

  const clipped =
    bounds.x < 0 ||
    bounds.y < 0 ||
    right > viewport.width ||
    bottom > viewport.height;

  const occluded =
    await locator
      .evaluate((element) => {
        const rect =
          (
            element as HTMLElement
          ).getBoundingClientRect();

        const x =
          rect.left +
          rect.width / 2;

        const y =
          rect.top +
          rect.height / 2;

        const root =
          element.getRootNode();

        const hit =
          root instanceof ShadowRoot
            ? root.elementFromPoint(x, y)
            : document.elementFromPoint(x, y);

        if (!(hit instanceof Element)) {
          return false;
        }

        return (
          hit !== element &&
          !element.contains(hit)
        );
      })
      .catch(() => false);

  return {
    bounds,
    inViewport,
    clipped,
    occluded,
  };
}

async function extractFrameText(
  frames: InspectableFrame[],
  maxTextChars: number,
): Promise<{
  text: string;
  truncated: boolean;
}> {
  const parts =
    await Promise.all(
      frames.map(async (frame) => {
        const extracted =
          await extractVisibleText(
            frame.frame,
            maxTextChars,
          ).catch(() => ({
            text: "",
            truncated: false,
          }));

        if (extracted.text.length === 0) {
          return extracted;
        }

        if (frame.main) {
          return extracted;
        }

        const label =
          frame.name.length > 0
            ? `Frame ${frame.index}: ${frame.name}`
            : `Frame ${frame.index}`;

        return {
          text:
            `[${label}]\n${extracted.text}`,
          truncated:
            extracted.truncated,
        };
      }),
    );

  const text =
    parts
      .map((part) => part.text)
      .filter((value) => value.length > 0)
      .join("\n\n");

  const truncated =
    parts.some(
      (part) => part.truncated,
    ) ||
    text.length > maxTextChars;

  return {
    text:
      truncated
        ? text.slice(0, maxTextChars)
        : text,
    truncated,
  };
}

function round(
  value: number,
): number {
  return Number(
    value.toFixed(3),
  );
}
