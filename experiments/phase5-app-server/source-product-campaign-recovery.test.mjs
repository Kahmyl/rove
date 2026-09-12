import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";

import {
  parseRunOwnedRecovery,
  postCloseArchiveDisposition,
  selectRunOwnedRecoveryTask,
  waitForPostCloseArchiveDisposition,
} from "./source-product-campaign-recovery.mjs";

const tuple = {
  taskId: "task_owned",
  sessionId: "ses_owned",
  operationId: "intent_11111111-1111-4111-a111-111111111111",
};
const task = {
  taskId: tuple.taskId,
  roveSessionId: tuple.sessionId,
  initialLaunch: { operationId: tuple.operationId },
  lifecycle: { phase: "working" },
};

test("campaign recovery adopts only an exact nonterminal ownership triple", () => {
  assert.deepEqual(
    parseRunOwnedRecovery([
      `--recover-run-owned=${tuple.taskId},${tuple.sessionId},${tuple.operationId}`,
    ]),
    tuple,
  );
  assert.equal(
    selectRunOwnedRecoveryTask([task], tuple, new Set(["closed", "failed"])),
    task,
  );
  for (const mismatch of [
    { ...tuple, taskId: "task_other" },
    { ...tuple, sessionId: "ses_other" },
    {
      ...tuple,
      operationId: "intent_22222222-2222-4222-a222-222222222222",
    },
  ])
    assert.throws(
      () =>
        selectRunOwnedRecoveryTask(
          [task],
          mismatch,
          new Set(["closed", "failed"]),
        ),
      /not found exactly once|does not exactly match/,
    );
});

test("campaign recovery rejects malformed, duplicate, and unsafe terminal adoption", () => {
  assert.equal(parseRunOwnedRecovery([]), null);
  assert.throws(
    () => parseRunOwnedRecovery(["--recover-run-owned=task_owned,ses_owned"]),
    /taskId,sessionId,operationId/,
  );
  assert.throws(
    () =>
      parseRunOwnedRecovery([
        `--recover-run-owned=${tuple.taskId},${tuple.sessionId},${tuple.operationId}`,
        `--recover-run-owned=${tuple.taskId},${tuple.sessionId},${tuple.operationId}`,
      ]),
    /exactly once/,
  );
  assert.throws(
    () =>
      selectRunOwnedRecoveryTask(
        [
          {
            ...task,
            lifecycle: { phase: "closed" },
            codexThreadId: "thread_owned",
            conversation: { archived: false },
            availableActions: [],
          },
        ],
        tuple,
        new Set(["closed", "failed"]),
      ),
    /archive state is unsafe/,
  );
});

test("campaign recovery adopts exact closed tasks with safe archive disposition", () => {
  const terminalPhases = new Set(["closed", "failed"]);
  const closedUnarchived = {
    ...task,
    lifecycle: { phase: "closed" },
    codexThreadId: "thread_owned",
    conversation: { archived: false },
    availableActions: ["archive"],
  };
  const archived = {
    ...closedUnarchived,
    conversation: { archived: true },
    availableActions: [],
  };
  assert.equal(
    selectRunOwnedRecoveryTask([closedUnarchived], tuple, terminalPhases),
    closedUnarchived,
  );
  assert.equal(
    selectRunOwnedRecoveryTask([archived], tuple, terminalPhases),
    archived,
  );
  assert.equal(postCloseArchiveDisposition(closedUnarchived), "archive");
  assert.equal(postCloseArchiveDisposition(archived), "settled");
});

test("post-close archive handling distinguishes reopen, settled, and threadless tasks", () => {
  assert.equal(
    postCloseArchiveDisposition({
      codexThreadId: "thread_1",
      conversation: { archived: false },
      availableActions: ["archive"],
    }),
    "archive",
  );
  assert.equal(
    postCloseArchiveDisposition({
      codexThreadId: "thread_1",
      conversation: { archived: true },
      availableActions: [],
    }),
    "settled",
  );
  assert.equal(
    postCloseArchiveDisposition({ availableActions: [] }),
    "not_applicable",
  );
  assert.equal(
    postCloseArchiveDisposition({
      codexThreadId: "thread_1",
      conversation: { archived: false },
      availableActions: [],
    }),
    "missing",
  );
});

test("post-close archive handling waits for asynchronous cleanup convergence", async () => {
  let clock = 0;
  const tasks = [
    {
      taskId: "task_owned",
      codexThreadId: "thread_1",
      conversation: { archived: false },
      availableActions: ["retry_cleanup"],
    },
    {
      taskId: "task_owned",
      codexThreadId: "thread_1",
      conversation: { archived: true },
      availableActions: [],
    },
  ];
  const result = await waitForPostCloseArchiveDisposition({
    readTask: async () => tasks.shift() ?? tasks.at(-1),
    wait: async (milliseconds) => {
      clock += milliseconds;
    },
    timeoutMs: 1_000,
    pollMs: 100,
    now: () => clock,
  });
  assert.equal(result.disposition, "settled");
  assert.equal(result.task.conversation.archived, true);
});

test("post-close archive handling retains missing when cleanup cannot converge", async () => {
  let clock = 0;
  const task = {
    taskId: "task_owned",
    codexThreadId: "thread_1",
    conversation: { archived: false },
    availableActions: ["retry_cleanup"],
  };
  const result = await waitForPostCloseArchiveDisposition({
    readTask: async () => task,
    wait: async (milliseconds) => {
      clock += milliseconds;
    },
    timeoutMs: 200,
    pollMs: 100,
    now: () => clock,
  });
  assert.equal(result.disposition, "missing");
  assert.equal(result.task, task);
});

test("closed-task archive navigation waits on the renderer control, not active-task identity", () => {
  const source = readFileSync(
    new URL("./source-product-stabilization-campaign.mjs", import.meta.url),
    "utf8",
  );
  const finishTask = source.slice(
    source.indexOf("async function finishTask"),
    source.indexOf("async function cleanupRunOwned"),
  );
  assert.match(finishTask, /Task history: \$\{taskId\}/);
  assert.match(finishTask, /archive\.click\(\{ trial: true/);
  assert.doesNotMatch(finishTask, /currentTaskId/);
});
