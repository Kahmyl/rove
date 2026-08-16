import { Injectable } from "@nestjs/common";
import { RoveError } from "@rove/protocol";

export type BrowserActor = "agent" | "human";

export interface BrowserOwnershipToken {
  sessionId: string;
  actor: BrowserActor;
  generation: number;
}

export interface BrowserOwnershipLease {
  readonly token: BrowserOwnershipToken;
  assertCurrent(): void;
  release(): void;
}

export interface BrowserOwnershipTransition {
  readonly sessionId: string;
  readonly generation: number;
  waitForDrain(): Promise<void>;
}

interface OwnershipFenceState {
  generation: number;
  owner: BrowserActor | null;
  acceptingWork: boolean;
  transitioning: boolean;
  activeOperations: number;
  drainWaiters: Set<() => void>;
}

@Injectable()
export class BrowserOwnershipFence {
  private readonly states = new Map<string, OwnershipFenceState>();

  initialize(sessionId: string, owner: BrowserActor | null): number {
    const existing = this.states.get(sessionId);

    if (existing !== undefined) {
      if (!existing.transitioning && existing.owner === owner) {
        return existing.generation;
      }

      throw new Error(
        `Browser ownership fence for ${sessionId} is already initialized in a different ownership state.`,
      );
    }

    const generation = 1;

    this.states.set(sessionId, {
      generation,
      owner,
      acceptingWork: owner !== null,
      transitioning: false,
      activeOperations: 0,
      drainWaiters: new Set(),
    });

    return generation;
  }

  acquire(sessionId: string, actor: BrowserActor): BrowserOwnershipLease {
    const state = this.requireState(sessionId);

    if (state.transitioning || !state.acceptingWork || state.owner !== actor) {
      throw this.controlNotOwned(state.owner);
    }

    const token: BrowserOwnershipToken = {
      sessionId,
      actor,
      generation: state.generation,
    };

    state.activeOperations += 1;

    let released = false;

    return {
      token,
      assertCurrent: () => this.assertCurrent(token),
      release: () => {
        if (released) return;
        released = true;
        this.releaseLease(sessionId);
      },
    };
  }

  async runAgentBrowserOperation<T>(
    sessionId: string,
    operation: (lease: BrowserOwnershipLease) => Promise<T>,
  ): Promise<T> {
    const lease = this.acquire(sessionId, "agent");

    try {
      const result = await operation(lease);
      lease.assertCurrent();
      return result;
    } finally {
      lease.release();
    }
  }

  beginTransition(sessionId: string): BrowserOwnershipTransition {
    const state = this.requireState(sessionId);

    if (!state.transitioning) {
      state.generation += 1;
      state.owner = null;
      state.acceptingWork = false;
      state.transitioning = true;
    }

    const generation = state.generation;

    return {
      sessionId,
      generation,
      waitForDrain: () => this.waitForDrain(sessionId, generation),
    };
  }

  completeTransition(
    transition: Pick<BrowserOwnershipTransition, "sessionId" | "generation">,
    owner: BrowserActor | null,
  ): void {
    const state = this.requireState(transition.sessionId);

    if (!state.transitioning || state.generation !== transition.generation) {
      throw this.staleOwnership();
    }

    if (state.activeOperations !== 0) {
      throw new Error(
        "Cannot complete browser ownership transition while browser operations are still active.",
      );
    }

    state.owner = owner;
    state.acceptingWork = owner !== null;
    state.transitioning = false;
  }

  assertCurrent(token: BrowserOwnershipToken): void {
    const state = this.states.get(token.sessionId);

    if (
      state === undefined ||
      state.transitioning ||
      !state.acceptingWork ||
      state.owner !== token.actor ||
      state.generation !== token.generation
    ) {
      throw this.staleOwnership();
    }
  }

  clear(sessionId: string): void {
    const state = this.states.get(sessionId);
    if (state === undefined) return;

    for (const resolve of state.drainWaiters) {
      resolve();
    }

    state.drainWaiters.clear();
    this.states.delete(sessionId);
  }

  private waitForDrain(sessionId: string, generation: number): Promise<void> {
    const state = this.requireState(sessionId);

    if (!state.transitioning || state.generation !== generation) {
      throw this.staleOwnership();
    }

    if (state.activeOperations === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      state.drainWaiters.add(resolve);
    });
  }

  private releaseLease(sessionId: string): void {
    const state = this.states.get(sessionId);
    if (state === undefined) return;

    if (state.activeOperations <= 0) {
      return;
    }

    state.activeOperations -= 1;

    if (state.activeOperations !== 0) {
      return;
    }

    for (const resolve of state.drainWaiters) {
      resolve();
    }

    state.drainWaiters.clear();
  }

  private requireState(sessionId: string): OwnershipFenceState {
    const state = this.states.get(sessionId);

    if (state === undefined) {
      throw new RoveError({
        code: "SESSION_NOT_ACTIVE",
        message: "Browser ownership state is not active for this session.",
      });
    }

    return state;
  }

  private controlNotOwned(owner: BrowserActor | null): RoveError {
    return new RoveError({
      code: "CONTROL_NOT_OWNED",
      message: `The browser is currently controlled by ${owner ?? "no one"}.`,
      details: { controller: owner },
    });
  }

  private staleOwnership(): RoveError {
    return new RoveError({
      code: "CONTROL_NOT_OWNED",
      message: "Browser ownership changed while the operation was running.",
    });
  }
}
