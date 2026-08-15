import { performance } from "node:perf_hooks";

import type { ElementHandle, Page } from "playwright";

export interface PageStateFrameElementEvidence {
  cssVisible: boolean;
  area: number;
  viewportIntersectionRatio: number;
  ancestorClipRatio: number;
  topmostSampleRatio: number | null;
}

export interface PageStateFrameEvidence {
  depth: number;
  domOrdinal: number | null;
  element: PageStateFrameElementEvidence | null;
  elementAcquisition: "available" | "not_applicable" | "unavailable";
}

export interface PageStateEvidence {
  frames: PageStateFrameEvidence[];
}

async function collectFrameElement(
  handle: ElementHandle,
  domOrdinal: number,
): Promise<PageStateFrameEvidence> {
  try {
    const element = await handle.evaluate((node) => {
      const html = node as HTMLElement;
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);

      type Rect = {
        left: number;
        top: number;
        right: number;
        bottom: number;
      };

      const intersect = (left: Rect, right: Rect): Rect => ({
        left: Math.max(left.left, right.left),
        top: Math.max(left.top, right.top),
        right: Math.min(left.right, right.right),
        bottom: Math.min(left.bottom, right.bottom),
      });

      const areaOf = (value: Rect): number =>
        Math.max(0, value.right - value.left) *
        Math.max(0, value.bottom - value.top);

      const ownRect: Rect = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };

      const viewportRect: Rect = {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
      };

      const viewportIntersection = intersect(ownRect, viewportRect);
      const viewportIntersectionRatio =
        area === 0 ? 0 : areaOf(viewportIntersection) / area;

      let ancestorClipped = ownRect;
      let ancestor = html.parentElement;
      let effectiveOpacity = Number.parseFloat(style.opacity || "1");
      let ancestorsCssVisible = true;

      while (ancestor !== null) {
        const ancestorStyle = getComputedStyle(ancestor);
        const ancestorOpacity = Number.parseFloat(ancestorStyle.opacity || "1");

        effectiveOpacity *= Number.isFinite(ancestorOpacity)
          ? ancestorOpacity
          : 1;

        ancestorsCssVisible =
          ancestorsCssVisible &&
          ancestorStyle.display !== "none" &&
          ancestorStyle.visibility !== "hidden" &&
          ancestorStyle.visibility !== "collapse";

        const clips =
          ["hidden", "clip", "scroll", "auto"].includes(
            ancestorStyle.overflow,
          ) ||
          ["hidden", "clip", "scroll", "auto"].includes(
            ancestorStyle.overflowX,
          ) ||
          ["hidden", "clip", "scroll", "auto"].includes(
            ancestorStyle.overflowY,
          );

        if (clips) {
          const ancestorRect = ancestor.getBoundingClientRect();
          ancestorClipped = intersect(ancestorClipped, {
            left: ancestorRect.left,
            top: ancestorRect.top,
            right: ancestorRect.right,
            bottom: ancestorRect.bottom,
          });
        }

        ancestor = ancestor.parentElement;
      }

      const ancestorClipRatio = area === 0 ? 0 : areaOf(ancestorClipped) / area;

      const effective = intersect(
        intersect(ownRect, viewportRect),
        ancestorClipped,
      );

      const effectiveWidth = Math.max(0, effective.right - effective.left);
      const effectiveHeight = Math.max(0, effective.bottom - effective.top);

      let topmostSampleRatio: number | null = null;

      if (effectiveWidth > 0 && effectiveHeight > 0) {
        const points = [
          [0.5, 0.5],
          [0.2, 0.2],
          [0.8, 0.2],
          [0.2, 0.8],
          [0.8, 0.8],
        ] as const;

        let topmost = 0;

        for (const [xRatio, yRatio] of points) {
          const x = effective.left + effectiveWidth * xRatio;
          const y = effective.top + effectiveHeight * yRatio;
          const atPoint = document.elementFromPoint(x, y);

          if (
            atPoint === html ||
            (atPoint !== null && html.contains(atPoint))
          ) {
            topmost += 1;
          }
        }

        topmostSampleRatio = topmost / points.length;
      }

      const opacity = Number.parseFloat(style.opacity || "1");

      return {
        cssVisible:
          html.isConnected &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.visibility !== "collapse" &&
          Number.isFinite(opacity) &&
          opacity > 0 &&
          effectiveOpacity > 0 &&
          ancestorsCssVisible &&
          rect.width > 0 &&
          rect.height > 0,
        area,
        viewportIntersectionRatio,
        ancestorClipRatio,
        topmostSampleRatio,
      };
    });

    return {
      depth: 1,
      domOrdinal,
      element,
      elementAcquisition: "available",
    };
  } catch {
    return {
      depth: 1,
      domOrdinal,
      element: null,
      elementAcquisition: "unavailable",
    };
  }
}

export async function collectPageStateFrameEvidence(
  page: Page,
  expectedIframeCount: number,
): Promise<PageStateEvidence> {
  const deadline = performance.now() + 500;
  let frames: PageStateFrameEvidence[] = [];

  await page.evaluate("globalThis.__name ??= value => value");

  do {
    const handles = await page.locator("iframe").elementHandles();

    frames = await Promise.all(
      handles.map((handle, ordinal) => collectFrameElement(handle, ordinal)),
    );

    if (
      handles.length >= expectedIframeCount &&
      frames.every((frame) => frame.elementAcquisition === "available")
    ) {
      return { frames };
    }

    await page.waitForTimeout(20);
  } while (performance.now() < deadline);

  return { frames };
}
