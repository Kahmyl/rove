import type { LoginProjection } from "../main/codex/account-catalog.js";
import type {
  LocalProductSnapshot,
  ProductTaskProjection,
} from "../main/codex/local-product-api.js";
import type { DesktopSurfaceSnapshot } from "../shared/desktop-api.js";
import type {
  BrowserIdentity,
  ExecutionMode,
} from "../main/codex/task-coordinator.js";

export function newestDesktopSnapshot(
  current: DesktopSurfaceSnapshot | null,
  incoming: DesktopSurfaceSnapshot,
): DesktopSurfaceSnapshot {
  return current !== null && current.revision > incoming.revision
    ? current
    : incoming;
}

export interface ComposerSelection {
  outcome: string;
  mode: ExecutionMode;
  browserChoice: string;
  model?: string;
  effort?: string;
}

export interface ComposerGate {
  ready: boolean;
  reason?: string;
  browserIdentity?: BrowserIdentity;
}

export type CodexCustomerStatusKind =
  | "starting"
  | "signing_in"
  | "signed_out"
  | "ready"
  | "usage_limit_reached"
  | "account_check_failed"
  | "startup_failed"
  | "unknown_failure";

export interface CodexCustomerStatus {
  kind: CodexCustomerStatusKind;
  label: string;
  ready: boolean;
  recovery: "sign_in" | "retry" | null;
}

/**
 * Customer-facing Codex state derived only from typed desktop/account state.
 * Raw host and compatibility errors remain developer diagnostics and never
 * become product copy through this projection.
 */
export function codexCustomerStatus(
  desktop: DesktopSurfaceSnapshot | null,
  login: LoginProjection | null = null,
  connectionFailed = false,
): CodexCustomerStatus {
  if (connectionFailed)
    return {
      kind: "unknown_failure",
      label: "Something went wrong with Codex",
      ready: false,
      recovery: "retry",
    };
  if (desktop === null)
    return {
      kind: "starting",
      label: "Starting Codex",
      ready: false,
      recovery: null,
    };
  if (desktop.productError !== null)
    return {
      kind: "startup_failed",
      label: "Codex couldn't start",
      ready: false,
      recovery: null,
    };
  const product = desktop.product;
  if (product === null || product.host.state === "failed")
    return {
      kind: "startup_failed",
      label: "Codex couldn't start",
      ready: false,
      recovery: null,
    };
  if (!product.host.ready)
    return {
      kind: "starting",
      label:
        product.host.state === "degraded"
          ? "Restarting Codex"
          : "Starting Codex",
      ready: false,
      recovery: null,
    };
  if (login !== null || product.catalog.login !== undefined)
    return {
      kind: "signing_in",
      label: "Signing in…",
      ready: false,
      recovery: null,
    };
  const account = product.catalog.account;
  if (account.status === "unavailable")
    return {
      kind: "account_check_failed",
      label: "Couldn't check your Codex account",
      ready: false,
      recovery: "retry",
    };
  if (account.status === "logged_out")
    return {
      kind: "signed_out",
      label: "Not signed in to Codex",
      ready: false,
      recovery: "sign_in",
    };
  if (
    product.catalog.rateLimits?.some(
      (limit) => limit.usedPercent !== null && limit.usedPercent >= 100,
    )
  )
    return {
      kind: "usage_limit_reached",
      label: "Codex usage limit reached",
      ready: false,
      recovery: null,
    };
  return {
    kind: "ready",
    label: "Codex ready",
    ready: true,
    recovery: null,
  };
}

export interface TaskControlProjection {
  controllerLabel: "Agent" | "You" | "Awaiting handoff" | "None";
  canTakeControl: boolean;
  canPause: boolean;
}

export function taskControlProjection(
  task: ProductTaskProjection | undefined,
  product: LocalProductSnapshot | null,
): TaskControlProjection {
  const runtime = task?.runtime;
  const isCurrent =
    task !== undefined &&
    task.taskId === product?.currentTaskId &&
    !terminalProductTask(task);
  const pendingHandoff =
    isCurrent &&
    product?.attention.some(
      (entry) =>
        entry.taskId === task.taskId &&
        entry.authority === "rove_control" &&
        entry.kind === "control_handoff" &&
        entry.status === "pending",
    );
  return {
    controllerLabel:
      runtime?.controller === "human"
        ? "You"
        : runtime?.controller === "agent"
          ? "Agent"
          : runtime?.status === "awaiting_human"
            ? "Awaiting handoff"
            : "None",
    canTakeControl:
      pendingHandoff === true &&
      runtime?.status === "awaiting_human" &&
      runtime.controller === null,
    canPause:
      isCurrent &&
      runtime?.status === "active" &&
      runtime.controller === "agent",
  };
}

export function activeProductTask(
  product: LocalProductSnapshot | null,
): ProductTaskProjection | undefined {
  return product?.tasks.find(
    (task) =>
      task.taskId === product.currentTaskId &&
      !["closed", "failed"].includes(task.lifecycle.phase),
  );
}

