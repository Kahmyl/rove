import { describe, expect, it } from "vitest";
import type { TaskEngine, TaskEvent } from "@rove/protocol";

import { OrderedTaskIngress } from "./ordered-task-ingress.js";

function observed(id: string): TaskEvent {
  return {
    schemaVersion: 1,
    type: "host_generation_changed",
    eventId: id,
    taskId: "task_12345678-1234-4123-8123-123456789abc",
    source: { kind: "host", id: "host", generation: 1, position: 1 },
    observedAt: "2026-09-09T12:00:00.000Z",
    component: "codex",
    generation: 1,
  };
}

describe("ordered task ingress", () => {
  it("serializes acceptance and fences an old generation", async () => {
    const order: string[] = [];
    const engine = {
      async accept(event: TaskEvent) {
        if (event.eventId === "first") await Promise.resolve();
        order.push(event.eventId);
        return {};
      },
    } as unknown as TaskEngine;
    const ingress = new OrderedTaskIngress(engine, () => undefined);
    ingress.replaceGeneration(1);
    const first = ingress.enqueue(1, observed("first"));
    const second = ingress.enqueue(1, observed("second"));
    await Promise.all([first, second]);
    ingress.replaceGeneration(2);
    await ingress.enqueue(1, observed("stale"));
    expect(order).toEqual(["first", "second"]);
  });

  it("surfaces listener failure as recoverable state", async () => {
    const failures: string[] = [];
    const engine = {
      async accept() {
        throw new Error("durability unavailable");
      },
    } as unknown as TaskEngine;
    const ingress = new OrderedTaskIngress(engine, (error) => {
      failures.push(error.message);
    });
    ingress.replaceGeneration(1);
    await expect(ingress.enqueue(1, observed("failure"))).rejects.toThrow(
      "durability unavailable",
    );
    expect(failures).toEqual(["durability unavailable"]);
    expect(ingress.state().recoveryRequired).toBe("durability unavailable");
  });

  it("commits ingress without waiting for external follow-up work", async () => {
    let release!: () => void;
    const external = new Promise<void>((resolve) => (release = resolve));
    const engine = { accept: async () => ({}) } as unknown as TaskEngine;
    const ingress = new OrderedTaskIngress(
      engine,
      () => undefined,
      () => external,
    );
    ingress.replaceGeneration(1);
    await ingress.enqueue(1, observed("committed"));
    expect(ingress.state().accepted).toBe(1);
    release();
  });

  it("enters explicit recovery when its bounded buffer overflows", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const engine = { accept: async () => blocked } as unknown as TaskEngine;
    const ingress = new OrderedTaskIngress(
      engine,
      () => undefined,
      () => undefined,
      1,
    );
    ingress.replaceGeneration(1);
    const first = ingress.enqueue(1, observed("first"));
    await expect(ingress.enqueue(1, observed("overflow"))).rejects.toThrow(
      "capacity exceeded",
    );
    release();
    await first;
  });
});
