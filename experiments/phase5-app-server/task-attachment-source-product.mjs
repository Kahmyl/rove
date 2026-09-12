#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

import { startFixtureServer } from "../../packages/browser/dist/fixtures/fixture-server.js";
import {
  pollProductTruth,
  pollSnapshot,
  validateSurfaceSnapshot,
} from "./source-product-poll.mjs";

const root = resolve(import.meta.dirname, "../..");
const companion = join(root, "apps/companion");
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
const sandbox = await mkdtemp(join(tmpdir(), "rove-attachment-product-"));
const productHome = join(sandbox, "product-home");
const canonical = process.argv.includes("--canonical-product-home");
const fixture = await startFixtureServer();
const knownStrandedTask = {
  taskId: "task_b39ec96c-14f0-409d-884e-ea735287a0d5",
  sessionId: "ses_3aece01d32d84fa7a1e4c27288a3a336",
};
const terminalPhases = new Set(["closed", "failed"]);

async function launch() {
  const userData = await mkdtemp(join(sandbox, "electron-"));
  const application = await electron.launch({
    executablePath,
    cwd: companion,
    args: [entry, "--rove-manage-services", `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      ...(canonical ? {} : { ROVE_DESKTOP_HOME: productHome }),
    },
  });
  await application.evaluate(({ app }) => app.emit("activate"));
  return {
    application,
    page: await application.firstWindow({ timeout: 30_000 }),
  };
}

async function snapshot(page) {
  return validateSurfaceSnapshot(
    await page.evaluate(() => globalThis.rove.getSurfaceSnapshot()),
    "attachment-qualification",
  );
}

async function waitForProductTruth(page) {
  return pollProductTruth({
    page,
    snapshot,
    stage: "attachment:product-truth",
    timeoutMs: 30_000,
    summarize: snapshotSummary,
  });
}

function snapshotSummary(state) {
  return {
    revision: state?.revision,
    product: state?.product === null ? null : typeof state?.product,
    tasks: Array.isArray(state?.product?.tasks)
      ? state.product.tasks.map((task) => ({
          taskId: task.taskId,
          phase: task.lifecycle?.phase,
          launch: task.initialLaunch?.stage,
        }))
      : typeof state?.product?.tasks,
    companion: state?.companion?.session?.id ?? null,
  };
}

async function convergeTaskThroughProduct(page, taskId) {
  let state = await waitForProductTruth(page);
  let task = state.product?.tasks.find((entry) => entry.taskId === taskId);
  if (!task || terminalPhases.has(task.lifecycle.phase)) return;
  if (state.product?.currentTaskId !== task.taskId) {
    await page
      .getByRole("button", {
        name: `Task history: ${task.taskId}`,
        exact: true,
      })
      .click();
    state = await snapshot(page);
    task = state.product?.tasks.find((entry) => entry.taskId === taskId);
  }
  const action = task?.availableActions.includes("retry_cleanup")
    ? "Retry cleanup"
    : task?.availableActions.includes("finish")
      ? "Finish"
      : null;
  if (!action)
    throw new Error(
      `Task ${taskId} cannot be converged through a visible product control: ${task?.lifecycle.phase ?? "missing"} (${task?.availableActions.join(",") ?? ""}).`,
    );
  await page.getByRole("button", { name: action, exact: true }).click();
  await pollSnapshot({
    page,
    snapshot,
    stage: `attachment:close:${taskId}`,
    timeoutMs: 120_000,
    summarize: snapshotSummary,
    predicate: (next) =>
      next.product.tasks.some(
        (entry) =>
          entry.taskId === taskId && terminalPhases.has(entry.lifecycle.phase),
      ) || false,
  });
}

async function prepareQualificationState(page) {
  let state = await waitForProductTruth(page);
  const nonterminal = (state.product?.tasks ?? []).filter(
    (task) => !terminalPhases.has(task.lifecycle.phase),
  );
  for (const task of nonterminal) {
    const isKnownStrandedTask =
      canonical &&
      task.taskId === knownStrandedTask.taskId &&
      task.roveSessionId === knownStrandedTask.sessionId;
    if (!isKnownStrandedTask)
      throw new Error(
        `Refusing to mutate unrelated pre-existing task ${task.taskId}: ${task.lifecycle.phase} (${task.roveSessionId ?? "no session"}).`,
      );
    await convergeTaskThroughProduct(page, task.taskId);
  }

  state = await snapshot(page);
  if (state.companion !== null) {
    const sessionId = state.companion.session.id;
    if (!canonical || sessionId !== knownStrandedTask.sessionId)
      throw new Error(
        `Refusing to mutate unrelated pre-existing companion session ${sessionId}.`,
      );
    await page
      .getByRole("button", { name: "Finish session", exact: true })
      .click();
    await pollSnapshot({
      page,
      snapshot,
      stage: "attachment:companion-close",
      summarize: snapshotSummary,
      predicate: (next) => next.companion === null || false,
    });
  }

  const backToComposer = page.getByRole("button", {
    name: "Back to new task",
    exact: true,
  });
  if (await backToComposer.isVisible().catch(() => false))
    await backToComposer.click();
  try {
    await page
      .getByLabel("Desired outcome", { exact: true })
      .waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    throw new Error(
      `Composer remained unavailable after visible convergence: ${(await page.locator("body").innerText()).slice(0, 2_000)}`,
    );
  }
  return snapshot(page);
}

let first;
let second;
let baselineTaskIds = new Set();
const runOwnedTaskIds = new Set();
try {
  qualification: {
    first = await launch();
    const { page } = first;
    const initial = await prepareQualificationState(page);
    baselineTaskIds = new Set(
      (initial.product?.tasks ?? []).map((task) => task.taskId),
    );
    if (canonical && initial.product?.catalog.account.status !== "logged_in")
      throw new Error(
        "Canonical source-product home has no authenticated App Server account.",
      );

    await page
      .getByLabel("Desired outcome", { exact: true })
      .fill(
        `Use only the normal Rove MCP browser tools. Navigate to ${fixture.url}/actions. Upload the already-authorized task attachment semantic-upload.txt to the input labeled Direct file. Inspect the page after the upload and report the exact visible upload result. Do not use shell commands or filesystem paths and do not request another file.`,
      );
    await page
      .getByLabel("Browser identity", { exact: true })
      .selectOption("temporary");
    await page
      .getByRole("button", { name: "Attach files", exact: true })
      .click();
    await page.getByText("74 bytes", { exact: true }).waitFor();
    if (!canonical && initial.product?.catalog.account.status !== "logged_in") {
      process.stdout.write(
        `${JSON.stringify({
          status: "blocked",
          sourceProduct: true,
          productHome: "isolated",
          signedInAppServerAccount: false,
          productLaunchBlocker: "Sign in to Rove with ChatGPT before starting.",
          rendererAttachmentSelectionVerified: true,
          fixtureBytes: 74,
          taskBrowserDrivenByHarness: false,
        })}\n`,
      );
      break qualification;
    }

    const existingTaskIds = [...baselineTaskIds];
    const start = page.getByRole("button", { name: "Start task", exact: true });
    try {
      await page.waitForFunction(
        () => {
          const button = [
            ...globalThis.document.querySelectorAll("button"),
          ].find((entry) => entry.textContent?.trim() === "Start task");
          return (
            button instanceof globalThis.HTMLButtonElement && !button.disabled
          );
        },
        undefined,
        { timeout: 60_000 },
      );
    } catch {
      throw new Error(
        `Source-product launch remained gated: ${(await page.locator("body").innerText()).slice(0, 2_000)}`,
      );
    }
    await start.click();

    const boundary = await pollSnapshot({
      page,
      snapshot,
      stage: "attachment:launch-boundary",
      timeoutMs: 120_000,
      summarize: snapshotSummary,
      predicate: (state) => {
        const candidates = state.product.tasks.filter(
          (task) =>
            !existingTaskIds.includes(task.taskId) &&
            task.initialLaunch?.stage === "turn_started" &&
            typeof task.initialLaunch.operationId === "string" &&
            typeof task.initialLaunch.turnId === "string" &&
            typeof task.codexThreadId === "string" &&
            typeof task.roveSessionId === "string",
        );
        return candidates.length === 1
          ? { revision: state.revision, task: candidates[0] }
          : false;
      },
    });
    const launchedTask = boundary.task;
    const launchedTaskId = launchedTask.taskId;
    runOwnedTaskIds.add(launchedTaskId);
    if (
      !/^intent_[0-9a-f-]{36}$/i.test(launchedTask.initialLaunch.operationId) ||
      launchedTask.conversation?.turnOrder.includes(
        launchedTask.initialLaunch.turnId,
      ) !== true
    )
      throw new Error(
        "The source-product launch boundary did not expose one durable initial turn.",
      );

    const completed = await pollSnapshot({
      page,
      snapshot,
      stage: `attachment:terminal:${launchedTaskId}`,
      timeoutMs: 600_000,
      summarize: snapshotSummary,
      predicate: (state) => {
        const task = state.product.tasks.find(
          (entry) => entry.taskId === launchedTaskId,
        );
        return task &&
          ["completed", "failed", "interrupted"].includes(
            task.conversation?.turnStatus ?? "",
          )
          ? { revision: state.revision, task }
          : false;
      },
    });
    const task = completed.task;
    if (task.conversation?.turnStatus !== "completed")
      throw new Error(
        `Source-product task did not complete: ${task.conversation?.turnStatus ?? "missing"}`,
      );
    const attachment = task.attachments?.[0];
    if (
      !attachment ||
      attachment.filename !== "semantic-upload.txt" ||
      attachment.size !== 74 ||
      attachment.status !== "bound" ||
      !attachment.evidenceId
    )
      throw new Error("Source-product attachment evidence was not exact.");
    const expectedSha256 = createHash("sha256")
      .update(Buffer.alloc(74, "R"))
      .digest("hex");
    if (attachment.sha256 !== expectedSha256)
      throw new Error("Source-product attachment digest changed.");
    const transcript = Object.values(task.conversation.items)
      .flatMap((item) => (item.text ? [item.text] : []))
      .join("\n");
    if (!transcript.includes("uploaded:semantic-upload.txt"))
      throw new Error(
        "The task did not report the exact fixture upload result.",
      );

    const taskId = task.taskId;
    const sessionId = task.roveSessionId;
    const evidenceId = attachment.evidenceId;
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    await pollSnapshot({
      page,
      snapshot,
      stage: `attachment:finished:${taskId}`,
      timeoutMs: 120_000,
      summarize: snapshotSummary,
      predicate: (state) =>
        state.product.tasks.some(
          (entry) =>
            entry.taskId === taskId && entry.lifecycle.phase === "closed",
        ) || false,
    });
    await page
      .getByRole("button", { name: `Task history: ${taskId}`, exact: true })
      .click();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await pollSnapshot({
      page,
      snapshot,
      stage: `attachment:archived:${taskId}`,
      timeoutMs: 120_000,
      summarize: snapshotSummary,
      predicate: (state) =>
        state.product.tasks.some(
          (entry) =>
            entry.taskId === taskId && entry.conversation?.archived === true,
        ) || false,
    });
    await first.application.close();
    first = undefined;

    second = await launch();
    const restarted = await waitForProductTruth(second.page);
    const recovered = restarted.product?.tasks.find(
      (entry) => entry.taskId === taskId,
    );
    if (
      recovered?.lifecycle.phase !== "closed" ||
      recovered.conversation?.archived !== true ||
      (recovered.attachments?.length ?? 0) !== 0 ||
      restarted.product?.fileAttention.length !== 0 ||
      restarted.companion !== null
    )
      throw new Error("Restart did not preserve terminal attachment cleanup.");
    process.stdout.write(
      `${JSON.stringify({
        status: "passed",
        sourceProduct: true,
        productHome: canonical ? "canonical" : "isolated",
        sourceRenderer: true,
        taskBrowserDrivenByHarness: false,
        fixtureUrlClass: "loopback",
        fixtureResult: "uploaded:semantic-upload.txt",
        fixtureBytes: 74,
        sha256: expectedSha256,
        evidenceId,
        taskId,
        sessionId,
        threadId: task.codexThreadId,
        initialTurnId: task.initialLaunch?.turnId,
        launchOperationId: task.initialLaunch?.operationId,
        launchBoundaryRevision: boundary.revision,
        terminalRevision: completed.revision,
        finished: true,
        archived: true,
        restartCleanupVerified: true,
        nativeOsPicker: false,
      })}\n`,
    );
  }
} finally {
  if (first) {
    const state = await snapshot(first.page).catch(() => null);
    for (const task of state?.product?.tasks ?? []) {
      if (!baselineTaskIds.has(task.taskId)) runOwnedTaskIds.add(task.taskId);
    }
    for (const taskId of runOwnedTaskIds)
      await convergeTaskThroughProduct(first.page, taskId);
  }
  await first?.application.close().catch(() => undefined);
  await second?.application.close().catch(() => undefined);
  await fixture.close().catch(() => undefined);
  await rm(sandbox, { recursive: true, force: true });
}
