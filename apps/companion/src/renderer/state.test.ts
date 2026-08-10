import {
  describe,
  expect,
  it,
} from "vitest";

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
  it("represents agent-controlled Companion Mode", () => {
    const snapshot: CompanionSnapshot = {
      session: baseSession,
      observationCount: 12,
      evidenceCount: 3,
    };

    expect(
      toCompanionViewModel(snapshot),
    ).toMatchObject({
      mode: "companion",
      controller: "Agent",
      status: "active",
      observationCount: 12,
      evidenceCount: 3,
      canTakeControl: true,
      canReturnControl: false,
      canFinish: true,
    });
  });

  it("represents human ownership and return control", () => {
    const snapshot: CompanionSnapshot = {
      session: {
        ...baseSession,
        controller: "human",
      },
      observationCount: 2,
      evidenceCount: 1,
    };

    expect(
      toCompanionViewModel(snapshot),
    ).toMatchObject({
      controller: "You",
      canTakeControl: false,
      canReturnControl: true,
    });
  });

  it("surfaces the human-handoff reason", () => {
    const snapshot: CompanionSnapshot = {
      session: {
        ...baseSession,
        status: "awaiting_human",
        controller: null,
        handoff: {
          reason:
            "Please complete the sign-in step.",
          requestedAt:
            "2026-08-10T07:01:00.000Z",
        },
      },
      observationCount: 4,
      evidenceCount: 0,
    };

    expect(
      toCompanionViewModel(snapshot),
    ).toMatchObject({
      controller: "Waiting",
      status: "awaiting human",
      handoffReason:
        "Please complete the sign-in step.",
      canTakeControl: true,
    });
  });

  it("represents the absence of a session safely", () => {
    expect(
      toCompanionViewModel(null),
    ).toMatchObject({
      hasSession: false,
      controller: "None",
      observationCount: 0,
      evidenceCount: 0,
      canTakeControl: false,
      canReturnControl: false,
      canFinish: false,
    });
  });
});
