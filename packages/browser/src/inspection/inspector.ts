import { randomUUID } from "node:crypto";

import type {
  BrowserObservation,
  BrowserViewport,
  InspectOptions,
  PageTarget,
  TargetKind,
} from "@rove/protocol";

import type { Frame, Page } from "playwright";

import type { PageState } from "../pages/page-state.js";
import { perceivedControlFor } from "../capabilities/browser-capability-registry.js";

import type { TargetRegistry } from "../targets/target-registry.js";

import { collectAriaStructure } from "./aria-structure.js";

import { classifyKind, classifyTargetCandidates } from "./target-classifier.js";

import {
  clearTargetMarkers,
  discoverTargetCandidates,
  recoverAccessibilityCandidates,
} from "./target-discovery.js";

import { identifyTargetCandidates } from "./target-identity-builder.js";

import {
  PageTargetRegistryStore,
  registerIdentifiedTargets,
  type TargetHandle,
} from "./target-registration.js";

import { readTargetSnapshots } from "./perceived-control.js";

import {
  classifyFocusedTextRead,
  extractCompleteVisibleText,
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

interface VirtualizedContentCoverage {
  incomplete: boolean;
  logicalItemCount: number;
  renderedItemCount: number;
}

async function readVirtualizedContentCoverage(
  frame: Frame,
): Promise<VirtualizedContentCoverage> {
  return frame.evaluate(() => {
    const partialCollections: Array<{
      logicalItemCount: number;
      renderedItemCount: number;
    }> = [];

    for (const item of Array.from(
      document.querySelectorAll<HTMLElement>("[aria-setsize]"),
    )) {
      const logicalItemCount = Number(item.getAttribute("aria-setsize"));
      if (!Number.isInteger(logicalItemCount) || logicalItemCount < 1) continue;
      const parent = item.parentElement;
      if (parent === null) continue;
      const role = item.getAttribute("role");
      const renderedItemCount = Array.from(parent.children).filter(
        (candidate) =>
          candidate instanceof HTMLElement &&
          candidate.getAttribute("aria-setsize") === String(logicalItemCount) &&
          candidate.getAttribute("role") === role,
      ).length;
      if (renderedItemCount < logicalItemCount) {
        partialCollections.push({ logicalItemCount, renderedItemCount });
      }
    }

    for (const grid of Array.from(
      document.querySelectorAll<HTMLElement>('[role="grid"][aria-rowcount]'),
    )) {
      const logicalItemCount = Number(grid.getAttribute("aria-rowcount"));
      if (!Number.isInteger(logicalItemCount) || logicalItemCount < 1) continue;
      const renderedItemCount = grid.querySelectorAll('[role="row"]').length;
      if (renderedItemCount < logicalItemCount) {
        partialCollections.push({ logicalItemCount, renderedItemCount });
      }
    }

    return partialCollections.reduce<VirtualizedContentCoverage>(
      (summary, collection) => ({
        incomplete: true,
        logicalItemCount: Math.max(
          summary.logicalItemCount,
          collection.logicalItemCount,
        ),
        renderedItemCount: Math.max(
          summary.renderedItemCount,
          collection.renderedItemCount,
        ),
      }),
      { incomplete: false, logicalItemCount: 0, renderedItemCount: 0 },
    );
  });
}

export function resolveInspectOptions(
  options: InspectOptions = {},
): ResolvedInspectOptions {
  return {
    includeText: options.includeText ?? true,
    includeTargets: options.includeTargets ?? true,
    includeViewport: options.includeViewport ?? true,
    includeStructure: options.includeStructure ?? true,
    maxTextChars: options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS,
    maxStructureChars: options.maxStructureChars ?? DEFAULT_MAX_STRUCTURE_CHARS,
    targetLimit: options.targetLimit ?? DEFAULT_TARGET_LIMIT,
    ...(options.targetKinds === undefined
      ? {}
      : { targetKinds: options.targetKinds }),
  };
}

export class PageInspector {
  private readonly canonicalTargets = new Map<
    string,
    { pageId: string; targets: PageTarget[] }
  >();

  constructor(private readonly registries = new PageTargetRegistryStore()) {}

  registryForPage(pageId: string): TargetRegistry<TargetHandle> | undefined {
    return this.registries.get(pageId);
  }

  targetsForObservation(observationId: string): PageTarget[] | undefined {
    return this.canonicalTargets.get(observationId)?.targets;
  }

  forgetObservation(observationId: string): void {
    this.canonicalTargets.delete(observationId);
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
    for (const [observationId, entry] of this.canonicalTargets) {
      if (entry.pageId === pageId) this.canonicalTargets.delete(observationId);
    }
  }

  clear(): void {
    this.registries.clear();
    this.canonicalTargets.clear();
  }

  async readTextProposition(
    page: Page,
    query: string,
    assertCurrent: () => void = () => undefined,
  ): Promise<{
    state: "present" | "absent" | "unknown";
    frameCount: number;
    checkedFrameCount: number;
    failedFrames: Array<{ index: number; url: string }>;
  }> {
    assertCurrent();
    const frames = inspectableFrames(page);
    const parts = await Promise.all(
      frames.map(async (frame) => {
        try {
          const extracted = await extractCompleteVisibleText(frame.frame);
          assertCurrent();
          return {
            frame,
            text: decorateFrameText(frame, extracted.text),
            succeeded: true as const,
          };
        } catch {
          assertCurrent();
          return { frame, text: "", succeeded: false as const };
        }
      }),
    );
    assertCurrent();

    const succeeded = parts.filter((part) => part.succeeded);
    const failed = parts.filter((part) => !part.succeeded);

    // A match in any successfully-read frame is sound even when an unrelated
    // frame could not be inspected. Absence requires every relevant frame.
    return {
      state: classifyFocusedTextRead(
        query,
        succeeded.map((part) => part.text).filter((text) => text.length > 0),
        failed.length,
      ),
      frameCount: frames.length,
      checkedFrameCount: succeeded.length,
      failedFrames: failed.map(({ frame }) => ({
        index: frame.index,
        url: frame.url,
      })),
    };
  }

  async inspect(
    page: Page,
    pageState: PageState,
    options: InspectOptions = {},
    assertCurrent: () => void = () => undefined,
  ): Promise<BrowserObservation> {
    assertCurrent();
    const resolved = resolveInspectOptions(options);

    const frames = inspectableFrames(page);

    const viewport = await readBrowserViewport(page);
    assertCurrent();

    const result: BrowserObservation = {
      observationId: `bobs_${randomUUID().replaceAll("-", "")}`,
      observedAt: new Date().toISOString(),
      pageId: pageState.id,
      revision: pageState.revision,
      mutationVersion: pageState.mutationVersion,
      document: {
        url: page.url(),
        revision: pageState.revision,
      },
      url: page.url(),
      title: await page.title(),
    };
    assertCurrent();

    const metadata: Record<string, unknown> = {};

    if (frames.length > 1) {
      metadata.frames = frames.map((frame) => ({
        index: frame.index,
        url: frame.url,
        ...(frame.name.length === 0 ? {} : { name: frame.name }),
        main: frame.main,
      }));
    }

    if (resolved.includeViewport) {
      result.viewport = viewport;
    }

    if (resolved.includeText) {
      const extracted = await extractFrameText(frames, resolved.maxTextChars);
      assertCurrent();

      result.text = extracted.text;
      metadata.textTruncated = extracted.truncated;
    }

    if (resolved.includeStructure) {
      result.structure = await collectAriaStructure(
        frames,
        resolved.maxStructureChars,
      );
      assertCurrent();
    }

    if (resolved.includeTargets) {
      const acquired = await Promise.all(
        frames.map(async (frame) => {
          let primary = await discoverTargetCandidates(frame.frame).catch(
            async () => {
              await clearTargetMarkersInFrame(frame.frame);
              return undefined;
            },
          );
          assertCurrent();
          const acquisitionErrors: string[] = [];
          if (primary === undefined) {
            primary = [];
            acquisitionErrors.push("primary_discovery_failed");
          }

          const recovery = await recoverAccessibilityCandidates(
            frame.frame,
            primary.length,
          ).catch(() => ({
            semanticInteractiveCount: 0,
            recovered: [],
            ambiguousBindingCount: 0,
            semanticPrimaryMarkers: [],
            failed: true as const,
          }));
          assertCurrent();
          if ("failed" in recovery) {
            acquisitionErrors.push("accessibility_recovery_failed");
          }

          const virtualizedContent = await readVirtualizedContentCoverage(
            frame.frame,
          ).catch(() => ({
            incomplete: false,
            logicalItemCount: 0,
            renderedItemCount: 0,
          }));
          assertCurrent();

          const discoveredCandidates = [...primary, ...recovery.recovered];
          const targetSnapshots = await readTargetSnapshots(
            frame.frame,
            viewport,
          ).catch(() => undefined);
          assertCurrent();
          if (targetSnapshots === undefined) {
            acquisitionErrors.push("target_state_acquisition_failed");
          }
          const candidates = discoveredCandidates.filter((candidate) =>
            targetSnapshots?.has(candidate.marker),
          );
          const semanticMarkers = new Set([
            ...recovery.semanticPrimaryMarkers,
            ...recovery.recovered.map((candidate) => candidate.marker),
          ]);
          const classified = classifyTargetCandidates(candidates);
          const excludedByReason: Record<string, number> = {};
          const addReason = (reason: string) => {
            excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
          };

          for (const candidate of candidates) {
            if (!candidate.visible) {
              addReason("hidden");
            } else if (classifyKind(candidate) === undefined) {
              addReason("unsupported_role_or_capability");
            }
          }
          if (recovery.ambiguousBindingCount > 0) {
            excludedByReason.ambiguous_binding = recovery.ambiguousBindingCount;
          }

          return {
            frame,
            primaryCount: primary.length,
            semanticInteractiveCount: recovery.semanticInteractiveCount,
            recoveredCount: recovery.recovered.length,
            candidates,
            classified,
            identified: identifyTargetCandidates(classified),
            excludedByReason,
            acquisitionErrors,
            semanticMarkers,
            virtualizedContent,
            targetSnapshots: targetSnapshots ?? new Map(),
          };
        }),
      );
      assertCurrent();

      const identified = acquired.flatMap(({ frame, identified }) =>
        identified.map((candidate) => ({
          frame,
          candidate,
        })),
      );

      const presentedEligible =
        resolved.targetKinds === undefined
          ? identified
          : identified.filter(({ candidate }) =>
              resolved.targetKinds!.includes(candidate.kind),
            );

      const targetsTruncated = presentedEligible.length > resolved.targetLimit;

      assertCurrent();
      const registry = this.registries.beginInspection(
        pageState.id,
        pageState.revision,
      );

      const registered = registerIdentifiedTargets(
        registry,
        identified.map(({ frame, candidate }) => ({
          candidate,
          frame: {
            index: frame.index,
            url: frame.url,
            instance: frame.frame,
          },
          snapshot: acquired
            .find((item) => item.frame.index === frame.index)!
            .targetSnapshots.get(candidate.marker),
        })),
      );

      const canonicalTargets = registered.map(
        ({ registered: target }, index): PageTarget => {
          const item = identified[index]!;
          const frameResult = acquired.find(
            (candidate) => candidate.frame.index === item.frame.index,
          )!;
          const snapshot = frameResult.targetSnapshots.get(
            item.candidate.marker,
          )!;
          const perceived = perceivedControlFor(
            item.candidate,
            snapshot.perceived.scopes,
          );
          const state = item.candidate.sensitive
            ? {
                ...snapshot.state,
                selectedValues: undefined,
                value: undefined,
                valueText: undefined,
              }
            : snapshot.state;

          return {
            ref: target.reference.ref,
            kind: item.candidate.kind,
            ...(item.candidate.role === undefined &&
            item.candidate.semanticRole === undefined
              ? {}
              : {
                  role: item.candidate.role ?? item.candidate.semanticRole,
                }),
            ...(item.candidate.name === undefined
              ? {}
              : { name: item.candidate.name }),
            visible: true,
            enabled: item.candidate.enabled,
            ...(item.candidate.sensitive ? { sensitive: true } : {}),
            frame: {
              index: item.frame.index,
              url: item.frame.url,
              ...(item.frame.name.length === 0
                ? {}
                : { name: item.frame.name }),
              main: item.frame.main,
            },
            shadowRootDepth: item.candidate.shadowRootDepth ?? 0,
            geometry: snapshot.geometry,
            perceived,
            ...(Object.values(state).every((value) => value === undefined)
              ? {}
              : { state }),
          };
        },
      );
      assertCurrent();

      this.canonicalTargets.set(result.observationId, {
        pageId: result.pageId,
        targets: canonicalTargets,
      });

      const presentedKinds =
        resolved.targetKinds === undefined
          ? undefined
          : new Set(resolved.targetKinds);
      result.targets = canonicalTargets
        .filter(
          (target) =>
            presentedKinds === undefined || presentedKinds.has(target.kind),
        )
        .slice(0, resolved.targetLimit);

      const excludedByReason = acquired.reduce<Record<string, number>>(
        (output, frame) => {
          for (const [reason, count] of Object.entries(
            frame.excludedByReason,
          )) {
            output[reason] = (output[reason] ?? 0) + count;
          }
          return output;
        },
        {},
      );
      const invalidGeometry = canonicalTargets.filter(
        (target) => target.geometry?.bounds === null,
      ).length;
      if (invalidGeometry > 0) {
        excludedByReason.invalid_geometry = invalidGeometry;
      }

      const semanticMarkerKeys = new Set(
        acquired.flatMap((frame) =>
          [...frame.semanticMarkers].map(
            (marker) => `${frame.frame.index}:${marker}`,
          ),
        ),
      );
      const semanticInvalidGeometry = canonicalTargets.filter(
        (target, index) => {
          const item = identified[index]!;
          return (
            semanticMarkerKeys.has(
              `${item.frame.index}:${item.candidate.marker}`,
            ) && target.geometry?.bounds === null
          );
        },
      ).length;
      const semanticHidden = acquired.reduce(
        (sum, frame) =>
          sum +
          frame.candidates.filter(
            (candidate) =>
              frame.semanticMarkers.has(candidate.marker) && !candidate.visible,
          ).length,
        0,
      );
      const semanticUnsupported = acquired.reduce(
        (sum, frame) =>
          sum +
          frame.candidates.filter(
            (candidate) =>
              frame.semanticMarkers.has(candidate.marker) &&
              candidate.visible &&
              classifyKind(candidate) === undefined,
          ).length,
        0,
      );
      const semanticAmbiguous = acquired.reduce(
        (sum, frame) => sum + (frame.excludedByReason.ambiguous_binding ?? 0),
        0,
      );
      const semanticNoDomBinding = acquired.reduce(
        (sum, frame) =>
          sum +
          Math.max(
            0,
            frame.semanticInteractiveCount -
              frame.semanticMarkers.size -
              (frame.excludedByReason.ambiguous_binding ?? 0),
          ),
        0,
      );
      const semanticInteractiveCount = acquired.reduce(
        (sum, frame) => sum + frame.semanticInteractiveCount,
        0,
      );
      const semanticTargeted = Math.max(
        0,
        semanticInteractiveCount -
          semanticHidden -
          semanticUnsupported -
          semanticInvalidGeometry -
          semanticAmbiguous -
          semanticNoDomBinding,
      );
      const virtualizedCoverage = acquired.reduce<VirtualizedContentCoverage>(
        (summary, frame) => ({
          incomplete: summary.incomplete || frame.virtualizedContent.incomplete,
          logicalItemCount: Math.max(
            summary.logicalItemCount,
            frame.virtualizedContent.logicalItemCount,
          ),
          renderedItemCount: Math.max(
            summary.renderedItemCount,
            frame.virtualizedContent.renderedItemCount,
          ),
        }),
        { incomplete: false, logicalItemCount: 0, renderedItemCount: 0 },
      );

      metadata.targetsTruncated = targetsTruncated;
      metadata.targetCoverage = {
        semanticInteractiveCount,
        primaryDiscoveredCount: acquired.reduce(
          (sum, frame) => sum + frame.primaryCount,
          0,
        ),
        accessibilityRecoveredCount: acquired.reduce(
          (sum, frame) => sum + frame.recoveredCount,
          0,
        ),
        classifiedCandidateCount: acquired.reduce(
          (sum, frame) => sum + frame.classified.length,
          0,
        ),
        identifiedCandidateCount: identified.length,
        registeredTargetCount: canonicalTargets.length,
        exposedTargetCount: result.targets.length,
        excludedByReason,
        acquisitionErrors: acquired.flatMap((frame) => frame.acquisitionErrors),
        ...(virtualizedCoverage.incomplete
          ? {
              virtualizedContentIncomplete: true,
              virtualizedLogicalItemCount: virtualizedCoverage.logicalItemCount,
              virtualizedRenderedItemCount:
                virtualizedCoverage.renderedItemCount,
            }
          : {}),
        semanticOutcomes: {
          targeted: semanticTargeted,
          hidden: semanticHidden,
          unsupported_role_or_capability: semanticUnsupported,
          invalid_geometry: semanticInvalidGeometry,
          ambiguous_binding: semanticAmbiguous,
          no_dom_binding: semanticNoDomBinding,
        },
      };
    } else {
      assertCurrent();
      this.registries.beginInspection(pageState.id, pageState.revision);
      await clearTargetMarkers(page);
      assertCurrent();
    }

    if (Object.keys(metadata).length > 0) {
      result.metadata = metadata;
    }

    assertCurrent();

    return result;
  }
}

async function clearTargetMarkersInFrame(frame: Frame): Promise<void> {
  await frame.evaluate((markerAttribute) => {
    const clear = (root: Document | ShadowRoot): void => {
      root
        .querySelectorAll(`[${markerAttribute}]`)
        .forEach((element) => element.removeAttribute(markerAttribute));
      for (const element of Array.from(root.querySelectorAll("*"))) {
        if (element.shadowRoot !== null) clear(element.shadowRoot);
      }
    };
    clear(document);
  }, "data-rove-target");
}

export {
  DEFAULT_MAX_STRUCTURE_CHARS,
  DEFAULT_MAX_TEXT_CHARS,
  DEFAULT_TARGET_LIMIT,
};

export async function readBrowserViewport(
  page: Page,
): Promise<BrowserViewport> {
  const configured = page.viewportSize();

  const live = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    deviceScaleFactor: window.devicePixelRatio,
  }));

  return {
    width: configured?.width ?? live.width,
    height: configured?.height ?? live.height,
    scrollX: live.scrollX,
    scrollY: live.scrollY,
    deviceScaleFactor: live.deviceScaleFactor,
  };
}

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
): Promise<{
  text: string;
  truncated: boolean;
}> {
  const parts = await Promise.all(
    frames.map(async (frame) => {
      const extracted = await extractVisibleText(
        frame.frame,
        maxTextChars,
      ).catch(() => ({
        text: "",
        truncated: false,
      }));

      return {
        text: decorateFrameText(frame, extracted.text),
        truncated: extracted.truncated,
      };
    }),
  );

  const text = parts
    .map((part) => part.text)
    .filter((value) => value.length > 0)
    .join("\n\n");

  const truncated =
    parts.some((part) => part.truncated) || text.length > maxTextChars;

  return {
    text: truncated ? text.slice(0, maxTextChars) : text,
    truncated,
  };
}

function decorateFrameText(frame: InspectableFrame, text: string): string {
  if (text.length === 0 || frame.main) return text;

  const label =
    frame.name.length > 0
      ? `Frame ${frame.index}: ${frame.name}`
      : `Frame ${frame.index}`;

  return `[${label}]\n${text}`;
}
