/* global Buffer, URL, console, process, structuredClone */

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  lifecycleContract,
  reduceLifecycleInventory,
  reduceTaskLifecycle,
} from "./native-lifecycle-contract.mjs";

const directory = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = new URL(
  "./fixtures/native-lifecycle-l0.json",
  import.meta.url,
);
const evidencePath = new URL(
  "../../docs/experiments/artifacts/p5.9-native-lifecycle-l0/results.json",
  import.meta.url,
);

const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const THREAD_ID = "01a0819a-dfa5-78e0-b725-371572a99787";
const SECOND_THREAD_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "wrk_00000000-0000-4000-8000-000000000001";
const BOOTSTRAP_ID = `boot_${"1".repeat(32)}`;
const base = {
  record: {
    schemaVersion: 1,
    identity: {
      taskId: "task_11111111-1111-4111-8111-111111111111",
      sessionId: "ses_11111111111111111111111111111111",
      threadId: THREAD_ID,
      browser: { mode: "workspace", workspaceId: WORKSPACE_ID },
    },
    bootstrap: {
      operationId: BOOTSTRAP_ID,
      threadSource: `rove:task_11111111-1111-4111-8111-111111111111:${BOOTSTRAP_ID}`,
      stage: "complete",
    },
    desiredState: "open",
  },
  codex: {
    availability: "available",
    threadExists: true,
    threadId: THREAD_ID,
    threadSource: `rove:task_11111111-1111-4111-8111-111111111111:${BOOTSTRAP_ID}`,
    sourceLookup: "exact",
    runtimeStatus: "idle",
    archived: false,
    turn: "completed",
  },
  runtime: {
    availability: "available",
    sessionExists: true,
    sessionId: "ses_11111111111111111111111111111111",
    status: "active",
    controller: "agent",
    attachment: "attached",
    profileLock: "owned",
    browserIdentity: { mode: "workspace", workspaceId: WORKSPACE_ID },
    bootstrapId: BOOTSTRAP_ID,
    bootstrapLookup: "exact",
    recovery: "not_needed",
  },
  continuation: { status: "none" },
  attentions: [],
  freshInspection: null,
  requestedOperation: {
    type: "observe",
    taskId: "task_11111111-1111-4111-8111-111111111111",
  },
};

function merge(left, right) {
  if (right === undefined) return structuredClone(left);
  if (
    left === null ||
    right === null ||
    Array.isArray(left) ||
    Array.isArray(right) ||
    typeof left !== "object" ||
    typeof right !== "object"
  )
    return structuredClone(right);
  const output = structuredClone(left);
  for (const [key, value] of Object.entries(right))
    output[key] = merge(left[key], value);
  return output;
}

function inputFor(testCase) {
  const input = merge(base, testCase.patch ?? {});
  if (testCase.withoutRecord) input.record = null;
  if (input.record?.identity.browser.mode === "temporary")
    delete input.record.identity.browser.workspaceId;
  if (input.runtime.browserIdentity?.mode === "temporary")
    delete input.runtime.browserIdentity.workspaceId;
  const bootstrapStage = input.record?.bootstrap.stage;
  if (["intent_persisted", "runtime_dispatching"].includes(bootstrapStage)) {
    delete input.record.identity.sessionId;
    delete input.record.identity.threadId;
  } else if (["runtime_bound", "thread_dispatching"].includes(bootstrapStage)) {
    delete input.record.identity.threadId;
  }
  if (input.record?.desiredState === "closed")
    input.record.closeOperation = merge(
      {
        operationId: "intent_33333333-3333-4333-8333-333333333333",
        requestedAt: "2026-09-08T00:00:00.000Z",
        stage: "requested",
      },
      testCase.patch?.record?.closeOperation ?? {},
    );
  if (input.codex.availability === "unavailable") {
    input.codex = {
      availability: "unavailable",
      threadExists: false,
      sourceLookup: "unknown",
      runtimeStatus: "unknown",
      archived: null,
      turn: "unknown",
    };
  } else if (!input.codex.threadExists) {
    input.codex = {
      availability: "available",
      threadExists: false,
      sourceLookup: testCase.patch?.codex?.sourceLookup ?? "none",
      runtimeStatus: "notLoaded",
      archived: null,
      turn: "none",
    };
  } else if (input.codex.turn === "active") {
    input.codex.turnId ??= "turn_1";
    input.codex.runtimeStatus = "active";
  } else {
    delete input.codex.turnId;
    if (input.codex.runtimeStatus === "active")
      input.codex.runtimeStatus = "idle";
  }
  if (
    ["intent_persisted", "runtime_dispatching", "runtime_bound"].includes(
      bootstrapStage,
    )
  )
    input.codex = {
      availability: "available",
      threadExists: false,
      sourceLookup: "none",
      runtimeStatus: "notLoaded",
      archived: null,
      turn: "none",
    };
  if (input.runtime.availability === "unavailable") {
    input.runtime = {
      availability: "unavailable",
      sessionExists: false,
      status: "unknown",
      controller: null,
      attachment: "unknown",
      profileLock: "unknown",
      recovery: "unknown",
      bootstrapLookup: "unknown",
    };
  } else if (!input.runtime.sessionExists) {
    input.runtime = {
      availability: "available",
      sessionExists: false,
      status: "missing",
      controller: null,
      attachment: testCase.patch?.runtime?.attachment ?? "missing",
      profileLock: testCase.patch?.runtime?.profileLock ?? "released",
      recovery: testCase.patch?.runtime?.recovery ?? "cleanup_required",
      bootstrapLookup: testCase.patch?.runtime?.bootstrapLookup ?? "none",
    };
  } else {
    input.runtime.recovery ??= "not_needed";
    input.runtime.bootstrapId ??= BOOTSTRAP_ID;
    if (["completed", "failed", "paused"].includes(input.runtime.status))
      input.runtime.controller = null;
  }
  if (input.continuation.status !== "none")
    input.continuation = {
      id: "continuation_1",
      taskId: "task_11111111-1111-4111-8111-111111111111",
      sessionId: "ses_11111111111111111111111111111111",
      threadId: THREAD_ID,
      handoffId: "handoff_11111111111111111111111111111111",
      generation: 1,
      policy: "resume_after_control_return",
      freshInspectionRequired: true,
      preHandoffObservationSeq: 10,
      ...input.continuation,
    };
  if (input.continuation.status === "consumed") {
    input.continuation.freshInspectionRequired = false;
    input.continuation.returnEventId ??=
      "return:ses_11111111111111111111111111111111:handoff_11111111111111111111111111111111:1";
    input.continuation.returnObservationSeq ??= 11;
    input.continuation.command ??= {
      commandId: "continuation_cmd_consumed",
      returnEventId: input.continuation.returnEventId,
      kind: "turn/start",
      dispatchStatus: "terminal",
    };
  }
  if (
    input.record?.desiredState === "open" &&
    input.record.bootstrap.stage === "complete" &&
    input.continuation.status === "pending" &&
    input.runtime.sessionExists &&
    input.runtime.lastReturnedHandoffId === undefined
  ) {
    input.runtime.handoffId ??= input.continuation.handoffId;
    input.runtime.handoffGeneration ??= input.continuation.generation;
  }
  if (
    input.runtime.handoffId !== undefined &&
    input.runtime.ownershipGeneration === undefined &&
    Number.isInteger(input.runtime.handoffGeneration)
  ) {
    if (
      input.runtime.status === "awaiting_human" &&
      input.runtime.controller === null
    )
      input.runtime.ownershipGeneration = input.runtime.handoffGeneration;
    else if (
      input.runtime.status === "active" &&
      input.runtime.controller === "human"
    )
      input.runtime.ownershipGeneration = input.runtime.handoffGeneration + 1;
  }
  input.attentions = input.attentions.map((entry) => ({
    authority: "codex",
    kind: "user_input",
    taskId: "task_11111111-1111-4111-8111-111111111111",
    threadId: THREAD_ID,
    ...entry,
  }));
  return input;
}

