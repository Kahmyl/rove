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
  const [followup, setFollowup] = useState("");
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
  const [login, setLogin] = useState<LoginProjection | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
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
    if (!gate.ready) return;
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
        },
      }),
    );
    if (result !== undefined) {
      setOutcome("");
      setShowNewTask(false);
    }
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
  const planLabel = accountPlanLabel(account?.planType);
  const primaryRateLimit = product?.catalog.rateLimits?.[0];
  const usageRemaining =
    primaryRateLimit?.usedPercent === null ||
    primaryRateLimit?.usedPercent === undefined
      ? "Unavailable"
      : `${Math.max(0, 100 - Math.round(primaryRateLimit.usedPercent))}% left`;

  if (account?.status !== "logged_in") {
    return (
      <div className="product-app product-auth-app">
        <header className="product-topbar">
          <div className="product-health" aria-live="polite">
            <span
              className={`status-pip status-${product?.host.state ?? "offline"}`}
            />
            {recoveryLabel(desktop)}
          </div>
        </header>
        <main className="auth-gate">
          <section className="auth-panel">
            <img src={roveMarkUrl} alt="" />
            <div className="eyebrow">Welcome to Rove</div>
            <h1>
              {account?.status === "logged_out"
                ? "Sign in to continue"
                : "Getting Rove ready"}
            </h1>
            <p>
              {account?.status === "logged_out"
                ? "Use your ChatGPT account to start and continue browser tasks with Codex."
                : "Rove is checking your local Codex session."}
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
              onClick={() =>
                void run(() => command({ type: "account.refresh" }))
              }
              disabled={busy}
            >
              Refresh account status
            </button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div
      className={`product-app${sidebarCollapsed ? " sidebar-collapsed" : ""}${windowFullscreen ? " window-fullscreen" : ""}`}
    >
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
            aria-labelledby="appearance-settings-title"
          >
            <header>
              <div>
                <span className="eyebrow">Settings</span>
                <h2 id="appearance-settings-title">Appearance</h2>
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
          </section>
        </div>
      )}

      <main className="product-layout">
        <section
          className={`product-main${viewedTask ? " product-main-task" : " product-main-composer"}`}
          aria-label="Task workspace"
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
                    if (gate.ready && !busy) void launch();
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
                      title={gate.ready ? "Start task" : gate.reason}
                      disabled={!gate.ready || busy}
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

          {viewedTask && (
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
              <div className="account-popover-row" role="menuitem">
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M3.2 13.8a7 7 0 1 1 13.6 0M10 10l3.3-2.4" />
                  <circle cx="10" cy="10" r="1" />
                </svg>
                <span>Usage</span>
                <strong>{usageRemaining}</strong>
              </div>
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
