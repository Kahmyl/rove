import { createHash } from "node:crypto";

import type { Page } from "playwright";

const MUTATION_STATE_KEY = "__roveF1ResearchMutationState";

export interface StructuralSignature {
  readyState: string;
  titleHash: string;
  textHash: string;
  elementCount: number;
  interactiveCandidateCount: number;
  iframeCount: number;
  ariaBusyCount: number;
}

export interface MutationState {
  count: number;
  lastMutationAtMs: number;
  nowMs: number;
}

export type StabilizationPolicy =
  | {
      id: string;
      kind: "load-only";
    }
  | {
      id: string;
      kind: "fixed";
      afterMs: number;
    }
  | {
      id: string;
      kind: "quiet-window";
      minimumObservationMs: number;
      quietWindowMs: number;
      maxObservationMs: number;
      pollMs: number;
    };

export interface StabilizationObservation {
  policyId: string;
  elapsedMs: number;
  mutationCount: number;
  quietForMs: number;
  timedOut: boolean;
  signature: StructuralSignature;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function installResearchMutationObserver(
  page: Page,
): Promise<void> {
  await page.addInitScript(`
    (() => {
      const key = ${JSON.stringify(MUTATION_STATE_KEY)};
      const root = globalThis;
      const state = {
        count: 0,
        lastMutationAtMs: performance.now()
      };

      root[key] = state;

      const observer = new MutationObserver((records) => {
        if (records.length === 0) return;
        state.count += records.length;
        state.lastMutationAtMs = performance.now();
      });

      observer.observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      });
    })();
  `);
}

export async function readMutationState(page: Page): Promise<MutationState> {
  return page.evaluate((key) => {
    const root = globalThis as unknown as Record<
      string,
      { count?: number; lastMutationAtMs?: number } | undefined
    >;
    const state = root[key];

    return {
      count: Number(state?.count ?? 0),
      lastMutationAtMs: Number(state?.lastMutationAtMs ?? 0),
      nowMs: performance.now(),
    };
  }, MUTATION_STATE_KEY);
}

async function waitUntilPageTime(page: Page, targetMs: number): Promise<void> {
  while (true) {
    const nowMs = await page.evaluate(() => performance.now());
    if (nowMs >= targetMs) return;
    await page.waitForTimeout(Math.min(10, Math.max(1, targetMs - nowMs)));
  }
}

export async function captureStructuralSignature(
  page: Page,
): Promise<StructuralSignature> {
  const value = await page.evaluate(() => {
    const interactiveSelector =
      'a[href],button,input:not([type="hidden"]),textarea,select,[role],[contenteditable="true"],[tabindex]';

    return {
      readyState: document.readyState,
      title: document.title,
      text: document.body?.innerText ?? "",
      elementCount: document.querySelectorAll("*").length,
      interactiveCandidateCount:
        document.querySelectorAll(interactiveSelector).length,
      iframeCount: document.querySelectorAll("iframe").length,
      ariaBusyCount: document.querySelectorAll('[aria-busy="true"]').length,
    };
  });

  return {
    readyState: value.readyState,
    titleHash: hash(value.title),
    textHash: hash(value.text),
    elementCount: value.elementCount,
    interactiveCandidateCount: value.interactiveCandidateCount,
    iframeCount: value.iframeCount,
    ariaBusyCount: value.ariaBusyCount,
  };
}

export function sameStructuralSignature(
  left: StructuralSignature,
  right: StructuralSignature,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function observeWithPolicy(
  page: Page,
  policy: StabilizationPolicy,
): Promise<StabilizationObservation> {
  let timedOut = false;

  if (policy.kind === "load-only") {
    await page.waitForLoadState("load");
  } else if (policy.kind === "fixed") {
    await waitUntilPageTime(page, policy.afterMs);
  } else {
    while (true) {
      const state = await readMutationState(page);
      const quietForMs = state.nowMs - state.lastMutationAtMs;

      if (
        state.nowMs >= policy.minimumObservationMs &&
        quietForMs >= policy.quietWindowMs
      ) {
        break;
      }

      if (state.nowMs >= policy.maxObservationMs) {
        timedOut = true;
        break;
      }

      await page.waitForTimeout(policy.pollMs);
    }
  }

  const state = await readMutationState(page);

  return {
    policyId: policy.id,
    elapsedMs: state.nowMs,
    mutationCount: state.count,
    quietForMs: state.nowMs - state.lastMutationAtMs,
    timedOut,
    signature: await captureStructuralSignature(page),
  };
}

export async function captureReferenceSignature(
  page: Page,
  afterMs: number,
): Promise<StructuralSignature> {
  await waitUntilPageTime(page, afterMs);
  return captureStructuralSignature(page);
}
