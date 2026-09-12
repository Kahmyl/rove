#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const sourceFlag = process.argv.indexOf("--source");
const outputFlag = process.argv.indexOf("--output");
if (sourceFlag < 0 || outputFlag < 0) {
  throw new Error(
    "Usage: generate-runtime-validators.mjs --source <generated-ts> --output <catalog.json>",
  );
}

const sourceDirectory = path.resolve(process.argv[sourceFlag + 1]);
const outputPath = path.resolve(process.argv[outputFlag + 1]);

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(target)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(target);
  }
  return files;
}

const files = await filesBelow(sourceDirectory);
const program = ts.createProgram(files, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length > 0) {
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => sourceDirectory,
      getNewLine: () => "\n",
    }),
  );
}

const checker = program.getTypeChecker();
const definitions = {};
const building = new Set();
const processingTypes = new Set();

function generatedSymbol(type) {
  const symbol = type.aliasSymbol ?? type.getSymbol?.();
  if (!symbol || symbol.name.startsWith("__")) return undefined;
  const declaration = symbol.declarations?.[0];
  if (
    !declaration ||
    !path
      .resolve(declaration.getSourceFile().fileName)
      .startsWith(sourceDirectory + path.sep)
  ) {
    return undefined;
  }
  return symbol;
}

function definitionName(symbol) {
  const declaration = symbol.declarations[0];
  const relative = path
    .relative(sourceDirectory, declaration.getSourceFile().fileName)
    .replace(/\.ts$/, "");
  return `${relative.replace(/[^A-Za-z0-9]+/g, "_")}__${symbol.name}`;
}

function schemaFor(type, inlineSymbol) {
  const symbol = generatedSymbol(type);
  if (symbol && symbol !== inlineSymbol) {
    const name = definitionName(symbol);
    if (!(name in definitions)) {
      definitions[name] = {};
      if (!building.has(name)) {
        building.add(name);
        definitions[name] = schemaFor(type, symbol);
        building.delete(name);
      }
    }
    return { $ref: `#/$defs/${name}` };
  }

  if (processingTypes.has(type.id)) return {};
  processingTypes.add(type.id);
  try {
    return schemaForInline(type);
  } finally {
    processingTypes.delete(type.id);
  }
}

function schemaForInline(type) {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {};
  if (type.flags & ts.TypeFlags.Never) return false;
  if (type.flags & ts.TypeFlags.StringLike) {
    if (type.flags & ts.TypeFlags.StringLiteral) return { const: type.value };
    return { type: "string" };
  }
  if (type.flags & ts.TypeFlags.NumberLike) {
    if (type.flags & ts.TypeFlags.NumberLiteral) return { const: type.value };
    return { type: "number" };
  }
  // ts-rs represents Rust u64/i64 values as bigint in TypeScript, while the
  // JSONL transport carries them as JSON numbers.
  if (type.flags & ts.TypeFlags.BigIntLike) return { type: "number" };
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return { const: type.intrinsicName === "true" };
  }
  if (type.flags & ts.TypeFlags.Boolean) return { type: "boolean" };
  if (type.flags & ts.TypeFlags.Null) return { type: "null" };
  if (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return false;
  if (type.isUnion?.()) {
    const variants = type.types
      .filter(
        (entry) =>
          !(entry.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)),
      )
      .map((entry) => schemaFor(entry));
    if (variants.length === 0) return false;
    if (variants.length === 1) return variants[0];
    return { anyOf: variants };
  }

  if (checker.isArrayType(type)) {
    return {
      type: "array",
      items: schemaFor(checker.getTypeArguments(type)[0]),
    };
  }
  if (checker.isTupleType(type)) {
    const items = checker
      .getTypeArguments(type)
      .map((entry) => schemaFor(entry));
    return {
      type: "array",
      prefixItems: items,
      minItems: items.length,
      maxItems: items.length,
    };
  }

  if (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) {
    const properties = {};
    const required = [];
    for (const property of checker
      .getPropertiesOfType(type)
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const declaration =
        property.valueDeclaration ?? property.declarations?.[0];
      if (!declaration) continue;
      properties[property.name] = schemaFor(
        checker.getTypeOfSymbolAtLocation(property, declaration),
      );
      if (!(property.flags & ts.SymbolFlags.Optional))
        required.push(property.name);
    }
    const stringIndex = checker.getIndexTypeOfType(type, ts.IndexKind.String);
    return {
      type: "object",
      properties,
      required,
      additionalProperties: stringIndex ? schemaFor(stringIndex) : false,
    };
  }

  const constraint = checker.getBaseConstraintOfType(type);
  return constraint && constraint !== type ? schemaFor(constraint) : {};
}

