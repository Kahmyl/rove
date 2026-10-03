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
  "artifacts/customer-journeys/task-decisions",
  new Date().toISOString().replaceAll(/[:.]/g, "-"),
);
const home = await mkdtemp(join(tmpdir(), "rove-decisions-"));
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
const families = [
  "user",
  "command",
  "file",
  "network",
  "permission",
  "form",
  "url",
];
function remap(value, from, to) {
  if (typeof value === "string") return value.replaceAll(from, to);
  if (Array.isArray(value)) return value.map((item) => remap(item, from, to));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replaceAll(from, to),
        remap(item, from, to),
      ]),
    );
  return value;
}
for (const family of families) {
  const name = `decision_${family}`;
  const value = remap(
    structuredClone(scenarios[`attention_${family}`]),
    "task_attention",
    "task_active",
  );
  const entry = value.product.attention[0];
  entry.context = [
    ...(entry.context ?? []),
    {
      label: "Details",
      value:
        "Exact fixture request material. Preserve the intended scope and review before choosing.\n".repeat(
          35,
        ),
    },
  ];
  value.product.tasks[0].customerExecution.queue = structuredClone(
    scenarios.queue.product.tasks[0].customerExecution.queue,
  );
  if (family === "form")
    entry.elicitation.fields = [
      {
        id: "workspace",
        title: "Workspace",
        type: "string",
        minLength: 3,
        required: true,
        description: "Name the workspace for this request.",
      },
      {
        id: "email",
        title: "Email",
        type: "string",
        format: "email",
        required: true,
      },
      {
        id: "count",
        title: "Count",
        type: "integer",
        minimum: 1,
        maximum: 5,
        required: true,
        default: 2,
      },
      {
        id: "kind",
        title: "Kind",
        type: "single_select",
        options: [{ value: "exact_internal", label: "Friendly label" }],
        required: true,
      },
      {
        id: "tags",
        title: "Tags",
        type: "multi_select",
        options: [
          { value: "first", label: "First" },
          { value: "second", label: "Second" },
        ],
        minItems: 1,
        maxItems: 1,
        required: true,
      },
      {
        id: "optional",
        title: "Include detail",
        type: "boolean",
        required: true,
      },
    ];
  if (family === "network")
    entry.approvalDecisions = [
      {
        id: "once",
        decision: "accept",
        label: "Approve once",
        description: "Allows only this network access request.",
        scope: "once",
      },
      {
        id: "policy",
        decision: {
          applyNetworkPolicyAmendment: {
            network_policy_amendment: { action: "deny", host: "example.test" },
          },
        },
        label: "Approve and deny example.test",
        description:
          "A network policy rule to deny example.test will persist after this request is approved.",
        scope: "persistent_policy",
      },
      {
        id: "refuse",
        decision: "decline",
        label: "Decline",
        description: "Does not allow this network request.",
        scope: "none",
      },
      {
        id: "cancel",
        decision: "cancel",
        label: "Cancel request",
        description: "Cancels without allowing it.",
        scope: "none",
      },
    ];
  // Use the production collaboration projection when the renderer consumes this modified fixture.
  delete value.product.tasks[0].customerCollaboration;
  scenarios[name] = value;
  for (const [suffix, status] of [
    ["checking", "awaiting_confirmation"],
    ["unknown", "resolution_unknown"],
  ]) {
    scenarios[`${name}_${suffix}`] = structuredClone(value);
    scenarios[`${name}_${suffix}`].product.attention[0].status = status;
    scenarios[`${name}_${suffix}`].product.tasks[0].capabilities.canRespond =
      false;
  }
}
scenarios.decision_secret = structuredClone(scenarios.decision_user);
scenarios.decision_secret.product.attention[0].questions = [
  {
    id: "token",
    header: "Token",
    question: "Enter the fixture secret",
    isOther: true,
    isSecret: true,
    options: null,
  },
];
scenarios.decision_secret.product.attention[0].requestId =
  "fixture_secret_request";
