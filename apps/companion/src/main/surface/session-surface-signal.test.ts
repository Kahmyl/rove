import { describe, expect, it } from "vitest";

import type { Session } from "@rove/protocol";

import { toCompanionSurfaceSignal } from "./session-surface-signal.js";

const base: Session = {
  id: "ses_test",
  mode: "agent",
  status: "active",
  controller: "agent",
  profile: {
    mode: "temporary",
  },
  createdAt: "2026-08-10T20:00:00.000Z",
  updatedAt: "2026-08-10T20:00:00.000Z",
};

describe("toCompanionSurfaceSignal", () => {
  it("requests attention for a human handoff", () => {
    const session: Session = {
      ...base,
      status: "awaiting_human",
      controller: null,
      handoff: {
        reason: "Complete sign in.",
        requestedAt: "2026-08-10T20:01:00.000Z",
      },
    };

    expect(toCompanionSurfaceSignal(session)).toEqual({
      key: "handoff:ses_test:2026-08-10T20:01:00.000Z",
      action: "attention",
    });
  });

  it("shows Companion when Capture begins", () => {
    const session: Session = {
      ...base,
      id: "ses_capture",
      mode: "capture",
      controller: "human",
    };

    expect(toCompanionSurfaceSignal(session)).toEqual({
      key: "capture:ses_capture",
      action: "show",
    });
  });

  it("does not interrupt normal agent work", () => {
    expect(toCompanionSurfaceSignal(base)).toBeNull();
  });
});
