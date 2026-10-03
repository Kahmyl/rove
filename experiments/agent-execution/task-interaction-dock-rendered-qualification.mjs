#!/usr/bin/env node
/* global window, document, getComputedStyle, structuredClone, localStorage, Event */
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
  "artifacts/customer-journeys/task-interaction-dock",
  new Date().toISOString().replaceAll(/[:.]/g, "-"),
);
const home = await mkdtemp(join(tmpdir(), "rove-dock-"));
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
scenarios.new_task = structuredClone(scenarios.start_sustained);
scenarios.new_task.product.tasks = [];
delete scenarios.new_task.product.currentTaskId;
function remap(value, from, to) {
  if (typeof value === "string") return value.replaceAll(from, to);
  if (Array.isArray(value)) return value.map((entry) => remap(entry, from, to));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key.replaceAll(from, to),
        remap(entry, from, to),
      ]),
    );
  return value;
}
scenarios.dock_decision = remap(
  structuredClone(scenarios.attention_command),
  "task_attention",
  "task_active",
);
scenarios.dock_decision.product.tasks[0].customerExecution.queue =
  structuredClone(scenarios.queue.product.tasks[0].customerExecution.queue);
scenarios.dock_before_turn = structuredClone(scenarios.start_sustained);
delete scenarios.dock_before_turn.product.tasks[0].conversation.activeTurnId;
delete scenarios.dock_before_turn.product.tasks[0].codexThreadId;
scenarios.dock_before_turn.product.tasks[0].bootstrapStage =
  "thread_dispatching";
scenarios.dock_checking = structuredClone(scenarios.dock_before_turn);
scenarios.dock_checking.product.tasks[0].customerPresentation.state =
  "checking";
Object.assign(scenarios.dock_checking.product.tasks[0].capabilities, {
  canQueue: false,
  canSteer: false,
  canSubmit: false,
});
scenarios.dock_stopping = structuredClone(scenarios.queue);
scenarios.dock_stopping.product.tasks[0].customerExecution.state = "stopping";
scenarios.dock_stopping.product.tasks[0].customerPresentation.state =
  "stopping";
