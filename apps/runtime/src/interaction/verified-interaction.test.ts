import { describe, expect, it } from "vitest";

import type { BrowserObservation } from "@rove/protocol";

import {
  assessExpectedEffectEvidenceSuitability,
  classifyActionOutcome,
  interactionActionProposal,
  verifyExpectedEffects,
} from "./verified-interaction.js";

function observation(
  id: string,
  url: string,
  text: string,
): BrowserObservation {
  return {
    observationId: id,
    observedAt: new Date(0).toISOString(),
    mutationVersion: 0,
    pageId: "page_01",
    revision: 1,
    url,
    title: "Fixture",
    document: {
      url,
      revision: 1,
    },
    text,
    targets: [],
  };
}

describe("verified interaction semantics", () => {
  it("requires positive successor evidence for applied", () => {
    const predecessor = observation(
      "before",
      "https://example.test/a",
      "before",
    );

    const successor = observation("after", "https://example.test/b", "done");

    const effects = verifyExpectedEffects(
      [
        {
          kind: "url_changed",
        },
        {
          kind: "text_present",
          text: "done",
        },
      ],
      predecessor,
      successor,
      undefined,
      [],
      [],
    );

    expect(classifyActionOutcome(effects)).toBe("applied");
  });

  it("does not accept pre-existing text or exact URL as causal proof", () => {
    const predecessor = observation(
      "before",
      "https://example.test/inbox",
      "Review request",
    );
    const successor = observation(
      "after",
      "https://example.test/inbox",
      "Review request",
    );
    const effects = verifyExpectedEffects(
      [
        { kind: "url_equals", url: "https://example.test/inbox" },
        { kind: "text_present", text: "Review request" },
      ],
      predecessor,
      successor,
      undefined,
      [],
      [],
    );

    expect(effects.every((effect) => effect.state === "unresolved")).toBe(true);
    expect(classifyActionOutcome(effects)).toBe("unknown");
  });

  it("requires target state and presence transitions", () => {
    const predecessor = observation("before", "https://example.test", "");
    predecessor.targets = [
      {
        ref: "before",
        kind: "checkbox",
        name: "Ready",
        visible: true,
        enabled: true,
        state: { checked: true },
      },
    ];
    const successor = observation("after", "https://example.test", "");
    successor.targets = [
      {
        ...predecessor.targets[0]!,
        ref: "after",
      },
    ];
    const preexisting = verifyExpectedEffects(
      [
        { kind: "target_checked", target: { name: "Ready", kind: "checkbox" } },
        { kind: "target_present", target: { name: "Ready", kind: "checkbox" } },
      ],
      predecessor,
      successor,
      undefined,
      [],
      [],
    );
    expect(preexisting.every((effect) => effect.state === "unresolved")).toBe(
      true,
    );

    predecessor.targets[0]!.state = { checked: false };
    const transitioned = verifyExpectedEffects(
      [{ kind: "target_checked", target: { name: "Ready", kind: "checkbox" } }],
      predecessor,
      successor,
      undefined,
      [],
      [],
    );
    expect(classifyActionOutcome(transitioned)).toBe("applied");
  });

  it("uses complete canonical target evidence behind presentation truncation", () => {
    const predecessor = observation("before", "https://example.test", "");
    predecessor.metadata = { targetsTruncated: true };
    predecessor.targetEvidence = {
      source: "canonical_registry",
      completeness: "complete",
    };
    const successor = observation("after", "https://example.test", "");
    successor.metadata = { targetsTruncated: true };
    successor.targetEvidence = {
      source: "canonical_registry",
      completeness: "complete",
    };
    successor.targets = [
      {
        ref: "canonical-target",
        kind: "button",
        name: "Created item",
        visible: true,
        enabled: true,
      },
    ];

    const effects = verifyExpectedEffects(
      [
        {
          kind: "target_present",
          target: { name: "Created item", kind: "button" },
        },
      ],
      predecessor,
      successor,
      undefined,
      [],
      [],
    );

    expect(effects).toEqual([expect.objectContaining({ state: "observed" })]);
  });

  it("keeps target verification unresolved when canonical acquisition is incomplete", () => {
    const predecessor = observation("before", "https://example.test", "");
    predecessor.targetEvidence = {
      source: "canonical_registry",
      completeness: "incomplete",
      incompleteReasons: ["target_acquisition_failed"],
    };
    const successor = observation("after", "https://example.test", "");
    successor.targetEvidence = {
      source: "canonical_registry",
      completeness: "incomplete",
      incompleteReasons: ["semantic_targets_unaccounted"],
    };
    successor.targets = [
      {
        ref: "partial-target",
        kind: "button",
        name: "Created item",
        visible: true,
        enabled: true,
      },
    ];

    const effects = verifyExpectedEffects(
      [
        {
          kind: "target_present",
          target: { name: "Created item", kind: "button" },
        },
      ],
      predecessor,
      successor,
      undefined,
      [],
      [],
    );

    expect(effects).toEqual([expect.objectContaining({ state: "unresolved" })]);
  });

  it("identifies whole-page text effects that cannot use a truncated predecessor", () => {
    const predecessor = observation("before", "https://example.test", "Create");
    predecessor.metadata = { textTruncated: true };

    expect(
      assessExpectedEffectEvidenceSuitability(
        [
          { kind: "text_present", text: "Created" },
          { kind: "text_absent", text: "Create" },
          { kind: "url_changed" },
        ],
        predecessor,
      ),
    ).toEqual([
      expect.objectContaining({
        effectIndex: 0,
        evidenceSurface: "page_text",
        reason: "predecessor_text_truncated",
      }),
      expect.objectContaining({
        effectIndex: 1,
        evidenceSurface: "page_text",
        reason: "predecessor_text_truncated",
      }),
    ]);
  });

  it("does not turn missing predecessor or successor text into authoritative absence", () => {
    const missingPredecessor = observation(
      "before-missing",
      "https://example.test",
      "unused",
    );
    delete missingPredecessor.text;
    const completeSuccessor = observation(
      "after-complete",
      "https://example.test",
      "Created item",
    );
    const completePredecessor = observation(
      "before-complete",
      "https://example.test",
      "Create item",
    );
    const missingSuccessor = observation(
      "after-missing",
      "https://example.test",
      "unused",
    );
    delete missingSuccessor.text;

    const effect = { kind: "text_present" as const, text: "Created item" };
    expect(
      verifyExpectedEffects(
        [effect],
        missingPredecessor,
        completeSuccessor,
        undefined,
        [],
        [],
      ),
    ).toEqual([expect.objectContaining({ state: "unresolved" })]);
    expect(
      verifyExpectedEffects(
        [effect],
        completePredecessor,
        missingSuccessor,
        undefined,
        [],
        [],
      ),
    ).toEqual([expect.objectContaining({ state: "unresolved" })]);
  });

  it("requires available predecessor text for whole-page effect suitability", () => {
    const predecessor = observation("before", "https://example.test", "unused");
    delete predecessor.text;

    expect(
      assessExpectedEffectEvidenceSuitability(
        [
          { kind: "text_present", text: "Created" },
          { kind: "text_absent", text: "Create" },
        ],
        predecessor,
      ),
    ).toEqual([
      expect.objectContaining({
        effectIndex: 0,
        evidenceSurface: "page_text",
        reason: "predecessor_text_unavailable",
      }),
      expect.objectContaining({
        effectIndex: 1,
        evidenceSurface: "page_text",
        reason: "predecessor_text_unavailable",
      }),
    ]);
  });

  it("keeps outcome unknown when successor evidence is unavailable", () => {
    const effects = verifyExpectedEffects(
      [
        {
          kind: "url_changed",
        },
      ],
      observation("before", "https://example.test/a", "before"),
      undefined,
      undefined,
      [],
      [],
    );

    expect(classifyActionOutcome(effects)).toBe("unknown");
  });

  it("does not treat dispatch without expected effects as factual success", () => {
    expect(classifyActionOutcome([])).toBe("unknown");
  });

  it("verifies page lifecycle effects without requiring a successor observation", () => {
    const predecessor = observation(
      "before",
      "https://example.test/a",
      "before",
    );

    const pageOne = {
      id: "page_01",
      url: "https://example.test/a",
      active: true,
      revision: 1,
    };

    const pageTwo = {
      id: "page_02",
      url: "https://example.test/popup",
      active: false,
      revision: 1,
    };

    const openedByPageDelta = verifyExpectedEffects(
      [
        {
          kind: "page_opened",
        },
      ],
      predecessor,
      undefined,
      undefined,
      [pageOne],
      [pageOne, pageTwo],
    );

    expect(classifyActionOutcome(openedByPageDelta)).toBe("applied");

    const openedByActionResult = verifyExpectedEffects(
      [
        {
          kind: "page_opened",
        },
      ],
      predecessor,
      undefined,
      {
        ok: true,
        action: "click",
        sessionId: "session_01",
        pageChanged: true,
        openedPages: [pageTwo],
      },
      [pageOne],
      undefined,
    );

    expect(classifyActionOutcome(openedByActionResult)).toBe("applied");

    const closedByPageDelta = verifyExpectedEffects(
      [
        {
          kind: "page_closed",
        },
      ],
      predecessor,
      undefined,
      undefined,
      [pageOne, pageTwo],
      [pageOne],
    );

    expect(classifyActionOutcome(closedByPageDelta)).toBe("applied");
  });

  it("keeps page lifecycle outcome unknown when the post-action page snapshot is unavailable", () => {
    const predecessor = observation(
      "before",
      "https://example.test/a",
      "before",
    );

    const pageOne = {
      id: "page_01",
      url: "https://example.test/a",
      active: true,
      revision: 1,
    };

    const opened = verifyExpectedEffects(
      [
        {
          kind: "page_opened",
        },
      ],
      predecessor,
      undefined,
      undefined,
      [pageOne],
      undefined,
    );

    const closed = verifyExpectedEffects(
      [
        {
          kind: "page_closed",
        },
      ],
      predecessor,
      undefined,
      undefined,
      [pageOne],
      undefined,
    );

    expect(classifyActionOutcome(opened)).toBe("unknown");

    expect(classifyActionOutcome(closed)).toBe("unknown");
  });

  it("derives a credential floor from the grounded target", () => {
    const before = observation(
      "before",
      "https://example.test/sign-in",
      "Sign in",
    );
    before.targets = [
      {
        ref: "t1",
        kind: "input",
        name: "Password",
        visible: true,
        enabled: true,
        sensitive: true,
      },
    ];

    expect(
      interactionActionProposal(
        {
          observationId: "before",
          action: {
            kind: "fill",
            target: { pageId: "page_01", revision: 1, ref: "t1" },
            value: "not-persisted",
          },
          expectedEffects: [],
          consequential: false,
        },
        before,
      ),
    ).toMatchObject({
      action: "fill",
      effect: "credential_entry",
    });
  });

  it("requires verifiable evidence for a consequential proposal", () => {
    const before = observation(
      "before",
      "https://example.test/issue/new",
      "Create issue",
    );

    expect(
      interactionActionProposal(
        {
          observationId: "before",
          action: {
            kind: "click",
            target: { pageId: "page_01", revision: 1, ref: "t1" },
          },
          expectedEffects: [],
          consequential: true,
          consequenceKey: "issue:create:1",
        },
        before,
      ),
    ).toMatchObject({
      effect: "external_commit",
      explicitlyAuthorized: true,
      outcomeCanBeVerified: false,
    });
  });

  it("verifies rich widget state and exact non-sensitive values", () => {
    const before = observation(
      "before",
      "https://example.test/widgets",
      "Widgets",
    );
    const after = observation(
      "after",
      "https://example.test/widgets",
      "Widgets",
    );
    before.targets = [
      {
        ref: "t1-before",
        kind: "disclosure",
        name: "Advanced",
        visible: true,
        enabled: true,
        state: { expanded: false, open: false, focused: false },
      },
      {
        ref: "t2-before",
        kind: "slider",
        name: "Priority",
        visible: true,
        enabled: true,
        state: { valueNow: 3 },
      },
      {
        ref: "t3-before",
        kind: "input",
        name: "Summary",
        visible: true,
        enabled: true,
        state: { value: "Draft" },
      },
    ];
    after.targets = [
      {
        ref: "t1",
        kind: "disclosure",
        name: "Advanced",
        visible: true,
        enabled: true,
        state: { expanded: true, open: true, focused: true },
      },
      {
        ref: "t2",
        kind: "slider",
        name: "Priority",
        visible: true,
        enabled: true,
        state: { valueNow: 7 },
      },
      {
        ref: "t3",
        kind: "input",
        name: "Summary",
        visible: true,
        enabled: true,
        state: { value: "Ready" },
      },
    ];

    const effects = verifyExpectedEffects(
      [
        { kind: "target_expanded", target: { name: "Advanced" } },
        { kind: "target_open", target: { name: "Advanced" } },
        { kind: "target_focused", target: { name: "Advanced" } },
        {
          kind: "target_numeric_value",
          target: { name: "Priority" },
          value: 7,
        },
        {
          kind: "target_value",
          target: { name: "Summary" },
          value: "Ready",
        },
      ],
      before,
      after,
      undefined,
      [],
      [],
    );

    expect(effects.every((effect) => effect.state === "observed")).toBe(true);
    expect(classifyActionOutcome(effects)).toBe("applied");
  });

  it("verifies a named target relative to a structural destination scope", () => {
    const before = observation(
      "before",
      "https://example.test/files",
      "Quarterly report Inbox Archive",
    );
    const after = observation(
      "after",
      "https://example.test/files",
      "Quarterly report Inbox Archive",
    );
    before.targets = [
      {
        ref: "source-before",
        kind: "button",
        name: "Quarterly report",
        visible: true,
        enabled: true,
        perceived: {
          capabilities: ["activate"],
          scopes: [
            { kind: "list", label: "Inbox" },
            { kind: "menu", label: "Move actions" },
          ],
        },
      },
    ];
    after.targets = [
      {
        ref: "source-copy",
        kind: "button",
        name: "Quarterly report",
        visible: true,
        enabled: true,
        perceived: {
          capabilities: ["activate"],
          scopes: [{ kind: "list", label: "Inbox" }],
        },
      },
      {
        ref: "destination-copy",
        kind: "button",
        name: "Quarterly report",
        visible: true,
        enabled: true,
        perceived: {
          capabilities: ["activate"],
          scopes: [{ kind: "list", label: "Archive" }],
        },
      },
    ];

    const effects = verifyExpectedEffects(
      [
        {
          kind: "target_within_scope",
          target: { name: "Quarterly report", kind: "button" },
          scope: { kind: "list", label: "Archive" },
        },
        {
          kind: "target_outside_scope",
          target: { name: "Quarterly report", kind: "button" },
          scope: { kind: "menu", label: "Move actions" },
        },
      ],
      before,
      after,
      undefined,
      [],
      [],
    );

    expect(effects.map((effect) => effect.state)).toEqual([
      "observed",
      "observed",
    ]);
    expect(classifyActionOutcome(effects)).toBe("applied");
  });
});
