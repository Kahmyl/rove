import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";

import type {
  CodexRpcPort,
  CodexServerEvent,
  DynamicToolSpec,
} from "./protocol.js";

export type LocalExecutionState =
  | "requested"
  | "dispatching"
  | "running"
  | "termination_requested"
  | "dispatch_unknown"
  | "exit_observed";

export type LocalExecutionTerminationCause =
  | "natural_exit"
  | "stop_requested"
  | "cancelled_before_dispatch"
  | "owner_shutdown"
  | "timeout";

export interface LocalExecutionAuthority {
  executionId: string;
  taskId: string;
  taskOperationId: string;
  threadId: string;
  turnId: string;
  toolCallId: string;
  ownerInstanceId: string;
  connectionGeneration: number;
  delegateProcessId: string;
  invocationDigest: string;
  commandDigest: string;
}

export interface LocalExecutionRequest extends LocalExecutionAuthority {
  permissionProfile: string;
  requestedAt: string;
}

export interface LocalExecutionExitObservation extends LocalExecutionAuthority {
  exitCode: number;
  cause: LocalExecutionTerminationCause;
  outputFinalized: true;
  stdoutBytes: number;
  stderrBytes: number;
  outputTruncated: boolean;
  observedAt: string;
}

export interface LocalExecutionRecord extends LocalExecutionRequest {
  schemaVersion: 1;
  state: LocalExecutionState;
  revision: number;
  dispatchStartedAt?: string;
  runningObservedAt?: string;
  terminationRequestedAt?: string;
  terminationOperationId?: string;
  exit?: {
    exitCode: number;
    cause: LocalExecutionTerminationCause;
    outputFinalized: true;
    stdoutBytes: number;
    stderrBytes: number;
    outputTruncated: boolean;
    observedAt: string;
    receiptDigest: string;
  };
}

export interface LocalExecutionStore {
  requestExecution(request: LocalExecutionRequest): LocalExecutionRecord;
  markExecutionDispatching(
    authority: LocalExecutionAuthority,
    observedAt: string,
  ): LocalExecutionRecord;
  markExecutionRunning(
    authority: LocalExecutionAuthority,
    observedAt: string,
  ): LocalExecutionRecord;
  requestExecutionTermination(
    authority: LocalExecutionAuthority,
    operationId: string,
    observedAt: string,
  ): LocalExecutionRecord;
  markExecutionDispatchUnknown(
    authority: LocalExecutionAuthority,
    observedAt: string,
  ): LocalExecutionRecord;
  observeExecutionExit(
    observation: LocalExecutionExitObservation,
  ): LocalExecutionRecord;
  execution(executionId: string): LocalExecutionRecord | null;
  executionForToolCall(
    threadId: string,
    turnId: string,
    toolCallId: string,
  ): LocalExecutionRecord | null;
  executionsForTask(taskId: string): readonly LocalExecutionRecord[];
  nonterminalExecutions(
    taskId: string,
    turnId?: string,
  ): readonly LocalExecutionRecord[];
  allNonterminalExecutions(): readonly LocalExecutionRecord[];
}

function boundedIdentity(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256)
    throw new Error(`${label} is invalid.`);
  return value;
}

function timestamp(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value)))
    throw new Error(`${label} is invalid.`);
  return value;
}

export function validateLocalExecutionObservedAt(value: string): string {
  return timestamp(value, "Execution observation time");
}

export function validateLocalExecutionOperationId(value: string): string {
  return boundedIdentity(value, "Execution operation identity");
}

export function newLocalExecutionId(): string {
  return `exec_${randomUUID().replaceAll("-", "")}`;
}

