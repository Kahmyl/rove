import assert from "node:assert/strict";
import { test } from "node:test";

import { pollSnapshot } from "./source-product-poll.mjs";

test("host polling does not accept false and returns later plain truth", async () => {
  const states = [{ ready: false }, { ready: true, value: "settled" }];
  let calls = 0;
  const snapshot = async () => {
    calls += 1;
    return states.shift();
  };
  const result = await pollSnapshot({
    page: {},
    snapshot,
    predicate: (state) => (state.ready ? state.value : false),
    stage: "offline:false-then-truth",
    timeoutMs: 100,
    intervalMs: 1,
  });
  assert.equal(result, "settled");
  assert.equal(calls, 2);
});

test("host polling reports its stage and last validated summary", async () => {
  await assert.rejects(
    () =>
      pollSnapshot({
        page: {},
        snapshot: async () => ({ ready: false, revision: 7 }),
        predicate: () => false,
        stage: "offline:timeout",
        timeoutMs: 2,
        intervalMs: 1,
        summarize: (state) => ({ revision: state.revision }),
      }),
    /offline:timeout; last validated snapshot: \{"revision":7\}/,
  );
});
