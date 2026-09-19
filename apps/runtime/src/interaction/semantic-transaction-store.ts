import { randomUUID } from "node:crypto";

import {
  RoveError,
  type ActionOutcome,
  type ActionReceipt,
  type BeginSemanticTransactionRequest,
  type EffectVerification,
  type ExpectedTarget,
  type SemanticTransactionPhase,
  type SemanticTransactionSnapshot,
  type SemanticTransactionDestination,
  type RoveErrorCode,
} from "@rove/protocol";

interface TransactionRecord {
  snapshot: SemanticTransactionSnapshot;
  inFlight: boolean;
}

function clone(
  snapshot: SemanticTransactionSnapshot,
): SemanticTransactionSnapshot {
  return structuredClone(snapshot);
}

function terminal(status: SemanticTransactionSnapshot["status"]): boolean {
  return ["verified", "not_applied", "uncertain", "cancelled"].includes(status);
}

function sameDestination(
  left: SemanticTransactionDestination,
  right: SemanticTransactionDestination,
): boolean {
  if (left.verification !== right.verification) return false;
  if (
    left.verification === "within_scope" &&
    right.verification === "within_scope"
  ) {
    return (
      left.scope.kind === right.scope.kind &&
      left.scope.label === right.scope.label
    );
  }
  return (
    left.verification === "destination_observation" &&
    right.verification === "destination_observation" &&
    left.label === right.label
  );
}

export class SemanticTransactionStore {
  private readonly transactions = new Map<string, TransactionRecord>();
  private readonly consequenceIndex = new Map<string, string>();

  begin(
    sessionId: string,
    input: BeginSemanticTransactionRequest,
    source: ExpectedTarget,
  ): SemanticTransactionSnapshot {
    const consequenceIdentity = this.consequenceIdentity(
      sessionId,
      input.consequenceKey,
    );
    const existingId = this.consequenceIndex.get(consequenceIdentity);
    if (existingId !== undefined) {
      const existing = this.require(sessionId, existingId).snapshot;
      const same =
        existing.kind === input.kind &&
        existing.mechanism === input.mechanism &&
        existing.sourceAuthority.pageId === input.sourceTarget.pageId &&
        existing.sourceAuthority.revision === input.sourceTarget.revision &&
        existing.sourceAuthority.ref === input.sourceTarget.ref &&
        existing.source.name === source.name &&
        existing.source.kind === source.kind &&
        sameDestination(existing.destination, input.destination);
      if (!same) {
        throw new RoveError({
          code: "TRANSACTION_CONFLICT",
          message:
            "The consequence key already identifies a different semantic transaction.",
        });
      }
      return clone(existing);
    }

    const now = new Date().toISOString();
    const snapshot: SemanticTransactionSnapshot = {
      transactionId: `tx_${randomUUID().replaceAll("-", "")}`,
      sessionId,
      kind: input.kind,
      status: "prepared",
      mechanism: input.mechanism,
      sourceAuthority: input.sourceTarget,
      source,
      destination: input.destination,
      consequenceKey: input.consequenceKey,
      createdAt: now,
      updatedAt: now,
      steps: [],
    };
    this.transactions.set(snapshot.transactionId, {
      snapshot,
      inFlight: false,
    });
    this.consequenceIndex.set(consequenceIdentity, snapshot.transactionId);
    return clone(snapshot);
  }

  get(sessionId: string, transactionId: string): SemanticTransactionSnapshot {
    return clone(this.require(sessionId, transactionId).snapshot);
  }

  existingFor(
    sessionId: string,
    consequenceKey: string,
  ): SemanticTransactionSnapshot | undefined {
    const transactionId = this.consequenceIndex.get(
      this.consequenceIdentity(sessionId, consequenceKey),
    );
    return transactionId === undefined
      ? undefined
      : this.get(sessionId, transactionId);
  }

