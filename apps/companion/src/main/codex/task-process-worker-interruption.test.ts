import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const child = fileURLToPath(
  new URL("./task-process-worker-child.ts", import.meta.url),
);
const tsxLoader = join(
  process.cwd(),
  "node_modules/.pnpm/tsx@4.23.11/node_modules/tsx/dist/loader.mjs",
);

function run(mode: string, databasePath: string, markerPath: string) {
  return spawnSync(
    process.execPath,
    ["--import", tsxLoader, child, mode, databasePath, markerPath],
    { cwd: process.cwd(), encoding: "utf8" },
  );
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("TaskProcessWorker process-cut recovery", () => {
  it("consumes committed work and reconciles dispatched work before redispatch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rove-worker-cut-"));
    directories.push(directory);
    const databasePath = join(directory, "ledger.sqlite3");
    const markerPath = join(directory, "adapter.log");

    expect(run("seed", databasePath, markerPath).status).toBe(0);
    expect(run("dispatch-cut", databasePath, markerPath).signal).toBe(
      "SIGKILL",
    );
    expect(await readFile(markerPath, "utf8")).toBe("execute\n");

    expect(run("reconcile-cut", databasePath, markerPath).signal).toBe(
      "SIGKILL",
    );
    expect(await readFile(markerPath, "utf8")).toBe("execute\nreconcile\n");

    expect(run("recover", databasePath, markerPath).status).toBe(0);
    expect(await readFile(markerPath, "utf8")).toBe(
      "execute\nreconcile\nreconcile\n",
    );
  });
});