export function terminalProductTask(task: ProductTaskProjection): boolean {
  return ["closed", "failed"].includes(task.lifecycle.phase);
}

export function reconcileSelectedTaskId(
  selectedTaskId: string | null,
  previousCurrentTaskId: string | null,
  product: LocalProductSnapshot | null,
): string | null {
  if (selectedTaskId === null) return null;
  if (!product?.tasks.some((task) => task.taskId === selectedTaskId))
    return null;
  const currentTaskId = activeProductTask(product)?.taskId ?? null;
  return currentTaskId === previousCurrentTaskId ? selectedTaskId : null;
}

export function selectableProductTasks(
  product: LocalProductSnapshot | null,
  closedHistoryLimit = 8,
): ProductTaskProjection[] {
  if (!product) return [];
  const recent = [...product.tasks].reverse();
  const blockers = recent.filter((task) => !terminalProductTask(task));
  const closedHistory = recent
    .filter(
      (task) =>
        terminalProductTask(task) && task.conversation?.archived !== true,
    )
    .slice(0, closedHistoryLimit);
  return [...blockers, ...closedHistory];
}

export function taskHistoryTitle(task: ProductTaskProjection): string {
  const request = Object.values(task.conversation?.items ?? {}).find(
    (item) =>
      item.kind === "user_message" &&
      item.authoredBy !== "host" &&
      item.text?.trim(),
  )?.text;
  if (!request)
    return task.executionMode === "capture"
      ? "Browser capture"
      : "Untitled task";
  const normalized = request
    .replace(/^\s*(?:[#>*-]+\s*)+/, "")
    .replace(/^please\s+/i, "")
    .replace(/^using only\b[^,]{0,100},\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const titled = normalized
    ? `${normalized[0]!.toUpperCase()}${normalized.slice(1)}`
    : normalized;
  const sentence = titled.split(/(?<=[.!?])\s/, 1)[0] ?? titled;
  if (sentence.length <= 54) return sentence.replace(/[.!?]+$/, "");
  const shortened = sentence.slice(0, 54);
  const lastSpace = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, lastSpace > 34 ? lastSpace : 54).trimEnd()}…`;
}

export function selectedBrowserIdentity(
  choice: string,
  desktop: DesktopSurfaceSnapshot | null,
): BrowserIdentity | undefined {
  if (choice === "temporary") return { mode: "temporary" };
  if (!choice.startsWith("workspace:")) return undefined;
  const workspaceId = choice.slice("workspace:".length);
  return desktop?.workspaces.workspaces.some(
    (workspace) => workspace.id === workspaceId,
  )
    ? { mode: "workspace", workspaceId }
    : undefined;
}

export function taskHasAttachedBrowserWorkspace(
  task: ProductTaskProjection,
  workspaceId: string,
): boolean {
  return (
    !terminalProductTask(task) &&
    task.browserIdentity?.mode === "workspace" &&
    task.browserIdentity.workspaceId === workspaceId &&
    task.runtime?.profileOwnership !== "released"
  );
}

export function composerGate(
  desktop: DesktopSurfaceSnapshot | null,
  selection: ComposerSelection,
): ComposerGate {
  if (desktop === null) return { ready: false, reason: "Starting Codex." };
  if (desktop.productError)
    return { ready: false, reason: "Codex couldn't start." };
  const product = desktop.product;
  if (!product?.host.ready) return { ready: false, reason: "Starting Codex." };
  if (product.catalog.account.status === "unavailable")
    return {
      ready: false,
      reason: "Couldn't check your Codex account.",
    };
  if (product.catalog.account.status === "logged_out")
    return { ready: false, reason: "Not signed in to Codex." };
  if (
    product.catalog.rateLimits?.some(
      (limit) => limit.usedPercent !== null && limit.usedPercent >= 100,
    )
  )
    return { ready: false, reason: "Codex usage limit reached." };
  if (selection.outcome.trim().length === 0)
    return { ready: false, reason: "Describe the outcome you want." };
  const browserIdentity = selectedBrowserIdentity(
    selection.browserChoice,
    desktop,
  );
  if (selection.model) {
    const model = product.catalog.models.find(
      (candidate) => candidate.id === selection.model,
    );
    if (!model) return { ready: false, reason: "The selected model is stale." };
    if (selection.effort && !model.efforts.includes(selection.effort))
      return {
        ready: false,
        reason: "The selected reasoning effort is unavailable.",
      };
  }
  return { ready: true, ...(browserIdentity ? { browserIdentity } : {}) };
}

export function recoveryLabel(desktop: DesktopSurfaceSnapshot | null): string {
  return codexCustomerStatus(desktop).label;
}

export function modeLabel(mode: ExecutionMode): string {
  return {
    agent: "Automate · Agent mode",
    companion: "Work together · Companion mode",
    capture: "Capture · Human-driven",
  }[mode];
}
