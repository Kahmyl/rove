import { describe, expect, it } from "vitest";

import type {
  BrowserActionType,
  PagePerceptionAssessment,
  PageStatePropositions,
} from "@rove/protocol";

import {
  ActionAuthorizationPolicy,
  type BrowserActionEffect,
  type BrowserActionProposal,
} from "./action-authorization-policy.js";
import { PageStatePolicy } from "./page-state-policy.js";

const policy = new ActionAuthorizationPolicy();

const resolved: PageStatePropositions = {
  primaryContentAvailable: true,
  documentUnstable: false,
  authenticationRequired: false,
  humanVerificationPresented: false,
  accessRestricted: false,
  errorPresented: false,
  interstitialPresented: false,
};

function page(
  kind: PagePerceptionAssessment["kind"],
  confidence: PagePerceptionAssessment["confidence"] = "high",
): PagePerceptionAssessment {
  return { kind, confidence, signals: [`experiment:${kind}`] };
}

function proposal(
  effect: BrowserActionEffect,
  overrides: Partial<BrowserActionProposal> = {},
): BrowserActionProposal {
  return {
    action: "click",
    effect,
    explicitlyAuthorized: false,
    freshlyGrounded: true,
    outcomeCanBeVerified: true,
    ...overrides,
  };
}

describe("Experiment A: contextual action authorization", () => {
  it("does not turn an unfamiliar interstitial into a global mutation ban", () => {
    const context = {
      pageState: page("unknown_interstitial", "medium"),
      propositions: { ...resolved, interstitialPresented: true },
    };

    expect(policy.evaluate(proposal("recover"), context)).toMatchObject({
      decision: "allow",
      reason: "fresh_low_impact_action",
    });

    expect(
      policy.evaluate(
        proposal("external_commit", { explicitlyAuthorized: true }),
        context,
      ),
    ).toMatchObject({
      decision: "allow",
      constraints: [
        "verify_outcome_before_next_commit",
        "do_not_retry_on_unknown_outcome",
      ],
    });
  });

  it("allows a grounded recovery from loading, error, and restricted pages", () => {
    for (const kind of ["loading", "error", "access_restricted"] as const) {
      expect(
        policy.evaluate(proposal("recover"), {
          pageState: page(kind),
          propositions: resolved,
        }),
      ).toMatchObject({ decision: "allow" });
    }
  });

  it("does not allow ordinary mutation while the document is unstable", () => {
    expect(
      policy.evaluate(proposal("edit_content", { explicitlyAuthorized: true }), {
        pageState: page("loading", "medium"),
        propositions: { ...resolved, documentUnstable: true },
      }),
    ).toMatchObject({
      decision: "wait_and_inspect",
      reason: "page_unstable",
    });
  });

  it("keeps credentials and human verification behind human control", () => {
    expect(
      policy.evaluate(proposal("credential_entry"), {
        pageState: page("ready"),
        propositions: resolved,
      }),
    ).toMatchObject({ decision: "require_human_control" });

    expect(
      policy.evaluate(proposal("reversible_ui"), {
        pageState: page("human_verification"),
        propositions: { ...resolved, humanVerificationPresented: true },
      }),
    ).toMatchObject({
      decision: "require_human_control",
      reason: "human_verification_required",
    });

    expect(
      policy.evaluate(proposal("recover"), {
        pageState: page("human_verification"),
        propositions: { ...resolved, humanVerificationPresented: true },
      }),
    ).toMatchObject({ decision: "allow" });
  });

  it("allows escape from restricted/error pages but denies task commits there", () => {
    for (const item of [
      {
        kind: "access_restricted" as const,
        propositions: { ...resolved, accessRestricted: true },
        reason: "site_access_restricted",
      },
      {
        kind: "error" as const,
        propositions: { ...resolved, errorPresented: true },
        reason: "page_error",
      },
    ]) {
      const context = {
        pageState: page(item.kind),
        propositions: item.propositions,
      };
      expect(policy.evaluate(proposal("recover"), context)).toMatchObject({
        decision: "allow",
      });
      expect(
        policy.evaluate(
          proposal("external_commit", { explicitlyAuthorized: true }),
          context,
        ),
      ).toMatchObject({ decision: "deny", reason: item.reason });
    }
  });

  it("requires explicit authority for consequential task actions", () => {
    expect(
      policy.evaluate(proposal("external_commit"), {
        pageState: page("ready"),
        propositions: resolved,
      }),
    ).toMatchObject({
      decision: "require_confirmation",
      reason: "explicit_authority_required",
    });

    expect(
      policy.evaluate(
        proposal("external_commit", { explicitlyAuthorized: true }),
        { pageState: page("ready"), propositions: resolved },
      ),
    ).toMatchObject({ decision: "allow" });
  });

  it("requires confirmation even when an irreversible action was requested", () => {
    expect(
      policy.evaluate(
        proposal("irreversible", { explicitlyAuthorized: true }),
        { pageState: page("ready"), propositions: resolved },
      ),
    ).toMatchObject({
      decision: "require_confirmation",
      reason: "irreversible_action_requires_confirmation",
    });
  });

  it("requires fresh grounding independently of semantic confidence", () => {
    expect(
      policy.evaluate(proposal("recover", { freshlyGrounded: false }), {
        pageState: page("ready"),
        propositions: resolved,
      }),
    ).toMatchObject({
      decision: "wait_and_inspect",
      reason: "fresh_grounding_required",
    });
  });

  it("blocks commits that cannot be reconciled", () => {
    expect(
      policy.evaluate(
        proposal("external_commit", {
          explicitlyAuthorized: true,
          outcomeCanBeVerified: false,
        }),
        { pageState: page("ready"), propositions: resolved },
      ),
    ).toMatchObject({
      decision: "deny",
      reason: "outcome_verification_required",
    });
  });
});

