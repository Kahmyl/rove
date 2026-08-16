import { describe, expect, it } from "vitest";

import type {
  PagePolicyDecision,
  PageStateAssessment,
  PageStatePropositions,
} from "@rove/protocol";

import { PageStatePolicy } from "./page-state-policy.js";

const allFalse: PageStatePropositions = {
  primaryContentAvailable: true,
  documentUnstable: false,
  authenticationRequired: false,
  humanVerificationPresented: false,
  accessRestricted: false,
  errorPresented: false,
  interstitialPresented: false,
};

function state(
  kind: PageStateAssessment["kind"],
  confidence: PageStateAssessment["confidence"] = "high",
): PageStateAssessment {
  return {
    kind,
    confidence,
    signals: [`test:${kind}`],
    recommendedAction:
      kind === "ready"
        ? "continue"
        : kind === "loading"
          ? "wait_and_inspect"
          : kind === "error"
            ? "stop"
            : "request_human",
  };
}

function expectDecision(
  actual: PagePolicyDecision,
  expected: Partial<PagePolicyDecision>,
): void {
  expect(actual).toEqual(
    expect.objectContaining({
      ...expected,
      message: expect.any(String),
    }),
  );
}

describe("PageStatePolicy", () => {
  const policy = new PageStatePolicy();

  it("allows mutation only for high-confidence ready with resolved non-blocking propositions", () => {
    expectDecision(policy.evaluate(state("ready"), allFalse), {
      disposition: "continue",
      reason: "page_ready",
      mutationAllowed: true,
      retryable: false,
    });
  });

  it.each(["medium", "low"] as const)(
    "waits for a %s-confidence ready assessment",
    (confidence) => {
      expectDecision(policy.evaluate(state("ready", confidence), allFalse), {
        disposition: "wait_and_inspect",
        reason: "insufficient_confidence",
        mutationAllowed: false,
        retryable: true,
      });
    },
  );

  it("fails closed when propositions are unavailable", () => {
    expectDecision(policy.evaluate(state("ready")), {
      disposition: "wait_and_inspect",
      reason: "unresolved_page_state",
      mutationAllowed: false,
      retryable: true,
    });
  });

  it.each([
    "documentUnstable",
    "authenticationRequired",
    "humanVerificationPresented",
    "accessRestricted",
    "errorPresented",
    "interstitialPresented",
  ] as const)(
    "waits when decision-relevant proposition %s is indeterminate",
    (key) => {
      expectDecision(
        policy.evaluate(state("ready"), {
          ...allFalse,
          [key]: "indeterminate",
        }),
        {
          disposition: "wait_and_inspect",
          reason: "unresolved_page_state",
          mutationAllowed: false,
          retryable: true,
        },
      );
    },
  );

  it("maps loading to wait_and_inspect without requesting a human", () => {
    expectDecision(policy.evaluate(state("loading", "medium"), allFalse), {
      disposition: "wait_and_inspect",
      reason: "page_unstable",
      mutationAllowed: false,
      retryable: true,
      errorCode: "PAGE_NOT_READY",
    });
  });

  it("maps authentication to request_human", () => {
    expectDecision(
      policy.evaluate(state("authentication_required"), allFalse),
      {
        disposition: "request_human",
        reason: "authentication_required",
        mutationAllowed: false,
        retryable: false,
        errorCode: "AUTHENTICATION_REQUIRED",
      },
    );
  });

  it("maps human verification to request_human", () => {
    expectDecision(policy.evaluate(state("human_verification"), allFalse), {
      disposition: "request_human",
      reason: "human_verification_required",
      mutationAllowed: false,
      retryable: false,
      errorCode: "HUMAN_VERIFICATION_REQUIRED",
    });
  });

  it("maps access restriction to stop rather than request_human", () => {
    expectDecision(policy.evaluate(state("access_restricted"), allFalse), {
      disposition: "stop",
      reason: "access_restricted",
      mutationAllowed: false,
      retryable: false,
      errorCode: "SITE_ACCESS_RESTRICTED",
    });
  });

  it("maps unknown interstitial to stop rather than request_human", () => {
    expectDecision(
      policy.evaluate(state("unknown_interstitial", "medium"), allFalse),
      {
        disposition: "stop",
        reason: "unknown_interstitial",
        mutationAllowed: false,
        retryable: false,
        errorCode: "UNKNOWN_INTERSTITIAL",
      },
    );
  });

  it("maps page error to stop rather than request_human", () => {
    expectDecision(policy.evaluate(state("error"), allFalse), {
      disposition: "stop",
      reason: "page_error",
      mutationAllowed: false,
      retryable: false,
      errorCode: "PAGE_NOT_READY",
    });
  });

  it.each([
    {
      key: "documentUnstable",
      expected: {
        disposition: "wait_and_inspect",
        reason: "page_unstable",
        errorCode: "PAGE_NOT_READY",
      },
    },
    {
      key: "authenticationRequired",
      expected: {
        disposition: "request_human",
        reason: "authentication_required",
        errorCode: "AUTHENTICATION_REQUIRED",
      },
    },
    {
      key: "humanVerificationPresented",
      expected: {
        disposition: "request_human",
        reason: "human_verification_required",
        errorCode: "HUMAN_VERIFICATION_REQUIRED",
      },
    },
    {
      key: "accessRestricted",
      expected: {
        disposition: "stop",
        reason: "access_restricted",
        errorCode: "SITE_ACCESS_RESTRICTED",
      },
    },
    {
      key: "errorPresented",
      expected: {
        disposition: "stop",
        reason: "page_error",
        errorCode: "PAGE_NOT_READY",
      },
    },
    {
      key: "interstitialPresented",
      expected: {
        disposition: "stop",
        reason: "unknown_interstitial",
        errorCode: "UNKNOWN_INTERSTITIAL",
      },
    },
  ] as const)(
    "lets proposition $key make nominal ready non-authorizing",
    ({ key, expected }) => {
      const decision = policy.evaluate(state("ready"), {
        ...allFalse,
        [key]: true,
      });

      expectDecision(decision, {
        ...expected,
        mutationAllowed: false,
      });
    },
  );

  it("lets a known human-remediable proposition outrank unrelated indeterminate evidence", () => {
    expectDecision(
      policy.evaluate(state("ready"), {
        ...allFalse,
        authenticationRequired: true,
        errorPresented: "indeterminate",
      }),
      {
        disposition: "request_human",
        reason: "authentication_required",
        mutationAllowed: false,
        retryable: false,
        errorCode: "AUTHENTICATION_REQUIRED",
      },
    );
  });

  it("is deterministic and independent of runtime/session/control services", () => {
    const pageState = state("ready");
    const first = policy.evaluate(pageState, allFalse);
    const second = policy.evaluate(pageState, allFalse);

    expect(second).toEqual(first);
  });
});
