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
  "artifacts/phase5-drive-live-20260909-181822.json",
);
const nativeScreenshotPath = join(
  root,
  "docs/experiments/artifacts/p5.9-live-acceptance/drive-20260909-181822-native.png",
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
const journey = "drive";
const driveFolderName =
  process.env.ROVE_LIVE_DRIVE_FOLDER_NAME?.trim() ??
  `Rove Live Acceptance P5.9 ${new Date()
    .toISOString()
    .replaceAll(/[-:TZ]/g, "")
    .slice(0, 12)
    .replace(/(\d{8})(\d{4})/, "$1-$2")}`;
if (!/^Rove Live Acceptance P5\.9 \d{8}-\d{4}$/.test(driveFolderName))
  throw new Error(
    "ROVE_LIVE_DRIVE_FOLDER_NAME is not a fresh canonical fixture name.",
  );
const driveAttachment = {
  filename: "rove-live-acceptance.txt",
  size: 74,
  sha256: "2c6a032c7575a2b3a80543b9551eea65ad61a9f4bd78a09a3eb05adf125b485b",
};
const outcome = `Open Google Drive and create one fresh folder named ${driveFolderName}. Use only the pre-launch attached file rove-live-acceptance.txt; a raw local path grants no file authority. Upload it into that folder and verify the uploaded file appears.

Rename the uploaded file to rove-live-acceptance-renamed.txt. Create a subfolder named Archive, move the renamed file into Archive, navigate into Archive, and verify from fresh Drive state that the breadcrumb is My Drive > ${driveFolderName} > Archive and exactly one file with that final name is present. Do not share, invite, email, delete, or alter unrelated Drive content.

Capture a Rove viewport screenshot showing the Archive folder and the file. From the exact folder, call Rove browser.navigate with https://drive.google.com/drive/my-drive so it creates a distinct history entry. Then call browser.back and require it to return to the exact Archive folder URL before verifying the breadcrumb and file again. If a safely completed read-only history operation lands elsewhere, fresh-inspect it and use at most one alternate read-only Rove navigate route for this step.

Download rove-live-acceptance-renamed.txt exactly once through the browser. Use that name only to identify the remote source file. Omit the optional download_completed filename because this journey is discovering and reporting the actual collision-safe saved filename. Obtain the actual local saved filename from durable evidence, along with its evidence identifier, size, and available MIME information. Never retry because of a collision suffix or an uncertain dispatch. Report all six external mutation outcomes and their receipts, the final Drive URL and verification observation, page identity, browser observations, download observation/evidence identifiers, screenshot evidence ID, and an exact description of what is visibly shown.

If authentication is required, request human control and stop. Read-only PAGE_CHANGED/OBSERVATION_STALE before dispatch may be retried once via fresh inspect and resolution. The download must never be retried after an uncertain dispatch; stop and report exact state unless durable evidence proves it did not apply.`;

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
    driveUrls: [
      ...new Set(
        combined.match(/https:\/\/drive\.google\.com\/[^\s)]+/g) ?? [],
      ),
    ],
    receiptIds: [...new Set(combined.match(/rcpt_[a-f0-9]{32}/gi) ?? [])],
    observationIds: [
      ...new Set(combined.match(/(?:bobs|obs)_[a-f0-9]{32}/gi) ?? []),
    ],
    evidenceIds: [...new Set(combined.match(/ev_[a-f0-9]{32}/gi) ?? [])],
    pageIds: [...new Set(combined.match(/page_[A-Za-z0-9_-]+/g) ?? [])],
    downloadFilenameMentions: (
      combined.match(/rove-live-acceptance-renamed\.txt/gi) ?? []
    ).length,
    downloadSizes: [
      ...new Set(combined.match(/\b\d[\d,]*(?:\s+|[-])bytes?\b/gi) ?? []),
    ],
    mimeTypes: [
      ...new Set(
        combined.match(
          /\b(?:text\/plain|application\/octet-stream|[a-z]+\/[a-z0-9.+-]+)\b/gi,
        ) ?? [],
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
  const legacyAcknowledgementTaskId =
    process.env.ROVE_LIVE_ACKNOWLEDGE_LEGACY_TASK_ID?.trim();
  if (legacyAcknowledgementTaskId) {
    const legacyTask = initial.product.tasks.find(
      (task) => task.taskId === legacyAcknowledgementTaskId,
    );
    if (!legacyTask || !terminalTaskPhases.has(legacyTask.lifecycle.phase))
      throw new Error(
        `Legacy-effect acknowledgement requires a terminal known task: ${legacyAcknowledgementTaskId}.`,
      );
    await desktop.page.evaluate(
      async (acknowledgementTaskId) =>
        globalThis.rove.executeProductIntent({
          type: "task.effects.acknowledge",
          taskId: acknowledgementTaskId,
        }),
      legacyAcknowledgementTaskId,
    );
  }
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
  process.stdout.write(
    `ROVE_DRIVE_ATTACHMENT_REQUIRED:${driveAttachment.filename}:${driveAttachment.size}:${driveAttachment.sha256}\n`,
  );
  stage = "drive-attachment-consent";
  await pollSnapshot({
    page: desktop.page,
    snapshot,
    stage,
    timeoutMs: 120_000,
    summarize: summarizeSurface,
    predicate: (state) => {
      const matches = state.product.draftAttachments.filter(
        (entry) => entry.filename === driveAttachment.filename,
      );
      if (matches.length > 1)
        throw new Error(
          "More than one canonical Drive attachment is selected.",
        );
      return matches[0]?.size === driveAttachment.size &&
        matches[0]?.sha256 === driveAttachment.sha256
        ? matches[0]
        : false;
    },
  });
  stage = "composer";
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