scenarios.decision_background = structuredClone(scenarios.queue);
scenarios.decision_background.product.tasks.push(
  structuredClone(scenarios.decision_user.product.tasks[0]),
);
scenarios.decision_background.product.tasks[1].taskId = "task_background";
scenarios.decision_background.product.attention = remap(
  structuredClone(scenarios.decision_user.product.attention),
  "task_active",
  "task_background",
);
scenarios.decision_background.product.tasks[1].title = "Background needs input";
scenarios.decision_browser = structuredClone(scenarios.decision_command);
const browser = remap(
  structuredClone(scenarios.browser_required),
  "task_browser",
  "task_active",
);
scenarios.decision_browser.product.tasks[0].runtime =
  browser.product.tasks[0].runtime;
scenarios.decision_browser.product.tasks[0].roveSessionId =
  browser.product.tasks[0].roveSessionId;
Object.assign(scenarios.decision_browser.product.tasks[0].capabilities, {
  canTakeControl: true,
});
scenarios.decision_browser.product.attention.push(...browser.product.attention);
scenarios.decision_browser.companion = browser.companion;
scenarios.decision_unsupported = structuredClone(scenarios.decision_form);
scenarios.decision_unsupported.product.attention[0].elicitation.unsupportedReason =
  "This fixture schema constraint is unsupported.";
