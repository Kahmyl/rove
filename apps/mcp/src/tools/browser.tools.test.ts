import { describe, expect, it, vi } from "vitest";

import type { RuntimeClient } from "../runtime/runtime-client.types.js";

import { browserTools } from "./browser.tools.js";

function record(value: unknown): Record<string, unknown> {
  expect(typeof value).toBe("object");

  expect(value).not.toBeNull();

  expect(Array.isArray(value)).toBe(false);

  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  expect(Array.isArray(value)).toBe(true);

  return value as unknown[];
}

function schemaVariant(
  variants: unknown[],
  kind: string,
): Record<string, unknown> {
  const match = variants.find((candidate) => {
    const properties = record(record(candidate).properties);

    const kindSchema = record(properties.kind ?? properties.verification);

    return kindSchema.const === kind;
  });

  expect(match).toBeDefined();

  return record(match);
}

describe("browser.interact MCP schema", () => {
  it("exposes one contextual target-mutation surface", () => {
    const names = browserTools({} as RuntimeClient).map((tool) => tool.name);

    expect(names).toContain("browser.interact");
    expect(names).not.toContain("browser.click");
    expect(names).not.toContain("browser.type");
    expect(names).not.toContain("browser.press");
    expect(names).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/focused/i),
        expect.stringMatching(/canonical/i),
      ]),
    );
  });

  it("advertises action-specific required fields", () => {
    const tool = browserTools({} as RuntimeClient).find(
      (candidate) => candidate.name === "browser.interact",
    );

    expect(tool).toBeDefined();

    const properties = record(tool!.inputSchema.properties);

    const action = record(properties.action);

    const variants = array(action.oneOf);

    expect(variants).toHaveLength(21);

    expect(schemaVariant(variants, "fill").required).toEqual([
      "kind",
      "target",
      "value",
    ]);
    expect(tool!.description).toContain("fresh grounded observation");

    expect(schemaVariant(variants, "drag").required).toEqual([
      "kind",
      "target",
      "destination",
    ]);

    expect(schemaVariant(variants, "modified_click").required).toEqual([
      "kind",
      "target",
      "modifiers",
    ]);

    expect(schemaVariant(variants, "type_sequential").required).toEqual([
      "kind",
      "target",
      "value",
    ]);

    expect(schemaVariant(variants, "clipboard").required).toEqual([
      "kind",
      "operation",
    ]);

    expect(schemaVariant(variants, "precise_scroll").required).toEqual([
      "kind",
      "deltaX",
      "deltaY",
    ]);

    expect(schemaVariant(variants, "coordinate_click").required).toEqual([
      "kind",
      "target",
      "observationId",
      "offsetX",
      "offsetY",
    ]);
  });

  it("advertises the bounded semantic outcome union", () => {
    const tool = browserTools({} as RuntimeClient).find(
      (candidate) => candidate.name === "browser.interact",
    );

    expect(tool).toBeDefined();

    const properties = record(tool!.inputSchema.properties);

    expect(properties).not.toHaveProperty("expectedEffects");
    const outcomes = record(properties.outcomes);

    const outcomeSchema = record(outcomes.items);

    const variants = array(outcomeSchema.oneOf);

    expect(variants).toHaveLength(10);

    expect(schemaVariant(variants, "download").required).toEqual(["kind"]);
    expect(
      record(record(schemaVariant(variants, "download").properties).filename)
        .maxLength,
    ).toBe(500);
    expect(schemaVariant(variants, "download").description).toContain(
      "Omit filename when discovering or reporting",
    );
    expect(schemaVariant(variants, "page").required).toEqual(["kind", "state"]);
    expect(schemaVariant(variants, "selection").required).toEqual([
      "kind",
      "target",
      "value",
    ]);
    expect(schemaVariant(variants, "target_location").required).toEqual([
      "kind",
      "target",
      "relation",
      "scope",
    ]);
    expect(tool!.description).toContain("desired user-visible outcomes");
    expect(tool!.description).toContain("Runtime chooses");
    expect(tool!.description).not.toMatch(
      /expectedEffects|canonical|focused|text_present|url_changed/,
    );
  });

  it("keeps every production browser tool free of blanket rejection stop wording", () => {
    const tools = browserTools({} as RuntimeClient).filter((tool) =>
      tool.name.startsWith("browser."),
    );

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.description).not.toMatch(
        /(?:a rejected (?:Rove |tool )?operation|tool rejection).{0,160}(?:hard|stop) boundar/i,
      );
    }

    const inspect = tools.find((tool) => tool.name === "browser.inspect");
    expect(inspect?.description).toContain(
      "permits a fresh inspect/re-ground/continue sequence",
    );
    expect(inspect?.description).toContain("explicitly retryable read-only");
    expect(inspect?.description).toContain("choose another safe Rove route");
  });

  it("advertises the stable consequence-key requirement", () => {
    const tool = browserTools({} as RuntimeClient).find(
      (candidate) => candidate.name === "browser.interact",
    );

    expect(tool).toBeDefined();

    const allOf = array(tool!.inputSchema.allOf);

    expect(record(tool!.inputSchema.properties)).not.toHaveProperty(
      "repeatAuthorization",
    );
    expect(tool!.inputSchema.additionalProperties).toBe(false);

    expect(allOf).toHaveLength(1);

    const conditional = record(allOf[0]);

    expect(record(conditional.then).required).toEqual(["consequenceKey"]);
  });

  it("forwards the exact task-result authorization digest to Runtime", async () => {
    const authorizationDigest = "a".repeat(64);
    const consequenceKey = `task-result:result_01:${authorizationDigest}`;
    const authorizedPlanId = `plan_${"b".repeat(32)}`;
    const runtime = {
      interact: vi.fn().mockResolvedValue({}),
      consequentialEffect: vi.fn().mockResolvedValue({
        state: "authorized",
        taskResultPlan: {
          planId: authorizedPlanId,
          materialDigest: authorizationDigest,
          expectedEffects: [{ kind: "url_changed" }],
        },
      }),
    } as unknown as RuntimeClient;
    const interact = browserTools(runtime).find(
      (tool) => tool.name === "browser.interact",
    )!;
    expect(record(interact.inputSchema.properties)).toHaveProperty(
      "authorizationDigest",
    );
    await interact.handler({
      sessionId: `ses_${"b".repeat(32)}`,
      observationId: "bobs_current",
      action: {
        kind: "click",
        target: { pageId: "page_01", revision: 1, ref: "t1" },
      },
      consequential: true,
      effect: "external_commit",
      consequenceKey,
      authorizationDigest,
      authorizedPlanId,
    });

    expect(runtime.interact).toHaveBeenCalledWith(
      `ses_${"b".repeat(32)}`,
      expect.objectContaining({
        consequenceKey,
        authorizationDigest,
        authorizedPlanId,
        expectedEffects: [{ kind: "url_changed" }],
      }),
    );
    expect(runtime.consequentialEffect).toHaveBeenCalledWith(
      `ses_${"b".repeat(32)}`,
      consequenceKey,
    );
  });

  it("requires Runtime recovery admission before each retried browser operation", async () => {
    let attempts = 0;
    const runtime = {
      admitBrowserRecovery: vi.fn(async () => {
        attempts += 1;
        if (attempts > 2)
          throw new Error("Browser recovery stopped after two attempts.");
        return { admittedAttempt: attempts, remainingAttempts: 2 - attempts };
      }),
      navigate: vi.fn().mockResolvedValue({}),
    } as unknown as RuntimeClient;
    const navigate = browserTools(runtime).find(
      (tool) => tool.name === "browser.navigate",
    )!;
    const input = {
      sessionId: `ses_${"e".repeat(32)}`,
      url: "https://example.test/reviewed",
      recovery: {
        operationId: "recovery-reviewed-navigation",
        kind: "read_only_outcome",
        consequentialOutcome: "completed",
      },
    };
    await expect(navigate.handler(input)).resolves.toEqual({});
    await expect(navigate.handler(input)).resolves.toEqual({});
    await expect(navigate.handler(input)).rejects.toThrow(
      /stopped after two attempts/i,
    );
    expect(runtime.admitBrowserRecovery).toHaveBeenCalledTimes(3);
    expect(runtime.navigate).toHaveBeenCalledTimes(2);
  });

  it("prepares and reads a concrete task-result plan without dispatching", async () => {
    const runtime = {
      prepareTaskResultAction: vi.fn().mockResolvedValue({
        planId: `plan_${"a".repeat(32)}`,
        expectedEffects: [{ kind: "url_changed" }],
      }),
      consequentialEffect: vi.fn().mockResolvedValue({
        state: "planned",
        taskResultPlan: {
          planId: `plan_${"a".repeat(32)}`,
          expectedEffects: [{ kind: "url_changed" }],
        },
      }),
    } as unknown as RuntimeClient;
    const tools = browserTools(runtime);
    const prepare = tools.find(
      (tool) => tool.name === "browser.prepare_task_result_action",
    )!;
    const status = tools.find(
      (tool) => tool.name === "browser.task_result_action_plan",
    )!;
    const prepareProperties = record(prepare.inputSchema.properties);
    expect(prepareProperties).toHaveProperty("outcomes");
    expect(prepareProperties).not.toHaveProperty("expectedEffects");
    const sessionId = `ses_${"c".repeat(32)}`;
    const materialDigest = "d".repeat(64);
    const consequenceKey = `task-result:result_1:${materialDigest}`;
    const request = {
      observationId: "bobs_plan",
      consequenceKey,
      materialDigest,
      fieldBindings: [{ field: "content", targetRef: "notes" }],
      attachmentBindings: [],
      commitAction: {
        kind: "click",
        target: { pageId: "page_1", revision: 3, ref: "send" },
      },
      outcomes: [{ kind: "url", state: "changed" }],
      effect: "external_commit",
    };

    const preparedPlan = record(
      await prepare.handler({ sessionId, ...request }),
    );
    const agentStatus = record(
      await status.handler({ sessionId, consequenceKey }),
    );
    expect(runtime.prepareTaskResultAction).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        observationId: request.observationId,
        consequenceKey,
        commitAction: request.commitAction,
        expectedEffects: [{ kind: "url_changed" }],
      }),
    );
    expect(
      record(
        (runtime.prepareTaskResultAction as ReturnType<typeof vi.fn>).mock
          .calls[0]![1],
      ),
    ).not.toHaveProperty("outcomes");
    expect(runtime.consequentialEffect).toHaveBeenCalledWith(
      sessionId,
      consequenceKey,
    );
    expect(record(agentStatus.taskResultPlan)).not.toHaveProperty(
      "expectedEffects",
    );
    expect(preparedPlan).not.toHaveProperty("expectedEffects");
  });

  it("rejects unsupported and duplicate download expectations before Runtime", async () => {
    const runtime = { interact: vi.fn() } as unknown as RuntimeClient;
    const interact = browserTools(runtime).find(
      (tool) => tool.name === "browser.interact",
    )!;
    const base = {
      sessionId: `ses_${"a".repeat(32)}`,
      observationId: "bobs_current",
      action: {
        kind: "click",
        target: { pageId: "page_01", revision: 1, ref: "t1" },
      },
    };

    await expect(
      interact.handler({
        ...base,
        action: {
          kind: "press",
          target: base.action.target,
          key: "Enter",
        },
        outcomes: [{ kind: "download" }],
      }),
    ).rejects.toThrow(/requires a grounded click action/);
    await expect(
      interact.handler({
        ...base,
        outcomes: [
          { kind: "download" },
          { kind: "download", filename: "second.pdf" },
        ],
      }),
    ).rejects.toThrow(/at most one download_completed/);
    expect(runtime.interact).not.toHaveBeenCalled();
  });

  it("routes a visible-text outcome into Runtime focused text escalation", async () => {
    const runtime = {
      interact: vi.fn().mockResolvedValue({ outcome: "applied" }),
    } as unknown as RuntimeClient;
    const interact = browserTools(runtime).find(
      (tool) => tool.name === "browser.interact",
    )!;

    await expect(
      interact.handler({
        sessionId: `ses_${"a".repeat(32)}`,
        observationId: "bobs_truncated",
        action: {
          kind: "click",
          target: { pageId: "page_01", revision: 1, ref: "save" },
        },
        outcomes: [{ kind: "visible_text", state: "present", text: "Saved" }],
        consequential: true,
        effect: "external_commit",
        consequenceKey: "save:document:1",
      }),
    ).resolves.toEqual({ outcome: "applied" });
    expect(runtime.interact).toHaveBeenCalledWith(
      `ses_${"a".repeat(32)}`,
      expect.objectContaining({
        expectedEffects: [{ kind: "text_present", text: "Saved" }],
      }),
    );
  });

  it("rejects consequential interactions without a usable outcome before Runtime", () => {
    const runtime = { interact: vi.fn() } as unknown as RuntimeClient;
    const interact = browserTools(runtime).find(
      (tool) => tool.name === "browser.interact",
    )!;

    expect(() =>
      interact.handler({
        sessionId: `ses_${"a".repeat(32)}`,
        observationId: "bobs_current",
        action: {
          kind: "click",
          target: { pageId: "page_01", revision: 1, ref: "t1" },
        },
        consequential: true,
        effect: "external_commit",
        consequenceKey: "publish:article:1",
      }),
    ).toThrow(/require at least one semantic outcome/i);
    expect(runtime.interact).not.toHaveBeenCalled();
  });

  it("does not let a task-result commit resupply its authorized outcomes", () => {
    const runtime = {
      interact: vi.fn(),
      consequentialEffect: vi.fn(),
    } as unknown as RuntimeClient;
    const interact = browserTools(runtime).find(
      (tool) => tool.name === "browser.interact",
    )!;
    const digest = "a".repeat(64);

    expect(() =>
      interact.handler({
        sessionId: `ses_${"a".repeat(32)}`,
        observationId: "bobs_current",
        action: {
          kind: "click",
          target: { pageId: "page_01", revision: 1, ref: "t1" },
        },
        outcomes: [{ kind: "url", state: "changed" }],
        consequential: true,
        effect: "external_commit",
        consequenceKey: `task-result:result_1:${digest}`,
        authorizationDigest: digest,
        authorizedPlanId: `plan_${"b".repeat(32)}`,
      }),
    ).toThrow(/authorized plan outcomes/i);
    expect(runtime.consequentialEffect).not.toHaveBeenCalled();
    expect(runtime.interact).not.toHaveBeenCalled();
  });
});

