import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { BrowserContext, Page } from "playwright";
import type { PageStateAssessment, PageStateKind } from "@rove/protocol";

import type { PageSignals } from "../../safety/page-state-classifier.js";
import {
  collectResearchEvidence,
  PageObservationRecorder,
  type ResearchEvidence,
} from "./evidence.js";
import {
  installResearchMutationObserver,
  observeWithPolicy,
  type StabilizationObservation,
} from "./stabilization.js";
import { gate5Strategies, type Gate5Input } from "./gate5-strategies.js";
import { gate6Document, type Gate6HeldoutDefinition } from "./gate6-heldout.js";
import type { Gate6DomSemantics } from "./gate6-candidate.js";

export const GATE6_WHOLE_DOCUMENT_POLICY = {
  id: "gate5-floor-300-dom-quiet-75",
  kind: "quiet-window" as const,
  minimumObservationMs: 300,
  quietWindowMs: 75,
  maxObservationMs: 1000,
  pollMs: 10,
};

export const GATE6_RELEVANT_POLICY = {
  quietWindowMs: 75,
  maxObservationMs: 1000,
  pollMs: 10,
};

export interface AccessibleSemanticAudit {
  available: boolean;
  chars: number;
  lines: number;
  hash: string | null;
  dialogCount: number;
  iframeCount: number;
  verificationCue: boolean;
  authenticationCue: boolean;
  restrictionCue: boolean;
  errorCue: boolean;
  interstitialCue: boolean;
}

export interface HeldoutAcquisition {
  definition: Gate6HeldoutDefinition;
  input: Gate5Input;
  accessibilityAudit: AccessibleSemanticAudit;
  acquisition: {
    totalMs: number;
    evidenceBytes: number;
  };
}

export interface RelevantDecisionSignature {
  readyState: string;
  ariaBusyCount: number;
  dialogCount: number;
  iframeCount: number;
  credentialInputCount: number;
  verificationCue: boolean;
  authenticationCue: boolean;
  restrictionCue: boolean;
  errorCue: boolean;
}

export interface RelevantStabilizationObservation {
  elapsedMs: number;
  timedOut: boolean;
  quietForMs: number;
  sampleCount: number;
  signature: RelevantDecisionSignature;
}

export interface TemporalChallengeDefinition {
  id: string;
  delayMs: number;
  finalState: PageStateKind;
  finalBody: string;
  continuousNoise: boolean;
}

