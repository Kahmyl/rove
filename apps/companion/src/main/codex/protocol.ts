import generatedSchemaCatalogJson from "./app-server-0.153.4.schemas.generated.json" with { type: "json" };
import {
  assertGeneratedSchema,
  type GeneratedSchemaCatalog,
} from "./generated-schema-validator.js";

const generatedSchemaCatalog =
  generatedSchemaCatalogJson as unknown as GeneratedSchemaCatalog;

/**
 * Checked-in reviewed subset mechanically derived from Codex App Server 0.153.4
 * `generate-ts --experimental`. Runtime validators below mirror these closed
 * generated unions and reject fields/types outside this locked version.
 */
export const CODEX_SCHEMA_SHA256 =
  "50cb262ffff7c4480e17f13a5667aeb5e3a411b2793a63327d03cc2d6cb6e5a5";
export const CODEX_GENERATED_SOURCE_DIGESTS = {
  clientRequestTs:
    "83418e6f3f8100fa59b0324afaaf45c8d258db3dd42a10769d9c337c93b910f2",
  serverRequestTs:
    "1c5837adbfbdd005f387478ba87840808d1353b47b82dcf63739a78bb1c8d3be",
  v2Json: "e5f798fd1343c539f01fedea0e8a84a43c080fcca4615c80eb04a5edab4f7d0a",
} as const;
export const CODEX_REVIEWED_GENERATED_FILE_DIGESTS = {
  "v2/Thread.ts":
    "9a2a7ab942bbc6d2a8c0757e991ab81ed6d3e55d70439b228c1f202db42cd3dc",
  "v2/Turn.ts":
    "5a0852e46a13446ccb3aa3f493c06a9151a43772d530521789ac741ed115da5f",
  "v2/ThreadItem.ts":
    "ee25d621ee645f49a88e494effcdf625d88cc229edbb184827d8cf4c135ff6f4",
  "v2/Model.ts":
    "ff56f09e9b9f301f1c6ecc565e2bcf6355c6ea66880f3ac963b7754e74cbe0a3",
  "v2/McpServerStatus.ts":
    "9d6b57ee14d00eccae653509ead06b5b6d69995cbb2cde473ac62d4236d6f817",
  "ServerRequest.ts":
    "1c5837adbfbdd005f387478ba87840808d1353b47b82dcf63739a78bb1c8d3be",
  "ServerNotification.ts":
    "dfd31c72d1319f069fcdf124bcae6368f15aa0dd0033350bf15519d3e3556d54",
} as const;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };
export type JsonRpcId = string | number;
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface InitializeParams {
  clientInfo: { name: "rove"; title: "Rove"; version: string };
  capabilities: { experimentalApi: boolean; requestAttestation: false };
}
export interface InitializeResponse {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}
export type UserInput =
  | { type: "text"; text: string; text_elements: JsonValue[] }
  | { type: "image"; url: string; detail?: string }
  | { type: "localImage"; path: string; detail?: string }
  | { type: "audio"; url: string }
  | { type: "localAudio"; path: string }
  | { type: "skill" | "mention"; name: string; path: string };

export interface CodexTurn {
  id: string;
  items: CodexThreadItem[];
  itemsView: "notLoaded" | "summary" | "full";
  status: "completed" | "interrupted" | "failed" | "inProgress";
  error: JsonValue | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}