export function validateLocalExecutionAuthority(
  value: LocalExecutionAuthority,
): LocalExecutionAuthority {
  if (!/^exec_[a-f0-9]{32}$/.test(value.executionId))
    throw new Error("Execution identity is invalid.");
  boundedIdentity(value.taskId, "Task identity");
  boundedIdentity(value.taskOperationId, "Task operation identity");
  boundedIdentity(value.threadId, "Codex thread identity");
  boundedIdentity(value.turnId, "Codex turn identity");
  boundedIdentity(value.toolCallId, "Codex tool-call identity");
  boundedIdentity(value.ownerInstanceId, "execution owner identity");
  boundedIdentity(value.delegateProcessId, "delegate process identity");
  if (
    !Number.isSafeInteger(value.connectionGeneration) ||
    value.connectionGeneration < 1
  )
    throw new Error("Execution connection generation is invalid.");
  if (!/^[a-f0-9]{64}$/.test(value.commandDigest))
    throw new Error("Execution command digest is invalid.");
  if (!/^[a-f0-9]{64}$/.test(value.invocationDigest))
    throw new Error("Execution invocation digest is invalid.");
  return structuredClone(value);
}

export function validateLocalExecutionRequest(
  value: LocalExecutionRequest,
): LocalExecutionRequest {
  validateLocalExecutionAuthority(value);
  boundedIdentity(value.permissionProfile, "permission profile");
  timestamp(value.requestedAt, "Execution request time");
  return structuredClone(value);
}

export function localExecutionExitReceiptDigest(
  value: LocalExecutionExitObservation,
): string {
  validateLocalExecutionAuthority(value);
  if (
    ![
      "natural_exit",
      "stop_requested",
      "cancelled_before_dispatch",
      "owner_shutdown",
      "timeout",
    ].includes(value.cause)
  )
    throw new Error("Execution termination cause is invalid.");
  if (value.outputFinalized !== true)
    throw new Error("Execution output is not finalized.");
  if (!Number.isSafeInteger(value.exitCode))
    throw new Error("Execution exit code is invalid.");
  if (!Number.isSafeInteger(value.stdoutBytes) || value.stdoutBytes < 0)
    throw new Error("Execution stdout count is invalid.");
  if (!Number.isSafeInteger(value.stderrBytes) || value.stderrBytes < 0)
    throw new Error("Execution stderr count is invalid.");
  if (typeof value.outputTruncated !== "boolean")
    throw new Error("Execution output truncation fact is invalid.");
  timestamp(value.observedAt, "Execution exit time");
  return createHash("sha256")
    .update(
      JSON.stringify({
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
        exitCode: value.exitCode,
        cause: value.cause,
        outputFinalized: value.outputFinalized,
        stdoutBytes: value.stdoutBytes,
        stderrBytes: value.stderrBytes,
        outputTruncated: value.outputTruncated,
        observedAt: value.observedAt,
      }),
    )
    .digest("hex");
}

export function sameLocalExecutionAuthority(
  left: LocalExecutionAuthority,
  right: LocalExecutionAuthority,
): boolean {
  return (
    left.executionId === right.executionId &&
    left.taskId === right.taskId &&
    left.taskOperationId === right.taskOperationId &&
    left.threadId === right.threadId &&
    left.turnId === right.turnId &&
    left.toolCallId === right.toolCallId &&
    left.ownerInstanceId === right.ownerInstanceId &&
    left.connectionGeneration === right.connectionGeneration &&
    left.delegateProcessId === right.delegateProcessId &&
    left.invocationDigest === right.invocationDigest &&
    left.commandDigest === right.commandDigest
  );
}

export const ROVE_EXECUTION_TOOL: DynamicToolSpec = {
  type: "function",
  name: "rove_exec",
  description:
    "Run one argv command inside this Rove Task's frozen local permission boundary. Rove owns the exact process lifecycle and Stop termination receipt.",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "array",
        minItems: 1,
        maxItems: 256,
        items: { type: "string", minLength: 1, maxLength: 32_768 },
      },
      timeoutMs: {
        type: "integer",
        minimum: 1_000,
        maximum: 1_800_000,
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
};

