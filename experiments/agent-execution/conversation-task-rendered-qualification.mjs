#!/usr/bin/env node
/* global console, document, Event, getComputedStyle, HTMLElement, innerHeight, innerWidth, structuredClone, window */

import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { emptyTaskAggregate } from "../../packages/protocol/dist/index.js";
import { customerTaskCapabilities } from "../../apps/companion/dist/main/main/codex/customer-task-capabilities.js";
import { customerTaskCollaboration } from "../../apps/companion/dist/main/main/codex/customer-task-collaboration.js";
import { customerTaskExecution } from "../../apps/companion/dist/main/main/codex/customer-task-execution.js";
import { customerTaskPresentation } from "../../apps/companion/dist/main/main/codex/customer-task-presentation.js";
import {
  compactFollowerTaskContext,
  toCompactFollowerViewModel,
} from "../../apps/companion/dist/main/renderer/follower-state.js";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputRoot = join(
  repositoryRoot,
  "artifacts/customer-journeys/conversation-task-rendered-qualification",
);
const scenarioPath = join(outputRoot, "production-projection-scenarios.json");
const rendererRoot = join(repositoryRoot, "apps/companion/dist/renderer");
const fixtureMain = join(
  repositoryRoot,
  "experiments/agent-execution/electron-conversation-task-qualification-fixture.cjs",
);
const requireBrowser = createRequire(
  join(repositoryRoot, "packages/browser/package.json"),
);
const requireCompanion = createRequire(
  join(repositoryRoot, "apps/companion/package.json"),
);
const { _electron: electron, chromium } = requireBrowser("playwright");
const electronExecutable = requireCompanion("electron");
const timestamp = "2026-09-20T12:00:00.000Z";
const workspaceId = "wrk_00000000-0000-4000-8000-000000000009";
const steps = [];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function capabilities(overrides = {}) {
  return customerTaskCapabilities({
    canSubmit: false,
    canQueue: false,
    canSteer: false,
    canStop: false,
    canRespond: false,
    canTakeControl: false,
    canReturnToRove: false,
    canRetry: false,
    canArchive: false,
    ...overrides,
  });
}

function acceptedItem(id, text, acceptedAt = timestamp) {
  return {
    id,
    kind: "user_message",
    status: "completed",
    authoredBy: "user",
    clientId: id.slice("user:".length),
    acceptedAt,
    completedAt: acceptedAt,
    text,
  };
}

function aggregate({
  taskId,
  state = "working",
  request = "Review the customer evidence and prepare a concise recommendation.",
  items = [],
  queue = [],
  runtime = {},
  attention = [],
  activityStart = timestamp,
}) {
  const value = emptyTaskAggregate(taskId);
  value.launch = {
    operationId: `intent_${taskId}`,
    bootstrapId: `boot_${taskId.replaceAll("_", "").padEnd(32, "0").slice(0, 32)}`,
    requestedAt: timestamp,
    outcome: request,
    executionMode: runtime.executionMode ?? "agent",
    approvalsReviewer: "auto_review",
    cwd: "/qualification",
    attachmentIds: [],
  };
  value.record = {
    schemaVersion: 1,
    identity: { taskId, threadId: `thread_${taskId}` },
    bootstrap: {
      operationId: value.launch.bootstrapId,
      threadSource: `rove:${taskId}:${value.launch.bootstrapId}`,
      stage: "complete",
    },
    desiredState: "open",
  };
  value.codex = {
    availability: "available",
    threadExists: true,
    threadId: `thread_${taskId}`,
    sourceLookup: "exact",
    runtimeStatus: "idle",
    archived: false,
    turn:
      state === "stopped"
        ? "interrupted"
        : state === "failed"
          ? "failed"
          : state === "ready"
            ? "completed"
            : "active",
    turnId: `turn_${taskId}`,
  };
  value.runtime = {
    availability: "available",
    sessionExists: runtime.attachment === "attached",
    sessionId:
      runtime.attachment === "attached" ? `session_${taskId}` : undefined,
    bootstrapLookup: runtime.attachment === "attached" ? "exact" : "none",
    status: runtime.status ?? "completed",
    controller: runtime.controller ?? null,
    attachment: runtime.attachment ?? "missing",
    profileLock: runtime.attachment === "attached" ? "owned" : "released",
    recovery: "not_needed",
  };
  const initial = acceptedItem(`user:${taskId}`, request);
  value.conversation.items = Object.fromEntries(
    [initial, ...items].map((item) => [item.id, item]),
  );
  value.conversation.itemOrder = [initial.id, ...items.map((item) => item.id)];
  value.conversation.turnOrder = [`turn_${taskId}`];
  value.customerActiveIntervals =
    state === "ready" || state === "stopped" || state === "failed"
      ? [
          {
            segmentId: initial.id,
            startedAt: activityStart,
            endedAt: "2026-09-20T12:00:09.000Z",
          },
        ]
      : [{ segmentId: initial.id, startedAt: activityStart }];
  value.queue = {
    entries: Object.fromEntries(queue.map((entry) => [entry.id, entry])),
    order: queue.map((entry) => entry.id),
  };
  value.attentions = attention;
  if (state === "checking")
    value.recoveryRequired = "internal diagnostic must not render";
  if (state === "stopping")
    value.requestedOperation = {
      type: "interrupt",
      taskId,
      operationId: `intent_stop_${taskId}`,
      requestedAt: timestamp,
    };
  return value;
}

