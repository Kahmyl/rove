#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import { startFixtureServer } from "../../packages/browser/dist/fixtures/fixture-server.js";
import {
  pollProductTruth,
  pollSnapshot,
  validateSurfaceSnapshot,
} from "./source-product-poll.mjs";
import {
  parseRunOwnedRecovery,
  selectRunOwnedRecoveryTask,
  waitForPostCloseArchiveDisposition,
} from "./source-product-campaign-recovery.mjs";
import { evaluateLaunchBoundary } from "./source-product-launch-boundary.mjs";
import { evaluateTerminalCleanliness } from "./source-product-terminal-cleanliness.mjs";

const root = resolve(import.meta.dirname, "../..");
const companion = join(root, "apps/companion");
const artifactPath = join(
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
const terminalPhases = new Set(["closed", "failed"]);
const recoverRunOwned = parseRunOwnedRecovery(process.argv.slice(2));
const fixture = await startFixtureServer();
const expectedAttachmentSha256 = createHash("sha256")
  .update(Buffer.alloc(74, "R"))
  .digest("hex");
const allScenarios = [
  { id: "ordinary-01", kind: "ordinary", path: "/actions" },
  { id: "ordinary-02", kind: "ordinary", path: "/result" },
  { id: "attachment-03", kind: "attachment" },
  { id: "download-04", kind: "download" },
  { id: "handover-05", kind: "handover" },
  { id: "ordinary-06", kind: "ordinary", path: "/actions" },
  { id: "handover-07", kind: "handover" },
  { id: "attachment-08", kind: "attachment" },
  { id: "download-09", kind: "download" },
  { id: "ordinary-10", kind: "ordinary", path: "/result" },
];
const requestedScenarioIds = new Set(
  (process.env.ROVE_CAMPAIGN_SCENARIOS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const scenarios =
  requestedScenarioIds.size === 0
    ? allScenarios
    : allScenarios.filter((scenario) => requestedScenarioIds.has(scenario.id));
if (
  requestedScenarioIds.size > 0 &&
  scenarios.length !== requestedScenarioIds.size
)
  throw new Error("Unknown source campaign scenario selection.");

let desktop;
let baselineTaskIds = new Set();
let baselineCaptured = false;
const runOwnedTaskIds = new Set();
const ledger = [];
const restartPoints = [];
const processIdentities = [];
let currentStage = "startup";
let lastSnapshotShape = null;
let lastTerminalCleanliness;

function valueKind(value) {
  return value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : typeof value;
}

function describeSnapshotShape(state) {
  const product =
    state && typeof state === "object" ? state.product : undefined;
  const tasks =
    product && typeof product === "object" ? product.tasks : undefined;
  return {
    root: valueKind(state),
    revision: valueKind(state?.revision),
    product: valueKind(product),
    tasks: Array.isArray(tasks)
      ? {
          length: tasks.length,
          items: tasks.map((task, index) => ({
            index,
            kind: valueKind(task),
            taskId:
              typeof task?.taskId === "string"
                ? task.taskId
                : valueKind(task?.taskId),
            lifecycle: valueKind(task?.lifecycle),
          })),
        }
      : valueKind(tasks),
    attention: valueKind(product?.attention),
    fileAttention: valueKind(product?.fileAttention),
    recoveryWarnings: valueKind(product?.recoveryWarnings),
  };
}

function boundedString(value, maximum = 400) {
  return typeof value === "string" ? value.slice(0, maximum) : undefined;
}

function describeRunOwnedFailureTasks(state) {
  const rendererError = boundedString(state?.productError);
  const tasks = Array.isArray(state?.product?.tasks) ? state.product.tasks : [];
  return tasks
    .filter(
      (task) =>
        typeof task?.taskId === "string" &&
        (runOwnedTaskIds.has(task.taskId) ||
          (baselineCaptured && !baselineTaskIds.has(task.taskId))),
    )
    .map((task) => ({
      taskId: task.taskId,
      lifecycle: {
        phase: boundedString(task.lifecycle?.phase, 80),
        reason: boundedString(task.lifecycle?.reason),
      },
      closeOperation:
        task.operation?.type === "finish"
          ? {
              operationId: boundedString(task.operation.operationId, 96),
              status: boundedString(task.operation.status, 80),
              reason: boundedString(task.operation.reason),
            }
          : null,
      bootstrapStage: boundedString(task.bootstrapStage, 80),
      initialLaunch:
        task.initialLaunch && typeof task.initialLaunch === "object"
          ? {
              stage: boundedString(task.initialLaunch.stage, 80),
              operationId: boundedString(task.initialLaunch.operationId, 96),
              turnId: boundedString(task.initialLaunch.turnId, 96),
            }
          : null,
      roveSessionId: boundedString(task.roveSessionId, 96),
      codexThreadId: boundedString(task.codexThreadId, 96),
      conversation:
        task.conversation && typeof task.conversation === "object"
          ? {
              turnStatus: boundedString(task.conversation.turnStatus, 80),
              archived: task.conversation.archived === true,
              activeTurnId: boundedString(task.conversation.activeTurnId, 96),
              turnCount: Array.isArray(task.conversation.turnOrder)
                ? task.conversation.turnOrder.length
                : null,
              itemCount:
                task.conversation.items &&
                typeof task.conversation.items === "object"
                  ? Object.keys(task.conversation.items).length
                  : null,
            }
          : null,
      availableActions: Array.isArray(task.availableActions)
        ? task.availableActions
            .filter((action) => typeof action === "string")
            .slice(0, 16)
            .map((action) => action.slice(0, 80))
        : [],
      ...(rendererError === undefined ? {} : { rendererError }),
    }));
}

function assertSnapshotShape(state, label = currentStage) {
  lastSnapshotShape = describeSnapshotShape(state);
  validateSurfaceSnapshot(state, label);
  if (state.product === null) return state;
  const fail = (path, expected, value) => {
    throw new Error(
      `Snapshot ${label} malformed at ${path}: expected ${expected}, received ${valueKind(value)}.`,
    );
  };
  if (!state || typeof state !== "object") fail("root", "object", state);
  if (!state.product || typeof state.product !== "object")
    fail("product", "object", state.product);
  for (const field of [
    "tasks",
    "attention",
    "fileAttention",
    "recoveryWarnings",
  ])
    if (!Array.isArray(state.product[field]))
      fail(`product.${field}`, "array", state.product[field]);
  state.product.tasks.forEach((task, index) => {
    const path = `product.tasks[${index}]`;
    if (!task || typeof task !== "object") fail(path, "object", task);
    if (typeof task.taskId !== "string")
      fail(`${path}.taskId`, "string", task.taskId);
    if (!task.lifecycle || typeof task.lifecycle !== "object")
      fail(`${path}.lifecycle`, "object", task.lifecycle);
    if (typeof task.lifecycle.phase !== "string")
      fail(`${path}.lifecycle.phase`, "string", task.lifecycle.phase);
    if (!Array.isArray(task.availableActions))
      fail(`${path}.availableActions`, "array", task.availableActions);
    if (task.attachments !== undefined && !Array.isArray(task.attachments))
      fail(`${path}.attachments`, "array", task.attachments);
    if (task.conversation !== undefined) {
      if (!task.conversation || typeof task.conversation !== "object")
        fail(`${path}.conversation`, "object", task.conversation);
      if (
        !task.conversation.items ||
        typeof task.conversation.items !== "object"
      )
        fail(`${path}.conversation.items`, "object", task.conversation.items);
      if (!Array.isArray(task.conversation.turnOrder))
        fail(
          `${path}.conversation.turnOrder`,
          "array",
          task.conversation.turnOrder,
        );
    }
  });
  return state;
}

function setStage(stage) {
  currentStage = stage;
}

async function launchDesktop() {
  const application = await electron.launch({
    executablePath,
    cwd: companion,
    args: [entry, "--rove-manage-services"],
    env: process.env,
  });
  await application.evaluate(({ app }) => app.emit("activate"));
  return {
    application,
    page: await application.firstWindow({ timeout: 30_000 }),
  };
}

async function snapshot(page = desktop.page) {
  return assertSnapshotShape(
    await page.evaluate(() => globalThis.rove.getSurfaceSnapshot()),
  );
}

async function waitForProductTruth(page = desktop.page) {
  return pollProductTruth({
    page,
    snapshot,
    stage: currentStage,
    timeoutMs: 30_000,
    summarize: describeSnapshotShape,
  });
}

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

function captureProcessIdentity(label) {
  const desktopPid = desktop.application.process().pid;
  const table = processTable();
  const owned = new Set([desktopPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of table) {
      if (owned.has(entry.parentPid) && !owned.has(entry.pid)) {
        owned.add(entry.pid);
        changed = true;
      }
    }
  }
  const descendants = table.filter((entry) => owned.has(entry.pid));
  const identity = {
    label,
    desktopPid,
    managedRuntimePids: descendants
      .filter((entry) =>
        /apps\/runtime|@rove\/runtime|runtime\/dist/.test(entry.command),
      )
      .map((entry) => entry.pid),
    ownedProcessPids: [...owned],
  };
  processIdentities.push(identity);
  return identity;
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
  const deadline = Date.now() + 15_000;
  let live = liveProcessIds(ids);
  while (live.length && Date.now() < deadline) {
    await delay(100);
    live = liveProcessIds(ids);
  }
  return live;
}

async function selectTask(taskId) {
  const state = await snapshot();
  if (state.product?.currentTaskId === taskId) return;
  await desktop.page
    .getByRole("button", { name: `Task history: ${taskId}`, exact: true })
    .click();
  await desktop.page.waitForFunction(
    async (id) =>
      (await globalThis.rove.getSurfaceSnapshot()).product?.currentTaskId ===
      id,
    taskId,
  );
}

async function finishTask(taskId) {
  let state = await snapshot();
  let task = state.product?.tasks.find((entry) => entry.taskId === taskId);
  if (!task) throw new Error(`Run-owned task ${taskId} disappeared.`);
  if (task.conversation?.archived === true) return;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (task.lifecycle.phase === "closed") break;
    await selectTask(taskId);
    state = await snapshot();
    task = state.product?.tasks.find((entry) => entry.taskId === taskId);
    if (!task)
      throw new Error(`Run-owned task ${taskId} disappeared before close.`);
    if (task.lifecycle.phase === "closed") break;
    const action = task.availableActions.includes("retry_cleanup")
      ? "Retry cleanup"
      : task.availableActions.includes("finish")
        ? "Finish"
        : null;
    if (!action)
      throw new Error(
        `Run-owned task ${taskId} has no visible cleanup control: ${task.lifecycle.phase}.`,
      );
    await desktop.page
      .getByRole("button", { name: action, exact: true })
      .click();
    task = await pollSnapshot({
      page: desktop.page,
      snapshot,
      stage: `${currentStage}:close-attempt-${attempt}`,
      timeoutMs: 120_000,
      summarize: describeSnapshotShape,
      predicate: (next) => {
        const current = next.product.tasks.find(
          (entry) => entry.taskId === taskId,
        );
        if (!current) return false;
        if (current.lifecycle.phase === "closed") return current;
        return current.availableActions.includes("retry_cleanup") &&
          action !== "Retry cleanup"
          ? current
          : false;
      },
    });
  }
  if (task.lifecycle.phase !== "closed")
    throw new Error(
      `Run-owned task ${taskId} did not close after three lifecycle-directed attempts: ${task.lifecycle.phase}.`,
    );
  const postClose = await waitForPostCloseArchiveDisposition({
    readTask: async () => {
      const latest = await snapshot();
      return latest.product?.tasks.find((entry) => entry.taskId === taskId);
    },
    wait: delay,
  });
  task = postClose.task;
  const archiveDisposition = postClose.disposition;
  if (
    archiveDisposition === "settled" ||
    archiveDisposition === "not_applicable"
  )
    return;
  if (archiveDisposition === "archive") {
    await desktop.page
      .getByRole("button", { name: `Task history: ${taskId}`, exact: true })
      .click();
    const archive = desktop.page.getByRole("button", {
      name: "Archive",
      exact: true,
    });
    const deadline = Date.now() + 30_000;
    let clicked = false;
    while (Date.now() < deadline) {
      const latest = await snapshot();
      const latestTask = latest.product.tasks.find(
        (entry) => entry.taskId === taskId,
      );
      if (latestTask?.conversation?.archived === true) return;
      if (await archive.isVisible().catch(() => false)) {
        try {
          await archive.click({ trial: true, timeout: 2_000 });
          await archive.click({ timeout: 2_000 });
          clicked = true;
          break;
        } catch {
          const afterClick = await snapshot();
          const afterClickTask = afterClick.product.tasks.find(
            (entry) => entry.taskId === taskId,
          );
          if (afterClickTask?.conversation?.archived === true) return;
        }
      }
      await delay(100);
    }
    if (!clicked)
      throw new Error(`Run-owned task ${taskId} did not expose Archive.`);
    await pollSnapshot({
      page: desktop.page,
      snapshot,
      stage: `${currentStage}:archived`,
      timeoutMs: 120_000,
      summarize: describeSnapshotShape,
      predicate: (next) =>
        next.product.tasks.some(
          (entry) =>
            entry.taskId === taskId && entry.conversation?.archived === true,
        ) || false,
    });
    return;
  }
  throw new Error(`Run-owned task ${taskId} did not expose Archive.`);
}

async function cleanupRunOwned() {
  if (!baselineCaptured) return;
  if (!desktop) desktop = await launchDesktop();
  const state = await waitForProductTruth();
  for (const task of state.product?.tasks ?? []) {
    if (!baselineTaskIds.has(task.taskId)) runOwnedTaskIds.add(task.taskId);
  }
  for (const taskId of runOwnedTaskIds) await finishTask(taskId);
}

async function restartDesktop(label) {
  const prior = processIdentities.at(-1);
  await desktop.application.close();
  const lingering = prior
    ? await waitForProcessesAbsent(prior.ownedProcessPids)
    : [];
  if (lingering.length)
    throw new Error(
      `Restart ${label} left launch-owned processes active: ${lingering.join(",")}.`,
    );
  desktop = await launchDesktop();
  await waitForProductTruth();
  captureProcessIdentity(label);
  restartPoints.push(label);
}

function scenarioPrompt(scenario) {
  if (scenario.kind === "attachment")
    return `Campaign ${scenario.id}. Use only the normal Rove MCP browser tools. Navigate to ${fixture.url}/actions. Upload the already-authorized task attachment semantic-upload.txt to Direct file. Inspect the page after upload and report the exact token campaign:${scenario.id}:uploaded:semantic-upload.txt. Do not use shell commands, filesystem paths, direct HTTP, Computer Use, or another browser authority.`;
  if (scenario.kind === "download")
    return `Campaign ${scenario.id}. Use only the normal Rove MCP browser tools. Navigate to ${fixture.url}/download. Activate Download file with the expected effect download_completed for the exact filename rove-session-download.txt. After the expected-effect receipt, perform a fresh browser inspection and call evidence.list. In the final response report exactly campaign:${scenario.id}:downloaded:rove-session-download.txt evidenceId=<the canonical ev_ ID from the receipt/list> observationId=<the canonical obs_ ID from the receipt>. Do not use shell commands, direct HTTP, Computer Use, or another browser authority.`;
  if (scenario.kind === "handover")
    return `Campaign ${scenario.id}. Use only the normal Rove MCP browser tools. Navigate to ${fixture.url}/actions, then call Rove control.request_human with continuationPolicy resume_after_control_return and ask the human to inspect the page. After control is returned, perform a fresh inspection and report the exact token campaign:${scenario.id}:returned:Browser actions. Do not use Computer Use or another browser authority.`;
  const title = scenario.path === "/result" ? "Result page" : "Browser actions";
  return `Campaign ${scenario.id}. Use only the normal Rove MCP browser tools. Navigate to ${fixture.url}${scenario.path}, inspect the page, and report the exact token campaign:${scenario.id}:inspected:${title}. Do not use shell commands, direct HTTP, Computer Use, or another browser authority.`;
}

function expectedToken(scenario) {
  if (scenario.kind === "attachment")
    return `campaign:${scenario.id}:uploaded:semantic-upload.txt`;
  if (scenario.kind === "download")
    return `campaign:${scenario.id}:downloaded:rove-session-download.txt`;
  if (scenario.kind === "handover")
    return `campaign:${scenario.id}:returned:Browser actions`;
  return `campaign:${scenario.id}:inspected:${scenario.path === "/result" ? "Result page" : "Browser actions"}`;
}

async function openComposer() {
  const back = desktop.page.getByRole("button", {
    name: "Back to new task",
    exact: true,
  });
  if (await back.isVisible().catch(() => false)) await back.click();
  await desktop.page
    .getByLabel("Desired outcome", { exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function runScenario(scenario, index) {
  setStage(`${scenario.id}:composer-visible`);
  await openComposer();
  setStage(`${scenario.id}:composer-fill`);
  await desktop.page
    .getByLabel("Desired outcome", { exact: true })
    .fill(scenarioPrompt(scenario));
  await desktop.page
    .getByLabel("Browser identity", { exact: true })
    .selectOption("temporary");
  if (scenario.kind === "attachment") {
    setStage(`${scenario.id}:attachment-select`);
    await desktop.page
      .getByRole("button", { name: "Attach files", exact: true })
      .click();
    await desktop.page.getByText("74 bytes", { exact: true }).waitFor();
  }
  setStage(`${scenario.id}:prelaunch-snapshot`);
  const priorIds = (await snapshot()).product.tasks.map((task) => task.taskId);
  setStage(`${scenario.id}:launch-click`);
  await desktop.page
    .getByRole("button", { name: "Start task", exact: true })
    .click();
  let expectedLaunchIdentity;
  const launch = await pollSnapshot({
    page: desktop.page,
    snapshot,
    stage: `${scenario.id}:launch-boundary`,
    timeoutMs: 120_000,
    summarize: describeSnapshotShape,
    predicate: (state) => {
      const decision = evaluateLaunchBoundary({
        state,
        priorTaskIds: priorIds,
        priorLedger: ledger,
        expectedIdentity: expectedLaunchIdentity,
        terminalPhases,
      });
      expectedLaunchIdentity = decision.identity;
      if (decision.identity?.taskId)
        runOwnedTaskIds.add(decision.identity.taskId);
      if (decision.status === "invalid")
        throw new Error(
          `Campaign ${scenario.id} launch boundary is invalid: ${decision.reason}.`,
        );
      return decision.status === "ready"
        ? { revision: decision.revision, task: decision.task }
        : false;
    },
  });
  setStage(`${scenario.id}:launch-boundary`);
  if (!launch || typeof launch !== "object" || !launch.task)
    throw new Error(
      `Campaign ${scenario.id} launch wait returned ${JSON.stringify(launch).slice(0, 500)} instead of a task boundary.`,
    );
  assertSnapshotShape(
    {
      revision: launch.revision,
      product: {
        tasks: [launch.task],
        attention: [],
        fileAttention: [],
        recoveryWarnings: [],
      },
    },
    `${scenario.id}:launch-boundary-task`,
  );
  const taskId = launch.task.taskId;
  runOwnedTaskIds.add(taskId);

  if (scenario.kind === "handover") {
    setStage(`${scenario.id}:handover-take`);
    await pollSnapshot({
      page: desktop.page,
      snapshot,
      stage: `${scenario.id}:handover-authoritative`,
      timeoutMs: 180_000,
      summarize: describeSnapshotShape,
      predicate: (state) => {
        const current = state.product.tasks.find(
          (entry) => entry.taskId === taskId,
        );
        const attention = state.product.attention.find(
          (entry) =>
            entry.taskId === taskId &&
            entry.authority === "rove_control" &&
            entry.kind === "control_handoff" &&
            entry.status === "pending",
        );
        return current?.runtime?.status === "awaiting_human" &&
          current.runtime.controller === null &&
          attention
          ? { current, attention }
          : false;
      },
    });
    let takeOver = desktop.page
      .getByRole("button", { name: "Take Over", exact: true })
      .filter({ visible: true })
      .first();
    if (!(await takeOver.isVisible().catch(() => false))) {
      const expand = desktop.page
        .getByRole("button", { name: /^Expand Rove\./ })
        .filter({ visible: true })
        .first();
      if (await expand.isVisible().catch(() => false)) await expand.click();
      takeOver = desktop.page
        .getByRole("button", { name: "Take Over", exact: true })
        .filter({ visible: true })
        .first();
    }
    await takeOver.waitFor({ state: "visible", timeout: 180_000 });
    await takeOver.click();
    setStage(`${scenario.id}:handover-return`);
    const returnControl = desktop.page
      .getByRole("button", { name: /^Return [Cc]ontrol$/ })
      .filter({ visible: true })
      .first();
    await returnControl.waitFor({ state: "visible", timeout: 60_000 });
    await returnControl.click();
  }

  setStage(`${scenario.id}:terminal-wait`);
  let terminal = await pollSnapshot({
    page: desktop.page,
    snapshot,
    stage: `${scenario.id}:terminal-wait`,
    timeoutMs: 600_000,
    summarize: describeSnapshotShape,
    predicate: (state) => {
      const task = state.product.tasks.find((entry) => entry.taskId === taskId);
      return task &&
        ["completed", "failed", "interrupted"].includes(
          task.conversation?.turnStatus ?? "",
        )
        ? { revision: state.revision, task, companion: state.companion }
        : false;
    },
  });
  if (!terminal || typeof terminal !== "object" || !terminal.task)
    throw new Error(
      `Campaign ${scenario.id} terminal wait returned ${JSON.stringify(terminal).slice(0, 500)} instead of task truth.`,
    );
  assertSnapshotShape(
    {
      revision: terminal.revision,
      product: {
        tasks: [terminal.task],
        attention: [],
        fileAttention: [],
        recoveryWarnings: [],
      },
    },
    `${scenario.id}:terminal-task`,
  );
  setStage(`${scenario.id}:terminal-assertions`);
  if (terminal.task.conversation?.turnStatus !== "completed")
    throw new Error(
      `Campaign ${scenario.id} ended ${terminal.task.conversation?.turnStatus ?? "without truth"}.`,
    );
  const transcript = Object.values(terminal.task.conversation.items)
    .flatMap((item) => (item.text ? [item.text] : []))
    .join("\n");
  if (!transcript.includes(expectedToken(scenario)))
    throw new Error(
      `Campaign ${scenario.id} omitted ${expectedToken(scenario)}.`,
    );
  const attachment = terminal.task.attachments?.[0];
  const downloadMatch =
    scenario.kind === "download"
      ? transcript.match(
          new RegExp(
            `campaign:${scenario.id}:downloaded:rove-session-download\\.txt\\s+evidenceId=(ev_[a-f0-9]{32})\\s+observationId=(obs_[a-f0-9]{32})`,
            "i",
          ),
        )
      : null;
  if (
    scenario.kind === "attachment" &&
    (attachment?.filename !== "semantic-upload.txt" ||
      attachment.size !== 74 ||
      attachment.sha256 !== expectedAttachmentSha256 ||
      attachment.status !== "bound" ||
      !attachment.evidenceId)
  )
    throw new Error(`Campaign ${scenario.id} attachment evidence is inexact.`);
  if (
    scenario.kind === "download" &&
    (!downloadMatch ||
      !/^ev_[a-f0-9]{32}$/.test(downloadMatch[1]) ||
      !/^obs_[a-f0-9]{32}$/.test(downloadMatch[2]) ||
      (terminal.companion?.evidenceCount ?? 0) < 1 ||
      (terminal.companion?.observationCount ?? 0) < 1)
  )
    throw new Error(`Campaign ${scenario.id} lacks durable download evidence.`);

  if (index === 1) {
    setStage(`${scenario.id}:restart-before-finish`);
    await restartDesktop(`${scenario.id}:terminal-before-finish`);
    await selectTask(taskId);
    terminal = {
      ...terminal,
      task: (await snapshot()).product.tasks.find(
        (task) => task.taskId === taskId,
      ),
    };
  }
  setStage(`${scenario.id}:finish-archive`);
  await finishTask(taskId);
  if (index === 5) await restartDesktop(`${scenario.id}:closed-after-archive`);

  ledger.push({
    scenario: scenario.id,
    kind: scenario.kind,
    taskId,
    operationId: launch.task.initialLaunch.operationId,
    sessionId: launch.task.roveSessionId,
    threadId: launch.task.codexThreadId,
    turnId: launch.task.initialLaunch.turnId,
    launchRevision: launch.revision,
    terminalRevision: terminal.revision,
    evidenceIds: [attachment?.evidenceId, downloadMatch?.[1]].filter(Boolean),
    ...(downloadMatch
      ? {
          downloadEvidenceId: downloadMatch[1],
          downloadObservationId: downloadMatch[2],
        }
      : {}),
    result: expectedToken(scenario),
  });
}

function assertClean(state) {
  lastTerminalCleanliness = evaluateTerminalCleanliness({
    state,
    runOwnedTaskIds,
    ledger,
  });
  if (!lastTerminalCleanliness.ok)
    throw new Error(
      `Terminal cleanup failed: ${lastTerminalCleanliness.violations.join(";")}`,
    );
  return lastTerminalCleanliness;
}

let result;
try {
  setStage("startup:launch-desktop");
  desktop = await launchDesktop();
  setStage("startup:product-truth");
  let initial = await waitForProductTruth();
  setStage("startup:process-identity");
  captureProcessIdentity("campaign:start");
  baselineTaskIds = new Set(initial.product.tasks.map((task) => task.taskId));
  baselineCaptured = true;
  const recoveryTask = selectRunOwnedRecoveryTask(
    initial.product.tasks,
    recoverRunOwned,
    terminalPhases,
  );
  if (recoveryTask) {
    setStage("startup:recover-run-owned");
    runOwnedTaskIds.add(recoveryTask.taskId);
    baselineTaskIds.delete(recoveryTask.taskId);
    await finishTask(recoveryTask.taskId);
    initial = await waitForProductTruth();
  }
  setStage("startup:account-assertion");
  if (initial.product.catalog.account.status !== "logged_in")
    throw new Error(
      "The source-built campaign requires a logged-in Codex account.",
    );
  const baselineNonterminal = initial.product.tasks.filter(
    (task) => !terminalPhases.has(task.lifecycle.phase),
  );
  if (initial.companion !== null || baselineNonterminal.length)
    throw new Error(
      `Refusing to mutate baseline state: companion=${initial.companion?.session.id ?? "none"}; tasks=${baselineNonterminal.map((task) => task.taskId).join(",") || "none"}.`,
    );
  for (const [index, scenario] of scenarios.entries())
    await runScenario(scenario, index);
  setStage("terminal:restart");
  await restartDesktop("campaign:terminal-verification");
  const terminal = await waitForProductTruth();
  const terminalCleanliness = assertClean(terminal);
  const ownedProcessPids = [
    ...new Set(processIdentities.flatMap((entry) => entry.ownedProcessPids)),
  ];
  await desktop.application.close();
  desktop = undefined;
  const liveOwnedProcessPids = await waitForProcessesAbsent(ownedProcessPids);
  if (liveOwnedProcessPids.length)
    throw new Error(
      `Terminal cleanup left launch-owned processes active: ${liveOwnedProcessPids.join(",")}.`,
    );
  result = {
    status: "passed",
    sourceProduct: true,
    tasks: ledger,
    restartPoints,
    processIdentities,
    cleanup: {
      runOwnedTaskCount: runOwnedTaskIds.size,
      activeProcesses: liveOwnedProcessPids.length,
      activeRuntimeSessions: 0,
      attachmentBytes: 0,
      unresolvedAttention: 0,
      recoveryWarnings: 0,
      nonterminalTasks: 0,
      resolvedHandoverAttention:
        terminalCleanliness.evidence.resolvedHandoverAttentionCount,
      baselinePreserved: true,
    },
    artifactPath,
  };
} catch (error) {
  const failure = error instanceof Error ? error.message : String(error);
  const errorStack =
    error instanceof Error && typeof error.stack === "string"
      ? error.stack.slice(0, 4_000)
      : undefined;
  let failureSnapshotShape = lastSnapshotShape;
  let failureTaskSummaries = [];
  let failureRendererError;
  if (desktop?.page) {
    const failureSnapshot = await desktop.page
      .evaluate(() => globalThis.rove.getSurfaceSnapshot())
      .catch(() => undefined);
    if (failureSnapshot !== undefined) {
      failureSnapshotShape = describeSnapshotShape(failureSnapshot);
      failureTaskSummaries = describeRunOwnedFailureTasks(failureSnapshot);
      failureRendererError = boundedString(failureSnapshot.productError);
    }
  }
  let cleanupFailure;
  try {
    await cleanupRunOwned();
  } catch (cleanupError) {
    cleanupFailure =
      cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError);
  }
  result = {
    status: "failed",
    sourceProduct: true,
    currentStage,
    failedInvariant: failure,
    ...(errorStack === undefined ? {} : { errorStack }),
    snapshotShape: failureSnapshotShape,
    runOwnedTaskSummaries: failureTaskSummaries,
    ...(lastTerminalCleanliness === undefined
      ? {}
      : { terminalCleanliness: lastTerminalCleanliness }),
    ...(failureRendererError === undefined
      ? {}
      : { rendererError: failureRendererError }),
    ...(cleanupFailure === undefined ? {} : { cleanupFailure }),
    tasks: ledger,
    runOwnedTaskIds: [...runOwnedTaskIds],
    restartPoints,
    processIdentities,
    artifactPath,
  };
  process.exitCode = 1;
} finally {
  await desktop?.application.close().catch(() => undefined);
  await fixture.close().catch(() => undefined);
}

await mkdir(dirname(artifactPath), { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(result)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(result)}\n`);
