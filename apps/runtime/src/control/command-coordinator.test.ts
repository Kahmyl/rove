import { describe, expect, it } from "vitest";
import { BrowserCommandCoordinator } from "./command-coordinator.js";

describe("BrowserCommandCoordinator", () => {
  it("serializes mutations within a session", async () => {
    const coordinator = new BrowserCommandCoordinator();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = coordinator.execute("ses_one", async () => {
      order.push("first:start");
      await gate;
      order.push("first:end");
    });
    const second = coordinator.execute("ses_one", async () => { order.push("second"); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("does not serialize different sessions globally", async () => {
    const coordinator = new BrowserCommandCoordinator();
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const order: string[] = [];
    const first = coordinator.execute("ses_one", async () => {
      order.push("one:start");
      await gate;
      order.push("one:end");
    });
    const second = coordinator.execute("ses_two", async () => { order.push("two"); });
    await second;
    expect(order).toEqual(["one:start", "two"]);
    releaseFirst();
    await first;
  });
});