export const ROVE_TASK_PERMISSION_PROFILE_ID = "rove_task";
export const ROVE_TASK_PERMISSION_PROFILE = {
  description: "Rove task workspace only",
  filesystem: {
    ":root": "deny",
    ":minimal": "read",
    ":workspace_roots": { ".": "write" },
    ":tmpdir": "deny",
    ":slash_tmp": "deny",
  },
  network: { enabled: false },
} as const;

export const CODEX_ROVE_TASK_PERMISSION_CONFIG_ARGS = [
  "-c",
  `default_permissions="${ROVE_TASK_PERMISSION_PROFILE_ID}"`,
  "-c",
  `permissions.${ROVE_TASK_PERMISSION_PROFILE_ID}.description="Rove task workspace only"`,
  "-c",
  `permissions.${ROVE_TASK_PERMISSION_PROFILE_ID}.filesystem={":root"="deny", ":minimal"="read", ":workspace_roots"={"."="write"}, ":tmpdir"="deny", ":slash_tmp"="deny"}`,
  "-c",
  `permissions.${ROVE_TASK_PERMISSION_PROFILE_ID}.network.enabled=false`,
] as const;

export interface LocalExecutionTaskAuthority {
  taskId: string;
  taskOperationId: string;
  threadId: string;
  turnId: string;
  cwd: string;
  permissionProfile: string;
}

export interface LocalExecutionSupervisorOptions {
  rpc: CodexRpcPort;
  store: LocalExecutionStore;
  ownerInstanceId: string;
  connectionGeneration: () => number;
  resolveTaskAuthority(
    threadId: string,
    turnId: string,
  ): Promise<LocalExecutionTaskAuthority>;
  now?: () => string;
  outputBytesCap?: number;
}

interface RoveExecArguments {
  command: string[];
  timeoutMs: number;
}

interface LocalExecutionCompletion {
  record: LocalExecutionRecord;
  stdout: string;
  stderr: string;
}

interface RoveExecutionToolResult {
  success: boolean;
  contentItems: Array<{ type: "inputText"; text: string }>;
}

function invocationDigest(input: {
  command: readonly string[];
  timeoutMs: number;
  outputBytesCap: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        command: [...input.command],
        timeoutMs: input.timeoutMs,
        outputBytesCap: input.outputBytesCap,
      }),
    )
    .digest("hex");
}

function commandDigest(input: {
  invocationDigest: string;
  cwd: string;
  permissionProfile: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function parseRoveExecArguments(value: unknown): RoveExecArguments {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Rove execution arguments must be an object.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["command", "timeoutMs"].includes(key)))
    throw new Error("Rove execution arguments contain an unsupported field.");
  if (
    !Array.isArray(input.command) ||
    input.command.length < 1 ||
    input.command.length > 256 ||
    input.command.some(
      (entry) =>
        typeof entry !== "string" || entry.length < 1 || entry.length > 32_768,
    )
  )
    throw new Error("Rove execution command argv is invalid.");
  const timeoutMs = input.timeoutMs ?? 1_800_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    Number(timeoutMs) < 1_000 ||
    Number(timeoutMs) > 1_800_000
  )
    throw new Error("Rove execution timeout is invalid.");
  return { command: [...input.command], timeoutMs: Number(timeoutMs) };
}

function toolText(stdout: string, stderr: string, exitCode: number): string {
  const sections = [
    stdout.length === 0 ? undefined : stdout,
    stderr.length === 0 ? undefined : stderr,
    `Process exited with code ${exitCode}.`,
  ].filter((value): value is string => value !== undefined);
  return sections.join("\n");
}

export class LocalExecutionSupervisor {
  private readonly now: () => string;
  private readonly outputBytesCap: number;
  private readonly inFlight = new Map<
    string,
    Promise<LocalExecutionCompletion>
  >();
  private readonly activeInvocations = new Map<
    string,
    { invocationDigest: string; result: Promise<RoveExecutionToolResult> }
  >();
  private readonly stoppingTurns = new Map<string, string>();
  private readonly activeToolCalls = new Set<Promise<void>>();
  private readonly outputCapReached = new Set<string>();

