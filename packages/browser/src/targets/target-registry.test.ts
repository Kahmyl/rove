import { describe, expect, it } from "vitest";
import { TargetRegistry } from "./target-registry.js";

describe("TargetRegistry", () => {
  it("resolves a target only within its page revision", () => {
    const registry = new TargetRegistry("page_01", 17);
    const target = registry.register({ role: "button", name: "Continue" }, Symbol("node"));
    expect(registry.resolve(target.reference)).toBe(target);
    registry.invalidate(18);
    expect(() => registry.resolve(target.reference)).toThrowError(
      expect.objectContaining({ code: "TARGET_STALE" }),
    );
  });
});
