import type { Session } from "@rove/protocol";

import { describe, expect, it } from "vitest";

import type { CustomerBrowserCollaboration } from "../main/codex/customer-task-collaboration.js";
import type {
  ProductAttentionProjection,
  ProductTaskProjection,
} from "../main/codex/local-product-api.js";
import type { DesktopSurfaceSnapshot } from "../shared/desktop-api.js";
import {
  compactFollowerTakeControlTarget,
  compactFollowerTaskContext,
  toCompactFollowerViewModel,
} from "./follower-state.js";

const base: Session = {
  id: "ses_follow",
  mode: "agent",
  status: "active",
  controller: "agent",
  profile: { mode: "temporary" },
  createdAt: "2026-09-05T16:00:00.000Z",
  updatedAt: "2026-09-05T16:00:00.000Z",
};

function browser(
  overrides: Partial<CustomerBrowserCollaboration> = {},
): CustomerBrowserCollaboration {
  return {
    state: "agent_control",
    title: "Rove controls the browser",
    description: "Rove can continue working in this Task's browser.",
    canTakeOver: false,
    canReturnToRove: false,
    ...overrides,
  };
}

function task(
  overrides: Partial<ProductTaskProjection> = {},
): ProductTaskProjection {
  return {
    taskId: "task_a",
    executionMode: "agent",
    selectionSource: "explicit",
    selectedAt: "2026-09-05T16:00:00.000Z",
    bootstrapStage: "ready",
    approvalsReviewer: "auto_review",
    results: [],
    lifecycle: { phase: "active", reason: "Running" },
    availableActions: [],
    roveSessionId: base.id,
    capabilities: {
      canSubmit: false,
      canQueue: false,
      canSteer: false,
      canStop: true,
      canRespond: false,
      canTakeControl: false,
      canReturnToRove: false,
      canRetry: false,
      canArchive: false,
    },
    runtime: {
      status: "active",
      controller: "agent",
      attachment: "attached",
      recovery: "none",
      profileOwnership: "held",
    },
    ...overrides,
  } as ProductTaskProjection;
}

function desktop(
  tasks: readonly ProductTaskProjection[],
  attention: readonly ProductAttentionProjection[] = [],
): DesktopSurfaceSnapshot {
  return {
    revision: 1,
    surface: {
      presentation: "expanded",
      browserContext: "windowed",
      activeHost: "browser_follower",
      returnPresentation: "chip",
      revision: 1,
    },
    companion: { session: base, observationCount: 0, evidenceCount: 0 },
    notice: null,
    workspaces: { workspaces: [] },
    product: {
      version: 9,
      host: { state: "ready", ready: true, restartAttempt: 0 },
      catalog: {
        account: { status: "logged_out" },
        models: [],
        rateLimits: null,
        usage: null,
        refreshedAt: "2026-09-05T16:00:00.000Z",
      },
      attention,
      tasks,
      workflows: [],
      recoveryWarnings: [],
      draftAttachments: [],
      fileAttention: [],
    },
    productError: null,
  } as DesktopSurfaceSnapshot;
}

