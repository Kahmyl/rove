#!/usr/bin/env node

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { URL } from "node:url";

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.153.4\n");
  process.exit(0);
}

const codexHome = process.env.CODEX_HOME;
if (!codexHome) throw new Error("CODEX_HOME is required.");
await mkdir(codexHome, { recursive: true, mode: 0o700 });
const statePath = join(codexHome, "l2-app-server-state.json");
const commandPath = join(codexHome, "l2-app-server-commands.json");
const controlPath = join(codexHome, "..", "..", "app-server-control.json");

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

const state = await readJson(statePath, {
  nextThread: 1,
  nextTurn: 1,
  threads: {},
  archived: {},
  logins: {},
  callbackGeneration: 0,
});
const commands = await readJson(commandPath, []);
state.approvalsReviewers ??= {};
const threadMcp = new Map();
let persistChain = Promise.resolve();

function persist() {
  const stateJson = `${JSON.stringify(state, null, 2)}\n`;
  const commandJson = `${JSON.stringify(commands, null, 2)}\n`;
  const operation = persistChain.then(async () => {
    const stateTemporary = `${statePath}.tmp`;
    const commandTemporary = `${commandPath}.tmp`;
    await Promise.all([
      writeFile(stateTemporary, stateJson, { mode: 0o600 }),
      writeFile(commandTemporary, commandJson, { mode: 0o600 }),
    ]);
    await Promise.all([
      rename(stateTemporary, statePath),
      rename(commandTemporary, commandPath),
    ]);
  });
  persistChain = operation.catch(() => undefined);
  return operation;
}

function turn(id, status = "completed", clientId, input = []) {
  return {
    id,
    items:
      typeof clientId === "string"
        ? [
            {
              type: "userMessage",
              id: `item_${id}`,
              content: input,
              clientId,
            },
          ]
        : [],
    itemsView: "full",
    status,
    error: null,
    startedAt: 1,
    completedAt: status === "inProgress" ? null : 2,
    durationMs: status === "inProgress" ? null : 1,
  };
}

function createThread(params) {
  const id = `thread_l2_${state.nextThread++}`;
  const value = {
    id,
    extra: null,
    sessionId: `codex_session_l2_${id}`,
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: params.historyMode ?? "legacy",
    modelProvider: "openai",
    model: params.model ?? "l2-model",
    reasoningEffort: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    recencyAt: Date.now(),
    cwd: params.cwd ?? codexHome,
    cliVersion: "0.153.4",
    status: { type: "idle" },
    path: null,
    source: "appServer",
    canAcceptDirectInput: true,
    turns: [],
    threadSource: params.threadSource ?? null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
  };
  state.threads[id] = value;
  state.approvalsReviewers[id] = params.approvalsReviewer ?? "user";
  return value;
}

function validateNamedPermissions(params) {
  const profiles = params.config?.permissions;
  if (!profiles || typeof profiles !== "object") return;
  const selected = params.config?.default_permissions;
  if (typeof selected !== "string" || selected.length === 0)
    throw new Error(
      "config defines `[permissions]` profiles but does not set `default_permissions`",
    );
  if (!Object.hasOwn(profiles, selected))
    throw new Error("default_permissions does not name a configured profile");
  if (params.permissions !== selected)
    throw new Error("thread permissions do not match default_permissions");
}

