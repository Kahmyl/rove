import { describe, expect, it } from "vitest";
import type { PageInspection, PageStateAssessment } from "@rove/protocol";
import { InteractionPolicy } from "./interaction-policy.js";

function inspection(pageState: PageStateAssessment): PageInspection {
  return { pageId: "page_01", revision: 1, url: "https://example.test", title: "Fixture", metadata: { pageState } };
}

const ready: PageStateAssessment = {
  kind: "ready",
  confidence: "high",
  signals: ["dom:content_available"],
  recommendedAction: "continue",
};

describe("InteractionPolicy", () => {
  it("requires an inspection before mutation", () => {
    const policy = new InteractionPolicy();
    expect(() => policy.authorizeMutation("ses_test", "click:next")).toThrowError(
      expect.objectContaining({ code: "INSPECTION_REQUIRED" }),
    );
  });

  it("blocks mutations for human-only page states", () => {
    const policy = new InteractionPolicy();
    policy.recordInspection("ses_test", inspection({
      kind: "human_verification",
      confidence: "high",
      signals: ["content:captcha"],
      recommendedAction: "request_human",
    }));
    expect(() => policy.authorizeMutation("ses_test", "click:verify")).toThrowError(
      expect.objectContaining({ code: "HUMAN_VERIFICATION_REQUIRED" }),
    );
  });

  it("makes loading-state rejection explicitly retryable", () => {
    const policy = new InteractionPolicy();
    policy.recordInspection("ses_test", inspection({
      kind: "loading",
      confidence: "high",
      signals: ["document_ready_state:loading"],
      recommendedAction: "wait_and_inspect",
    }));
    expect(() => policy.authorizeMutation("ses_test", "scroll:down")).toThrowError(
      expect.objectContaining({ code: "PAGE_NOT_READY", retryable: true }),
    );
  });

  it("blocks a repeated mutation campaign deterministically", () => {
    const policy = new InteractionPolicy();
    policy.recordInspection("ses_test", inspection(ready));
    for (let index = 0; index < 4; index += 1) {
      policy.authorizeMutation("ses_test", "click:next", index * 100);
    }
    expect(() => policy.authorizeMutation("ses_test", "click:next", 500)).toThrowError(
      expect.objectContaining({ code: "REPEATED_ACTION_BLOCKED" }),
    );
  });

  it("enforces the rolling session action budget", () => {
    const policy = new InteractionPolicy();
    policy.recordInspection("ses_test", inspection(ready));
    for (let index = 0; index < 30; index += 1) {
      policy.authorizeMutation("ses_test", `click:item-${index}`, index * 100);
    }
    expect(() => policy.authorizeMutation("ses_test", "click:item-31", 3_100)).toThrowError(
      expect.objectContaining({ code: "ACTION_BUDGET_EXCEEDED", retryable: true }),
    );
  });
});
