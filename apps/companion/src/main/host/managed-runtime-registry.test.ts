import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { reconcileManagedRuntime } from "./managed-runtime-registry.js";

const homes: string[] = [];
const children: ChildProcess[] = [];
const execFileAsync = promisify(execFile);

async function processStartIdentity(pid: number): Promise<string> {
  const { stdout } = await execFileAsync("ps", [
    "-p",
    String(pid),
    "-o",
    "lstart=",
  ]);
  return stdout.trim();
}

async function loopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await waitForExit(child);
  }
  await Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

describe("managed Runtime reconciliation", () => {
  it("removes a record only after its Runtime PID is proven dead", async () => {
    const home = await mkdtemp(join(tmpdir(), "rove-managed-runtime-"));
    homes.push(home);
    const path = join(home, "managed-runtime.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        runtimeInstanceId: "runtime_22222222222222222222222222222222",
        runtimeProcessId: 2_147_483_647,
        runtimeProcessIdentity: "dead",
        ownerProcessId: 2_147_483_647,
        ownerProcessIdentity: "dead",
        runtimeDirectory: "/tmp/runtime",
        baseUrl: "http://127.0.0.1:51999",
        startedAt: new Date().toISOString(),
      }),
    );

    await reconcileManagedRuntime({ home, runtimeDirectory: "/tmp/runtime" });
    await expect(readFile(path, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fails closed for malformed ownership metadata", async () => {
    const home = await mkdtemp(join(tmpdir(), "rove-managed-runtime-"));
    homes.push(home);
    await writeFile(join(home, "managed-runtime.json"), "{}\n");

    await expect(
      reconcileManagedRuntime({ home, runtimeDirectory: "/tmp/runtime" }),
    ).rejects.toThrow("invalid");
  });

  it("waits for a correlated Runtime already closing after owner loss", async () => {
    const home = await mkdtemp(join(tmpdir(), "rove-managed-runtime-"));
    homes.push(home);
    const runtimeInstanceId = `runtime_${"a".repeat(32)}`;
    const child = spawn(
      process.execPath,
      [
        "-e",
        "setTimeout(() => process.exit(0), 250)",
        "--",
        `--rove-runtime-instance=${runtimeInstanceId}`,
      ],
      { detached: true, stdio: "ignore" },
    );
    children.push(child);
    expect(child.pid).toBeTypeOf("number");
    const runtimeProcessId = child.pid!;
    await writeFile(
      join(home, "managed-runtime.json"),
      JSON.stringify({
        schemaVersion: 1,
        runtimeInstanceId,
        runtimeProcessId,
        runtimeProcessIdentity: await processStartIdentity(runtimeProcessId),
        ownerProcessId: 2_147_483_647,
        ownerProcessIdentity: "dead",
        runtimeDirectory: "/tmp/runtime",
        baseUrl: "http://127.0.0.1:1",
        startedAt: new Date().toISOString(),
      }),
    );

    await reconcileManagedRuntime({ home, runtimeDirectory: "/tmp/runtime" });
    await expect(
      readFile(join(home, "managed-runtime.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes a dying Runtime record when command identity disappears during teardown", async () => {
    const home = await mkdtemp(join(tmpdir(), "rove-managed-runtime-"));
    homes.push(home);
    const runtimeInstanceId = `runtime_${"d".repeat(32)}`;
    const child = spawn(
      process.execPath,
      ["-e", "setTimeout(() => process.exit(0), 250)"],
      { detached: true, stdio: "ignore" },
    );
    children.push(child);
    const runtimeProcessId = child.pid!;
    await writeFile(
      join(home, "managed-runtime.json"),
      JSON.stringify({
        schemaVersion: 1,
        runtimeInstanceId,
        runtimeProcessId,
        runtimeProcessIdentity: await processStartIdentity(runtimeProcessId),
        ownerProcessId: 2_147_483_647,
        ownerProcessIdentity: "dead",
        runtimeDirectory: "/tmp/runtime",
        baseUrl: "http://127.0.0.1:1",
        startedAt: new Date().toISOString(),
      }),
    );

    await reconcileManagedRuntime({ home, runtimeDirectory: "/tmp/runtime" });
    await expect(
      readFile(join(home, "managed-runtime.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("terminates a surviving Runtime only after its live identity matches", async () => {
    const home = await mkdtemp(join(tmpdir(), "rove-managed-runtime-"));
    homes.push(home);
    const runtimeInstanceId = `runtime_${"b".repeat(32)}`;
    const port = await loopbackPort();
    const child = spawn(
      process.execPath,
      [
        "-e",
        `require("node:http").createServer((_q,r)=>{r.setHeader("content-type","application/json");r.end(JSON.stringify({runtime:{runtimeInstanceId:${JSON.stringify(runtimeInstanceId)},processId:process.pid}}))}).listen(${port},"127.0.0.1",()=>process.stdout.write("ready\\n"))`,
        "--",
        `--rove-runtime-instance=${runtimeInstanceId}`,
      ],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    children.push(child);
    await new Promise<void>((resolve) =>
      child.stdout!.once("data", () => resolve()),
    );
    const runtimeProcessId = child.pid!;
    await writeFile(
      join(home, "managed-runtime.json"),
      JSON.stringify({
        schemaVersion: 1,
        runtimeInstanceId,
        runtimeProcessId,
        runtimeProcessIdentity: await processStartIdentity(runtimeProcessId),
        ownerProcessId: 2_147_483_647,
        ownerProcessIdentity: "dead",
        runtimeDirectory: "/tmp/runtime",
        baseUrl: `http://127.0.0.1:${port}`,
        startedAt: new Date().toISOString(),
      }),
    );

    await reconcileManagedRuntime({ home, runtimeDirectory: "/tmp/runtime" });
    await waitForExit(child);
    expect(child.signalCode).toBe("SIGTERM");
  }, 10_000);

  it("refuses a PID-reused or unrelated live process", async () => {
    const home = await mkdtemp(join(tmpdir(), "rove-managed-runtime-"));
    homes.push(home);
    await writeFile(
      join(home, "managed-runtime.json"),
      JSON.stringify({
        schemaVersion: 1,
        runtimeInstanceId: `runtime_${"c".repeat(32)}`,
        runtimeProcessId: process.pid,
        runtimeProcessIdentity: await processStartIdentity(process.pid),
        ownerProcessId: 2_147_483_647,
        ownerProcessIdentity: "dead",
        runtimeDirectory: "/tmp/runtime",
        baseUrl: "http://127.0.0.1:1",
        startedAt: new Date().toISOString(),
      }),
    );

    await expect(
      reconcileManagedRuntime({ home, runtimeDirectory: "/tmp/runtime" }),
    ).rejects.toThrow("ownership could not be proved");
  });
});
