import {
  RoveError,
  type PageInspection,
  type PagePerceptionAssessment,
  type PageStateIdentity,
  type PageStatePropositions,
  type PageStateTruth,
  type RoveErrorCode,
} from "@rove/protocol";

interface ActionRecord {
  at: number;
  signature: string;
}

interface RecordedInspection {
  pageId: string;
  revision: number;
  pageState: PagePerceptionAssessment;
  propositions?: PageStatePropositions;
  fingerprint?: string;
}

interface SessionPolicyState {
  inspection?: RecordedInspection;
  actions: ActionRecord[];
}

const ACTION_WINDOW_MS = 60_000;
const REPEAT_WINDOW_MS = 30_000;
const MAX_ACTIONS_PER_WINDOW = 30;
const MAX_REPEATED_ACTIONS = 4;

const BLOCKED_PAGE_STATES: Partial<
  Record<
    PagePerceptionAssessment["kind"],
    {
      code: RoveErrorCode;
      message: string;
      retryable: boolean;
    }
  >
> = {
  loading: {
    code: "PAGE_NOT_READY",
    message:
      "The page is still loading. Wait, then inspect it again before mutating it.",
    retryable: true,
  },
  authentication_required: {
    code: "AUTHENTICATION_REQUIRED",
    message:
      "The page requires human authentication. Request human control and stop browser mutations.",
    retryable: false,
  },
  human_verification: {
    code: "HUMAN_VERIFICATION_REQUIRED",
    message:
      "The page requires human verification. Request human control; do not attempt to solve it automatically.",
    retryable: false,
  },
  access_restricted: {
    code: "SITE_ACCESS_RESTRICTED",
    message:
      "The site has restricted access. Stop browser mutations and request human review.",
    retryable: false,
  },
  unknown_interstitial: {
    code: "UNKNOWN_INTERSTITIAL",
    message:
      "The page is an unrecognized interstitial. Request human review instead of guessing its controls.",
    retryable: false,
  },
  error: {
    code: "PAGE_NOT_READY",
    message: "The page is in an error state and cannot be mutated safely.",
    retryable: false,
  },
};

const PROPOSITION_KEYS = [
  "primaryContentAvailable",
  "documentUnstable",
  "authenticationRequired",
  "humanVerificationPresented",
  "accessRestricted",
  "errorPresented",
  "interstitialPresented",
] as const;

function truth(value: unknown): value is PageStateTruth {
  return value === true || value === false || value === "indeterminate";
}

export function pageStateFromInspection(
  inspection: PageInspection,
): PagePerceptionAssessment {
  const value = inspection.metadata?.pageState;

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;

    if (
      typeof record.kind === "string" &&
      typeof record.confidence === "string" &&
      Array.isArray(record.signals)
    ) {
      return value as PagePerceptionAssessment;
    }
  }

  // Older/non-Playwright adapters remain readable. This compatibility
  // fallback is intentionally not mutation-authorizing.
  return {
    kind: "ready",
    confidence: "low",
    signals: ["adapter:page_state_unavailable"],
  };
}

export function pageStatePropositionsFromInspection(
  inspection: PageInspection,
): PageStatePropositions | undefined {
  const value = inspection.metadata?.pageStatePropositions;

  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  if (!PROPOSITION_KEYS.every((key) => truth(record[key]))) {
    return undefined;
  }

  return value as PageStatePropositions;
}

function fingerprintFromInspection(
  inspection: PageInspection,
): string | undefined {
  const value = inspection.metadata?.pageStateFingerprint;

  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
    ? value
    : undefined;
}

function unresolvedOrBlocking(
  propositions: PageStatePropositions | undefined,
): boolean {
  if (propositions === undefined) {
    return true;
  }

  return [
    propositions.documentUnstable,
    propositions.authenticationRequired,
    propositions.humanVerificationPresented,
    propositions.accessRestricted,
    propositions.errorPresented,
    propositions.interstitialPresented,
  ].some((value) => value !== false);
}

export class InteractionPolicy {
  private readonly sessions = new Map<string, SessionPolicyState>();

  recordInspection(
    sessionId: string,
    inspection: PageInspection,
  ): PagePerceptionAssessment {
    const state = this.state(sessionId);
    const pageState = pageStateFromInspection(inspection);

    const propositions = pageStatePropositionsFromInspection(inspection);
    const fingerprint = fingerprintFromInspection(inspection);

    state.inspection = {
      pageId: inspection.pageId,
      revision: inspection.revision,
      pageState,
      ...(propositions === undefined ? {} : { propositions }),
      ...(fingerprint === undefined ? {} : { fingerprint }),
    };

    return pageState;
  }

