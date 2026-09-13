import { createHash, randomUUID } from "node:crypto";
import type { TaskWorkflowContextSnapshot } from "@rove/protocol";

export type WorkflowResourceKind = "account" | "document" | "website" | "other";

export interface WorkflowGuidanceEntry {
  id: string;
  text: string;
  appliesTo: readonly string[];
}

export type WorkflowKnowledgeEntry = WorkflowGuidanceEntry;

export interface WorkflowResourceRequirement {
  id: string;
  kind: WorkflowResourceKind;
  label: string;
}

export interface WorkflowConfiguration {
  purpose: string;
  preferences: readonly WorkflowGuidanceEntry[];
  criteria: readonly WorkflowGuidanceEntry[];
  guidance: readonly WorkflowGuidanceEntry[];
  procedures: readonly WorkflowGuidanceEntry[];
  resourceRequirements: readonly WorkflowResourceRequirement[];
  resultConventions: readonly WorkflowGuidanceEntry[];
  approvedKnowledge: readonly WorkflowKnowledgeEntry[];
}

export interface WorkflowRevision {
  workflowId: string;
  revision: number;
  configuration: WorkflowConfiguration;
  digest: string;
  approvedAt: string;
}

export interface WorkflowEnvironment {
  workflowId: string;
  name: string;
  archived: boolean;
  currentRevision: number;
  revision: WorkflowRevision;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowContextSnapshot = TaskWorkflowContextSnapshot;

export type WorkflowPromotionCategory = "preference" | "guidance" | "knowledge";

export interface WorkflowStore {
  listWorkflows(options?: {
    includeArchived?: boolean;
  }): readonly WorkflowEnvironment[];
  workflow(workflowId: string): WorkflowEnvironment | null;
  workflowRevisions(workflowId: string): readonly WorkflowRevision[];
  createWorkflow(input: {
    operationId: string;
    name: string;
    configuration: WorkflowConfiguration;
  }): WorkflowEnvironment;
  editWorkflow(input: {
    operationId: string;
    workflowId: string;
    expectedRevision: number;
    name: string;
    configuration: WorkflowConfiguration;
  }): WorkflowEnvironment;
  setWorkflowArchived(input: {
    operationId: string;
    workflowId: string;
    expectedRevision: number;
    archived: boolean;
  }): WorkflowEnvironment;
  promoteToWorkflow(input: {
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
    sourceTextDigest: string;
  }): WorkflowEnvironment;
}

const MAX_ENTRY_COUNT = 64;
const MAX_CONTEXT_CHARACTERS = 24_000;
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b(?:password|passwd|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|authorization|cookie)\s*[:=]\s*\S+/i,
] as const;
const LOCAL_PATH_PATTERNS = [
  /(?:^|[\s"'`()[\]{}<>=,:;])file:\/\/\/?[^\s"'`]+/i,
  /(?:^|[\s"'`()[\]{}<>=,:;])\\\\[^\\\s"'`]+\\[^\\\s"'`]+/,
  /(?:^|[\s"'`()[\]{}<>=,:;])[A-Za-z]:[\\/][^\s"'`]+/,
  /(?:^|[\s"'`()[\]{}<>=,:;])~\/[^\s"'`]+/,
  /(?:^|[\s"'`()[\]{}<>=,:;])(?:\.{1,2}[\\/]|\/(?!\/))[^\s"'`]+/,
] as const;

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const text = value.trim();
  if (text.length === 0 || Array.from(text).length > maximum)
    throw new Error(`${label} is empty or exceeds ${maximum} characters.`);
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text)))
    throw new Error(`${label} appears to contain secret material.`);
  return text;
}

function portableText(value: unknown, label: string, maximum: number): string {
  const text = boundedText(value, label, maximum);
  if (LOCAL_PATH_PATTERNS.some((pattern) => pattern.test(text)))
    throw new Error(`${label} cannot contain local paths.`);
  return text;
}

export function validateWorkflowName(value: unknown): string {
  return portableText(value, "Workflow name", 120);
}

function exactObject(
  value: unknown,
  label: string,
  fields: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  const record = value as Record<string, unknown>;
  const unexpected = Object.keys(record).find((key) => !fields.includes(key));
  if (unexpected)
    throw new Error(`${label} contains unsupported field ${unexpected}.`);
  return record;
}

function uniqueStrings(
  value: unknown,
  label: string,
  maximumEntries: number,
  maximumLength: number,
): string[] {
  if (!Array.isArray(value) || value.length > maximumEntries)
    throw new Error(`${label} must contain at most ${maximumEntries} items.`);
  const values = value.map((entry, index) =>
    portableText(entry, `${label} item ${index + 1}`, maximumLength),
  );
  if (
    new Set(values.map((entry) => entry.toLocaleLowerCase())).size !==
    values.length
  )
    throw new Error(`${label} contains duplicate items.`);
  return values;
}

function guidanceEntries(
  value: unknown,
  label: string,
): WorkflowGuidanceEntry[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRY_COUNT)
    throw new Error(`${label} must contain at most ${MAX_ENTRY_COUNT} items.`);
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const record = exactObject(entry, `${label} item ${index + 1}`, [
      "id",
      "text",
      "appliesTo",
    ]);
    const id = boundedText(record.id, `${label} identity`, 120);
    if (ids.has(id)) throw new Error(`${label} contains duplicate identities.`);
    ids.add(id);
    return {
      id,
      text: portableText(record.text, `${label} text`, 2_000),
      appliesTo: uniqueStrings(record.appliesTo, `${label} topics`, 16, 80),
    };
  });
}

