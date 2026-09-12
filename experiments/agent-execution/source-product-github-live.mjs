#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

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
import { postCloseArchiveDisposition } from "./source-product-campaign-recovery.mjs";

const root = resolve(import.meta.dirname, "../..");
const companion = join(root, "apps/companion");
const artifactPath = join(
  root,
  "artifacts/agent-execution-github-live-20260909-181822.json",
);
const nativeScreenshotPath = join(
  root,
  "artifacts/verification/browser-acceptance/github-20260909-181822-native.png",
);
const priorCampaignPath = join(
  root,
  "artifacts/agent-execution-source-product-stabilization.json",
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
const journey = "github";
const recoverTaskId = process.env.ROVE_RECOVER_TASK_ID;
const recoverSessionId = process.env.ROVE_RECOVER_SESSION_ID;
const recoverOperationId = process.env.ROVE_RECOVER_OPERATION_ID;
if (
  [recoverTaskId, recoverSessionId, recoverOperationId].filter(Boolean)
    .length !== 0 &&
  [recoverTaskId, recoverSessionId, recoverOperationId].filter(Boolean)
    .length !== 3
)
  throw new Error(
    "Run-owned recovery requires task, session, and operation identities together.",
  );
const outcome = `Create a new private GitHub repository named rove-agent-execution-live-20260909-181822.

Create issue #1 titled:
[ROVE LIVE] Browser acceptance task

Use this multi-paragraph body, with exactly three initially unchecked checklist items:

This issue verifies the complete Rove Phase 5 browser journey against GitHub’s live product surface.

The result must preserve issue content, ownership, labeling, editing, navigation history, and visual evidence.

- [ ] Create the private repository
- [ ] Verify the saved issue metadata
- [ ] Confirm browser-history navigation

Assign the issue to the current GitHub user and apply the enhancement label. Verify the saved issue. Then edit it so that only the first checklist item is checked, save, and verify the final title, body, checklist, assignee, and label.

Navigate to the repository main page, use browser history to return to the issue, open another repository page in a second tab, return to the issue tab, capture a final Rove viewport screenshot, and describe what is visibly shown.

Do not delete the repository, close the issue, send messages, change account settings, or make unrelated mutations.

At the end, report the repository and issue URLs, the final checklist state, assignee and label, the history and tab verification, the consequential-action receipts, the final browser observation and viewport evidence identifiers, and an exact description of what is visibly shown.`;

let desktop;
let productHome;
let harnessProcessIds = [];
let taskId;
let baselineTaskIds = [];
let baselineTruth = [];
let stage = "startup";
let result;

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

function ownedProcessIdentity() {
  const rootPid = desktop.application.process().pid;
  const table = processTable();
  const owned = new Set([rootPid]);
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
    desktopPid: rootPid,
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
    summarize: (state) => ({
      revision: state?.revision,
      account: state?.product?.catalog?.account?.status,
      taskCount: state?.product?.tasks?.length,
      currentTaskId: state?.product?.currentTaskId,
      productError: state?.productError,
    }),
  });
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
      summarize: (next) => ({
        task: next?.product?.tasks?.find((entry) => entry.taskId === id),
      }),
    });
  }
  state = await snapshot();
  task = state.product.tasks.find((entry) => entry.taskId === id);
  const archive = postCloseArchiveDisposition(task);
  if (archive === "settled" || archive === "not_applicable") return;
  if (archive !== "archive")
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
    summarize: (next) => ({
      task: next?.product?.tasks?.find((entry) => entry.taskId === id),
    }),
  });
}

function taskSummary(task) {
  return {
    taskId: task.taskId,
    lifecycle: task.lifecycle,
    bootstrapStage: task.bootstrapStage,
    initialLaunch: task.initialLaunch,
    roveSessionId: task.roveSessionId,
    codexThreadId: task.codexThreadId,
    executionMode: task.executionMode,
    browserIdentity: task.browserIdentity,
    approvalsReviewer: task.approvalsReviewer,
    availableActions: task.availableActions,
    conversation:
      task.conversation === undefined
        ? null
        : {
            turnStatus: task.conversation.turnStatus,
            archived: task.conversation.archived,
            turnOrder: task.conversation.turnOrder,
            itemCount: Object.keys(task.conversation.items).length,
          },
  };
}

function baselineProjection(tasks) {
  return tasks.map((task) => ({
    taskId: task.taskId,
    lifecyclePhase: task.lifecycle?.phase,
    conversationArchived: task.conversation?.archived ?? null,
  }));
}

