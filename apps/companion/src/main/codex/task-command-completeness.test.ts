import { describe, expect, it } from "vitest";

import {
  NATIVE_LIFECYCLE_COMMAND_TYPES,
  TASK_COMMAND_MANIFEST,
  TASK_COMMAND_MANIFEST_COMPLETE,
} from "@rove/protocol";

describe("generated task command completeness", () => {
  it("classifies every native command exactly once", () => {
    expect(TASK_COMMAND_MANIFEST_COMPLETE).toBe(true);
    expect(Object.keys(TASK_COMMAND_MANIFEST).sort()).toEqual(
      [...NATIVE_LIFECYCLE_COMMAND_TYPES].sort(),
    );
    for (const type of NATIVE_LIFECYCLE_COMMAND_TYPES) {
      expect(TASK_COMMAND_MANIFEST[type].execute).toMatch(
        /^(pure_ledger|repeatable_read|correlated_write|uncertain_write)$/,
      );
      expect(TASK_COMMAND_MANIFEST[type].reconcile).toMatch(
        /^(not_required|read_truth|correlate_receipt)$/,
      );
    }
  });
});
