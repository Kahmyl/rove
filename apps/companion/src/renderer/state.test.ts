import { describe, expect, it } from "vitest";

import type { CompanionSnapshot } from "../shared/desktop-api.js";
import { toCompanionViewModel } from "./state.js";

const baseSession = {
  id: "ses_test",
  mode: "companion" as const,
  status: "active" as const,
  controller: "agent" as const,
  profile: {
    mode: "temporary" as const,
  },
  createdAt: "2026-08-10T07:00:00.000Z",
  updatedAt: "2026-08-10T07:00:00.000Z",
};

describe("Companion renderer state", () => {
  it("presents agent work as a quiet no-action-needed state", () => {
    const snapshot: CompanionSnapshot = {
      session: baseSession,
      observationCount: 12,
      evidenceCount: 3,
    };

    expect(toCompanionViewModel(snapshot)).toMatchObject({
      experience: "agent_working",
      kicker: "Agent working",
      title: "Working in the browser",
      description: "No action is needed from you right now.",
      primaryAction: "take_control",
      primaryActionLabel: "Take over",
      controller: "Agent",
      observationCount: 12,
      evidenceCount: 3,
      canTakeControl: true,
      canReturnControl: false,
    });
  });

  it("keeps Agent Mode autonomous until an explicit handoff", () => {
    const snapshot: CompanionSnapshot = {
      session: {
        ...baseSession,
        mode: "agent",
      },
      observationCount: 5,
      evidenceCount: 0,
    };

    expect(toCompanionViewModel(snapshot)).toMatchObject({
      experience: "agent_working",
      supportingText: "Rove will ask when it needs your help.",
      primaryAction: null,
      canTakeControl: false,
      canReturnControl: false,
    });
  });

  it("allows a requested Agent Mode handoff to be accepted", () => {
    const snapshot: CompanionSnapshot = {
      session: {
        ...baseSession,
        mode: "agent",
        status: "awaiting_human",
        controller: null,
        handoff: {
          reason: "Sign in to your account.",
          requestedAt: "2026-08-10T07:01:00.000Z",
        },
      },
      observationCount: 4,
      evidenceCount: 0,
    };

    expect(toCompanionViewModel(snapshot)).toMatchObject({
      experience: "handoff_waiting",
      kicker: "Your turn",
      description: "Sign in to your account.",
      primaryAction: "take_control",
      primaryActionLabel: "Start this step",
      canTakeControl: true,
      canReturnControl: false,
    });
  });

  it("returns Agent Mode to automation after the requested human step", () => {
    const snapshot: CompanionSnapshot = {
      session: {
        ...baseSession,
        mode: "agent",
        controller: "human",
        handoff: {
          reason: "Sign in to your account.",
          requestedAt: "2026-08-10T07:01:00.000Z",
        },
      },
      observationCount: 6,
      evidenceCount: 0,
    };

    expect(toCompanionViewModel(snapshot)).toMatchObject({
      experience: "human_step",
      description: "Sign in to your account.",
      primaryAction: "return_control",
      primaryActionLabel: "Done — Resume Automation",
      canTakeControl: false,
      canReturnControl: true,
    });
  });

  it("turns a requested handoff into one obvious human task", () => {
    const snapshot: CompanionSnapshot = {
      session: {
        ...baseSession,
        status: "awaiting_human",
        controller: null,
        handoff: {
          reason: "Please complete the sign-in step.",
          requestedAt: "2026-08-10T07:01:00.000Z",
        },
      },
      observationCount: 4,
      evidenceCount: 0,
    };

    expect(toCompanionViewModel(snapshot)).toMatchObject({
      experience: "handoff_waiting",
      kicker: "Your turn",
      title: "Rove needs you for one step",
      description: "Please complete the sign-in step.",
      supportingText: "Rove is paused until you take over.",
      primaryAction: "take_control",
      primaryActionLabel: "Start this step",
      controller: "Waiting",
    });
  });

  it("keeps the requested task visible while the human performs it", () => {
    const snapshot: CompanionSnapshot = {
      session: {
        ...baseSession,
        controller: "human",
        handoff: {
          reason: "Please complete the sign-in step.",
          requestedAt: "2026-08-10T07:01:00.000Z",
        },
      },
      observationCount: 6,
      evidenceCount: 1,
    };

    expect(toCompanionViewModel(snapshot)).toMatchObject({
      experience: "human_step",
      kicker: "You're in control",
      title: "You're handling this step",
      description: "Please complete the sign-in step.",
      supportingText: "Rove is paused while you work.",
      primaryAction: "return_control",
      primaryActionLabel: "Done — Resume Automation",
      controller: "You",
      canTakeControl: false,
      canReturnControl: true,
    });
  });

  it("represents voluntary human takeover without pretending it was a requested step", () => {
    const snapshot: CompanionSnapshot = {
      session: {
        ...baseSession,
        controller: "human",
      },
      observationCount: 2,
      evidenceCount: 1,
    };

    expect(toCompanionViewModel(snapshot)).toMatchObject({
      experience: "human_step",
      title: "Browser control is yours",
      description:
        "Use the browser directly, then resume automation when you're done.",
      primaryAction: "return_control",
      primaryActionLabel: "Resume Automation",
    });
  });

  it("makes Capture Mode human-first and removes handback semantics", () => {
    const snapshot: CompanionSnapshot = {
      session: {
        ...baseSession,
        id: "ses_capture",
        mode: "capture",
        controller: "human",
      },
      observationCount: 8,
      evidenceCount: 2,
    };

    expect(toCompanionViewModel(snapshot)).toMatchObject({
      experience: "capture",
      kicker: "Capture mode",
      title: "You're in control",
      description: "Rove is observing this browser session while you work.",
      primaryAction: "finish_capture",
      primaryActionLabel: "Finish Capture",
      controller: "You",
      canTakeControl: false,
      canReturnControl: false,
      canFinish: true,
    });
  });

  it("represents the absence of a session without exposing internal state", () => {
    expect(toCompanionViewModel(null)).toMatchObject({
      hasSession: false,
      experience: "no_session",
      kicker: "Ready",
      title: "Waiting for a session",
      primaryAction: null,
      controller: "None",
      observationCount: 0,
      evidenceCount: 0,
      canTakeControl: false,
      canReturnControl: false,
      canFinish: false,
    });
  });
});
