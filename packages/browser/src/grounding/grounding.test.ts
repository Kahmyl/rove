import { describe, expect, it } from "vitest";

import type { BrowserObservation } from "@rove/protocol";

import { groundTarget } from "./grounding.js";

function observation(): BrowserObservation {
  return {
    observationId: "bobs_phase2",
    observedAt: new Date(0).toISOString(),
    mutationVersion: 0,
    pageId: "page_01",
    revision: 4,
    url: "https://example.test/",
    title: "Fixture",
    document: {
      url: "https://example.test/",
      revision: 4,
    },
    targets: [
      {
        ref: "t1",
        kind: "button",
        name: "Save",
        visible: true,
        enabled: true,
        perceived: {
          capabilities: ["activate"],
          scopes: [
            {
              kind: "form",
              label: "Profile",
            },
          ],
        },
        geometry: {
          bounds: {
            x: 10,
            y: 10,
            width: 100,
            height: 30,
          },
          inViewport: true,
          clipped: false,
          occluded: false,
        },
      },
      {
        ref: "t2",
        kind: "button",
        name: "Save",
        visible: true,
        enabled: true,
        perceived: {
          capabilities: ["activate"],
          scopes: [
            {
              kind: "form",
              label: "Billing address",
            },
          ],
        },
        geometry: {
          bounds: {
            x: 10,
            y: 60,
            width: 100,
            height: 30,
          },
          inViewport: true,
          clipped: false,
          occluded: false,
        },
      },
    ],
  };
}

describe("Phase 2 target grounding", () => {
  it("uses an exact requested kind to select a same-named link", () => {
    const input = observation();
    input.targets = [
      { ...input.targets![0]!, ref: "row", kind: "row", name: "Review" },
      {
        ...input.targets![0]!,
        ref: "gridcell",
        kind: "gridcell",
        name: "Review",
      },
      { ...input.targets![0]!, ref: "link", kind: "link", name: "Review" },
    ];

    const result = groundTarget(input, {
      kind: "link",
      capability: "activate",
      text: "Review",
    });
    expect(result).toMatchObject({
      status: "selected",
      target: { ref: "link" },
    });
    expect(result.alternatives[0]?.evidence).toContain("kind_match");
  });

  it("does not substitute another kind when the requested kind is absent", () => {
    const result = groundTarget(observation(), {
      kind: "link",
      capability: "activate",
      text: "Save",
    });
    expect(result).toMatchObject({
      status: "unresolved",
      reason: "no_candidate",
    });
    expect(
      result.alternatives.every((item) => item.evidence[0] === "kind_mismatch"),
    ).toBe(true);
  });

  it("uses structural scope to ground duplicate names", () => {
    expect(
      groundTarget(observation(), {
        capability: "activate",
        text: "Save",
        scope: {
          kind: "form",
          label: "Billing address",
        },
      }),
    ).toMatchObject({
      status: "selected",
      target: {
        pageId: "page_01",
        revision: 4,
        ref: "t2",
      },
    });
  });

  it("represents a strongest-class tie as ambiguity", () => {
    const input = observation();

    input.targets![1] = {
      ...input.targets![0]!,
      ref: "t2",
    };

    expect(
      groundTarget(input, {
        capability: "activate",
        text: "Save",
      }),
    ).toMatchObject({
      status: "ambiguous",
      reason: "insufficient_separation",
    });
  });

  it("does not fall through when the strongest candidate is non-actionable", () => {
    const input = observation();

    input.targets![1] = {
      ...input.targets![1]!,
      geometry: {
        ...input.targets![1]!.geometry!,
        occluded: true,
      },
    };

    expect(
      groundTarget(input, {
        capability: "activate",
        text: "Save",
        scope: {
          kind: "form",
          label: "Billing address",
        },
      }),
    ).toMatchObject({
      status: "ambiguous",
      reason: "best_candidate_not_actionable",
    });
  });
});

