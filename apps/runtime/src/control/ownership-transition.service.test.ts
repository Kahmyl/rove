import { describe, expect, it, vi } from "vitest";

import type { PagePerceptionAssessment, Session } from "@rove/protocol";

import { BrowserService } from "../browser/browser.service.js";
import { ObservationService } from "../observation/observation.service.js";
import { InteractionPolicy } from "../policy/interaction-policy.js";
import { SessionService } from "../session/session.service.js";
import { BrowserOwnershipFence } from "./browser-ownership-fence.js";
import { ControlService } from "./control.service.js";
import { ControlWaitService } from "./control-wait.service.js";
import { OwnershipTransitionService } from "./ownership-transition.service.js";

const ready: PagePerceptionAssessment = {
  kind: "ready",
  confidence: "high",
  signals: ["test:ready"],
};

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses_test",
    mode: "agent",
    status: "active",
    controller: "agent",
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  } as Session;
}

function expectControlNotOwned(operation: () => unknown): void {
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    return;
  }

  throw new Error("Expected CONTROL_NOT_OWNED.");
}

function harness(initial: Session) {
  let current = initial;
  let seq = 0;

  const get = vi.fn(async () => current);

  const update = vi.fn(async (next: Session) => {
    current = {
      ...next,
      updatedAt: "2026-08-16T00:00:01.000Z",
    };

    return current;
  });

  const end = vi.fn(async () => {
    current = {
      ...current,
      status: "completed",
      controller: null,
      endedAt: "2026-08-16T00:00:02.000Z",
      updatedAt: "2026-08-16T00:00:02.000Z",
    };

    delete current.handoff;

    return current;
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
      seq: ++seq,
      sessionId,
      ...input,
    }),
  );

  const publish = vi.fn(async () => undefined);

  const pages = vi.fn(async () => [
    {
      id: "page_02",
      url: "https://example.test/",
      title: "Example",
      active: true,
      revision: 7,
    },
  ]);

  const invalidateAllTargets = vi.fn(async () => 2);

  const close = vi.fn(async () => undefined);

  const browserSession = {
    pages,
    invalidateAllTargets,
  };

  const browser = {
    get: vi.fn(() => browserSession),
    close,
  } as unknown as BrowserService;

  const sessions = {
    get,
    update,
    end,
  } as unknown as SessionService;

  const observations = {
    append,
  } as unknown as ObservationService;

  const controlWait = {
    publish,
  } as unknown as ControlWaitService;

  const ownershipFence = new BrowserOwnershipFence();

  ownershipFence.initialize(initial.id, initial.controller);

  const interactionPolicy = new InteractionPolicy();

  const service = new OwnershipTransitionService(
    sessions,
    new ControlService(),
    controlWait,
    browser,
    observations,
    ownershipFence,
    interactionPolicy,
  );

  return {
    service,
    ownershipFence,
    interactionPolicy,
    get,
    update,
    end,
    append,
    publish,
    pages,
    invalidateAllTargets,
    close,
    current: () => current,
  };
}