export interface TemporalChallengeResult {
  id: string;
  delayMs: number;
  finalState: PageStateKind;
  continuousNoise: boolean;
  wholeDocument: {
    observation: StabilizationObservation;
    expectedAtObservation: PageStateKind;
    acquisitionStatus: "available" | "unstable_during_acquisition";
    actualAtObservation: PageStateAssessment | null;
  };
  relevantEvidence: {
    observation: RelevantStabilizationObservation;
    expectedAtObservation: PageStateKind;
    acquisitionStatus: "decision_relevant_signals";
    actualAtObservation: PageStateAssessment;
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function countRole(snapshot: string, role: string): number {
  const expression = new RegExp(`^\\s*-\\s+${role}(?:\\s|:|$)`, "gim");
  return snapshot.match(expression)?.length ?? 0;
}

export async function collectAccessibleSemanticAudit(
  page: Page,
): Promise<AccessibleSemanticAudit> {
  let snapshot: string;

  try {
    snapshot = await page.locator("body").ariaSnapshot();
  } catch {
    return {
      available: false,
      chars: 0,
      lines: 0,
      hash: null,
      dialogCount: 0,
      iframeCount: 0,
      verificationCue: false,
      authenticationCue: false,
      restrictionCue: false,
      errorCue: false,
      interstitialCue: false,
    };
  }

  const lowered = snapshot.toLowerCase();
  const verificationCue =
    /\bhuman (?:check|verification)\b/.test(lowered) ||
    /\bverification (?:challenge|step)\b/.test(lowered) ||
    /\bsecurity (?:check|challenge)\b/.test(lowered) ||
    /\bverify you are human\b/.test(lowered);
  const authenticationCue =
    /\b(?:sign|log) in\b/.test(lowered) ||
    /\bchoose (?:an )?account\b/.test(lowered) ||
    /\bcontinue with an account\b/.test(lowered) ||
    /\baccess your workspace\b/.test(lowered);
  const restrictionCue =
    /\b(?:limited|restricted|denied|blocked) (?:your )?access\b/.test(
      lowered,
    ) ||
    /\btemporarily limited\b/.test(lowered) ||
    /\bcannot continue right now\b/.test(lowered);
  const errorCue =
    /\bsomething went wrong\b/.test(lowered) ||
    /\bcould not load\b/.test(lowered) ||
    /\bservice unavailable\b/.test(lowered);
  const interstitialCue =
    countRole(snapshot, "dialog") > 0 ||
    /\bintermediate step\b/.test(lowered) ||
    /\bcontinue to destination\b/.test(lowered);

  return {
    available: true,
    chars: snapshot.length,
    lines: snapshot.length === 0 ? 0 : snapshot.split("\n").length,
    hash: sha256(snapshot),
    dialogCount: countRole(snapshot, "dialog"),
    iframeCount: countRole(snapshot, "iframe"),
    verificationCue,
    authenticationCue,
    restrictionCue,
    errorCue,
    interstitialCue,
  };
}

export async function pageSignals(
  page: Page,
  httpStatus?: number,
): Promise<PageSignals> {
  const snapshot = await page.evaluate(() => ({
    title: document.title,
    text: document.body?.innerText ?? "",
    rawHtml: document.documentElement.outerHTML,
    readyState: document.readyState,
    targetCount: document.querySelectorAll(
      'a[href],button,input:not([type="hidden"]),textarea,select,[role],[contenteditable="true"],[tabindex]',
    ).length,
  }));

  return {
    url: page.url(),
    ...snapshot,
    frameUrls: page.frames().map((frame) => frame.url()),
    ...(httpStatus === undefined ? {} : { httpStatus }),
  };
}

export function s4Strategy() {
  const strategy = gate5Strategies().find(
    (candidate) => candidate.name === "s4-proposition-first-stabilized",
  );

  if (strategy === undefined) {
    throw new Error("Gate 5 S4 strategy is unavailable.");
  }

  return strategy;
}

export async function acquireHeldoutCase(
  context: BrowserContext,
  definition: Gate6HeldoutDefinition,
): Promise<HeldoutAcquisition> {
  const page = await context.newPage();
  const recorder = new PageObservationRecorder(page);

  try {
    await page.setContent(gate6Document(definition.title, definition.body), {
      waitUntil: "load",
    });

    const started = performance.now();
    const evidence = await collectResearchEvidence(page, recorder);
    const signals = await pageSignals(page, definition.httpStatus);
    const audit = await collectAccessibleSemanticAudit(page);
    const totalMs = performance.now() - started;

    return {
      definition,
      input: {
        signals,
        evidence: evidence.evidence,
        acquisitionMs: totalMs,
        evidenceBytes: evidence.payload.totalBytes,
      },
      accessibilityAudit: audit,
      acquisition: {
        totalMs,
        evidenceBytes: evidence.payload.totalBytes,
      },
    };
  } finally {
    await page.close();
  }
}

export async function predictS4(
  input: Gate5Input,
): Promise<PageStateAssessment> {
  const prediction = await s4Strategy().predict(input, {
    id: "gate6-opaque-validation",
    tier: "A",
    description: "held-out validation",
    criticality: "standard",
    tags: [],
  });

  return prediction.assessment;
}

export function withoutEvidence(input: Gate5Input): Gate5Input {
  return {
    signals: {
      ...input.signals,
      ...(input.signals.frameUrls === undefined
        ? {}
        : { frameUrls: [...input.signals.frameUrls] }),
    },
  };
}

export function withUnavailableFrameGeometry(input: Gate5Input): Gate5Input {
  if (input.evidence === undefined) return withoutEvidence(input);

  const evidence = structuredClone(input.evidence) as ResearchEvidence;

  for (const frame of evidence.frames) {
    if (frame.depth === 0) continue;
    frame.elementAcquisition = "unavailable";
    frame.element = null;
  }

  return {
    ...input,
    evidence,
  };
}

export async function captureRelevantDecisionSignature(
  page: Page,
): Promise<RelevantDecisionSignature> {
  return page.evaluate(() => {
    const text = (document.body?.innerText ?? "").toLowerCase();
    const verificationCue =
      /\bhuman (?:check|verification)\b/.test(text) ||
      /\bverification (?:challenge|step)\b/.test(text) ||
      /\bsecurity (?:check|challenge)\b/.test(text) ||
      /\bverify you are human\b/.test(text);
    const authenticationCue =
      /\b(?:sign|log) in\b/.test(text) ||
      /\bchoose (?:an )?account\b/.test(text) ||
      /\bcontinue with an account\b/.test(text) ||
      /\baccess your workspace\b/.test(text);
    const restrictionCue =
      /\btemporarily limited\b/.test(text) ||
      /\baccess (?:is )?(?:restricted|denied|blocked)\b/.test(text);
    const errorCue =
      /\bsomething went wrong\b/.test(text) ||
      /\bcould not load\b/.test(text) ||
      /\bservice unavailable\b/.test(text);

    return {
      readyState: document.readyState,
      ariaBusyCount: document.querySelectorAll('[aria-busy="true"]').length,
      dialogCount: document.querySelectorAll('[role="dialog"],dialog[open]')
        .length,
      iframeCount: document.querySelectorAll("iframe").length,
      credentialInputCount: document.querySelectorAll(
        'input[type="email"],input[type="password"]',
      ).length,
      verificationCue,
      authenticationCue,
      restrictionCue,
      errorCue,
    };
  });
}

function sameRelevantSignature(
  left: RelevantDecisionSignature,
  right: RelevantDecisionSignature,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function observeRelevantDecisionStability(
  page: Page,
): Promise<RelevantStabilizationObservation> {
  const started = performance.now();
  let lastSignature = await captureRelevantDecisionSignature(page);
  let stableSince = performance.now();
  let sampleCount = 1;

  while (true) {
    const now = performance.now();
    const elapsedMs = now - started;
    const quietForMs = now - stableSince;
    const stillUnstable =
      lastSignature.readyState === "loading" || lastSignature.ariaBusyCount > 0;

    if (!stillUnstable && quietForMs >= GATE6_RELEVANT_POLICY.quietWindowMs) {
      return {
        elapsedMs,
        timedOut: false,
        quietForMs,
        sampleCount,
        signature: lastSignature,
      };
    }

    if (elapsedMs >= GATE6_RELEVANT_POLICY.maxObservationMs) {
      return {
        elapsedMs,
        timedOut: true,
        quietForMs,
        sampleCount,
        signature: lastSignature,
      };
    }

    await page.waitForTimeout(GATE6_RELEVANT_POLICY.pollMs);
    const next = await captureRelevantDecisionSignature(page);
    sampleCount += 1;

    if (!sameRelevantSignature(lastSignature, next)) {
      lastSignature = next;
      stableSince = performance.now();
    }
  }
}

function temporalDocument(definition: TemporalChallengeDefinition): string {
  const finalBody = JSON.stringify(definition.finalBody);
  const noiseScript = definition.continuousNoise
    ? `
      const noise = document.querySelector("#noise");
      setInterval(() => {
        noise.textContent = String(performance.now());
      }, 20);
    `
    : "";

  return gate6Document(
    "Temporal held-out",
    `
      <main id="content" aria-busy="true">
        <h1>Loading workspace</h1>
      </main>
      <span id="noise" aria-hidden="true"></span>
      <script>
        ${noiseScript}
        setTimeout(() => {
          const main = document.querySelector("#content");
          main.removeAttribute("aria-busy");
          main.innerHTML = ${finalBody};
        }, ${definition.delayMs});
      </script>`,
  );
}

function expectedTemporalState(
  elapsedMs: number,
  definition: TemporalChallengeDefinition,
): PageStateKind {
  return elapsedMs + 15 >= definition.delayMs
    ? definition.finalState
    : "loading";
}

async function temporalPrediction(
  page: Page,
  recorder: PageObservationRecorder,
): Promise<PageStateAssessment> {
  const acquired = await collectResearchEvidence(page, recorder);

  return predictS4({
    signals: await pageSignals(page),
    evidence: acquired.evidence,
    acquisitionMs: acquired.timing.totalMs,
    evidenceBytes: acquired.payload.totalBytes,
  });
}

async function runWholeDocumentTemporal(
  context: BrowserContext,
  definition: TemporalChallengeDefinition,
): Promise<TemporalChallengeResult["wholeDocument"]> {
  const page = await context.newPage();
  await installResearchMutationObserver(page);
  const recorder = new PageObservationRecorder(page);

  try {
    await page.goto(
      `data:text/html,${encodeURIComponent(temporalDocument(definition))}`,
      { waitUntil: "domcontentloaded" },
    );

    const observation = await observeWithPolicy(
      page,
      GATE6_WHOLE_DOCUMENT_POLICY,
    );

    let actualAtObservation: PageStateAssessment | null = null;
    let acquisitionStatus: "available" | "unstable_during_acquisition" =
      "available";

    try {
      actualAtObservation = await temporalPrediction(page, recorder);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message ===
          "Page structure changed while evidence channels were acquired."
      ) {
        acquisitionStatus = "unstable_during_acquisition";
      } else {
        throw error;
      }
    }

    return {
      observation,
      expectedAtObservation: expectedTemporalState(
        observation.elapsedMs,
        definition,
      ),
      acquisitionStatus,
      actualAtObservation,
    };
  } finally {
    await page.close();
  }
}

async function runRelevantTemporal(
  context: BrowserContext,
  definition: TemporalChallengeDefinition,
): Promise<TemporalChallengeResult["relevantEvidence"]> {
  const page = await context.newPage();

  try {
    await page.goto(
      `data:text/html,${encodeURIComponent(temporalDocument(definition))}`,
      { waitUntil: "domcontentloaded" },
    );

    const observation = await observeRelevantDecisionStability(page);

    let actualAtObservation = await predictS4({
      signals: await pageSignals(page),
    });

    if (
      observation.timedOut &&
      (observation.signature.readyState === "loading" ||
        observation.signature.ariaBusyCount > 0)
    ) {
      actualAtObservation = {
        kind: "loading",
        confidence: "medium",
        signals: ["document:unstable", "stabilization:bounded_timeout"],
        recommendedAction: "wait_and_inspect",
      };
    }

    return {
      observation,
      expectedAtObservation: expectedTemporalState(
        observation.elapsedMs,
        definition,
      ),
      acquisitionStatus: "decision_relevant_signals",
      actualAtObservation,
    };
  } finally {
    await page.close();
  }
}

export const GATE6_TEMPORAL_CHALLENGES: TemporalChallengeDefinition[] = [
  {
    id: "heldout-temporal-ready-50",
    delayMs: 50,
    finalState: "ready",
    finalBody: "<h1>Workspace ready</h1><button>Continue</button>",
    continuousNoise: false,
  },
  {
    id: "heldout-temporal-auth-250",
    delayMs: 250,
    finalState: "authentication_required",
    finalBody:
      '<h1>Sign in to continue</h1><label>Email <input type="email"></label>',
    continuousNoise: false,
  },
  {
    id: "heldout-temporal-auth-800",
    delayMs: 800,
    finalState: "authentication_required",
    finalBody:
      '<h1>Sign in to continue</h1><label>Email <input type="email"></label>',
    continuousNoise: false,
  },
  {
    id: "heldout-temporal-ready-800",
    delayMs: 800,
    finalState: "ready",
    finalBody: "<h1>Workspace ready</h1><button>Continue</button>",
    continuousNoise: false,
  },
  {
    id: "heldout-temporal-ready-noisy-200",
    delayMs: 200,
    finalState: "ready",
    finalBody: "<h1>Workspace ready</h1><button>Continue</button>",
    continuousNoise: true,
  },
  {
    id: "heldout-temporal-auth-noisy-200",
    delayMs: 200,
    finalState: "authentication_required",
    finalBody:
      '<h1>Sign in to continue</h1><label>Email <input type="email"></label>',
    continuousNoise: true,
  },
  {
    id: "heldout-temporal-long-1200",
    delayMs: 1200,
    finalState: "authentication_required",
    finalBody:
      '<h1>Sign in to continue</h1><label>Email <input type="email"></label>',
    continuousNoise: false,
  },
];

export async function runTemporalChallenges(
  context: BrowserContext,
): Promise<TemporalChallengeResult[]> {
  const results: TemporalChallengeResult[] = [];

  for (const definition of GATE6_TEMPORAL_CHALLENGES) {
    results.push({
      id: definition.id,
      delayMs: definition.delayMs,
      finalState: definition.finalState,
      continuousNoise: definition.continuousNoise,
      wholeDocument: await runWholeDocumentTemporal(context, definition),
      relevantEvidence: await runRelevantTemporal(context, definition),
    });
  }

  return results;
}

export async function runStableThenBlockerObservation(
  context: BrowserContext,
): Promise<{
  initial: PageStateAssessment;
  later: PageStateAssessment;
  delayMs: number;
}> {
  const page = await context.newPage();
  const recorder = new PageObservationRecorder(page);
  const delayMs = 450;

  try {
    await page.goto(
      `data:text/html,${encodeURIComponent(
        gate6Document(
          "Public content",
          `
            <main id="content"><h1>Public content</h1><button>Continue</button></main>
            <script>
              setTimeout(() => {
                const overlay = document.createElement("div");
                overlay.style.cssText = "position:fixed;inset:0;background:white;z-index:30";
                overlay.innerHTML =
                  '<h1>Verify you are human to continue.</h1>' +
                  '<iframe title="Human verification" style="width:320px;height:140px" ' +
                  'srcdoc="<html><body><button>Continue</button></body></html>"></iframe>';
                document.body.append(overlay);
              }, ${delayMs});
            </script>`,
        ),
      )}`,
      { waitUntil: "domcontentloaded" },
    );

    const initialAcquired = await collectResearchEvidence(page, recorder);
    const initial = await predictS4({
      signals: await pageSignals(page),
      evidence: initialAcquired.evidence,
      acquisitionMs: initialAcquired.timing.totalMs,
      evidenceBytes: initialAcquired.payload.totalBytes,
    });

    await page.waitForTimeout(delayMs + 100);

    const laterAcquired = await collectResearchEvidence(page, recorder);
    const later = await predictS4({
      signals: await pageSignals(page),
      evidence: laterAcquired.evidence,
      acquisitionMs: laterAcquired.timing.totalMs,
      evidenceBytes: laterAcquired.payload.totalBytes,
    });

    return {
      initial,
      later,
      delayMs,
    };
  } finally {
    await page.close();
  }
}

export async function canvasPixelFeature(page: Page): Promise<{
  available: boolean;
  materiallyPainted: boolean;
  nonTransparentPixelRatio: number | null;
  rawPixelBytesInMemory: number;
}> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");

    if (!(canvas instanceof HTMLCanvasElement)) {
      return {
        available: false,
        materiallyPainted: false,
        nonTransparentPixelRatio: null,
        rawPixelBytesInMemory: 0,
      };
    }

    const context = canvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (context === null || canvas.width === 0 || canvas.height === 0) {
      return {
        available: false,
        materiallyPainted: false,
        nonTransparentPixelRatio: null,
        rawPixelBytesInMemory: 0,
      };
    }

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonTransparent = 0;

    for (let index = 3; index < pixels.length; index += 4) {
      if ((pixels[index] ?? 0) > 0) nonTransparent += 1;
    }

    const ratio = nonTransparent / (pixels.length / 4);

    return {
      available: true,
      materiallyPainted: ratio >= 0.25,
      nonTransparentPixelRatio: ratio,
      rawPixelBytesInMemory: pixels.byteLength,
    };
  });
}

