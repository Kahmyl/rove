#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import { postCloseArchiveDisposition } from "./source-product-campaign-recovery.mjs";
import { evaluateLaunchBoundary } from "./source-product-launch-boundary.mjs";
import { loadLiveSessionLedger } from "./source-product-live-ledger.mjs";
import {
  liveResultMarkerInstruction,
  verifyLiveJourney,
} from "./source-product-live-verifier.mjs";
import {
  pollProductTruth,
  pollSnapshot,
  validateSurfaceSnapshot,
} from "./source-product-poll.mjs";

const root = resolve(import.meta.dirname, "../..");
const companion = join(root, "apps/companion");
const artifactPath = join(
  root,
  "artifacts/phase5-maps-live-20260909-181822.json",
);
const nativeScreenshotPath = join(
  root,
  "docs/experiments/artifacts/p5.9-live-acceptance/maps-20260909-181822-native.png",
);
const requireBrowser = createRequire(
  join(root, "packages/browser/package.json"),
);
const requireCompanion = createRequire(join(companion, "package.json"));
const { _electron: electron } = requireBrowser("playwright");
const executablePath = requireCompanion("electron");
const entry = join(
  companion,
  "dist/main/main/qualification/attachment-main.js",
);
const terminalTaskPhases = new Set(["closed", "failed"]);
const terminalTurnStatuses = new Set(["completed", "failed", "interrupted"]);
const terminalAttentionStatuses = new Set(["resolved", "cancelled", "stale"]);
const journey = "maps";
const outcome = `Open Google Maps and search for Lekki Conservation Centre, Lagos. Capture a Rove viewport screenshot and describe where the place-information panel is relative to the map, the major visible controls, and whether the map is closely centered on the destination or shows a wider region.

Then ask Maps for directions from Murtala Muhammed International Airport to Lekki Conservation Centre. Inspect the route choices, select public transit if available, summarize the visible route options and durations, and capture a second Rove viewport screenshot. Describe the route presentation using the screenshot. Do not start navigation, save places, share, or change account settings.

Report page/tab identities, URLs, browser observations, screenshot evidence IDs, route facts, and exact visual descriptions. Request human control only for authentication, human verification, access, or a consent choice required for this route task. Ignore and leave untouched any optional survey or feedback card after the requested route and screenshots are proven. If such an optional overlay blocks a still-required target, dismiss it only through one freshly grounded nonconsequential action. One fresh read-only retry is allowed for pre-dispatch PAGE_CHANGED/OBSERVATION_STALE.`;

let desktop;
let productHome;
let harnessProcessIds = [];
let taskId;
let stage = "startup";
let result;
let baselineTaskIds = [];
let baselineTruth = [];
let nativeScreenshotCaptured = false;

function processTable() {
  return execFileSync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      return match
        ? [
            {
              pid: Number(match[1]),
              parentPid: Number(match[2]),
              command: match[3],
            },
          ]
        : [];
    });
}

function captureOwnedProcesses() {
  const desktopPid = desktop.application.process().pid;
  const table = processTable();
  const owned = new Set([desktopPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of table)
      if (owned.has(entry.parentPid) && !owned.has(entry.pid)) {
        owned.add(entry.pid);
        changed = true;
      }
  }
  return {
    desktopPid,
    ownedProcessPids: [...owned],
    managedRuntimePids: table
      .filter(
        (entry) =>
          owned.has(entry.pid) &&
          /apps\/runtime|@rove\/runtime|runtime\/dist/.test(entry.command),
      )
      .map((entry) => entry.pid),
  };
}

function liveProcessIds(ids) {
  return ids.filter((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error?.code !== "ESRCH";
    }
  });
}

async function waitForProcessesAbsent(ids) {
  const deadline = Date.now() + 20_000;
  let live = liveProcessIds(ids);
  while (live.length && Date.now() < deadline) {
    await delay(100);
    live = liveProcessIds(ids);
  }
  return live;
}

