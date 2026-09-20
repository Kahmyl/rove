import type {
  TaskAggregate,
  TaskConversationItem,
  TaskQueueEntry,
} from "@rove/protocol";

export type CustomerActivityKind =
  | "read"
  | "search"
  | "navigate"
  | "inspect"
  | "change"
  | "create"
  | "run"
  | "transfer"
  | "capture"
  | "verify"
  | "compare";

export type CustomerActivityState =
  "started" | "dispatched" | "checking" | "confirmed" | "failed" | "unresolved";

export interface CustomerActivityProjection {
  id: string;
  itemId: string;
  kind: CustomerActivityKind;
  state: CustomerActivityState;
  label: string;
}

export interface CustomerWorkSegmentProjection {
  id: string;
  inputItemId?: string;
  commentaryItemIds: readonly string[];
  finalAnswerItemIds: readonly string[];
  activities: readonly CustomerActivityProjection[];
  workOrder: readonly {
    type: "commentary" | "activity";
    id: string;
  }[];
  status: "active" | "terminal";
  accumulatedActiveMs: number;
  activeSince?: string;
  completedAt?: string;
}

export interface CustomerTaskExecutionProjection {
  state:
    | "idle"
    | "working"
    | "waiting_for_you"
    | "human_control"
    | "checking"
    | "stopping"
    | "stopped"
    | "failed";
  workingVisibleAfter?: string;
  queue: readonly TaskQueueEntry[];
  segments: readonly CustomerWorkSegmentProjection[];
}

const ACTIVE_ATTENTION_STATES = new Set([
  "pending",
  "responding",
  "awaiting_confirmation",
  "resolution_unknown",
]);

function orderedItems(aggregate: TaskAggregate): TaskConversationItem[] {
  const ids = aggregate.conversation.itemOrder ?? [];
  const known = new Set(ids);
  return [
    ...ids.flatMap((id) => {
      const item = aggregate.conversation.items[id];
      return item ? [item] : [];
    }),
    ...Object.values(aggregate.conversation.items).filter(
      (item) => !known.has(item.id),
    ),
  ];
}

function activityKind(item: TaskConversationItem): CustomerActivityKind {
  if (item.kind === "command") return "run";
  if (item.kind === "file_change") return "change";
  if (item.kind === "plan") return "inspect";
  const mechanism = (item.title ?? "").toLowerCase();
  if (/search|find|query/.test(mechanism)) return "search";
  if (/navigate|open_page|switch_page|back|forward/.test(mechanism))
    return "navigate";
  if (/screenshot|capture|record/.test(mechanism)) return "capture";
  if (/verify|status|check|transaction/.test(mechanism)) return "verify";
  if (/upload|download|transfer/.test(mechanism)) return "transfer";
  if (/create|write|generate/.test(mechanism)) return "create";
  if (/change|edit|interact|click|type|scroll/.test(mechanism)) return "change";
  if (/compare|diff/.test(mechanism)) return "compare";
  if (/read|inspect|evidence|pages/.test(mechanism)) return "read";
  return "inspect";
}

const ACTIVITY_LABELS: Record<
  CustomerActivityKind,
  { active: string; confirmed: string }
> = {
  read: { active: "Reading information", confirmed: "Read information" },
  search: { active: "Searching", confirmed: "Searched" },
  navigate: {
    active: "Opening the right place",
    confirmed: "Opened the right place",
  },
  inspect: { active: "Inspecting details", confirmed: "Inspected details" },
  change: { active: "Making a change", confirmed: "Made a change" },
  create: { active: "Creating content", confirmed: "Created content" },
  run: {
    active: "Running a local operation",
    confirmed: "Ran a local operation",
  },
  transfer: {
    active: "Transferring content",
    confirmed: "Transferred content",
  },
  capture: { active: "Capturing evidence", confirmed: "Captured evidence" },
  verify: {
    active: "Verifying the result",
    confirmed: "Verified the result",
  },
  compare: {
    active: "Comparing information",
    confirmed: "Compared information",
  },
};

