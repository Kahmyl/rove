import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { customerTaskCollaboration } from "../main/codex/customer-task-collaboration.js";
import type {
  ProductAttentionProjection,
  ProductTaskProjection,
} from "../main/codex/local-product-api.js";
import {
  TaskDecisionSurface,
  decisionValidation,
} from "./task-decision-surface.js";

const task = {
  taskId: "task",
  capabilities: { canRespond: true },
} as ProductTaskProjection;
function entry(
  kind: ProductAttentionProjection["kind"],
): ProductAttentionProjection {
  return {
    authority: "codex",
    kind,
    requestId: "request",
    taskId: "task",
    threadId: "thread",
    turnId: "turn",
    itemId: "item",
    generation: 3,
    sequence: 1,
    status: "pending",
    title: "Exact request",
  };
}
function render(value: ProductAttentionProjection, submitting = false) {
  const request = customerTaskCollaboration(task, [value]).request!;
  return renderToStaticMarkup(
    <TaskDecisionSurface
      entry={value}
      request={request}
      submitting={submitting}
      answers={{}}
      form={{}}
      onAnswer={() => {}}
      onForm={() => {}}
      onRespond={() => {}}
      onExternal={async () => {}}
      onFocusDeparture={() => {}}
    />,
  );
}
describe("Task decision surface", () => {
  for (const kind of [
    "user_input",
    "command_approval",
    "file_approval",
    "network_approval",
    "permission_approval",
    "mcp_elicitation",
  ] as const) {
    it(`retains disabled ${kind} controls and exactly one submission status`, () => {
      const pending = entry(kind);
      if (kind === "user_input")
        pending.questions = [
          {
            id: "q",
            header: "Audience",
            question: "Which audience?",
            isOther: true,
            isSecret: false,
            options: [{ label: "Team", description: "Details" }],
          },
        ];
      if (kind === "mcp_elicitation")
        pending.elicitation = {
          mode: "form",
          message: "Complete this form",
          fields: [
            {
              id: "email",
              title: "Email",
              type: "string",
              format: "email",
              required: true,
            },
          ],
        };
      const html = render({ ...pending, status: "responding" });
      expect(html.match(/Submitting your response…/g)).toHaveLength(1);
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('disabled=""');
      expect(html).not.toContain('aria-label="Task message"');
      expect(html.match(/<button/g)?.length).toEqual(
        render(pending).match(/<button/g)?.length,
      );
      if (kind === "mcp_elicitation")
        expect(html).toContain('aria-label="Email"');
    });
  }
  it("keeps trusted URL intent separate from response during all states", () => {
    const value = {
      ...entry("mcp_elicitation"),
      elicitation: { mode: "url" as const, message: "Connect securely" },
    };
    const html = render(value);
    for (const label of ["Open secure page", "Continue", "Decline", "Cancel"])
      expect(html).toContain(label);
    expect(html).toContain(
      "Opening the page does not approve or submit this request.",
    );
    expect(render({ ...value, status: "awaiting_confirmation" })).toContain(
      "Checking whether your response was received…",
    );
    expect(render({ ...value, status: "resolution_unknown" })).toContain(
      "will not be sent again automatically",
    );
    expect(
      render(value, true).match(/Submitting your response…/g),
    ).toHaveLength(1);
  });
  it("preserves offered order and exact amendments with visible consequences and refusal", () => {
    const value = entry("command_approval");
    value.approvalDecisions = [
      {
        id: "p",
        decision: {
          acceptWithExecpolicyAmendment: {
            execpolicy_amendment: ["allow exact command"],
          },
        },
        label: "Update exact policy",
        description: "Persists allow exact command",
        scope: "persistent_policy",
      },
      {
        id: "n",
        decision: "decline",
        label: "Refuse",
        description: "Does not run",
        scope: "none",
      },
      {
        id: "o",
        decision: "accept",
        label: "Once",
        description: "Only this command",
        scope: "once",
      },
    ];
    const html = render(value);
    expect(html).toContain("Persists allow exact command");
    expect(html).toContain("Updates saved policy. Review the full rule above.");
    const actions = html.slice(html.indexOf('class="attention-actions'));
    expect(actions.indexOf("Update exact policy")).toBeLessThan(
      actions.indexOf("Refuse"),
    );
    expect(actions.indexOf("Refuse")).toBeLessThan(actions.indexOf("Once"));
    expect(actions).not.toContain("Approve for session");
  });
  it("does not copy a secret answer from the Task-level answer owner into markup", () => {
    const value = entry("user_input");
    value.questions = [
      {
        id: "token",
        header: "Token",
        question: "Enter token",
        isOther: true,
        isSecret: true,
        options: null,
      },
    ];
    const request = customerTaskCollaboration(task, [value]).request!;
    const html = renderToStaticMarkup(
      <TaskDecisionSurface
        entry={value}
        request={request}
        submitting={false}
        answers={{ token: ["fixture-secret-must-not-render"] }}
        form={{}}
        onAnswer={() => {}}
        onForm={() => {}}
        onRespond={() => {}}
        onExternal={async () => {}}
        onFocusDeparture={() => {}}
      />,
    );
    expect(html).toContain('type="password"');
    expect(html).not.toContain("fixture-secret-must-not-render");
  });
  it("rejects missing input and unavailable answers before dispatch without echoing values", () => {
    const value = entry("user_input");
    value.questions = [
      {
        id: "q",
        header: "Audience",
        question: "Choose audience",
        isOther: false,
        isSecret: false,
        options: [{ label: "Team", description: "Details" }],
      },
    ];
    expect(decisionValidation(value, {}, {})).toHaveLength(1);
    expect(decisionValidation(value, { q: ["invalid-secret"] }, {})).toEqual([
      { id: "q", message: "Choose or enter an answer for Audience." },
    ]);
    expect(decisionValidation(value, { q: ["Team"] }, {})).toEqual([]);
  });
  it("validates required/default, integer limits, exact option values and bounded multiple selection", () => {
    const value = entry("mcp_elicitation");
    value.elicitation = {
      mode: "form",
      message: "Fill in",
      fields: [
        {
          id: "mail",
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
          default: 2,
          required: true,
        },
        {
          id: "kind",
          title: "Kind",
          type: "single_select",
          options: [{ value: "exact", label: "Friendly" }],
          required: true,
        },
        {
          id: "tags",
          title: "Tags",
          type: "multi_select",
          options: [{ value: "one", label: "One" }],
          minItems: 1,
          maxItems: 1,
          required: true,
        },
      ],
    };
    expect(
      decisionValidation(
        value,
        {},
        { mail: "bad", count: 1.5, kind: "Friendly", tags: ["one", "one"] },
      ),
    ).toHaveLength(4);
    expect(
      decisionValidation(
        value,
        {},
        { mail: "fixture@example.test", kind: "exact", tags: ["one"] },
      ),
    ).toEqual([]);
  });
  it("preserves provider-valid empty string defaults and exact empty option values", () => {
    const value = entry("mcp_elicitation");
    value.elicitation = {
      mode: "form",
      message: "Fill in",
      fields: [
        {
          id: "text",
          title: "Text",
          type: "string",
          required: true,
          default: "",
        },
        {
          id: "option",
          title: "Option",
          type: "single_select",
          required: true,
          options: [{ value: "", label: "Empty exact value" }],
          default: "",
        },
      ],
    };
    expect(decisionValidation(value, {}, {})).toEqual([]);
    expect(render(value)).toContain("Empty exact value");
  });
});
