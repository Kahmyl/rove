import { describe, expect, it } from "vitest";

import type { Session } from "@rove/protocol";

import { toTrayStatusLabel } from "./tray-state.js";

const base: Session = {
  id: "ses_test",
  mode: "agent",
  status: "active",
  controller: "agent",
  profile: {
    mode: "temporary",
  },
  createdAt: "2026-08-10T22:00:00.000Z",
  updatedAt: "2026-08-10T22:00:00.000Z",
};

describe("toTrayStatusLabel", () => {
  it("reports ready without a session", () => {
    expect(toTrayStatusLabel(null)).toBe("Ready");
  });

  it("reports agent work", () => {
    expect(toTrayStatusLabel(base)).toBe("Agent working");
  });

  it("prioritizes requested handoff", () => {
    expect(
      toTrayStatusLabel({
        ...base,
        status: "awaiting_human",
        controller: null,
        handoff: {
          reason: "Complete sign in.",
          requestedAt: "2026-08-10T22:01:00.000Z",
        },
      }),
    ).toBe("Your turn");
  });

  it("reports Capture mode", () => {
    expect(
      toTrayStatusLabel({
        ...base,
        mode: "capture",
        controller: "human",
      }),
    ).toBe("Capture mode");
  });

  it("reports voluntary human control", () => {
    expect(
      toTrayStatusLabel({
        ...base,
        mode: "companion",
        controller: "human",
      }),
    ).toBe("You're in control");
  });
});