interface ExperimentCase {
  name: string;
  pageState: PagePerceptionAssessment;
  propositions: PageStatePropositions;
  action: BrowserActionType;
  effect: BrowserActionEffect;
  explicit: boolean;
  safelyProgresses: boolean;
}

const comparisonCorpus: ExperimentCase[] = [
  {
    name: "ready requested submit",
    pageState: page("ready"),
    propositions: resolved,
    action: "click",
    effect: "external_commit",
    explicit: true,
    safelyProgresses: true,
  },
  {
    name: "unfamiliar notification dismiss",
    pageState: page("unknown_interstitial", "medium"),
    propositions: { ...resolved, interstitialPresented: true },
    action: "click",
    effect: "recover",
    explicit: true,
    safelyProgresses: true,
  },
  {
    name: "unfamiliar overlay requested submit",
    pageState: page("unknown_interstitial", "medium"),
    propositions: { ...resolved, interstitialPresented: true },
    action: "click",
    effect: "external_commit",
    explicit: true,
    safelyProgresses: true,
  },
  {
    name: "loading back",
    pageState: page("loading", "medium"),
    propositions: { ...resolved, documentUnstable: true },
    action: "back",
    effect: "recover",
    explicit: true,
    safelyProgresses: true,
  },
  {
    name: "loading submit",
    pageState: page("loading", "medium"),
    propositions: { ...resolved, documentUnstable: true },
    action: "click",
    effect: "external_commit",
    explicit: true,
    safelyProgresses: false,
  },
  {
    name: "human verification click",
    pageState: page("human_verification"),
    propositions: { ...resolved, humanVerificationPresented: true },
    action: "click",
    effect: "reversible_ui",
    explicit: true,
    safelyProgresses: false,
  },
  {
    name: "authentication password",
    pageState: page("authentication_required"),
    propositions: { ...resolved, authenticationRequired: true },
    action: "fill",
    effect: "credential_entry",
    explicit: true,
    safelyProgresses: false,
  },
  {
    name: "medium confidence grounded fill",
    pageState: page("ready", "medium"),
    propositions: resolved,
    action: "fill",
    effect: "edit_content",
    explicit: true,
    safelyProgresses: true,
  },
  {
    name: "unrequested email send",
    pageState: page("ready"),
    propositions: resolved,
    action: "click",
    effect: "external_commit",
    explicit: false,
    safelyProgresses: false,
  },
  {
    name: "destructive delete",
    pageState: page("ready"),
    propositions: resolved,
    action: "click",
    effect: "irreversible",
    explicit: true,
    safelyProgresses: false,
  },
];

describe("Experiment A: baseline comparison corpus", () => {
  it("removes false stops without admitting unsafe cases", () => {
    const legacy = new PageStatePolicy();
    let legacySafeProgress = 0;
    let candidateSafeProgress = 0;
    let candidateUnsafeAllows = 0;

    for (const item of comparisonCorpus) {
      const expectedProgress = item.safelyProgresses;
      const legacyAllows = legacy.evaluate(
        item.pageState,
        item.propositions,
      ).mutationAllowed;
      const candidate = policy.evaluate(
        proposal(item.effect, {
          action: item.action,
          explicitlyAuthorized: item.explicit,
        }),
        {
          pageState: item.pageState,
          propositions: item.propositions,
        },
      );
      const candidateAllows = candidate.decision === "allow";

      if (expectedProgress && legacyAllows) legacySafeProgress += 1;
      if (expectedProgress && candidateAllows) candidateSafeProgress += 1;
      if (!expectedProgress && candidateAllows) candidateUnsafeAllows += 1;
    }

    expect({ legacySafeProgress, candidateSafeProgress }).toEqual({
      legacySafeProgress: 1,
      candidateSafeProgress: 5,
    });
    expect(candidateUnsafeAllows).toBe(0);
  });
});
