export type RevisedSnapshot<T extends object> = T & { revision: number };

interface Waiter<T extends object> {
  epoch: number;
  resolve(value: RevisedSnapshot<T>): void;
  reject(error: unknown): void;
}

export class DesktopSnapshotCoordinator<T extends object> {
  private requestedEpoch = 0;
  private revision = 0;
  private inFlight = false;
  private latestBuild: (() => Promise<T>) | undefined;
  private committed: RevisedSnapshot<T> | undefined;
  private readonly waiters: Waiter<T>[] = [];

  constructor(
    private readonly publish: (snapshot: RevisedSnapshot<T>) => void,
  ) {}

  current(): RevisedSnapshot<T> | undefined {
    return this.committed;
  }

  refresh(build: () => Promise<T>): Promise<RevisedSnapshot<T>> {
    const epoch = ++this.requestedEpoch;
    this.latestBuild = build;
    const result = new Promise<RevisedSnapshot<T>>((resolve, reject) => {
      this.waiters.push({ epoch, resolve, reject });
    });
    if (!this.inFlight) void this.drain();
    return result;
  }

  patch(
    update: (current: RevisedSnapshot<T>) => T,
  ): RevisedSnapshot<T> | undefined {
    if (!this.committed) return undefined;
    const snapshot = { ...update(this.committed), revision: ++this.revision };
    this.committed = snapshot;
    this.publish(snapshot);
    return snapshot;
  }

  private async drain(): Promise<void> {
    this.inFlight = true;
    try {
      while (this.waiters.length > 0) {
        const epoch = this.requestedEpoch;
        const build = this.latestBuild;
        if (!build) throw new Error("Desktop snapshot build is unavailable.");
        try {
          const value = await build();
          const snapshot = { ...value, revision: ++this.revision };
          this.committed = snapshot;
          this.publish(snapshot);
          this.settle(epoch, snapshot);
        } catch (error) {
          this.reject(epoch, error);
        }
      }
    } finally {
      this.inFlight = false;
      if (this.waiters.length > 0) void this.drain();
    }
  }

  private settle(epoch: number, snapshot: RevisedSnapshot<T>): void {
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index]!;
      if (waiter.epoch > epoch) continue;
      this.waiters.splice(index, 1);
      waiter.resolve(snapshot);
    }
  }

  private reject(epoch: number, error: unknown): void {
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index]!;
      if (waiter.epoch > epoch) continue;
      this.waiters.splice(index, 1);
      waiter.reject(error);
    }
  }
}
