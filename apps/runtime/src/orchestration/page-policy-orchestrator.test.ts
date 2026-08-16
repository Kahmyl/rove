import { describe, expect, it, vi } from "vitest";

import type {
  PagePerceptionAssessment,
  PagePolicyDecision,
  Session,
} from "@rove/protocol";

import { BrowserOwnershipFence } from "../control/browser-ownership-fence.js";
import { ControlWaitService } from "../control/control-wait.service.js";
import { ObservationService } from "../observation/observation.service.js";
import { SessionService } from "../session/session.service.js";
import { PagePolicyOrchestrator } from "./page-policy-orchestrator.js";

const authentication: PagePerceptionAssessment = {
  kind: "authentication_required",
  confidence: "high",
  signals: ["test:authentication"],
};

const verification: PagePerceptionAssessment = {
  kind: "human_verification",
  confidence: "high",
  signals: ["test:verification"],
};

const authenticationDecision: PagePolicyDecision = {
  disposition: "request_human",
  reason: "authentication_required",
  mutationAllowed: false,
  retryable: false,
  errorCode: "AUTHENTICATION_REQUIRED",
  message:
    "The page requires authentication that must be completed by a human.",
};

const verificationDecision: PagePolicyDecision = {
  disposition: "request_human",
  reason: "human_verification_required",
  mutationAllowed: false,
  retryable: false,
  errorCode: "HUMAN_VERIFICATION_REQUIRED",
  message: "The page requires a human verification step.",
};

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses_test",
    mode: "agent",
    status: "active",
    controller: "agent",
    ...overrides,
  } as Session;
}

function harness(initial: Session) {
  let current = initial;

  const ownershipFence = new BrowserOwnershipFence();
  ownershipFence.initialize(initial.id, initial.controller);

  const get = vi.fn(async () => current);

  const update = vi.fn(async (next: Session) => {
    current = next;
    return next;
  });

  const append = vi.fn(
    async (
      sessionId: string,
      input: {
        actor: string;
        type: string;
        data: unknown;
      },
    ) => ({
      seq: 1,
      sessionId,
      ...input,
    }),
  );

  const publish = vi.fn(async () => undefined);

  const orchestrator = new PagePolicyOrchestrator(
    {
      get,
      update,
    } as unknown as SessionService,
    {
      append,
    } as unknown as ObservationService,
    {
      publish,
    } as unknown as ControlWaitService,
    ownershipFence,
  );

  return {
    orchestrator,
    get,
    update,
    append,
    publish,
    ownershipFence,
    current: () => current,
  };
}

describe("PagePolicyOrchestrator", () => {
  it.each([
    {
      disposition: "continue",
      reason: "page_ready",
      mutationAllowed: true,
      retryable: false,
      message: "ready",
    },
    {
      disposition: "wait_and_inspect",
      reason: "page_unstable",
      mutationAllowed: false,
      retryable: true,
      errorCode: "PAGE_NOT_READY",
      message: "wait",
    },
    {
      disposition: "stop",
      reason: "access_restricted",
      mutationAllowed: false,
      retryable: false,
      errorCode: "SITE_ACCESS_RESTRICTED",
      message: "stop",
    },
  ] satisfies PagePolicyDecision[])(
    "$disposition never changes browser ownership",
    async (decision) => {
      const test = harness(makeSession());

      await test.orchestrator.orchestrate(
        "ses_test",
        decision,
        authentication,
        "session_start",
      );

      expect(test.get).not.toHaveBeenCalled();
      expect(test.update).not.toHaveBeenCalled();
      expect(test.append).not.toHaveBeenCalled();
      expect(test.publish).not.toHaveBeenCalled();
    },
  );

  it("requests human ownership for authentication from active agent control", async () => {
    const test = harness(makeSession());

    await test.orchestrator.orchestrate(
      "ses_test",
      authenticationDecision,
      authentication,
      "session_start",
    );

    expect(test.current()).toMatchObject({
      status: "awaiting_human",
      controller: null,
      handoff: {
        reason:
          "The page requires authentication that must be completed by a human.",
      },
    });

    expect(test.append).toHaveBeenCalledWith(
      "ses_test",
      expect.objectContaining({
        actor: "system",
        type: "authentication_required",
        data: authentication,
      }),
    );

    expect(test.publish).toHaveBeenCalledTimes(1);

    try {
      test.ownershipFence.acquire("ses_test", "agent");
      throw new Error("Expected agent admission to be closed.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "CONTROL_NOT_OWNED",
      });
    }
  });

  it("requests human ownership for human verification", async () => {
    const test = harness(makeSession());

    await test.orchestrator.orchestrate(
      "ses_test",
      verificationDecision,
      verification,
      "post_action",
    );

    expect(test.current()).toMatchObject({
      status: "awaiting_human",
      controller: null,
    });

    expect(test.append).toHaveBeenCalledWith(
      "ses_test",
      expect.objectContaining({
        type: "human_verification_required",
        data: verification,
      }),
    );
  });

  it("does nothing when a human already owns the browser", async () => {
    const test = harness(
      makeSession({
        mode: "capture",
        controller: "human",
      }),
    );

    await test.orchestrator.orchestrate(
      "ses_test",
      authenticationDecision,
      authentication,
      "session_start",
    );

    expect(test.update).not.toHaveBeenCalled();
    expect(test.append).not.toHaveBeenCalled();
    expect(test.publish).not.toHaveBeenCalled();
    expect(test.current().controller).toBe("human");
  });

  it("is idempotent when a human handoff is already pending", async () => {
    const test = harness(
      makeSession({
        status: "awaiting_human",
        controller: null,
        handoff: {
          reason: "Existing handoff",
          requestedAt: "2026-08-16T00:00:00.000Z",
        },
      }),
    );

    await test.orchestrator.orchestrate(
      "ses_test",
      authenticationDecision,
      authentication,
      "post_action",
    );

    expect(test.update).not.toHaveBeenCalled();
    expect(test.append).not.toHaveBeenCalled();
    expect(test.publish).not.toHaveBeenCalled();
  });
});
