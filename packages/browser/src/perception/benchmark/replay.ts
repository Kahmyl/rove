import type {
  PageStateAssessment,
  PageStateKind,
  PageStateRecommendedAction,
} from "@rove/protocol";

import {
  PAGE_STATE_CONFIDENCES,
  PAGE_STATE_KINDS,
  PAGE_STATE_RECOMMENDED_ACTIONS,
  PROPOSITION_NAMES,
  type BenchmarkCriticality,
  type BenchmarkPayloadMeasurement,
  type BenchmarkTiming,
  type CorpusTier,
  type PropositionSet,
} from "./types.js";

export interface PerceptionReplayV1 {
  schemaVersion: "f1-perception-replay/v1";
  source: {
    tier: CorpusTier;
    kind: "synthetic" | "provider" | "recorded";
  };
  caseId: string;
  capturedAt: string;
  description: string;
  criticality: BenchmarkCriticality;
  tags: string[];
  expected: {
    propositions: PropositionSet;
    primaryState: PageStateKind;
    disposition: PageStateRecommendedAction;
  };
  evidence: Record<string, unknown>;
  assessment?: PageStateAssessment;
  timing?: BenchmarkTiming;
  payload?: BenchmarkPayloadMeasurement;
}

const FORBIDDEN_EXTERNAL_KEYS = new Set([
  "authorization",
  "bearertoken",
  "bodytext",
  "cookie",
  "cookies",
  "headers",
  "htmlcontent",
  "htmlsnippet",
  "indexeddb",
  "inputvalue",
  "localstorage",
  "onetimecode",
  "otp",
  "password",
  "rawhtml",
  "requestbody",
  "requestheaders",
  "responsebody",
  "responseheaders",
  "sessionstorage",
  "text",
  "textcontent",
  "textexcerpt",
  "textvalue",
  "token",
]);

const FORBIDDEN_EXTERNAL_PREFIXES = [
  "authorization",
  "bearertoken",
  "bodytext",
  "cookie",
  "htmlcontent",
  "htmlsnippet",
  "indexeddb",
  "inputvalue",
  "localstorage",
  "onetimecode",
  "otp",
  "password",
  "rawhtml",
  "requestbody",
  "requestheaders",
  "responsebody",
  "responseheaders",
  "sessionstorage",
  "textcontent",
  "textexcerpt",
  "textvalue",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isForbiddenExternalKey(value: string): boolean {
  const normalized = normalizedKey(value);

  if (normalized.startsWith("sanitized")) return false;

  return (
    FORBIDDEN_EXTERNAL_KEYS.has(normalized) ||
    FORBIDDEN_EXTERNAL_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix),
    ) ||
    normalized.endsWith("token")
  );
}

function isPageStateKind(value: unknown): value is PageStateKind {
  return (
    typeof value === "string" &&
    PAGE_STATE_KINDS.some((state) => state === value)
  );
}

function isRecommendedAction(
  value: unknown,
): value is PageStateRecommendedAction {
  return (
    typeof value === "string" &&
    PAGE_STATE_RECOMMENDED_ACTIONS.some((action) => action === value)
  );
}

function expectedDisposition(state: PageStateKind): PageStateRecommendedAction {
  switch (state) {
    case "ready":
      return "continue";
    case "loading":
      return "wait_and_inspect";
    case "error":
      return "stop";
    case "authentication_required":
    case "human_verification":
    case "access_restricted":
    case "unknown_interstitial":
      return "request_human";
  }
}

