import { describe, expect, it } from "vitest";

import {
  UnifiedSurfaceCoordinator,
  UnifiedSurfaceStateMachine,
  type UnifiedSurfaceHost,
  type UnifiedSurfaceSnapshot,
} from "./unified-surface-state.js";

class FakeHost implements UnifiedSurfaceHost {
  visible = false;
  presentations: UnifiedSurfaceSnapshot[] = [];

  isVisible(): boolean {
    return this.visible;
  }

  hide(): void {
    this.visible = false;
  }

  show(snapshot: UnifiedSurfaceSnapshot): void {
    this.presentations.push({ ...snapshot });
    this.visible = true;
  }
}

describe("Experiment C: one logical companion surface", () => {
  it("morphs chip -> expanded -> full -> expanded without losing state", () => {
    const machine = new UnifiedSurfaceStateMachine();

    expect(machine.snapshot()).toMatchObject({
      presentation: "chip",
      activeHost: "browser_follower",
      revision: 0,
    });

    expect(machine.dispatch({ type: "expand" })).toMatchObject({
      presentation: "expanded",
      activeHost: "browser_follower",
      revision: 1,
    });
    expect(machine.dispatch({ type: "open_full" })).toMatchObject({
      presentation: "full",
      activeHost: "control_center",
      returnPresentation: "expanded",
      revision: 2,
    });
    expect(machine.dispatch({ type: "close_full" })).toMatchObject({
      presentation: "expanded",
      activeHost: "browser_follower",
      revision: 3,
    });
  });

  it("treats fullscreen as host context rather than a second product mode", () => {
    const machine = new UnifiedSurfaceStateMachine();
    machine.dispatch({ type: "expand" });

    expect(
      machine.dispatch({ type: "browser_context", context: "fullscreen" }),
    ).toMatchObject({
      presentation: "expanded",
      browserContext: "fullscreen",
      activeHost: "browser_follower",
    });
  });

  it("keeps exactly one native host visible through every transition", () => {
    const follower = new FakeHost();
    const controlCenter = new FakeHost();
    const coordinator = new UnifiedSurfaceCoordinator(follower, controlCenter);
    const machine = new UnifiedSurfaceStateMachine();

    const snapshots = [
      machine.snapshot(),
      machine.dispatch({ type: "expand" }),
      machine.dispatch({ type: "open_full" }),
      machine.dispatch({
        type: "browser_context",
        context: "fullscreen",
      }),
      machine.dispatch({ type: "close_full" }),
      machine.dispatch({ type: "collapse" }),
    ];

    for (const snapshot of snapshots) {
      coordinator.present(snapshot);
      expect(coordinator.visibleHostCount()).toBe(1);
      expect({
        follower: follower.visible,
        controlCenter: controlCenter.visible,
      }).toEqual(
        snapshot.activeHost === "browser_follower"
          ? { follower: true, controlCenter: false }
          : { follower: false, controlCenter: true },
      );
    }
  });

  it("does not produce new revisions for idempotent presentation events", () => {
    const machine = new UnifiedSurfaceStateMachine();
    expect(machine.dispatch({ type: "collapse" }).revision).toBe(0);
    expect(
      machine.dispatch({ type: "browser_context", context: "windowed" })
        .revision,
    ).toBe(0);
  });
});
