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
