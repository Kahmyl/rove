import assert from "node:assert/strict";
import test from "node:test";

import {
  formatJourneySummary,
  groupObservations,
  relevantSurfaceSnapshot,
  sanitizeText,
  validateObservations,
} from "./electron-customer-journey-walker.mjs";

test("customer journey artifacts redact private identity and local paths", () => {
  const value = sanitizeText(
    "user@example.com token=secret /Users/person/private/file ABCD-EFGH",
  );
  assert.equal(value.includes("user@example.com"), false);
  assert.equal(value.includes("/Users/person"), false);
  assert.equal(value.includes("ABCD-EFGH"), false);
  assert.match(value, /\[redacted-email\]/);
  assert.match(value, /token=\[redacted\]/);
});

test("customer journey snapshot keeps review state without durable identities", () => {
  const snapshot = relevantSurfaceSnapshot({
    revision: 4,
    surface: {
      presentation: "full",
      browserContext: "windowed",
      activeHost: "control_center",
    },
    companion: null,
    productError: null,
    product: {
      host: { state: "ready", ready: true },
      catalog: {
        account: { status: "logged_out" },
        models: [],
      },
      currentTaskId: "task_private",
      tasks: [
        {
          taskId: "task_private",
          executionMode: "agent",
          lifecycle: { phase: "working" },
          conversation: { turnStatus: "in_progress" },
        },
      ],
      workflows: [],
      attention: [],
      fileAttention: [],
      recoveryWarnings: [],
    },
  });
  assert.equal(snapshot.product.currentTaskId, "[present]");
  assert.equal(snapshot.product.tasks[0].identity, "[task]");
  assert.equal(JSON.stringify(snapshot).includes("task_private"), false);
  assert.equal(snapshot.product.account.status, "logged_out");
});

test("customer journey reports accept only the bounded observation taxonomy", () => {
  assert.throws(
    () => validateObservations([{ classification: "BUG", text: "No." }]),
    /Unsupported customer-journey classification/,
  );
  const observations = [
    { classification: "NON_BLOCKING_NOTE", step: 1, text: "Fresh state." },
  ];
  assert.equal(groupObservations(observations).NON_BLOCKING_NOTE.length, 1);
  const summary = formatJourneySummary({
    title: "First launch",
    baseline: {
      commit: "abc",
      gitState: "clean",
      productHome: "fresh",
      electronData: "fresh",
      accountState: "none",
      externalEffects: "none",
      viewports: [{ width: 1440, height: 900 }],
    },
    steps: [
      {
        number: 1,
        userIntent: "Open Rove",
        actionTaken: "Launch",
        screenshot: "01-launch.png",
      },
    ],
    observations,
    journeyBoundary: "Stopped after first launch.",
  });
  assert.match(summary, /NON_BLOCKING_NOTE/);
  assert.match(summary, /01-launch\.png/);
});
