import { RuntimeProcess } from "../runtime-process.js";

const [runtimeDirectory, home, portValue] = process.argv.slice(2);
const port = Number(portValue);
if (!runtimeDirectory || !home || !Number.isSafeInteger(port) || port < 1)
  throw new Error("Runtime owner fixture arguments are invalid.");

const runtimeInstanceId = `runtime_${"c".repeat(32)}`;
const runtime = new RuntimeProcess({
  runtimeDirectory,
  home,
  host: "127.0.0.1",
  port,
  token: "runtime-owner-fixture-token",
  browserHeadless: true,
  browser: "chromium",
  nodeExecutable: process.execPath,
  entrypoint: "dist/main.js",
  runtimeInstanceId,
  runtimeStartedAt: "2026-09-10T00:00:00.000Z",
});

runtime.start();
const runtimeProcessId = runtime.getPid();
if (runtimeProcessId === undefined)
  throw new Error("Runtime owner fixture did not receive a process ID.");
process.stdout.write(
  `ROVE_OWNER_FIXTURE:${JSON.stringify({
    schemaVersion: 1,
    ownerProcessId: process.pid,
    runtimeProcessId,
    runtimeInstanceId,
    startupStage: "runtime_spawned_pre_ready",
  })}\n`,
);
setInterval(() => undefined, 1_000);