function projection({
  taskId,
  state,
  request,
  items = [],
  queue = [],
  runtime,
  attention = [],
  capability = {},
  executionMode = runtime?.executionMode ?? "agent",
  latestDelivery = "materialized",
  title,
}) {
  const source = aggregate({
    taskId,
    state,
    request,
    items,
    queue,
    runtime,
    attention,
    activityStart:
      state === "working"
        ? new Date(Date.now() - 3_000).toISOString()
        : timestamp,
  });
  const task = {
    taskId,
    executionMode,
    browserIdentity:
      runtime?.attachment === "attached"
        ? { mode: "workspace", workspaceId }
        : { mode: "temporary" },
    selectionSource: "user_selected",
    selectedAt: timestamp,
    approvalsReviewer: "auto_review",
    bootstrapStage: "complete",
    roveSessionId:
      runtime?.attachment === "attached" ? `session_${taskId}` : undefined,
    codexThreadId: `thread_${taskId}`,
    model: "gpt-fixture",
    reasoningEffort: "medium",
    results: [],
    recordings: [],
    conversation: {
      ...(source.codex.turn === "active"
        ? { activeTurnId: `turn_${taskId}` }
        : {}),
      turnStatus:
        source.codex.turn === "active"
          ? "in_progress"
          : source.codex.turn === "none"
            ? "unknown"
            : source.codex.turn,
      archived: false,
      turnOrder: [...source.conversation.turnOrder],
      itemOrder: [...source.conversation.itemOrder],
      items: structuredClone(source.conversation.items),
    },
    lifecycle: {
      phase: state === "ready" ? "ready" : "working",
      reason: "internal",
    },
    availableActions: [],
    capabilities: capabilities(capability),
    runtime:
      runtime === undefined
        ? undefined
        : {
            status: runtime.status ?? "active",
            controller:
              runtime.controller === undefined ? "agent" : runtime.controller,
            attachment: runtime.attachment ?? "attached",
            recovery: "not_needed",
            profileOwnership: "owned",
            ...(runtime.handoffActionable ? { handoffActionable: true } : {}),
            ...(runtime.handoffGeneration
              ? { handoffGeneration: runtime.handoffGeneration }
              : {}),
            ...(runtime.collaborationState
              ? { collaborationState: runtime.collaborationState }
              : {}),
            ...(runtime.continuationPolicy
              ? { continuationPolicy: runtime.continuationPolicy }
              : {}),
          },
    customerExecution: customerTaskExecution(source),
    operation: { operationId: `intent_${taskId}`, kind: "message" },
    ...(title ? { displayTitle: title } : {}),
  };
  task.customerCollaboration = customerTaskCollaboration(task, attention);
  task.customerPresentation = customerTaskPresentation({
    execution: task.customerExecution,
    collaboration: task.customerCollaboration,
    capabilities: task.capabilities,
    latestDelivery,
    recordings: [],
  });
  return task;
}

function baseSnapshot(tasks, currentTaskId, attention = [], companion = null) {
  return {
    revision: 1,
    surface: {
      presentation: "full",
      browserContext: "windowed",
      activeHost: "control_center",
      returnPresentation: "chip",
      revision: 1,
    },
    companion,
    notice: null,
    workspaces: {
      selectedWorkspaceId: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          displayName: "Qualification browser",
          browser: "chrome",
          storageLayout: "workspace",
          createdAt: timestamp,
          lastUsedAt: timestamp,
        },
      ],
    },
    product: {
      version: 9,
      host: { state: "ready", ready: true, restartAttempt: 0 },
      catalog: {
        account: { status: "logged_in", authMode: "chatgpt", planType: "Plus" },
        models: [
          {
            id: "gpt-fixture",
            model: "gpt-fixture",
            displayName: "Codex",
            description: "Deterministic qualification fixture",
            efforts: ["low", "medium", "high"],
            defaultEffort: "medium",
            isDefault: true,
            inputModalities: ["text", "image"],
            supportsPersonality: false,
            defaultServiceTier: null,
          },
        ],
        rateLimits: [],
        usage: null,
        refreshedAt: timestamp,
      },
      attention,
      fileAttention: [],
      draftAttachments: [],
      tasks,
      currentTaskId,
      workflows: [],
      recoveryWarnings: [],
    },
    productError: null,
  };
}

const commentary = {
  id: "commentary",
  kind: "assistant_message",
  phase: "commentary",
  status: "completed",
  authoredBy: "assistant",
  completedAt: "2026-09-20T12:00:03.000Z",
  text: "I’m comparing the evidence and checking the most important differences.",
};
const rawActivities = [
  {
    id: "read",
    kind: "tool",
    status: "completed",
    title: "mcp__runtime/browser.inspect",
  },
  {
    id: "change",
    kind: "file_change",
    status: "completed",
    title: "private patch internals",
  },
  {
    id: "run",
    kind: "command",
    status: "started",
    title: "secret-command --internal",
  },
  {
    id: "verify",
    kind: "tool",
    status: "completed",
    title: "runtime_transaction_verify",
    activityOutcome: "checking",
  },
];
const finalAnswer = {
  id: "final",
  kind: "assistant_message",
  phase: "final_answer",
  status: "completed",
  authoredBy: "assistant",
  completedAt: "2026-09-20T12:00:10.000Z",
  text: "The recommendation is ready. Option A best matches the stated constraints.",
};
const queue = [
  {
    id: "queue:first",
    operationId: "queue_first",
    message: "Add a short executive summary and keep the evidence links.",
    createdAt: timestamp,
    updatedAt: timestamp,
    attachmentIds: ["attachment_fixture"],
  },
  {
    id: "queue:second",
    operationId: "queue_second",
    message: "Then compare the implementation cost in a table.",
    createdAt: timestamp,
    updatedAt: timestamp,
    attachmentIds: [],
  },
];

function attention(kind, overrides = {}) {
  return {
    authority: "codex",
    kind,
    requestId: `request_${kind}`,
    taskId: "task_attention",
    threadId: "thread_task_attention",
    turnId: "turn_task_attention",
    itemId: `item_${kind}`,
    generation: 3,
    status: "pending",
    sequence: 1,
    title: overrides.title ?? "Review this request",
    ...overrides,
  };
}

