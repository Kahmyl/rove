import type {
  ProductAttentionProjection,
  ProductTaskProjection,
} from "./local-product-api.js";

export type CustomerCollaborationDecision = "accept" | "decline" | "cancel";
export type CustomerCollaborationAction =
  | { kind: "respond"; decision: CustomerCollaborationDecision; label: string }
  | { kind: "trusted_external"; label: string };

export interface CustomerCollaborationRequest {
  state:
    | "answer_required"
    | "approval_required"
    | "secure_interaction_required"
    | "submitting"
    | "confirmation_unresolved";
  responseState: "pending" | "submitting" | "checking" | "unresolved";
  title: string;
  description: string;
  identity: Pick<
    ProductAttentionProjection,
    | "authority"
    | "requestId"
    | "taskId"
    | "threadId"
    | "turnId"
    | "itemId"
    | "generation"
  >;
  kind: ProductAttentionProjection["kind"];
  context?: ProductAttentionProjection["context"];
  questions?: ProductAttentionProjection["questions"];
  elicitation?: ProductAttentionProjection["elicitation"];
  sensitive: boolean;
  actions: readonly CustomerCollaborationAction[];
}

export interface CustomerBrowserCollaboration {
  state:
    | "none"
    | "agent_control"
    | "takeover_available"
    | "takeover_required"
    | "human_control"
    | "checking_after_return";
  title: string;
  description: string;
  canTakeOver: boolean;
  canReturnToRove: boolean;
  handoffGeneration?: number;
  continuationPolicy?:
    | "resume_after_control_return"
    | "explicit_user_response";
}

export interface CustomerTaskCollaborationProjection {
  taskId: string;
  request?: CustomerCollaborationRequest;
  browser: CustomerBrowserCollaboration;
  needsCustomerAction: boolean;
}

const ACTIVE_REQUEST_STATES = new Set([
  "pending",
  "responding",
  "awaiting_confirmation",
  "resolution_unknown",
]);

const REQUEST_PRIORITY: Readonly<
  Record<ProductAttentionProjection["kind"], number>
> = {
  user_input: 0,
  mcp_elicitation: 1,
  permission_approval: 2,
  network_approval: 3,
  file_approval: 4,
  command_approval: 5,
  control_handoff: 6,
};

function stableRequestOrder(
  left: ProductAttentionProjection,
  right: ProductAttentionProjection,
): number {
  const responsePriority = (entry: ProductAttentionProjection) =>
    entry.status === "pending" ? 1 : 0;
  return (
    responsePriority(left) - responsePriority(right) ||
    REQUEST_PRIORITY[left.kind] - REQUEST_PRIORITY[right.kind] ||
    left.sequence - right.sequence ||
    left.requestId.localeCompare(right.requestId) ||
    left.generation - right.generation
  );
}

function requestDescription(entry: ProductAttentionProjection): string {
  if (entry.instruction) return entry.instruction;
  if (entry.elicitation) return entry.elicitation.message;
  return {
    command_approval: "Review the command and choose whether Rove may run it.",
    file_approval: "Review the proposed file change before Rove continues.",
    network_approval: "Choose whether Rove may use the requested network access.",
    permission_approval: "Choose whether to grant this permission for the current work.",
    mcp_elicitation: "A connected service needs information before work can continue.",
    user_input: "Answer this question so Rove can continue.",
    control_handoff: "Take control of the browser to complete this step.",
  }[entry.kind];
}

function requestActions(
  entry: ProductAttentionProjection,
): readonly CustomerCollaborationAction[] {
  if (entry.status !== "pending") return [];
  if (entry.kind === "user_input")
    return [{ kind: "respond", decision: "accept", label: "Send" }];
  if (entry.kind === "mcp_elicitation") {
    const actions: CustomerCollaborationAction[] = [];
    if (entry.elicitation?.mode === "url")
      actions.push({ kind: "trusted_external", label: "Open secure page" });
    if (!entry.elicitation?.unsupportedReason)
      actions.push({
        kind: "respond",
        decision: "accept",
        label: entry.elicitation?.mode === "url" ? "Continue" : "Submit",
      });
    actions.push(
      { kind: "respond", decision: "decline", label: "Decline" },
      { kind: "respond", decision: "cancel", label: "Cancel" },
    );
    return actions;
  }
  const allowed = entry.allowedDecisions ?? ["accept", "decline"];
  return allowed.flatMap((decision): CustomerCollaborationAction[] => {
    if (decision === "cancel") return [];
    return [
      {
        kind: "respond",
        decision,
        label:
          decision === "accept"
            ? entry.kind === "permission_approval"
              ? "Allow"
              : "Approve"
            : entry.kind === "permission_approval"
              ? "Deny"
              : "Decline",
      },
    ];
  });
}

