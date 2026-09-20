import type {
  CodexAccountCatalogPort,
  CodexCatalogSnapshot,
} from "./account-catalog.js";
import type { CodexHostHealth } from "./app-server-host.js";
import type {
  AttentionRequest,
  AttentionKind,
  AttentionStatus,
} from "./attention.js";
import type {
  ProductTaskPort,
  ExecutionMode,
  BrowserIdentity,
  ProductTaskSnapshot,
  ApprovalsReviewer,
} from "./product-task-port.js";
import {
  customerTaskCollaboration,
  type CustomerTaskCollaborationProjection,
} from "./customer-task-collaboration.js";
import {
  customerTaskPresentation,
  type CustomerTaskPresentation,
} from "./customer-task-presentation.js";
import type {
  CodexTurnStatus,
  ProjectedConversationItem,
} from "./conversations.js";
import type {
  AttachmentRuntimeMaterializer,
  TaskAttachmentAuthority,
  TaskAttachmentDescriptor,
  TaskFileAttention,
} from "./task-attachments.js";
import type {
  TaskAcceptance,
  TaskPortableValue,
  TaskResultActionPlan,
  Recording,
  StartRecordingRequest,
} from "@rove/protocol";
import {
  assembleWorkflowContext,
  textDigest,
  validateWorkflowConfiguration,
  type WorkflowConfiguration,
  type WorkflowEnvironment,
  type WorkflowPromotionCategory,
  type WorkflowStore,
} from "./workflows.js";
import {
  assembleTaskResultContext,
  taskResultConsequenceKey,
  type ResultStore,
  type TaskResult,
  type TaskResultKind,
} from "./results.js";

export const LOCAL_PRODUCT_API_VERSION = 9 as const;
export interface ProductTaskLaunchInput {
  outcome: string;
  executionMode: ExecutionMode;
  browserIdentity?: BrowserIdentity;
  approvalsReviewer: ApprovalsReviewer;
  model?: string;
  reasoningEffort?: string;
  attachmentIds?: readonly string[];
  workflowId?: string;
  shareWorkflowContext?: boolean;
}
export type LocalProductCommand =
  | { type: "account.refresh" }
  | { type: "account.token.refresh" }
  | { type: "account.login"; loginType: "chatgpt" | "deviceCode" }
  | { type: "account.login.cancel"; loginId: string }
  | { type: "account.logout" }
  | { type: "attachments.pick" }
  | {
      type: "workflow.create";
      operationId: string;
      name: string;
      configuration: WorkflowConfiguration;
    }
  | {
      type: "workflow.edit";
      operationId: string;
      workflowId: string;
      expectedRevision: number;
      name: string;
      configuration: WorkflowConfiguration;
    }
  | {
      type: "workflow.archive" | "workflow.unarchive";
      operationId: string;
      workflowId: string;
      expectedRevision: number;
    }
  | {
      type: "workflow.promote";
      operationId: string;
      workflowId: string;
      expectedRevision: number;
      category: WorkflowPromotionCategory;
      text: string;
      appliesTo: readonly string[];
      sourceTaskId: string;
      sourceItemId?: string;
      sourceResultId?: string;
      sourceResultRevision?: number;
    }
  | {
      type: "result.create";
      operationId: string;
      taskId: string;
      sourceItemId: string;
      kind: Exclude<TaskResultKind, "artifact">;
      title: string;
      body: string;
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
    }
  | {
      type: "result.revise";
      operationId: string;
      taskId: string;
      resultId: string;
      expectedRevision: number;
      title: string;
      body: string;
    }
  | {
      type: "result.select";
      operationId: string;
      taskId: string;
      resultId: string;
      expectedRevision: number;
      selected: boolean;
    }
  | {
      type: "result.authorize";
      operationId: string;
      taskId: string;
      resultId: string;
      materialDigest: string;
    }
  | { type: "attachments.remove"; attachmentId: string }
  | { type: "attachments.replace"; attachmentId: string }
  | {
      type: "task.attachment.reselect";
      taskId: string;
      attachmentId: string;
    }
  | {
      type: "file-attention.select";
      requestId: string;
      taskId: string;
      sessionId: string;
    }
  | {
      type: "file-attention.cancel";
      requestId: string;
      taskId: string;
      sessionId: string;
    }
  | { type: "task.launch"; operationId: string; input: ProductTaskLaunchInput }
  | {
      type: "task.message";
      taskId: string;
      operationId: string;
      outcome: string;
      attachmentIds?: readonly string[];
      selectedResultIds?: readonly string[];
    }
  | {
      type: "task.steer";
      taskId: string;
      operationId: string;
      expectedTurnId: string;
      outcome: string;
      attachmentIds?: readonly string[];
    }
  | {
      type: "task.queue.add";
      taskId: string;
      operationId: string;
      outcome: string;
      attachmentIds?: readonly string[];
      selectedResultIds?: readonly string[];
    }
  | {
      type: "task.queue.edit";
      taskId: string;
      operationId: string;
      entryId: string;
      outcome: string;
    }
  | {
      type: "task.queue.remove";
      taskId: string;
      operationId: string;
      entryId: string;
    }
  | {
      type: "task.queue.reorder";
      taskId: string;
      operationId: string;
      entryIds: readonly string[];
    }
  | {
      type: "task.queue.steer";
      taskId: string;
      entryId: string;
      expectedTurnId: string;
    }
  | { type: "task.close"; taskId: string; operationId: string }
  | { type: "task.return-control"; taskId: string; operationId: string }
  | { type: "task.thread.read"; taskId: string }
  | { type: "task.thread.archive"; taskId: string; operationId?: string }
  | { type: "task.thread.unarchive"; taskId: string; operationId?: string }
  | { type: "task.effects.acknowledge"; taskId: string }
  | {
      type: "task.effects.authorize-repeat";
      taskId: string;
      effectId: string;
    }
  | {
      type: "task.effects.closeout";
      taskId: string;
      operationId: string;
    }
  | {
      type: "task.recording.start";
      taskId: string;
      scope: "page" | "browser_window";
      pageId?: string;
      confirmUnmaskedSensitiveContent: true;
    }
  | { type: "task.recording.stop"; taskId: string; recordingId: string }
  | {
      type: "attention.decide";
      requestId: string;
      taskId: string;
      threadId?: string;
      turnId?: string;
      itemId?: string;
      generation: number;
      decision: "accept" | "decline" | "cancel";
      answers?: Record<string, readonly string[]>;
      form?: Record<string, string | number | boolean | readonly string[]>;
    }
  | {
      type: "attention.respond";
      requestId: string;
      taskId: string;
      threadId?: string;
      turnId?: string;
      itemId?: string;
      generation: number;
      result: unknown;
    };
/** The complete renderer-write surface. Addressing and policy are host-owned. */
export type RendererProductIntent =
  | { type: "account.refresh" }
  | { type: "account.token.refresh" }
  | { type: "account.login"; loginType: "chatgpt" | "deviceCode" }
  | { type: "account.login.cancel"; loginId: string }
  | { type: "account.logout" }
  | { type: "attachments.pick" }
  | Extract<
      LocalProductCommand,
      {
        type:
          | "workflow.create"
          | "workflow.edit"
          | "workflow.archive"
          | "workflow.unarchive"
          | "workflow.promote"
          | "result.create"
          | "result.revise"
          | "result.select"
          | "result.authorize"
          | "task.recording.start"
          | "task.recording.stop"
          | "task.steer"
          | "task.queue.add"
          | "task.queue.edit"
          | "task.queue.remove"
          | "task.queue.reorder"
          | "task.queue.steer";
      }
    >
  | { type: "attachments.remove"; attachmentId: string }
  | { type: "attachments.replace"; attachmentId: string }
  | {
      type: "task.attachment.reselect";
      taskId: string;
      attachmentId: string;
    }
  | {
      type: "file-attention.select";
      requestId: string;
      taskId: string;
      sessionId: string;
    }
  | {
      type: "file-attention.cancel";
      requestId: string;
      taskId: string;
      sessionId: string;
    }
  | { type: "task.launch"; operationId: string; input: ProductTaskLaunchInput }
  | {
      type: "task.message";
      taskId: string;
      operationId: string;
      outcome: string;
      attachmentIds?: readonly string[];
      selectedResultIds?: readonly string[];
    }
  | { type: "task.stop"; taskId: string; operationId: string }
  | { type: "task.cleanup.retry"; taskId: string; operationId: string }
  | { type: "task.return-control"; taskId: string; operationId: string }
  | { type: "task.restore"; taskId: string; operationId: string }
  | { type: "task.archive"; taskId: string; operationId: string }
  | { type: "task.effects.acknowledge"; taskId: string }
  | {
      type: "task.effects.authorize-repeat";
      taskId: string;
      effectId: string;
    }
  | {
      type: "attention.decide";
      taskId: string;
      requestId: string;
      generation: number;
      decision: "accept" | "decline" | "cancel";
      answers?: Record<string, readonly string[]>;
      form?: Record<string, string | number | boolean | readonly string[]>;
    };