export interface CodexThread {
  id: string;
  extra: JsonValue | null;
  sessionId: string;
  forkedFromId: string | null;
  parentThreadId: string | null;
  preview: string;
  ephemeral: boolean;
  section: JsonValue | null;
  sectionEnteredAt: number | null;
  projectId: string | null;
  historyMode: "legacy" | "paginated";
  modelProvider: string;
  model: string | null;
  reasoningEffort: string | null;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  cwd: string;
  cliVersion: string;
  status:
    | { type: "notLoaded" | "idle" | "systemError" }
    | { type: "active"; activeFlags: JsonValue[] };
  path: string | null;
  source:
    | "cli"
    | "vscode"
    | "exec"
    | "appServer"
    | "unknown"
    | { custom: string }
    | { subAgent: JsonValue };
  canAcceptDirectInput: boolean | null;
  threadSource: string | null;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: JsonValue | null;
  name: string | null;
  turns: CodexTurn[];
}
export type CodexThreadItem =
  | {
      type: "userMessage";
      id: string;
      clientId: string | null;
      content: UserInput[];
    }
  | {
      type: "agentMessage";
      id: string;
      text: string;
      phase: string | null;
      memoryCitation: JsonValue | null;
      delivery: JsonValue | null;
      questions: JsonValue[] | null;
    }
  | { type: "plan"; id: string; text: string }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | {
      type: "commandExecution";
      id: string;
      pluginId: string | null;
      scriptPath: string | null;
      command: string;
      cwd: string;
      processId: string | null;
      source: JsonValue;
      status: string;
      commandActions: JsonValue[];
      aggregatedOutput: string | null;
      exitCode: number | null;
      durationMs: number | null;
    }
  | { type: "fileChange"; id: string; changes: JsonValue[]; status: string }
  | {
      type: "mcpToolCall";
      id: string;
      server: string;
      tool: string;
      status: string;
      arguments: JsonValue;
      appContext: JsonValue | null;
      mcpAppResourceUri?: string;
      pluginId: string | null;
      readOnlyHint: boolean | null;
      result: JsonValue | null;
      error: JsonValue | null;
      durationMs: number | null;
    }
  | {
      type: "dynamicToolCall";
      id: string;
      namespace: string | null;
      tool: string;
      status: string;
      arguments: JsonValue;
      contentItems: JsonValue[] | null;
      success: boolean | null;
      durationMs: number | null;
    }
  | { type: "contextCompaction"; id: string }
  | {
      type: "enteredReviewMode" | "exitedReviewMode";
      id: string;
      review: string;
    }
  | { type: "imageView"; id: string; path: string }
  | {
      type: "subAgentActivity";
      id: string;
      kind: JsonValue;
      agentThreadId: string;
      agentPath: string;
    }
  | {
      type:
        | "hookPrompt"
        | "functionCallOutput"
        | "collabAgentToolCall"
        | "webSearch"
        | "sleep"
        | "imageGeneration";
      id: string;
    };