async function snapshot() {
  const value = await desktop.page.evaluate(() =>
    globalThis.rove.getSurfaceSnapshot(),
  );
  return validateSurfaceSnapshot(value, stage);
}

async function waitForProductTruth() {
  return pollProductTruth({
    page: desktop.page,
    snapshot,
    stage,
    timeoutMs: 30_000,
    summarize: summarizeSurface,
  });
}

function summarizeTask(task) {
  return {
    taskId: task.taskId,
    lifecycle: {
      phase: task.lifecycle?.phase,
      reason: task.lifecycle?.reason?.slice(0, 400),
    },
    bootstrapStage: task.bootstrapStage,
    initialLaunch:
      task.initialLaunch === undefined
        ? null
        : {
            operationId: task.initialLaunch.operationId,
            stage: task.initialLaunch.stage,
            turnId: task.initialLaunch.turnId,
          },
    roveSessionId: task.roveSessionId,
    codexThreadId: task.codexThreadId,
    executionMode: task.executionMode,
    browserIdentity: task.browserIdentity,
    approvalsReviewer: task.approvalsReviewer,
    availableActions: task.availableActions,
    runtime:
      task.runtime === undefined
        ? null
        : {
            status: task.runtime.status,
            controller: task.runtime.controller,
            recovery: task.runtime.recovery,
          },
    conversation:
      task.conversation === undefined
        ? null
        : {
            turnStatus: task.conversation.turnStatus,
            archived: task.conversation.archived,
            turnOrder: task.conversation.turnOrder,
            itemCount: Object.keys(task.conversation.items).length,
          },
    attachmentCount: task.attachments?.length ?? 0,
  };
}

function summarizeSurface(state) {
  return {
    revision: state?.revision,
    account: state?.product?.catalog?.account?.status,
    currentTaskId: state?.product?.currentTaskId,
    tasks: state?.product?.tasks?.map(summarizeTask),
    attention: state?.product?.attention?.map((entry) => ({
      authority: entry.authority,
      kind: entry.kind,
      requestId: entry.requestId,
      taskId: entry.taskId,
      threadId: entry.threadId,
      turnId: entry.turnId,
      status: entry.status,
    })),
    fileAttention: state?.product?.fileAttention?.map((entry) => ({
      requestId: entry.requestId,
      taskId: entry.taskId,
      sessionId: entry.sessionId,
      status: entry.status,
    })),
    recoveryWarnings: state?.product?.recoveryWarnings?.map((warning) =>
      warning.slice(0, 400),
    ),
    companion:
      state?.companion === null || state?.companion === undefined
        ? null
        : {
            sessionId: state.companion.session.id,
            status: state.companion.session.status,
            controller: state.companion.session.controller,
          },
    productError: state?.productError?.slice(0, 400),
  };
}

function projectEvidence(task) {
  const items = Object.values(task.conversation?.items ?? {});
  const assistantMessages = items
    .filter((item) => item.kind === "assistant_message" && item.text)
    .map((item) => ({
      id: item.id,
      turnId: item.turnId,
      text: item.text.slice(0, 12_000),
    }));
  const combined = assistantMessages.map((item) => item.text).join("\n");
  return {
    assistantMessages,
    toolCalls: items
      .filter((item) => item.kind === "tool")
      .map((item) => ({
        id: item.id,
        turnId: item.turnId,
        status: item.status,
        title: item.title?.slice(0, 160),
      })),
    mapsUrls: [
      ...new Set(
        combined.match(
          /https:\/\/(?:www\.)?google\.[^/\s)]+\/maps\/[^\s)]+/g,
        ) ?? [],
      ),
    ],
    observationIds: [
      ...new Set(combined.match(/(?:bobs|obs)_[a-f0-9]{32}/gi) ?? []),
    ],
    evidenceIds: [...new Set(combined.match(/ev_[a-f0-9]{32}/gi) ?? [])],
    pageIds: [...new Set(combined.match(/page_[A-Za-z0-9_-]+/g) ?? [])],
    visibleDurations: [
      ...new Set(
        combined.match(/\b\d+\s*(?:hr|hrs|hour|hours|min|mins|minutes)\b/gi) ??
          [],
      ),
    ],
  };
}

