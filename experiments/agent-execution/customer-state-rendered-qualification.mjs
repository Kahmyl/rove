#!/usr/bin/env node
/* global window, document, getComputedStyle, structuredClone, localStorage */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

const root = resolve(import.meta.dirname, "../..");
const output = join(
  root,
  "artifacts/customer-journeys/task-notifications",
  new Date().toISOString().replaceAll(/[:.]/g, "-"),
);
const home = await mkdtemp(join(tmpdir(), "rove-notifications-"));
await mkdir(output, { recursive: true });
execFileSync(
  process.execPath,
  [
    join(
      root,
      "experiments/agent-execution/conversation-task-rendered-qualification.mjs",
    ),
    "--scenarios-only",
  ],
  { env: { ...process.env, ROVE_RENDERED_EVIDENCE_ROOT: output } },
);
const scenarioPath = join(output, "production-projection-scenarios.json");
const scenarios = JSON.parse(await readFile(scenarioPath, "utf8"));
const { customerTaskPresentation } =
  await import("../../apps/companion/dist/main/main/codex/customer-task-presentation.js");
const { RUNTIME_TRANSIENT_WARNING } =
  await import("../../apps/companion/dist/main/main/runtime-failure-containment.js");
// Keep ordinary activity durations believable; IDs and semantic projections stay unchanged.
const dateShift = Date.now() - 45_000 - Date.parse("2026-09-20T12:00:00.000Z");
function recentDates(value) {
  if (typeof value === "string" && /^2026-09-20T/.test(value))
    return new Date(Date.parse(value) + dateShift).toISOString();
  if (Array.isArray(value)) return value.map(recentDates);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, recentDates(entry)]),
    );
  return value;
}
for (const name of Object.keys(scenarios))
  scenarios[name] = recentDates(scenarios[name]);

function present(task, extras = {}) {
  task.customerPresentation = customerTaskPresentation({
    execution: task.customerExecution,
    collaboration: task.customerCollaboration,
    capabilities: task.capabilities,
    ...extras,
  });
}
scenarios.notice_uncertain = structuredClone(scenarios.uncertain);
const uncertain = scenarios.notice_uncertain.product.tasks[0];
const input =
  Object.values(uncertain.conversation.items).find(
    (item) => item.kind === "user_message",
  ) ?? Object.values(uncertain.conversation.items)[0];
input.deliveryState = "uncertain";
present(uncertain, {
  latestDelivery: "uncertain",
  uncertainInputIds: [input.id],
});
scenarios.notice_unresolved = structuredClone(scenarios.recovery);
scenarios.notice_unresolved.product.tasks[0].customerExecution.state =
  "unresolved";
for (const segment of scenarios.notice_unresolved.product.tasks[0]
  .customerExecution.segments)
  segment.status = "terminal";
present(scenarios.notice_unresolved.product.tasks[0]);
scenarios.notice_failure = structuredClone(scenarios.failure);
present(scenarios.notice_failure.product.tasks[0]);
scenarios.notice_checking = structuredClone(scenarios.recovery);
present(scenarios.notice_checking.product.tasks[0]);
scenarios.notice_browser = structuredClone(scenarios.browser_required);
const browserTask = scenarios.notice_browser.product.tasks[0];
browserTask.runtime.recovery = "unknown";
present(browserTask, {
  browserRecoveryKey: JSON.stringify([
    browserTask.roveSessionId,
    browserTask.runtime.attachment,
    browserTask.runtime.recovery,
  ]),
});
scenarios.notice_legacy = structuredClone(scenarios.queue);
scenarios.notice_legacy.product.tasks[0].availableActions.push(
  "acknowledge_legacy_effects",
);
present(scenarios.notice_legacy.product.tasks[0], {
  legacyOutcomeUnclear: true,
});
scenarios.notice_runtime = structuredClone(scenarios.queue);
scenarios.notice_runtime.product.recoveryWarnings = [RUNTIME_TRANSIENT_WARNING];
scenarios.notice_multi = structuredClone(scenarios.notice_uncertain);
scenarios.notice_multi.product.tasks.push(
  structuredClone(scenarios.queue.product.tasks[0]),
);
scenarios.notice_resolved = structuredClone(scenarios.notice_uncertain);
const resolved = scenarios.notice_resolved.product.tasks[0];
resolved.customerExecution.state = "idle";
input.deliveryState = "uncertain";
for (const item of Object.values(resolved.conversation.items))
  if (item.deliveryState === "uncertain") item.deliveryState = "materialized";