export interface ThreadStartParams {
  model?: string | null;
  cwd?: string | null;
  approvalPolicy?: string | null;
  approvalsReviewer?: "auto_review" | "user" | null;
  sandbox?: string | null;
  permissions?: string | null;
  runtimeWorkspaceRoots?: string[] | null;
  config?: Record<string, JsonValue | undefined> | null;
  serviceName?: string | null;
  historyMode?: "legacy" | "paginated" | null;
  ephemeral?: boolean | null;
  experimentalRawEvents?: boolean;
  threadSource?: string | null;
  developerInstructions?: string | null;
}
export interface ThreadResumeParams {
  threadId: string;
  model?: string | null;
  cwd?: string | null;
  approvalPolicy?: string | null;
  approvalsReviewer?: "auto_review" | "user" | null;
  sandbox?: string | null;
  permissions?: string | null;
  runtimeWorkspaceRoots?: string[] | null;
  config?: Record<string, JsonValue | undefined> | null;
  excludeTurns?: boolean;
  developerInstructions?: string | null;
}
export interface ThreadStartResponse {
  thread: CodexThread;
  model: string;
  modelProvider: string;
  serviceTier: string | null;
  cwd: string;
  runtimeWorkspaceRoots: string[];
  instructionSources: string[];
  approvalPolicy: string;
  approvalsReviewer: JsonValue;
  sandbox: JsonValue;
  activePermissionProfile: JsonValue | null;
  reasoningEffort: string | null;
  multiAgentMode: JsonValue;
}
export interface ThreadResumeResponse extends ThreadStartResponse {
  initialTurnsPage: JsonValue | null;
  turnsBackwardsCursor: string | null;
  itemsBackwardsCursor: string | null;
}
export interface ThreadListParams {
  cursor?: string | null;
  limit?: number | null;
  sortKey?: string | null;
  sortDirection?: "asc" | "desc" | null;
  archived?: boolean | null;
  cwd?: string | string[] | null;
}
export interface ThreadListResponse {
  data: CodexThread[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}
export interface TurnStartParams {
  threadId: string;
  clientUserMessageId?: string | null;
  input: UserInput[];
}
export interface TurnStartResponse {
  turn: CodexTurn;
}
export interface TurnSteerParams extends TurnStartParams {
  expectedTurnId: string;
}
export interface TurnSteerResponse {
  turnId: string;
}

export interface CodexModel {
  id: string;
  model: string;
  upgrade: string | null;
  upgradeInfo: JsonValue | null;
  availabilityNux: JsonValue | null;
  displayName: string;
  description: string;
  modelSpecialty: string | null;
  hidden: boolean;
  supportedReasoningEfforts: Array<{
    reasoningEffort: string;
    description: string;
  }>;
  defaultReasoningEffort: string;
  inputModalities: string[];
  supportsPersonality: boolean;
  multiAgentVersion: JsonValue | null;
  additionalSpeedTiers: string[];
  serviceTiers: JsonValue[];
  defaultServiceTier: string | null;
  isDefault: boolean;
}
export interface ModelListResponse {
  data: CodexModel[];
  nextCursor: string | null;
}
export type CodexAccount =
  | { type: "apiKey" }
  | { type: "chatgpt"; email: string | null; planType: string }
  | { type: "amazonBedrock"; usesCodexManagedCredentials: boolean };
export interface GetAccountResponse {
  account: CodexAccount | null;
  requiresOpenaiAuth: boolean;
}
export type LoginAccountResponse =
  | { type: "chatgpt"; loginId: string; authUrl: string }
  | {
      type: "chatgptDeviceCode";
      loginId: string;
      verificationUrl: string;
      userCode: string;
    };
export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}
export interface RateLimitSnapshot {
  limitId: string | null;
  limitName: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  credits: JsonValue | null;
  individualLimit: JsonValue | null;
  spendControlReached: boolean | null;
  planType: string | null;
  rateLimitReachedType: JsonValue | null;
}
export interface GetAccountRateLimitsResponse {
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId: Record<string, RateLimitSnapshot> | null;
  rateLimitResetCredits: JsonValue | null;
  accountId: string | null;
  rateLimitUpsell: JsonValue | null;
}
export interface GetAccountTokenUsageResponse {
  summary: Record<string, number | string | null>;
  dailyUsageBuckets: JsonValue[] | null;
  threadUsage?: JsonValue | null;
}

export interface McpToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonValue;
  outputSchema?: JsonValue;
  annotations?: JsonValue;
  _meta?: JsonValue;
}
export interface McpServerStatus {
  name: string;
  runtimeStatus:
    | "notStarted"
    | "starting"
    | "connected"
    | "authenticationRequired"
    | "failed"
    | "cancelled"
    | "disabled"
    | null;
  pluginId: string | null;
  serverInfo: {
    name: string;
    title: string | null;
    version: string;
    description: string | null;
    websiteUrl: string | null;
  } | null;
  tools: Record<string, McpToolDefinition>;
  resources: JsonValue[];
  resourceTemplates: JsonValue[];
  authStatus:
    "unknown" | "unsupported" | "notLoggedIn" | "bearerToken" | "oAuth";
}

