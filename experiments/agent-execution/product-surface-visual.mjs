#!/usr/bin/env node
/* global document, getComputedStyle, localStorage, window */

import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const requireBrowserDependency = createRequire(
  join(repositoryRoot, "packages/browser/package.json"),
);
const { chromium } = requireBrowserDependency("playwright");
const rendererRoot = join(repositoryRoot, "apps/companion/dist/renderer");
const outputRoot = process.env.ROVE_PRODUCT_SURFACE_VISUAL_OUTPUT
  ? resolve(process.env.ROVE_PRODUCT_SURFACE_VISUAL_OUTPUT)
  : join(
      repositoryRoot,
      "artifacts/verification/product-surface",
    );
const workspaceId = "wrk_00000000-0000-4000-8000-000000000001";

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
    const path = join(rendererRoot, pathname === "/" ? "index.html" : pathname);
    const body = await readFile(path);
    response.writeHead(200, {
      "content-type": mime[extname(path)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise((resolveListen) =>
  server.listen(0, "127.0.0.1", resolveListen),
);
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("No fixture port.");

function baseSnapshot(presentation, accountStatus) {
  return {
    surface: {
      presentation,
      browserContext: "windowed",
      activeHost:
        presentation === "full" ? "control_center" : "browser_follower",
      returnPresentation: "chip",
      revision: 3,
    },
    companion: null,
    notice: null,
    workspaces: {
      selectedWorkspaceId: workspaceId,
      workspaces: [
        {
          id: workspaceId,
          displayName: "Personal",
          browser: "chrome",
          storageLayout: "workspace",
          createdAt: "2026-09-07T00:00:00Z",
          lastUsedAt: "2026-09-07T00:00:00Z",
        },
      ],
    },
    product: {
      version: 5,
      host: {
        state: "ready",
        ready: true,
        restartAttempt: 0,
        compatibility: {
          version: "0.153.4",
          platform: "macos",
          architecture: "arm64",
          source: "packaged",
        },
      },
      catalog: {
        account:
          accountStatus === "logged_in"
            ? { status: "logged_in", authMode: "chatgpt", planType: "Plus" }
            : { status: accountStatus },
        models: [
          {
            id: "gpt-6-astra",
            model: "gpt-6-astra",
            displayName: "GPT-6 Astra",
            description: "Fixture model",
            efforts: ["low", "medium", "high"],
            defaultEffort: "low",
            isDefault: true,
            inputModalities: ["text", "image"],
            supportsPersonality: false,
            defaultServiceTier: null,
          },
        ],
        rateLimits: [
          {
            limitId: "codex",
            limitName: "Five-hour window",
            usedPercent: 38,
            resetsAt: 1788825600,
            windowDurationMins: 300,
            planType: "Plus",
          },
        ],
        usage: { summary: { inputTokens: 18500 }, dailyUsageBuckets: null },
        refreshedAt: "2026-09-07T00:00:00Z",
      },
      attention: [],
      fileAttention: [],
      draftAttachments: [],
      tasks: [],
      recoveryWarnings: [],
    },
    productError: null,
  };
}

function activeSnapshot(presentation) {
  const value = baseSnapshot(presentation, "logged_in");
  value.product.recoveryWarnings = [
    "Codex event recovery: Task event identity was reused with different content.",
    "Codex event recovery: Task event identity was reused with different content.",
  ];
  value.companion = {
    session: {
      id: "ses_visual",
      bootstrapId: "boot_visual",
      mode: "companion",
      status: "awaiting_human",
      controller: null,
      profile: { mode: "persistent", name: workspaceId },
      workspace: value.workspaces.workspaces[0],
      handoff: {
        reason: "Confirm the delivery address before checkout",
        requestedAt: "2026-09-07T00:00:00Z",
      },
      createdAt: "2026-09-07T00:00:00Z",
      updatedAt: "2026-09-07T00:01:00Z",
    },
    observationCount: 12,
    evidenceCount: 4,
  };
  value.product.tasks = [
    {
      taskId: "task_history",
      executionMode: "agent",
      browserIdentity: { mode: "temporary" },
      selectionSource: "user_selected",
      selectedAt: "2026-09-06T00:00:00Z",
      approvalsReviewer: "auto_review",
      bootstrapStage: "complete",
      roveSessionId: "ses_history",
      codexThreadId: "thread_history",
      conversation: {
        turnStatus: "completed",
        archived: false,
        turnOrder: ["turn_history"],
        items: {
          history: {
            id: "history",
            turnId: "turn_history",
            kind: "assistant_message",
            status: "completed",
            authoredBy: "assistant",
            text: "Historical result",
          },
        },
      },
      lifecycle: { phase: "closed", reason: "Historical task · read-only" },
      availableActions: ["archive"],
    },
    {
      taskId: "task_visual",
      executionMode: "companion",
      browserIdentity: { mode: "workspace", workspaceId },
      selectionSource: "user_selected",
      selectedAt: "2026-09-07T00:00:00Z",
      approvalsReviewer: "auto_review",
      bootstrapStage: "complete",
      roveSessionId: "ses_visual",
      codexThreadId: "thread_visual",
      model: "gpt-6-astra",
      reasoningEffort: "low",
      conversation: {
        activeTurnId: "turn_visual",
        turnStatus: "in_progress",
        archived: false,
        turnOrder: ["turn_visual"],
        items: {
          user: {
            id: "user",
            turnId: "turn_visual",
            kind: "user_message",
            status: "completed",
            authoredBy: "user",
            completedAt: "2026-09-07T00:00:00Z",
            text: "Compare the options and prepare the order for my review.",
          },
          assistant: {
            id: "assistant",
            turnId: "turn_visual",
            kind: "assistant_message",
            status: "completed",
            authoredBy: "assistant",
            phase: "commentary",
            completedAt: "2026-09-07T00:00:06Z",
            text: "I compared the available options and paused before checkout.",
          },
          tool: {
            id: "tool",
            turnId: "turn_visual",
            kind: "tool",
            status: "completed",
            completedAt: "2026-09-07T00:00:10Z",
            title: "rove/browser.inspect",
          },
          command: {
            id: "command",
            turnId: "turn_visual",
            kind: "command",
            status: "completed",
            completedAt: "2026-09-07T00:00:14Z",
            title: "Prepare comparison",
          },
          result: {
            id: "result",
            turnId: "turn_visual",
            kind: "assistant_message",
            status: "completed",
            authoredBy: "assistant",
            phase: "final_answer",
            completedAt: "2026-09-07T00:00:16Z",
            text: [
              "## Comparison ready",
              "",
              "- Option A is faster.",
              "- Option B costs less.",
              "",
              "| Option | Outcome |",
              "| --- | --- |",
              "| A | Faster |",
              "| B | Lower cost |",
              "",
              'ROVE_LIVE_RESULT {"status":"passed","choice":"A"}',
            ].join("\n"),
          },
          continuation: {
            id: "continuation",
            turnId: "turn_visual",
            kind: "user_message",
            status: "completed",
            authoredBy: "host",
            completedAt: "2026-09-07T00:00:20Z",
            text: "Continue after human control returned.",
          },
          resumed: {
            id: "resumed",
            turnId: "turn_visual",
            kind: "assistant_message",
            status: "completed",
            authoredBy: "assistant",
            phase: "commentary",
            completedAt: "2026-09-07T00:00:23Z",
            text: "Control is back. I am checking the final page state.",
          },
        },
      },
      lifecycle: {
        phase: "waiting_for_human",
        reason: "Confirm the delivery address before checkout.",
      },
      availableActions: ["finish"],
      runtime: {
        status: "awaiting_human",
        controller: null,
        attachment: "attached",
        recovery: "not_needed",
        profileOwnership: "owned",
      },
    },
  ];
  value.product.currentTaskId = "task_visual";
  value.product.attention = [
    {
      authority: "codex",
      kind: "file_approval",
      requestId: "file_visual",
      taskId: "task_visual",
      threadId: "thread_visual",
      turnId: "turn_visual",
      itemId: "file_item",
      generation: 2,
      status: "pending",
      sequence: 1,
      title: "File change approval",
      context: [
        { label: "Reason", value: "Update the generated comparison" },
        { label: "Scope", value: "Proposed file changes" },
      ],
    },
    {
      authority: "codex",
      kind: "user_input",
      requestId: "questions_visual",
      taskId: "task_visual",
      threadId: "thread_visual",
      turnId: "turn_visual",
      itemId: "question_item",
      generation: 2,
      status: "pending",
      sequence: 2,
      title: "Codex needs your input",
      questions: [
        {
          id: "region",
          header: "Region",
          question: "Which delivery region should Rove use?",
          isOther: false,
          isSecret: false,
          options: [
            { label: "West", description: "Western delivery zone" },
            { label: "East", description: "Eastern delivery zone" },
          ],
        },
        {
          id: "private_note",
          header: "Private note",
          question: "Enter the private delivery note.",
          isOther: true,
          isSecret: true,
          options: null,
        },
      ],
    },
    {
      authority: "codex",
      kind: "mcp_elicitation",
      requestId: "form_visual",
      taskId: "task_visual",
      threadId: "thread_visual",
      turnId: "turn_visual",
      itemId: "form_item",
      generation: 2,
      status: "pending",
      sequence: 3,
      title: "Tool needs information",
      elicitation: {
        mode: "form",
        message: "Choose delivery preferences.",
        serverName: "shipping",
        fields: [
          {
            id: "speed",
            title: "Delivery speed",
            required: true,
            type: "single_select",
            options: [
              { value: "standard", label: "Standard" },
              { value: "express", label: "Express" },
            ],
          },
          {
            id: "insured",
            title: "Add insurance",
            required: false,
            type: "boolean",
          },
        ],
      },
    },
    {
      authority: "rove_control",
      kind: "control_handoff",
      requestId: "control:ses_visual:2",
      taskId: "task_visual",
      threadId: "thread_visual",
      turnId: "turn_visual",
      generation: 2,
      status: "pending",
      sequence: 5,
      title: "Browser control handoff",
      instruction: "Confirm the delivery address before checkout.",
      continuationPolicy: "resume_after_control_return",
    },
  ];
  value.product.attention.splice(3, 0, {
    authority: "codex",
    kind: "mcp_elicitation",
    requestId: "url_visual",
    taskId: "task_visual",
    threadId: "thread_visual",
    turnId: "turn_visual",
    itemId: "url_item",
    generation: 2,
    status: "pending",
    sequence: 4,
    title: "Tool needs information",
    elicitation: {
      mode: "url",
      message: "Connect the current shipping account.",
      serverName: "shipping",
    },
  });
  return value;
}

function explicitResponseReturnedSnapshot() {
  const value = activeSnapshot("full");
  value.companion.session.status = "active";
  value.companion.session.controller = "agent";
  delete value.companion.session.handoff;
  const handoff = value.product.attention.find(
    (entry) => entry.authority === "rove_control",
  );
  handoff.instruction =
    "Control has returned. Rove is waiting for your explicit response before the task continues.";
  handoff.continuationPolicy = "explicit_user_response";
  value.product.tasks.find((task) => task.taskId === "task_visual").runtime = {
    status: "active",
    controller: "agent",
    attachment: "attached",
    recovery: "not_needed",
    profileOwnership: "owned",
  };
  value.product.tasks.find(
    (task) => task.taskId === "task_visual",
  ).availableActions = ["message", "finish"];
  return value;
}

function activeComposerSnapshot() {
  const value = activeSnapshot("full");
  value.product.attention = [];
  value.companion.session.status = "active";
  value.companion.session.controller = "agent";
  delete value.companion.session.handoff;
  const task = value.product.tasks.find(
    (entry) => entry.taskId === "task_visual",
  );
  task.lifecycle = { phase: "running", reason: "Working" };
  task.availableActions = ["message", "finish"];
  task.runtime = {
    status: "active",
    controller: "agent",
    attachment: "attached",
    recovery: "not_needed",
    profileOwnership: "owned",
  };
  return value;
}

function browserHandoffSnapshot() {
  const value = activeSnapshot("full");
  value.product.attention = value.product.attention.filter(
    (entry) => entry.authority === "rove_control",
  );
  value.product.tasks.find(
    (task) => task.taskId === "task_visual",
  ).availableActions = ["finish"];
  return value;
}

function constrainedLongSnapshot() {
  const value = activeSnapshot("full");
  const task = value.product.tasks.find(
    (entry) => entry.taskId === "task_visual",
  );
  task.availableActions = ["message", "finish"];
  for (let index = 0; index < 48; index += 1) {
    task.conversation.items[`long_${index}`] = {
      id: `long_${index}`,
      turnId: "turn_visual",
      kind: "assistant_message",
      status: "completed",
      authoredBy: "assistant",
      text: `Constrained layout entry ${index}: ${"verified progress detail ".repeat(8)}`,
    };
  }
  return value;
}

const cases = [
  {
    id: "full-onboarding",
    snapshot: baseSnapshot("full", "logged_out"),
    failFirstLoginOpen: true,
    follower: false,
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "full-composer",
    snapshot: baseSnapshot("full", "logged_in"),
    follower: false,
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "full-auth-dark",
    snapshot: baseSnapshot("full", "logged_out"),
    follower: false,
    colorScheme: "dark",
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "full-composer-dark",
    snapshot: baseSnapshot("full", "logged_in"),
    follower: false,
    colorScheme: "dark",
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "full-composer-narrow-dark",
    snapshot: baseSnapshot("full", "logged_in"),
    follower: false,
    colorScheme: "dark",
    viewport: { width: 590, height: 650 },
  },
  {
    id: "full-active-handoff",
    snapshot: activeSnapshot("full"),
    follower: false,
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "full-forced-light-dark-system",
    snapshot: activeComposerSnapshot(),
    follower: false,
    colorScheme: "dark",
    themePreference: "light",
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "full-explicit-response-returned",
    snapshot: explicitResponseReturnedSnapshot(),
    follower: false,
    colorScheme: "dark",
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "full-browser-handoff",
    snapshot: browserHandoffSnapshot(),
    follower: false,
    colorScheme: "dark",
    viewport: { width: 1180, height: 780 },
  },
  {
    id: "compact-active",
    snapshot: activeSnapshot("chip"),
    follower: true,
    viewport: { width: 64, height: 56 },
  },
  {
    id: "expanded-attention",
    snapshot: activeSnapshot("expanded"),
    follower: true,
    viewport: { width: 360, height: 240 },
  },
  {
    id: "full-constrained-long-content",
    snapshot: constrainedLongSnapshot(),
    follower: false,
    viewport: { width: 760, height: 420 },
  },
];
const requestedCase = process.argv
  .find((argument) => argument.startsWith("--case="))
  ?.slice("--case=".length);
const selectedCases = requestedCase
  ? cases.filter((item) => item.id === requestedCase)
  : process.argv.includes("--login-only")
    ? cases.filter((item) => item.id === "full-onboarding")
    : cases;
if (requestedCase && selectedCases.length === 0)
  throw new Error(`Unknown product-surface visual case: ${requestedCase}`);

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true });
const artifacts = [];
try {
  for (const item of selectedCases) {
    const page = await browser.newPage({
      viewport: item.viewport,
      colorScheme: item.colorScheme ?? "light",
    });
    page.on("pageerror", (error) => {
      process.stderr.write(`[product-surface:${item.id}] ${error.message}\n`);
    });
    await page.addInitScript(
      ({ snapshot, failFirstLoginOpen, themePreference }) => {
        if (themePreference)
          localStorage.setItem("rove.theme-preference.v1", themePreference);
        const listeners = new Set();
        const fullscreenListeners = new Set();
        window.__roveCalls = [];
        window.__roveSetFullscreen = (fullscreen) => {
          for (const listener of fullscreenListeners) listener(fullscreen);
        };
        window.__roveLoginOpenFailures = failFirstLoginOpen ? 1 : 0;
        window.rove = {
          getWindowFullscreen: async () => false,
          subscribeWindowFullscreen: (listener) => {
            fullscreenListeners.add(listener);
            return () => fullscreenListeners.delete(listener);
          },
          getSurfaceSnapshot: async () => snapshot,
          subscribeSurfaceSnapshot: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          transitionSurface: async () => snapshot,
          executeProductIntent: async (intent) => {
            window.__roveCalls.push({ type: "product", command: intent });
            if (intent.type === "account.login") {
              return intent.loginType === "deviceCode"
                ? {
                    type: "chatgptDeviceCode",
                    loginId: "login_device",
                    userCode: "ABCD-EFGH",
                  }
                : { type: "chatgpt", loginId: "login_browser" };
            }
            return {};
          },
          getSnapshot: async () => snapshot.companion,
          getNotice: async () => snapshot.notice,
          getLiveSession: async () => snapshot.companion?.session ?? null,
          getFollowerPresentation: async () => "windowed_compact",
          takeControl: async () => snapshot.companion,
          returnControl: async () => {
            window.__roveCalls.push({ type: "returnControl" });
            return snapshot.companion;
          },
          pauseSession: async () => snapshot.companion,
          finishSession: async () => null,
          setFollowerExpanded: async () => "windowed_expanded",
          beginFollowerDrag: async () => undefined,
          updateFollowerDrag: async () => undefined,
          endFollowerDrag: async () => undefined,
          openRove: async () => undefined,
          openTrustedExternal: async (intent) => {
            window.__roveCalls.push({ type: "openTrustedExternal", intent });
            if (
              intent.purpose === "account_login" &&
              window.__roveLoginOpenFailures > 0
            ) {
              window.__roveLoginOpenFailures -= 1;
              throw new Error("The sign-in page could not be opened.");
            }
          },
          getBrowserWorkspaces: async () => snapshot.workspaces,
          createBrowserWorkspace: async () => snapshot.workspaces,
          selectBrowserWorkspace: async () => snapshot.workspaces,
        };
      },
      {
        snapshot: item.snapshot,
        failFirstLoginOpen: item.failFirstLoginOpen ?? false,
        themePreference: item.themePreference,
      },
    );
    const suffix = item.follower ? "?surface=follower" : "";
    await page.goto(`http://127.0.0.1:${address.port}/${suffix}`);
    await page.waitForSelector(
      item.follower ? ".product-chip, .product-expanded" : ".product-app",
    );
    let keyboardOrder;
    let interactionAssertions;
    if (item.id === "full-onboarding") {
      await page.getByRole("button", { name: "Sign in with ChatGPT" }).click();
      await page
        .getByRole("alert")
        .filter({ hasText: "The sign-in page could not be opened." })
        .waitFor();
      await page.getByRole("button", { name: "Continue sign-in" }).click();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page
        .getByRole("button", { name: "Sign in with ChatGPT" })
        .waitFor();
      await page.getByRole("button", { name: "Use device code" }).click();
      await page.getByText("ABCD-EFGH", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Open verification page" })
        .waitFor();

      const loginCalls = await page.evaluate(() => window.__roveCalls);
      const loginSequence = loginCalls.map((call) =>
        call.type === "product"
          ? {
              type: "product",
              command: call.command.type,
              loginType: call.command.loginType,
              loginId: call.command.loginId,
            }
          : {
              type: "openTrustedExternal",
              purpose: call.intent.purpose,
              loginId: call.intent.loginId,
            },
      );
      const expectedLoginSequence = [
        {
          type: "product",
          command: "account.login",
          loginType: "chatgpt",
        },
        {
          type: "openTrustedExternal",
          purpose: "account_login",
          loginId: "login_browser",
        },
        {
          type: "openTrustedExternal",
          purpose: "account_login",
          loginId: "login_browser",
        },
        {
          type: "product",
          command: "account.login.cancel",
          loginId: "login_browser",
        },
        {
          type: "product",
          command: "account.login",
          loginType: "deviceCode",
        },
        {
          type: "openTrustedExternal",
          purpose: "account_login",
          loginId: "login_device",
        },
      ];
      if (
        JSON.stringify(loginSequence) !== JSON.stringify(expectedLoginSequence)
      )
        throw new Error(
          `Login interaction order/count drifted: ${JSON.stringify({ expectedLoginSequence, loginSequence })}`,
        );
      interactionAssertions = {
        loginSequence,
        failedOpenWasActionable: true,
        browserRetryRemainedAvailable: true,
        successfulCancelClearedLocalProjection: true,
        deviceCodeVisible: true,
        deviceVerificationRetryRemainedAvailable: true,
      };
    }
    if (item.id.startsWith("full-composer")) {
      await page.getByLabel("Desired outcome").focus();
      keyboardOrder = [];
      for (let index = 0; index < 6; index += 1) {
        keyboardOrder.push(
          await page.evaluate(() => {
            const active = document.activeElement;
            return (
              active?.getAttribute("aria-label") ??
              active?.textContent?.trim() ??
              ""
            );
          }),
        );
        await page.keyboard.press("Tab");
      }
      const expectedOrder = [
        "Desired outcome",
        "Attach files",
        "Task setup",
        "Permission review",
        "Model and reasoning effort",
        "Task controls and status",
      ];
      if (JSON.stringify(keyboardOrder) !== JSON.stringify(expectedOrder))
        throw new Error(
          `Keyboard order drifted: ${JSON.stringify({ expectedOrder, keyboardOrder })}`,
        );
      await page.getByLabel("Task setup").click();
      await page.getByText("How Rove helps", { exact: true }).waitFor();
      const setupPopoverBox = await page
        .locator(".composer-setup-menu .composer-popover")
        .boundingBox();
      const setupPopoverGeometryValid =
        setupPopoverBox !== null &&
        setupPopoverBox.x >= 0 &&
        setupPopoverBox.y >= 0 &&
        setupPopoverBox.x + setupPopoverBox.width <= item.viewport.width &&
        setupPopoverBox.y + setupPopoverBox.height <= item.viewport.height &&
        setupPopoverBox.width <= 400 &&
        setupPopoverBox.height <= 460;
      if (!setupPopoverGeometryValid)
        throw new Error(
          `Task setup popover geometry is invalid: ${JSON.stringify({ setupPopoverBox, viewport: item.viewport })}`,
        );
      if (item.id === "full-composer-dark")
        await page.screenshot({
          path: join(outputRoot, "full-composer-dark-setup-open.png"),
        });
      await page.locator(".product-topbar").click();
      const setupOutsideClickDismissed = !(await page
        .locator(".composer-setup-menu")
        .evaluate((menu) => menu.open));
      if (!setupOutsideClickDismissed)
        throw new Error("Task setup remained open after an outside click.");
      await page.getByLabel("Permission review").click();
      await page.keyboard.press("Escape");
      const permissionEscapeDismissed = !(await page
        .locator(".composer-permission-menu")
        .evaluate((menu) => menu.open));
      if (!permissionEscapeDismissed)
        throw new Error("Permission menu remained open after Escape.");
      await page.getByLabel("Model and reasoning effort").click();
      await page.getByText("Reasoning effort", { exact: true }).waitFor();
      const modelPopoverBox = await page
        .locator(".composer-model-menu .composer-popover")
        .boundingBox();
      const modelPopoverGeometryValid =
        modelPopoverBox !== null &&
        modelPopoverBox.x >= 0 &&
        modelPopoverBox.y >= 0 &&
        modelPopoverBox.x + modelPopoverBox.width <= item.viewport.width &&
        modelPopoverBox.y + modelPopoverBox.height <= item.viewport.height &&
        modelPopoverBox.width <= 320 &&
        modelPopoverBox.height <= 380;
      if (!modelPopoverGeometryValid)
        throw new Error(
          `Model popover geometry is invalid: ${JSON.stringify({ modelPopoverBox, viewport: item.viewport })}`,
        );
      if (item.id === "full-composer-dark")
        await page.screenshot({
          path: join(outputRoot, "full-composer-dark-model-open.png"),
        });
      await page.locator(".product-topbar").click();
      const modelOutsideClickDismissed = !(await page
        .locator(".composer-model-menu")
        .evaluate((menu) => menu.open));
      if (!modelOutsideClickDismissed)
        throw new Error("Model menu remained open after an outside click.");
      await page.locator(".account-menu > summary").click();
      await page.getByRole("menuitem", { name: "Sign out" }).waitFor();
      if ((await page.getByText("Token activity").count()) !== 0)
        throw new Error("Account popover still exposes token activity.");
      if ((await page.getByRole("menuitem", { name: "Refresh" }).count()) !== 0)
        throw new Error("Account popover still exposes refresh.");
      const popoverBox = await page.locator(".account-popover").boundingBox();
      const popoverWithinViewport =
        popoverBox !== null &&
        popoverBox.x >= 0 &&
        popoverBox.x + popoverBox.width <= item.viewport.width;
      if (!popoverWithinViewport)
        throw new Error(
          `Account popover escaped the viewport: ${JSON.stringify({ popoverBox, viewport: item.viewport })}`,
        );
      await page.getByLabel("Desired outcome").click();
      const outsideClickDismissed = !(await page
        .locator(".account-menu")
        .evaluate((menu) => menu.open));
      if (!outsideClickDismissed)
        throw new Error(
          "Account popover remained open after an outside click.",
        );
      await page.locator(".account-menu > summary").click();
      await page.keyboard.press("Escape");
      const escapeDismissed = !(await page
        .locator(".account-menu")
        .evaluate((menu) => menu.open));
      if (!escapeDismissed)
        throw new Error("Account popover remained open after Escape.");
      await page.locator(".account-menu > summary").click();
      await page.getByRole("menuitem", { name: "Settings" }).click();
      await page
        .getByRole("dialog", { name: "Appearance" })
        .waitFor({ state: "visible" });
      await page.getByRole("button", { name: /Dark/ }).click();
      const darkThemeApplied =
        (await page.locator("html").getAttribute("data-rove-theme")) === "dark";
      await page.getByRole("button", { name: /Light/ }).click();
      const lightThemeApplied =
        (await page.locator("html").getAttribute("data-rove-theme")) ===
        "light";
      await page.getByRole("button", { name: /System/ }).click();
      const systemThemeApplied =
        (await page.locator("html").getAttribute("data-rove-theme")) === null;
      if (!darkThemeApplied || !lightThemeApplied || !systemThemeApplied)
        throw new Error("Appearance setting did not apply all theme modes.");
      await page.getByRole("button", { name: "Close settings" }).click();
      let sidebarToggleWorks = true;
      let nativeFullscreenTogglePositionWorks = true;
      if (item.id === "full-composer") {
        const normalToggleX = await page
          .getByRole("button", { name: "Collapse sidebar" })
          .evaluate((toggle) => toggle.getBoundingClientRect().x);
        await page.evaluate(() => window.__roveSetFullscreen(true));
        await page.locator(".product-app.window-fullscreen").waitFor();
        const fullscreenToggleX = await page
          .getByRole("button", { name: "Collapse sidebar" })
          .evaluate((toggle) => toggle.getBoundingClientRect().x);
        nativeFullscreenTogglePositionWorks =
          normalToggleX >= 90 && fullscreenToggleX <= 14;
        if (!nativeFullscreenTogglePositionWorks)
          throw new Error(
            `Sidebar toggle did not follow native fullscreen state: ${JSON.stringify({ normalToggleX, fullscreenToggleX })}`,
          );
        await page.screenshot({
          path: join(outputRoot, "full-composer-native-fullscreen.png"),
        });
        await page.evaluate(() => window.__roveSetFullscreen(false));
        await page
          .locator(".product-app.window-fullscreen")
          .waitFor({ state: "detached" });
        await page.getByRole("button", { name: "Collapse sidebar" }).click();
        sidebarToggleWorks =
          (await page.locator(".product-sidebar").evaluate((sidebar) => {
            return getComputedStyle(sidebar).display === "none";
          })) &&
          (await page
            .getByRole("button", { name: "Expand sidebar" })
            .count()) === 1;
        if (!sidebarToggleWorks)
          throw new Error("Sidebar did not collapse from its header control.");
        await page.screenshot({
          path: join(outputRoot, "full-composer-sidebar-collapsed.png"),
        });
        await page.getByRole("button", { name: "Expand sidebar" }).click();
        sidebarToggleWorks =
          (await page.locator(".product-sidebar").evaluate((sidebar) => {
            return getComputedStyle(sidebar).display !== "none";
          })) &&
          (await page
            .getByRole("button", { name: "Collapse sidebar" })
            .count()) === 1;
        if (!sidebarToggleWorks)
          throw new Error("Sidebar did not expand from its header control.");
      }
      interactionAssertions = {
        keyboardOrder,
        profilePopoverVisible: true,
        popoverWithinViewport,
        setupPopoverGeometryValid,
        modelPopoverGeometryValid,
        setupOutsideClickDismissed,
        permissionEscapeDismissed,
        modelOutsideClickDismissed,
        outsideClickDismissed,
        escapeDismissed,
        themeSettingWorks:
          darkThemeApplied && lightThemeApplied && systemThemeApplied,
        sidebarToggleWorks,
        nativeFullscreenTogglePositionWorks,
      };
    }
    if (item.id === "full-forced-light-dark-system") {
      const themeSurfaces = await page.evaluate(() => {
        const composer = document.querySelector(
          ".followup.composer-input-shell",
        );
        const toolbar = document.querySelector(
          ".followup.composer-input-shell .composer-action-row",
        );
        const textarea = composer?.querySelector(":scope > textarea");
        const userMessage = document.querySelector(
          ".timeline-user > .message-body",
        );
        const inspector = document.querySelector(
          ".inspector-panel.browser-status",
        );
        const account = document.querySelector(".account-menu");
        if (
          !composer ||
          !textarea ||
          !toolbar ||
          !userMessage ||
          !inspector ||
          !account
        )
          return null;
        const composerStyle = getComputedStyle(composer);
        const textareaStyle = getComputedStyle(textarea);
        const toolbarStyle = getComputedStyle(toolbar);
        const userMessageStyle = getComputedStyle(userMessage);
        const inspectorStyle = getComputedStyle(inspector);
        const accountStyle = getComputedStyle(account);
        return {
          theme: document.documentElement.dataset.roveTheme,
          composerBackground: composerStyle.backgroundColor,
          composerTextareaBackground: textareaStyle.backgroundColor,
          composerImage: composerStyle.backgroundImage,
          composerRadius: composerStyle.borderRadius,
          toolbarBackground: toolbarStyle.backgroundColor,
          userMessageBackground: userMessageStyle.backgroundColor,
          userMessageColor: userMessageStyle.color,
          userMessageRadius: userMessageStyle.borderRadius,
          inspectorBackground: inspectorStyle.backgroundColor,
          inspectorShadow: inspectorStyle.boxShadow,
          accountSeparator: accountStyle.borderTopColor,
        };
      });
      if (
        themeSurfaces === null ||
        themeSurfaces.theme !== "light" ||
        themeSurfaces.composerBackground !== "rgb(255, 255, 255)" ||
        themeSurfaces.composerTextareaBackground !== "rgba(0, 0, 0, 0)" ||
        themeSurfaces.composerImage !== "none" ||
        themeSurfaces.composerRadius !== "22px" ||
        themeSurfaces.toolbarBackground !== "rgba(0, 0, 0, 0)" ||
        themeSurfaces.userMessageBackground !== "rgb(32, 32, 30)" ||
        themeSurfaces.userMessageColor !== "rgb(255, 255, 255)" ||
        themeSurfaces.userMessageRadius !== "18px" ||
        themeSurfaces.inspectorBackground !== "rgb(255, 255, 255)" ||
        themeSurfaces.inspectorShadow === "none"
      )
        throw new Error(
          `Forced-light surfaces leaked dark styling: ${JSON.stringify(themeSurfaces)}`,
        );
      await page.getByLabel("Task setup").hover();
      const setupHoverBackground = await page
        .getByLabel("Task setup")
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      const hoverAlpha = Number(
        setupHoverBackground.match(/rgba\(0, 0, 0, ([\d.]+)\)/)?.[1],
      );
      if (!Number.isFinite(hoverAlpha) || hoverAlpha > 0.05)
        throw new Error(
          `Forced-light setup hover is too strong: ${setupHoverBackground}`,
        );
      interactionAssertions = {
        forcedLightOverridesDarkSystem: true,
        continuousComposerSurface: true,
        softlyElevatedInspector: true,
        lowContrastAccountSeparator: true,
        lowContrastSetupHover: true,
      };
    }
    if (item.id === "full-active-handoff") {
      await page.getByRole("button", { name: "New task" }).click();
      if ((await page.getByLabel("Desired outcome").count()) !== 1)
        throw new Error("New task did not switch to the launch composer.");
      await page.getByLabel("Task history: task_visual").click();
      if ((await page.getByLabel("Current task request").count()) !== 1)
        throw new Error("Task selection did not restore one pending request.");
      if ((await page.locator(".task-composer-shell").count()) !== 0)
        throw new Error(
          "The composer remained visible behind a pending request.",
        );
      if (
        (await page.locator(".product-sidebar .attention-card").count()) !== 0
      )
        throw new Error("A pending request leaked into the sidebar.");
      if (
        (await page.locator(".product-inspector .browser-status").count()) !== 1
      )
        throw new Error("Browser status did not move to the right inspector.");
      if (
        (await page.locator(".product-sidebar .browser-status").count()) !== 0
      )
        throw new Error("Browser status remained in the task-history sidebar.");
      if ((await page.getByText("Codex needs your input").count()) !== 0)
        throw new Error(
          "A later request was rendered before the first request.",
        );
      if ((await page.locator(".product-task-nav").count()) !== 1)
        throw new Error(
          "Current task identity is missing from the top navigation.",
        );
      if ((await page.locator(".task-heading").count()) !== 0)
        throw new Error(
          "The duplicate in-task title/status row is still visible.",
        );
      const recoveryNotice = page.getByText(
        "Codex event recovery: Task event identity was reused with different content.",
      );
      if ((await recoveryNotice.count()) !== 0)
        throw new Error("Internal recovery diagnostics leaked into the UI.");
      await page.locator(".product-sidebar").focus();
      await page.keyboard.press("Shift");
      const sidebarOutline = await page
        .locator(".product-sidebar")
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return { style: style.outlineStyle, width: style.outlineWidth };
        });
      if (sidebarOutline.style !== "none" && sidebarOutline.width !== "0px")
        throw new Error(
          `Sidebar displayed a focus frame: ${JSON.stringify(sidebarOutline)}`,
        );
      const chronologicalText = await page
        .locator(".task-timeline")
        .innerText();
      const firstInputAt = chronologicalText.indexOf("Compare the options");
      const firstOutputAt = chronologicalText.indexOf("Comparison ready");
      const secondInputAt = chronologicalText.indexOf(
        "Continue after human control returned.",
      );
      const resumedWorkAt = chronologicalText.indexOf("Control is back.");
      if (!(
        firstInputAt >= 0 &&
        firstInputAt < firstOutputAt &&
        firstOutputAt < secondInputAt &&
        secondInputAt < resumedWorkAt
      ))
        throw new Error("Conversation segments are not chronological.");
      if ((await page.getByLabel("Copy message").count()) !== 2)
        throw new Error("Input copy controls are not icon-only per message.");
      if ((await page.getByLabel("Copy response").count()) !== 1)
        throw new Error("Output copy control is missing.");
      if (
        (await page
          .locator(".timeline-user > .message-body + .message-meta")
          .count()) !== 2
      )
        throw new Error("Input metadata is not outside the message card.");
      if ((await page.locator(".task-timeline time").count()) < 4)
        throw new Error("Conversation timestamps are missing.");
      if ((await page.locator(".timeline-final h2").count()) !== 1)
        throw new Error("Final answer Markdown was not formatted.");
      if ((await page.locator(".timeline-final table").count()) !== 1)
        throw new Error("Final answer table was not formatted.");
      if (
        (await page.locator(".timeline-final code.language-json").count()) !== 1
      )
        throw new Error("Structured result JSON was not formatted.");
      if ((await page.locator(".task-composer-shell").count()) !== 0)
        throw new Error("The pending request did not replace the composer.");
      if ((await page.getByLabel("Current task request").count()) !== 1)
        throw new Error("The task view did not show one current request.");
      if ((await page.getByRole("button", { name: "Pause" }).count()) !== 0)
        throw new Error("The legacy sidebar Pause control is still visible.");
      const historicalSelect = page.getByLabel("Task history: task_history");
      const historicalRow = historicalSelect.locator("..");
      await historicalRow.hover();
      const directArchive = historicalRow.getByRole("button", {
        name: /^Archive /,
      });
      if ((await directArchive.count()) !== 1)
        throw new Error("The direct hover archive control is missing.");
      await historicalRow.click({ button: "right" });
      await page.getByRole("menu", { name: /^Actions for / }).waitFor();
      await page.getByRole("menuitem", { name: "Rename" }).click();
      await page.getByLabel("Rename task").fill("Historical comparison");
      await page.getByRole("button", { name: "Save" }).click();
      await historicalSelect.getByText("Historical comparison").waitFor();
      await historicalRow.click({ button: "right" });
      if ((await page.getByRole("menuitem", { name: "Archive" }).count()) !== 1)
        throw new Error("Right-click task actions did not include Archive.");
      await page.locator(".product-topbar").click();
      if ((await page.locator(".task-context-menu").count()) !== 0)
        throw new Error("Task context menu remained open after outside click.");
      await historicalSelect.click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[aria-label="Task history: task_history"]')
            ?.getAttribute("aria-current") === "true",
      );
      if ((await page.getByText("Codex needs your input").count()) !== 0)
        throw new Error("Active attention leaked into historical task scope.");
      await page.getByLabel("Task history: task_visual").click();
      if ((await page.getByText("File change approval").count()) !== 1)
        throw new Error("Active attention did not return with active scope.");
      await directArchive.click();
      const archiveCalls = await page.evaluate(() =>
        window.__roveCalls.filter(
          (call) =>
            call.type === "product" && call.command.type === "task.archive",
        ),
      );
      if (
        archiveCalls.length !== 1 ||
        archiveCalls[0].command.taskId !== "task_history"
      )
        throw new Error("Direct archive control did not submit task.archive.");
      const calls = await page.evaluate(() => window.__roveCalls);
      const commands = calls
        .filter((call) => call.type === "product")
        .map((call) => call.command);
      if (commands.some((command) => command.type === "continuation.return"))
        throw new Error(
          "Renderer emitted a forbidden continuation.return command.",
        );
      interactionAssertions = {
        chronologicalInputWorkOutputSegments: true,
        iconOnlyCopyControls: true,
        inputMetadataOutsideCard: true,
        timestampsVisible: true,
        internalRecoveryDiagnosticsHidden: true,
        scrollRegionFocusFrameHidden: true,
        formattedFinalOutput: true,
        pendingRequestReplacesRichComposer: true,
        newTaskSwitchesToLaunchComposer: true,
        directArchiveControlRetained: true,
        rightClickRenameAndArchive: true,
        outsideClickDismissedTaskMenu: true,
        directArchiveCommandCount: archiveCalls.length,
        historicalTaskReadOnly: true,
        activeAttentionScopedAndRestored: true,
        singleInlineAttention: true,
        attentionReplacesComposer: true,
        sidebarAttentionRemoved: true,
        browserStatusInRightInspector: true,
        taskIdentityInTopNavigation: true,
        duplicateTaskStatusRemoved: true,
      };
    }
    if (item.id === "full-constrained-long-content") {
      const layout = await page.evaluate(() => {
        const main = document.querySelector(".product-main");
        const timeline = document.querySelector(".task-timeline");
        const sidebar = document.querySelector(".product-sidebar");
        const attention = document.querySelector(".attention-inline");
        const chip = document.querySelector(".product-chip");
        if (
          !(main instanceof globalThis.HTMLElement) ||
          !(timeline instanceof globalThis.HTMLElement) ||
          !(sidebar instanceof globalThis.HTMLElement)
        )
          throw new Error("Full product scroll regions are missing.");
        timeline.scrollTop = timeline.scrollHeight;
        sidebar.scrollTop = sidebar.scrollHeight;
        return {
          mainContained: main.scrollHeight <= main.clientHeight,
          timelineScrollable: timeline.scrollHeight > timeline.clientHeight,
          sidebarContained: sidebar.scrollHeight <= sidebar.clientHeight,
          sidebarScrollable: sidebar.scrollHeight > sidebar.clientHeight,
          timelineAtBottom:
            Math.abs(
              timeline.scrollHeight -
                timeline.clientHeight -
                timeline.scrollTop,
            ) <= 1,
          sidebarAtBottom:
            Math.abs(
              sidebar.scrollHeight - sidebar.clientHeight - sidebar.scrollTop,
            ) <= 1,
          noHorizontalOverflow:
            main.scrollWidth <= main.clientWidth &&
            sidebar.scrollWidth <= sidebar.clientWidth &&
            document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          approvalActionsContained:
            attention instanceof globalThis.HTMLElement &&
            [...attention.querySelectorAll(".attention-actions button")].every(
              (button) =>
                button.getBoundingClientRect().bottom <=
                attention.getBoundingClientRect().bottom - 8,
            ) &&
            attention.getBoundingClientRect().bottom <=
              globalThis.innerHeight - 8,
          horizontalOverflow: [...document.querySelectorAll("*")]
            .filter(
              (element) =>
                element instanceof globalThis.HTMLElement &&
                element.scrollWidth > element.clientWidth + 1,
            )
            .slice(0, 12)
            .map((element) => ({
              tag: element.tagName,
              className: element.className,
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
            })),
          chipAbsent: chip === null,
        };
      });
      if (
        !layout.mainContained ||
        !layout.timelineScrollable ||
        (!layout.sidebarContained && !layout.sidebarScrollable) ||
        !layout.timelineAtBottom ||
        !layout.sidebarAtBottom ||
        !layout.noHorizontalOverflow ||
        !layout.approvalActionsContained ||
        !layout.chipAbsent
      )
        throw new Error(`Constrained layout failed: ${JSON.stringify(layout)}`);
      interactionAssertions = layout;
    }
    const path = join(outputRoot, `${item.id}.png`);
    await page.screenshot({ path, fullPage: true });
    artifacts.push({
      id: item.id,
      path,
      ...(keyboardOrder ? { keyboardOrder } : {}),
      ...(interactionAssertions ? { interactionAssertions } : {}),
    });
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

await writeFile(
  join(outputRoot, "manifest.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), artifacts }, null, 2)}\n`,
);
process.stdout.write(
  `${JSON.stringify({ status: "pass", artifacts }, null, 2)}\n`,
);