  requireInspection(sessionId: string): void {
    delete this.state(sessionId).inspection;
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  requireFreshInspectionRevision(
    sessionId: string,
    pageId: string,
    currentRevision: number | undefined,
  ): void {
    const state = this.state(sessionId);
    const inspection = state.inspection;

    if (
      inspection === undefined ||
      currentRevision === undefined ||
      inspection.pageId !== pageId ||
      inspection.revision !== currentRevision
    ) {
      delete state.inspection;

      throw new RoveError({
        code: "INSPECTION_REQUIRED",
        message:
          "The page revision changed after the last inspection. Inspect the active page again before mutating it.",
        retryable: true,
        details: {
          inspectedPageId: inspection?.pageId,
          currentPageId: pageId,
          inspectedRevision: inspection?.revision,
          currentRevision,
        },
      });
    }
  }

  authorizeMutation(
    sessionId: string,
    signature: string,
    now = Date.now(),
    currentIdentity?: PageStateIdentity,
  ): void {
    const state = this.state(sessionId);
    const inspection = state.inspection;

    if (inspection === undefined) {
      throw new RoveError({
        code: "INSPECTION_REQUIRED",
        message:
          "Inspect the active page before requesting another browser mutation.",
        retryable: true,
      });
    }

    const blocked = BLOCKED_PAGE_STATES[inspection.pageState.kind];

    if (blocked !== undefined) {
      throw new RoveError({
        code: blocked.code,
        message: blocked.message,
        retryable: blocked.retryable,
        details: {
          pageState: inspection.pageState,
        },
      });
    }

    if (
      inspection.pageState.kind !== "ready" ||
      inspection.pageState.confidence !== "high"
    ) {
      throw new RoveError({
        code: "PAGE_NOT_READY",
        message:
          "A high-confidence ready inspection is required before mutating the page.",
        retryable: true,
        details: {
          pageState: inspection.pageState,
        },
      });
    }

    if (unresolvedOrBlocking(inspection.propositions)) {
      throw new RoveError({
        code: "PAGE_NOT_READY",
        message:
          "The inspection has unresolved or blocking page-state propositions. Inspect again before mutating.",
        retryable: true,
        details: {
          pageState: inspection.pageState,
          propositions: inspection.propositions,
        },
      });
    }

    if (
      inspection.fingerprint === undefined ||
      currentIdentity === undefined ||
      currentIdentity.pageId !== inspection.pageId ||
      currentIdentity.fingerprint !== inspection.fingerprint
    ) {
      delete state.inspection;

      throw new RoveError({
        code: "INSPECTION_REQUIRED",
        message:
          "The page-state decision changed after the last inspection. Inspect the active page again before mutating it.",
        retryable: true,
        details: {
          inspectedPageId: inspection.pageId,
          currentPageId: currentIdentity?.pageId,
        },
      });
    }

    state.actions = state.actions.filter(
      (item) => now - item.at < ACTION_WINDOW_MS,
    );

    if (state.actions.length >= MAX_ACTIONS_PER_WINDOW) {
      throw new RoveError({
        code: "ACTION_BUDGET_EXCEEDED",
        message:
          "The session action budget is exhausted. Pause before continuing.",
        retryable: true,
        details: {
          windowMs: ACTION_WINDOW_MS,
          limit: MAX_ACTIONS_PER_WINDOW,
        },
      });
    }

    const repeated = state.actions.filter(
      (item) =>
        item.signature === signature && now - item.at < REPEAT_WINDOW_MS,
    );

    if (repeated.length >= MAX_REPEATED_ACTIONS) {
      throw new RoveError({
        code: "REPEATED_ACTION_BLOCKED",
        message:
          "The same browser action was requested repeatedly. Inspect the page and reconsider the workflow.",
        retryable: false,
        details: {
          windowMs: REPEAT_WINDOW_MS,
          limit: MAX_REPEATED_ACTIONS,
        },
      });
    }

    state.actions.push({
      at: now,
      signature,
    });
  }

  private state(sessionId: string): SessionPolicyState {
    const existing = this.sessions.get(sessionId);

    if (existing !== undefined) {
      return existing;
    }

    const created: SessionPolicyState = {
      actions: [],
    };

    this.sessions.set(sessionId, created);

    return created;
  }
}