export const CODEX_REVIEWED_METHODS = [
  "initialize",
  "account/read",
  "account/login/start",
  "account/login/cancel",
  "account/logout",
  "model/list",
  "account/rateLimits/read",
  "account/usage/read",
  "thread/start",
  "thread/list",
  "thread/read",
  "thread/resume",
  "thread/archive",
  "thread/unarchive",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "mcpServerStatus/list",
] as const;
export interface CodexRequestMap {
  initialize: { params: InitializeParams; result: InitializeResponse };
  "account/read": {
    params: { refreshToken?: boolean };
    result: GetAccountResponse;
  };
  "account/login/start": {
    params:
      | {
          type: "chatgpt";
          appBrand?: "chatgpt" | "codex" | null;
          codexStreamlinedLogin?: boolean;
          useHostedLoginSuccessPage?: boolean;
        }
      | { type: "chatgptDeviceCode" };
    result: LoginAccountResponse;
  };
  "account/login/cancel": {
    params: { loginId: string };
    result: { status: string };
  };
  "account/logout": { params: undefined; result: Record<string, never> };
  "model/list": {
    params: {
      includeHidden?: boolean | null;
      limit?: number | null;
      cursor?: string | null;
    };
    result: ModelListResponse;
  };
  "account/rateLimits/read": {
    params: undefined;
    result: GetAccountRateLimitsResponse;
  };
  "account/usage/read": {
    params: { threadId?: string | null } | undefined;
    result: GetAccountTokenUsageResponse;
  };
  "thread/start": { params: ThreadStartParams; result: ThreadStartResponse };
  "thread/list": { params: ThreadListParams; result: ThreadListResponse };
  "thread/read": {
    params: { threadId: string; includeTurns?: boolean };
    result: { thread: CodexThread };
  };
  "thread/resume": { params: ThreadResumeParams; result: ThreadResumeResponse };
  "thread/archive": {
    params: { threadId: string };
    result: Record<string, never>;
  };
  "thread/unarchive": {
    params: { threadId: string };
    result: { thread: CodexThread };
  };
  "turn/start": { params: TurnStartParams; result: TurnStartResponse };
  "turn/steer": { params: TurnSteerParams; result: TurnSteerResponse };
  "turn/interrupt": {
    params: { threadId: string; turnId: string };
    result: Record<string, never>;
  };
  "mcpServerStatus/list": {
    params: {
      cursor?: string | null;
      limit?: number | null;
      detail?: "full" | "summary" | null;
      threadId?: string | null;
    };
    result: { data: McpServerStatus[]; nextCursor: string | null };
  };
}
export type CodexMethod = keyof CodexRequestMap;

export const CODEX_SERVER_REQUEST_METHODS = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "item/permissions/requestApproval",
  "item/tool/call",
  "account/chatgptAuthTokens/refresh",
  "attestation/generate",
  "currentTime/read",
  "applyPatchApproval",
  "execCommandApproval",
] as const;
export type CodexServerRequestMethod =
  (typeof CODEX_SERVER_REQUEST_METHODS)[number];
export const CODEX_SERVER_NOTIFICATION_METHODS = [
  "account/updated",
  "account/login/completed",
  "account/rateLimits/updated",
  "thread/started",
  "thread/archived",
  "thread/unarchived",
  "thread/status/changed",
  "turn/started",
  "turn/completed",
  "turn/plan/updated",
  "turn/diff/updated",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/mcpToolCall/progress",
  "serverRequest/resolved",
  "mcpServer/startupStatus/updated",
] as const;
export type CodexServerNotificationMethod =
  (typeof CODEX_SERVER_NOTIFICATION_METHODS)[number];
export interface CodexServerEvent {
  method: CodexServerRequestMethod | CodexServerNotificationMethod;
  params: Record<string, unknown>;
  requestId?: JsonRpcId;
  wireRequestId?: JsonRpcId;
}
export type CodexServerEventListener = (
  event: CodexServerEvent,
) => Promise<void> | void;
export interface CodexRpcPort {
  request<M extends CodexMethod>(
    method: M,
    params: CodexRequestMap[M]["params"],
    timeoutMs?: number,
  ): Promise<CodexRequestMap[M]["result"]>;
  notify(method: "initialized", params?: undefined): void;
  respond(id: JsonRpcId, result: unknown, error?: JsonRpcError): Promise<void>;
  onEvent(listener: CodexServerEventListener): () => void;
}

