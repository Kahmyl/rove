import { describe, expect, it } from "vitest";

import type {
  LocalProductSnapshot,
  ProductTaskProjection,
} from "../main/codex/local-product-api.js";
import type { DesktopSurfaceSnapshot } from "../shared/desktop-api.js";
import {
  activeProductTask,
  archivedProductTasks,
  codexCustomerStatus,
  composerGate,
  newestDesktopSnapshot,
  reconcileSelectedTaskId,
  recoveryLabel,
  selectableProductTasks,
  taskControlProjection,
  taskHistoryTitle,
} from "./product-surface-state.js";

const workspaceId = "wrk_00000000-0000-4000-8000-000000000001";

function product(
  account: "unavailable" | "logged_out" | "logged_in" = "logged_in",
): LocalProductSnapshot {
  return {
    version: 9,
    host: { state: "ready", ready: true, restartAttempt: 0 },
    catalog: {
      account: { status: account },
      models: [
        {
          id: "model_a",
          model: "model_a",
          displayName: "Model A",
          description: "Fixture",
          efforts: ["low", "high"],
          defaultEffort: "low",
          isDefault: true,
          inputModalities: ["text"],
          supportsPersonality: false,
          defaultServiceTier: null,
        },
      ],
      rateLimits: null,
      usage: null,
      refreshedAt: "2026-09-07T00:00:00Z",
    },
    attention: [],
    tasks: [],
    workflows: [],
    recoveryWarnings: [],
    draftAttachments: [],
    fileAttention: [],
  };
}

function desktop(
  account: "unavailable" | "logged_out" | "logged_in" = "logged_in",
): DesktopSurfaceSnapshot {
  return {
    revision: 1,
    surface: {
      presentation: "full",
      browserContext: "windowed",
      activeHost: "control_center",
      returnPresentation: "chip",
      revision: 1,
    },
    companion: null,
    notice: null,
    workspaces: {
      selectedWorkspaceId: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          displayName: "Personal",
          browser: "chrome",
          storageLayout: "workspace",
          createdAt: "2026-09-07T00:00:00Z",
          lastUsedAt: "2026-09-07T00:00:00Z",
        },
      ],
    },
    product: product(account),
    productError: null,
  };
}

