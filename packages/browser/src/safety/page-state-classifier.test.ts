import { describe, expect, it } from "vitest";

import { classifyObservedPageState as authoritativeClassifier } from "../perception/page-state-decision.js";
import { classifyObservedPageState as safetyClassifier } from "./page-state-classifier.js";

describe("production page-state safety entrypoint", () => {
  it("re-exports the authoritative F1 perception classifier", () => {
    expect(safetyClassifier).toBe(authoritativeClassifier);
  });

  it("reports access restriction without operational policy", () => {
    const result = safetyClassifier({
      signals: {
        readyState: "complete",
        httpStatus: 403,
      },
    });

    expect(result.assessment).toMatchObject({
      kind: "access_restricted",
      confidence: "high",
    });
    expect(result.propositions.accessRestricted).toBe(true);
    expect(result.assessment).not.toHaveProperty("recommendedAction");
  });

  it("does not treat interactive readyState as automatically unstable", () => {
    const result = safetyClassifier({
      signals: {
        readyState: "interactive",
        httpStatus: 200,
      },
    });

    expect(result.propositions.documentUnstable).toBe(false);
    expect(result.assessment).not.toHaveProperty("recommendedAction");
  });
});