function companion(taskId, controller = "agent", status = "active", handoff) {
  return {
    session: {
      id: `session_${taskId}`,
      bootstrapId: `bootstrap_${taskId}`,
      mode: "companion",
      status,
      controller,
      profile: { mode: "persistent", name: workspaceId },
      workspace: {
        id: workspaceId,
        displayName: "Qualification browser",
        browser: "chrome",
        storageLayout: "workspace",
        createdAt: timestamp,
        lastUsedAt: timestamp,
      },
      ...(handoff ? { handoff } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    observationCount: 9,
    evidenceCount: 4,
    browserOpen: true,
  };
}

const activeTask = (overrides = {}) =>
  projection({
    taskId: "task_active",
    state: "working",
    items: [commentary, ...rawActivities],
    queue,
    capability: { canQueue: true, canSteer: true, canStop: true },
    ...overrides,
  });

const requestedHandoff = attention("control_handoff", {
  authority: "rove_control",
  requestId: "control:session_task_browser:7",
  taskId: "task_browser",
  threadId: "thread_task_browser",
  turnId: "turn_task_browser",
  generation: 7,
  title: "Browser control handoff",
  instruction: "Confirm the delivery address before Rove continues.",
  continuationPolicy: "resume_after_control_return",
});

function browserTask(kind) {
  const settings = {
    required: {
      status: "awaiting_human",
      controller: null,
      attachment: "attached",
      handoffActionable: true,
      handoffGeneration: 7,
      collaborationState: "takeover_required",
      continuationPolicy: "resume_after_control_return",
      executionMode: "agent",
    },
    voluntary: {
      status: "active",
      controller: "agent",
      attachment: "attached",
      collaborationState: "agent_control",
      executionMode: "companion",
    },
    human: {
      status: "paused",
      controller: "human",
      attachment: "attached",
      collaborationState: "human_control",
      continuationPolicy: "resume_after_control_return",
      executionMode: "agent",
    },
    checking: {
      status: "active",
      controller: "agent",
      attachment: "attached",
      collaborationState: "checking_after_return",
      continuationPolicy: "resume_after_control_return",
      executionMode: "agent",
    },
  }[kind];
  return projection({
    taskId: "task_browser",
    state: kind === "checking" ? "working" : "working",
    request: "Check the order and stop before the final submission.",
    items: [commentary],
    runtime: settings,
    attention: kind === "required" ? [requestedHandoff] : [],
    capability: {
      canStop: true,
      canTakeControl: kind === "required" || kind === "voluntary",
      canReturnToRove: kind === "human",
    },
    executionMode: settings.executionMode,
  });
}

const attentionFamilies = {
  attention_user: attention("user_input", {
    title: "Choose the audience",
    questions: [
      {
        id: "audience",
        header: "Audience",
        question: "Who should receive the summary?",
        isOther: true,
        isSecret: false,
        options: [
          { label: "Leadership", description: "A concise decision summary." },
          {
            label: "Product team",
            description: "Detail and supporting evidence.",
          },
        ],
      },
    ],
  }),
  attention_command: attention("command_approval", {
    title: "Approve local command",
    context: [{ label: "Command", value: "Generate the local report" }],
  }),
  attention_file: attention("file_approval", {
    title: "Approve file change",
    context: [{ label: "File", value: "qualification-report.md" }],
  }),
  attention_network: attention("network_approval", {
    title: "Allow network access",
    context: [{ label: "Host", value: "example.test" }],
  }),
  attention_permission: attention("permission_approval", {
    title: "Allow access for this task",
    context: [{ label: "Permission", value: "Read the selected folder" }],
  }),
  attention_form: attention("mcp_elicitation", {
    title: "Complete connection details",
    elicitation: {
      mode: "form",
      message: "A connected service needs these non-sensitive fixture values.",
      fields: [
        { id: "workspace", title: "Workspace", type: "text", required: true },
        { id: "masked", title: "Fixture secret", type: "text", required: true },
      ],
    },
  }),
  attention_url: attention("mcp_elicitation", {
    title: "Connect the fixture account",
    elicitation: {
      mode: "url",
      message: "Open the trusted fixture page to continue.",
      url: "https://example.test/connect",
    },
  }),
};

const scenarios = {};
scenarios.start_fast = baseSnapshot(
  [
    projection({
      taskId: "task_start",
      state: "ready",
      capability: { canSubmit: true },
    }),
  ],
  "task_start",
);
scenarios.start_sustained = baseSnapshot(
  [
    projection({
      taskId: "task_start",
      state: "working",
      capability: { canQueue: true, canSteer: true, canStop: true },
    }),
  ],
  "task_start",
);
scenarios.immediate_sustained = scenarios.start_sustained;
scenarios.active_work = baseSnapshot([activeTask()], "task_active");
scenarios.terminal_work = baseSnapshot(
  [
    projection({
      taskId: "task_terminal",
      state: "ready",
      items: [commentary, ...rawActivities, finalAnswer],
      capability: { canSubmit: true, canArchive: true },
    }),
  ],
  "task_terminal",
);
scenarios.queue = baseSnapshot([activeTask()], "task_active");
const promotedMessage =
  "Add a short executive summary and keep the evidence links.";
scenarios.queue_promoted = baseSnapshot(
  [
    activeTask({
      items: [
        acceptedItem(
          "user:queue_first",
          promotedMessage,
          "2026-09-20T12:00:05.000Z",
        ),
      ],
      queue: [queue[1]],
    }),
  ],
  "task_active",
);
for (const [name, request] of Object.entries(attentionFamilies)) {
  const task = projection({
    taskId: "task_attention",
    state: "working",
    items: [commentary],
    attention: [request],
    capability: { canRespond: true, canStop: true },
  });
  scenarios[name] = baseSnapshot([task], task.taskId, [request]);
}
scenarios.browser_required = baseSnapshot(
  [browserTask("required")],
  "task_browser",
  [requestedHandoff],
  companion("task_browser", null, "awaiting_human", {
    reason: requestedHandoff.instruction,
    requestedAt: timestamp,
  }),
);
scenarios.browser_voluntary = baseSnapshot(
  [browserTask("voluntary")],
  "task_browser",
  [],
  companion("task_browser"),
);
scenarios.browser_human = baseSnapshot(
  [browserTask("human")],
  "task_browser",
  [],
  companion("task_browser", "human", "active"),
);
scenarios.browser_checking = baseSnapshot(
  [browserTask("checking")],
  "task_browser",
  [],
  companion("task_browser", "agent", "active"),
);
scenarios.recovery = baseSnapshot(
  [
    projection({
      taskId: "task_recovery",
      state: "checking",
      items: [commentary],
      capability: { canStop: true },
    }),
  ],
  "task_recovery",
);
scenarios.failure = baseSnapshot(
  [
    projection({
      taskId: "task_failure",
      state: "failed",
      items: [
        commentary,
        { ...rawActivities[1], id: "failed_change", activityOutcome: "failed" },
      ],
      capability: { canSubmit: true, canArchive: true },
    }),
  ],
  "task_failure",
);
scenarios.uncertain = baseSnapshot(
  [
    projection({
      taskId: "task_uncertain",
      state: "failed",
      items: [
        commentary,
        {
          ...rawActivities[1],
          id: "uncertain_change",
          activityOutcome: "unresolved",
        },
      ],
      capability: { canSubmit: true, canArchive: true },
      latestDelivery: "uncertain",
    }),
  ],
  "task_uncertain",
);
const taskA = activeTask({
  taskId: "task_a",
  request: "Analyze the interview themes.",
});
const taskBRequest = { ...attentionFamilies.attention_user, taskId: "task_b" };
const taskB = projection({
  taskId: "task_b",
  state: "working",
  request: "Prepare the launch summary.",
  attention: [taskBRequest],
  capability: { canRespond: true, canStop: true },
});
const taskC = projection({
  taskId: "task_c",
  state: "ready",
  request: "Keep the completed notes available.",
  items: [finalAnswer],
  capability: { canSubmit: true },
});
scenarios.multi_task = baseSnapshot([taskA, taskB, taskC], "task_a", [
  taskBRequest,
]);
const longTextTail = "accepted-message-render-tail";
const longText = `${"x".repeat(16_000 - longTextTail.length)}${longTextTail}`;
scenarios.long_content = baseSnapshot(
  [
    projection({
      taskId: "task_long",
      state: "working",
      request: longText,
      items: [
        commentary,
        ...Array.from({ length: 28 }, (_, index) => ({
          id: `activity_${index}`,
          kind: index % 2 ? "tool" : "command",
          status: "completed",
          title: index % 2 ? "internal_search" : "internal_run",
        })),
      ],
      queue: [
        {
          ...queue[0],
          message: `Long queued follow-up ${"with context ".repeat(60)}`,
        },
      ],
      capability: { canQueue: true, canSteer: true, canStop: true },
      title:
        "A deliberately long task title that must wrap without pushing critical controls away",
    }),
  ],
  "task_long",
);
await writeFile(scenarioPath, `${JSON.stringify(scenarios)}\n`);

async function visibleState(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      text: document.body.innerText.replace(/\s+/g, " ").trim(),
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      outside: [...document.querySelectorAll("[role=dialog], [role=alert]")]
        .filter(visible)
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.left < 0 ||
            rect.top < 0 ||
            rect.right > innerWidth ||
            rect.bottom > innerHeight
          );
        }).length,
      focused:
        document.activeElement instanceof HTMLElement
          ? document.activeElement.getAttribute("aria-label") ||
            document.activeElement.innerText
          : null,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches,
    };
  });
}

