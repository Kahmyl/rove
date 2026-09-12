import { describe, expect, it } from "vitest";

import {
  advanceSemanticTransactionRequestSchema,
  beginSemanticTransactionRequestSchema,
  expectedEffectSchema,
  verifySemanticTransactionRequestSchema,
} from "../src/index.js";

const sourceTarget = { pageId: "page_1", revision: 4, ref: "t1" };

describe("semantic transaction protocol", () => {
  it("requires a stable consequence identity and explicit destination verification", () => {
    expect(
      beginSemanticTransactionRequestSchema.parse({
        observationId: "bobs_1",
        kind: "transfer",
        sourceTarget,
        destination: {
          verification: "within_scope",
          scope: { kind: "list", label: "Archive" },
        },
        mechanism: "menu",
        consequenceKey: "move:quarterly-report:archive",
      }),
    ).toMatchObject({
      kind: "transfer",
      destination: {
        verification: "within_scope",
        scope: { kind: "list", label: "Archive" },
      },
    });

    expect(
      beginSemanticTransactionRequestSchema.parse({
        observationId: "bobs_1",
        kind: "transfer",
        sourceTarget,
        destination: {
          verification: "destination_observation",
          label: "Archive",
        },
        mechanism: "menu",
        consequenceKey: "move:quarterly-report:remote-archive",
      }).destination,
    ).toEqual({
      verification: "destination_observation",
      label: "Archive",
    });

    expect(() =>
      beginSemanticTransactionRequestSchema.parse({
        observationId: "bobs_1",
        kind: "transfer",
        sourceTarget,
        destination: { verification: "destination_observation" },
        mechanism: "menu",
        consequenceKey: "move:quarterly-report:archive",
      }),
    ).toThrow();

    expect(
      beginSemanticTransactionRequestSchema.parse({
        observationId: "bobs_1",
        kind: "transfer",
        sourceTarget,
        destination: { kind: "list", label: "Legacy Archive" },
        mechanism: "menu",
        consequenceKey: "move:quarterly-report:legacy-archive",
      }).destination,
    ).toEqual({
      verification: "within_scope",
      scope: { kind: "list", label: "Legacy Archive" },
    });
  });

  it("makes commit an explicit phase and forbids commit effects during prepare", () => {
    const base = {
      transactionId: "tx_123",
      observationId: "bobs_2",
      action: { kind: "click", target: sourceTarget },
      expectedEffects: [{ kind: "text_present", text: "Move actions" }],
    };

    expect(
      advanceSemanticTransactionRequestSchema.parse({
        ...base,
        phase: "commit",
        effect: "external_commit",
      }).phase,
    ).toBe("commit");

    expect(() =>
      advanceSemanticTransactionRequestSchema.parse({
        ...base,
        phase: "prepare",
        effect: "external_commit",
      }),
    ).toThrow();

    expect(
      advanceSemanticTransactionRequestSchema.parse({
        transactionId: "tx_123",
        observationId: "bobs_selected",
        phase: "prepare",
        action: { kind: "clipboard", operation: "cut" },
        expectedEffects: [],
      }).expectedEffects,
    ).toEqual([]);

    expect(() =>
      advanceSemanticTransactionRequestSchema.parse({
        ...base,
        phase: "prepare",
        expectedEffects: [],
      }),
    ).toThrow();

    expect(() =>
      advanceSemanticTransactionRequestSchema.parse({
        ...base,
        phase: "commit",
        expectedEffects: [],
      }),
    ).toThrow();
  });

  it("supports scope-relative verification without selector or coordinate authority", () => {
    expect(
      expectedEffectSchema.parse({
        kind: "target_within_scope",
        target: { name: "Quarterly report", kind: "button" },
        scope: { kind: "list", label: "Archive" },
      }),
    ).toMatchObject({ kind: "target_within_scope" });

    expect(
      verifySemanticTransactionRequestSchema.parse({
        transactionId: "tx_123",
        observationId: "bobs_3",
      }).additionalExpectedEffects,
    ).toEqual([]);
  });
});