function activityLabel(
  kind: CustomerActivityKind,
  state: CustomerActivityState,
): string {
  const copy = ACTIVITY_LABELS[kind];
  if (state === "confirmed") return copy.confirmed;
  if (state === "failed") return `${copy.active} failed`;
  if (state === "unresolved") return `${copy.active} — outcome unclear`;
  if (state === "checking") return `${copy.active} — checking outcome`;
  if (state === "dispatched") return `${copy.active} — sent`;
  return copy.active;
}

function activityProjection(
  item: TaskConversationItem,
): CustomerActivityProjection {
  const kind = activityKind(item);
  const state =
    item.activityOutcome ??
    (item.status === "started" ? "started" : "confirmed");
  return {
    id: `activity:${item.id}`,
    itemId: item.id,
    kind,
    state,
    label: activityLabel(kind, state),
  };
}

function executionState(
  aggregate: TaskAggregate,
): CustomerTaskExecutionProjection["state"] {
  if (aggregate.requestedOperation.type === "interrupt") return "stopping";
  if (aggregate.recoveryRequired !== null) return "checking";
  if (aggregate.runtime.controller === "human") return "human_control";
  if (
    aggregate.runtime.status === "awaiting_human" ||
    aggregate.attentions.some((attention) =>
      ACTIVE_ATTENTION_STATES.has(attention.status),
    )
  )
    return "waiting_for_you";
  if (aggregate.codex.turn === "interrupted") return "stopped";
  if (aggregate.codex.turn === "failed") return "failed";
  if (
    aggregate.customerActiveIntervals?.at(-1)?.endedAt === undefined &&
    (aggregate.codex.turn === "active" ||
      aggregate.requestedOperation.type === "message" ||
      aggregate.record?.bootstrap.stage !== "complete")
  )
    return "working";
  return "idle";
}

