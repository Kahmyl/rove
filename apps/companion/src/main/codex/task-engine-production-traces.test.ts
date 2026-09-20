import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  launchIntent,
  ProcessProductHarness,
  type ProductValue,
  task,
  taskId,
} from "./task-engine-process-harness.test-support.js";

const homes: string[] = [];
const processes: ProcessProductHarness[] = [];

async function product(
  options: ConstructorParameters<typeof ProcessProductHarness>[1] = {},
) {
  const home = await mkdtemp(join(tmpdir(), "rove-production-trace-"));
  homes.push(home);
  const harness = new ProcessProductHarness(home, options);
  processes.push(harness);
  await harness.start();
  return harness;
}

afterEach(async () => {
  await Promise.all(processes.splice(0).map((entry) => entry.stop()));
  await Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

function lifecycle(value: ProductValue): ProductValue {
  return value.lifecycle as ProductValue;
}

function conversation(value: ProductValue): ProductValue {
  return value.conversation as ProductValue;
}

function attention(snapshot: ProductValue): ProductValue[] {
  return (snapshot.attention as ProductValue[]) ?? [];
}

function attachments(value: ProductValue): ProductValue[] {
  return (value.attachments as ProductValue[]) ?? [];
}

function availableActions(value: ProductValue): string[] {
  return (value.availableActions as string[]) ?? [];
}

function processAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function bootstrapId(operationId: string): string {
  return `boot_${createHash("sha256").update(operationId).digest("hex").slice(0, 32)}`;
}

const ids = {
  launch: "intent_11111111-1111-4111-8111-111111111111",
  attention: "intent_22222222-2222-4222-8222-222222222222",
  handoff: "intent_33333333-3333-4333-8333-333333333333",
  finish: "intent_44444444-4444-4444-8444-444444444444",
  restart: "intent_55555555-5555-4555-8555-555555555555",
} as const;

describe("five process-backed production-composition lifecycle traces", () => {
  it("1. launches browserlessly with local attachments and exact Rove MCP/model parameters, and rejects a bad catalog", async () => {
    const current = await product();
    const selected = await current.request({
      type: "attachment.prepare",
      filename: "trace.txt",
      content: "process-backed attachment",
    });
    const attachmentId = String(
      ((selected.attachments as ProductValue[]) ?? [])[0]?.id,
    );
    await current.request(
      launchIntent(ids.launch, { attachmentIds: [attachmentId] }),
    );
    const snapshot = await current.until((value) => {
      const entry = task(value, taskId(ids.launch));
      const conversation = entry.conversation as ProductValue | undefined;
      const items = Object.values(
        (conversation?.items as ProductValue | undefined) ?? {},
      );
      return (
        entry.bootstrapStage === "complete" &&
        attachments(entry)[0]?.status === "bound" &&
        typeof (entry.initialLaunch as ProductValue | undefined)?.turnId ===
          "string" &&
        items.some(
          (item) =>
            (item as ProductValue).kind === "user_message" &&
            (item as ProductValue).clientId === ids.launch,
        )
      );
    });
    const entry = task(snapshot, taskId(ids.launch));
    expect(snapshot.recoveryWarnings).toEqual([]);
    expect(entry.initialLaunch).toMatchObject({
      operationId: ids.launch,
      stage: "turn_started",
      turnId: expect.any(String),
    });
    expect(
      Object.values(
        (entry.conversation as ProductValue).items as ProductValue,
      ).some(
        (item) =>
          (item as ProductValue).kind === "user_message" &&
          (item as ProductValue).clientId === ids.launch,
      ),
    ).toBe(true);
    const requests = (await current.request({
      type: "appserver.requests",
    })) as unknown as ProductValue[];
    const start = requests.find(
      (request) =>
        request.method === "thread/start" &&
        (request.rove as ProductValue | null)?.taskId === taskId(ids.launch),
    );
    expect(start).toMatchObject({
      method: "thread/start",
      model: "l2-model",
      reasoningEffort: "low",
      approvalsReviewer: "auto_review",
      permissions: "rove_task",
      defaultPermissions: "rove_task",
    });
    expect(start?.developerInstructions).toContain("Rove browser route policy");
    const rove = start?.rove as ProductValue | undefined;
    expect(rove).toMatchObject({
      required: true,
      enabled: true,
      taskId: taskId(ids.launch),
      bootstrapId: bootstrapId(ids.launch),
      mode: "agent",
      browserIdentity: JSON.stringify({ mode: "temporary" }),
      capability: true,
      verifier: true,
    });
    expect(rove?.sessionId).toBeUndefined();
    const actions = await current.request({ type: "external.actions" });
    expect(
      (actions.runtime as ProductValue[]).filter(
        (action) => action.method === "startSession",
      ),
    ).toHaveLength(0);
    expect(
      (actions.appServer as ProductValue[]).filter(
        (action) =>
          action.method === "turn/start" && action.correlation === ids.launch,
      ),
    ).toHaveLength(1);

    const rejected = await product({ badCatalog: true });
    const rejectedId = "intent_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await rejected.request(launchIntent(rejectedId));
    const failed = await rejected.until(
      (value) =>
        lifecycle(task(value, taskId(rejectedId))).phase === "recovering",
    );
    expect(task(failed, taskId(rejectedId)).codexThreadId).toBeUndefined();
    const rejectedActions = await rejected.request({
      type: "external.actions",
    });
    expect(
      (rejectedActions.appServer as ProductValue[]).filter(
        (action) => action.method === "turn/start",
      ),
    ).toHaveLength(0);
  }, 120_000);

  it("2. publishes conversation/progress and Codex attention through awaited ingress, response, and resolution", async () => {
    const current = await product();
    await current.request(launchIntent(ids.attention));
    await current.until(
      (value) =>
        task(value, taskId(ids.attention)).bootstrapStage === "complete",
    );
    const progress = await current.request({
      type: "codex.progress",
      taskId: taskId(ids.attention),
      text: "Durable process progress",
    });
    const itemId = String(progress.itemId);
    const projected = await current.until((value) =>
      Boolean(
        (
          conversation(task(value, taskId(ids.attention))).items as ProductValue
        )?.[itemId],
      ),
    );
    expect(
      (
        conversation(task(projected, taskId(ids.attention)))
          .items as ProductValue
      )[itemId],
    ).toMatchObject({ text: "Durable process progress", status: "completed" });

    const emitted = await current.request({
      type: "codex.attention",
      taskId: taskId(ids.attention),
      requestId: "approval_trace_2",
    });
    const second = await current.request({
      type: "codex.attention",
      taskId: taskId(ids.attention),
      requestId: "approval_trace_2b",
    });
    const requestId = String(emitted.requestId);
    const secondRequestId = String(second.requestId);
    const pending = await current.until((value) =>
      [requestId, secondRequestId].every((expected) =>
        attention(value).some(
          (request) =>
            request.requestId === expected && request.status === "pending",
        ),
      ),
    );
    const request = attention(pending).find(
      (candidate) => candidate.requestId === requestId,
    )!;
    const secondRequest = attention(pending).find(
      (candidate) => candidate.requestId === secondRequestId,
    )!;
    expect(request.itemId).toBe("item_approval_trace_2");
    expect(secondRequest.itemId).toBe("item_approval_trace_2b");
    await current.request({
      type: "attention.decide",
      taskId: taskId(ids.attention),
      requestId,
      generation: request.generation,
      decision: "accept",
    });
    await current.until(
      (value) =>
        attention(value).some(
          (candidate) =>
            candidate.requestId === requestId &&
            candidate.status === "responding",
        ) &&
        attention(value).some(
          (candidate) =>
            candidate.requestId === secondRequestId &&
            candidate.status === "pending",
        ),
    );
    await current.request({
      type: "codex.attention.resolve",
      taskId: taskId(ids.attention),
      requestId,
      wireRequestId: emitted.wireRequestId,
    });
    const settled = await current.until((value) =>
      attention(value).every(
        (candidate) =>
          candidate.requestId !== requestId || candidate.status === "resolved",
      ),
    );
    expect(lifecycle(task(settled, taskId(ids.attention))).phase).toBe(
      "waiting_for_human",
    );
    await current.request({
      type: "attention.decide",
      taskId: taskId(ids.attention),
      requestId: secondRequestId,
      generation: secondRequest.generation,
      decision: "decline",
    });
    await current.request({
      type: "codex.attention.resolve",
      taskId: taskId(ids.attention),
      requestId: secondRequestId,
      wireRequestId: second.wireRequestId,
    });
    const allSettled = await current.until((value) =>
      [requestId, secondRequestId].every((expected) =>
        attention(value).some(
          (candidate) =>
            candidate.requestId === expected && candidate.status === "resolved",
        ),
      ),
    );
    expect(lifecycle(task(allSettled, taskId(ids.attention))).phase).toBe(
      "ready",
    );
  }, 120_000);

  it("3. corroborates a completed request-human event and returns control through one continuation", async () => {
    const current = await product();
    await current.request(launchIntent(ids.handoff));
    await current.until((value) => {
      const entry = task(value, taskId(ids.handoff));
      const items = Object.values(
        ((entry.conversation as ProductValue | undefined)?.items as
          ProductValue | undefined) ?? {},
      );
      return (
        entry.bootstrapStage === "complete" &&
        items.some((item) => (item as ProductValue).clientId === ids.handoff)
      );
    });
    const before = await current.request({ type: "external.actions" });
    expect(
      (before.appServer as ProductValue[]).filter(
        (action) =>
          action.method === "turn/start" && action.correlation === ids.handoff,
      ),
    ).toHaveLength(1);
    await current.request({
      type: "browser.attach",
      taskId: taskId(ids.handoff),
    });
    await current.request({
      type: "handoff.prepare",
      taskId: taskId(ids.handoff),
    });
    const handedOff = await current.until((value) =>
      attention(value).some(
        (request) =>
          request.taskId === taskId(ids.handoff) &&
          request.kind === "control_handoff" &&
          request.status === "pending",
      ),
    );
    expect(task(handedOff, taskId(ids.handoff)).availableActions).toContain(
      "return_control",
    );
    const handoffAttention = attention(handedOff).find(
      (request) =>
        request.taskId === taskId(ids.handoff) &&
        request.kind === "control_handoff" &&
        request.status === "pending",
    )!;
    const continuationCommandId = `continuation:${taskId(ids.handoff)}:${String(handoffAttention.generation)}`;
    await current.request({
      type: "task.return",
      taskId: taskId(ids.handoff),
      operationId: "intent_33333333-3333-4333-8333-333333333334",
    });
    const returned = await current.until((value) => {
      const entry = task(value, taskId(ids.handoff));
      const items = Object.values(
        ((entry.conversation as ProductValue | undefined)?.items as
          ProductValue | undefined) ?? {},
      );
      return (
        lifecycle(entry).phase === "ready" &&
        items.some(
          (item) => (item as ProductValue).clientId === continuationCommandId,
        )
      );
    });
    expect(
      attention(returned).some(
        (request) =>
          request.taskId === taskId(ids.handoff) &&
          request.status === "pending",
      ),
    ).toBe(false);
    const after = await current.request({ type: "external.actions" });
    const turnsBefore = (before.appServer as ProductValue[]).filter(
      (action) => action.method === "turn/start",
    ).length;
    const turnsAfter = (after.appServer as ProductValue[]).filter(
      (action) => action.method === "turn/start",
    ).length;
    expect(turnsAfter - turnsBefore).toBe(1);
    expect(
      (after.appServer as ProductValue[]).filter(
        (action) =>
          action.method === "turn/start" &&
          action.correlation === continuationCommandId,
      ),
    ).toHaveLength(1);
  }, 120_000);

  it("reconstructs a missing persisted handoff projection from corroborated authority", async () => {
    const current = await product();
    await current.request(launchIntent(ids.handoff));
    await current.until((value) => {
      const entry = task(value, taskId(ids.handoff));
      return entry.bootstrapStage === "complete";
    });
    await current.request({
      type: "browser.attach",
      taskId: taskId(ids.handoff),
    });
    await current.request({
      type: "handoff.prepare",
      taskId: taskId(ids.handoff),
      takeControl: false,
    });
    const handedOff = await current.until((value) =>
      attention(value).some(
        (request) =>
          request.taskId === taskId(ids.handoff) &&
          request.kind === "control_handoff" &&
          request.status === "pending",
      ),
    );
    expect(task(handedOff, taskId(ids.handoff)).runtime).toMatchObject({
      status: "awaiting_human",
      controller: null,
      handoffActionable: true,
    });

    await current.stop();
    const database = new Database(
      join(current.home, "codex-product", "task-process.v1.sqlite3"),
    );
    for (const table of [
      "task_engine_aggregate",
      "task_engine_projection",
    ]) {
      const row = database
        .prepare(`SELECT payload_json FROM ${table} WHERE task_id = ?`)
        .get(taskId(ids.handoff)) as { payload_json: string };
      const payload = JSON.parse(row.payload_json) as ProductValue;
      if (table === "task_engine_aggregate")
        expect(payload.continuation).toMatchObject({
          status: "pending",
          policy: "resume_after_control_return",
          handoffId: (payload.runtime as ProductValue).handoffId,
          generation: (payload.runtime as ProductValue).handoffGeneration,
        });
      payload.attentions = [];
      database
        .prepare(`UPDATE ${table} SET payload_json = ? WHERE task_id = ?`)
        .run(JSON.stringify(payload), taskId(ids.handoff));
    }
    database.close();

    await current.start();
    const recovered = await current.until((value) => {
      const recoveredTask = task(value, taskId(ids.handoff));
      const recoveredAttention = attention(value).find(
        (request) =>
          request.taskId === taskId(ids.handoff) &&
          request.kind === "control_handoff" &&
          request.status === "pending",
      );
      return (
        recoveredTask.runtime !== undefined && recoveredAttention !== undefined
      );
    });
    expect(
      attention(recovered).filter(
        (request) =>
          request.taskId === taskId(ids.handoff) &&
          request.kind === "control_handoff" &&
          request.status === "pending",
      ),
    ).toHaveLength(1);
    expect(
      (task(recovered, taskId(ids.handoff)).runtime as ProductValue)
        .handoffActionable,
    ).toBe(true);
    expect(task(recovered, taskId(ids.handoff)).runtime).toMatchObject({
      status: "awaiting_human",
      controller: null,
    });
  }, 120_000);

  it("4. cleans resources from handoff state, returns the Task to ready, and archives only locally", async () => {
    const current = await product();
    const selected = await current.request({
      type: "attachment.prepare",
      filename: "finish.txt",
      content: "cleanup evidence",
    });
    const attachmentId = String(
      ((selected.attachments as ProductValue[]) ?? [])[0]?.id,
    );
    await current.request(
      launchIntent(ids.finish, { attachmentIds: [attachmentId] }),
    );
    await current.until((value) => {
      const entry = task(value, taskId(ids.finish));
      return (
        entry.bootstrapStage === "complete" &&
        lifecycle(entry).phase === "ready" &&
        conversation(entry).turnStatus === "completed"
      );
    });
    await current.request({
      type: "browser.attach",
      taskId: taskId(ids.finish),
    });
    await current.request({
      type: "handoff.prepare",
      taskId: taskId(ids.finish),
    });
    await current.until((value) =>
      attention(value).some(
        (request) =>
          request.taskId === taskId(ids.finish) &&
          request.kind === "control_handoff" &&
          request.status === "pending",
      ),
    );
    await current.request({
      type: "task.finish",
      taskId: taskId(ids.finish),
      operationId: "intent_44444444-4444-4444-8444-444444444445",
    });
    const cleaned = await current.until((value) => {
      const entry = task(value, taskId(ids.finish));
      return (
        lifecycle(entry).phase === "ready" &&
        conversation(entry).archived === false &&
        availableActions(entry).includes("message") &&
        availableActions(entry).includes("archive")
      );
    });
    const entry = task(cleaned, taskId(ids.finish));
    expect(attachments(entry)).toEqual([]);
    expect(conversation(entry).archived).toBe(false);
    expect(entry.availableActions).toContain("message");
    expect(entry.availableActions).toContain("archive");
    let actions = await current.request({ type: "external.actions" });
    expect(
      (actions.runtime as ProductValue[]).filter(
        (action) => action.method === "endSession",
      ),
    ).toHaveLength(1);
    expect(
      (actions.appServer as ProductValue[]).filter(
        (action) => action.method === "thread/archive",
      ),
    ).toHaveLength(0);
    await current.request({
      type: "task.archive",
      taskId: taskId(ids.finish),
      operationId: "intent_44444444-4444-4444-8444-444444444446",
    });
    await current.until(
      (value) =>
        conversation(task(value, taskId(ids.finish))).archived === true &&
        availableActions(task(value, taskId(ids.finish))).includes("resume"),
    );
    actions = await current.request({ type: "external.actions" });
    expect(
      (actions.appServer as ProductValue[]).filter(
        (action) => action.method === "thread/unarchive",
      ),
    ).toHaveLength(0);
    expect(
      (actions.appServer as ProductValue[]).filter(
        (action) => action.method === "thread/archive",
      ),
    ).toHaveLength(0);

    await current.request({
      type: "task.unarchive",
      taskId: taskId(ids.finish),
      operationId: "intent_44444444-4444-4444-8444-444444444447",
    });
    await current.until(
      (value) =>
        conversation(task(value, taskId(ids.finish))).archived === false &&
        availableActions(task(value, taskId(ids.finish))).includes("message"),
    );

    const nextTaskOperation = "intent_44444444-4444-4444-8444-444444444448";
    await current.request(launchIntent(nextTaskOperation));
    const nextTask = await current.until(
      (value) =>
        task(value, taskId(nextTaskOperation)).bootstrapStage === "complete",
    );
    expect(task(nextTask, taskId(nextTaskOperation)).taskId).not.toBe(
      taskId(ids.finish),
    );
    expect(lifecycle(task(nextTask, taskId(ids.finish))).phase).toBe("ready");
  }, 120_000);

  it("5. restores a browserless task across App Server, Runtime, and Desktop restarts and accepts a second product intent once", async () => {
    let current = await product();
    await current.request(
      launchIntent(ids.restart, { browserIdentity: undefined }),
    );
    const started = await current.until((value) => {
      const entry = task(value, taskId(ids.restart));
      return (
        entry.bootstrapStage === "complete" &&
        lifecycle(entry).phase === "ready" &&
        conversation(entry).turnStatus === "completed" &&
        Object.values(conversation(entry).items as ProductValue).some(
          (item) =>
            (item as ProductValue).kind === "user_message" &&
            (item as ProductValue).clientId === ids.restart,
        )
      );
    });
    const sessionId = task(started, taskId(ids.restart)).roveSessionId;
    expect(sessionId).toBeUndefined();
    const appServerReplacement = await current.request({
      type: "appserver.kill",
    });
    const afterAppServerReplacement = await current.request({
      type: "process.identities",
    });
    expect(Number(afterAppServerReplacement.appServerPid)).not.toBe(
      Number(appServerReplacement.killedPid),
    );
    await current.until((value) => {
      const entry = task(value, taskId(ids.restart));
      return (
        lifecycle(entry).phase === "ready" &&
        conversation(entry).turnStatus === "completed" &&
        Object.values(conversation(entry).items as ProductValue).some(
          (item) => (item as ProductValue).clientId === ids.restart,
        )
      );
    });
    let requests = (await current.request({
      type: "appserver.requests",
    })) as unknown as ProductValue[];
    expect(
      requests.some(
        (request) =>
          request.method === "thread/resume" &&
          (request.rove as ProductValue | null)?.bootstrapId ===
            bootstrapId(ids.restart),
      ),
    ).toBe(true);
    const runtimeReplacement = await current.request({ type: "runtime.kill" });
    expect(
      Number((runtimeReplacement.identities as ProductValue).runtimePid),
    ).not.toBe(Number(runtimeReplacement.killedPid));
    await current.until(
      (value) => lifecycle(task(value, taskId(ids.restart))).phase === "ready",
    );

    const beforeDesktopRestart = await current.request({
      type: "process.identities",
    });
    const requestsBeforeDesktopRestart = (await current.request({
      type: "appserver.requests",
    })) as unknown as ProductValue[];
    const resumesBeforeDesktopRestart = requestsBeforeDesktopRestart.filter(
      (request) => request.method === "thread/resume",
    ).length;
    const priorRuntimeProcessId = Number(beforeDesktopRestart.runtimePid);
    await current.stop();
    const shutdownDeadline = Date.now() + 10_000;
    while (processAlive(priorRuntimeProcessId) && Date.now() < shutdownDeadline)
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    expect(processAlive(priorRuntimeProcessId)).toBe(false);
    current = new ProcessProductHarness(current.home);
    processes.push(current);
    await current.start();
    const afterDesktopRestart = await current.request({
      type: "process.identities",
    });
    expect(Number(afterDesktopRestart.runtimePid)).not.toBe(
      priorRuntimeProcessId,
    );
    await current.untilResult(
      { type: "appserver.requests" },
      (value) =>
        Array.isArray(value) &&
        value.filter(
          (request) => (request as ProductValue).method === "thread/resume",
        ).length > resumesBeforeDesktopRestart,
    );
    await current.until((value) => {
      const restored = task(value, taskId(ids.restart));
      return (
        restored.roveSessionId === undefined &&
        lifecycle(restored).phase === "ready" &&
        conversation(restored).turnStatus === "completed" &&
        Object.values(conversation(restored).items as ProductValue).some(
          (item) => (item as ProductValue).clientId === ids.restart,
        ) &&
        (restored.availableActions as string[]).includes("message")
      );
    });
    const secondIntent = "intent_55555555-5555-4555-8555-555555555556";
    await current.request({
      type: "task.message",
      taskId: taskId(ids.restart),
      operationId: secondIntent,
      message: "Continue exactly once after Desktop restart.",
    });
    await current.until((value) => {
      const restored = task(value, taskId(ids.restart));
      return (
        lifecycle(restored).phase === "ready" &&
        conversation(restored).turnStatus === "completed" &&
        Object.values(conversation(restored).items as ProductValue).some(
          (item) =>
            (item as ProductValue).kind === "user_message" &&
            (item as ProductValue).clientId === secondIntent &&
            typeof (item as ProductValue).providerItemId === "string" &&
            (item as ProductValue).text ===
              "Continue exactly once after Desktop restart.",
        )
      );
    });
    const actions = await current.request({ type: "external.actions" });
    expect(
      (actions.appServer as ProductValue[]).filter(
        (action) =>
          action.method === "turn/start" && action.correlation === secondIntent,
      ),
    ).toHaveLength(1);
    requests = (await current.request({
      type: "appserver.requests",
    })) as unknown as ProductValue[];
    expect(requests.some((request) => request.method === "thread/resume")).toBe(
      true,
    );
    expect(
      (
        (await current.request({ type: "external.actions" }))
          .runtime as ProductValue[]
      ).filter((action) => action.method === "startSession"),
    ).toHaveLength(0);
  }, 180_000);
});
