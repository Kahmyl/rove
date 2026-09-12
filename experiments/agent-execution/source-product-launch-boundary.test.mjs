import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateLaunchBoundary } from "./source-product-launch-boundary.mjs";

const operationId = "intent_11111111-1111-4111-a111-111111111111";
const identity = {
  taskId: "task_fresh",
  operationId,
  sessionId: "ses_fresh",
  threadId: "thread_fresh",
  turnId: "turn_fresh",
};
const baseTask = {
  taskId: identity.taskId,
  roveSessionId: identity.sessionId,
  codexThreadId: identity.threadId,
  initialLaunch: {
    stage: "turn_started",
    operationId: identity.operationId,
    turnId: identity.turnId,
  },
  lifecycle: { phase: "working" },
  conversation: { items: {} },
};
const initialItem = {
  id: "item_initial",
  kind: "user_message",
  turnId: identity.turnId,
  clientId: identity.operationId,
};

function evaluate(task, overrides = {}) {
  return evaluateLaunchBoundary({
    state: {
      revision: 7,
      product: { tasks: [{ taskId: "task_old" }, task] },
    },
    priorTaskIds: ["task_old"],
    priorLedger: [],
    expectedIdentity: undefined,
    terminalPhases: new Set(["closed", "failed"]),
    ...overrides,
  });
}

test("turn_started before its projected user item remains pending", () => {
  assert.deepEqual(evaluate(baseTask), { status: "pending", identity });
});

test("the exact initial user item completes the launch boundary", () => {
  const task = {
    ...baseTask,
    conversation: { items: { [initialItem.id]: initialItem } },
  };
  const result = evaluate(task);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.identity, identity);
  assert.equal(result.item, initialItem);
});

test("duplicate, mismatched, and conflicting launch identity are invalid", () => {
  const duplicate = {
    ...baseTask,
    conversation: {
      items: {
        first: initialItem,
        second: { ...initialItem, id: "item_duplicate" },
      },
    },
  };
  assert.match(evaluate(duplicate).reason, /multiple initial user items/);
  const mismatched = {
    ...baseTask,
    conversation: {
      items: {
        wrong: { ...initialItem, turnId: "turn_other" },
      },
    },
  };
  assert.match(evaluate(mismatched).reason, /conflicting turn identity/);
  for (const field of [
    "taskId",
    "operationId",
    "sessionId",
    "threadId",
    "turnId",
  ])
    assert.match(
      evaluate(baseTask, {
        expectedIdentity: { ...identity, [field]: `${field}_other` },
      }).reason,
      new RegExp(`${field} changed|observed launch task disappeared`),
    );
  assert.match(
    evaluate({
      ...baseTask,
      conversation: {
        items: {
          initial: { ...initialItem, clientId: "intent_other" },
        },
      },
    }).reason,
    /conflicting client identity/,
  );
  assert.match(
    evaluate({ ...baseTask, lifecycle: { phase: "failed" } }).reason,
    /terminal before initial user projection/,
  );
});

test("unrelated tasks and non-user items do not satisfy the boundary", () => {
  assert.equal(
    evaluateLaunchBoundary({
      state: {
        revision: 8,
        product: {
          tasks: [
            {
              ...baseTask,
              taskId: "task_old",
              conversation: { items: { initial: initialItem } },
            },
          ],
        },
      },
      priorTaskIds: ["task_old"],
      priorLedger: [],
      terminalPhases: new Set(["closed", "failed"]),
    }).status,
    "pending",
  );
  assert.equal(
    evaluate({
      ...baseTask,
      conversation: {
        items: {
          unrelated: {
            id: "item_agent",
            kind: "assistant_message",
            turnId: identity.turnId,
          },
        },
      },
    }).status,
    "pending",
  );
});

test("a duplicate prior ledger identity remains invalid", () => {
  const task = {
    ...baseTask,
    conversation: { items: { [initialItem.id]: initialItem } },
  };
  assert.match(
    evaluate(task, {
      priorLedger: [{ ...identity, taskId: "task_prior" }],
    }).reason,
    /duplicates the accumulated ledger/,
  );
});
