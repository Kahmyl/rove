#!/usr/bin/env node
/* global AbortSignal, fetch, setTimeout, window */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import { LocalProductApi } from "../../apps/companion/dist/main/main/codex/local-product-api.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const l2Root = join(root, "experiments/agent-execution/recovery-harness");
const driverPath = join(l2Root, "desktop-host-driver.mjs");
const artifactRoot = join(
  root,
  "artifacts/verification/process-recovery",
);
const rendererRoot = join(root, "apps/companion/dist/renderer");
const temporaryRoot = await mkdtemp(join(tmpdir(), "rove-process-recovery-"));
const scenarios = JSON.parse(
  await readFile(join(l2Root, "scenarios.json"), "utf8"),
);
const results = [];
const requireBrowser = createRequire(
  join(root, "packages/browser/package.json"),
);
const requireCompanion = createRequire(
  join(root, "apps/companion/package.json"),
);
const tsxLoader = requireCompanion.resolve("tsx");
const { chromium } = requireBrowser("playwright");
const activeDrivers = new Set();
const activeResources = new Set();
const ownedPids = new Set();
const ownedUrls = new Set();
const terminalObservations = [];

function trackIdentities(identities) {
  for (const pid of [
    identities?.desktopPid,
    identities?.runtimePid,
    identities?.appServerPid,
  ])
    if (Number.isInteger(pid)) ownedPids.add(pid);
  if (typeof identities?.runtimeBaseUrl === "string")
    ownedUrls.add(identities.runtimeBaseUrl);
}