function assertOptionalMeasurements(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): void {
  if (value === undefined) return;

  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  for (const [key, measurement] of Object.entries(value)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${label} contains unknown field ${key}.`);
    }

    if (
      typeof measurement !== "number" ||
      !Number.isFinite(measurement) ||
      measurement < 0
    ) {
      throw new Error(`${label}.${key} must be a non-negative finite number.`);
    }
  }
}

function assertAssessment(value: unknown): void {
  if (value === undefined) return;

  if (
    !isRecord(value) ||
    !isPageStateKind(value.kind) ||
    !PAGE_STATE_CONFIDENCES.some(
      (confidence) => confidence === value.confidence,
    ) ||
    !Array.isArray(value.signals) ||
    value.signals.some((signal) => typeof signal !== "string") ||
    !isRecommendedAction(value.recommendedAction)
  ) {
    throw new Error("Perception replay assessment is invalid.");
  }
}

function assertPropositions(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error("Perception replay propositions are invalid.");
  }

  const keys = Object.keys(value).sort();
  const expectedKeys = [...PROPOSITION_NAMES].sort();

  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(
      "Perception replay propositions do not match the v1 schema.",
    );
  }

  for (const proposition of PROPOSITION_NAMES) {
    const truth = value[proposition];
    if (truth !== true && truth !== false && truth !== "indeterminate") {
      throw new Error(
        `Perception replay proposition ${proposition} is invalid.`,
      );
    }
  }
}

function expectedSourceKind(
  tier: CorpusTier,
): PerceptionReplayV1["source"]["kind"] {
  switch (tier) {
    case "A":
      return "synthetic";
    case "B":
      return "provider";
    case "C":
    case "D":
      return "recorded";
  }
}

export function assertReplayShape(
  value: unknown,
): asserts value is PerceptionReplayV1 {
  if (!isRecord(value)) {
    throw new Error("Perception replay must be an object.");
  }

  if (value.schemaVersion !== "f1-perception-replay/v1") {
    throw new Error("Unsupported perception replay schema.");
  }

  if (!isRecord(value.source)) {
    throw new Error("Perception replay source is invalid.");
  }

  const tier = value.source.tier;
  if (tier !== "A" && tier !== "B" && tier !== "C" && tier !== "D") {
    throw new Error("Perception replay source tier is invalid.");
  }

  const kind = value.source.kind;
  if (kind !== expectedSourceKind(tier)) {
    throw new Error(
      `Perception replay source ${tier}/${String(kind)} is invalid.`,
    );
  }

  if (
    typeof value.caseId !== "string" ||
    value.caseId.trim().length === 0 ||
    typeof value.description !== "string" ||
    value.description.trim().length === 0 ||
    typeof value.capturedAt !== "string" ||
    Number.isNaN(Date.parse(value.capturedAt))
  ) {
    throw new Error("Perception replay identity metadata is invalid.");
  }

  if (value.criticality !== "critical" && value.criticality !== "standard") {
    throw new Error("Perception replay criticality is invalid.");
  }

  if (
    !Array.isArray(value.tags) ||
    value.tags.some((tag) => typeof tag !== "string")
  ) {
    throw new Error("Perception replay tags are invalid.");
  }

  if (!isRecord(value.expected)) {
    throw new Error("Perception replay expected result is invalid.");
  }

  assertPropositions(value.expected.propositions);

  if (!isPageStateKind(value.expected.primaryState)) {
    throw new Error("Perception replay expected primary state is invalid.");
  }

  if (
    !isRecommendedAction(value.expected.disposition) ||
    value.expected.disposition !==
      expectedDisposition(value.expected.primaryState)
  ) {
    throw new Error("Perception replay expected disposition is invalid.");
  }

  if (!isRecord(value.evidence)) {
    throw new Error("Perception replay evidence must be an object.");
  }

  assertAssessment(value.assessment);
  assertOptionalMeasurements(
    value.timing,
    ["acquisitionMs", "inferenceMs", "totalMs"],
    "Perception replay timing",
  );
  assertOptionalMeasurements(
    value.payload,
    ["evidenceBytes", "persistedArtifactBytes"],
    "Perception replay payload",
  );
}

function validateExternalUrl(value: string, path: string): void {
  if (value === "about:blank") return;

  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `External perception replay URL uses unsupported protocol: ${path}.`,
    );
  }

  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      `External perception replay URL is not sanitized: ${path}.`,
    );
  }
}

function validateExternalUrlField(value: unknown, path: string): void {
  if (typeof value === "string") {
    validateExternalUrl(value, path);
    return;
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    value.forEach((item, index) =>
      validateExternalUrl(item, `${path}[${index}]`),
    );
    return;
  }

  throw new Error(`External perception replay URL field is invalid: ${path}.`);
}

function walkExternalPersistence(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      walkExternalPersistence(item, `${path}[${index}]`),
    );
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    const childPath = path.length === 0 ? key : `${path}.${key}`;

    if (isForbiddenExternalKey(key)) {
      throw new Error(
        `External perception replay cannot persist ${childPath}.`,
      );
    }

    if (normalized.endsWith("url") || normalized.endsWith("urls")) {
      validateExternalUrlField(child, childPath);
    }

    walkExternalPersistence(child, childPath);
  }
}

export function sanitizeExternalUrl(
  input: string,
  sanitizedPath = "/",
): string {
  const url = new URL(input);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      "Only HTTP(S) URLs can be sanitized for external perception replay.",
    );
  }

  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.pathname = sanitizedPath.startsWith("/")
    ? sanitizedPath
    : `/${sanitizedPath}`;

  return url.toString();
}

export function assertReplayPersistable(
  value: unknown,
): asserts value is PerceptionReplayV1 {
  assertReplayShape(value);

  if (value.source.tier === "A") return;

  // Walk the complete envelope so future fields cannot bypass the
  // persistence boundary simply by living outside `evidence`.
  walkExternalPersistence(value, "replay");
}

export function parsePerceptionReplay(serialized: string): PerceptionReplayV1 {
  const value: unknown = JSON.parse(serialized);
  assertReplayPersistable(value);
  return value;
}