function finalEvidence(task) {
  const items = Object.values(task.conversation?.items ?? {});
  const assistantMessages = items
    .filter((item) => item.kind === "assistant_message" && item.text)
    .map((item) => ({ id: item.id, turnId: item.turnId, text: item.text }));
  const combined = assistantMessages.map((item) => item.text).join("\n");
  return {
    assistantMessages,
    toolCalls: items
      .filter((item) => item.kind === "tool")
      .map((item) => ({
        id: item.id,
        turnId: item.turnId,
        status: item.status,
        title: item.title,
      })),
    repositoryUrls: [
      ...new Set(
        combined.match(
          /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/rove-agent-execution-live-20260909-0415(?:\/issues\/1)?/g,
        ) ?? [],
      ),
    ],
    receiptIds: [...new Set(combined.match(/rcpt_[a-f0-9]{32}/gi) ?? [])],
    observationIds: [
      ...new Set(combined.match(/(?:bobs|obs)_[a-f0-9]{32}/gi) ?? []),
    ],
    evidenceIds: [...new Set(combined.match(/ev_[a-f0-9]{32}/gi) ?? [])],
    navigationIds: [...new Set(combined.match(/nav_[a-f0-9]{32}/gi) ?? [])],
  };
}

async function priorRunOwnedIds() {
  try {
    const prior = JSON.parse(await readFile(priorCampaignPath, "utf8"));
    return new Set(
      Array.isArray(prior.tasks)
        ? prior.tasks.map((task) => task.taskId).filter(Boolean)
        : [],
    );
  } catch {
    return new Set();
  }
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
  const processIdentity = ownedProcessIdentity();
  harnessProcessIds = processIdentity.ownedProcessPids;

  stage = "preflight";
  let initial = await waitForProductTruth();
  const priorIds = await priorRunOwnedIds();
  for (const task of initial.product.tasks)
    if (
      priorIds.has(task.taskId) &&
      !terminalTaskPhases.has(task.lifecycle.phase)
    )
      await finishAndArchive(task.taskId);
  initial = await waitForProductTruth();
  const recoveryTask =
    recoverTaskId === undefined
      ? undefined
      : initial.product.tasks.find((task) => task.taskId === recoverTaskId);
  if (recoverTaskId !== undefined) {
    if (!recoveryTask)
      throw new Error(`Run-owned recovery task ${recoverTaskId} is absent.`);
    if (
      recoveryTask.roveSessionId !== recoverSessionId ||
      recoveryTask.initialLaunch?.operationId !== recoverOperationId
    )
      throw new Error(
        "Run-owned recovery identities do not match product truth.",
      );
  }
  const priorNonterminal = initial.product.tasks.filter(
    (task) =>
      priorIds.has(task.taskId) &&
      !terminalTaskPhases.has(task.lifecycle.phase),
  );
  if (priorNonterminal.length)
    throw new Error(
      `Prior run-owned tasks remain nonterminal: ${priorNonterminal.map((task) => task.taskId).join(",")}.`,
    );
  const priorSessions = new Set(
    initial.product.tasks
      .filter((task) => priorIds.has(task.taskId))
      .map((task) => task.roveSessionId)
      .filter(Boolean),
  );
  if (
    initial.companion?.session?.id &&
    priorSessions.has(initial.companion.session.id) &&
    !["completed", "failed"].includes(initial.companion.session.status)
  )
    throw new Error(
      `Prior run-owned Runtime session remains nonterminal: ${initial.companion.session.id}.`,
    );
  const unrelatedNonterminal = initial.product.tasks.filter(
    (task) =>
      task.taskId !== recoverTaskId &&
      !terminalTaskPhases.has(task.lifecycle.phase),
  );
  const unrelatedCompanion =
    initial.companion !== null &&
    initial.companion.session.id !== recoverSessionId;
  if (unrelatedNonterminal.length || unrelatedCompanion)
    throw new Error(
      `Unrelated active product truth blocks an isolated journey: tasks=${unrelatedNonterminal.map((task) => task.taskId).join(",") || "none"}; companion=${initial.companion?.session?.id ?? "none"}.`,
    );
  if (initial.product.catalog.account.status !== "logged_in")
    throw new Error("Rove Codex account is not logged in.");
  const workspaceId =
    initial.workspaces.selectedWorkspaceId ??
    initial.workspaces.workspaces[0]?.id;
  const workspace = initial.workspaces.workspaces.find(
    (entry) => entry.id === workspaceId,
  );
  if (!workspace)
    throw new Error("No existing persistent browser workspace is available.");
  baselineTaskIds = initial.product.tasks
    .filter((task) => task.taskId !== recoverTaskId)
    .map((task) => task.taskId);
  baselineTruth = baselineProjection(
    initial.product.tasks.filter((task) => task.taskId !== recoverTaskId),
  );

  let launch;
  if (recoveryTask) {
    taskId = recoveryTask.taskId;
    launch = {
      task: recoveryTask,
      identity: {
        taskId: recoveryTask.taskId,
        sessionId: recoveryTask.roveSessionId,
        operationId: recoveryTask.initialLaunch?.operationId,
        threadId: recoveryTask.codexThreadId,
      },
    };
  } else {
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
    launch = await pollSnapshot({
      page: desktop.page,
      snapshot,
      stage,
      timeoutMs: 180_000,
      summarize: (state) => ({
        revision: state?.revision,
        tasks: state?.product?.tasks?.map(taskSummary),
        productError: state?.productError,
      }),
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
  }
  taskId = launch.task.taskId;

  stage = "task-terminal";
  const terminal = await pollSnapshot({
    page: desktop.page,
    snapshot,
    stage,
    timeoutMs: 900_000,
    intervalMs: 500,
    summarize: (state) => ({
      revision: state?.revision,
      task: state?.product?.tasks?.find((task) => task.taskId === taskId)
        ? taskSummary(
            state.product.tasks.find((task) => task.taskId === taskId),
          )
        : null,
      attention: state?.product?.attention
        ?.filter((entry) => entry.taskId === taskId)
        .map((entry) => ({
          authority: entry.authority,
          kind: entry.kind,
          status: entry.status,
          requestId: entry.requestId,
        })),
      productError: state?.productError,
    }),
    predicate: (state) => {
      const task = state.product.tasks.find((entry) => entry.taskId === taskId);
      if (!task) throw new Error(`Fresh task ${taskId} disappeared.`);
      const handoff = state.product.attention.find(
        (entry) =>
          entry.taskId === taskId &&
          entry.authority === "rove_control" &&
          entry.kind === "control_handoff" &&
          !["resolved", "cancelled", "stale"].includes(entry.status),
      );
      if (handoff)
        throw new Error(
          `GitHub authentication requires human control: ${handoff.requestId}.`,
        );
      return terminalTurnStatuses.has(task.conversation?.turnStatus)
        ? { revision: state.revision, task, companion: state.companion }
        : false;
    },
  });
  const evidence = finalEvidence(terminal.task);
  await mkdir(dirname(nativeScreenshotPath), { recursive: true });
  await desktop.page.screenshot({ path: nativeScreenshotPath, fullPage: true });
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
    terminalTask: taskSummary(terminal.task),
    journeyVerification,
    liveLedger,
    evidence,
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
  } catch {
    state = undefined;
  }
  result = {
    status: "failed",
    stage,
    error: error instanceof Error ? error.message : String(error),
    ...(taskId === undefined ? {} : { taskId }),
    task:
      taskId === undefined
        ? null
        : taskSummary(
            state?.product?.tasks?.find((task) => task.taskId === taskId) ?? {
              taskId,
              lifecycle: { phase: "unknown" },
              availableActions: [],
            },
          ),
    productError: state?.productError,
  };
} finally {
  if (desktop && taskId) {
    stage = "cleanup";
    try {
      await finishAndArchive(taskId);
      const state = await snapshot();
      const task = state.product.tasks.find((entry) => entry.taskId === taskId);
      const runOwnedAttention = state.product.attention.filter(
        (entry) => entry.taskId === taskId,
      );
      const runOwnedFileAttention = state.product.fileAttention.filter(
        (entry) => entry.taskId === taskId,
      );
      const runOwnedRecoveryWarnings = state.product.recoveryWarnings.filter(
        (warning) => warning.includes(taskId),
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
        ...(runOwnedAttention.length ? ["run_owned_attention"] : []),
        ...(runOwnedFileAttention.length ? ["run_owned_file_attention"] : []),
        ...(runOwnedRecoveryWarnings.length
          ? ["run_owned_recovery_warning"]
          : []),
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
        task: task ? taskSummary(task) : null,
        companion: state.companion,
        runOwnedAttention: runOwnedAttention.map((entry) => ({
          authority: entry.authority,
          kind: entry.kind,
          requestId: entry.requestId,
          status: entry.status,
        })),
        runOwnedFileAttention: runOwnedFileAttention.length,
        runOwnedRecoveryWarnings,
        baselinePreserved: !cleanupViolations.includes(
          "baseline_task_truth_changed",
        ),
        violations: cleanupViolations,
      };
      if (cleanupViolations.length) result.status = "failed";
    } catch (cleanupError) {
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
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (
    result.status !== "completed" ||
    result.cleanupError ||
    residualProcessIds.length
  )
    process.exitCode = 1;
}