present(resolved);
for (const name of [
  "uncertain",
  "legacy",
  "unresolved",
  "failure",
  "browser",
  "runtime",
]) {
  const settled = structuredClone(scenarios[`notice_${name}`]);
  const task = settled.product.tasks[0];
  task.customerExecution.state = "idle";
  task.availableActions = task.availableActions.filter(
    (action) => action !== "acknowledge_legacy_effects",
  );
  task.customerCollaboration = {
    taskId: task.taskId,
    needsCustomerAction: false,
    browser: {
      state: "none",
      title: "No browser collaboration needed",
      description: "No browser wait.",
      canTakeOver: false,
      canReturnToRove: false,
    },
  };
  for (const item of Object.values(task.conversation.items))
    if (item.deliveryState === "uncertain") item.deliveryState = "materialized";
  if (task.runtime) task.runtime.recovery = "not_needed";
  settled.product.recoveryWarnings = [];
  settled.product.attention = [];
  present(task);
  scenarios[`notice_${name}_resolved`] = settled;
}
scenarios.notice_long = structuredClone(scenarios.notice_uncertain);
scenarios.notice_long.product.tasks[0].customerPresentation.markers[0].description +=
  " Review the affected work and keep its unresolved state until matching evidence confirms the outcome.".repeat(
    20,
  );
