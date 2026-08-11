import { RoveError, type PageInspection, type PageStateAssessment, type RoveErrorCode } from "@rove/protocol";

interface ActionRecord {
  at: number;
  signature: string;
}

interface SessionPolicyState {
  pageState?: PageStateAssessment;
  actions: ActionRecord[];
}

const ACTION_WINDOW_MS = 60_000;
const REPEAT_WINDOW_MS = 30_000;
const MAX_ACTIONS_PER_WINDOW = 30;
const MAX_REPEATED_ACTIONS = 4;

const BLOCKED_PAGE_STATES: Partial<Record<PageStateAssessment["kind"], {
  code: RoveErrorCode;
  message: string;
  retryable: boolean;
}>> = {
  loading: {
    code: "PAGE_NOT_READY",
    message: "The page is still loading. Wait, then inspect it again before mutating it.",
    retryable: true,
  },
  authentication_required: {
    code: "AUTHENTICATION_REQUIRED",
    message: "The page requires human authentication. Request human control and stop browser mutations.",
    retryable: false,
  },
  human_verification: {
    code: "HUMAN_VERIFICATION_REQUIRED",
    message: "The page requires human verification. Request human control; do not attempt to solve it automatically.",
    retryable: false,
  },
  access_restricted: {
    code: "SITE_ACCESS_RESTRICTED",
    message: "The site has restricted access. Stop browser mutations and request human review.",
    retryable: false,
  },
  unknown_interstitial: {
    code: "UNKNOWN_INTERSTITIAL",
    message: "The page is an unrecognized interstitial. Request human review instead of guessing its controls.",
    retryable: false,
  },
  error: {
    code: "PAGE_NOT_READY",
    message: "The page is in an error state and cannot be mutated safely.",
    retryable: false,
  },
};

export function pageStateFromInspection(inspection: PageInspection): PageStateAssessment {
  const value = inspection.metadata?.pageState;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (
      typeof record.kind === "string" &&
      typeof record.confidence === "string" &&
      Array.isArray(record.signals) &&
      typeof record.recommendedAction === "string"
    ) {
      return value as PageStateAssessment;
    }
  }

  // Non-Playwright and older browser adapters remain compatible, but every
  // real Playwright inspection supplies the full deterministic assessment.
  return {
    kind: "ready",
    confidence: "low",
    signals: ["adapter:page_state_unavailable"],
    recommendedAction: "continue",
  };
}

export class InteractionPolicy {
  private readonly sessions = new Map<string, SessionPolicyState>();

  recordInspection(sessionId: string, inspection: PageInspection): PageStateAssessment {
    const state = this.state(sessionId);
    state.pageState = pageStateFromInspection(inspection);
    return state.pageState;
  }

  requireInspection(sessionId: string): void {
    delete this.state(sessionId).pageState;
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  authorizeMutation(sessionId: string, signature: string, now = Date.now()): void {
    const state = this.state(sessionId);
    if (state.pageState === undefined) {
      throw new RoveError({
        code: "INSPECTION_REQUIRED",
        message: "Inspect the active page before requesting another browser mutation.",
        retryable: true,
      });
    }

    const blocked = BLOCKED_PAGE_STATES[state.pageState.kind];
    if (blocked !== undefined) {
      throw new RoveError({
        code: blocked.code,
        message: blocked.message,
        retryable: blocked.retryable,
        details: { pageState: state.pageState },
      });
    }

    state.actions = state.actions.filter((item) => now - item.at < ACTION_WINDOW_MS);
    if (state.actions.length >= MAX_ACTIONS_PER_WINDOW) {
      throw new RoveError({
        code: "ACTION_BUDGET_EXCEEDED",
        message: "The session action budget is exhausted. Pause before continuing.",
        retryable: true,
        details: { windowMs: ACTION_WINDOW_MS, limit: MAX_ACTIONS_PER_WINDOW },
      });
    }

    const repeated = state.actions.filter(
      (item) => item.signature === signature && now - item.at < REPEAT_WINDOW_MS,
    );
    if (repeated.length >= MAX_REPEATED_ACTIONS) {
      throw new RoveError({
        code: "REPEATED_ACTION_BLOCKED",
        message: "The same browser action was requested repeatedly. Inspect the page and reconsider the workflow.",
        retryable: false,
        details: { windowMs: REPEAT_WINDOW_MS, limit: MAX_REPEATED_ACTIONS },
      });
    }

    state.actions.push({ at: now, signature });
  }

  private state(sessionId: string): SessionPolicyState {
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) return existing;
    const created: SessionPolicyState = { actions: [] };
    this.sessions.set(sessionId, created);
    return created;
  }
}
