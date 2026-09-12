import type { Session } from "@rove/protocol";

import { describe, expect, it } from "vitest";

import { toUnifiedSessionViewModel } from "./unified-session-state.js";

const base: Session = {
  id: "ses_unified",
  mode: "agent",
  status: "active",
  controller: "agent",
  profile: { mode: "temporary" },
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
};

describe("Experiment C: canonical session semantics", () => {
  it.each([
    {
      label: "no session",
      session: null,
      experience: "no_session",
      action: null,
    },
    {
      label: "agent working",
      session: base,
      experience: "agent_working",
      action: null,
    },
    {
      label: "companion takeover",
      session: { ...base, mode: "companion" as const },
      experience: "agent_working",
      action: "take_control",
    },
    {
      label: "human handoff",
      session: {
        ...base,
        status: "awaiting_human" as const,
        controller: null,
        handoff: {
          reason: "Complete sign in.",
          requestedAt: "2026-09-07T00:01:00.000Z",
        },
      },
      experience: "handoff_waiting",
      action: "take_control",
    },
    {
      label: "human controlling",
      session: { ...base, controller: "human" as const },
      experience: "human_controlling",
      action: "return_control",
    },
    {
      label: "paused",
      session: {
        ...base,
        status: "paused" as const,
        controller: null,
      },
      experience: "paused",
      action: "resume",
    },
    {
      label: "capture",
      session: {
        ...base,
        mode: "capture" as const,
        controller: "human" as const,
      },
      experience: "capture",
      action: "finish_capture",
    },
    {
      label: "completed",
      session: {
        ...base,
        status: "completed" as const,
        controller: null,
      },
      experience: "session_ended",
      action: null,
    },
  ])("derives $label once for every presentation", (item) => {
    expect(toUnifiedSessionViewModel(item.session)).toMatchObject({
      experience: item.experience,
      primaryAction: item.action,
    });
  });

  it("preserves the handoff instruction as the primary description", () => {
    expect(
      toUnifiedSessionViewModel({
        ...base,
        controller: "human",
        handoff: {
          reason: "Approve the security key prompt.",
          requestedAt: "2026-09-07T00:01:00.000Z",
        },
      }),
    ).toMatchObject({
      title: "You're handling this step",
      description: "Approve the security key prompt.",
      primaryAction: "return_control",
    });
  });
});
