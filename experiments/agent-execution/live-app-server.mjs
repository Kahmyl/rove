import { spawn } from "node:child_process";
import console from "node:console";
import process from "node:process";
import readline from "node:readline";
import { accessSync, rmSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";

const executable = process.env.ROVE_CODEX_EXECUTABLE ?? "codex";
const lifecycle = process.argv.includes("--lifecycle");
const mcpBoundary = process.argv.includes("--mcp-boundary");
const cwd = resolve(process.cwd());
const isolatedCodexHome = mcpBoundary
  ? await mkdtemp(join(tmpdir(), "rove-agent-schema-codex-home-"))
  : undefined;
if (isolatedCodexHome) {
  process.once("exit", () => {
    try {
      rmSync(isolatedCodexHome, { recursive: true, force: true });
    } catch {
      // The asynchronous cleanup below is primary; this covers abrupt failures.
    }
  });
}
const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const expectedRoveCatalog = JSON.parse(
  await readFile(resolve(here, "fixtures/rove-tool-catalog.json"), "utf8"),
);

function progress(phase) {
  console.error(
    `[p50:${lifecycle ? "lifecycle" : mcpBoundary ? "mcp" : "read-only"}] ${phase}`,
  );
}

async function resolveExecutable() {
  if (isAbsolute(executable) || executable.includes("/"))
    return realpath(resolve(executable));
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = resolve(directory, executable);
    try {
      accessSync(candidate);
      return realpath(candidate);
    } catch {
      // Continue searching PATH.
    }
  }
  throw new Error(`executable_not_found:${executable}`);
}

function requireEvidence(condition, label) {
  if (!condition) throw new Error(`required_evidence_failed:${label}`);
}

