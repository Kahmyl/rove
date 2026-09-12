#!/usr/bin/env node
/* global fetch, setTimeout */

import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

import { CodexExecutionCore } from "../../../apps/companion/src/main/codex/execution-core.ts";
import { CodexAppServerHost } from "../../../apps/companion/src/main/codex/app-server-host.ts";
import { CodexExecutableResolver } from "../../../apps/companion/src/main/codex/compatibility.ts";
import { TaskAttachmentAuthority } from "../../../apps/companion/src/main/codex/task-attachments.ts";
import { DesktopHost } from "../../../apps/companion/src/main/host/desktop-host.ts";
import { CompanionRuntimeClient } from "../../../apps/companion/src/main/runtime-client.ts";

const root = resolve(import.meta.dirname, "../../..");
const home = process.env.ROVE_L2_HOME;
if (!home) throw new Error("ROVE_L2_HOME is required.");
const standin = join(import.meta.dirname, "app-server-standin.mjs");
const runtimeDirectory = join(root, "apps/runtime");
const runtimeEntrypoint = join(runtimeDirectory, "dist/main.js");
const mcpEntrypoint = join(root, "apps/mcp/dist/main.js");
const expectedDigest =
  "c147aa90d34139599711fb568102ceefc6319ca1ac5cb6f4056ca46a1834edd9";
const cutPoint = process.env.ROVE_TASK_ENGINE_CUT_POINT;
const cutCommand = process.env.ROVE_TASK_ENGINE_CUT_COMMAND;
const cutOccurrence = Number(process.env.ROVE_TASK_ENGINE_CUT_OCCURRENCE ?? 1);
if (!Number.isSafeInteger(cutOccurrence) || cutOccurrence < 1)
  throw new Error(
    "ROVE_TASK_ENGINE_CUT_OCCURRENCE must be a positive integer.",
  );
let matchingCutCount = 0;

let desktop;
let core;
let runtime;
let connection;
let detachDesktopEvent;
let attachmentAuthority;
let nextAttachmentSelection = null;

async function pauseAtCut(point, detail) {
  if (!cutPoint || cutPoint !== point) return;
  if (cutCommand && cutCommand !== detail.commandType) return;
  matchingCutCount += 1;
  if (matchingCutCount !== cutOccurrence) return;
  await writeFile(
    join(home, "task-engine-cut.json"),
    `${JSON.stringify({ point, ...detail, occurrence: matchingCutCount, desktopPid: process.pid })}\n`,
    { mode: 0o600 },
  );
  await new Promise(() => undefined);
}

function host() {
  return new CodexAppServerHost({
    resolver: new CodexExecutableResolver({
      isPackaged: false,
      developmentExecutablePath: standin,
      platform: "darwin",
      architecture: "arm64",
      readVersion: async () => "0.153.4",
      hashFile: async () => expectedDigest,
    }),
    clientVersion: "0.1.0",
    environment: {
      CODEX_HOME: join(home, "codex-product/codex-home"),
      ...(process.env.ROVE_L2_BAD_MCP_CATALOG === undefined
        ? {}
        : { ROVE_L2_BAD_MCP_CATALOG: process.env.ROVE_L2_BAD_MCP_CATALOG }),
    },
    restartPolicy: { maxAttempts: 5, baseDelayMs: 25, maxDelayMs: 100 },
  });
}

async function start() {
  desktop = new DesktopHost({
    runtimeDirectory,
    runtimeEntrypoint,
    runtimeNodeExecutable: process.execPath,
    home,
    browserHeadless: true,
    browser: "chromium",
    startupTimeoutMs: 15_000,
    restartPolicy: { maxAttempts: 5, baseDelayMs: 25, maxDelayMs: 100 },
  });
  connection = await desktop.start();
  const runtimeClient = new CompanionRuntimeClient({
    baseUrl: connection.runtime.baseUrl,
    token: connection.runtime.token,
  });
  runtime = countingRuntime(runtimeClient);
  const appServerHost = host();
  attachmentAuthority = new TaskAttachmentAuthority(
    join(home, "codex-product/task-attachments"),
    {
      select: async () => {
        const selected = nextAttachmentSelection;
        nextAttachmentSelection = null;
        return selected;
      },
    },
  );
  core = new CodexExecutionCore({
    isPackaged: false,
    clientVersion: "0.1.0",
    stateDirectory: join(home, "codex-product"),
    taskWorkingDirectory: home,
    runtime,
    mcpLaunch: {
      command: process.execPath,
      args: [mcpEntrypoint],
      environment: {
        ROVE_RUNTIME_URL: connection.runtime.baseUrl,
        ROVE_RUNTIME_TOKEN: connection.runtime.token,
      },
    },
    attachmentAuthority,
    attachmentRuntime: runtime,
    ...(cutPoint ? { onTaskEngineCut: pauseAtCut } : {}),
    appServerHost,
  });
  await core.start();
  detachDesktopEvent = desktop.onEvent((event) => {
    if (event.type === "runtime-recovered") void core.recover("Runtime");
  });
}

