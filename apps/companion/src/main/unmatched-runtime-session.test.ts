import { describe, expect, it, vi } from "vitest";

import type { DesktopSurfaceSnapshot } from "../shared/desktop-api.js";
import { endUnmatchedRuntimeSession } from "./unmatched-runtime-session.js";

function snapshot(matched: boolean): DesktopSurfaceSnapshot {
  const sessionId = "ses_unmatched";
  return {
    revision: 1,
    surface: {
      presentation: "full",
      browserContext: "windowed",
      activeHost: "control_center",
      returnPresentation: "chip",
      revision: 1,
    },
    companion: {
      session: {
        id: sessionId,
        mode: "agent",
        status: "active",
        controller: "agent",
      },
      observationCount: 2,
      evidenceCount: 7,
    },
    notice: null,
    workspaces: { workspaces: [] },
    product: {
      version: 8,
      host: { state: "ready", ready: true, restartAttempt: 0 },
      catalog: {
        account: { status: "logged_out", requiresOpenaiAuth: true },
        models: [],
        rateLimits: null,
        usage: null,
        refreshedAt: "2026-09-08T00:00:00Z",
      },
      attention: [],
      tasks: matched
        ? [
            {
              taskId: "task_matched",
              executionMode: "agent",
              browserIdentity: { mode: "temporary" },
              selectionSource: "user_selected",
              selectedAt: "2026-09-08T00:00:00Z",
              approvalsReviewer: "auto_review",
              bootstrapStage: "complete",
              roveSessionId: sessionId,
              lifecycle: { phase: "working", reason: "Working." },
              availableActions: ["finish"],
            },
          ]
        : [],
      workflows: [],
      recoveryWarnings: [],
      draftAttachments: [],
      fileAttention: [],
    },
    productError: null,
  };
}

describe("unmatched Runtime session finish boundary", () => {
  it("ends the exact unmatched session once", async () => {
    const endSession = vi.fn().mockResolvedValue(undefined);
    await endUnmatchedRuntimeSession({
      sessionId: "ses_unmatched",
      snapshot: snapshot(false),
      endSession,
    });
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(endSession).toHaveBeenCalledWith("ses_unmatched");
  });

  it("does not guess or end a session already associated with a task", async () => {
    const endSession = vi.fn().mockResolvedValue(undefined);
    await expect(
      endUnmatchedRuntimeSession({
        sessionId: "ses_unmatched",
        snapshot: snapshot(true),
        endSession,
      }),
    ).rejects.toThrow(/no longer an unmatched session/);
    expect(endSession).not.toHaveBeenCalled();
  });
});