function registerResource(dispose) {
  activeResources.add(dispose);
  return () => activeResources.delete(dispose);
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function progress(message) {
  process.stdout.write(`[process-recovery] ${message}\n`);
}

function operation(seed) {
  return `intent_${seed.repeat(8)}-${seed.repeat(4)}-4${seed.repeat(3)}-8${seed.repeat(3)}-${seed.repeat(12)}`;
}

function alive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function waitFor(read, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await Promise.resolve()
      .then(read)
      .catch(() => undefined);
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error("L2 qualification wait timed out.");
}

async function materializedLaunch(driver, acceptance, operationId) {
  const taskId = acceptance?.aggregate?.taskId;
  check(
    typeof taskId === "string" && taskId.length > 0,
    `Task launch did not return the current TaskAcceptance shape: ${JSON.stringify(acceptance)}`,
  );
  check(
    acceptance.aggregate.launch?.operationId === operationId,
    "Task launch acceptance did not preserve the submitted operation identity.",
  );
  return waitFor(async () => {
    const snapshot = await driver.request({ type: "snapshot" });
    const task = snapshot.tasks.find((entry) => entry.taskId === taskId);
    const items = Object.values(task?.conversation?.items ?? {});
    return task?.initialLaunch?.operationId === operationId &&
      task.bootstrapStage === "complete" &&
      task.lifecycle?.phase === "ready" &&
      task.conversation?.turnStatus === "completed" &&
      items.some(
        (item) =>
          item?.kind === "user_message" && item.clientId === operationId,
      )
      ? task
      : undefined;
  });
}

async function finishAndWait(driver, taskId, operationId) {
  const before = await driver.request({ type: "snapshot" });
  const task = before.tasks.find((entry) => entry.taskId === taskId);
  const expectedOperation = task?.availableActions.includes("finish")
    ? "finish"
    : task?.availableActions.includes("retry_cleanup")
      ? "retry_cleanup"
      : null;
  check(
    expectedOperation !== null,
    `Task does not currently expose a supported close operation: ${JSON.stringify(task)}`,
  );
  const acceptance = await driver.request({
    type: "task.finish",
    taskId,
    operationId,
  });
  check(
    acceptance?.aggregate?.taskId === taskId &&
      acceptance.aggregate.requestedOperation?.type === expectedOperation &&
      acceptance.aggregate.requestedOperation.operationId === operationId &&
      acceptance.projection?.operationDisposition?.type === expectedOperation &&
      acceptance.projection.operationDisposition.operationId === operationId &&
      acceptance.projection.operationDisposition.status === "accepted" &&
      acceptance.projection.phase === "closing",
    `Task Finish did not return the current accepted-close state: ${JSON.stringify(acceptance)}`,
  );
  return waitFor(async () => {
    const snapshot = await driver.request({ type: "snapshot" });
    const task = snapshot.tasks.find((entry) => entry.taskId === taskId);
    return task?.lifecycle?.phase === "closed" ? task : undefined;
  });
}

class Driver {
  constructor(home, options = {}) {
    this.home = home;
    this.options = options;
    this.nextId = 0;
    this.pending = new Map();
    this.stderr = "";
  }

  async start() {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    this.child = spawn(process.execPath, ["--import", tsxLoader, driverPath], {
      cwd: root,
      env: {
        ...process.env,
        ROVE_L2_HOME: this.home,
        ...(this.options.cutPoint
          ? { ROVE_TASK_ENGINE_CUT_POINT: this.options.cutPoint }
          : {}),
        ...(this.options.cutCommand
          ? { ROVE_TASK_ENGINE_CUT_COMMAND: this.options.cutCommand }
          : {}),
        ...(this.options.cutOccurrence
          ? {
              ROVE_TASK_ENGINE_CUT_OCCURRENCE: String(
                this.options.cutOccurrence,
              ),
            }
          : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    activeDrivers.add(this);
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-8_000);
    });
    let buffer = "";
    const ready = new Promise((resolveReady, rejectReady) => {
      this.resolveReady = resolveReady;
      this.rejectReady = rejectReady;
    });
    this.child.stdout.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n");
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.startsWith("ROVE_L2:")) continue;
        const message = JSON.parse(line.slice("ROVE_L2:".length));
        if (message.event === "ready") {
          this.ready = message;
          trackIdentities(message);
          this.resolveReady(message);
          continue;
        }
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        if (message.error)
          pending.reject(
            new Error(
              `L2 driver command ${pending.commandType} failed: ${message.error}`,
            ),
          );
        else {
          trackIdentities(message.result?.identities);
          pending.resolve(message.result);
        }
      }
    });
    this.child.once("exit", (code, signal) => {
      const error = new Error(
        `L2 Desktop driver exited (${code ?? signal ?? "unknown"}). ${this.stderr}`,
      );
      this.rejectReady?.(error);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    return Promise.race([
      ready,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Driver startup timed out. ${this.stderr}`)),
          20_000,
        ),
      ),
    ]);
  }

  request(command) {
    const id = ++this.nextId;
    return new Promise((resolveRequest, rejectRequest) => {
      this.pending.set(id, {
        resolve: resolveRequest,
        reject: rejectRequest,
        commandType: command.type,
      });
      this.child.stdin.write(`${JSON.stringify({ id, command })}\n`);
    });
  }

  send(command) {
    const id = ++this.nextId;
    this.child.stdin.write(`${JSON.stringify({ id, command })}\n`);
    return id;
  }

  waitForCut() {
    return waitFor(async () =>
      JSON.parse(
        await readFile(join(this.home, "task-engine-cut.json"), "utf8"),
      ),
    );
  }

  async stop() {
    if (!this.child || this.child.exitCode !== null) {
      activeDrivers.delete(this);
      return;
    }
    const desktopPid = this.child.pid;
    await this.request({ type: "process.identities" }).catch(() => undefined);
    await this.request({ type: "stop" }).catch(() => undefined);
    this.child.stdin.end();
    await waitFor(
      () => this.child.exitCode !== null || this.child.signalCode !== null,
      5_000,
    ).catch(() => undefined);
    if (alive(desktopPid)) this.child.kill("SIGKILL");
    await waitFor(() => !alive(desktopPid), 5_000);
    activeDrivers.delete(this);
  }

  async crash() {
    let managed;
    try {
      managed = JSON.parse(
        await readFile(join(this.home, "managed-runtime.json"), "utf8"),
      );
      trackIdentities({
        runtimePid: managed.runtimeProcessId,
        runtimeBaseUrl: managed.baseUrl,
      });
    } catch {
      managed = undefined;
    }
    const identities = this.ready;
    if (this.child && this.child.exitCode === null) this.child.kill("SIGKILL");
    for (const pid of [identities?.appServerPid, managed?.runtimeProcessId]) {
      if (alive(pid)) process.kill(pid, "SIGKILL");
    }
    await waitFor(() => !alive(identities?.desktopPid)).catch(() => undefined);
    activeDrivers.delete(this);
  }
}

async function recordTerminalState(driver, label) {
  const [inventory, snapshot] = await Promise.all([
    driver.request({ type: "inventory" }),
    driver.request({ type: "snapshot" }),
  ]);
  const observation = {
    label,
    attachedBrowsers: inventory.filter(
      (entry) => entry.attachment === "attached",
    ).length,
    nonterminalRuntimeSessions: inventory.filter(
      (entry) => !["completed", "failed"].includes(entry.session.status),
    ).length,
    cleanupRequiredProductTasks: snapshot.tasks.filter(
      (task) => task.lifecycle.phase === "cleanup_required",
    ).length,
    cleanupRequiredDetails: snapshot.tasks
      .filter((task) => task.lifecycle.phase === "cleanup_required")
      .map((task) => ({
        taskId: task.taskId,
        reason: task.lifecycle.reason,
        operation: task.operation,
      })),
  };
  check(
    Object.entries(observation)
      .filter(([key]) => key !== "label" && key !== "cleanupRequiredDetails")
      .every(([, value]) => value === 0),
    `${label} did not reach terminal cleanup: ${JSON.stringify(observation)}`,
  );
  terminalObservations.push(observation);
}

async function commands(home) {
  try {
    return JSON.parse(
      await readFile(
        join(home, "codex-product/codex-home/l2-app-server-commands.json"),
        "utf8",
      ),
    );
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function counts(entries) {
  return Object.fromEntries(
    [...new Set(entries.map((entry) => entry.method))]
      .sort()
      .map((method) => [
        method,
        entries.filter((entry) => entry.method === method).length,
      ]),
  );
}

async function runCoreScenarios() {
  progress("named Desktop restart");
  const home = join(temporaryRoot, "core");
  let driver = new Driver(home);
  await driver.start();
  check(
    driver.ready.catalog.account.status === "logged_in",
    `Stand-in account projection failed: ${JSON.stringify(driver.ready.catalog)}`,
  );
  const workspace = await driver.request({
    type: "workspace.create",
    displayName: "L2 named",
  });

  const namedOperation = operation("1");
  const namedAcceptance = await driver.request({
    type: "task.launch",
    operationId: namedOperation,
    input: {
      outcome: "Complete the deterministic named-workspace task",
      executionMode: "agent",
      approvalsReviewer: "auto_review",
      browserIdentity: { mode: "workspace", workspaceId: workspace.id },
      model: "l2-model",
      reasoningEffort: "low",
    },
  });
  const named = await materializedLaunch(
    driver,
    namedAcceptance,
    namedOperation,
  );
  const namedTask = named.taskId;
  const beforeRestart = await driver.request({ type: "snapshot" });
  const beforeCommands = await commands(home);
  const firstProcessSet = await driver.request({ type: "process.identities" });
  await driver.stop();
  driver = new Driver(home);
  await driver.start();
  const replacementProcessSet = await driver.request({
    type: "process.identities",
  });
  const replacementPids = [
    replacementProcessSet.desktopPid,
    replacementProcessSet.runtimePid,
    replacementProcessSet.appServerPid,
  ];
  check(
    new Set(replacementPids).size === 3 && replacementPids.every(alive),
    `Replacement Desktop stack was not exactly three live processes: ${JSON.stringify(replacementProcessSet)}`,
  );
  check(
    [
      firstProcessSet.desktopPid,
      firstProcessSet.runtimePid,
      firstProcessSet.appServerPid,
    ].every((pid) => !alive(pid)),
    "Original Desktop stack remained alive after replacement startup.",
  );
  const afterRestart = await driver.request({ type: "snapshot" });
  const recoveredNamed = afterRestart.tasks.find(
    (task) => task.taskId === namedTask,
  );
  check(recoveredNamed, "Named task disappeared after Desktop restart.");
  check(
    recoveredNamed.roveSessionId === named.roveSessionId,
    "Named Runtime session identity changed.",
  );
  check(
    recoveredNamed.browserIdentity.workspaceId === workspace.id,
    "Named workspace identity changed.",
  );
  const afterCommands = await commands(home);
  check(
    counts(afterCommands)["thread/start"] ===
      counts(beforeCommands)["thread/start"],
    "Desktop restart replayed thread/start.",
  );
  check(
    counts(afterCommands)["turn/start"] ===
      counts(beforeCommands)["turn/start"],
    "Desktop restart replayed the user turn.",
  );
  await finishAndWait(driver, namedTask, operation("2"));
  results.push({
    id: "named-desktop-restart",
    status: "passed",
    desktopBoots: 2,
    taskId: namedTask,
    sessionId: named.roveSessionId,
    workspaceId: workspace.id,
    commandCounts: counts(afterCommands),
    processReplacement: {
      priorProcessesAlive: 0,
      replacementProcessesAlive: replacementPids.length,
      replacementProcessesUnique: new Set(replacementPids).size,
    },
  });

  progress("named Runtime restart");
  const runtimeOperation = operation("3");
  const runtimeAcceptance = await driver.request({
    type: "task.launch",
    operationId: runtimeOperation,
    input: {
      outcome: "Survive a Runtime process restart",
      executionMode: "agent",
      approvalsReviewer: "auto_review",
      browserIdentity: { mode: "workspace", workspaceId: workspace.id },
      model: "l2-model",
      reasoningEffort: "low",
    },
  });
  const runtimeTask = await materializedLaunch(
    driver,
    runtimeAcceptance,
    runtimeOperation,
  );
  progress("named Runtime task launched");
  const beforeRuntimeInventory = await driver.request({ type: "inventory" });
  const runtimeRestart = await driver.request({ type: "runtime.kill" });
  progress("managed Runtime restarted");
  const runtimeConvergence = await waitFor(async () => {
    const [snapshot, inventory] = await Promise.all([
      driver.request({ type: "snapshot" }),
      driver.request({ type: "inventory" }),
    ]);
    const task = snapshot.tasks.find(
      (entry) => entry.taskId === runtimeTask.taskId,
    );
    const matches = inventory.filter(
      (entry) => entry.session.id === runtimeTask.roveSessionId,
    );
    return matches.length === 1 &&
      inventory.length === beforeRuntimeInventory.length &&
      matches[0].attachment === "attached" &&
      matches[0].recovery === "not_needed" &&
      task?.roveSessionId === runtimeTask.roveSessionId &&
      task.lifecycle?.phase === "ready" &&
      task.runtime?.attachment === "attached" &&
      task.runtime?.recovery === "not_needed"
      ? { snapshot, inventory }
      : undefined;
  });
  const runtimeSnapshot = runtimeConvergence.snapshot;
  const runtimeRecovered = runtimeSnapshot.tasks.find(
    (task) => task.taskId === runtimeTask.taskId,
  );
  progress(
    `Runtime recovery projection ${JSON.stringify({ lifecycle: runtimeRecovered?.lifecycle, actions: runtimeRecovered?.availableActions, runtime: runtimeRecovered?.runtime, conversation: runtimeRecovered?.conversation?.turnStatus })}`,
  );
  check(
    runtimeRecovered?.roveSessionId === runtimeTask.roveSessionId,
    "Runtime restart changed session identity.",
  );
  const runtimeInventory = runtimeConvergence.inventory;
  check(
    runtimeInventory.filter(
      (entry) => entry.session.id === runtimeTask.roveSessionId,
    ).length === 1,
    "Runtime recovery did not retain one exact inventory record.",
  );
  check(
    runtimeInventory.length === beforeRuntimeInventory.length,
    "Runtime restart created a duplicate session record.",
  );
  check(
    runtimeInventory.filter(
      (entry) =>
        entry.session.id === runtimeTask.roveSessionId &&
        entry.attachment === "attached" &&
        entry.recovery === "not_needed",
    ).length === 1,
    "Runtime restart did not restore exactly one attachment for the task.",
  );
  await finishAndWait(driver, runtimeTask.taskId, operation("4"));
  progress("named Runtime task finished");
  results.push({
    id: "named-runtime-restart",
    status: "passed",
    killedPid: runtimeRestart.killedPid,
    recoveredSessionId: runtimeTask.roveSessionId,
    inventoryRecords: 1,
    inventoryCountBeforeRestart: beforeRuntimeInventory.length,
    inventoryCountAfterRestart: runtimeInventory.length,
    restoredAttachmentsForTask: 1,
  });

  progress("Temporary process loss");
  const temporaryOperation = operation("5");
  const temporaryAcceptance = await driver.request({
    type: "task.launch",
    operationId: temporaryOperation,
    input: {
      outcome: "Converge a lost Temporary task",
      executionMode: "agent",
      approvalsReviewer: "auto_review",
      browserIdentity: { mode: "temporary" },
      model: "l2-model",
      reasoningEffort: "low",
    },
  });
  const temporary = await materializedLaunch(
    driver,
    temporaryAcceptance,
    temporaryOperation,
  );
  await driver.request({ type: "runtime.kill" });
  const temporaryConvergence = await waitFor(async () => {
    const [snapshot, inventory] = await Promise.all([
      driver.request({ type: "snapshot" }),
      driver.request({ type: "inventory" }),
    ]);
    const task = snapshot.tasks.find(
      (entry) => entry.taskId === temporary.taskId,
    );
    const matches = inventory.filter(
      (entry) => entry.session.id === temporary.roveSessionId,
    );
    return matches.length === 1 &&
      matches[0].session.status === "active" &&
      matches[0].attachment === "missing" &&
      matches[0].recovery === "unrecoverable" &&
      matches[0].profileOwnership === "released" &&
      task?.lifecycle?.phase === "cleanup_required" &&
      task.runtime?.attachment === "missing" &&
      task.runtime?.recovery === "unrecoverable"
      ? { snapshot, inventory }
      : undefined;
  });
  const temporarySnapshot = temporaryConvergence.snapshot;
  const temporaryTask = temporarySnapshot.tasks.find(
    (task) => task.taskId === temporary.taskId,
  );
  progress(
    `Temporary recovery projection ${JSON.stringify({ lifecycle: temporaryTask?.lifecycle, actions: temporaryTask?.availableActions, runtime: temporaryTask?.runtime, conversation: temporaryTask?.conversation?.turnStatus })}`,
  );
  check(
    temporaryTask?.browserIdentity.mode === "temporary",
    "Temporary identity changed after process loss.",
  );
  check(
    temporaryTask?.availableActions.includes("retry_cleanup"),
    "Lost Temporary task did not expose cleanup.",
  );
  await finishAndWait(driver, temporary.taskId, operation("6"));
  results.push({
    id: "temporary-process-loss",
    status: "passed",
    taskId: temporary.taskId,
    identity: "temporary",
    cleanupConverged: true,
  });

  progress("App Server process restart");
  const appOperation = operation("7");
  const appAcceptance = await driver.request({
    type: "task.launch",
    operationId: appOperation,
    input: {
      outcome: "Recover fresh App Server truth",
      executionMode: "agent",
      approvalsReviewer: "auto_review",
      browserIdentity: { mode: "workspace", workspaceId: workspace.id },
      model: "l2-model",
      reasoningEffort: "low",
    },
  });
  const appTask = await materializedLaunch(driver, appAcceptance, appOperation);
  const beforeAppCommands = await commands(home);
  const killed = await driver.request({
    type: "appserver.kill.now",
    threadId: appTask.codexThreadId,
  });
  const unavailable = await driver.request({ type: "snapshot" });
  const unavailableTask = unavailable.tasks.find(
    (task) => task.taskId === appTask.taskId,
  );
  check(
    killed.health?.state === "degraded" && unavailable.host.ready === false,
    "Killed App Server did not expose the degraded transport boundary.",
  );
  check(
    killed.deadSessionRequest?.rejected === true,
    "The dead App Server connection accepted a thread request.",
  );
  const reconnected = await driver.request({ type: "appserver.ready" });
  const recovery = await waitFor(async () => {
    const [snapshot, identities, appCommands] = await Promise.all([
      driver.request({ type: "snapshot" }),
      driver.request({ type: "process.identities" }),
      commands(home),
    ]);
    const task = snapshot.tasks.find(
      (entry) => entry.taskId === appTask.taskId,
    );
    const afterCut = appCommands.slice(beforeAppCommands.length);
    const resumed = afterCut.some(
      (entry) =>
        entry.method === "thread/resume" &&
        entry.params?.threadId === appTask.codexThreadId,
    );
    const freshlyRead = afterCut.some(
      (entry) =>
        entry.method === "thread/read" &&
        entry.params?.threadId === appTask.codexThreadId,
    );
    return Number(identities.appServerPid) !== Number(killed.killedPid) &&
      snapshot.host.ready === true &&
      resumed &&
      freshlyRead &&
      task?.codexThreadId === appTask.codexThreadId &&
      task.lifecycle?.phase === "ready" &&
      task.conversation?.turnStatus === "completed" &&
      Object.values(task.conversation.items ?? {}).some(
        (item) => item?.clientId === appOperation,
      )
      ? { snapshot, identities, appCommands, task }
      : undefined;
  });
  const afterAppCommands = recovery.appCommands;
  check(
    counts(afterAppCommands)["turn/start"] ===
      counts(beforeAppCommands)["turn/start"],
    "App Server reconnect replayed a user turn.",
  );
  await finishAndWait(driver, appTask.taskId, operation("8"));
  results.push({
    id: "app-server-process-restart",
    status: "passed",
    killedPid: killed.killedPid,
    replacementPid: recovery.identities.appServerPid,
    unavailablePhase: unavailableTask.lifecycle.phase,
    deadSessionRequestRejected: true,
    freshReadCount: counts(afterAppCommands)["thread/read"],
    resumeCount: counts(afterAppCommands)["thread/resume"],
    turnStartsBefore: counts(beforeAppCommands)["turn/start"],
    turnStartsAfter: counts(afterAppCommands)["turn/start"],
  });

  progress("authentication callback restart");
  const firstLogin = await driver.request({ type: "login.start" });
  const firstRedirect = new URL(firstLogin.url).searchParams.get(
    "redirect_uri",
  );
  check(firstRedirect, "Stand-in login did not expose a callback URI.");
  ownedUrls.add(firstRedirect);
  await driver.request({ type: "appserver.kill.now" });
  const staleRejected = await fetch(firstRedirect)
    .then(() => false)
    .catch(() => true);
  check(staleRejected, "Callback listener survived App Server termination.");
  await driver.request({ type: "appserver.ready" });
  const secondLogin = await driver.request({ type: "login.start" });
  const secondRedirect = new URL(secondLogin.url).searchParams.get(
    "redirect_uri",
  );
  check(
    secondRedirect && secondRedirect !== firstRedirect,
    "Restart reused a stale callback identity.",
  );
  ownedUrls.add(secondRedirect);
  const thirdLogin = await driver.request({ type: "login.start" });
  const thirdRedirect = new URL(thirdLogin.url).searchParams.get(
    "redirect_uri",
  );
  check(thirdRedirect, "Replacement login did not expose a callback URI.");
  ownedUrls.add(thirdRedirect);
  const obsoleteCallback = await fetch(secondRedirect);
  check(
    obsoleteCallback.status === 410,
    "Obsolete callback identity was not rejected by the active listener.",
  );
  const callback = await fetch(thirdRedirect);
  check(callback.status === 200, "Fresh callback did not complete.");
  const replayStatus = await fetch(thirdRedirect)
    .then((response) => response.status)
    .catch(() => 0);
  check(
    replayStatus !== 200,
    "Completed callback listener accepted a stale replay.",
  );
  results.push({
    id: "authentication-return",
    status: "passed",
    listenerRestarted: true,
    shutdownListenerConnectionRefused: true,
    obsoleteIdentityStatus: obsoleteCallback.status,
    callbackReplayRejected: true,
    callbackReplayStatus: replayStatus,
  });

  await recordTerminalState(driver, "core scenarios");
  await driver.stop();
  check(
    !alive(driver.ready.desktopPid),
    "Desktop driver remained alive after clean stop.",
  );
  return { home, beforeRestart, afterRestart, reconnected };
}

async function runCloseMatrix() {
  const cuts = scenarios.scenarios.find(
    (item) => item.id === "close-stage-crash-matrix",
  ).cuts;
  const evidence = [];
  for (const [index, cut] of cuts.entries()) {
    progress(`close crash cut ${cut.stage}`);
    const home = join(temporaryRoot, `close-${cut.stage}`);
    let driver = new Driver(home, {
      cutPoint: cut.point,
      cutCommand: cut.command,
      cutOccurrence: cut.occurrence,
    });
    await driver.start();
    const workspace = await driver.request({
      type: "workspace.create",
      displayName: `Close ${cut}`,
    });
    const launchOperation = operation(String(index + 1));
    const launchAcceptance = await driver.request({
      type: "task.launch",
      operationId: launchOperation,
      input: {
        outcome: `Close cut ${cut}`,
        executionMode: "agent",
        approvalsReviewer: "auto_review",
        browserIdentity: { mode: "workspace", workspaceId: workspace.id },
        model: "l2-model",
        reasoningEffort: "low",
      },
    });
    const launched = await materializedLaunch(
      driver,
      launchAcceptance,
      launchOperation,
    );
    const taskId = launched.taskId;
    const closeOperation = operation(String(index + 5));
    driver.send({ type: "task.finish", taskId, operationId: closeOperation });
    const marker = await driver.waitForCut();
    check(
      marker.point === cut.point &&
        marker.commandType === cut.command &&
        marker.occurrence === cut.occurrence &&
        marker.taskId === taskId,
      `Close cut ${cut.stage} acknowledgement did not match its request: ${JSON.stringify(marker)}`,
    );
    await driver.crash();
    driver = new Driver(home);
    await driver.start();
    await driver.request({
      type: "recover",
      source: `close cut ${cut.stage}`,
    });
    const task = await waitFor(async () => {
      const snapshot = await driver.request({ type: "snapshot" });
      const current = snapshot.tasks.find((item) => item.taskId === taskId);
      return current?.lifecycle.phase === "closed" ? current : undefined;
    });
    check(
      task?.lifecycle.phase === "closed",
      `Close cut ${cut.stage} did not converge.`,
    );
    await driver.request({
      type: "task.close.raw",
      taskId,
      operationId: closeOperation,
    });
    await driver.request({
      type: "task.close.raw",
      taskId,
      operationId: closeOperation,
    });
    const log = await commands(home);
    check(
      counts(log)["thread/start"] === 1,
      `Close cut ${cut.stage} duplicated thread creation.`,
    );
    check(
      counts(log)["turn/start"] === 1,
      `Close cut ${cut.stage} duplicated turn creation.`,
    );
    const inventory = await driver.request({ type: "inventory" });
    check(
      inventory.length === 1,
      `Close cut ${cut.stage} created a duplicate Runtime session.`,
    );
    const session = inventory.find(
      (entry) => entry.session.id === launched.roveSessionId,
    );
    check(
      session && ["completed", "failed"].includes(session.session.status),
      `Close cut ${cut.stage} left Runtime nonterminal.`,
    );
    check(
      session.attachment === "missing",
      `Close cut ${cut.stage} left browser attached.`,
    );
    await recordTerminalState(driver, `close cut ${cut.stage}`);
    await driver.stop();
    evidence.push({
      stage: cut.stage,
      point: cut.point,
      command: cut.command,
      occurrence: cut.occurrence,
      markerProcessId: marker.desktopPid,
      terminalStatus: session.session.status,
      attachment: session.attachment,
      repeatedFinishSafe: true,
      runtimeSessionCount: inventory.length,
      commandCounts: counts(log),
    });
  }
  results.push({
    id: "close-stage-crash-matrix",
    status: "passed",
    cuts: evidence,
  });
}

async function runHumanReturn() {
  const cutEvidence = [];
  for (const [index, returnBeforeRestart] of [false, true].entries()) {
    const cut = returnBeforeRestart
      ? "after_return_before_inspection"
      : "before_return";
    progress(`human return cut ${cut}`);
    const home = join(temporaryRoot, `return-${cut}`);
    let driver = new Driver(home);
    await driver.start();
    const workspace = await driver.request({
      type: "workspace.create",
      displayName: `Return ${cut}`,
    });
    const launchOperation = operation(String(index + 1));
    const launchAcceptance = await driver.request({
      type: "task.launch",
      operationId: launchOperation,
      input: {
        outcome: `Human return ${cut}`,
        executionMode: "agent",
        approvalsReviewer: "auto_review",
        browserIdentity: { mode: "workspace", workspaceId: workspace.id },
        model: "l2-model",
        reasoningEffort: "low",
      },
    });
    const launched = await materializedLaunch(
      driver,
      launchAcceptance,
      launchOperation,
    );
    const taskId = launched.taskId;
    const handoffPrecondition = await waitFor(async () => {
      const state = await driver.request({
        type: "handoff.status",
        taskId,
      });
      return state.control?.status === "active" &&
        state.control.controller === "agent" &&
        state.task?.runtime?.status === "active" &&
        state.task.runtime.controller === "agent"
        ? state
        : undefined;
    });
    progress(`human return preparing handoff ${cut}`);
    await driver.request({
      type: "handoff.prepare",
      taskId,
      returnBeforeRestart,
    });
    progress(`human return stopping first Desktop ${cut}`);
    await driver.stop();
    progress(`human return starting replacement Desktop ${cut}`);
    driver = new Driver(home);
    await driver.start();
    progress(`human return reading restored control ${cut}`);
    const restoredHandoff = await waitFor(async () => {
      const state = await driver.request({
        type: "handoff.status",
        taskId,
      });
      const expectedController = returnBeforeRestart ? "agent" : "human";
      const runtimeRestored =
        state.control?.status === "active" &&
        state.control.controller === expectedController;
      const productRestored =
        state.task?.runtime?.status === "active" &&
        state.task.runtime.controller === expectedController &&
        state.task.runtime.attachment === "attached" &&
        state.task.runtime.recovery === "not_needed";
      return runtimeRestored && (returnBeforeRestart || productRestored)
        ? state
        : undefined;
    });
    progress(
      `human return restored truth ${JSON.stringify({ cut, control: restoredHandoff.control, continuation: restoredHandoff.continuation })}`,
    );
    if (!returnBeforeRestart)
      await driver.request({
        type: "handoff.return",
        taskId,
        operationId: operation(String(index + 7)),
      });
    else await driver.request({ type: "recover", source: cut });
    await waitFor(async () => {
      const [snapshot, control, log] = await Promise.all([
        driver.request({ type: "snapshot" }),
        driver.request({ type: "handoff.status", taskId }),
        commands(home),
      ]);
      const task = snapshot.tasks.find((item) => item.taskId === taskId);
      return counts(log)["turn/start"] === 2 &&
        task?.lifecycle.phase !== "waiting_for_human" &&
        task?.conversation?.turnStatus === "completed" &&
        control.control?.controller === "agent"
        ? { snapshot, control, log, task }
        : undefined;
    });
    await driver.request({ type: "recover", source: "App Server duplicate" });
    await finishAndWait(driver, taskId, operation(String(index + 5)));
    const [snapshot, log] = await Promise.all([
      driver.request({ type: "snapshot" }),
      commands(home),
    ]);
    const task = snapshot.tasks.find((item) => item.taskId === taskId);
    check(
      counts(log)["turn/start"] === 2,
      `${cut} did not dispatch exactly one continuation.`,
    );
    check(
      task?.lifecycle.phase === "closed",
      `${cut} did not remain closed after duplicate recovery.`,
    );
    await recordTerminalState(driver, `human return ${cut}`);
    await driver.stop();
    cutEvidence.push({
      cut,
      handoffPrecondition: handoffPrecondition.control,
      turnStartCount: counts(log)["turn/start"],
      continuationDispatches: counts(log)["turn/start"] - 1,
      freshInspectionRequiredBeforeDispatch: true,
    });
  }
  results.push({
    id: "human-return-restart",
    status: "passed",
    cuts: cutEvidence,
  });
}

async function screenshotRenderer(realSnapshot) {
  progress("retained blocker renderer");
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      const path = join(
        rendererRoot,
        pathname === "/" ? "index.html" : pathname,
      );
      response.writeHead(200, {
        "content-type": mime[extname(path)] ?? "application/octet-stream",
      });
      response.end(await readFile(path));
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  const serverUrl = `http://127.0.0.1:${address.port}`;
  ownedUrls.add(serverUrl);
  let browser;
  const disposeServer = async () =>
    new Promise((resolveClose) => server.close(resolveClose));
  const unregisterServer = registerResource(disposeServer);
  const productTask = (id, selectedAt, lifecycle, availableActions) => ({
    context: {
      roveTaskId: id,
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      selectionSource: "user_selected",
      selectedAt,
      policy: { model: "l2-model", reasoningEffort: "low" },
      bootstrap: {
        attemptId: `boot_${id.padEnd(32, "0").slice(-32)}`,
        threadSource: "L2 persisted renderer qualification",
        stage: "complete",
      },
    },
    lifecycle,
    availableActions,
  });
  const blocker = (id, selectedAt) =>
    productTask(
      id,
      selectedAt,
      {
        phase: "cleanup_required",
        reason: `Cleanup remains for ${id}.`,
      },
      ["retry_cleanup", "finish"],
    );
  const persistedTaskFile = join(
    temporaryRoot,
    "renderer-production-task-set.json",
  );
  const persistedTaskSet = [
    blocker("task_l2_blocker_old", "2026-09-01T00:00:00Z"),
    ...Array.from({ length: 12 }, (_, index) =>
      productTask(
        `task_l2_closed_${index}`,
        `2026-09-02T00:00:${String(index).padStart(2, "0")}Z`,
        { phase: "closed", reason: "Closed." },
        [],
      ),
    ),
    blocker("task_l2_blocker_new", "2026-09-03T00:00:00Z"),
  ];
  await writeFile(
    persistedTaskFile,
    `${JSON.stringify(persistedTaskSet, null, 2)}\n`,
  );
  const tasks = {
    productTasks: async () =>
      JSON.parse(await readFile(persistedTaskFile, "utf8")),
    start: async () => {
      throw new Error("Launch crossed the blocker gate.");
    },
  };
  const productApi = new LocalProductApi(
    () => ({
      state: "ready",
      ready: true,
      restartAttempt: 0,
      stderrTail: [],
    }),
    { snapshot: () => realSnapshot.catalog },
    tasks,
    {},
    { list: () => [] },
    temporaryRoot,
  );
  const productSnapshot = await productApi.readSnapshot();
  const launchRejected = await productApi
    .executeRendererIntent({
      type: "task.launch",
      operationId: operation("9"),
      input: {
        outcome: "Must remain blocked",
        executionMode: "agent",
        approvalsReviewer: "auto_review",
        browserIdentity: { mode: "temporary" },
      },
    })
    .then(() => false)
    .catch((error) => /Multiple tasks must converge/.test(String(error)));
  check(
    launchRejected,
    "Production API did not reject launch across blockers.",
  );
  const snapshot = {
    surface: {
      presentation: "full",
      browserContext: "windowed",
      activeHost: "control_center",
      returnPresentation: "chip",
      revision: 99,
    },
    product: productSnapshot,
    companion: null,
    notice: null,
    workspaces: { workspaces: [] },
    productError: null,
  };
  try {
    browser = await chromium.launch({ headless: true });
    const unregisterBrowser = registerResource(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 1180, height: 820 },
    });
    await page.addInitScript((value) => {
      window.rove = {
        getSurfaceSnapshot: async () => value,
        subscribeSurfaceSnapshot: () => () => undefined,
        transitionSurface: async () => value,
        executeProductIntent: async () => ({}),
        getSnapshot: async () => null,
        getNotice: async () => null,
        getLiveSession: async () => null,
        getFollowerPresentation: async () => "windowed_compact",
        takeControl: async () => null,
        returnControl: async () => null,
        pauseSession: async () => null,
        finishSession: async () => null,
        setFollowerExpanded: async () => "windowed_expanded",
        beginFollowerDrag: async () => undefined,
        updateFollowerDrag: async () => undefined,
        endFollowerDrag: async () => undefined,
        openRove: async () => undefined,
        openTrustedExternal: async () => undefined,
        getBrowserWorkspaces: async () => value.workspaces,
        createBrowserWorkspace: async () => value.workspaces,
        selectBrowserWorkspace: async () => value.workspaces,
      };
    }, snapshot);
    await page.goto(serverUrl);
    await page.waitForSelector(".product-app");
    const buttons = page.locator(".task-history > button");
    check(
      (await buttons.count()) === 10,
      "Renderer did not keep two blockers plus eight terminal histories.",
    );
    check(
      (await page.getByText(/2 tasks must finish or converge/).count()) === 1,
      "Composer did not visibly block launch.",
    );
    await buttons.nth(0).click();
    check(
      (await page
        .getByText("Cleanup remains for task_l2_blocker_new.")
        .count()) === 1,
      "Newest blocker was not selectable.",
    );
    await buttons.nth(1).click();
    check(
      (await page
        .getByText("Cleanup remains for task_l2_blocker_old.")
        .count()) === 1,
      "Oldest blocker was not selectable.",
    );
    const screenshot = join(artifactRoot, "retained-blockers.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    results.push({
      id: "retained-blocker-renderer",
      status: "passed",
      selectableTasks: 10,
      cleanupBlockers: 2,
      terminalHistoriesShown: 8,
      launchVisiblyBlocked: true,
      launchRejectedByProductionApi: launchRejected,
      snapshotSource:
        "LocalProductApi.readSnapshot over persisted task fixture",
      screenshot: "retained-blockers.png",
    });
    unregisterBrowser();
  } finally {
    await browser?.close().catch(() => undefined);
    unregisterServer();
    await disposeServer();
  }
}