scenarios.notice_decision = structuredClone(scenarios.attention_command);
present(scenarios.notice_decision.product.tasks[0], {
  consequentialOutcomeUnclear: true,
  unresolvedResultIds: ["fixture_earlier_result"],
});
for (const [state, segmentStatus] of [
  ["stopping", "stopping"],
  ["stopped", "terminal"],
]) {
  const value = structuredClone(scenarios.notice_checking);
  const task = value.product.tasks[0];
  task.customerExecution.state = state;
  task.customerExecution.segments.forEach((segment) => {
    segment.status = segmentStatus;
  });
  present(task);
  scenarios[`notice_${state}`] = value;
}
await writeFile(scenarioPath, JSON.stringify(scenarios));
const requireBrowser = createRequire(
  join(root, "packages/browser/package.json"),
);
const requireCompanion = createRequire(
  join(root, "apps/companion/package.json"),
);
const { _electron: electron } = requireBrowser("playwright");
const captures = [];
const steps = [];
let app;
try {
  app = await electron.launch({
    executablePath: requireCompanion("electron"),
    args: [
      join(
        root,
        "experiments/agent-execution/electron-conversation-task-qualification-fixture.cjs",
      ),
      `--user-data-dir=${home}`,
    ],
    env: {
      ...process.env,
      ROVE_HOME: home,
      ROVE_JOURNEY_RENDERER_ROOT: join(root, "apps/companion/dist/renderer"),
      ROVE_QUALIFICATION_SCENARIOS: scenarioPath,
    },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator(".product-app[data-shell-mode]").waitFor();
  async function resize(width, height) {
    await app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setContentSize(...size),
      [width, height],
    );
    await page.waitForFunction(
      (size) => window.innerWidth === size[0] && window.innerHeight === size[1],
      [width, height],
    );
  }
  async function scenario(name, taskId) {
    await page.evaluate((name) => window.rove.setJourneyScenario(name), name);
    if (taskId) {
      if (!(await page.locator("#shell-navigation").isVisible()))
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
      await page
        .getByRole("button", { name: `Task history: ${taskId}`, exact: true })
        .click();
    }
  }
  async function capture(name) {
    const geometry = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const r = element.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        };
      };
      const contrast = (a, b) => {
        const luminance = (color) => {
          const rgb = color
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
            .map((c) => {
              c /= 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
          return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
        };
        const x = luminance(a),
          y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const app = document.querySelector(".product-app");
      const title = document.querySelector(".product-task-nav strong");
      const style = getComputedStyle(app);
      const probe = document.createElement("span");
      probe.style.color = "var(--muted)";
      app.append(probe);
      const mutedColor = getComputedStyle(probe).color;
      probe.remove();
      return {
        viewport: [window.innerWidth, window.innerHeight],
        mode: app.dataset.shellMode,
        navigation: app.dataset.shellNavigation,
        inspector: app.dataset.shellInspector,
        main: rect(".product-main"),
        conversation: rect(".task-detail"),
        dock: rect(".task-detail-dock"),
        decision: rect(".task-decision-surface"),
        material: rect(".task-decision-material"),
        decisionActions: Array.from(
          document.querySelectorAll(".task-decision-actions button"),
        ).map((node) => {
          const r = node.getBoundingClientRect();
          const actionStyle = getComputedStyle(node);
          const description = node.querySelector("small");
          return {
            foreground: actionStyle.color,
            background: actionStyle.backgroundColor,
            textContrast: contrast(
              actionStyle.color,
              actionStyle.backgroundColor,
            ),
            descriptionContrast: description
              ? contrast(
                  getComputedStyle(description).color,
                  actionStyle.backgroundColor,
                )
              : null,
            hovered: node.matches(":hover"),
            focusVisible: node.matches(":focus-visible"),
            primary: node.classList.contains("primary"),
            label: node.textContent,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            disabled: node.disabled,
          };
        }),
        notifications: Array.from(
          document.querySelectorAll(".customer-notification"),
        ).map((node) => {
          const style = getComputedStyle(node);
          const button = node.querySelector("button");
          const control = getComputedStyle(button);
          const r = node.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            textContrast: contrast(style.color, style.backgroundColor),
            controlContrast: contrast(control.color, control.backgroundColor),
            hovered: button.matches(":hover"),
            focused: button.matches(":focus-visible"),
          };
        }),
        markers: Array.from(
          document.querySelectorAll(".customer-state-marker"),
        ).map((node) => ({
          id: node.id,
          open: node.open,
          text: node.textContent,
        })),
        responseStatus: document.querySelector(".task-decision-status")
          ?.textContent,
        composer: rect(".composer-input-shell"),
        action: rect(".composer-action-row"),
        stop: rect(".task-stop-control"),
        dockMode: document.querySelector(".task-interaction-dock")?.dataset
          .dockMode,
        title: rect(".product-task-nav strong"),
        drawer: rect("[data-shell-drawer]:not([hidden])"),
        documentWidth: document.documentElement.scrollWidth,
        textContrast: contrast(style.color, style.backgroundColor),
        mutedContrast: contrast(mutedColor, style.backgroundColor),
        titleFont: title ? getComputedStyle(title).fontSize : null,
        focus: document.activeElement?.outerHTML.slice(0, 500),
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches,
      };
    });
    assert.equal(
      geometry.documentWidth,
      geometry.viewport[0],
      `${name}: document overflow`,
    );
    assert.ok(
      geometry.main.width - 48 >= 680,
      `${name}: work allocation ${geometry.main.width}`,
    );
    assert.ok(geometry.textContrast >= 4.5, `${name}: body contrast`);
    assert.ok(
      geometry.mutedContrast >= 4.5,
      `${name}: secondary label contrast`,
    );
    for (const notice of geometry.notifications) {
      assert.ok(notice.textContrast >= 4.5, `${name}: notice contrast`);
      assert.ok(notice.controlContrast >= 4.5, `${name}: dismiss contrast`);
      assert.ok(
        notice.x >= 0 &&
          notice.x + notice.width <= geometry.viewport[0] &&
          notice.y + notice.height <= geometry.viewport[1],
        `${name}: notice bounds`,
      );
    }
    for (const action of geometry.decisionActions) {
      assert.ok(
        action.textContrast >= 4.5,
        `${name}: action text contrast ${action.textContrast}`,
      );
      if (action.descriptionContrast !== null)
        assert.ok(
          action.descriptionContrast >= 4.5,
          `${name}: action consequence contrast`,
        );
    }
    if (geometry.drawer)
      assert.ok(
        geometry.drawer.x >= 0 &&
          geometry.drawer.x + geometry.drawer.width <= geometry.viewport[0],
        `${name}: drawer bounds`,
      );
    const file = `${name}.png`;
    await page.screenshot({ path: join(output, file) });
    await writeFile(join(output, `${name}.html`), await page.content());
    captures.push({
      file,
      sha256: createHash("sha256")
        .update(await readFile(join(output, file)))
        .digest("hex"),
      geometry,
    });
  }

  const authority = async () =>
    (await page.evaluate(() => window.rove.getJourneyState())).snapshot.product;
  const commands = async () =>
    (await page.evaluate(() => window.rove.getJourneyState())).calls;
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      localStorage.setItem("rove.theme-preference.v1", value);
      document.documentElement.dataset.roveTheme = value;
    }, theme);
    for (const [width, height] of [
      [1180, 780],
      [820, 700],
    ]) {
      await resize(width, height);
      await page.emulateMedia({
        reducedMotion: width === 820 ? "reduce" : "no-preference",
      });
      for (const [name, title] of [
        ["uncertain", "Outcome unclear"],
        ["legacy", "Outcome unclear"],
        ["unresolved", "Task state unclear"],
        ["failure", "Couldn't continue"],
        ["runtime", "Browser work is unavailable"],
        ["browser", "Browser state unconfirmed"],
      ]) {
        const snapshot = scenarios[`notice_${name}`];
        const taskId = snapshot.product.tasks[0].taskId;
        await scenario("queue"); // Exact issue absence re-arms a later failure episode.
        await scenario(`notice_${name}`, taskId);
        const dismiss = page.getByRole("button", {
          name: `Dismiss ${title} notification`,
          exact: true,
        });
        await dismiss.waitFor();
        const before = await authority();
        const beforeCalls = await commands();
        const marker = page.locator(
          name === "runtime"
            ? "#device-browser-state"
            : `[id="task-state-${taskId}"]`,
        );
        assert.ok((await marker.innerText()).includes(title));
        await dismiss.hover();
        await capture(`${theme}-${width}-${name}-shown-pointer`);
        await page.mouse.move(0, 0);
        await dismiss.focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        assert.equal(
          await dismiss.evaluate((node) => node.matches(":focus-visible")),
          true,
        );
        await page.keyboard.press("Enter");
        assert.equal(await dismiss.count(), 0);
        assert.equal(await marker.isVisible(), true);
        assert.deepEqual(
          await authority(),
          before,
          "Dismissal cannot change host state, capabilities or fences",
        );
        assert.deepEqual(
          await commands(),
          beforeCalls,
          "Dismissal cannot dispatch any command",
        );
        await capture(`${theme}-${width}-${name}-dismissed-marker`);
        await marker.locator("summary").click();
        assert.equal(await marker.evaluate((node) => node.open), true);
        await capture(`${theme}-${width}-${name}-recovery-details`);
        await scenario(`notice_${name}`, taskId);
        assert.equal(
          await dismiss.count(),
          0,
          "Unchanged snapshots cannot re-announce dismissed episode",
        );
        await scenario(`notice_${name}_resolved`, taskId);
        assert.equal(await page.locator(".customer-notification").count(), 0);
        assert.equal(
          await marker.count(),
          0,
          "Matching owner resolution removes marker",
        );
        await capture(`${theme}-${width}-${name}-resolved`);
      }
      await scenario(
        "notice_checking",
        scenarios.notice_checking.product.tasks[0].taskId,
      );
      assert.equal(
        await page.locator(".customer-notification").count(),
        0,
        "Neutral checking is not a warning",
      );
      await capture(`${theme}-${width}-neutral-checking`);
    }
  }
  steps.push(
    "Both themes and sizes, pointer/keyboard/reduced motion, six attributed warnings, dismissal/details and unchanged exact authority/capabilities/command log, matching resolution and neutral checking",
  );
  await scenario("queue");
  await scenario("notice_multi", uncertain.taskId);
  await page
    .getByRole("button", {
      name: "Dismiss Outcome unclear notification",
      exact: true,
    })
    .click();
  async function select(taskId) {
    if (!(await page.locator("#shell-navigation").isVisible()))
      await page
        .getByRole("button", { name: "Open navigation", exact: true })
        .click();
    await page
      .getByRole("button", { name: `Task history: ${taskId}`, exact: true })
      .click();
  }
  await select(scenarios.queue.product.tasks[0].taskId);
  assert.equal(
    await page.locator(".customer-notification").count(),
    0,
    "No attribution to unrelated selected Task",
  );
  await page
    .getByLabel("Task message", { exact: true })
    .fill("Independent Task draft");
  await select(uncertain.taskId);
  assert.equal(
    await page
      .getByRole("button", {
        name: "Dismiss Outcome unclear notification",
        exact: true,
      })
      .count(),
    0,
  );
  assert.equal(
    await page.locator(`[id="task-state-${uncertain.taskId}"]`).isVisible(),
    true,
  );
  await capture("task-switch-retains-owning-marker");
  await page.reload();
  await page.locator(".product-app[data-shell-mode]").waitFor();
  await scenario("notice_uncertain", uncertain.taskId);
  assert.equal(
    await page.locator(`[id="task-state-${uncertain.taskId}"]`).isVisible(),
    true,
    "Fresh renderer reconstructs marker from exact fixture snapshot",
  );
  await page
    .getByRole("button", {
      name: "Dismiss Outcome unclear notification",
      exact: true,
    })
    .waitFor();
  await capture("renderer-restart-retains-truth-renotifies-once");
  await scenario("notice_resolved", uncertain.taskId);
  assert.equal(await page.locator(".customer-notification").count(), 0);
  await scenario("notice_uncertain", uncertain.taskId);
  await page
    .getByRole("button", {
      name: "Dismiss Outcome unclear notification",
      exact: true,
    })
    .waitFor();
  await capture("resolved-then-new-uncertainty-rearms-notice");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.roveTheme = value;
    }, theme);
    await scenario("queue");
    await scenario("notice_long", uncertain.taskId);
    const longDismiss = page.getByRole("button", {
      name: "Dismiss Outcome unclear notification",
      exact: true,
    });
    const content = page.locator('.customer-notification [role="status"]');
    assert.equal(
      await content.evaluate((node) => node.scrollHeight > node.clientHeight),
      true,
      "Long material scrolls independently of dismissal",
    );
    const bounds = await longDismiss.boundingBox();
    assert.ok(
      bounds.y + bounds.height <= 700,
      "Long copy preserves visible dismissal",
    );
    await capture(`${theme}-compact-long-notification`);
    await longDismiss.click();
    await page.locator(`[id="task-state-${uncertain.taskId}"] summary`).click();
    assert.equal(
      await page
        .locator(".customer-state-marker > div")
        .evaluate((node) => node.scrollHeight > node.clientHeight),
      true,
    );
    await capture(`${theme}-compact-long-marker-details`);
    await scenario(
      "notice_decision",
      scenarios.notice_decision.product.tasks[0].taskId,
    );
    const noticeDismiss = page.getByRole("button", {
      name: "Dismiss Outcome unclear notification",
      exact: true,
    });
    const commandBefore = await commands();
    const truthBefore = await authority();
    const decision = page.getByRole("region", {
      name: "Current task request",
      exact: true,
    });
    assert.equal(await decision.isVisible(), true);
    const labelsBefore = await decision
      .locator(".task-decision-actions button")
      .allTextContents();
    await noticeDismiss.click();
    assert.deepEqual(await commands(), commandBefore);
    assert.deepEqual(await authority(), truthBefore);
    assert.deepEqual(
      await decision.locator(".task-decision-actions button").allTextContents(),
      labelsBefore,
    );
    assert.equal(
      await page.getByLabel("Task message", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Stop current work", exact: true })
        .isEnabled(),
      true,
    );
    await capture(`${theme}-decision-dismissal-preserves-exact-actions-stop`);
  }
  const transitionTask = scenarios.notice_checking.product.tasks[0].taskId;
  for (const [state, mode] of [
    ["checking", "checking"],
    ["stopping", "stopping"],
    ["stopped", "compose"],
  ]) {
    await scenario(`notice_${state}`, transitionTask);
    assert.equal(
      await page
        .locator(".task-interaction-dock")
        .getAttribute("data-dock-mode"),
      mode,
    );
    assert.equal(await page.locator(".customer-notification").count(), 0);
    await capture(`rapid-authoritative-${state}`);
  }
  steps.push(
    "Long notice/details material stays bounded with visible dismissal; both-theme decision actions/independent Stop remain exact after dismiss; rapid newer checking/stopping/stopped snapshots win without artificial dwell",
  );
  steps.push(
    "Task switch retains dismissal and owning marker, unrelated draft stays enabled; renderer reload reconstructs durable fixture truth, restart/new episode re-announces once without dispatch",
  );
  assert.deepEqual(errors, []);
  const sourceFiles = {};
  for (const path of [
    "apps/companion/src/main/codex/customer-task-presentation.ts",
    "apps/companion/src/main/codex/customer-task-presentation.test.ts",
    "apps/companion/src/main/codex/local-product-api.ts",
    "apps/companion/src/renderer/product-surface.tsx",
    "apps/companion/src/renderer/product-surface.test.tsx",
    "apps/companion/src/renderer/customer-state-notices.tsx",
    "apps/companion/src/renderer/customer-state-notices.test.tsx",
    "apps/companion/src/renderer/styles.css",
    "experiments/agent-execution/customer-state-rendered-qualification.mjs",
    "experiments/agent-execution/electron-conversation-task-qualification-fixture.cjs",
  ]) {
    sourceFiles[path] = createHash("sha256")
      .update(await readFile(join(root, path)))
      .digest("hex");
  }
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        sourceHead: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        }).trim(),
        mode: "deterministic production-projection Electron renderer; fixture account; temporary user data",
        sourceFiles,
        captures,
        steps,
        errors,
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    `${output}\n${captures.length} captures; ${steps.length} assertion groups passed\n`,
  );
} catch (error) {
  // Preserve the primary failure even if Electron's window has already closed.
  const failedPage = app?.windows().find((window) => !window.isClosed());
  if (failedPage) {
    try {
      await failedPage.screenshot({ path: join(output, "failure.png") });
      await writeFile(join(output, "failure.html"), await failedPage.content());
    } catch (captureError) {
      await writeFile(
        join(output, "failure-capture.txt"),
        captureError.message,
      );
    }
  }
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify(
      { message: error.message, stack: error.stack, captures, steps },
      null,
      2,
    ),
  );
  process.stderr.write(`Evidence retained: ${output}\n`);
  throw error;
} finally {
  await app?.close();
  await rm(home, { recursive: true, force: true });
}