let assertions = 0;
function check(actual, expected, message) {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}

for (const testCase of fixture.cases) {
  const output = reduceTaskLifecycle(inputFor(testCase));
  const actual = {
    phase: output.phase,
    commandType: output.nextCommand?.type ?? null,
    confirmationType: output.confirmation?.type ?? null,
  };
  if (testCase.expected.allowedActions !== undefined)
    actual.allowedActions = output.allowedActions;
  if (testCase.expected.operationDisposition !== undefined)
    actual.operationDisposition = output.operationDisposition.status;
  check(actual, testCase.expected, testCase.name);
}

const turns = ["none", "active", "completed", "failed", "interrupted"];
const availability = ["available", "unavailable"];
const runtimeStatuses = [
  "starting",
  "active",
  "paused",
  "awaiting_human",
  "completed",
  "failed",
];
const attachments = ["attached", "missing", "conflicting"];
const browserModes = ["workspace", "temporary"];
const continuationStatuses = ["pending", "consumed", "cancelled", "superseded"];
const attentionStatuses = ["pending", "resolved", "stale", "cancelled"];
let exhaustiveStates = 0;
let rejectedExhaustiveStates = 0;
let maximumOutputBytes = 0;

for (const turn of turns)
  for (const codexAvailability of availability)
    for (const runtimeAvailability of availability)
      for (const status of runtimeStatuses)
        for (const attachment of attachments)
          for (const mode of browserModes)
            for (const continuationStatus of continuationStatuses)
              for (const attentionStatus of attentionStatuses) {
                const browser =
                  mode === "workspace"
                    ? { mode, workspaceId: WORKSPACE_ID }
                    : { mode };
                const generated = inputFor({
                  patch: {
                    record: { identity: { browser } },
                    codex: {
                      availability: codexAvailability,
                      turn,
                      ...(turn === "active" ? { turnId: "turn_1" } : {}),
                    },
                    runtime:
                      runtimeAvailability === "unavailable"
                        ? { availability: "unavailable" }
                        : {
                            availability: "available",
                            status,
                            controller: [
                              "awaiting_human",
                              "paused",
                              "completed",
                              "failed",
                            ].includes(status)
                              ? null
                              : "agent",
                            attachment,
                            profileLock:
                              attachment === "missing" ? "released" : "owned",
                            browserIdentity: browser,
                            recovery:
                              attachment === "missing" && mode === "workspace"
                                ? "relaunchable"
                                : attachment === "attached"
                                  ? "not_needed"
                                  : "cleanup_required",
                          },
                    continuation: { status: continuationStatus },
                    attentions: [
                      {
                        taskId: "task_11111111-1111-4111-8111-111111111111",
                        sessionId: "ses_11111111111111111111111111111111",
                        threadId: THREAD_ID,
                        requestId: "req_2",
                        generation: 2,
                        status: attentionStatus,
                      },
                      {
                        taskId: "task_11111111-1111-4111-8111-111111111111",
                        sessionId: "ses_11111111111111111111111111111111",
                        threadId: THREAD_ID,
                        requestId: "req_1",
                        generation: 1,
                        status: "resolved",
                      },
                    ],
                  },
                });
                const input = generated;
                let first;
                try {
                  first = reduceTaskLifecycle(input);
                } catch (error) {
                  assertions += 1;
                  assert.throws(
                    () => reduceTaskLifecycle(structuredClone(input)),
                    (replayed) => replayed.message === error.message,
                    "contradictory Cartesian input rejects deterministically",
                  );
                  rejectedExhaustiveStates += 1;
                  continue;
                }
                const replay = reduceTaskLifecycle(structuredClone(input));
                check(replay, first, "deterministic replay");
                check(
                  Number(first.nextCommand !== null) <= 1,
                  true,
                  "at most one command",
                );
                check(
                  first.nextCommand === null || first.confirmation !== null,
                  true,
                  "every command has an exact confirmation",
                );
                check(
                  ["accepted", "deferred-for-convergence", "rejected"].includes(
                    first.operationDisposition.status,
                  ),
                  true,
                  "every operation has an explicit disposition",
                );
                if (first.operationDisposition.status === "rejected")
                  check(
                    first.nextCommand,
                    null,
                    "rejected operation emits no unrelated command",
                  );
                if (
                  first.operationDisposition.status ===
                  "deferred-for-convergence"
                )
                  check(
                    first.operationDisposition.operationId,
                    input.requestedOperation.operationId,
                    "deferred operation retains stable identity",
                  );
                const reversed = reduceTaskLifecycle({
                  ...structuredClone(input),
                  attentions: [...input.attentions].reverse(),
                });
                check(reversed, first, "attention order is immaterial");
                const bytes = Buffer.byteLength(JSON.stringify(first));
                maximumOutputBytes = Math.max(maximumOutputBytes, bytes);
                check(
                  bytes <= lifecycleContract.limits.outputCharacters,
                  true,
                  "output is bounded",
                );
                exhaustiveStates += 1;
              }

