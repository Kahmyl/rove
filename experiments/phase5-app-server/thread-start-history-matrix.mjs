#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { clearTimeout, setTimeout } from "node:timers";

const executable =
  process.env.ROVE_CODEX_EXECUTABLE ??
  "/Applications/ChatGPT.app/Contents/Resources/codex";
const cwd = resolve(process.cwd());
const fixture = resolve(
  process.cwd(),
  "experiments/phase5-app-server/fixture-mcp-server.mjs",
);

class Client {
  constructor(home, experimentalApi) {
    this.home = home;
    this.experimentalApi = experimentalApi;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = [];
  }

  async start() {
    this.child = spawn(executable, ["app-server", "--stdio"], {
      cwd,
      env: { ...process.env, CODEX_HOME: this.home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr.push(String(chunk).trim());
      this.stderr = this.stderr.slice(-30);
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id !== undefined && message.method !== undefined) {
        this.send({ id: message.id, result: { decision: "decline" } });
        return;
      }
      if (message.id === undefined) return;
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(String(message.id));
      if (message.error)
        pending.reject(
          Object.assign(new Error(message.error.message), {
            rpcError: message.error,
          }),
        );
      else pending.resolve(message.result);
    });
    this.exit = new Promise((resolveExit) => {
      this.child.once("exit", (code, signal) => resolveExit({ code, signal }));
    });
    await this.request("initialize", {
      clientInfo: {
        name: "rove_thread_start_matrix",
        title: "Rove thread start matrix",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: this.experimentalApi,
        requestAttestation: false,
      },
    });
    this.send({ method: "initialized", params: {} });
  }

  send(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeoutMs = 20_000) {
    const id = `matrix-${this.nextId++}`;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request_timeout:${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      this.send({ id, method, params });
    });
  }

  async stop() {
    if (!this.child || this.child.exitCode !== null) return;
    this.child.kill("SIGTERM");
    await Promise.race([
      this.exit,
      new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
    ]);
    if (this.child.exitCode === null) this.child.kill("SIGKILL");
  }
}

function baseConfig(withFixtureMcp) {
  return {
    ...(withFixtureMcp
      ? {
          mcp_servers: {
            rove: {
              command: process.execPath,
              args: [fixture],
              env: {
                ROVE_TASK_ID: "task_history_matrix",
                ROVE_TASK_SESSION_ID: "ses_history_matrix",
                ROVE_TASK_CAPABILITY: "rtcap_fixture_only",
              },
              enabled: true,
              required: true,
              startup_timeout_sec: 15,
            },
          },
        }
      : {}),
    web_search: "disabled",
    browser_use: {
      allow_history_access: false,
      default_origin_policy: {
        access: "deny",
        downloads: "deny",
        uploads: "deny",
        full_cdp_access: "deny",
      },
      origins: {},
    },
    computer_use: { default_app_access: "deny" },
  };
}

function errorEvidence(error) {
  const rpcError =
    error?.rpcError !== null && typeof error?.rpcError === "object"
      ? error.rpcError
      : undefined;
  const dataPresent = rpcError !== undefined && Object.hasOwn(rpcError, "data");
  return {
    message: error instanceof Error ? error.message : String(error),
    rpcErrorPresent: rpcError !== undefined,
    rpcErrorKeys: rpcError === undefined ? [] : Object.keys(rpcError).sort(),
    code: typeof rpcError?.code === "number" ? rpcError.code : null,
    dataPresent,
    ...(dataPresent ? { data: rpcError.data } : {}),
  };
}

async function runCell(experimentalApi, historyMode, withFixtureMcp) {
  const home = await mkdtemp(`${tmpdir()}/rove-thread-start-matrix-`);
  const client = new Client(home, experimentalApi);
  const startedAt = Date.now();
  let threadId;
  try {
    await client.start();
    const result = await client.request("thread/start", {
      cwd,
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
      ...(historyMode === undefined ? {} : { historyMode }),
      threadSource: `rove:task_history_matrix:${historyMode ?? "omitted"}:${withFixtureMcp ? "fixture" : "none"}`,
      experimentalRawEvents: false,
      developerInstructions: "Protocol-only thread creation experiment.",
      config: baseConfig(withFixtureMcp),
    });
    threadId = result.thread.id;
    let fullHistoryRead = null;
    if (historyMode === "legacy") {
      try {
        const read = await client.request("thread/read", {
          threadId,
          includeTurns: true,
        });
        fullHistoryRead = {
          outcome: "read",
          turnCount: read.thread.turns.length,
        };
      } catch (error) {
        fullHistoryRead = {
          outcome: "error",
          ...errorEvidence(error),
        };
      }
    }
    return {
      experimentalApi,
      historyMode: historyMode ?? "omitted",
      mcp: withFixtureMcp ? "fixture-required" : "none",
      outcome: "started",
      returnedHistoryMode: result.thread.historyMode,
      thread: {
        id: result.thread.id,
        sessionId: result.thread.sessionId,
        threadSource: result.thread.threadSource,
        historyMode: result.thread.historyMode,
        status: result.thread.status,
        turnCount: result.thread.turns.length,
      },
      fullHistoryRead,
      elapsedMs: Date.now() - startedAt,
      stderr: client.stderr,
    };
  } catch (error) {
    return {
      experimentalApi,
      historyMode: historyMode ?? "omitted",
      mcp: withFixtureMcp ? "fixture-required" : "none",
      outcome: error.message.startsWith("request_timeout:")
        ? "timeout"
        : "error",
      error: errorEvidence(error),
      elapsedMs: Date.now() - startedAt,
      stderr: client.stderr,
    };
  } finally {
    if (threadId)
      await client
        .request("thread/archive", { threadId }, 5_000)
        .catch(() => undefined);
    await client.stop().catch(() => undefined);
    await rm(home, { recursive: true, force: true });
  }
}

