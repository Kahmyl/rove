import { describe, expect, it } from "vitest";

import { shouldDetachManagedChild } from "./process-tree.js";

describe("managed process groups", () => {
  it("creates dedicated POSIX process groups for descendant cleanup", () => {
    expect(shouldDetachManagedChild("darwin")).toBe(true);
    expect(shouldDetachManagedChild("linux")).toBe(true);
  });

  it("uses the Windows task tree instead of POSIX groups", () => {
    expect(shouldDetachManagedChild("win32")).toBe(false);
  });
});
