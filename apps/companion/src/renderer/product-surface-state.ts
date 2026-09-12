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
  if (desktop === null) return { ready: false, reason: "Rove is connecting." };
  if (desktop.productError)
    return { ready: false, reason: desktop.productError };
  const product = desktop.product;
  if (!product?.host.ready)
    return { ready: false, reason: "Codex App Server is not ready." };
  if (product.catalog.account.status !== "logged_in")
    return {
      ready: false,
      reason: "Sign in to Rove with ChatGPT before starting.",
    };
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
  if (desktop === null) return "Connecting";
  if (desktop.productError) return "Codex unavailable";
  const state = desktop.product?.host.state;
  if (state === "resolving" || state === "starting" || state === "initializing")
    return "Starting Codex";
  if (state === "degraded") return "Restarting Codex";
  if (state === "failed") return "Codex needs attention";
  return desktop.product?.host.ready ? "Ready" : "Recovering";
}

export function modeLabel(mode: ExecutionMode): string {
  return {
    agent: "Automate · Agent mode",
    companion: "Work together · Companion mode",
    capture: "Capture · Human-driven",
  }[mode];
}
