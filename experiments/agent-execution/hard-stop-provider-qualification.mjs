import { spawn, spawnSync } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import readline from "node:readline";
import { clearTimeout, setTimeout } from "node:timers";

if (process.env.ROVE_ALLOW_LIVE_STOP !== "1") {
  throw new Error("live_stop_requires_explicit_ROVE_ALLOW_LIVE_STOP_1");
}

const requestedExecutable = process.env.ROVE_CODEX_EXECUTABLE ?? "codex";
const disableUnifiedExec = process.argv.includes("--disable-unified-exec");
const workspace = await mkdtemp(join(tmpdir(), "rove-hard-stop-"));
const sentinelPath = join(workspace, "completion-sentinel.txt");

async function resolveExecutable() {
  if (isAbsolute(requestedExecutable) || requestedExecutable.includes("/")) {
    return realpath(resolve(requestedExecutable));
  }
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

class AppServerClient {
  constructor(executablePath) {
    this.executablePath = executablePath;
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.waiters = [];
    this.serverRequests = [];
    this.stderr = [];
  }

  async start() {
    const args = ["app-server", "--stdio"];
    if (disableUnifiedExec) args.push("--disable", "unified_exec");
    const childEnv = { ...process.env };
    childEnv.PATH = [dirname(this.executablePath), childEnv.PATH]
      .filter(Boolean)
      .join(delimiter);
    this.child = spawn(this.executablePath, args, {
      cwd: workspace,
      env: childEnv,
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
          this.failAll(new Error("malformed_server_stdout"));
          return;
        }
        if (
          message.id !== undefined &&
          (message.result !== undefined || message.error !== undefined)
        ) {
          const pending = this.pending.get(String(message.id));
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(String(message.id));
          if (message.error) {
            pending.reject(
              Object.assign(new Error(message.error.message), {
                rpcError: message.error,
              }),
            );
          } else pending.resolve(message.result);
          return;
        }
        if (message.id !== undefined && message.method) {
          this.serverRequests.push(message);
          const available = Array.isArray(message.params?.availableDecisions)
            ? message.params.availableDecisions
            : [];
          this.send({
            id: message.id,
            result: {
              decision: available.includes("decline") ? "decline" : "cancel",
            },
          });
          return;
        }
        if (!message.method) return;
        this.notifications.push(message);
        for (const waiter of [...this.waiters]) {
          if (!waiter.predicate(message)) continue;
          clearTimeout(waiter.timer);
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      });
    this.exit = new Promise((resolveExit) => {
      this.child.once("exit", (code, signal) => {
        this.failAll(
          new Error(`app_server_exit:${code ?? "null"}:${signal ?? "none"}`),
        );
        resolveExit({ code, signal });
      });
    });
  }

  failAll(error) {
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
    const id = `stop-${this.nextId++}`;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request_timeout:${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      this.send({ id, method, params });
    });
  }

  notify(method, params = {}) {
    this.send({ method, params });
  }

  waitFor(predicate, timeoutMs = 120_000) {
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
    const initialized = await this.request("initialize", {
      clientInfo: {
        name: "rove_hard_stop_qualification",
        title: "Rove Hard Stop Qualification",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.notify("initialized");
    return initialized;
  }

  async stop() {
    if (!this.child || this.child.exitCode !== null) return;
    this.child.kill("SIGTERM");
    await Promise.race([this.exit, wait(3_000)]);
    if (this.child.exitCode === null) this.child.kill("SIGKILL");
  }
}

const executablePath = await resolveExecutable();
const executableBytes = await readFile(executablePath);
const executableSha256 = createHash("sha256")
  .update(executableBytes)
  .digest("hex");
const version = spawnSync(executablePath, ["--version"], {
  encoding: "utf8",
}).stdout.trim();
const client = new AppServerClient(executablePath);
let threadId;
let result;

try {
  await client.start();
  const initialized = await client.initialize();
  const models = await client.request("model/list", {
    includeHidden: true,
    limit: 100,
  });
  const visibleModel = models.data?.find((model) => !model.hidden);
  const started = await client.request("thread/start", {
    cwd: workspace,
    model: visibleModel?.model ?? visibleModel?.id,
    approvalPolicy: "never",
    sandbox: "workspace-write",
    ephemeral: true,
    serviceName: "rove-hard-stop-qualification",
    baseInstructions:
      "This is a bounded process-cancellation qualification. Execute the user's exact command once with exec_command, wait for it, and do not use any other tool.",
  });
  threadId = started.thread.id;
  const command = `/bin/sh -c 'sleep 8; printf survived > ${sentinelPath}'`;
  const turnStarted = await client.request("turn/start", {
    threadId,
    input: [
      {
        type: "text",
        text: `Use exec_command exactly once to run this exact command and wait for it: ${command}`,
        text_elements: [],
      },
    ],
  });
  const turnId = turnStarted.turn.id;
  const commandItem = await client.waitFor(
    (message) =>
      message.method === "item/started" &&
      message.params?.turnId === turnId &&
      message.params?.item?.type === "commandExecution",
  );
  const interruptStartedAt = Date.now();
  const interruptReceipt = await client.request("turn/interrupt", {
    threadId,
    turnId,
  });
  const completed = await client.waitFor(
    (message) =>
      message.method === "turn/completed" &&
      message.params?.turn?.id === turnId,
    30_000,
  );
  const terminalObservedAt = Date.now();
  await wait(9_000);
  let sentinelPresent = false;
  try {
    await access(sentinelPath);
    sentinelPresent = true;
  } catch {
    // Absence after the original completion window is the required evidence.
  }
  const commandValue = commandItem.params?.item?.command;
  const commandText = Array.isArray(commandValue)
    ? commandValue.join(" ")
    : String(commandValue ?? "");
  const processId = commandItem.params?.item?.processId;
  const terminalStatus = completed.params?.turn?.status ?? null;
  result = {
    status:
      terminalStatus === "interrupted" && !sentinelPresent
        ? "qualified"
        : "blocked",
    date: new Date().toISOString(),
    provider: {
      version,
      executableSha256,
      executableBytes: executableBytes.byteLength,
      userAgent: initialized.userAgent ?? null,
      unifiedExec: disableUnifiedExec ? "disabled" : "default",
    },
    authority: {
      threadIdRecorded: typeof threadId === "string",
      turnIdRecorded: typeof turnId === "string",
      processIdPresent:
        typeof processId === "string" || typeof processId === "number",
      processIdType: processId == null ? null : typeof processId,
      commandMatched:
        commandText.includes("sleep 8") && commandText.includes(sentinelPath),
      interruptAcknowledged: interruptReceipt != null,
      terminalStatus,
      interruptToTerminalMs: terminalObservedAt - interruptStartedAt,
      delayedSentinelPresent: sentinelPresent,
      exactTerminationProven:
        terminalStatus === "interrupted" && !sentinelPresent,
    },
    unexpectedServerRequestCount: client.serverRequests.length,
  };
} finally {
  if (threadId) {
    try {
      await client.request("thread/archive", { threadId }, 5_000);
    } catch {
      // Ephemeral-thread cleanup is best effort; the temporary workspace is primary.
    }
  }
  await client.stop();
  await rm(workspace, { recursive: true, force: true });
}

console.log(JSON.stringify(result, null, 2));
