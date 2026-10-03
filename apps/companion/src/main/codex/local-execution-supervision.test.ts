import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskEngine, type TaskEvent } from "@rove/protocol";

import {
  newLocalExecutionId,
  LocalExecutionSupervisor,
  type LocalExecutionAuthority,
  type LocalExecutionRequest,
} from "./local-execution-supervision.js";
import type {
  CodexRpcPort,
  CodexServerEvent,
  CodexServerEventListener,
} from "./protocol.js";
import { SqliteTaskEngineStore } from "./sqlite-task-engine-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function launch(
  taskId: string,
): Extract<TaskEvent, { type: "task_launch_requested" }> {
  const operationId = "intent_12345678-1234-4123-8123-123456789abc";
  return {
    schemaVersion: 1,
    type: "task_launch_requested",
    eventId: `product:${operationId}`,
    taskId,
    source: {
      kind: "product",
      id: "execution-test",
      generation: 1,
      position: 1,
    },
    observedAt: "2026-09-27T10:00:00.000Z",
    operationId,
    launch: {
      operationId,
      bootstrapId: "boot_1234567890abcdef1234567890abcdef",
      requestedAt: "2026-09-27T10:00:00.000Z",
      outcome: "Run a bounded command",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      approvalsReviewer: "user",
      cwd: "/tmp/rove-execution-test",
      attachmentIds: [],
    },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rove-local-execution-"));
  roots.push(root);
  const path = join(root, "task.sqlite3");
  const store = new SqliteTaskEngineStore({ path });
  const taskId = "task_12345678-1234-4123-8123-123456789abc";
  await new TaskEngine(store).accept(launch(taskId));
  return { path, store, taskId };
}

function request(taskId: string): LocalExecutionRequest {
  return {
    executionId: newLocalExecutionId(),
    taskId,
    taskOperationId: "intent_12345678-1234-4123-8123-123456789abc",
    threadId: "thread_exact",
    turnId: "turn_exact",
    toolCallId: "call_exact",
    ownerInstanceId: "codex_owner_exact",
    connectionGeneration: 7,
    delegateProcessId: "rove_exec_exact",
    invocationDigest: "c".repeat(64),
    commandDigest: "a".repeat(64),
    permissionProfile: "rove_task",
    requestedAt: "2026-09-27T10:00:01.000Z",
  };
}

function authority(value: LocalExecutionRequest): LocalExecutionAuthority {
  return {
    executionId: value.executionId,
    taskId: value.taskId,
    taskOperationId: value.taskOperationId,
    threadId: value.threadId,
    turnId: value.turnId,
    toolCallId: value.toolCallId,
    ownerInstanceId: value.ownerInstanceId,
    connectionGeneration: value.connectionGeneration,
    delegateProcessId: value.delegateProcessId,
    invocationDigest: value.invocationDigest,
    commandDigest: value.commandDigest,
  };
}

describe("durable exact local execution supervision", () => {
  it("persists request, dispatch, Stop intent and observed exit across restart", async () => {
    const { path, store, taskId } = await fixture();
    const requested = request(taskId);
    const exact = authority(requested);

    expect(store.requestExecution(requested)).toMatchObject({
      state: "requested",
      revision: 1,
    });
    expect(store.requestExecution(requested)).toMatchObject({
      state: "requested",
      revision: 1,
    });
    expect(
      store.markExecutionDispatching(exact, "2026-09-27T10:00:02.000Z"),
    ).toMatchObject({ state: "dispatching", revision: 2 });
    expect(
      store.markExecutionRunning(exact, "2026-09-27T10:00:03.000Z"),
    ).toMatchObject({ state: "running", revision: 3 });
    expect(
      store.requestExecutionTermination(
        exact,
        "stop_12345678-1234-4123-8123-123456789abc",
        "2026-09-27T10:00:04.000Z",
      ),
    ).toMatchObject({
      state: "termination_requested",
      terminationOperationId: "stop_12345678-1234-4123-8123-123456789abc",
    });
    store.close();

    const reopened = new SqliteTaskEngineStore({ path });
    expect(reopened.nonterminalExecutions(taskId, "turn_exact")).toHaveLength(
      1,
    );
    const exited = reopened.observeExecutionExit({
      ...exact,
      exitCode: 137,
      cause: "stop_requested",
      outputFinalized: true,
      stdoutBytes: 12,
      stderrBytes: 0,
      outputTruncated: false,
      observedAt: "2026-09-27T10:00:05.000Z",
    });
    expect(exited).toMatchObject({
      state: "exit_observed",
      revision: 5,
      exit: {
        exitCode: 137,
        cause: "stop_requested",
        outputFinalized: true,
        receiptDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(reopened.nonterminalExecutions(taskId)).toEqual([]);
    reopened.close();
  });

  it("rejects stale, cross-authority and conflicting idempotency attempts", async () => {
    const { store, taskId } = await fixture();
    const requested = request(taskId);
    const exact = authority(requested);
    store.requestExecution(requested);

    expect(() =>
      store.requestExecution({
        ...requested,
        executionId: newLocalExecutionId(),
        commandDigest: "b".repeat(64),
      }),
    ).toThrow("conflicts with durable authority");
    expect(() =>
      store.markExecutionDispatching(
        { ...exact, connectionGeneration: 8 },
        "2026-09-27T10:00:02.000Z",
      ),
    ).toThrow("authority does not match");
    expect(() =>
      store.markExecutionDispatching(
        { ...exact, taskId: "task_wrong" },
        "2026-09-27T10:00:02.000Z",
      ),
    ).toThrow("authority does not match");
    store.close();
  });

  it("retains uncertain dispatch and one exact Stop authority", async () => {
    const { store, taskId } = await fixture();
    const requested = request(taskId);
    const exact = authority(requested);
    store.requestExecution(requested);
    store.markExecutionDispatching(exact, "2026-09-27T10:00:02.000Z");
    expect(
      store.markExecutionDispatchUnknown(exact, "2026-09-27T10:00:03.000Z"),
    ).toMatchObject({ state: "dispatch_unknown" });
    store.requestExecutionTermination(
      exact,
      "stop_exact",
      "2026-09-27T10:00:04.000Z",
    );
    expect(() =>
      store.requestExecutionTermination(
        exact,
        "stop_stale",
        "2026-09-27T10:00:05.000Z",
      ),
    ).toThrow("another Stop authority");
    expect(store.nonterminalExecutions(taskId)).toMatchObject([
      { state: "termination_requested", terminationOperationId: "stop_exact" },
    ]);
    store.close();
  });

  it("rejects an exit cause that is not authoritative for the durable state", async () => {
    const { store, taskId } = await fixture();
    const requested = request(taskId);
    const exact = authority(requested);
    store.requestExecution(requested);

    expect(() =>
      store.observeExecutionExit({
        ...exact,
        exitCode: 0,
        cause: "natural_exit",
        outputFinalized: true,
        stdoutBytes: 0,
        stderrBytes: 0,
        outputTruncated: false,
        observedAt: "2026-09-27T10:00:02.000Z",
      }),
    ).toThrow("exit cause conflicts");
    store.close();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("exact execution supervisor races", () => {
  it("reattaches a duplicate dynamic-tool delivery without redispatch", async () => {
    const { store, taskId } = await fixture();
    const listeners = new Set<CodexServerEventListener>();
    const execution = deferred<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>();
    const requestRpc = vi.fn((method: string) => {
      if (method === "command/exec") return execution.promise;
      throw new Error(`Unexpected request ${method}`);
    });
    const responses: Array<{ id: string | number; result: unknown }> = [];
    let activeTurnAuthority = true;
    const respondRpc = vi.fn(async (id: string | number, result: unknown) => {
      responses.push({ id, result });
    });
    const rpc = {
      request: requestRpc,
      notify: vi.fn(),
      respond: respondRpc,
      onEvent: (listener: CodexServerEventListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as CodexRpcPort;
    const supervisor = new LocalExecutionSupervisor({
      rpc,
      store,
      ownerInstanceId: "owner_live",
      connectionGeneration: () => 4,
      resolveTaskAuthority: async (threadId, turnId) => {
        if (!activeTurnAuthority)
          throw new Error("Task turn is no longer active.");
        return {
          taskId,
          taskOperationId: "intent_12345678-1234-4123-8123-123456789abc",
          threadId,
          turnId,
          cwd: "/tmp/rove-execution-test",
          permissionProfile: "rove_task",
        };
      },
    });
    supervisor.attach();
    const params = {
      threadId: "thread_exact",
      turnId: "turn_exact",
      callId: "call_replayed",
      namespace: null,
      tool: "rove_exec",
      arguments: { command: ["/usr/bin/true"] },
    };
    for (const listener of listeners) {
      listener({ method: "item/tool/call", requestId: "delivery-1", params });
      listener({ method: "item/tool/call", requestId: "delivery-2", params });
    }
    await vi.waitFor(() => expect(requestRpc).toHaveBeenCalledTimes(1));
    execution.resolve({ exitCode: 0, stdout: "done", stderr: "" });
    await vi.waitFor(() => expect(responses).toHaveLength(2));

    expect(store.executionsForTask(taskId)).toHaveLength(1);
    expect(responses.map((entry) => entry.id).sort()).toEqual([
      "delivery-1",
      "delivery-2",
    ]);
    expect(responses[0]!.result).toEqual(responses[1]!.result);
    activeTurnAuthority = false;
    for (const listener of listeners)
      listener({ method: "item/tool/call", requestId: "delivery-3", params });
    await vi.waitFor(() => expect(responses).toHaveLength(3));
    expect(requestRpc).toHaveBeenCalledTimes(1);
    expect(responses[2]).toMatchObject({
      id: "delivery-3",
      result: { success: true, contentItems: expect.any(Array) },
    });
    for (const listener of listeners)
      listener({
        method: "item/tool/call",
        requestId: "delivery-4",
        params: { ...params, arguments: { ...params.arguments, timeoutMs: 2_000 } },
      });
    await vi.waitFor(() => expect(respondRpc).toHaveBeenCalledTimes(4));
    expect(requestRpc).toHaveBeenCalledTimes(1);
    expect(respondRpc).toHaveBeenLastCalledWith(
      "delivery-4",
      {},
      expect.objectContaining({
        message: expect.stringContaining("conflicts with durable execution"),
      }),
    );
    store.close();
  });

  it("does not settle Stop on terminate acknowledgement before final exit", async () => {
    const { store, taskId } = await fixture();
    const listeners = new Set<CodexServerEventListener>();
    const execution = deferred<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>();
    const requests: Array<{ method: string; params: unknown }> = [];
    const responses: Array<{ id: string | number; result: unknown }> = [];
    const rpc = {
      request: vi.fn((method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "command/exec") return execution.promise;
        if (method === "command/exec/terminate") return Promise.resolve({});
        throw new Error(`Unexpected request ${method}`);
      }),
      notify: vi.fn(),
      respond: vi.fn(async (id: string | number, result: unknown) => {
        responses.push({ id, result });
      }),
      onEvent: (listener: CodexServerEventListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as CodexRpcPort;
    const supervisor = new LocalExecutionSupervisor({
      rpc,
      store,
      ownerInstanceId: "owner_live",
      connectionGeneration: () => 4,
      resolveTaskAuthority: async (threadId, turnId) => ({
        taskId,
        taskOperationId: "intent_12345678-1234-4123-8123-123456789abc",
        threadId,
        turnId,
        cwd: "/tmp/rove-execution-test",
        permissionProfile: "rove_task",
      }),
      now: (() => {
        let tick = 0;
        return () => `2026-09-27T10:00:${String(++tick).padStart(2, "0")}.000Z`;
      })(),
    });
    supervisor.attach();
    const event: CodexServerEvent = {
      method: "item/tool/call",
      requestId: "tool-request",
      params: {
        threadId: "thread_exact",
        turnId: "turn_exact",
        callId: "call_exact",
        namespace: null,
        tool: "rove_exec",
        arguments: { command: ["/bin/sh", "-c", "sleep 30"] },
      },
    };
    const delivery = Promise.all(
      [...listeners].map((listener) => listener(event)),
    );
    await vi.waitFor(() =>
      expect(requests.some((entry) => entry.method === "command/exec")).toBe(
        true,
      ),
    );
    const processId = String(
      (
        requests.find((entry) => entry.method === "command/exec")!
          .params as { processId: string }
      ).processId,
    );
    await Promise.all(
      [...listeners].map((listener) =>
        listener({
          method: "command/exec/outputDelta",
          params: {
            processId,
            stream: "stdout",
            deltaBase64: "b3V0cHV0",
            capReached: true,
          },
        }),
      ),
    );
    expect(store.execution(processId)).toMatchObject({
      state: "running",
      runningObservedAt: expect.any(String),
    });

    let stopped = false;
    const stop = supervisor
      .terminateTaskTurn(taskId, "turn_exact", "stop_exact")
      .then((value) => {
        stopped = true;
        return value;
      });
    await vi.waitFor(() =>
      expect(
        requests.some((entry) => entry.method === "command/exec/terminate"),
      ).toBe(true),
    );
    expect(stopped).toBe(false);

    execution.resolve({ exitCode: 137, stdout: "", stderr: "terminated" });
    const receipts = await stop;
    await delivery;
    await vi.waitFor(() => expect(responses).toHaveLength(1));
    expect(receipts).toMatchObject([
      {
        state: "exit_observed",
        exit: {
          exitCode: 137,
          cause: "stop_requested",
          outputTruncated: true,
        },
      },
    ]);
    expect(responses).toMatchObject([
      {
        id: "tool-request",
        result: { success: false, contentItems: expect.any(Array) },
      },
    ]);
    expect(store.nonterminalExecutions(taskId)).toEqual([]);
    store.close();
  });

  it("fences a late tool call before dispatch once Stop owns the turn", async () => {
    const { store, taskId } = await fixture();
    const listeners = new Set<CodexServerEventListener>();
    const requestRpc = vi.fn();
    const respond = vi.fn(async () => undefined);
    const rpc = {
      request: requestRpc,
      notify: vi.fn(),
      respond,
      onEvent: (listener: CodexServerEventListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as CodexRpcPort;
    const supervisor = new LocalExecutionSupervisor({
      rpc,
      store,
      ownerInstanceId: "owner_live",
      connectionGeneration: () => 4,
      resolveTaskAuthority: async (threadId, turnId) => ({
        taskId,
        taskOperationId: "intent_12345678-1234-4123-8123-123456789abc",
        threadId,
        turnId,
        cwd: "/tmp/rove-execution-test",
        permissionProfile: "rove_task",
      }),
    });
    supervisor.attach();
    await supervisor.terminateTaskTurn(taskId, "turn_exact", "stop_exact");
    const event: CodexServerEvent = {
      method: "item/tool/call",
      requestId: "late-tool-request",
      params: {
        threadId: "thread_exact",
        turnId: "turn_exact",
        callId: "call_late",
        namespace: null,
        tool: "rove_exec",
        arguments: { command: ["/usr/bin/true"] },
      },
    };
    await Promise.all([...listeners].map((listener) => listener(event)));
    await vi.waitFor(() => expect(respond).toHaveBeenCalledTimes(1));
    expect(requestRpc).not.toHaveBeenCalled();
    expect(store.executionsForTask(taskId)).toMatchObject([
      {
        state: "exit_observed",
        exit: { cause: "cancelled_before_dispatch" },
      },
    ]);
    expect(respond).toHaveBeenCalledWith(
      "late-tool-request",
      expect.objectContaining({ success: false }),
    );
    store.close();
  });
});