function threadMetadata(thread) {
  return {
    id: thread.id,
    sessionId: thread.sessionId,
    threadSource: thread.threadSource,
    historyMode: thread.historyMode,
    status: thread.status,
    preview: thread.preview,
    name: thread.name,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    recencyAt: thread.recencyAt,
    turnCount: thread.turns.length,
  };
}

async function captureRequest(client, method, params) {
  try {
    const value = await client.request(method, params);
    return { outcome: "ok", value };
  } catch (error) {
    return {
      outcome: "error",
      ...errorEvidence(error),
    };
  }
}

async function crossProcessNoMessage() {
  const home = await mkdtemp(`${tmpdir()}/rove-thread-restart-matrix-`);
  const source = "rove:task_history_restart:legacy:fixture";
  let threadId;
  let processA;
  let processB;
  try {
    processA = new Client(home, true);
    await processA.start();
    const started = await processA.request("thread/start", {
      cwd,
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
      historyMode: "legacy",
      threadSource: source,
      experimentalRawEvents: false,
      developerInstructions: "Protocol-only restart experiment.",
      config: baseConfig(true),
    });
    threadId = started.thread.id;
    const processAThread = threadMetadata(started.thread);
    await processA.stop();
    processA = undefined;

    processB = new Client(home, true);
    await processB.start();
    const listedActive = await processB.request("thread/list", {
      limit: 100,
      archived: false,
    });
    const listedArchivedBefore = await processB.request("thread/list", {
      limit: 100,
      archived: true,
    });
    const readMetadataBefore = await captureRequest(processB, "thread/read", {
      threadId,
      includeTurns: false,
    });
    const readFullBefore = await captureRequest(processB, "thread/read", {
      threadId,
      includeTurns: true,
    });
    const resumed = await captureRequest(processB, "thread/resume", {
      threadId,
      cwd,
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
      config: baseConfig(true),
      excludeTurns: false,
      developerInstructions: "Protocol-only restart experiment.",
    });
    const readMetadataAfter = await captureRequest(processB, "thread/read", {
      threadId,
      includeTurns: false,
    });
    const readFullAfter = await captureRequest(processB, "thread/read", {
      threadId,
      includeTurns: true,
    });
    const archived = await captureRequest(processB, "thread/archive", {
      threadId,
    });
    const listedArchivedAfter = await processB.request("thread/list", {
      limit: 100,
      archived: true,
    });
    return {
      homeWasIsolated: true,
      processA: processAThread,
      processB: {
        listedActive: listedActive.data.map(threadMetadata),
        listedArchivedBefore: listedArchivedBefore.data.map(threadMetadata),
        readMetadataBefore,
        readFullBefore,
        resume:
          resumed.outcome === "ok"
            ? {
                outcome: "ok",
                thread: threadMetadata(resumed.value.thread),
                initialTurnsPage: resumed.value.initialTurnsPage,
                turnsBackwardsCursor: resumed.value.turnsBackwardsCursor,
              }
            : resumed,
        readMetadataAfter,
        readFullAfter,
        archive: archived,
        listedArchivedAfter: listedArchivedAfter.data.map(threadMetadata),
      },
    };
  } finally {
    if (threadId && processB)
      await processB
        .request("thread/archive", { threadId }, 5_000)
        .catch(() => undefined);
    await processA?.stop().catch(() => undefined);
    await processB?.stop().catch(() => undefined);
    await rm(home, { recursive: true, force: true });
  }
}

const cells = [];
for (const withFixtureMcp of [false, true])
  for (const variant of [
    { experimentalApi: false, historyMode: undefined },
    { experimentalApi: false, historyMode: "legacy" },
    { experimentalApi: true, historyMode: "legacy" },
  ])
    cells.push(
      await runCell(
        variant.experimentalApi,
        variant.historyMode,
        withFixtureMcp,
      ),
    );

const restart = await crossProcessNoMessage();

process.stdout.write(
  `${JSON.stringify({ executable, cells, crossProcessNoMessage: restart }, null, 2)}\n`,
);
