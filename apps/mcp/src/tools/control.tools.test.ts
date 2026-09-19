import { describe, expect, it, vi } from "vitest";

import type { ControlStatus } from "@rove/protocol";
import type { RuntimeClient } from "../runtime/runtime-client.types.js";
import { controlTools } from "./control.tools.js";

function awaitingStatus(
  handoffId = "handoff_exact",
  handoffGeneration = 8,
  durable = false,
): ControlStatus {
  return {
    sessionId: "ses_1",
    generation: handoffGeneration,
    status: "awaiting_human",
    controller: null,
    activeHandoffId: handoffId,
    activeHandoffGeneration: handoffGeneration,
    ...(durable
      ? {
          durableHandoffId: handoffId,
          durableHandoffGeneration: handoffGeneration,
        }
      : {}),
    observationSeq: 40,
    updatedAt: "2026-09-19T00:00:00.000Z",
    handoff: {
      reason: "Sign in",
      requestedAt: "2026-09-19T00:00:00.000Z",
    },
  };
}

function definitions(runtime: Partial<RuntimeClient>) {
  const tools = controlTools(runtime as RuntimeClient);
  return {
    requestHuman: tools.find((tool) => tool.name === "control.request_human")!,
    wait: tools.find((tool) => tool.name === "control.wait")!,
  };
}

const requestInput = {
  sessionId: "ses_1",
  reason: "Sign in",
  instruction: "Inspect the signed-in page and continue.",
  continuationPolicy: "resume_after_control_return",
};

describe("control handoff tools", () => {
  it("refuses to wait for an automatic handoff without an explicit durable request", async () => {
    const status = awaitingStatus();
    const waitForControl = vi.fn();
    const tools = definitions({
      getControlStatus: vi.fn(async () => status),
      waitForControl,
    });

    await expect(tools.wait.handler({ sessionId: "ses_1" })).rejects.toThrow(
      /Companion durable acknowledgement/,
    );
    expect(waitForControl).not.toHaveBeenCalled();
  });

  it("waits only after control.request_human records the exact active handoff", async () => {
    const status = awaitingStatus();
    const waitResult = { event: "human_requested", status };
    const requestHuman = vi.fn(async () => status);
    const getControlStatus = vi.fn(async () =>
      awaitingStatus(undefined, undefined, true),
    );
    const waitForControl = vi.fn(async () => waitResult as never);
    const tools = definitions({
      requestHuman,
      getControlStatus,
      waitForControl,
    });

    await expect(tools.requestHuman.handler(requestInput)).resolves.toEqual(
      status,
    );
    await expect(
      tools.wait.handler({ sessionId: "ses_1", afterSeq: 40, timeoutMs: 1 }),
    ).resolves.toEqual(waitResult);
    await expect(
      tools.wait.handler({ sessionId: "ses_1", afterSeq: 40, timeoutMs: 1 }),
    ).resolves.toEqual(waitResult);
    expect(requestHuman).toHaveBeenCalledWith("ses_1", "Sign in");
    expect(getControlStatus).toHaveBeenCalledTimes(2);
    expect(waitForControl).toHaveBeenCalledTimes(2);
    expect(waitForControl).toHaveBeenLastCalledWith(
      "ses_1",
      { afterSeq: 40, timeoutMs: 1 },
      undefined,
    );
  });

  it("returns a bounded retry state until Companion acknowledges durability", async () => {
    const status = awaitingStatus();
    const waitForControl = vi.fn();
    const tools = definitions({
      requestHuman: vi.fn(async () => status),
      getControlStatus: vi.fn(async () => status),
      waitForControl,
    });

    await tools.requestHuman.handler(requestInput);
    await expect(tools.wait.handler({ sessionId: "ses_1" })).rejects.toThrow(
      /durable acknowledgement.*bounded reconciliation/,
    );
    expect(waitForControl).not.toHaveBeenCalled();
  });

  it("refuses to wait when Runtime moves to a different handoff identity", async () => {
    const requestHuman = vi.fn(async () => awaitingStatus());
    const waitForControl = vi.fn();
    const tools = definitions({
      requestHuman,
      getControlStatus: vi.fn(async () => awaitingStatus("handoff_other", 9)),
      waitForControl,
    });

    await tools.requestHuman.handler(requestInput);
    await expect(tools.wait.handler({ sessionId: "ses_1" })).rejects.toThrow(
      /durable acknowledgement/,
    );
    expect(waitForControl).not.toHaveBeenCalled();
  });

  it("still observes the exact handoff when the human takes control before wait starts", async () => {
    const requested = awaitingStatus();
    const humanOwned: ControlStatus = {
      ...requested,
      durableHandoffId: requested.activeHandoffId,
      durableHandoffGeneration: requested.activeHandoffGeneration,
      status: "active",
      controller: "human",
      generation: 9,
      observationSeq: 41,
    };
    const waitResult = {
      event: "human_took_control",
      sessionId: "ses_1",
      status: "active",
      controller: "human",
      observationSeq: 41,
    };
    const waitForControl = vi.fn(async () => waitResult as never);
    const tools = definitions({
      requestHuman: vi.fn(async () => requested),
      getControlStatus: vi.fn(async () => humanOwned),
      waitForControl,
    });

    await tools.requestHuman.handler(requestInput);
    await expect(tools.wait.handler({ sessionId: "ses_1" })).resolves.toEqual(
      waitResult,
    );
    expect(waitForControl).toHaveBeenCalledOnce();
  });

  it("does not authorize waits from an incomplete request-human identity", async () => {
    const requestHuman = vi.fn(async () => ({
      ...awaitingStatus(),
      activeHandoffGeneration: undefined,
    }));
    const waitForControl = vi.fn();
    const tools = definitions({
      requestHuman,
      getControlStatus: vi.fn(async () => awaitingStatus()),
      waitForControl,
    });

    await expect(tools.requestHuman.handler(requestInput)).rejects.toThrow(
      /did not return an exact active handoff identity/,
    );
    await expect(tools.wait.handler({ sessionId: "ses_1" })).rejects.toThrow(
      /successful control\.request_human/,
    );
    expect(waitForControl).not.toHaveBeenCalled();
  });
});