scenarios.decision_decimal = structuredClone(scenarios.decision_form);
scenarios.decision_decimal.product.attention[0].elicitation.fields.find(
  (field) => field.id === "count",
).type = "number";
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
          return {
            label: node.textContent,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            disabled: node.disabled,
          };
        }),
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
  const request = page.getByRole("region", {
    name: "Current task request",
    exact: true,
  });
  async function calls(type = "attention.decide") {
    return (
      await page.evaluate(() => window.rove.getJourneyState())
    ).calls.filter((call) => call.intent?.type === type);
  }
  async function fill(family) {
    if (family === "user")
      await request.locator(".task-response-choice").first().click();
    if (family === "user")
      assert.equal(await request.getByRole("radio").first().isChecked(), true);
    if (family === "form") {
      await request
        .getByLabel("Workspace", { exact: true })
        .fill("Fixture workspace");
      await request
        .getByLabel("Email", { exact: true })
        .fill("fixture@example.test");
      await request
        .getByLabel("Kind", { exact: true })
        .selectOption("exact_internal");
      await request.getByLabel("Tags", { exact: true }).selectOption("first");
    }
  }
  async function actionGeometry() {
    return request
      .locator(".task-decision-actions button")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect();
          return {
            label: node.textContent,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            disabled: node.disabled,
          };
        }),
      );
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
      await page.emulateMedia({
        reducedMotion: width === 820 ? "reduce" : "no-preference",
      });
      for (const family of families) {
        const label = `${theme}-${width}-${family}`;
        await scenario("queue", "task_active");
        await message.fill(`Preserved draft ${label}`);
        const baseline = await page.evaluate(() =>
          window.rove.getJourneyState(),
        );
        await scenario(`decision_${family}`, "task_active");
        await request.waitFor();
        assert.equal(
          await message.count(),
          0,
          "Ordinary composer is absent in every decision family",
        );
        assert.equal(await dock.getAttribute("data-dock-mode"), "decision");
        assert.equal(
          await dock
            .getByRole("button", { name: "Stop current work", exact: true })
            .isEnabled(),
          true,
        );
        const queueIds = await page
          .locator(".task-queue-entry")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.dataset.queueEntryId),
          );
        assert.equal(queueIds.length, 2);
        assert.equal(
          (await calls()).length,
          baseline.calls.filter(
            (call) => call.intent?.type === "attention.decide",
          ).length,
          "Mode change cannot dispatch",
        );
        const material = request.locator(".task-decision-material");
        assert.ok(
          await material.evaluate(
            (node) => node.scrollHeight > node.clientHeight,
          ),
          "Long request details stay scrollable",
        );
        await material.evaluate((node) => {
          node.scrollTop = node.scrollHeight;
        });
        await request.locator("h2").focus();
        for (let tabs = 0; tabs < 40; tabs++) {
          await page.keyboard.press("Tab");
          if (
            await page.evaluate(() =>
              document.activeElement?.matches(".task-decision-actions button"),
            )
          )
            break;
        }
        assert.equal(
          await page.evaluate(() =>
            document.activeElement?.matches(
              ".task-decision-actions button:focus-visible",
            ),
          ),
          true,
          "Keyboard action focus is visible",
        );
        const before = await actionGeometry();
        for (const button of before)
          assert.ok(
            button.y >= 0 &&
              button.y + button.height <= height &&
              button.x >= 0 &&
              button.x + button.width <= width,
            `${label}: discoverable action bounds ${JSON.stringify(button)}`,
          );
        await capture(`${label}-pending-keyboard`);
        await fill(family);
        if (family === "url") {
          const prior = await calls();
          await request
            .getByRole("button", { name: "Open secure page", exact: true })
            .click();
          const state = await page.evaluate(() =>
            window.rove.getJourneyState(),
          );
          const external = state.calls
            .filter((call) => call.type === "openTrustedExternal")
            .at(-1);
          assert.deepEqual(external.intent, {
            purpose: "mcp_elicitation",
            taskId: "task_active",
            requestId: state.snapshot.product.attention[0].requestId,
            generation: state.snapshot.product.attention[0].generation,
          });
          assert.equal(
            (await calls()).length,
            prior.length,
            "Opening secure page is not a decision",
          );
        }
        const beforeSubmit = await actionGeometry();
        const responseCount = (await calls()).length;
        const submitName =
          family === "user"
            ? "Send"
            : family === "form"
              ? "Submit"
              : family === "url"
                ? "Continue"
                : family === "permission"
                  ? "Allow for this turn"
                  : "Approve once";
        await request
          .getByRole("button", { name: new RegExp(`^${submitName}`) })
          .evaluate((node) => {
            node.click();
            node.click();
          });
        await page.waitForFunction(
          () =>
            document
              .querySelector(".task-decision-surface")
              ?.getAttribute("aria-busy") === "true",
        );
        assert.equal(
          (await calls()).length,
          responseCount + 1,
          "Synchronous double click commits one response",
        );
        const submission = (await calls()).at(-1).intent;
        assert.equal(submission.taskId, "task_active");
        if (family === "form")
          assert.deepEqual(submission.form, {
            workspace: "Fixture workspace",
            email: "fixture@example.test",
            kind: "exact_internal",
            tags: ["first"],
            optional: false,
          });
        if (family === "user")
          assert.deepEqual(submission.answers, { audience: ["Leadership"] });
        assert.equal(
          await request
            .getByText("Submitting your response…", { exact: true })
            .count(),
          1,
        );
        const after = await actionGeometry();
        assert.equal(after.length, beforeSubmit.length);
        for (let i = 0; i < after.length; i++) {
          assert.equal(after[i].disabled, true);
          for (const key of ["x", "y", "width", "height"])
            assert.ok(
              Math.abs(after[i][key] - beforeSubmit[i][key]) < 2,
              `${label}: stable ${key} for ${after[i].label}`,
            );
        }
        await capture(`${label}-submitting-pointer`);
        await scenario("queue");
        await message.waitFor();
        assert.equal(
          await message.evaluate((node) => node === document.activeElement),
          true,
          "Settled request returns owned focus to restored composition",
        );
        assert.equal(await message.inputValue(), `Preserved draft ${label}`);
        assert.deepEqual(
          await page
            .locator(".task-queue-entry")
            .evaluateAll((nodes) =>
              nodes.map((node) => node.dataset.queueEntryId),
            ),
          queueIds,
        );
        assert.equal(await request.count(), 0);
        assert.equal(
          (await calls()).length,
          responseCount + 1,
          "Resolution does not replay",
        );
        await capture(`${label}-resolved`);
      }
    }
  }
  steps.push(
    "Seven-family light/dark normal/compact pending, submitting, resolved; exact intents, stable geometry, refusal/scope discoverability, scroll, keyboard, draft/queue and reduced motion",
  );
  await scenario("decision_form", "task_active");
  const validationBefore = (await calls()).length;
  await request.getByRole("button", { name: "Submit", exact: true }).click();
  assert.equal((await calls()).length, validationBefore);
  assert.equal(
    await request
      .getByLabel("Workspace", { exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  assert.ok(
    (await request.getByRole("status").innerText()).includes(
      "Workspace is required",
    ),
  );
  await capture("form-validation-required");
  await scenario("decision_form", "task_active");
  await fill("form");
  const integerInput = request.getByLabel("Count", { exact: true });
  await integerInput.fill("2.5");
  assert.equal(await integerInput.getAttribute("step"), "1");
  assert.equal(
    await integerInput.evaluate((node) => node.validity.stepMismatch),
    true,
  );
  const integerBefore = (await calls()).length;
  await request.getByRole("button", { name: "Submit", exact: true }).click();
  assert.equal(
    (await calls()).length,
    integerBefore,
    "Fractional integer cannot dispatch",
  );
  assert.equal(
    await integerInput.evaluate((node) => node === document.activeElement),
    true,
  );
  await capture("form-integer-fraction-refused");
  await scenario("decision_decimal", "task_active");
  await fill("form");
  const decimalInput = request.getByLabel("Count", { exact: true });
  await decimalInput.fill("2.5");
  assert.equal(await decimalInput.getAttribute("step"), "any");
  assert.equal(
    await decimalInput.evaluate((node) => node.validity.valid),
    true,
  );
  const decimalBefore = (await calls()).length;
  await request.getByRole("button", { name: "Submit", exact: true }).click();
  assert.equal(
    (await calls()).length,
    decimalBefore + 1,
    "Valid decimal dispatches exactly once",
  );
  assert.equal(
    (await calls()).at(-1).intent.form.count,
    2.5,
    "Exact decimal value survives intent",
  );
  await capture("form-number-decimal-submitted");
  steps.push(
    "Valid bounded decimal emits exact 2.5 once; fractional integer remains invalid and emits no intent",
  );

  await scenario("queue", "task_active");
  await message.waitFor();
  for (const family of ["command", "network"]) {
    await scenario(`decision_${family}`, "task_active");
    const offered = (await page.evaluate(() => window.rove.getJourneyState()))
      .snapshot.product.attention[0].approvalDecisions;
    const policy = offered.find(
      (action) => action.scope === "persistent_policy",
    );
    await request
      .getByRole("button", { name: new RegExp(`^${policy.label}`) })
      .click();
    assert.deepEqual(
      (await calls()).at(-1).intent.decision,
      policy.decision,
      "Exact amendment round-trip",
    );
    await scenario("queue", "task_active");
    await message.waitFor();
  }
  for (const family of families.filter((family) => family !== "user")) {
    await scenario(`decision_${family}`, "task_active");
    const before = (await calls()).length;
    const name = family === "permission" ? "Deny" : "Decline";
    await request.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    assert.equal((await calls()).length, before + 1);
    assert.equal((await calls()).at(-1).intent.decision, "decline");
    await scenario("queue");
    await message.waitFor();
  }
  for (const family of ["network", "form", "url"]) {
    await scenario(`decision_${family}`, "task_active");
    await request.getByRole("button", { name: new RegExp("^Cancel") }).click();
    assert.equal((await calls()).at(-1).intent.decision, "cancel");
    await scenario("queue");
    await message.waitFor();
  }
  steps.push(
    "Required-field validation and exact offered command/network amendment round-trip",
  );
  for (const suffix of ["checking", "unknown"]) {
    await scenario(`decision_url_${suffix}`, "task_active");
    await request.waitFor();
    assert.equal(
      await request.locator(".task-decision-actions button:enabled").count(),
      0,
    );
    assert.equal(await request.getByRole("status").count(), 1);
    assert.equal(await message.count(), 0);
    await capture(`url-${suffix}`);
    await scenario("queue", "task_active");
    await message.waitFor();
  }
  await scenario("decision_command", "task_active");
  await request.waitFor();
  const stopBefore = (await calls("task.stop")).length;
  await dock
    .getByRole("button", { name: "Stop current work", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".task-interaction-dock")?.dataset.dockMode ===
      "stopping",
  );
  assert.equal(
    await request.count(),
    0,
    "Stopping takes precedence over unresolved decision",
  );
  await page.waitForFunction(
    async () =>
      (await window.rove.getJourneyState()).snapshot.product.tasks.find(
        (task) => task.taskId === "task_active",
      )?.customerExecution.state === "stopped",
  );
  await request.waitFor();
  assert.equal(
    await dock.getAttribute("data-dock-mode"),
    "decision",
    "Unsettled exact request remains primary after the fixture stops",
  );
  await scenario("queue");
  assert.equal((await calls("task.stop")).length, stopBefore + 1);
  await message.waitFor();
  await scenario("decision_secret", "task_active");
  await request
    .getByLabel("Token answer", { exact: true })
    .fill("ephemeral-fixture-value");
  await scenario("queue", "task_active");
  await message.waitFor();
  await scenario("decision_secret", "task_active");
  assert.equal(
    await request.getByLabel("Token answer", { exact: true }).inputValue(),
    "",
    "Secret clears on departure",
  );
  await request
    .getByLabel("Token answer", { exact: true })
    .fill("ephemeral-fixture-value");
  await request.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".task-decision-surface")
        ?.getAttribute("aria-busy") === "true",
  );
  assert.equal(
    await request.getByLabel("Token answer", { exact: true }).inputValue(),
    "",
    "Secret clears on submission",
  );
  assert.ok(!(await page.content()).includes("ephemeral-fixture-value"));
  // Deliberately do not retain fixture response payloads containing the fake secret.
  await capture("secret-submitting-cleared");
  await scenario("queue");
  await message.waitFor();
  await scenario("decision_secret", "task_active");
  await request
    .getByLabel("Token answer", { exact: true })
    .fill("private-fixture-value");
  assert.equal(
    await page.evaluate(() => Object.isFrozen(window.rove)),
    true,
    "Production-style context bridge is immutable",
  );
  await page.evaluate(() => window.rove.rejectNextAttentionResponse());
  await request.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByText(
      "The response could not be submitted. Check this request before trying again.",
      { exact: true },
    )
    .waitFor();
  assert.ok(
    !(await page.content()).includes("private-fixture-value"),
    "Rejected response cannot echo private values",
  );
  assert.equal(
    await request.getByLabel("Token answer", { exact: true }).inputValue(),
    "",
  );
  await capture("secret-rejection-redacted");
  await scenario("decision_background", "task_active");
  await message.waitFor();
  assert.equal(
    await request.count(),
    0,
    "Background request cannot replace selected Task composer",
  );
  if (!(await page.locator("#shell-navigation").isVisible()))
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  assert.equal(
    await page
      .getByRole("button", {
        name: "Task history: task_background",
        exact: true,
      })
      .getByText("Needs input")
      .count(),
    1,
  );
  await capture("background-request-isolation");
  await page.keyboard.press("Escape");
  await scenario("multi_task", "task_a");
  await message.fill("Exact Task A unsent draft");
  await scenario("multi_task", "task_b");
  await request.waitFor();
  await request.locator(".task-response-choice").first().click();
  await request.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".task-decision-surface")
        ?.getAttribute("aria-busy") === "true",
  );
  await scenario("multi_task", "task_a");
  await message.waitFor();
  assert.equal(await message.inputValue(), "Exact Task A unsent draft");
  assert.equal(
    await message.isEnabled(),
    true,
    "Another Task submission does not globally disable input",
  );
  await capture("unrelated-task-draft-during-response");
  await scenario("decision_command", "task_active");
  await request.waitFor();
  await request.locator(".task-decision-actions button").first().focus();
  await page
    .getByRole("button", { name: "Open Task details", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Task inspector",
    exact: true,
  });
  await dialog.waitFor();
  await scenario("decision_command_checking");
  await page.waitForFunction(
    () =>
      document
        .querySelector(".task-decision-surface")
        ?.getAttribute("aria-busy") === "true",
  );
  assert.equal(
    await dialog.evaluate((node) => node.contains(document.activeElement)),
    true,
    "Submitting/checking cannot steal topmost modal focus",
  );
  assert.equal(
    await page.locator(".product-main").evaluate((node) => node.inert),
    true,
  );
  await capture("checking-under-inspector-focus");
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .getByRole("button", { name: "Open Task details", exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await scenario("decision_browser", "task_active");
  await request.waitFor();
  assert.equal(await dock.getAttribute("data-dock-mode"), "decision");
  assert.equal(
    await page
      .getByText("A device browser session needs cleanup", { exact: true })
      .count(),
    0,
    "Exact attached session association cannot be mistaken for an orphan",
  );
  const takeover = request.getByRole("button", {
    name: "Take Over",
    exact: true,
  });
  await takeover.scrollIntoViewIfNeeded();
  assert.equal(
    await takeover.isEnabled(),
    true,
    "Exact browser control remains a secondary action within decision material",
  );
  for (const node of await actionGeometry())
    assert.ok(
      node.y + node.height <= 700,
      "Combined decision/browser preserves offered approval actions",
    );
  assert.equal(
    await dock
      .getByRole("button", { name: "Stop current work", exact: true })
      .isEnabled(),
    true,
  );
  assert.equal(await message.count(), 0);
  await capture("decision-browser-stop-precedence");
  await scenario("decision_unsupported", "task_active");
  await request.getByRole("alert").waitFor();
  assert.equal(
    await request.getByRole("button", { name: "Submit", exact: true }).count(),
    0,
  );
  assert.equal(
    await request
      .getByRole("button", { name: "Decline", exact: true })
      .isEnabled(),
    true,
  );
  await capture("unsupported-form-refusal-only");
  steps.push(
    "Checking/unresolved disabled state, secret erasure, background isolation, unrelated Task drafts and modal focus/inert ownership",
  );
  assert.deepEqual(errors, []);
  const sourceFiles = {};
  for (const path of [
    "apps/companion/src/renderer/product-shell.tsx",
    "apps/companion/src/renderer/product-shell.test.tsx",
    "apps/companion/src/renderer/product-surface.tsx",
    "apps/companion/src/renderer/product-surface.test.tsx",
    "apps/companion/src/renderer/styles.css",
    "experiments/agent-execution/task-decision-rendered-qualification.mjs",
    "experiments/agent-execution/electron-conversation-task-qualification-fixture.cjs",
    "apps/companion/src/renderer/task-decision-surface.tsx",
    "apps/companion/src/renderer/task-decision-surface.test.tsx",
    "apps/companion/src/main/codex/customer-task-collaboration.ts",
    "apps/companion/src/main/codex/customer-task-collaboration.test.ts",
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
  if (app) {
    const failedPage = await app.firstWindow();
    await failedPage.screenshot({ path: join(output, "failure.png") });
    await writeFile(join(output, "failure.html"), await failedPage.content());
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