async function assertNoLockFiles(path) {
  for (const entry of await readdir(path, { withFileTypes: true }).catch(
    () => [],
  )) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await assertNoLockFiles(child);
    else
      check(
        entry.name !== "profile.lock",
        `Stale profile lock remained at ${child}.`,
      );
  }
}

async function countLockFiles(path) {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true }).catch(
    () => [],
  )) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += await countLockFiles(child);
    else if (entry.name === "profile.lock") total += 1;
  }
  return total;
}

async function responds(url) {
  return fetch(url, { signal: AbortSignal.timeout(500) })
    .then(() => true)
    .catch(() => false);
}

await mkdir(artifactRoot, { recursive: true });
let qualificationError;
try {
  const core = await runCoreScenarios();
  await runCloseMatrix();
  await runHumanReturn();
  await screenshotRenderer(core.afterRestart);
  await assertNoLockFiles(temporaryRoot);
  const nonterminal = results.filter((item) => item.status !== "passed");
  check(nonterminal.length === 0, "One or more L2 scenarios did not pass.");
} catch (error) {
  qualificationError = error;
} finally {
  for (const dispose of [...activeResources].reverse())
    await dispose().catch(() => undefined);
  activeResources.clear();
  for (const driver of activeDrivers)
    await driver.crash().catch(() => undefined);
  for (const pid of ownedPids) if (alive(pid)) process.kill(pid, "SIGKILL");
  await waitFor(() => [...ownedPids].every((pid) => !alive(pid)), 5_000).catch(
    () => undefined,
  );
}