describe("toCompactFollowerViewModel", () => {
  it("keeps ordinary Agent Mode observational", () => {
    expect(toCompactFollowerViewModel(base, browser(), true)).toMatchObject({
      experience: "agent_working",
      kicker: "Agent working",
      primaryAction: null,
      canStop: true,
    });
  });

  it("offers requested handoff authority from the canonical projection", () => {
    expect(
      toCompactFollowerViewModel(
        { ...base, status: "awaiting_human", controller: null },
        browser({
          state: "takeover_required",
          title: "Waiting for you",
          canTakeOver: true,
          handoffGeneration: 7,
        }),
        true,
      ),
    ).toMatchObject({
      experience: "human_required",
      kicker: "Your turn",
      primaryAction: "take_control",
      primaryActionLabel: "Take Over",
    });
  });

  it("does not expose requested takeover without its exact generation", () => {
    expect(
      toCompactFollowerViewModel(
        { ...base, status: "awaiting_human", controller: null },
        browser({ state: "takeover_required", canTakeOver: true }),
      ).primaryAction,
    ).toBeNull();
  });

  it("allows voluntary Companion takeover without a handoff generation", () => {
    expect(
      toCompactFollowerViewModel(
        { ...base, mode: "companion" },
        browser({ state: "takeover_available", canTakeOver: true }),
      ),
    ).toMatchObject({
      experience: "agent_working",
      primaryAction: "take_control",
      primaryActionLabel: "Take Over",
    });
  });

  it("does not infer voluntary takeover from Companion session mode", () => {
    expect(
      toCompactFollowerViewModel({ ...base, mode: "companion" }, browser())
        .primaryAction,
    ).toBeNull();
  });

  it("offers Return to Rove only while canonical authority permits it", () => {
    expect(
      toCompactFollowerViewModel(
        { ...base, controller: "human" },
        browser({
          state: "human_control",
          title: "You're in control",
          canReturnToRove: true,
        }),
      ),
    ).toMatchObject({
      experience: "human_controlling",
      primaryAction: "return_control",
      primaryActionLabel: "Return to Rove",
    });

    expect(
      toCompactFollowerViewModel(
        { ...base, controller: "human" },
        browser({ state: "human_control", canReturnToRove: false }),
      ).primaryAction,
    ).toBeNull();
  });

  it("shows checking-after-return without controls or Agent working copy", () => {
    const view = toCompactFollowerViewModel(
      base,
      browser({
        state: "checking_after_return",
        title: "Checking the page…",
      }),
    );
    expect(view).toMatchObject({
      experience: "checking_after_return",
      kicker: "Checking",
      primaryAction: null,
    });
    expect(view.kicker).not.toBe("Agent working");
  });

  it("does not turn a paused legacy session into browser handback authority", () => {
    expect(
      toCompactFollowerViewModel(
        { ...base, status: "paused", controller: null },
        browser({ state: "none" }),
        true,
      ),
    ).toMatchObject({
      experience: "paused",
      primaryAction: null,
      canStop: true,
    });
  });

  it("keeps Stop independent and tied to the exact Task capability", () => {
    expect(toCompactFollowerViewModel(base, browser(), false).canStop).toBe(
      false,
    );
    expect(toCompactFollowerViewModel(base, browser(), true).canStop).toBe(
      true,
    );
  });

  it("represents terminal, Capture, and absent sessions without control authority", () => {
    expect(
      toCompactFollowerViewModel({
        ...base,
        status: "completed",
        controller: null,
      }),
    ).toMatchObject({ experience: "ready_for_review", primaryAction: null });
    expect(
      toCompactFollowerViewModel(
        { ...base, mode: "capture", controller: "human" },
        browser({ state: "human_control", canReturnToRove: true }),
      ),
    ).toMatchObject({ experience: "capture", primaryAction: null });
    expect(toCompactFollowerViewModel(null)).toMatchObject({
      experience: "ready",
      primaryAction: null,
      canStop: false,
    });
  });
});

describe("compactFollowerTaskContext", () => {
  it("uses the exact Task's canonical collaboration source and generation", () => {
    const canonical = browser({
      state: "takeover_required",
      canTakeOver: true,
      handoffGeneration: 12,
    });
    const exactTask = task({
      customerCollaboration: {
        taskId: "task_a",
        browser: canonical,
        needsCustomerAction: true,
      },
    });
    const context = compactFollowerTaskContext(desktop([exactTask]));

    expect(context.browser).toBe(canonical);
    expect(compactFollowerTakeControlTarget(context)).toEqual({
      taskId: "task_a",
      handoffGeneration: 12,
    });
  });

  it("does not let global attention override canonical denial", () => {
    const canonical = browser({ state: "agent_control", canTakeOver: false });
    const exactTask = task({
      customerCollaboration: {
        taskId: "task_a",
        browser: canonical,
        needsCustomerAction: false,
      },
    });
    const independentlyPending = {
      authority: "rove_control",
      kind: "control_handoff",
      taskId: "task_a",
      requestId: "stale_global_handoff",
      generation: 19,
      status: "pending",
      sequence: 1,
      title: "Stale global handoff",
    } as ProductAttentionProjection;
    const context = compactFollowerTaskContext(
      desktop([exactTask], [independentlyPending]),
    );

    expect(context.browser).toBe(canonical);
    expect(compactFollowerTakeControlTarget(context)).toBeNull();
    expect(
      toCompactFollowerViewModel(context.session, context.browser)
        .primaryAction,
    ).toBeNull();
  });

  it("does not let Task A consume Task B's pending handoff", () => {
    const taskA = task({
      capabilities: { ...task().capabilities!, canTakeControl: true },
      runtime: {
        ...task().runtime!,
        status: "awaiting_human",
        controller: null,
        handoffActionable: true,
        handoffGeneration: 4,
      },
    });
    const taskBAttention = {
      authority: "rove_control",
      kind: "control_handoff",
      taskId: "task_b",
      requestId: "handoff_b",
      generation: 4,
      status: "pending",
      sequence: 1,
      title: "Task B needs you",
    } as ProductAttentionProjection;
    const context = compactFollowerTaskContext(
      desktop([taskA], [taskBAttention]),
    );

    expect(context.browser?.canTakeOver).toBe(false);
    expect(compactFollowerTakeControlTarget(context)).toBeNull();
  });

  it("uses the compatibility projector only when canonical collaboration is absent", () => {
    const fallbackTask = task({
      executionMode: "companion",
      capabilities: { ...task().capabilities!, canTakeControl: true },
    });
    const context = compactFollowerTaskContext(desktop([fallbackTask]));

    expect(context.browser).toMatchObject({
      state: "takeover_available",
      canTakeOver: true,
    });
    expect(compactFollowerTakeControlTarget(context)).toEqual({
      taskId: "task_a",
    });
  });
});
