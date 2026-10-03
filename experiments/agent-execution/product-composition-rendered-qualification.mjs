#!/usr/bin/env node
/* global window, document, getComputedStyle, structuredClone, localStorage, Event */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

const root = resolve(import.meta.dirname, "../..");
const output = join(
  root,
  "artifacts/customer-journeys/product-composition",
  new Date().toISOString().replaceAll(/[:.]/g, "-"),
);
const home = await mkdtemp(join(tmpdir(), "rove-composition-"));
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
const { customerTaskCollaboration } =
  await import("../../apps/companion/dist/main/main/codex/customer-task-collaboration.js");
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

function refresh(value) {
  const task = value.product.tasks[0];
  task.customerCollaboration = customerTaskCollaboration(
    task,
    value.product.attention,
  );
  task.customerPresentation = customerTaskPresentation({
    execution: task.customerExecution,
    collaboration: task.customerCollaboration,
    capabilities: task.capabilities,
    recordings: task.recordings,
  });
}

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
function uncertainty(value) {
  const task = value.product.tasks[0];
  const item = Object.values(task.conversation.items).find(
    (item) => item.kind === "user_message",
  );
  item.deliveryState = "uncertain";
  refresh(value);
  task.customerPresentation = customerTaskPresentation({
    execution: task.customerExecution,
    collaboration: task.customerCollaboration,
    capabilities: task.capabilities,
    latestDelivery: "uncertain",
    uncertainInputIds: [item.id],
  });
  return value;
}
scenarios.composition_working = uncertainty(structuredClone(scenarios.queue));
for (const name of ["required", "human", "checking"]) {
  const value = uncertainty(structuredClone(scenarios[`browser_${name}`]));
  value.product.tasks[0].customerExecution.queue = structuredClone(
    scenarios.queue.product.tasks[0].customerExecution.queue,
  );
  scenarios[`composition_browser_${name}`] = value;
}
scenarios.composition_decision = uncertainty(
  remap(
    structuredClone(scenarios.attention_command),
    "task_attention",
    "task_active",
  ),
);
scenarios.composition_decision.product.tasks[0].customerExecution.queue =
  structuredClone(scenarios.queue.product.tasks[0].customerExecution.queue);
scenarios.composition_background = structuredClone(scenarios.multi_task);
scenarios.composition_long = uncertainty(
  structuredClone(scenarios.long_content),
);
scenarios.composition_long.product.tasks[0].title =
  "Review a deliberately long customer task title with attachments, many activities and saved work while retaining the current interaction";
scenarios.composition_checking = structuredClone(scenarios.recovery);
scenarios.composition_checking.product.tasks[0].capabilities.canSubmit = false;
scenarios.composition_checking.product.tasks[0].capabilities.canQueue = false;
scenarios.composition_checking.product.tasks[0].capabilities.canSteer = false;
refresh(scenarios.composition_checking);
scenarios.composition_failure = structuredClone(scenarios.failure);
scenarios.composition_unresolved = structuredClone(scenarios.recovery);
scenarios.composition_unresolved.product.tasks[0].customerExecution.state =
  "unresolved";
for (const segment of scenarios.composition_unresolved.product.tasks[0]
  .customerExecution.segments)
  segment.status = "terminal";