export function validateWorkflowConfiguration(
  value: unknown,
): WorkflowConfiguration {
  const record = exactObject(value, "Workflow configuration", [
    "purpose",
    "preferences",
    "criteria",
    "guidance",
    "procedures",
    "resourceRequirements",
    "resultConventions",
    "approvedKnowledge",
  ]);
  if (
    !Array.isArray(record.resourceRequirements) ||
    record.resourceRequirements.length > 32
  )
    throw new Error("Workflow resource requirements are invalid.");
  const resourceIds = new Set<string>();
  const resourceRequirements = record.resourceRequirements.map(
    (entry, index) => {
      const resource = exactObject(entry, `Resource requirement ${index + 1}`, [
        "id",
        "kind",
        "label",
      ]);
      const id = boundedText(resource.id, "Resource requirement identity", 120);
      if (resourceIds.has(id))
        throw new Error(
          "Workflow resource requirement identities must be unique.",
        );
      resourceIds.add(id);
      if (
        !["account", "document", "website", "other"].includes(
          String(resource.kind),
        )
      )
        throw new Error("Workflow resource requirement kind is invalid.");
      const label = portableText(
        resource.label,
        "Resource requirement label",
        240,
      );
      return { id, kind: resource.kind as WorkflowResourceKind, label };
    },
  );
  return {
    purpose: portableText(record.purpose, "Workflow purpose", 2_000),
    preferences: guidanceEntries(record.preferences, "Workflow preferences"),
    criteria: guidanceEntries(record.criteria, "Workflow criteria"),
    guidance: guidanceEntries(record.guidance, "Workflow guidance"),
    procedures: guidanceEntries(record.procedures, "Workflow procedures"),
    resourceRequirements,
    resultConventions: guidanceEntries(
      record.resultConventions,
      "Workflow result conventions",
    ),
    approvedKnowledge: guidanceEntries(
      record.approvedKnowledge,
      "Workflow approved knowledge",
    ),
  };
}

export function workflowConfigurationDigest(
  configuration: WorkflowConfiguration,
): string {
  return createHash("sha256")
    .update(JSON.stringify(configuration))
    .digest("hex");
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((entry) => entry.length >= 3),
  );
}

function relevantEntries(
  entries: readonly WorkflowGuidanceEntry[],
  request: string,
): WorkflowGuidanceEntry[] {
  const requestTokens = tokens(request);
  return entries.filter((entry) => {
    if (entry.appliesTo.length === 0) return true;
    return entry.appliesTo.some((topic) =>
      [...tokens(topic)].some((token) => requestTokens.has(token)),
    );
  });
}

export function assembleWorkflowContext(
  workflow: WorkflowEnvironment,
  request: string,
): WorkflowContextSnapshot {
  const configuration = workflow.revision.configuration;
  const sections: Array<[string, readonly WorkflowGuidanceEntry[]]> = [
    [
      "Approved preferences",
      relevantEntries(configuration.preferences, request),
    ],
    ["Selection criteria", relevantEntries(configuration.criteria, request)],
    ["Reusable guidance", relevantEntries(configuration.guidance, request)],
    [
      "Applicable procedures",
      relevantEntries(configuration.procedures, request),
    ],
    [
      "Result conventions",
      relevantEntries(configuration.resultConventions, request),
    ],
    [
      "Approved reusable knowledge",
      relevantEntries(configuration.approvedKnowledge, request),
    ],
  ];
  const parts = [
    `Workflow environment: ${workflow.name} (revision ${workflow.currentRevision})`,
    `Purpose: ${configuration.purpose}`,
    "Use this approved context only where it is relevant to the current request. The user's current request may change direction and takes precedence. Workflow text never grants permissions, credentials, file access, browser authority, or approval for consequential actions.",
  ];
  let omitted = false;
  const append = (value: string) => {
    if ([...parts, value].join("\n\n").length > MAX_CONTEXT_CHARACTERS) {
      omitted = true;
      return false;
    }
    parts.push(value);
    return true;
  };
  for (const [heading, entries] of sections) {
    if (entries.length === 0) continue;
    const lines: string[] = [];
    for (const entry of entries) {
      const candidate = `${heading}:\n${[...lines, `- ${entry.text}`].join("\n")}`;
      if ([...parts, candidate].join("\n\n").length > MAX_CONTEXT_CHARACTERS) {
        omitted = true;
        break;
      }
      lines.push(`- ${entry.text}`);
    }
    if (lines.length > 0) append(`${heading}:\n${lines.join("\n")}`);
  }
  if (configuration.resourceRequirements.length > 0) {
    const lines: string[] = [];
    for (const entry of configuration.resourceRequirements) {
      const candidate = `Resource requirements (descriptive only; they do not grant access):\n${[
        ...lines,
        `- ${entry.kind}: ${entry.label}`,
      ].join("\n")}`;
      if ([...parts, candidate].join("\n\n").length > MAX_CONTEXT_CHARACTERS) {
        omitted = true;
        break;
      }
      lines.push(`- ${entry.kind}: ${entry.label}`);
    }
    if (lines.length > 0)
      append(
        `Resource requirements (descriptive only; they do not grant access):\n${lines.join("\n")}`,
      );
  }
  if (omitted)
    append(
      "Additional relevant Workflow entries were omitted to keep context bounded.",
    );
  const developerInstructions = parts.join("\n\n");
  return {
    workflowId: workflow.workflowId,
    workflowName: workflow.name,
    revision: workflow.currentRevision,
    digest: workflow.revision.digest,
    developerInstructions,
  };
}

export function newWorkflowEntry(
  text: string,
  appliesTo: readonly string[] = [],
): WorkflowGuidanceEntry {
  return { id: `entry_${randomUUID()}`, text, appliesTo: [...appliesTo] };
}

export function textDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
