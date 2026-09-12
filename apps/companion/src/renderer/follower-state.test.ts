import type { Session } from "@rove/protocol";

import { describe, expect, it } from "vitest";

import { toCompactFollowerViewModel } from "./follower-state.js";

const base: Session = {
  id: "ses_follow",
  mode: "agent",
  status: "active",
  controller: "agent",
  profile: {
    mode: "temporary",
  },
  createdAt: "2026-09-05T16:00:00.000Z",
  updatedAt: "2026-09-05T16:00:00.000Z",
};

describe("toCompactFollowerViewModel", () => {
  it("keeps ordinary Agent Mode observational", () => {
    expect(toCompactFollowerViewModel(base)).toMatchObject({
      experience: "agent_working",
      kicker: "Agent working",
      primaryAction: null,
    });
  });

  it("allows voluntary Companion Mode takeover", () => {
    expect(
      toCompactFollowerViewModel({
        ...base,
        mode: "companion",
      }),
    ).toMatchObject({
      experience: "agent_working",
      primaryAction: "take_control",
      primaryActionLabel: "Take over",
    });
  });

  it("offers requested Agent Mode handoff authority", () => {
    expect(
      toCompactFollowerViewModel({
        ...base,
        status: "awaiting_human",
        controller: null,
        handoff: {
          reason: "Complete sign in.",
          requestedAt: "2026-09-05T16:01:00.000Z",
        },
      }),
    ).toMatchObject({
      experience: "human_required",
      kicker: "Your turn",
      primaryAction: "take_control",
    });
  });

  it("offers handback while the human owns the browser", () => {
    expect(
      toCompactFollowerViewModel({
        ...base,
        controller: "human",
      }),
    ).toMatchObject({
      experience: "human_controlling",
      primaryAction: "return_control",
      primaryActionLabel: "Resume Automation",
    });
  });

  it("represents a fenced pause with an explicit resume action", () => {
    expect(
      toCompactFollowerViewModel({
        ...base,
        status: "paused",
        controller: null,
      }),
    ).toMatchObject({
      experience: "paused",
      primaryAction: "return_control",
      primaryActionLabel: "Resume",
      canPause: false,
      canStop: true,
    });
  });

  it("represents terminal sessions as ready for review", () => {
    expect(
      toCompactFollowerViewModel({
        ...base,
        status: "completed",
        controller: null,
      }),
    ).toMatchObject({
      experience: "ready_for_review",
      kicker: "Ready for review",
      canStop: false,
    });
  });

  it("does not turn Capture into follower control authority", () => {
    expect(
      toCompactFollowerViewModel({
        ...base,
        mode: "capture",
        controller: "human",
      }),
    ).toMatchObject({
      experience: "capture",
      primaryAction: null,
    });
  });

  it("represents no live session without inventing control authority", () => {
    expect(toCompactFollowerViewModel(null)).toEqual({
      experience: "ready",
      kicker: "Ready",
      title: "Waiting for a session",
      primaryAction: null,
      description: "Rove will appear beside its browser when a session starts.",
      canPause: false,
      canStop: false,
    });
  });
});