function baselineProjection(tasks) {
  return tasks.map((task) => ({
    taskId: task.taskId,
    lifecyclePhase: task.lifecycle?.phase,
    conversationArchived: task.conversation?.archived ?? null,
  }));
}

async function selectTask(id) {
  const state = await snapshot();
  if (state.product?.currentTaskId === id) return;
  await desktop.page
    .getByRole("button", { name: `Task history: ${id}`, exact: true })
    .click();
}

async function finishAndArchive(id) {
  let state = await snapshot();
  let task = state.product.tasks.find((entry) => entry.taskId === id);
  if (!task)
    throw new Error(`Run-owned task ${id} disappeared during cleanup.`);
  if (task.conversation?.archived === true) return;
  if (!terminalTaskPhases.has(task.lifecycle.phase)) {
    await selectTask(id);
    const action = task.availableActions.includes("retry_cleanup")
      ? "Retry cleanup"
      : task.availableActions.includes("finish")
        ? "Finish"
        : null;
    if (!action)
      throw new Error(
        `Run-owned task ${id} lacks a normal Finish control at ${task.lifecycle.phase}.`,
      );
    await desktop.page
      .getByRole("button", { name: action, exact: true })
      .click();
    await pollSnapshot({
      page: desktop.page,
      snapshot,
      stage: `${stage}:finish`,
      timeoutMs: 180_000,
      predicate: (next) => {
        const current = next.product.tasks.find((entry) => entry.taskId === id);
        return current && terminalTaskPhases.has(current.lifecycle.phase)
          ? current
          : false;
      },
      summarize: summarizeSurface,
    });
  }
  state = await snapshot();
  task = state.product.tasks.find((entry) => entry.taskId === id);
  const disposition = postCloseArchiveDisposition(task);
  if (disposition === "settled" || disposition === "not_applicable") return;
  if (disposition !== "archive")
    throw new Error(`Run-owned task ${id} has no safe Archive action.`);
  await selectTask(id);
  await desktop.page
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await pollSnapshot({
    page: desktop.page,
    snapshot,
    stage: `${stage}:archive`,
    timeoutMs: 120_000,
    predicate: (next) =>
      next.product.tasks.some(
        (entry) => entry.taskId === id && entry.conversation?.archived === true,
      ) || false,
    summarize: summarizeSurface,
  });
}

async function captureNativeScreenshot() {
  if (!desktop?.page || nativeScreenshotCaptured) return;
  await mkdir(dirname(nativeScreenshotPath), { recursive: true });
  await desktop.page.screenshot({
    path: nativeScreenshotPath,
    fullPage: true,
  });
  nativeScreenshotCaptured = true;
}