function exportedType(relativeFile, exportName) {
  const filename = path.join(sourceDirectory, relativeFile);
  const source = program.getSourceFile(filename);
  if (!source) throw new Error(`Missing generated source ${relativeFile}.`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  const symbol =
    moduleSymbol &&
    checker
      .getExportsOfModule(moduleSymbol)
      .find((entry) => entry.name === exportName);
  if (!symbol)
    throw new Error(
      `Missing generated export ${exportName} in ${relativeFile}.`,
    );
  return schemaFor(checker.getDeclaredTypeOfSymbol(symbol));
}

const roots = {
  clientParams: {},
  clientResponses: {},
  notifications: {},
  serverRequests: {},
  serverResponses: {},
};

const rootMappings = {
  clientParams: {
    initialize: ["InitializeParams.ts", "InitializeParams"],
    "account/read": ["v2/GetAccountParams.ts", "GetAccountParams"],
    "account/login/start": ["v2/LoginAccountParams.ts", "LoginAccountParams"],
    "account/login/cancel": [
      "v2/CancelLoginAccountParams.ts",
      "CancelLoginAccountParams",
    ],
    "model/list": ["v2/ModelListParams.ts", "ModelListParams"],
    "account/usage/read": [
      "v2/GetAccountTokenUsageParams.ts",
      "GetAccountTokenUsageParams",
    ],
    "thread/start": ["v2/ThreadStartParams.ts", "ThreadStartParams"],
    "thread/list": ["v2/ThreadListParams.ts", "ThreadListParams"],
    "thread/read": ["v2/ThreadReadParams.ts", "ThreadReadParams"],
    "thread/resume": ["v2/ThreadResumeParams.ts", "ThreadResumeParams"],
    "thread/archive": ["v2/ThreadArchiveParams.ts", "ThreadArchiveParams"],
    "thread/unarchive": [
      "v2/ThreadUnarchiveParams.ts",
      "ThreadUnarchiveParams",
    ],
    "turn/start": ["v2/TurnStartParams.ts", "TurnStartParams"],
    "turn/steer": ["v2/TurnSteerParams.ts", "TurnSteerParams"],
    "turn/interrupt": ["v2/TurnInterruptParams.ts", "TurnInterruptParams"],
    "mcpServerStatus/list": [
      "v2/ListMcpServerStatusParams.ts",
      "ListMcpServerStatusParams",
    ],
  },
  clientResponses: {
    initialize: ["InitializeResponse.ts", "InitializeResponse"],
    "account/read": ["v2/GetAccountResponse.ts", "GetAccountResponse"],
    "account/login/start": [
      "v2/LoginAccountResponse.ts",
      "LoginAccountResponse",
    ],
    "account/login/cancel": [
      "v2/CancelLoginAccountResponse.ts",
      "CancelLoginAccountResponse",
    ],
    "account/logout": ["v2/LogoutAccountResponse.ts", "LogoutAccountResponse"],
    "model/list": ["v2/ModelListResponse.ts", "ModelListResponse"],
    "account/rateLimits/read": [
      "v2/GetAccountRateLimitsResponse.ts",
      "GetAccountRateLimitsResponse",
    ],
    "account/usage/read": [
      "v2/GetAccountTokenUsageResponse.ts",
      "GetAccountTokenUsageResponse",
    ],
    "thread/start": ["v2/ThreadStartResponse.ts", "ThreadStartResponse"],
    "thread/list": ["v2/ThreadListResponse.ts", "ThreadListResponse"],
    "thread/read": ["v2/ThreadReadResponse.ts", "ThreadReadResponse"],
    "thread/resume": ["v2/ThreadResumeResponse.ts", "ThreadResumeResponse"],
    "thread/archive": ["v2/ThreadArchiveResponse.ts", "ThreadArchiveResponse"],
    "thread/unarchive": [
      "v2/ThreadUnarchiveResponse.ts",
      "ThreadUnarchiveResponse",
    ],
    "turn/start": ["v2/TurnStartResponse.ts", "TurnStartResponse"],
    "turn/steer": ["v2/TurnSteerResponse.ts", "TurnSteerResponse"],
    "turn/interrupt": ["v2/TurnInterruptResponse.ts", "TurnInterruptResponse"],
    "mcpServerStatus/list": [
      "v2/ListMcpServerStatusResponse.ts",
      "ListMcpServerStatusResponse",
    ],
  },
  notifications: {
    "account/updated": [
      "v2/AccountUpdatedNotification.ts",
      "AccountUpdatedNotification",
    ],
    "account/login/completed": [
      "v2/AccountLoginCompletedNotification.ts",
      "AccountLoginCompletedNotification",
    ],
    "account/rateLimits/updated": [
      "v2/AccountRateLimitsUpdatedNotification.ts",
      "AccountRateLimitsUpdatedNotification",
    ],
    "thread/started": [
      "v2/ThreadStartedNotification.ts",
      "ThreadStartedNotification",
    ],
    "thread/archived": [
      "v2/ThreadArchivedNotification.ts",
      "ThreadArchivedNotification",
    ],
    "thread/unarchived": [
      "v2/ThreadUnarchivedNotification.ts",
      "ThreadUnarchivedNotification",
    ],
    "thread/status/changed": [
      "v2/ThreadStatusChangedNotification.ts",
      "ThreadStatusChangedNotification",
    ],
    "turn/started": [
      "v2/TurnStartedNotification.ts",
      "TurnStartedNotification",
    ],
    "turn/completed": [
      "v2/TurnCompletedNotification.ts",
      "TurnCompletedNotification",
    ],
    "turn/plan/updated": [
      "v2/TurnPlanUpdatedNotification.ts",
      "TurnPlanUpdatedNotification",
    ],
    "turn/diff/updated": [
      "v2/TurnDiffUpdatedNotification.ts",
      "TurnDiffUpdatedNotification",
    ],
    "item/started": [
      "v2/ItemStartedNotification.ts",
      "ItemStartedNotification",
    ],
    "item/completed": [
      "v2/ItemCompletedNotification.ts",
      "ItemCompletedNotification",
    ],
    "item/agentMessage/delta": [
      "v2/AgentMessageDeltaNotification.ts",
      "AgentMessageDeltaNotification",
    ],
    "item/plan/delta": ["v2/PlanDeltaNotification.ts", "PlanDeltaNotification"],
    "item/commandExecution/outputDelta": [
      "v2/CommandExecutionOutputDeltaNotification.ts",
      "CommandExecutionOutputDeltaNotification",
    ],
    "item/fileChange/outputDelta": [
      "v2/FileChangeOutputDeltaNotification.ts",
      "FileChangeOutputDeltaNotification",
    ],
    "item/mcpToolCall/progress": [
      "v2/McpToolCallProgressNotification.ts",
      "McpToolCallProgressNotification",
    ],
    "serverRequest/resolved": [
      "v2/ServerRequestResolvedNotification.ts",
      "ServerRequestResolvedNotification",
    ],
    "mcpServer/startupStatus/updated": [
      "v2/McpServerStatusUpdatedNotification.ts",
      "McpServerStatusUpdatedNotification",
    ],
  },
  serverRequests: {
    "item/commandExecution/requestApproval": [
      "v2/CommandExecutionRequestApprovalParams.ts",
      "CommandExecutionRequestApprovalParams",
    ],
    "item/fileChange/requestApproval": [
      "v2/FileChangeRequestApprovalParams.ts",
      "FileChangeRequestApprovalParams",
    ],
    "item/tool/requestUserInput": [
      "v2/ToolRequestUserInputParams.ts",
      "ToolRequestUserInputParams",
    ],
    "mcpServer/elicitation/request": [
      "v2/McpServerElicitationRequestParams.ts",
      "McpServerElicitationRequestParams",
    ],
    "item/permissions/requestApproval": [
      "v2/PermissionsRequestApprovalParams.ts",
      "PermissionsRequestApprovalParams",
    ],
    "item/tool/call": ["v2/DynamicToolCallParams.ts", "DynamicToolCallParams"],
    "account/chatgptAuthTokens/refresh": [
      "v2/ChatgptAuthTokensRefreshParams.ts",
      "ChatgptAuthTokensRefreshParams",
    ],
    "attestation/generate": [
      "v2/AttestationGenerateParams.ts",
      "AttestationGenerateParams",
    ],
    "currentTime/read": [
      "v2/CurrentTimeReadParams.ts",
      "CurrentTimeReadParams",
    ],
    applyPatchApproval: [
      "ApplyPatchApprovalParams.ts",
      "ApplyPatchApprovalParams",
    ],
    execCommandApproval: [
      "ExecCommandApprovalParams.ts",
      "ExecCommandApprovalParams",
    ],
  },
  serverResponses: {
    "item/commandExecution/requestApproval": [
      "v2/CommandExecutionRequestApprovalResponse.ts",
      "CommandExecutionRequestApprovalResponse",
    ],
    "item/fileChange/requestApproval": [
      "v2/FileChangeRequestApprovalResponse.ts",
      "FileChangeRequestApprovalResponse",
    ],
    "item/tool/requestUserInput": [
      "v2/ToolRequestUserInputResponse.ts",
      "ToolRequestUserInputResponse",
    ],
    "mcpServer/elicitation/request": [
      "v2/McpServerElicitationRequestResponse.ts",
      "McpServerElicitationRequestResponse",
    ],
    "item/permissions/requestApproval": [
      "v2/PermissionsRequestApprovalResponse.ts",
      "PermissionsRequestApprovalResponse",
    ],
    "item/tool/call": [
      "v2/DynamicToolCallResponse.ts",
      "DynamicToolCallResponse",
    ],
    "account/chatgptAuthTokens/refresh": [
      "v2/ChatgptAuthTokensRefreshResponse.ts",
      "ChatgptAuthTokensRefreshResponse",
    ],
    "attestation/generate": [
      "v2/AttestationGenerateResponse.ts",
      "AttestationGenerateResponse",
    ],
    "currentTime/read": [
      "v2/CurrentTimeReadResponse.ts",
      "CurrentTimeReadResponse",
    ],
    applyPatchApproval: [
      "ApplyPatchApprovalResponse.ts",
      "ApplyPatchApprovalResponse",
    ],
    execCommandApproval: [
      "ExecCommandApprovalResponse.ts",
      "ExecCommandApprovalResponse",
    ],
  },
};

for (const [family, mappings] of Object.entries(rootMappings)) {
  for (const [method, [file, name]] of Object.entries(mappings)) {
    roots[family][method] = exportedType(file, name);
  }
}

const digest = createHash("sha256");
for (const file of files) {
  digest.update(path.relative(sourceDirectory, file));
  digest.update("\0");
  digest.update(await readFile(file));
  digest.update("\0");
}

const catalog = {
  generatedBy: "Codex App Server generate-ts 0.153.4 --experimental",
  generatedTsAggregateSha256: digest.digest("hex"),
  roots,
  $defs: Object.fromEntries(
    Object.entries(definitions).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ),
};
await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, {
  mode: 0o644,
});