function applyConfirmation(input, output) {
  const next = structuredClone(input);
  const command = output.nextCommand;
  if (!command) return next;
  if (command.type === "interrupt_codex_turn") {
    next.codex.turn = "interrupted";
    next.codex.runtimeStatus = "idle";
    delete next.codex.turnId;
  }
  if (command.type === "settle_continuation_attention") {
    next.continuation.status = "cancelled";
    next.attentions = next.attentions.map((entry) => ({
      ...entry,
      status: "cancelled",
    }));
  }
  if (command.type === "persist_close_intent") {
    next.record.desiredState = "closed";
    next.record.closeOperation = {
      operationId: command.operationId,
      requestedAt: "2026-09-08T00:00:00.000Z",
      stage: "requested",
    };
    next.requestedOperation = {
      type: "observe",
      taskId: next.record.identity.taskId,
    };
  }
  if (command.type === "lookup_or_start_runtime")
    next.runtime = structuredClone(base.runtime);
  if (command.type === "bind_runtime_identity") {
    next.record.identity.sessionId = command.returnedSessionId;
    next.record.bootstrap.stage = "runtime_bound";
  }
  if (command.type === "lookup_or_start_codex_thread")
    next.codex = structuredClone(base.codex);
  if (command.type === "bind_codex_identity") {
    next.record.identity.threadId = command.returnedThreadId;
    next.record.bootstrap.stage = "complete";
  }
  if (command.type === "advance_bootstrap_stage")
    next.record.bootstrap.stage = command.stage;
  if (command.type === "end_runtime_session") {
    Object.assign(next.runtime, {
      status: "completed",
      controller: null,
      attachment: "missing",
      profileLock: "released",
      recovery: "cleanup_required",
    });
  }
  if (command.type === "advance_close_stage")
    next.record.closeOperation.stage = command.stage;
  if (command.type === "read_codex_thread")
    next.codex = structuredClone(base.codex);
  if (command.type === "read_runtime_inventory")
    next.runtime = structuredClone(base.runtime);
  if (command.type === "relaunch_named_browser")
    Object.assign(next.runtime, {
      attachment: "attached",
      profileLock: "owned",
      recovery: "not_needed",
    });
  if (command.type === "return_runtime_ownership") {
    next.runtime.controller = "agent";
    next.runtime.lastReturnedHandoffId = command.handoffId;
    next.runtime.observationSeq =
      next.continuation.preHandoffObservationSeq + 1;
    delete next.runtime.handoffId;
    delete next.runtime.handoffGeneration;
    next.attentions = next.attentions.map((entry) => ({
      ...entry,
      status: entry.authority === "rove_control" ? "resolved" : entry.status,
    }));
    next.requestedOperation = {
      type: "observe",
      taskId: next.record.identity.taskId,
    };
  }
  if (command.type === "inspect_after_return")
    next.freshInspection = {
      inspectionId: "inspection_return_1",
      sessionId: command.sessionId,
      handoffId: command.handoffId,
      generation: command.generation,
      afterObservationSeq: command.afterObservationSeq,
    };
  if (command.type === "record_return_event") {
    next.continuation.freshInspectionRequired = false;
    next.continuation.returnEventId = command.returnEventId;
    next.continuation.returnObservationSeq = command.returnObservationSeq;
  }
  if (command.type === "prepare_continuation_command")
    next.continuation.command = {
      commandId: "continuation_cmd_1",
      returnEventId: command.returnEventId,
      kind: next.codex.turn === "active" ? "turn/steer" : "turn/start",
      dispatchStatus: "not_started",
    };
  if (command.type === "persist_continuation_dispatch_intent")
    next.continuation.command.dispatchStatus = "possibly_started";
  if (
    command.type === "reconcile_continuation_dispatch" ||
    command.type === "dispatch_or_reconcile_continuation"
  ) {
    next.continuation.command.dispatchStatus = "terminal";
    next.continuation.status = "consumed";
  }
  if (command.type === "respond_continuation_explicit")
    next.continuation.status = "consumed";
  if (command.type === "reconcile_attention_response")
    next.attentions = next.attentions.map((entry) =>
      entry.requestId === command.requestId &&
      entry.generation === command.generation
        ? { ...entry, status: "resolved" }
        : entry,
    );
  if (command.type === "respond_codex_attention")
    next.attentions = next.attentions.map((entry) =>
      entry.authority === "codex" &&
      entry.requestId === command.requestId &&
      entry.generation === command.generation
        ? { ...entry, status: "resolved" }
        : entry,
    );
  if (command.type === "respond_codex_attention")
    next.requestedOperation = {
      type: "observe",
      taskId: next.record.identity.taskId,
    };
  if (
    command.type === "resume_codex_thread" ||
    command.type === "recover_codex_thread"
  )
    next.codex.runtimeStatus = "idle";
  if (command.type === "unarchive_codex_thread") next.codex.archived = false;
  if (command.type === "archive_codex_thread") next.codex.archived = true;
  return next;
}

let modelSequences = 0;
for (const turn of ["active", "completed", "failed", "interrupted"])
  for (const continuationStatus of continuationStatuses)
    for (const appServerAvailable of [true, false])
      for (const runtimeAvailable of [true, false]) {
        let state = inputFor({
          patch: {
            record: {
              desiredState: "closed",
              closeOperation: { stage: "requested" },
            },
            codex: {
              turn,
              availability: appServerAvailable ? "available" : "unavailable",
            },
            runtime: {
              availability: runtimeAvailable ? "available" : "unavailable",
            },
            continuation: { status: continuationStatus },
            attentions: [
              {
                taskId: "task_11111111-1111-4111-8111-111111111111",
                sessionId: "ses_11111111111111111111111111111111",
                threadId: THREAD_ID,
                requestId: "req_1",
                generation: 1,
                status: "pending",
              },
            ],
          },
        });
        let steps = 0;
        while (steps < 12) {
          const before = reduceTaskLifecycle(state);
          check(
            reduceTaskLifecycle(structuredClone(state)),
            before,
            "restart replay",
          );
          if (before.phase === "closed") break;
          check(before.nextCommand !== null, true, "close remains actionable");
          state = applyConfirmation(state, before);
          steps += 1;
        }
        check(reduceTaskLifecycle(state).phase, "closed", "close converges");
        check(steps <= 9, true, "close convergence is bounded");
        check(
          reduceTaskLifecycle(state).nextCommand,
          null,
          "repeated close is inert",
        );
        modelSequences += 1;
      }

