import { describe, expect, it } from "vitest";
import {
  BrowserOwnershipFence,
  type BrowserOwnershipLease,
} from "./browser-ownership-fence.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function expectControlNotOwned(operation: () => unknown): void {
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({ code: "CONTROL_NOT_OWNED" });
    return;
  }

  throw new Error("Expected CONTROL_NOT_OWNED.");
}

describe("BrowserOwnershipFence", () => {
  it("admits agent work under the initialized ownership generation", () => {
    const fence = new BrowserOwnershipFence();

    expect(fence.initialize("ses_one", "agent")).toBe(1);

    const lease = fence.acquire("ses_one", "agent");

    expect(lease.token).toEqual({
      sessionId: "ses_one",
      actor: "agent",
      generation: 1,
    });
    expect(() => lease.assertCurrent()).not.toThrow();

    lease.release();
  });

  it("rejects work from the wrong owner", () => {
    const fence = new BrowserOwnershipFence();
    fence.initialize("ses_one", "agent");

    expectControlNotOwned(() => fence.acquire("ses_one", "human"));
  });

  it("advances generation once for each actual transition", async () => {
    const fence = new BrowserOwnershipFence();
    fence.initialize("ses_one", "agent");

    const toHuman = fence.beginTransition("ses_one");
    expect(toHuman.generation).toBe(2);
    await toHuman.waitForDrain();
    fence.completeTransition(toHuman, "human");

    const humanLease = fence.acquire("ses_one", "human");
    expect(humanLease.token.generation).toBe(2);
    humanLease.release();

    const toAgent = fence.beginTransition("ses_one");
    expect(toAgent.generation).toBe(3);
    await toAgent.waitForDrain();
    fence.completeTransition(toAgent, "agent");

    const agentLease = fence.acquire("ses_one", "agent");
    expect(agentLease.token.generation).toBe(3);
    agentLease.release();
  });

  it("keeps repeated beginTransition calls in one transition generation", async () => {
    const fence = new BrowserOwnershipFence();
    fence.initialize("ses_one", "agent");

    const first = fence.beginTransition("ses_one");
    const repeated = fence.beginTransition("ses_one");

    expect(first.generation).toBe(2);
    expect(repeated.generation).toBe(first.generation);

    await repeated.waitForDrain();
    fence.completeTransition(repeated, null);
  });

  it("rejects a lease as stale as soon as transition fencing begins", async () => {
    const fence = new BrowserOwnershipFence();
    fence.initialize("ses_one", "agent");

    const lease = fence.acquire("ses_one", "agent");
    const transition = fence.beginTransition("ses_one");

    expectControlNotOwned(() => lease.assertCurrent());

    lease.release();
    await transition.waitForDrain();
    fence.completeTransition(transition, null);
  });

  it("allows multiple stable reads and drains only after the final lease releases", async () => {
    const fence = new BrowserOwnershipFence();
    fence.initialize("ses_one", "agent");

    const first = fence.acquire("ses_one", "agent");
    const second = fence.acquire("ses_one", "agent");

    expect(() => first.assertCurrent()).not.toThrow();
    expect(() => second.assertCurrent()).not.toThrow();

    const transition = fence.beginTransition("ses_one");
    const drained = deferred<void>();

    void transition.waitForDrain().then(
      () => drained.resolve(),
      (error) => drained.reject(error),
    );

    let drainResolved = false;
    void drained.promise.then(() => {
      drainResolved = true;
    });

    await Promise.resolve();
    expect(drainResolved).toBe(false);

    first.release();
    await Promise.resolve();
    expect(drainResolved).toBe(false);

    second.release();
    await drained.promise;
    expect(drainResolved).toBe(true);

    fence.completeTransition(transition, "human");
  });

  it("blocks new admission immediately when a transition starts", async () => {
    const fence = new BrowserOwnershipFence();
    fence.initialize("ses_one", "agent");

    const transition = fence.beginTransition("ses_one");

    expectControlNotOwned(() => fence.acquire("ses_one", "agent"));
    expectControlNotOwned(() => fence.acquire("ses_one", "human"));

    await transition.waitForDrain();
    fence.completeTransition(transition, "human");

    const humanLease = fence.acquire("ses_one", "human");
    humanLease.release();
  });

  it("refuses to complete a transition before active work drains", async () => {
    const fence = new BrowserOwnershipFence();
    fence.initialize("ses_one", "agent");

    const lease = fence.acquire("ses_one", "agent");
    const transition = fence.beginTransition("ses_one");

    expect(() => fence.completeTransition(transition, "human")).toThrow(
      /browser operations are still active/,
    );

    lease.release();
    await transition.waitForDrain();

    expect(() => fence.completeTransition(transition, "human")).not.toThrow();
  });

  it("runAgentBrowserOperation rejects a result that became stale before return", async () => {
    const fence = new BrowserOwnershipFence();
    fence.initialize("ses_one", "agent");

    const operationStarted = deferred<BrowserOwnershipLease>();
    const releaseOperation = deferred<void>();

    const operation = fence.runAgentBrowserOperation(
      "ses_one",
      async (lease) => {
        operationStarted.resolve(lease);
        await releaseOperation.promise;
        return "browser-result";
      },
    );

    await operationStarted.promise;

    const transition = fence.beginTransition("ses_one");
    releaseOperation.resolve();

    await expect(operation).rejects.toMatchObject({
      code: "CONTROL_NOT_OWNED",
    });

    await transition.waitForDrain();
    fence.completeTransition(transition, null);
  });

  it("makes lease release and session cleanup idempotent", async () => {
    const fence = new BrowserOwnershipFence();
    fence.initialize("ses_one", "agent");

    const lease = fence.acquire("ses_one", "agent");
    const transition = fence.beginTransition("ses_one");

    lease.release();
    lease.release();

    await transition.waitForDrain();

    fence.clear("ses_one");
    fence.clear("ses_one");

    expectControlNotOwned(() => lease.assertCurrent());

    expect(() => fence.acquire("ses_one", "agent")).toThrowError(
      /ownership state is not active/,
    );
  });

  it("keeps different sessions independent", async () => {
    const fence = new BrowserOwnershipFence();
    fence.initialize("ses_one", "agent");
    fence.initialize("ses_two", "agent");

    const firstLease = fence.acquire("ses_one", "agent");
    const transition = fence.beginTransition("ses_one");

    const secondLease = fence.acquire("ses_two", "agent");
    expect(() => secondLease.assertCurrent()).not.toThrow();

    secondLease.release();
    firstLease.release();

    await transition.waitForDrain();
    fence.completeTransition(transition, null);
  });
});
