import { describe, expect, it } from "vitest";

import { validateCodexResponse } from "./protocol.js";
import {
  normalizeCompletedRequestHumanToolItem,
  REQUEST_HUMAN_TOOL,
  ROVE_CONTROL_NAMESPACE,
} from "./request-human-tool-item.js";

const argumentsValue = {
  sessionId: "ses_bound",
  reason: "Sign in",
  instruction: "Inspect the authenticated page and continue.",
  continuationPolicy: "resume_after_control_return",
} as const;

const returnedControl = {
  sessionId: "ses_bound",
  generation: 2,
  status: "awaiting_human",
  controller: null,
  activeHandoffId: "handoff_bound",
  observationSeq: 17,
};

function dynamicItem(overrides: Record<string, unknown> = {}) {
  return {
    type: "dynamicToolCall",
    id: "item_handoff",
    namespace: ROVE_CONTROL_NAMESPACE,
    tool: REQUEST_HUMAN_TOOL,
    status: "completed",
    arguments: argumentsValue,
    contentItems: [
      { type: "inputText", text: JSON.stringify(returnedControl) },
    ],
    success: true,
    durationMs: 1,
    ...overrides,
  };
}

function mcpItem() {
  return {
    type: "mcpToolCall",
    id: "item_handoff",
    server: ROVE_CONTROL_NAMESPACE,
    tool: REQUEST_HUMAN_TOOL,
    status: "completed",
    arguments: argumentsValue,
    appContext: null,
    pluginId: null,
    readOnlyHint: false,
    result: {
      _meta: null,
      structuredContent: null,
      content: [{ type: "text", text: JSON.stringify(returnedControl) }],
    },
    error: null,
    durationMs: 1,
  };
}

function threadReadResult(item: ReturnType<typeof dynamicItem>) {
  return {
    thread: {
      id: "thread_bound",
      extra: null,
      sessionId: "codex_bound",
      forkedFromId: null,
      parentThreadId: null,
      preview: "",
      ephemeral: false,
      section: null,
      sectionEnteredAt: null,
      projectId: null,
      daybreakEnabled: null,
      environments: null,
      originator: null,
      historyMode: "legacy",
      modelProvider: "openai",
      model: null,
      reasoningEffort: null,
      createdAt: 1,
      updatedAt: 2,
      recencyAt: 2,
      cwd: "/work",
      cliVersion: "0.154.0-alpha.6.2",
      status: { type: "idle" },
      path: null,
      source: "appServer",
      canAcceptDirectInput: true,
      threadSource: "rove:task_bound:boot_bound",
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
      turns: [
        {
          id: "turn_bound",
          items: [item],
          itemsView: "full",
          status: "completed",
          error: null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
        },
      ],
    },
  };
}

describe("completed request-human tool normalization", () => {
  it("normalizes the existing MCP result form", () => {
    expect(normalizeCompletedRequestHumanToolItem(mcpItem())).toEqual({
      itemId: "item_handoff",
      sessionId: "ses_bound",
      instruction: "Inspect the authenticated page and continue.",
      continuationPolicy: "resume_after_control_return",
      returnedControlStatus: {
        sessionId: "ses_bound",
        generation: 2,
        handoffId: "handoff_bound",
        observationSeq: 17,
      },
    });
  });

  it("admits and normalizes the pinned App Server dynamic thread item", () => {
    const item = dynamicItem();
    expect(() =>
      validateCodexResponse("thread/read", threadReadResult(item) as never),
    ).not.toThrow();
    expect(normalizeCompletedRequestHumanToolItem(item)).toEqual(
      normalizeCompletedRequestHumanToolItem(mcpItem()),
    );
  });

  it.each([
    ["failed", dynamicItem({ status: "failed", success: false })],
    ["unsuccessful", dynamicItem({ success: false })],
    ["wrong namespace", dynamicItem({ namespace: "foreign" })],
    ["missing namespace", dynamicItem({ namespace: null })],
    ["wrong tool", dynamicItem({ tool: "control.wait" })],
  ])("does not recognize a %s dynamic item", (_label, item) => {
    expect(normalizeCompletedRequestHumanToolItem(item)).toBeUndefined();
  });

  it.each([
    ["missing", []],
    [
      "ambiguous",
      [
        { type: "inputText", text: JSON.stringify(returnedControl) },
        { type: "inputText", text: JSON.stringify(returnedControl) },
      ],
    ],
    ["malformed", [{ type: "inputText", text: "not-json" }]],
    ["non-text", [{ type: "inputImage", imageUrl: "data:image/png;base64," }]],
  ])("fails closed for a %s dynamic result", (_label, contentItems) => {
    expect(() =>
      normalizeCompletedRequestHumanToolItem(dynamicItem({ contentItems })),
    ).toThrow(/lacks trusted Runtime result/);
  });

  it("fails closed when the exact request arguments are incomplete", () => {
    expect(() =>
      normalizeCompletedRequestHumanToolItem(
        dynamicItem({ arguments: { ...argumentsValue, reason: "" } }),
      ),
    ).toThrow(/request-human reason/);
  });
});
