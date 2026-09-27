#!/usr/bin/env node

import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

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
  "dist/main/main/qualification/startup-hydration-main.js",
);
const fixtureHome = await mkdtemp(join(tmpdir(), "rove-startup-hydration-"));
const fixturePath = join(fixtureHome, "persisted-product.json");

const capabilities = {
  canSubmit: true,
  canQueue: false,
  canSteer: false,
  canStop: false,
  canRespond: false,
  canTakeControl: false,
  canReturnToRove: false,
  canRetry: false,
  canArchive: false,
};
const task = (taskId, title, unresolved) => ({
  taskId,
  executionMode: "agent",
  selectionSource: "user_selected",
  selectedAt: "2026-09-27T00:00:00.000Z",
  approvalsReviewer: "auto_review",
  bootstrapStage: "complete",
  results: [],
  lifecycle: { phase: "ready", reason: "Persisted fixture" },
  availableActions: ["message"],
  capabilities,
  conversation: {
    turnStatus: "completed",
    archived: false,
    items: {
      [`user_${taskId}`]: {
        id: `user_${taskId}`,
        kind: "user_message",
        status: "completed",
        authoredBy: "user",
        text: title,
      },
      [`assistant_${taskId}`]: {
        id: `assistant_${taskId}`,
        kind: "assistant_message",
        status: "completed",
        text: unresolved
          ? "The last action could not be confirmed."
          : "This persisted task remains ready for follow-up.",
      },
    },
    itemOrder: [`user_${taskId}`, `assistant_${taskId}`],
    turnOrder: [],
  },
  customerExecution: {
    state: unresolved ? "unresolved" : "ready",
    queue: [],
    segments: [],
  },
  customerPresentation: unresolved
    ? {
        state: "outcome_unclear",
        sidebar: { label: "Couldn't continue", tone: "danger" },
        conversationStatus: {
          title: "Task state unclear",
          description:
            "Rove could not confirm the latest task state. It will not repeat the affected action automatically.",
          tone: "danger",
        },
        terminalWorkLabel: "Couldn't continue",
      }
    : { state: "ready", terminalWorkLabel: "Worked" },
});

await writeFile(
  fixturePath,
  JSON.stringify({
    version: 9,
    host: { state: "ready", ready: true, restartAttempt: 0 },
    catalog: {
      account: { status: "logged_in", authMode: "chatgpt" },
      models: [
        {
          id: "fixture-model",
          model: "fixture-model",
          displayName: "Fixture model",
          description: "Local qualification only",
          efforts: ["low"],
          defaultEffort: "low",
          isDefault: true,
          inputModalities: ["text"],
          supportsPersonality: false,
          defaultServiceTier: null,
        },
      ],
      rateLimits: null,
      usage: null,
      refreshedAt: "2026-09-27T00:00:00.000Z",
    },
    attention: [],
    tasks: [
      task("task_unresolved", "Persisted uncertain task", true),
      task("task_ready", "Persisted unrelated task", false),
    ],
    workflows: [],
    recoveryWarnings: [],
    draftAttachments: [],
    fileAttention: [],
    currentTaskId: "task_unresolved",
  }),
  { encoding: "utf8", mode: 0o600 },
);

async function qualify(scenario) {
  const application = await electron.launch({
    executablePath,
    cwd: companion,
    args: [
      entry,
      `--user-data-dir=${join(fixtureHome, `electron-${scenario}`)}`,
    ],
    env: {
      ...process.env,
      ROVE_STARTUP_HYDRATION_FIXTURE: fixturePath,
      ROVE_STARTUP_HYDRATION_SCENARIO: scenario,
    },
  });
  try {
    const page = await application.firstWindow({ timeout: 30_000 });
    await page.getByText("Opening Rove", { exact: true }).waitFor();
    if (await page.getByText("New task", { exact: true }).count())
      throw new Error("Cold start flashed the task composer during hydration.");
    await page
      .getByText("Persisted uncertain task", { exact: true })
      .first()
      .waitFor();
    await page.getByText("Task state unclear", { exact: true }).waitFor();
    await page
      .getByRole("button", {
        name: "Task history: task_ready",
        exact: true,
      })
      .click();
    await page
      .getByText("Persisted unrelated task", { exact: true })
      .first()
      .waitFor();
    const composer = page.getByLabel("Task message", { exact: true });
    await composer.waitFor({ state: "visible" });
    if (await composer.isDisabled())
      throw new Error("Unrelated persisted task was not interactive.");
    const warning = page.getByLabel("Browser service status", { exact: true });
    if (scenario === "degraded") {
      await warning.waitFor({ state: "visible" });
      const text = await warning.innerText();
      if (!text.includes("Conversation history remains available"))
        throw new Error("Degraded Runtime warning was not customer-safe.");
    } else if (await warning.count()) {
      throw new Error("Healthy startup rendered a Runtime warning.");
    }
    return {
      scenario,
      hydrationObserved: true,
      persistedConversationObserved: true,
      unresolvedTaskOwned: true,
      unrelatedTaskInteractive: true,
      runtimeWarning: scenario === "degraded",
    };
  } finally {
    await application.close().catch(() => undefined);
  }
}

try {
  const healthy = await qualify("healthy");
  const degraded = await qualify("degraded");
  process.stdout.write(
    `${JSON.stringify({ status: "passed", fixtureHome, healthy, degraded })}\n`,
  );
} finally {
  await rm(fixtureHome, { recursive: true, force: true });
}
