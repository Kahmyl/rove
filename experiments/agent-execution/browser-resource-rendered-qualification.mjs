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
  "artifacts/customer-journeys/task-browser-resources",
  new Date().toISOString().replaceAll(/[:.]/g, "-"),
);
const home = await mkdtemp(join(tmpdir(), "rove-browser-resources-"));
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
for (const name of [
  "browser_required",
  "browser_voluntary",
  "browser_human",
  "browser_checking",
]) {
  scenarios[name].product.tasks[0].browserIdentity = {
    mode: "workspace",
    workspaceId: scenarios[name].workspaces.selectedWorkspaceId,
  };
  scenarios[name].workspaces.workspaces[0].displayName =
    "Work · customer research and reporting in a deliberately long saved browser profile";
  refresh(scenarios[name]);
}
const profileId = scenarios.browser_required.workspaces.selectedWorkspaceId;
scenarios.resource_available = structuredClone(scenarios.queue);
delete scenarios.resource_available.product.tasks[0].runtime;
delete scenarios.resource_available.product.tasks[0].roveSessionId;
scenarios.resource_available.product.tasks[0].browserIdentity = {
  mode: "temporary",
};
refresh(scenarios.resource_available);
scenarios.resource_profile_required = structuredClone(
  scenarios.resource_available,
);
delete scenarios.resource_profile_required.product.tasks[0].browserIdentity;
scenarios.resource_profile_required.workspaces = { workspaces: [] };
refresh(scenarios.resource_profile_required);
scenarios.resource_profile_missing = structuredClone(
  scenarios.resource_available,
);
scenarios.resource_profile_missing.product.tasks[0].browserIdentity = {
  mode: "workspace",
  workspaceId: "wrk_deleted",
};
refresh(scenarios.resource_profile_missing);
scenarios.resource_recovery = structuredClone(scenarios.browser_required);
scenarios.resource_recovery.product.tasks[0].runtime.recovery = "unknown";
scenarios.resource_recovery.product.tasks[0].runtime.attachment = "unknown";
scenarios.resource_recovery.product.tasks[0].capabilities.canTakeControl = false;
scenarios.resource_recovery.product.tasks[0].runtime.handoffActionable = false;
refresh(scenarios.resource_recovery);
for (const base of ["required", "voluntary", "human", "checking"]) {
  const value = structuredClone(scenarios[`browser_${base}`]);
  const task = value.product.tasks[0];
  const request = structuredClone(
    scenarios.attention_command.product.attention[0],
  );
  request.taskId = task.taskId;
  task.capabilities.canRespond = true;
  value.product.attention.push(request);
  refresh(value);
  scenarios[`resource_decision_${base}`] = value;
}
for (const state of [
  "requested",
  "recording",
  "finalizing",
  "available",
  "failed",
]) {
  const value = structuredClone(scenarios.browser_voluntary);
  const task = value.product.tasks[0];
  const recording = {
    schemaVersion: 1,
    id: `rec_${"a".repeat(32)}`,
    taskId: task.taskId,
    sessionId: task.roveSessionId,
    mode: task.executionMode,
    state,
    scope: {
      kind: "page",
      pageId: "page_fixture_recording",
      url: "https://user:private@very-long-customer-research-site.example.test/private-path?token=private#private",
    },
    sensitiveDataPolicy: "user_confirmed_visible_content",
    includesAudio: false,
    coverage: "Selected page only",
    exclusions: ["Browser chrome", "Other tabs", "Audio"],
    requestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (state !== "requested") recording.startedAt = recording.requestedAt;
  if (["finalizing", "available"].includes(state))
    recording.stoppedAt = recording.requestedAt;
  if (state === "available")
    recording.artifact = {
      artifactId: recording.id,
      filename: "fixture.webm",
      mimeType: "video/webm",
      sizeBytes: 1024,
      sha256: "b".repeat(64),
      playable: true,
      partial: false,
    };
  if (state === "failed")
    recording.failure = {
      code: "FINALIZATION_FAILED",
      message:
        "This page recording could not be finalized. The task conversation and browser remain available.",
    };
  task.recordings = [recording];
  refresh(value);
  scenarios[`resource_recording_${state}`] = value;
}
for (const mode of ["agent", "capture"]) {
  const value = structuredClone(scenarios.resource_recording_recording);
  const task = value.product.tasks[0];
  task.executionMode = mode;
  task.recordings[0].mode = mode;
  value.companion.session.mode = mode;
  if (mode === "capture") {
    task.runtime = structuredClone(
      scenarios.browser_human.product.tasks[0].runtime,
    );
    task.customerExecution = structuredClone(
      scenarios.browser_human.product.tasks[0].customerExecution,
    );
    task.capabilities.canTakeControl = false;
    task.capabilities.canReturnToRove = false;
    value.companion.session.controller = "human";
  }
  refresh(value);
  scenarios[`resource_recording_mode_${mode}`] = value;
}
scenarios.resource_long = structuredClone(scenarios.browser_required);
scenarios.resource_long.product.attention[0].instruction =
  "Review the task-owned page and complete the requested human browser step, then return control to Rove. ".repeat(
    40,
  );
refresh(scenarios.resource_long);
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
          document.querySelectorAll(
            ".browser-status button, .recording-panel button, .browser-collaboration button, .browser-collaboration-summary button, .browser-profiles-modal button",
          ),
        )
          .filter(
            (node) =>
              node.getBoundingClientRect().width > 0 &&
              !node.closest("[hidden], [inert], details:not([open])"),
          )
          .map((node) => {
            const cs = getComputedStyle(node);
            let parent = node;
            let bg;
            while (parent) {
              const color = getComputedStyle(parent).backgroundColor;
              if (color !== "transparent" && !color.endsWith(", 0)")) {
                bg = color;
                break;
              }
              parent = parent.parentElement;
            }
            return {
              label: node.textContent,
              foreground: cs.color,
              background: bg ?? style.backgroundColor,
              contrast: contrast(cs.color, bg ?? style.backgroundColor),
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
  const state = async () =>
    (await page.evaluate(() => window.rove.getJourneyState())).snapshot;
  async function openInspector() {
    if (!(await inspector.isVisible()))
      await page
        .getByRole("button", { name: "Open Task details", exact: true })
        .click();
  }
  async function closeInspector() {
    const close = page.getByRole("button", {
      name: "Close inspector",
      exact: true,
    });
    if (await close.isVisible()) await close.click();
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
        "resource_available",
        "resource_profile_required",
        "resource_profile_missing",
        "resource_recovery",
        "browser_required",
        "browser_voluntary",
        "browser_human",
        "browser_checking",
        ...["requested", "recording", "finalizing", "available", "failed"].map(
          (value) => `resource_recording_${value}`,
        ),
      ]) {
        await closeInspector();
        await scenario(name, scenarios[name].product.tasks[0].taskId);
        const before = await authority();
        const beforeCalls = await commands();
        const take = page
          .locator(".task-interaction-dock button")
          .filter({ hasText: /^Take Over$/ });
        const back = page
          .locator(".task-interaction-dock button")
          .filter({ hasText: /^Return to Rove$/ });
        const collaboration =
          scenarios[name].product.tasks[0].customerCollaboration.browser;
        assert.equal(await take.count(), Number(collaboration.canTakeOver));
        assert.equal(await back.count(), Number(collaboration.canReturnToRove));
        await capture(`${theme}-${width}-${name}-closed`);
        await openInspector();
        assert.equal(
          await inspector
            .locator("button")
            .filter({ hasText: /^(Take Over|Return to Rove)$/ })
            .count(),
          0,
          "Resource inspector cannot duplicate collaboration",
        );
        assert.ok((await inspector.innerText()).includes("Profile"));
        if (name === "resource_available") {
          assert.match(
            await inspector.locator(".browser-resource-facts").innerText(),
            /Profile\s+Not yet attached/,
          );
          assert.doesNotMatch(
            await inspector.locator(".browser-resource-facts").innerText(),
            /Guest/,
          );
        }
        if (
          [
            "resource_recovery",
            "resource_profile_required",
            "resource_profile_missing",
          ].includes(name)
        )
          assert.equal(
            await inspector
              .getByRole("button", { name: /^(Open|View) Browser$/ })
              .count(),
            0,
          );
        if (name === "resource_profile_missing") {
          assert.ok(
            (await inspector.innerText()).includes("cannot be replaced"),
          );
          assert.ok(
            (await inspector.innerText()).includes("Unavailable task profile"),
          );
        }
        if (name.startsWith("resource_recording_")) {
          assert.ok(
            (await inspector.innerText()).includes("Selected page only"),
          );
          assert.ok((await inspector.innerText()).includes("no audio"));
          if (name.endsWith("available") || name.endsWith("failed")) {
            assert.ok(
              (await inspector.innerText()).includes(
                "Recorded page · very-long-customer-research-site.example.test",
              ),
            );
            assert.ok(!(await inspector.innerText()).includes("private-path"));
            assert.ok(!(await inspector.innerText()).includes("token=private"));
          }
        }
        const first = inspector.locator("button:enabled").last();
        if (await first.count()) await first.hover();
        await capture(`${theme}-${width}-${name}-open-pointer`);
        await page.mouse.move(0, 0);
        assert.deepEqual(
          await authority(),
          before,
          "Resource inspection cannot change host authority",
        );
        assert.deepEqual(
          await commands(),
          beforeCalls,
          "Resource inspection cannot dispatch",
        );
        await closeInspector();
      }
      for (const name of ["required", "voluntary", "human", "checking"]) {
        await scenario(`resource_decision_${name}`, "task_browser");
        assert.equal(await page.locator(".task-decision-surface").count(), 1);
        assert.equal(
          await page.getByLabel("Task message", { exact: true }).count(),
          0,
        );
        const browser =
          scenarios[`resource_decision_${name}`].product.tasks[0]
            .customerCollaboration.browser;
        const dockButtons = page.locator(".task-interaction-dock button");
        assert.equal(
          await dockButtons.filter({ hasText: /^Take Over$/ }).count(),
          Number(browser.canTakeOver),
        );
        assert.equal(
          await dockButtons.filter({ hasText: /^Return to Rove$/ }).count(),
          Number(browser.canReturnToRove),
        );
        const decisionsBefore = await page
          .locator(".task-decision-actions button")
          .allTextContents();
        const truthBefore = await authority();
        const commandsBefore = await commands();
        await openInspector();
        assert.equal(
          await inspector
            .locator("button")
            .filter({ hasText: /^(Take Over|Return to Rove)$/ })
            .count(),
          0,
        );
        await closeInspector();
        assert.deepEqual(
          await page.locator(".task-decision-actions button").allTextContents(),
          decisionsBefore,
        );
        assert.deepEqual(await authority(), truthBefore);
        assert.deepEqual(await commands(), commandsBefore);
        await capture(`${theme}-${width}-decision-browser-${name}`);
      }
      // Exercise profile CRUD with exact identities through immutable fixture bridge methods.
      await scenario("browser_voluntary", "task_browser");
      const frozenBefore = (await authority()).tasks[0].browserIdentity;
      await profileModal();
      const modal = page.getByRole("dialog", {
        name: "Browser profiles",
        exact: true,
      });
      assert.ok(
        (await modal.innerText()).includes("Default for future browser use"),
      );
      await modal
        .getByLabel("New browser profile name", { exact: true })
        .fill("Fixture client profile");
      await modal.getByRole("button", { name: "Create", exact: true }).hover();
      await capture(`${theme}-${width}-profiles-create-hover`);
      await modal.getByRole("button", { name: "Create", exact: true }).click();
      assert.equal(
        (await state()).workspaces.selectedWorkspaceId,
        "wrk_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      );
      assert.deepEqual(
        (await authority()).tasks[0].browserIdentity,
        frozenBefore,
      );
      await capture(`${theme}-${width}-profiles-created-default`);
      await modal
        .getByRole("button", { name: /Work · customer research/ })
        .click();
      assert.equal((await state()).workspaces.selectedWorkspaceId, profileId);
      await modal.locator("summary").filter({ hasText: "•••" }).last().click();
      await modal.getByRole("button", { name: "Delete", exact: true }).hover();
      await capture(`${theme}-${width}-profiles-actions-delete-hover`);
      await modal.getByRole("button", { name: "Rename", exact: true }).click();
      await modal
        .getByLabel("Browser profile name", { exact: true })
        .fill("Renamed fixture client profile");
      assert.equal(
        await modal
          .getByRole("button", { name: "Create", exact: true })
          .count(),
        0,
        "Rename owns its form without a competing create form",
      );
      await modal.getByRole("button", { name: "Save", exact: true }).hover();
      await capture(`${theme}-${width}-profiles-rename-hover`);
      await modal.getByRole("button", { name: "Save", exact: true }).click();
      assert.ok(
        (await state()).workspaces.workspaces.some(
          (entry) => entry.displayName === "Renamed fixture client profile",
        ),
      );
      await modal.locator("summary").filter({ hasText: "•••" }).last().click();
      await modal.getByRole("button", { name: "Delete", exact: true }).click();
      assert.ok((await modal.innerText()).includes("Task history remains"));
      await capture(`${theme}-${width}-profiles-delete-confirm`);
      await modal.getByRole("button", { name: "Cancel", exact: true }).click();
      await modal.locator("summary").filter({ hasText: "•••" }).last().click();
      await modal.getByRole("button", { name: "Delete", exact: true }).click();
      await modal
        .getByRole("button", { name: "Delete profile", exact: true })
        .click();
      assert.equal((await state()).workspaces.workspaces.length, 1);
      assert.deepEqual(
        (await authority()).tasks[0].browserIdentity,
        frozenBefore,
      );
      await capture(`${theme}-${width}-profiles-deleted-history-retained`);
      const recorded = await commands();
      assert.ok(
        recorded.some(
          (call) =>
            call.type === "renameBrowserWorkspace" &&
            call.workspaceId === "wrk_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" &&
            call.displayName === "Renamed fixture client profile",
        ),
      );
      await modal
        .getByRole("button", { name: "Close browser profiles", exact: true })
        .click();
      assert.equal(await inspector.isVisible(), true);
      await closeInspector();
      await scenario(
        "resource_profile_required",
        scenarios.resource_profile_required.product.tasks[0].taskId,
      );
      await profileModal();
      await capture(`${theme}-${width}-profiles-empty-required`);
      await page
        .getByRole("button", { name: "Close browser profiles", exact: true })
        .click();
      await closeInspector();
    }
  }
  steps.push(
    "Both themes/sizes resource closed/open, single dock collaboration, exact no-attachment/profile/recovery controls, all recording lifecycle/safe historical site states, profile create/select/rename/cancel/delete exact fixture intents and frozen task identity",
  );
  await resize(820, 700);
  await scenario("browser_required", "task_browser");
  const take = page.getByRole("button", { name: "Take Over", exact: true });
  await take.focus();
  await page.keyboard.press("Enter");
  assert.deepEqual((await commands()).at(-1), {
    type: "takeControl",
    taskId: "task_browser",
    handoffGeneration: 7,
  });
  await page
    .getByRole("button", { name: "Return to Rove", exact: true })
    .waitFor();
  await page.evaluate(() => window.rove.rejectNextBrowserReturn());
  const beforeReturn = await authority();
  await page
    .getByRole("button", { name: "Return to Rove", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Dismiss Action could not complete notification",
      exact: true,
    })
    .waitFor();
  assert.deepEqual(await authority(), beforeReturn);
  await capture("return-failure-retains-exact-human-ownership");
  await page
    .getByRole("button", {
      name: "Dismiss Action could not complete notification",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Return to Rove", exact: true })
    .click();
  await page
    .getByText("Rove is checking the page before continuing.", { exact: true })
    .waitFor();
  const returned = (await commands()).at(-1);
  assert.equal(returned.intent.type, "task.return-control");
  assert.equal(returned.intent.taskId, "task_browser");
  assert.match(returned.intent.operationId, /^intent_/);
  await capture("return-checking-has-no-collaboration-action");
  await scenario("browser_voluntary", "task_browser");
  await page.getByRole("button", { name: "Take Over", exact: true }).click();
  assert.equal((await commands()).at(-1).handoffGeneration, undefined);
  await scenario("browser_voluntary", "task_browser");
  await openInspector();
  await inspector
    .getByRole("button", { name: "View Browser", exact: true })
    .click();
  assert.deepEqual((await commands()).at(-1), {
    type: "showBrowser",
    taskId: "task_browser",
  });
  await profileModal();
  const profile = page.getByRole("dialog", {
    name: "Browser profiles",
    exact: true,
  });
  await resize(1480, 780);
  await page.keyboard.press("Tab");
  assert.equal(
    await profile.evaluate((node) => node.contains(document.activeElement)),
    true,
  );
  await capture("nested-profile-modal-after-inspector-promotion");
  await resize(820, 700);
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await profile.evaluate((node) => node.contains(document.activeElement)),
    true,
  );
  await capture("nested-profile-modal-after-inspector-demotion");
  await page.keyboard.press("Escape");
  assert.equal(await profile.count(), 0);
  await closeInspector();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.roveTheme = value),
      theme,
    );
    await resize(1480, 780);
    await scenario("browser_human", "task_browser");
    assert.equal(await inspector.getAttribute("data-shell-drawer"), null);
    assert.equal(
      await inspector
        .locator("button")
        .filter({ hasText: /^Return to Rove$/ })
        .count(),
      0,
    );
    await capture(`${theme}-wide-inline-resource-inspector`);
  }
  await resize(820, 700);
  await scenario("browser_voluntary", "task_browser");
  await openInspector();
  await inspector.locator(".recording-panel summary").click();
  const start = inspector.getByRole("button", {
    name: "Start page recording",
    exact: true,
  });
  assert.equal(await start.isEnabled(), false);
  await inspector.getByRole("checkbox").check();
  await start.click();
  const started = (await commands()).at(-1);
  assert.deepEqual(started.intent, {
    type: "task.recording.start",
    taskId: "task_browser",
    scope: "page",
    confirmUnmaskedSensitiveContent: true,
  });
  await scenario("resource_recording_recording", "task_browser");
  await openInspector();
  await inspector
    .getByRole("button", { name: "Stop page recording", exact: true })
    .click();
  assert.deepEqual((await commands()).at(-1).intent, {
    type: "task.recording.stop",
    taskId: "task_browser",
    recordingId: `rec_${"a".repeat(32)}`,
  });
  await scenario("resource_recording_available", "task_browser");
  await openInspector();
  await inspector
    .getByRole("button", { name: "Open recording", exact: true })
    .click();
  assert.deepEqual((await commands()).at(-1), {
    type: "openRecording",
    taskId: "task_browser",
    recordingId: `rec_${"a".repeat(32)}`,
  });
  for (const theme of ["light", "dark"]) {
    await closeInspector();
    await page.evaluate(
      (value) => (document.documentElement.dataset.roveTheme = value),
      theme,
    );
    await scenario("resource_long", "task_browser");
    const material = page.locator(".browser-collaboration > p");
    assert.equal(
      await material.evaluate((node) => node.scrollHeight > node.clientHeight),
      true,
    );
    const action = page.getByRole("button", { name: "Take Over", exact: true });
    const bounds = await action.boundingBox();
    assert.ok(bounds.y + bounds.height <= 700);
    await action.focus();
    await capture(`${theme}-compact-long-handoff-visible-action`);
  }
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.roveTheme = value),
      theme,
    );
    for (const mode of ["agent", "capture"]) {
      await scenario(`resource_recording_mode_${mode}`, "task_browser");
      await openInspector();
      assert.equal(
        await inspector
          .getByRole("button", { name: "Stop page recording", exact: true })
          .isEnabled(),
        true,
      );
      if (mode === "capture") {
        assert.doesNotMatch(
          await page.locator(".task-detail").innerText(),
          /Working for/,
        );
        assert.match(
          await inspector.locator(".browser-resource-facts").innerText(),
          /Control\s+You/,
        );
        assert.equal(
          await page
            .getByRole("button", { name: "Return to Rove", exact: true })
            .count(),
          0,
        );
      }
      await capture(`${theme}-compact-recording-mode-${mode}`);
    }
  }
  steps.push(
    "Exact requested and voluntary takeover/return/failure intents retain human/checking truth; resource View uses exact Task; profile nested focus survives inspector promotion/demotion; recording consent/start/stop/playback intents preserve page-only scope",
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
    "experiments/agent-execution/browser-resource-rendered-qualification.mjs",
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