try {
  stage = "launch-desktop";
  const application = await electron.launch({
    executablePath,
    cwd: companion,
    args: [entry, "--rove-manage-services"],
    env: process.env,
  });
  await application.evaluate(({ app }) => app.emit("activate"));
  productHome = join(
    await application.evaluate(({ app }) => app.getPath("appData")),
    "Rove",
    "product",
  );
  desktop = {
    application,
    page: await application.firstWindow({ timeout: 30_000 }),
  };
  const processIdentity = captureOwnedProcesses();
  harnessProcessIds = processIdentity.ownedProcessPids;

  stage = "preflight";
  const initial = await waitForProductTruth();
  if (initial.product.catalog.account.status !== "logged_in")
    throw new Error("Rove Codex account is not logged in.");
  const nonterminalTasks = initial.product.tasks.filter(
    (task) => !terminalTaskPhases.has(task.lifecycle.phase),
  );
  if (nonterminalTasks.length || initial.companion !== null)
    throw new Error(
      `Canonical product state is not clean: tasks=${nonterminalTasks.map((task) => task.taskId).join(",") || "none"}; companion=${initial.companion?.session?.id ?? "none"}.`,
    );
  if (initial.product.fileAttention.length)
    throw new Error("Canonical product state has unresolved file attention.");
  if (
    initial.product.attention.some(
      (entry) => !terminalAttentionStatuses.has(entry.status),
    )
  )
    throw new Error("Canonical product state has unresolved attention.");
  if (initial.product.recoveryWarnings.length)
    throw new Error("Canonical product state has recovery warnings.");
  const workspaceId =
    initial.workspaces.selectedWorkspaceId ??
    initial.workspaces.workspaces[0]?.id;
  const workspace = initial.workspaces.workspaces.find(
    (entry) => entry.id === workspaceId,
  );
  if (!workspace)
    throw new Error("No selected persistent browser workspace is available.");
  baselineTaskIds = initial.product.tasks.map((task) => task.taskId);
  baselineTruth = baselineProjection(initial.product.tasks);

  stage = "composer";
  const back = desktop.page.getByRole("button", {
    name: "Back to new task",
    exact: true,
  });
  if (await back.isVisible().catch(() => false)) await back.click();
  await desktop.page
    .getByLabel("Desired outcome", { exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  await desktop.page
    .getByLabel("Desired outcome", { exact: true })
    .fill(`${outcome}\n\n${liveResultMarkerInstruction(journey)}`);
  await desktop.page
    .getByLabel("Execution mode", { exact: true })
    .selectOption("agent");
  await desktop.page
    .getByLabel("Browser identity", { exact: true })
    .selectOption(`workspace:${workspace.id}`);
  await desktop.page
    .getByLabel("Permission review", { exact: true })
    .selectOption("auto_review");
  await desktop.page
    .getByRole("button", { name: "Start task", exact: true })
    .click();

  stage = "launch-boundary";
  let expectedIdentity;
  const launch = await pollSnapshot({
    page: desktop.page,
    snapshot,
    stage,
    timeoutMs: 180_000,
    summarize: summarizeSurface,
    predicate: (state) => {
      const decision = evaluateLaunchBoundary({
        state,
        priorTaskIds: baselineTaskIds,
        priorLedger: [],
        expectedIdentity,
        terminalPhases: terminalTaskPhases,
      });
      expectedIdentity = decision.identity;
      if (decision.identity?.taskId) taskId = decision.identity.taskId;
      if (decision.status === "invalid")
        throw new Error(`Launch boundary invalid: ${decision.reason}.`);
      return decision.status === "ready" ? decision : false;
    },
  });
  taskId = launch.task.taskId;

  stage = "task-terminal";
  const terminal = await pollSnapshot({
    page: desktop.page,
    snapshot,
    stage,
    timeoutMs: 900_000,
    intervalMs: 500,
    summarize: summarizeSurface,
    predicate: (state) => {
      const task = state.product.tasks.find((entry) => entry.taskId === taskId);
      if (!task) throw new Error(`Run-owned task ${taskId} disappeared.`);
      const unresolvedHandoff = state.product.attention.find(
        (entry) =>
          entry.taskId === taskId &&
          entry.authority === "rove_control" &&
          entry.kind === "control_handoff" &&
          !terminalAttentionStatuses.has(entry.status),
      );
      if (unresolvedHandoff)
        throw new Error(
          `Authentication requires human control: ${unresolvedHandoff.requestId}.`,
        );
      return terminalTurnStatuses.has(task.conversation?.turnStatus)
        ? { revision: state.revision, task, companion: state.companion }
        : false;
    },
  });
  await captureNativeScreenshot();
  if (!terminal.task.roveSessionId)
    throw new Error("Terminal task lacks a run-owned Rove session ID.");
  const liveLedger = await loadLiveSessionLedger({
    productHome,
    sessionId: terminal.task.roveSessionId,
  });
  const journeyVerification = verifyLiveJourney({
    journey,
    task: terminal.task,
    ledger: liveLedger,
  });
  result = {
    status: journeyVerification.ok ? "completed" : "failed",
    stage,
    workspace: {
      id: workspace.id,
      displayName: workspace.displayName,
      browser: workspace.browser,
    },
    processIdentity,
    launchIdentity: launch.identity,
    terminalRevision: terminal.revision,
    terminalTask: summarizeTask(terminal.task),
    journeyVerification,
    liveLedger,
    evidence: projectEvidence(terminal.task),
    nativeScreenshotPath,
  };
} catch (error) {
  let state;
  try {
    state = desktop ? await snapshot() : undefined;
    if (!taskId)
      taskId = state?.product?.tasks?.find(
        (task) => !baselineTaskIds.includes(task.taskId),
      )?.taskId;
    await captureNativeScreenshot();
  } catch {
    state = undefined;
  }
  const failedTask = state?.product?.tasks?.find(
    (task) => task.taskId === taskId,
  );
  result = {
    status: "failed",
    stage,
    error: error instanceof Error ? error.message : String(error),
    ...(taskId === undefined ? {} : { taskId }),
    task: failedTask ? summarizeTask(failedTask) : null,
    evidence: failedTask ? projectEvidence(failedTask) : null,
    surface: state ? summarizeSurface(state) : null,
    ...(nativeScreenshotCaptured ? { nativeScreenshotPath } : {}),
  };
} finally {
  if (desktop && taskId) {
    stage = "cleanup";
    try {
      await finishAndArchive(taskId);
      const state = await snapshot();
      const task = state.product.tasks.find((entry) => entry.taskId === taskId);
      const ownedAttention = state.product.attention.filter(
        (entry) => entry.taskId === taskId,
      );
      const ownedFileAttention = state.product.fileAttention.filter(
        (entry) => entry.taskId === taskId,
      );
      const ownedWarnings = state.product.recoveryWarnings.filter((warning) =>
        warning.includes(taskId),
      );
      const baselineAfter = baselineProjection(
        state.product.tasks.filter((entry) =>
          baselineTaskIds.includes(entry.taskId),
        ),
      );
      const cleanupViolations = [
        ...(task?.conversation?.archived === true &&
        terminalTaskPhases.has(task.lifecycle.phase)
          ? []
          : ["task_not_closed_and_archived"]),
        ...(ownedAttention.length ? ["run_owned_attention"] : []),
        ...(ownedFileAttention.length ? ["run_owned_file_attention"] : []),
        ...(ownedWarnings.length ? ["run_owned_recovery_warning"] : []),
        ...(state.companion !== null &&
        state.companion.session.id === task?.roveSessionId
          ? ["run_owned_companion"]
          : []),
        ...(JSON.stringify(baselineAfter) === JSON.stringify(baselineTruth)
          ? []
          : ["baseline_task_truth_changed"]),
      ];
      result.cleanup = {
        operation: "normal Finish and Archive",
        task: task ? summarizeTask(task) : null,
        companion:
          state.companion === null
            ? null
            : {
                sessionId: state.companion.session.id,
                status: state.companion.session.status,
                controller: state.companion.session.controller,
              },
        attention: ownedAttention.map((entry) => ({
          authority: entry.authority,
          kind: entry.kind,
          requestId: entry.requestId,
          status: entry.status,
        })),
        fileAttention: ownedFileAttention.map((entry) => ({
          requestId: entry.requestId,
          status: entry.status,
        })),
        recoveryWarnings: ownedWarnings.map((warning) => warning.slice(0, 400)),
        baselinePreserved: !cleanupViolations.includes(
          "baseline_task_truth_changed",
        ),
        violations: cleanupViolations,
      };
      if (cleanupViolations.length) result.status = "failed";
    } catch (cleanupError) {
      result.status = "failed";
      result.cleanupError =
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError);
    }
  }
  await desktop?.application.close().catch(() => undefined);
  const residualProcessIds = await waitForProcessesAbsent(harnessProcessIds);
  result.residualProcessAudit = {
    ownedProcessCount: harnessProcessIds.length,
    residualProcessIds,
  };
  if (residualProcessIds.length) result.status = "failed";
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "completed") process.exitCode = 1;
}