describe("Phase 2 grounding safety regressions", () => {
  it("matches a requested whole-token sequence through supplemental text and wrapping punctuation", () => {
    const input = observation();

    input.targets = [
      ...Array.from({ length: 8 }, (_, index) => ({
        ...input.targets![0]!,
        ref: `unrelated-${index}`,
        name: `Unrelated action ${index}`,
      })),
      {
        ...input.targets[0]!,
        ref: "report-pdf",
        kind: "link",
        name: "2026 Quarterly Report (PDF)",
      },
    ];

    const result = groundTarget(input, {
      capability: "activate",
      text: "Quarterly Report PDF",
    });

    expect(result).toMatchObject({
      status: "selected",
      target: {
        ref: "report-pdf",
      },
      reason: "grounded",
    });
    expect(result.alternatives[0]).toMatchObject({
      target: { ref: "report-pdf" },
      evidence: expect.arrayContaining([
        "capability_match",
        "partial_name_match",
        "actionable",
      ]),
    });
  });

  it("matches when the actual whole-token sequence is contained by a longer request", () => {
    const input = observation();

    input.targets = [
      {
        ...input.targets![0]!,
        ref: "report-pdf",
        kind: "link",
        name: "Quarterly Report (PDF)",
      },
    ];

    const result = groundTarget(input, {
      capability: "activate",
      text: "Download 2026 Quarterly Report PDF Now",
    });

    expect(result).toMatchObject({
      status: "selected",
      target: { ref: "report-pdf" },
    });
    expect(result.alternatives[0]?.evidence).toContain("partial_name_match");
  });

  it.each([
    ["AB", "A/B"],
    ["Quarterly Report PDF", "Quarterly Reporting (PDF)"],
    ["***", "2026 Quarterly Report (PDF)"],
    ["***", "***"],
  ])(
    "does not manufacture token-sequence evidence for %j against %j",
    (requested, actual) => {
      const input = observation();

      input.targets = [
        {
          ...input.targets![0]!,
          name: actual,
        },
      ];

      expect(
        groundTarget(input, {
          text: requested,
        }),
      ).toMatchObject({
        status: "unresolved",
        reason: "no_candidate",
      });
    },
  );

  it("keeps a stronger non-actionable substring above a weaker actionable token-sequence match", () => {
    const input = observation();

    input.targets = [
      {
        ...input.targets![0]!,
        ref: "strong",
        name: "Download Quarterly Report PDF now",
        geometry: {
          ...input.targets![0]!.geometry!,
          occluded: true,
        },
      },
      {
        ...input.targets![1]!,
        ref: "weak",
        name: "2026 Quarterly Report (PDF)",
      },
    ];

    const result = groundTarget(input, {
      capability: "activate",
      text: "Quarterly Report PDF",
    });

    expect(result).toMatchObject({
      status: "ambiguous",
      reason: "best_candidate_not_actionable",
    });
    expect(result.alternatives[0]).toMatchObject({
      target: { ref: "strong" },
      actionable: false,
      evidence: expect.arrayContaining(["partial_name_match"]),
    });
  });

  it("does not ground an empty internal intent", () => {
    expect(groundTarget(observation(), {})).toMatchObject({
      status: "unresolved",
      reason: "no_candidate",
    });
  });

  it("does not ground a control that lacks an explicitly requested capability", () => {
    const input = observation();

    input.targets = [input.targets![0]!];

    expect(
      groundTarget(input, {
        capability: "upload",
        text: "Save",
      }),
    ).toMatchObject({
      status: "unresolved",
      reason: "no_candidate",
      alternatives: [
        expect.objectContaining({
          evidence: ["capability_mismatch"],
        }),
      ],
    });
  });

  it("does not count omitted dimensions as positive evidence", () => {
    const input = observation();

    input.targets = [input.targets![0]!];

    expect(
      groundTarget(input, {
        text: "No such control",
      }),
    ).toMatchObject({
      status: "unresolved",
      reason: "no_candidate",
    });
  });

  it("permits frame-only grounding when frame evidence is uniquely positive", () => {
    const input = observation();

    input.targets = [
      {
        ...input.targets![0]!,
        frame: {
          index: 0,
          url: "https://example.test/",
          name: "main",
          main: true,
        },
      },
      {
        ...input.targets![1]!,
        frame: {
          index: 1,
          url: "https://example.test/checkout",
          name: "Checkout",
          main: false,
        },
      },
    ];

    expect(
      groundTarget(input, {
        frameLabel: "Checkout",
      }),
    ).toMatchObject({
      status: "selected",
      target: {
        ref: "t2",
      },
    });
  });
});
