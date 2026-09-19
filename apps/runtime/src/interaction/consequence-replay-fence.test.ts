import { describe, expect, it } from "vitest";

import { ConsequenceReplayFence } from "./consequence-replay-fence.js";

describe("consequence replay fence", () => {
  it("blocks only the unresolved stable key in the same session", () => {
    const fence = new ConsequenceReplayFence();

    fence.recordUnknown("session_a", "purchase:123");

    expect(() => fence.assertAvailable("session_a", "purchase:123")).toThrow();

    expect(() =>
      fence.assertAvailable("session_a", "purchase:124"),
    ).not.toThrow();

    expect(() =>
      fence.assertAvailable("session_b", "purchase:123"),
    ).not.toThrow();

    fence.clearSession("session_a");

    expect(() =>
      fence.assertAvailable("session_a", "purchase:123"),
    ).not.toThrow();
  });

  it("clears only the exact settled consequence key", () => {
    const fence = new ConsequenceReplayFence();
    fence.recordUnknown("session_a", "create:first");
    fence.recordUnknown("session_a", "create:second");

    fence.clear("session_a", "create:first");

    expect(() =>
      fence.assertAvailable("session_a", "create:first"),
    ).not.toThrow();
    expect(() => fence.assertAvailable("session_a", "create:second")).toThrow();
  });
});