refresh(scenarios.composition_unresolved);
for (const state of ["stopping", "stopped"]) {
  const value = structuredClone(scenarios.queue),
    task = value.product.tasks[0];
  task.customerExecution.state = state;
  for (const segment of task.customerExecution.segments)
    segment.status = state === "stopping" ? "stopping" : "terminal";
  task.lifecycle.phase = state === "stopping" ? "working" : "ready";
  task.capabilities.canStop = state === "stopping";
  if (state === "stopped") {
    task.capabilities.canSubmit = true;
    task.capabilities.canQueue = false;
    task.capabilities.canSteer = false;
  }
  refresh(value);
  scenarios[`composition_${state}`] = value;
}
scenarios.composition_attachment = uncertainty(
  structuredClone(scenarios.queue),
);
scenarios.composition_attachment.product.draftAttachments = [
  {
    id: "att_" + "a".repeat(32),
    filename: "Customer evidence with a long descriptive filename.txt",
    mimeType: "text/plain",
    size: 74,
    sha256: "f".repeat(64),
    status: "ready",
  },
];
// Model account and exact persisted delivery are independent; assistant prose changes neither.
for (const delivery of ["pending", "uncertain", "materialized"]) {
  const value = structuredClone(scenarios.terminal_work),
    task = value.product.tasks[0];
  Object.values(task.conversation.items).find(
    (item) => item.kind === "user_message",
  ).deliveryState = delivery;
  value.product.catalog.account = { status: "logged_out" };
  value.product.catalog.models = [];
  refresh(value);
  scenarios[`composition_offline_${delivery}`] = value;
}
for (const mode of ["decision", "stopping", "stopped", "checking"]) {
  const value = scenarios[`composition_${mode}`];
  scenarios[`composition_transition_${mode}`] = remap(
    structuredClone(value),
    value.product.tasks[0].taskId,
    "task_active",
  );
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
    const close = page.getByRole("button", {
      name: "Close inspector",
      exact: true,
    });
    if (await close.isVisible()) await close.click();
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
    if (name.endsWith("-focus")) {
      const focused = await page.evaluate(
        () => document.activeElement.outerHTML,
      );
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement.outerHTML),
        focused,
      );
      assert.equal(
        await page.evaluate(() =>
          document.activeElement.matches(":focus-visible"),
        ),
        true,
      );
    }
    // Sample painted endpoints, rather than a CSS opacity transition mid-frame.
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) =>
            Number.isFinite(animation.effect.getComputedTiming().endTime),
          )
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
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
              if (!color.startsWith("color(srgb")) c /= 255;
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
        resourceControls: Array.from(
          document.querySelectorAll(".product-app button"),
        )
          .filter(
            (node) =>
              Number(getComputedStyle(node).opacity) > 0 &&
              node.getBoundingClientRect().width > 0 &&
              !node.closest("[hidden], [inert], details:not([open])") &&
              node.getBoundingClientRect().bottom > 0 &&
              node.getBoundingClientRect().top < window.innerHeight,
          )
          .map((node) => {
            const cs = getComputedStyle(node);
            const parse = (color) => {
              if (color === "transparent") return [0, 0, 0, 0];
              const values = color.match(/[\d.]+/g).map(Number);
              return [values[0], values[1], values[2]]
                .map((c) => (color.startsWith("color(srgb") ? c * 255 : c))
                .concat(values[3] ?? 1);
            };
            const blend = (front, back, alpha) =>
              front
                .slice(0, 3)
                .map((c, i) => c * alpha + back[i] * (1 - alpha));
            const ancestors = [];
            for (
              let parent = node.parentElement;
              parent;
              parent = parent.parentElement
            )
              ancestors.unshift(parent);
            let parentBackground = [255, 255, 255];
            for (const parent of ancestors) {
              const color = parse(getComputedStyle(parent).backgroundColor);
              parentBackground = blend(color, parentBackground, color[3]);
            }
            const own = parse(cs.backgroundColor),
              foreground = parse(cs.color),
              opacity = Number(cs.opacity);
            const ownBackground = blend(own, parentBackground, own[3]);
            const effectiveBackground = blend(
              ownBackground,
              parentBackground,
              opacity,
            );
            const effectiveForeground = blend(
              blend(foreground, ownBackground, foreground[3]),
              parentBackground,
              opacity,
            );
            const rgb = (color) => `rgb(${color.join(", ")})`;
            return {
              label: node.getAttribute("aria-label") ?? node.textContent,
              foreground: cs.color,
              background: cs.backgroundColor,
              opacity,
              effectiveForeground: rgb(effectiveForeground),
              effectiveBackground: rgb(effectiveBackground),
              contrast: contrast(
                rgb(effectiveForeground),
                rgb(effectiveBackground),
              ),
              hover: node.matches(":hover"),
              focus: node.matches(":focus-visible"),
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
    if (geometry.stop)
      assert.ok(
        geometry.stop.y >= 0 &&
          geometry.stop.y + geometry.stop.height <= geometry.viewport[1],
        `${name}: Stop remains viewport-contained`,
      );
    assert.ok(geometry.textContrast >= 4.5, `${name}: body contrast`);
    assert.ok(
      geometry.mutedContrast >= 4.5,
      `${name}: secondary label contrast`,
    );
    for (const control of geometry.resourceControls)
      assert.ok(
        control.contrast >= 4.5,
        `${name}: resource action ${control.label}: ${control.contrast}`,
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

  const inspector = page.locator("#shell-inspector");
  let inspectorNoticeCount = 0;
  async function openInspector() {
    inspectorNoticeCount = await page.locator(".customer-notification").count();
    if (!(await inspector.isVisible()))
      await page
        .getByRole("button", { name: "Open Task details", exact: true })
        .click();
    if ((await inspector.getAttribute("aria-modal")) === "true") {
      assert.equal(await page.locator(".customer-notification").count(), 0);
      await page.keyboard.press("Tab");
      assert.equal(
        await inspector.evaluate((node) =>
          node.contains(document.activeElement),
        ),
        true,
      );
    }
  }
  async function closeInspector() {
    const close = page.getByRole("button", {
      name: "Close inspector",
      exact: true,
    });
    if (await close.isVisible()) {
      await close.click();
      assert.equal(
        await page.locator(".customer-notification").count(),
        inspectorNoticeCount,
      );
    }
  }
  async function profileModal() {
    await openInspector();
    const choose = inspector.getByRole("button", {
      name: "Choose profile",
      exact: true,
    });
    if (await choose.count()) await choose.click();
    else
      await inspector
        .getByRole("button", { name: "Manage profiles", exact: true })
        .click();
    await page
      .getByRole("dialog", { name: "Browser profiles", exact: true })
      .waitFor();
  }
  const matrix = [];
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
      for (const name of [
        "working",
        "decision",
        "browser_required",
        "browser_human",
        "browser_checking",
        "background",
        "long",
        "checking",
        "failure",
        "unresolved",
        "stopping",
        "stopped",
        "offline_pending",
        "offline_uncertain",
        "offline_materialized",
        "attachment",
      ]) {
        const value = scenarios[`composition_${name}`],
          task = value.product.tasks[0];
        await scenario(`composition_${name}`, task.taskId);
        const truth = await authority(),
          calls = await commands();
        if (name.startsWith("offline_")) {
          assert.equal(
            await page
              .getByText("Not signed in to Codex", { exact: true })
              .isVisible(),
            true,
          );
          assert.equal(
            await page.getByText("Sending…", { exact: true }).count(),
            name === "offline_pending" ? 1 : 0,
          );
        }
        if (name === "attachment") {
          await page.getByLabel("Selected task attachments").waitFor();
          await page.getByLabel("More queued message actions").first().focus();
          await page.keyboard.press("Enter");
          await page.keyboard.press("Tab");
        }

        await capture(`${theme}-${width}-${name}-closed`);
        if (name === "failure") {
          if (!(await page.locator("#shell-navigation").isVisible()))
            await page
              .getByRole("button", { name: "Open navigation", exact: true })
              .click();
          const archive = page
            .getByRole("button", { name: /^Archive / })
            .first();
          await page.locator(".task-history-row").first().hover();
          await archive.hover();
          await capture(`${theme}-${width}-archive-hover`);
          await archive.focus();
          await capture(`${theme}-${width}-archive-focus`);
          const closeNav = page
            .locator(".shell-drawer-heading")
            .getByRole("button", { name: "Close navigation", exact: true });
          if (await closeNav.isVisible()) await closeNav.click();
        }
        if (["decision", "browser_required", "browser_human"].includes(name)) {
          const action = page
            .locator(".task-interaction-dock button.primary")
            .first();
          assert.equal(await action.count(), 1);
          assert.equal(await action.isEnabled(), true);
          {
            await action.hover();
            await capture(`${theme}-${width}-${name}-primary-hover`);
            await action.focus();
            await capture(`${theme}-${width}-${name}-primary-focus`);
          }
        }
        await openInspector();
        await capture(`${theme}-${width}-${name}-inspector`);
        assert.equal(
          await inspector
            .getByRole("button", { name: /^(Take Over|Return to Rove)$/ })
            .count(),
          0,
        );
        await closeInspector();
        assert.deepEqual(await authority(), truth);
        assert.deepEqual(await commands(), calls);
        if (["working", "long"].includes(name)) {
          const input = page.getByLabel("Task message", { exact: true });
          await input.fill("Keep this draft on its owning task.");
          const send = page.locator(
            ".composer-action-row button.primary.composer-submit",
          );
          if (await send.isEnabled()) {
            await send.hover();
            await capture(`${theme}-${width}-${name}-send-hover`);
            await send.focus();
            await capture(`${theme}-${width}-${name}-send-focus`);
          }
        }
        matrix.push({
          theme,
          width,
          height,
          state: name,
          inspector: "closed/open",
          motion: width === 820 ? "reduced" : "normal",
        });
      }
      await scenario("composition_browser_required", "task_browser");
      const noticeTruth = await authority(),
        noticeCalls = await commands();
      const dismiss = page.getByRole("button", {
        name: "Dismiss Outcome unclear notification",
        exact: true,
      });
      if (await dismiss.count()) {
        await dismiss.focus();
        await page.keyboard.press("Enter");
        assert.deepEqual(await authority(), noticeTruth);
        assert.deepEqual(await commands(), noticeCalls);
        assert.ok((await page.locator(".customer-state-marker").count()) > 0);
        await capture(
          `${theme}-${width}-browser-notice-dismissed-marker-retained`,
        );
      }
      // Submission retains all offered actions and the exact authority identity.
      await scenario("composition_decision", "task_active");
      const decision = page.locator(".task-interaction-dock");
      const actions = decision.locator(".task-decision-actions button");
      const offered = await actions.count();
      assert.ok(offered >= 2);
      const identity = (await authority()).attention[0];
      const commandCount = (await commands()).length;
      await decision.getByRole("button", { name: /^Approve once/ }).click();
      await decision
        .getByText("Submitting your response…", { exact: true })
        .waitFor();
      assert.equal(await actions.count(), offered);
      for (const action of await actions.all())
        assert.equal(await action.isDisabled(), true);
      assert.equal((await commands()).length, commandCount + 1);
      const submitted = (await commands()).at(-1).intent;
      assert.deepEqual(submitted, {
        type: "attention.decide",
        taskId: identity.taskId,
        requestId: identity.requestId,
        generation: identity.generation,
        decision: "accept",
      });
      const retained = (await authority()).attention[0];
      for (const key of [
        "taskId",
        "authority",
        "requestId",
        "generation",
        "threadId",
        "turnId",
        "itemId",
      ])
        assert.equal(retained[key], identity[key]);
      await capture(`${theme}-${width}-decision-submitting`);
      // Exact Task drafts and reading position survive replacement, navigation and drawers.
      await scenario("composition_working", "task_active");
      const input = page.getByLabel("Task message", { exact: true });
      const draft =
        "Preserve the exact Task draft through these interaction modes.\n".repeat(
          12,
        );
      await input.fill(draft);
      const before = await commands();
      for (const mode of ["decision", "stopping", "stopped", "checking"]) {
        await scenario(`composition_transition_${mode}`, "task_active");
        assert.equal(
          await page
            .locator(".task-interaction-dock")
            .getAttribute("data-dock-mode"),
          mode === "decision"
            ? "decision"
            : mode === "stopping"
              ? "stopping"
              : mode === "checking"
                ? "checking"
                : "compose",
        );
      }
      await scenario("composition_working", "task_active");
      assert.equal(await input.inputValue(), draft);
      assert.deepEqual(await commands(), before);
      await capture(`${theme}-${width}-draft-after-modes`);
      await scenario("multi_task", "task_a");
      await input.fill("Draft A stays with A");
      await scenario("multi_task", "task_c");
      await input.fill("Draft C stays with C");
      await scenario("multi_task", "task_a");
      assert.equal(await input.inputValue(), "Draft A stays with A");
      await scenario("multi_task", "task_b");
      assert.equal(await input.count(), 0);
      await capture(`${theme}-${width}-background-attention-exact-task`);
      await scenario("long_content", "task_long");
      const timeline = page.locator(".task-timeline");
      await timeline.evaluate((node) => {
        node.scrollTop = 0;
        node.dispatchEvent(new Event("scroll"));
      });
      await openInspector();
      await closeInspector();
      assert.equal(await timeline.evaluate((node) => node.scrollTop), 0);
      await scenario("multi_task", "task_a");
      await scenario("long_content", "task_long");
      assert.equal(await timeline.evaluate((node) => node.scrollTop), 0);
      await capture(`${theme}-${width}-long-reading-position`);
      await page.getByRole("button", { name: "Latest", exact: true }).click();
      assert.ok(
        await timeline.evaluate(
          (node) =>
            node.scrollHeight - node.scrollTop - node.clientHeight <= 24,
        ),
      );
      await capture(`${theme}-${width}-latest-follow`);
      // A real modal owns focus/inert above notices and either drawer allocation.
      await scenario("browser_voluntary", "task_browser");
      await profileModal();
      const modal = page.getByRole("dialog", {
        name: "Browser profiles",
        exact: true,
      });
      await page.keyboard.press("Tab");
      assert.equal(
        await modal.evaluate((node) => node.contains(document.activeElement)),
        true,
      );
      await capture(`${theme}-${width}-profiles-disabled-create`);
      await modal
        .getByLabel("New browser profile name", { exact: true })
        .fill("Customer work");
      await modal.getByRole("button", { name: "Create", exact: true }).hover();
      await capture(`${theme}-${width}-profiles-primary-hover`);
      await modal
        .getByRole("button", { name: "Close browser profiles", exact: true })
        .click();
      await closeInspector();
      // Unrelated primary controls use the same owning theme pair.
      if (!(await page.locator("#shell-navigation").isVisible()))
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
      await page
        .getByRole("button", { name: "Create Workflow", exact: true })
        .click();
      const workflow = page.getByRole("dialog", {
        name: "Name your Workflow",
        exact: true,
      });
      await capture(`${theme}-${width}-workflow-disabled-create`);
      await workflow
        .getByLabel("Workflow name", { exact: true })
        .fill("Saved customer work");
      const create = workflow.getByRole("button", {
        name: "Create Workflow",
        exact: true,
      });
      await create.hover();
      await capture(`${theme}-${width}-workflow-primary-hover`);
      await create.focus();
      await capture(`${theme}-${width}-workflow-primary-focus`);
      await workflow
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      if (!(await page.locator("#shell-navigation").isVisible()))
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
      await page.getByRole("button", { name: "New task", exact: true }).click();
      await page
        .getByLabel("Desired outcome", { exact: true })
        .fill("Review the saved customer evidence");
      const start = page.getByRole("button", {
        name: "Start task",
        exact: true,
      });
      assert.equal(await start.isEnabled(), true);
      await start.hover();
      await capture(`${theme}-${width}-new-task-primary-hover`);
      await start.focus();
      await capture(`${theme}-${width}-new-task-primary-focus`);
    }
    for (const width of [967, 968, 1279, 1280, 1440]) {
      await resize(width, 780);
      await scenario("composition_working", "task_active");
      await openInspector();
      await capture(`${theme}-${width}-threshold-working-inspector`);
      await closeInspector();
    }
  }
  steps.push(
    "Both themes/sizes combined dock/queue/decision/browser/notice/marker/inspector matrix, long titles/content, primary hover/focus and disabled profile modal with unchanged authority",
  );
  await writeFile(
    join(output, "matrix.json"),
    JSON.stringify(
      { states: matrix, captures: captures.map(({ file }) => file) },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  const sourceFiles = {};
  for (const path of [
    "apps/companion/src/renderer/product-surface.tsx",
    "apps/companion/src/renderer/product-surface.test.tsx",
    "apps/companion/src/renderer/styles.css",
    "apps/companion/src/renderer/task-interaction-dock.tsx",
    "apps/companion/src/main/codex/customer-task-collaboration.ts",
    "apps/companion/src/renderer/follower-state.ts",
    "experiments/agent-execution/product-composition-rendered-qualification.mjs",
    "experiments/agent-execution/packaged-critical-interaction-qualification.mjs",
    "apps/companion/src/main/codex/product-task-port.test.ts",
    "apps/companion/src/main/codex/product-task-port.ts",
    "apps/companion/src/main/codex/local-product-api.ts",
    "packages/protocol/src/task-engine.ts",
    "experiments/agent-execution/persisted-conversation-qualification-fixture.test.mjs",
    "experiments/agent-execution/electron-conversation-task-qualification-fixture.cjs",
  ]) {
    sourceFiles[path] = createHash("sha256")
      .update(await readFile(join(root, path)))
      .digest("hex");
  }
  const compiledFiles = {};
  for (const file of await readdir(join(root, "apps/companion/dist/renderer"), {
    recursive: true,
  })) {
    if (!/\.(?:html|js|css|png)$/.test(file)) continue;
    const path = `apps/companion/dist/renderer/${file}`;
    compiledFiles[path] = createHash("sha256")
      .update(await readFile(join(root, path)))
      .digest("hex");
  }
  const runtime = await app.evaluate(() => ({
    electron: process.versions.electron,
    chromium: process.versions.chrome,
  }));
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
        compiledFiles,
        runtime: { ...runtime, node: process.version },
        matrixSha256: createHash("sha256")
          .update(await readFile(join(output, "matrix.json")))
          .digest("hex"),
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