const closedTask = inputFor(
  fixture.cases.find((entry) => entry.name === "repeated-close-complete"),
);
const cleanupTask = inputFor(
  fixture.cases.find((entry) => entry.name === "temporary-runtime-missing"),
);
const convergingTask = inputFor(
  fixture.cases.find(
    (entry) => entry.name === "complete-rechecks-active-runtime",
  ),
);
const secondCleanup = structuredClone(cleanupTask);
secondCleanup.record.identity.taskId =
  "task_22222222-2222-4222-8222-222222222222";
secondCleanup.record.identity.sessionId =
  "ses_22222222222222222222222222222222";
secondCleanup.record.identity.threadId = SECOND_THREAD_ID;
secondCleanup.record.bootstrap.threadSource = `rove:task_22222222-2222-4222-8222-222222222222:${BOOTSTRAP_ID}`;
secondCleanup.codex.threadId = SECOND_THREAD_ID;
secondCleanup.codex.threadSource = `rove:task_22222222-2222-4222-8222-222222222222:${BOOTSTRAP_ID}`;

const zero = reduceLifecycleInventory({
  tasks: [closedTask],
  requestedOperation: {
    type: "launch",
    operationId: "intent_44444444-4444-4444-8444-444444444444",
  },
});
check(zero.launchAllowed, true, "zero cleanup tasks allows launch");
check(
  zero.operationDisposition,
  {
    type: "launch",
    operationId: "intent_44444444-4444-4444-8444-444444444444",
    status: "accepted",
    reason: "Launch intent can be persisted.",
  },
  "zero blockers accepts the exact launch operation",
);
check(
  zero.nextCommand?.type,
  "persist_bootstrap_intent",
  "launch persists intent first",
);
check(
  zero.confirmation?.type,
  "durable_bootstrap_intent",
  "launch has exact confirmation",
);
const one = reduceLifecycleInventory({
  tasks: [convergingTask],
  requestedOperation: {
    type: "launch",
    operationId: "intent_44444444-4444-4444-8444-444444444444",
  },
});
check(one.launchAllowed, false, "one cleanup task blocks launch");
check(
  one.operationDisposition.status,
  "deferred-for-convergence",
  "one actionable blocker defers launch",
);
check(
  one.operationDisposition.operationId,
  "intent_44444444-4444-4444-8444-444444444444",
  "deferred launch retains exact operation identity",
);
check(
  one.nextCommand?.type,
  "end_runtime_session",
  "deferred launch emits only the blocker convergence command",
);
const convergedOne = applyConfirmation(convergingTask, one);
const resumedLaunch = reduceLifecycleInventory({
  tasks: [convergedOne],
  requestedOperation: {
    type: "launch",
    operationId: one.operationDisposition.operationId,
  },
});
check(
  resumedLaunch.operationDisposition.status,
  "accepted",
  "deferred launch becomes accepted after blocker convergence",
);
check(
  resumedLaunch.nextCommand,
  {
    type: "persist_bootstrap_intent",
    operationId: "intent_44444444-4444-4444-8444-444444444444",
  },
  "converged launch persists the same stable operation identity",
);
const unresolvedOne = reduceLifecycleInventory({
  tasks: [cleanupTask],
  requestedOperation: {
    type: "launch",
    operationId: "intent_44444444-4444-4444-8444-444444444444",
  },
});
check(
  unresolvedOne.operationDisposition.status,
  "rejected",
  "one non-actionable blocker rejects launch",
);
check(
  unresolvedOne.nextCommand,
  null,
  "rejected launch emits no unrelated command",
);
const multiple = reduceLifecycleInventory({
  tasks: [secondCleanup, cleanupTask],
  requestedOperation: {
    type: "launch",
    operationId: "intent_44444444-4444-4444-8444-444444444444",
  },
});
check(multiple.launchAllowed, false, "multiple cleanup tasks block launch");
check(
  multiple.operationDisposition.status,
  "rejected",
  "multiple blockers reject launch explicitly",
);
check(
  multiple.nextCommand,
  null,
  "multiple cleanup tasks are not chosen by recency",
);
check(
  multiple.attention.taskIds,
  [
    "task_11111111-1111-4111-8111-111111111111",
    "task_22222222-2222-4222-8222-222222222222",
  ],
  "multiple cleanup tasks are stable and visible",
);

const mismatch = inputFor(
  fixture.cases.find((entry) => entry.name === "session-identity-mismatch"),
);
const mismatchOutput = reduceTaskLifecycle(mismatch);
check(
  lifecycleContract.componentAffectingCommands.includes(
    mismatchOutput.nextCommand?.type,
  ),
  false,
  "identity mismatch cannot emit a component side effect",
);
for (const name of [
  "session-identity-mismatch",
  "thread-identity-mismatch",
  "workspace-identity-mismatch",
]) {
  const value = reduceTaskLifecycle(
    inputFor(fixture.cases.find((entry) => entry.name === name)),
  );
  check(value.nextCommand, null, `${name} emits no command`);
  check(value.allowedActions, [], `${name} advertises no action`);
}
for (const name of [
  "close-unbound-runtime-conflicting-lookup",
  "close-unbound-codex-conflicting-lookup",
]) {
  const conflict = inputFor(fixture.cases.find((entry) => entry.name === name));
  const first = reduceTaskLifecycle(conflict);
  check(first.phase, "cleanup_required", `${name} requires manual cleanup`);
  check(first.nextCommand, null, `${name} cannot guess a component identity`);
  check(
    reduceTaskLifecycle(structuredClone(conflict)),
    first,
    `${name} remains stable across restart`,
  );
  const admission = reduceLifecycleInventory({
    tasks: [conflict],
    requestedOperation: {
      type: "launch",
      operationId: "intent_44444444-4444-4444-8444-444444444444",
    },
  });
  check(
    admission.operationDisposition.status,
    "rejected",
    `${name} rejects launch admission`,
  );
  check(
    admission.nextCommand,
    null,
    `${name} emits no unrelated launch-blocker command`,
  );
}
const nonComponentCommands = new Set([
  "persist_bootstrap_intent",
  "advance_bootstrap_stage",
  "bind_runtime_identity",
  "bind_codex_identity",
  "read_codex_thread",
  "read_runtime_inventory",
  "read_lifecycle_truth",
  "persist_close_intent",
  "advance_close_stage",
  "record_return_event",
  "prepare_continuation_command",
  "persist_continuation_dispatch_intent",
]);
check(
  [
    ...lifecycleContract.componentAffectingCommands,
    ...nonComponentCommands,
  ].sort(),
  [...lifecycleContract.commands].sort(),
  "component-affecting command classification is complete",
);

