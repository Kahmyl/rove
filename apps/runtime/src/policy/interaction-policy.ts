import {
  RoveError,
  type ActionAuthorization,
  type BrowserActionProposal,
  type PageInspection,
  type PagePerceptionAssessment,
  type PagePolicyDecision,
  type PageStateIdentity,
  type PageStatePropositions,
  type PageStateTruth,
} from "@rove/protocol";

import { PageStatePolicy } from "./page-state-policy.js";
import { ActionAuthorizationPolicy } from "./action-authorization-policy.js";

interface ActionRecord {
  at: number;
  signature: string;
}

export interface PageInspectionPolicyRecord {
  pageState: PagePerceptionAssessment;
  propositions?: PageStatePropositions;
  policyDecision: PagePolicyDecision;
}

interface RecordedInspection extends PageInspectionPolicyRecord {
  pageId: string;
  revision: number;
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

export class InteractionPolicy {
  private readonly sessions = new Map<string, SessionPolicyState>();
  private readonly pageStatePolicy = new PageStatePolicy();
  private readonly actionAuthorizationPolicy = new ActionAuthorizationPolicy();

  recordInspection(
    sessionId: string,
    inspection: PageInspection,
  ): PageInspectionPolicyRecord {
    const state = this.state(sessionId);
    const pageState = pageStateFromInspection(inspection);
    const propositions = pageStatePropositionsFromInspection(inspection);
    const fingerprint = fingerprintFromInspection(inspection);
    const policyDecision = this.pageStatePolicy.evaluate(
      pageState,
      propositions,
    );

    state.inspection = {
      pageId: inspection.pageId,
      revision: inspection.revision,
      pageState,
      ...(propositions === undefined ? {} : { propositions }),
      ...(fingerprint === undefined ? {} : { fingerprint }),
      policyDecision,
    };

    return {
      pageState,
      ...(propositions === undefined ? {} : { propositions }),
      policyDecision,
    };
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

    const pagePolicy = inspection.policyDecision;

    if (!pagePolicy.mutationAllowed) {
      throw new RoveError({
        code: pagePolicy.errorCode ?? "PAGE_NOT_READY",
        message: pagePolicy.message,
        retryable: pagePolicy.retryable,
        details: {
          pageState: inspection.pageState,
          ...(inspection.propositions === undefined
            ? {}
            : { propositions: inspection.propositions }),
          pagePolicy,
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

    this.recordAuthorizedAction(state, signature, now);
  }

  authorizeAction(
    sessionId: string,
    signature: string,
    proposal: BrowserActionProposal,
    now = Date.now(),
    currentIdentity?: PageStateIdentity,
  ): ActionAuthorization {
    const state = this.state(sessionId);
    const inspection = state.inspection;

    if (inspection === undefined) {
      throw new RoveError({
        code: "INSPECTION_REQUIRED",
        message:
          "Inspect the active page before requesting another browser action.",
        retryable: true,
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
          "The page-state decision changed after the last inspection. Inspect the active page again before acting.",
        retryable: true,
        details: {
          inspectedPageId: inspection.pageId,
          currentPageId: currentIdentity?.pageId,
        },
      });
    }

    const authorization = this.actionAuthorizationPolicy.evaluate(proposal, {
      pageState: inspection.pageState,
      ...(inspection.propositions === undefined
        ? {}
        : { propositions: inspection.propositions }),
    });

    if (authorization.decision !== "allow") {
      throw this.authorizationError(authorization, inspection);
    }

    this.recordAuthorizedAction(state, signature, now);
    return authorization;
  }

  private recordAuthorizedAction(
    state: SessionPolicyState,
    signature: string,
    now: number,
  ): void {
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

  private authorizationError(
    authorization: ActionAuthorization,
    inspection: RecordedInspection,
  ): RoveError {
    const code = (() => {
      if (authorization.decision === "require_confirmation") {
        return "ACTION_CONFIRMATION_REQUIRED" as const;
      }
      if (authorization.decision === "require_human_control") {
        if (authorization.reason === "human_verification_required") {
          return "HUMAN_VERIFICATION_REQUIRED" as const;
        }
        if (authorization.reason === "authentication_required") {
          return "AUTHENTICATION_REQUIRED" as const;
        }
        return "HUMAN_CONTROL_REQUIRED" as const;
      }
      if (authorization.decision === "wait_and_inspect") {
        return authorization.reason === "page_unstable"
          ? ("PAGE_NOT_READY" as const)
          : ("INSPECTION_REQUIRED" as const);
      }
      return authorization.reason === "site_access_restricted"
        ? ("SITE_ACCESS_RESTRICTED" as const)
        : ("ACTION_NOT_AUTHORIZED" as const);
    })();

    const message = (() => {
      switch (authorization.decision) {
        case "require_confirmation":
          return "This browser action requires explicit user confirmation.";
        case "require_human_control":
          return "This browser action requires human control.";
        case "wait_and_inspect":
          return "Wait for a stable page and inspect again before acting.";
        case "deny":
          return "This browser action is not authorized in the current context.";
        case "allow":
          return "The browser action is allowed.";
      }
    })();

    return new RoveError({
      code,
      message,
      retryable: authorization.decision === "wait_and_inspect",
      details: {
        pageState: inspection.pageState,
        ...(inspection.propositions === undefined
          ? {}
          : { propositions: inspection.propositions }),
        actionAuthorization: authorization,
      },
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
