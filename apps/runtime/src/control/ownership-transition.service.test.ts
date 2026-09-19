import { describe, expect, it, vi } from "vitest";

import type {
  ControlMutationAuthority,
  PagePerceptionAssessment,
  Session,
} from "@rove/protocol";

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
    ownershipGeneration: 1,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  } as Session;
}

function controlAuthority(session: Session): ControlMutationAuthority {
  return {
    ownershipGeneration: session.ownershipGeneration!,
    ...(session.activeHandoffId === undefined
      ? {}
      : {
          handoffId: session.activeHandoffId,
          handoffGeneration: session.activeHandoffGeneration!,
        }),
  };
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
  const beginHumanControl = vi.fn(async () => undefined);
  const abortHumanControl = vi.fn(async () => undefined);
  const endHumanControl = vi.fn();

  const browserSession = {
    pages,
    invalidateAllTargets,
  };

  const browser = {
    get: vi.fn(() => browserSession),
    close,
    beginHumanControl,
    abortHumanControl,
    prepareHumanControlReturn: invalidateAllTargets,
    endHumanControl,
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

  ownershipFence.initialize(
    initial.id,
    initial.controller,
    initial.ownershipGeneration ?? 1,
  );

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
    beginHumanControl,
    abortHumanControl,
    endHumanControl,
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

  it("records Companion durability only for the exact active handoff", async () => {
    const test = harness(makeSession());
    const requested = await test.service.requestHuman("ses_test", "Sign in");

    await expect(
      test.service.acknowledgeDurableHandoff("ses_test", {
        handoffId: "handoff_other",
        handoffGeneration: requested.activeHandoffGeneration!,
      }),
    ).rejects.toMatchObject({ code: "CONTROL_NOT_OWNED" });

    await expect(
      test.service.acknowledgeDurableHandoff("ses_test", {
        handoffId: requested.activeHandoffId!,
        handoffGeneration: requested.activeHandoffGeneration!,
      }),
    ).resolves.toMatchObject({
      durableHandoffId: requested.activeHandoffId,
      durableHandoffGeneration: requested.activeHandoffGeneration,
    });
    expect(test.current()).toMatchObject({
      durableHandoffId: requested.activeHandoffId,
      durableHandoffGeneration: requested.activeHandoffGeneration,
    });
  });

  it("persists one stable handoff identity and every ownership generation across restart cuts", async () => {
    const requested = harness(makeSession({ ownershipGeneration: 7 }));
    const awaiting = await requested.service.requestHuman(
      "ses_test",
      "Sign in",
    );
    expect(awaiting).toMatchObject({
      generation: 8,
      activeHandoffId: expect.stringMatching(/^handoff_/),
      activeHandoffGeneration: 8,
    });
    expect(requested.current()).toMatchObject({
      ownershipGeneration: 8,
      activeHandoffGeneration: 8,
    });

    const afterRequestRestart = harness(requested.current());
    const human = await afterRequestRestart.service.takeHuman(
      "ses_test",
      controlAuthority(afterRequestRestart.current()),
    );
    expect(human).toMatchObject({
      generation: 9,
      activeHandoffId: awaiting.activeHandoffId,
      activeHandoffGeneration: 8,
    });
    expect(afterRequestRestart.current()).toMatchObject({
      ownershipGeneration: 9,
      activeHandoffId: awaiting.activeHandoffId,
      activeHandoffGeneration: 8,
    });

    const afterTakeRestart = harness(afterRequestRestart.current());
    const returned = await afterTakeRestart.service.returnAgent(
      "ses_test",
      async () => undefined,
      controlAuthority(afterTakeRestart.current()),
    );
    expect(returned).toMatchObject({
      generation: 10,
      lastReturnedHandoffId: awaiting.activeHandoffId,
    });
    expect(afterTakeRestart.current()).toMatchObject({
      ownershipGeneration: 10,
      lastReturnedHandoffId: awaiting.activeHandoffId,
    });
    expect(afterTakeRestart.current().activeHandoffId).toBeUndefined();
    expect(afterTakeRestart.current().activeHandoffGeneration).toBeUndefined();

    const postReturnRestart = new BrowserOwnershipFence();
    expect(
      postReturnRestart.initialize(
        "ses_test",
        "agent",
        afterTakeRestart.current().ownershipGeneration,
      ),
    ).toBe(10);
  });

  it("rejects stale or mismatched control identities before mutating the owned browser", async () => {
    const test = harness(makeSession({ ownershipGeneration: 7 }));
    const awaiting = await test.service.requestHuman("ses_test", "Sign in");
    const authority = {
      ownershipGeneration: awaiting.generation,
      handoffId: awaiting.activeHandoffId!,
      handoffGeneration: awaiting.activeHandoffGeneration!,
    };

    await expect(
      test.service.takeHuman("ses_test", {
        ...authority,
        handoffGeneration: authority.handoffGeneration + 1,
      }),
    ).rejects.toMatchObject({ code: "CONTROL_NOT_OWNED" });
    await expect(
      test.service.takeHuman("ses_test", {
        ...authority,
        handoffId: `handoff_${"f".repeat(32)}`,
      }),
    ).rejects.toMatchObject({ code: "CONTROL_NOT_OWNED" });
    await expect(
      test.service.takeHuman("ses_test", {
        ...authority,
        ownershipGeneration: authority.ownershipGeneration - 1,
      }),
    ).rejects.toMatchObject({ code: "CONTROL_NOT_OWNED" });

    expect(test.beginHumanControl).not.toHaveBeenCalled();
    expect(test.update).toHaveBeenCalledTimes(1);

    await expect(
      test.service.takeHuman("ses_test", authority),
    ).resolves.toMatchObject({
      controller: "human",
      activeHandoffId: authority.handoffId,
    });
    expect(test.beginHumanControl).toHaveBeenCalledTimes(1);
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
    const explicit = await test.service.requestHuman(
      "ses_test",
      "Sign in, then return control.",
    );

    expect(test.current()).toMatchObject({
      status: "awaiting_human",
      controller: null,
      handoff: {
        reason: "Authentication required",
      },
    });
    expect(explicit).toMatchObject({
      status: "awaiting_human",
      controller: null,
      activeHandoffId: test.current().activeHandoffId,
      activeHandoffGeneration: test.current().activeHandoffGeneration,
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

    const result = await test.service.takeHuman(
      "ses_test",
      controlAuthority(test.current()),
    );

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
      controlAuthority(test.current()),
    );

    expect(flushHumanActivity).toHaveBeenCalledTimes(1);

    expect(test.pages).toHaveBeenCalledTimes(1);

    expect(test.invalidateAllTargets).toHaveBeenCalledTimes(1);

    expect(test.endHumanControl).toHaveBeenCalledTimes(1);
    expect(test.invalidateAllTargets.mock.invocationCallOrder[0]).toBeLessThan(
      test.endHumanControl.mock.invocationCallOrder[0]!,
    );

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

  it("pauses only after draining agent authority and resumes through fresh target invalidation", async () => {
    const test = harness(makeSession({ mode: "companion" }));
    const lease = test.ownershipFence.acquire("ses_test", "agent");
    const pausing = test.service.pauseAgent(
      "ses_test",
      controlAuthority(test.current()),
    );

    await Promise.resolve();
    expect(test.update).not.toHaveBeenCalled();

    lease.release();
    const paused = await pausing;

    expect(paused).toMatchObject({ status: "paused", controller: null });
    expectControlNotOwned(() =>
      test.ownershipFence.acquire("ses_test", "agent"),
    );
    expect(test.append).toHaveBeenCalledWith(
      "ses_test",
      expect.objectContaining({ actor: "human", type: "session_paused" }),
    );

    const resumed = await test.service.returnAgent(
      "ses_test",
      async () => undefined,
      controlAuthority(test.current()),
    );
    expect(resumed).toMatchObject({ status: "active", controller: "agent" });
    expect(test.invalidateAllTargets).toHaveBeenCalledTimes(1);
    test.ownershipFence.acquire("ses_test", "agent").release();
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