function countingRuntime(target) {
  const consequential = new Set([
    "startSession",
    "recoverSession",
    "endSession",
    "returnControlForSession",
    "materializeUserFile",
    "cleanupUserFileGrant",
  ]);
  return new Proxy(target, {
    get(instance, property) {
      const value = instance[property];
      if (typeof value !== "function") return value;
      if (!consequential.has(String(property))) return value.bind(instance);
      return async (...args) => {
        const result = await value.apply(instance, args);
        const path = join(home, "runtime-external-actions.json");
        const prior = await readJson(path, []);
        prior.push({
          method: String(property),
          correlation:
            property === "startSession"
              ? args[0]?.bootstrapId
              : property === "materializeUserFile"
                ? args[0]?.grantId
                : String(args[0]?.sessionId ?? args[0] ?? "unknown"),
          at: Date.now(),
        });
        await writeFile(path, `${JSON.stringify(prior, null, 2)}\n`, {
          mode: 0o600,
        });
        return result;
      };
    },
  });
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function stop() {
  detachDesktopEvent?.();
  detachDesktopEvent = undefined;
  await core?.stop().catch(() => undefined);
  await desktop?.stop().catch(() => undefined);
  core = undefined;
  desktop = undefined;
  runtime = undefined;
  connection = undefined;
}

async function managedRuntimePid() {
  const record = JSON.parse(
    await readFile(join(home, "managed-runtime.json"), "utf8"),
  );
  return record.runtimeProcessId;
}

async function processIdentities() {
  const record = JSON.parse(
    await readFile(join(home, "managed-runtime.json"), "utf8"),
  );
  return {
    desktopPid: process.pid,
    runtimePid: record.runtimeProcessId,
    runtimeBaseUrl: record.baseUrl,
    appServerPid: core.host.getProcessId(),
  };
}

async function runtimeRequest(path, init = {}) {
  const response = await fetch(`${connection.runtime.baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${connection.runtime.token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new Error(
      `Runtime HTTP ${response.status}: ${await response.text()}`,
    );
  return response.json();
}

async function waitFor(predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await Promise.resolve()
      .then(predicate)
      .catch(() => undefined);
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  let snapshot;
  try {
    snapshot = core ? await core.api().readSnapshot() : undefined;
  } catch {
    snapshot = undefined;
  }
  throw new Error(
    `L2 driver wait timed out.${
      snapshot === undefined
        ? ""
        : `\nLast product snapshot:\n${JSON.stringify(snapshot, null, 2)}`
    }\nApp Server health:\n${JSON.stringify(core?.host.getHealth(), null, 2)}`,
  );
}

async function execute(command) {
  if (command.type === "snapshot") return core.api().readSnapshot();
  if (command.type === "inventory") return runtime.listSessionInventory();
  if (command.type === "process.identities") return processIdentities();
  if (command.type === "appserver.requests") {
    const entries = JSON.parse(
      await readFile(
        join(home, "codex-product/codex-home/l2-app-server-commands.json"),
        "utf8",
      ),
    );
    return entries
      .filter((entry) =>
        ["thread/start", "thread/resume"].includes(entry.method),
      )
      .map((entry) => {
        const rove = entry.params?.config?.mcp_servers?.rove;
        return {
          method: entry.method,
          threadId: entry.params?.threadId ?? null,
          cwd: entry.params?.cwd ?? null,
          model: entry.params?.model ?? null,
          approvalsReviewer: entry.params?.approvalsReviewer ?? null,
          permissions: entry.params?.permissions ?? null,
          defaultPermissions: entry.params?.config?.default_permissions ?? null,
          reasoningEffort: entry.params?.config?.model_reasoning_effort ?? null,
          developerInstructions: entry.params?.developerInstructions ?? "",
          rove: rove
            ? {
                required: rove.required === true,
                enabled: rove.enabled === true,
                command: rove.command,
                args: rove.args,
                taskId: rove.env?.ROVE_TASK_ID,
                bootstrapId: rove.env?.ROVE_TASK_BOOTSTRAP_ID,
                sessionId: rove.env?.ROVE_TASK_SESSION_ID,
                mode: rove.env?.ROVE_TASK_EXECUTION_MODE,
                browserIdentity: rove.env?.ROVE_TASK_BROWSER_IDENTITY,
                capability: typeof rove.env?.ROVE_TASK_CAPABILITY === "string",
                verifier:
                  typeof rove.env?.ROVE_TASK_CAPABILITY_VERIFIER === "string",
              }
            : null,
        };
      });
  }
  if (command.type === "external.actions") {
    const appServer = await readJson(
      join(home, "codex-product/codex-home/l2-app-server-commands.json"),
      [],
    );
    const runtimeActions = await readJson(
      join(home, "runtime-external-actions.json"),
      [],
    );
    return {
      appServer: appServer.map((entry) => ({
        method: entry.method,
        correlation:
          entry.params?.clientUserMessageId ??
          entry.params?.threadSource ??
          entry.params?.threadId ??
          null,
      })),
      runtime: runtimeActions,
    };
  }
  if (command.type === "workspace.create")
    return runtime.createBrowserWorkspace(
      command.displayName ?? "L2 workspace",
    );
  if (command.type === "task.launch")
    return core.api().executeRendererIntent({
      type: "task.launch",
      operationId: command.operationId,
      input: command.input,
    });
  if (command.type === "task.finish")
    return core.api().execute({
      type: "task.close",
      taskId: command.taskId,
      operationId: command.operationId,
    });
  if (command.type === "browser.attach")
    return core.attachBrowser(command.taskId);
  if (command.type === "task.message")
    return core.api().executeRendererIntent({
      type: "task.message",
      taskId: command.taskId,
      operationId: command.operationId,
      outcome: command.message,
    });
  if (command.type === "task.return")
    return core.api().executeRendererIntent({
      type: "task.return-control",
      taskId: command.taskId,
      operationId: command.operationId,
    });
  if (command.type === "task.archive" || command.type === "task.unarchive")
    return core.api().executeRendererIntent({
      type: command.type === "task.unarchive" ? "task.restore" : command.type,
      taskId: command.taskId,
      operationId: command.operationId,
    });
  if (command.type === "attachment.prepare") {
    nextAttachmentSelection = [
      {
        filename: command.filename ?? "trace.txt",
        mimeType: command.mimeType ?? "text/plain",
        bytes: Buffer.from(command.content ?? "process-backed attachment"),
      },
    ];
    return core.api().executeRendererIntent({ type: "attachments.pick" });
  }
  if (command.type === "codex.attention") {
    const snapshot = await core.api().readSnapshot();
    const task = snapshot.tasks.find(
      (entry) => entry.taskId === command.taskId,
    );
    if (!task?.codexThreadId) throw new Error("Task is not Codex-bound.");
    const requestId = command.requestId ?? `approval_${Date.now()}`;
    await writeFile(
      join(home, "app-server-control.json"),
      `${JSON.stringify({
        requestId,
        method: "item/commandExecution/requestApproval",
        params: {
          environmentId: null,
          itemId: `item_${requestId}`,
          kind: "command",
          startedAtMs: 0,
          threadId: task.codexThreadId,
          turnId: task.conversation?.activeTurnId ?? "turn_l2_attention",
          command: "true",
          cwd: null,
          reason: "Process-backed approval",
          availableDecisions: null,
          commandActions: null,
          networkApprovalContext: null,
          proposedExecpolicyAmendment: null,
          proposedNetworkPolicyAmendments: null,
        },
      })}\n`,
      { mode: 0o600 },
    );
    process.kill(core.host.getProcessId(), "SIGUSR1");
    const observed = await waitFor(async () =>
      (await core.api().readSnapshot()).attention.find((entry) =>
        entry.requestId.endsWith(
          `:server:${typeof requestId}:${String(requestId)}`,
        ),
      ),
    );
    return { requestId: observed.requestId, wireRequestId: requestId };
  }
  if (command.type === "codex.attention.resolve") {
    const snapshot = await core.api().readSnapshot();
    const task = snapshot.tasks.find(
      (entry) => entry.taskId === command.taskId,
    );
    if (!task?.codexThreadId) throw new Error("Task is not Codex-bound.");
    await writeFile(
      join(home, "app-server-control.json"),
      `${JSON.stringify({
        method: "serverRequest/resolved",
        params: {
          requestId: command.wireRequestId,
          threadId: task.codexThreadId,
        },
      })}\n`,
      { mode: 0o600 },
    );
    process.kill(core.host.getProcessId(), "SIGUSR1");
    return { requestId: command.requestId };
  }
  if (command.type === "attention.decide")
    return core.api().executeRendererIntent({
      type: "attention.decide",
      taskId: command.taskId,
      requestId: command.requestId,
      generation: command.generation,
      decision: command.decision,
    });
  if (command.type === "codex.progress") {
    const snapshot = await core.api().readSnapshot();
    const task = snapshot.tasks.find(
      (entry) => entry.taskId === command.taskId,
    );
    if (!task?.codexThreadId) throw new Error("Task is not Codex-bound.");
    const turnId = task.conversation?.turnOrder.at(-1) ?? "turn_l2_progress";
    const itemId = `item_progress_${Date.now()}`;
    await writeFile(
      join(home, "app-server-control.json"),
      `${JSON.stringify({
        events: [
          {
            method: "item/agentMessage/delta",
            params: {
              threadId: task.codexThreadId,
              turnId,
              itemId,
              delta: command.text ?? "Process-backed progress",
            },
          },
          {
            method: "item/completed",
            params: {
              threadId: task.codexThreadId,
              turnId,
              completedAtMs: 1,
              item: {
                type: "agentMessage",
                id: itemId,
                text: command.text ?? "Process-backed progress",
                phase: null,
                memoryCitation: null,
                delivery: null,
                questions: null,
              },
            },
          },
        ],
      })}\n`,
      { mode: 0o600 },
    );
    process.kill(core.host.getProcessId(), "SIGUSR1");
    await waitFor(async () => {
      const current = await core.api().readSnapshot();
      const value = current.tasks.find(
        (entry) => entry.taskId === command.taskId,
      );
      return Boolean(value?.conversation?.items?.[itemId]);
    });
    return { itemId };
  }
  if (command.type === "recover") {
    await core.recover(command.source ?? "L2");
    return core.api().readSnapshot();
  }
  if (command.type === "runtime.kill") {
    const pid = await managedRuntimePid();
    const recovered = new Promise((resolveRecovered) => {
      const detach = desktop.onEvent((event) => {
        if (event.type !== "runtime-recovered") return;
        detach();
        resolveRecovered(undefined);
      });
    });
    process.kill(pid, "SIGKILL");
    await recovered;
    return {
      killedPid: pid,
      connection: desktop.getConnection(),
      identities: await processIdentities(),
    };
  }
  if (command.type === "runtime.kill.now") {
    const pid = await managedRuntimePid();
    process.kill(pid, "SIGKILL");
    return { killedPid: pid };
  }
  if (command.type === "appserver.kill") {
    const before = (
      await readJson(
        join(home, "codex-product/codex-home/l2-app-server-commands.json"),
        [],
      )
    ).filter((entry) => entry.method === "thread/resume").length;
    const pid = core.host.getProcessId();
    if (!pid) throw new Error("App Server stand-in is not running.");
    process.kill(pid, "SIGKILL");
    await waitFor(() => core.host.getHealth().state === "ready");
    await waitFor(async () => {
      const entries = await readJson(
        join(home, "codex-product/codex-home/l2-app-server-commands.json"),
        [],
      );
      return (
        entries.filter((entry) => entry.method === "thread/resume").length >
        before
      );
    });
    return { killedPid: pid, health: core.host.getHealth() };
  }
  if (command.type === "appserver.kill.now") {
    const pid = core.host.getProcessId();
    if (!pid) throw new Error("App Server stand-in is not running.");
    process.kill(pid, "SIGKILL");
    await waitFor(() => core.host.getHealth().state === "degraded");
    const health = core.host.getHealth();
    let deadSessionRequest;
    if (typeof command.threadId === "string") {
      try {
        await core.host.request("thread/read", {
          threadId: command.threadId,
          includeTurns: false,
        });
        deadSessionRequest = { rejected: false };
      } catch (error) {
        deadSessionRequest = {
          rejected: true,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return {
      killedPid: pid,
      health,
      ...(deadSessionRequest ? { deadSessionRequest } : {}),
    };
  }
  if (command.type === "appserver.ready") {
    await waitFor(() => core.host.getHealth().state === "ready");
    return {
      snapshot: await core.api().readSnapshot(),
      identities: await processIdentities(),
    };
  }
  if (command.type === "login.start") {
    const login = await core.api().execute({
      type: "account.login",
      loginType: "chatgpt",
    });
    const url = await core.api().resolveTrustedExternalUrl({
      purpose: "account_login",
      loginId: login.loginId,
    });
    return { login, url };
  }
  if (command.type === "handoff.prepare") {
    const snapshot = await core.api().readSnapshot();
    const task = snapshot.tasks.find((item) => item.taskId === command.taskId);
    if (!task?.roveSessionId || !task.codexThreadId)
      throw new Error("Task is not ready for a handoff.");
    const beforeHandoff = await runtime.getControlStatus(task.roveSessionId);
    if (
      beforeHandoff.status !== "active" ||
      beforeHandoff.controller !== "agent"
    )
      throw new Error(
        `L2 handoff precondition is not active agent control: ${JSON.stringify(beforeHandoff)}`,
      );
    let control;
    try {
      control = await runtimeRequest(
        `/sessions/${encodeURIComponent(task.roveSessionId)}/control/request-human`,
        {
          method: "POST",
          body: JSON.stringify({
            reason: "L2 local human step",
            instruction: "Inspect fresh truth and continue once.",
            continuationPolicy: "resume_after_control_return",
          }),
        },
      );
    } catch (error) {
      throw new Error(
        `L2 request-human failed after ${JSON.stringify(beforeHandoff)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let humanControl;
    try {
      humanControl = await runtimeRequest(
        `/sessions/${encodeURIComponent(task.roveSessionId)}/control/take`,
        { method: "POST", body: "{}" },
      );
    } catch (error) {
      throw new Error(
        `L2 take-control failed after ${JSON.stringify(control)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const appServerControlPath = join(home, "app-server-control.json");
    await writeFile(
      appServerControlPath,
      `${JSON.stringify({
        method: "item/completed",
        params: {
          threadId: task.codexThreadId,
          turnId: task.conversation?.turnOrder.at(-1) ?? "turn_l2_origin",
          completedAtMs: 1,
          item: {
            type: "mcpToolCall",
            id: `item_handoff_${control.generation}`,
            server: "rove",
            tool: "control.request_human",
            status: "completed",
            arguments: {
              sessionId: task.roveSessionId,
              reason: "L2 local human step",
              instruction: "Inspect fresh truth and continue once.",
              continuationPolicy: "resume_after_control_return",
            },
            appContext: null,
            pluginId: null,
            readOnlyHint: false,
            result: {
              _meta: null,
              structuredContent: null,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    sessionId: task.roveSessionId,
                    activeHandoffId: control.activeHandoffId,
                    generation: control.generation,
                    observationSeq: control.observationSeq,
                  }),
                },
              ],
            },
            error: null,
            durationMs: 1,
          },
        },
      })}\n`,
      { mode: 0o600 },
    );
    try {
      process.kill(core.host.getProcessId(), "SIGUSR1");
      await waitFor(async () => {
        const current = await core.api().readSnapshot();
        return current.attention.some(
          (entry) =>
            entry.taskId === command.taskId && entry.kind === "control_handoff",
        );
      });
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n` +
          `Request-human control:\n${JSON.stringify(control, null, 2)}\n` +
          `Human control:\n${JSON.stringify(humanControl, null, 2)}`,
      );
    }
    if (command.returnBeforeRestart === true)
      await runtime.returnControlForSession(task.roveSessionId);
    return { beforeHandoff, control, humanControl };
  }
  if (command.type === "handoff.status") {
    const snapshot = await core.api().readSnapshot();
    const task = snapshot.tasks.find((item) => item.taskId === command.taskId);
    if (!task?.roveSessionId) throw new Error("Task has no Runtime session.");
    return {
      control: await runtime.getControlStatus(task.roveSessionId),
      task,
    };
  }
  if (command.type === "handoff.return")
    return core.api().executeRendererIntent({
      type: "task.return-control",
      taskId: command.taskId,
      operationId: command.operationId,
    });
  if (command.type === "task.close.raw")
    return core.api().execute({
      type: "task.close",
      taskId: command.taskId,
      operationId: command.operationId,
    });
  if (command.type === "stop") {
    await stop();
    return { stopped: true };
  }
  throw new Error(`Unsupported driver command ${command.type}`);
}

function send(value) {
  process.stdout.write(`ROVE_L2:${JSON.stringify(value)}\n`);
}

await start();
send({
  event: "ready",
  ...(await processIdentities()),
  catalog: core.api().snapshot().catalog,
});

const lines = createInterface({ input: process.stdin });
let chain = Promise.resolve();
lines.on("line", (line) => {
  chain = chain.then(async () => {
    const message = JSON.parse(line);
    try {
      send({ id: message.id, result: await execute(message.command) });
    } catch (error) {
      send({
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await stop();
    process.exit(0);
  });
}
