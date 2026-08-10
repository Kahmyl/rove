import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import type { ControlWaitEvent, ControlWaitResult, Observation, Session } from "@rove/protocol";
import { ObservationService } from "../observation/observation.service.js";
import { SessionService } from "../session/session.service.js";

const RELEVANT = new Set<ControlWaitEvent>([
  "human_requested",
  "human_took_control",
  "human_returned_control",
  "session_completed",
  "session_failed",
]);

interface Waiter {
  afterSeq: number;
  resolve(result: ControlWaitResult): void;
  reject(error: Error): void;
}

@Injectable()
export class ControlWaitService implements OnModuleDestroy {
  private readonly waiters = new Map<string, Set<Waiter>>();
  private afterRegisterHook: (() => Promise<void>) | undefined;

  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ObservationService) private readonly observations: ObservationService,
  ) {}

  setAfterRegisterHookForTest(hook: (() => Promise<void>) | undefined): void {
    this.afterRegisterHook = hook;
  }

  async wait(sessionId: string, afterSeq: number, timeoutMs: number, signal?: AbortSignal): Promise<ControlWaitResult> {
    await this.sessions.get(sessionId);
    const existing = await this.firstRelevant(sessionId, afterSeq);
    if (existing !== undefined) return this.fromObservation(sessionId, existing);

    let waiter!: Waiter;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;
    const pending = new Promise<ControlWaitResult>((resolve, reject) => {
      waiter = { afterSeq, resolve, reject };
      this.register(sessionId, waiter);
      timer = setTimeout(() => {
        void this.timeoutResult(sessionId).then(resolve, reject);
      }, timeoutMs);
      if (signal !== undefined) {
        abortHandler = () => reject(new Error("Control wait was cancelled."));
        signal.addEventListener("abort", abortHandler, { once: true });
      }
    }).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
      if (abortHandler !== undefined) signal?.removeEventListener("abort", abortHandler);
      this.unregister(sessionId, waiter);
    });
    void pending.catch(() => undefined);

    await this.afterRegisterHook?.();
    const raced = await this.firstRelevant(sessionId, afterSeq);
    if (raced !== undefined) {
      waiter.resolve(await this.fromObservation(sessionId, raced));
    }
    return pending;
  }

  async publish(sessionId: string, observation: Observation): Promise<void> {
    if (!RELEVANT.has(observation.type as ControlWaitEvent)) return;
    const result = await this.fromObservation(sessionId, observation);
    for (const waiter of this.waiters.get(sessionId) ?? []) {
      if (observation.seq > waiter.afterSeq) waiter.resolve(result);
    }
  }

  waiterCount(sessionId: string): number {
    return this.waiters.get(sessionId)?.size ?? 0;
  }

  onModuleDestroy(): void {
    for (const waiters of this.waiters.values()) {
      for (const waiter of waiters) waiter.reject(new Error("Runtime is shutting down."));
    }
    this.waiters.clear();
  }

  private async firstRelevant(sessionId: string, afterSeq: number): Promise<Observation | undefined> {
    let cursor = afterSeq;
    while (true) {
      const page = await this.observations.list(sessionId, { afterSeq: cursor, limit: 1_000 });
      const relevant = page.items.find((item) => RELEVANT.has(item.type as ControlWaitEvent));
      if (relevant !== undefined) return relevant;
      const last = page.items.at(-1);
      if (last === undefined || page.items.length < 1_000) return undefined;
      cursor = last.seq;
    }
  }

  private async fromObservation(sessionId: string, observation: Observation): Promise<ControlWaitResult> {
    const current = await this.sessions.get(sessionId);
    const event = observation.type as Exclude<ControlWaitEvent, "timeout">;
    const state = this.stateAtEvent(current, observation);
    return {
      event,
      sessionId,
      controller: state.controller,
      status: state.status,
      observationSeq: observation.seq,
      ...(state.handoff === undefined ? {} : { handoff: state.handoff }),
    };
  }

  private stateAtEvent(current: Session, observation: Observation): Pick<Session, "controller" | "status" | "handoff"> {
    switch (observation.type) {
      case "human_requested": {
        const data = observation.data as { reason?: unknown };
        const reason = typeof data.reason === "string" ? data.reason : current.handoff?.reason;
        return {
          controller: null,
          status: "awaiting_human",
          ...(reason === undefined ? {} : { handoff: { reason, requestedAt: observation.timestamp } }),
        };
      }
      case "human_took_control": return { controller: "human", status: "active", ...(current.handoff === undefined ? {} : { handoff: current.handoff }) };
      case "human_returned_control": return { controller: "agent", status: "active" };
      case "session_completed": return { controller: null, status: "completed" };
      case "session_failed": return { controller: null, status: "failed" };
      default: return current;
    }
  }

  private async timeoutResult(sessionId: string): Promise<ControlWaitResult> {
    const session = await this.sessions.get(sessionId);
    return {
      event: "timeout",
      sessionId,
      controller: session.controller,
      status: session.status,
      ...(session.handoff === undefined ? {} : { handoff: session.handoff }),
    };
  }

  private register(sessionId: string, waiter: Waiter): void {
    const set = this.waiters.get(sessionId) ?? new Set<Waiter>();
    set.add(waiter);
    this.waiters.set(sessionId, set);
  }

  private unregister(sessionId: string, waiter: Waiter): void {
    const set = this.waiters.get(sessionId);
    set?.delete(waiter);
    if (set?.size === 0) this.waiters.delete(sessionId);
  }
}