function threadStartResponse(thread) {
  return {
    activePermissionProfile: null,
    approvalPolicy: "on-request",
    approvalsReviewer: state.approvalsReviewers[thread.id] ?? "user",
    cwd: thread.cwd,
    instructionSources: [],
    model: thread.model ?? "l2-model",
    modelProvider: "openai",
    multiAgentMode: "explicitRequestOnly",
    reasoningEffort: thread.reasoningEffort,
    runtimeWorkspaceRoots: [],
    sandbox: { type: "readOnly", networkAccess: false },
    serviceTier: null,
    thread,
  };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function event(method, params, requestId) {
  send(
    requestId === undefined
      ? { method, params }
      : { id: requestId, method, params },
  );
}

async function readMcpDefinitions(config) {
  const launch = config?.mcp_servers?.rove;
  if (!launch?.command || !Array.isArray(launch.args))
    throw new Error("Thread has no L2 Rove MCP launch config.");
  const child = spawn(launch.command, launch.args, {
    env: { ...process.env, ...launch.env, ROVE_MCP_TRANSPORT: "stdio" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  let id = 0;
  const request = (method, params) =>
    new Promise((resolveRequest, rejectRequest) => {
      const requestId = ++id;
      pending.set(requestId, {
        resolve: resolveRequest,
        reject: rejectRequest,
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`,
      );
    });
  try {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "l2-app-server", version: "0.1.0" },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    const tools = (await request("tools/list", {})).tools;
    return process.env.ROVE_L2_BAD_MCP_CATALOG === "1" ? tools.slice(1) : tools;
  } finally {
    lines.close();
    child.kill("SIGTERM");
  }
}

let callbackServer;
let activeCallback;

async function stopCallback() {
  const server = callbackServer;
  callbackServer = undefined;
  activeCallback = undefined;
  if (server)
    await new Promise((resolve) => server.close(() => resolve(undefined)));
}

async function startCallback(loginId) {
  const generation = ++state.callbackGeneration;
  if (!callbackServer) {
    callbackServer = createServer(async (request, response) => {
      const current = activeCallback;
      const callbackUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const callbackGeneration = Number(
        callbackUrl.searchParams.get("generation"),
      );
      const callbackLoginId = callbackUrl.searchParams.get("loginId");
      if (
        !current ||
        current.generation !== callbackGeneration ||
        current.loginId !== callbackLoginId
      ) {
        response.writeHead(410).end("stale callback");
        return;
      }
      activeCallback = undefined;
      state.logins[current.loginId] = "completed";
      response.writeHead(200, { "content-type": "text/plain" }).end("complete");
      event("account/login/completed", {
        loginId: current.loginId,
        success: true,
        error: null,
        onboardingEntrypoint: null,
      });
      await persist();
      await stopCallback();
    });
    await new Promise((resolve) =>
      callbackServer.listen(0, "127.0.0.1", resolve),
    );
  }
  const address = callbackServer.address();
  if (!address || typeof address === "string")
    throw new Error("No callback port.");
  activeCallback = { loginId, generation, port: address.port };
  return `https://example.invalid/login?redirect_uri=${encodeURIComponent(`http://127.0.0.1:${address.port}/callback?generation=${generation}&loginId=${encodeURIComponent(loginId)}`)}`;
}

async function handle(method, params = {}) {
  commands.push({ method, params, at: Date.now() });
  if (method === "initialize")
    return {
      userAgent: "codex-cli 0.153.4",
      codexHome,
      platformFamily: "unix",
      platformOs: "macos",
    };
  if (method === "account/read")
    return {
      account: {
        type: "chatgpt",
        email: "l2-redacted@example.invalid",
        planType: "pro",
      },
      requiresOpenaiAuth: true,
    };
  if (method === "model/list")
    return {
      data: [
        {
          id: "l2-model",
          model: "l2-model",
          additionalSpeedTiers: [],
          upgrade: null,
          upgradeInfo: null,
          availabilityNux: null,
          displayName: "L2 deterministic model",
          description: "Local protocol stand-in",
          modelSpecialty: null,
          multiAgentVersion: null,
          hidden: false,
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Deterministic" },
          ],
          defaultReasoningEffort: "low",
          inputModalities: ["text"],
          supportsPersonality: false,
          defaultServiceTier: null,
          serviceTiers: [],
          isDefault: true,
        },
      ],
      nextCursor: null,
    };
  if (method === "account/rateLimits/read")
    return {
      rateLimits: {
        limitId: null,
        limitName: null,
        primary: null,
        secondary: null,
        planType: "pro",
        credits: null,
        individualLimit: null,
        rateLimitReachedType: null,
        spendControlReached: null,
      },
      rateLimitsByLimitId: null,
      accountId: null,
      rateLimitResetCredits: null,
      rateLimitUpsell: null,
    };
  if (method === "account/usage/read")
    return {
      summary: {
        currentStreakDays: null,
        lifetimeTokens: null,
        longestRunningTurnSec: null,
        longestStreakDays: null,
        peakDailyTokens: null,
      },
      dailyUsageBuckets: null,
    };
  if (method === "account/logout") return {};
  if (method === "account/login/start") {
    const loginId = `login_l2_${state.callbackGeneration + 1}`;
    state.logins[loginId] = "pending";
    const authUrl = await startCallback(loginId);
    await persist();
    return params.type === "chatgptDeviceCode"
      ? {
          type: "chatgptDeviceCode",
          loginId,
          verificationUrl: "https://example.invalid/device",
          userCode: "L2-LOCAL",
        }
      : { type: "chatgpt", loginId, authUrl };
  }
  if (method === "account/login/cancel") {
    state.logins[params.loginId] = "cancelled";
    await stopCallback();
    await persist();
    return { status: "cancelled" };
  }
  if (method === "thread/start") {
    validateNamedPermissions(params);
    const thread = createThread(params);
    threadMcp.set(thread.id, await readMcpDefinitions(params.config));
    await persist();
    return threadStartResponse(thread);
  }
  if (method === "thread/list") {
    const archived = params.archived === true;
    return {
      data: Object.values(state.threads).filter(
        (item) => Boolean(state.archived[item.id]) === archived,
      ),
      nextCursor: null,
      backwardsCursor: null,
    };
  }
  if (method === "thread/read" || method === "thread/resume") {
    const thread = state.threads[params.threadId];
    if (!thread) throw new Error("Unknown L2 thread.");
    if (method === "thread/resume") {
      validateNamedPermissions(params);
      threadMcp.set(thread.id, await readMcpDefinitions(params.config));
    }
    return method === "thread/resume"
      ? {
          ...threadStartResponse(thread),
          initialTurnsPage: null,
          itemsBackwardsCursor: null,
          turnsBackwardsCursor: null,
        }
      : { thread };
  }
  if (method === "thread/archive") {
    state.archived[params.threadId] = true;
    await persist();
    event("thread/archived", { threadId: params.threadId });
    return {};
  }
  if (method === "thread/unarchive") {
    state.archived[params.threadId] = false;
    await persist();
    const thread = state.threads[params.threadId];
    event("thread/unarchived", { threadId: params.threadId });
    return { thread };
  }
  if (method === "turn/start") {
    const thread = state.threads[params.threadId];
    if (!thread) throw new Error("Unknown L2 thread.");
    const value = turn(
      `turn_l2_${state.nextTurn++}`,
      "completed",
      params.clientUserMessageId,
      params.input,
    );
    thread.turns.push(value);
    thread.updatedAt = Date.now();
    await persist();
    event("turn/started", {
      threadId: thread.id,
      turn: { ...value, status: "inProgress" },
    });
    for (const item of value.items)
      event("item/completed", {
        threadId: thread.id,
        turnId: value.id,
        item,
        completedAtMs: 0,
      });
    event("turn/completed", { threadId: thread.id, turn: value });
    return { turn: value };
  }
  if (method === "turn/steer") return { turnId: params.expectedTurnId };
  if (method === "turn/interrupt") {
    const thread = state.threads[params.threadId];
    const active = thread?.turns.find((item) => item.id === params.turnId);
    if (active) active.status = "interrupted";
    await persist();
    return {};
  }
  if (method === "mcpServerStatus/list")
    return {
      data: threadMcp.has(params.threadId)
        ? [
            {
              name: "rove",
              runtimeStatus: "connected",
              pluginId: null,
              serverInfo: {
                name: "rove",
                title: null,
                version: "0.1.0",
                description: null,
                websiteUrl: null,
                icons: [],
              },
              tools: Object.fromEntries(
                threadMcp.get(params.threadId).map((tool) => [tool.name, tool]),
              ),
              resources: [],
              resourceTemplates: [],
              authStatus: "unsupported",
            },
          ]
        : [],
      nextCursor: null,
    };
  throw new Error(`Unsupported L2 method ${method}`);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const line = input.slice(0, index);
    input = input.slice(index + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.method === "initialized" || message.id === undefined) continue;
    if (typeof message.method !== "string") continue;
    try {
      const result = await handle(message.method, message.params);
      await persist();
      send({ id: message.id, result });
    } catch (error) {
      send({
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stopCallback();
    await persist();
    process.exit(0);
  });
}

process.on("SIGUSR1", async () => {
  try {
    const command = JSON.parse(await readFile(controlPath, "utf8"));
    if (Array.isArray(command.events)) {
      for (const value of command.events)
        event(value.method, value.params, value.requestId);
      return;
    }
    if (typeof command.method !== "string" || !command.params)
      throw new Error("Invalid App Server control event.");
    event(command.method, command.params, command.requestId);
  } catch (error) {
    process.stderr.write(
      `App Server control event failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
});