describe("native product composer state", () => {
  it("ignores a Desktop snapshot older than the newest applied revision", () => {
    const newer = desktop();
    const older = { ...newer, revision: 0 };
    expect(newestDesktopSnapshot(newer, older)).toBe(newer);
    expect(newestDesktopSnapshot(older, newer)).toBe(newer);
  });

  it.each(["agent", "companion", "capture"] as const)(
    "accepts %s with named and explicitly temporary identity",
    (mode) => {
      for (const browserChoice of [`workspace:${workspaceId}`, "temporary"]) {
        const result = composerGate(desktop(), {
          outcome: "Complete the task",
          mode,
          browserChoice,
          model: "model_a",
          effort: "high",
        });
        expect(result.ready).toBe(true);
        expect(result.browserIdentity?.mode).toBe(
          browserChoice === "temporary" ? "temporary" : "workspace",
        );
      }
    },
  );

  it("blocks unavailable model access and empty input without requiring a browser", () => {
    for (const account of ["logged_out", "unavailable"] as const)
      expect(
        composerGate(desktop(account), {
          outcome: "Do it",
          mode: "agent",
          browserChoice: `workspace:${workspaceId}`,
        }).ready,
      ).toBe(false);
    expect(
      composerGate(desktop(), {
        outcome: "",
        mode: "agent",
        browserChoice: `workspace:${workspaceId}`,
      }).reason,
    ).toMatch(/Describe/);
    const noWorkspace = desktop();
    noWorkspace.workspaces = { workspaces: [] };
    expect(
      composerGate(noWorkspace, {
        outcome: "Do it",
        mode: "agent",
        browserChoice: "",
      }),
    ).toEqual({ ready: true });
  });

  it("keeps an unmatched Runtime session visible without globally blocking new tasks", () => {
    const state = desktop("logged_out");
    state.companion = {
      session: {
        id: "ses_unmatched",
        mode: "agent",
        status: "active",
        controller: "agent",
      },
      observationCount: 2,
      evidenceCount: 7,
    };
    expect(
      composerGate(state, {
        outcome: "Do it",
        mode: "agent",
        browserChoice: `workspace:${workspaceId}`,
      }).reason,
    ).toBe("Not signed in to Codex.");

    state.product!.catalog.account = { status: "logged_in" };
    expect(
      composerGate(state, {
        outcome: "Do it",
        mode: "agent",
        browserChoice: "temporary",
      }),
    ).toMatchObject({ ready: true, browserIdentity: { mode: "temporary" } });
  });

  it("defers stale browser selection while rejecting stale model choices", () => {
    expect(
      composerGate(desktop(), {
        outcome: "Do it",
        mode: "agent",
        browserChoice: "workspace:wrk_00000000-0000-4000-8000-000000000099",
      }),
    ).toEqual({ ready: true });
    expect(
      composerGate(desktop(), {
        outcome: "Do it",
        mode: "agent",
        browserChoice: `workspace:${workspaceId}`,
        model: "removed",
      }).reason,
    ).toMatch(/model is stale/);
    expect(
      composerGate(desktop(), {
        outcome: "Do it",
        mode: "agent",
        browserChoice: `workspace:${workspaceId}`,
        model: "model_a",
        effort: "ultra",
      }).reason,
    ).toMatch(/effort is unavailable/);
  });

  it("keeps an oldest cleanup task selectable without blocking an independent launch", () => {
    const state = desktop();
    const blocker: ProductTaskProjection = {
      taskId: "task_oldest_blocker",
      executionMode: "agent" as const,
      browserIdentity: { mode: "temporary" as const },
      selectionSource: "user_selected" as const,
      selectedAt: "2026-09-01T00:00:00.000Z",
      approvalsReviewer: "auto_review",
      bootstrapStage: "complete" as const,
      results: [],
      lifecycle: {
        phase: "cleanup_required" as const,
        reason: "Runtime cleanup is unconfirmed.",
      },
      availableActions: ["retry_cleanup", "finish"],
    };
    const histories: ProductTaskProjection[] = Array.from(
      { length: 12 },
      (_, index) => ({
        ...blocker,
        taskId: `task_closed_${index}`,
        selectedAt: `2026-09-0${String((index % 7) + 1)}T01:00:00.000Z`,
        lifecycle: { phase: "closed", reason: "Closed." },
        availableActions: [],
      }),
    );
    state.product!.tasks = [blocker, ...histories];

    const selectable = selectableProductTasks(state.product);
    expect(selectable).toHaveLength(9);
    expect(selectable[0]).toMatchObject({
      taskId: blocker.taskId,
      availableActions: ["retry_cleanup", "finish"],
    });
    expect(
      composerGate(state, {
        outcome: "Start another task",
        mode: "agent",
        browserChoice: "temporary",
      }),
    ).toMatchObject({
      ready: true,
      browserIdentity: { mode: "temporary" },
    });
  });

  it("keeps a selected task visible when another active task receives an update", () => {
    const state = product();
    const active: ProductTaskProjection = {
      taskId: "task_a",
      executionMode: "agent",
      selectionSource: "user_selected",
      selectedAt: "2026-09-12T00:00:00.000Z",
      approvalsReviewer: "auto_review",
      bootstrapStage: "complete",
      results: [],
      lifecycle: { phase: "working", reason: "Working." },
      availableActions: ["message", "interrupt"],
    };
    const selected: ProductTaskProjection = {
      ...active,
      taskId: "task_b",
      lifecycle: { phase: "ready", reason: "Ready." },
      availableActions: ["message"],
    };
    state.tasks = [active, selected];
    state.currentTaskId = active.taskId;

    expect(reconcileSelectedTaskId(selected.taskId, active.taskId, state)).toBe(
      selected.taskId,
    );
    state.tasks = [
      { ...active, lifecycle: { phase: "working", reason: "New event." } },
      selected,
    ];
    expect(reconcileSelectedTaskId(selected.taskId, active.taskId, state)).toBe(
      selected.taskId,
    );
  });

  it("derives concise task names from the first meaningful user request", () => {
    const task: ProductTaskProjection = {
      taskId: "task_named",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      selectionSource: "user_selected",
      selectedAt: "2026-09-12T00:00:00.000Z",
      approvalsReviewer: "auto_review",
      bootstrapStage: "complete",
      results: [],
      lifecycle: { phase: "closed", reason: "Closed." },
      availableActions: [],
      conversation: {
        turnStatus: "completed",
        archived: false,
        items: {
          first: {
            id: "first",
            turnId: "turn_1",
            kind: "user_message",
            status: "completed",
            authoredBy: "user",
            text: "Using only the Rove connector, create and verify a private GitHub repository for browser acceptance.",
          },
        },
        turnOrder: ["turn_1"],
      },
    };
    expect(taskHistoryTitle(task)).toBe(
      "Create and verify a private GitHub repository for…",
    );
    const legacyFirst = { ...task.conversation!.items.first! };
    delete legacyFirst.authoredBy;
    expect(
      taskHistoryTitle({
        ...task,
        conversation: {
          ...task.conversation!,
          items: {
            first: legacyFirst,
          },
        },
      }),
    ).toBe("Create and verify a private GitHub repository for…");
    const withoutConversation = { ...task };
    delete withoutConversation.conversation;
    expect(
      taskHistoryTitle({ ...withoutConversation, executionMode: "capture" }),
    ).toBe("Browser capture");
  });

  it("does not count closed archived history as blockers before or after active-task cleanup", () => {
    const state = desktop();
    const closed: ProductTaskProjection = {
      taskId: "task_closed",
      executionMode: "agent",
      browserIdentity: { mode: "workspace", workspaceId },
      selectionSource: "user_selected",
      selectedAt: "2026-09-07T00:00:00.000Z",
      approvalsReviewer: "auto_review",
      bootstrapStage: "complete",
      results: [],
      lifecycle: { phase: "closed", reason: "Closed." },
      availableActions: [],
      conversation: {
        turnStatus: "completed",
        archived: true,
        items: {},
        turnOrder: [],
      },
    };
    const active: ProductTaskProjection = {
      ...closed,
      taskId: "task_active",
      lifecycle: { phase: "working", reason: "Working." },
      availableActions: [],
      conversation: {
        turnStatus: "in_progress",
        archived: false,
        items: {},
        turnOrder: [],
      },
    };
    state.product!.tasks = [closed, closed, closed, closed, active].map(
      (task, index) => ({ ...task, taskId: `${task.taskId}_${index}` }),
    );
    state.product!.currentTaskId = "task_active_4";
    expect(
      composerGate(state, {
        outcome: "Next",
        mode: "agent",
        browserChoice: `workspace:${workspaceId}`,
      }),
    ).toMatchObject({
      ready: true,
      browserIdentity: { mode: "workspace", workspaceId },
    });
    expect(
      composerGate(state, {
        outcome: "Next",
        mode: "agent",
        browserChoice: "temporary",
      }),
    ).toMatchObject({ ready: true, browserIdentity: { mode: "temporary" } });
    state.product!.tasks = state.product!.tasks.map((task, index) =>
      index === 4
        ? {
            ...task,
            lifecycle: { phase: "ready", reason: "Ready." },
            conversation: {
              turnStatus: "completed",
              archived: false,
              items: {},
              turnOrder: [],
            },
          }
        : task,
    );
    expect(
      composerGate(state, {
        outcome: "Keep the dormant profile selection",
        mode: "agent",
        browserChoice: `workspace:${workspaceId}`,
      }),
    ).toMatchObject({ ready: true });

    state.product!.tasks = state.product!.tasks.map((task, index) =>
      index === 4
        ? {
            ...task,
            lifecycle: { phase: "closed", reason: "Closed." },
            availableActions: [],
            conversation: {
              turnStatus: "completed",
              archived: true,
              items: {},
              turnOrder: [],
            },
          }
        : task,
    );
    delete state.product!.currentTaskId;
    expect(
      composerGate(state, {
        outcome: "Next",
        mode: "agent",
        browserChoice: `workspace:${workspaceId}`,
      }),
    ).toMatchObject({ ready: true });
  });

  it("keeps exact takeover authority when another task owns current presentation", () => {
    const state = product();
    const task: ProductTaskProjection = {
      taskId: "task_waiting",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      selectionSource: "user_selected",
      selectedAt: "2026-09-08T00:00:00.000Z",
      approvalsReviewer: "auto_review",
      bootstrapStage: "complete",
      results: [],
      lifecycle: { phase: "waiting_for_human", reason: "Handoff." },
      availableActions: [],
      capabilities: {
        canSubmit: false,
        canQueue: false,
        canSteer: false,
        canStop: true,
        canRespond: false,
        canTakeControl: true,
        canReturnToRove: false,
        canRetry: false,
        canArchive: false,
      },
      runtime: {
        status: "awaiting_human",
        controller: null,
        attachment: "attached",
        recovery: "not_needed",
        profileOwnership: "released",
        handoffActionable: true,
        handoffGeneration: 2,
      },
    };
    const presented = {
      ...task,
      taskId: "task_presented",
      lifecycle: { phase: "working" as const, reason: "Working." },
      runtime: {
        ...task.runtime!,
        status: "active" as const,
        controller: "agent" as const,
      },
    };
    state.tasks = [task, presented];
    state.currentTaskId = presented.taskId;
    state.attention = [
      {
        authority: "rove_control",
        kind: "control_handoff",
        requestId: "control:ses_waiting:handoff_waiting",
        taskId: task.taskId,
        generation: 2,
        status: "pending",
        sequence: 1,
        title: "Browser control handoff",
      },
    ];
    expect(taskControlProjection(task, state)).toEqual({
      controllerLabel: "Awaiting handoff",
      canTakeControl: true,
      canPause: false,
    });
    state.attention = state.attention.map((entry) => ({
      ...entry,
      generation: 3,
    }));
    expect(taskControlProjection(task, state)).toEqual({
      controllerLabel: "Awaiting handoff",
      canTakeControl: false,
      canPause: false,
    });
    state.attention = state.attention.map((entry) => ({
      ...entry,
      generation: 2,
    }));
    task.runtime!.handoffActionable = false;
    expect(taskControlProjection(task, state)).toEqual({
      controllerLabel: "Awaiting handoff",
      canTakeControl: false,
      canPause: false,
    });
    task.runtime!.handoffActionable = true;
    expect(taskControlProjection(presented, state)).toEqual({
      controllerLabel: "Agent",
      canTakeControl: false,
      canPause: true,
    });
  });

  it("reconciles selection against actual unarchived navigation history", () => {
    const state = product();
    const terminal: ProductTaskProjection = {
      taskId: "task_terminal",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      selectionSource: "user_selected",
      selectedAt: "2026-09-08T00:00:00.000Z",
      approvalsReviewer: "auto_review",
      bootstrapStage: "complete",
      results: [],
      lifecycle: { phase: "closed", reason: "Closed." },
      availableActions: [],
    };
    state.tasks = [terminal];

    expect(activeProductTask(state)).toBeUndefined();
    expect(reconcileSelectedTaskId("task_terminal", null, state)).toBe(
      "task_terminal",
    );
    expect(reconcileSelectedTaskId("task_missing", null, state)).toBe(
      "task_terminal",
    );

    const archived = {
      ...terminal,
      conversation: {
        turnStatus: "completed" as const,
        archived: true,
        items: {},
        turnOrder: [],
      },
    } satisfies ProductTaskProjection;
    state.tasks = [archived];
    expect(reconcileSelectedTaskId("task_terminal", null, state)).toBeNull();

    const recent = { ...terminal, taskId: "task_recent" };
    state.tasks = [recent, archived];
    expect(reconcileSelectedTaskId("task_terminal", null, state)).toBe(
      "task_recent",
    );

    const archivedReady = {
      ...archived,
      taskId: "task_archived_ready",
      lifecycle: { phase: "ready" as const, reason: "Ready." },
      availableActions: ["resume" as const],
    };
    const archivedCleanup = {
      ...archived,
      taskId: "task_archived_cleanup",
      lifecycle: {
        phase: "cleanup_required" as const,
        reason: "Cleanup remains.",
      },
      availableActions: [
        "message" as const,
        "retry_cleanup" as const,
        "resume" as const,
      ],
    };
    state.tasks = [archivedReady, archivedCleanup];
    expect(selectableProductTasks(state)).toEqual([]);
    expect(archivedProductTasks(state).map((task) => task.taskId)).toEqual([
      "task_archived_cleanup",
      "task_archived_ready",
    ]);
    expect(
      reconcileSelectedTaskId("task_archived_ready", null, state),
    ).toBeNull();

    const blocker = {
      ...terminal,
      taskId: "task_blocker",
      lifecycle: { phase: "cleanup_required", reason: "Cleanup required." },
      availableActions: ["retry_cleanup"],
    } satisfies ProductTaskProjection;
    state.tasks = [terminal, blocker];
    state.currentTaskId = blocker.taskId;
    expect(reconcileSelectedTaskId("task_terminal", null, state)).toBeNull();
    expect(activeProductTask(state)?.taskId).toBe(blocker.taskId);

    delete state.currentTaskId;
    state.tasks = [terminal];
    expect(
      reconcileSelectedTaskId("task_terminal", blocker.taskId, state),
    ).toBeNull();
  });

  it("projects exact customer Codex states without exposing technical failures", () => {
    expect(recoveryLabel(null)).toBe("Starting Codex");
    const starting = desktop();
    starting.product!.host = {
      state: "initializing",
      ready: false,
      restartAttempt: 0,
    };
    expect(recoveryLabel(starting)).toBe("Starting Codex");
    starting.product!.host = {
      state: "degraded",
      ready: false,
      restartAttempt: 1,
    };
    expect(recoveryLabel(starting)).toBe("Restarting Codex");
    starting.productError =
      "Codex 0.154.0 is not reviewed baseline 0.153.4 (sha256 deadbeef).";
    expect(recoveryLabel(starting)).toBe("Codex couldn't start");
    expect(codexCustomerStatus(starting).recovery).toBe("restart_rove");
    expect(recoveryLabel(starting)).not.toMatch(
      /0\.154|baseline|sha256|App Server/,
    );

    const signedOut = desktop("logged_out");
    expect(codexCustomerStatus(signedOut)).toMatchObject({
      kind: "signed_out",
      label: "Not signed in to Codex",
      recovery: "sign_in",
    });
    expect(
      codexCustomerStatus(signedOut, {
        type: "chatgpt",
        loginId: "login_a",
      }),
    ).toMatchObject({ kind: "signing_in", label: "Signing in…" });

    const accountFailure = desktop("unavailable");
    accountFailure.product!.catalog.account.error = "RPC unavailable";
    expect(codexCustomerStatus(accountFailure)).toMatchObject({
      kind: "account_check_failed",
      label: "Couldn't check your Codex account",
      recovery: "retry",
    });

    const usageLimited = desktop();
    usageLimited.product!.catalog.rateLimits = [
      {
        limitId: "codex",
        limitName: "Five-hour window",
        usedPercent: 100,
        resetsAt: 1788825600,
        windowDurationMins: 300,
        planType: "Plus",
      },
    ];
    expect(codexCustomerStatus(usageLimited)).toMatchObject({
      kind: "usage_limit_reached",
      label: "Codex usage limit reached",
    });
    expect(recoveryLabel(desktop())).toBe("Codex ready");
    expect(codexCustomerStatus(desktop(), null, true)).toMatchObject({
      kind: "unknown_failure",
      label: "Something went wrong with Codex",
    });
  });

  it("contains no browser profile filesystem path in the renderer workspace projection", () => {
    expect(JSON.stringify(desktop())).not.toMatch(
      /userDataDir|profileDirectory/,
    );
  });
});