  acquireAdvance(
    sessionId: string,
    transactionId: string,
    observationId: string,
  ): SemanticTransactionSnapshot {
    const record = this.require(sessionId, transactionId);
    if (record.inFlight) {
      throw new RoveError({
        code: "TRANSACTION_CONFLICT",
        message: "The semantic transaction already has an in-flight operation.",
      });
    }
    if (
      terminal(record.snapshot.status) ||
      record.snapshot.status === "committed"
    ) {
      throw new RoveError({
        code: "TRANSACTION_STATE_INVALID",
        message: `The semantic transaction cannot advance from ${record.snapshot.status}.`,
      });
    }
    const lastObservationId =
      record.snapshot.steps.at(-1)?.predecessorObservationId;
    if (lastObservationId === observationId) {
      throw new RoveError({
        code: "TRANSACTION_STATE_INVALID",
        message:
          "Each semantic transaction phase must use a fresh post-phase observation.",
        retryable: true,
      });
    }
    record.inFlight = true;
    return clone(record.snapshot);
  }

  releaseAdvance(sessionId: string, transactionId: string): void {
    this.require(sessionId, transactionId).inFlight = false;
  }

  recordStep(
    sessionId: string,
    transactionId: string,
    phase: SemanticTransactionPhase,
    receipt: ActionReceipt,
    options: { acceptCompletedPrepareDispatch?: boolean } = {},
  ): SemanticTransactionSnapshot {
    const record = this.require(sessionId, transactionId);
    if (!record.inFlight) {
      throw new RoveError({
        code: "TRANSACTION_STATE_INVALID",
        message:
          "The semantic transaction does not have an acquired operation.",
      });
    }
    const trustedPrepareDispatch =
      phase === "prepare" &&
      options.acceptCompletedPrepareDispatch === true &&
      receipt.dispatched &&
      receipt.dispatchStatus === "completed" &&
      receipt.outcome === "unknown";
    record.snapshot.steps.push({
      phase,
      receiptId: receipt.receiptId,
      action: receipt.action,
      outcome: receipt.outcome,
      dispatchStatus: receipt.dispatchStatus,
      evidenceBasis:
        receipt.outcome === "applied"
          ? "verified_effect"
          : trustedPrepareDispatch
            ? "trusted_dispatch"
            : "unverified",
      ...(receipt.predecessorObservationId === undefined
        ? {}
        : { predecessorObservationId: receipt.predecessorObservationId }),
      ...(receipt.successorObservationId === undefined
        ? {}
        : { successorObservationId: receipt.successorObservationId }),
    });
    record.snapshot.status = this.statusAfterStep(
      phase,
      receipt.outcome,
      receipt.dispatchStatus,
      trustedPrepareDispatch,
    );
    record.snapshot.updatedAt = new Date().toISOString();
    record.inFlight = false;
    return clone(record.snapshot);
  }

  recordVerification(
    sessionId: string,
    transactionId: string,
    observationId: string,
    outcome: ActionOutcome,
    effects: EffectVerification[],
  ): SemanticTransactionSnapshot {
    const record = this.require(sessionId, transactionId);
    const retryingUnknownVerification =
      record.snapshot.status === "uncertain" &&
      record.snapshot.verification?.outcome === "unknown";
    if (
      record.inFlight ||
      (record.snapshot.status !== "committed" && !retryingUnknownVerification)
    ) {
      throw new RoveError({
        code: "TRANSACTION_STATE_INVALID",
        message:
          "Only a committed semantic transaction without in-flight work can be verified.",
      });
    }
    if (
      record.snapshot.steps.at(-1)?.predecessorObservationId === observationId ||
      record.snapshot.verification?.observationId === observationId
    ) {
      throw new RoveError({
        code: "TRANSACTION_STATE_INVALID",
        message:
          "Final semantic transaction verification requires a fresh post-commit observation.",
        retryable: true,
      });
    }
    record.snapshot.status =
      outcome === "applied"
        ? "verified"
        : outcome === "not_applied"
          ? "not_applied"
          : "uncertain";
    record.snapshot.updatedAt = new Date().toISOString();
    record.snapshot.verification = { observationId, outcome, effects };
    return clone(record.snapshot);
  }

