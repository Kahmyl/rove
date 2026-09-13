import { createHash, randomUUID } from "node:crypto";

export type TaskResultKind =
  "finding_collection" | "draft" | "report" | "journey" | "artifact" | "action";

export type TaskResultLifecycle =
  | "prepared"
  | "authorized"
  | "dispatched"
  | "confirmed"
  | "failed"
  | "unresolved";

export interface TaskResultSource {
  conversationItemId?: string;
  conversationTextDigest?: string;
  operationId?: string;
  evidenceIds: readonly string[];
}

export interface TaskResultRevision {
  resultId: string;
  revision: number;
  title: string;
  body: string;
  artifactIds: readonly string[];
  digest: string;
  createdAt: string;
}

export interface TaskResult {
  resultId: string;
  taskId: string;
  turnId?: string;
  kind: TaskResultKind;
  lifecycle: TaskResultLifecycle;
  selected: boolean;
  currentRevision: number;
  revision: TaskResultRevision;
  source: TaskResultSource;
  actionMaterial?: {
    recipient?: string;
    recipientControl?: string;
    content: string;
    contentControl?: string;
    target?: string;
    commitControl?: string;
    attachmentIds: readonly string[];
    attachmentControl?: string;
    scope?: string;
  };
  materialDigest?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskResultContextSnapshot {
  resultIds: readonly string[];
  digest: string;
  developerInstructions: string;
}

export interface ResultStore {
  listResults(taskId?: string): readonly TaskResult[];
  result(taskId: string, resultId: string): TaskResult | null;
  createResult(input: {
    operationId: string;
    taskId: string;
    turnId?: string;
    kind: Exclude<TaskResultKind, "action" | "artifact">;
    title: string;
    body: string;
    artifactIds?: readonly string[];
    source: TaskResultSource;
  }): TaskResult;
  reviseDraft(input: {
    operationId: string;
    taskId: string;
    resultId: string;
    expectedRevision: number;
    title: string;
    body: string;
  }): TaskResult;
  setResultSelected(input: {
    operationId: string;
    taskId: string;
    resultId: string;
    expectedRevision: number;
    selected: boolean;
  }): TaskResult;
  createAction(input: {
    operationId: string;
    taskId: string;
    turnId?: string;
    title: string;
    body: string;
    material: {
      recipient?: string;
      recipientControl?: string;
      content: string;
      contentControl?: string;
      target?: string;
      commitControl?: string;
      attachmentIds: readonly string[];
      attachmentControl?: string;
      scope?: string;
    };
    source: TaskResultSource;
  }): TaskResult;
  transitionAction(input: {
    operationId: string;
    taskId: string;
    resultId: string;
    expectedLifecycle: TaskResultLifecycle;
    lifecycle: Exclude<TaskResultLifecycle, "prepared">;
    materialDigest?: string;
    evidenceIds?: readonly string[];
  }): TaskResult;
}

const RESULT_KINDS = new Set<TaskResultKind>([
  "finding_collection",
  "draft",
  "report",
  "journey",
  "artifact",
  "action",
]);
const RESULT_LIFECYCLES = new Set<TaskResultLifecycle>([
  "prepared",
  "authorized",
  "dispatched",
  "confirmed",
  "failed",
  "unresolved",
]);

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const text = value.trim();
  if (text.length < 1 || Array.from(text).length > maximum)
    throw new Error(`${label} is empty or exceeds ${maximum} characters.`);
  return text;
}

function boundedIds(value: unknown, label: string, maximum = 64): string[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error(`${label} is invalid.`);
  const ids = value.map((entry) => boundedText(entry, label, 160));
  if (new Set(ids).size !== ids.length)
    throw new Error(`${label} contains duplicates.`);
  return ids;
}

