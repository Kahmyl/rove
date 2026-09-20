import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
  type PointerEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type {
  RendererProductIntent,
  LocalProductSnapshot,
  ProductAttentionProjection,
  ProductElicitationField,
  ProductTaskProjection,
} from "../main/codex/local-product-api.js";
import type { RecordingState } from "@rove/protocol";
import type { ProjectedConversationItem } from "../main/codex/conversations.js";
import type {
  CodexModelProjection,
  LoginProjection,
} from "../main/codex/account-catalog.js";
import type { TaskAttachmentDescriptor } from "../main/codex/task-attachments.js";
import type {
  WorkflowConfiguration,
  WorkflowEnvironment,
  WorkflowPromotionCategory,
} from "../main/codex/workflows.js";
import type { TaskResult, TaskResultKind } from "../main/codex/results.js";
import type {
  ApprovalsReviewer,
  ExecutionMode,
} from "../main/codex/task-coordinator.js";
import type { DesktopSurfaceSnapshot } from "../shared/desktop-api.js";
import type { WorkflowSyncBindingProjection } from "../main/codex/workflow-sync-coordinator.js";
import { unmatchedRuntimeSession } from "../shared/desktop-api.js";
import roveMarkUrl from "./assets/rove-mark.png";
import { toCompanionViewModel } from "./state.js";
import {
  activeProductTask,
  archivedProductTasks,
  codexCustomerStatus,
  composerGate,
  modeLabel,
  reconcileSelectedTaskId,
  selectableProductTasks,
  taskHistoryTitle,
  taskControlProjection,
  taskHasAttachedBrowserWorkspace,
  terminalProductTask,
} from "./product-surface-state.js";

export interface ProductSurfaceProps {
  desktop: DesktopSurfaceSnapshot | null;
  connectionError: string | null;
  follower: boolean;
  refresh(): Promise<void>;
}

interface WorkflowEditorDraft {
  workflowId?: string;
  expectedRevision?: number;
  name: string;
  purpose: string;
  focus: "research" | "review" | "outreach" | "custom";
  preferences: WorkflowGuidanceDraft[];
  criteria: WorkflowGuidanceDraft[];
  guidance: WorkflowGuidanceDraft[];
  procedures: WorkflowGuidanceDraft[];
  resourceRequirements: WorkflowResourceDraft[];
  resultStyle: "sources" | "concise" | "detailed";
  approvedKnowledge: WorkflowGuidanceDraft[];
  sourceConfiguration?: WorkflowConfiguration;
  sourceFocus?: WorkflowEditorDraft["focus"];
  sourceResultStyle?: WorkflowEditorDraft["resultStyle"];
}

interface WorkflowGuidanceDraft {
  id: string;
  text: string;
  appliesTo: string;
}

interface WorkflowResourceDraft {
  id: string;
  kind: WorkflowConfiguration["resourceRequirements"][number]["kind"];
  label: string;
}

interface WorkflowPromotionDraft {
  workflowId: string;
  expectedRevision: number;
  destinationImplicit: boolean;
  category: WorkflowPromotionCategory;
  text: string;
  appliesTo: string;
  sourceTaskId: string;
  sourceItemId?: string;
  sourceResultId?: string;
  sourceResultRevision?: number;
}

interface ResultEditorDraft {
  taskId: string;
  resultId: string;
  expectedRevision: number;
  title: string;
  body: string;
  originalTitle: string;
  originalBody: string;
  presentationBody: string;
  suppressedHeadingLine?: string | undefined;
}

export interface OutputStatusProjection {
  label: string;
  description: string;
  tone: "neutral" | "success" | "warning" | "danger";
}