describe("browser.resolve_target MCP schema", () => {
  it("publishes exact target-kind grounding and named-link navigation guidance", () => {
    const tool = browserTools({} as RuntimeClient).find(
      (candidate) => candidate.name === "browser.resolve_target",
    )!;
    const intent = record(record(tool.inputSchema.properties).intent);
    const kind = record(record(intent.properties).kind);
    expect(array(kind.enum)).toContain("link");
    expect(tool.description).toContain('kind:"link"');
    expect(tool.description).toContain("same-named row or gridcell");
  });
});

describe("browser.inspect MCP projection", () => {
  it("distinguishes diagnostic subresource failures from required-path failures", () => {
    const inspect = browserTools({} as RuntimeClient).find(
      (tool) => tool.name === "browser.inspect",
    )!;

    expect(inspect.description).toContain(
      "Diagnostic browserEvidence entries alone are not required-path failures.",
    );
    expect(inspect.description).toContain(
      "When the main document succeeds and pageState is ready",
    );
    expect(inspect.description).toContain(
      "unrelated non-main-frame or subresource failures are diagnostic only",
    );
    expect(inspect.description).toContain(
      "unless evidence shows they prevented a required target or outcome",
    );
    expect(inspect.description).toContain(
      "unknown or uncertain consequential outcome remain hard boundaries",
    );
    expect(inspect.description).not.toContain("Google");
    expect(inspect.description).not.toContain("status-code allowlist");
    expect(inspect.description).not.toContain("ignore errors");
  });

  it("keeps page semantics observational and withholds the legacy page-wide mutation verdict", async () => {
    const runtime = {
      inspect: vi.fn(async () => ({
        pageId: "page_1",
        revision: 7,
        url: "https://fixture.invalid/rename",
        title: "Rename",
        metadata: {
          pageState: {
            kind: "unknown_interstitial",
            confidence: "medium",
            signals: ["interstitial:blocking_unknown_surface"],
          },
          pageStatePropositions: {
            primaryContentAvailable: false,
            documentUnstable: false,
            authenticationRequired: false,
            humanVerificationPresented: false,
            accessRestricted: false,
            errorPresented: false,
            interstitialPresented: true,
          },
          pagePolicy: {
            disposition: "stop",
            reason: "unknown_interstitial",
            mutationAllowed: false,
          },
        },
      })),
    } as unknown as RuntimeClient;
    const inspect = browserTools(runtime).find(
      (tool) => tool.name === "browser.inspect",
    )!;

    const result = record(await inspect.handler({ sessionId: "session_1" }));
    const metadata = record(result.metadata);

    expect(metadata).not.toHaveProperty("pagePolicy");
    expect(metadata).toMatchObject({
      pageState: { kind: "unknown_interstitial" },
      actionAuthority: {
        model: "contextual_per_action",
        pageStateIsEvidence: true,
        mutationDecision: "deferred_until_action",
        interactionTool: "browser.interact",
      },
    });
  });
});

