import { describe, expect, it } from "vitest";

import type {
  PageInspection,
  PageStateAssessment,
  PageStateIdentity,
  PageStatePropositions,
} from "@rove/protocol";

import { InteractionPolicy } from "./interaction-policy.js";

const propositions: PageStatePropositions = {
  primaryContentAvailable: true,
  documentUnstable: false,
  authenticationRequired: false,
  humanVerificationPresented: false,
  accessRestricted: false,
  errorPresented: false,
  interstitialPresented: false,
};

const fingerprint = "a".repeat(64);

const identity: PageStateIdentity = {
  pageId: "page_01",
  fingerprint,
};

function inspection(
  pageState: PageStateAssessment,
  overrides: {
    propositions?: PageStatePropositions;
    fingerprint?: string;
    pageId?: string;
  } = {},
): PageInspection {
  return {
    pageId: overrides.pageId ?? "page_01",
    revision: 1,
    url: "https://example.test",
    title: "Fixture",
    metadata: {
      pageState,
      pageStatePropositions: overrides.propositions ?? propositions,
      pageStateFingerprint: overrides.fingerprint ?? fingerprint,
    },
  };
}

const ready: PageStateAssessment = {
  kind: "ready",
  confidence: "high",
  signals: ["document:stable"],
  recommendedAction: "continue",
};

describe("InteractionPolicy", () => {
  it("requires an inspection before mutation", () => {
    const policy = new InteractionPolicy();

    expect(() =>
      policy.authorizeMutation("ses_test", "click:next", 0, identity),
    ).toThrowError(
      expect.objectContaining({
        code: "INSPECTION_REQUIRED",
      }),
    );
  });

  it("blocks mutations for human-only page states", () => {
    const policy = new InteractionPolicy();

    policy.recordInspection(
      "ses_test",
      inspection({
        kind: "human_verification",
        confidence: "high",
        signals: ["verification:primary_surface"],
        recommendedAction: "request_human",
      }),
    );

    expect(() =>
      policy.authorizeMutation("ses_test", "click:verify", 0, identity),
    ).toThrowError(
      expect.objectContaining({
        code: "HUMAN_VERIFICATION_REQUIRED",
      }),
    );
  });

  it("makes loading-state rejection explicitly retryable", () => {
    const policy = new InteractionPolicy();

    policy.recordInspection(
      "ses_test",
      inspection({
        kind: "loading",
        confidence: "medium",
        signals: ["document:unstable"],
        recommendedAction: "wait_and_inspect",
      }),
    );

    expect(() =>
      policy.authorizeMutation("ses_test", "scroll:down", 0, identity),
    ).toThrowError(
      expect.objectContaining({
        code: "PAGE_NOT_READY",
        retryable: true,
      }),
    );
  });

  it("does not authorize low or medium confidence ready compatibility states", () => {
    for (const confidence of ["low", "medium"] as const) {
      const policy = new InteractionPolicy();

      policy.recordInspection(
        "ses_test",
        inspection({
          ...ready,
          confidence,
        }),
      );

      expect(() =>
        policy.authorizeMutation("ses_test", "click:next", 0, identity),
      ).toThrowError(
        expect.objectContaining({
          code: "PAGE_NOT_READY",
          retryable: true,
        }),
      );
    }
  });

  it("requires every mutation-relevant proposition to be resolved and false", () => {
    const policy = new InteractionPolicy();

    policy.recordInspection(
      "ses_test",
      inspection(ready, {
        propositions: {
          ...propositions,
          humanVerificationPresented: "indeterminate",
        },
      }),
    );

    expect(() =>
      policy.authorizeMutation("ses_test", "click:next", 0, identity),
    ).toThrowError(
      expect.objectContaining({
        code: "PAGE_NOT_READY",
      }),
    );
  });

  it("invalidates a ready inspection when page identity or fingerprint changes", () => {
    for (const current of [
      {
        pageId: "page_02",
        fingerprint,
      },
      {
        pageId: "page_01",
        fingerprint: "b".repeat(64),
      },
    ]) {
      const policy = new InteractionPolicy();

      policy.recordInspection("ses_test", inspection(ready));

      expect(() =>
        policy.authorizeMutation("ses_test", "click:next", 0, current),
      ).toThrowError(
        expect.objectContaining({
          code: "INSPECTION_REQUIRED",
          retryable: true,
        }),
      );

      expect(() =>
        policy.authorizeMutation("ses_test", "click:next", 1, current),
      ).toThrowError(
        expect.objectContaining({
          code: "INSPECTION_REQUIRED",
        }),
      );
    }
  });

  it("invalidates an inspection when the page revision changes despite the same semantic identity", () => {
    const policy = new InteractionPolicy();

    policy.recordInspection("ses_test", inspection(ready));

    expect(() =>
      policy.requireFreshInspectionRevision("ses_test", "page_01", 2),
    ).toThrowError(
      expect.objectContaining({
        code: "INSPECTION_REQUIRED",
        retryable: true,
      }),
    );
  });

  it("blocks a repeated mutation campaign deterministically", () => {
    const policy = new InteractionPolicy();

    policy.recordInspection("ses_test", inspection(ready));

    for (let index = 0; index < 4; index += 1) {
      policy.authorizeMutation("ses_test", "click:next", index * 100, identity);
    }

    expect(() =>
      policy.authorizeMutation("ses_test", "click:next", 500, identity),
    ).toThrowError(
      expect.objectContaining({
        code: "REPEATED_ACTION_BLOCKED",
      }),
    );
  });

  it("enforces the rolling session action budget", () => {
    const policy = new InteractionPolicy();

    policy.recordInspection("ses_test", inspection(ready));

    for (let index = 0; index < 30; index += 1) {
      policy.authorizeMutation(
        "ses_test",
        `click:item-${index}`,
        index * 100,
        identity,
      );
    }

    expect(() =>
      policy.authorizeMutation("ses_test", "click:item-31", 3_100, identity),
    ).toThrowError(
      expect.objectContaining({
        code: "ACTION_BUDGET_EXCEEDED",
        retryable: true,
      }),
    );
  });
});
