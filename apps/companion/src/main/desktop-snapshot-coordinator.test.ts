import { describe, expect, it, vi } from "vitest";

import { DesktopSnapshotCoordinator } from "./desktop-snapshot-coordinator.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("DesktopSnapshotCoordinator", () => {
  it("serializes builds, coalesces invalidations, and cannot publish reverse-order truth", async () => {
    const publications: Array<{ value: string; revision: number }> = [];
    const coordinator = new DesktopSnapshotCoordinator<{ value: string }>(
      (snapshot) => publications.push(snapshot),
    );
    const older = deferred<{ value: string }>();
    const newer = deferred<{ value: string }>();
    const newest = deferred<{ value: string }>();
    const olderBuild = vi.fn(() => older.promise);
    const newerBuild = vi.fn(() => newer.promise);
    const newestBuild = vi.fn(() => newest.promise);
    const first = coordinator.refresh(olderBuild);
    const second = coordinator.refresh(newerBuild);
    const third = coordinator.refresh(newestBuild);
    expect(olderBuild).toHaveBeenCalledTimes(1);
    expect(newerBuild).not.toHaveBeenCalled();
    expect(newestBuild).not.toHaveBeenCalled();

    older.resolve({ value: "older" });
    await expect(first).resolves.toMatchObject({ value: "older", revision: 1 });
    expect(newerBuild).not.toHaveBeenCalled();
    expect(newestBuild).toHaveBeenCalledTimes(1);
    newest.resolve({ value: "newest" });
    await expect(second).resolves.toMatchObject({
      value: "newest",
      revision: 2,
    });
    await expect(third).resolves.toMatchObject({
      value: "newest",
      revision: 2,
    });
    expect(publications).toEqual([
      { value: "older", revision: 1 },
      { value: "newest", revision: 2 },
    ]);
  });

  it("rejects a failed complete read without publishing it", async () => {
    const publish = vi.fn();
    const coordinator = new DesktopSnapshotCoordinator<{ value: string }>(
      publish,
    );
    await expect(
      coordinator.refresh(async () => {
        throw new Error("read failed");
      }),
    ).rejects.toThrow("read failed");
    expect(publish).not.toHaveBeenCalled();
    expect(coordinator.current()).toBeUndefined();
  });
});
