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
  ProductAttentionProjection,
  ProductElicitationField,
} from "../main/codex/local-product-api.js";
import type { ProjectedConversationItem } from "../main/codex/conversations.js";
import type { LoginProjection } from "../main/codex/account-catalog.js";
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
import { unmatchedRuntimeSession } from "../shared/desktop-api.js";
import roveMarkUrl from "./assets/rove-mark.png";
import { toCompanionViewModel } from "./state.js";
import {
  activeProductTask,
  composerGate,
  modeLabel,
  reconcileSelectedTaskId,
  recoveryLabel,
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
  sourceItemId?: string;
  resultId?: string;
  expectedRevision?: number;
  kind: Exclude<TaskResultKind, "artifact">;
  title: string;
  body: string;
  actionRecipient: string;
  actionRecipientControl: string;
  actionContent: string;
  actionContentControl: string;
  actionTarget: string;
  actionCommitControl: string;
  actionScope: string;
  actionAttachmentIds: string[];
  actionAttachmentControl: string;
}

export function followupDraftForTask(
  drafts: Readonly<Record<string, string>>,
  taskId: string | undefined,
): string {
  return taskId ? (drafts[taskId] ?? "") : "";
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
    sources: "Include sources and uncertainty with each result.",
    concise: "Present concise, actionable results.",
    detailed: "Present detailed results with reasoning.",
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

function accountPlanLabel(planType: string | undefined): string {
  if (!planType) return "Signed in";
  const normalized = planType.toLowerCase();
  if (normalized.includes("pro")) return "Pro";
  if (normalized.includes("plus")) return "Plus";
  if (normalized.includes("business") || normalized.includes("team"))
    return "Business";
  if (normalized.includes("enterprise")) return "Enterprise";
  return planType
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function closeParentMenu(event: MouseEvent<HTMLButtonElement>): void {
  event.currentTarget.closest("details")?.removeAttribute("open");
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

export function ProductSurface({
  desktop,
  connectionError,
  follower,
  refresh,
}: ProductSurfaceProps) {
  const product = desktop?.product ?? null;
  const activeTask = activeProductTask(product);
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
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const [profileManagerOpen, setProfileManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [operationError, setOperationError] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [recordingConfirmed, setRecordingConfirmed] = useState(false);
  const [login, setLogin] = useState<LoginProjection | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [shareWorkflowContext, setShareWorkflowContext] = useState<
    "" | "share" | "local"
  >("");
  const [workflowEditor, setWorkflowEditor] =
    useState<WorkflowEditorDraft | null>(null);
  const [workflowPromotion, setWorkflowPromotion] =
    useState<WorkflowPromotionDraft | null>(null);
  const [resultEditor, setResultEditor] = useState<ResultEditorDraft | null>(
    null,
  );
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
  const accountMenu = useRef<HTMLDetailsElement | null>(null);
  const outcomeComposer = useRef<HTMLTextAreaElement | null>(null);
  const followupComposer = useRef<HTMLTextAreaElement | null>(null);

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
  const viewedTask = showNewTask
    ? undefined
    : (product?.tasks.find((entry) => entry.taskId === selectedTaskId) ??
      activeTask);
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
  const error = operationError ?? connectionError ?? desktop?.productError;
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
  const selectedIdentity = viewedTask?.browserIdentity;
  const identityLabel =
    selectedIdentity?.mode === "workspace"
      ? workspaceName(desktop, selectedIdentity.workspaceId)
      : selectedIdentity?.mode === "temporary"
        ? "Guest"
        : "No browser profile";

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
      command({
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
      category: "knowledge",
      text,
      appliesTo: "",
      sourceTaskId: taskId,
      sourceItemId: item.id,
    });
  };
  const beginResultPromotion = (result: TaskResult) => {
    const destination =
      product?.workflows.find(
        (workflow) =>
          !workflow.archived &&
          workflow.workflowId === viewedTask?.workflowAssociation?.workflowId,
      ) ?? product?.workflows.find((workflow) => !workflow.archived);
    if (!destination) return;
    setWorkflowPromotion({
      workflowId: destination.workflowId,
      expectedRevision: destination.currentRevision,
      category: "knowledge",
      text: result.revision.body,
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
  const beginResultCreate = (
    item: ProjectedConversationItem,
    taskId: string,
  ) => {
    const body = messageText(item).trim();
    if (!body) return;
    setResultEditor({
      taskId,
      sourceItemId: item.id,
      kind: "finding_collection",
      title: "Saved result",
      body,
      actionRecipient: "",
      actionRecipientControl: "",
      actionContent: body,
      actionContentControl: "",
      actionTarget: "",
      actionCommitControl: "",
      actionScope: "",
      actionAttachmentIds: [],
      actionAttachmentControl: "",
    });
  };
  const beginResultRevision = (result: TaskResult) => {
    if (result.kind !== "draft") return;
    setResultEditor({
      taskId: result.taskId,
      resultId: result.resultId,
      expectedRevision: result.currentRevision,
      kind: "draft",
      title: result.revision.title,
      body: result.revision.body,
      actionRecipient: "",
      actionRecipientControl: "",
      actionContent: "",
      actionContentControl: "",
      actionTarget: "",
      actionCommitControl: "",
      actionScope: "",
      actionAttachmentIds: [],
      actionAttachmentControl: "",
    });
  };
  const saveResult = async () => {
    if (!resultEditor) return;
    const result = await run(() =>
      command({
        type: resultEditor.resultId ? "result.revise" : "result.create",
        operationId: `intent_${crypto.randomUUID()}`,
        taskId: resultEditor.taskId,
        ...(resultEditor.resultId
          ? {
              resultId: resultEditor.resultId,
              expectedRevision: resultEditor.expectedRevision!,
            }
          : {
              sourceItemId: resultEditor.sourceItemId!,
              kind: resultEditor.kind,
              ...(resultEditor.kind === "action"
                ? {
                    actionMaterial: {
                      ...(resultEditor.actionRecipient.trim()
                        ? { recipient: resultEditor.actionRecipient.trim() }
                        : {}),
                      ...(resultEditor.actionRecipientControl.trim()
                        ? {
                            recipientControl:
                              resultEditor.actionRecipientControl.trim(),
                          }
                        : {}),
                      content: resultEditor.actionContent.trim(),
                      ...(resultEditor.actionContentControl.trim()
                        ? {
                            contentControl:
                              resultEditor.actionContentControl.trim(),
                          }
                        : {}),
                      ...(resultEditor.actionTarget.trim()
                        ? { target: resultEditor.actionTarget.trim() }
                        : {}),
                      ...(resultEditor.actionCommitControl.trim()
                        ? {
                            commitControl:
                              resultEditor.actionCommitControl.trim(),
                          }
                        : {}),
                      attachmentIds: resultEditor.actionAttachmentIds,
                      ...(resultEditor.actionAttachmentControl.trim()
                        ? {
                            attachmentControl:
                              resultEditor.actionAttachmentControl.trim(),
                          }
                        : {}),
                      ...(resultEditor.actionScope.trim()
                        ? { scope: resultEditor.actionScope.trim() }
                        : {}),
                    },
                  }
                : {}),
            }),
        title: resultEditor.title.trim(),
        body: resultEditor.body.trim(),
      } as RendererProductIntent),
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
        setOperationError(null);
      } catch (cause) {
        setOperationError(
          cause instanceof Error
            ? cause.message
            : "Rove could not open the sign-in page.",
        );
      }
      await refresh();
    } catch (cause) {
      setOperationError(
        cause instanceof Error
          ? cause.message
          : "Codex sign-in could not start.",
      );
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
      setOperationError(null);
    } catch (cause) {
      setOperationError(
        cause instanceof Error
          ? cause.message
          : "Rove could not open the sign-in page.",
      );
    } finally {
      setBusy(false);
    }
  };
  const cancelLogin = async (loginId: string) => {
    setBusy(true);
    try {
      await command({ type: "account.login.cancel", loginId });
      setLogin((current) => (current?.loginId === loginId ? null : current));
      setOperationError(null);
      await refresh();
    } catch (cause) {
      setOperationError(
        cause instanceof Error
          ? cause.message
          : "Codex sign-in could not be cancelled.",
      );
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
    if (!viewedTask?.availableActions.includes("return_control")) return;
    await run(() =>
      command({
        type: "task.return-control",
        taskId: viewedTask.taskId,
        operationId: `intent_${crypto.randomUUID()}`,
      }),
    );
  };
  const stopTask = async () => {
    if (!viewedTask) return;
    await run(() =>
      command({
        type: "task.stop",
        taskId: viewedTask.taskId,
        operationId:
          viewedTask.operation?.operationId ?? `intent_${crypto.randomUUID()}`,
      }),
    );
  };
  const resumeTask = async () => {
    if (!viewedTask?.availableActions.includes("resume")) return;
    await run(() =>
      command({
        type: "task.restore",
        taskId: viewedTask.taskId,
        operationId: `intent_${crypto.randomUUID()}`,
      }),
    );
  };
  const archiveTask = async (task = viewedTask) => {
    if (
      !task ||
      (!task.availableActions.includes("archive") &&
        !task.availableActions.includes("finish") &&
        !task.availableActions.includes("retry_cleanup")) ||
      archivingTaskIds.has(task.taskId)
    )
      return;
    setArchivingTaskIds((current) => new Set(current).add(task.taskId));
    try {
      await command({
        type: "task.archive",
        taskId: task.taskId,
        operationId: `intent_${crypto.randomUUID()}`,
      });
      await refresh();
      setOperationError(null);
    } catch (cause) {
      setOperationError(
        cause instanceof Error ? cause.message : "Task archive failed.",
      );
    } finally {
      setArchivingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.taskId);
        return next;
      });
    }
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

  const renderCodexAttention = (entry: ProductAttentionProjection) => (
    <section
      className="attention-card attention-inline attention-codex"
      aria-label="Current task request"
    >
      <div className="eyebrow">Input needed</div>
      <strong>{entry.title}</strong>
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
                <label key={option.label}>
                  <input
                    type="radio"
                    name={`${attentionStateKey(entry)}:${question.id}`}
                    checked={
                      attentionAnswers[attentionStateKey(entry)]?.[
                        question.id
                      ]?.[0] === option.label
                    }
                    onChange={() =>
                      setQuestionAnswer(attentionStateKey(entry), question.id, [
                        option.label,
                      ])
                    }
                  />
                  {option.label} — {option.description}
                </label>
              ))}
              {(!question.options || question.isOther) && (
                <input
                  aria-label={`${question.header} answer`}
                  type={question.isSecret ? "password" : "text"}
                  value={
                    attentionAnswers[attentionStateKey(entry)]?.[
                      question.id
                    ]?.[0] ?? ""
                  }
                  onChange={(event) =>
                    setQuestionAnswer(attentionStateKey(entry), question.id, [
                      event.target.value,
                    ])
                  }
                />
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
              {entry.kind === "user_input"
                ? "Submit answers"
                : "Approve / Send"}
            </button>
          </div>
        </>
      )}
      {entry.status !== "pending" && (
        <small>Status: {entry.status.replaceAll("_", " ")}</small>
      )}
    </section>
  );

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
          aria-label={`Expand Rove. ${unmatchedSession ? "Browser session needs cleanup" : awaitingExplicitResponse ? "Your response is needed" : taskAttention.length ? "Attention required" : recoveryLabel(desktop)}`}
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
                : recoveryLabel(desktop)}
          </span>
          <strong>
            {unmatchedSession
              ? "Browser session needs cleanup"
              : activeTask
                ? activeSurfaceTitle
                : "Rove is ready"}
          </strong>
          {activeTask?.availableActions.includes("return_control") && (
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
            <button onClick={() => void run(window.rove.takeControl)}>
              Take Over
            </button>
          )}
          {activeTask?.availableActions.includes("return_control") && (
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
  const orderedTurnIds = [
    ...(viewedTask?.conversation?.turnOrder ?? []),
    ...timeline
      .map((item) => item.turnId)
      .filter(
        (turnId, index, all) =>
          !viewedTask?.conversation?.turnOrder.includes(turnId) &&
          all.indexOf(turnId) === index,
      ),
  ];
  const orderedTimeline = orderedTurnIds.flatMap((turnId) =>
    timeline.filter((item) => item.turnId === turnId),
  );
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
        id: `work:${item.turnId}:${item.id}`,
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
  const account = product?.catalog.account;
  const planLabel =
    account?.status === "logged_in"
      ? accountPlanLabel(account.planType)
      : account?.status === "logged_out"
        ? "Signed out"
        : "Connecting…";
  const primaryRateLimit = product?.catalog.rateLimits?.[0];
  const usageRemaining =
    primaryRateLimit?.usedPercent === null ||
    primaryRateLimit?.usedPercent === undefined
      ? "Unavailable"
      : `${Math.max(0, 100 - Math.round(primaryRateLimit.usedPercent))}% left`;

  const accountGate =
    account?.status === "logged_in" ? null : (
      <section className="auth-panel local-auth-panel">
        <img src={roveMarkUrl} alt="" />
        <div className="eyebrow">Local work remains available</div>
        <h1>
          {account?.status === "logged_out"
            ? "Sign in to run tasks"
            : "Getting Codex ready"}
        </h1>
        <p>
          You can inspect and edit local Workflows and return to task history
          while Codex is disconnected.
        </p>
        {account?.error && <small role="alert">{account.error}</small>}
        {account?.status === "logged_out" && !visibleLogin && (
          <div className="auth-actions">
            <button
              className="primary"
              onClick={() => void startLogin("chatgpt")}
              disabled={busy}
            >
              Sign in with ChatGPT
            </button>
            <button
              onClick={() => void startLogin("deviceCode")}
              disabled={busy}
            >
              Use device code
            </button>
          </div>
        )}
        {visibleLogin?.type === "chatgpt" && (
          <div className="auth-actions">
            <button
              className="primary"
              onClick={() => void openLogin(visibleLogin.loginId)}
              disabled={busy}
            >
              Continue sign-in
            </button>
            <button
              onClick={() => void cancelLogin(visibleLogin.loginId)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        )}
        {visibleLogin?.type === "chatgptDeviceCode" && (
          <div className="auth-device-code">
            <span>Enter this code on the verification page</span>
            <code>{visibleLogin.userCode}</code>
            <div className="auth-actions">
              <button
                className="primary"
                onClick={() => void openLogin(visibleLogin.loginId)}
                disabled={busy}
              >
                Open verification page
              </button>
              <button
                onClick={() => void cancelLogin(visibleLogin.loginId)}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && (
          <div className="product-error" role="alert">
            <strong>Sign-in needs attention</strong>
            <span>{error}</span>
          </div>
        )}
        <button
          className="auth-refresh"
          onClick={() => void run(() => command({ type: "account.refresh" }))}
          disabled={busy}
        >
          Refresh account status
        </button>
      </section>
    );

  return (
    <div
      className={`product-app${sidebarCollapsed ? " sidebar-collapsed" : ""}${windowFullscreen ? " window-fullscreen" : ""}`}
    >
      {workflowEditor && (
        <div className="profile-modal-backdrop" role="presentation">
          <section
            className="profile-modal workflow-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workflow-editor-title"
          >
            <header>
              <div>
                <div className="eyebrow">Reusable operating environment</div>
                <h2 id="workflow-editor-title">
                  {workflowEditor.workflowId ? "Edit Workflow" : "New Workflow"}
                </h2>
                <p>
                  Answer a few structured questions. You can refine the approved
                  guidance later; each save creates a revision.
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
                  required
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
                <span>How should results be presented?</span>
                <select
                  aria-label="Workflow result style"
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
                Workflow setup stays local unless a synchronization provider is
                connected in the future. Secrets, credentials, local paths, task
                history, attachments, and browser state are rejected.
              </p>
              <div className="auth-actions">
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
                  Save approved revision
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
                <div className="eyebrow">Stable task result</div>
                <h2 id="result-editor-title">
                  {resultEditor.resultId ? "Revise draft" : "Save result"}
                </h2>
                <p>
                  Review the exact local material. Saving does not authorize or
                  prove an external action.
                </p>
              </div>
              <button
                type="button"
                className="profile-modal-close"
                aria-label="Close result editor"
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
              {!resultEditor.resultId && (
                <label>
                  <span>Result type</span>
                  <select
                    aria-label="Result type"
                    value={resultEditor.kind}
                    onChange={(event) =>
                      setResultEditor({
                        ...resultEditor,
                        kind: event.target.value as ResultEditorDraft["kind"],
                      })
                    }
                  >
                    <option value="finding_collection">Findings</option>
                    <option value="draft">Draft</option>
                    <option value="report">Report</option>
                    <option value="journey">Journey</option>
                    <option value="action">Action</option>
                  </select>
                </label>
              )}
              <label>
                <span>Title</span>
                <input
                  aria-label="Result title"
                  required
                  maxLength={240}
                  value={resultEditor.title}
                  onChange={(event) =>
                    setResultEditor({
                      ...resultEditor,
                      title: event.target.value,
                    })
                  }
                />
              </label>
              {resultEditor.kind === "action" && (
                <fieldset className="result-action-editor">
                  <legend>Exact action material</legend>
                  <p>
                    Rove will bind these values and files to a concrete, freshly
                    grounded browser plan before any external disclosure. Enter
                    the exact accessible names shown for each browser control.
                  </p>
                  <label>
                    <span>Recipient</span>
                    <input
                      aria-label="Action recipient"
                      maxLength={1000}
                      value={resultEditor.actionRecipient}
                      onChange={(event) =>
                        setResultEditor({
                          ...resultEditor,
                          actionRecipient: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Recipient control name</span>
                    <input
                      aria-label="Action recipient control"
                      required={Boolean(resultEditor.actionRecipient.trim())}
                      maxLength={500}
                      value={resultEditor.actionRecipientControl}
                      onChange={(event) =>
                        setResultEditor({
                          ...resultEditor,
                          actionRecipientControl: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Content</span>
                    <textarea
                      aria-label="Action content"
                      required
                      maxLength={16000}
                      value={resultEditor.actionContent}
                      onChange={(event) =>
                        setResultEditor({
                          ...resultEditor,
                          actionContent: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Content control name</span>
                    <input
                      aria-label="Action content control"
                      required
                      maxLength={500}
                      value={resultEditor.actionContentControl}
                      onChange={(event) =>
                        setResultEditor({
                          ...resultEditor,
                          actionContentControl: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Target or resource</span>
                    <input
                      aria-label="Action target"
                      maxLength={2000}
                      value={resultEditor.actionTarget}
                      onChange={(event) =>
                        setResultEditor({
                          ...resultEditor,
                          actionTarget: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Commit control name</span>
                    <input
                      aria-label="Action commit control"
                      required
                      maxLength={500}
                      value={resultEditor.actionCommitControl}
                      onChange={(event) =>
                        setResultEditor({
                          ...resultEditor,
                          actionCommitControl: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Scope</span>
                    <input
                      aria-label="Action scope"
                      maxLength={1000}
                      value={resultEditor.actionScope}
                      onChange={(event) =>
                        setResultEditor({
                          ...resultEditor,
                          actionScope: event.target.value,
                        })
                      }
                    />
                  </label>
                  {(viewedTask?.attachments?.length ?? 0) > 0 && (
                    <div className="result-action-attachments">
                      <span>Attachments included in authorization</span>
                      <label>
                        <span>Attachment control name</span>
                        <input
                          aria-label="Action attachment control"
                          required={resultEditor.actionAttachmentIds.length > 0}
                          maxLength={500}
                          value={resultEditor.actionAttachmentControl}
                          onChange={(event) =>
                            setResultEditor({
                              ...resultEditor,
                              actionAttachmentControl: event.target.value,
                            })
                          }
                        />
                      </label>
                      {(viewedTask?.attachments ?? []).map((attachment) => (
                        <label key={attachment.id}>
                          <input
                            type="checkbox"
                            checked={resultEditor.actionAttachmentIds.includes(
                              attachment.id,
                            )}
                            onChange={(event) =>
                              setResultEditor({
                                ...resultEditor,
                                actionAttachmentIds: event.target.checked
                                  ? [
                                      ...resultEditor.actionAttachmentIds,
                                      attachment.id,
                                    ]
                                  : resultEditor.actionAttachmentIds.filter(
                                      (id) => id !== attachment.id,
                                    ),
                              })
                            }
                          />
                          <span>{attachment.filename}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              )}
              <label>
                <span>Result material</span>
                <textarea
                  aria-label="Result material"
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
              <div className="auth-actions">
                <button type="button" onClick={() => setResultEditor(null)}>
                  Cancel
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={
                    busy ||
                    !resultEditor.title.trim() ||
                    !resultEditor.body.trim() ||
                    (resultEditor.kind === "action" &&
                      (!resultEditor.actionContent.trim() ||
                        !resultEditor.actionContentControl.trim() ||
                        !resultEditor.actionCommitControl.trim() ||
                        (Boolean(resultEditor.actionRecipient.trim()) &&
                          !resultEditor.actionRecipientControl.trim()) ||
                        (resultEditor.actionAttachmentIds.length > 0 &&
                          !resultEditor.actionAttachmentControl.trim())))
                  }
                >
                  {resultEditor.resultId ? "Save revision" : "Save result"}
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
                <div className="eyebrow">Explicit promotion</div>
                <h2 id="workflow-promotion-title">Save to Workflow</h2>
                <p>
                  Review exactly what will become reusable. The conversation,
                  files, approvals, and browser state are not included.
                </p>
              </div>
              <button
                className="profile-modal-close"
                type="button"
                aria-label="Cancel Save to Workflow"
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
              <label>
                <span>Destination</span>
                <select
                  aria-label="Promotion destination Workflow"
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
              <label>
                <span>Reusable information class</span>
                <select
                  aria-label="Promotion category"
                  value={workflowPromotion.category}
                  onChange={(event) =>
                    setWorkflowPromotion({
                      ...workflowPromotion,
                      category: event.target.value as WorkflowPromotionCategory,
                    })
                  }
                >
                  <option value="knowledge">Approved knowledge</option>
                  <option value="preference">Preference</option>
                  <option value="guidance">Guidance</option>
                </select>
              </label>
              <label>
                <span>Exact reusable text</span>
                <textarea
                  aria-label="Promoted Workflow text"
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
              <label>
                <span>Apply only to these topics (optional, one per line)</span>
                <textarea
                  aria-label="Promotion topics"
                  value={workflowPromotion.appliesTo}
                  onChange={(event) =>
                    setWorkflowPromotion({
                      ...workflowPromotion,
                      appliesTo: event.target.value,
                    })
                  }
                />
              </label>
              <div className="auth-actions">
                <button
                  type="button"
                  onClick={() => setWorkflowPromotion(null)}
                >
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={busy}>
                  Save approved information
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
            title={viewedTask ? displayTaskTitle(viewedTask) : "New task"}
          >
            {viewedTask ? displayTaskTitle(viewedTask) : "New task"}
          </strong>
          {viewedTask &&
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
                    <button disabled={busy} onClick={() => void stopTask()}>
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
              className={`status-pip status-${product?.host.state ?? "offline"}`}
            />
            {recoveryLabel(desktop)}
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

            <footer>
              <p>
                Guest browsing is available from Task setup. Guest data is
                deleted locally when its task ends.
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
                  <span className="theme-option-check" aria-hidden="true">
                    {themePreference === value ? "✓" : ""}
                  </span>
                </button>
              ))}
            </div>
            <LocalBackupSettings
              busy={busy}
              status={backupStatus}
              onExport={() => {
                setBusy(true);
                setBackupStatus(null);
                void window.rove
                  .exportLocalBackup()
                  .then((result) => {
                    if (result.status === "created") {
                      setBackupStatus(
                        `${result.name} created with ${result.fileCount} files${
                          result.missingCount > 0
                            ? `; ${result.missingCount} missing or excluded entries are listed in its manifest`
                            : ""
                        }.`,
                      );
                      setOperationError(null);
                    }
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
          </section>
        </div>
      )}

      <main className="product-layout">
        <section
          className={`product-main${viewedTask ? " product-main-task" : " product-main-composer"}`}
          aria-label="Task workspace"
          tabIndex={0}
        >
          {accountGate}
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
          {!viewedTask && (
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
                    if (
                      event.key !== "Enter" ||
                      event.shiftKey ||
                      event.nativeEvent.isComposing
                    )
                      return;
                    event.preventDefault();
                    if (
                      gate.ready &&
                      !busy &&
                      (!selectedWorkflowId || shareWorkflowContext)
                    )
                      void launch();
                  }}
                />
                <div className="composer-action-row">
                  <ComposerAttachButton
                    busy={busy}
                    onPick={() =>
                      void run(() => command({ type: "attachments.pick" }))
                    }
                  />
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
                    <details className="composer-menu composer-setup-menu">
                      <summary aria-label="Task setup">Task setup</summary>
                      <div className="composer-popover">
                        <section>
                          <strong>How Rove helps</strong>
                          {(
                            [
                              ["agent", "Agent", "Rove completes the task"],
                              [
                                "companion",
                                "Companion",
                                "Work together with handoffs",
                              ],
                              ["capture", "Capture", "You drive the browser"],
                            ] as const
                          ).map(([value, label, description]) => (
                            <button
                              key={value}
                              type="button"
                              aria-label={`Execution mode: ${label}`}
                              aria-pressed={mode === value}
                              onClick={(event) => {
                                setMode(value);
                                closeParentMenu(event);
                              }}
                            >
                              <span>{label}</span>
                              <small>{description}</small>
                            </button>
                          ))}
                        </section>
                        <section>
                          <strong>Browser profile</strong>
                          {desktop?.workspaces.workspaces.map((workspace) => (
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
                                browserChoice === `workspace:${workspace.id}`
                              }
                              onClick={(event) => {
                                setBrowserChoice(`workspace:${workspace.id}`);
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
                          ))}
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
                            <small>Starts fresh and is deleted locally</small>
                          </button>
                        </section>
                      </div>
                    </details>
                    <details className="composer-menu composer-permission-menu">
                      <summary aria-label="Permission review">
                        <svg
                          className="composer-control-icon"
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                        >
                          <path d="M10 2.5 16 5v4.3c0 3.7-2.35 6.55-6 8.2-3.65-1.65-6-4.5-6-8.2V5l6-2.5Z" />
                          <path d="m7.4 10 1.65 1.65 3.55-3.55" />
                        </svg>
                        {approvalsReviewer === "auto_review"
                          ? "Approve for me"
                          : "Always ask"}
                      </summary>
                      <div className="composer-popover compact-popover">
                        <button
                          type="button"
                          aria-pressed={approvalsReviewer === "auto_review"}
                          disabled={mode === "capture"}
                          onClick={(event) => {
                            setApprovalsReviewer("auto_review");
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
                            setApprovalsReviewer("user");
                            closeParentMenu(event);
                          }}
                        >
                          <span>Always ask</span>
                          <small>You review every request</small>
                        </button>
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
                            event.target.value as "" | "share" | "local",
                          )
                        }
                      >
                        <option value="">Choose before starting…</option>
                        <option value="share">
                          Apply relevant guidance to Codex
                        </option>
                        <option value="local">
                          Keep association local only
                        </option>
                      </select>
                      <small>
                        Applying guidance may send approved relevant text to the
                        model service. Secrets, files, credentials, and browser
                        state are excluded.
                      </small>
                    </label>
                  )}
                  <div className="composer-footer">
                    <details className="composer-menu composer-model-menu">
                      <summary aria-label="Model and reasoning effort">
                        <span
                          className="composer-control-icon"
                          aria-hidden="true"
                        >
                          ✦
                        </span>
                        {selectedModel?.displayName ?? "Default model"}
                        {effort ? ` · ${effort}` : ""}
                        <svg
                          className="composer-chevron"
                          aria-hidden="true"
                          viewBox="0 0 16 16"
                        >
                          <path d="m4 6 4 4 4-4" />
                        </svg>
                      </summary>
                      <div className="composer-popover model-popover">
                        <section>
                          <strong>Model</strong>
                          {product?.catalog.models.map((entry) => (
                            <button
                              key={entry.id}
                              type="button"
                              aria-pressed={model === entry.id}
                              onClick={() => setModel(entry.id)}
                            >
                              <span>{entry.displayName}</span>
                            </button>
                          ))}
                        </section>
                        <section>
                          <strong>Reasoning effort</strong>
                          {selectedModel?.efforts.map((value) => (
                            <button
                              key={value}
                              type="button"
                              aria-pressed={effort === value}
                              onClick={(event) => {
                                setEffort(value);
                                closeParentMenu(event);
                              }}
                            >
                              <span>
                                {value[0]?.toUpperCase() + value.slice(1)}
                              </span>
                            </button>
                          ))}
                        </section>
                      </div>
                    </details>
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
                        !gate.ready ||
                        busy ||
                        Boolean(selectedWorkflowId && !shareWorkflowContext)
                      }
                      onClick={() => void launch()}
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                  </div>
                </div>
              </ComposerInputShell>
              {!gate.ready && gate.reason && outcome.trim().length > 0 && (
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
            .map(({ task, recording }) => (
              <div
                className="product-warning"
                role="status"
                key={`active-recording:${recording.id}`}
              >
                <strong>Page recording active</strong>
                <span>
                  {displayTaskTitle(task)} · {recording.state}
                </span>
              </div>
            ))}

          {viewedTask && (
            <div className="task-detail">
              <section className="result-shelf" aria-label="Task recordings">
                <header>
                  <div>
                    <div className="eyebrow">Page recording</div>
                    <strong>Task-owned browser evidence</strong>
                  </div>
                  <small>{viewedTask.executionMode} mode</small>
                </header>
                <p>
                  Records the selected page only, without audio. Browser chrome,
                  other tabs, popups, and native dialogs are excluded.
                  Continuous video is not masked.
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
                      <button
                        type="button"
                        className="secondary"
                        key={recording.id}
                        disabled={busy || recording.state === "finalizing"}
                        onClick={() =>
                          void stopRecording(viewedTask.taskId, recording.id)
                        }
                      >
                        {recording.state === "finalizing"
                          ? "Finalizing recording…"
                          : "Stop page recording"}
                      </button>
                    ))
                ) : (
                  <>
                    <label className="result-select">
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
                      className="secondary"
                      disabled={
                        busy ||
                        !recordingConfirmed ||
                        ["closed", "failed"].includes(
                          viewedTask.lifecycle.phase,
                        )
                      }
                      onClick={() => void startPageRecording(viewedTask.taskId)}
                    >
                      Start page recording
                    </button>
                    <small>
                      Browser-window recording is unavailable until Rove can
                      isolate one task per browser window.
                    </small>
                  </>
                )}
                {(viewedTask.recordings ?? []).filter((recording) =>
                  ["available", "failed"].includes(recording.state),
                ).length > 0 && (
                  <div className="result-card-list">
                    {(viewedTask.recordings ?? [])
                      .filter((recording) =>
                        ["available", "failed"].includes(recording.state),
                      )
                      .map((recording) => (
                        <article className="result-card" key={recording.id}>
                          <div className="result-card-heading">
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
                              Recording unavailable:{" "}
                              {recording.failure?.message}
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
              </section>
              {viewedTask.results.length > 0 && (
                <section className="result-shelf" aria-label="Task results">
                  <header>
                    <div>
                      <div className="eyebrow">Saved results</div>
                      <strong>Working material for follow-up</strong>
                    </div>
                    <small>
                      {
                        viewedTask.results.filter((result) => result.selected)
                          .length
                      }{" "}
                      selected
                    </small>
                  </header>
                  <div className="result-card-list">
                    {viewedTask.results.map((result) => (
                      <article className="result-card" key={result.resultId}>
                        <label className="result-select">
                          <input
                            type="checkbox"
                            checked={result.selected}
                            disabled={busy}
                            onChange={() => void toggleResultSelection(result)}
                          />
                          <span>Select for follow-up</span>
                        </label>
                        <div className="result-card-heading">
                          <strong>{result.revision.title}</strong>
                          <span data-result-state={result.lifecycle}>
                            {result.lifecycle.replaceAll("_", " ")}
                          </span>
                        </div>
                        <small>
                          {result.kind.replaceAll("_", " ")} · Revision{" "}
                          {result.currentRevision}
                        </small>
                        <MessageBody text={result.revision.body} />
                        {result.kind === "action" && result.actionMaterial && (
                          <dl className="result-action-material">
                            {result.actionMaterial.recipient && (
                              <>
                                <dt>Recipient</dt>
                                <dd>{result.actionMaterial.recipient}</dd>
                                <dt>Recipient control</dt>
                                <dd>
                                  {result.actionMaterial.recipientControl}
                                </dd>
                              </>
                            )}
                            <dt>Content</dt>
                            <dd>{result.actionMaterial.content}</dd>
                            <dt>Content control</dt>
                            <dd>{result.actionMaterial.contentControl}</dd>
                            {result.actionMaterial.target && (
                              <>
                                <dt>Target</dt>
                                <dd>{result.actionMaterial.target}</dd>
                              </>
                            )}
                            {result.actionMaterial.attachmentIds.length > 0 && (
                              <>
                                <dt>Attachments</dt>
                                <dd>
                                  {result.actionMaterial.attachmentIds.join(
                                    ", ",
                                  )}
                                </dd>
                                <dt>Attachment control</dt>
                                <dd>
                                  {result.actionMaterial.attachmentControl}
                                </dd>
                              </>
                            )}
                            <dt>Commit control</dt>
                            <dd>{result.actionMaterial.commitControl}</dd>
                            {result.actionMaterial.scope && (
                              <>
                                <dt>Scope</dt>
                                <dd>{result.actionMaterial.scope}</dd>
                              </>
                            )}
                          </dl>
                        )}
                        <footer>
                          {result.kind === "draft" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => beginResultRevision(result)}
                            >
                              Revise draft
                            </button>
                          )}
                          {result.kind === "action" &&
                            result.lifecycle === "prepared" && (
                              <button
                                type="button"
                                className="primary"
                                disabled={busy}
                                onClick={() => void authorizeResult(result)}
                              >
                                Authorize exact action
                              </button>
                            )}
                          {result.kind !== "action" &&
                            result.kind !== "artifact" &&
                            (product?.workflows.some(
                              (workflow) => !workflow.archived,
                            ) ??
                              false) && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => beginResultPromotion(result)}
                              >
                                Save to Workflow
                              </button>
                            )}
                        </footer>
                      </article>
                    ))}
                  </div>
                </section>
              )}
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
                                aria-label="Save message to Workflow"
                                title="Save to Workflow"
                                onClick={() =>
                                  beginWorkflowPromotion(
                                    segment.input!,
                                    viewedTask.taskId,
                                  )
                                }
                              >
                                Save
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
                          {(product?.workflows.some(
                            (workflow) => !workflow.archived,
                          ) ??
                            false) && (
                            <button
                              type="button"
                              aria-label="Save response to Workflow"
                              title="Save to Workflow"
                              onClick={() =>
                                beginWorkflowPromotion(item, viewedTask.taskId)
                              }
                            >
                              Save
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label="Save response as result"
                            title="Save result"
                            onClick={() =>
                              beginResultCreate(item, viewedTask.taskId)
                            }
                          >
                            Result
                          </button>
                        </footer>
                      </article>
                    ))}
                  </section>
                ))}
              </section>
              {!gate.ready &&
                (viewedTask.availableActions.includes("retry_cleanup") ||
                  viewedTask.lifecycle.phase === "recovering") && (
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
                {!currentCodexAttention &&
                  viewedTask.executionMode !== "capture" &&
                  (viewedTask.availableActions.includes("message") ||
                    viewedTask.availableActions.includes("finish") ||
                    viewedTask.availableActions.includes("resume") ||
                    viewedTask.availableActions.includes("return_control")) && (
                    <ComposerInputShell
                      attachments={product?.draftAttachments ?? []}
                      busy={
                        busy || !viewedTask.availableActions.includes("message")
                      }
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
                          className="selected-result-rail"
                          aria-label="Selected results for follow-up"
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
                                {result.revision.title} ×
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
                        disabled={
                          busy ||
                          !viewedTask.availableActions.includes("message")
                        }
                        onChange={(event) => setFollowup(event.target.value)}
                        onKeyDown={(event) => {
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
                          busy={
                            busy ||
                            !viewedTask.availableActions.includes("message")
                          }
                          onPick={() =>
                            void run(() =>
                              command({ type: "attachments.pick" }),
                            )
                          }
                        />
                        <div className="composer-control-rail">
                          <details className="composer-menu composer-setup-menu">
                            <summary aria-label="Task setup">
                              Task setup
                            </summary>
                            <div className="composer-popover task-settings-popover">
                              <section>
                                <strong>How Rove helps</strong>
                                <div className="task-frozen-option">
                                  <span>
                                    {viewedTask.executionMode === "companion"
                                      ? "Companion"
                                      : "Agent"}
                                  </span>
                                  <small>Fixed for this task</small>
                                </div>
                              </section>
                              <section>
                                <strong>Browser profile</strong>
                                <div className="task-frozen-option">
                                  <span>{identityLabel}</span>
                                  <small>Fixed for this task</small>
                                </div>
                              </section>
                            </div>
                          </details>
                          <details className="composer-menu composer-permission-menu">
                            <summary aria-label="Permission review">
                              <svg
                                className="composer-control-icon"
                                aria-hidden="true"
                                viewBox="0 0 20 20"
                              >
                                <path d="M10 2.5 16 5v4.3c0 3.7-2.35 6.55-6 8.2-3.65-1.65-6-4.5-6-8.2V5l6-2.5Z" />
                                <path d="m7.4 10 1.65 1.65 3.55-3.55" />
                              </svg>
                              {viewedTask.approvalsReviewer === "auto_review"
                                ? "Approve for me"
                                : "Always ask"}
                            </summary>
                            <div className="composer-popover compact-popover task-settings-popover">
                              <div className="task-frozen-option">
                                <span>
                                  {viewedTask.approvalsReviewer ===
                                  "auto_review"
                                    ? "Approve for me"
                                    : "Always ask"}
                                </span>
                                <small>Fixed for this task</small>
                              </div>
                            </div>
                          </details>
                        </div>
                        <div className="composer-footer">
                          <details className="composer-menu composer-model-menu">
                            <summary aria-label="Model and reasoning effort">
                              <span
                                className="composer-control-icon"
                                aria-hidden="true"
                              >
                                ✦
                              </span>
                              {product?.catalog.models.find(
                                (entry) => entry.id === viewedTask.model,
                              )?.displayName ??
                                viewedTask.model ??
                                "Default model"}
                              {viewedTask.reasoningEffort
                                ? ` · ${viewedTask.reasoningEffort}`
                                : ""}
                              <svg
                                className="composer-chevron"
                                aria-hidden="true"
                                viewBox="0 0 16 16"
                              >
                                <path d="m4 6 4 4 4-4" />
                              </svg>
                            </summary>
                            <div className="composer-popover compact-popover task-settings-popover">
                              <div className="task-frozen-option">
                                <span>
                                  {product?.catalog.models.find(
                                    (entry) => entry.id === viewedTask.model,
                                  )?.displayName ??
                                    viewedTask.model ??
                                    "Default model"}
                                </span>
                                <small>
                                  {viewedTask.reasoningEffort
                                    ? `${viewedTask.reasoningEffort} reasoning · fixed for this task`
                                    : "Fixed for this task"}
                                </small>
                              </div>
                            </div>
                          </details>
                          {viewedTask.availableActions.includes(
                            "return_control",
                          ) ? (
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
                              onClick={() => void resumeTask()}
                            >
                              <span aria-hidden="true">▶</span>
                            </button>
                          ) : viewedTask.conversation?.turnStatus ===
                              "in_progress" &&
                            viewedTask.availableActions.includes("finish") ? (
                            <button
                              className="primary composer-submit composer-stop"
                              aria-label="Stop task"
                              title="Stop task"
                              disabled={busy}
                              onClick={() => void stopTask()}
                            >
                              <span aria-hidden="true" />
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

          {error && (
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
            onClick={() => {
              setSelectedTaskId(null);
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
                onClick={() => setWorkflowEditor(workflowDraft())}
              >
                ＋
              </button>
            </div>
            {product?.workflows.map((workflow) => (
              <button
                className="workflow-list-row"
                type="button"
                key={workflow.workflowId}
                onClick={() => setWorkflowEditor(workflowDraft(workflow))}
              >
                <strong>{workflow.name}</strong>
                <small>
                  {workflow.archived ? "Archived · " : ""}Revision{" "}
                  {workflow.currentRevision} ·{" "}
                  {
                    product.tasks.filter(
                      (task) =>
                        task.workflowAssociation?.workflowId ===
                        workflow.workflowId,
                    ).length
                  }{" "}
                  tasks
                </small>
              </button>
            ))}
            {(product?.workflows.length ?? 0) === 0 && (
              <button
                className="workflow-empty"
                type="button"
                onClick={() => setWorkflowEditor(workflowDraft())}
              >
                Create a reusable environment for recurring work
              </button>
            )}
          </section>

          {(product?.tasks.length ?? 0) > 0 && (
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
                >
                  <button
                    className="task-history-select"
                    aria-label={`Task history: ${entry.taskId}`}
                    aria-current={
                      entry.taskId === viewedTask?.taskId ? "true" : undefined
                    }
                    onClick={() => {
                      setSelectedTaskId(entry.taskId);
                      setShowNewTask(false);
                    }}
                  >
                    <strong>{displayTaskTitle(entry)}</strong>
                    <span>
                      {entry.workflowAssociation
                        ? `${entry.workflowAssociation.workflowName} · `
                        : "Standalone · "}
                      {entry.conversation?.turnStatus === "in_progress"
                        ? "Working"
                        : terminalProductTask(entry)
                          ? "Completed"
                          : entry.lifecycle.phase.replaceAll("_", " ")}
                      {` · ${entry.executionMode === "agent" ? "Agent" : entry.executionMode === "companion" ? "Companion" : "Capture"}`}
                    </span>
                  </button>
                  {(entry.availableActions.includes("archive") ||
                    entry.availableActions.includes("finish") ||
                    entry.availableActions.includes("retry_cleanup")) && (
                    <button
                      className="task-history-archive"
                      type="button"
                      aria-label={`Archive ${displayTaskTitle(entry)}`}
                      title="Archive task"
                      disabled={archivingTaskIds.has(entry.taskId)}
                      onClick={() => void archiveTask(entry)}
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
                      (!taskContextEntry.availableActions.includes("archive") &&
                        !taskContextEntry.availableActions.includes("finish") &&
                        !taskContextEntry.availableActions.includes(
                          "retry_cleanup",
                        )) ||
                      archivingTaskIds.has(taskContextEntry.taskId)
                    }
                    onClick={() => {
                      setTaskContextMenu(null);
                      void archiveTask(taskContextEntry);
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

          <details className="account-menu" ref={accountMenu}>
            <summary>
              <span className="account-avatar" aria-hidden="true">
                R
              </span>
              <span className="account-summary-copy">
                <strong>ChatGPT account</strong>
                <small>{planLabel}</small>
              </span>
              <span className="account-chevron" aria-hidden="true">
                ···
              </span>
            </summary>
            <div className="account-popover" role="menu">
              {account?.status === "logged_in" && (
                <div className="account-popover-row" role="menuitem">
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M3.2 13.8a7 7 0 1 1 13.6 0M10 10l3.3-2.4" />
                    <circle cx="10" cy="10" r="1" />
                  </svg>
                  <span>Usage</span>
                  <strong>{usageRemaining}</strong>
                </div>
              )}
              <button
                className="account-popover-row"
                type="button"
                role="menuitem"
                onClick={(event) => {
                  closeParentMenu(event);
                  setSettingsOpen(true);
                }}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="10" cy="10" r="3" />
                  <path d="M10 2.5v1.4M10 16.1v1.4M17.5 10h-1.4M3.9 10H2.5M15.3 4.7l-1 1M5.7 14.3l-1 1M15.3 15.3l-1-1M5.7 5.7l-1-1" />
                </svg>
                <span>Settings</span>
              </button>
              {account?.status === "logged_in" && (
                <button
                  className="account-popover-row"
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    void run(() => command({ type: "account.logout" }))
                  }
                  disabled={busy}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M8 3.5H4.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1H8M11.5 6.5 15 10l-3.5 3.5M7 10h8" />
                  </svg>
                  Sign out
                </button>
              )}
            </div>
          </details>
        </aside>
        {viewedTask && (
          <aside className="product-inspector" aria-label="Task inspector">
            <section
              className="inspector-panel browser-status"
              aria-label="Browser status"
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
                  <small>{viewedTaskControl.controllerLabel}</small>
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
                    <strong>{desktop?.companion?.observationCount ?? 0}</strong>
                    <small>Observations</small>
                  </div>
                  <div>
                    <strong>{desktop?.companion?.evidenceCount ?? 0}</strong>
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
                  {desktop?.companion?.browserOpen
                    ? "View Browser"
                    : "Open Browser"}
                </button>
                {viewedTaskControl.canTakeControl && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void run(window.rove.takeControl)}
                  >
                    Take Over
                  </button>
                )}
                {viewedTask.availableActions.includes("return_control") && (
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
          </aside>
        )}
      </main>
    </div>
  );
}
