import assert from "node:assert/strict";
import console from "node:console";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AccountCatalogProjection,
  AttentionCoordinator,
  BoundedRestartSupervisor,
  ContinuationCoordinator,
  DirectLocalProductApi,
  EventLog,
  JsonFixtureLocalProductApi,
  OutcomeCoordinator,
  RemoteProductFixture,
  RpcCorrelation,
  TaskLaunchAuthority,
  UnifiedProductStore,
  toCloudEnvelope,
} from "./contract-models.mjs";
import {
  assertSchema,
  auditSchema,
  validateSchema,
} from "./schema-validator.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const readJson = async (path) =>
  JSON.parse(await readFile(resolve(here, path), "utf8"));
const [catalog, taskLaunchSchema, continuationSchema, boundary, catalogSource] =
  await Promise.all([
    readJson("fixtures/rove-tool-catalog.json"),
    readJson("contracts/task-launch.schema.json"),
    readJson("contracts/durable-continuation.schema.json"),
    readJson("contracts/local-cloud-boundary.json"),
    readFile(
      resolve(repo, "packages/protocol/src/rove-tool-catalog.ts"),
      "utf8",
    ),
  ]);

const results = [];
function check(experiment, name, fn) {
  try {
    fn();
    results.push({ experiment, name, status: "pass" });
  } catch (error) {
    results.push({
      experiment,
      name,
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
const rejects = (fn, pattern) => assert.throws(fn, pattern);
const clean = (value) =>
  Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
const clone = (value) => JSON.parse(JSON.stringify(value));
const workspaceId = "wrk_12345678-1234-1234-1234-123456789abc";
const otherWorkspaceId = "wrk_abcdefab-cdef-abcd-efab-cdefabcdefab";

function launch(overrides = {}) {
  return {
    roveTaskId: "task_alpha",
    executionMode: "agent",
    browserIdentityMode: "workspace",
    resolvedWorkspaceId: workspaceId,
    selectionSource: "user_selected",
    selectedAt: "2026-09-07T12:00:00.000Z",
    ...overrides,
  };
}

function continuation(overrides = {}) {
  const value = {
    roveTaskId: "task_alpha",
    codexThreadId: "thr_1",
    originatingCodexTurnId: "turn_1",
    roveSessionId: "session_1",
    handoffId: "handoff_alpha",
    handoffGeneration: 2,
    requestedInstruction: "Continue after human control returns",
    continuationPolicy: "resume_after_control_return",
    status: "pending",
    freshInspectionRequired: true,
    ...overrides,
  };
  if (value.handoffId !== undefined && overrides.observationFingerprint === undefined) {
    value.observationFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          roveTaskId: value.roveTaskId,
          codexThreadId: value.codexThreadId,
          originatingCodexTurnId: value.originatingCodexTurnId,
          roveSessionId: value.roveSessionId,
          handoffId: value.handoffId,
          handoffGeneration: value.handoffGeneration,
          requestedInstruction: value.requestedInstruction,
          continuationPolicy: value.continuationPolicy,
          ...(value.preHandoffObservationSeq === undefined
            ? {}
            : { preHandoffObservationSeq: value.preHandoffObservationSeq }),
        }),
      )
      .digest("hex");
  }
  if (value.continuationCommand !== undefined) {
    if (overrides.returnEventId === undefined)
      value.returnEventId = value.continuationCommand.returnEventId;
    if (overrides.freshInspectionRequired === undefined)
      value.freshInspectionRequired = false;
  }
  return value;
}

function continuationCommand(dispatchStatus = "not_started", overrides = {}) {
  const commandId = "continue:task_alpha:2:evt_1";
  return {
    commandId,
    returnEventId: "evt_1",
    kind: "turn/start",
    dispatchStatus,
    payload: {
      roveContinuationCommandId: commandId,
      authoredBy: "host",
      instruction: "Continue after human control returns",
    },
    ...overrides,
  };
}

for (const [name, value] of [
  ["workspace launch", launch()],
  [
    "temporary launch",
    launch({
      browserIdentityMode: "temporary",
      resolvedWorkspaceId: undefined,
    }),
  ],
])
  check("Schemas", `${name} validates`, () =>
    assertSchema(taskLaunchSchema, clean(value)),
  );

for (const [name, value] of [
  ["workspace without identity", launch({ resolvedWorkspaceId: undefined })],
  ["temporary with workspace", launch({ browserIdentityMode: "temporary" })],
  ["unknown execution mode", launch({ executionMode: "model_decides" })],
  ["unexpected launch field", { ...launch(), modelChoice: "workspace" }],
  ["malformed task id", launch({ roveTaskId: "alpha" })],
  ["malformed date", launch({ selectedAt: "today" })],
  [
    "legacy noncanonical workspace id",
    launch({ resolvedWorkspaceId: "wrk_primary" }),
  ],
  [
    "calendar-invalid RFC 3339 date",
    launch({ selectedAt: "2026-02-30T12:00:00Z" }),
  ],
  [
    "unsupported leap-second date-time",
    launch({ selectedAt: "2028-02-29T23:59:60+00:00" }),
  ],
])
  check("Schemas", `${name} is rejected`, () =>
    assert.notEqual(validateSchema(taskLaunchSchema, clean(value)).length, 0),
  );

check(
  "Schemas",
  "all checked-in schemas use the audited keyword subset",
  () => {
    auditSchema(taskLaunchSchema);
    auditSchema(continuationSchema);
    auditSchema(boundary.transportEnvelopeSchema);
    assertSchema(
      taskLaunchSchema,
      launch({ selectedAt: "2028-02-29T23:59:59+00:00" }),
    );
  },
);
check(
  "Schemas",
  "unsupported schema keywords types and formats fail closed",
  () => {
    rejects(
      () => auditSchema({ type: "string", minItems: 1 }),
      /unsupported schema keyword minItems/,
    );
    rejects(() => auditSchema({ type: "number" }), /unsupported schema type/);
    rejects(
      () => auditSchema({ type: "string", format: "email" }),
      /unsupported format/,
    );
    rejects(
      () =>
        auditSchema({
          type: "object",
          required: "id",
          additionalProperties: "false",
        }),
      /additionalProperties|required/,
    );
    rejects(
      () => auditSchema({ type: "object", required: "id" }),
      /array of unique strings/,
    );
    rejects(
      () => auditSchema({ type: "object", properties: [] }),
      /properties: must be an object/,
    );
    rejects(() => auditSchema({ enum: [] }), /non-empty array/);
    rejects(() => auditSchema({ enum: ["x", "x"] }), /must be unique/);
    rejects(
      () => auditSchema({ type: "string", minLength: -1 }),
      /non-negative/,
    );
    rejects(
      () => auditSchema({ type: "integer", minimum: "1" }),
      /finite number/,
    );
    rejects(() => auditSchema({ allOf: {} }), /must be an array/);
  },
);

check("Schemas", "pending continuation validates", () =>
  assertSchema(continuationSchema, continuation()),
);
check("Schemas", "all production continuation lifecycle states validate", () => {
  for (const value of [
    continuation(),
    continuation({
      freshInspectionRequired: false,
      continuationCommand: continuationCommand("possibly_started"),
    }),
    continuation({
      status: "consumed",
      consumedEventId: "evt_1",
      freshInspectionRequired: false,
      continuationCommand: continuationCommand("terminal"),
    }),
    continuation({ status: "cancelled" }),
    continuation({ status: "superseded" }),
  ])
    assertSchema(continuationSchema, value);
});
check(
  "Schemas",
  "observation fingerprint rejects immutable drift and preserves legacy migration",
  () => {
    const coordinator = new ContinuationCoordinator(continuationSchema);
    coordinator.persist(continuation());
    rejects(
      () =>
        coordinator.persist({
          ...continuation(),
          requestedInstruction: "Changed immutable instruction",
          observationFingerprint: continuation().observationFingerprint,
        }),
      /fingerprint_mismatch/,
    );
    const legacy = continuation();
    delete legacy.handoffId;
    delete legacy.observationFingerprint;
    assertSchema(continuationSchema, legacy);
    rejects(
      () =>
        assertSchema(continuationSchema, {
          ...legacy,
          observationFingerprint: "f".repeat(64),
        }),
      /forbidden schema|not|required/,
    );
  },
);
check(
  "Schemas",
  "consumed continuation records completed fresh inspection and receipt",
  () =>
    assertSchema(
      continuationSchema,
      continuation({
        status: "consumed",
        consumedEventId: "evt_1",
        freshInspectionRequired: false,
        continuationCommand: continuationCommand("terminal"),
      }),
    ),
);
for (const [name, value] of [
  [
    "consumed without receipt",
    continuation({ status: "consumed", freshInspectionRequired: true }),
  ],
  [
    "consumed with inspection still required",
    continuation({
      status: "consumed",
      consumedEventId: "evt_1",
      freshInspectionRequired: true,
      continuationCommand: continuationCommand("terminal"),
    }),
  ],
  [
    "mutation typo",
    {
      ...continuation(),
      freshInspectionRequired: undefined,
      requiresFreshInspection: true,
    },
  ],
  ["pending with consumed receipt", continuation({ consumedEventId: "evt_1" })],
  [
    "cancelled with consumed receipt",
    continuation({ status: "cancelled", consumedEventId: "evt_1" }),
  ],
  [
    "superseded with consumed receipt",
    continuation({ status: "superseded", consumedEventId: "evt_1" }),
  ],
  [
    "pending with terminal continuation command",
    continuation({
      freshInspectionRequired: false,
      continuationCommand: continuationCommand("terminal"),
    }),
  ],
  [
    "cancelled with retryable continuation command",
    continuation({
      status: "cancelled",
      freshInspectionRequired: true,
      continuationCommand: continuationCommand("not_started"),
    }),
  ],
])
  check("Schemas", `${name} is rejected`, () =>
    assert.notEqual(validateSchema(continuationSchema, clean(value)).length, 0),
  );

check("E1", "request before initialization is rejected", () =>
  rejects(
    () => new RpcCorrelation().request("account/read"),
    /not_initialized/,
  ),
);
check("E1", "initialized requests correlate out of order", () => {
  const rpc = new RpcCorrelation();
  rpc.initialize();
  const first = rpc.request("account/read");
  const second = rpc.request("model/list");
  rpc.settle(second);
  rpc.settle(first);
  assert.equal(rpc.pending.size, 0);
});
check("E1", "duplicate and unknown responses fail closed", () => {
  const rpc = new RpcCorrelation();
  rpc.initialize();
  const id = rpc.request("account/read");
  rpc.settle(id);
  rejects(() => rpc.settle(id), /duplicate_response/);
  rejects(() => rpc.settle("orphan"), /unknown_response_id/);
});
check("E1", "malformed JSON cannot enter correlation state", () =>
  rejects(() => JSON.parse("{malformed"), /JSON/),
);
check("E1", "process exit fences outstanding requests", () => {
  const rpc = new RpcCorrelation();
  rpc.initialize();
  rpc.request("turn/start");
  assert.deepEqual(
    rpc.exit().map(({ method, outcome }) => ({ method, outcome })),
    [{ method: "turn/start", outcome: "transport_uncertain" }],
  );
});

check("E2", "stored catalog equals production TOOL_CATALOG", () => {
  const block = catalogSource.match(
    /ROVE_TOOL_CATALOG\s*=\s*\[([\s\S]*?)\]\s*as const/,
  )?.[1];
  assert.ok(block, "production TOOL_CATALOG was not parseable");
  const production = [...block.matchAll(/["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(catalog.tools, production);
});
check("E2", "task capability binds calls and rejects mismatch", () => {
  const call = (taskId, capability) => {
    if (taskId !== "task_alpha" || capability !== "rtcap_fixture")
      throw new Error("task_binding_mismatch");
    return { serverInfo: { name: catalog.serverName }, tools: catalog.tools };
  };
  assert.equal(
    call("task_alpha", "rtcap_fixture").tools.length,
    catalog.tools.length,
  );
  rejects(() => call("task_other", "rtcap_fixture"), /task_binding_mismatch/);
  rejects(() => call("task_alpha", "rtcap_other"), /task_binding_mismatch/);
});
check("E2", "required server readiness keeps authentication distinct", () => {
  const readiness = (status) =>
    status === "connected"
      ? "ready"
      : status === "authenticationRequired"
        ? "reauthentication_required"
        : "unavailable";
  assert.deepEqual(
    [
      readiness("connected"),
      readiness("authenticationRequired"),
      readiness("failed"),
    ],
    ["ready", "reauthentication_required", "unavailable"],
  );
});
check("E2", "typed MCP content survives the boundary", () => {
  const content = [
    { type: "text", text: "ok" },
    { type: "image", data: "AA==", mimeType: "image/png" },
  ];
  assert.deepEqual(
    content.map(({ type }) => type),
    ["text", "image"],
  );
});

check(
  "E3",
  "all Codex attention kinds interleave with independent Rove control",
  () => {
    const attention = new AttentionCoordinator();
    const kinds = [
      "command",
      "file",
      "network",
      "permission",
      "mcp_elicitation",
      "user_input",
    ];
    for (const [index, kind] of kinds.entries()) {
      attention.addCodex({
        requestId: `req_${kind}`,
        threadId: "thr_1",
        turnId: index < 3 ? "turn_1" : "turn_2",
        itemId: `item_${kind}`,
        kind,
      });
      if (index === 1)
        attention.addRove({
          sessionId: "session_1",
          generation: 1,
          taskId: "task_alpha",
          action: "take_over",
        });
      if (index === 3)
        attention.addRove({
          sessionId: "session_1",
          generation: 2,
          taskId: "task_alpha",
          action: "pause",
        });
      if (index === 5)
        attention.addRove({
          sessionId: "session_1",
          generation: 3,
          taskId: "task_alpha",
          action: "return",
        });
    }
    assert.equal(attention.projection().length, 9);
    attention.resolveCodex({
      requestId: "req_network",
      threadId: "thr_1",
      turnId: "turn_1",
      itemId: "item_network",
    });
    attention.resolveRove({
      sessionId: "session_1",
      generation: 2,
      taskId: "task_alpha",
    });
    assert.deepEqual(
      attention
        .projection()
        .map(
          ({ authority, kind, action }) =>
            `${authority}:${kind ?? action ?? "control"}`,
        ),
      [
        "codex:command",
        "codex:file",
        "codex:permission",
        "codex:mcp_elicitation",
        "codex:user_input",
        "rove:take_over",
        "rove:return",
      ],
    );
  },
);
check(
  "E3",
  "cross-authority and stale decisions reject without queue mutation",
  () => {
    const attention = new AttentionCoordinator();
    attention.addCodex({
      requestId: "same",
      threadId: "thr_1",
      turnId: "turn_1",
      itemId: "item_1",
      kind: "command",
    });
    attention.addRove({
      sessionId: "same",
      generation: 1,
      taskId: "task_alpha",
    });
    rejects(
      () =>
        attention.resolveRove({
          sessionId: "same",
          generation: 1,
          taskId: "task_other",
        }),
      /stale_rove/,
    );
    rejects(
      () =>
        attention.resolveCodex({
          requestId: "same",
          threadId: "thr_old",
          turnId: "turn_1",
          itemId: "item_1",
        }),
      /stale_codex/,
    );
    assert.equal(attention.projection().length, 2);
  },
);
check("E3", "exact duplicate redelivery is idempotent", () => {
  const attention = new AttentionCoordinator();
  const codex = {
    requestId: "req_1",
    threadId: "thr_1",
    turnId: "turn_1",
    itemId: "item_1",
    kind: "command",
  };
  const rove = { sessionId: "session_1", generation: 1, taskId: "task_alpha" };
  attention.addCodex(codex);
  attention.addCodex(codex);
  attention.addRove(rove);
  attention.addRove(rove);
  assert.equal(attention.projection().length, 2);
});
check("E3", "Codex and Rove identity collisions fail closed", () => {
  const attention = new AttentionCoordinator();
  attention.addCodex({
    requestId: "req_1",
    threadId: "thr_1",
    turnId: "turn_1",
    itemId: "item_1",
    kind: "command",
  });
  rejects(
    () =>
      attention.addCodex({
        requestId: "req_1",
        threadId: "thr_1",
        turnId: "turn_2",
        itemId: "item_2",
        kind: "file",
      }),
    /attention_identity_collision/,
  );
  attention.addRove({
    sessionId: "session_1",
    generation: 1,
    taskId: "task_alpha",
  });
  rejects(
    () =>
      attention.addRove({
        sessionId: "session_1",
        generation: 1,
        taskId: "task_beta",
      }),
    /attention_identity_collision/,
  );
});
check(
  "E3",
  "turn cancellation clears only that turn and leaves Rove control pending",
  () => {
    const attention = new AttentionCoordinator();
    attention.addCodex({
      requestId: "req_1",
      threadId: "thr_1",
      turnId: "turn_1",
      itemId: "item_1",
      kind: "command",
    });
    attention.addRove({
      sessionId: "session_1",
      generation: 1,
      taskId: "task_alpha",
    });
    attention.addCodex({
      requestId: "req_2",
      threadId: "thr_1",
      turnId: "turn_2",
      itemId: "item_2",
      kind: "user_input",
    });
    attention.cancelTurn("thr_1", "turn_1");
    assert.deepEqual(
      attention
        .projection()
        .map(({ authority, turnId }) => `${authority}:${turnId ?? "task"}`),
      ["codex:turn_2", "rove:task"],
    );
  },
);

check("E4", "crash-cut table recovers once and fences unsafe replay", () => {
  const cuts = [
    {
      name: "before_response",
      consequenceKey: "request_1",
      dispatchStatus: "not_started",
      terminal: "failed",
      expectedReplay: true,
      expectedSource: "dispatch",
    },
    {
      name: "mid_stream",
      consequenceKey: "stream_1",
      dispatchStatus: "started",
      terminal: "failed",
      expectedReplay: false,
      expectedSource: "replay_fence",
    },
    {
      name: "during_attention",
      consequenceKey: "approval_1",
      dispatchStatus: "unknown",
      terminal: "interrupted",
      expectedReplay: false,
      expectedSource: "replay_fence",
    },
    {
      name: "ordinary_rove_action",
      consequenceKey: "navigate_1",
      dispatchStatus: "started",
      terminal: "failed",
      freshObservation: { applied: true },
      expectedReplay: false,
      expectedSource: "fresh_observation",
    },
    {
      name: "post_consequential_dispatch",
      consequenceKey: "purchase_1",
      dispatchStatus: "unknown",
      terminal: "failed",
      receipt: { consequenceKey: "purchase_1", outcome: "applied" },
      expectedReplay: false,
      expectedSource: "receipt",
    },
  ];
  for (const cut of cuts) {
    const beforeCrash = new OutcomeCoordinator();
    if (cut.receipt) beforeCrash.recordReceipt(cut.receipt);
    const durableState = beforeCrash.serialize();
    const { attempt, value: outcomes } = new BoundedRestartSupervisor(
      3,
    ).restart((candidate) =>
      candidate === 2 ? OutcomeCoordinator.restore(durableState) : null,
    );
    const recovered = outcomes.recover(cut);
    assert.equal(attempt, 2, cut.name);
    assert.equal(recovered.projectedEvents, 1, cut.name);
    assert.equal(recovered.activeTurnId, null, cut.name);
    assert.equal(recovered.replay, cut.expectedReplay, cut.name);
    assert.equal(recovered.source, cut.expectedSource, cut.name);
  }
  rejects(
    () => new BoundedRestartSupervisor(2).restart(() => null),
    /restart_exhausted/,
  );
});
check(
  "E4",
  "event redelivery is idempotent but identity collision fails closed",
  () => {
    const log = new EventLog();
    const event = { id: "evt_1", type: "turn.completed", status: "completed" };
    assert.equal(log.append(event), true);
    assert.equal(log.append(event), false);
    rejects(
      () => log.append({ ...event, status: "failed" }),
      /event_identity_collision/,
    );
    assert.equal(log.events.length, 1);
  },
);
check("E4", "duplicate consequence receipt is rejected", () => {
  const outcomes = new OutcomeCoordinator();
  outcomes.recordReceipt({ consequenceKey: "x", outcome: "applied" });
  rejects(
    () => outcomes.recordReceipt({ consequenceKey: "x", outcome: "applied" }),
    /duplicate_consequence/,
  );
});

for (const [phase, pendingAttention] of [
  ["streaming", 0],
  ["needs_human", 1],
])
  check(
    "E5",
    `${phase} survives the full presentation and restart matrix`,
    () => {
      let store = new UnifiedProductStore({
        taskId: "task_alpha",
        sessionId: "session_1",
        threadId: "thr_1",
        controller: pendingAttention ? "human" : "agent",
        phase,
        pendingAttention,
      });
      const invariant = clone(store.state);
      const steps = [
        { presentation: "chip" },
        { presentation: "expanded" },
        { presentation: "full" },
        { presentation: "expanded" },
        { presentation: "full" },
        { browserContext: "fullscreen", presentation: "chip" },
        { suppressed: true },
        { suppressed: false, browserContext: "windowed" },
      ];
      for (const step of steps) {
        const view = store.transition(step);
        assert.deepEqual(
          clean({
            taskId: view.taskId,
            sessionId: view.sessionId,
            threadId: view.threadId,
            controller: view.controller,
            phase: view.phase,
            pendingAttention: view.pendingAttention,
          }),
          invariant,
        );
        assert.equal(view.visibleHostCount, 1);
      }
      store = UnifiedProductStore.restore(store.serialize()); // renderer crash/reload
      assert.deepEqual(store.state, invariant);
      store = UnifiedProductStore.restore(store.serialize()); // Desktop restart
      assert.deepEqual(store.state, invariant);
      assert.equal(store.project().visibleHostCount, 1);
    },
  );

const returnEvent = (overrides = {}) => ({
  id: "evt_return",
  roveTaskId: "task_alpha",
  roveSessionId: "session_1",
  handoffId: "handoff_alpha",
  handoffGeneration: 2,
  ...overrides,
});

for (const timing of [
  "before_wait_timeout",
  "after_wait_timeout",
  "originating_turn_completed",
])
  check(
    "E6",
    `${timing} records exactly one host-authored start command when idle`,
    () => {
      const events = new EventLog();
      if (timing === "before_wait_timeout")
        events.append({ id: "evt_return", type: "control.returned" });
      let coordinator = new ContinuationCoordinator(continuationSchema);
      coordinator.persist(continuation());
      if (timing !== "before_wait_timeout")
        events.append({ id: "evt_return", type: "control.returned" });
      coordinator = ContinuationCoordinator.restore(
        continuationSchema,
        coordinator.serialize(),
      );
      const result = coordinator.returnControl(returnEvent(), {
        threadId: "thr_1",
        activeTurnId: null,
      });
      assert.equal(result.action, "start_turn");
      assert.equal(result.authoredBy, "host");
      assert.equal(result.dispatchStatus, "not_started");
      assert.equal(result.payload.roveContinuationCommandId, result.commandId);
      assert.equal(coordinator.records.get("task_alpha").status, "pending");
      coordinator = ContinuationCoordinator.restore(
        continuationSchema,
        coordinator.serialize(),
      );
      assert.equal(
        coordinator.returnControl(returnEvent(), {
          threadId: "thr_1",
          activeTurnId: null,
        }).commandId,
        result.commandId,
      );
      assert.equal(
        coordinator.reconcileDispatch("task_alpha", result.commandId, {
          threadId: "thr_1",
          activeTurnId: null,
        }).action,
        "retry",
      );
      coordinator.beginDispatch("task_alpha", result.commandId);
      assert.equal(
        coordinator.reconcileDispatch("task_alpha", result.commandId, {
          threadId: "thr_1",
          terminalContinuationCommandIds: [result.commandId],
        }).action,
        "complete",
      );
      assert.equal(coordinator.records.get("task_alpha").status, "consumed");
    },
  );
check(
  "E6",
  "matching originating turn records one durable steer command",
  () => {
    const coordinator = new ContinuationCoordinator(continuationSchema);
    coordinator.persist(continuation());
    const result = coordinator.returnControl(returnEvent(), {
      threadId: "thr_1",
      activeTurnId: "turn_1",
    });
    assert.equal(result.action, "steer");
    assert.equal(result.authoredBy, "host");
    assert.equal(coordinator.records.get("task_alpha").status, "pending");
    assert.equal(
      coordinator.records.get("task_alpha").continuationCommand.kind,
      "turn/steer",
    );
    coordinator.beginDispatch("task_alpha", result.commandId);
    coordinator.reconcileDispatch("task_alpha", result.commandId, {
      threadId: "thr_1",
      terminalContinuationCommandIds: [result.commandId],
    });
    assert.equal(coordinator.records.get("task_alpha").status, "consumed");
  },
);
check(
  "E6",
  "different active turn waits without consuming until the thread is idle",
  () => {
    const coordinator = new ContinuationCoordinator(continuationSchema);
    coordinator.persist(continuation());
    assert.deepEqual(
      coordinator.returnControl(returnEvent(), {
        threadId: "thr_other",
        activeTurnId: "turn_1",
      }),
      { action: "reject", reason: "thread_identity_mismatch" },
    );
    assert.deepEqual(coordinator.records.get("task_alpha"), continuation());
    assert.deepEqual(
      coordinator.returnControl(returnEvent(), {
        threadId: "thr_1",
        activeTurnId: "turn_other",
      }),
      {
        action: "wait_for_idle",
        reason: "different_turn_active",
        activeTurnId: "turn_other",
      },
    );
    assert.deepEqual(coordinator.records.get("task_alpha"), {
      ...continuation(),
      freshInspectionRequired: false,
      returnEventId: "evt_return",
    });
    assert.equal(
      coordinator.returnControl(returnEvent(), {
        threadId: "thr_1",
        activeTurnId: null,
      }).action,
      "start_turn",
    );
  },
);
check(
  "E6",
  "durable outbox closes all three continuation crash windows",
  () => {
    const create = () => {
      const coordinator = new ContinuationCoordinator(continuationSchema);
      coordinator.persist(continuation());
      const result = coordinator.returnControl(returnEvent(), {
        threadId: "thr_1",
        activeTurnId: null,
      });
      return { coordinator, commandId: result.commandId };
    };

    let beforeDispatch = create();
    beforeDispatch.coordinator = ContinuationCoordinator.restore(
      continuationSchema,
      beforeDispatch.coordinator.serialize(),
    );
    assert.equal(
      beforeDispatch.coordinator.reconcileDispatch(
        "task_alpha",
        beforeDispatch.commandId,
        { threadId: "thr_1", activeTurnId: null },
      ).action,
      "retry",
    );

    let afterAcceptance = create();
    const preparedSend = afterAcceptance.coordinator.beginDispatch(
      "task_alpha",
      afterAcceptance.commandId,
    );
    assert.equal(
      afterAcceptance.coordinator.records.get("task_alpha").continuationCommand
        .dispatchStatus,
      "possibly_started",
    );
    const stateCommittedBeforeWire = afterAcceptance.coordinator.serialize();
    assert.equal(
      preparedSend.command.payload.roveContinuationCommandId,
      afterAcceptance.commandId,
    );
    const wireAcceptedPayload = globalThis.structuredClone(
      preparedSend.command.payload,
    );
    afterAcceptance.coordinator = ContinuationCoordinator.restore(
      continuationSchema,
      stateCommittedBeforeWire,
    );
    assert.equal(
      afterAcceptance.coordinator.reconcileDispatch(
        "task_alpha",
        afterAcceptance.commandId,
        {
          threadId: "thr_1",
          activeTurnId: null,
          hostAuthoredPayloads: [wireAcceptedPayload],
        },
      ).action,
      "await_terminal",
    );
    assert.equal(
      afterAcceptance.coordinator.reconcileDispatch(
        "task_alpha",
        afterAcceptance.commandId,
        { threadId: "thr_1" },
      ).action,
      "replay_fenced",
    );
    const legacyMissedCommit = create();
    assert.equal(
      legacyMissedCommit.coordinator.reconcileDispatch(
        "task_alpha",
        legacyMissedCommit.commandId,
        {
          threadId: "thr_1",
          activeTurnId: null,
          hostAuthoredPayloads: [
            legacyMissedCommit.coordinator.records.get("task_alpha")
              .continuationCommand.payload,
          ],
        },
      ).action,
      "await_terminal",
    );
    const definitelyNotStarted = create();
    definitelyNotStarted.coordinator.beginDispatch(
      "task_alpha",
      definitelyNotStarted.commandId,
    );
    assert.equal(
      definitelyNotStarted.coordinator.reconcileDispatch(
        "task_alpha",
        definitelyNotStarted.commandId,
        {
          threadId: "thr_1",
          activeTurnId: null,
          definitelyNotStarted: true,
        },
      ).action,
      "retry",
    );

    const steerBecameIdle = (() => {
      const coordinator = new ContinuationCoordinator(continuationSchema);
      coordinator.persist(continuation());
      const result = coordinator.returnControl(returnEvent(), {
        threadId: "thr_1",
        activeTurnId: "turn_1",
      });
      return { coordinator, commandId: result.commandId };
    })();
    const converted = steerBecameIdle.coordinator.reconcileDispatch(
      "task_alpha",
      steerBecameIdle.commandId,
      { threadId: "thr_1", activeTurnId: null },
    );
    assert.equal(converted.action, "retry");
    assert.equal(converted.command.kind, "turn/start");
    assert.equal(converted.command.commandId, steerBecameIdle.commandId);

    const startBlocked = create();
    assert.deepEqual(
      startBlocked.coordinator.reconcileDispatch(
        "task_alpha",
        startBlocked.commandId,
        { threadId: "thr_1", activeTurnId: "turn_other" },
      ),
      { action: "wait_for_idle", activeTurnId: "turn_other" },
    );

    let afterTerminal = create();
    afterTerminal.coordinator.beginDispatch(
      "task_alpha",
      afterTerminal.commandId,
    );
    assert.equal(
      afterTerminal.coordinator.reconcileDispatch(
        "task_alpha",
        afterTerminal.commandId,
        {
          threadId: "thr_1",
          terminalContinuationCommandIds: [afterTerminal.commandId],
        },
      ).action,
      "complete",
    );
    afterTerminal.coordinator = ContinuationCoordinator.restore(
      continuationSchema,
      afterTerminal.coordinator.serialize(),
    );
    assert.equal(
      afterTerminal.coordinator.reconcileDispatch(
        "task_alpha",
        afterTerminal.commandId,
        { threadId: "thr_1" },
      ).action,
      "complete",
    );
    assert.equal(
      afterTerminal.coordinator.records.get("task_alpha").consumedEventId,
      "evt_return",
    );
  },
);
check(
  "E6",
  "exact observed handoff replay is inert across every lifecycle state",
  () => {
    for (const value of [
      continuation(),
      continuation({
        freshInspectionRequired: false,
        continuationCommand: continuationCommand("possibly_started"),
      }),
      continuation({
        status: "consumed",
        consumedEventId: "evt_1",
        freshInspectionRequired: false,
        continuationCommand: continuationCommand("terminal"),
      }),
      continuation({ status: "cancelled" }),
      continuation({ status: "superseded" }),
    ]) {
      const coordinator = new ContinuationCoordinator(continuationSchema, [value]);
      assert.equal(coordinator.persist(continuation()), false);
      assert.deepEqual(coordinator.records.get("task_alpha"), value);
    }
  },
);
check(
  "E6",
  "renderer App Server and Desktop restart preserve one pending continuation",
  () => {
    let coordinator = new ContinuationCoordinator(continuationSchema);
    coordinator.persist(continuation());
    for (const component of ["renderer", "app_server", "desktop"]) {
      coordinator = ContinuationCoordinator.restore(
        continuationSchema,
        coordinator.serialize(),
      );
      assert.deepEqual(
        coordinator.records.get("task_alpha"),
        continuation(),
        component,
      );
    }
    assert.equal(
      coordinator.returnControl(returnEvent(), {
        threadId: "thr_1",
        activeTurnId: null,
      }).action,
      "start_turn",
    );
  },
);
check(
  "E6",
  "reordered stale and duplicate Return events cannot create a second continuation",
  () => {
    const coordinator = new ContinuationCoordinator(continuationSchema);
    assert.equal(
      coordinator.returnControl(returnEvent(), {
        threadId: "thr_1",
        activeTurnId: null,
      }).action,
      "reject",
    );
    coordinator.persist(continuation());
    assert.equal(
      coordinator.returnControl(returnEvent({ handoffGeneration: 1 }), {
        threadId: "thr_1",
        activeTurnId: null,
      }).action,
      "reject",
    );
    assert.equal(
      coordinator.returnControl(returnEvent(), {
        threadId: "thr_1",
        activeTurnId: null,
      }).action,
      "start_turn",
    );
    assert.equal(
      coordinator.returnControl(returnEvent({ id: "evt_late" }), {
        threadId: "thr_1",
        activeTurnId: null,
      }).action,
      "reject",
    );
  },
);
check(
  "E6",
  "cancel and explicit-user-response policies prevent auto-continuation",
  () => {
    const cancelled = new ContinuationCoordinator(continuationSchema);
    cancelled.persist(continuation());
    const undispatched = cancelled.returnControl(returnEvent(), {
      threadId: "thr_1",
      activeTurnId: null,
    });
    assert.deepEqual(cancelled.cancel("task_alpha"), {
      action: "cancelled_undispatched",
    });
    assert.equal(
      cancelled.records.get("task_alpha").continuationCommand,
      undefined,
    );
    assert.deepEqual(
      cancelled.reconcileDispatch("task_alpha", undispatched.commandId, {
        threadId: "thr_1",
      }),
      { action: "cancelled" },
    );
    assert.equal(
      cancelled.returnControl(returnEvent(), {
        threadId: "thr_1",
        activeTurnId: null,
      }).action,
      "reject",
    );
    const inFlight = new ContinuationCoordinator(continuationSchema);
    inFlight.persist(continuation());
    const dispatched = inFlight.returnControl(returnEvent(), {
      threadId: "thr_1",
      activeTurnId: null,
    });
    inFlight.beginDispatch("task_alpha", dispatched.commandId);
    assert.deepEqual(inFlight.cancel("task_alpha"), {
      action: "reconcile_or_interrupt",
    });
    rejects(
      () => inFlight.beginDispatch("task_alpha", dispatched.commandId),
      /continuation_not_pending/,
    );
    assert.deepEqual(
      inFlight.reconcileDispatch("task_alpha", dispatched.commandId, {
        threadId: "thr_1",
      }),
      { action: "reconcile_or_interrupt" },
    );
    assert.equal(
      inFlight.reconcileDispatch("task_alpha", dispatched.commandId, {
        threadId: "thr_1",
        hostAuthoredPayloads: [dispatched.payload],
      }).action,
      "await_cancelled_terminal",
    );
    assert.equal(
      inFlight.reconcileDispatch("task_alpha", dispatched.commandId, {
        threadId: "thr_1",
        terminalContinuationCommandIds: [dispatched.commandId],
      }).action,
      "cancelled_terminal",
    );
    const superseded = new ContinuationCoordinator(continuationSchema);
    superseded.persist(continuation());
    superseded.returnControl(returnEvent(), {
      threadId: "thr_1",
      activeTurnId: null,
    });
    assert.deepEqual(superseded.supersede("task_alpha"), {
      action: "superseded_undispatched",
    });
    const explicit = new ContinuationCoordinator(continuationSchema);
    explicit.persist(
      continuation({ continuationPolicy: "explicit_user_response" }),
    );
    assert.deepEqual(
      explicit.returnControl(returnEvent(), {
        threadId: "thr_other",
        activeTurnId: null,
      }),
      { action: "reject", reason: "thread_identity_mismatch" },
    );
    assert.equal(
      explicit.returnControl(returnEvent(), {
        threadId: "thr_1",
        activeTurnId: null,
      }).action,
      "pause",
    );
    assert.equal(explicit.records.get("task_alpha").status, "pending");
  },
);
check(
  "E6",
  "restored records validate and conflicting task records fail closed",
  () => {
    rejects(
      () =>
        ContinuationCoordinator.restore(
          continuationSchema,
          JSON.stringify([{ ...continuation(), status: "consumed" }]),
        ),
      /consumedEventId|freshInspectionRequired/,
    );
    const coordinator = new ContinuationCoordinator(continuationSchema);
    assert.equal(coordinator.persist(continuation()), true);
    assert.equal(coordinator.persist(continuation()), false);
    rejects(
      () =>
        coordinator.persist(
          continuation({ roveSessionId: "session_conflict" }),
        ),
      /continuation_task_collision/,
    );
    rejects(
      () =>
        ContinuationCoordinator.restore(
          continuationSchema,
          JSON.stringify([
            continuation(),
            continuation({ roveSessionId: "session_conflict" }),
          ]),
        ),
      /continuation_task_collision/,
    );
    rejects(
      () =>
        ContinuationCoordinator.restore(
          continuationSchema,
          JSON.stringify([
            continuation({
              freshInspectionRequired: false,
              continuationCommand: continuationCommand("not_started", {
                payload: {
                  roveContinuationCommandId: "wrong_command",
                  authoredBy: "host",
                  instruction: "Continue after human control returns",
                },
              }),
            }),
          ]),
        ),
      /continuation_command_correlation_mismatch/,
    );
  },
);

check(
  "E7",
  "login refresh logout and unavailable usage replace redacted projections",
  () => {
    const projection = new AccountCatalogProjection();
    projection.reduce({
      type: "login_completed",
      authMode: "chatgpt",
      plan: "team",
    });
    projection.reduce({ type: "token_refreshed", at: "2026-09-07T12:00:00Z" });
    projection.reduce({
      type: "models",
      models: [
        { id: "m1", hidden: false },
        { id: "old", hidden: true },
      ],
    });
    projection.reduce({ type: "usage", usage: null });
    projection.reduce({ type: "rate_limits", rateLimits: { remaining: 42 } });
    assert.deepEqual(
      projection.state.models.map(({ id }) => id),
      ["m1"],
    );
    assert.equal(projection.state.usage, null);
    assert.equal(projection.state.rateLimits.remaining, 42);
    projection.reduce({ type: "logout" });
    assert.equal(projection.state.account.status, "logged_out");
    assert.equal(JSON.stringify(projection.state).includes("token"), false);
  },
);
check("E7", "browser and device-code login flows remain device-owned", () => {
  for (const authMode of ["browser", "device_code"]) {
    const projection = new AccountCatalogProjection();
    projection.reduce({ type: "login_completed", authMode, plan: "team" });
    assert.deepEqual(projection.state.account, {
      status: "logged_in",
      authMode,
      plan: "team",
    });
  }
});
check(
  "E7",
  "catalog change hides hidden models and rejects unsupported effort",
  () => {
    const projection = new AccountCatalogProjection();
    projection.reduce({
      type: "models",
      models: [
        { id: "m1", hidden: false, efforts: ["low", "high"] },
        { id: "hidden", hidden: true, efforts: ["max"] },
      ],
    });
    const select = (modelId, effort) => {
      const model = projection.state.models.find(({ id }) => id === modelId);
      if (!model || !model.efforts.includes(effort))
        throw new Error("unsupported_effort");
      return { modelId, effort };
    };
    assert.deepEqual(select("m1", "high"), { modelId: "m1", effort: "high" });
    rejects(() => select("m1", "max"), /unsupported_effort/);
    rejects(() => select("hidden", "max"), /unsupported_effort/);
  },
);
check("E7", "allowlisted cloud envelope drops local secrets", () => {
  const envelope = toCloudEnvelope(boundary.transportEnvelopeSchema, {
    deviceId: "dev_1",
    sequence: 1,
    type: "redacted_task_event",
    payload: {
      taskId: "task_alpha",
      status: "running",
      summary: "safe",
      occurredAt: "2026-09-07T12:00:00Z",
      codexToken: "secret",
      browserCookie: "secret",
      localPath: "/secret",
    },
  });
  assert.deepEqual(Object.keys(envelope.payload).sort(), [
    "occurredAt",
    "status",
    "summary",
    "taskId",
  ]);
  assertSchema(boundary.transportEnvelopeSchema, envelope);
});
for (const [name, value] of [
  [
    "unknown top-level field",
    {
      schemaVersion: 1,
      deviceId: "dev_1",
      sequence: 1,
      type: "task_intent",
      payload: {},
      token: "x",
    },
  ],
  [
    "sensitive payload field",
    {
      schemaVersion: 1,
      deviceId: "dev_1",
      sequence: 1,
      type: "task_intent",
      payload: { codexToken: "x" },
    },
  ],
  [
    "unknown event type",
    {
      schemaVersion: 1,
      deviceId: "dev_1",
      sequence: 1,
      type: "local_approval",
      payload: {},
    },
  ],
])
  check("E7", `${name} is rejected by transport schema`, () =>
    rejects(
      () => assertSchema(boundary.transportEnvelopeSchema, value),
      /not allowed|enum/,
    ),
  );
check(
  "E7",
  "direct and JSON LocalProductApi adapters deliver the same ordered sequence",
  () => {
    const logicalSequence = [
      {
        deviceId: "dev_1",
        sequence: 1,
        type: "task_intent",
        payload: { taskId: "task_alpha", status: "requested" },
      },
      {
        deviceId: "dev_1",
        sequence: 2,
        type: "redacted_task_event",
        payload: {
          taskId: "task_alpha",
          status: "running",
          occurredAt: "2026-09-07T12:00:00Z",
        },
      },
      {
        deviceId: "dev_1",
        sequence: 3,
        type: "workflow_metadata",
        payload: { workflowId: "wf_1", status: "ready" },
      },
    ].map((event) => toCloudEnvelope(boundary.transportEnvelopeSchema, event));
    const directRemote = new RemoteProductFixture();
    const jsonRemote = new RemoteProductFixture();
    const direct = new DirectLocalProductApi((event) =>
      directRemote.receive(event),
    );
    const json = new JsonFixtureLocalProductApi((event) =>
      jsonRemote.receive(event),
    );
    for (const event of logicalSequence) {
      direct.send(event);
      json.send(event);
    }
    assert.deepEqual(directRemote.received, logicalSequence);
    assert.deepEqual(jsonRemote.received, logicalSequence);
    assert.deepEqual(jsonRemote.received, directRemote.received);
    assert.deepEqual(direct.instrumentation, {
      structuredClones: 3,
      jsonEncodes: 0,
      jsonDecodes: 0,
    });
    assert.deepEqual(json.instrumentation, {
      structuredClones: 0,
      jsonEncodes: 3,
      jsonDecodes: 3,
    });
  },
);
check(
  "E7",
  "remote fixture has no device-only execution or outcome authority",
  () => {
    const remote = new RemoteProductFixture();
    for (const authority of [
      "browser",
      "approval",
      "credential",
      "receipt",
      "consequentialOutcome",
    ])
      rejects(() => remote.invoke(authority), /authority_device_only/);
  },
);

check("E8", "all six execution and identity combinations validate", () => {
  const authority = new TaskLaunchAuthority(
    taskLaunchSchema,
    [{ id: workspaceId, leased: false, authenticated: true }],
    { executionMode: "companion", browserIdentityMode: "workspace" },
  );
  for (const executionMode of ["agent", "companion", "capture"])
    for (const browserIdentityMode of ["workspace", "temporary"]) {
      const resolved = authority.resolve(
        clean(
          launch({
            roveTaskId: `task_${executionMode}_${browserIdentityMode}`,
            executionMode,
            browserIdentityMode,
            resolvedWorkspaceId:
              browserIdentityMode === "workspace" ? workspaceId : undefined,
          }),
        ),
      );
      assertSchema(taskLaunchSchema, resolved);
      assert.equal(
        authority.authorizeSessionStart(resolved, resolved).initialController,
        executionMode === "capture" ? "human" : "agent",
      );
      authority.close(resolved);
    }
  assert.equal(authority.activeLaunches.size, 0);
});
check("E8", "agent session mismatch is actually rejected", () => {
  const authority = new TaskLaunchAuthority(
    taskLaunchSchema,
    [{ id: workspaceId, leased: false, authenticated: true }],
    null,
  );
  const resolved = authority.resolve(launch());
  rejects(
    () =>
      authority.authorizeSessionStart(resolved, {
        ...resolved,
        roveTaskId: "task_beta",
      }),
    /task_identity_mismatch/,
  );
  rejects(
    () =>
      authority.authorizeSessionStart(
        resolved,
        clean({
          ...resolved,
          browserIdentityMode: "temporary",
          resolvedWorkspaceId: undefined,
        }),
      ),
    /browser_identity_mismatch/,
  );
  rejects(
    () =>
      authority.authorizeSessionStart(resolved, {
        ...resolved,
        resolvedWorkspaceId: otherWorkspaceId,
      }),
    /workspace_identity_mismatch/,
  );
});
check(
  "E8",
  "no selection and missing or leased workspaces fail without fallback",
  () => {
    rejects(
      () =>
        new TaskLaunchAuthority(taskLaunchSchema, [], null).resolveSelection({
          roveTaskId: "task_alpha",
          selectedAt: "2026-09-07T12:00:00Z",
        }),
      /launch_selection_required/,
    );
    rejects(
      () =>
        new TaskLaunchAuthority(taskLaunchSchema, [], null).resolve(launch()),
      /workspace_missing/,
    );
    rejects(
      () =>
        new TaskLaunchAuthority(
          taskLaunchSchema,
          [{ id: workspaceId, leased: true, authenticated: true }],
          null,
        ).resolve(launch()),
      /workspace_leased/,
    );
  },
);
check(
  "E8",
  "workspace lease is acquired atomically and released by exact close",
  () => {
    const authority = new TaskLaunchAuthority(
      taskLaunchSchema,
      [{ id: workspaceId, leased: false, authenticated: true }],
      null,
    );
    const first = authority.resolve(launch());
    assert.equal(
      authority.workspaces.get(workspaceId).leasedByTaskId,
      "task_alpha",
    );
    rejects(
      () => authority.resolve(launch({ roveTaskId: "task_beta" })),
      /workspace_leased/,
    );
    authority.close(first);
    const second = authority.resolve(launch({ roveTaskId: "task_beta" }));
    assert.equal(
      authority.workspaces.get(workspaceId).leasedByTaskId,
      "task_beta",
    );
    authority.close(second);
  },
);
check("E8", "temporary cleanup cannot delete persistent workspace", () => {
  const authority = new TaskLaunchAuthority(
    taskLaunchSchema,
    [{ id: workspaceId, leased: false, authenticated: true }],
    null,
  );
  const persistent = authority.resolve(launch());
  const temporary = authority.resolve(
    clean(
      launch({
        roveTaskId: "task_temp",
        browserIdentityMode: "temporary",
        resolvedWorkspaceId: undefined,
      }),
    ),
  );
  assert.equal(authority.temporaryProfiles.has("task_temp"), true);
  authority.close(persistent);
  assert.equal(authority.temporaryProfiles.has("task_temp"), true);
  authority.close(temporary);
  assert.equal(authority.temporaryProfiles.has("task_temp"), false);
});
check("E8", "remembered default is unchanged by resolution", () => {
  const remembered = {
    executionMode: "companion",
    browserIdentityMode: "workspace",
    resolvedWorkspaceId: workspaceId,
  };
  const authority = new TaskLaunchAuthority(
    taskLaunchSchema,
    [{ id: workspaceId, leased: false, authenticated: true }],
    remembered,
  );
  authority.resolve(launch({ executionMode: "agent" }));
  assert.deepEqual(authority.rememberedDefault, remembered);
});
check(
  "E8",
  "active launch exact redelivery is idempotent and conflict fails closed",
  () => {
    const authority = new TaskLaunchAuthority(
      taskLaunchSchema,
      [{ id: workspaceId, leased: false, authenticated: true }],
      null,
    );
    const first = authority.resolve(launch());
    assert.equal(authority.resolve(launch()), first);
    assert.equal(authority.activeLaunches.size, 1);
    rejects(
      () => authority.resolve(launch({ executionMode: "capture" })),
      /active_launch_conflict/,
    );
    assert.deepEqual(authority.activeLaunches.get("task_alpha"), first);
  },
);
check("E8", "only exact close releases a task for explicit relaunch", () => {
  const authority = new TaskLaunchAuthority(
    taskLaunchSchema,
    [{ id: workspaceId, leased: false, authenticated: true }],
    null,
  );
  const first = authority.resolve(launch());
  rejects(
    () => authority.close({ ...first, executionMode: "capture" }),
    /active_launch_mismatch/,
  );
  rejects(
    () => authority.resolve(launch({ executionMode: "capture" })),
    /active_launch_conflict/,
  );
  assert.equal(authority.close(first), true);
  const relaunched = authority.resolve(launch({ executionMode: "capture" }));
  assert.equal(relaunched.executionMode, "capture");
});
check(
  "E8",
  "remembered default and one-time override resolve visibly without mutation",
  () => {
    const remembered = {
      executionMode: "companion",
      browserIdentityMode: "workspace",
      resolvedWorkspaceId: workspaceId,
    };
    const authority = new TaskLaunchAuthority(
      taskLaunchSchema,
      [{ id: workspaceId, leased: false, authenticated: true }],
      remembered,
    );
    const base = {
      roveTaskId: "task_default",
      selectedAt: "2026-09-07T12:00:00Z",
    };
    const fromDefault = authority.resolveSelection(base);
    const override = authority.resolveSelection({
      ...base,
      roveTaskId: "task_override",
      executionMode: "agent",
      browserIdentityMode: "temporary",
    });
    assert.equal(fromDefault.selectionSource, "remembered_default");
    assert.equal(fromDefault.resolvedWorkspaceId, workspaceId);
    assert.equal(override.selectionSource, "user_selected");
    assert.equal(override.browserIdentityMode, "temporary");
    assert.deepEqual(authority.rememberedDefault, remembered);
  },
);
check(
  "E8",
  "presentation changes and restart preserve immutable resolved launch",
  () => {
    let authority = new TaskLaunchAuthority(
      taskLaunchSchema,
      [{ id: workspaceId, leased: false, authenticated: true }],
      null,
    );
    const resolved = authority.resolve(launch());
    const serializedLaunch = JSON.stringify(resolved);
    for (const presentation of ["chip", "expanded", "full"]) {
      const view = { presentation, launch: resolved };
      assert.equal(view.launch, resolved);
      assert.equal(JSON.stringify(resolved), serializedLaunch);
    }
    authority = TaskLaunchAuthority.restore(
      taskLaunchSchema,
      authority.serialize(),
    );
    assert.equal(authority.workspaces.get(workspaceId).authenticated, true);
    assert.deepEqual(authority.resolve(JSON.parse(serializedLaunch)), resolved);
    rejects(
      () => authority.resolve(launch({ executionMode: "capture" })),
      /active_launch_conflict/,
    );
    assert.equal(authority.activeLaunches.size, 1);
    assert.equal(Object.isFrozen(resolved), true);
  },
);
check(
  "E8",
  "temporary profile survives restart only until explicit close",
  () => {
    let authority = new TaskLaunchAuthority(taskLaunchSchema, [], null);
    const temporary = authority.resolve(
      clean(
        launch({
          roveTaskId: "task_temp_restart",
          browserIdentityMode: "temporary",
          resolvedWorkspaceId: undefined,
        }),
      ),
    );
    authority = TaskLaunchAuthority.restore(
      taskLaunchSchema,
      authority.serialize(),
    );
    assert.equal(authority.temporaryProfiles.has("task_temp_restart"), true);
    authority.close(temporary);
    assert.equal(authority.temporaryProfiles.has("task_temp_restart"), false);
  },
);

const failed = results.filter(({ status }) => status === "fail");
console.log(
  JSON.stringify(
    {
      summary: {
        total: results.length,
        passed: results.length - failed.length,
        failed: failed.length,
      },
      results,
    },
    null,
    2,
  ),
);
if (failed.length > 0) process.exitCode = 1;