  constructor(private readonly options: LocalExecutionSupervisorOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.outputBytesCap = options.outputBytesCap ?? 64 * 1024;
  }

  attach(): () => void {
    return this.options.rpc.onEvent((event) => this.onEvent(event));
  }

  async recoverPriorOwners(): Promise<readonly LocalExecutionRecord[]> {
    const generation = this.options.connectionGeneration();
    const recovered: LocalExecutionRecord[] = [];
    for (const record of this.options.store.allNonterminalExecutions()) {
      if (
        record.ownerInstanceId === this.options.ownerInstanceId &&
        record.connectionGeneration === generation
      )
        continue;
      recovered.push(
        this.options.store.observeExecutionExit({
          ...record,
          exitCode: -1,
          cause: "owner_shutdown",
          outputFinalized: true,
          stdoutBytes: 0,
          stderrBytes: 0,
          outputTruncated: true,
          observedAt: this.now(),
        }),
      );
    }
    return recovered;
  }

  async terminateTaskTurn(
    taskId: string,
    turnId: string,
    operationId: string,
  ): Promise<readonly LocalExecutionRecord[]> {
    validateLocalExecutionOperationId(operationId);
    const fenceKey = `${taskId}\u0000${turnId}`;
    const existingFence = this.stoppingTurns.get(fenceKey);
    if (existingFence !== undefined && existingFence !== operationId)
      throw new Error("A different Stop operation owns this Task turn.");
    this.stoppingTurns.set(fenceKey, operationId);
    const records = this.options.store.nonterminalExecutions(taskId, turnId);
    const terminal: LocalExecutionRecord[] = [];
    for (const record of records) {
      this.requireCurrentOwner(record);
      this.options.store.requestExecutionTermination(
        record,
        operationId,
        this.now(),
      );
      try {
        await this.options.rpc.request("command/exec/terminate", {
          processId: record.delegateProcessId,
        });
      } catch (error) {
        const completion = this.inFlight.get(record.executionId);
        if (!completion) {
          this.options.store.markExecutionDispatchUnknown(record, this.now());
          throw error;
        }
      }
      const completion = this.inFlight.get(record.executionId);
      if (completion) terminal.push((await completion).record);
      else {
        const observed = this.options.store.execution(record.executionId);
        if (!observed?.exit)
          throw new Error("Exact execution termination lacks an exit receipt.");
        terminal.push(observed);
      }
    }
    if (this.options.store.nonterminalExecutions(taskId, turnId).length > 0)
      throw new Error("Task Stop still has nonterminal exact executions.");
    return terminal;
  }

  async shutdown(): Promise<void> {
    const operationId = `owner_shutdown_${randomUUID().replaceAll("-", "")}`;
    const owned = this.options.store
      .allNonterminalExecutions()
      .filter(
        (record) =>
          record.ownerInstanceId === this.options.ownerInstanceId &&
          record.connectionGeneration === this.options.connectionGeneration(),
      );
    const turns = new Map<string, { taskId: string; turnId: string }>();
    for (const record of owned)
      turns.set(`${record.taskId}\u0000${record.turnId}`, {
        taskId: record.taskId,
        turnId: record.turnId,
      });
    for (const turn of turns.values())
      await this.terminateTaskTurn(
        turn.taskId,
        turn.turnId,
        this.stoppingTurns.get(`${turn.taskId}\u0000${turn.turnId}`) ??
          operationId,
      );
    await Promise.allSettled(this.activeToolCalls);
  }

  private onEvent(event: CodexServerEvent): void {
    if (event.method === "command/exec/outputDelta") {
      this.observeOutput(event);
      return;
    }
    if (event.method !== "item/tool/call" || event.requestId === undefined)
      return;
    const handling = this.handleToolCall(event);
    this.activeToolCalls.add(handling);
    void handling
      .finally(() => this.activeToolCalls.delete(handling))
      .catch(() => undefined);
  }

