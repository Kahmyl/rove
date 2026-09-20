import type { TaskConversationItem, TaskEvent } from "@rove/protocol";

import { authoritativePreHandoffObservationSeq } from "./handoff-observation.js";
import { projectUserInputAttachments } from "./conversations.js";
import { normalizeCompletedRequestHumanToolItem } from "./request-human-tool-item.js";
import type { TaskRuntimePort } from "./task-coordinator.js";

type CompletedHandoff = NonNullable<
  Extract<TaskEvent, { type: "codex_item_observed" }>["completedHandoff"]
>;

export async function composeCompletedRequestHumanHandoff(input: {
  taskId: string;
  threadId: string;
  turnId: string | undefined;
  item: Record<string, unknown>;
  boundRuntimeSessionId: string | undefined;
  getControlStatus?: TaskRuntimePort["getControlStatus"];
}): Promise<CompletedHandoff | undefined> {
  if (!input.turnId) return undefined;
  const normalized = normalizeCompletedRequestHumanToolItem(input.item);
  if (!normalized) return undefined;
  const result = normalized.returnedControlStatus;
  const sessionId = normalized.sessionId;
  if (
    !input.boundRuntimeSessionId ||
    sessionId !== input.boundRuntimeSessionId ||
    result.sessionId !== sessionId ||
    !input.getControlStatus
  )
    throw new Error("Completed handoff item lacks exact trusted bindings.");
  const control = await input.getControlStatus(sessionId);
  const preHandoffObservationSeq = authoritativePreHandoffObservationSeq({
    result: {
      handoffId: result.handoffId,
      generation: result.generation,
      ...(result.observationSeq === undefined
        ? {}
        : { observationSeq: result.observationSeq }),
    },
    runtime: control,
  });
  return {
    sessionId,
    handoffId: result.handoffId,
    handoffGeneration: result.generation,
    ownershipGeneration: control.generation,
    controller: control.controller,
    status: control.status,
    continuation: {
      status: "pending",
      id: `continuation:${input.taskId}:${result.generation}`,
      taskId: input.taskId,
      sessionId,
      threadId: input.threadId,
      handoffId: result.handoffId,
      generation: result.generation,
      policy: normalized.continuationPolicy,
      freshInspectionRequired: true,
      preHandoffObservationSeq,
    },
    attention: {
      authority: "rove_control",
      kind: "control_handoff",
      requestId: `control:${normalized.itemId}`,
      taskId: input.taskId,
      sessionId,
      threadId: input.threadId,
      turnId: input.turnId,
      handoffId: result.handoffId,
      generation: result.generation,
      status: "pending",
    },
  };
}

export function projectedItem(
  value: Record<string, unknown>,
  turnId: string | undefined,
  itemId: string | undefined,
  completed: boolean,
): TaskConversationItem | undefined {
  if (!turnId || !itemId) return undefined;
  const type = text(value.type);
  const kind: TaskConversationItem["kind"] =
    type === "userMessage"
      ? "user_message"
      : type === "agentMessage"
        ? "assistant_message"
        : type === "plan"
          ? "plan"
          : type === "commandExecution"
            ? "command"
            : type === "fileChange"
              ? "file_change"
              : type === "mcpToolCall" || type === "dynamicToolCall"
                ? "tool"
                : "other";
  const content = Array.isArray(value.content)
    ? value.content
        .map((part) => text(object(part)?.text))
        .filter((part): part is string => Boolean(part))
        .join("\n")
    : undefined;
  const attachments = projectUserInputAttachments(value.content);
  const phase: TaskConversationItem["phase"] =
    value.phase === "commentary" || value.phase === "final_answer"
      ? value.phase
      : undefined;
  const mechanismStatus = text(value.status);
  const activityOutcome: TaskConversationItem["activityOutcome"] = ![
    "command",
    "file_change",
    "tool",
  ].includes(kind)
    ? undefined
    : mechanismStatus === "failed" ||
        mechanismStatus === "declined" ||
        value.success === false ||
        (value.error !== null && value.error !== undefined)
      ? "failed"
      : mechanismStatus === "unresolved"
        ? "unresolved"
        : !completed || mechanismStatus === "inProgress"
          ? "started"
          : "confirmed";
  return {
    id: itemId,
    turnId,
    ...(type === "userMessage" && text(value.clientId)
      ? { clientId: text(value.clientId)! }
      : {}),
    ...(type === "userMessage" && attachments.length ? { attachments } : {}),
    kind,
    status: completed ? "completed" : "started",
    ...(activityOutcome ? { activityOutcome } : {}),
    ...(phase === undefined ? {} : { phase }),
    ...(text(value.text) || content
      ? { text: (text(value.text) ?? content)!.slice(0, 16_000) }
      : {}),
    ...(text(value.command) || text(value.tool)
      ? { title: (text(value.command) ?? text(value.tool))!.slice(0, 500) }
      : {}),
    ...(text(value.aggregatedOutput) || text(value.message)
      ? {
          progress: (text(value.aggregatedOutput) ??
            text(value.message))!.slice(0, 8_000),
        }
      : {}),
  };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