const terminalCleanup = {
  trackedChildProcesses: ownedPids.size,
  staleChildProcesses: [...ownedPids].filter(alive).length,
  trackedListeningPorts: ownedUrls.size,
  staleListeningPorts: (
    await Promise.all([...ownedUrls].map((url) => responds(url)))
  ).filter(Boolean).length,
  staleProfileLocks: await countLockFiles(temporaryRoot),
  attachedBrowsers: terminalObservations.reduce(
    (total, item) => total + item.attachedBrowsers,
    0,
  ),
  nonterminalRuntimeSessions: terminalObservations.reduce(
    (total, item) => total + item.nonterminalRuntimeSessions,
    0,
  ),
  cleanupRequiredProductTasks: terminalObservations.reduce(
    (total, item) => total + item.cleanupRequiredProductTasks,
    0,
  ),
  observedTerminalHomes: terminalObservations.length,
  isolatedHomeRemoved: false,
};
await rm(temporaryRoot, { recursive: true, force: true });
terminalCleanup.isolatedHomeRemoved = await readdir(temporaryRoot)
  .then(() => false)
  .catch((error) => error?.code === "ENOENT");

if (qualificationError) throw qualificationError;
check(
  terminalCleanup.staleChildProcesses === 0 &&
    terminalCleanup.staleListeningPorts === 0 &&
    terminalCleanup.staleProfileLocks === 0 &&
    terminalCleanup.attachedBrowsers === 0 &&
    terminalCleanup.nonterminalRuntimeSessions === 0 &&
    terminalCleanup.cleanupRequiredProductTasks === 0 &&
    terminalCleanup.isolatedHomeRemoved,
  `L2 terminal cleanup failed: ${JSON.stringify(terminalCleanup)}`,
);
const evidence = {
  schemaVersion: 1,
  qualification: "P5.9 L2 production-equivalent local recovery",
  sourceBuilt: true,
  packaged: false,
  externalServicesContacted: false,
  scenarioManifest: "experiments/agent-execution/recovery-harness/scenarios.json",
  scenarios: results,
  terminalObservations,
  terminalCleanup,
  result: "passed",
};
await writeFile(
  join(artifactRoot, "results.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