export function customerTaskExecution(
  aggregate: TaskAggregate,
): CustomerTaskExecutionProjection {
  const raw: Array<{
    id: string;
    input?: TaskConversationItem;
    items: TaskConversationItem[];
  }> = [];
  for (const item of orderedItems(aggregate)) {
    if (item.kind === "user_message") {
      raw.push({ id: item.id, input: item, items: [] });
      continue;
    }
    const segment = raw.at(-1);
    if (segment) segment.items.push(item);
    else raw.push({ id: `work:${item.id}`, items: [item] });
  }
  const state = executionState(aggregate);
  const openInterval = aggregate.customerActiveIntervals?.at(-1);
  const activeSegmentId =
    state === "working" && openInterval?.endedAt === undefined
      ? openInterval?.segmentId
      : undefined;
  const segments = raw.map((segment) => {
    const assistants = segment.items.filter(
      (item) => item.kind === "assistant_message",
    );
    const explicitFinals = assistants.filter(
      (item) => item.phase === "final_answer",
    );
    const fallbackFinal =
      explicitFinals.length === 0 &&
      segment.id !== activeSegmentId &&
      assistants.every((item) => item.phase === undefined)
        ? assistants.at(-1)
        : undefined;
    const finalIds = new Set(
      [...explicitFinals, ...(fallbackFinal ? [fallbackFinal] : [])].map(
        (item) => item.id,
      ),
    );
    const intervals = (aggregate.customerActiveIntervals ?? []).filter(
      (interval) => interval.segmentId === segment.id,
    );
    const accumulatedActiveMs = intervals.reduce((total, interval) => {
      if (!interval.endedAt) return total;
      return (
        total +
        Math.max(
          0,
          Date.parse(interval.endedAt) - Date.parse(interval.startedAt),
        )
      );
    }, 0);
    const active =
      state === "working"
        ? [...intervals]
            .reverse()
            .find((interval) => interval.endedAt === undefined)
        : undefined;
    const completedAt = segment.items
      .flatMap((item) => [item.completedAt])
      .filter((value): value is string => value !== undefined)
      .at(-1);
    const workOrder: CustomerWorkSegmentProjection["workOrder"] =
      segment.items.reduce<{ type: "commentary" | "activity"; id: string }[]>(
        (order, item) => {
          if (finalIds.has(item.id)) return order;
          order.push(
            item.kind === "assistant_message"
              ? { type: "commentary", id: item.id }
              : { type: "activity", id: `activity:${item.id}` },
          );
          return order;
        },
        [],
      );
    return {
      id: segment.id,
      ...(segment.input ? { inputItemId: segment.input.id } : {}),
      commentaryItemIds: segment.items
        .filter(
          (item) => item.kind === "assistant_message" && !finalIds.has(item.id),
        )
        .map((item) => item.id),
      finalAnswerItemIds: segment.items
        .filter((item) => finalIds.has(item.id))
        .map((item) => item.id),
      activities: segment.items
        .filter((item) => item.kind !== "assistant_message")
        .map(activityProjection),
      workOrder,
      status: active ? ("active" as const) : ("terminal" as const),
      accumulatedActiveMs,
      ...(active ? { activeSince: active.startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
    };
  });
  const activeSince = segments.find(
    (segment) => segment.status === "active",
  )?.activeSince;
  return {
    state,
    ...(state === "working" && activeSince
      ? {
          workingVisibleAfter: new Date(
            Date.parse(activeSince) + 250,
          ).toISOString(),
        }
      : {}),
    queue: (aggregate.queue?.order ?? []).flatMap((id) => {
      const entry = aggregate.queue?.entries[id];
      return entry ? [structuredClone(entry)] : [];
    }),
    segments,
  };
}

/** Rolling-startup compatibility for an older in-memory renderer projection.
 * Current production snapshots always carry customerExecution. Keeping this
 * translation here prevents React from interpreting mechanisms or rebuilding
 * segmentation while an old snapshot is replaced. */
export function legacyCustomerTaskExecution(input: {
  turnStatus:
    "unknown" | "in_progress" | "completed" | "interrupted" | "failed";
  items: Readonly<Record<string, TaskConversationItem>>;
  itemOrder?: readonly string[];
  turnOrder: readonly string[];
}): CustomerTaskExecutionProjection {
  const order = input.itemOrder ?? Object.keys(input.items);
  const latestAccepted = [...order]
    .reverse()
    .map((id) => input.items[id])
    .find((item) => item?.kind === "user_message" && item.acceptedAt);
  const activeSince = latestAccepted?.acceptedAt ?? latestAccepted?.startedAt;
  return customerTaskExecution({
    schemaVersion: 1,
    taskId: "legacy-renderer-projection",
    revision: 0,
    launch: null,
    desiredState: "open",
    record: null,
    codex: {
      availability: "available",
      threadExists: true,
      sourceLookup: "exact",
      runtimeStatus: "idle",
      archived: false,
      turn:
        input.turnStatus === "in_progress"
          ? "active"
          : input.turnStatus === "unknown"
            ? "none"
            : input.turnStatus,
    },
    codexSessionId: null,
    runtime: {
      availability: "available",
      sessionExists: false,
      bootstrapLookup: "none",
      status: "completed",
      controller: null,
      attachment: "missing",
      profileLock: "released",
      recovery: "not_needed",
    },
    continuation: { status: "none" },
    attentions: [],
    freshInspection: null,
    attachment: { ready: true, attachmentIds: [] },
    capabilityFingerprint: null,
    conversation: {
      items: input.items,
      itemOrder: order,
      turnOrder: input.turnOrder,
      terminalTurns: {},
    },
    queue: { entries: {}, order: [] },
    customerActiveIntervals:
      input.turnStatus === "in_progress" && latestAccepted && activeSince
        ? [
            {
              segmentId: latestAccepted.id,
              startedAt: activeSince,
            },
          ]
        : [],
    messageDeliveries: {},
    requestedOperation: {
      type: "observe",
      taskId: "legacy-renderer-projection",
    },
    processorGeneration: 1,
    sourcePositions: {},
    recoveryRequired: null,
  });
}