export function outputKindLabel(kind: TaskResultKind): string {
  return kind === "finding_collection"
    ? "Findings"
    : kind === "artifact"
      ? "File"
      : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

export function outputKindForMessage(
  text: string,
): Exclude<TaskResultKind, "action" | "artifact"> {
  const heading = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^#{1,6}\s+/.test(line))
    ?.replace(/^#{1,6}\s+/, "")
    .toLowerCase();
  if (heading?.match(/finding|research|observation|shortlist/))
    return "finding_collection";
  if (heading?.includes("report")) return "report";
  if (heading?.match(/journey|walkthrough/)) return "journey";
  return "draft";
}

function cleanOutputText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/[`*_~>|]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedOutputText(text: string, maximum: number): string {
  if (text.length <= maximum) return text;
  const candidate = text.slice(0, maximum - 1).trimEnd();
  const lastSpace = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, lastSpace > maximum * 0.6 ? lastSpace : undefined)}…`;
}

export function deriveOutputTitle(text: string): string {
  const heading = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^#{1,6}\s+\S/.test(line))
    ?.replace(/^#{1,6}\s+/, "")
    .trim();
  if (heading) return boundedOutputText(cleanOutputText(heading), 80);
  const clean = cleanOutputText(text);
  const sentence = clean.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? clean;
  return boundedOutputText(sentence || "Saved Output", 80);
}

function outputHeadingText(line: string): string | null {
  return (
    line
      .trim()
      .match(/^#{1,6}[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*$/)?.[1]
      ?.trim() ?? null
  );
}

function normalizedOutputIdentity(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function outputHeadingMatchesTitle(title: string, line: string): boolean {
  const heading = outputHeadingText(line);
  return (
    heading !== null &&
    normalizedOutputIdentity(heading) === normalizedOutputIdentity(title)
  );
}

function duplicateOutputHeadingLine(
  title: string,
  body: string,
): string | null {
  const firstMeaningful = body.split(/\r?\n/).find((line) => line.trim());
  return firstMeaningful && outputHeadingMatchesTitle(title, firstMeaningful)
    ? firstMeaningful
    : null;
}

export function outputBodyForPresentation(title: string, body: string): string {
  const lines = body.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim());
  if (
    headingIndex < 0 ||
    !outputHeadingMatchesTitle(title, lines[headingIndex] ?? "")
  )
    return body;
  let contentIndex = headingIndex + 1;
  while (contentIndex < lines.length && !lines[contentIndex]?.trim())
    contentIndex += 1;
  return lines.slice(contentIndex).join("\n");
}

export function outputPreview(title: string, text: string): string {
  return boundedOutputText(
    cleanOutputText(outputBodyForPresentation(title, text)),
    180,
  );
}

export function outputStatus(
  result: TaskResult,
): OutputStatusProjection | null {
  if (result.kind !== "action") return null;
  const statuses: Record<TaskResult["lifecycle"], OutputStatusProjection> = {
    prepared: {
      label: "Ready for approval",
      description: "Nothing has been sent yet.",
      tone: "neutral",
    },
    authorized: {
      label: "Approved",
      description: "Rove has permission. Completion is not yet confirmed.",
      tone: "neutral",
    },
    dispatched: {
      label: "Checking outcome",
      description: "Rove initiated the action and is confirming what happened.",
      tone: "warning",
    },
    confirmed: {
      label: "Sent",
      description: "Rove confirmed success.",
      tone: "success",
    },
    failed: {
      label: "Couldn't complete",
      description: "Rove confirmed that the action did not complete.",
      tone: "danger",
    },
    unresolved: {
      label: "Outcome unclear",
      description:
        "Rove cannot confirm whether the action happened. Check the destination before trying again.",
      tone: "warning",
    },
  };
  return statuses[result.lifecycle];
}

export function followupDraftForTask(
  drafts: Readonly<Record<string, string>>,
  taskId: string | undefined,
): string {
  return taskId ? (drafts[taskId] ?? "") : "";
}

export function workflowWorkspaceProjection(
  product: LocalProductSnapshot | null,
  workflowId: string,
) {
  const workflow = product?.workflows.find(
    (entry) => entry.workflowId === workflowId,
  );
  const tasks = (product?.tasks ?? [])
    .filter((task) => task.workflowAssociation?.workflowId === workflowId)
    .sort((left, right) => right.selectedAt.localeCompare(left.selectedAt));
  const taskIds = new Set(tasks.map((task) => task.taskId));
  const outputs = tasks
    .flatMap((task) => task.results.map((result) => ({ task, result })))
    .sort((left, right) =>
      right.result.updatedAt.localeCompare(left.result.updatedAt),
    );
  const attention = (product?.attention ?? [])
    .filter(
      (entry) =>
        taskIds.has(entry.taskId) &&
        [
          "pending",
          "responding",
          "awaiting_confirmation",
          "resolution_unknown",
          "stale",
        ].includes(entry.status),
    )
    .sort((left, right) => left.sequence - right.sequence);
  return { workflow, tasks, outputs, attention };
}

export function withTaskFollowupDraft(
  drafts: Readonly<Record<string, string>>,
  taskId: string,
  value: string,
): Record<string, string> {
  return { ...drafts, [taskId]: value };
}

function workflowLines(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function emptyWorkflowDraftConfiguration(): WorkflowConfiguration {
  return {
    purpose: "",
    preferences: [],
    criteria: [],
    guidance: [],
    procedures: [],
    resourceRequirements: [],
    resultConventions: [],
    approvedKnowledge: [],
  };
}

function guidanceDrafts(
  entries: WorkflowConfiguration["guidance"] | undefined,
): WorkflowGuidanceDraft[] {
  return (entries ?? []).map((entry) => ({
    id: entry.id,
    text: entry.text,
    appliesTo: entry.appliesTo.join("\n"),
  }));
}

export function removeWorkflowGuidanceEntry(
  entries: WorkflowGuidanceDraft[],
  id: string,
): WorkflowGuidanceDraft[] {
  return entries.filter((entry) => entry.id !== id);
}

export function removeWorkflowResourceEntry(
  entries: WorkflowResourceDraft[],
  id: string,
): WorkflowResourceDraft[] {
  return entries.filter((entry) => entry.id !== id);
}

function WorkflowGuidanceEditor({
  label,
  entries,
  defaultTopic,
  onChange,
}: {
  label: string;
  entries: WorkflowGuidanceDraft[];
  defaultTopic: WorkflowEditorDraft["focus"];
  onChange(entries: WorkflowGuidanceDraft[]): void;
}) {
  return (
    <fieldset className="workflow-entry-editor">
      <legend>{label}</legend>
      {entries.map((entry, index) => (
        <div className="workflow-entry-row" key={entry.id}>
          <label>
            <span>Entry {index + 1}</span>
            <textarea
              aria-label={`${label} entry ${index + 1}`}
              maxLength={2000}
              value={entry.text}
              onChange={(event) =>
                onChange(
                  entries.map((candidate) =>
                    candidate.id === entry.id
                      ? { ...candidate, text: event.target.value }
                      : candidate,
                  ),
                )
              }
            />
          </label>
          <label>
            <span>Relevant topics (one per line)</span>
            <textarea
              aria-label={`${label} topics ${index + 1}`}
              maxLength={1295}
              value={entry.appliesTo}
              onChange={(event) =>
                onChange(
                  entries.map((candidate) =>
                    candidate.id === entry.id
                      ? { ...candidate, appliesTo: event.target.value }
                      : candidate,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            className="danger-text"
            aria-label={`Remove ${label} entry ${index + 1}`}
            onClick={() =>
              onChange(removeWorkflowGuidanceEntry(entries, entry.id))
            }
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...entries,
            {
              id: `entry_${crypto.randomUUID()}`,
              text: "",
              appliesTo: defaultTopic === "custom" ? "" : defaultTopic,
            },
          ])
        }
      >
        Add entry
      </button>
    </fieldset>
  );
}

function WorkflowResourceEditor({
  entries,
  onChange,
}: {
  entries: WorkflowResourceDraft[];
  onChange(entries: WorkflowResourceDraft[]): void;
}) {
  return (
    <fieldset className="workflow-entry-editor">
      <legend>Required accounts, sites, or documents</legend>
      {entries.map((entry, index) => (
        <div className="workflow-entry-row" key={entry.id}>
          <label>
            <span>Resource type</span>
            <select
              aria-label={`Workflow resource type ${index + 1}`}
              value={entry.kind}
              onChange={(event) =>
                onChange(
                  entries.map((candidate) =>
                    candidate.id === entry.id
                      ? {
                          ...candidate,
                          kind: event.target
                            .value as WorkflowResourceDraft["kind"],
                        }
                      : candidate,
                  ),
                )
              }
            >
              <option value="account">Account</option>
              <option value="website">Website</option>
              <option value="document">Document</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            <span>Description only (no local paths or credentials)</span>
            <input
              aria-label={`Workflow resource description ${index + 1}`}
              maxLength={240}
              value={entry.label}
              onChange={(event) =>
                onChange(
                  entries.map((candidate) =>
                    candidate.id === entry.id
                      ? { ...candidate, label: event.target.value }
                      : candidate,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            className="danger-text"
            aria-label={`Remove Workflow resource ${index + 1}`}
            onClick={() =>
              onChange(removeWorkflowResourceEntry(entries, entry.id))
            }
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...entries,
            { id: `resource_${crypto.randomUUID()}`, kind: "other", label: "" },
          ])
        }
      >
        Add resource
      </button>
    </fieldset>
  );
}

export function workflowDraft(
  workflow?: WorkflowEnvironment,
): WorkflowEditorDraft {
  const configuration = workflow?.revision.configuration;
  const configuredTopics = configuration
    ? [
        ...configuration.preferences,
        ...configuration.criteria,
        ...configuration.guidance,
        ...configuration.procedures,
        ...configuration.resultConventions,
        ...configuration.approvedKnowledge,
      ].flatMap((entry) => entry.appliesTo)
    : [];
  const focus = ["research", "review", "outreach"].find((candidate) =>
    configuredTopics.includes(candidate),
  ) as WorkflowEditorDraft["focus"] | undefined;
  const resultStyle = configuration?.resultConventions.some((entry) =>
    /source/i.test(entry.text),
  )
    ? "sources"
    : configuration?.resultConventions.some((entry) =>
          /detail/i.test(entry.text),
        )
      ? "detailed"
      : "concise";
  return {
    ...(workflow
      ? {
          workflowId: workflow.workflowId,
          expectedRevision: workflow.currentRevision,
        }
      : {}),
    name: workflow?.name ?? "",
    purpose: configuration?.purpose ?? "",
    focus: focus ?? (workflow ? "custom" : "research"),
    preferences: guidanceDrafts(configuration?.preferences),
    criteria: guidanceDrafts(configuration?.criteria),
    guidance: guidanceDrafts(configuration?.guidance),
    procedures: guidanceDrafts(configuration?.procedures),
    resourceRequirements: (configuration?.resourceRequirements ?? []).map(
      (entry) => ({ ...entry }),
    ),
    resultStyle,
    approvedKnowledge: guidanceDrafts(configuration?.approvedKnowledge),
    ...(configuration
      ? {
          sourceConfiguration: configuration,
          sourceFocus: focus ?? "custom",
          sourceResultStyle: resultStyle,
        }
      : {}),
  };
}

export function workflowConfigurationFromDraft(
  draft: WorkflowEditorDraft,
): WorkflowConfiguration {
  const existing = draft.sourceConfiguration;
  const resultText = {
    sources: "Include sources and uncertainty with each Output.",
    concise: "Present concise, actionable Outputs.",
    detailed: "Present detailed Outputs with reasoning.",
  }[draft.resultStyle];
  return {
    purpose: draft.purpose.trim(),
    preferences: draft.preferences
      .filter((entry) => entry.text.trim())
      .map((entry) => ({
        id: entry.id,
        text: entry.text.trim(),
        appliesTo: workflowLines(entry.appliesTo),
      })),
    criteria: draft.criteria
      .filter((entry) => entry.text.trim())
      .map((entry) => ({
        id: entry.id,
        text: entry.text.trim(),
        appliesTo: workflowLines(entry.appliesTo),
      })),
    guidance: draft.guidance
      .filter((entry) => entry.text.trim())
      .map((entry) => ({
        id: entry.id,
        text: entry.text.trim(),
        appliesTo: workflowLines(entry.appliesTo),
      })),
    procedures: draft.procedures
      .filter((entry) => entry.text.trim())
      .map((entry) => ({
        id: entry.id,
        text: entry.text.trim(),
        appliesTo: workflowLines(entry.appliesTo),
      })),
    resourceRequirements: draft.resourceRequirements
      .filter((entry) => entry.label.trim())
      .map((entry) => ({ ...entry, label: entry.label.trim() })),
    resultConventions:
      existing && draft.resultStyle === draft.sourceResultStyle
        ? existing.resultConventions
        : [
            {
              id: `result_${crypto.randomUUID()}`,
              text: resultText,
              appliesTo: draft.focus === "custom" ? [] : [draft.focus],
            },
          ],
    approvedKnowledge: draft.approvedKnowledge
      .filter((entry) => entry.text.trim())
      .map((entry) => ({
        id: entry.id,
        text: entry.text.trim(),
        appliesTo: workflowLines(entry.appliesTo),
      })),
  };
}

export function workflowSynchronizationDisclosure(
  binding: WorkflowSyncBindingProjection | null,
  context: "editor" | "promotion",
): string {
  const location =
    binding?.eligibility === "owner_bound"
      ? binding.status === "conflicted"
        ? "This Workflow needs sync conflict resolution."
        : binding.status === "pending_delete"
          ? "Removal from your Rove account is pending. The local Workflow remains on this device."
          : binding.status === "deleted_remotely" ||
              binding.status === "absent_remotely"
            ? "The cloud Workflow is absent. The local Workflow remains on this device until you choose what to do."
            : binding.status === "unavailable" ||
                binding.status === "auth_required" ||
                binding.status === "transport_uncertain"
              ? "Changes are saved locally. Sync will resume when connection and account access are available."
              : binding.status === "error"
                ? "This Workflow is linked to your Rove account, but its current portable configuration cannot synchronize."
                : binding.status === "pending_upload"
                  ? "Changes are saved locally and pending synchronization with your Rove account."
                  : binding.status === "synchronized"
                    ? "Synced with your Rove account."
                    : "This Workflow is linked to your Rove account, but its synchronization status is not yet confirmed."
      : binding?.eligibility === "detached"
        ? "Stored on this device. It is no longer synchronized with your Rove account."
        : binding?.eligibility === "other_owner"
          ? "Stored on this device. It is not synchronized with the current Rove account."
          : context === "editor"
            ? "Stored on this device."
            : "This destination remains on this device.";
  const exclusions =
    context === "editor"
      ? " Secrets, credentials, local paths, task history, attachments, approvals, execution state, and browser state are excluded."
      : "";
  return `${location}${exclusions} Automated checks cannot guarantee detection of every secret you manually enter in reusable text.`;
}

export function currentOwnerWorkflowSyncBinding(
  desktop: DesktopSurfaceSnapshot | null,
  workflowId: string,
): WorkflowSyncBindingProjection | null {
  const binding = desktop?.workflowSync?.bindings[workflowId];
  if (!binding) return null;
  const account = desktop?.roveAccount;
  const ownerId = account?.status === "signed_in" ? account.ownerId : null;
  const exactOwnerBinding =
    ownerId !== null &&
    desktop.workflowSync?.signedInOwnerId === ownerId &&
    desktop.workflowSync.boundOwnerId === ownerId &&
    binding.eligibility === "owner_bound";
  if (exactOwnerBinding) return binding;
  if (
    binding.eligibility === "device_only" ||
    binding.eligibility === "detached"
  )
    return { eligibility: binding.eligibility, status: null };
  return { eligibility: "other_owner", status: null };
}

export function workflowSynchronizationBadge(
  binding: WorkflowSyncBindingProjection | null,
): string | null {
  if (!binding || binding.eligibility === "device_only") return null;
  if (binding.eligibility === "other_owner")
    return "Not synced to this account";
  if (binding.eligibility === "detached") return "This device only";
  if (binding.status === "synchronized") return "Synced";
  if (binding.status === "pending_upload") return "Pending upload";
  if (binding.status === "pending_delete") return "Pending cloud deletion";
  if (binding.status === "conflicted") return "Sync conflict";
  if (binding.status === "deleted_remotely") return "Deleted in cloud";
  if (binding.status === "absent_remotely") return "No longer in cloud";
  if (binding.status === "unavailable") return "Sync unavailable";
  if (binding.status === "auth_required") return "Sign-in required for sync";
  if (binding.status === "transport_uncertain") return "Sync outcome uncertain";
  if (binding.status === "error") return "Sync error";
  if (binding.status === "local_only") return "This device only";
  return "Sync status pending";
}

export function canRemoveWorkflowFromCloud(
  desktop: DesktopSurfaceSnapshot | null,
  workflowId: string,
): boolean {
  const binding = currentOwnerWorkflowSyncBinding(desktop, workflowId);
  return (
    binding?.eligibility === "owner_bound" && binding.status === "synchronized"
  );
}

function workspaceChoice(desktop: DesktopSurfaceSnapshot | null): string {
  const selected = desktop?.workspaces.selectedWorkspaceId;
  return selected === undefined ? "" : `workspace:${selected}`;
}

function workspaceName(
  desktop: DesktopSurfaceSnapshot | null,
  workspaceId: string,
): string {
  return (
    desktop?.workspaces.workspaces.find((entry) => entry.id === workspaceId)
      ?.displayName ?? "Unavailable workspace"
  );
}

export function taskNeedsCustomerInput(
  product: LocalProductSnapshot | null,
  taskId: string,
): boolean {
  return (
    product?.attention.some(
      (entry) =>
        entry.taskId === taskId &&
        entry.status === "pending" &&
        (entry.kind === "user_input" ||
          entry.continuationPolicy === "explicit_user_response"),
    ) ?? false
  );
}

export function taskHasUnresolvedAttention(
  product: LocalProductSnapshot | null,
  taskId: string,
): boolean {
  return (
    product?.attention.some(
      (entry) =>
        entry.taskId === taskId &&
        [
          "pending",
          "responding",
          "awaiting_confirmation",
          "resolution_unknown",
          "stale",
        ].includes(entry.status),
    ) ?? false
  );
}

export function browserIdentityLabel(
  desktop: DesktopSurfaceSnapshot | null,
  task: ProductTaskProjection | undefined,
): string {
  if (task?.runtime?.attachment !== "attached") return "No browser attached";
  if (task.browserIdentity?.mode === "workspace")
    return workspaceName(desktop, task.browserIdentity.workspaceId);
  if (task.browserIdentity?.mode === "temporary") return "Guest";
  return "No browser attached";
}

export function recordingLifecyclePresentation(state: RecordingState): {
  summary: string;
  stateLabel: string;
  actionLabel: string | null;
  canStop: boolean;
} {
  switch (state) {
    case "requested":
      return {
        summary: "Starting page recording…",
        stateLabel: "Starting…",
        actionLabel: "Starting page recording…",
        canStop: false,
      };
    case "recording":
      return {
        summary: "Page recording active",
        stateLabel: "Recording",
        actionLabel: "Stop page recording",
        canStop: true,
      };
    case "finalizing":
      return {
        summary: "Finalizing recording",
        stateLabel: "Finalizing…",
        actionLabel: "Finalizing recording…",
        canStop: false,
      };
    case "available":
      return {
        summary: "Recording available",
        stateLabel: "Available",
        actionLabel: "Open recording",
        canStop: false,
      };
    case "failed":
      return {
        summary: "Recording unavailable",
        stateLabel: "Failed",
        actionLabel: null,
        canStop: false,
      };
  }
}

export function localBackupExportStatus(
  result: Awaited<ReturnType<Window["rove"]["exportLocalBackup"]>>,
): string {
  if (result.status === "cancelled")
    return "Backup export cancelled. No backup was created.";
  return `${result.name} created with ${result.fileCount} files${
    result.missingCount > 0
      ? `; ${result.missingCount} missing or excluded entries are listed in its manifest`
      : ""
  }.`;
}

function attachmentTypeLabel(filename: string, mimeType: string): string {
  const extension = filename.includes(".")
    ? filename.split(".").at(-1)?.trim().toUpperCase()
    : undefined;
  if (extension) return extension.slice(0, 12);
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType === "application/pdf") return "PDF";
  return "FILE";
}

interface ComposerInputShellProps {
  attachments: readonly TaskAttachmentDescriptor[];
  busy: boolean;
  className?: string;
  children: ReactNode;
  onReplace(attachmentId: string): void;
  onRemove(attachmentId: string): void;
}

function ComposerInputShell({
  attachments,
  busy,
  className,
  children,
  onReplace,
  onRemove,
}: ComposerInputShellProps) {
  return (
    <div className={`composer-input-shell${className ? ` ${className}` : ""}`}>
      {attachments.length > 0 && (
        <div
          className="composer-attachment-rail"
          aria-label="Selected task attachments"
        >
          {attachments.map((attachment) => (
            <article
              className="composer-attachment-preview"
              key={attachment.id}
            >
              <button
                className="composer-attachment-main"
                type="button"
                aria-label={`Replace ${attachment.filename}`}
                title="Replace file"
                disabled={busy}
                onClick={() => onReplace(attachment.id)}
              >
                <span
                  className="composer-attachment-thumbnail"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24">
                    {attachment.mimeType.startsWith("image/") ? (
                      <>
                        <circle cx="8.5" cy="8" r="1.5" />
                        <path d="m4.5 18 5-5 3 3 2.5-2.5 4.5 4.5M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Z" />
                      </>
                    ) : (
                      <path d="M6 3.5h8l4 4V20.5H6v-17Zm8 0v4h4M9 12h6M9 15.5h6" />
                    )}
                  </svg>
                </span>
                <span className="composer-attachment-copy">
                  <strong>{attachment.filename}</strong>
                  <small>
                    {attachmentTypeLabel(
                      attachment.filename,
                      attachment.mimeType,
                    )}
                  </small>
                </span>
              </button>
              <button
                className="composer-attachment-remove"
                type="button"
                aria-label={`Remove ${attachment.filename}`}
                title="Remove file"
                disabled={busy}
                onClick={() => onRemove(attachment.id)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </article>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

function ComposerAttachButton({
  busy,
  onPick,
}: {
  busy: boolean;
  onPick(): void;
}) {
  return (
    <div className="attachment-composer" aria-label="Task attachments">
      <button
        className="attachment-button"
        aria-label="Attach files"
        type="button"
        disabled={busy}
        onClick={onPick}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

function ConversationAttachments({
  attachments,
  taskId,
}: {
  attachments: NonNullable<ProjectedConversationItem["attachments"]>;
  taskId: string;
}) {
  return (
    <div className="message-attachment-rail" aria-label="Sent attachments">
      {attachments.map((attachment, index) => (
        <ConversationAttachment
          attachment={attachment}
          key={`${attachment.filename}:${attachment.kind}:${index}`}
          taskId={taskId}
        />
      ))}
    </div>
  );
}

function ConversationAttachment({
  attachment,
  taskId,
}: {
  attachment: NonNullable<ProjectedConversationItem["attachments"]>[number];
  taskId: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (attachment.kind !== "image") return () => undefined;
    void window.rove
      .getTaskAttachmentPreview?.(taskId, attachment.filename)
      .then((value) => {
        if (active) setPreview(value ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [attachment.filename, attachment.kind, taskId]);
  return (
    <div
      className={`message-attachment-card${preview ? " message-attachment-card-image" : ""}`}
    >
      {preview ? (
        <img
          className="message-attachment-preview"
          src={preview}
          alt={attachment.filename}
        />
      ) : (
        <span className="message-attachment-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            {attachment.kind === "image" ? (
              <>
                <circle cx="8.5" cy="8" r="1.5" />
                <path d="m4.5 18 5-5 3 3 2.5-2.5 4.5 4.5M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Z" />
              </>
            ) : (
              <path d="M6 3.5h8l4 4V20.5H6v-17Zm8 0v4h4M9 12h6M9 15.5h6" />
            )}
          </svg>
        </span>
      )}
      <span>
        <strong>{attachment.filename}</strong>
        <small>{attachment.kind.toUpperCase()}</small>
      </span>
    </div>
  );
}

function closeParentMenu(event: MouseEvent<HTMLButtonElement>): void {
  event.currentTarget.closest("details")?.removeAttribute("open");
}

export function compatibleReasoningEffort(
  model: Pick<CodexModelProjection, "efforts" | "defaultEffort">,
  currentEffort: string,
): string {
  return model.efforts.includes(currentEffort)
    ? currentEffort
    : model.defaultEffort;
}

function displayReasoningEffort(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : "Default";
}

function ComposerModeMenu({
  mode,
  onChange,
}: {
  mode: ExecutionMode;
  onChange?: (mode: ExecutionMode) => void;
}) {
  const label =
    mode === "agent" ? "Agent" : mode === "companion" ? "Companion" : "Capture";
  return (
    <details className="composer-menu composer-mode-menu">
      <summary aria-label={`Participation mode: ${label}`}>
        <span>{label}</span>
        <svg
          className="composer-chevron"
          aria-hidden="true"
          viewBox="0 0 16 16"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </summary>
      <div className="composer-popover compact-popover">
        {onChange ? (
          <section>
            <strong>Participation mode</strong>
            {(
              [
                ["agent", "Agent", "Rove completes the task"],
                ["companion", "Companion", "Work together with handoffs"],
                ["capture", "Capture", "You drive the browser"],
              ] as const
            ).map(([value, optionLabel, description]) => (
              <button
                key={value}
                type="button"
                aria-label={`Execution mode: ${optionLabel}`}
                aria-pressed={mode === value}
                onClick={(event) => {
                  onChange(value);
                  closeParentMenu(event);
                }}
              >
                <span>{optionLabel}</span>
                <small>{description}</small>
              </button>
            ))}
          </section>
        ) : (
          <div className="task-frozen-option">
            <span>{label}</span>
            <small>Fixed for this task</small>
          </div>
        )}
      </div>
    </details>
  );
}

function ComposerPermissionMenu({
  approvalsReviewer,
  mode,
  onChange,
}: {
  approvalsReviewer: ApprovalsReviewer;
  mode: ExecutionMode;
  onChange?: (approvalsReviewer: ApprovalsReviewer) => void;
}) {
  const label =
    approvalsReviewer === "auto_review" ? "Approve for me" : "Always ask";
  return (
    <details className="composer-menu composer-permission-menu">
      <summary aria-label={`Approval policy: ${label}`}>
        <svg
          className="composer-control-icon"
          aria-hidden="true"
          viewBox="0 0 20 20"
        >
          <path d="M10 2.5 16 5v4.3c0 3.7-2.35 6.55-6 8.2-3.65-1.65-6-4.5-6-8.2V5l6-2.5Z" />
          <path d="m7.4 10 1.65 1.65 3.55-3.55" />
        </svg>
        <span>{label}</span>
        <svg
          className="composer-chevron"
          aria-hidden="true"
          viewBox="0 0 16 16"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </summary>
      <div className="composer-popover compact-popover">
        {onChange ? (
          <section>
            <strong>Approval policy</strong>
            <button
              type="button"
              aria-pressed={approvalsReviewer === "auto_review"}
              disabled={mode === "capture"}
              onClick={(event) => {
                onChange("auto_review");
                closeParentMenu(event);
              }}
            >
              <span>Approve for me</span>
              <small>Rove reviews routine requests</small>
            </button>
            <button
              type="button"
              aria-pressed={approvalsReviewer === "user"}
              disabled={mode === "capture"}
              onClick={(event) => {
                onChange("user");
                closeParentMenu(event);
              }}
            >
              <span>Always ask</span>
              <small>You review every request</small>
            </button>
          </section>
        ) : (
          <div className="task-frozen-option">
            <span>{label}</span>
            <small>Fixed for this task</small>
          </div>
        )}
      </div>
    </details>
  );
}

function ComposerModelMenu({
  models,
  modelId,
  effort,
  onModelChange,
  onEffortChange,
}: {
  models: readonly CodexModelProjection[];
  modelId: string;
  effort: string;
  onModelChange?: (model: CodexModelProjection) => void;
  onEffortChange?: (effort: string) => void;
}) {
  const selected = models.find((entry) => entry.id === modelId);
  const modelLabel = selected?.displayName ?? (modelId || "Default model");
  const effortLabel = displayReasoningEffort(effort);
  return (
    <details className="composer-menu composer-model-menu">
      <summary
        aria-label={`Model and reasoning effort: ${modelLabel}, ${effortLabel}`}
      >
        <span className="composer-control-icon" aria-hidden="true">
          ✦
        </span>
        <span className="composer-model-label">{modelLabel}</span>
        <small className="composer-current-effort">{effortLabel}</small>
        <svg
          className="composer-chevron"
          aria-hidden="true"
          viewBox="0 0 16 16"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </summary>
      <div className="composer-popover model-popover">
        {onModelChange && onEffortChange ? (
          <>
            <section>
              <strong>Model</strong>
              {models.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-label={`Model: ${entry.displayName}`}
                  aria-pressed={modelId === entry.id}
                  onClick={() => onModelChange(entry)}
                >
                  <span>{entry.displayName}</span>
                </button>
              ))}
            </section>
            <section>
              <strong>Reasoning</strong>
              {selected?.efforts.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`Reasoning effort: ${displayReasoningEffort(value)}`}
                  aria-pressed={effort === value}
                  onClick={(event) => {
                    onEffortChange(value);
                    closeParentMenu(event);
                  }}
                >
                  <span>{displayReasoningEffort(value)}</span>
                </button>
              ))}
            </section>
          </>
        ) : (
          <div className="task-frozen-option">
            <span>{modelLabel}</span>
            <small>
              {effort
                ? `${effortLabel} reasoning · fixed for this task`
                : "Fixed for this task"}
            </small>
          </div>
        )}
      </div>
    </details>
  );
}

function attentionCopy(entry: ProductAttentionProjection): string {
  if (entry.instruction) return entry.instruction;
  if (entry.elicitation) return entry.elicitation.message;
  if (entry.status === "stale")
    return "This request belongs to an earlier App Server connection and cannot be answered.";
  if (entry.status === "resolution_unknown")
    return "The response outcome is unresolved. Rove will not submit it again.";
  return {
    command_approval: "Codex wants to run a command.",
    file_approval: "Codex wants to change files.",
    network_approval: "Codex is requesting network access.",
    permission_approval:
      "Codex is requesting additional permission for this turn.",
    mcp_elicitation: "A connected tool needs a decision or value.",
    user_input: "Codex needs an answer before it can continue.",
    control_handoff: "Rove needs you to take control of the browser.",
  }[entry.kind];
}

function attentionStateKey(entry: ProductAttentionProjection): string {
  return JSON.stringify([
    entry.requestId,
    entry.taskId,
    entry.threadId ?? null,
    entry.turnId ?? null,
    entry.itemId ?? null,
    entry.generation,
  ]);
}
function unsetSelectValue(field: ProductElicitationField): string {
  let value = `__rove_unset__:${field.id}`;
  while (field.options?.some((option) => option.value === value))
    value = `_${value}`;
  return value;
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/^.*\//, "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function commandPaletteMatches(
  query: string,
  ...terms: string[]
): boolean {
  const normalized = query.trim().toLowerCase();
  return (
    !normalized || terms.some((term) => term.toLowerCase().includes(normalized))
  );
}

function activityCopy(item: ProjectedConversationItem): {
  label: string;
  detail?: string;
} {
  const name = item.title ?? "";
  const browserAction = name.replace(/^.*\/browser\./, "");
  const browserLabels: Record<string, string> = {
    inspect: "Reading the current page",
    screenshot: "Capturing the current page",
    interact: "Interacting with the page",
    navigate: "Opening a page",
    open_page: "Opening a new page",
    pages: "Checking open pages",
    switch_page: "Switching pages",
    close_page: "Closing a page",
    resolve_target: "Finding an element on the page",
    scroll: "Scrolling the page",
    back: "Going back",
    forward: "Going forward",
    transaction_begin: "Preparing a browser action",
    transaction_advance: "Continuing a browser action",
    transaction_verify: "Verifying the browser action",
    transaction_status: "Checking the browser action",
    transaction_cancel: "Stopping the browser action",
  };
  if (item.kind === "tool" && browserLabels[browserAction])
    return { label: browserLabels[browserAction]! };
  if (item.kind === "tool" && /\/evidence\.list$/.test(name))
    return { label: "Reviewing saved evidence" };
  if (item.kind === "tool" && /\/session\.status$/.test(name))
    return { label: "Checking the browser session" };
  if (item.kind === "tool" && /\/control\.request_human$/.test(name))
    return { label: "Requesting browser control" };
  if (item.kind === "tool")
    return {
      label: name ? humanizeIdentifier(name) : "Using a connected tool",
    };
  if (item.kind === "plan")
    return { label: item.text ?? item.title ?? "Planning the next steps" };
  if (item.kind === "command")
    return {
      label: "Running a local command",
      ...(name ? { detail: name } : {}),
    };
  if (item.kind === "file_change")
    return { label: item.title ?? "Updating files" };
  return {
    label: item.text ?? item.title ?? item.progress ?? "Working",
  };
}

const TASK_TITLE_STORAGE_KEY = "rove.task-titles.v1";
const THEME_STORAGE_KEY = "rove.theme-preference.v1";
const SIDEBAR_STORAGE_KEY = "rove.sidebar-collapsed.v1";
type ThemePreference = "system" | "light" | "dark";

function loadThemePreference(): ThemePreference {
  try {
    const value = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function loadSidebarCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function formatMessageTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function messageText(item: ProjectedConversationItem): string {
  return (
    item.text ??
    item.title ??
    (item.kind === "user_message" ? "Message" : "Update")
  );
}

function normalizedMarkdown(text: string): string {
  const marker = "ROVE_LIVE_RESULT ";
  const markerAt = text.indexOf(marker);
  const candidate =
    markerAt >= 0 ? text.slice(markerAt + marker.length).trim() : text.trim();
  if (
    markerAt < 0 &&
    !(candidate.startsWith("{") || candidate.startsWith("["))
  ) {
    return text;
  }
  try {
    const value = JSON.parse(candidate) as unknown;
    const json = `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
    return markerAt >= 0
      ? `${text.slice(0, markerAt).trimEnd()}\n\nROVE_LIVE_RESULT\n\n${json}`.trimStart()
      : json;
  } catch {
    return text;
  }
}

function MessageBody({ text }: { text: string }) {
  return (
    <div className="message-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <span className="message-link" title={href}>
              {children}
            </span>
          ),
          img: ({ src, alt }) => (
            <span className="message-image-reference" title={src}>
              {alt ? `Image: ${alt}` : "Image attachment"}
            </span>
          ),
        }}
      >
        {normalizedMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
}

function loadTaskTitles(): Record<string, string> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(TASK_TITLE_STORAGE_KEY) ?? "{}",
    );
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].trim().length > 0,
      ),
    );
  } catch {
    return {};
  }
}
export function permissionReviewDescription(
  mode: ExecutionMode,
  approvalsReviewer: ApprovalsReviewer,
): string {
  if (mode === "capture")
    return "Permission review is unused in Capture mode because Capture starts no Codex turn.";
  return approvalsReviewer === "auto_review"
    ? "Routine eligible requests are reviewed automatically; important handoffs can still pause for you."
    : "Codex will pause and ask you to review permission requests.";
}

export function LocalBackupSettings({
  busy,
  status,
  onExport,
}: {
  busy: boolean;
  status: string | null;
  onExport(): void;
}) {
  return (
    <section className="settings-data" aria-labelledby="local-data-title">
      <div>
        <strong id="local-data-title">Local data</strong>
        <p>
          Export task history, evidence, recordings, and attachments. The backup
          may contain sensitive task content. Rove excludes its managed
          credential stores, browser profiles, and arbitrary task workspace
          files.
        </p>
      </div>
      <button type="button" disabled={busy} onClick={onExport}>
        Export local backup…
      </button>
      {status && <p role="status">{status}</p>}
      <small>
        This is a device-local backup, not Workflow sync. Restore is not
        available yet; Rove will not overwrite active data with this folder.
      </small>
    </section>
  );
}

export function ArchivedTaskSettings({
  product,
  busy,
  titleForTask,
  onOpen,
  onRestore,
}: {
  product: LocalProductSnapshot | null;
  busy: boolean;
  titleForTask(task: ProductTaskProjection): string;
  onOpen(task: ProductTaskProjection): void;
  onRestore(task: ProductTaskProjection): void;
}) {
  const tasks = archivedProductTasks(product);
  return (
    <section
      className="settings-archive"
      aria-labelledby="archived-tasks-title"
    >
      <header>
        <div>
          <h3 id="archived-tasks-title">Archived tasks</h3>
          <p>Read or restore tasks preserved on this device.</p>
        </div>
      </header>
      {tasks.length === 0 ? (
        <div className="settings-empty-state">
          <strong>No archived tasks</strong>
          <span>Tasks you archive will appear here.</span>
        </div>
      ) : (
        <div className="settings-archive-list">
          {tasks.map((entry) => (
            <article
              className="settings-archive-row"
              key={entry.taskId}
              data-needs-input={
                taskHasUnresolvedAttention(product, entry.taskId)
                  ? "true"
                  : undefined
              }
            >
              <button
                className="settings-archive-open"
                type="button"
                aria-label={`Read archived task: ${entry.taskId}`}
                onClick={() => onOpen(entry)}
              >
                <strong>{titleForTask(entry)}</strong>
                <span>
                  {taskHasUnresolvedAttention(product, entry.taskId)
                    ? "Needs attention · Preserved locally"
                    : "Preserved locally"}
                </span>
              </button>
              <button
                className="settings-archive-restore"
                type="button"
                disabled={busy}
                onClick={() => onRestore(entry)}
              >
                Restore
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function RoveAccountSettings({
  desktop,
  busy,
  email,
  code,
  status,
  onEmail,
  onCode,
  run,
}: {
  desktop: DesktopSurfaceSnapshot | null;
  busy: boolean;
  email: string;
  code: string;
  status: string | null;
  onEmail(value: string): void;
  onCode(value: string): void;
  run(operation: () => Promise<unknown>, success?: string): void;
}) {
  const account = desktop?.roveAccount;
  const sync = desktop?.workflowSync;
  const signedIn = account?.status === "signed_in";
  const canExport = Boolean(
    signedIn &&
    sync?.boundOwnerId &&
    sync.boundOwnerId === sync.signedInOwnerId &&
    sync.exportableWorkflowCount > 0,
  );
  const actionableSyncItems = (desktop?.product?.workflows ?? []).flatMap(
    (workflow) => {
      const binding = currentOwnerWorkflowSyncBinding(
        desktop,
        workflow.workflowId,
      );
      return binding?.eligibility === "owner_bound" &&
        (binding.status === "conflicted" ||
          binding.status === "deleted_remotely" ||
          binding.status === "absent_remotely")
        ? [
            {
              workflowId: workflow.workflowId,
              status: binding.status,
            },
          ]
        : [];
    },
  );
  return (
    <section className="settings-data" aria-labelledby="rove-account-title">
      <div>
        <strong id="rove-account-title">Rove account and Workflow sync</strong>
        <p>
          A Rove account is optional. It synchronizes only portable Workflow
          configuration and is independent of your Codex/ChatGPT connection.
        </p>
      </div>
      {account?.status === "unconfigured" || !account ? (
        <small>
          Workflow sync is not configured in this build. Local tasks and
          Workflows remain available.
        </small>
      ) : signedIn ? (
        <>
          <p>
            Signed in as <strong>{account.email ?? "Rove account"}</strong>
          </p>
          {sync?.status === "account_mismatch" ? (
            <>
              <p role="alert">
                This device was linked to another Rove account. Nothing will
                sync until you confirm the switch.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => window.rove.bindWorkflowSync(true))}
              >
                Use this account on this device
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(() =>
                  sync?.boundOwnerId
                    ? window.rove.synchronizeWorkflows()
                    : window.rove.bindWorkflowSync(),
                )
              }
            >
              {sync?.status === "syncing"
                ? "Synchronizing…"
                : "Sync Workflows now"}
            </button>
          )}
          {sync?.status === "unavailable" && (
            <p role="status">
              Sync is unavailable. Local Workflows still work and changes remain
              on this device. {sync.lastError}
            </p>
          )}
          {sync?.status === "auth_required" && (
            <p role="alert">
              Workflow sync needs you to sign in again. Local Workflows and
              changes remain on this device.
            </p>
          )}
          {sync?.status === "transport_uncertain" && (
            <p role="status">
              A sync request has an uncertain outcome. Rove will reconcile it
              safely before retrying; local Workflows remain available.
            </p>
          )}
          {sync?.status === "error" && (
            <p role="alert">
              A Workflow configuration was rejected and will not be retried
              until it changes. Local Workflows and tasks remain available.
            </p>
          )}
          {actionableSyncItems.length > 0 && (
            <div role="alert">
              <p>
                Some Workflows need a conflict or deletion choice. Rove has kept
                the local versions unchanged.
              </p>
              {actionableSyncItems.map(({ workflowId, status }) => (
                <div key={workflowId}>
                  <strong>
                    {desktop?.product?.workflows.find(
                      (workflow) => workflow.workflowId === workflowId,
                    )?.name ?? "Workflow"}
                  </strong>
                  {status === "conflicted" ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              window.rove.resolveWorkflowSync(
                                workflowId,
                                "keep_local",
                              ),
                            "Kept the device version and synchronized it.",
                          )
                        }
                      >
                        Keep this device
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              window.rove.resolveWorkflowSync(
                                workflowId,
                                "keep_remote",
                              ),
                            "Kept the cloud version.",
                          )
                        }
                      >
                        Keep cloud
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              window.rove.resolveWorkflowSync(
                                workflowId,
                                "create_copy",
                              ),
                            "Kept a local copy and applied the cloud version.",
                          )
                        }
                      >
                        Keep both
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () =>
                            window.rove.resolveWorkflowSync(
                              workflowId,
                              "keep_device_only",
                            ),
                          "Kept this Workflow on this device only.",
                        )
                      }
                    >
                      Keep on this device only
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () => window.rove.signOutRoveAccount(),
                "Signed out. Device-local data was kept.",
              )
            }
          >
            Sign out
          </button>
          <button
            className="danger-text"
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Delete this Rove cloud account and its synchronized Workflow configuration? Device-local tasks, results, recordings, artifacts, and Workflows will stay on this device.",
                )
              )
                run(
                  () => window.rove.deleteRoveCloudAccount(),
                  "Cloud account deleted. Device-local data was kept.",
                );
            }}
          >
            Delete cloud account…
          </button>
        </>
      ) : (
        <>
          <label>
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => onEmail(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !email.trim()}
            onClick={() =>
              run(
                () => window.rove.sendRoveEmailCode(email),
                "Check your email for the six-digit Rove sign-in code.",
              )
            }
          >
            Email me a code
          </button>
          {account.status === "email_code_sent" && (
            <>
              <label>
                <span>Six-digit code</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) =>
                    onCode(event.target.value.replace(/\D/g, ""))
                  }
                />
              </label>
              <button
                type="button"
                disabled={busy || code.length !== 6}
                onClick={() =>
                  run(
                    () => window.rove.verifyRoveEmailCode(code),
                    "Signed in to Rove.",
                  )
                }
              >
                Verify code
              </button>
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => window.rove.beginRoveGoogleSignIn())}
          >
            Continue with Google
          </button>
          {account.status === "error" && <p role="alert">{account.message}</p>}
        </>
      )}
      <button
        type="button"
        disabled={busy || !desktop?.product || !canExport}
        onClick={() =>
          run(
            () =>
              window.rove.exportPortableWorkflows().then((result) => {
                if (result.status === "created")
                  return `${result.name} created with ${result.workflowCount} Workflows.`;
              }),
            "Portable Workflow export finished.",
          )
        }
      >
        Export synchronized Workflows…
      </button>
      {!canExport && (
        <small>
          Sign in to the linked Rove account and synchronize at least one
          Workflow to enable this owner-scoped export.
        </small>
      )}
      {status && <p role="status">{status}</p>}
      <small>
        Never synchronized: task conversations, results, recordings,
        attachments, credentials, cookies, approvals, browser/live state, local
        paths, or execution state.
      </small>
    </section>
  );
}

type SettingsSection = "appearance" | "archived-tasks" | "account-sync";

export function SettingsNavigation({
  active,
  archivedTaskCount,
  onSelect,
}: {
  active: SettingsSection;
  archivedTaskCount: number;
  onSelect(section: SettingsSection): void;
}) {
  return (
    <nav className="settings-navigation" aria-label="Settings sections">
      <button
        type="button"
        aria-current={active === "appearance" ? "page" : undefined}
        onClick={() => onSelect("appearance")}
      >
        Appearance
      </button>
      <button
        type="button"
        aria-current={active === "archived-tasks" ? "page" : undefined}
        onClick={() => onSelect("archived-tasks")}
      >
        <span>Archived tasks</span>
        {archivedTaskCount > 0 && <small>{archivedTaskCount}</small>}
      </button>
      <button
        type="button"
        aria-current={active === "account-sync" ? "page" : undefined}
        onClick={() => onSelect("account-sync")}
      >
        Account &amp; sync
      </button>
    </nav>
  );
}

export function TaskArchiveConfirmation({
  busy,
  archiving,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  archiving: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <div
      className="profile-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className="profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-task-title"
      >
        <header>
          <div>
            <div className="eyebrow">Task history</div>
            <h2 id="archive-task-title">Archive this task?</h2>
            <p>
              It will be removed from Task History. You can restore it later.
            </p>
          </div>
        </header>
        {error && (
          <div className="product-error modal-error" role="alert">
            <strong>Rove needs attention</strong>
            <span>{error}</span>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="primary"
            type="button"
            disabled={busy || archiving}
            onClick={onConfirm}
          >
            Archive
          </button>
        </div>
      </section>
    </div>
  );
}

export function ProductSurface({
  desktop,
  connectionError,
  follower,
  refresh,
}: ProductSurfaceProps) {
  const product = desktop?.product ?? null;
  const currentTask = activeProductTask(product);
  const activeTask = follower
    ? (product?.tasks.find(
        (task) => task.roveSessionId === desktop?.companion?.session.id,
      ) ?? currentTask)
    : currentTask;
  const unmatchedSession = unmatchedRuntimeSession(desktop);
  const legacyView = toCompanionViewModel(
    desktop?.companion ?? null,
    desktop?.notice ?? null,
  );
  const presentation = follower
    ? desktop?.surface.presentation === "expanded"
      ? "expanded"
      : "chip"
    : "full";
  const [outcome, setOutcome] = useState("");
  const [followupDrafts, setFollowupDrafts] = useState<Record<string, string>>(
    {},
  );
  const [mode, setMode] = useState<ExecutionMode>("agent");
  const [browserChoice, setBrowserChoice] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [approvalsReviewer, setApprovalsReviewer] =
    useState<ApprovalsReviewer>("auto_review");
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const [profileManagerOpen, setProfileManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("appearance");
  const [themePreference, setThemePreference] =
    useState<ThemePreference>(loadThemePreference);
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState(loadSidebarCollapsed);
  const [windowFullscreen, setWindowFullscreen] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(
    null,
  );
  const [attentionAnswers, setAttentionAnswers] = useState<
    Record<string, Record<string, string[]>>
  >({});
  const [attentionForms, setAttentionForms] = useState<
    Record<string, Record<string, string | number | boolean | string[]>>
  >({});
  const [busy, setBusy] = useState(false);
  const [archivingTaskIds, setArchivingTaskIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [archiveTaskId, setArchiveTaskId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [roveEmail, setRoveEmail] = useState("");
  const [roveCode, setRoveCode] = useState("");
  const [roveAccountStatus, setRoveAccountStatus] = useState<string | null>(
    null,
  );
  const [recordingConfirmed, setRecordingConfirmed] = useState(false);
  const [login, setLogin] = useState<LoginProjection | null>(null);
  const [codexRecoveryOpen, setCodexRecoveryOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [archivedPreviewTaskId, setArchivedPreviewTaskId] = useState<
    string | null
  >(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [workflowCreateName, setWorkflowCreateName] = useState<string | null>(
    null,
  );
  const [selectedWorkflowWorkspaceId, setSelectedWorkflowWorkspaceId] =
    useState<string | null>(null);
  const [workflowWorkspaceSection, setWorkflowWorkspaceSection] = useState<
    "home" | "outputs" | "context"
  >("home");
  const [selectedWorkflowOutputId, setSelectedWorkflowOutputId] = useState<
    string | null
  >(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [shareWorkflowContext, setShareWorkflowContext] = useState<
    "" | "share" | "local"
  >("");
  const [workflowEditor, setWorkflowEditor] =
    useState<WorkflowEditorDraft | null>(null);
  const [workflowContextEditSection, setWorkflowContextEditSection] = useState<
    "goal" | "help" | "success" | "knowledge" | "advanced" | null
  >(null);
  const [workflowPromotion, setWorkflowPromotion] =
    useState<WorkflowPromotionDraft | null>(null);
  const [resultEditor, setResultEditor] = useState<ResultEditorDraft | null>(
    null,
  );
  const activeModal =
    archiveTaskId !== null
      ? "archive"
      : workflowCreateName !== null
        ? "workflow-create"
        : workflowEditor && !selectedWorkflowWorkspaceId
          ? "workflow"
          : resultEditor
            ? "result"
            : workflowPromotion
              ? "promotion"
              : profileManagerOpen
                ? "profiles"
                : settingsOpen
                  ? "settings"
                  : codexRecoveryOpen
                    ? "codex"
                    : null;
  const [taskTitles, setTaskTitles] = useState<Record<string, string>>({});
  const [taskContextMenu, setTaskContextMenu] = useState<{
    taskId: string;
    x: number;
    y: number;
  } | null>(null);
  const [renamingTaskId, setRenamingTaskId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [timelineNow, setTimelineNow] = useState(() => Date.now());
  const [openWorkTurnIds, setOpenWorkTurnIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const initializedDefaults = useRef(false);
  const previousCurrentTaskId = useRef(activeTask?.taskId ?? null);
  const dragPointer = useRef<number | null>(null);
  const outcomeComposer = useRef<HTMLTextAreaElement | null>(null);
  const followupComposer = useRef<HTMLTextAreaElement | null>(null);
  const savingOutputItemIds = useRef(new Set<string>());

  useEffect(() => {
    if (activeModal !== null) setOperationError(null);
  }, [activeModal]);

  useEffect(() => {
    const dismissOpenMenus = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof globalThis.Node)) return;
      document
        .querySelectorAll<HTMLDetailsElement>(
          ".account-menu[open], .app-menu[open], .composer-menu[open], .profile-actions[open], .task-more-menu[open]",
        )
        .forEach((menu) => {
          if (!menu.contains(target)) menu.open = false;
        });
      if (!(target as Element).closest?.(".task-context-menu")) {
        setTaskContextMenu(null);
        setRenamingTaskId(null);
      }
    };
    const dismissOpenMenusWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      document
        .querySelectorAll<HTMLDetailsElement>(
          ".account-menu[open], .app-menu[open], .composer-menu[open], .profile-actions[open], .task-more-menu[open]",
        )
        .forEach((menu) => {
          menu.open = false;
          menu.querySelector<HTMLElement>("summary")?.focus();
        });
      setProfileManagerOpen(false);
      setSettingsOpen(false);
      setCodexRecoveryOpen(false);
      setTaskContextMenu(null);
      setRenamingTaskId(null);
    };
    document.addEventListener("pointerdown", dismissOpenMenus);
    document.addEventListener("keydown", dismissOpenMenusWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", dismissOpenMenus);
      document.removeEventListener("keydown", dismissOpenMenusWithKeyboard);
    };
  }, []);

  useEffect(() => {
    setTaskTitles(loadTaskTitles());
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (themePreference === "system") delete root.dataset.roveTheme;
    else root.dataset.roveTheme = themePreference;
    try {
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, themePreference);
    } catch {
      // A read-only browser context can still use the selected theme this run.
    }
  }, [themePreference]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(
        SIDEBAR_STORAGE_KEY,
        String(sidebarCollapsed),
      );
    } catch {
      // A read-only browser context can still collapse the sidebar this run.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    let active = true;
    void window.rove
      .getWindowFullscreen()
      .then((fullscreen) => {
        if (active) setWindowFullscreen(fullscreen);
      })
      .catch(() => {
        if (active) setWindowFullscreen(false);
      });
    const unsubscribe = window.rove.subscribeWindowFullscreen((fullscreen) => {
      if (active) setWindowFullscreen(fullscreen);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (initializedDefaults.current || desktop === null) return;
    initializedDefaults.current = true;
    setBrowserChoice(workspaceChoice(desktop));
    const preferred =
      product?.catalog.models.find((entry) => entry.isDefault) ??
      product?.catalog.models[0];
    if (preferred) {
      setModel(preferred.id);
      setEffort(preferred.defaultEffort);
    }
  }, [desktop, product]);

  const selectedModel = product?.catalog.models.find(
    (entry) => entry.id === model,
  );
  const selectComposerModel = (entry: CodexModelProjection) => {
    setModel(entry.id);
    setEffort(compatibleReasoningEffort(entry, effort));
  };
  const archivedPreviewTask = product?.tasks.find(
    (entry) =>
      entry.taskId === archivedPreviewTaskId &&
      entry.conversation?.archived === true,
  );
  const viewedTask = showNewTask
    ? undefined
    : (archivedPreviewTask ??
      product?.tasks.find((entry) => entry.taskId === selectedTaskId) ??
      activeTask);
  const workflowWorkspace = workflowWorkspaceProjection(
    product,
    selectedWorkflowWorkspaceId ?? "",
  );
  const selectedWorkflow = workflowWorkspace.workflow;
  const selectedWorkflowOutput = workflowWorkspace.outputs.find(
    ({ result }) => result.resultId === selectedWorkflowOutputId,
  );
  const followup = followupDraftForTask(followupDrafts, viewedTask?.taskId);
  const setFollowup = (value: string) => {
    if (!viewedTask) return;
    setFollowupDrafts((current) =>
      withTaskFollowupDraft(current, viewedTask.taskId, value),
    );
  };
  const viewedTaskControl = taskControlProjection(viewedTask, product);
  const activeTaskControl = taskControlProjection(activeTask, product);
  useEffect(() => {
    setSelectedTaskId((current) =>
      reconcileSelectedTaskId(current, previousCurrentTaskId.current, product),
    );
    previousCurrentTaskId.current = activeTask?.taskId ?? null;
  }, [activeTask?.taskId, product]);
  useEffect(() => {
    if (archivedPreviewTaskId && !archivedPreviewTask)
      setArchivedPreviewTaskId(null);
  }, [archivedPreviewTask, archivedPreviewTaskId]);
  useEffect(() => {
    if (selectedModel && !selectedModel.efforts.includes(effort))
      setEffort(selectedModel.defaultEffort);
  }, [effort, selectedModel]);
  useEffect(() => {
    const textarea = outcomeComposer.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const maximumHeight = 240;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maximumHeight)}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maximumHeight ? "auto" : "hidden";
  }, [outcome]);
  useEffect(() => {
    const textarea = followupComposer.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const maximumHeight = 180;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maximumHeight)}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maximumHeight ? "auto" : "hidden";
  }, [followup]);

  useEffect(() => {
    if (viewedTask?.conversation?.turnStatus !== "in_progress") return;
    setTimelineNow(Date.now());
    const timer = window.setInterval(() => setTimelineNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [viewedTask?.conversation?.turnStatus, viewedTask?.taskId]);
  useEffect(() => {
    const activeTurnId = viewedTask?.conversation?.activeTurnId;
    if (!activeTurnId || viewedTask?.conversation?.turnStatus !== "in_progress")
      return;
    const activeItems = Object.values(viewedTask.conversation.items).filter(
      (item) => item.turnId === activeTurnId,
    );
    const lastInput = activeItems
      .filter((item) => item.kind === "user_message")
      .at(-1);
    const segmentId =
      lastInput?.id ??
      (activeItems[0]
        ? `work:${activeTurnId}:${activeItems[0].id}`
        : activeTurnId);
    setOpenWorkTurnIds((current) => new Set(current).add(segmentId));
  }, [
    viewedTask?.conversation?.activeTurnId,
    viewedTask?.conversation?.turnStatus,
  ]);
  const gate = composerGate(desktop, {
    outcome,
    mode,
    browserChoice,
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
  });
  const error = operationError;
  const activeAttention =
    product?.attention.filter((entry) =>
      [
        "pending",
        "responding",
        "awaiting_confirmation",
        "resolution_unknown",
        "stale",
      ].includes(entry.status),
    ) ?? [];
  const taskAttention = activeAttention.filter(
    (entry) => viewedTask !== undefined && entry.taskId === viewedTask.taskId,
  );
  const codexAttention = taskAttention.filter(
    (entry) => entry.authority === "codex",
  );
  const currentCodexAttention = [...codexAttention].sort(
    (left, right) => left.sequence - right.sequence,
  )[0];
  const browserHandoff = taskAttention.find(
    (entry) => entry.authority === "rove_control",
  );
  const viewedCompanion =
    viewedTask?.roveSessionId !== undefined &&
    desktop?.companion?.session.id === viewedTask.roveSessionId
      ? desktop.companion
      : null;
  const fileAttention = product?.fileAttention ?? [];
  const awaitingExplicitResponse = taskAttention.some(
    (entry) =>
      entry.authority === "rove_control" &&
      entry.status === "pending" &&
      entry.continuationPolicy === "explicit_user_response" &&
      viewedTask?.runtime?.controller === "agent",
  );
  const activeSurfaceTitle = awaitingExplicitResponse
    ? "Your response is needed"
    : legacyView.title;
  const activeSurfaceDescription = awaitingExplicitResponse
    ? "Reply below so Rove can continue this task."
    : legacyView.description;
  useEffect(() => {
    const live = new Set(activeAttention.map(attentionStateKey));
    setAttentionAnswers((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => live.has(key)),
      ),
    );
    setAttentionForms((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => live.has(key)),
      ),
    );
  }, [product?.attention]);
  const browserAttached = viewedTask?.runtime?.attachment === "attached";
  const identityLabel = browserIdentityLabel(desktop, viewedTask);

  const run = async <T,>(
    operation: () => Promise<T>,
  ): Promise<T | undefined> => {
    setBusy(true);
    try {
      const result = await operation();
      await refresh();
      setOperationError(null);
      return result;
    } catch (cause) {
      setOperationError(
        cause instanceof Error ? cause.message : "The Rove operation failed.",
      );
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const command = <T,>(value: RendererProductIntent) =>
    window.rove.executeProductIntent(value) as Promise<T>;

  const startPageRecording = async (taskId: string) => {
    if (!recordingConfirmed) return;
    await run(() =>
      command({
        type: "task.recording.start",
        taskId,
        scope: "page",
        confirmUnmaskedSensitiveContent: true,
      }),
    );
  };

  const stopRecording = async (taskId: string, recordingId: string) => {
    await run(() =>
      command({ type: "task.recording.stop", taskId, recordingId }),
    );
  };

  const visibleLogin =
    product?.catalog.login ??
    (product?.catalog.account.status === "logged_in" ? null : login);
  const customerCodexStatus = codexCustomerStatus(
    desktop,
    visibleLogin,
    connectionError !== null,
  );

  useEffect(() => {
    if (customerCodexStatus.ready) setCodexRecoveryOpen(false);
  }, [customerCodexStatus.ready]);

  useEffect(() => {
    if (
      login !== null &&
      product?.catalog.login?.loginId !== login.loginId &&
      (product?.catalog.account.status === "logged_in" ||
        product?.catalog.account.error !== undefined)
    ) {
      setLogin(null);
    }
  }, [login, product?.catalog.account, product?.catalog.login]);

  const launch = async () => {
    if (!gate.ready || (selectedWorkflowId && !shareWorkflowContext)) return;
    const result = await run(() =>
      command<{ aggregate: { taskId: string } }>({
        type: "task.launch",
        operationId: `intent_${crypto.randomUUID()}`,
        input: {
          outcome: outcome.trim(),
          executionMode: mode,
          ...(gate.browserIdentity
            ? { browserIdentity: gate.browserIdentity }
            : {}),
          approvalsReviewer,
          ...(model ? { model } : {}),
          ...(effort ? { reasoningEffort: effort } : {}),
          ...(product?.draftAttachments.length
            ? {
                attachmentIds: product.draftAttachments.map(
                  (attachment) => attachment.id,
                ),
              }
            : {}),
          ...(selectedWorkflowId
            ? {
                workflowId: selectedWorkflowId,
                shareWorkflowContext: shareWorkflowContext === "share",
              }
            : {}),
        },
      }),
    );
    if (result !== undefined) {
      setOutcome("");
      setSelectedWorkflowId("");
      setShareWorkflowContext("");
      setSelectedTaskId(result.aggregate.taskId);
      setSelectedWorkflowWorkspaceId(null);
      setShowNewTask(false);
    }
  };
  const attemptLaunch = async () => {
    if (
      busy ||
      outcome.trim().length === 0 ||
      (selectedWorkflowId && !shareWorkflowContext)
    )
      return;
    if (!customerCodexStatus.ready) {
      setCodexRecoveryOpen(true);
      return;
    }
    if (!gate.ready) {
      setOperationError(gate.reason ?? "Something went wrong with Codex.");
      return;
    }
    await launch();
  };
  const createWorkflow = async () => {
    if (workflowCreateName === null || !workflowCreateName.trim()) return;
    const result = await run(() =>
      command<WorkflowEnvironment>({
        type: "workflow.create",
        operationId: `intent_${crypto.randomUUID()}`,
        name: workflowCreateName.trim(),
        configuration: emptyWorkflowDraftConfiguration(),
      }),
    );
    if (result !== undefined) {
      setWorkflowCreateName(null);
      setSelectedWorkflowWorkspaceId(result.workflowId);
      setWorkflowWorkspaceSection("home");
      setSelectedTaskId(null);
      setShowNewTask(false);
    }
  };
  const saveWorkflow = async () => {
    if (!workflowEditor) return;
    const configuration = workflowConfigurationFromDraft(workflowEditor);
    const result = await run(() =>
      command({
        type: workflowEditor.workflowId ? "workflow.edit" : "workflow.create",
        operationId: `intent_${crypto.randomUUID()}`,
        ...(workflowEditor.workflowId
          ? {
              workflowId: workflowEditor.workflowId,
              expectedRevision: workflowEditor.expectedRevision!,
            }
          : {}),
        name: workflowEditor.name.trim(),
        configuration,
      } as RendererProductIntent),
    );
    if (result !== undefined) setWorkflowEditor(null);
  };
  const archiveWorkflow = async (workflow: WorkflowEnvironment) => {
    const result = await run(() =>
      command({
        type: workflow.archived ? "workflow.unarchive" : "workflow.archive",
        operationId: `intent_${crypto.randomUUID()}`,
        workflowId: workflow.workflowId,
        expectedRevision: workflow.currentRevision,
      }),
    );
    if (result !== undefined) setWorkflowEditor(null);
  };
  const removeWorkflowFromCloud = async (workflow: WorkflowEnvironment) => {
    if (
      !window.confirm(
        `Remove “${workflow.name}” from this Rove account? The Workflow and all local task history will stay on this device.`,
      )
    )
      return;
    const result = await run(() =>
      window.rove.removeWorkflowFromCloud(workflow.workflowId),
    );
    if (result !== undefined) setWorkflowEditor(null);
  };
  const beginWorkflowPromotion = (
    item: ProjectedConversationItem,
    taskId: string,
  ) => {
    const destination =
      product?.workflows.find(
        (workflow) =>
          !workflow.archived &&
          workflow.workflowId === viewedTask?.workflowAssociation?.workflowId,
      ) ?? product?.workflows.find((workflow) => !workflow.archived);
    const text = messageText(item).trim();
    if (!destination || !text) return;
    setWorkflowPromotion({
      workflowId: destination.workflowId,
      expectedRevision: destination.currentRevision,
      destinationImplicit:
        destination.workflowId === viewedTask?.workflowAssociation?.workflowId,
      category: "knowledge",
      text,
      appliesTo: "",
      sourceTaskId: taskId,
      sourceItemId: item.id,
    });
  };
  const beginResultPromotion = (result: TaskResult) => {
    const sourceWorkflowId = product?.tasks.find(
      (task) => task.taskId === result.taskId,
    )?.workflowAssociation?.workflowId;
    const destination =
      selectedWorkflow ??
      product?.workflows.find(
        (workflow) =>
          !workflow.archived && workflow.workflowId === sourceWorkflowId,
      ) ??
      product?.workflows.find((workflow) => !workflow.archived);
    if (!destination) return;
    setWorkflowPromotion({
      workflowId: destination.workflowId,
      expectedRevision: destination.currentRevision,
      destinationImplicit:
        destination.workflowId ===
        (selectedWorkflow?.workflowId ?? sourceWorkflowId),
      category: "knowledge",
      text: outputBodyForPresentation(
        result.revision.title,
        result.revision.body,
      ),
      appliesTo: "",
      sourceTaskId: result.taskId,
      sourceResultId: result.resultId,
      sourceResultRevision: result.currentRevision,
    });
  };
  const saveWorkflowPromotion = async () => {
    if (!workflowPromotion) return;
    const result = await run(() =>
      command({
        type: "workflow.promote",
        operationId: `intent_${crypto.randomUUID()}`,
        workflowId: workflowPromotion.workflowId,
        expectedRevision: workflowPromotion.expectedRevision,
        category: workflowPromotion.category,
        text: workflowPromotion.text.trim(),
        appliesTo: workflowLines(workflowPromotion.appliesTo),
        sourceTaskId: workflowPromotion.sourceTaskId,
        ...(workflowPromotion.sourceItemId
          ? { sourceItemId: workflowPromotion.sourceItemId }
          : {}),
        ...(workflowPromotion.sourceResultId
          ? {
              sourceResultId: workflowPromotion.sourceResultId,
              sourceResultRevision: workflowPromotion.sourceResultRevision,
            }
          : {}),
      }),
    );
    if (result !== undefined) setWorkflowPromotion(null);
  };
  const beginResultRevision = (result: TaskResult) => {
    if (result.kind !== "draft") return;
    const presentationBody = outputBodyForPresentation(
      result.revision.title,
      result.revision.body,
    );
    setResultEditor({
      taskId: result.taskId,
      resultId: result.resultId,
      expectedRevision: result.currentRevision,
      title: result.revision.title,
      body: presentationBody.trim() ? presentationBody : result.revision.body,
      originalTitle: result.revision.title,
      originalBody: result.revision.body,
      presentationBody,
      ...(presentationBody !== result.revision.body && presentationBody.trim()
        ? {
            suppressedHeadingLine:
              duplicateOutputHeadingLine(
                result.revision.title,
                result.revision.body,
              ) ?? undefined,
          }
        : {}),
    });
  };
  const saveResponseToOutputs = async (
    item: ProjectedConversationItem,
    taskId: string,
  ) => {
    const body = messageText(item).trim();
    if (!body || savingOutputItemIds.current.has(item.id)) return;
    const existing = viewedTask?.results.find(
      (result) =>
        result.kind !== "action" &&
        result.source.conversationItemId === item.id,
    );
    if (existing) return;
    savingOutputItemIds.current.add(item.id);
    try {
      await run(() =>
        command({
          type: "result.create",
          operationId: `intent_${crypto.randomUUID()}`,
          taskId,
          sourceItemId: item.id,
          kind: outputKindForMessage(body),
          title: deriveOutputTitle(body),
          body,
        }),
      );
    } finally {
      savingOutputItemIds.current.delete(item.id);
    }
  };
  const saveResult = async () => {
    if (!resultEditor?.resultId || resultEditor.expectedRevision === undefined)
      return;
    const title = resultEditor.title.trim();
    const body = resultEditor.suppressedHeadingLine
      ? title === resultEditor.originalTitle &&
        resultEditor.body === resultEditor.presentationBody
        ? resultEditor.originalBody
        : `${resultEditor.suppressedHeadingLine}\n\n${resultEditor.body.trimStart()}`
      : resultEditor.body.trim();
    const result = await run(() =>
      command({
        type: "result.revise",
        operationId: `intent_${crypto.randomUUID()}`,
        taskId: resultEditor.taskId,
        resultId: resultEditor.resultId,
        expectedRevision: resultEditor.expectedRevision,
        title,
        body,
      }),
    );
    if (result !== undefined) setResultEditor(null);
  };
  const toggleResultSelection = async (result: TaskResult) => {
    await run(() =>
      command({
        type: "result.select",
        operationId: `intent_${crypto.randomUUID()}`,
        taskId: result.taskId,
        resultId: result.resultId,
        expectedRevision: result.currentRevision,
        selected: !result.selected,
      }),
    );
  };
  const continueFromOutput = async (result: TaskResult) => {
    if (!result.selected) {
      const selected = await run(() =>
        command<TaskResult>({
          type: "result.select",
          operationId: `intent_${crypto.randomUUID()}`,
          taskId: result.taskId,
          resultId: result.resultId,
          expectedRevision: result.currentRevision,
          selected: true,
        }),
      );
      if (selected === undefined) return;
    }
    setSelectedTaskId(result.taskId);
    setSelectedWorkflowWorkspaceId(null);
    setSelectedWorkflowOutputId(null);
    setShowNewTask(false);
  };
  const openWorkflowOutput = (workflowId: string, resultId: string) => {
    setSelectedWorkflowWorkspaceId(workflowId);
    setWorkflowWorkspaceSection("outputs");
    setSelectedWorkflowOutputId(resultId);
    setSelectedTaskId(null);
    setShowNewTask(false);
  };
  const authorizeResult = async (result: TaskResult) => {
    if (result.kind !== "action" || !result.materialDigest) return;
    await run(() =>
      command({
        type: "result.authorize",
        operationId: `intent_${crypto.randomUUID()}`,
        taskId: result.taskId,
        resultId: result.resultId,
        materialDigest: result.materialDigest!,
      }),
    );
  };
  const startLogin = async (loginType: "chatgpt" | "deviceCode") => {
    setBusy(true);
    try {
      const result = await command<LoginProjection>({
        type: "account.login",
        loginType,
      });
      setLogin(result);
      try {
        await window.rove.openTrustedExternal({
          purpose: "account_login",
          loginId: result.loginId,
        });
        setLoginError(null);
      } catch (cause) {
        console.error("[codex-login] Could not open sign-in page.", cause);
        setLoginError("Rove couldn't open the Codex sign-in page. Try again.");
      }
      await refresh();
    } catch (cause) {
      console.error("[codex-login] Sign-in could not start.", cause);
      setLoginError("Codex sign-in couldn't start. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const openLogin = async (loginId: string) => {
    setBusy(true);
    try {
      await window.rove.openTrustedExternal({
        purpose: "account_login",
        loginId,
      });
      setLoginError(null);
    } catch (cause) {
      console.error("[codex-login] Could not reopen sign-in page.", cause);
      setLoginError("Rove couldn't open the Codex sign-in page. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const cancelLogin = async (loginId: string) => {
    setBusy(true);
    try {
      await command({ type: "account.login.cancel", loginId });
      setLogin((current) => (current?.loginId === loginId ? null : current));
      setLoginError(null);
      await refresh();
      setCodexRecoveryOpen(false);
    } catch (cause) {
      console.error("[codex-login] Sign-in could not be cancelled.", cause);
      setLoginError("Codex sign-in couldn't be cancelled. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const answerAttention = async (
    entry: ProductAttentionProjection,
    decision: "accept" | "decline" | "cancel",
  ) => {
    const stateKey = attentionStateKey(entry);
    await run(() =>
      command({
        type: "attention.decide",
        taskId: entry.taskId,
        requestId: entry.requestId,
        generation: entry.generation,
        decision,
        ...(entry.kind === "user_input"
          ? { answers: attentionAnswers[stateKey] ?? {} }
          : {}),
        ...(entry.elicitation?.mode === "form"
          ? { form: attentionForms[stateKey] ?? {} }
          : {}),
      }),
    );
  };
  const returnControl = async () => {
    if (!viewedTask?.capabilities?.canReturnToRove) return;
    await run(() =>
      command({
        type: "task.return-control",
        taskId: viewedTask.taskId,
        operationId: `intent_${crypto.randomUUID()}`,
      }),
    );
  };
  const takeControl = async (task: ProductTaskProjection | undefined) => {
    if (!task) return;
    const handoffGeneration = activeAttention.find(
      (entry) =>
        entry.taskId === task.taskId &&
        entry.authority === "rove_control" &&
        entry.kind === "control_handoff" &&
        entry.status === "pending",
    )?.generation;
    await run(() => window.rove.takeControl(task.taskId, handoffGeneration));
  };
  const stopTask = async () => {
    if (!viewedTask?.capabilities?.canStop) return;
    await run(() =>
      command({
        type: "task.stop",
        taskId: viewedTask.taskId,
        operationId:
          viewedTask.operation?.operationId ?? `intent_${crypto.randomUUID()}`,
      }),
    );
  };
  const restoreTask = async (task = viewedTask) => {
    if (!task?.availableActions.includes("resume")) return;
    await run(() =>
      command({
        type: "task.restore",
        taskId: task.taskId,
        operationId: `intent_${crypto.randomUUID()}`,
      }),
    );
  };
  const requestTaskArchive = (task = viewedTask) => {
    if (
      !task ||
      !task.availableActions.includes("archive") ||
      archivingTaskIds.has(task.taskId)
    )
      return;
    setArchiveTaskId(task.taskId);
  };
  const confirmTaskArchive = async () => {
    const taskId = archiveTaskId;
    if (!taskId || archivingTaskIds.has(taskId)) return;
    setArchivingTaskIds((current) => new Set(current).add(taskId));
    try {
      await command({
        type: "task.archive",
        taskId,
        operationId: `intent_${crypto.randomUUID()}`,
      });
      await refresh();
      setArchiveTaskId(null);
      setOperationError(null);
    } catch (cause) {
      setOperationError(
        cause instanceof Error ? cause.message : "Task archive failed.",
      );
    } finally {
      setArchivingTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
    }
  };
  const retryTaskCleanup = async () => {
    if (!viewedTask?.availableActions.includes("retry_cleanup")) return;
    await run(() =>
      command({
        type: "task.cleanup.retry",
        taskId: viewedTask.taskId,
        operationId: `intent_${crypto.randomUUID()}`,
      }),
    );
  };
  const displayTaskTitle = (task: NonNullable<typeof viewedTask>) =>
    taskTitles[task.taskId] ?? taskHistoryTitle(task);
  const openTaskContextMenu = (
    event: MouseEvent<HTMLDivElement>,
    task: NonNullable<typeof viewedTask>,
  ) => {
    event.preventDefault();
    const width = 210;
    const height = 104;
    setTaskContextMenu({
      taskId: task.taskId,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    });
    setRenamingTaskId(null);
  };
  const beginTaskRename = (task: NonNullable<typeof viewedTask>) => {
    setRenameDraft(displayTaskTitle(task));
    setRenamingTaskId(task.taskId);
  };
  const saveTaskRename = (taskId: string) => {
    const title = renameDraft.trim().slice(0, 80);
    setTaskTitles((current) => {
      const next = { ...current };
      if (title) next[taskId] = title;
      else delete next[taskId];
      localStorage.setItem(TASK_TITLE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setTaskContextMenu(null);
    setRenamingTaskId(null);
  };
  const copyConversationItem = async (item: ProjectedConversationItem) => {
    await navigator.clipboard.writeText(messageText(item));
    setCopiedItemId(item.id);
    window.setTimeout(
      () =>
        setCopiedItemId((current) => (current === item.id ? null : current)),
      1_500,
    );
  };
  const acknowledgeLegacyEffects = async () => {
    if (!viewedTask?.availableActions.includes("acknowledge_legacy_effects"))
      return;
    await run(() =>
      command({
        type: "task.effects.acknowledge",
        taskId: viewedTask.taskId,
      }),
    );
  };
  const sendFollowup = async () => {
    const message = followup.trim();
    if (!viewedTask || !message || busy) return;
    await run(async () => {
      await command({
        type: "task.message",
        taskId: viewedTask.taskId,
        operationId: `intent_${crypto.randomUUID()}`,
        outcome: message,
        ...(product?.draftAttachments.length
          ? {
              attachmentIds: product.draftAttachments.map(
                (attachment) => attachment.id,
              ),
            }
          : {}),
        ...(viewedTask.results.some((result) => result.selected)
          ? {
              selectedResultIds: viewedTask.results
                .filter((result) => result.selected)
                .map((result) => result.resultId),
            }
          : {}),
      });
      setFollowup("");
    });
  };

  const setQuestionAnswer = (
    requestId: string,
    questionId: string,
    values: string[],
  ) =>
    setAttentionAnswers((current) => ({
      ...current,
      [requestId]: { ...current[requestId], [questionId]: values },
    }));
  const setFormValue = (
    requestId: string,
    fieldId: string,
    value: string | number | boolean | string[],
  ) =>
    setAttentionForms((current) => ({
      ...current,
      [requestId]: { ...current[requestId], [fieldId]: value },
    }));

  const renderCodexAttention = (entry: ProductAttentionProjection) => {
    const choiceQuestion =
      entry.kind === "user_input" && entry.questions?.length === 1
        ? entry.questions[0]
        : undefined;
    const choiceOptions = choiceQuestion?.options;
    const responseKey = attentionStateKey(entry);
    const selectedChoice = choiceQuestion
      ? attentionAnswers[responseKey]?.[choiceQuestion.id]?.[0]
      : undefined;
    const boundedChoiceResponse = Boolean(
      choiceQuestion && choiceOptions?.length,
    );

    if (boundedChoiceResponse && choiceQuestion && choiceOptions) {
      const freeformValue = choiceOptions.some(
        (option) => option.label === selectedChoice,
      )
        ? ""
        : (selectedChoice ?? "");

      return (
        <section
          className="attention-card attention-inline attention-codex task-response-surface task-choice-response"
          aria-label="Current task request"
        >
          <header className="task-response-heading">
            <h2>{choiceQuestion.question}</h2>
          </header>
          {entry.context?.length ? (
            <div className="task-response-context">
              {entry.context.map((item) => (
                <p key={item.label}>
                  <strong>{item.label}:</strong> {item.value}
                </p>
              ))}
            </div>
          ) : null}
          {entry.status === "pending" ? (
            <>
              <fieldset className="task-response-options">
                <legend>{choiceQuestion.header}</legend>
                {choiceOptions.map((option, index) => (
                  <label className="task-response-choice" key={option.label}>
                    <input
                      className="task-response-radio"
                      type="radio"
                      name={`${responseKey}:${choiceQuestion.id}`}
                      checked={selectedChoice === option.label}
                      onChange={() =>
                        setQuestionAnswer(responseKey, choiceQuestion.id, [
                          option.label,
                        ])
                      }
                    />
                    <span className="task-response-index" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="task-response-option-copy">
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    <svg
                      className="task-response-arrow"
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                    >
                      <path d="m7.5 4.5 5.5 5.5-5.5 5.5" />
                    </svg>
                  </label>
                ))}
              </fieldset>
              <div className="task-response-footer">
                {choiceQuestion.isOther ? (
                  <label className="task-response-other">
                    <span className="task-response-pencil" aria-hidden="true">
                      <svg viewBox="0 0 20 20">
                        <path d="m12.9 4.1 3 3L7.2 15.8l-3.7.7.7-3.7 8.7-8.7Z" />
                        <path d="m11.5 5.5 3 3" />
                      </svg>
                    </span>
                    <span className="task-response-other-label">
                      Something else
                    </span>
                    <input
                      aria-label={`${choiceQuestion.header} answer`}
                      type={choiceQuestion.isSecret ? "password" : "text"}
                      placeholder="Something else…"
                      value={freeformValue}
                      onChange={(event) =>
                        setQuestionAnswer(responseKey, choiceQuestion.id, [
                          event.target.value,
                        ])
                      }
                    />
                  </label>
                ) : (
                  <span />
                )}
                <button
                  className="primary task-response-submit"
                  disabled={busy}
                  onClick={() => void answerAttention(entry, "accept")}
                >
                  Send
                </button>
              </div>
            </>
          ) : (
            <small>Status: {entry.status.replaceAll("_", " ")}</small>
          )}
        </section>
      );
    }

    return (
      <section
        className={`attention-card attention-inline attention-codex${
          entry.kind === "user_input" ? " task-response-surface" : ""
        }`}
        aria-label="Current task request"
      >
        <div className="eyebrow">
          {entry.kind === "user_input"
            ? "Rove needs your input"
            : "Input needed"}
        </div>
        <h2>{entry.title}</h2>
        <p>{attentionCopy(entry)}</p>
        {entry.context?.map((item) => (
          <p key={item.label}>
            <strong>{item.label}:</strong> {item.value}
          </p>
        ))}
        {entry.status === "pending" && (
          <>
            {entry.questions?.map((question) => (
              <fieldset key={question.id}>
                <legend>{question.header}</legend>
                <p>{question.question}</p>
                {question.options?.map((option) => (
                  <label className="task-response-choice" key={option.label}>
                    <input
                      type="radio"
                      name={`${attentionStateKey(entry)}:${question.id}`}
                      checked={
                        attentionAnswers[attentionStateKey(entry)]?.[
                          question.id
                        ]?.[0] === option.label
                      }
                      onChange={() =>
                        setQuestionAnswer(
                          attentionStateKey(entry),
                          question.id,
                          [option.label],
                        )
                      }
                    />
                    {option.label} — {option.description}
                  </label>
                ))}
                {(!question.options || question.isOther) && (
                  <label className="task-response-other">
                    <span>
                      {question.options ? "Something else" : "Your answer"}
                    </span>
                    <input
                      aria-label={`${question.header} answer`}
                      type={question.isSecret ? "password" : "text"}
                      value={
                        question.options &&
                        question.options.some(
                          (option) =>
                            option.label ===
                            attentionAnswers[attentionStateKey(entry)]?.[
                              question.id
                            ]?.[0],
                        )
                          ? ""
                          : (attentionAnswers[attentionStateKey(entry)]?.[
                              question.id
                            ]?.[0] ?? "")
                      }
                      onChange={(event) =>
                        setQuestionAnswer(
                          attentionStateKey(entry),
                          question.id,
                          [event.target.value],
                        )
                      }
                    />
                  </label>
                )}
              </fieldset>
            ))}
            {entry.elicitation?.mode === "form" &&
              entry.elicitation.fields?.map((field) => (
                <label key={field.id}>
                  {field.title}
                  {field.description && <small>{field.description}</small>}
                  {field.type === "boolean" ? (
                    <input
                      type="checkbox"
                      checked={
                        (attentionForms[attentionStateKey(entry)]?.[field.id] ??
                          field.default) === true
                      }
                      onChange={(event) =>
                        setFormValue(
                          attentionStateKey(entry),
                          field.id,
                          event.target.checked,
                        )
                      }
                    />
                  ) : field.options ? (
                    <select
                      aria-label={field.title}
                      multiple={field.type === "multi_select"}
                      value={
                        field.type === "multi_select"
                          ? ((attentionForms[attentionStateKey(entry)]?.[
                              field.id
                            ] as string[] | undefined) ??
                            (field.default as readonly string[] | undefined) ??
                            [])
                          : String(
                              attentionForms[attentionStateKey(entry)]?.[
                                field.id
                              ] ??
                                field.default ??
                                unsetSelectValue(field),
                            )
                      }
                      onChange={(event) =>
                        setFormValue(
                          attentionStateKey(entry),
                          field.id,
                          field.type === "multi_select"
                            ? Array.from(event.target.selectedOptions).map(
                                (option) => option.value,
                              )
                            : event.target.value,
                        )
                      }
                    >
                      {field.type !== "multi_select" && (
                        <option value={unsetSelectValue(field)} disabled>
                          Choose…
                        </option>
                      )}
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={field.title}
                      type={
                        field.type === "number" || field.type === "integer"
                          ? "number"
                          : field.format === "email"
                            ? "email"
                            : field.format === "uri"
                              ? "url"
                              : field.format === "date"
                                ? "date"
                                : "text"
                      }
                      required={field.required}
                      min={field.minimum}
                      max={field.maximum}
                      minLength={field.minLength}
                      maxLength={field.maxLength}
                      step={field.type === "integer" ? 1 : undefined}
                      placeholder={
                        field.format === "date-time"
                          ? "YYYY-MM-DDTHH:mm:ssZ"
                          : undefined
                      }
                      value={String(
                        attentionForms[attentionStateKey(entry)]?.[field.id] ??
                          field.default ??
                          "",
                      )}
                      onChange={(event) =>
                        setFormValue(
                          attentionStateKey(entry),
                          field.id,
                          field.type === "number" || field.type === "integer"
                            ? event.target.valueAsNumber
                            : event.target.value,
                        )
                      }
                    />
                  )}
                </label>
              ))}
            {entry.elicitation?.mode === "form" &&
              entry.elicitation.unsupportedReason && (
                <p role="alert">
                  This request cannot be submitted:{" "}
                  {entry.elicitation.unsupportedReason}
                </p>
              )}
            {entry.elicitation?.mode === "url" && (
              <button
                onClick={() =>
                  void window.rove.openTrustedExternal({
                    purpose: "mcp_elicitation",
                    taskId: entry.taskId,
                    requestId: entry.requestId,
                    generation: entry.generation,
                  })
                }
              >
                Open secure page
              </button>
            )}
            <div className="attention-actions">
              {entry.kind !== "user_input" && (
                <button
                  disabled={busy}
                  onClick={() => void answerAttention(entry, "decline")}
                >
                  Decline
                </button>
              )}
              {entry.kind === "mcp_elicitation" && (
                <button
                  disabled={busy}
                  onClick={() => void answerAttention(entry, "cancel")}
                >
                  Cancel
                </button>
              )}
              <button
                className="primary"
                disabled={busy || Boolean(entry.elicitation?.unsupportedReason)}
                onClick={() => void answerAttention(entry, "accept")}
              >
                {entry.kind === "user_input" ? "Send" : "Approve / Send"}
              </button>
            </div>
          </>
        )}
        {entry.status !== "pending" && (
          <small>Status: {entry.status.replaceAll("_", " ")}</small>
        )}
      </section>
    );
  };

  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!follower || (event.target as Element).closest("button")) return;
    dragPointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    void window.rove.beginFollowerDrag();
  };
  const updateDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragPointer.current === event.pointerId)
      void window.rove.updateFollowerDrag();
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragPointer.current !== event.pointerId) return;
    dragPointer.current = null;
    void window.rove.endFollowerDrag();
  };

  if (presentation === "chip") {
    return (
      <div
        className="product-chip"
        onPointerDown={beginDrag}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
      >
        <img src={roveMarkUrl} alt="" aria-hidden="true" />
        <span
          className={`status-pip status-${product?.host.state ?? "offline"}`}
        />
        <button
          type="button"
          aria-label={`Expand Rove. ${unmatchedSession ? "Browser session needs cleanup" : awaitingExplicitResponse ? "Your response is needed" : taskAttention.length ? "Attention required" : customerCodexStatus.label}`}
          onClick={() =>
            void run(() => window.rove.transitionSurface("expand"))
          }
        >
          {awaitingExplicitResponse
            ? "Reply"
            : taskAttention.length
              ? "!"
              : "↗"}
        </button>
      </div>
    );
  }

  if (presentation === "expanded") {
    return (
      <div
        className="product-expanded"
        aria-label="Rove browser companion"
        tabIndex={0}
        onPointerDown={beginDrag}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
      >
        <div className="expanded-copy">
          <span>
            {unmatchedSession
              ? "Cleanup required"
              : taskAttention.length || fileAttention.length
                ? "Attention needed"
                : customerCodexStatus.label}
          </span>
          <strong>
            {unmatchedSession
              ? "Browser session needs cleanup"
              : activeTask
                ? activeSurfaceTitle
                : "Rove is ready"}
          </strong>
          {activeTask?.capabilities?.canReturnToRove && (
            <small>{activeTask.lifecycle.reason}</small>
          )}
          <small>
            {unmatchedSession
              ? `${modeLabel(unmatchedSession.session.mode)} · ${unmatchedSession.session.status}`
              : activeTask
                ? `${modeLabel(activeTask.executionMode)} · ${workspaceName(desktop, activeTask.browserIdentity?.mode === "workspace" ? activeTask.browserIdentity.workspaceId : "")} · Controller: ${activeTaskControl.controllerLabel}`
                : "Open Rove to start a task"}
          </small>
        </div>
        <div className="expanded-actions">
          {activeTaskControl.canTakeControl && (
            <button onClick={() => void takeControl(activeTask)}>
              Take Over
            </button>
          )}
          {activeTask?.capabilities?.canReturnToRove && (
            <button onClick={() => void returnControl()}>Return Control</button>
          )}
          {unmatchedSession && (
            <button
              className="danger"
              onClick={() =>
                void run(() =>
                  window.rove.finishSession(unmatchedSession.session.id),
                )
              }
            >
              Finish session
            </button>
          )}
          <button onClick={() => void run(window.rove.openRove)}>
            Go to Rove
          </button>
          <button
            aria-label="Collapse Rove"
            onClick={() =>
              void run(() => window.rove.transitionSurface("collapse"))
            }
          >
            —
          </button>
        </div>
      </div>
    );
  }

  const timeline = Object.values(viewedTask?.conversation?.items ?? {});
  const itemOrder = viewedTask?.conversation?.itemOrder ?? [];
  const itemsById = new Map(timeline.map((item) => [item.id, item]));
  const orderedTimeline = [
    ...itemOrder.flatMap((id) => {
      const item = itemsById.get(id);
      return item ? [item] : [];
    }),
    ...timeline.filter((item) => !itemOrder.includes(item.id)),
  ];
  const rawSegments: Array<{
    id: string;
    input?: ProjectedConversationItem;
    items: ProjectedConversationItem[];
  }> = [];
  for (const item of orderedTimeline) {
    if (item.kind === "user_message") {
      rawSegments.push({ id: item.id, input: item, items: [] });
      continue;
    }
    const current = rawSegments.at(-1);
    if (current) current.items.push(item);
    else
      rawSegments.push({
        id: `work:${item.turnId ?? "unassociated"}:${item.id}`,
        items: [item],
      });
  }
  const timelineSegments = rawSegments.map((segment, index) => {
    const isActiveSegment =
      index === rawSegments.length - 1 &&
      viewedTask?.conversation?.turnStatus === "in_progress";
    const assistants = segment.items.filter(
      (item) => item.kind === "assistant_message",
    );
    const explicitFinals = assistants.filter(
      (item) => item.phase === "final_answer",
    );
    const fallbackFinal =
      explicitFinals.length === 0 &&
      !isActiveSegment &&
      assistants.every((item) => item.phase === undefined)
        ? assistants.at(-1)
        : undefined;
    const finalIds = new Set(
      [...explicitFinals, ...(fallbackFinal ? [fallbackFinal] : [])].map(
        (item) => item.id,
      ),
    );
    const allItems = [
      ...(segment.input ? [segment.input] : []),
      ...segment.items,
    ];
    const timestamps = allItems
      .flatMap((item) => [item.startedAt, item.completedAt])
      .filter((value): value is string => value !== undefined)
      .map((value) => Date.parse(value))
      .filter(Number.isFinite);
    const startedAt =
      timestamps.length > 0 ? Math.min(...timestamps) : undefined;
    const completedAt = isActiveSegment
      ? timelineNow
      : timestamps.length > 0
        ? Math.max(...timestamps)
        : undefined;
    return {
      ...segment,
      work: segment.items.filter((item) => !finalIds.has(item.id)),
      finals: segment.items.filter((item) => finalIds.has(item.id)),
      isActiveSegment,
      completedTimestamp:
        completedAt === undefined
          ? undefined
          : new Date(completedAt).toISOString(),
      elapsed:
        startedAt === undefined || completedAt === undefined
          ? undefined
          : formatElapsed(completedAt - startedAt),
    };
  });
  const taskContextEntry = product?.tasks.find(
    (task) => task.taskId === taskContextMenu?.taskId,
  );
  const archiveTask = product?.tasks.find(
    (task) => task.taskId === archiveTaskId,
  );
  const account = product?.catalog.account;
  const primaryRateLimit = product?.catalog.rateLimits?.[0];
  const usageRemaining =
    primaryRateLimit?.usedPercent === null ||
    primaryRateLimit?.usedPercent === undefined
      ? "Unavailable"
      : `${Math.max(0, 100 - Math.round(primaryRateLimit.usedPercent))}% left`;

  const retryCodexStatus = async () => {
    if (product !== null) await run(() => command({ type: "account.refresh" }));
    else await refresh();
  };
  const codexRecoveryDialog = codexRecoveryOpen ? (
    <div
      className="profile-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setCodexRecoveryOpen(false);
      }}
    >
      <section
        className="profile-modal codex-recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="codex-recovery-title"
      >
        <header>
          <div>
            <div className="eyebrow">Codex execution</div>
            <h2 id="codex-recovery-title">
              {customerCodexStatus.kind === "signed_out"
                ? "Sign in to Codex"
                : customerCodexStatus.label}
            </h2>
            <p>
              {customerCodexStatus.kind === "signed_out"
                ? "Rove uses Codex to work on your tasks. Sign in with your ChatGPT account to continue."
                : customerCodexStatus.kind === "signing_in"
                  ? "Complete sign-in in your browser, or cancel to return to your draft."
                  : customerCodexStatus.kind === "usage_limit_reached"
                    ? "Your draft is saved here. You can try again after your Codex usage limit resets."
                    : customerCodexStatus.kind === "startup_failed"
                      ? "Rove couldn't start Codex. Restart Rove to try again."
                      : "Your draft is saved here. Retry when you are ready."}
            </p>
          </div>
          <button
            className="profile-modal-close"
            type="button"
            aria-label="Close Codex recovery"
            onClick={() => setCodexRecoveryOpen(false)}
          >
            ×
          </button>
        </header>
        {visibleLogin?.type === "chatgptDeviceCode" && (
          <div className="auth-device-code">
            <span>Enter this code on the verification page</span>
            <code>{visibleLogin.userCode}</code>
          </div>
        )}
        {(loginError ||
          (account?.status === "logged_out" ? account.error : undefined)) && (
          <div className="product-error modal-error" role="alert">
            <strong>Sign-in needs attention</strong>
            <span>{loginError ?? account?.error}</span>
          </div>
        )}
        <div className="modal-actions">
          {customerCodexStatus.kind === "signed_out" && (
            <button
              className="primary"
              type="button"
              onClick={() => void startLogin("chatgpt")}
              disabled={busy}
            >
              Sign in
            </button>
          )}
          {customerCodexStatus.kind === "signing_in" && visibleLogin && (
            <button
              className="primary"
              type="button"
              onClick={() => void openLogin(visibleLogin.loginId)}
              disabled={busy}
            >
              {visibleLogin.type === "chatgptDeviceCode"
                ? "Open verification page"
                : "Continue sign-in"}
            </button>
          )}
          {customerCodexStatus.recovery === "retry" && (
            <button
              className="primary"
              type="button"
              onClick={() => void retryCodexStatus()}
              disabled={busy}
            >
              Retry
            </button>
          )}
          {customerCodexStatus.recovery === "restart_rove" && (
            <button
              className="primary"
              type="button"
              onClick={() => {
                setBusy(true);
                void window.rove.restartRove().catch((cause: unknown) => {
                  setBusy(false);
                  setOperationError(
                    cause instanceof Error
                      ? cause.message
                      : "Rove could not restart.",
                  );
                });
              }}
              disabled={busy}
            >
              Restart Rove
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (visibleLogin) void cancelLogin(visibleLogin.loginId);
              else setCodexRecoveryOpen(false);
            }}
            disabled={busy}
          >
            {visibleLogin ? "Cancel" : "Not now"}
          </button>
        </div>
      </section>
    </div>
  ) : null;
  const renderModalError = () =>
    error ? (
      <div className="product-error modal-error" role="alert">
        <strong>Rove needs attention</strong>
        <span>{error}</span>
      </div>
    ) : null;

  return (
    <div
      className={`product-app${sidebarCollapsed ? " sidebar-collapsed" : ""}${windowFullscreen ? " window-fullscreen" : ""}`}
    >
      {codexRecoveryDialog}
      {archiveTask && (
        <TaskArchiveConfirmation
          busy={busy}
          archiving={archivingTaskIds.has(archiveTask.taskId)}
          error={error}
          onCancel={() => setArchiveTaskId(null)}
          onConfirm={() => void confirmTaskArchive()}
        />
      )}
      {workflowCreateName !== null && (
        <div className="profile-modal-backdrop" role="presentation">
          <section
            className="profile-modal workflow-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workflow-create-title"
          >
            <header>
              <div>
                <div className="eyebrow">New Workflow</div>
                <h2 id="workflow-create-title">Name your Workflow</h2>
                <p>
                  You can start working now and add context whenever it helps.
                </p>
              </div>
              <button
                type="button"
                className="profile-modal-close"
                aria-label="Close Workflow creation"
                onClick={() => setWorkflowCreateName(null)}
              >
                ×
              </button>
            </header>
            <form
              className="workflow-create-form"
              onSubmit={(event) => {
                event.preventDefault();
                void createWorkflow();
              }}
            >
              <label>
                <span>Workflow name</span>
                <input
                  aria-label="Workflow name"
                  autoFocus
                  required
                  maxLength={120}
                  placeholder="e.g. Weekly product update"
                  value={workflowCreateName}
                  onChange={(event) =>
                    setWorkflowCreateName(event.target.value)
                  }
                />
              </label>
              {renderModalError()}
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => setWorkflowCreateName(null)}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={busy || !workflowCreateName.trim()}
                >
                  Create Workflow
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {workflowEditor && !selectedWorkflow && (
        <div className="profile-modal-backdrop" role="presentation">
          <section
            className="profile-modal workflow-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workflow-editor-title"
          >
            <header>
              <div>
                <div className="eyebrow">Workflow context</div>
                <h2 id="workflow-editor-title">
                  {workflowEditor.workflowId ? "Edit Workflow" : "New Workflow"}
                </h2>
                <p>
                  Add only the context that helps Rove work the way you prefer.
                  You can leave any section empty.
                </p>
              </div>
              <button
                type="button"
                className="profile-modal-close"
                aria-label="Close Workflow editor"
                onClick={() => setWorkflowEditor(null)}
              >
                ×
              </button>
            </header>
            <form
              className="workflow-editor-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveWorkflow();
              }}
            >
              <label>
                <span>Name</span>
                <input
                  aria-label="Workflow name"
                  maxLength={120}
                  required
                  value={workflowEditor.name}
                  onChange={(event) =>
                    setWorkflowEditor({
                      ...workflowEditor,
                      name: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <span>What recurring work is this for?</span>
                <textarea
                  aria-label="Workflow purpose"
                  maxLength={2000}
                  value={workflowEditor.purpose}
                  onChange={(event) =>
                    setWorkflowEditor({
                      ...workflowEditor,
                      purpose: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <span>Primary kind of work</span>
                <select
                  aria-label="Workflow kind"
                  value={workflowEditor.focus}
                  onChange={(event) =>
                    setWorkflowEditor({
                      ...workflowEditor,
                      focus: event.target.value as WorkflowEditorDraft["focus"],
                    })
                  }
                >
                  <option value="research">Research and discovery</option>
                  <option value="review">Review and decisions</option>
                  <option value="outreach">Drafting and outreach</option>
                  <option value="custom">Custom / not sure</option>
                </select>
              </label>
              <WorkflowGuidanceEditor
                label="What should Rove prioritize?"
                entries={workflowEditor.preferences}
                defaultTopic={workflowEditor.focus}
                onChange={(preferences) =>
                  setWorkflowEditor({ ...workflowEditor, preferences })
                }
              />
              <WorkflowGuidanceEditor
                label="What criteria or exclusions matter?"
                entries={workflowEditor.criteria}
                defaultTopic={workflowEditor.focus}
                onChange={(criteria) =>
                  setWorkflowEditor({ ...workflowEditor, criteria })
                }
              />
              <WorkflowGuidanceEditor
                label="Additional reusable guidance"
                entries={workflowEditor.guidance}
                defaultTopic={workflowEditor.focus}
                onChange={(guidance) =>
                  setWorkflowEditor({ ...workflowEditor, guidance })
                }
              />
              <WorkflowGuidanceEditor
                label="Approved procedures or skill guidance"
                entries={workflowEditor.procedures}
                defaultTopic={workflowEditor.focus}
                onChange={(procedures) =>
                  setWorkflowEditor({ ...workflowEditor, procedures })
                }
              />
              <WorkflowResourceEditor
                entries={workflowEditor.resourceRequirements}
                onChange={(resourceRequirements) =>
                  setWorkflowEditor({ ...workflowEditor, resourceRequirements })
                }
              />
              <WorkflowGuidanceEditor
                label="Explicitly saved reusable knowledge"
                entries={workflowEditor.approvedKnowledge}
                defaultTopic={workflowEditor.focus}
                onChange={(approvedKnowledge) =>
                  setWorkflowEditor({ ...workflowEditor, approvedKnowledge })
                }
              />
              <label>
                <span>How should Outputs be presented?</span>
                <select
                  aria-label="Workflow Output style"
                  value={workflowEditor.resultStyle}
                  onChange={(event) =>
                    setWorkflowEditor({
                      ...workflowEditor,
                      resultStyle: event.target
                        .value as WorkflowEditorDraft["resultStyle"],
                    })
                  }
                >
                  <option value="sources">With sources and uncertainty</option>
                  <option value="concise">Concise and actionable</option>
                  <option value="detailed">Detailed with reasoning</option>
                </select>
              </label>
              <p className="workflow-disclosure">
                {workflowSynchronizationDisclosure(
                  workflowEditor.workflowId
                    ? currentOwnerWorkflowSyncBinding(
                        desktop,
                        workflowEditor.workflowId,
                      )
                    : desktop?.workflowSync?.boundOwnerId &&
                        desktop.workflowSync.boundOwnerId ===
                          desktop.workflowSync.signedInOwnerId
                      ? {
                          eligibility: "owner_bound",
                          status: "pending_upload",
                        }
                      : null,
                  "editor",
                )}
              </p>
              {renderModalError()}
              <div className="modal-actions">
                {workflowEditor.workflowId &&
                  canRemoveWorkflowFromCloud(
                    desktop,
                    workflowEditor.workflowId,
                  ) && (
                    <button
                      type="button"
                      className="danger-text"
                      disabled={busy}
                      onClick={() => {
                        const workflow = product?.workflows.find(
                          (entry) =>
                            entry.workflowId === workflowEditor.workflowId,
                        );
                        if (workflow) void removeWorkflowFromCloud(workflow);
                      }}
                    >
                      Remove from Rove account…
                    </button>
                  )}
                {workflowEditor.workflowId &&
                  product?.workflows.find(
                    (entry) => entry.workflowId === workflowEditor.workflowId,
                  ) && (
                    <button
                      type="button"
                      className="danger-text"
                      disabled={busy}
                      onClick={() =>
                        void archiveWorkflow(
                          product.workflows.find(
                            (entry) =>
                              entry.workflowId === workflowEditor.workflowId,
                          )!,
                        )
                      }
                    >
                      {product.workflows.find(
                        (entry) =>
                          entry.workflowId === workflowEditor.workflowId,
                      )?.archived
                        ? "Restore"
                        : "Archive"}
                    </button>
                  )}
                <button type="button" onClick={() => setWorkflowEditor(null)}>
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={busy}>
                  Save changes
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {resultEditor && (
        <div className="profile-modal-backdrop" role="presentation">
          <section
            className="profile-modal workflow-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="result-editor-title"
          >
            <header>
              <div>
                <div className="eyebrow">Output</div>
                <h2 id="result-editor-title">Edit Output</h2>
                <p>Update the saved work directly.</p>
              </div>
              <button
                type="button"
                className="profile-modal-close"
                aria-label="Close Output editor"
                onClick={() => setResultEditor(null)}
              >
                ×
              </button>
            </header>
            <form
              className="workflow-editor-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveResult();
              }}
            >
              <label>
                <span>Title</span>
                <input
                  aria-label="Output title"
                  required
                  maxLength={240}
                  value={resultEditor.title}
                  onChange={(event) => {
                    const title = event.target.value;
                    const revealHeading =
                      resultEditor.suppressedHeadingLine !== undefined &&
                      !outputHeadingMatchesTitle(
                        title,
                        resultEditor.suppressedHeadingLine,
                      );
                    setResultEditor({
                      ...resultEditor,
                      title,
                      ...(revealHeading
                        ? {
                            body: `${resultEditor.suppressedHeadingLine}\n\n${resultEditor.body}`,
                            suppressedHeadingLine: undefined,
                          }
                        : {}),
                    });
                  }}
                />
              </label>
              <label>
                <span>Content</span>
                <textarea
                  aria-label="Output content"
                  required
                  maxLength={32000}
                  value={resultEditor.body}
                  onChange={(event) =>
                    setResultEditor({
                      ...resultEditor,
                      body: event.target.value,
                    })
                  }
                />
              </label>
              {renderModalError()}
              <div className="modal-actions">
                <button type="button" onClick={() => setResultEditor(null)}>
                  Cancel
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={
                    busy ||
                    !resultEditor.title.trim() ||
                    !resultEditor.body.trim()
                  }
                >
                  Save changes
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {workflowPromotion && (
        <div className="profile-modal-backdrop" role="presentation">
          <section
            className="profile-modal workflow-promotion"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workflow-promotion-title"
          >
            <header>
              <div>
                <div className="eyebrow">Workflow Context</div>
                <h2 id="workflow-promotion-title">Add to Context</h2>
                <p>Rove can use this in future tasks in this Workflow.</p>
                <p>
                  {workflowSynchronizationDisclosure(
                    currentOwnerWorkflowSyncBinding(
                      desktop,
                      workflowPromotion.workflowId,
                    ),
                    "promotion",
                  )}
                </p>
              </div>
              <button
                className="profile-modal-close"
                type="button"
                aria-label="Cancel Add to Context"
                onClick={() => setWorkflowPromotion(null)}
              >
                ×
              </button>
            </header>
            <form
              className="workflow-editor-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveWorkflowPromotion();
              }}
            >
              {!workflowPromotion.destinationImplicit && (
                <label>
                  <span>Workflow</span>
                  <select
                    aria-label="Workflow"
                    value={workflowPromotion.workflowId}
                    onChange={(event) => {
                      const workflow = product?.workflows.find(
                        (entry) => entry.workflowId === event.target.value,
                      );
                      if (workflow)
                        setWorkflowPromotion({
                          ...workflowPromotion,
                          workflowId: workflow.workflowId,
                          expectedRevision: workflow.currentRevision,
                        });
                    }}
                  >
                    {product?.workflows
                      .filter((workflow) => !workflow.archived)
                      .map((workflow) => (
                        <option
                          key={workflow.workflowId}
                          value={workflow.workflowId}
                        >
                          {workflow.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                <span>What Rove should remember</span>
                <textarea
                  aria-label="What Rove should remember"
                  required
                  maxLength={2000}
                  value={workflowPromotion.text}
                  onChange={(event) =>
                    setWorkflowPromotion({
                      ...workflowPromotion,
                      text: event.target.value,
                    })
                  }
                />
              </label>
              <details className="workflow-promotion-advanced">
                <summary>Advanced</summary>
                <label>
                  <span>Use only for these topics (optional)</span>
                  <textarea
                    aria-label="Relevant topics"
                    placeholder="One topic per line"
                    value={workflowPromotion.appliesTo}
                    onChange={(event) =>
                      setWorkflowPromotion({
                        ...workflowPromotion,
                        appliesTo: event.target.value,
                      })
                    }
                  />
                </label>
              </details>
              {renderModalError()}
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => setWorkflowPromotion(null)}
                >
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={busy}>
                  Add to Context
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      <header className="product-topbar">
        <button
          className="sidebar-toggle"
          type="button"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setSidebarCollapsed((current) => !current)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <rect x="2.5" y="3" width="15" height="14" rx="2.5" />
            <path d="M7 3v14" />
          </svg>
        </button>
        <div className="product-brand">
          <img src={roveMarkUrl} alt="" />
          <strong>Rove</strong>
        </div>
        <div className="product-task-nav">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M2.75 5.75A1.75 1.75 0 0 1 4.5 4h3l1.6 1.75h6.4a1.75 1.75 0 0 1 1.75 1.75v7A1.75 1.75 0 0 1 15.5 16h-11a1.75 1.75 0 0 1-1.75-1.75v-8.5Z" />
          </svg>
          <strong
            title={
              selectedWorkflow?.name ??
              (viewedTask ? displayTaskTitle(viewedTask) : "New task")
            }
          >
            {selectedWorkflow?.name ??
              (viewedTask ? displayTaskTitle(viewedTask) : "New task")}
          </strong>
          {!selectedWorkflow &&
            viewedTask &&
            (viewedTask.availableActions.includes("retry_cleanup") ||
              viewedTask.availableActions.includes(
                "acknowledge_legacy_effects",
              )) && (
              <details className="task-more-menu">
                <summary aria-label="Task actions">•••</summary>
                <div className="task-action-popover">
                  {viewedTask.availableActions.includes(
                    "acknowledge_legacy_effects",
                  ) && (
                    <button
                      disabled={busy}
                      onClick={() => void acknowledgeLegacyEffects()}
                    >
                      Acknowledge previous-work uncertainty
                    </button>
                  )}
                  {viewedTask.availableActions.includes("retry_cleanup") && (
                    <button
                      disabled={busy}
                      onClick={() => void retryTaskCleanup()}
                    >
                      Retry cleanup
                    </button>
                  )}
                </div>
              </details>
            )}
        </div>
        <div className="product-topbar-actions">
          <div className="product-health" aria-live="polite">
            <span
              className={`status-pip status-${customerCodexStatus.ready ? "ready" : customerCodexStatus.kind === "starting" || customerCodexStatus.kind === "signing_in" ? "starting" : "offline"}`}
            />
            <span
              className="product-health-label"
              title={customerCodexStatus.label}
            >
              {customerCodexStatus.label}
            </span>
            {!codexRecoveryOpen && customerCodexStatus.recovery !== null && (
              <button
                className="product-health-action"
                type="button"
                onClick={() => setCodexRecoveryOpen(true)}
              >
                {customerCodexStatus.recovery === "sign_in"
                  ? "Sign in"
                  : customerCodexStatus.recovery === "restart_rove"
                    ? "Restart Rove"
                    : "Retry"}
              </button>
            )}
          </div>
          <details className="app-menu">
            <summary aria-label="Rove settings" title="Rove settings">
              <span aria-hidden="true">•••</span>
            </summary>
            <div className="app-menu-popover">
              <button
                type="button"
                onClick={(event) => {
                  closeParentMenu(event);
                  setProfileManagerOpen(true);
                }}
              >
                Browser profiles
              </button>
              <button
                type="button"
                onClick={(event) => {
                  closeParentMenu(event);
                  setSettingsSection("appearance");
                  setSettingsOpen(true);
                }}
              >
                Settings
              </button>
              {account?.status === "logged_in" && (
                <>
                  <div className="app-menu-status">
                    <span>Codex usage</span>
                    <strong>{usageRemaining}</strong>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void run(() => command({ type: "account.logout" }))
                    }
                    disabled={busy}
                  >
                    Sign out of Codex
                  </button>
                </>
              )}
            </div>
          </details>
        </div>
      </header>

      {profileManagerOpen && (
        <div
          className="profile-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setProfileManagerOpen(false);
          }}
        >
          <section
            className="profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="browser-profiles-title"
          >
            <header>
              <div>
                <div className="eyebrow">Browser settings</div>
                <h2 id="browser-profiles-title">Browser profiles</h2>
                <p>
                  Keep work, personal, or client sign-ins in separate saved
                  browsing contexts.
                </p>
              </div>
              <button
                className="profile-modal-close"
                type="button"
                aria-label="Close browser profiles"
                onClick={() => setProfileManagerOpen(false)}
              >
                ×
              </button>
            </header>

            <div className="profile-card-grid">
              {desktop?.workspaces.workspaces.map((workspace) => {
                const selected =
                  desktop.workspaces.selectedWorkspaceId === workspace.id;
                return (
                  <div
                    className="profile-card"
                    key={workspace.id}
                    data-selected={selected ? "true" : undefined}
                  >
                    <button
                      className="profile-card-select"
                      type="button"
                      aria-pressed={selected}
                      disabled={busy || selected}
                      onClick={() =>
                        void run(() =>
                          window.rove.selectBrowserWorkspace(workspace.id),
                        ).then((status) => {
                          if (status !== undefined)
                            setBrowserChoice(`workspace:${workspace.id}`);
                        })
                      }
                    >
                      <span className="profile-avatar" aria-hidden="true">
                        {workspace.displayName.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="profile-card-copy">
                        <strong>{workspace.displayName}</strong>
                        <small>
                          {selected ? "Default profile" : "Saved profile"}
                        </small>
                      </span>
                      {selected && (
                        <span className="profile-selected" aria-hidden="true">
                          ✓
                        </span>
                      )}
                    </button>
                    <details className="profile-actions">
                      <summary
                        aria-label={`Manage ${workspace.displayName}`}
                        title={`Manage ${workspace.displayName}`}
                      >
                        •••
                      </summary>
                      <div className="profile-actions-popover">
                        <button
                          type="button"
                          onClick={(event) => {
                            closeParentMenu(event);
                            setDeletingProfileId(null);
                            setEditingProfileId(workspace.id);
                            setProfileNameDraft(workspace.displayName);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          className="danger-text"
                          type="button"
                          onClick={(event) => {
                            closeParentMenu(event);
                            setEditingProfileId(null);
                            setDeletingProfileId(workspace.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </details>
                  </div>
                );
              })}
              {(desktop?.workspaces.workspaces.length ?? 0) === 0 && (
                <p className="profile-empty">
                  Create your first saved profile to retain browser sign-ins
                  between tasks.
                </p>
              )}
            </div>

            {editingProfileId !== null && (
              <form
                className="profile-inline-panel"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = profileNameDraft.trim();
                  if (!name || busy) return;
                  void run(() =>
                    window.rove.renameBrowserWorkspace(editingProfileId, name),
                  ).then((status) => {
                    if (status !== undefined) setEditingProfileId(null);
                  });
                }}
              >
                <div>
                  <strong>Rename profile</strong>
                  <small>
                    The profile’s cookies and sign-ins stay unchanged.
                  </small>
                </div>
                <div className="profile-create-controls">
                  <input
                    aria-label="Browser profile name"
                    maxLength={80}
                    value={profileNameDraft}
                    onChange={(event) =>
                      setProfileNameDraft(event.target.value)
                    }
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setEditingProfileId(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary"
                    type="submit"
                    disabled={busy || !profileNameDraft.trim()}
                  >
                    Save
                  </button>
                </div>
              </form>
            )}

            {deletingProfileId !== null && (
              <section className="profile-inline-panel profile-delete-confirm">
                <div>
                  <strong>Delete this profile?</strong>
                  <small>
                    Its locally saved cookies, sign-ins, and browsing data will
                    be permanently removed. Task history remains.
                  </small>
                </div>
                <div className="profile-confirm-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDeletingProfileId(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="danger"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const workspaceId = deletingProfileId;
                      void run(() =>
                        window.rove.deleteBrowserWorkspace(workspaceId),
                      ).then((status) => {
                        if (status === undefined) return;
                        const selected = status.selectedWorkspaceId;
                        setBrowserChoice(
                          selected === undefined
                            ? "temporary"
                            : `workspace:${selected}`,
                        );
                        setDeletingProfileId(null);
                      });
                    }}
                  >
                    Delete profile
                  </button>
                </div>
              </section>
            )}

            <form
              className="profile-create"
              onSubmit={(event) => {
                event.preventDefault();
                const name = workspaceDraft.trim();
                if (!name || busy) return;
                void run(() => window.rove.createBrowserWorkspace(name)).then(
                  (status) => {
                    const selected = status?.selectedWorkspaceId;
                    if (selected) setBrowserChoice(`workspace:${selected}`);
                    if (status !== undefined) setWorkspaceDraft("");
                  },
                );
              }}
            >
              <div>
                <strong>Create a profile</strong>
                <small>Give it a familiar name such as Work or Personal.</small>
              </div>
              <div className="profile-create-controls">
                <input
                  aria-label="New browser profile name"
                  placeholder="Profile name"
                  maxLength={80}
                  value={workspaceDraft}
                  onChange={(event) => setWorkspaceDraft(event.target.value)}
                />
                <button
                  className="primary"
                  type="submit"
                  disabled={busy || !workspaceDraft.trim()}
                >
                  Create
                </button>
              </div>
            </form>

            {renderModalError()}
            <footer>
              <p>
                Guest browsing is available from Commands under Browser profile.
                Guest data is deleted locally when its task ends.
              </p>
            </footer>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div
          className="settings-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <header>
              <div>
                <span className="eyebrow">Settings</span>
                <h2 id="settings-title">Settings</h2>
              </div>
              <button
                className="settings-modal-close"
                type="button"
                aria-label="Close settings"
                onClick={() => setSettingsOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="settings-layout">
              <SettingsNavigation
                active={settingsSection}
                archivedTaskCount={archivedProductTasks(product).length}
                onSelect={setSettingsSection}
              />
              <div className="settings-content">
                {settingsSection === "appearance" ? (
                  <>
                    <section
                      className="settings-appearance"
                      aria-labelledby="appearance-title"
                    >
                      <header>
                        <h3 id="appearance-title">Appearance</h3>
                        <p>Choose how Rove looks on this device.</p>
                      </header>
                      <div className="theme-options" aria-label="Theme">
                        {(
                          [
                            ["system", "System", "Use your desktop setting"],
                            ["light", "Light", "Always use the light theme"],
                            ["dark", "Dark", "Always use the dark theme"],
                          ] as const
                        ).map(([value, label, description]) => (
                          <button
                            type="button"
                            key={value}
                            aria-pressed={themePreference === value}
                            onClick={() => setThemePreference(value)}
                          >
                            <span>
                              <strong>{label}</strong>
                              <small>{description}</small>
                            </span>
                            <span
                              className="theme-option-check"
                              aria-hidden="true"
                            >
                              {themePreference === value ? "✓" : ""}
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                    <LocalBackupSettings
                      busy={busy}
                      status={backupStatus}
                      onExport={() => {
                        setBusy(true);
                        setBackupStatus(null);
                        void window.rove
                          .exportLocalBackup()
                          .then((result) => {
                            setBackupStatus(localBackupExportStatus(result));
                            setOperationError(null);
                          })
                          .catch((cause: unknown) => {
                            setOperationError(
                              cause instanceof Error
                                ? cause.message
                                : "Rove could not export the local backup.",
                            );
                          })
                          .finally(() => setBusy(false));
                      }}
                    />
                  </>
                ) : settingsSection === "archived-tasks" ? (
                  <ArchivedTaskSettings
                    product={product}
                    busy={busy}
                    titleForTask={displayTaskTitle}
                    onOpen={(task) => {
                      setArchivedPreviewTaskId(task.taskId);
                      setSelectedWorkflowWorkspaceId(null);
                      setSelectedWorkflowOutputId(null);
                      setShowNewTask(false);
                      setSettingsOpen(false);
                    }}
                    onRestore={(task) => void restoreTask(task)}
                  />
                ) : (
                  <RoveAccountSettings
                    desktop={desktop}
                    busy={busy}
                    email={roveEmail}
                    code={roveCode}
                    status={roveAccountStatus}
                    onEmail={setRoveEmail}
                    onCode={setRoveCode}
                    run={(operation, success) => {
                      setBusy(true);
                      setRoveAccountStatus(null);
                      void operation()
                        .then((result) => {
                          setRoveAccountStatus(
                            typeof result === "string"
                              ? result
                              : (success ?? null),
                          );
                          setOperationError(null);
                          return refresh();
                        })
                        .catch((cause: unknown) =>
                          setOperationError(
                            cause instanceof Error
                              ? cause.message
                              : "Rove account operation failed.",
                          ),
                        )
                        .finally(() => setBusy(false));
                    }}
                  />
                )}
                {renderModalError()}
              </div>
            </div>
          </section>
        </div>
      )}

      <main className="product-layout">
        <section
          className={`product-main${selectedWorkflow ? " product-main-workflow" : viewedTask ? " product-main-task" : " product-main-composer"}`}
          aria-label={
            selectedWorkflow ? "Workflow workspace" : "Task workspace"
          }
          tabIndex={0}
        >
          {unmatchedSession !== null && (
            <section
              className="product-warning"
              aria-label="Unmatched browser session"
            >
              <strong>Browser session needs cleanup</strong>
              <span>
                Rove found an unmatched {unmatchedSession.session.mode} session.
                Status: {unmatchedSession.session.status}. Controller:{" "}
                {unmatchedSession.session.controller ?? "none"}.
              </span>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    window.rove.finishSession(unmatchedSession.session.id),
                  )
                }
              >
                Finish session
              </button>
            </section>
          )}
          {fileAttention.map((entry) => (
            <section
              key={entry.requestId}
              className="product-warning file-attention"
              aria-label="File selection needed"
            >
              <strong>File selection needed</strong>
              <span>{entry.reason}</span>
              {entry.error && <span>{entry.error}</span>}
              <div className="attention-actions">
                <button
                  className="primary"
                  disabled={
                    busy ||
                    ![
                      "waiting",
                      "reconciliation_required",
                      "cleanup_required",
                    ].includes(entry.status)
                  }
                  onClick={() =>
                    void run(() =>
                      command({
                        type: "file-attention.select",
                        requestId: entry.requestId,
                        taskId: entry.taskId,
                        sessionId: entry.sessionId,
                      }),
                    )
                  }
                >
                  {["reconciliation_required", "cleanup_required"].includes(
                    entry.status,
                  )
                    ? "Retry"
                    : "Select files"}
                </button>
                <button
                  disabled={
                    busy ||
                    ![
                      "waiting",
                      "reconciliation_required",
                      "cleanup_required",
                      "failed",
                    ].includes(entry.status)
                  }
                  onClick={() =>
                    void run(() =>
                      command({
                        type: "file-attention.cancel",
                        requestId: entry.requestId,
                        taskId: entry.taskId,
                        sessionId: entry.sessionId,
                      }),
                    )
                  }
                >
                  Cancel
                </button>
              </div>
            </section>
          ))}
          {viewedTask?.conversation?.archived === true && (
            <section className="product-warning archived-task-notice">
              <strong>Archived task</strong>
              <span>
                This conversation is preserved locally. Restore it to return it
                to normal Task History.
              </span>
            </section>
          )}
          {viewedTask?.attachments?.some(
            (attachment) => attachment.status === "unavailable",
          ) && (
            <section
              className="attachment-composer"
              aria-label="Attachments needing attention"
            >
              {viewedTask.attachments
                .filter((attachment) => attachment.status === "unavailable")
                .map((attachment) => (
                  <div className="attachment-chip" key={attachment.id}>
                    <span>{attachment.filename}</span>
                    <small>File needs to be selected again</small>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          command({
                            type: "task.attachment.reselect",
                            taskId: viewedTask.taskId,
                            attachmentId: attachment.id,
                          }),
                        )
                      }
                    >
                      Reselect
                    </button>
                  </div>
                ))}
            </section>
          )}
          {selectedWorkflow && (
            <div className="workflow-workspace">
              <header className="workflow-workspace-header">
                <div>
                  <div className="eyebrow">Workflow</div>
                  <h1>{selectedWorkflow.name}</h1>
                </div>
                <nav aria-label="Workflow sections">
                  <button
                    type="button"
                    aria-current={
                      workflowWorkspaceSection === "home" ? "page" : undefined
                    }
                    onClick={() => {
                      setWorkflowWorkspaceSection("home");
                      setSelectedWorkflowOutputId(null);
                    }}
                  >
                    Home
                  </button>
                  <button
                    type="button"
                    aria-current={
                      workflowWorkspaceSection === "outputs"
                        ? "page"
                        : undefined
                    }
                    onClick={() => {
                      setWorkflowWorkspaceSection("outputs");
                      setSelectedWorkflowOutputId(null);
                    }}
                  >
                    Outputs
                  </button>
                  <button
                    type="button"
                    aria-current={
                      workflowWorkspaceSection === "context"
                        ? "page"
                        : undefined
                    }
                    className="workflow-context-button"
                    onClick={() => {
                      setWorkflowWorkspaceSection("context");
                      setSelectedWorkflowOutputId(null);
                      setWorkflowEditor(null);
                      setWorkflowContextEditSection(null);
                    }}
                  >
                    Context
                  </button>
                </nav>
              </header>

              {workflowWorkspaceSection === "home" ? (
                <div className="workflow-home">
                  <section className="workflow-start-card">
                    <div>
                      <span className="eyebrow">Start here</span>
                      <h2>What would you like to get done?</h2>
                      <p>
                        New tasks started here stay connected to this Workflow.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        setSelectedWorkflowId(selectedWorkflow.workflowId);
                        setShareWorkflowContext("");
                        setSelectedWorkflowWorkspaceId(null);
                        setSelectedTaskId(null);
                        setShowNewTask(true);
                      }}
                    >
                      New task
                    </button>
                  </section>

                  <div className="workflow-home-grid">
                    <section
                      className="workflow-home-section"
                      aria-labelledby="workflow-recent-tasks"
                    >
                      <header>
                        <div>
                          <span className="eyebrow">Continue</span>
                          <h2 id="workflow-recent-tasks">Recent tasks</h2>
                        </div>
                      </header>
                      {workflowWorkspace.tasks.length === 0 ? (
                        <div className="workflow-empty-state">
                          <strong>No tasks yet</strong>
                          <p>Start the first task when you’re ready.</p>
                        </div>
                      ) : (
                        <div className="workflow-item-list">
                          {workflowWorkspace.tasks.slice(0, 5).map((task) => (
                            <button
                              type="button"
                              key={task.taskId}
                              aria-label={`Open Workflow task: ${task.taskId}`}
                              onClick={() => {
                                setSelectedTaskId(task.taskId);
                                setSelectedWorkflowWorkspaceId(null);
                                setShowNewTask(false);
                              }}
                            >
                              <span>
                                <strong>{displayTaskTitle(task)}</strong>
                                <small>
                                  {task.conversation?.turnStatus ===
                                  "in_progress"
                                    ? "Working"
                                    : terminalProductTask(task)
                                      ? "Completed"
                                      : task.lifecycle.phase.replaceAll(
                                          "_",
                                          " ",
                                        )}
                                </small>
                              </span>
                              <span aria-hidden="true">›</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>

                    <section
                      className="workflow-home-section"
                      aria-labelledby="workflow-recent-outputs"
                    >
                      <header>
                        <div>
                          <span className="eyebrow">Keep using</span>
                          <h2 id="workflow-recent-outputs">Recent outputs</h2>
                        </div>
                        {workflowWorkspace.outputs.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setWorkflowWorkspaceSection("outputs");
                              setSelectedWorkflowOutputId(null);
                            }}
                          >
                            View all
                          </button>
                        )}
                      </header>
                      {workflowWorkspace.outputs.length === 0 ? (
                        <div className="workflow-empty-state">
                          <strong>No outputs yet</strong>
                          <p>Useful work you save will appear here.</p>
                        </div>
                      ) : (
                        <div className="workflow-item-list">
                          {workflowWorkspace.outputs
                            .slice(0, 3)
                            .map(({ result }) => (
                              <button
                                type="button"
                                key={result.resultId}
                                aria-label={`Open Output: ${result.revision.title}`}
                                onClick={() =>
                                  openWorkflowOutput(
                                    selectedWorkflow.workflowId,
                                    result.resultId,
                                  )
                                }
                              >
                                <span className="workflow-output-summary">
                                  <span
                                    className="output-kind-icon"
                                    aria-hidden="true"
                                  >
                                    {outputKindLabel(result.kind).charAt(0)}
                                  </span>
                                  <span>
                                    <strong>{result.revision.title}</strong>
                                    <small>
                                      {outputPreview(
                                        result.revision.title,
                                        result.revision.body,
                                      )}
                                    </small>
                                  </span>
                                </span>
                                <span aria-hidden="true">›</span>
                              </button>
                            ))}
                        </div>
                      )}
                    </section>
                  </div>

                  {workflowWorkspace.attention.length > 0 && (
                    <section
                      className="workflow-home-section workflow-attention"
                      aria-labelledby="workflow-needs-attention"
                    >
                      <header>
                        <div>
                          <span className="eyebrow">Needs attention</span>
                          <h2 id="workflow-needs-attention">
                            Your input is needed
                          </h2>
                        </div>
                      </header>
                      <div className="workflow-item-list">
                        {workflowWorkspace.attention.map((entry) => (
                          <button
                            type="button"
                            key={`${entry.taskId}:${entry.requestId}:${entry.generation}`}
                            onClick={() => {
                              setSelectedTaskId(entry.taskId);
                              setSelectedWorkflowWorkspaceId(null);
                              setShowNewTask(false);
                            }}
                          >
                            <span>
                              <strong>{entry.title}</strong>
                              <small>
                                {displayTaskTitle(
                                  workflowWorkspace.tasks.find(
                                    (task) => task.taskId === entry.taskId,
                                  )!,
                                )}
                              </small>
                            </span>
                            <span aria-hidden="true">›</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              ) : workflowWorkspaceSection === "outputs" ? (
                <section
                  className="workflow-outputs"
                  aria-labelledby="workflow-outputs-title"
                >
                  {selectedWorkflowOutput ? (
                    <article className="output-detail">
                      <button
                        type="button"
                        className="output-detail-back"
                        onClick={() => setSelectedWorkflowOutputId(null)}
                      >
                        <span aria-hidden="true">←</span> Outputs
                      </button>
                      <header>
                        <div className="output-detail-identity">
                          <span className="output-kind-icon" aria-hidden="true">
                            {outputKindLabel(
                              selectedWorkflowOutput.result.kind,
                            ).charAt(0)}
                          </span>
                          <span className="workflow-output-kind">
                            {outputKindLabel(
                              selectedWorkflowOutput.result.kind,
                            )}
                          </span>
                        </div>
                        <h2 id="workflow-outputs-title">
                          {selectedWorkflowOutput.result.revision.title}
                        </h2>
                        <button
                          type="button"
                          className="output-provenance"
                          onClick={() => {
                            setSelectedTaskId(
                              selectedWorkflowOutput.task.taskId,
                            );
                            setSelectedWorkflowWorkspaceId(null);
                            setSelectedWorkflowOutputId(null);
                            setShowNewTask(false);
                          }}
                        >
                          From “{displayTaskTitle(selectedWorkflowOutput.task)}”
                        </button>
                      </header>
                      {outputStatus(selectedWorkflowOutput.result) && (
                        <section
                          className="output-action-status"
                          data-tone={
                            outputStatus(selectedWorkflowOutput.result)!.tone
                          }
                          aria-label="Action status"
                        >
                          <strong>
                            {outputStatus(selectedWorkflowOutput.result)!.label}
                          </strong>
                          <p>
                            {
                              outputStatus(selectedWorkflowOutput.result)!
                                .description
                            }
                          </p>
                        </section>
                      )}
                      {selectedWorkflowOutput.result.kind === "action" &&
                      selectedWorkflowOutput.result.actionMaterial ? (
                        <dl className="output-action-review">
                          {selectedWorkflowOutput.result.actionMaterial
                            .recipient && (
                            <>
                              <dt>To</dt>
                              <dd>
                                {
                                  selectedWorkflowOutput.result.actionMaterial
                                    .recipient
                                }
                              </dd>
                            </>
                          )}
                          <dt>Message</dt>
                          <dd>
                            {
                              selectedWorkflowOutput.result.actionMaterial
                                .content
                            }
                          </dd>
                          {selectedWorkflowOutput.result.actionMaterial
                            .attachmentIds.length > 0 && (
                            <>
                              <dt>Attachments</dt>
                              <dd>
                                {selectedWorkflowOutput.result.actionMaterial.attachmentIds
                                  .map(
                                    (attachmentId) =>
                                      selectedWorkflowOutput.task.attachments?.find(
                                        (attachment) =>
                                          attachment.id === attachmentId,
                                      )?.filename ?? "Attached file",
                                  )
                                  .join(", ")}
                              </dd>
                            </>
                          )}
                          {selectedWorkflowOutput.result.actionMaterial
                            .target && (
                            <>
                              <dt>Destination</dt>
                              <dd>
                                {
                                  selectedWorkflowOutput.result.actionMaterial
                                    .target
                                }
                              </dd>
                            </>
                          )}
                          {selectedWorkflowOutput.result.actionMaterial
                            .scope && (
                            <>
                              <dt>Scope</dt>
                              <dd>
                                {
                                  selectedWorkflowOutput.result.actionMaterial
                                    .scope
                                }
                              </dd>
                            </>
                          )}
                        </dl>
                      ) : (
                        <div className="output-detail-content">
                          <MessageBody
                            text={outputBodyForPresentation(
                              selectedWorkflowOutput.result.revision.title,
                              selectedWorkflowOutput.result.revision.body,
                            )}
                          />
                        </div>
                      )}
                      <footer className="output-detail-actions">
                        {selectedWorkflowOutput.result.kind === "draft" && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              beginResultRevision(selectedWorkflowOutput.result)
                            }
                          >
                            Edit
                          </button>
                        )}
                        {selectedWorkflowOutput.result.kind !== "action" &&
                          selectedWorkflowOutput.result.kind !== "artifact" && (
                            <button
                              type="button"
                              className="output-context-action"
                              disabled={busy}
                              onClick={() =>
                                beginResultPromotion(
                                  selectedWorkflowOutput.result,
                                )
                              }
                            >
                              Add to Context
                            </button>
                          )}
                        {selectedWorkflowOutput.result.kind !== "action" && (
                          <button
                            type="button"
                            className="primary"
                            disabled={busy}
                            onClick={() =>
                              void continueFromOutput(
                                selectedWorkflowOutput.result,
                              )
                            }
                          >
                            Continue in task
                          </button>
                        )}
                        {selectedWorkflowOutput.result.kind === "action" &&
                          selectedWorkflowOutput.result.lifecycle ===
                            "prepared" && (
                            <button
                              type="button"
                              className="primary"
                              disabled={busy}
                              onClick={() =>
                                void authorizeResult(
                                  selectedWorkflowOutput.result,
                                )
                              }
                            >
                              Approve and send
                            </button>
                          )}
                      </footer>
                    </article>
                  ) : (
                    <>
                      <header>
                        <div>
                          <span className="eyebrow">Outputs</span>
                          <h2 id="workflow-outputs-title">
                            Useful work to return to
                          </h2>
                          <p>Things you saved from this Workflow’s tasks.</p>
                        </div>
                      </header>
                      {workflowWorkspace.outputs.length === 0 ? (
                        <div className="workflow-empty-state workflow-empty-state-large">
                          <strong>No outputs yet</strong>
                          <p>
                            Save useful work from a task and it will appear
                            here.
                          </p>
                        </div>
                      ) : (
                        <div className="workflow-output-list">
                          {workflowWorkspace.outputs.map(({ task, result }) => {
                            const status = outputStatus(result);
                            return (
                              <button
                                type="button"
                                key={result.resultId}
                                aria-label={`Open Output: ${result.revision.title}`}
                                onClick={() =>
                                  openWorkflowOutput(
                                    selectedWorkflow.workflowId,
                                    result.resultId,
                                  )
                                }
                              >
                                <span
                                  className="output-kind-icon"
                                  aria-hidden="true"
                                >
                                  {outputKindLabel(result.kind).charAt(0)}
                                </span>
                                <span>
                                  <span className="workflow-output-kind">
                                    {outputKindLabel(result.kind)}
                                  </span>
                                  <strong>{result.revision.title}</strong>
                                  <small>
                                    {outputPreview(
                                      result.revision.title,
                                      result.revision.body,
                                    )}
                                  </small>
                                  <span className="output-source">
                                    From {displayTaskTitle(task)}
                                    {status ? ` · ${status.label}` : ""}
                                  </span>
                                </span>
                                <span aria-hidden="true">›</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </section>
              ) : (
                <section
                  className="workflow-context-surface"
                  aria-labelledby="workflow-context-title"
                >
                  <header>
                    <div>
                      <span className="eyebrow">Context</span>
                      <h2 id="workflow-context-title">
                        Help Rove understand how to work here
                      </h2>
                      <p>
                        Review what Rove will use. Edit one part when it needs
                        to change.
                      </p>
                    </div>
                  </header>
                  {(
                    [
                      [
                        "goal",
                        "Goal",
                        selectedWorkflow.revision.configuration.purpose ||
                          "No goal has been added yet.",
                      ],
                      [
                        "help",
                        "How Rove should help",
                        [
                          ...selectedWorkflow.revision.configuration
                            .preferences,
                          ...selectedWorkflow.revision.configuration.guidance,
                        ]
                          .map((entry) => entry.text)
                          .join(" · ") || "No preferences have been added yet.",
                      ],
                      [
                        "success",
                        "What good looks like",
                        [
                          ...selectedWorkflow.revision.configuration.criteria,
                          ...selectedWorkflow.revision.configuration
                            .resultConventions,
                        ]
                          .map((entry) => entry.text)
                          .join(" · ") ||
                          "No success expectations have been added yet.",
                      ],
                      [
                        "knowledge",
                        "Knowledge & resources",
                        [
                          ...selectedWorkflow.revision.configuration.approvedKnowledge.map(
                            (entry) => entry.text,
                          ),
                          ...selectedWorkflow.revision.configuration.resourceRequirements.map(
                            (entry) => entry.label,
                          ),
                        ].join(" · ") ||
                          "No knowledge or resources have been added yet.",
                      ],
                    ] as const
                  ).map(([section, title, summary]) => (
                    <article className="workflow-context-section" key={section}>
                      <header>
                        <h3>{title}</h3>
                        <button
                          type="button"
                          onClick={() => {
                            setWorkflowEditor(workflowDraft(selectedWorkflow));
                            setWorkflowContextEditSection(section);
                          }}
                        >
                          Edit
                        </button>
                      </header>
                      {workflowContextEditSection === section &&
                      workflowEditor ? (
                        <form
                          className="workflow-context-focused-editor"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveWorkflow();
                            setWorkflowContextEditSection(null);
                          }}
                        >
                          {section === "goal" && (
                            <label>
                              <span>What is this work for?</span>
                              <textarea
                                aria-label="Workflow goal"
                                value={workflowEditor.purpose}
                                onChange={(event) =>
                                  setWorkflowEditor({
                                    ...workflowEditor,
                                    purpose: event.target.value,
                                  })
                                }
                              />
                            </label>
                          )}
                          {section === "help" && (
                            <>
                              <WorkflowGuidanceEditor
                                label="Preferences"
                                entries={workflowEditor.preferences}
                                defaultTopic={workflowEditor.focus}
                                onChange={(preferences) =>
                                  setWorkflowEditor({
                                    ...workflowEditor,
                                    preferences,
                                  })
                                }
                              />
                              <WorkflowGuidanceEditor
                                label="Helpful guidance"
                                entries={workflowEditor.guidance}
                                defaultTopic={workflowEditor.focus}
                                onChange={(guidance) =>
                                  setWorkflowEditor({
                                    ...workflowEditor,
                                    guidance,
                                  })
                                }
                              />
                            </>
                          )}
                          {section === "success" && (
                            <WorkflowGuidanceEditor
                              label="Success expectations"
                              entries={workflowEditor.criteria}
                              defaultTopic={workflowEditor.focus}
                              onChange={(criteria) =>
                                setWorkflowEditor({
                                  ...workflowEditor,
                                  criteria,
                                })
                              }
                            />
                          )}
                          {section === "knowledge" && (
                            <>
                              <WorkflowGuidanceEditor
                                label="Useful knowledge"
                                entries={workflowEditor.approvedKnowledge}
                                defaultTopic={workflowEditor.focus}
                                onChange={(approvedKnowledge) =>
                                  setWorkflowEditor({
                                    ...workflowEditor,
                                    approvedKnowledge,
                                  })
                                }
                              />
                              <WorkflowResourceEditor
                                entries={workflowEditor.resourceRequirements}
                                onChange={(resourceRequirements) =>
                                  setWorkflowEditor({
                                    ...workflowEditor,
                                    resourceRequirements,
                                  })
                                }
                              />
                            </>
                          )}
                          <div className="workflow-context-edit-actions">
                            <button
                              type="button"
                              onClick={() => {
                                setWorkflowEditor(null);
                                setWorkflowContextEditSection(null);
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              className="primary"
                              type="submit"
                              disabled={busy}
                            >
                              Save
                            </button>
                          </div>
                        </form>
                      ) : (
                        <p>{summary}</p>
                      )}
                    </article>
                  ))}
                  <details className="workflow-context-advanced">
                    <summary>Advanced</summary>
                    <p>
                      Procedures, work type, and output preferences remain
                      available when you need them.
                    </p>
                    {workflowContextEditSection === "advanced" &&
                    workflowEditor ? (
                      <form
                        className="workflow-context-focused-editor"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveWorkflow();
                          setWorkflowContextEditSection(null);
                        }}
                      >
                        <label>
                          <span>Primary kind of work</span>
                          <select
                            aria-label="Workflow kind"
                            value={workflowEditor.focus}
                            onChange={(event) =>
                              setWorkflowEditor({
                                ...workflowEditor,
                                focus: event.target
                                  .value as WorkflowEditorDraft["focus"],
                              })
                            }
                          >
                            <option value="research">
                              Research and discovery
                            </option>
                            <option value="review">Review and decisions</option>
                            <option value="outreach">
                              Drafting and outreach
                            </option>
                            <option value="custom">Custom / not sure</option>
                          </select>
                        </label>
                        <WorkflowGuidanceEditor
                          label="Procedures"
                          entries={workflowEditor.procedures}
                          defaultTopic={workflowEditor.focus}
                          onChange={(procedures) =>
                            setWorkflowEditor({ ...workflowEditor, procedures })
                          }
                        />
                        <label>
                          <span>Output preference</span>
                          <select
                            aria-label="Workflow Output style"
                            value={workflowEditor.resultStyle}
                            onChange={(event) =>
                              setWorkflowEditor({
                                ...workflowEditor,
                                resultStyle: event.target
                                  .value as WorkflowEditorDraft["resultStyle"],
                              })
                            }
                          >
                            <option value="sources">
                              With sources and uncertainty
                            </option>
                            <option value="concise">
                              Concise and actionable
                            </option>
                            <option value="detailed">
                              Detailed with reasoning
                            </option>
                          </select>
                        </label>
                        <div className="workflow-context-edit-actions">
                          <button
                            type="button"
                            onClick={() => {
                              setWorkflowEditor(null);
                              setWorkflowContextEditSection(null);
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            className="primary"
                            type="submit"
                            disabled={busy}
                          >
                            Save
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setWorkflowEditor(workflowDraft(selectedWorkflow));
                          setWorkflowContextEditSection("advanced");
                        }}
                      >
                        Edit advanced settings
                      </button>
                    )}
                  </details>
                </section>
              )}
            </div>
          )}
          {!viewedTask && !selectedWorkflow && (
            <div className="composer-card">
              <div className="composer-welcome">
                <div className="eyebrow">New task</div>
                <h1>What would you like to get done?</h1>
              </div>
              <ComposerInputShell
                attachments={product?.draftAttachments ?? []}
                busy={busy}
                onReplace={(attachmentId) =>
                  void run(() =>
                    command({ type: "attachments.replace", attachmentId }),
                  )
                }
                onRemove={(attachmentId) =>
                  void run(() =>
                    command({ type: "attachments.remove", attachmentId }),
                  )
                }
              >
                <textarea
                  ref={outcomeComposer}
                  aria-label="Desired outcome"
                  autoFocus
                  maxLength={16000}
                  placeholder={
                    mode === "capture"
                      ? "What are you demonstrating?"
                      : "Do anything"
                  }
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "/" && outcome.length === 0) {
                      event.preventDefault();
                      const palette = document.getElementById(
                        "task-command-palette",
                      ) as HTMLDetailsElement | null;
                      if (palette) palette.open = true;
                      window.setTimeout(() =>
                        document
                          .querySelector<HTMLInputElement>(
                            "#task-command-palette input[type='search']",
                          )
                          ?.focus(),
                      );
                      return;
                    }
                    if (
                      event.key !== "Enter" ||
                      event.shiftKey ||
                      event.nativeEvent.isComposing
                    )
                      return;
                    event.preventDefault();
                    void attemptLaunch();
                  }}
                />
                <div className="composer-action-row">
                  <ComposerAttachButton
                    busy={busy}
                    onPick={() =>
                      void run(() => command({ type: "attachments.pick" }))
                    }
                  />
                  <details
                    className="composer-menu composer-command-menu"
                    id="task-command-palette"
                  >
                    <summary aria-label="Commands" title="Commands">
                      <span aria-hidden="true">/</span>
                    </summary>
                    <div
                      className="composer-command-palette"
                      aria-label="Task commands and settings"
                    >
                      <label className="composer-command-search">
                        <span>Commands</span>
                        <input
                          type="search"
                          aria-label="Search commands"
                          placeholder="Search actions and settings"
                          value={commandPaletteQuery}
                          onChange={(event) =>
                            setCommandPaletteQuery(event.target.value)
                          }
                        />
                      </label>
                      {commandPaletteMatches(
                        commandPaletteQuery,
                        "attach",
                        "file",
                      ) && (
                        <section>
                          <strong>Actions</strong>
                          <button
                            type="button"
                            onClick={() =>
                              void run(() =>
                                command({ type: "attachments.pick" }),
                              )
                            }
                          >
                            <span>Attach file</span>
                            <small>Add local task material</small>
                          </button>
                        </section>
                      )}
                      {commandPaletteMatches(
                        commandPaletteQuery,
                        "workflow",
                        "task",
                        "mode",
                        "approval",
                        "browser",
                      ) && (
                        <section>
                          <strong>Task</strong>
                          <div className="composer-control-rail">
                            <label className="workflow-task-choice">
                              <span>Workflow</span>
                              <select
                                aria-label="Workflow environment"
                                value={selectedWorkflowId}
                                onChange={(event) => {
                                  setSelectedWorkflowId(event.target.value);
                                  setShareWorkflowContext("");
                                }}
                              >
                                <option value="">Standalone task</option>
                                {product?.workflows
                                  .filter((workflow) => !workflow.archived)
                                  .map((workflow) => (
                                    <option
                                      key={workflow.workflowId}
                                      value={workflow.workflowId}
                                    >
                                      {workflow.name}
                                    </option>
                                  ))}
                              </select>
                            </label>
                            <ComposerModeMenu mode={mode} onChange={setMode} />
                            <ComposerPermissionMenu
                              approvalsReviewer={approvalsReviewer}
                              mode={mode}
                              onChange={setApprovalsReviewer}
                            />
                            <details className="composer-menu composer-setup-menu">
                              <summary aria-label="Browser profile">
                                Browser profile
                              </summary>
                              <div className="composer-popover compact-popover">
                                <section>
                                  <strong>Browser profile</strong>
                                  {desktop?.workspaces.workspaces.map(
                                    (workspace) => (
                                      <button
                                        key={workspace.id}
                                        type="button"
                                        aria-label={`Browser profile: ${workspace.displayName}`}
                                        disabled={product?.tasks.some((task) =>
                                          taskHasAttachedBrowserWorkspace(
                                            task,
                                            workspace.id,
                                          ),
                                        )}
                                        aria-pressed={
                                          browserChoice ===
                                          `workspace:${workspace.id}`
                                        }
                                        onClick={(event) => {
                                          setBrowserChoice(
                                            `workspace:${workspace.id}`,
                                          );
                                          closeParentMenu(event);
                                        }}
                                      >
                                        <span>{workspace.displayName}</span>
                                        <small>
                                          {product?.tasks.some((task) =>
                                            taskHasAttachedBrowserWorkspace(
                                              task,
                                              workspace.id,
                                            ),
                                          )
                                            ? "Still attached to another task"
                                            : "Saved sign-ins and browsing data"}
                                        </small>
                                      </button>
                                    ),
                                  )}
                                  <button
                                    type="button"
                                    aria-label="Browser profile: Guest"
                                    aria-pressed={browserChoice === "temporary"}
                                    onClick={(event) => {
                                      setBrowserChoice("temporary");
                                      closeParentMenu(event);
                                    }}
                                  >
                                    <span>Guest</span>
                                    <small>
                                      Starts fresh and is deleted locally
                                    </small>
                                  </button>
                                </section>
                              </div>
                            </details>
                          </div>
                          {selectedWorkflowId && (
                            <label className="workflow-share-choice">
                              <span>Workflow guidance</span>
                              <select
                                aria-label="Workflow guidance sharing"
                                required
                                value={shareWorkflowContext}
                                onChange={(event) =>
                                  setShareWorkflowContext(
                                    event.target.value as
                                      "" | "share" | "local",
                                  )
                                }
                              >
                                <option value="">
                                  Choose before starting…
                                </option>
                                <option value="share">
                                  Apply relevant guidance to Codex
                                </option>
                                <option value="local">
                                  Keep association local only
                                </option>
                              </select>
                              <small>
                                Applying guidance may send approved relevant
                                text to the model service. Secrets, files,
                                credentials, and browser state are excluded.
                              </small>
                            </label>
                          )}
                        </section>
                      )}
                      {commandPaletteMatches(
                        commandPaletteQuery,
                        "model",
                        "reasoning",
                        "effort",
                      ) && (
                        <section>
                          <strong>Model</strong>
                          <ComposerModelMenu
                            models={product?.catalog.models ?? []}
                            modelId={model}
                            effort={effort}
                            onModelChange={selectComposerModel}
                            onEffortChange={setEffort}
                          />
                        </section>
                      )}
                    </div>
                  </details>
                  <div
                    className="composer-ambient-controls"
                    aria-label="Task configuration"
                  >
                    <ComposerModeMenu mode={mode} onChange={setMode} />
                    <ComposerPermissionMenu
                      approvalsReviewer={approvalsReviewer}
                      mode={mode}
                      onChange={setApprovalsReviewer}
                    />
                  </div>
                  <div className="composer-footer">
                    <ComposerModelMenu
                      models={product?.catalog.models ?? []}
                      modelId={model}
                      effort={effort}
                      onModelChange={selectComposerModel}
                      onEffortChange={setEffort}
                    />
                    <button
                      className="primary composer-submit"
                      aria-label={
                        mode === "capture" ? "Start Capture" : "Start task"
                      }
                      title={
                        gate.ready &&
                        (!selectedWorkflowId || shareWorkflowContext)
                          ? "Start task"
                          : selectedWorkflowId && !shareWorkflowContext
                            ? "Choose how Workflow guidance should be used"
                            : gate.reason
                      }
                      disabled={
                        busy ||
                        outcome.trim().length === 0 ||
                        Boolean(selectedWorkflowId && !shareWorkflowContext)
                      }
                      onClick={() => void attemptLaunch()}
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                  </div>
                </div>
              </ComposerInputShell>
              {customerCodexStatus.ready &&
                !gate.ready &&
                gate.reason &&
                outcome.trim().length > 0 && (
                  <div className="product-warning" role="status">
                    <strong>Choose how to continue</strong>
                    <span>{gate.reason}</span>
                  </div>
                )}
            </div>
          )}

          {product?.tasks
            .flatMap((task) =>
              (task.recordings ?? [])
                .filter((recording) =>
                  ["requested", "recording", "finalizing"].includes(
                    recording.state,
                  ),
                )
                .map((recording) => ({ task, recording })),
            )
            .filter(({ task }) => task.taskId !== viewedTask?.taskId)
            .map(({ task, recording }) => (
              <div
                className="product-warning"
                role="status"
                key={`active-recording:${recording.id}`}
              >
                <strong>
                  {recordingLifecyclePresentation(recording.state).summary}
                </strong>
                <span>
                  {displayTaskTitle(task)} ·{" "}
                  {recordingLifecyclePresentation(recording.state).stateLabel}
                </span>
              </div>
            ))}

          {viewedTask && !selectedWorkflow && (
            <div className="task-detail">
              <section
                className="task-timeline"
                aria-label="Conversation and activity"
              >
                {timeline.length === 0 && (
                  <div className="timeline-empty">
                    <span className="activity-spinner" aria-hidden="true" />
                    <p>{viewedTask.lifecycle.reason}</p>
                  </div>
                )}
                {timelineSegments.map((segment) => (
                  <section className="timeline-turn" key={segment.id}>
                    {segment.input && (
                      <article className="timeline-message timeline-user">
                        {(segment.input.attachments?.length ?? 0) > 0 && (
                          <ConversationAttachments
                            attachments={segment.input.attachments!}
                            taskId={viewedTask.taskId}
                          />
                        )}
                        <MessageBody text={messageText(segment.input)} />
                        <footer className="message-meta message-meta-user">
                          {segment.input.deliveryState === "pending" && (
                            <span>Sending…</span>
                          )}
                          {segment.input.deliveryState === "not_sent" && (
                            <span>Not sent</span>
                          )}
                          {segment.input.deliveryState === "uncertain" && (
                            <span>Delivery unconfirmed</span>
                          )}
                          {formatMessageTime(
                            segment.input.completedAt ??
                              segment.input.startedAt,
                          ) && (
                            <time>
                              {formatMessageTime(
                                segment.input.completedAt ??
                                  segment.input.startedAt,
                              )}
                            </time>
                          )}
                          <button
                            type="button"
                            aria-label="Copy message"
                            title="Copy"
                            onClick={() =>
                              void copyConversationItem(segment.input!)
                            }
                          >
                            {copiedItemId === segment.input.id ? (
                              <span aria-hidden="true">✓</span>
                            ) : (
                              <svg viewBox="0 0 20 20" aria-hidden="true">
                                <rect
                                  x="6.5"
                                  y="6.5"
                                  width="10"
                                  height="10"
                                  rx="2"
                                />
                                <path d="M13.5 6.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
                              </svg>
                            )}
                          </button>
                          {(product?.workflows.some(
                            (workflow) => !workflow.archived,
                          ) ??
                            false) &&
                            !segment.input.attachments?.length && (
                              <button
                                type="button"
                                aria-label="Add message to Context"
                                title="Add to Context"
                                onClick={() =>
                                  beginWorkflowPromotion(
                                    segment.input!,
                                    viewedTask.taskId,
                                  )
                                }
                              >
                                Add to Context
                              </button>
                            )}
                        </footer>
                      </article>
                    )}
                    {segment.work.length > 0 && (
                      <details
                        className="timeline-work"
                        open={openWorkTurnIds.has(segment.id)}
                        onToggle={(event) => {
                          const isOpen = event.currentTarget.open;
                          setOpenWorkTurnIds((current) => {
                            const next = new Set(current);
                            if (isOpen) next.add(segment.id);
                            else next.delete(segment.id);
                            return next;
                          });
                        }}
                      >
                        <summary>
                          <span
                            className={
                              segment.isActiveSegment
                                ? "activity-spinner"
                                : "work-complete"
                            }
                            aria-hidden="true"
                          >
                            {segment.isActiveSegment ? "" : "✓"}
                          </span>
                          <strong>
                            {segment.isActiveSegment ? "Working" : "Worked"}
                            {segment.elapsed ? ` for ${segment.elapsed}` : ""}
                          </strong>
                          {formatMessageTime(segment.completedTimestamp) && (
                            <time>
                              {formatMessageTime(segment.completedTimestamp)}
                            </time>
                          )}
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="m4 6 4 4 4-4" />
                          </svg>
                        </summary>
                        <div className="timeline-work-items">
                          {segment.work.map((item) => {
                            if (item.kind === "assistant_message")
                              return (
                                <div className="work-commentary" key={item.id}>
                                  <MessageBody text={messageText(item)} />
                                </div>
                              );
                            const activity = activityCopy(item);
                            return (
                              <div
                                key={item.id}
                                className="timeline-activity"
                                data-status={item.status}
                              >
                                <span
                                  className="activity-icon"
                                  aria-hidden="true"
                                >
                                  {item.status === "completed" ? "✓" : ""}
                                </span>
                                <span className="activity-copy">
                                  <strong>{activity.label}</strong>
                                  {activity.detail && (
                                    <small>{activity.detail}</small>
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    )}
                    {segment.finals.map((item) => (
                      <article
                        key={item.id}
                        className="timeline-message timeline-assistant timeline-final"
                      >
                        <MessageBody text={messageText(item)} />
                        <footer className="message-meta message-meta-assistant">
                          {formatMessageTime(
                            item.completedAt ?? item.startedAt,
                          ) && (
                            <time>
                              {formatMessageTime(
                                item.completedAt ?? item.startedAt,
                              )}
                            </time>
                          )}
                          <button
                            type="button"
                            aria-label="Copy response"
                            title="Copy"
                            onClick={() => void copyConversationItem(item)}
                          >
                            {copiedItemId === item.id ? (
                              <span aria-hidden="true">✓</span>
                            ) : (
                              <svg viewBox="0 0 20 20" aria-hidden="true">
                                <rect
                                  x="6.5"
                                  y="6.5"
                                  width="10"
                                  height="10"
                                  rx="2"
                                />
                                <path d="M13.5 6.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
                              </svg>
                            )}
                          </button>
                          {viewedTask.workflowAssociation &&
                            (() => {
                              const savedOutput = viewedTask.results.find(
                                (result) =>
                                  result.kind !== "action" &&
                                  result.source.conversationItemId === item.id,
                              );
                              return savedOutput ? (
                                <button
                                  type="button"
                                  className="output-saved-marker"
                                  aria-label={`Open saved Output: ${savedOutput.revision.title}`}
                                  title="Open Output"
                                  onClick={() =>
                                    openWorkflowOutput(
                                      viewedTask.workflowAssociation!
                                        .workflowId,
                                      savedOutput.resultId,
                                    )
                                  }
                                >
                                  <span aria-hidden="true">✓</span>
                                  {savedOutput.revision.title} · Saved to
                                  Outputs
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="save-output-action"
                                  aria-label="Save response to Outputs"
                                  title="Save to Outputs"
                                  disabled={busy}
                                  onClick={() =>
                                    void saveResponseToOutputs(
                                      item,
                                      viewedTask.taskId,
                                    )
                                  }
                                >
                                  Save to Outputs
                                </button>
                              );
                            })()}
                        </footer>
                      </article>
                    ))}
                  </section>
                ))}
              </section>
              {!gate.ready && viewedTask.lifecycle.phase === "recovering" && (
                <div className="product-warning" role="status">
                  <strong>Checking task state</strong>
                  <span>Rove is confirming the latest task activity.</span>
                </div>
              )}
              {!gate.ready &&
                viewedTask.lifecycle.phase !== "recovering" &&
                viewedTask.availableActions.includes("retry_cleanup") && (
                  <div className="product-warning" role="status">
                    <strong>Task needs attention</strong>
                    <span>{viewedTask.lifecycle.reason}</span>
                  </div>
                )}
              <footer className="task-detail-dock">
                {currentCodexAttention &&
                  renderCodexAttention(currentCodexAttention)}
                {!currentCodexAttention && awaitingExplicitResponse && (
                  <p className="task-response-hint">
                    {activeSurfaceDescription}
                  </p>
                )}
                {viewedTask.capabilities?.canStop && (
                  <div className="task-independent-controls">
                    <button
                      type="button"
                      className="composer-stop"
                      aria-label="Stop current work"
                      disabled={busy}
                      onClick={() => void stopTask()}
                    >
                      Stop
                    </button>
                  </div>
                )}
                {!currentCodexAttention &&
                  viewedTask.executionMode !== "capture" &&
                  (viewedTask.capabilities?.canSubmit ||
                    viewedTask.availableActions.includes("resume") ||
                    viewedTask.capabilities?.canReturnToRove) && (
                    <ComposerInputShell
                      attachments={product?.draftAttachments ?? []}
                      busy={busy || !viewedTask.capabilities?.canSubmit}
                      className="followup task-composer-shell"
                      onReplace={(attachmentId) =>
                        void run(() =>
                          command({
                            type: "attachments.replace",
                            attachmentId,
                          }),
                        )
                      }
                      onRemove={(attachmentId) =>
                        void run(() =>
                          command({ type: "attachments.remove", attachmentId }),
                        )
                      }
                    >
                      {viewedTask.results.some((result) => result.selected) && (
                        <div
                          className="output-context-rail"
                          aria-label="Outputs used for this message"
                        >
                          {viewedTask.results
                            .filter((result) => result.selected)
                            .map((result) => (
                              <button
                                type="button"
                                key={result.resultId}
                                disabled={busy}
                                onClick={() =>
                                  void toggleResultSelection(result)
                                }
                              >
                                Using: {result.revision.title} ×
                              </button>
                            ))}
                        </div>
                      )}
                      <textarea
                        ref={followupComposer}
                        aria-label={
                          awaitingExplicitResponse
                            ? "Handoff response"
                            : "Follow-up outcome"
                        }
                        placeholder={
                          awaitingExplicitResponse
                            ? "Reply so the task can continue…"
                            : "Add a follow-up…"
                        }
                        value={followup}
                        disabled={busy || !viewedTask.capabilities?.canSubmit}
                        onChange={(event) => setFollowup(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "/" && followup.length === 0) {
                            event.preventDefault();
                            const palette = document.getElementById(
                              "task-followup-command-palette",
                            ) as HTMLDetailsElement | null;
                            if (palette) palette.open = true;
                            window.setTimeout(() =>
                              document
                                .querySelector<HTMLInputElement>(
                                  "#task-followup-command-palette input[type='search']",
                                )
                                ?.focus(),
                            );
                            return;
                          }
                          if (
                            event.key !== "Enter" ||
                            event.shiftKey ||
                            event.nativeEvent.isComposing
                          )
                            return;
                          event.preventDefault();
                          void sendFollowup();
                        }}
                      />
                      <div className="composer-action-row">
                        <ComposerAttachButton
                          busy={busy || !viewedTask.capabilities?.canSubmit}
                          onPick={() =>
                            void run(() =>
                              command({ type: "attachments.pick" }),
                            )
                          }
                        />
                        <div className="composer-footer">
                          <details
                            className="composer-menu composer-command-menu"
                            id="task-followup-command-palette"
                          >
                            <summary aria-label="Commands" title="Commands">
                              <span aria-hidden="true">/</span>
                            </summary>
                            <div
                              className="composer-command-palette"
                              aria-label="Task commands and settings"
                            >
                              <label className="composer-command-search">
                                <span>Commands</span>
                                <input
                                  type="search"
                                  aria-label="Search commands"
                                  placeholder="Search task settings"
                                  value={commandPaletteQuery}
                                  onChange={(event) =>
                                    setCommandPaletteQuery(event.target.value)
                                  }
                                />
                              </label>
                              {commandPaletteMatches(
                                commandPaletteQuery,
                                "task",
                                "mode",
                                "browser",
                                "approval",
                              ) && (
                                <section>
                                  <strong>Task</strong>
                                  <div className="composer-control-rail">
                                    <ComposerModeMenu
                                      mode={viewedTask.executionMode}
                                    />
                                    <ComposerPermissionMenu
                                      approvalsReviewer={
                                        viewedTask.approvalsReviewer
                                      }
                                      mode={viewedTask.executionMode}
                                    />
                                    <details className="composer-menu composer-setup-menu">
                                      <summary aria-label="Browser profile">
                                        Browser profile
                                      </summary>
                                      <div className="composer-popover compact-popover task-settings-popover">
                                        <div className="task-frozen-option">
                                          <span>{identityLabel}</span>
                                          <small>Fixed for this task</small>
                                        </div>
                                      </div>
                                    </details>
                                  </div>
                                </section>
                              )}
                              {commandPaletteMatches(
                                commandPaletteQuery,
                                "model",
                                "reasoning",
                                "effort",
                              ) && (
                                <section>
                                  <strong>Model</strong>
                                  <ComposerModelMenu
                                    models={product?.catalog.models ?? []}
                                    modelId={viewedTask.model ?? ""}
                                    effort={viewedTask.reasoningEffort ?? ""}
                                  />
                                </section>
                              )}
                            </div>
                          </details>
                          <ComposerModeMenu mode={viewedTask.executionMode} />
                          <ComposerPermissionMenu
                            approvalsReviewer={viewedTask.approvalsReviewer}
                            mode={viewedTask.executionMode}
                          />
                          <ComposerModelMenu
                            models={product?.catalog.models ?? []}
                            modelId={viewedTask.model ?? ""}
                            effort={viewedTask.reasoningEffort ?? ""}
                          />
                          {viewedTask.capabilities?.canReturnToRove ? (
                            <button
                              className="primary composer-submit"
                              aria-label="Resume automation"
                              title="Return control to Rove"
                              disabled={busy}
                              onClick={() => void returnControl()}
                            >
                              <span aria-hidden="true">▶</span>
                            </button>
                          ) : viewedTask.availableActions.includes("resume") ? (
                            <button
                              className="primary composer-submit"
                              aria-label="Resume task"
                              title="Resume task"
                              disabled={busy}
                              onClick={() => void restoreTask()}
                            >
                              <span aria-hidden="true">▶</span>
                            </button>
                          ) : (
                            <button
                              className="primary composer-submit"
                              aria-label="Send follow-up"
                              disabled={busy || !followup.trim()}
                              onClick={() => void sendFollowup()}
                            >
                              <span aria-hidden="true">↑</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </ComposerInputShell>
                  )}
              </footer>
            </div>
          )}

          {error && activeModal === null && (
            <div className="product-error" role="alert">
              <strong>Rove needs attention</strong>
              <span>{error}</span>
            </div>
          )}
        </section>

        <aside
          className="product-sidebar"
          aria-label="Task controls and status"
          tabIndex={0}
        >
          <button
            className="sidebar-new-task"
            type="button"
            aria-current={
              viewedTask === undefined && selectedWorkflow === undefined
                ? "page"
                : undefined
            }
            onClick={() => {
              setSelectedWorkflowWorkspaceId(null);
              setSelectedWorkflowOutputId(null);
              setSelectedWorkflowId("");
              setShareWorkflowContext("");
              setSelectedTaskId(null);
              setArchivedPreviewTaskId(null);
              setShowNewTask(true);
            }}
          >
            <span aria-hidden="true">＋</span>
            <strong>New task</strong>
          </button>

          <section className="side-card workflow-list">
            <div className="side-heading">
              <span>Workflows</span>
              <button
                type="button"
                aria-label="Create Workflow"
                onClick={() => setWorkflowCreateName("")}
              >
                ＋
              </button>
            </div>
            {product?.workflows.map((workflow) => (
              <button
                className="workflow-list-row"
                type="button"
                key={workflow.workflowId}
                data-current={
                  workflow.workflowId === selectedWorkflow?.workflowId
                    ? "true"
                    : undefined
                }
                onClick={() => {
                  setSelectedWorkflowWorkspaceId(workflow.workflowId);
                  setWorkflowWorkspaceSection("home");
                  setSelectedWorkflowOutputId(null);
                  setSelectedTaskId(null);
                  setArchivedPreviewTaskId(null);
                  setShowNewTask(false);
                }}
              >
                <strong>{workflow.name}</strong>
                <small>
                  {workflow.archived ? "Archived · " : ""}
                  {
                    product.tasks.filter(
                      (task) =>
                        task.workflowAssociation?.workflowId ===
                        workflow.workflowId,
                    ).length
                  }{" "}
                  {product.tasks.filter(
                    (task) =>
                      task.workflowAssociation?.workflowId ===
                      workflow.workflowId,
                  ).length === 1
                    ? "task"
                    : "tasks"}
                  {(() => {
                    const badge = workflowSynchronizationBadge(
                      currentOwnerWorkflowSyncBinding(
                        desktop,
                        workflow.workflowId,
                      ),
                    );
                    return badge ? <> · {badge}</> : null;
                  })()}
                </small>
              </button>
            ))}
          </section>

          {selectableProductTasks(product).length > 0 && (
            <section className="side-card task-history">
              <div className="side-heading">
                <span>Task history</span>
              </div>
              {selectableProductTasks(product).map((entry) => (
                <div
                  className="task-history-row"
                  key={entry.taskId}
                  onContextMenu={(event) => openTaskContextMenu(event, entry)}
                  data-current={
                    entry.taskId === viewedTask?.taskId ? "true" : undefined
                  }
                  data-needs-input={
                    taskNeedsCustomerInput(product, entry.taskId)
                      ? "true"
                      : undefined
                  }
                >
                  <button
                    className="task-history-select"
                    aria-label={`Task history: ${entry.taskId}`}
                    aria-current={
                      entry.taskId === viewedTask?.taskId ? "true" : undefined
                    }
                    onClick={() => {
                      setSelectedWorkflowWorkspaceId(null);
                      setSelectedWorkflowOutputId(null);
                      setSelectedTaskId(entry.taskId);
                      setArchivedPreviewTaskId(null);
                      setShowNewTask(false);
                    }}
                  >
                    <strong>{displayTaskTitle(entry)}</strong>
                    <span>
                      {entry.workflowAssociation
                        ? `${entry.workflowAssociation.workflowName} · `
                        : "Standalone · "}
                      {taskNeedsCustomerInput(product, entry.taskId)
                        ? "Needs input"
                        : entry.conversation?.turnStatus === "in_progress"
                          ? "Working"
                          : terminalProductTask(entry)
                            ? "Completed"
                            : entry.lifecycle.phase.replaceAll("_", " ")}
                      {` · ${entry.executionMode === "agent" ? "Agent" : entry.executionMode === "companion" ? "Companion" : "Capture"}`}
                    </span>
                  </button>
                  {entry.availableActions.includes("archive") && (
                    <button
                      className="task-history-archive"
                      type="button"
                      aria-label={`Archive ${displayTaskTitle(entry)}`}
                      title="Archive task"
                      disabled={archivingTaskIds.has(entry.taskId)}
                      onClick={() => requestTaskArchive(entry)}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M3.5 5.5h13v10.25a1.75 1.75 0 0 1-1.75 1.75h-9a1.75 1.75 0 0 1-1.75-1.75V5.5Zm-.5-3h14a1 1 0 0 1 1 1v2H2v-2a1 1 0 0 1 1-1Zm4 6.5h6" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}

          <button
            className="sidebar-profile"
            type="button"
            aria-label="Open Rove profile settings"
            onClick={() => {
              setSettingsSection("appearance");
              setSettingsOpen(true);
            }}
          >
            <span className="sidebar-profile-avatar" aria-hidden="true">
              R
            </span>
            <span className="sidebar-profile-copy">
              <strong>Rove profile</strong>
              <small>Local profile</small>
            </span>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m7.5 4 6 6-6 6" />
            </svg>
          </button>

          {taskContextMenu && taskContextEntry && (
            <div
              className="task-context-menu"
              role="menu"
              aria-label={`Actions for ${displayTaskTitle(taskContextEntry)}`}
              style={{ left: taskContextMenu.x, top: taskContextMenu.y }}
              onContextMenu={(event) => event.preventDefault()}
            >
              {renamingTaskId === taskContextEntry.taskId ? (
                <form
                  className="task-rename-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveTaskRename(taskContextEntry.taskId);
                  }}
                >
                  <label htmlFor="task-rename-input">Rename task</label>
                  <input
                    id="task-rename-input"
                    autoFocus
                    maxLength={80}
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                  />
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingTaskId(null);
                        setTaskContextMenu(null);
                      }}
                    >
                      Cancel
                    </button>
                    <button type="submit">Save</button>
                  </div>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => beginTaskRename(taskContextEntry)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={
                      !taskContextEntry.availableActions.includes("archive") ||
                      archivingTaskIds.has(taskContextEntry.taskId)
                    }
                    onClick={() => {
                      setTaskContextMenu(null);
                      requestTaskArchive(taskContextEntry);
                    }}
                  >
                    {archivingTaskIds.has(taskContextEntry.taskId)
                      ? "Archiving…"
                      : "Archive"}
                  </button>
                </>
              )}
            </div>
          )}
        </aside>
        {viewedTask && !selectedWorkflow && (
          <aside className="product-inspector" aria-label="Task inspector">
            <section
              className="inspector-panel browser-status"
              aria-label="Browser status"
              data-attached={browserAttached ? "true" : undefined}
            >
              <header className="inspector-heading">
                <span>Browser</span>
              </header>
              <div className="browser-status-heading">
                <span className="browser-status-icon" aria-hidden="true">
                  <svg viewBox="0 0 20 20">
                    <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
                    <path d="M2.5 7h15M5.5 5.25h.01M8 5.25h.01" />
                  </svg>
                </span>
                <span>
                  <strong>{identityLabel}</strong>
                  {browserAttached && (
                    <small>{viewedTaskControl.controllerLabel}</small>
                  )}
                </span>
              </div>
              {browserHandoff && (
                <div className="browser-handoff-summary">
                  <strong>{browserHandoff.title}</strong>
                  <span>{attentionCopy(browserHandoff)}</span>
                  <small>
                    {browserHandoff.status === "pending"
                      ? "Waiting for you"
                      : browserHandoff.status.replaceAll("_", " ")}
                  </small>
                </div>
              )}
              <div className="inspector-section">
                <span className="inspector-section-title">Activity</span>
                <div className="browser-metrics">
                  <div>
                    <strong>{viewedCompanion?.observationCount ?? 0}</strong>
                    <small>Observations</small>
                  </div>
                  <div>
                    <strong>{viewedCompanion?.evidenceCount ?? 0}</strong>
                    <small>Evidence</small>
                  </div>
                </div>
              </div>
              <div className="control-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(() => window.rove.showBrowser(viewedTask.taskId))
                  }
                >
                  {viewedCompanion?.browserOpen
                    ? "View Browser"
                    : "Open Browser"}
                </button>
                {viewedTaskControl.canTakeControl && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void takeControl(viewedTask)}
                  >
                    Take Over
                  </button>
                )}
                {viewedTask.capabilities?.canReturnToRove && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void returnControl()}
                  >
                    Return control
                  </button>
                )}
              </div>
            </section>
            <details
              className="inspector-panel recording-panel"
              aria-label="Task recordings"
              open={(viewedTask.recordings ?? []).length > 0}
            >
              <summary className="inspector-heading">
                <span>Recording</span>
                <small>
                  {
                    {
                      agent: "Agent",
                      companion: "Companion",
                      capture: "Capture · Human-driven",
                    }[viewedTask.executionMode]
                  }
                </small>
              </summary>
              <div className="recording-summary">
                <strong>
                  {(viewedTask.recordings ?? []).find((recording) =>
                    ["requested", "recording", "finalizing"].includes(
                      recording.state,
                    ),
                  )
                    ? recordingLifecyclePresentation(
                        (viewedTask.recordings ?? []).find((recording) =>
                          ["requested", "recording", "finalizing"].includes(
                            recording.state,
                          ),
                        )!.state,
                      ).summary
                    : "Task-owned page evidence"}
                </strong>
                <span>Selected page only · no audio</span>
              </div>
              <p className="recording-scope">
                Browser chrome, other tabs, popups, and native dialogs are
                excluded. Continuous video is not masked.
              </p>
              {(viewedTask.recordings ?? []).some((recording) =>
                ["requested", "recording", "finalizing"].includes(
                  recording.state,
                ),
              ) ? (
                (viewedTask.recordings ?? [])
                  .filter((recording) =>
                    ["requested", "recording", "finalizing"].includes(
                      recording.state,
                    ),
                  )
                  .map((recording) => (
                    <div className="recording-actions" key={recording.id}>
                      <small>
                        {
                          recordingLifecyclePresentation(recording.state)
                            .stateLabel
                        }
                      </small>
                      <button
                        type="button"
                        disabled={
                          busy ||
                          !recordingLifecyclePresentation(recording.state)
                            .canStop
                        }
                        onClick={() =>
                          void stopRecording(viewedTask.taskId, recording.id)
                        }
                      >
                        {
                          recordingLifecyclePresentation(recording.state)
                            .actionLabel
                        }
                      </button>
                    </div>
                  ))
              ) : (
                <div className="recording-actions">
                  <label className="recording-consent">
                    <input
                      type="checkbox"
                      checked={recordingConfirmed}
                      disabled={busy}
                      onChange={(event) =>
                        setRecordingConfirmed(event.currentTarget.checked)
                      }
                    />
                    <span>
                      I understand visible sensitive content will be recorded
                      and will stop before revealing secrets.
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !recordingConfirmed ||
                      ["closed", "failed"].includes(viewedTask.lifecycle.phase)
                    }
                    onClick={() => void startPageRecording(viewedTask.taskId)}
                  >
                    Start page recording
                  </button>
                  <small>
                    Browser-window recording is unavailable until Rove can
                    isolate one task per browser window.
                  </small>
                </div>
              )}
              {(viewedTask.recordings ?? []).filter((recording) =>
                ["available", "failed"].includes(recording.state),
              ).length > 0 && (
                <div className="recording-history">
                  {(viewedTask.recordings ?? [])
                    .filter((recording) =>
                      ["available", "failed"].includes(recording.state),
                    )
                    .map((recording) => (
                      <article key={recording.id}>
                        <div className="recording-history-heading">
                          <strong>Page recording</strong>
                          <span data-result-state={recording.state}>
                            {recording.state}
                          </span>
                        </div>
                        <small>
                          {recording.scope.kind === "page"
                            ? recording.scope.url
                            : "Browser window"}{" "}
                          · no audio
                        </small>
                        {recording.state === "failed" ? (
                          <p role="status">
                            Recording unavailable: {recording.failure?.message}
                          </p>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(() =>
                                window.rove.openRecording(
                                  viewedTask.taskId,
                                  recording.id,
                                ),
                              )
                            }
                          >
                            Open recording
                          </button>
                        )}
                      </article>
                    ))}
                </div>
              )}
            </details>
          </aside>
        )}
      </main>
    </div>
  );
}