export async function collectGate6DomSemantics(
  page: Page,
): Promise<Gate6DomSemantics> {
  const result = await page.evaluate<Gate6DomSemantics>(`(() => {
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      let current = element;
      while (current instanceof Element) {
        const style = getComputedStyle(current);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          Number.parseFloat(style.opacity || "1") === 0
        ) {
          return false;
        }
        current = current.parentElement;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      return (
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < innerHeight &&
        rect.left < innerWidth
      );
    };

    const normalize = (value) =>
      String(value ?? "").replace(/\\s+/g, " ").trim().toLowerCase();

    const verificationDirective = (value) => {
      const text = normalize(value);
      return (
        /\\b(?:verify|confirm|complete|solve)\\b.{0,90}\\b(?:human|captcha|verification|security check|challenge)\\b/.test(text) ||
        /\\b(?:human check|human verification|verification step|captcha|security check)\\b.{0,90}\\b(?:required|before|continue|proceed|complete|submit)\\b/.test(text)
      );
    };

    const authenticationCue = (value) => {
      const text = normalize(value);
      return (
        /\\b(?:sign|log) in(?: to continue)?\\b/.test(text) ||
        /\\baccess your (?:workspace|account)\\b/.test(text) ||
        /\\bcontinue with an account\\b/.test(text) ||
        /\\bchoose (?:an )?account\\b/.test(text) ||
        /\\bauthentication required\\b/.test(text)
      );
    };

    const restrictionCue = (value) => {
      const text = normalize(value);
      return (
        /\\b(?:access|requests?|connection)\\b.{0,90}\\b(?:restricted|limited|denied|blocked|cannot continue)\\b/.test(text) ||
        /\\b(?:restricted|limited|denied|blocked)\\b.{0,90}\\b(?:access|requests?|connection)\\b/.test(text) ||
        /\\bunusual (?:activity|traffic)\\b/.test(text) ||
        /\\btoo many requests\\b/.test(text)
      );
    };

    const errorCue = (value) => {
      const text = normalize(value);
      return (
        /\\bsomething went wrong\\b/.test(text) ||
        /\\b(?:application|page|service)\\b.{0,80}\\b(?:could not|failed to|unable to)\\b.{0,80}\\b(?:load|start|continue)\\b/.test(text) ||
        /\\bservice unavailable\\b/.test(text) ||
        /\\bunexpected error\\b/.test(text)
      );
    };

    const interstitialCue = (value) => {
      const text = normalize(value);
      return (
        /\\bintervening\\b/.test(text) ||
        /\\binterstitial\\b/.test(text) ||
        /\\bintermediate step\\b/.test(text) ||
        /\\bcontinue in this browser window\\b/.test(text) ||
        /\\breview before (?:continuing|proceeding)\\b/.test(text)
      );
    };

    const visibleElements = (selector) =>
      Array.from(document.querySelectorAll(selector)).filter(visible);

    const headings = visibleElements("h1,h2,h3")
      .map((element) => element.textContent ?? "");

    const alerts = visibleElements('[role="alert"]')
      .map((element) => element.textContent ?? "");

    const authHeading = headings.some(authenticationCue);
    const credentialInputs = visibleElements(
      'input[type="email"],input[type="password"]',
    );
    const passwordInputs = visibleElements('input[type="password"]');

    const visibleButtons = visibleElements(
      'button,[role="button"]',
    );

    const bodyText = document.body?.innerText ?? "";

    const semanticVerificationFrameOrdinals = Array.from(
      document.querySelectorAll("iframe"),
    ).flatMap((frame, ordinal) => {
      const semantic = [
        frame.getAttribute("title"),
        frame.getAttribute("aria-label"),
        frame.getAttribute("name"),
      ]
        .filter(Boolean)
        .join(" ");

      return /\\b(?:human|verification|captcha|security|challenge)\\b/i.test(
        semantic,
      )
        ? [ordinal]
        : [];
    });

    const dialogs = visibleElements(
      '[role="dialog"],dialog[open],[aria-modal="true"]',
    );
    const blockingDialogPresent = dialogs.some((element) => {
      if (
        element.getAttribute("aria-modal") === "true" ||
        element.matches("dialog[open]")
      ) {
        return true;
      }
      const rect = element.getBoundingClientRect();
      return (
        rect.width * rect.height >=
        innerWidth * innerHeight * 0.25
      );
    });

    let interstitialCanvasPresented = false;
    let nonInterstitialCanvasPresented = false;
    let visibleCanvasCount = 0;

    for (const canvas of visibleElements("canvas")) {
      visibleCanvasCount += 1;
      const labelledBy = canvas.getAttribute("aria-labelledby");
      const labelledText =
        labelledBy === null
          ? ""
          : labelledBy
              .split(/\\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? "")
              .join(" ");
      const accessibleLabel = [
        canvas.getAttribute("aria-label"),
        labelledText,
        canvas.getAttribute("title"),
      ]
        .filter(Boolean)
        .join(" ");

      if (interstitialCue(accessibleLabel)) {
        interstitialCanvasPresented = true;
      } else {
        nonInterstitialCanvasPresented = true;
      }
    }

    const interactiveCount = visibleElements(
      'a[href],button,input:not([type="hidden"]),textarea,select,[role],[contenteditable="true"],[tabindex]',
    ).length;

    return {
      available: true,
      visibleChars: bodyText.trim().length,
      interactiveCount,
      ariaBusyCount:
        document.querySelectorAll('[aria-busy="true"]').length,
      verificationHeadingDirective:
        headings.some(verificationDirective),
      authenticationHeadingCue: authHeading,
      restrictionHeadingOrAlertCue:
        [...headings, ...alerts].some(restrictionCue),
      errorHeadingOrAlertCue:
        [...headings, ...alerts].some(errorCue),
      credentialInputCount: credentialInputs.length,
      passwordInputCount: passwordInputs.length,
      accountChooserPresent:
        authHeading && visibleButtons.length >= 2,
      blockingDialogPresent,
      semanticVerificationFrameOrdinals,
      visibleCanvasCount,
      interstitialCanvasPresented,
      nonInterstitialCanvasPresented,
    };
  })()`);

  return result;
}