describe("OwnershipTransitionService", () => {
  it("uses one safe transition for explicit request-human", async () => {
    const test = harness(makeSession());

    const result = await test.service.requestHuman(
      "ses_test",
      "Need human input",
    );

    expect(result).toMatchObject({
      status: "awaiting_human",
      controller: null,
      handoff: {
        reason: "Need human input",
      },
    });

    expectControlNotOwned(() =>
      test.ownershipFence.acquire("ses_test", "agent"),
    );

    expect(test.append).toHaveBeenCalledWith(
      "ses_test",
      expect.objectContaining({
        actor: "agent",
        type: "human_requested",
      }),
    );

    expect(test.publish).toHaveBeenCalledTimes(1);
  });

  it("routes automatic F2 handoff through the same awaiting-human transition and remains idempotent", async () => {
    const test = harness(makeSession());

    await test.service.requestHumanForPolicy("ses_test", {
      reason: "Authentication required",
      observationType: "authentication_required",
      pageState: ready,
    });

    await test.service.requestHumanForPolicy("ses_test", {
      reason: "Authentication required again",
      observationType: "authentication_required",
      pageState: ready,
    });

    expect(test.current()).toMatchObject({
      status: "awaiting_human",
      controller: null,
      handoff: {
        reason: "Authentication required",
      },
    });

    expect(test.update).toHaveBeenCalledTimes(1);

    expect(test.append).toHaveBeenCalledTimes(1);

    expect(test.append).toHaveBeenCalledWith(
      "ses_test",
      expect.objectContaining({
        actor: "system",
        type: "authentication_required",
        data: ready,
      }),
    );
  });

  it("supports voluntary Companion takeover through the centralized fence", async () => {
    const test = harness(
      makeSession({
        mode: "companion",
      }),
    );

    const result = await test.service.takeHuman("ses_test");

    expect(result).toMatchObject({
      status: "active",
      controller: "human",
    });

    const lease = test.ownershipFence.acquire("ses_test", "human");

    expect(lease.token.actor).toBe("human");

    lease.release();

    expect(test.append).toHaveBeenCalledWith(
      "ses_test",
      expect.objectContaining({
        type: "human_took_control",
      }),
    );
  });

  it("keeps agent admission closed until handback invalidates browser targets and inspection knowledge", async () => {
    const test = harness(
      makeSession({
        mode: "companion",
        controller: "human",
        handoff: {
          reason: "Edit the page",
          requestedAt: "2026-08-16T00:00:00.000Z",
        },
      }),
    );

    const requireInspection = vi.spyOn(
      test.interactionPolicy,
      "requireInspection",
    );

    const flushHumanActivity = vi.fn(async () => undefined);

    const result = await test.service.returnAgent(
      "ses_test",
      flushHumanActivity,
    );

    expect(flushHumanActivity).toHaveBeenCalledTimes(1);

    expect(test.pages).toHaveBeenCalledTimes(1);

    expect(test.invalidateAllTargets).toHaveBeenCalledTimes(1);

    expect(requireInspection).toHaveBeenCalledWith("ses_test");

    expect(result).toMatchObject({
      status: "active",
      controller: "agent",
    });

    expect(result.handoff).toBeUndefined();

    const lease = test.ownershipFence.acquire("ses_test", "agent");

    lease.release();

    expect(test.append).toHaveBeenCalledWith(
      "ses_test",
      expect.objectContaining({
        type: "human_returned_control",
      }),
    );
  });

  it("drains obsolete browser work before terminal shutdown", async () => {
    const test = harness(makeSession());

    const lease = test.ownershipFence.acquire("ses_test", "agent");

    let transitionStartedResolve!: () => void;

    const transitionStarted = new Promise<void>((resolve) => {
      transitionStartedResolve = resolve;
    });

    const originalBeginTransition = test.ownershipFence.beginTransition.bind(
      test.ownershipFence,
    );

    test.ownershipFence.beginTransition = (sessionId) => {
      const transition = originalBeginTransition(sessionId);

      transitionStartedResolve();

      return transition;
    };

    const hooks = {
      flushHumanActivity: vi.fn(async () => undefined),
      flushBrowserEvidence: vi.fn(async () => undefined),
      clearRuntimeState: vi.fn(),
      releaseProfileLock: vi.fn(async () => undefined),
    };

    const ending = test.service.endSession("ses_test", hooks);

    await transitionStarted;

    expect(test.close).not.toHaveBeenCalled();

    lease.release();

    const ended = await ending;

    expect(hooks.flushHumanActivity).toHaveBeenCalledTimes(1);

    expect(hooks.flushBrowserEvidence).toHaveBeenCalledTimes(1);

    expect(hooks.clearRuntimeState).toHaveBeenCalledTimes(1);

    expect(hooks.releaseProfileLock).toHaveBeenCalledTimes(1);

    expect(test.close).toHaveBeenCalledTimes(1);

    expect(ended).toMatchObject({
      status: "completed",
      controller: null,
    });

    expect(() => test.ownershipFence.acquire("ses_test", "agent")).toThrow();
  });
});
