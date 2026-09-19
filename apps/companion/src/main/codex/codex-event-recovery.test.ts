import { describe, expect, it } from "vitest";

import { classifyCodexEventRecovery } from "./codex-event-recovery.js";
import type { CodexServerEvent } from "./protocol.js";

function classified(event: CodexServerEvent) {
  return classifyCodexEventRecovery(event, 7);
}

describe("Codex event recovery classification", () => {
  it("uses event semantics instead of top-level request identity", () => {
    expect(
      classified({
        method: "item/completed",
        params: { threadId: "thread_a", turnId: "turn_a", itemId: "item_a" },
      }),
    ).toMatchObject({
      recoveryClass: "thread_history_reconstructible",
      family: "item/completed",
      threadId: "thread_a",
      blockerId: expect.any(String),
    });
    const request = classified({
      method: "item/fileChange/requestApproval",
      requestId: "connection:server:number:41",
      wireRequestId: 41,
      params: { threadId: "thread_a", itemId: "item_a" },
    });
    const resolution = classified({
      method: "serverRequest/resolved",
      params: { threadId: "thread_a", requestId: 41 },
    });
    expect(request).toMatchObject({
      recoveryClass: "live_attention",
      correlationId: "7:number:41",
    });
    expect(resolution).toMatchObject({
      recoveryClass: "live_attention",
      correlationId: "7:number:41",
      blockerId: request.blockerId,
    });
  });

  it("separates provider membership and expendable presentation", () => {
    expect(
      classified({
        method: "thread/archived",
        params: { threadId: "thread_a" },
      }),
    ).toMatchObject({
      recoveryClass: "provider_other_authority",
      family: "thread_archive_membership",
      blockerId: expect.any(String),
    });
    for (const method of [
      "item/agentMessage/delta",
      "item/commandExecution/outputDelta",
      "item/mcpToolCall/progress",
      "turn/plan/updated",
    ] as const)
      expect(
        classified({ method, params: { threadId: "thread_a" } }),
      ).toMatchObject({ recoveryClass: "expendable_presentation" });
  });
});