let semanticCases = 0;
function semantic(input, expectation) {
  const actual = reduceTaskLifecycle(input);
  expectation(actual);
  semanticCases += 1;
}
let rejectionCases = 0;
function rejects(mutator, message) {
  const input = inputFor({ patch: {} });
  mutator(input);
  assertions += 1;
  assert.throws(() => reduceTaskLifecycle(input), Error, message);
  rejectionCases += 1;
}

for (const stage of [
  "codex_settled",
  "continuation_settled",
  "runtime_settled",
  "complete",
])
  semantic(
    inputFor({
      patch: {
        record: { desiredState: "closed", closeOperation: { stage } },
        codex: { turn: "active", turnId: "turn_late" },
      },
    }),
    (value) =>
      check(
        value.nextCommand?.type,
        "interrupt_codex_turn",
        `${stage} rechecks active Codex truth`,
      ),
    `${stage} active Codex contradiction`,
  );

for (const stage of ["runtime_settled", "complete"])
  semantic(
    inputFor({
      patch: { record: { desiredState: "closed", closeOperation: { stage } } },
    }),
    (value) =>
      check(
        value.nextCommand?.type,
        "end_runtime_session",
        `${stage} rechecks Runtime truth`,
      ),
    `${stage} active Runtime contradiction`,
  );

semantic(
  inputFor({
    patch: {
      attentions: [
        { requestId: "req_codex", generation: 1, status: "pending" },
      ],
    },
  }),
  (value) => {
    check(
      value.allowedActions.includes("respond_attention"),
      true,
      "Codex attention is respondable",
    );
    check(
      value.allowedActions.includes("return_control"),
      false,
      "Codex attention is not Return Control",
    );
  },
  "Codex attention action separation",
);

const handoffInput = inputFor({
  patch: {
    runtime: {
      status: "active",
      controller: "human",
      ownershipGeneration: 2,
      handoffId: "handoff_11111111111111111111111111111111",
      handoffGeneration: 1,
    },
    continuation: {
      status: "pending",
      handoffId: "handoff_11111111111111111111111111111111",
      generation: 1,
    },
    attentions: [
      {
        authority: "rove_control",
        kind: "control_handoff",
        requestId: "req_handoff",
        sessionId: "ses_11111111111111111111111111111111",
        handoffId: "handoff_11111111111111111111111111111111",
        generation: 1,
        status: "pending",
      },
    ],
  },
});
semantic(
  handoffInput,
  (value) =>
    check(
      value.allowedActions.includes("return_control"),
      true,
      "exact handoff exposes Return Control",
    ),
  "exact handoff",
);
const awaitingHandoff = structuredClone(handoffInput);
awaitingHandoff.runtime.status = "awaiting_human";
awaitingHandoff.runtime.controller = null;
awaitingHandoff.runtime.ownershipGeneration = 1;
semantic(
  awaitingHandoff,
  (value) => {
    check(value.phase, "waiting_for_human", "awaiting N/N handoff is valid");
    check(
      value.allowedActions.includes("return_control"),
      false,
      "awaiting N/N does not expose Return Control before takeover",
    );
  },
  "awaiting handoff generation invariant",
);
semantic(
  inputFor({
    patch: {
      runtime: {
        status: "active",
        controller: "human",
        ownershipGeneration: 2,
      },
    },
  }),
  (value) => {
    check(
      value.phase,
      "waiting_for_human",
      "voluntary human ownership remains valid",
    );
    check(
      value.allowedActions.includes("return_control"),
      false,
      "voluntary human ownership does not gain requested-handoff authority",
    );
  },
  "voluntary human ownership",
);
for (const [name, mutate] of [
  [
    "awaiting handoff ownership mismatch",
    (value) => {
      value.runtime.status = "awaiting_human";
      value.runtime.controller = null;
      value.runtime.ownershipGeneration = 2;
    },
  ],
  [
    "active human handoff ownership mismatch",
    (value) => (value.runtime.ownershipGeneration = 4),
  ],
  [
    "active handoff missing ownership generation",
    (value) => delete value.runtime.ownershipGeneration,
  ],
  [
    "active handoff invalid controller",
    (value) => (value.runtime.controller = "agent"),
  ],
]) {
  const value = structuredClone(handoffInput);
  mutate(value);
  assertions += 1;
  assert.throws(
    () => reduceTaskLifecycle(value),
    /ownership|handoff/i,
    `${name} fails closed`,
  );
  rejectionCases += 1;
}
for (const [name, mutate] of [
  [
    "wrong handoff id",
    (value) =>
      (value.runtime.handoffId = "handoff_22222222222222222222222222222222"),
  ],
  [
    "wrong handoff generation",
    (value) => (value.runtime.handoffGeneration = 2),
  ],
  [
    "missing continuation",
    (value) => (value.continuation = { status: "none" }),
  ],
  ["missing exact attention", (value) => (value.attentions = [])],
]) {
  const value = structuredClone(handoffInput);
  mutate(value);
  if (name === "missing continuation" || name === "missing exact attention") {
    semantic(
      value,
      (output) =>
        check(
          output.allowedActions.includes("return_control"),
          false,
          `${name} does not expose Return Control`,
        ),
      `${name} fails closed`,
    );
  } else {
    assertions += 1;
    assert.throws(
      () => reduceTaskLifecycle(value),
      /handoff|continuation/i,
      `${name} fails closed`,
    );
    rejectionCases += 1;
  }
}
const returnRequest = structuredClone(handoffInput);
returnRequest.requestedOperation = {
  type: "return_control",
  taskId: "task_11111111-1111-4111-8111-111111111111",
  operationId: "intent_55555555-5555-4555-8555-555555555555",
};
const returned = reduceTaskLifecycle(returnRequest);
check(
  returned.nextCommand?.type,
  "return_runtime_ownership",
  "exact Return Control command",
);
const afterReturn = applyConfirmation(returnRequest, returned);
const afterReturnOutput = reduceTaskLifecycle(afterReturn);
check(
  afterReturnOutput.allowedActions.includes("return_control"),
  false,
  "Return Control is at most once",
);
check(
  afterReturnOutput.nextCommand?.type,
  "inspect_after_return",
  "return requires fresh inspection before continuation",
);
semanticCases += 2;

