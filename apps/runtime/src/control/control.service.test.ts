import { describe, expect, it } from "vitest";
import type { Session } from "@rove/protocol";
import { ControlService } from "./control.service.js";

const session: Session = {
  id: "ses_test",
  mode: "companion",
  status: "active",
  controller: "human",
  profile: { mode: "temporary" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("ControlService", () => {
  it("rejects an agent mutation while the human owns control", () => {
    expect(() => new ControlService().assertCanMutate(session, "agent")).toThrowError(
      expect.objectContaining({ code: "CONTROL_NOT_OWNED" }),
    );
  });

  it("allows the active controller", () => {
    expect(() => new ControlService().assertCanMutate(session, "human")).not.toThrow();
  });
});