  private observeOutput(event: CodexServerEvent): void {
    const processId = String(event.params.processId ?? "");
    const record = this.options.store.execution(processId);
    if (!record) return;
    this.requireCurrentOwner(record);
    if (event.params.capReached === true)
      this.outputCapReached.add(record.executionId);
    if (
      ["dispatching", "termination_requested", "dispatch_unknown"].includes(
        record.state,
      )
    )
      this.options.store.markExecutionRunning(record, this.now());
  }

  private async handleToolCall(event: CodexServerEvent): Promise<void> {
    const requestId = event.requestId;
    if (requestId === undefined)
      throw new Error("Dynamic tool call lacks a request identity.");
    const params = event.params;
    if (params.tool !== ROVE_EXECUTION_TOOL.name || params.namespace !== null) {
      await this.options.rpc.respond(
        requestId,
        {},
        {
          code: -32601,
          message: "Unsupported dynamic tool authority.",
        },
      );
      return;
    }
    try {
      const result = await this.execute(event);
      await this.options.rpc.respond(requestId, result);
    } catch (error) {
      await this.options.rpc.respond(
        requestId,
        {},
        {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private async execute(
    event: CodexServerEvent,
  ): Promise<RoveExecutionToolResult> {
    const threadId = boundedIdentity(
      String(event.params.threadId ?? ""),
      "Codex thread identity",
    );
    const turnId = boundedIdentity(
      String(event.params.turnId ?? ""),
      "Codex turn identity",
    );
    const toolCallId = boundedIdentity(
      String(event.params.callId ?? ""),
      "Codex tool-call identity",
    );
    const input = parseRoveExecArguments(event.params.arguments);
    const invocation = invocationDigest({
      command: input.command,
      timeoutMs: input.timeoutMs,
      outputBytesCap: this.outputBytesCap,
    });
    const invocationKey = `${threadId}\u0000${turnId}\u0000${toolCallId}`;
    const active = this.activeInvocations.get(invocationKey);
    if (active) {
      if (active.invocationDigest !== invocation)
        throw new Error(
          "Replayed dynamic tool call conflicts with live execution authority.",
        );
      return active.result;
    }
    const existing = this.options.store.executionForToolCall(
      threadId,
      turnId,
      toolCallId,
    );
    if (existing) {
      if (
        existing.ownerInstanceId !== this.options.ownerInstanceId ||
        existing.connectionGeneration !== this.options.connectionGeneration() ||
        existing.invocationDigest !== invocation
      )
        throw new Error(
          "Replayed dynamic tool call conflicts with durable execution authority.",
        );
      const pending = this.inFlight.get(existing.executionId);
      if (pending) return this.toolResult(await pending);
      if (existing.exit)
        return this.toolResult({
          record: existing,
          stdout: "",
          stderr: "Authoritative execution output was already finalized and is not replayed.",
        });
      throw new Error(
        "Replayed dynamic tool call is durably nonterminal but no exact live request is attached.",
      );
    }
    const result = this.executeNew(
      threadId,
      turnId,
      toolCallId,
      input,
      invocation,
    );
    this.activeInvocations.set(invocationKey, {
      invocationDigest: invocation,
      result,
    });
    try {
      return await result;
    } finally {
      this.activeInvocations.delete(invocationKey);
    }
  }

  private async executeNew(
    threadId: string,
    turnId: string,
    toolCallId: string,
    input: RoveExecArguments,
    invocation: string,
  ): Promise<RoveExecutionToolResult> {
    const task = await this.options.resolveTaskAuthority(threadId, turnId);
    if (task.threadId !== threadId || task.turnId !== turnId)
      throw new Error("Resolved Task execution authority changed.");
    const digest = commandDigest({
      invocationDigest: invocation,
      cwd: task.cwd,
      permissionProfile: task.permissionProfile,
    });
    const executionId = newLocalExecutionId();
    const authority: LocalExecutionAuthority = {
      executionId,
      taskId: task.taskId,
      taskOperationId: task.taskOperationId,
      threadId,
      turnId,
      toolCallId,
      ownerInstanceId: this.options.ownerInstanceId,
      connectionGeneration: this.options.connectionGeneration(),
      delegateProcessId: executionId,
      invocationDigest: invocation,
      commandDigest: digest,
    };
    const requested = this.options.store.requestExecution({
      ...authority,
      permissionProfile: task.permissionProfile,
      requestedAt: this.now(),
    });
    const fence = this.stoppingTurns.get(`${task.taskId}\u0000${turnId}`);
    if (fence !== undefined) {
      const terminal = this.options.store.observeExecutionExit({
        ...authority,
        exitCode: -1,
        cause: "cancelled_before_dispatch",
        outputFinalized: true,
        stdoutBytes: 0,
        stderrBytes: 0,
        outputTruncated: false,
        observedAt: this.now(),
      });
      return {
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: `Execution was not dispatched because Stop ${fence} owns this Task turn (${terminal.exit!.receiptDigest}).`,
          },
        ],
      };
    }
    this.options.store.markExecutionDispatching(requested, this.now());
    const completion = this.dispatch(authority, task, input);
    this.inFlight.set(executionId, completion);
    let completionResult: LocalExecutionCompletion;
    try {
      completionResult = await completion;
    } finally {
      this.inFlight.delete(executionId);
    }
    return this.toolResult(completionResult);
  }

  private toolResult(
    completion: LocalExecutionCompletion,
  ): RoveExecutionToolResult {
    const result = completion.record.exit;
    if (!result)
      throw new Error("Execution completed without an exit receipt.");
    return {
      success: result.exitCode === 0,
      contentItems: [
        {
          type: "inputText",
          text: `${toolText(completion.stdout, completion.stderr, result.exitCode)}\nExecution receipt: ${result.receiptDigest}.`,
        },
      ],
    };
  }

  private async dispatch(
    authority: LocalExecutionAuthority,
    task: LocalExecutionTaskAuthority,
    input: RoveExecArguments,
  ): Promise<LocalExecutionCompletion> {
    try {
      const response = await this.options.rpc.request(
        "command/exec",
        {
          command: input.command,
          processId: authority.delegateProcessId,
          cwd: task.cwd,
          permissionProfile: task.permissionProfile,
          timeoutMs: input.timeoutMs,
          outputBytesCap: this.outputBytesCap,
        },
        input.timeoutMs + 30_000,
      );
      const current = this.options.store.execution(authority.executionId);
      const cause =
        current?.state === "termination_requested"
          ? "stop_requested"
          : "natural_exit";
      const record = this.options.store.observeExecutionExit({
        ...authority,
        exitCode: response.exitCode,
        cause,
        outputFinalized: true,
        stdoutBytes: Buffer.byteLength(response.stdout),
        stderrBytes: Buffer.byteLength(response.stderr),
        outputTruncated: this.outputCapReached.has(authority.executionId),
        observedAt: this.now(),
      });
      this.outputCapReached.delete(authority.executionId);
      return { record, stdout: response.stdout, stderr: response.stderr };
    } catch (error) {
      const current = this.options.store.execution(authority.executionId);
      if (current && ["dispatching", "running"].includes(current.state))
        this.options.store.markExecutionDispatchUnknown(authority, this.now());
      throw error;
    }
  }

  private requireCurrentOwner(record: LocalExecutionRecord): void {
    if (
      record.ownerInstanceId !== this.options.ownerInstanceId ||
      record.connectionGeneration !== this.options.connectionGeneration()
    )
      throw new Error("Stale execution owner cannot issue termination.");
  }
}