  recordCommitSettlement(
    sessionId: string,
    consequenceKey: string,
    outcome: "applied" | "not_applied",
  ): SemanticTransactionSnapshot | undefined {
    const transactionId = this.consequenceIndex.get(
      this.consequenceIdentity(sessionId, consequenceKey),
    );
    if (transactionId === undefined) return undefined;

    const record = this.require(sessionId, transactionId);
    const hasCommit = record.snapshot.steps.some(
      (step) => step.phase === "commit",
    );
    if (!hasCommit) return clone(record.snapshot);

    if (outcome === "not_applied") {
      record.snapshot.status = "not_applied";
    } else if (
      record.snapshot.status === "uncertain" &&
      record.snapshot.verification === undefined
    ) {
      record.snapshot.status = "committed";
    }
    record.snapshot.updatedAt = new Date().toISOString();
    return clone(record.snapshot);
  }

  recordDegradation(
    sessionId: string,
    transactionId: string,
    code: RoveErrorCode,
  ): SemanticTransactionSnapshot {
    const record = this.require(sessionId, transactionId);
    record.snapshot.degradations ??= [];
    record.snapshot.degradations.push({
      stage: "transaction_persistence",
      code,
    });
    record.snapshot.updatedAt = new Date().toISOString();
    return clone(record.snapshot);
  }

  cancel(
    sessionId: string,
    transactionId: string,
  ): SemanticTransactionSnapshot {
    const record = this.require(sessionId, transactionId);
    if (
      record.inFlight ||
      (record.snapshot.status !== "prepared" &&
        record.snapshot.status !== "in_progress")
    ) {
      throw new RoveError({
        code: "TRANSACTION_STATE_INVALID",
        message: "A semantic transaction can be cancelled only before commit.",
      });
    }
    record.snapshot.status = "cancelled";
    record.snapshot.updatedAt = new Date().toISOString();
    return clone(record.snapshot);
  }

  clearSession(sessionId: string): void {
    for (const [transactionId, record] of this.transactions) {
      if (record.snapshot.sessionId !== sessionId) continue;
      this.transactions.delete(transactionId);
      this.consequenceIndex.delete(
        this.consequenceIdentity(sessionId, record.snapshot.consequenceKey),
      );
    }
  }

  private statusAfterStep(
    phase: SemanticTransactionPhase,
    outcome: ActionOutcome,
    dispatchStatus: ActionReceipt["dispatchStatus"],
    trustedPrepareDispatch: boolean,
  ): SemanticTransactionSnapshot["status"] {
    // Positive successor evidence resolves dispatch ambiguity for the requested
    // business effect. Preserve transport/action degradations on the receipt,
    // but never strand an applied transaction or encourage a duplicate replay.
    if (outcome === "applied") {
      return phase === "commit" ? "committed" : "in_progress";
    }
    if (phase === "commit" && outcome === "not_applied") {
      return "not_applied";
    }
    if (trustedPrepareDispatch) {
      return "in_progress";
    }
    if (dispatchStatus === "uncertain" || outcome === "unknown") {
      return "uncertain";
    }
    return "in_progress";
  }

  private require(sessionId: string, transactionId: string): TransactionRecord {
    const record = this.transactions.get(transactionId);
    if (record === undefined || record.snapshot.sessionId !== sessionId) {
      throw new RoveError({
        code: "TRANSACTION_NOT_FOUND",
        message: "The semantic transaction was not found in this session.",
      });
    }
    return record;
  }

  private consequenceIdentity(
    sessionId: string,
    consequenceKey: string,
  ): string {
    return `${sessionId}:${consequenceKey}`;
  }
}