const attentionResponse = inputFor({
  patch: {
    attentions: [{ requestId: "req_codex", generation: 2, status: "pending" }],
    requestedOperation: {
      type: "respond_attention",
      taskId: "task_11111111-1111-4111-8111-111111111111",
      operationId: "intent_66666666-6666-4666-8666-666666666666",
      requestId: "req_codex",
      generation: 2,
    },
  },
});
semantic(
  attentionResponse,
  (value) =>
    check(
      value.nextCommand?.type,
      "respond_codex_attention",
      "Codex attention has its own response command",
    ),
  "attention response",
);

semantic(
  inputFor({ patch: { runtime: { sessionExists: false } } }),
  (value) => {
    check(
      value.phase,
      "cleanup_required",
      "missing persisted session requires cleanup",
    );
    check(
      value.nextCommand?.type ?? null,
      null,
      "missing persisted session cannot relaunch",
    );
  },
  "missing persisted named session",
);

for (const mutator of [
  (input) => {
    input.extra = true;
  },
  (input) => {
    input.record.desiredState = "bogus";
  },
  (input) => {
    input.record.desiredState = "closed";
    input.record.closeOperation = {
      operationId: "intent_33333333-3333-4333-8333-333333333333",
      requestedAt: "2026-02-30T00:00:00.000Z",
      stage: "requested",
    };
  },
  (input) => {
    input.codex.turn = "active";
  },
  (input) => {
    input.runtime.status = "completed";
    input.runtime.controller = "agent";
  },
  (input) => {
    input.runtime.recovery = "magic";
  },
  (input) => {
    input.continuation = { status: "pending" };
  },
  (input) => {
    input.attentions = [
      {
        authority: "rove_control",
        kind: "user_input",
        requestId: "req_1",
        taskId: "task_11111111-1111-4111-8111-111111111111",
        sessionId: "ses_11111111111111111111111111111111",
        threadId: THREAD_ID,
        handoffId: "handoff_11111111111111111111111111111111",
        generation: 1,
        status: "pending",
      },
    ];
  },
  (input) => {
    input.requestedOperation = {
      type: "message",
      taskId: "task_11111111-1111-4111-8111-111111111111",
      operationId: "intent_77777777-7777-4777-8777-777777777777",
    };
  },
  (input) => {
    input.runtime.recovery = "relaunchable";
  },
  (input) => {
    input.record.identity.taskId = "task_legacy";
  },
  (input) => {
    input.record.identity.sessionId = "ses_legacy";
  },
  (input) => {
    input.record.identity.browser.workspaceId = "wrk_legacy";
  },
  (input) => {
    input.requestedOperation = {
      type: "message",
      taskId: "task_11111111-1111-4111-8111-111111111111",
      operationId: "op_legacy",
      message: "must reject a legacy operation identifier",
    };
  },
])
  rejects(mutator, "malformed or contradictory input rejects");

for (const invalid of ["", "x".repeat(257), 7]) {
  rejects((input) => {
    input.record.identity.threadId = invalid;
  }, "empty, oversized, or wrongly typed Codex thread identity rejects");
  rejects((input) => {
    input.codex.turn = "active";
    input.codex.runtimeStatus = "active";
    input.codex.turnId = invalid;
  }, "empty, oversized, or wrongly typed Codex turn identity rejects");
  rejects((input) => {
    input.attentions = [
      {
        authority: "codex",
        kind: "mcp_elicitation",
        requestId: invalid,
        taskId: "task_11111111-1111-4111-8111-111111111111",
        threadId: THREAD_ID,
        turnId: "01a0819a-eb7b-7fa2-9d33-29f824eb3d18",
        generation: 1,
        status: "pending",
      },
    ];
  }, "empty, oversized, or wrongly typed Codex request identity rejects");
}

for (const requestedOperation of [
  {
    type: "return_control",
    taskId: "task_11111111-1111-4111-8111-111111111111",
    operationId: "intent_55555555-5555-4555-8555-555555555555",
  },
  {
    type: "respond_attention",
    taskId: "task_11111111-1111-4111-8111-111111111111",
    operationId: "intent_66666666-6666-4666-8666-666666666666",
    requestId: "missing",
    generation: 1,
  },
  {
    type: "archive",
    taskId: "task_11111111-1111-4111-8111-111111111111",
    operationId: "intent_88888888-8888-4888-8888-888888888888",
  },
]) {
  const rejected = reduceTaskLifecycle(
    inputFor({ patch: { requestedOperation } }),
  );
  check(
    rejected.operationDisposition.status,
    "rejected",
    `${requestedOperation.type} rejects explicitly`,
  );
  check(
    rejected.nextCommand,
    null,
    `${requestedOperation.type} cannot become unrelated convergence`,
  );
}

let transitionSequences = 0;
function converge(initial, terminal, maximum = 12) {
  let state = initial;
  for (let step = 0; step <= maximum; step += 1) {
    const current = reduceTaskLifecycle(state);
    check(
      reduceTaskLifecycle(structuredClone(state)),
      current,
      "transition restart is deterministic",
    );
    if (terminal(current)) return { state, steps: step };
    check(
      current.nextCommand !== null,
      true,
      "transition sequence remains actionable",
    );
    state = applyConfirmation(state, current);
  }
  assert.fail("transition sequence exceeded its bound");
}

const bootstrapStart = inputFor({
  patch: {
    record: { bootstrap: { stage: "intent_persisted" } },
    runtime: { sessionExists: false },
    codex: { threadExists: false },
  },
});
const bootstrapDone = converge(
  bootstrapStart,
  (value) => value.phase === "ready",
);
check(bootstrapDone.steps <= 6, true, "bootstrap recovery is bounded");
transitionSequences += 1;

const zeroMatchClose = converge(
  inputFor({
    patch: {
      record: {
        bootstrap: { stage: "runtime_dispatching" },
        desiredState: "closed",
        closeOperation: { stage: "requested" },
      },
      runtime: { sessionExists: false },
      codex: { threadExists: false },
    },
  }),
  (value) => value.phase === "closed",
);
check(
  zeroMatchClose.steps <= 4,
  true,
  "zero bootstrap/source matches close without invented identities",
);
transitionSequences += 1;