scenarios.dock_stopping.product.tasks[0].capabilities.canStop = false;
scenarios.dock_stopped = structuredClone(scenarios.queue);
scenarios.dock_stopped.product.tasks[0].customerExecution.state = "stopped";
scenarios.dock_stopped.product.tasks[0].customerPresentation.state = "stopped";
for (const segment of scenarios.dock_stopped.product.tasks[0].customerExecution
  .segments) {
  segment.status = "terminal";
  delete segment.activeSince;
  segment.completedAt = new Date().toISOString();
}
Object.assign(scenarios.dock_stopped.product.tasks[0].capabilities, {
  canStop: false,
  canSteer: false,
  canQueue: false,
  canSubmit: true,
});
scenarios.dock_attachment = structuredClone(scenarios.queue);
scenarios.dock_attachment.product.draftAttachments = [
  {
    id: "att_" + "a".repeat(32),
    filename: "Customer evidence with a long descriptive filename.txt",
    mimeType: "text/plain",
    size: 74,
    sha256: "f".repeat(64),
    status: "ready",
  },
];
scenarios.dock_attachment.product.tasks[0].customerExecution.queue[0].attachmentIds =
  ["att_" + "b".repeat(32)];

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

  const message = page.getByLabel("Task message", { exact: true });
  const dock = page.getByRole("region", {
    name: "Task interaction",
    exact: true,
  });
  const stop = dock.getByRole("button", {
    name: "Stop current work",
    exact: true,
  });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      localStorage.setItem("rove.theme-preference.v1", theme);
      document.documentElement.dataset.roveTheme = theme;
    }, theme);
    for (const [width, height] of [
      [1180, 780],
      [820, 700],
    ]) {
      const label = `${theme}-${width}`;
      await resize(width, height);
      await scenario("new_task");
      await page.getByLabel("Desired outcome").fill("A bounded new request");
      const newRow = await page.locator(".composer-action-row").boundingBox();
      await capture(`${label}-new-compose`);
      await scenario("terminal_work", "task_terminal");
      await message.fill("");
      assert.ok(
        await page
          .getByRole("button", { name: "Send follow-up", exact: true })
          .isDisabled(),
        `${label}: empty ready draft cannot submit`,
      );
      await message.fill("A bounded follow-up");
      assert.ok(
        await page
          .getByRole("button", { name: "Send follow-up", exact: true })
          .isEnabled(),
        `${label}: ready conversation can continue`,
      );
      const existingRow = await page
        .locator(".composer-action-row")
        .boundingBox();
      assert.ok(
        Math.abs(newRow.height - existingRow.height) <= 2,
        `${label}: shared compact action height`,
      );
      assert.equal(await dock.getAttribute("data-dock-mode"), "compose");
      await capture(`${label}-ready-compose`);
      await scenario("queue", "task_active");
      await message.fill("Preserve this unsent draft through every dock mode");
      const draftNode = await message.evaluate((node) => node.value);
      const queueBefore = await page.evaluate(() =>
        window.rove.getJourneyState(),
      );
      const queueIds =
        queueBefore.snapshot.product.tasks[0].customerExecution.queue.map(
          (entry) => entry.id,
        );
      const stopBefore = await stop.boundingBox();
      await capture(`${label}-queue-compose`);
      assert.ok(
        await stop.isEnabled(),
        `${label}: Stop remains available with a draft`,
      );
      await message.fill("");
      const emptyStop = await stop.boundingBox();
      assert.deepEqual(
        emptyStop,
        stopBefore,
        `${label}: draft text cannot move Stop`,
      );
      await message.fill(draftNode);
      await scenario("dock_decision", "task_active");
      assert.equal(await dock.getAttribute("data-dock-mode"), "decision");
      assert.equal(
        await message.count(),
        0,
        `${label}: one decision primary surface`,
      );
      assert.equal(await stop.isVisible(), true);
      assert.equal(await page.getByLabel("Queued messages").isVisible(), true);
      await capture(`${label}-decision-seam`);
      await scenario("dock_stopping", "task_active");
      assert.equal(await dock.getAttribute("data-dock-mode"), "stopping");
      assert.equal(await stop.isDisabled(), true);
      const stoppingBox = await stop.boundingBox();
      assert.ok(
        Math.abs(stoppingBox.x - stopBefore.x) <= 2 &&
          Math.abs(stoppingBox.y - stopBefore.y) <= 2,
        `${label}: stable Stop geometry across mode change`,
      );
      await capture(`${label}-stopping`);
      await scenario("dock_stopped", "task_active");
      assert.equal(
        await message.inputValue(),
        draftNode,
        `${label}: stopped restores unsent draft`,
      );
      assert.ok(
        await page
          .getByRole("button", { name: "Send follow-up", exact: true })
          .isEnabled(),
        `${label}: stopped conversation accepts a later request`,
      );
      const stopped = await page.evaluate(() => window.rove.getJourneyState());
      assert.deepEqual(
        stopped.snapshot.product.tasks[0].customerExecution.queue.map(
          (entry) => entry.id,
        ),
        queueIds,
        `${label}: Stop leaves queue inert and ordered`,
      );
      assert.equal(
        stopped.calls.filter((entry) => entry.type === "product").length,
        queueBefore.calls.filter((entry) => entry.type === "product").length,
        `${label}: mode changes never dispatch`,
      );
      await capture(`${label}-stopped`);
      await scenario("dock_attachment", "task_active");
      await page.getByLabel("Selected task attachments").waitFor();
      await page.getByLabel("More queued message actions").first().focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      assert.ok(
        await page
          .getByRole("button", { name: "Edit", exact: true })
          .first()
          .evaluate((node) => node.matches(":focus-visible")),
        `${label}: queue overflow visible focus`,
      );
      await capture(`${label}-attachments-overflow`);
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator(".task-queue-more[open]").count(),
        0,
        `${label}: Escape closes overflow`,
      );
      await scenario("multi_task", "task_a");
      await message.fill("Draft A belongs to A");
      await scenario("multi_task", "task_b");
      assert.equal(
        await message.count(),
        0,
        `${label}: background switch selects exact decision`,
      );
      await scenario("multi_task", "task_c");
      await message.fill("Draft C belongs to C");
      await scenario("multi_task", "task_a");
      assert.equal(await message.inputValue(), "Draft A belongs to A");
      await scenario("multi_task", "task_c");
      assert.equal(await message.inputValue(), "Draft C belongs to C");
      steps.push(
        `${label}: New/existing parity, independent stable Stop, queue/draft mode restoration, attachments/overflow, exact Task draft isolation and no dispatch`,
      );
    }
  }
  for (const name of ["dock_before_turn", "dock_checking"]) {
    await scenario(name, "task_start");
    assert.ok(
      await stop.isEnabled(),
      `${name}: exact Stop remains available before a provider turn`,
    );
    assert.equal(
      await dock.getAttribute("data-dock-mode"),
      name === "dock_checking" ? "checking" : "compose",
    );
    await capture(name);
    const before = await page.evaluate(() => window.rove.getJourneyState());
    await stop.evaluate((node) => {
      node.click();
      node.click();
    });
    await page.waitForFunction(() =>
      document.querySelector('[data-dock-mode="stopping"]'),
    );
    assert.ok(await stop.isDisabled());
    await page.waitForFunction(() =>
      window.rove
        .getJourneyState()
        .then(
          (state) =>
            state.snapshot.product.tasks[0].customerPresentation.state ===
            "stopped",
        ),
    );
    await message.waitFor();
    assert.equal(
      await dock.getAttribute("data-dock-mode"),
      "compose",
      `${name}: authoritative Stop restores composition before another case`,
    );
    const after = await page.evaluate(() => window.rove.getJourneyState());
    assert.equal(
      after.calls.filter((entry) => entry.intent?.type === "task.stop").length -
        before.calls.filter((entry) => entry.intent?.type === "task.stop")
          .length,
      1,
      `${name}: duplicate Stop is refused without a provider turn`,
    );
  }
  await scenario("queue", "task_active");
  const beforeStop = await page.evaluate(() => window.rove.getJourneyState());
  await stop.evaluate((node) => {
    node.click();
    node.click();
  });
  await page.waitForFunction(() =>
    document.querySelector('[data-dock-mode="stopping"]'),
  );
  assert.ok(await stop.isDisabled());
  await page.waitForFunction(() =>
    window.rove
      .getJourneyState()
      .then(
        (state) =>
          state.snapshot.product.tasks[0].customerPresentation.state ===
          "stopped",
      ),
  );
  await message.waitFor();
  assert.equal(
    await dock.getAttribute("data-dock-mode"),
    "compose",
    "Committed Stop visibly restores composition before Task switching",
  );
  const afterStop = await page.evaluate(() => window.rove.getJourneyState());
  assert.equal(
    afterStop.calls.filter((entry) => entry.intent?.type === "task.stop")
      .length -
      beforeStop.calls.filter((entry) => entry.intent?.type === "task.stop")
        .length,
    1,
    "Synchronous duplicate click dispatches exactly one Stop",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await scenario("long_content", "task_long");
  const timeline = page.locator(".task-timeline");
  assert.ok(
    await timeline.evaluate(
      (node) => node.scrollHeight - node.scrollTop - node.clientHeight <= 24,
    ),
    "Fresh Task begins in follow mode independently of another Task's reading flag",
  );
  await timeline.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event("scroll"));
  });
  await scenario("multi_task", "task_a");
  await scenario("long_content", "task_long");
  assert.equal(
    await timeline.evaluate((node) => node.scrollTop),
    0,
    "Returning to a Task restores its own upward reading position",
  );
  await capture("reduced-motion-long-content");
  await scenario("queue", "task_active");
  const longDraft =
    "Keep this multiline draft attached to its exact Task.\n".repeat(20);
  await message.fill(longDraft);
  const longDraftHeight = (await message.boundingBox()).height;
  await scenario("dock_decision", "task_active");
  assert.equal(await message.count(), 0);
  await scenario("queue", "task_active");
  assert.equal(await message.inputValue(), longDraft);
  assert.equal(
    (await message.boundingBox()).height,
    longDraftHeight,
    "Restored multiline draft retains bounded input geometry",
  );
  assert.ok(longDraftHeight <= 180, "Long draft cannot overwhelm conversation");
  await capture("long-draft-restored");
  steps.push(
    "Immediate duplicate Stop refusal, authoritative Stopped restoration, reduced motion and long content",
  );
  assert.deepEqual(errors, []);
  const sourceFiles = {};
  for (const path of [
    "apps/companion/src/renderer/product-shell.tsx",
    "apps/companion/src/renderer/product-shell.test.tsx",
    "apps/companion/src/renderer/product-surface.tsx",
    "apps/companion/src/renderer/product-surface.test.tsx",
    "apps/companion/src/renderer/styles.css",
    "experiments/agent-execution/task-interaction-dock-rendered-qualification.mjs",
    "apps/companion/src/renderer/task-interaction-dock.tsx",
    "apps/companion/src/renderer/task-interaction-dock.test.tsx",
    "experiments/agent-execution/conversation-task-rendered-qualification.mjs",
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
