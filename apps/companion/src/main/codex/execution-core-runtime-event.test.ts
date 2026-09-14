import { describe, expect, it } from "vitest";

import { runtimeInventoryEventId } from "./execution-core.js";

describe("Runtime inventory event identity", () => {
  it("separates observations by generation, position, and state", () => {
    const first = runtimeInventoryEventId("task_1", 7, 1, "same-state");

    expect(runtimeInventoryEventId("task_1", 7, 1, "same-state")).toBe(first);
    expect(runtimeInventoryEventId("task_1", 8, 1, "same-state")).not.toBe(
      first,
    );
    expect(runtimeInventoryEventId("task_1", 7, 2, "same-state")).not.toBe(
      first,
    );
    expect(runtimeInventoryEventId("task_1", 7, 1, "other-state")).not.toBe(
      first,
    );
  });
});
