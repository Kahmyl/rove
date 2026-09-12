import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateTerminalCleanliness } from "./source-product-terminal-cleanliness.mjs";

const handovers = [5, 7].map((number) => ({
  scenario: `handover-${String(number).padStart(2, "0")}`,
  kind: "handover",
  taskId: `task_handover_${number}`,
  sessionId: `ses_handover_${number}`,
  threadId: `thread_handover_${number}`,
  turnId: `turn_handover_${number}`,
}));

function task(entry) {
  return {
    taskId: entry.taskId,
    roveSessionId: entry.sessionId,
    codexThreadId: entry.threadId,
    lifecycle: { phase: "closed" },
    conversation: { archived: true },
    attachments: [],
    runtime: { status: "completed" },
  };
}

function attention(entry, status = "resolved") {
  return {
    authority: "rove_control",
    kind: "control_handoff",
    requestId: `control_${entry.taskId}`,
    taskId: entry.taskId,
    threadId: entry.threadId,
    turnId: entry.turnId,
    status,
  };
}

function cleanState() {
  return {
    companion: null,
    product: {
      tasks: handovers.map(task),
      attention: handovers.map((entry) => attention(entry)),
      fileAttention: [],
      recoveryWarnings: [],
    },
  };
}

function evaluate(state = cleanState(), ledger = handovers) {
  return evaluateTerminalCleanliness({
    state,
    runOwnedTaskIds: handovers.map((entry) => entry.taskId),
    ledger,
  });
}

test("resolved handover history is positive terminal evidence", () => {
  const result = evaluate();
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.evidence.resolvedHandoverAttentionCount, 2);
});

test("pending, responding, resolution-unknown, and unknown attention reject", () => {
  for (const status of [
    "pending",
    "responding",
    "awaiting_confirmation",
    "resolution_unknown",
    "unknown",
  ]) {
    const state = cleanState();
    state.product.attention[0] = attention(handovers[0], status);
    assert.match(evaluate(state).violations.join("|"), /attention_nonterminal/);
  }
});

test("resolved, cancelled, and stale non-handover audit records are terminal", () => {
  for (const status of ["resolved", "cancelled", "stale"]) {
    const state = cleanState();
    state.product.attention.push({
      authority: "codex",
      kind: "command_approval",
      requestId: `audit_${status}`,
      taskId: handovers[0].taskId,
      threadId: handovers[0].threadId,
      turnId: handovers[0].turnId,
      status,
    });
    assert.equal(evaluate(state).ok, true);
  }
});

test("run-owned active companion rejects while unrelated baseline state is allowed", () => {
  const owned = cleanState();
  owned.companion = {
    session: { id: handovers[0].sessionId, status: "active" },
  };
  assert.match(evaluate(owned).violations.join("|"), /companion_nonterminal/);

  const unrelated = cleanState();
  unrelated.companion = {
    session: { id: "ses_baseline", status: "active" },
  };
  unrelated.product.attention.push({
    ...attention(handovers[0], "pending"),
    taskId: "task_baseline",
    requestId: "baseline_attention",
  });
  assert.equal(evaluate(unrelated).ok, true);
});

test("attachments, recovery, nonterminal lifecycle/runtime, and archive failures are exact", () => {
  const cases = [
    [
      "attachment_bytes_retained",
      (state) => state.product.tasks[0].attachments.push({ id: "attachment" }),
    ],
    [
      "recovery_warning",
      (state) =>
        state.product.recoveryWarnings.push(
          `${handovers[0].taskId}: recovery remains`,
        ),
    ],
    [
      "task_lifecycle_nonterminal",
      (state) => (state.product.tasks[0].lifecycle.phase = "cleanup_required"),
    ],
    [
      "runtime_nonterminal",
      (state) => (state.product.tasks[0].runtime.status = "active"),
    ],
    [
      "conversation_unarchived",
      (state) => (state.product.tasks[0].conversation.archived = false),
    ],
    [
      "file_attention",
      (state) =>
        state.product.fileAttention.push({
          requestId: "file_1",
          taskId: handovers[0].taskId,
          sessionId: handovers[0].sessionId,
          status: "pending",
        }),
    ],
  ];
  for (const [category, mutate] of cases) {
    const state = cleanState();
    mutate(state);
    assert.match(evaluate(state).violations.join("|"), new RegExp(category));
  }
});

test("handover history must be exactly two resolved identity-bound records", () => {
  const duplicate = cleanState();
  duplicate.product.attention.push({
    ...attention(handovers[0]),
    requestId: "duplicate_handoff",
  });
  assert.match(
    evaluate(duplicate).violations.join("|"),
    /handover_attention_count/,
  );

  const mismatch = cleanState();
  mismatch.product.attention[0].turnId = "turn_wrong";
  assert.match(
    evaluate(mismatch).violations.join("|"),
    /handover_attention_binding/,
  );
});
