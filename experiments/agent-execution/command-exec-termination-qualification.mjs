import { spawn, spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import console from "node:console";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import readline from "node:readline";
import { clearTimeout, setTimeout } from "node:timers";
import { URL } from "node:url";

const requestedExecutable = process.env.ROVE_CODEX_EXECUTABLE ?? "codex";
const workspace = await mkdtemp(join(tmpdir(), "rove-command-exec-stop-"));
const codexHome = join(workspace, "codex-home");
const serverWorkspace = join(workspace, "server-owner");
const taskWorkspace = join(workspace, "task-workspace");
await Promise.all(
  [codexHome, serverWorkspace, taskWorkspace].map((path) =>
    mkdir(path, { recursive: true, mode: 0o700 }),
  ),
);
const stoppedSentinel = join(taskWorkspace, "stopped-sentinel.txt");
const unrelatedSentinel = join(taskWorkspace, "unrelated-sentinel.txt");
const ownerCrashSentinel = join(taskWorkspace, "owner-crash-sentinel.txt");
const outsideSecret = join(dirname(workspace), `${randomUUID()}.secret`);
const outsideGrantSentinel = join(
  dirname(workspace),
  `${randomUUID()}.grant-sentinel`,
);
await writeFile(outsideSecret, "must-not-be-readable", { mode: 0o600 });

const appServerArgs = [
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

async function executablePath() {
  if (isAbsolute(requestedExecutable) || requestedExecutable.includes("/"))
    return realpath(resolve(requestedExecutable));
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    try {
      return await realpath(resolve(directory, requestedExecutable));
    } catch {
      // Continue searching PATH.
    }
  }
  throw new Error(`executable_not_found:${requestedExecutable}`);
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function qualifyOwnerCrash(path) {
  const child = spawn(
    process.execPath,
    [
      new URL("./command-exec-owner-crash-child.mjs", import.meta.url).pathname,
      path,
      serverWorkspace,
      taskWorkspace,
      ownerCrashSentinel,
    ],
    {
      cwd: serverWorkspace,
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  const ready = await new Promise((resolveReady, reject) => {
    const timer = setTimeout(
      () => reject(new Error("owner_crash_ready_timeout")),
      10_000,
    );
    readline.createInterface({ input: child.stdout }).once("line", (line) => {
      clearTimeout(timer);
      try {
        resolveReady(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `owner_crash_child_exited:${code}:${signal}:${stderr.join("")}`,
        ),
      );
    });
  });
  if (
    ready?.status !== "ready" ||
    !Number.isSafeInteger(ready.appServerPid) ||
    typeof ready.processId !== "string"
  )
    throw new Error("owner_crash_ready_identity_invalid");
  child.kill("SIGKILL");
  await new Promise((resolveExit) => child.once("exit", resolveExit));
  await wait(9_000);
  const sentinelPresent = await exists(ownerCrashSentinel);
  const appServerAlive = processAlive(ready.appServerPid);
  if (appServerAlive) process.kill(ready.appServerPid, "SIGKILL");
  return {
    controllerKilled: true,
    processId: ready.processId,
    sentinelPresent,
    appServerExited: !appServerAlive,
  };
}

class JsonRpcClient {
  constructor(path) {
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.waiters = [];
    this.stderr = [];
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
      ].flatMap((name) =>
        process.env[name] === undefined ? [] : [[name, process.env[name]]],
      ),
    );
    environment.CODEX_HOME = codexHome;
    environment.PATH = [dirname(path), environment.PATH]
      .filter(Boolean)
      .join(delimiter);
    this.child = spawn(path, appServerArgs, {
      cwd: serverWorkspace,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr.push(String(chunk).trim());
      if (this.stderr.length > 20) this.stderr.shift();
    });
    readline
      .createInterface({ input: this.child.stdout })
      .on("line", (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          this.fail(new Error("malformed_app_server_output"));
          return;
        }
        if (message.id === undefined || message.method !== undefined) {
          if (message.method) {
            this.notifications.push(message);
            for (const waiter of [...this.waiters]) {
              if (!waiter.predicate(message)) continue;
              clearTimeout(waiter.timer);
              this.waiters.splice(this.waiters.indexOf(waiter), 1);
              waiter.resolve(message);
            }
          }
          return;
        }
        const pending = this.pending.get(String(message.id));
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(String(message.id));
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    this.exit = new Promise((resolveExit) => {
      this.child.once("exit", (code, signal) => {
        if (!this.stopping)
          this.fail(
            new Error(
              `app_server_exit:${code}:${signal}:${this.stderr.join(" | ")}`,
            ),
          );
        resolveExit({ code, signal });
      });
    });
  }

  fail(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters = [];
  }

  send(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeoutMs = 30_000) {
    const id = `command-exec-${this.nextId++}`;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request_timeout:${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      this.send({ id, method, params });
    });
  }

  waitFor(predicate, timeoutMs = 10_000) {
    const existing = this.notifications.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolveWait, reject) => {
      const waiter = { predicate, resolve: resolveWait, reject };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error("notification_timeout"));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async initialize() {
    const result = await this.request("initialize", {
      clientInfo: {
        name: "rove_command_exec_qualification",
        title: "Rove Command Exec Qualification",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.send({ method: "initialized", params: {} });
    return result;
  }

  async stop() {
    if (this.child.exitCode !== null) return;
    this.stopping = true;
    this.child.kill("SIGTERM");
    await Promise.race([this.exit, wait(3_000)]);
    if (this.child.exitCode === null) this.child.kill("SIGKILL");
  }
}

const path = await executablePath();
const bytes = await readFile(path);
const digest = createHash("sha256").update(bytes).digest("hex");
const version = spawnSync(path, ["--version"], {
  encoding: "utf8",
}).stdout.trim();
const client = new JsonRpcClient(path);
let result;

try {
  const initialized = await client.initialize();
  const threadStart = await client.request("thread/start", {
    cwd: taskWorkspace,
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
    permissions: "rove_task",
    runtimeWorkspaceRoots: [taskWorkspace],
    config: {
      default_permissions: "rove_task",
      permissions: {
        rove_task: {
          description: "Rove task workspace only",
          filesystem: {
            ":root": "deny",
            ":minimal": "read",
            ":workspace_roots": { ".": "write" },
            ":tmpdir": "deny",
            ":slash_tmp": "deny",
          },
          network: { enabled: false },
        },
      },
      features: {
        shell_tool: false,
        unified_exec: false,
        code_mode: false,
        code_mode_host: false,
        code_mode_only: false,
        js_repl: false,
        multi_agent: false,
      },
      web_search: "disabled",
    },
    dynamicTools: [
      {
        type: "function",
        name: "rove_exec",
        description: "Rove-owned exact local execution",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
            },
          },
          required: ["command"],
          additionalProperties: false,
        },
      },
    ],
    historyMode: "legacy",
    experimentalRawEvents: false,
    threadSource: `rove:qualification:${randomUUID()}`,
  });
  const threadRead = await client.request("thread/read", {
    threadId: threadStart.thread.id,
    includeTurns: false,
  });
  const threadBoundary = {
    startAccepted: typeof threadStart?.thread?.id === "string",
    exactReadAccepted: threadRead?.thread?.id === threadStart?.thread?.id,
    dynamicToolName: "rove_exec",
    providerExecutionFeaturesDisabled: true,
    permissionProfile: "rove_task",
  };
  const unsupportedGrantProbeProcessId = `rove_grant_probe_${randomUUID().replaceAll("-", "")}`;
  let unsupportedGrantProbe;
  try {
    const response = await client.request("command/exec", {
      command: [
        "/bin/sh",
        "-c",
        `printf escaped > ${JSON.stringify(outsideGrantSentinel)}`,
      ],
      processId: unsupportedGrantProbeProcessId,
      cwd: taskWorkspace,
      permissionProfile: "rove_task",
      threadId: threadStart.thread.id,
      turnId: "synthetic_unapproved_turn",
      toolCallId: "synthetic_unapproved_tool_call",
      permissionGrantId: "synthetic_unapproved_grant",
      disableTimeout: true,
    });
    const elevatedEffectObserved = await exists(outsideGrantSentinel);
    unsupportedGrantProbe = {
      status: elevatedEffectObserved ? "unsafe_elevated_effect" : "blocked",
      requestRejected: false,
      exactBindingRejected: false,
      requestCompleted: typeof response?.exitCode === "number",
      providerExitCode: response?.exitCode ?? null,
      elevatedEffectObserved,
      reason: elevatedEffectObserved
        ? "Synthetic grant fields produced an out-of-profile effect without qualified provider grant authority."
        : "command/exec ignored or did not consume synthetic grant fields; the base profile denied the elevated effect.",
    };
  } catch (error) {
    unsupportedGrantProbe = {
      status: "blocked",
      requestRejected: true,
      exactBindingRejected: true,
      requestCompleted: false,
      providerExitCode: null,
      elevatedEffectObserved: false,
      reason:
        "The provider rejected thread/turn/tool-call/grant binding fields on command/exec.",
      error: error instanceof Error ? error.message.slice(0, 500) : String(error),
    };
  }
  const stoppedProcessId = `rove_exec_${randomUUID().replaceAll("-", "")}`;
  const unrelatedProcessId = `rove_exec_${randomUUID().replaceAll("-", "")}`;
  const stoppedRequest = client.request(
    "command/exec",
    {
      command: [
        "/bin/sh",
        "-c",
        `test ! -r ${JSON.stringify(outsideSecret)} && printf started\\n && (sleep 8; printf survived > ${JSON.stringify(stoppedSentinel)}) & wait`,
      ],
      processId: stoppedProcessId,
      cwd: taskWorkspace,
      permissionProfile: "rove_task",
      streamStdoutStderr: true,
      disableTimeout: true,
    },
    30_000,
  );
  const unrelatedRequest = client.request(
    "command/exec",
    {
      command: [
        "/bin/sh",
        "-c",
        `sleep 2; printf survived > ${JSON.stringify(unrelatedSentinel)}`,
      ],
      processId: unrelatedProcessId,
      cwd: taskWorkspace,
      permissionProfile: "rove_task",
      streamStdoutStderr: true,
      disableTimeout: true,
    },
    30_000,
  );
  await client.waitFor(
    (notification) =>
      notification.method === "command/exec/outputDelta" &&
      notification.params?.processId === stoppedProcessId,
  );
  const terminationRequestedAt = Date.now();
  const terminateReceipt = await client.request("command/exec/terminate", {
    processId: stoppedProcessId,
  });
  const stoppedExit = await stoppedRequest;
  const exitObservedAt = Date.now();
  const unrelatedExit = await unrelatedRequest;
  await wait(8_000);
  const stoppedSentinelPresent = await exists(stoppedSentinel);
  const unrelatedSentinelPresent = await exists(unrelatedSentinel);
  const outputByProcess = Object.fromEntries(
    [stoppedProcessId, unrelatedProcessId].map((processId) => [
      processId,
      client.notifications
        .filter(
          (notification) =>
            notification.method === "command/exec/outputDelta" &&
            notification.params?.processId === processId &&
            typeof notification.params?.deltaBase64 === "string",
        )
        .map((notification) =>
          Buffer.from(notification.params.deltaBase64, "base64").toString(
            "utf8",
          ),
        )
        .join("")
        .slice(-2_000),
    ]),
  );
  const outsideSecretDenied =
    outputByProcess[stoppedProcessId]?.includes("started");
  const ownerCrash = await qualifyOwnerCrash(path);
  result = {
    status:
      !stoppedSentinelPresent &&
      unrelatedSentinelPresent &&
      outsideSecretDenied &&
      threadBoundary.startAccepted &&
      threadBoundary.exactReadAccepted &&
      unsupportedGrantProbe.status === "blocked" &&
      unsupportedGrantProbe.elevatedEffectObserved === false &&
      ownerCrash.controllerKilled &&
      !ownerCrash.sentinelPresent &&
      ownerCrash.appServerExited &&
      typeof stoppedExit?.exitCode === "number" &&
      unrelatedExit?.exitCode === 0
        ? "qualified"
        : "blocked",
    date: new Date().toISOString(),
    provider: {
      version,
      executableSha256: digest,
      executableBytes: bytes.byteLength,
      userAgent: initialized.userAgent ?? null,
    },
    permissionProfile: {
      name: "rove_task",
      outsideSecretDenied,
      workspaceWriteObserved: true,
      networkEnabled: false,
    },
    threadBoundary,
    providerGrantBoundary: {
      ...unsupportedGrantProbe,
      authority: "provider",
      requiredBeforeElevatedAdoption: true,
      humanAndAutomaticGrantConsumptionQualified: false,
    },
    ownerCrash,
    authority: {
      stoppedProcessId,
      unrelatedProcessId,
      identitiesDistinct: stoppedProcessId !== unrelatedProcessId,
      terminateAcknowledged: terminateReceipt != null,
      finalExitObserved: typeof stoppedExit?.exitCode === "number",
      stoppedExitCode: stoppedExit?.exitCode ?? null,
      terminateToExitMs: exitObservedAt - terminationRequestedAt,
      stoppedSentinelPresent,
      unrelatedExitCode: unrelatedExit?.exitCode ?? null,
      unrelatedSentinelPresent,
      outputByProcess,
      unexpectedNotificationMethods: [
        ...new Set(
          client.notifications
            .map((notification) => notification.method)
            .filter((method) => method !== "command/exec/outputDelta"),
        ),
      ],
    },
  };
} finally {
  await client.stop();
  await rm(workspace, { recursive: true, force: true });
  await rm(outsideSecret, { force: true });
  await rm(outsideGrantSentinel, { force: true });
}

console.log(JSON.stringify(result, null, 2));
if (result?.status !== "qualified") process.exitCode = 1;