describe("browser semantic transaction MCP tools", () => {
  it("advertises the explicit begin, advance, verify, status, and cancel lifecycle", () => {
    const tools = browserTools({} as RuntimeClient);
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "browser.transaction_begin",
        "browser.transaction_advance",
        "browser.transaction_verify",
        "browser.transaction_status",
        "browser.transaction_cancel",
      ]),
    );

    const begin = tools.find(
      (tool) => tool.name === "browser.transaction_begin",
    )!;
    const destination = record(
      record(begin.inputSchema.properties).destination,
    );
    const destinationVariants = array(destination.oneOf);
    expect(schemaVariant(destinationVariants, "within_scope").required).toEqual(
      ["verification", "scope"],
    );
    expect(
      schemaVariant(destinationVariants, "destination_observation").required,
    ).toEqual(["verification", "label"]);

    const advance = tools.find(
      (tool) => tool.name === "browser.transaction_advance",
    )!;
    const effects = record(
      record(advance.inputSchema.properties).expectedEffects,
    );
    expect(effects).toMatchObject({ minItems: 0, maxItems: 20 });
  });

  it("validates and forwards semantic transaction requests", async () => {
    const runtime = {
      beginSemanticTransaction: vi.fn(async () => ({ status: "prepared" })),
      advanceSemanticTransaction: vi.fn(async () => ({
        transaction: { status: "committed" },
      })),
      verifySemanticTransaction: vi.fn(async () => ({ outcome: "applied" })),
      getSemanticTransaction: vi.fn(async () => ({ status: "verified" })),
      cancelSemanticTransaction: vi.fn(async () => ({ status: "cancelled" })),
    } as unknown as RuntimeClient;
    const tools = new Map(
      browserTools(runtime).map((tool) => [tool.name, tool.handler]),
    );
    const sourceTarget = { pageId: "page_1", revision: 1, ref: "t1" };

    await tools.get("browser.transaction_begin")!({
      sessionId: "session_1",
      observationId: "bobs_1",
      kind: "transfer",
      sourceTarget,
      destination: {
        verification: "destination_observation",
        label: "Archive",
      },
      mechanism: "menu",
      consequenceKey: "move:report:archive",
    });
    await tools.get("browser.transaction_advance")!({
      sessionId: "session_1",
      transactionId: "tx_1",
      observationId: "bobs_2",
      phase: "commit",
      action: { kind: "click", target: sourceTarget },
      expectedEffects: [{ kind: "text_present", text: "Moved" }],
    });
    await tools.get("browser.transaction_verify")!({
      sessionId: "session_1",
      transactionId: "tx_1",
      observationId: "bobs_3",
    });
    await tools.get("browser.transaction_status")!({
      sessionId: "session_1",
      transactionId: "tx_1",
    });
    await tools.get("browser.transaction_cancel")!({
      sessionId: "session_1",
      transactionId: "tx_1",
    });

    expect(runtime.beginSemanticTransaction).toHaveBeenCalledWith(
      "session_1",
      expect.objectContaining({ consequenceKey: "move:report:archive" }),
    );
    expect(runtime.advanceSemanticTransaction).toHaveBeenCalledWith(
      "session_1",
      expect.objectContaining({ phase: "commit" }),
    );
    expect(runtime.verifySemanticTransaction).toHaveBeenCalledWith(
      "session_1",
      expect.objectContaining({ observationId: "bobs_3" }),
    );
    expect(runtime.getSemanticTransaction).toHaveBeenCalledWith(
      "session_1",
      "tx_1",
    );
    expect(runtime.cancelSemanticTransaction).toHaveBeenCalledWith(
      "session_1",
      "tx_1",
    );
  });
});

describe("browser page lifecycle MCP tools", () => {
  it("advertises explicit open, list, switch, and close operations", () => {
    const names = browserTools({} as RuntimeClient).map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "browser.open_page",
        "browser.pages",
        "browser.switch_page",
        "browser.close_page",
      ]),
    );
  });
});