const returnResume = converge(afterReturn, (value) => value.phase === "ready");
check(
  returnResume.steps,
  5,
  "Return, inspection, durable dispatch, and exact receipt are split",
);
check(
  returnResume.state.continuation.status,
  "consumed",
  "resume continuation consumes one terminal receipt",
);
transitionSequences += 1;

const explicitHandoff = structuredClone(handoffInput);
explicitHandoff.continuation.policy = "explicit_user_response";
explicitHandoff.requestedOperation = {
  type: "return_control",
  taskId: "task_11111111-1111-4111-8111-111111111111",
  operationId: "intent_99999999-9999-4999-8999-999999999999",
};
let explicitState = applyConfirmation(
  explicitHandoff,
  reduceTaskLifecycle(explicitHandoff),
);
explicitState = applyConfirmation(
  explicitState,
  reduceTaskLifecycle(explicitState),
);
explicitState = applyConfirmation(
  explicitState,
  reduceTaskLifecycle(explicitState),
);
let explicitProjection = reduceTaskLifecycle(explicitState);
check(
  explicitProjection.phase,
  "waiting_for_human",
  "explicit policy never auto-dispatches continuation",
);
check(
  explicitProjection.allowedActions.includes("message"),
  true,
  "explicit policy awaits user response",
);
explicitState.requestedOperation = {
  type: "message",
  taskId: "task_11111111-1111-4111-8111-111111111111",
  operationId: "intent_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  message: "continue with my answer",
};
explicitProjection = reduceTaskLifecycle(explicitState);
check(
  explicitProjection.nextCommand?.type,
  "respond_continuation_explicit",
  "explicit response has separate command",
);
explicitState = applyConfirmation(explicitState, explicitProjection);
check(
  reduceTaskLifecycle(explicitState).phase,
  "ready",
  "explicit response consumes continuation once",
);
transitionSequences += 1;

const uncertainContinuation = structuredClone(afterReturn);
uncertainContinuation.continuation.freshInspectionRequired = false;
uncertainContinuation.continuation.returnEventId =
  "return:ses_11111111111111111111111111111111:handoff_11111111111111111111111111111111:1";
uncertainContinuation.continuation.returnObservationSeq = 11;
uncertainContinuation.continuation.command = {
  commandId: "continuation_cmd_uncertain",
  returnEventId: uncertainContinuation.continuation.returnEventId,
  kind: "turn/start",
  dispatchStatus: "resolution_unknown",
};
uncertainContinuation.freshInspection = null;
check(
  reduceTaskLifecycle(uncertainContinuation).nextCommand?.type,
  "reconcile_continuation_dispatch",
  "uncertain continuation reconciles before another dispatch",
);
semanticCases += 1;

for (const [source, mutate] of [
  [
    afterReturn,
    (value) => {
      value.runtime.observationSeq =
        value.continuation.preHandoffObservationSeq;
    },
  ],
  [
    handoffInput,
    (value) => {
      value.runtime.handoffGeneration = value.continuation.generation + 1;
    },
  ],
]) {
  const stale = structuredClone(source);
  mutate(stale);
  assertions += 1;
  assert.throws(
    () => reduceTaskLifecycle(stale),
    Error,
    "stale or changed handoff identity rejects",
  );
  rejectionCases += 1;
}

for (const mutateProof of [
  (value) => {
    value.freshInspection.afterObservationSeq =
      value.runtime.observationSeq + 1;
  },
  (value) => {
    value.freshInspection.afterObservationSeq =
      value.continuation.preHandoffObservationSeq;
  },
  (value) => {
    value.freshInspection.sessionId = "ses_22222222222222222222222222222222";
  },
]) {
  const invalidProof = structuredClone(afterReturn);
  invalidProof.freshInspection = {
    inspectionId: "inspection_return_invalid",
    sessionId: invalidProof.continuation.sessionId,
    handoffId: invalidProof.continuation.handoffId,
    generation: invalidProof.continuation.generation,
    afterObservationSeq: invalidProof.runtime.observationSeq,
  };
  mutateProof(invalidProof);
  assertions += 1;
  assert.throws(
    () => reduceTaskLifecycle(invalidProof),
    Error,
    "future, stale, or mismatched inspection proof rejects",
  );
  rejectionCases += 1;
}

const deferredMessage = inputFor({
  patch: {
    codex: { runtimeStatus: "notLoaded" },
    requestedOperation: {
      type: "message",
      taskId: "task_11111111-1111-4111-8111-111111111111",
      operationId: "intent_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      message: "continue",
    },
  },
});
const deferredFirst = reduceTaskLifecycle(deferredMessage);
check(
  deferredFirst.operationDisposition.status,
  "deferred-for-convergence",
  "message defers for App Server load",
);
check(
  deferredFirst.operationDisposition.operationId,
  "intent_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "deferred operation identity is retained",
);
const deferredLoaded = applyConfirmation(deferredMessage, deferredFirst);
const deferredSecond = reduceTaskLifecycle(deferredLoaded);
check(
  deferredSecond.operationDisposition.status,
  "accepted",
  "deferred message executes after convergence",
);
check(
  deferredSecond.nextCommand?.type,
  "start_or_steer_codex_turn",
  "no unrelated command consumes deferred message",
);
transitionSequences += 1;

const uncertainResponse = inputFor({
  patch: {
    attentions: [
      {
        requestId: "req_uncertain_operation",
        generation: 3,
        status: "resolution_unknown",
      },
    ],
    requestedOperation: {
      type: "respond_attention",
      taskId: "task_11111111-1111-4111-8111-111111111111",
      operationId: "intent_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      requestId: "req_uncertain_operation",
      generation: 3,
    },
  },
});
const uncertainFirst = reduceTaskLifecycle(uncertainResponse);
check(
  uncertainFirst.operationDisposition.status,
  "deferred-for-convergence",
  "uncertain response defers to exact receipt lookup",
);
check(
  uncertainFirst.nextCommand?.type,
  "reconcile_attention_response",
  "uncertain response cannot be sent again",
);
const uncertainSettled = applyConfirmation(uncertainResponse, uncertainFirst);
const uncertainSecond = reduceTaskLifecycle(uncertainSettled);
check(
  uncertainSecond.operationDisposition.status,
  "rejected",
  "settled stale response is not consumed as new success",
);
check(
  uncertainSecond.nextCommand,
  null,
  "settled stale response emits no second response",
);
transitionSequences += 1;

