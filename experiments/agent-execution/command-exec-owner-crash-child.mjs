import { spawn } from "node:child_process";
import { dirname } from "node:path";
import process from "node:process";
import readline from "node:readline";

const executable = process.argv[2];
const serverWorkspace = process.argv[3];
const taskWorkspace = process.argv[4];
const sentinel = process.argv[5];
if (!executable || !serverWorkspace || !taskWorkspace || !sentinel)
  throw new Error(
    "owner crash child requires executable, server workspace, task workspace, sentinel",
  );

const profileArgs = [
  "-c",
  'default_permissions="rove_task"',
  "-c",
  'permissions.rove_task.description="Rove task workspace only"',
  "-c",
  'permissions.rove_task.filesystem={":root"="deny", ":minimal"="read", ":workspace_roots"={"."="write"}, ":tmpdir"="deny", ":slash_tmp"="deny"}',
  "-c",
  "permissions.rove_task.network.enabled=false",
  "app-server",
  "--stdio",
];
const environment = Object.fromEntries(
  [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SystemRoot",
    "CODEX_HOME",
  ].flatMap((name) =>
    process.env[name] === undefined ? [] : [[name, process.env[name]]],
  ),
);
environment.PATH = [dirname(executable), environment.PATH]
  .filter(Boolean)
  .join(":");
const server = spawn(executable, profileArgs, {
  cwd: serverWorkspace,
  env: environment,
  stdio: ["pipe", "pipe", "pipe"],
});
let nextId = 0;
const pending = new Map();
let ready = false;
readline.createInterface({ input: server.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "command/exec/outputDelta" && !ready) {
    ready = true;
    process.stdout.write(
      `${JSON.stringify({ status: "ready", appServerPid: server.pid, processId: message.params.processId })}\n`,
    );
    return;
  }
  if (message.id === undefined || message.method !== undefined) return;
  const entry = pending.get(String(message.id));
  if (!entry) return;
  pending.delete(String(message.id));
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
});
server.stderr.on("data", (chunk) => process.stderr.write(chunk));
server.once("exit", (code, signal) => {
  if (!ready)
    process.stderr.write(`app server exited before ready: ${code}:${signal}\n`);
  process.exit(code ?? 1);
});

function request(method, params) {
  const id = `owner-crash-${++nextId}`;
  const result = new Promise((resolve, reject) =>
    pending.set(id, { resolve, reject }),
  );
  server.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  return result;
}

await request("initialize", {
  clientInfo: {
    name: "rove_owner_crash_qualification",
    title: "Rove Owner Crash Qualification",
    version: "0.1.0",
  },
  capabilities: { experimentalApi: true, requestAttestation: false },
});
server.stdin.write(
  `${JSON.stringify({ method: "initialized", params: {} })}\n`,
);
void request("command/exec", {
  command: [
    "/bin/sh",
    "-c",
    `printf started\\n; sleep 8; printf survived > ${JSON.stringify(sentinel)}`,
  ],
  processId: `rove_owner_crash_${process.pid}`,
  cwd: taskWorkspace,
  permissionProfile: "rove_task",
  streamStdoutStderr: true,
  disableTimeout: true,
});

await new Promise(() => undefined);
