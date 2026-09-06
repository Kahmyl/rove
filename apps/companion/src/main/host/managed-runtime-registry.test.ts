import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  reconcileManagedRuntime,
} from "./managed-runtime-registry.js";

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("managed Runtime reconciliation", () => {
  it("removes a record only after its Runtime PID is proven dead", async () => {
    const home = await mkdtemp(join(tmpdir(), "rove-managed-runtime-"));
    homes.push(home);
    const path = join(home, "managed-runtime.json");
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      runtimeInstanceId: "runtime_22222222222222222222222222222222",
      runtimeProcessId: 2_147_483_647,
      runtimeProcessIdentity: "dead",
      ownerProcessId: 2_147_483_647,
      ownerProcessIdentity: "dead",
      runtimeDirectory: "/tmp/runtime",
      baseUrl: "http://127.0.0.1:51999",
      startedAt: new Date().toISOString(),
    }));

    await reconcileManagedRuntime({ home, runtimeDirectory: "/tmp/runtime" });
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed for malformed ownership metadata", async () => {
    const home = await mkdtemp(join(tmpdir(), "rove-managed-runtime-"));
    homes.push(home);
    await writeFile(join(home, "managed-runtime.json"), "{}\n");

    await expect(reconcileManagedRuntime({ home, runtimeDirectory: "/tmp/runtime" }))
      .rejects.toThrow("invalid");
  });
});
