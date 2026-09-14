import type {
  CodexRpcPort,
  CodexThread,
  ThreadListResponse,
  ThreadResumeParams,
  ThreadStartParams,
  UserInput,
} from "./protocol.js";
import { APPROVED_CODEX_CLI_VERSION } from "./compatibility.js";

export const ROVE_CODEX_COMPATIBILITY_PROFILE = Object.freeze({
  cliVersion: APPROVED_CODEX_CLI_VERSION,
  historyMode: "legacy" as const,
});

export type CodexMessageDeliveryState =
  | "dispatch_not_started"
  | "transport_may_have_received"
  | "acceptance_observed"
  | "message_materialized"
  | "non_submission_established"
  | "unresolved";

export interface CodexMessageDeliveryEvidence {
  operationId: string;
  threadId: string;
  turnId?: string;
  state: CodexMessageDeliveryState;
  connectionGeneration: number;
  observedAt: string;
}

export class CodexThreadCompatibilityError extends Error {
  constructor() {
    super("Codex thread is outside the qualified compatibility profile.");
    this.name = "CodexThreadCompatibilityError";
  }
}

/**
 * The sole production owner of task-scoped thread and turn decisions. The
 * App Server host still owns transport and the Task Engine still owns durable
 * lifecycle state; this supervisor keeps those two authorities from being
 * reimplemented by each command handler.
 */
export class CodexThreadSessionSupervisor {
  private connectionGenerationValue = 1;
  private readonly attached = new Map<string, number>();

  constructor(
    private readonly rpc: CodexRpcPort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  connectionGeneration(): number {
    return this.connectionGenerationValue;
  }

  replaceConnectionGeneration(generation: number): void {
    if (
      !Number.isSafeInteger(generation) ||
      generation <= this.connectionGenerationValue
    )
      throw new Error(
        "Codex connection generation must increase monotonically.",
      );
    this.connectionGenerationValue = generation;
    this.attached.clear();
  }

  async listAll(): Promise<Array<{ thread: CodexThread; archived: boolean }>> {
    const listState = async (archived: boolean) => {
      const entries: Array<{ thread: CodexThread; archived: boolean }> = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const response: ThreadListResponse = await this.rpc.request(
          "thread/list",
          {
            limit: 100,
            archived,
            ...(cursor === null ? {} : { cursor }),
          },
        );
        entries.push(...response.data.map((thread) => ({ thread, archived })));
        if (!response.nextCursor) return entries;
        if (seen.has(response.nextCursor))
          throw new Error("Codex thread-list pagination is cyclic.");
        seen.add(response.nextCursor);
        cursor = response.nextCursor;
      }
      throw new Error("Codex thread-list pagination exceeded its bound.");
    };
    const [open, archived] = await Promise.all([
      listState(false),
      listState(true),
    ]);
    return [...open, ...archived].filter(
      (entry, index, values) =>
        values.findIndex(
          (candidate) => candidate.thread.id === entry.thread.id,
        ) === index,
    );
  }

  async start(params: ThreadStartParams): Promise<CodexThread> {
    const started = await this.rpc.request("thread/start", {
      ...params,
      historyMode: ROVE_CODEX_COMPATIBILITY_PROFILE.historyMode,
      experimentalRawEvents: false,
    });
    this.assertCompatibility(started.thread);
    this.attached.set(started.thread.id, this.connectionGenerationValue);
    return started.thread;
  }

  async read(threadId: string, includeTurns: boolean): Promise<CodexThread> {
    const result = await this.rpc.request("thread/read", {
      threadId,
      includeTurns,
    });
    this.assertCompatibility(result.thread);
    return result.thread;
  }

  async resume(params: ThreadResumeParams): Promise<CodexThread> {
    const resumed = await this.rpc.request("thread/resume", params);
    this.assertCompatibility(resumed.thread);
    this.attached.set(resumed.thread.id, this.connectionGenerationValue);
    return resumed.thread;
  }

  isAttached(threadId: string): boolean {
    return this.attached.get(threadId) === this.connectionGenerationValue;
  }

  async dispatch(input: {
    thread: CodexThread;
    operationId: string;
    message: string;
    attachments?: readonly UserInput[];
    expectedActiveTurnId?: string;
  }): Promise<CodexMessageDeliveryEvidence> {
    const evidence = (
      state: CodexMessageDeliveryState,
      turnId?: string,
    ): CodexMessageDeliveryEvidence => ({
      operationId: input.operationId,
      threadId: input.thread.id,
      ...(turnId ? { turnId } : {}),
      state,
      connectionGeneration: this.connectionGenerationValue,
      observedAt: this.now(),
    });
    if (
      !this.isAttached(input.thread.id) ||
      (input.thread.status.type === "active" && !input.expectedActiveTurnId)
    )
      return evidence("dispatch_not_started");
    try {
      const turnInput: UserInput[] = [
        ...(input.attachments ?? []),
        { type: "text", text: input.message, text_elements: [] },
      ];
      if (input.thread.status.type === "active") {
        const expectedTurnId = input.expectedActiveTurnId;
        if (!expectedTurnId) return evidence("dispatch_not_started");
        const steered = await this.rpc.request("turn/steer", {
          threadId: input.thread.id,
          expectedTurnId,
          clientUserMessageId: input.operationId,
          input: turnInput,
        });
        return evidence("acceptance_observed", steered.turnId);
      } else {
        const started = await this.rpc.request("turn/start", {
          threadId: input.thread.id,
          clientUserMessageId: input.operationId,
          input: turnInput,
        });
        return evidence("acceptance_observed", started.turn.id);
      }
    } catch (error) {
      if (error !== null && typeof error === "object" && "rpc" in error)
        return evidence("non_submission_established");
      return evidence("transport_may_have_received");
    }
  }

  correlate(
    thread: CodexThread,
    operationId: string,
  ): CodexMessageDeliveryEvidence {
    const materialized = thread.turns.find((turn) =>
      turn.items.some(
        (item) => item.type === "userMessage" && item.clientId === operationId,
      ),
    );
    return {
      operationId,
      threadId: thread.id,
      ...(materialized ? { turnId: materialized.id } : {}),
      state: materialized ? "message_materialized" : "unresolved",
      connectionGeneration: this.connectionGenerationValue,
      observedAt: this.now(),
    };
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    await this.rpc.request("turn/interrupt", { threadId, turnId });
  }

  async setArchived(threadId: string, archived: boolean): Promise<void> {
    await this.rpc.request(archived ? "thread/archive" : "thread/unarchive", {
      threadId,
    });
  }

  private assertCompatibility(thread: CodexThread): void {
    if (
      thread.cliVersion !== ROVE_CODEX_COMPATIBILITY_PROFILE.cliVersion ||
      thread.historyMode !== ROVE_CODEX_COMPATIBILITY_PROFILE.historyMode
    )
      throw new CodexThreadCompatibilityError();
  }
}