class AppServerClient {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.waiters = [];
    this.stderr = [];
    this.protocolErrors = [];
  }

  async start() {
    this.child = spawn(executable, ["app-server", "--stdio"], {
      cwd,
      env: {
        ...process.env,
        ...(isolatedCodexHome ? { CODEX_HOME: isolatedCodexHome } : {}),
      },
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
          if (!pending) {
            this.protocolErrors.push(
              message.error ?? { code: "orphan_response", id: message.id },
            );
            return;
          }
          clearTimeout(pending.timer);
          this.pending.delete(String(message.id));
          if (message.error)
            pending.reject(
              Object.assign(new Error(message.error.message), {
                rpcError: message.error,
              }),
            );
          else pending.resolve(message.result);
          return;
        }
        if (message.id !== undefined && message.method) {
          this.respondToServerRequest(message);
          return;
        }
        if (message.method) {
          this.notifications.push(message);
          for (const waiter of [...this.waiters]) {
            if (waiter.predicate(message)) {
              clearTimeout(waiter.timer);
              this.waiters.splice(this.waiters.indexOf(waiter), 1);
              waiter.resolve(message);
            }
          }
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
  }

  send(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeoutMs = 30_000) {
    const id = `p50-${this.nextId++}`;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request_timeout:${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveRequest, reject, timer, method });
      this.send({ method, id, params });
    });
  }

  notify(method, params = {}) {
    this.send({ method, params });
  }

  waitFor(predicate, timeoutMs = 60_000) {
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

  respondToServerRequest(message) {
    const method = message.method;
    let result;
    if (method.includes("requestApproval")) result = { decision: "decline" };
    else if (
      method === "tool/requestUserInput" ||
      method === "item/tool/requestUserInput"
    )
      result = { answers: {} };
    else if (method === "mcpServer/elicitation/request")
      result = { action: "cancel", content: null };
    else result = { decision: "decline" };
    this.send({ id: message.id, result });
  }

  async initialize() {
    const result = await this.request("initialize", {
      clientInfo: {
        name: "rove_p50_experiment",
        title: "Rove P5.0 Experiment",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.notify("initialized");
    return result;
  }

  async stop() {
    if (!this.child || this.child.exitCode !== null) return;
    this.child.kill("SIGTERM");
    await Promise.race([
      this.exit,
      new Promise((resolveWait) => setTimeout(resolveWait, 3_000)),
    ]);
    if (this.child.exitCode === null) this.child.kill("SIGKILL");
  }
}

async function observePreInitializeRejection() {
  const client = new AppServerClient();
  await client.start();
  try {
    await client.request("account/read", {}, 10_000);
    return { rejected: false };
  } catch (error) {
    return {
      rejected: true,
      code: error.rpcError?.code ?? null,
      message: error.message,
    };
  } finally {
    await client.stop();
  }
}

async function observeMalformedInput() {
  const client = new AppServerClient();
  await client.start();
  client.child.stdin.write("{malformed-json\n");
  const outcome = await Promise.race([
    client.exit.then((value) => ({ exited: true, ...value })),
    new Promise((resolveWait) =>
      setTimeout(
        () =>
          resolveWait({
            exited: false,
            protocolErrors: client.protocolErrors.map((error) => ({
              code: error.code ?? null,
              message: error.message ?? null,
            })),
            stderrDiagnosticObserved: client.stderr.length > 0,
            parseDiagnosticObserved: client.stderr.some((line) =>
              /parse|json|malformed/i.test(line),
            ),
          }),
        1_000,
      ),
    ),
  ]);
  await client.stop();
  return outcome;
}

function statusOf(promise) {
  return promise.then(
    (value) => ({ status: "ok", value }),
    (error) => ({
      status: "error",
      code: error.rpcError?.code ?? null,
      message: error.message,
    }),
  );
}

function summarizeAccount(result) {
  return {
    hasAccount: result?.account != null,
    authMode: result?.account?.type ?? result?.account?.authMode ?? null,
    planType: result?.account?.planType ?? null,
    requiresOpenaiAuth: result?.requiresOpenaiAuth ?? null,
  };
}

function notificationCounts(notifications) {
  const counts = {};
  for (const item of notifications)
    counts[item.method] = (counts[item.method] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

progress("probing pre-initialize rejection");
const preInitialize = await observePreInitializeRejection();
progress("probing malformed JSON handling");
const malformedInput = await observeMalformedInput();
const evidence = {
  date: "2026-09-07",
  executable: await resolveExecutable(),
  mode: lifecycle ? "lifecycle" : mcpBoundary ? "mcp-boundary" : "read-only",
  preInitialize,
  malformedInput,
};

let client = new AppServerClient();
let createdThreadId;
let allNotifications = [];
try {
  progress("initializing App Server");
  await client.start();
  const initialized = await client.initialize();
  evidence.initialize = {
    userAgent: initialized.userAgent,
    codexHomePresent: typeof initialized.codexHome === "string",
    platformFamily: initialized.platformFamily,
    platformOs: initialized.platformOs,
  };

  const [account, models, rateLimits, usage, mcp] = await Promise.all([
    statusOf(client.request("account/read", { refreshToken: false })),
    statusOf(client.request("model/list", { includeHidden: true, limit: 100 })),
    statusOf(client.request("account/rateLimits/read", undefined)),
    statusOf(client.request("account/usage/read", undefined)),
    statusOf(
      client.request("mcpServerStatus/list", {
        detail: "toolsAndAuthOnly",
        limit: 100,
      }),
    ),
  ]);
  evidence.account =
    account.status === "ok"
      ? { status: "ok", ...summarizeAccount(account.value) }
      : account;
  evidence.models =
    models.status === "ok"
      ? {
          status: "ok",
          count: models.value.data?.length ?? 0,
          hidden:
            models.value.data?.filter((model) => model.hidden).length ?? 0,
          entries: (models.value.data ?? []).map((model) => ({
            id: model.id,
            hidden: model.hidden,
            isDefault: model.isDefault,
            defaultReasoningEffort: model.defaultReasoningEffort,
            supportedReasoningEfforts: model.supportedReasoningEfforts?.map(
              (item) => item.reasoningEffort,
            ),
          })),
        }
      : models;
  evidence.rateLimits =
    rateLimits.status === "ok"
      ? { status: "ok", available: rateLimits.value != null }
      : rateLimits;
  evidence.usage =
    usage.status === "ok"
      ? { status: "ok", available: usage.value != null }
      : usage;
  evidence.mcp =
    mcp.status === "ok"
      ? {
          status: "ok",
          servers: (mcp.value.data ?? []).map((server) => ({
            name: server.name,
            runtimeStatus: server.runtimeStatus,
            authStatus: server.authStatus,
            toolCount: Object.keys(server.tools ?? {}).length,
            ...(server.name === "rove"
              ? {
                  catalogMatches:
                    JSON.stringify(Object.keys(server.tools ?? {}).sort()) ===
                    JSON.stringify([...expectedRoveCatalog.tools].sort()),
                  serverInfoName: server.serverInfo?.name ?? null,
                }
              : {}),
          })),
        }
      : mcp;
  progress("captured account, model, usage, rate-limit, and MCP projections");

  if (mcpBoundary) {
    progress("starting isolated required-MCP boundary");
    const fixturePath = resolve(here, "fixture-mcp-server.mjs");
    const fixtureConfig = {
      mcp_servers: {
        rove: {
          command: process.execPath,
          args: [fixturePath],
          env: {
            ROVE_TASK_ID: "task_alpha",
            ROVE_TASK_CAPABILITY: "rtcap_fixture_only",
          },
          enabled: true,
          required: true,
          startup_timeout_sec: 10,
        },
      },
    };
    const started = await client.request("thread/start", {
      cwd,
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      config: fixtureConfig,
    });
    const threadId = started.thread.id;
    const status = await client.request("mcpServerStatus/list", {
      threadId,
      detail: "full",
      limit: 100,
    });
    const rove = status.data.find((server) => server.name === "rove");
    const bound = await client.request("mcpServer/tool/call", {
      threadId,
      server: "rove",
      tool: "session.status",
      arguments: { roveTaskId: "task_alpha" },
    });
    const mismatched = await client.request("mcpServer/tool/call", {
      threadId,
      server: "rove",
      tool: "session.status",
      arguments: { roveTaskId: "task_other" },
    });
    const screenshot = await client.request("mcpServer/tool/call", {
      threadId,
      server: "rove",
      tool: "browser.screenshot",
      arguments: { roveTaskId: "task_alpha" },
    });
    evidence.requiredMcp = {
      name: rove?.name ?? null,
      serverInfoName: rove?.serverInfo?.name ?? null,
      runtimeStatus: rove?.runtimeStatus ?? null,
      authStatus: rove?.authStatus ?? null,
      toolCount: Object.keys(rove?.tools ?? {}).length,
      catalogMatches:
        JSON.stringify(Object.keys(rove?.tools ?? {}).sort()) ===
        JSON.stringify([...expectedRoveCatalog.tools].sort()),
      boundCallSucceeded: bound.isError !== true,
      mismatchedCallRejected: mismatched.isError === true,
      contentTypes: screenshot.content.map((item) => item.type),
    };

    const unavailable = await statusOf(
      client.request("thread/start", {
        cwd,
        ephemeral: true,
        config: {
          mcp_servers: {
            rove: {
              command: "/path/that/does/not/exist/rove-mcp",
              enabled: true,
              required: true,
              startup_timeout_sec: 1,
            },
          },
        },
      }),
    );
    evidence.requiredMcp.unavailableStart = {
      status: unavailable.status,
      code: unavailable.code ?? null,
      visiblyFailed: unavailable.status === "error",
    };
    progress("completed required-MCP calls and unavailable-server check");
  }

  if (lifecycle) {
    progress("starting lifecycle thread");
    const visibleModel =
      models.status === "ok"
        ? models.value.data?.find((model) => !model.hidden)
        : undefined;
    const started = await client.request("thread/start", {
      cwd,
      model: visibleModel?.model ?? visibleModel?.id,
      approvalPolicy: "never",
      sandbox: "read-only",
      serviceName: "rove-agent-schema-experiment",
      baseInstructions:
        "This is a protocol experiment. Follow response-format requests exactly. Only use the shell when explicitly asked to run sleep for the interruption probe.",
    });
    createdThreadId = started.thread.id;
    evidence.thread = {
      idRecorded: true,
      sessionIdRead: started.thread.sessionId ?? null,
      sessionIdWasDerived: false,
    };

    const turnStarted = await client.request("turn/start", {
      threadId: createdThreadId,
      input: [
        {
          type: "text",
          text: "Reply with exactly ROVE_P50_STREAM_OK",
          text_elements: [],
        },
      ],
    });
    const turnId = turnStarted.turn.id;
    await client.waitFor(
      (message) =>
        message.method === "turn/completed" &&
        message.params?.turn?.id === turnId,
      120_000,
    );
    evidence.turn = { started: true, completed: true, turnIdRecorded: true };

    const longTurn = await client.request("turn/start", {
      threadId: createdThreadId,
      input: [
        {
          type: "text",
          text: "Write a detailed 1500 word essay about deterministic state machines. Do not use tools.",
          text_elements: [],
        },
      ],
    });
    const longTurnId = longTurn.turn.id;
    const steer = await statusOf(
      client.request("turn/steer", {
        threadId: createdThreadId,
        expectedTurnId: longTurnId,
        input: [
          {
            type: "text",
            text: "Instead conclude with the token ROVE_P50_STEERED.",
            text_elements: [],
          },
        ],
      }),
    );
    const steerCompletion = await client.waitFor(
      (message) =>
        message.method === "turn/completed" &&
        message.params?.turn?.id === longTurnId,
      120_000,
    );
    evidence.steer = {
      status: steer.status,
      code: steer.code ?? null,
      message: steer.message ?? null,
      terminalStatus: steerCompletion.params?.turn?.status ?? null,
    };

    progress("running bounded interruption probe");
    const interruptAttempts = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const priorTurnIds = new Set(
        client.notifications
          .filter((message) => message.method === "turn/started")
          .map((message) => message.params?.turn?.id),
      );
      const shellStart = await statusOf(
        client.request("thread/shellCommand", {
          threadId: createdThreadId,
          command: "sleep 20",
          timeoutMs: 25_000,
        }),
      );
      const startedNotification = await statusOf(
        client.waitFor(
          (message) =>
            message.method === "turn/started" &&
            !priorTurnIds.has(message.params?.turn?.id),
          5_000,
        ),
      );
      const interruptTurnId =
        startedNotification.status === "ok"
          ? startedNotification.value.params?.turn?.id
          : null;
      const rpc = await statusOf(
        interruptTurnId
          ? client.request("turn/interrupt", {
              threadId: createdThreadId,
              turnId: interruptTurnId,
            })
          : Promise.reject(new Error("turn_started_notification_missing")),
      );
      const completion = await statusOf(
        interruptTurnId
          ? client.waitFor(
              (message) =>
                message.method === "turn/completed" &&
                message.params?.turn?.id === interruptTurnId,
              30_000,
            )
          : Promise.reject(new Error("turn_completion_unobservable")),
      );
      const terminalStatus =
        completion.status === "ok"
          ? (completion.value.params?.turn?.status ?? null)
          : null;
      interruptAttempts.push({
        attempt,
        shellStartStatus: shellStart.status,
        shellStartMessage: shellStart.message ?? null,
        turnIdRecorded: interruptTurnId !== null,
        rpcStatus: rpc.status,
        rpcCode: rpc.code ?? null,
        rpcMessage: rpc.message ?? null,
        terminalStatus,
        terminalError:
          completion.status === "error" ? completion.message : null,
      });
      if (rpc.status === "ok" && terminalStatus === "interrupted") break;
    }
    evidence.interrupt = {
      passed: interruptAttempts.some(
        (attempt) =>
          attempt.rpcStatus === "ok" &&
          attempt.terminalStatus === "interrupted",
      ),
      attempts: interruptAttempts,
    };

    const [read, listed, resumed] = await Promise.all([
      client.request("thread/read", {
        threadId: createdThreadId,
        includeTurns: true,
      }),
      client.request("thread/list", { limit: 20, archived: false }),
      client.request("thread/resume", { threadId: createdThreadId }),
    ]);
    evidence.thread.read = read.thread.id === createdThreadId;
    evidence.thread.listed = listed.data.some(
      (thread) => thread.id === createdThreadId,
    );
    evidence.thread.resumed = resumed.thread.id === createdThreadId;

    await client.request("thread/archive", { threadId: createdThreadId });
    await client.request("thread/unarchive", { threadId: createdThreadId });
    evidence.thread.archiveRoundTrip = true;

    allNotifications.push(...client.notifications);
    await client.stop();
    client = new AppServerClient();
    await client.start();
    await client.initialize();
    const recovered = await client.request("thread/read", {
      threadId: createdThreadId,
      includeTurns: true,
    });
    evidence.recovery = {
      processRestarted: true,
      threadRead: recovered.thread.id === createdThreadId,
      status: recovered.thread.status?.type ?? null,
      blindTurnReplay: false,
    };
    await client.request("thread/archive", { threadId: createdThreadId });
    evidence.thread.finalState = "archived";
    progress("completed restart recovery and archive cleanup");
  }
  allNotifications.push(...client.notifications);
  evidence.notificationCounts = notificationCounts(allNotifications);
} finally {
  if (createdThreadId && lifecycle) {
    try {
      await client.request(
        "thread/archive",
        { threadId: createdThreadId },
        5_000,
      );
    } catch {
      // Best-effort cleanup is reported by the recorded final state.
    }
  }
  await client.stop();
}

const verification = [];
function verify(condition, label) {
  verification.push({ label, passed: Boolean(condition) });
}
verify(
  evidence.preInitialize.rejected && evidence.preInitialize.code === -32600,
  "pre-initialize request rejected with -32600",
);
verify(
  evidence.malformedInput.exited === false &&
    evidence.malformedInput.parseDiagnosticObserved === true,
  "malformed JSON diagnosed without terminating server",
);
verify(
  typeof evidence.initialize?.userAgent === "string",
  "initialize returned user agent",
);
verify(evidence.account?.status === "ok", "account/read completed");
verify(
  evidence.models?.status === "ok" && evidence.models.count > 0,
  "model/list returned entries",
);
verify(evidence.mcp?.status === "ok", "mcpServerStatus/list completed");

if (mcpBoundary) {
  verify(evidence.requiredMcp?.name === "rove", "required MCP name is rove");
  verify(
    evidence.requiredMcp?.serverInfoName === "rove",
    "required MCP serverInfo name is rove",
  );
  verify(
    evidence.requiredMcp?.runtimeStatus === "connected",
    "required MCP connected",
  );
  verify(
    evidence.requiredMcp?.catalogMatches === true,
    "required MCP catalog matches fixture",
  );
  verify(
    evidence.requiredMcp?.boundCallSucceeded === true,
    "task-bound MCP call succeeded",
  );
  verify(
    evidence.requiredMcp?.mismatchedCallRejected === true,
    "mismatched task call rejected",
  );
  verify(
    evidence.requiredMcp?.contentTypes?.includes("text") &&
      evidence.requiredMcp?.contentTypes?.includes("image"),
    "typed text and image content observed",
  );
  verify(
    evidence.requiredMcp?.unavailableStart?.visiblyFailed === true &&
      evidence.requiredMcp?.unavailableStart?.code === -32603,
    "unavailable required MCP failed thread start with -32603",
  );
}

if (lifecycle) {
  verify(
    evidence.turn?.started && evidence.turn?.completed,
    "turn streamed to completion",
  );
  verify(
    evidence.steer?.status === "ok" &&
      evidence.steer?.terminalStatus === "completed",
    "steer RPC succeeded and turn completed",
  );
  verify(
    evidence.interrupt?.passed === true,
    "interrupt RPC succeeded and terminal status is interrupted",
  );
  verify(
    evidence.thread?.read &&
      evidence.thread?.listed &&
      evidence.thread?.resumed &&
      evidence.thread?.archiveRoundTrip,
    "thread read/list/resume/archive round trip succeeded",
  );
  verify(
    evidence.recovery?.processRestarted &&
      evidence.recovery?.threadRead &&
      evidence.recovery?.blindTurnReplay === false,
    "process restart recovered thread without blind replay",
  );
  verify(
    evidence.thread?.finalState === "archived",
    "experiment thread archived",
  );
}

evidence.verification = verification;
evidence.passed = verification.every(({ passed }) => passed);
console.log(JSON.stringify(evidence, null, 2));
progress(
  evidence.passed ? "all required evidence passed" : "required evidence failed",
);
if (isolatedCodexHome)
  await rm(isolatedCodexHome, { recursive: true, force: true });
requireEvidence(
  evidence.passed,
  verification
    .filter(({ passed }) => !passed)
    .map(({ label }) => label)
    .join(","),
);
