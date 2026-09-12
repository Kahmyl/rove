#!/usr/bin/env node

import console from "node:console";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

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

let application;
try {
  application = await electron.launch({
    executablePath,
    cwd: companion,
    args: [entry, "--rove-manage-services"],
    env: process.env,
  });
  await application.evaluate(({ app }) => app.emit("activate"));
  const page = await application.firstWindow({ timeout: 30_000 });
  let before = await page.evaluate(() => globalThis.rove.getSurfaceSnapshot());
  const cleanupTaskId = process.env.ROVE_CLEANUP_TASK_ID;
  if (cleanupTaskId) {
    let task = before.product?.tasks?.find(
      (entry) => entry.taskId === cleanupTaskId,
    );
    if (!task) throw new Error(`Cleanup task ${cleanupTaskId} was not found.`);
    if (process.env.ROVE_LOG_CLEANUP_TASK === "1")
      console.log(
        JSON.stringify(
          {
            status: "cleanup_task_snapshot",
            task,
            companion: before.companion,
          },
          null,
          2,
        ),
      );
    if (task.conversation?.archived === true) {
      console.log(
        JSON.stringify(
          {
            status: "task_already_archived",
            taskId: cleanupTaskId,
            phase: task.lifecycle.phase,
          },
          null,
          2,
        ),
      );
    } else if (before.product.currentTaskId !== cleanupTaskId) {
      await page
        .getByRole("button", {
          name: `Task history: ${cleanupTaskId}`,
          exact: true,
        })
        .click();
      await page.waitForFunction(
        async (id) =>
          (await globalThis.rove.getSurfaceSnapshot()).product
            ?.currentTaskId === id,
        cleanupTaskId,
      );
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const current = await page.evaluate(
        async (id) => {
          const state = await globalThis.rove.getSurfaceSnapshot();
          return state.product?.tasks?.find((entry) => entry.taskId === id);
        },
        cleanupTaskId,
      );
      if (
        current?.conversation?.archived === true ||
        current?.availableActions?.includes("archive") === true ||
        current?.lifecycle?.phase === "closed"
      )
        break;
      const action = current?.availableActions?.includes("retry_cleanup")
        ? "Retry cleanup"
        : current?.availableActions?.includes("finish")
          ? "Finish"
          : null;
      if (!action)
        throw new Error(
          `Cleanup task ${cleanupTaskId} has no normal cleanup action at ${current?.lifecycle?.phase}.`,
        );
      await page.evaluate(
        ({ taskId, operationId }) =>
          globalThis.rove.executeProductIntent({
            type: "task.stop",
            taskId,
            operationId,
          }),
        {
          taskId: cleanupTaskId,
          operationId:
            current?.operation?.operationId ??
            `intent_${globalThis.crypto.randomUUID()}`,
        },
      );
      await page.waitForFunction(
        async ({ id, previousAction }) => {
          const state = await globalThis.rove.getSurfaceSnapshot();
          const next = state.product?.tasks?.find(
            (entry) => entry.taskId === id,
          );
          return (
            next?.availableActions?.includes("archive") === true ||
            next?.lifecycle?.phase === "closed" ||
            (previousAction === "Finish" &&
              next?.availableActions?.includes("retry_cleanup") === true)
          );
        },
        { id: cleanupTaskId, previousAction: action },
        { timeout: 120_000 },
      );
    }
    const readyToArchive = await page.evaluate(() =>
      globalThis.rove.getSurfaceSnapshot(),
    );
    task = readyToArchive.product.tasks.find(
      (entry) => entry.taskId === cleanupTaskId,
    );
    if (task?.conversation?.archived === true) {
      before = readyToArchive;
    } else if (!task?.availableActions.includes("archive")) {
      if (task?.lifecycle.phase !== "closed")
        throw new Error(
          `Cleanup task ${cleanupTaskId} did not reach a closed or archivable state: ${JSON.stringify(
            {
              phase: task?.lifecycle?.phase,
              reason: task?.lifecycle?.reason,
              availableActions: task?.availableActions,
              sessionId: task?.roveSessionId,
              threadId: task?.codexThreadId,
            },
          )}`,
        );
      console.log(
        JSON.stringify(
          {
            status: "task_closed",
            taskId: cleanupTaskId,
            phase: task.lifecycle.phase,
          },
          null,
          2,
        ),
      );
      before = readyToArchive;
    } else {
      if (readyToArchive.product.currentTaskId !== cleanupTaskId)
        await page
          .getByRole("button", {
            name: `Task history: ${cleanupTaskId}`,
            exact: true,
          })
          .click();
      const archive = page.getByRole("button", {
        name: "Archive",
        exact: true,
      });
      if (await archive.isVisible().catch(() => false)) await archive.click();
      else
        await page.evaluate(
          (taskId) =>
            globalThis.rove.executeProductIntent({
              type: "task.archive",
              taskId,
              operationId: `intent_${globalThis.crypto.randomUUID()}`,
            }),
          cleanupTaskId,
        );
      await page.waitForFunction(
        async (id) => {
          const state = await globalThis.rove.getSurfaceSnapshot();
          return (
            state.product?.tasks?.find((entry) => entry.taskId === id)
              ?.conversation?.archived === true
          );
        },
        cleanupTaskId,
        { timeout: 120_000 },
      );
      before = await page.evaluate(() => globalThis.rove.getSurfaceSnapshot());
      task = before.product.tasks.find(
        (entry) => entry.taskId === cleanupTaskId,
      );
      console.log(
        JSON.stringify(
          {
            status: "task_archived",
            taskId: cleanupTaskId,
            phase: task?.lifecycle?.phase,
          },
          null,
          2,
        ),
      );
    }
  }
  const session = before.companion?.session;
  if (!session) {
    console.log(JSON.stringify({ status: "clean", session: null }, null, 2));
  } else {
    const finish = page.getByRole("button", {
      name: "Finish session",
      exact: true,
    });
    if (await finish.isVisible().catch(() => false)) await finish.click();
    else
      await page.evaluate(
        (sessionId) => globalThis.rove.finishSession(sessionId),
        session.id,
      );
    await page.waitForFunction(
      async () => {
        const state = await globalThis.rove.getSurfaceSnapshot();
        return state.companion === null;
      },
      undefined,
      { timeout: 120_000 },
    );
    await delay(5_000);
    const afterWait = await page.evaluate(() =>
      globalThis.rove.getSurfaceSnapshot(),
    );
    if (afterWait.companion !== null)
      throw new Error("Finished session reappeared before desktop shutdown.");
    console.log(
      JSON.stringify(
        {
          status: "finished",
          session: {
            id: session.id,
            mode: session.mode,
            status: session.status,
            controller: session.controller,
          },
        },
        null,
        2,
      ),
    );
  }
} finally {
  await application?.close().catch(() => undefined);
}