export function objectValue(
  value: unknown,
  label = "value",
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Expected ${label} to be an object.`);
  return value as Record<string, unknown>;
}
export function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Codex value is missing ${field}.`);
  return value;
}
export function validateCodexRequestParams<M extends CodexMethod>(
  method: M,
  value: CodexRequestMap[M]["params"],
): void {
  if (method === "account/logout" || method === "account/rateLimits/read") {
    if (value !== undefined)
      throw new Error(`${method} does not accept params.`);
    return;
  }
  if (method === "account/usage/read" && value === undefined) return;
  assertGeneratedSchema(
    generatedSchemaCatalog,
    generatedSchemaCatalog.roots.clientParams[method],
    value,
    `${method} params`,
  );
  if (method === "turn/start" || method === "turn/steer") {
    const allowed =
      method === "turn/start"
        ? ["threadId", "clientUserMessageId", "input"]
        : ["threadId", "clientUserMessageId", "input", "expectedTurnId"];
    const unsupported = Object.keys(value as object).find(
      (field) => !allowed.includes(field),
    );
    if (unsupported)
      throw new Error(
        `${method} params contains unsupported field ${unsupported}.`,
      );
  }
  if (
    method === "thread/start" &&
    (value as ThreadStartParams).experimentalRawEvents === true
  )
    throw new Error("Raw App Server events are not permitted.");
}

export function validateCodexResponse<M extends CodexMethod>(
  method: M,
  value: unknown,
): CodexRequestMap[M]["result"] {
  assertGeneratedSchema(
    generatedSchemaCatalog,
    generatedSchemaCatalog.roots.clientResponses[method],
    value,
    `${method} result`,
  );
  return value as CodexRequestMap[M]["result"];
}

export function parseCodexServerEvent(
  method: string,
  paramsValue: unknown,
  requestId?: JsonRpcId,
  wireRequestId?: JsonRpcId,
): CodexServerEvent | undefined {
  if (requestId !== undefined) {
    if (!(CODEX_SERVER_REQUEST_METHODS as readonly string[]).includes(method))
      return undefined;
    const typedMethod = method as CodexServerRequestMethod;
    assertGeneratedSchema(
      generatedSchemaCatalog,
      generatedSchemaCatalog.roots.serverRequests[typedMethod],
      paramsValue,
      `${method} params`,
    );
    return {
      method: typedMethod,
      params: paramsValue as Record<string, unknown>,
      requestId,
      ...(wireRequestId === undefined ? {} : { wireRequestId }),
    };
  }
  if (
    !(CODEX_SERVER_NOTIFICATION_METHODS as readonly string[]).includes(method)
  )
    return undefined;
  const typedMethod = method as CodexServerNotificationMethod;
  assertGeneratedSchema(
    generatedSchemaCatalog,
    generatedSchemaCatalog.roots.notifications[typedMethod],
    paramsValue,
    `${method} params`,
  );
  return {
    method: typedMethod,
    params: paramsValue as Record<string, unknown>,
  };
}
export function validateServerRequestResponse(
  method: CodexServerRequestMethod,
  value: unknown,
): void {
  assertGeneratedSchema(
    generatedSchemaCatalog,
    generatedSchemaCatalog.roots.serverResponses[method],
    value,
    `${method} response`,
  );
  if (
    method === "item/permissions/requestApproval" &&
    typeof (value as { strictAutoReview?: unknown }).strictAutoReview !==
      "boolean"
  )
    throw new Error(
      "item/permissions/requestApproval response requires strictAutoReview.",
    );
}
