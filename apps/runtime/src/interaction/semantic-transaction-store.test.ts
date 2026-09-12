import { describe, expect, it } from "vitest";

import {
  RoveError,
  type ActionReceipt,
  type BeginSemanticTransactionRequest,
} from "@rove/protocol";

import { SemanticTransactionStore } from "./semantic-transaction-store.js";

const request: BeginSemanticTransactionRequest = {
  observationId: "bobs_1",
  kind: "transfer",
  sourceTarget: { pageId: "page_1", revision: 1, ref: "t1" },
  destination: {
    verification: "within_scope",
    scope: { kind: "list", label: "Archive" },
  },
  mechanism: "menu",
  consequenceKey: "move:quarterly-report:archive",
};

function receipt(
  outcome: ActionReceipt["outcome"],
  dispatchStatus: ActionReceipt["dispatchStatus"] = "completed",
  predecessorObservationId = "bobs_1",
): ActionReceipt {
  return {
    receiptId: `rcpt_${outcome}`,
    sessionId: "session_1",
    action: "click",
    dispatched: true,
    dispatchStatus,
    outcome,
    consequential: false,
    predecessorObservationId,
    effects: [],
  };
}

function expectCode(operation: () => unknown, code: RoveError["code"]): void {
  try {
    operation();
    throw new Error("Expected operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(RoveError);
    expect((error as RoveError).code).toBe(code);
  }
}

describe("SemanticTransactionStore", () => {
  it("deduplicates a consequence identity and rejects conflicting reuse", () => {
    const store = new SemanticTransactionStore();
    const source = { name: "Quarterly report", kind: "button" as const };
    const first = store.begin("session_1", request, source);
    const duplicate = store.begin("session_1", request, source);

    expect(duplicate.transactionId).toBe(first.transactionId);

    expectCode(
      () =>
        store.begin(
          "session_1",
          {
            ...request,
            destination: {
              verification: "within_scope",
              scope: { kind: "list", label: "Later" },
            },
          },
          source,
        ),
      "TRANSACTION_CONFLICT",
    );
    expectCode(
      () =>
        store.begin(
          "session_1",
          {
            ...request,
            sourceTarget: { pageId: "page_1", revision: 1, ref: "t2" },
          },
          source,
        ),
      "TRANSACTION_CONFLICT",
    );
  });

  it("crosses commit once, verifies terminally, and refuses replay", () => {
    const store = new SemanticTransactionStore();
    const transaction = store.begin("session_1", request, {
      name: "Quarterly report",
      kind: "button",
    });

    store.acquireAdvance("session_1", transaction.transactionId, "bobs_1");
    expect(
      store.recordStep(
        "session_1",
        transaction.transactionId,
        "prepare",
        receipt("applied"),
      ).status,
    ).toBe("in_progress");

    expectCode(
      () =>
        store.acquireAdvance("session_1", transaction.transactionId, "bobs_1"),
      "TRANSACTION_STATE_INVALID",
    );
    store.acquireAdvance("session_1", transaction.transactionId, "bobs_2");
    expect(
      store.recordStep(
        "session_1",
        transaction.transactionId,
        "commit",
        receipt("applied", "completed", "bobs_2"),
      ).status,
    ).toBe("committed");

    expect(
      store.recordVerification(
        "session_1",
        transaction.transactionId,
        "bobs_final",
        "applied",
        [],
      ).status,
    ).toBe("verified");

    expectCode(
      () =>
        store.acquireAdvance("session_1", transaction.transactionId, "bobs_3"),
      "TRANSACTION_STATE_INVALID",
    );
    expectCode(
      () => store.cancel("session_1", transaction.transactionId),
      "TRANSACTION_STATE_INVALID",
    );
  });

  it("makes an unknown dispatch terminal and records persistence degradation", () => {
    const store = new SemanticTransactionStore();
    const transaction = store.begin("session_1", request, {
      name: "Quarterly report",
    });
    store.acquireAdvance("session_1", transaction.transactionId, "bobs_1");
    expect(
      store.recordStep(
        "session_1",
        transaction.transactionId,
        "commit",
        receipt("unknown", "uncertain"),
      ).status,
    ).toBe("uncertain");

    expectCode(
      () =>
        store.acquireAdvance("session_1", transaction.transactionId, "bobs_2"),
      "TRANSACTION_STATE_INVALID",
    );
    expect(
      store.recordDegradation(
        "session_1",
        transaction.transactionId,
        "EVIDENCE_WRITE_FAILED",
      ).degradations,
    ).toEqual([
      {
        stage: "transaction_persistence",
        code: "EVIDENCE_WRITE_FAILED",
      },
    ]);
  });

  it("treats positive successor evidence as authoritative over dispatch ambiguity", () => {
    const store = new SemanticTransactionStore();
    const transaction = store.begin("session_1", request, {
      name: "Quarterly report",
    });
    store.acquireAdvance("session_1", transaction.transactionId, "bobs_1");

    expect(
      store.recordStep(
        "session_1",
        transaction.transactionId,
        "commit",
        receipt("applied", "uncertain"),
      ).status,
    ).toBe("committed");
  });

  it("advances a non-consequential prepare on explicitly accepted trusted dispatch", () => {
    const store = new SemanticTransactionStore();
    const transaction = store.begin("session_1", request, {
      name: "Quarterly report",
    });
    store.acquireAdvance("session_1", transaction.transactionId, "bobs_1");

    const updated = store.recordStep(
      "session_1",
      transaction.transactionId,
      "prepare",
      receipt("unknown", "completed"),
      { acceptCompletedPrepareDispatch: true },
    );

    expect(updated).toMatchObject({
      status: "in_progress",
      steps: [
        {
          outcome: "unknown",
          dispatchStatus: "completed",
          evidenceBasis: "trusted_dispatch",
        },
      ],
    });
  });

  it("does not advance prepare when trusted dispatch was uncertain", () => {
    const store = new SemanticTransactionStore();
    const transaction = store.begin("session_1", request, {
      name: "Quarterly report",
    });
    store.acquireAdvance("session_1", transaction.transactionId, "bobs_1");

    expect(
      store.recordStep(
        "session_1",
        transaction.transactionId,
        "prepare",
        receipt("unknown", "uncertain"),
        { acceptCompletedPrepareDispatch: true },
      ),
    ).toMatchObject({
      status: "uncertain",
      steps: [{ evidenceBasis: "unverified" }],
    });
  });
});
