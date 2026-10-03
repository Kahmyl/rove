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
  "artifacts/customer-journeys/responsive-shell",
  new Date().toISOString().replaceAll(/[:.]/g, "-"),
);
const home = await mkdtemp(join(tmpdir(), "rove-shell-"));
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
scenarios.workflow = structuredClone(scenarios.new_task);
scenarios.workflow.product.workflows = [
  {
    workflowId: "workflow_shell",
    name: "Evidence review",
    archived: false,
    currentRevision: 1,
    revision: {
      workflowId: "workflow_shell",
      revision: 1,
      configuration: {
        purpose: "Review evidence",
        preferences: [],
        criteria: [],
        guidance: [],
        procedures: [],
        resourceRequirements: [],
        resultConventions: [],
        approvedKnowledge: [],
      },
      digest: "a".repeat(64),
      approvedAt: "2026-10-03T10:00:00Z",
    },
    createdAt: "2026-10-03T10:00:00Z",
    updatedAt: "2026-10-03T10:00:00Z",
  },
];
scenarios.missing_profile = structuredClone(scenarios.active_work);
scenarios.missing_profile.workspaces.workspaces = [];
delete scenarios.missing_profile.workspaces.selectedWorkspaceId;
delete scenarios.missing_profile.product.tasks[0].browserIdentity;
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
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      localStorage.setItem("rove.theme-preference.v1", theme);
      document.documentElement.dataset.roveTheme = theme;
    }, theme);
    for (const [width, height] of [
      [1180, 780],
      [820, 700],
    ]) {
      await resize(width, height);
      await scenario("active_work", "task_active");
      await capture(`${theme}-${width}-selected-task`);
      await scenario("long_content", "task_long");
      const draft = page.locator(".task-composer-shell textarea");
      await draft.fill("Keep this task-owned unsent draft");
      const timeline = page.locator(".task-timeline");
      await timeline.evaluate((node) => {
        node.scrollTop = 40;
        window.shellTimeline = node;
        window.shellDraft = document.querySelector(
          ".task-composer-shell textarea",
        );
      });
      const before = await page.evaluate(async () => ({
        top: window.shellTimeline.scrollTop,
        calls: (await window.rove.getJourneyState()).calls.length,
        task: (await window.rove.getJourneyState()).snapshot.product
          .currentTaskId,
      }));
      await capture(`${theme}-${width}-closed`);
      await page
        .getByRole("button", { name: "Open Task details", exact: true })
        .click();
      const drawer = page.locator("#shell-inspector");
      assert.equal(await drawer.getAttribute("aria-modal"), "true");
      assert.ok(
        await drawer.evaluate((node) => node.contains(document.activeElement)),
      );
      const focusable = drawer.locator(
        'button:visible:not(:disabled), summary:visible, input:visible:not(:disabled), [tabindex="0"]:visible',
      );
      await focusable.last().focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await page
          .getByRole("button", { name: "Close inspector", exact: true })
          .evaluate((node) => node === document.activeElement),
        true,
      );
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await focusable
          .last()
          .evaluate((node) => node === document.activeElement),
        true,
      );
      await capture(`${theme}-${width}-inspector`);
      await page.keyboard.press("Escape");
      assert.equal(await drawer.isVisible(), false);
      assert.equal(
        await page
          .getByRole("button", { name: "Open Task details", exact: true })
          .evaluate((node) => node === document.activeElement),
        true,
      );
      await page
        .getByRole("button", { name: "Open Task details", exact: true })
        .click();
      await page
        .locator(".shell-drawer-backdrop")
        .click({ position: { x: 20, y: 100 } });
      assert.equal(await drawer.isVisible(), false);
      if (width === 820) {
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
        await capture(`${theme}-${width}-navigation`);
        await page
          .getByRole("button", { name: "Task history: task_long", exact: true })
          .click({ button: "right" });
        await page
          .getByRole("menuitem", { name: "Rename", exact: true })
          .focus();
        await page.keyboard.press("Escape");
        assert.equal(await page.getByRole("menu").count(), 0);
        assert.equal(await page.locator("#shell-navigation").isVisible(), true);
        await page.keyboard.press("Escape");
        assert.equal(
          await page.locator("#shell-navigation").isVisible(),
          false,
        );
      } else {
        await page
          .getByRole("button", { name: "Collapse sidebar", exact: true })
          .click();
        await capture(`${theme}-${width}-navigation-collapsed`);
        await page
          .getByRole("button", { name: "Expand sidebar", exact: true })
          .click();
      }
      assert.equal(
        await draft.inputValue(),
        "Keep this task-owned unsent draft",
      );
      assert.ok(
        await page.evaluate(
          () =>
            window.shellTimeline === document.querySelector(".task-timeline") &&
            window.shellDraft ===
              document.querySelector(".task-composer-shell textarea"),
        ),
      );
      assert.equal(
        await timeline.evaluate((node) => node.scrollTop),
        before.top,
      );
      const after = await page.evaluate(() => window.rove.getJourneyState());
      assert.equal(after.calls.length, before.calls);
      assert.equal(after.snapshot.product.currentTaskId, before.task);
      steps.push(
        `${theme}/${width}: focus loop, Escape, backdrop, unchanged Task/intents/draft/DOM/read position`,
      );
    }
  }
  for (const width of [959, 960, 967, 968, 1279, 1280, 1400]) {
    await resize(width, 780);
    await capture(`threshold-${width}`);
  }
  await resize(1180, 780);
  await page
    .getByRole("button", { name: "Open Task details", exact: true })
    .click();
  await resize(1280, 780);
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"][data-shell-drawer]'),
  );
  assert.equal(
    await page
      .locator(".sidebar-toggle")
      .evaluate((node) => node === document.activeElement),
    true,
  );
  steps.push(
    "Resize removes inspector opener: focus returns to visible navigation toggle",
  );
  await resize(820, 700);
  await scenario("missing_profile", "task_active");
  await page
    .getByRole("button", { name: "Open Task details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Choose profile", exact: true })
    .click();
  const profiles = page.getByRole("dialog", {
    name: "Browser profiles",
    exact: true,
  });
  await profiles.waitFor();
  assert.ok(
    await profiles.evaluate((node) => node.contains(document.activeElement)),
  );
  await capture("profile-modal-over-inspector");
  await page.keyboard.press("Escape");
  assert.equal(await profiles.count(), 0);
  assert.equal(await page.locator("#shell-inspector").isVisible(), true);
  assert.equal(
    await page
      .getByRole("button", { name: "Choose profile", exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#shell-inspector").isVisible(), false);
  steps.push(
    "Nested profile modal Escape dismisses only topmost overlay and restores exact opener",
  );
  await scenario("new_task");
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await capture("new-task-compact");
  await scenario("workflow");
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page
    .locator(".workflow-list-row")
    .filter({ hasText: "Evidence review" })
    .click();
  await capture("workflow-compact");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await scenario("long_content", "task_long");
  await page
    .getByRole("button", { name: "Open Task details", exact: true })
    .click();
  await capture("reduced-motion-inspector");
  assert.equal(
    await page
      .locator(".shell-drawer-backdrop")
      .evaluate((node) => getComputedStyle(node).transitionDuration),
    "0s",
  );
  await page.keyboard.press("Escape");
  await scenario("browser_voluntary", "task_browser");
  const beforeBrowser = await page.evaluate(() =>
    window.rove.getJourneyState(),
  );
  await page
    .getByRole("button", { name: "Open Task details", exact: true })
    .click();
  await page.keyboard.press("Escape");
  const afterBrowser = await page.evaluate(() => window.rove.getJourneyState());
  assert.deepEqual(
    afterBrowser.snapshot.product.tasks[0].runtime,
    beforeBrowser.snapshot.product.tasks[0].runtime,
  );
  assert.deepEqual(afterBrowser.calls, beforeBrowser.calls);
  steps.push(
    "Browser collaboration authority/generations unchanged by drawer disclosure",
  );
  await resize(1180, 780);
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  const preference = await page.evaluate(() =>
    localStorage.getItem("rove.sidebar-collapsed.v1"),
  );
  assert.equal(preference, "true");
  await resize(820, 700);
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  assert.equal(await page.getByRole("dialog").count(), 1);
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("rove.sidebar-collapsed.v1"),
    ),
    preference,
  );
  await resize(1180, 780);
  await page.reload();
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .waitFor();
  assert.equal(await page.locator("#shell-navigation").isVisible(), false);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.roveTheme),
    "dark",
  );
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  assert.equal(await page.locator("#shell-navigation").isVisible(), true);
  steps.push(
    "Compact disclosure preserves stored collapse; reload restores navigation/theme preference without restoring drawer",
  );
  assert.deepEqual(errors, []);
  const sourceFiles = {};
  for (const path of [
    "apps/companion/src/renderer/product-shell.tsx",
    "apps/companion/src/renderer/product-shell.test.tsx",
    "apps/companion/src/renderer/product-surface.tsx",
    "apps/companion/src/renderer/product-surface.test.tsx",
    "apps/companion/src/renderer/styles.css",
    "experiments/agent-execution/responsive-shell-rendered-qualification.mjs",
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