export interface ProductHostProjection {
  state: CodexHostHealth["state"];
  ready: boolean;
  restartAttempt: number;
  error?: string;
  compatibility?: {
    version: string;
    platform: string;
    architecture: string;
    source: "development" | "packaged";
  };
}
export interface ProductAttentionProjection {
  authority: AttentionRequest["authority"];
  kind: AttentionKind;
  requestId: string;
  taskId: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  generation: number;
  status: AttentionStatus;
  sequence: number;
  title: string;
  instruction?: string;
  context?: readonly { label: string; value: string }[];
  questions?: readonly ProductAttentionQuestion[];
  elicitation?: ProductElicitationProjection;
  allowedDecisions?: readonly ("accept" | "decline" | "cancel")[];
  continuationPolicy?: "resume_after_control_return" | "explicit_user_response";
}
export interface ProductAttentionQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: readonly { label: string; description: string }[] | null;
}
export interface ProductElicitationField {
  id: string;
  title: string;
  description?: string;
  required: boolean;
  type:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "single_select"
    | "multi_select";
  options?: readonly { value: string; label: string }[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  format?: "email" | "uri" | "date" | "date-time";
  default?: string | number | boolean | readonly string[];
}
export interface ProductElicitationProjection {
  mode: "form" | "url";
  message: string;
  serverName?: string;
  fields?: readonly ProductElicitationField[];
  unsupportedReason?: string;
}
export interface ProductConversationProjection {
  activeTurnId?: string;
  turnStatus: CodexTurnStatus;
  explicitSummary?: string;
  archived: boolean;
  items: Readonly<Record<string, ProjectedConversationItem>>;
  itemOrder?: readonly string[];
  turnOrder: readonly string[];
}
export interface ProductTaskProjection {
  taskId: string;
  executionMode: ExecutionMode;
  browserIdentity?: BrowserIdentity;
  selectionSource: ProductTaskSnapshot["context"]["selectionSource"];
  selectedAt: string;
  bootstrapStage: ProductTaskSnapshot["context"]["bootstrap"]["stage"];
  initialLaunch?: {
    operationId: string;
    inputDigest: string;
    stage: NonNullable<
      ProductTaskSnapshot["context"]["initialLaunch"]
    >["stage"];
    turnId?: string;
  };
  roveSessionId?: string;
  codexThreadId?: string;
  model?: string;
  reasoningEffort?: string;
  approvalsReviewer: ApprovalsReviewer;
  conversation?: ProductConversationProjection;
  results: readonly TaskResult[];
  recordings?: readonly Recording[];
  lifecycle: ProductTaskSnapshot["lifecycle"];
  availableActions: ProductTaskSnapshot["availableActions"];
  /** Present on every current production projection. Optional only while
   * decoding older in-memory bridge fixtures during rolling startup. */
  capabilities?: ProductTaskSnapshot["capabilities"];
  customerExecution?: ProductTaskSnapshot["customerExecution"];
  customerCollaboration?: CustomerTaskCollaborationProjection;
  customerPresentation?: CustomerTaskPresentation;
  runtime?: ProductTaskSnapshot["runtime"];
  attachments?: readonly TaskAttachmentDescriptor[];
  workflowContext?: NonNullable<
    ProductTaskSnapshot["context"]["workflowContext"]
  >;
  workflowAssociation?: NonNullable<
    ProductTaskSnapshot["context"]["workflowAssociation"]
  >;
  operation?: {
    type: "finish";
    operationId: string;
    status: "accepted" | "deferred-for-convergence";
    reason: string;
  };
}
export type TrustedExternalIntent =
  | { purpose: "account_login"; loginId: string }
  | {
      purpose: "mcp_elicitation";
      taskId: string;
      requestId: string;
      generation: number;
    };
export interface LocalProductSnapshot {
  version: typeof LOCAL_PRODUCT_API_VERSION;
  host: ProductHostProjection;
  catalog: CodexCatalogSnapshot;
  attention: readonly ProductAttentionProjection[];
  tasks: readonly ProductTaskProjection[];
  workflows: readonly WorkflowEnvironment[];
  recoveryWarnings: readonly string[];
  draftAttachments: readonly TaskAttachmentDescriptor[];
  fileAttention: readonly TaskFileAttention[];
  currentTaskId?: string;
}
export type LocalProductResult =
  CodexCatalogSnapshot | object | string | boolean | undefined;
export interface ProductAttentionPort {
  refresh?(): Promise<void>;
  list(): readonly AttentionRequest[];
  requireExact(identity: {
    authority: AttentionRequest["authority"];
    requestId: string;
    taskId: string;
    threadId?: string;
    turnId?: string;
    itemId?: string;
    generation: number;
  }): AttentionRequest;
}
export function validateTrustedExternalUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Trusted external URL is malformed.");
  }
  if (url.protocol !== "https:")
    throw new Error("Only HTTPS external URLs are permitted.");
  return value;
}
function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Invalid ${label}.`);
  return value;
}
function stableOperationId(value: unknown, label: string): string {
  const id = nonempty(value, label);
  if (
    !/^intent_[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      id,
    )
  )
    throw new Error(`Invalid ${label}.`);
  return id;
}
function exactCommand(
  command: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const invalid = Object.keys(command).find((key) => !allowed.includes(key));
  if (invalid !== undefined)
    throw new Error(
      `Local product command contains unsupported field ${invalid}.`,
    );
}
function boundedText(value: unknown, maximum = 280): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, maximum)
    : undefined;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function isApprovalsReviewer(value: unknown): value is ApprovalsReviewer {
  return value === "auto_review" || value === "user";
}
const RENDERER_PRODUCT_INTENT_SHAPES: Readonly<
  Record<RendererProductIntent["type"], readonly string[]>
> = {
  "account.refresh": ["type"],
  "account.token.refresh": ["type"],
  "account.login": ["type", "loginType"],
  "account.login.cancel": ["type", "loginId"],
  "account.logout": ["type"],
  "attachments.pick": ["type"],
  "workflow.create": ["type", "operationId", "name", "configuration"],
  "workflow.edit": [
    "type",
    "operationId",
    "workflowId",
    "expectedRevision",
    "name",
    "configuration",
  ],
  "workflow.archive": ["type", "operationId", "workflowId", "expectedRevision"],
  "workflow.unarchive": [
    "type",
    "operationId",
    "workflowId",
    "expectedRevision",
  ],
  "workflow.promote": [
    "type",
    "operationId",
    "workflowId",
    "expectedRevision",
    "category",
    "text",
    "appliesTo",
    "sourceTaskId",
    "sourceItemId",
    "sourceResultId",
    "sourceResultRevision",
  ],
  "result.create": [
    "type",
    "operationId",
    "taskId",
    "sourceItemId",
    "kind",
    "title",
    "body",
    "actionMaterial",
  ],
  "result.revise": [
    "type",
    "operationId",
    "taskId",
    "resultId",
    "expectedRevision",
    "title",
    "body",
  ],
  "result.select": [
    "type",
    "operationId",
    "taskId",
    "resultId",
    "expectedRevision",
    "selected",
  ],
  "result.authorize": [
    "type",
    "operationId",
    "taskId",
    "resultId",
    "materialDigest",
  ],
  "attachments.remove": ["type", "attachmentId"],
  "attachments.replace": ["type", "attachmentId"],
  "task.attachment.reselect": ["type", "taskId", "attachmentId"],
  "file-attention.select": ["type", "requestId", "taskId", "sessionId"],
  "file-attention.cancel": ["type", "requestId", "taskId", "sessionId"],
  "task.launch": ["type", "operationId", "input"],
  "task.message": [
    "type",
    "taskId",
    "operationId",
    "outcome",
    "attachmentIds",
    "selectedResultIds",
  ],
  "task.steer": [
    "type",
    "taskId",
    "operationId",
    "expectedTurnId",
    "outcome",
    "attachmentIds",
  ],
  "task.queue.add": [
    "type",
    "taskId",
    "operationId",
    "outcome",
    "attachmentIds",
    "selectedResultIds",
  ],
  "task.queue.edit": ["type", "taskId", "operationId", "entryId", "outcome"],
  "task.queue.remove": ["type", "taskId", "operationId", "entryId"],
  "task.queue.reorder": ["type", "taskId", "operationId", "entryIds"],
  "task.queue.steer": ["type", "taskId", "entryId", "expectedTurnId"],
  "task.stop": ["type", "taskId", "operationId"],
  "task.cleanup.retry": ["type", "taskId", "operationId"],
  "task.return-control": ["type", "taskId", "operationId"],
  "task.restore": ["type", "taskId", "operationId"],
  "task.archive": ["type", "taskId", "operationId"],
  "task.effects.acknowledge": ["type", "taskId"],
  "task.effects.authorize-repeat": ["type", "taskId", "effectId"],
  "task.recording.start": [
    "type",
    "taskId",
    "scope",
    "pageId",
    "confirmUnmaskedSensitiveContent",
  ],
  "task.recording.stop": ["type", "taskId", "recordingId"],
  "attention.decide": [
    "type",
    "taskId",
    "requestId",
    "generation",
    "decision",
    "answers",
    "form",
  ],
};
export function assertRendererProductIntent(
  intent: unknown,
): asserts intent is RendererProductIntent {
  const value = record(intent);
  if (!value || typeof value.type !== "string")
    throw new Error("Invalid renderer product intent.");
  const shape =
    RENDERER_PRODUCT_INTENT_SHAPES[value.type as RendererProductIntent["type"]];
  if (shape === undefined)
    throw new Error("Unsupported renderer product intent.");
  exactCommand(value, shape);
}
function safeText(value: unknown, maximum = 500): string | undefined {
  const text = boundedText(value, maximum);
  if (text === undefined) return undefined;
  return text
    .replace(
      /\b(token|password|cookie|authorization|secret)=([^\s&]+)/gi,
      "$1=[redacted]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
}
function exactBoundedText(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum
    ? value
    : undefined;
}
function exactBoundedString(
  value: unknown,
  maximum: number,
): string | undefined {
  return typeof value === "string" && value.length <= maximum
    ? value
    : undefined;
}
function validCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}
function validRfc3339DateTime(value: string): boolean {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match || !validCalendarDate(match[1]!)) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  const offsetHour = match[6] === undefined ? 0 : Number(match[6]);
  const offsetMinute = match[7] === undefined ? 0 : Number(match[7]);
  return (
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    !Number.isNaN(Date.parse(value))
  );
}
function assertFieldValue(
  field: ProductElicitationField,
  value: string | number | boolean | readonly string[],
  prefix = `Field ${field.id}`,
): void {
  if (field.type === "boolean") {
    if (typeof value !== "boolean")
      throw new Error(`${prefix} has an invalid default.`);
    return;
  }
  if (field.type === "number" || field.type === "integer") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (field.type === "integer" && !Number.isInteger(value)) ||
      (field.minimum !== undefined && value < field.minimum) ||
      (field.maximum !== undefined && value > field.maximum)
    )
      throw new Error(`${prefix} has an invalid default.`);
    return;
  }
  if (field.type === "multi_select") {
    if (
      !Array.isArray(value) ||
      (field.minItems !== undefined && value.length < field.minItems) ||
      (field.maxItems !== undefined && value.length > field.maxItems) ||
      new Set(value).size !== value.length ||
      value.some(
        (entry) =>
          typeof entry !== "string" ||
          !field.options?.some((option) => option.value === entry),
      )
    )
      throw new Error(`${prefix} has an invalid default.`);
    return;
  }
  if (typeof value !== "string")
    throw new Error(`${prefix} has an invalid default.`);
  const length = Array.from(value).length;
  if (
    (field.minLength !== undefined && length < field.minLength) ||
    length > (field.maxLength ?? 2_000) ||
    (field.type === "single_select" &&
      !field.options?.some((option) => option.value === value)) ||
    (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) ||
    (field.format === "uri" && !URL.canParse(value)) ||
    (field.format === "date" && !validCalendarDate(value)) ||
    (field.format === "date-time" && !validRfc3339DateTime(value))
  )
    throw new Error(`${prefix} has an invalid default.`);
}
function projectQuestions(
  value: unknown,
): ProductAttentionQuestion[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const questions = value.slice(0, 3).flatMap((raw) => {
    const item = record(raw);
    const id = exactBoundedText(item?.id, 120);
    const header = safeText(item?.header, 80);
    const question = safeText(item?.question, 500);
    if (!item || !id || !header || !question) return [];
    const options = Array.isArray(item.options)
      ? item.options.slice(0, 3).flatMap((rawOption) => {
          const option = record(rawOption);
          const label = exactBoundedText(option?.label, 160);
          const description = safeText(option?.description, 280);
          return label && description ? [{ label, description }] : [];
        })
      : null;
    return [
      {
        id,
        header,
        question,
        isOther: item.isOther === true,
        isSecret: item.isSecret === true,
        options,
      },
    ];
  });
  return questions.length === 0 ? undefined : questions;
}
function schemaOptions(
  schema: Record<string, unknown>,
): { value: string; label: string }[] | undefined {
  const optionKeys = ["enum", "oneOf", "anyOf"].filter(
    (key) => schema[key] !== undefined,
  );
  if (optionKeys.length > 1)
    throw new Error("This form combines unsupported option constraints.");
  if (schema.enumNames !== undefined && schema.enum === undefined)
    throw new Error("This form contains orphaned option labels.");
  if (schema.oneOf !== undefined && !Array.isArray(schema.oneOf))
    throw new Error("This form contains an invalid oneOf constraint.");
  if (schema.anyOf !== undefined && !Array.isArray(schema.anyOf))
    throw new Error("This form contains an invalid anyOf constraint.");
  if (schema.enum !== undefined && !Array.isArray(schema.enum))
    throw new Error("This form contains an invalid enum constraint.");
  const titledOptions = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : undefined;
  if (titledOptions) {
    if (titledOptions.length === 0)
      throw new Error("This form contains an empty titled option constraint.");
    if (titledOptions.length > 20)
      throw new Error("This form has more than 20 options.");
    const options = titledOptions.map((raw) => {
      const option = record(raw);
      if (option) exactCommand(option, ["const", "title"]);
      const value = exactBoundedString(option?.const, 2_000);
      const label = exactBoundedString(option?.title, 120);
      if (value === undefined || label === undefined)
        throw new Error("This form contains an invalid titled option.");
      return { value, label };
    });
    if (new Set(options.map((option) => option.value)).size !== options.length)
      throw new Error("This form contains duplicate options.");
    return options;
  }
  if (Array.isArray(schema.enum)) {
    if (schema.enum.length === 0)
      throw new Error("This form contains an empty enum constraint.");
    if (schema.enum.length > 20)
      throw new Error("This form has more than 20 options.");
    if (
      schema.enumNames !== undefined &&
      (!Array.isArray(schema.enumNames) ||
        schema.enumNames.length !== schema.enum.length ||
        schema.enumNames.some((entry) => typeof entry !== "string"))
    )
      throw new Error("This form contains invalid option labels.");
    const names = Array.isArray(schema.enumNames) ? schema.enumNames : [];
    const options = schema.enum.map((raw, index) => {
      const value = exactBoundedString(raw, 2_000);
      if (value === undefined)
        throw new Error("This form contains an invalid option.");
      const rawLabel = names[index];
      const label =
        rawLabel === undefined ? value : exactBoundedString(rawLabel, 120);
      if (label === undefined)
        throw new Error("This form contains an invalid option label.");
      return { value, label };
    });
    if (new Set(options.map((option) => option.value)).size !== options.length)
      throw new Error("This form contains duplicate options.");
    return options;
  }
  const items = record(schema.items);
  if (items) return schemaOptions(items);
  return undefined;
}
const FORM_TOP_LEVEL_KEYS = [
  "$schema",
  "type",
  "properties",
  "required",
] as const;
const FORM_FIELD_KEYS = [
  "type",
  "title",
  "description",
  "enum",
  "enumNames",
  "oneOf",
  "anyOf",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "format",
  "default",
  "items",
] as const;
function assertSupportedFieldSchema(
  id: string,
  schema: Record<string, unknown>,
): void {
  exactCommand(schema, FORM_FIELD_KEYS);
  const rawType = schema.type;
  const common = new Set(["type", "title", "description", "default"]);
  const allowed =
    rawType === "string"
      ? schema.enum !== undefined || schema.enumNames !== undefined
        ? new Set([...common, "enum", "enumNames"])
        : schema.oneOf !== undefined
          ? new Set([...common, "oneOf"])
          : new Set([...common, "minLength", "maxLength", "format"])
      : rawType === "number" || rawType === "integer"
        ? new Set([...common, "minimum", "maximum"])
        : rawType === "boolean"
          ? common
          : rawType === "array"
            ? new Set([...common, "items", "minItems", "maxItems"])
            : new Set<string>();
  const inapplicable = Object.keys(schema).find((key) => !allowed.has(key));
  if (inapplicable !== undefined)
    throw new Error(`Field ${id} uses unsupported constraint ${inapplicable}.`);
  if (rawType === "array") {
    const items = record(schema.items);
    if (!items) throw new Error(`Field ${id} has an unsupported array schema.`);
    if (items.anyOf !== undefined) {
      exactCommand(items, ["anyOf"]);
    } else {
      exactCommand(items, ["type", "enum"]);
    }
    if (items.anyOf === undefined && items.type !== "string")
      throw new Error(`Field ${id} has an unsupported array item type.`);
  }
}
function projectElicitation(
  payload: Record<string, unknown>,
): ProductElicitationProjection | undefined {
  if (payload.mode === "url") {
    const message = safeText(payload.message, 500);
    if (!message) return undefined;
    const serverName = safeText(payload.serverName, 120);
    return {
      mode: "url",
      message,
      ...(serverName === undefined ? {} : { serverName }),
    };
  }
  if (!["form", "openai/form", "openaiForm"].includes(String(payload.mode)))
    return undefined;
  const requested = record(payload.requestedSchema);
  const properties = record(requested?.properties);
  const message = safeText(payload.message, 500);
  if (!message) return undefined;
  const serverName = safeText(payload.serverName, 120);
  const unsupported = (reason: string): ProductElicitationProjection => ({
    mode: "form",
    message,
    ...(serverName === undefined ? {} : { serverName }),
    fields: [],
    unsupportedReason: safeText(reason, 280) ?? "This form is unsupported.",
  });
  if (!requested || !properties || requested.type !== "object")
    return unsupported("This form has no supported object schema.");
  try {
    exactCommand(requested, FORM_TOP_LEVEL_KEYS);
  } catch (error) {
    return unsupported(
      error instanceof Error ? error.message : "This form is unsupported.",
    );
  }
  if (
    requested.$schema !== undefined &&
    exactBoundedString(requested.$schema, 2_000) === undefined
  )
    return unsupported("This form has invalid schema metadata.");
  if (Object.keys(properties).length > 16)
    return unsupported("This form has more than 16 fields.");
  if (requested.required !== undefined && !Array.isArray(requested.required))
    return unsupported("This form has an invalid required-field list.");
  const requiredEntries = Array.isArray(requested.required)
    ? requested.required
    : [];
  const required = new Set(
    requiredEntries.filter(
      (entry): entry is string => typeof entry === "string",
    ),
  );
  if (
    requiredEntries.some((entry) => typeof entry !== "string") ||
    required.size !== requiredEntries.length ||
    [...required].some((id) => !(id in properties))
  )
    return unsupported("This form has an invalid required-field list.");
  let fields: ProductElicitationField[];
  try {
    fields = Object.entries(properties).map(([id, raw]) => {
      if (id.length === 0 || id.length > 120)
        throw new Error("This form contains an invalid field identity.");
      const schema = record(raw);
      if (!schema) throw new Error("This form contains an invalid field.");
      assertSupportedFieldSchema(id, schema);
      const options = schemaOptions(schema);
      const rawType = schema.type;
      if (
        !["string", "number", "integer", "boolean", "array"].includes(
          String(rawType),
        )
      )
        throw new Error(`Field ${id} has an unsupported type.`);
      if (rawType === "array" && !options)
        throw new Error(`Field ${id} has an unsupported array schema.`);
      const type: ProductElicitationField["type"] =
        rawType === "boolean"
          ? "boolean"
          : rawType === "number" || rawType === "integer"
            ? rawType
            : rawType === "array" && options
              ? "multi_select"
              : options
                ? "single_select"
                : "string";
      const description = exactBoundedString(schema.description, 280);
      if (schema.description !== undefined && description === undefined)
        throw new Error(`Field ${id} has an invalid description.`);
      const title = exactBoundedString(schema.title, 120);
      if (schema.title !== undefined && title === undefined)
        throw new Error(`Field ${id} has an invalid title.`);
      const field: ProductElicitationField = {
        id,
        title: title ?? id,
        required: required.has(id),
        type,
        ...(description === undefined ? {} : { description }),
        ...(options === undefined ? {} : { options }),
      };
      for (const name of ["minimum", "maximum"] as const)
        if (schema[name] !== undefined) {
          if (
            typeof schema[name] !== "number" ||
            !Number.isFinite(schema[name])
          )
            throw new Error(`Field ${id} has an invalid ${name}.`);
          field[name] = Number(schema[name]);
        }
      for (const name of ["minLength", "maxLength"] as const)
        if (schema[name] !== undefined) {
          if (!Number.isInteger(schema[name]) || Number(schema[name]) < 0)
            throw new Error(`Field ${id} has an invalid ${name}.`);
          field[name] = Number(schema[name]);
        }
      for (const name of ["minItems", "maxItems"] as const)
        if (schema[name] !== undefined) {
          if (!Number.isInteger(schema[name]) || Number(schema[name]) < 0)
            throw new Error(`Field ${id} has an invalid ${name}.`);
          field[name] = Number(schema[name]);
        }
      if (schema.format !== undefined) {
        if (
          !["email", "uri", "date", "date-time"].includes(String(schema.format))
        )
          throw new Error(`Field ${id} has an unsupported format.`);
        field.format = schema.format as NonNullable<
          ProductElicitationField["format"]
        >;
      }
      if (
        (field.minimum !== undefined &&
          field.maximum !== undefined &&
          field.minimum > field.maximum) ||
        (field.minLength !== undefined &&
          field.maxLength !== undefined &&
          field.minLength > field.maxLength) ||
        (field.minItems !== undefined &&
          field.maxItems !== undefined &&
          field.minItems > field.maxItems)
      )
        throw new Error(`Field ${id} has contradictory constraints.`);
      if (schema.default !== undefined) {
        const value = schema.default;
        const valid =
          (type === "boolean" && typeof value === "boolean") ||
          ((type === "number" || type === "integer") &&
            typeof value === "number" &&
            Number.isFinite(value)) ||
          ((type === "string" || type === "single_select") &&
            typeof value === "string") ||
          (type === "multi_select" &&
            Array.isArray(value) &&
            value.every((entry) => typeof entry === "string"));
        if (!valid) throw new Error(`Field ${id} has an invalid default.`);
        field.default = value as NonNullable<
          ProductElicitationField["default"]
        >;
        assertFieldValue(field, field.default);
      }
      return field;
    });
  } catch (error) {
    return unsupported(
      error instanceof Error ? error.message : "This form is unsupported.",
    );
  }
  return {
    mode: "form",
    message,
    ...(serverName === undefined ? {} : { serverName }),
    fields,
  };
}
function attentionTitle(kind: AttentionKind): string {
  return {
    command_approval: "Command approval",
    file_approval: "File change approval",
    network_approval: "Network approval",
    permission_approval: "Permission request",
    mcp_elicitation: "Tool needs information",
    user_input: "Codex needs your input",
    control_handoff: "Browser control handoff",
  }[kind];
}
function supportedAttentionDecisions(
  entry: Pick<AttentionRequest, "kind" | "payload" | "method">,
): readonly ("accept" | "decline" | "cancel")[] {
  if (entry.kind === "user_input") return ["accept"];
  if (entry.kind === "mcp_elicitation")
    return ["accept", "decline", "cancel"];
  if (entry.kind === "command_approval") {
    const available = Array.isArray(entry.payload.availableDecisions)
      ? entry.payload.availableDecisions
      : undefined;
    if (available)
      return ["accept", "decline"].filter((decision) =>
        available.includes(decision),
      ) as ("accept" | "decline")[];
  }
  return ["accept", "decline"];
}
function projectAttention(entry: AttentionRequest): ProductAttentionProjection {
  const context: { label: string; value: string }[] = [];
  const pushContext = (label: string, value: unknown, maximum = 500) => {
    const projected = safeText(value, maximum);
    if (projected) context.push({ label, value: projected });
  };
  if (entry.kind === "command_approval") {
    pushContext("Command", entry.payload.command, 800);
    pushContext("Reason", entry.payload.reason);
  } else if (entry.kind === "network_approval") {
    const network = record(entry.payload.networkApprovalContext);
    pushContext("Host", network?.host, 253);
    pushContext("Protocol", network?.protocol, 40);
    pushContext("Reason", entry.payload.reason);
  } else if (entry.kind === "file_approval") {
    pushContext("Reason", entry.payload.reason);
    context.push({ label: "Scope", value: "Proposed file changes" });
  } else if (entry.kind === "permission_approval") {
    const permissions = record(entry.payload.permissions);
    if (permissions?.network !== null && permissions?.network !== undefined)
      context.push({ label: "Permission", value: "Additional network access" });
    if (
      permissions?.fileSystem !== null &&
      permissions?.fileSystem !== undefined
    )
      context.push({
        label: "Permission",
        value: "Additional filesystem access",
      });
    pushContext("Reason", entry.payload.reason);
  }
  const questions =
    entry.kind === "user_input"
      ? projectQuestions(entry.payload.questions)
      : undefined;
  const elicitation =
    entry.kind === "mcp_elicitation"
      ? projectElicitation(entry.payload)
      : undefined;
  return {
    authority: entry.authority,
    kind: entry.kind,
    requestId: entry.requestId,
    taskId: entry.taskId,
    ...(entry.threadId === undefined ? {} : { threadId: entry.threadId }),
    ...(entry.turnId === undefined ? {} : { turnId: entry.turnId }),
    ...(entry.itemId === undefined ? {} : { itemId: entry.itemId }),
    generation: entry.generation,
    status: entry.status,
    sequence: entry.sequence,
    title: attentionTitle(entry.kind),
    allowedDecisions: supportedAttentionDecisions(entry),
    ...(context.length === 0 ? {} : { context: context.slice(0, 8) }),
    ...(questions === undefined ? {} : { questions }),
    ...(elicitation === undefined ? {} : { elicitation }),
    ...(entry.authority === "rove_control" &&
    (entry.payload.policy === "resume_after_control_return" ||
      entry.payload.policy === "explicit_user_response")
      ? { continuationPolicy: entry.payload.policy }
      : {}),
    ...(() => {
      const instruction =
        safeText(entry.payload.instruction) ??
        safeText(entry.payload.reason) ??
        safeText(entry.payload.prompt) ??
        safeText(entry.payload.message);
      return instruction === undefined ? {} : { instruction };
    })(),
  };
}
function projectConversation(
  conversation: NonNullable<ProductTaskSnapshot["conversation"]>,
): ProductConversationProjection {
  const items = Object.fromEntries(
    Object.entries(conversation.items)
      .slice(-128)
      .map(([id, item]) => [
        id,
        {
          id: item.id,
          ...(item.turnId === undefined ? {} : { turnId: item.turnId }),
          kind: item.kind,
          status: item.status,
          ...(item.phase === undefined ? {} : { phase: item.phase }),
          ...(item.startedAt === undefined
            ? {}
            : { startedAt: item.startedAt }),
          ...(item.completedAt === undefined
            ? {}
            : { completedAt: item.completedAt }),
          ...(item.clientId === undefined ? {} : { clientId: item.clientId }),
          ...(item.acceptedAt === undefined
            ? {}
            : { acceptedAt: item.acceptedAt }),
          ...(item.providerItemId === undefined
            ? {}
            : { providerItemId: item.providerItemId }),
          ...(item.deliveryState === undefined
            ? {}
            : { deliveryState: item.deliveryState }),
          ...(item.attachments?.length
            ? {
                attachments: item.attachments
                  .slice(0, 100)
                  .map((attachment) => ({
                    filename: attachment.filename.slice(0, 255),
                    kind: attachment.kind,
                  })),
              }
            : {}),
          ...(item.authoredBy === undefined
            ? {}
            : { authoredBy: item.authoredBy }),
          ...(safeText(
            item.text,
            item.kind === "user_message" ? 16_000 : 2_000,
          ) === undefined
            ? {}
            : {
                text: safeText(
                  item.text,
                  item.kind === "user_message" ? 16_000 : 2_000,
                ),
              }),
          ...(safeText(item.title, 500) === undefined
            ? {}
            : { title: safeText(item.title, 500) }),
          ...(safeText(item.progress, 500) === undefined
            ? {}
            : { progress: safeText(item.progress, 500) }),
        },
      ]),
  ) as Record<string, ProjectedConversationItem>;
  const explicitSummary = safeText(conversation.explicitSummary, 2_000);
  return {
    ...(conversation.activeTurnId === undefined
      ? {}
      : { activeTurnId: conversation.activeTurnId }),
    turnStatus: conversation.turnStatus,
    ...(explicitSummary === undefined ? {} : { explicitSummary }),
    archived: conversation.archived,
    items,
    ...(conversation.itemOrder === undefined
      ? {}
      : { itemOrder: conversation.itemOrder.slice(-128) }),
    turnOrder: conversation.turnOrder.slice(-64),
  };
}

function conversationAttachmentMetadata(
  attachments: readonly TaskAttachmentDescriptor[],
  attachmentIds: readonly string[],
): ProjectedConversationItem["attachments"] {
  const byId = new Map(
    attachments.map((attachment) => [attachment.id, attachment]),
  );
  return attachmentIds.map((id) => {
    const attachment = byId.get(id);
    if (!attachment)
      throw new Error("Task attachment metadata is unavailable.");
    const mimeType = attachment.mimeType ?? "";
    return {
      filename: attachment.filename,
      kind: mimeType.startsWith("image/")
        ? ("image" as const)
        : mimeType.startsWith("audio/")
          ? ("audio" as const)
          : ("file" as const),
    };
  });
}
function projectTask(
  task: ProductTaskSnapshot,
  attachments: readonly TaskAttachmentDescriptor[] = [],
  results: readonly TaskResult[] = [],
): ProductTaskProjection {
  const { context } = task;
  return {
    taskId: context.roveTaskId,
    executionMode: context.executionMode,
    ...(context.browserIdentity
      ? {
          browserIdentity:
            context.browserIdentity.mode === "temporary"
              ? ({ mode: "temporary" } as const)
              : {
                  mode: "workspace" as const,
                  workspaceId: context.browserIdentity.workspaceId,
                },
        }
      : {}),
    selectionSource: context.selectionSource,
    selectedAt: context.selectedAt.slice(0, 40),
    bootstrapStage: context.bootstrap.stage,
    ...(context.workflowContext
      ? { workflowContext: structuredClone(context.workflowContext) }
      : {}),
    ...(context.workflowAssociation
      ? { workflowAssociation: structuredClone(context.workflowAssociation) }
      : {}),
    ...(context.initialLaunch === undefined
      ? {}
      : {
          initialLaunch: {
            operationId: context.initialLaunch.operationId,
            inputDigest: context.initialLaunch.inputDigest,
            stage: context.initialLaunch.stage,
            ...(context.initialLaunch.turnId === undefined
              ? {}
              : { turnId: context.initialLaunch.turnId }),
          },
        }),
    ...(context.roveSessionId === undefined
      ? {}
      : { roveSessionId: context.roveSessionId }),
    ...(context.codexThreadId === undefined
      ? {}
      : { codexThreadId: context.codexThreadId }),
    ...(context.policy.model === undefined
      ? {}
      : { model: context.policy.model }),
    ...(context.policy.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: context.policy.reasoningEffort.slice(0, 40) }),
    approvalsReviewer: context.policy.approvalsReviewer,
    results: results.map((result) => structuredClone(result)),
    ...(task.conversation === undefined
      ? {}
      : { conversation: projectConversation(task.conversation) }),
    lifecycle: task.lifecycle ?? {
      phase: "cleanup_required",
      reason: "Lifecycle projection is unavailable.",
    },
    availableActions: [...(task.availableActions ?? [])],
    capabilities: structuredClone(task.capabilities),
    ...(task.customerExecution === undefined
      ? {}
      : { customerExecution: structuredClone(task.customerExecution) }),
    attachments,
    ...(task.runtime === undefined ? {} : { runtime: task.runtime }),
    ...(context.lifecycle?.closeOperation === undefined
      ? {}
      : {
          operation: {
            type: "finish",
            operationId: context.lifecycle.closeOperation.operationId,
            status:
              context.lifecycle.closeOperation.stage === "complete"
                ? ("accepted" as const)
                : ("deferred-for-convergence" as const),
            reason:
              context.lifecycle.lastConvergence?.reason ??
              "Task cleanup is converging.",
          },
        }),
  };
}
function hostProjection(health: CodexHostHealth): ProductHostProjection {
  return {
    state: health.state,
    ready: health.ready,
    restartAttempt: health.restartAttempt,
    ...(health.lastError === undefined
      ? {}
      : { error: health.lastError.slice(0, 500) }),
    ...(health.executable === undefined
      ? {}
      : {
          compatibility: {
            version: health.executable.baseline.cliVersion.slice(0, 80),
            platform: health.executable.baseline.platformOs.slice(0, 80),
            architecture: health.executable.baseline.architecture.slice(0, 80),
            source: health.executable.source,
          },
        }),
  };
}
function answerMap(
  entry: AttentionRequest,
  input: Record<string, readonly string[]> | undefined,
): Record<string, { answers: string[] }> {
  const questions = projectQuestions(entry.payload.questions) ?? [];
  if (questions.length === 0)
    throw new Error("Request has no answerable questions.");
  const supplied = input ?? {};
  if (
    Object.keys(supplied).some(
      (id) => !questions.some((item) => item.id === id),
    )
  )
    throw new Error("Answer contains an unknown question identity.");
  return Object.fromEntries(
    questions.map((question) => {
      const answers = supplied[question.id];
      if (!Array.isArray(answers) || answers.length === 0 || answers.length > 8)
        throw new Error(`Question ${question.id} requires an answer.`);
      const values = answers.map((value) =>
        nonempty(value, "question answer").slice(0, 2_000),
      );
      if (
        question.options &&
        !question.isOther &&
        values.some(
          (value) =>
            !question.options!.some((option) => option.label === value),
        )
      )
        throw new Error(
          `Question ${question.id} contains an unavailable option.`,
        );
      return [question.id, { answers: values }];
    }),
  );
}
function formContent(
  entry: AttentionRequest,
  input:
    Record<string, string | number | boolean | readonly string[]> | undefined,
): Record<string, string | number | boolean | string[]> {
  const projection = projectElicitation(entry.payload);
  if (!projection || projection.unsupportedReason)
    throw new Error(
      projection?.unsupportedReason ?? "This form cannot be submitted.",
    );
  const fields = projection.fields ?? [];
  const supplied = input ?? {};
  if (
    Object.keys(supplied).some((id) => !fields.some((field) => field.id === id))
  )
    throw new Error("Form contains an unknown field identity.");
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const field of fields) {
    const value = supplied[field.id] ?? field.default;
    if (value === undefined) {
      if (field.required)
        throw new Error(`Form field ${field.id} is required.`);
      continue;
    }
    if (field.type === "boolean") {
      if (typeof value !== "boolean")
        throw new Error(`Form field ${field.id} must be boolean.`);
      content[field.id] = value;
    } else if (field.type === "number" || field.type === "integer") {
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`Form field ${field.id} must be numeric.`);
      if (field.type === "integer" && !Number.isInteger(value))
        throw new Error(`Form field ${field.id} must be an integer.`);
      if (field.minimum !== undefined && value < field.minimum)
        throw new Error(`Form field ${field.id} is below its minimum.`);
      if (field.maximum !== undefined && value > field.maximum)
        throw new Error(`Form field ${field.id} is above its maximum.`);
      content[field.id] = value;
    } else if (field.type === "multi_select") {
      if (!Array.isArray(value))
        throw new Error(`Form field ${field.id} must be a bounded selection.`);
      const values = value.map((item) => {
        const projected = exactBoundedString(item, 2_000);
        if (projected === undefined)
          throw new Error(`Form field ${field.id} has an invalid selection.`);
        return projected;
      });
      if (field.minItems !== undefined && values.length < field.minItems)
        throw new Error(`Form field ${field.id} has too few selections.`);
      if (field.maxItems !== undefined && values.length > field.maxItems)
        throw new Error(`Form field ${field.id} has too many selections.`);
      if (new Set(values).size !== values.length)
        throw new Error(`Form field ${field.id} has duplicate selections.`);
      if (
        values.some(
          (item) => !field.options?.some((option) => option.value === item),
        )
      )
        throw new Error(
          `Form field ${field.id} contains an unavailable option.`,
        );
      content[field.id] = values;
    } else {
      if (typeof value !== "string")
        throw new Error(`Form field ${field.id} must be text.`);
      const length = Array.from(value).length;
      if (length > (field.maxLength ?? 2_000))
        throw new Error(`Form field ${field.id} exceeds its maximum length.`);
      if (field.minLength !== undefined && length < field.minLength)
        throw new Error(`Form field ${field.id} is below its minimum length.`);
      if (
        field.type === "single_select" &&
        !field.options?.some((option) => option.value === value)
      )
        throw new Error(
          `Form field ${field.id} contains an unavailable option.`,
        );
      if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        throw new Error(`Form field ${field.id} must be an email address.`);
      if (field.format === "uri") {
        try {
          new URL(value);
        } catch {
          throw new Error(`Form field ${field.id} must be a URI.`);
        }
      }
      if (field.format === "date" && !validCalendarDate(value))
        throw new Error(`Form field ${field.id} must be a date.`);
      if (field.format === "date-time" && !validRfc3339DateTime(value))
        throw new Error(`Form field ${field.id} must be a date-time.`);
      content[field.id] = value;
    }
  }
  return content;
}

/** Trusted host product service. Renderer writes enter only through executeRendererIntent. */
export class LocalProductApi {
  private currentTaskId: string | undefined;
  private readonly recordingWarnings = new Set<string>();
  private readonly health: () => CodexHostHealth;
  private readonly account: CodexAccountCatalogPort;
  private readonly tasks: ProductTaskPort;
  private readonly attention: ProductAttentionPort;
  private readonly taskCwd: string;
  private readonly recoveryWarnings: () => readonly string[];
  private readonly attachments: TaskAttachmentAuthority | undefined;
  private readonly attachmentRuntime: AttachmentRuntimeMaterializer | undefined;
  private readonly workflows: WorkflowStore | undefined;
  private readonly results: ResultStore | undefined;
  private readonly recordingRuntime:
    | {
        startRecording(
          sessionId: string | undefined,
          request: StartRecordingRequest,
        ): Promise<Recording>;
        stopRecording(
          sessionId: string,
          recordingId: string,
        ): Promise<Recording>;
        listRecordings(sessionId: string): Promise<Recording[]>;
      }
    | undefined;
  private readonly legacyEffects:
    | {
        acknowledgeLegacyEffectScope(sessionId: string): Promise<void>;
        authorizeEffectRepetition?(
          sessionId: string,
          effectId: string,
        ): Promise<object>;
        consequentialEffect?(
          sessionId: string,
          consequenceKey: string,
        ): Promise<{
          effectId: string;
          state:
            | "planned"
            | "authorized"
            | "prepared"
            | "applied"
            | "not_applied"
            | "unresolved";
          consequenceKey: string;
          observationId?: string;
          evidenceId?: string;
          taskResultPlan?: TaskResultActionPlan;
        } | null>;
        authorizeTaskResultAction?(
          sessionId: string,
          consequenceKey: string,
          materialDigest: string,
          planId: string,
        ): Promise<object>;
      }
    | undefined;
  constructor(
    health: () => CodexHostHealth,
    account: CodexAccountCatalogPort,
    tasks: ProductTaskPort | object,
    _broker: object,
    attention: ProductAttentionPort,
    taskCwd: string = process.cwd(),
    recoveryWarnings: () => readonly string[] = () => [],
    attachments?: TaskAttachmentAuthority,
    attachmentRuntime?: AttachmentRuntimeMaterializer,
    legacyEffects?: {
      acknowledgeLegacyEffectScope(sessionId: string): Promise<void>;
      authorizeEffectRepetition?(
        sessionId: string,
        effectId: string,
      ): Promise<object>;
      consequentialEffect?(
        sessionId: string,
        consequenceKey: string,
      ): Promise<{
        effectId: string;
        state:
          | "planned"
          | "authorized"
          | "prepared"
          | "applied"
          | "not_applied"
          | "unresolved";
        consequenceKey: string;
        observationId?: string;
        evidenceId?: string;
        taskResultPlan?: TaskResultActionPlan;
      } | null>;
      authorizeTaskResultAction?(
        sessionId: string,
        consequenceKey: string,
        materialDigest: string,
        planId: string,
      ): Promise<object>;
    },
    workflows?: WorkflowStore,
    results?: ResultStore,
    recordingRuntime?: {
      startRecording(
        sessionId: string | undefined,
        request: StartRecordingRequest,
      ): Promise<Recording>;
      stopRecording(sessionId: string, recordingId: string): Promise<Recording>;
      listRecordings(sessionId: string): Promise<Recording[]>;
    },
  ) {
    this.health = health;
    this.account = account;
    this.tasks = tasks as ProductTaskPort;
    this.attention = attention;
    this.taskCwd = taskCwd;
    this.recoveryWarnings = recoveryWarnings;
    this.attachments = attachments;
    this.attachmentRuntime = attachmentRuntime;
    this.legacyEffects = legacyEffects;
    this.workflows = workflows;
    this.results = results;
    this.recordingRuntime = recordingRuntime;
  }
  private taskResultPlanMatches(
    result: TaskResult,
    plan: TaskResultActionPlan,
  ): boolean {
    const material = result.actionMaterial;
    if (
      result.kind !== "action" ||
      !material ||
      plan.consequenceKey !== taskResultConsequenceKey(result) ||
      plan.materialDigest !== result.materialDigest
    )
      return false;
    const fields = new Map(plan.fields.map((field) => [field.field, field]));
    if (
      fields.get("content")?.value !== material.content ||
      material.contentControl === undefined ||
      fields.get("content")?.targetName !== material.contentControl
    )
      return false;
    if (
      material.recipient === undefined
        ? fields.has("recipient")
        : fields.get("recipient")?.value !== material.recipient ||
          material.recipientControl === undefined ||
          fields.get("recipient")?.targetName !== material.recipientControl
    )
      return false;
    const attachments = this.attachments?.listForTask?.(result.taskId) ?? [];
    const expectedFiles = material.attachmentIds.map((attachmentId) =>
      attachments.find((attachment) => attachment.id === attachmentId),
    );
    if (
      expectedFiles.some(
        (attachment) =>
          !attachment?.evidenceId ||
          attachment.status !== "bound" ||
          !attachment.sha256,
      ) ||
      plan.attachments.length !== expectedFiles.length ||
      plan.attachments.some((attachment) =>
        expectedFiles.every(
          (expected) =>
            expected?.evidenceId !== attachment.evidenceId ||
            expected.filename !== attachment.filename ||
            expected.size !== attachment.size ||
            expected.sha256 !== attachment.sha256,
        ),
      )
    )
      return false;
    if (
      expectedFiles.length > 0 &&
      (material.attachmentControl === undefined ||
        plan.attachments.some(
          (attachment) => attachment.targetName !== material.attachmentControl,
        ))
    )
      return false;
    if (
      plan.commitTarget &&
      (material.commitControl === undefined ||
        plan.commitTarget.targetName !== material.commitControl)
    )
      return false;
    if (
      material.target !== undefined &&
      plan.commitTarget?.targetName !== material.target &&
      plan.url !== material.target
    )
      return false;
    if (
      material.scope !== undefined &&
      !plan.commitTarget?.scopeLabels.includes(material.scope) &&
      plan.url !== material.scope
    )
      return false;
    return true;
  }
  private async reconcileActionResults(
    tasks: readonly ProductTaskSnapshot[],
  ): Promise<void> {
    if (!this.results || !this.legacyEffects?.consequentialEffect) return;
    for (const task of tasks) {
      const sessionId = task.context.roveSessionId;
      if (!sessionId) continue;
      for (const candidate of this.results.listResults(
        task.context.roveTaskId,
      )) {
        if (
          candidate.kind !== "action" ||
          !["authorized", "dispatched", "unresolved"].includes(
            candidate.lifecycle,
          )
        )
          continue;
        let effect;
        try {
          effect = await this.legacyEffects.consequentialEffect(
            sessionId,
            taskResultConsequenceKey(candidate),
          );
        } catch {
          continue;
        }
        if (!effect || effect.state === "authorized") continue;
        if (effect.state === "planned") {
          if (
            candidate.lifecycle === "authorized" &&
            effect.taskResultPlan &&
            this.taskResultPlanMatches(candidate, effect.taskResultPlan) &&
            this.legacyEffects.authorizeTaskResultAction
          )
            try {
              await this.legacyEffects.authorizeTaskResultAction(
                sessionId,
                taskResultConsequenceKey(candidate),
                candidate.materialDigest!,
                effect.taskResultPlan.planId,
              );
            } catch {
              // A later snapshot retries exact plan activation. The result
              // remains authorized locally and no dispatch has occurred.
            }
          continue;
        }
        const evidenceIds = [
          effect.effectId,
          ...(effect.observationId ? [effect.observationId] : []),
          ...(effect.evidenceId ? [effect.evidenceId] : []),
        ];
        let current = candidate;
        const transition = (
          lifecycle: "dispatched" | "confirmed" | "failed" | "unresolved",
        ) => {
          current = this.results!.transitionAction({
            operationId: `result-effect:${effect.effectId}:${lifecycle}`,
            taskId: current.taskId,
            resultId: current.resultId,
            expectedLifecycle: current.lifecycle,
            lifecycle,
            evidenceIds,
          });
        };
        if (effect.state === "applied") {
          if (current.lifecycle === "authorized") transition("dispatched");
          if (
            current.lifecycle === "dispatched" ||
            current.lifecycle === "unresolved"
          )
            transition("confirmed");
        } else if (effect.state === "not_applied") {
          transition("failed");
        } else if (
          (effect.state === "prepared" || effect.state === "unresolved") &&
          current.lifecycle !== "unresolved"
        ) {
          transition("unresolved");
        }
      }
    }
  }
  snapshot(): LocalProductSnapshot {
    return {
      version: LOCAL_PRODUCT_API_VERSION,
      host: hostProjection(this.health()),
      catalog: this.account.snapshot(),
      attention: this.attention.list().slice(-256).map(projectAttention),
      tasks: [],
      workflows: this.workflows?.listWorkflows({ includeArchived: true }) ?? [],
      recoveryWarnings: [...this.recoveryWarnings()]
        .concat([...this.recordingWarnings])
        .slice(-64)
        .map((value) => value.slice(0, 500)),
      draftAttachments: this.attachments?.listDrafts() ?? [],
      fileAttention: this.attachments?.listAttention() ?? [],
    };
  }
  async readSnapshot(): Promise<LocalProductSnapshot> {
    await this.attention.refresh?.();
    const projectedAttention = this.attention
      .list()
      .slice(-256)
      .map(projectAttention);
    const productTasks = await this.tasks.productTasks();
    await this.reconcileActionResults(productTasks);
    const tasks = await Promise.all(
      productTasks.slice(-256).map(async (task) => {
        const taskId = task.context.roveTaskId;
        const sessionId = task.context.roveSessionId;
        let recordings: Recording[] = [];
        if (sessionId && this.recordingRuntime)
          try {
            recordings = (
              await this.recordingRuntime.listRecordings(sessionId)
            ).filter(
              (recording) =>
                recording.taskId === taskId &&
                recording.sessionId === sessionId,
            );
            this.recordingWarnings.delete(
              `Recording state is unavailable for task ${taskId}.`,
            );
          } catch {
            recordings = [];
            this.recordingWarnings.add(
              `Recording state is unavailable for task ${taskId}.`,
            );
          }
        return {
          ...projectTask(
            task,
            this.attachments?.listForTask?.(taskId) ?? [],
            this.results?.listResults(taskId) ?? [],
          ),
          recordings,
        };
      }),
    );
    for (const task of tasks) {
      task.customerCollaboration = customerTaskCollaboration(
        task,
        projectedAttention,
      );
      const latestInputId =
        task.customerExecution?.segments.at(-1)?.inputItemId;
      task.customerPresentation = customerTaskPresentation({
        execution: task.customerExecution ?? {
          state: "idle",
          queue: [],
          segments: [],
        },
        collaboration: task.customerCollaboration,
        ...(task.capabilities ? { capabilities: task.capabilities } : {}),
        ...(latestInputId &&
        task.conversation?.items[latestInputId]?.deliveryState
          ? {
              latestDelivery:
                task.conversation.items[latestInputId]!.deliveryState!,
            }
          : {}),
        consequentialOutcomeUnclear: task.results.some(
          (result) => result.lifecycle === "unresolved",
        ),
        recordings: task.recordings,
      });
    }
    const current = tasks.find((task) => task.taskId === this.currentTaskId);
    const blockers = [...tasks]
      .reverse()
      .filter(
        (task) =>
          task.conversation?.archived !== true &&
          !["closed", "failed"].includes(task.lifecycle.phase),
      );
    if (
      current === undefined ||
      current.conversation?.archived === true ||
      ["closed", "failed"].includes(current.lifecycle.phase)
    )
      this.currentTaskId = blockers[0]?.taskId;
    return {
      ...this.snapshot(),
      tasks,
      workflows: this.workflows?.listWorkflows({ includeArchived: true }) ?? [],
      attention: projectedAttention,
      ...(this.currentTaskId === undefined
        ? {}
        : { currentTaskId: this.currentTaskId }),
    };
  }
  async prepareReturnControl(sessionId: string): Promise<string> {
    return this.tasks.taskIdForRuntimeSession(
      nonempty(sessionId, "Runtime session id"),
    );
  }
  async recordingForOpen(
    taskId: string,
    recordingId: string,
  ): Promise<Recording> {
    if (!this.recordingRuntime) throw new Error("Recording is unavailable.");
    const task = await this.tasks.readTask(nonempty(taskId, "task id"));
    const sessionId = nonempty(
      task?.context.roveSessionId,
      "Runtime session id",
    );
    const recording = (
      await this.recordingRuntime.listRecordings(sessionId)
    ).find(
      (candidate) =>
        candidate.id === recordingId && candidate.taskId === taskId,
    );
    if (
      !recording ||
      recording.state !== "available" ||
      !recording.artifact?.playable ||
      recording.artifact.partial
    )
      throw new Error("A playable recording was not found for this task.");
    return recording;
  }
  async completeReturnControl(sessionId: string) {
    const taskId = await this.tasks.taskIdForRuntimeSession(
      nonempty(sessionId, "Runtime session id"),
    );
    this.requireAccepted(
      await this.tasks.submit({
        type: "return_control",
        taskId,
        operationId: `intent_${crypto.randomUUID()}`,
      }),
    );
    return "dispatched";
  }
  private requireAccepted(acceptance: TaskAcceptance): TaskAcceptance {
    const disposition = acceptance.projection.operationDisposition;
    if (disposition?.status === "rejected") throw new Error(disposition.reason);
    return acceptance;
  }
  async resolveTrustedExternalUrl(
    intent: TrustedExternalIntent,
  ): Promise<string> {
    const value = record(intent);
    if (!value) throw new Error("Invalid trusted external intent.");
    if (value.purpose === "account_login") {
      exactCommand(value, ["purpose", "loginId"]);
      return this.account.trustedLoginUrl(nonempty(value.loginId, "login id"));
    }
    if (value.purpose !== "mcp_elicitation")
      throw new Error("Unknown trusted external purpose.");
    exactCommand(value, ["purpose", "taskId", "requestId", "generation"]);
    const requestId = nonempty(value.requestId, "request id");
    const taskId = nonempty(value.taskId, "task id");
    if (!Number.isInteger(value.generation) || Number(value.generation) < 0)
      throw new Error("Invalid request generation.");
    const entry = this.attention
      .list()
      .find(
        (candidate) =>
          candidate.authority === "codex" &&
          candidate.taskId === taskId &&
          candidate.requestId === requestId &&
          candidate.generation === Number(value.generation),
      );
    if (entry === undefined)
      throw new Error("Stale or mismatched attention response.");
    if (
      entry.status !== "pending" ||
      entry.kind !== "mcp_elicitation" ||
      entry.payload.mode !== "url"
    )
      throw new Error("MCP URL elicitation is no longer active.");
    return nonempty(entry.payload.url, "MCP elicitation URL");
  }
  async executeRendererIntent(intent: unknown): Promise<LocalProductResult> {
    assertRendererProductIntent(intent);
    const value = intent as unknown as Record<string, unknown>;
    if (
      value.type === "account.refresh" ||
      value.type === "account.token.refresh" ||
      value.type === "account.logout"
    )
      return this.execute({ type: value.type });
    if (value.type === "account.login") {
      if (value.loginType !== "chatgpt" && value.loginType !== "deviceCode")
        throw new Error("Invalid account login type.");
      return this.execute({ type: value.type, loginType: value.loginType });
    }
    if (value.type === "account.login.cancel")
      return this.execute({
        type: value.type,
        loginId: nonempty(value.loginId, "login id"),
      });
    if (typeof value.type === "string" && value.type.startsWith("workflow.")) {
      if (!this.workflows) throw new Error("Workflows are unavailable.");
      const operationId = stableOperationId(
        value.operationId,
        "Workflow operation id",
      );
      if (value.type === "workflow.create")
        return this.workflows.createWorkflow({
          operationId,
          name: nonempty(value.name, "Workflow name"),
          configuration: validateWorkflowConfiguration(value.configuration),
        });
      const workflowId = nonempty(value.workflowId, "Workflow id");
      if (
        !Number.isSafeInteger(value.expectedRevision) ||
        Number(value.expectedRevision) < 1
      )
        throw new Error("Workflow expected revision is invalid.");
      const expectedRevision = Number(value.expectedRevision);
      if (value.type === "workflow.edit")
        return this.workflows.editWorkflow({
          operationId,
          workflowId,
          expectedRevision,
          name: nonempty(value.name, "Workflow name"),
          configuration: validateWorkflowConfiguration(value.configuration),
        });
      if (
        value.type === "workflow.archive" ||
        value.type === "workflow.unarchive"
      )
        return this.workflows.setWorkflowArchived({
          operationId,
          workflowId,
          expectedRevision,
          archived: value.type === "workflow.archive",
        });
      if (value.type !== "workflow.promote")
        throw new Error("Unsupported Workflow command.");
      if (
        !["preference", "guidance", "knowledge"].includes(
          String(value.category),
        )
      )
        throw new Error("Workflow promotion category is invalid.");
      if (
        !Array.isArray(value.appliesTo) ||
        value.appliesTo.some((entry) => typeof entry !== "string")
      )
        throw new Error("Workflow promotion topics are invalid.");
      const sourceTaskId = nonempty(value.sourceTaskId, "source task id");
      const sourceItemId =
        typeof value.sourceItemId === "string" ? value.sourceItemId : undefined;
      const sourceResultId =
        typeof value.sourceResultId === "string"
          ? value.sourceResultId
          : undefined;
      if (Boolean(sourceItemId) === Boolean(sourceResultId))
        throw new Error("Workflow promotion requires exactly one source.");
      const sourceTask = await this.tasks.readTask(sourceTaskId);
      if (!sourceTask) throw new Error("Workflow promotion task is stale.");
      const sourceItem = sourceItemId
        ? sourceTask.conversation?.items[sourceItemId]
        : undefined;
      const sourceResult = sourceResultId
        ? this.results?.result(sourceTaskId, sourceResultId)
        : undefined;
      if (sourceItemId && (!sourceItem?.text || sourceItem.attachments?.length))
        throw new Error(
          "Workflow promotion source is stale or includes attachments.",
        );
      if (
        sourceResultId &&
        (!sourceResult ||
          sourceResult.currentRevision !== Number(value.sourceResultRevision))
      )
        throw new Error("Workflow promotion result revision is stale.");
      const sourceText = sourceItem?.text ?? sourceResult?.revision.body;
      if (!sourceText)
        throw new Error("Workflow promotion source is unavailable.");
      return this.workflows.promoteToWorkflow({
        operationId,
        workflowId,
        expectedRevision,
        category: value.category as WorkflowPromotionCategory,
        text: nonempty(value.text, "promoted Workflow text"),
        appliesTo: value.appliesTo as readonly string[],
        sourceTaskId,
        ...(sourceItemId ? { sourceItemId } : {}),
        ...(sourceResult
          ? {
              sourceResultId: sourceResult.resultId,
              sourceResultRevision: sourceResult.currentRevision,
            }
          : {}),
        sourceTextDigest: textDigest(sourceText),
      });
    }
    if (typeof value.type === "string" && value.type.startsWith("result.")) {
      if (!this.results) throw new Error("Task results are unavailable.");
      const operationId = stableOperationId(
        value.operationId,
        "Result operation id",
      );
      const taskId = nonempty(value.taskId, "result task id");
      if (!(await this.tasks.readTask(taskId)))
        throw new Error("Result task is unavailable.");
      if (value.type === "result.create") {
        if (
          ![
            "finding_collection",
            "draft",
            "report",
            "journey",
            "action",
          ].includes(String(value.kind))
        )
          throw new Error("Result kind is unavailable for manual creation.");
        const sourceItemId = nonempty(
          value.sourceItemId,
          "result source item id",
        );
        const task = await this.tasks.readTask(taskId);
        if (!task) throw new Error("Result task is unavailable.");
        const sourceItem = task?.conversation?.items[sourceItemId];
        if (
          !sourceItem?.text ||
          sourceItem.status !== "completed" ||
          sourceItem.kind !== "assistant_message"
        )
          throw new Error(
            "Result source is stale or is not a completed response.",
          );
        const createBase = {
          operationId,
          taskId,
          ...(sourceItem.turnId ? { turnId: sourceItem.turnId } : {}),
          title: nonempty(value.title, "result title"),
          body: nonempty(value.body, "result body"),
          source: {
            conversationItemId: sourceItemId,
            conversationTextDigest: textDigest(sourceItem.text),
            evidenceIds: [],
          },
        };
        if (value.kind === "action") {
          const material = record(value.actionMaterial);
          if (!material) throw new Error("Action result material is required.");
          exactCommand(material, [
            "recipient",
            "recipientControl",
            "content",
            "contentControl",
            "target",
            "commitControl",
            "attachmentIds",
            "attachmentControl",
            "scope",
          ]);
          if (
            !Array.isArray(material.attachmentIds) ||
            material.attachmentIds.some((id) => typeof id !== "string") ||
            new Set(material.attachmentIds).size !==
              material.attachmentIds.length
          )
            throw new Error("Action result attachments are invalid.");
          const availableAttachments = new Set(
            this.attachments
              ?.listForTask?.(taskId)
              .map((attachment) => attachment.id) ?? [],
          );
          if (
            material.attachmentIds.some(
              (attachmentId) => !availableAttachments.has(attachmentId),
            )
          )
            throw new Error(
              "Action result attachments are stale or belong to another task.",
            );
          return this.results.createAction({
            ...createBase,
            material: {
              ...(material.recipient === undefined
                ? {}
                : {
                    recipient: nonempty(material.recipient, "action recipient"),
                  }),
              ...(material.recipientControl === undefined
                ? {}
                : {
                    recipientControl: nonempty(
                      material.recipientControl,
                      "recipient control",
                    ),
                  }),
              content: nonempty(material.content, "action content"),
              ...(material.contentControl === undefined
                ? {}
                : {
                    contentControl: nonempty(
                      material.contentControl,
                      "content control",
                    ),
                  }),
              ...(material.target === undefined
                ? {}
                : { target: nonempty(material.target, "action target") }),
              ...(material.commitControl === undefined
                ? {}
                : {
                    commitControl: nonempty(
                      material.commitControl,
                      "commit control",
                    ),
                  }),
              attachmentIds: material.attachmentIds as string[],
              ...(material.attachmentControl === undefined
                ? {}
                : {
                    attachmentControl: nonempty(
                      material.attachmentControl,
                      "attachment control",
                    ),
                  }),
              ...(material.scope === undefined
                ? {}
                : { scope: nonempty(material.scope, "action scope") }),
            },
          });
        }
        if (value.actionMaterial !== undefined)
          throw new Error("Only action results accept action material.");
        return this.results.createResult({
          ...createBase,
          kind: value.kind as Exclude<TaskResultKind, "artifact" | "action">,
        });
      }
      const resultId = nonempty(value.resultId, "result id");
      const result = this.results.result(taskId, resultId);
      if (!result) throw new Error("Result is unavailable for this task.");
      if (value.type === "result.authorize") {
        if (
          result.kind !== "action" ||
          !["prepared", "authorized"].includes(result.lifecycle)
        )
          throw new Error("Only a prepared action can be authorized.");
        const materialDigest = nonempty(
          value.materialDigest,
          "action material digest",
        );
        if (materialDigest !== result.materialDigest)
          throw new Error(
            "Action authorization does not match current material.",
          );
        return this.results.transitionAction({
          operationId,
          taskId,
          resultId,
          expectedLifecycle: "prepared",
          lifecycle: "authorized",
          materialDigest,
        });
      }
      if (
        !Number.isSafeInteger(value.expectedRevision) ||
        Number(value.expectedRevision) < 1
      )
        throw new Error("Result expected revision is invalid.");
      const expectedRevision = Number(value.expectedRevision);
      if (value.type === "result.revise")
        return this.results.reviseDraft({
          operationId,
          taskId,
          resultId,
          expectedRevision,
          title: nonempty(value.title, "result title"),
          body: nonempty(value.body, "result body"),
        });
      if (value.type === "result.select") {
        if (typeof value.selected !== "boolean")
          throw new Error("Result selection is invalid.");
        return this.results.setResultSelected({
          operationId,
          taskId,
          resultId,
          expectedRevision,
          selected: value.selected,
        });
      }
      throw new Error("Unsupported result command.");
    }
    if (value.type === "attachments.pick") {
      if (!this.attachments)
        throw new Error("File attachments are unavailable.");
      return this.attachments.selectDrafts();
    }
    if (
      value.type === "attachments.remove" ||
      value.type === "attachments.replace"
    ) {
      if (!this.attachments)
        throw new Error("File attachments are unavailable.");
      const attachmentId = nonempty(value.attachmentId, "attachment id");
      if (value.type === "attachments.remove") {
        await this.attachments.removeDraft(attachmentId);
        return undefined;
      }
      return this.attachments.replaceDraft(attachmentId);
    }
    if (value.type === "task.attachment.reselect") {
      if (!this.attachments || !this.attachmentRuntime)
        throw new Error("File attachments are unavailable.");
      const taskId = nonempty(value.taskId, "task id");
      const attachmentId = nonempty(value.attachmentId, "attachment id");
      const task = await this.tasks.readTask(taskId);
      if (!task) throw new Error("Task is unavailable.");
      const sessionId = nonempty(
        task.context.roveSessionId,
        "Runtime session id",
      );
      return (
        (await this.attachments.reselectTaskAttachment(
          attachmentId,
          taskId,
          sessionId,
          this.attachmentRuntime,
        )) ?? undefined
      );
    }
    if (
      value.type === "file-attention.select" ||
      value.type === "file-attention.cancel"
    ) {
      if (!this.attachments)
        throw new Error("File attachments are unavailable.");
      const identity = {
        requestId: nonempty(value.requestId, "file request id"),
        taskId: nonempty(value.taskId, "task id"),
        sessionId: nonempty(value.sessionId, "session id"),
      };
      const attention = this.attachments
        .listAttention()
        .find(
          (entry) =>
            entry.requestId === identity.requestId &&
            entry.taskId === identity.taskId &&
            entry.sessionId === identity.sessionId,
        );
      if (!attention) throw new Error("Stale or mismatched file request.");
      if (
        ["reconciliation_required", "cleanup_required"].includes(
          attention.status,
        )
      )
        throw new Error(
          "File grant reconciliation requires the attachment subsystem port.",
        );
      else if (value.type === "file-attention.select")
        await this.attachments.selectPending(identity);
      else await this.attachments.cancelPending(identity);
      return undefined;
    }
    if (value.type === "task.launch") {
      if (!record(value.input)) throw new Error("Invalid product task launch.");
      return this.execute({
        type: value.type,
        operationId: stableOperationId(
          value.operationId,
          "launch operation id",
        ),
        input: value.input as unknown as ProductTaskLaunchInput,
      });
    }
    const taskId = nonempty(value.taskId, "task id");
    if (value.type === "task.message") {
      await this.requireTaskAction(taskId, "message");
      const attachmentIds = value.attachmentIds ?? [];
      if (
        !Array.isArray(attachmentIds) ||
        attachmentIds.some((id) => typeof id !== "string") ||
        JSON.stringify([...attachmentIds].sort()) !==
          JSON.stringify(
            (this.attachments?.listDrafts() ?? [])
              .map((attachment) => attachment.id)
              .sort(),
          )
      )
        throw new Error("Task message attachment selection is stale.");
      const selectedResultIds = value.selectedResultIds ?? [];
      if (
        !Array.isArray(selectedResultIds) ||
        selectedResultIds.length > 8 ||
        selectedResultIds.some(
          (id) => typeof id !== "string" || id.trim().length < 1,
        ) ||
        new Set(selectedResultIds).size !== selectedResultIds.length
      )
        throw new Error("Task result selection is invalid.");
      return this.execute({
        type: value.type,
        taskId,
        operationId: stableOperationId(
          value.operationId,
          "message operation id",
        ),
        outcome: nonempty(value.outcome, "task outcome"),
        attachmentIds: [...attachmentIds],
        selectedResultIds: [...selectedResultIds] as string[],
      });
    }
    if (
      value.type === "task.steer" ||
      value.type === "task.queue.add" ||
      value.type === "task.queue.edit" ||
      value.type === "task.queue.remove" ||
      value.type === "task.queue.reorder"
    ) {
      return this.execute({
        ...value,
        taskId,
        operationId: stableOperationId(
          value.operationId,
          "task interaction operation id",
        ),
      } as LocalProductCommand);
    }
    if (value.type === "task.queue.steer") {
      return this.execute({
        type: value.type,
        taskId,
        entryId: nonempty(value.entryId, "queue entry id"),
        expectedTurnId: nonempty(value.expectedTurnId, "expected turn id"),
      });
    }
    if (value.type === "task.stop") {
      if (
        !(await this.taskProjection(taskId)).availableActions.includes(
          "interrupt",
        )
      )
        throw new Error("Stop is available only while this task is executing.");
      return this.tasks.submit({
        type: "interrupt",
        taskId,
        operationId: stableOperationId(
          value.operationId,
          "interrupt operation id",
        ),
      });
    }
    if (value.type === "task.cleanup.retry") {
      await this.requireTaskAction(taskId, "retry_cleanup");
      return this.tasks.submit({
        type: "retry_cleanup",
        taskId,
        operationId: stableOperationId(
          value.operationId,
          "cleanup retry operation id",
        ),
      });
    }
    if (value.type === "task.return-control")
      return this.execute({
        type: value.type,
        taskId,
        operationId: stableOperationId(
          value.operationId,
          "Return Control operation id",
        ),
      });
    if (value.type === "task.restore") {
      return this.tasks.submit({
        type: "unarchive",
        taskId,
        operationId: stableOperationId(
          value.operationId,
          "restore operation id",
        ),
      });
    }
    if (value.type === "task.archive") {
      const operationId = stableOperationId(
        value.operationId,
        "archive operation id",
      );
      return this.tasks.submit({
        type: "archive",
        taskId,
        operationId,
      });
    }
    if (value.type === "task.effects.acknowledge") {
      await this.requireTaskAction(taskId, "acknowledge_legacy_effects");
      return this.execute({ type: value.type, taskId });
    }
    if (value.type === "task.effects.authorize-repeat")
      return this.execute({
        type: value.type,
        taskId,
        effectId: nonempty(value.effectId, "effect id"),
      });
    if (value.type === "task.recording.start") {
      if (value.scope !== "page" && value.scope !== "browser_window")
        throw new Error("Invalid recording scope.");
      if (value.confirmUnmaskedSensitiveContent !== true)
        throw new Error("Recording requires sensitive-content confirmation.");
      const pageId =
        value.pageId === undefined
          ? undefined
          : nonempty(value.pageId, "recording page id");
      return this.execute({
        type: value.type,
        taskId,
        scope: value.scope,
        ...(pageId === undefined ? {} : { pageId }),
        confirmUnmaskedSensitiveContent: true,
      });
    }
    if (value.type === "task.recording.stop")
      return this.execute({
        type: value.type,
        taskId,
        recordingId: nonempty(value.recordingId, "recording id"),
      });
    const requestId = nonempty(value.requestId, "request id");
    if (!Number.isInteger(value.generation) || Number(value.generation) < 0)
      throw new Error("Invalid request generation.");
    if (
      value.decision !== "accept" &&
      value.decision !== "decline" &&
      value.decision !== "cancel"
    )
      throw new Error("Invalid attention decision.");
    const answers =
      value.answers === undefined ? undefined : record(value.answers);
    const form = value.form === undefined ? undefined : record(value.form);
    if (value.answers !== undefined && answers === undefined)
      throw new Error("Invalid attention answers.");
    if (value.form !== undefined && form === undefined)
      throw new Error("Invalid attention form.");
    const entry = this.attention
      .list()
      .find(
        (candidate) =>
          candidate.authority === "codex" &&
          candidate.status === "pending" &&
          candidate.taskId === taskId &&
          candidate.requestId === requestId &&
          candidate.generation === Number(value.generation),
      );
    const responseTask = await this.tasks.readTask(taskId);
    if (
      responseTask &&
      (responseTask.lifecycle.phase === "failed" ||
        responseTask.context.bootstrap.stage !== "complete")
    )
      throw new Error(
        "Task requires explicit recovery before attention can be answered.",
      );
    if (entry === undefined || !responseTask)
      throw new Error("Stale or mismatched attention response.");
    if (entry.kind === "user_input") {
      if (form !== undefined)
        throw new Error("User-input attention does not accept form content.");
    } else if (entry.kind === "mcp_elicitation") {
      if (answers !== undefined)
        throw new Error("MCP elicitation does not accept question answers.");
      if (entry.payload.mode === "url" && form !== undefined)
        throw new Error("URL elicitation does not accept form content.");
    } else if (answers !== undefined || form !== undefined) {
      throw new Error("Approval attention does not accept response content.");
    }
    return this.execute({
      type: "attention.decide",
      requestId,
      taskId,
      ...(entry.threadId === undefined ? {} : { threadId: entry.threadId }),
      ...(entry.turnId === undefined ? {} : { turnId: entry.turnId }),
      ...(entry.itemId === undefined ? {} : { itemId: entry.itemId }),
      generation: Number(value.generation),
      decision: value.decision,
      ...(answers === undefined
        ? {}
        : { answers: answers as Record<string, readonly string[]> }),
      ...(form === undefined
        ? {}
        : {
            form: form as Record<
              string,
              string | number | boolean | readonly string[]
            >,
          }),
    });
  }
  private async taskProjection(taskId: string): Promise<ProductTaskSnapshot> {
    const task = (await this.tasks.productTasks()).find(
      (entry) => entry.context.roveTaskId === taskId,
    );
    if (!task) throw new Error("Task lifecycle record was not found.");
    return task;
  }
  private async requireTaskAction(
    taskId: string,
    action: ProductTaskSnapshot["availableActions"][number],
  ): Promise<void> {
    if (!(await this.taskProjection(taskId)).availableActions.includes(action))
      throw new Error(
        `${action.replaceAll("_", " ")} is not available for this task.`,
      );
  }
  private requireModelReady(model?: string, effort?: string): void {
    if (!this.health().ready) throw new Error("Codex App Server is not ready.");
    const catalog = this.account.snapshot();
    if (catalog.account.status !== "logged_in")
      throw new Error("ChatGPT model access is unavailable.");
    if (!model) return;
    const selected = catalog.models.find((candidate) => candidate.id === model);
    if (!selected) throw new Error("The selected model is stale.");
    if (effort && !selected.efforts.includes(effort))
      throw new Error("The selected reasoning effort is unavailable.");
  }
  async execute(command: LocalProductCommand): Promise<LocalProductResult> {
    if (command === null || typeof command !== "object")
      throw new Error("Invalid local product command.");
    const shapes: Record<LocalProductCommand["type"], readonly string[]> = {
      "account.refresh": ["type"],
      "account.token.refresh": ["type"],
      "account.login": ["type", "loginType"],
      "account.login.cancel": ["type", "loginId"],
      "account.logout": ["type"],
      "workflow.create": ["type", "operationId", "name", "configuration"],
      "workflow.edit": [
        "type",
        "operationId",
        "workflowId",
        "expectedRevision",
        "name",
        "configuration",
      ],
      "workflow.archive": [
        "type",
        "operationId",
        "workflowId",
        "expectedRevision",
      ],
      "workflow.unarchive": [
        "type",
        "operationId",
        "workflowId",
        "expectedRevision",
      ],
      "workflow.promote": [
        "type",
        "operationId",
        "workflowId",
        "expectedRevision",
        "category",
        "text",
        "appliesTo",
        "sourceTaskId",
        "sourceItemId",
        "sourceResultId",
        "sourceResultRevision",
      ],
      "result.create": [
        "type",
        "operationId",
        "taskId",
        "sourceItemId",
        "kind",
        "title",
        "body",
        "actionMaterial",
      ],
      "result.revise": [
        "type",
        "operationId",
        "taskId",
        "resultId",
        "expectedRevision",
        "title",
        "body",
      ],
      "result.select": [
        "type",
        "operationId",
        "taskId",
        "resultId",
        "expectedRevision",
        "selected",
      ],
      "result.authorize": [
        "type",
        "operationId",
        "taskId",
        "resultId",
        "materialDigest",
      ],
      "attachments.pick": ["type"],
      "attachments.remove": ["type", "attachmentId"],
      "attachments.replace": ["type", "attachmentId"],
      "task.attachment.reselect": ["type", "taskId", "attachmentId"],
      "file-attention.select": ["type", "requestId", "taskId", "sessionId"],
      "file-attention.cancel": ["type", "requestId", "taskId", "sessionId"],
      "task.launch": ["type", "operationId", "input"],
      "task.message": [
        "type",
        "taskId",
        "operationId",
        "outcome",
        "attachmentIds",
        "selectedResultIds",
      ],
      "task.steer": [
        "type",
        "taskId",
        "operationId",
        "expectedTurnId",
        "outcome",
        "attachmentIds",
      ],
      "task.queue.add": [
        "type",
        "taskId",
        "operationId",
        "outcome",
        "attachmentIds",
        "selectedResultIds",
      ],
      "task.queue.edit": [
        "type",
        "taskId",
        "operationId",
        "entryId",
        "outcome",
      ],
      "task.queue.remove": ["type", "taskId", "operationId", "entryId"],
      "task.queue.reorder": ["type", "taskId", "operationId", "entryIds"],
      "task.queue.steer": ["type", "taskId", "entryId", "expectedTurnId"],
      "task.close": ["type", "taskId", "operationId"],
      "task.return-control": ["type", "taskId", "operationId"],
      "task.thread.read": ["type", "taskId"],
      "task.thread.archive": ["type", "taskId", "operationId"],
      "task.thread.unarchive": ["type", "taskId", "operationId"],
      "task.effects.acknowledge": ["type", "taskId"],
      "task.effects.authorize-repeat": ["type", "taskId", "effectId"],
      "task.recording.start": [
        "type",
        "taskId",
        "scope",
        "pageId",
        "confirmUnmaskedSensitiveContent",
      ],
      "task.recording.stop": ["type", "taskId", "recordingId"],
      "task.effects.closeout": ["type", "taskId", "operationId"],
      "attention.decide": [
        "type",
        "requestId",
        "taskId",
        "threadId",
        "turnId",
        "itemId",
        "generation",
        "decision",
        "answers",
        "form",
      ],
      "attention.respond": [
        "type",
        "requestId",
        "taskId",
        "threadId",
        "turnId",
        "itemId",
        "generation",
        "result",
      ],
    };
    const shape = shapes[command.type];
    if (shape === undefined)
      throw new Error("Unsupported local product command.");
    exactCommand(command as unknown as Record<string, unknown>, shape);
    switch (command.type) {
      case "account.refresh":
        return this.account.refresh();
      case "account.token.refresh":
        return this.account.refreshManagedToken();
      case "account.login":
        return this.account.login(command.loginType);
      case "account.login.cancel":
        return this.account.cancelLogin(nonempty(command.loginId, "login id"));
      case "account.logout":
        await this.account.logout();
        return undefined;
      case "result.create":
      case "result.revise":
      case "result.select":
      case "result.authorize":
        return this.executeRendererIntent(command);
      case "task.launch": {
        const input = command.input;
        const operationId = stableOperationId(
          command.operationId,
          "launch operation id",
        );
        if (input === null || typeof input !== "object")
          throw new Error("Invalid product task launch.");
        this.requireModelReady(input.model, input.reasoningEffort);
        exactCommand(input as unknown as Record<string, unknown>, [
          "outcome",
          "executionMode",
          "browserIdentity",
          "approvalsReviewer",
          "model",
          "reasoningEffort",
          "attachmentIds",
          "workflowId",
          "shareWorkflowContext",
        ]);
        const outcome = nonempty(input.outcome, "task outcome").slice(
          0,
          16_000,
        );
        const workflow = input.workflowId
          ? this.workflows?.workflow(
              nonempty(input.workflowId, "Workflow identity"),
            )
          : undefined;
        if (input.workflowId && !this.workflows)
          throw new Error("Workflows are unavailable.");
        if (input.workflowId && (!workflow || workflow.archived))
          throw new Error("Selected Workflow is unavailable.");
        if (
          input.shareWorkflowContext !== undefined &&
          typeof input.shareWorkflowContext !== "boolean"
        )
          throw new Error("Workflow context sharing choice is invalid.");
        const workflowContext =
          workflow && input.shareWorkflowContext === true
            ? assembleWorkflowContext(workflow, outcome)
            : undefined;
        if (!isApprovalsReviewer(input.approvalsReviewer))
          throw new Error("Invalid product approvals reviewer.");
        const attachmentIds = input.attachmentIds ?? [];
        if (
          !Array.isArray(attachmentIds) ||
          attachmentIds.some((id) => typeof id !== "string") ||
          JSON.stringify([...attachmentIds].sort()) !==
            JSON.stringify(
              (this.attachments?.listDrafts() ?? [])
                .map((attachment) => attachment.id)
                .sort(),
            )
        )
          throw new Error("Task launch attachment selection is stale.");
        const started = await this.tasks.submit({
          type: "launch",
          operationId,
          outcome,
          executionMode: input.executionMode,
          ...(input.browserIdentity
            ? { browserIdentity: input.browserIdentity }
            : {}),
          approvalsReviewer: input.approvalsReviewer,
          cwd: this.taskCwd,
          ...(input.model === undefined ? {} : { model: input.model }),
          ...(input.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: input.reasoningEffort }),
          attachmentIds: [...attachmentIds],
          attachmentMetadata: conversationAttachmentMetadata(
            this.attachments?.listDrafts() ?? [],
            attachmentIds,
          ),
          ...(workflowContext ? { workflowContext } : {}),
          ...(workflow
            ? {
                workflowAssociation: {
                  workflowId: workflow.workflowId,
                  workflowName: workflow.name,
                },
              }
            : {}),
        });
        this.currentTaskId = started.aggregate.taskId;
        return started;
      }
      case "task.queue.edit":
        return this.tasks.submit({
          type: "queue_edit",
          taskId: nonempty(command.taskId, "task id"),
          operationId: stableOperationId(
            command.operationId,
            "queue edit operation id",
          ),
          entryId: nonempty(command.entryId, "queue entry id"),
          message: nonempty(command.outcome, "queued outcome").slice(0, 16_000),
        });
      case "task.queue.steer": {
        const taskId = nonempty(command.taskId, "task id");
        const entryId = nonempty(command.entryId, "queue entry id");
        const expectedTurnId = nonempty(
          command.expectedTurnId,
          "expected turn id",
        );
        const task = await this.tasks.readTask(taskId);
        if (!task) throw new Error("Task is unavailable.");
        if (
          task.conversation?.turnStatus !== "in_progress" ||
          task.conversation.activeTurnId !== expectedTurnId ||
          !task.capabilities.canSteer
        )
          throw new Error(
            "Active work changed before the queued intervention was accepted.",
          );
        const entry = task.customerExecution?.queue.find(
          (candidate) => candidate.id === entryId,
        );
        if (!entry) throw new Error("Queued message is no longer available.");
        this.requireModelReady(
          task.context.policy.model,
          task.context.policy.reasoningEffort,
        );
        return this.tasks.submit({
          type: "queue_steer",
          taskId,
          operationId: entry.operationId,
          entryId: entry.id,
          expectedTurnId,
        });
      }
      case "task.queue.remove":
        return this.tasks.submit({
          type: "queue_remove",
          taskId: nonempty(command.taskId, "task id"),
          operationId: stableOperationId(
            command.operationId,
            "queue remove operation id",
          ),
          entryId: nonempty(command.entryId, "queue entry id"),
        });
      case "task.queue.reorder": {
        if (
          !Array.isArray(command.entryIds) ||
          command.entryIds.some((id) => typeof id !== "string") ||
          new Set(command.entryIds).size !== command.entryIds.length
        )
          throw new Error("Queue order is invalid.");
        return this.tasks.submit({
          type: "queue_reorder",
          taskId: nonempty(command.taskId, "task id"),
          operationId: stableOperationId(
            command.operationId,
            "queue reorder operation id",
          ),
          entryIds: [...command.entryIds],
        });
      }
      case "task.queue.add":
      case "task.steer": {
        const taskId = nonempty(command.taskId, "task id");
        const outcome = nonempty(command.outcome, "task outcome").slice(
          0,
          16_000,
        );
        const operationId = stableOperationId(
          command.operationId,
          command.type === "task.steer"
            ? "steer operation id"
            : "queue operation id",
        );
        const attachmentIds = command.attachmentIds ?? [];
        if (
          !Array.isArray(attachmentIds) ||
          attachmentIds.some((id) => typeof id !== "string") ||
          JSON.stringify([...attachmentIds].sort()) !==
            JSON.stringify(
              (this.attachments?.listDrafts() ?? [])
                .map((attachment) => attachment.id)
                .sort(),
            )
        )
          throw new Error("Task message attachment selection is stale.");
        const task = await this.tasks.readTask(taskId);
        if (!task) throw new Error("Task is unavailable.");
        this.requireModelReady(
          task.context.policy.model,
          task.context.policy.reasoningEffort,
        );
        if (
          task.conversation?.turnStatus !== "in_progress" ||
          !task.conversation.activeTurnId
        )
          throw new Error(
            "Active work changed before the intervention was accepted.",
          );
        if (
          command.type === "task.steer" &&
          command.expectedTurnId !== task.conversation.activeTurnId
        )
          throw new Error("Send now targets a stale active turn.");
        if (command.type === "task.steer")
          return this.tasks.submit({
            type: "steer",
            taskId,
            operationId,
            expectedTurnId: command.expectedTurnId,
            message: outcome,
            attachmentIds: [...attachmentIds],
            attachmentMetadata: conversationAttachmentMetadata(
              this.attachments?.listDrafts() ?? [],
              attachmentIds,
            ),
          });
        const selectedResultIds = command.selectedResultIds ?? [];
        if (
          selectedResultIds.length > 8 ||
          selectedResultIds.some(
            (resultId) =>
              typeof resultId !== "string" || resultId.trim().length < 1,
          ) ||
          new Set(selectedResultIds).size !== selectedResultIds.length
        )
          throw new Error("Task result selection is invalid.");
        const selectedResults = selectedResultIds.map((resultId) => {
          const result = this.results?.result(taskId, resultId);
          if (!result || !result.selected || !result.selectedRevision)
            throw new Error(
              "Selected result is stale or belongs to another task.",
            );
          return result;
        });
        const associatedWorkflow = task.context.workflowAssociation
          ? this.workflows?.workflow(
              task.context.workflowAssociation.workflowId,
            )
          : null;
        return this.tasks.submit({
          type: "queue_add",
          taskId,
          operationId,
          message: outcome,
          attachmentIds: [...attachmentIds],
          attachmentMetadata: conversationAttachmentMetadata(
            this.attachments?.listDrafts() ?? [],
            attachmentIds,
          ),
          ...(associatedWorkflow
            ? {
                workflowContext: assembleWorkflowContext(
                  associatedWorkflow,
                  outcome,
                ),
              }
            : {}),
          ...(selectedResults.length
            ? {
                selectedResultContext:
                  assembleTaskResultContext(selectedResults),
              }
            : {}),
        });
      }
      case "task.message": {
        const taskId = nonempty(command.taskId, "task id");
        const outcome = nonempty(command.outcome, "task outcome").slice(
          0,
          16_000,
        );
        const operationId = stableOperationId(
          command.operationId,
          "message operation id",
        );
        const attachmentIds = command.attachmentIds ?? [];
        if (
          !Array.isArray(attachmentIds) ||
          attachmentIds.some((id) => typeof id !== "string")
        )
          throw new Error("Task message attachment selection is invalid.");
        const selectedResultIds = command.selectedResultIds ?? [];
        if (
          selectedResultIds.length > 8 ||
          selectedResultIds.some(
            (resultId) =>
              typeof resultId !== "string" || resultId.trim().length < 1,
          ) ||
          new Set(selectedResultIds).size !== selectedResultIds.length
        )
          throw new Error("Task result selection is invalid.");
        const prior = await this.tasks.acceptedTaskMessage?.({
          taskId,
          operationId,
          message: outcome,
          attachmentIds,
          selectedResultIds,
        });
        if (prior) return prior;
        const existingTask = await this.tasks.readTask(taskId);
        const explicitContinuation = this.attention
          .list()
          .some(
            (entry) =>
              entry.authority === "rove_control" &&
              entry.kind === "control_handoff" &&
              entry.status === "pending" &&
              entry.taskId === taskId &&
              entry.payload.policy === "explicit_user_response",
          );
        if (
          existingTask?.conversation?.turnStatus === "in_progress" &&
          !explicitContinuation
        )
          return this.execute({
            type: "task.queue.add",
            taskId,
            operationId,
            outcome,
            attachmentIds: [...attachmentIds],
            selectedResultIds: [...selectedResultIds],
          });
        this.requireModelReady(
          existingTask?.context.policy.model,
          existingTask?.context.policy.reasoningEffort,
        );
        if (
          JSON.stringify([...attachmentIds].sort()) !==
          JSON.stringify(
            (this.attachments?.listDrafts() ?? [])
              .map((attachment) => attachment.id)
              .sort(),
          )
        )
          throw new Error("Task message attachment selection is stale.");
        const selectedResults = selectedResultIds.map((resultId) => {
          const result = this.results?.result(taskId, resultId);
          if (!result || !result.selected || !result.selectedRevision)
            throw new Error(
              "Selected result is stale or belongs to another task.",
            );
          return result;
        });
        const selectedResultContext = selectedResults.length
          ? assembleTaskResultContext(selectedResults)
          : undefined;
        const associatedWorkflow = existingTask?.context.workflowAssociation
          ? this.workflows?.workflow(
              existingTask.context.workflowAssociation.workflowId,
            )
          : null;
        const workflowContext =
          associatedWorkflow && existingTask?.context.workflowContext
            ? assembleWorkflowContext(associatedWorkflow, outcome)
            : undefined;
        const accepted = await this.tasks.submit({
          type: explicitContinuation
            ? "explicit_continuation_response"
            : "message",
          taskId,
          message: outcome,
          attachmentIds: [...attachmentIds],
          attachmentMetadata: conversationAttachmentMetadata(
            this.attachments?.listDrafts() ?? [],
            attachmentIds,
          ),
          ...(workflowContext ? { workflowContext } : {}),
          ...(selectedResultContext ? { selectedResultContext } : {}),
          operationId,
        });
        return accepted;
      }
      case "task.close":
        return this.tasks.submit({
          type: "finish",
          taskId: nonempty(command.taskId, "task id"),
          operationId: stableOperationId(
            command.operationId,
            "finish operation id",
          ),
        });
      case "task.return-control": {
        const operationId = stableOperationId(
          command.operationId,
          "Return Control operation id",
        );
        return this.tasks.submit({
          type: "return_control",
          taskId: nonempty(command.taskId, "task id"),
          operationId,
        });
      }
      case "task.thread.read":
        return (
          (await this.tasks.readTask(nonempty(command.taskId, "task id"))) ?? {}
        );
      case "task.thread.archive":
        return this.tasks.submit({
          type: "archive",
          taskId: nonempty(command.taskId, "task id"),
          operationId: command.operationId ?? `intent_${crypto.randomUUID()}`,
        });
      case "task.thread.unarchive":
        return this.tasks.submit({
          type: "unarchive",
          taskId: nonempty(command.taskId, "task id"),
          operationId: command.operationId ?? `intent_${crypto.randomUUID()}`,
        });
      case "task.effects.acknowledge": {
        if (!this.legacyEffects)
          throw new Error("Legacy effect acknowledgement is unavailable.");
        const task = await this.tasks.readTask(
          nonempty(command.taskId, "task id"),
        );
        const sessionId = nonempty(
          task?.context.roveSessionId,
          "Runtime session id",
        );
        await this.legacyEffects.acknowledgeLegacyEffectScope(sessionId);
        return true;
      }
      case "task.effects.authorize-repeat": {
        if (!this.legacyEffects?.authorizeEffectRepetition)
          throw new Error("Effect repetition authorization is unavailable.");
        const effectId = nonempty(command.effectId, "effect id");
        if (!/^[a-f0-9]{64}$/.test(effectId))
          throw new Error("Invalid effect id.");
        const task = await this.tasks.readTask(
          nonempty(command.taskId, "task id"),
        );
        const sessionId = nonempty(
          task?.context.roveSessionId,
          "Runtime session id",
        );
        return this.legacyEffects.authorizeEffectRepetition(
          sessionId,
          effectId,
        );
      }
      case "task.recording.start": {
        if (!this.recordingRuntime)
          throw new Error("Recording is unavailable.");
        const taskId = nonempty(command.taskId, "task id");
        const task = await this.tasks.readTask(taskId);
        if (!task || ["closed", "failed"].includes(task.lifecycle.phase))
          throw new Error("Recording requires an open task.");
        const sessionId = task.context.roveSessionId;
        if (command.scope !== "page" && command.scope !== "browser_window")
          throw new Error("Invalid recording scope.");
        if (command.confirmUnmaskedSensitiveContent !== true)
          throw new Error("Recording requires sensitive-content confirmation.");
        if (
          command.pageId !== undefined &&
          !/^page_[A-Za-z0-9_-]+$/.test(command.pageId)
        )
          throw new Error("Invalid recording page id.");
        const request: StartRecordingRequest =
          command.scope === "page"
            ? {
                scope: "page",
                taskId,
                ...(command.pageId ? { pageId: command.pageId } : {}),
                sensitiveDataPolicy: "user_confirmed_visible_content",
                confirmUnmaskedSensitiveContent: true,
              }
            : {
                scope: "browser_window",
                taskId,
                sensitiveDataPolicy: "user_confirmed_visible_content",
                confirmUnmaskedSensitiveContent: true,
              };
        return this.recordingRuntime.startRecording(sessionId, request);
      }
      case "task.recording.stop": {
        if (!this.recordingRuntime)
          throw new Error("Recording is unavailable.");
        const taskId = nonempty(command.taskId, "task id");
        const recordingId = nonempty(command.recordingId, "recording id");
        if (!/^rec_[a-f0-9]{32}$/.test(recordingId))
          throw new Error("Invalid recording id.");
        const task = await this.tasks.readTask(taskId);
        const sessionId = nonempty(
          task?.context.roveSessionId,
          "Runtime session id",
        );
        const owned = (
          await this.recordingRuntime.listRecordings(sessionId)
        ).find(
          (recording) =>
            recording.id === recordingId && recording.taskId === taskId,
        );
        if (!owned) throw new Error("Recording does not belong to this task.");
        return this.recordingRuntime.stopRecording(sessionId, recordingId);
      }
      case "task.effects.closeout": {
        if (!this.legacyEffects)
          throw new Error("Legacy effect closeout is unavailable.");
        const taskId = nonempty(command.taskId, "task id");
        const task = await this.tasks.readTask(taskId);
        const sessionId = nonempty(
          task?.context.roveSessionId,
          "Runtime session id",
        );
        await this.legacyEffects.acknowledgeLegacyEffectScope(sessionId);
        return this.tasks.submit({
          type: "finish",
          taskId,
          operationId: stableOperationId(
            command.operationId,
            "legacy effect closeout operation id",
          ),
        });
      }
      case "attention.respond": {
        const responseTask = await this.tasks.readTask(command.taskId);
        if (
          !responseTask ||
          responseTask.lifecycle.phase === "failed" ||
          responseTask.context.bootstrap.stage !== "complete"
        )
          throw new Error(
            "Task requires explicit recovery before attention can be answered.",
          );
        this.requireAccepted(
          await this.tasks.submit({
            type: "attention_response",
            taskId: command.taskId,
            operationId: `intent_${crypto.randomUUID()}`,
            requestId: command.requestId,
            generation: command.generation,
            response: command.result as TaskPortableValue,
          }),
        );
        return undefined;
      }
      case "attention.decide": {
        const task = await this.tasks.readTask(command.taskId);
        if (
          !task ||
          task.lifecycle.phase === "failed" ||
          task.context.bootstrap.stage !== "complete"
        )
          throw new Error(
            "Task requires explicit recovery before attention can be answered.",
          );
        const entry = this.attention.requireExact({
          authority: "codex",
          requestId: command.requestId,
          taskId: command.taskId,
          ...(command.threadId === undefined
            ? {}
            : { threadId: command.threadId }),
          ...(command.turnId === undefined ? {} : { turnId: command.turnId }),
          ...(command.itemId === undefined ? {} : { itemId: command.itemId }),
          generation: command.generation,
        });
        let result: unknown;
        if (
          entry.kind === "command_approval" ||
          entry.kind === "file_approval" ||
          entry.kind === "network_approval"
        ) {
          if (command.decision === "cancel")
            throw new Error("Approval requests do not support cancel.");
          if (!supportedAttentionDecisions(entry).includes(command.decision))
            throw new Error("This approval decision is not available.");
          const legacy =
            entry.method === "execCommandApproval" ||
            entry.method === "applyPatchApproval";
          result = {
            decision:
              command.decision === "accept"
                ? legacy
                  ? "approved"
                  : "accept"
                : legacy
                  ? "abort"
                  : "decline",
          };
        } else if (entry.kind === "permission_approval") {
          if (command.decision === "cancel")
            throw new Error("Permission approvals do not support cancel.");
          result = {
            permissions:
              command.decision === "accept" &&
              entry.payload.permissions !== null &&
              typeof entry.payload.permissions === "object"
                ? entry.payload.permissions
                : {},
            scope: "turn",
            strictAutoReview: false,
          };
        } else if (entry.kind === "mcp_elicitation") {
          const mode = entry.payload.mode;
          result = {
            _meta: null,
            action: command.decision,
            content:
              command.decision === "accept"
                ? mode === "url"
                  ? null
                  : formContent(entry, command.form)
                : null,
          };
        } else {
          if (command.decision !== "accept")
            throw new Error("User-input requests require submitted answers.");
          result = {
            answers: answerMap(entry, command.answers),
          };
        }
        this.requireAccepted(
          await this.tasks.submit({
            type: "attention_response",
            taskId: command.taskId,
            operationId: `intent_${crypto.randomUUID()}`,
            requestId: command.requestId,
            generation: command.generation,
            response: result as TaskPortableValue,
          }),
        );
        return undefined;
      }
    }
  }
}