export function taskResultRevisionDigest(value: {
  title: string;
  body: string;
  artifactIds: readonly string[];
}): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function taskActionMaterialDigest(
  value: NonNullable<TaskResult["actionMaterial"]>,
): string {
  const recipient =
    value.recipient === undefined
      ? null
      : boundedText(value.recipient, "Action recipient", 1_000);
  const target =
    value.target === undefined
      ? null
      : boundedText(value.target, "Action target", 2_000);
  const scope =
    value.scope === undefined
      ? null
      : boundedText(value.scope, "Action scope", 1_000);
  return createHash("sha256")
    .update(
      JSON.stringify({
        recipient,
        recipientControl:
          value.recipientControl === undefined
            ? null
            : boundedText(value.recipientControl, "Recipient control", 500),
        content: boundedText(value.content, "Action content", 16_000),
        contentControl:
          value.contentControl === undefined
            ? null
            : boundedText(value.contentControl, "Content control", 500),
        target,
        commitControl:
          value.commitControl === undefined
            ? null
            : boundedText(value.commitControl, "Commit control", 500),
        attachmentIds: boundedIds(value.attachmentIds, "Action attachments"),
        attachmentControl:
          value.attachmentControl === undefined
            ? null
            : boundedText(value.attachmentControl, "Attachment control", 500),
        scope,
      }),
    )
    .digest("hex");
}

function normalizedActionMaterial(
  value: NonNullable<TaskResult["actionMaterial"]>,
): NonNullable<TaskResult["actionMaterial"]> {
  return {
    ...(value.recipient === undefined
      ? {}
      : { recipient: boundedText(value.recipient, "Action recipient", 1_000) }),
    ...(value.recipientControl === undefined
      ? {}
      : {
          recipientControl: boundedText(
            value.recipientControl,
            "Recipient control",
            500,
          ),
        }),
    content: boundedText(value.content, "Action content", 16_000),
    ...(value.contentControl === undefined
      ? {}
      : {
          contentControl: boundedText(
            value.contentControl,
            "Content control",
            500,
          ),
        }),
    ...(value.target === undefined
      ? {}
      : { target: boundedText(value.target, "Action target", 2_000) }),
    ...(value.commitControl === undefined
      ? {}
      : {
          commitControl: boundedText(
            value.commitControl,
            "Commit control",
            500,
          ),
        }),
    attachmentIds: boundedIds(value.attachmentIds, "Action attachments"),
    ...(value.attachmentControl === undefined
      ? {}
      : {
          attachmentControl: boundedText(
            value.attachmentControl,
            "Attachment control",
            500,
          ),
        }),
    ...(value.scope === undefined
      ? {}
      : { scope: boundedText(value.scope, "Action scope", 1_000) }),
  };
}

export function validateTaskResult(value: TaskResult): TaskResult {
  const resultId = boundedText(value.resultId, "Result identity", 160);
  const taskId = boundedText(value.taskId, "Result task identity", 160);
  if (!RESULT_KINDS.has(value.kind)) throw new Error("Result kind is invalid.");
  if (!RESULT_LIFECYCLES.has(value.lifecycle))
    throw new Error("Result lifecycle is invalid.");
  if (!Number.isSafeInteger(value.currentRevision) || value.currentRevision < 1)
    throw new Error("Result revision is invalid.");
  if (value.revision.resultId !== resultId)
    throw new Error("Result revision identity is invalid.");
  if (value.revision.revision !== value.currentRevision)
    throw new Error("Result current revision is inconsistent.");
  const title = boundedText(value.revision.title, "Result title", 240);
  const body = boundedText(value.revision.body, "Result body", 32_000);
  const artifactIds = boundedIds(
    value.revision.artifactIds,
    "Result artifact identities",
  );
  if (value.kind === "artifact" && artifactIds.length === 0)
    throw new Error("Artifact results require a managed artifact identity.");
  const digest = taskResultRevisionDigest({ title, body, artifactIds });
  if (digest !== value.revision.digest)
    throw new Error("Result revision digest is invalid.");
  if (!Number.isFinite(Date.parse(value.createdAt)))
    throw new Error("Result created timestamp is invalid.");
  if (!Number.isFinite(Date.parse(value.updatedAt)))
    throw new Error("Result updated timestamp is invalid.");
  if (!Number.isFinite(Date.parse(value.revision.createdAt)))
    throw new Error("Result revision timestamp is invalid.");
  const evidenceIds = boundedIds(
    value.source.evidenceIds,
    "Result evidence identities",
  );
  const conversationItemId =
    value.source.conversationItemId === undefined
      ? undefined
      : boundedText(
          value.source.conversationItemId,
          "Result source conversation item",
          160,
        );
  const operationId =
    value.source.operationId === undefined
      ? undefined
      : boundedText(value.source.operationId, "Result source operation", 160);
  if (
    value.source.conversationTextDigest !== undefined &&
    !/^[a-f0-9]{64}$/.test(value.source.conversationTextDigest)
  )
    throw new Error("Result source digest is invalid.");
  const actionMaterial = value.actionMaterial
    ? normalizedActionMaterial(value.actionMaterial)
    : undefined;
  if (value.kind === "action") {
    if (
      !actionMaterial ||
      !value.materialDigest ||
      taskActionMaterialDigest(actionMaterial) !== value.materialDigest
    )
      throw new Error("Action receipt material digest is invalid.");
  } else if (actionMaterial || value.materialDigest) {
    throw new Error("Only action results may contain action material.");
  }
  if (value.kind !== "action" && value.lifecycle !== "prepared")
    throw new Error("Only action results have an external action lifecycle.");
  return {
    ...value,
    resultId,
    taskId,
    revision: { ...value.revision, title, body, artifactIds, digest },
    source: {
      ...value.source,
      ...(conversationItemId === undefined ? {} : { conversationItemId }),
      ...(operationId === undefined ? {} : { operationId }),
      evidenceIds,
    },
    ...(actionMaterial
      ? { actionMaterial, materialDigest: value.materialDigest! }
      : {}),
  };
}