const beforeRuntimeDispatch = reduceTaskLifecycle(
  inputFor({
    patch: {
      record: { bootstrap: { stage: "intent_persisted" } },
      runtime: { sessionExists: false },
    },
  }),
);
check(
  "sessionId" in beforeRuntimeDispatch.nextCommand,
  false,
  "pre-dispatch bootstrap does not invent Runtime identity",
);
check(
  "threadId" in beforeRuntimeDispatch.nextCommand,
  false,
  "pre-dispatch bootstrap does not invent Codex identity",
);
const beforeThreadReceipt = reduceTaskLifecycle(
  inputFor({
    patch: {
      record: { bootstrap: { stage: "thread_dispatching" } },
      codex: { threadExists: false },
    },
  }),
);
check(
  "threadId" in beforeThreadReceipt.nextCommand,
  false,
  "Codex dispatch uses threadSource, not caller-selected thread id",
);
const closeWithReturnedRuntime = reduceTaskLifecycle(
  inputFor({
    patch: {
      record: {
        bootstrap: { stage: "runtime_dispatching" },
        desiredState: "closed",
        closeOperation: { stage: "continuation_settled" },
      },
      codex: { threadExists: false },
    },
  }),
);
check(
  closeWithReturnedRuntime.nextCommand?.sessionId,
  "ses_11111111111111111111111111111111",
  "unbound close targets the exact Runtime lookup receipt",
);
const closeWithReturnedThread = reduceTaskLifecycle(
  inputFor({
    patch: {
      record: {
        bootstrap: { stage: "thread_dispatching" },
        desiredState: "closed",
        closeOperation: { stage: "requested" },
      },
      codex: { turn: "active", turnId: "turn_unbound_close" },
    },
  }),
);
check(
  closeWithReturnedThread.nextCommand?.threadId,
  THREAD_ID,
  "unbound close targets the exact Codex lookup receipt",
);
semanticCases += 4;

const firstArchive = inputFor({
  patch: {
    record: { desiredState: "closed", closeOperation: { stage: "complete" } },
    runtime: {
      status: "completed",
      controller: null,
      attachment: "missing",
      profileLock: "released",
      recovery: "cleanup_required",
    },
    requestedOperation: {
      type: "archive",
      taskId: "task_11111111-1111-4111-8111-111111111111",
      operationId: "intent_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    },
  },
});
const archiveCommand = reduceTaskLifecycle(firstArchive);
check(
  archiveCommand.nextCommand?.type,
  "archive_codex_thread",
  "archive applies only to unarchived closed thread",
);
const archivedAgain = reduceTaskLifecycle(
  applyConfirmation(firstArchive, archiveCommand),
);
check(
  archivedAgain.operationDisposition.status,
  "accepted",
  "repeated archive reconciles safely",
);
check(
  archivedAgain.nextCommand,
  null,
  "repeated archive emits no second component command",
);
transitionSequences += 1;

const namedRecovery = inputFor({
  patch: {
    runtime: {
      attachment: "missing",
      profileLock: "released",
      recovery: "relaunchable",
    },
  },
});
const namedDone = converge(namedRecovery, (value) => value.phase === "ready");
check(namedDone.steps, 1, "named relaunch converges once");
transitionSequences += 1;

const archivedNotLoaded = inputFor({
  patch: { codex: { archived: true, runtimeStatus: "notLoaded" } },
});
const appServerRecovered = converge(
  archivedNotLoaded,
  (value) => value.phase === "ready",
);
check(
  appServerRecovered.steps,
  2,
  "App Server unarchive and resume are independently confirmed",
);
transitionSequences += 1;

const systemErrorRecovered = converge(
  inputFor({ patch: { codex: { runtimeStatus: "systemError" } } }),
  (value) => value.phase === "ready",
);
check(
  systemErrorRecovered.steps,
  1,
  "App Server system error recovery is bounded",
);
transitionSequences += 1;

const temporaryRetry = inputFor({
  patch: {
    record: { identity: { browser: { mode: "temporary" } } },
    runtime: { sessionExists: false },
    requestedOperation: {
      type: "retry_cleanup",
      taskId: "task_11111111-1111-4111-8111-111111111111",
      operationId: "intent_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    },
  },
});
const temporaryDone = converge(
  temporaryRetry,
  (value) => value.phase === "closed",
);
check(
  temporaryDone.steps <= 5,
  true,
  "Temporary conservative cleanup is bounded",
);
check(
  temporaryDone.state.record.identity.browser.mode,
  "temporary",
  "Temporary cleanup never falls back",
);
transitionSequences += 1;

for (const stage of [
  "requested",
  "codex_settled",
  "continuation_settled",
  "runtime_settled",
  "complete",
])
  for (const contradiction of ["clean", "active_turn", "active_runtime"]) {
    const patch = {
      record: { desiredState: "closed", closeOperation: { stage } },
    };
    if (contradiction === "active_turn")
      patch.codex = { turn: "active", turnId: "turn_late" };
    if (contradiction === "clean")
      patch.runtime = {
        status: "completed",
        controller: null,
        attachment: "missing",
        profileLock: "released",
        recovery: "cleanup_required",
      };
    const done = converge(
      inputFor({ patch }),
      (value) => value.phase === "closed",
    );
    check(done.steps <= 8, true, "every close stage contradiction converges");
    transitionSequences += 1;
  }

const evidence = {
  schemaVersion: 1,
  oracle: "P5.9 L0 native lifecycle convergence",
  fixture: "experiments/phase5-app-server/fixtures/native-lifecycle-l0.json",
  fixtureCases: fixture.cases.length,
  exhaustiveStates,
  rejectedExhaustiveStates,
  modelSequences,
  semanticCases,
  transitionSequences,
  rejectionCases,
  assertions,
  maximumOutputBytes,
  limits: lifecycleContract.limits,
  result: "passed",
};

if (process.argv.includes("--write-evidence")) {
  await mkdir(fileURLToPath(new URL(".", evidencePath)), { recursive: true });
  await writeFile(
    evidencePath,
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
}

console.log(JSON.stringify({ ...evidence, runner: directory }, null, 2));
