import type { TaskEngine, TaskEvent } from "@rove/protocol";

export interface OrderedTaskIngressState {
  generation: number;
  accepted: number;
  recoveryRequired: string | null;
}

/** A generation-fenced, ordered async ingress. enqueue resolves only after the
 * accepted-event transaction commits, so later App Server events cannot
 * overtake earlier events and UI publication can safely follow resolution. */
export class OrderedTaskIngress {
  private chain: Promise<void> = Promise.resolve();
  private generation = 0;
  private accepted = 0;
  private recoveryRequired: string | null = null;
  private buffered = 0;

  constructor(
    private readonly engine: TaskEngine,
    private readonly onFailure: (error: Error) => Promise<void> | void,
    private readonly afterAccept: () => Promise<void> | void = () => undefined,
    private readonly maximumBuffered = 1024,
  ) {}

  replaceGeneration(generation: number): void {
    if (!Number.isSafeInteger(generation) || generation <= this.generation)
      throw new Error("Ingress generation must increase monotonically.");
    this.generation = generation;
  }

  enqueue(generation: number, event: TaskEvent): Promise<void> {
    if (this.buffered >= this.maximumBuffered) {
      const failure = new Error("Ordered event ingress capacity exceeded.");
      this.recoveryRequired = failure.message;
      void this.onFailure(failure);
      return Promise.reject(failure);
    }
    this.buffered += 1;
    const work = this.chain.then(async () => {
      if (generation !== this.generation) return;
      try {
        await this.engine.accept(event);
        this.accepted += 1;
        void Promise.resolve(this.afterAccept()).catch(async (error) => {
          const failure =
            error instanceof Error ? error : new Error(String(error));
          this.recoveryRequired = failure.message.slice(0, 240);
          await this.onFailure(failure);
        });
      } catch (error) {
        const failure =
          error instanceof Error ? error : new Error(String(error));
        this.recoveryRequired = failure.message.slice(0, 240);
        await this.onFailure(failure);
        throw failure;
      }
    });
    this.chain = work
      .catch(() => undefined)
      .finally(() => {
        this.buffered -= 1;
      });
    return work;
  }

  async drain(): Promise<void> {
    await this.chain;
  }

  state(): OrderedTaskIngressState {
    return {
      generation: this.generation,
      accepted: this.accepted,
      recoveryRequired: this.recoveryRequired,
    };
  }
}