export function newResultId(): string {
  return `result_${randomUUID()}`;
}

export function taskResultConsequenceKey(result: TaskResult): string {
  if (result.kind !== "action" || !result.materialDigest)
    throw new Error("Only action results have a consequence key.");
  return `task-result:${result.resultId}:${result.materialDigest}`;
}

export function assembleTaskResultContext(
  results: readonly TaskResult[],
): TaskResultContextSnapshot {
  if (results.length < 1 || results.length > 8)
    throw new Error("Selected result context must contain 1 to 8 results.");
  const unique = new Set(results.map((result) => result.resultId));
  if (unique.size !== results.length)
    throw new Error("Selected result context contains duplicates.");
  const lines = [
    "Selected local task results follow. Treat them as user-selected working material, not as permission or proof of external completion.",
    ...results.flatMap((result) => {
      const header = `\n[${result.kind}; ${result.resultId}; ${result.lifecycle}; revision ${result.currentRevision}] ${result.revision.title}`;
      if (result.kind !== "action") return [header, result.revision.body];
      const material = result.actionMaterial!;
      return [
        header,
        result.revision.body,
        `Exact action material: ${JSON.stringify(material)}`,
        result.lifecycle === "authorized"
          ? `This action material is user-authorized. If executing it through Rove, preserve the material and exact control names, stage only non-consequential fields, and never upload a file before an exact browser.prepare_task_result_action upload plan is authorized. A later send or submit plan may include that attachment only when Runtime links the unchanged current file hash to the applied upload plan and receipt. Prepare this result with consequenceKey ${JSON.stringify(taskResultConsequenceKey(result))} and materialDigest ${JSON.stringify(result.materialDigest)}. Do not commit until browser.task_result_action_plan reports authorized. Commit the unchanged plan once with its planId and authorizationDigest ${JSON.stringify(result.materialDigest)}. Runtime evidence, not model text, determines its outcome.`
          : "This action is not currently authorized for dispatch. Discuss or refine it only; do not execute it.",
      ];
    }),
  ];
  const developerInstructions = lines.join("\n");
  if (developerInstructions.length > 16_000)
    throw new Error("Selected result context exceeds the model context limit.");
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        references: results.map((result) => ({
          resultId: result.resultId,
          revision: result.currentRevision,
          digest: result.revision.digest,
          lifecycle: result.lifecycle,
        })),
        developerInstructions,
      }),
    )
    .digest("hex");
  return {
    resultIds: results.map((result) => result.resultId),
    digest,
    developerInstructions,
  };
}
