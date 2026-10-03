#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "../..");
const companion = join(root, "apps/companion");
const requireCompanion = createRequire(join(companion, "package.json"));
const Database = requireCompanion("better-sqlite3");
const { SqliteTaskEngineStore } = await import(
  join(companion, "dist/main/main/codex/sqlite-task-engine-store.js")
);
const { customerTaskExecution } = await import(
  join(companion, "dist/main/main/codex/customer-task-execution.js")
);

const source = process.argv[2];
if (!source)
  throw new Error(
    "Usage: authoritative-execution-state-qualification.mjs <task database>",
  );

await stat(source);
const sourceHashBefore = createHash("sha256")
  .update(await readFile(source))
  .digest("hex");
const fixtureHome = await mkdtemp(join(tmpdir(), "rove-execution-state-"));
const copy = join(fixtureHome, basename(source));

try {
  await copyFile(source, copy);
  for (const suffix of ["-wal", "-shm"]) {
    try {
      await copyFile(`${source}${suffix}`, `${copy}${suffix}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const database = new Database(copy, { readonly: true });
  const row = database
    .prepare(
      `SELECT task_id, payload_json
       FROM task_engine_aggregate
       WHERE json_extract(payload_json, '$.requestedOperation.type') = 'interrupt'
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get();
  database.close();
  if (!row)
    throw new Error(
      "The fixture has no persisted interrupt operation to qualify.",
    );

  const before = JSON.parse(row.payload_json);
  const store = new SqliteTaskEngineStore({ path: copy });
  const aggregate = await store.aggregate(row.task_id);
  store.close();
  if (!aggregate) throw new Error("The migrated fixture task disappeared.");
  if (aggregate.requestedOperation.type !== "observe")
    throw new Error("A succeeded legacy Stop still projects as requested.");

  const execution = customerTaskExecution(aggregate);
  if (execution.state === "stopping")
    throw new Error("A succeeded legacy Stop still projects as Stopping.");
  const sourceHashAfter = createHash("sha256")
    .update(await readFile(source))
    .digest("hex");
  if (sourceHashAfter !== sourceHashBefore)
    throw new Error("Qualification modified the preserved source fixture.");

  process.stdout.write(
    `${JSON.stringify({
      status: "passed",
      source,
      sourceSha256: sourceHashAfter,
      taskId: row.task_id,
      beforeRequestedOperation: before.requestedOperation.type,
      afterRequestedOperation: aggregate.requestedOperation.type,
      customerExecutionState: execution.state,
    })}\n`,
  );
} finally {
  await rm(fixtureHome, { recursive: true, force: true });
}
