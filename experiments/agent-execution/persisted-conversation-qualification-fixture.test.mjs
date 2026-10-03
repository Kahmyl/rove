import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { TaskEngine } from "../../packages/protocol/dist/index.js";
import { SqliteTaskEngineStore } from "../../apps/companion/dist/main/main/codex/sqlite-task-engine-store.js";
import { LocalProductApi } from "../../apps/companion/dist/main/main/codex/local-product-api.js";
import { OrderedAttentionQueue } from "../../apps/companion/dist/main/main/codex/attention.js";
import { LedgerProductTaskPort } from "../../apps/companion/dist/main/main/codex/product-task-port.js";
import {
  baseAggregate,
  seedProductHome,
} from "./packaged-critical-interaction-qualification.mjs";

test("persisted qualification history includes exact synthetic delivery rather than deriving it from saved response text", async () => {
  const home = await mkdtemp(join(tmpdir(), "rove-persisted-history-"));
  let store;
  try {
    await seedProductHome(home);
    const path = join(home, "codex-product/task-process.v1.sqlite3");
    store = new SqliteTaskEngineStore({ path });
    const { identity } = baseAggregate(
      1,
      "Review the packaged launch evidence",
    );
    const saved = await store.aggregate(identity.taskId);
    assert.equal(
      saved.messageDeliveries[identity.operationId].state,
      "message_materialized",
    );
    assert.equal(
      saved.conversation.items[`user:${identity.operationId}`].turnId,
      identity.turnId,
    );
    store.close();
    store = new SqliteTaskEngineStore({ path });
    let signals = 0;
    const port = new LedgerProductTaskPort({
      engine: new TaskEngine(store),
      store,
      worker: {
        signal() {
          signals++;
        },
        cancelTask() {},
      },
    });
    const api = new LocalProductApi(
      () => ({
        state: "ready",
        ready: true,
        restartAttempt: 0,
        stderrTail: [],
      }),
      {
        snapshot: () => ({
          account: { status: "logged_out" },
          models: [],
          rateLimits: null,
          usage: null,
          refreshedAt: new Date().toISOString(),
        }),
      },
      port,
      {},
      new OrderedAttentionQueue(),
      home,
      () => [],
    );
    const snapshot = await api.readSnapshot();
    assert.equal(snapshot.catalog.account.status, "logged_out");
    const task = snapshot.tasks.find((task) => task.taskId === identity.taskId);
    assert.equal(
      task.conversation.items[`user:${identity.operationId}`].deliveryState,
      "materialized",
    );
    assert.match(
      task.conversation.items.assistant_ready.text,
      /persisted packaged conversation/,
    );
    assert.equal(signals, 0);
    assert.deepEqual(await store.claimDueCommands("fixture-audit", 1, 10), []);
  } finally {
    store?.close();
    await rm(home, { recursive: true, force: true });
  }
});