async function capture(page, scenario, goal, action, expected) {
  const number = steps.length + 1;
  const screenshot = `${String(number).padStart(2, "0")}-${scenario}.png`;
  await page.screenshot({ path: join(outputRoot, screenshot) });
  const visible = await visibleState(page);
  assert(
    !visible.horizontalOverflow,
    `${scenario} has horizontal document overflow.`,
  );
  assert(
    visible.outside === 0,
    `${scenario} has an out-of-viewport dialog or alert.`,
  );
  steps.push({
    number,
    scenario,
    customerGoal: goal,
    action,
    expected,
    screenshot,
    visible,
  });
}

async function setScenario(page, name) {
  await page.evaluate(
    (scenario) => window.rove.setJourneyScenario(scenario),
    name,
  );
  await page.waitForTimeout(40);
}

async function openTask(page, taskId) {
  await page.getByRole("button", { name: `Task history: ${taskId}` }).click();
  await page.locator(".task-detail").waitFor();
}

async function setWindowSize(application, width, height) {
  await application.evaluate(
    ({ BrowserWindow }, dimensions) =>
      BrowserWindow.getAllWindows()[0]?.setSize(
        dimensions.width,
        dimensions.height,
      ),
    { width, height },
  );
}

async function renderContactSheet() {
  const cells = await Promise.all(
    steps.map(async (step) => ({
      ...step,
      image: (await readFile(join(outputRoot, step.screenshot))).toString(
        "base64",
      ),
    })),
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1560, height: 900 },
    });
    await page.setContent(`<!doctype html><style>
      *{box-sizing:border-box}body{margin:0;padding:28px;background:#efefec;color:#20201e;font:14px -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif}
      h1{margin:0 0 22px;font-size:24px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.cell{overflow:hidden;border:1px solid #d9d9d4;border-radius:14px;background:#fff}.meta{padding:12px;border-bottom:1px solid #eaeae6}.meta strong,.meta span{display:block}.meta span{margin-top:4px;color:#676762;font-size:11px}.cell img{display:block;width:100%;height:auto}
    </style><h1>Conversation and Task rendered qualification</h1><div class="grid">${cells.map((step) => `<article class="cell"><div class="meta"><strong>${String(step.number).padStart(2, "0")} · ${step.scenario}</strong><span>${step.customerGoal} · ${step.action} · ${step.expected}</span></div><img src="data:image/png;base64,${step.image}"></article>`).join("")}</div>`);
    await page.screenshot({
      path: join(outputRoot, "contact-sheet.png"),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
}

const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();
let application;
let traceStarted = false;
try {
  application = await electron.launch({
    executablePath: electronExecutable,
    cwd: repositoryRoot,
    args: [fixtureMain],
    env: {
      ...process.env,
      ROVE_JOURNEY_RENDERER_ROOT: rendererRoot,
      ROVE_QUALIFICATION_SCENARIOS: scenarioPath,
    },
  });
  await application
    .context()
    .tracing.start({ screenshots: true, snapshots: true, sources: true });
  traceStarted = true;
  const page = await application.firstWindow({ timeout: 30_000 });
  page.on("console", (message) =>
    process.stderr.write(
      `[conversation-task:${message.type()}] ${message.text()}\n`,
    ),
  );
  page.on("pageerror", (error) =>
    process.stderr.write(`[conversation-task:pageerror] ${error.message}\n`),
  );
  try {
    await page.locator(".product-app").waitFor({ timeout: 30_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(async () => {
      const api = window.rove;
      let snapshotError = null;
      try {
        await api?.getSurfaceSnapshot?.();
      } catch (cause) {
        snapshotError = cause instanceof Error ? cause.message : String(cause);
      }
      return {
        api: typeof api,
        keys: api ? Object.keys(api) : [],
        snapshotError,
        html: document.documentElement.outerHTML.slice(0, 1_000),
      };
    });
    process.stderr.write(
      `[conversation-task:url] ${page.url()}\n[conversation-task:body] ${await page.locator("body").innerText()}\n[conversation-task:diagnostic] ${JSON.stringify(diagnostic)}\n`,
    );
    throw error;
  }

  await setScenario(page, "start_fast");
  assert(
    (await page.getByRole("region", { name: "Active work" }).count()) === 0,
    "Fast startup flashed Working.",
  );
  assert(
    await page
      .locator(".timeline-user")
      .getByText(/Review the customer evidence/)
      .isVisible(),
    "Accepted message is not immediate.",
  );
  assert(
    !/Starting this task|Waiting for Codex activity/.test(
      (await visibleState(page)).text,
    ),
    "Startup mechanism leaked.",
  );
  await capture(
    page,
    "immediate-fast",
    "Send a task",
    "Accept immediately",
    "Message is final-positioned without startup flash",
  );

  await setScenario(page, "start_sustained");
  const revealStarted = Date.now();
  await page
    .getByRole("region", { name: "Active work" })
    .waitFor({ timeout: 1_000 });
  const revealElapsed = Date.now() - revealStarted;
  assert(
    revealElapsed >= 100 && revealElapsed <= 700,
    `Working anti-flicker was ${revealElapsed}ms.`,
  );
  await capture(
    page,
    "start-sustained",
    "Wait for sustained work",
    "Observe authoritative activity",
    "Working appears after the anti-flicker bound",
  );

  await setScenario(page, "active_work");
  const activeWork = page.getByRole("region", { name: "Active work" });
  await activeWork.waitFor();
  assert(
    (await activeWork.locator("summary").count()) === 0,
    "Active work is collapsible.",
  );
  const activityText = (await activeWork.innerText()).replace(/\s+/g, " ");
  assert(
    !/mcp__|runtime_transaction|secret-command|private patch/.test(
      activityText,
    ),
    "Raw activity mechanism leaked.",
  );
  assert(
    /Reading information|Making a change|Running a local operation|Verifying/.test(
      activityText,
    ),
    "Semantic activity is missing.",
  );
  await capture(
    page,
    "active-work",
    "Follow current work",
    "Inspect commentary and activity",
    "Active history is open, bounded, and semantic",
  );

  await setScenario(page, "terminal_work");
  const terminal = page.locator("details.timeline-work");
  assert(
    !(await terminal.getAttribute("open")),
    "Terminal work did not auto-compact.",
  );
  await terminal.locator("summary").focus();
  await page.keyboard.press("Enter");
  assert(
    await terminal.evaluate((node) => node.open),
    "Keyboard did not reopen terminal work.",
  );
  assert(
    await page.getByText(/recommendation is ready/).isVisible(),
    "Final answer moved or disappeared.",
  );
  await capture(
    page,
    "terminal-work",
    "Review completed work",
    "Expand with keyboard",
    "Work reopens while the final answer remains readable",
  );

  await setScenario(page, "start_sustained");
  const canonicalComposer = page.getByLabel("Task message");
  const emptyStop = page.getByRole("button", { name: "Stop current work" });
  await emptyStop.waitFor();
  const emptyStopBox = await emptyStop.boundingBox();
  assert(
    (await page.locator(".task-independent-controls").count()) === 0 &&
      (await page.getByText("Send now", { exact: true }).count()) === 0,
    "Active composer retained detached or competing controls.",
  );
  await capture(
    page,
    "active-empty-composer",
    "Continue while work is active",
    "Leave the draft empty",
    "Stop occupies the canonical primary slot",
  );
  await canonicalComposer.fill("Apply the newest evidence first");
  const activeSend = page.getByRole("button", { name: "Queue follow-up" });
  await activeSend.waitFor();
  const activeSendBox = await activeSend.boundingBox();
  assert(
    emptyStopBox &&
      activeSendBox &&
      Math.abs(emptyStopBox.x - activeSendBox.x) < 2 &&
      Math.abs(emptyStopBox.y - activeSendBox.y) < 2 &&
      Math.abs(emptyStopBox.width - activeSendBox.width) < 2 &&
      Math.abs(emptyStopBox.height - activeSendBox.height) < 2,
    "Typing changed the canonical primary-action geometry.",
  );
  await capture(
    page,
    "active-draft-composer",
    "Write an active-work follow-up",
    "Type without changing composer geometry",
    "Send replaces Stop in the same primary slot",
  );
  await canonicalComposer.press("Enter");
  const referenceQueue = page.getByLabel("Queued messages");
  await referenceQueue.getByText("Apply the newest evidence first").waitFor();
  assert(
    (await canonicalComposer.inputValue()) === "" &&
      (await emptyStop.isVisible()),
    "Queue acceptance did not clear the draft and restore Stop.",
  );
  await capture(
    page,
    "active-queued-composer",
    "Queue the follow-up",
    "Use ordinary Send",
    "A compact message object appears above the unchanged composer",
  );
  await referenceQueue
    .locator(".task-queue-entry", {
      hasText: "Apply the newest evidence first",
    })
    .getByRole("button", { name: "Steer", exact: true })
    .click();
  await page
    .locator(".timeline-user")
    .filter({ hasText: "Apply the newest evidence first" })
    .waitFor();
  const queuedSteerState = await page.evaluate(() =>
    window.rove.getJourneyState(),
  );
  const queuedSteers = queuedSteerState.calls.filter(
    (entry) => entry.intent?.type === "task.queue.steer",
  );
  const steeredEntryId = queuedSteers[0]?.intent.entryId;
  const steeredOperationId = steeredEntryId?.slice("queue:".length);
  const steeredTask = queuedSteerState.snapshot.product.tasks.find(
    (task) => task.taskId === "task_start",
  );
  assert(
    queuedSteers.length === 1 &&
      queuedSteers[0].intent.expectedTurnId === "turn_task_start" &&
      steeredTask?.conversation.items[`user:${steeredOperationId}`]
        ?.clientId === steeredOperationId &&
      (await referenceQueue
        .getByText("Apply the newest evidence first")
        .count()) === 0,
    "Queued Steer did not promote the exact entry once.",
  );
  await capture(
    page,
    "queued-steer",
    "Apply a queued instruction now",
    "Choose Steer on the exact message",
    "The same queued identity becomes one accepted intervention",
  );

  await setScenario(page, "queue");
  const queueRegion = page.getByLabel("Queued messages");
  await queueRegion.waitFor();
  assert(
    (await page
      .locator(".timeline-user")
      .filter({ hasText: "executive summary" })
      .count()) === 0,
    "Queue leaked into transcript.",
  );
  const composer = page.getByLabel("Task message");
  await composer.fill("A newly queued follow-up");
  await composer.press("Enter");
  await queueRegion.getByText("A newly queued follow-up").waitFor();
  const addedEntry = queueRegion.locator(".task-queue-entry", {
    hasText: "A newly queued follow-up",
  });
  await addedEntry.getByLabel("More queued message actions").click();
  await addedEntry.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Edit queued message").fill("Edited queued follow-up");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await queueRegion.getByText("Edited queued follow-up").waitFor();
  const editedEntry = queueRegion.locator(".task-queue-entry", {
    hasText: "Edited queued follow-up",
  });
  await editedEntry.getByLabel("More queued message actions").click();
  await editedEntry
    .getByRole("button", { name: "Move earlier", exact: true })
    .click();
  await editedEntry.getByLabel("Delete queued message").click();
  await capture(
    page,
    "queue",
    "Plan a follow-up without interrupting",
    "Queue, edit, reorder, and remove",
    "Queue stays above the composer and outside transcript",
  );
  const queueCalls = await page.evaluate(() => window.rove.getJourneyState());
  assert(
    queueCalls.calls.filter(
      (entry) =>
        entry.intent?.type === "task.queue.add" &&
        entry.intent.outcome === "A newly queued follow-up",
    ).length === 1,
    "Queue action was not exact-once.",
  );

  await setScenario(page, "queue");
  await openTask(page, "task_active");
  assert(
    (await page
      .getByLabel("Queued messages")
      .locator(".task-queue-entry")
      .count()) === 2,
    "Queue did not survive re-render.",
  );
  const rerenderedQueueState = await page.evaluate(() =>
    window.rove.getJourneyState(),
  );
  assert(
    rerenderedQueueState.calls.filter(
      (entry) => entry.intent?.type === "task.steer",
    ).length === 0,
    "Queue re-render dispatched queued work.",
  );
  await setScenario(page, "queue_promoted");
  await openTask(page, "task_active");
  assert(
    (await page
      .locator(".timeline-user")
      .filter({ hasText: promotedMessage })
      .count()) === 1 &&
      (await page
        .getByLabel("Queued messages")
        .filter({ hasText: promotedMessage })
        .count()) === 0,
    "Promoted queue entry did not move to one accepted transcript item.",
  );
  await setScenario(page, "queue");
  await openTask(page, "task_active");

  await composer.fill("Steer to the newest evidence");
  await composer.press(
    process.platform === "darwin" ? "Meta+Enter" : "Control+Enter",
  );
  await page
    .locator(".timeline-user")
    .filter({ hasText: "Steer to the newest evidence" })
    .waitFor();
  const steerState = await page.evaluate(() => window.rove.getJourneyState());
  assert(
    steerState.calls.filter((entry) => entry.intent?.type === "task.steer")
      .length === 1,
    "Steer was not exact-once.",
  );
  await composer.fill("line one");
  await composer.press("Shift+Enter");
  assert(
    (await composer.inputValue()).includes("\n"),
    "Shift+Enter did not insert a newline.",
  );
  await capture(
    page,
    "steer-keyboard",
    "Redirect active work",
    "Use Command+Enter",
    "One accepted intervention creates a new work segment",
  );

  await composer.fill("");
  const stopBoxBefore = await page
    .getByRole("button", { name: "Stop current work" })
    .boundingBox();
  await page.getByRole("button", { name: "Stop current work" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("region", { name: "Stopping work" }).waitFor();
  const stoppingButton = page.getByRole("button", {
    name: "Stop current work",
  });
  assert(
    await stoppingButton.isDisabled(),
    "Duplicate Stop intent remained enabled.",
  );
  const stopBoxStopping = await stoppingButton.boundingBox();
  assert(
    stopBoxBefore &&
      stopBoxStopping &&
      Math.abs(stopBoxBefore.x - stopBoxStopping.x) < 2 &&
      Math.abs(stopBoxBefore.width - stopBoxStopping.width) < 2,
    "Stop target moved materially while stopping.",
  );
  await page
    .getByText(/^Stopped/)
    .first()
    .waitFor({ timeout: 1_000 });
  const stoppedTask = await page.evaluate(() => window.rove.getJourneyState());
  assert(
    stoppedTask.snapshot.product.tasks[0].customerExecution.queue.length > 0,
    "Stop discarded queued work.",
  );
  assert(stopBoxBefore?.width > 0, "Stop lacked a stable hit target.");
  await capture(
    page,
    "stop",
    "Stop current work safely",
    "Activate Stop once",
    "Stopping resolves to Stopped and ordinary follow-up returns",
  );

  for (const name of Object.keys(attentionFamilies)) {
    await setScenario(page, name);
    await openTask(page, "task_attention");
    await page.getByLabel("Current task request").waitFor();
    if (
      [
        "attention_command",
        "attention_file",
        "attention_network",
        "attention_permission",
      ].includes(name)
    )
      assert(
        await page
          .getByRole("button", { name: "Stop current work" })
          .isVisible(),
        `${name} hid the canonical composer Stop.`,
      );
    const requestText = await page
      .getByLabel("Current task request")
      .innerText();
    assert(
      !/requestId|generation|MCP|Runtime/.test(requestText),
      `${name} leaked request internals.`,
    );
    await capture(
      page,
      name,
      "Respond to the exact request",
      "Inspect family-specific material",
      "Request remains visible with matching actions",
    );
  }
  await setScenario(page, "attention_user");
  await openTask(page, "task_attention");
  await page.getByRole("radio", { name: /Leadership/ }).focus();
  await page.keyboard.press("Space");
  const requestBoxBefore = await page
    .getByLabel("Current task request")
    .boundingBox();
  await page.getByRole("button", { name: "Send", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByText("Submitting your response…", { exact: true }).waitFor();
  const requestBoxAfter = await page
    .getByLabel("Current task request")
    .boundingBox();
  assert(
    requestBoxBefore &&
      requestBoxAfter &&
      Math.abs(requestBoxBefore.x - requestBoxAfter.x) < 2,
    "Attention submission jumped horizontally.",
  );
  assert(
    (await page.getByRole("button", { name: "Send", exact: true }).count()) ===
      0,
    "Submitting attention remained actionable.",
  );

  await setScenario(page, "browser_required");
  await openTask(page, "task_browser");
  await page.getByText("Waiting for you", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Take Over", exact: true })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await page.getByText("You're in control", { exact: true }).first().waitFor();
  await capture(
    page,
    "browser-human",
    "Complete a browser step",
    "Take over the exact Task resource",
    "Human ownership is explicit and task-scoped",
  );
  await page
    .getByRole("button", { name: "Return to Rove", exact: true })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await page.getByText("Checking the page…", { exact: true }).first().waitFor();
  await capture(
    page,
    "browser-checking",
    "Return the page safely",
    "Return to Rove",
    "Fresh checking precedes resumed work",
  );
  const browserCalls = await page.evaluate(() => window.rove.getJourneyState());
  assert(
    browserCalls.calls.some(
      (entry) =>
        entry.type === "takeControl" &&
        entry.taskId === "task_browser" &&
        entry.handoffGeneration === 7,
    ),
    "Exact handoff generation was not used.",
  );

  await setScenario(page, "browser_voluntary");
  await openTask(page, "task_browser");
  assert(
    await page
      .getByRole("button", { name: "Take Over", exact: true })
      .first()
      .isVisible(),
    "Companion voluntary Take Over is missing.",
  );
  assert(
    (await page.getByText("Waiting for you", { exact: true }).count()) === 0,
    "Voluntary takeover fabricated a handoff.",
  );
  const followerContext = compactFollowerTaskContext(
    scenarios.browser_voluntary,
  );
  const followerView = toCompactFollowerViewModel(
    followerContext.session,
    followerContext.browser,
    followerContext.task?.capabilities?.canStop === true,
  );
  assert(
    followerView.primaryAction === "take_control" &&
      followerView.primaryActionLabel === "Take Over",
    "Follower lacks voluntary Take Over.",
  );
  await capture(
    page,
    "follower-voluntary",
    "Collaborate from the follower",
    "Inspect Companion control",
    "Follower agrees with the main Task projection",
  );

  await setScenario(page, "recovery");
  await openTask(page, "task_recovery");
  const recoveryText = (await visibleState(page)).text;
  assert(
    recoveryText.includes("Checking task state…"),
    "Neutral recovery copy is missing.",
  );
  assert(
    !/internal diagnostic|Needs input/.test(recoveryText),
    "Recovery leaked diagnostics or false attention.",
  );
  await capture(
    page,
    "recovery",
    "Wait while state is reconciled",
    "Inspect safe controls",
    "Checking is neutral and history remains readable",
  );

  await setScenario(page, "failure");
  await openTask(page, "task_failure");
  assert(
    await page
      .getByText("Couldn't continue", { exact: true })
      .first()
      .isVisible(),
    "Confirmed failure is missing.",
  );
  assert(
    (await page.locator(".product-warning").count()) === 0,
    "Ordinary failure rendered a redundant detached warning.",
  );
  await setScenario(page, "uncertain");
  await openTask(page, "task_uncertain");
  assert(
    await page.getByText("Outcome unclear", { exact: true }).isVisible(),
    "Uncertainty is not distinct.",
  );
  assert(
    (await page.locator(".product-warning").count()) === 1,
    "Consequential uncertainty lost its persistent warning.",
  );
  assert(
    (await page.getByText("Retry cleanup", { exact: true }).count()) === 0,
    "Unsafe generic retry appeared.",
  );
  await capture(
    page,
    "uncertainty",
    "Understand an unconfirmed outcome",
    "Inspect replay-safe recovery",
    "Uncertainty is distinct and has no mutation retry",
  );

  await setScenario(page, "multi_task");
  await openTask(page, "task_a");
  await page.getByRole("button", { name: "Task history: task_c" }).focus();
  await page.keyboard.press("Enter");
  assert(
    (await page
      .getByRole("button", { name: "Task history: task_c" })
      .getAttribute("aria-current")) === "true",
    "Task selection did not remain exact.",
  );
  assert(
    await page
      .getByRole("button", { name: "Task history: task_a" })
      .getByText("Working")
      .isVisible(),
    "Background working state disappeared.",
  );
  assert(
    await page
      .getByRole("button", { name: "Task history: task_b" })
      .getByText("Needs input")
      .isVisible(),
    "Background attention is missing.",
  );
  assert(
    (await page
      .getByText("Who should receive the summary?", { exact: true })
      .count()) === 0,
    "Background request stole the selected composer.",
  );
  await capture(
    page,
    "multi-task",
    "Switch Tasks without changing background work",
    "Select ready Task C",
    "A remains Working, B Needs input, and C stays selected",
  );

  await setWindowSize(application, 820, 700);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setScenario(page, "long_content");
  await openTask(page, "task_long");
  assert(
    (await visibleState(page)).reducedMotion,
    "Reduced-motion preference was not active.",
  );
  const renderedLongMessage = await page
    .locator(".timeline-user .message-body")
    .first()
    .textContent();
  assert(
    renderedLongMessage.length === 16_000 &&
      renderedLongMessage.endsWith(longTextTail),
    "The accepted 16,000-character message was truncated.",
  );
  const timeline = page.locator(".task-timeline");
  const atBottom = () =>
    timeline.evaluate(
      (node) => node.scrollHeight - node.scrollTop - node.clientHeight <= 24,
    );
  assert(await atBottom(), "Timeline did not begin in follow mode.");
  await page.evaluate(() => window.rove.appendJourneyActivity());
  await page.getByText("Verified follow-up 1", { exact: true }).waitFor();
  assert(await atBottom(), "New activity did not follow while at the bottom.");
  await timeline.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event("scroll"));
  });
  await page.getByRole("button", { name: "Latest", exact: true }).waitFor();
  await page.evaluate(() => window.rove.appendJourneyActivity());
  await page.getByText("Verified follow-up 2", { exact: true }).waitFor();
  const scrollBefore = await timeline.evaluate((node) => node.scrollTop);
  assert(
    scrollBefore === 0,
    "New observation stole an upward reading position.",
  );
  await page.getByRole("button", { name: "Latest", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert(await atBottom(), "Latest did not restore timeline following.");
  await capture(
    page,
    "narrow-long-reduced",
    "Use a dense task on a narrow window",
    "Inspect long content with reduced motion",
    "Content wraps, controls remain reachable, and motion is not required",
  );

  await setWindowSize(application, 1180, 780);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await setScenario(page, "active_work");
  await openTask(page, "task_active");
  const focusOrder = [];
  await page.getByLabel("Task message").focus();
  for (let index = 0; index < 12; index += 1) {
    focusOrder.push(
      await page.evaluate(
        () =>
          document.activeElement?.getAttribute("aria-label") ||
          document.activeElement?.textContent?.trim(),
      ),
    );
    await page.keyboard.press("Tab");
  }
  assert(
    focusOrder.some((value) => value?.includes("Task message")),
    "Composer was absent from keyboard order.",
  );
  assert(
    focusOrder.some((value) => value?.includes("Stop current work")) &&
      !focusOrder.some((value) => value?.includes("Send now")),
    "Canonical Stop was absent or permanent Send now remained in keyboard order.",
  );
  const collapseSidebar = page.getByRole("button", {
    name: "Collapse sidebar",
  });
  await collapseSidebar.focus();
  await page.keyboard.press("Enter");
  const expandSidebar = page.getByRole("button", { name: "Expand sidebar" });
  await expandSidebar.waitFor();
  await expandSidebar.focus();
  await page.keyboard.press("Enter");
  await collapseSidebar.waitFor();
  await capture(
    page,
    "keyboard-focus",
    "Operate critical controls without a pointer",
    "Tab through the Task dock",
    "Focus remains visible and reaches the active controls",
  );

  await renderContactSheet();
  const finalState = await page.evaluate(() => window.rove.getJourneyState());
  const manifest = {
    title: "Conversation and Task rendered experience qualification",
    baseline: {
      branch: "codex/manual-acceptance-task-composer-remediation",
      commit,
    },
    environment: {
      type: "deterministic production-projection Electron fixture",
      liveCodexUsed: false,
      realAccountUsed: false,
      externalActionUsed: false,
      normalViewport: { width: 1180, height: 780 },
      narrowViewport: { width: 820, height: 700 },
    },
    projectionBoundary: [
      "customerTaskExecution",
      "customerTaskCapabilities",
      "customerTaskCollaboration",
      "customerTaskPresentation",
    ],
    qualificationRows: [
      "immediate-send",
      "start-timing",
      "work-history",
      "activity",
      "queue",
      "steer",
      "stop",
      "attention",
      "browser-handoff",
      "companion-takeover",
      "return",
      "recovery",
      "failure-uncertainty",
      "multi-task",
      "responsive",
      "keyboard-focus",
      "reduced-motion",
      "auto-follow-anchoring",
      "main-follower-parity",
    ],
    assertions: {
      immediateAcceptedMessage: true,
      noStartupPlaceholder: true,
      antiFlickerBoundMs: revealElapsed,
      activeForcedOpen: true,
      terminalExpandable: true,
      semanticActivityNoMechanismLeak: true,
      queueOutsideTranscript: true,
      queueCommandsExact: true,
      queuePromotionExactOnce: true,
      queuedSteerExactIdentity: true,
      steerExactOnce: true,
      macCommandEnterQualified: process.platform === "darwin",
      stopProgression: true,
      requestFamiliesQualified: Object.keys(attentionFamilies),
      exactHandoffGeneration: true,
      voluntaryCompanionTakeover: true,
      returnChecksBeforeResume: true,
      recoveryNeutral: true,
      failureDistinctFromUncertainty: true,
      multiTaskSelectionStable: true,
      noHorizontalOverflow: steps.every(
        (step) => !step.visible.horizontalOverflow,
      ),
      dialogsInViewport: steps.every((step) => step.visible.outside === 0),
      reducedMotionQualified: true,
      autoFollowAndAnchoring: true,
      followerParity: true,
    },
    calls: finalState.calls,
    steps,
  };
  await writeFile(
    join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(outputRoot, "manual-acceptance.md"),
    `# Manual development-app acceptance\n\nUse a temporary Rove home, fixture Codex account, and non-sensitive browser fixture. Do not use a real external account or consequential action.\n\n- [ ] Send: accepted message appears immediately with no startup placeholder.\n- [ ] Working: fast completion does not flash; sustained work appears after the anti-flicker delay.\n- [ ] Activity: commentary and semantic activity remain distinct; repeated low-value inspection is bounded; no tool/Runtime identifiers appear.\n- [ ] Composer: active empty shows Stop in the primary slot; typing swaps the same slot to Send; queue acceptance clears the draft and restores Stop.\n- [ ] Queue: ordinary active Send queues; edit, remove, reorder, restart, and automatic promotion remain exact.\n- [ ] Steer: use the queued message's Steer action and Command+Enter; confirm one exact accepted intervention for each path and no permanent Send now control.\n- [ ] Stop: verify primary-slot Stop → disabled Stop while Stopping → Stopped, retained queue, ordinary follow-up, and no browser ownership theft.\n- [ ] Attention: exercise user input, command/file/network/permission approvals, MCP form, and trusted URL with non-sensitive fixture values.\n- [ ] Browser: requested and Companion voluntary Take Over, exact page foregrounding, Return to Rove, fresh checking, and resumed work.\n- [ ] Recovery/outcomes: neutral checking, ordinary failure without a duplicate dock warning, persistent uncertain consequence, and no unsafe retry.\n- [ ] Completion: confirm terminal work compacts, reopens, and preserves the final-answer reading position.\n- [ ] Multi-Task: A Working, B Needs input, C ready; background changes never steal selection.\n- [ ] Repeat relevant states at 1180×780 and 820×700, keyboard-only, reduced motion, long content, and background attention.\n- [ ] Confirm main Task and follower agree for takeover, human ownership, return, checking, and Stop consequence.\n`,
  );
  await application
    .context()
    .tracing.stop({ path: join(outputRoot, "journey.trace.zip") });
  traceStarted = false;
  for (const name of [
    "manifest.json",
    "manual-acceptance.md",
    "contact-sheet.png",
    "journey.trace.zip",
  ])
    assert((await stat(join(outputRoot, name))).size > 0, `${name} is empty.`);
  console.log(
    JSON.stringify({
      status: "pass",
      output: relative(repositoryRoot, outputRoot),
      screenshots: steps.length,
    }),
  );
} finally {
  if (traceStarted && application)
    await application
      .context()
      .tracing.stop()
      .catch(() => undefined);
  if (application) await application.close();
}