function projectRequest(
  entry: ProductAttentionProjection,
): CustomerCollaborationRequest {
  const sensitive =
    entry.elicitation?.mode === "url" ||
    entry.questions?.some((question) => question.isSecret) === true;
  const responseState =
    entry.status === "pending"
      ? "pending"
      : entry.status === "responding"
        ? "submitting"
        : entry.status === "resolution_unknown"
          ? "unresolved"
          : "checking";
  return {
    state:
      responseState === "unresolved"
        ? "confirmation_unresolved"
        : responseState !== "pending"
          ? "submitting"
          : sensitive
            ? "secure_interaction_required"
            : entry.kind === "user_input"
              ? "answer_required"
              : "approval_required",
    responseState,
    title: entry.title,
    description:
      responseState === "submitting"
        ? "Submitting your response…"
        : responseState === "checking"
          ? "Checking whether your response was received…"
          : responseState === "unresolved"
            ? "Rove could not confirm the response. It will not be sent again automatically."
            : requestDescription(entry),
    identity: {
      authority: entry.authority,
      requestId: entry.requestId,
      taskId: entry.taskId,
      ...(entry.threadId === undefined ? {} : { threadId: entry.threadId }),
      ...(entry.turnId === undefined ? {} : { turnId: entry.turnId }),
      ...(entry.itemId === undefined ? {} : { itemId: entry.itemId }),
      generation: entry.generation,
    },
    kind: entry.kind,
    ...(entry.context === undefined ? {} : { context: entry.context }),
    ...(entry.questions === undefined ? {} : { questions: entry.questions }),
    ...(entry.elicitation === undefined
      ? {}
      : { elicitation: entry.elicitation }),
    sensitive,
    actions: requestActions(entry),
  };
}

function projectBrowser(
  task: ProductTaskProjection,
  attention: readonly ProductAttentionProjection[],
): CustomerBrowserCollaboration {
  const runtime = task.runtime;
  const taskHandoff = attention.find(
    (entry) =>
      entry.authority === "rove_control" &&
      entry.kind === "control_handoff" &&
      entry.taskId === task.taskId &&
      entry.status === "pending",
  );
  const handoff =
    taskHandoff?.generation === runtime?.handoffGeneration
      ? taskHandoff
      : undefined;
  const exactTakeover =
    task.capabilities?.canTakeControl === true &&
    runtime?.handoffActionable === true &&
    runtime.status === "awaiting_human" &&
    runtime.controller === null &&
    handoff !== undefined;
  const exactReturn =
    task.capabilities?.canReturnToRove === true &&
    runtime?.controller === "human";
  const voluntaryTakeover =
    task.executionMode === "companion" &&
    task.capabilities?.canTakeControl === true &&
    runtime?.status === "active" &&
    runtime.controller === "agent" &&
    runtime.attachment === "attached" &&
    taskHandoff === undefined;

  if (exactTakeover)
    return {
      state: "takeover_required",
      title: "Waiting for you",
      description:
        handoff.instruction ??
        "Take control of the browser to complete this step, then return it to Rove.",
      canTakeOver: true,
      canReturnToRove: false,
      handoffGeneration: handoff.generation,
      ...(handoff.continuationPolicy === undefined
        ? {}
        : { continuationPolicy: handoff.continuationPolicy }),
    };
  if (exactReturn)
    return {
      state: "human_control",
      title: "You're in control",
      description: "Complete the browser step, then return control so Rove can continue.",
      canTakeOver: false,
      canReturnToRove: true,
      ...(runtime?.continuationPolicy === undefined
        ? {}
        : { continuationPolicy: runtime.continuationPolicy }),
    };
  if (runtime?.collaborationState === "checking_after_return")
    return {
      state: "checking_after_return",
      title: "Checking the page…",
      description: "Rove is checking the page before continuing.",
      canTakeOver: false,
      canReturnToRove: false,
      ...(runtime.continuationPolicy === undefined
        ? {}
        : { continuationPolicy: runtime.continuationPolicy }),
    };
  if (voluntaryTakeover)
    return {
      state: "takeover_available",
      title: "Rove controls the browser",
      description: "You can take over this Task's browser whenever you need to.",
      canTakeOver: true,
      canReturnToRove: false,
    };
  if (runtime?.controller === "human")
    return {
      state: "human_control",
      title: "You're in control",
      description: "Rove cannot change the browser while you control it.",
      canTakeOver: false,
      canReturnToRove: false,
    };
  if (runtime?.attachment === "attached" && runtime.controller === "agent")
    return {
      state: "agent_control",
      title: "Rove controls the browser",
      description: "Rove can continue working in this Task's browser.",
      canTakeOver: false,
      canReturnToRove: false,
      ...(taskHandoff?.continuationPolicy === undefined
        ? runtime.continuationPolicy === undefined
          ? {}
          : { continuationPolicy: runtime.continuationPolicy }
        : { continuationPolicy: taskHandoff.continuationPolicy }),
    };
  return {
    state: "none",
    title: "No browser collaboration needed",
    description: "This Task is not waiting on browser control.",
    canTakeOver: false,
    canReturnToRove: false,
  };
}

export function customerTaskCollaboration(
  task: ProductTaskProjection,
  attention: readonly ProductAttentionProjection[],
): CustomerTaskCollaborationProjection {
  const current = attention
    .filter(
      (entry) =>
        entry.taskId === task.taskId &&
        entry.authority === "codex" &&
        entry.kind !== "control_handoff" &&
        ACTIVE_REQUEST_STATES.has(entry.status) &&
        (entry.status !== "pending" || task.capabilities?.canRespond === true),
    )
    .sort(stableRequestOrder)[0];
  const request = current === undefined ? undefined : projectRequest(current);
  const browser = projectBrowser(task, attention);
  return {
    taskId: task.taskId,
    ...(request === undefined ? {} : { request }),
    browser,
    needsCustomerAction:
      request?.responseState === "pending" ||
      browser.state === "takeover_required" ||
      browser.state === "human_control",
  };
}
