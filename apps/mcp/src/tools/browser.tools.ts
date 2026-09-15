import {
  inspectOptionsSchema,
  navigateRequestSchema,
  screenshotRequestSchema,
  scrollRequestSchema,
  targetResolutionRequestSchema,
  verifiedInteractionRequestSchema,
  advanceSemanticTransactionRequestSchema,
  beginSemanticTransactionRequestSchema,
  semanticTransactionReferenceSchema,
  verifySemanticTransactionRequestSchema,
  prepareTaskResultActionRequestSchema,
  browserRecoveryAdmissionRequestSchema,
} from "@rove/protocol";
import type { PageInspection } from "@rove/protocol";
import { z } from "zod";
import type { RuntimeClient } from "../runtime/runtime-client.types.js";
import type { ToolDefinition } from "../server/register-tools.js";
import { toolSuccessWithImage } from "../server/tool-result.js";
import {
  sessionIdJsonSchema,
  sessionIdSchema,
  targetJsonSchema,
  targetSchema,
} from "./schemas.js";

const browserRecoveryJsonSchema = {
  type: "object",
  properties: {
    operationId: { type: "string", minLength: 1, maxLength: 160 },
    kind: { type: "string", enum: ["freshness", "read_only_outcome"] },
    consequentialOutcome: {
      type: "string",
      enum: ["not_dispatched", "completed", "unknown"],
    },
  },
  required: ["operationId", "kind", "consequentialOutcome"],
  additionalProperties: false,
} as const;

function afterRecoveryAdmission<T>(
  runtime: RuntimeClient,
  sessionId: string,
  recovery:
    ReturnType<typeof browserRecoveryAdmissionRequestSchema.parse> | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!recovery) return operation();
  if (!runtime.admitBrowserRecovery)
    return Promise.reject(
      new Error("Runtime browser recovery admission is unavailable."),
    );
  return runtime
    .admitBrowserRecovery(sessionId, recovery)
    .then(() => operation());
}

const dialogDirectiveJsonSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        action: {
          const: "dismiss",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        action: {
          const: "accept",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        action: {
          const: "accept_prompt",
        },
        value: {
          type: "string",
          maxLength: 10000,
        },
      },
      required: ["action", "value"],
      additionalProperties: false,
    },
  ],
} as const;

const browserInteractionActionJsonSchema = {
  oneOf: [
    ...[
      "click",
      "double_click",
      "secondary_click",
      "hover",
      "focus",
      "blur",
      "clear",
      "select_text",
      "check",
      "uncheck",
    ].map((kind) => ({
      type: "object",
      properties: {
        kind: {
          const: kind,
        },
        target: targetJsonSchema,
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "target"],
      additionalProperties: false,
    })),
    {
      type: "object",
      properties: {
        kind: { const: "modified_click" },
        target: targetJsonSchema,
        modifiers: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: { type: "string", enum: ["Alt", "Control", "Meta", "Shift"] },
        },
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "target", "modifiers"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "press" },
        target: targetJsonSchema,
        key: { type: "string", minLength: 1, maxLength: 100 },
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "key"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "type_sequential" },
        target: targetJsonSchema,
        value: { type: "string", maxLength: 100000 },
        delayMs: { type: "integer", minimum: 0, maximum: 1000 },
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "target", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: {
          const: "fill",
        },
        target: targetJsonSchema,
        value: {
          type: "string",
          maxLength: 100000,
        },
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "target", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: {
          const: "select",
        },
        target: targetJsonSchema,
        values: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "string",
            maxLength: 5000,
          },
        },
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "target", "values"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: {
          const: "drag",
        },
        target: targetJsonSchema,
        destination: targetJsonSchema,
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "target", "destination"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: {
          const: "upload",
        },
        target: targetJsonSchema,
        evidenceId: {
          type: "string",
          pattern: "^ev_",
          description:
            "Existing Rove file-artifact ID containing the upload bytes. Host filesystem paths are not accepted.",
        },
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "target", "evidenceId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "upload" },
        target: targetJsonSchema,
        evidenceIds: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "string",
            pattern: "^ev_",
            description:
              "Existing Rove file-artifact ID containing upload bytes.",
          },
        },
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "target", "evidenceIds"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "clipboard" },
        target: targetJsonSchema,
        operation: { type: "string", enum: ["copy", "cut", "paste"] },
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "operation"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: {
          const: "precise_scroll",
        },
        target: targetJsonSchema,
        deltaX: {
          type: "number",
          minimum: -100000,
          maximum: 100000,
        },
        deltaY: {
          type: "number",
          minimum: -100000,
          maximum: 100000,
        },
      },
      required: ["kind", "deltaX", "deltaY"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: {
          const: "coordinate_click",
        },
        target: targetJsonSchema,
        observationId: {
          type: "string",
          minLength: 1,
          maxLength: 200,
        },
        offsetX: {
          type: "number",
        },
        offsetY: {
          type: "number",
        },
        dialog: dialogDirectiveJsonSchema,
      },
      required: ["kind", "target", "observationId", "offsetX", "offsetY"],
      additionalProperties: false,
    },
  ],
} as const;

const expectedTargetJsonSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 500,
    },
    kind: {
      type: "string",
      enum: [
        "button",
        "link",
        "input",
        "textarea",
        "select",
        "checkbox",
        "radio",
        "tab",
        "menuitem",
        "menuitemcheckbox",
        "menuitemradio",
        "option",
        "switch",
        "combobox",
        "listbox",
        "slider",
        "spinbutton",
        "treeitem",
        "gridcell",
        "row",
        "disclosure",
        "media",
        "control",
      ],
    },
  },
  required: ["name"],
  additionalProperties: false,
} as const;

const structuralScopeJsonSchema = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: [
        "form",
        "dialog",
        "card",
        "row",
        "region",
        "group",
        "list",
        "listbox",
        "tree",
        "grid",
        "table",
        "menu",
      ],
    },
    label: { type: "string", maxLength: 500 },
  },
  required: ["kind"],
  additionalProperties: false,
} as const;

const namedStructuralScopeJsonSchema = {
  ...structuralScopeJsonSchema,
  required: ["kind", "label"],
} as const;

const semanticTransactionDestinationJsonSchema = {
  oneOf: [
    {
      type: "object",
      description:
        "A destination rendered in the same final observation; verification requires the source target within this exact semantic scope.",
      properties: {
        verification: { const: "within_scope" },
        scope: namedStructuralScopeJsonSchema,
      },
      required: ["verification", "scope"],
      additionalProperties: false,
    },
    {
      type: "object",
      description:
        "A remote destination that must be opened after commit; verification requires the exact source target plus independent destination context in the fresh destination observation.",
      properties: {
        verification: { const: "destination_observation" },
        label: { type: "string", minLength: 1, maxLength: 500 },
      },
      required: ["verification", "label"],
      additionalProperties: false,
    },
  ],
} as const;

const expectedEffectJsonSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: {
          const: "url_equals",
        },
        url: {
          type: "string",
          format: "uri",
        },
      },
      required: ["kind", "url"],
      additionalProperties: false,
    },
    ...["target_within_scope", "target_outside_scope"].map((kind) => ({
      type: "object",
      properties: {
        kind: { const: kind },
        target: expectedTargetJsonSchema,
        scope: structuralScopeJsonSchema,
      },
      required: ["kind", "target", "scope"],
      additionalProperties: false,
    })),
    {
      type: "object",
      properties: {
        kind: {
          const: "url_changed",
        },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    ...["text_present", "text_absent"].map((kind) => ({
      type: "object",
      description:
        kind === "text_absent"
          ? "Page-wide visible-text absence. Do not use this to prove an entity was renamed or removed when activity, history, toasts, or audit UI may legitimately retain the old text; use an exact target absence or scoped target effect instead."
          : "Page-wide visible-text presence. Prefer an exact target or scoped target effect when the workflow outcome belongs to a specific entity or collection.",
      properties: {
        kind: {
          const: kind,
        },
        text: {
          type: "string",
          minLength: 1,
          maxLength: 5000,
        },
      },
      required: ["kind", "text"],
      additionalProperties: false,
    })),
    ...[
      "target_present",
      "target_absent",
      "target_enabled",
      "target_disabled",
      "target_checked",
      "target_unchecked",
      "target_focused",
      "target_blurred",
      "target_expanded",
      "target_collapsed",
      "target_pressed",
      "target_unpressed",
      "target_selected",
      "target_unselected",
      "target_open",
      "target_closed",
    ].map((kind) => ({
      type: "object",
      description:
        kind === "target_absent"
          ? "Exact semantic target absence. Use this instead of page-wide text_absent when proving an old entity name is no longer present as a control or row."
          : undefined,
      properties: {
        kind: {
          const: kind,
        },
        target: expectedTargetJsonSchema,
      },
      required: ["kind", "target"],
      additionalProperties: false,
    })),
    {
      type: "object",
      properties: {
        kind: { const: "target_value" },
        target: expectedTargetJsonSchema,
        value: { type: "string", maxLength: 100000 },
      },
      required: ["kind", "target", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "target_numeric_value" },
        target: expectedTargetJsonSchema,
        value: { type: "number" },
      },
      required: ["kind", "target", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: {
          const: "selected_value",
        },
        target: expectedTargetJsonSchema,
        value: {
          type: "string",
          maxLength: 5000,
        },
      },
      required: ["kind", "target", "value"],
      additionalProperties: false,
    },
    ...["page_opened", "page_closed"].map((kind) => ({
      type: "object",
      properties: {
        kind: {
          const: kind,
        },
      },
      required: ["kind"],
      additionalProperties: false,
    })),
    {
      type: "object",
      description:
        "A new managed download initiated by this action and persisted as Runtime file evidence. Omit filename when discovering or reporting the actual saved filename; include it only when the user explicitly requires the saved artifact to equal that exact predeclared name. Browser collision suffixes are valid completed downloads when filename is omitted, and the actual filename must come from durable evidence. An exact-name mismatch is not_applied and must never trigger a second download.",
      properties: {
        kind: { const: "download_completed" },
        filename: { type: "string", minLength: 1, maxLength: 500 },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  ],
} as const;

function inspectionForAgent(inspection: PageInspection): PageInspection {
  const observationalMetadata = { ...(inspection.metadata ?? {}) };
  delete observationalMetadata.pagePolicy;

  return {
    ...inspection,
    metadata: {
      ...observationalMetadata,
      actionAuthority: {
        model: "contextual_per_action",
        pageStateIsEvidence: true,
        mutationDecision: "deferred_until_action",
        interactionTool: "browser.interact",
      },
    },
  };
}

export function browserTools(runtime: RuntimeClient): ToolDefinition[] {
  return [
    {
      name: "browser.resolve_target",
      description:
        'Resolve an intended browser control against one exact current BrowserObservation. kind is an exact constraint: when navigation is intended for a named link, request kind:"link" and require URL-change evidence rather than selecting a same-named row or gridcell. Capabilities describe the target itself: for an indirect mechanism such as a button or menu item that opens a dynamic file chooser, resolve the trigger by its advertised activate capability plus exact text/scope, then pass that grounded target to browser.interact with an upload action. Direct file inputs advertise upload. Returns selected, ambiguous, or unresolved grounding and never bypasses the existing TargetReference authority.',
      inputSchema: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            minLength: 1,
          },
          observationId: {
            type: "string",
            minLength: 1,
            maxLength: 200,
          },
          intent: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: [
                  "button",
                  "link",
                  "input",
                  "textarea",
                  "select",
                  "checkbox",
                  "radio",
                  "tab",
                  "menuitem",
                  "menuitemcheckbox",
                  "menuitemradio",
                  "option",
                  "switch",
                  "combobox",
                  "listbox",
                  "slider",
                  "spinbutton",
                  "treeitem",
                  "gridcell",
                  "row",
                  "disclosure",
                  "media",
                  "control",
                ],
              },
              capability: {
                type: "string",
                enum: [
                  "activate",
                  "double_activate",
                  "secondary_activate",
                  "fill",
                  "set_value",
                  "select",
                  "select_text",
                  "check",
                  "uncheck",
                  "expand",
                  "collapse",
                  "focus",
                  "press",
                  "clipboard",
                  "hover",
                  "drag",
                  "upload",
                  "scroll",
                ],
              },
              text: {
                type: "string",
                minLength: 1,
                maxLength: 500,
              },
              scope: {
                type: "object",
                properties: {
                  kind: {
                    type: "string",
                    enum: [
                      "form",
                      "dialog",
                      "card",
                      "row",
                      "region",
                      "group",
                      "list",
                      "listbox",
                      "tree",
                      "grid",
                      "table",
                      "menu",
                    ],
                  },
                  label: {
                    type: "string",
                    maxLength: 500,
                  },
                },
                required: ["kind"],
                additionalProperties: false,
              },
              frameLabel: {
                type: "string",
                minLength: 1,
                maxLength: 500,
              },
            },
            additionalProperties: false,
          },
        },
        required: ["sessionId", "observationId", "intent"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            observationId: z.string().min(1).max(200),
            intent: z.unknown(),
          })
          .parse(input);

        return runtime.resolveTarget(
          parsed.sessionId,
          targetResolutionRequestSchema.parse({
            observationId: parsed.observationId,
            intent: parsed.intent,
          }),
        );
      },
    },
    {
      name: "browser.prepare_task_result_action",
      description:
        "Prepare, but do not dispatch, one concrete commit for a saved task-result action. First stage the exact recipient/content/files with ordinary grounded interactions. This call snapshots the current field values, immutable file evidence, commit target, expected effects, page revision, and action fingerprint. It remains non-dispatching until the Companion validates the plan against the user's saved authorization. Use browser.task_result_action_plan to observe authorization, then commit the unchanged plan once with browser.interact.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          observationId: { type: "string", minLength: 1, maxLength: 200 },
          consequenceKey: { type: "string", minLength: 1, maxLength: 500 },
          materialDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
          fieldBindings: {
            type: "array",
            maxItems: 2,
            items: {
              type: "object",
              properties: {
                field: { type: "string", enum: ["recipient", "content"] },
                targetRef: { type: "string", minLength: 1, maxLength: 200 },
              },
              required: ["field", "targetRef"],
              additionalProperties: false,
            },
          },
          attachmentBindings: {
            type: "array",
            maxItems: 64,
            items: {
              type: "object",
              properties: {
                evidenceId: { type: "string", pattern: "^ev_" },
                targetRef: { type: "string", minLength: 1, maxLength: 200 },
              },
              required: ["evidenceId", "targetRef"],
              additionalProperties: false,
            },
          },
          commitAction: browserInteractionActionJsonSchema,
          expectedEffects: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: expectedEffectJsonSchema,
          },
          effect: {
            type: "string",
            enum: ["external_commit", "irreversible"],
          },
        },
        required: [
          "sessionId",
          "observationId",
          "consequenceKey",
          "materialDigest",
          "fieldBindings",
          "attachmentBindings",
          "commitAction",
          "expectedEffects",
          "effect",
        ],
        additionalProperties: false,
      },
      handler: (input) => {
        const value = z
          .object({ sessionId: sessionIdSchema })
          .passthrough()
          .parse(input);
        const { sessionId, ...request } = value;
        return runtime.prepareTaskResultAction(
          sessionId,
          prepareTaskResultActionRequestSchema.parse(request),
        );
      },
    },
    {
      name: "browser.task_result_action_plan",
      description:
        "Read the durable state of an exact prepared task-result action plan. Commit only when state is authorized, using the returned planId unchanged. Planned means the Companion has not yet validated the concrete plan; prepared or unresolved means dispatch may have happened and must not be replayed.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          consequenceKey: { type: "string", minLength: 1, maxLength: 500 },
        },
        required: ["sessionId", "consequenceKey"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            consequenceKey: z.string().min(1).max(500),
          })
          .parse(input);
        return runtime.consequentialEffect(
          parsed.sessionId,
          parsed.consequenceKey,
        );
      },
    },
    {
      name: "browser.interact",
      description:
        'The single agent-facing tool for target-bound mutation. Put the target inside action, for example action:{kind:"fill",target:{pageId,revision,ref},value:"..."}; never put target beside action. Perform a grounded browser interaction, authorize its contextual effect, collect a successor observation, verify bounded expected effects, and return an ActionReceipt. If INVALID_INPUT or schema validation identifies an exact invalid path, a mechanically corrected request is allowed when the returned result proves the handler never ran and no effect was dispatched and fresh grounding supplies the correction; never replay an identical malformed request. A recoverable pre-dispatch freshness rejection does not end the task: inspect freshly, re-ground the current state, and continue with a safe newly grounded action or route. Every recovery retry must include recovery with one stable operationId; Runtime persists two admitted attempts and refuses the third. Unrelated dynamic DOM churn triggers automatic exact-target revalidation immediately before dispatch; navigation, viewport/scroll change, ownership change, target/frame/root replacement, target identity/state/geometry change, ambiguity, occlusion, or disabled/hidden state still rejects before dispatch. Coordinate actions retain strict whole-observation freshness. The receipt outcome is authoritative for the requested effect: applied means positive predecessor-to-successor evidence reconciled the action; an already-visible text, already-equal URL, or already-satisfied target state is not causal proof. For named-link navigation, resolve kind:"link" and use url_changed, an exact new url_equals, or a condition absent before and present after. unknown is the consequential stop/reconciliation boundary and must not be replayed. download_completed waits for a new action-correlated managed download persisted as Runtime file evidence. Omit its optional filename when the user\'s request is to discover, confirm, or report the actual saved filename; include filename only when the user explicitly requires the saved artifact to equal that exact predeclared name. A browser collision suffix is a valid completed download when filename is omitted, and the actual filename must be read from durable evidence. An exact-name mismatch is not_applied and must never cause a second download. A pageState such as unknown_interstitial is observational evidence, not a page-wide stop: ordinary dialogs and overlays may be handled when the exact current target is freshly grounded and the declared effect is authorized. Ignore optional survey or feedback cards after the requested outcome is proven. If one blocks a still-required target, dismiss it only with a freshly grounded nonconsequential action. Authentication, required consent, human verification, credentials, access restrictions, instability, confirmation requirements, Runtime refusal, and unknown consequential outcomes remain hard boundaries. Expected text_present/text_absent effects apply to the whole visible page; for rename, move, or removal outcomes where history/activity/toasts can retain old text, use exact target_present/target_absent or target-within-scope effects instead. Upload accepts either a direct file-input target that advertises upload or an exactly grounded activation target expected to open a dynamic file chooser; ground the latter by activate plus exact text/scope. External or irreversible actions must be marked consequential, include a stable consequenceKey, and include expected effects so Runtime can reconcile the outcome. A task-result commit additionally requires the exact authorizedPlanId and authorizationDigest returned by the concrete-plan status tool. Unknown consequential outcomes block replay of the same key.',
      inputSchema: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            minLength: 1,
          },
          observationId: {
            type: "string",
            minLength: 1,
            maxLength: 200,
          },
          action: browserInteractionActionJsonSchema,
          expectedEffects: {
            type: "array",
            maxItems: 20,
            items: expectedEffectJsonSchema,
          },
          consequential: {
            type: "boolean",
            default: false,
          },
          effect: {
            type: "string",
            enum: [
              "observe",
              "recover",
              "navigate",
              "reversible_ui",
              "edit_content",
              "external_commit",
              "irreversible",
              "credential_entry",
            ],
            description:
              "Contextual consequence of the proposed action. Runtime may raise this classification from grounded target facts but never lowers it.",
          },
          consequenceKey: {
            type: "string",
            minLength: 1,
            maxLength: 500,
          },
          authorizationDigest: {
            type: "string",
            pattern: "^[a-f0-9]{64}$",
            description:
              "Exact material digest registered by the host for a task-result action.",
          },
          authorizedPlanId: {
            type: "string",
            pattern: "^plan_[a-f0-9]{32}$",
            description:
              "Opaque Runtime plan identity authorized for this exact commit.",
          },
          recovery: browserRecoveryJsonSchema,
        },
        required: ["sessionId", "observationId", "action"],
        allOf: [
          {
            if: {
              properties: {
                consequential: {
                  const: true,
                },
              },
              required: ["consequential"],
            },
            then: {
              required: ["consequenceKey"],
            },
          },
        ],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            observationId: z.string().min(1).max(200),
            action: z.unknown(),
            expectedEffects: z
              .array(z.unknown())
              .max(20)
              .optional()
              .default([]),
            consequential: z.boolean().optional().default(false),
            effect: z
              .enum([
                "observe",
                "recover",
                "navigate",
                "reversible_ui",
                "edit_content",
                "external_commit",
                "irreversible",
                "credential_entry",
              ])
              .optional(),
            consequenceKey: z.string().min(1).max(500).optional(),
            authorizationDigest: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
            authorizedPlanId: z
              .string()
              .regex(/^plan_[a-f0-9]{32}$/)
              .optional(),
            recovery: browserRecoveryAdmissionRequestSchema.optional(),
          })
          .parse(input);

        return afterRecoveryAdmission(
          runtime,
          parsed.sessionId,
          parsed.recovery,
          () =>
            runtime.interact(
              parsed.sessionId,
              verifiedInteractionRequestSchema.parse({
                observationId: parsed.observationId,
                action: parsed.action,
                expectedEffects: parsed.expectedEffects,
                consequential: parsed.consequential,
                effect: parsed.effect,
                consequenceKey: parsed.consequenceKey,
                authorizationDigest: parsed.authorizationDigest,
                authorizedPlanId: parsed.authorizedPlanId,
              }),
            ),
        );
      },
    },
    {
      name: "browser.transaction_begin",
      description:
        "Begin an exactly-once semantic transfer from a source grounded in the supplied fresh observation. Declare whether the destination remains a visible semantic scope or must be verified later from an independently opened destination observation. The destination identity and consequenceKey remain stable while later phases are grounded from new observations.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          observationId: { type: "string", minLength: 1, maxLength: 200 },
          kind: { const: "transfer" },
          sourceTarget: targetJsonSchema,
          destination: semanticTransactionDestinationJsonSchema,
          mechanism: {
            type: "string",
            enum: ["menu", "keyboard", "drag", "file_picker", "direct"],
          },
          consequenceKey: { type: "string", minLength: 1, maxLength: 500 },
        },
        required: [
          "sessionId",
          "observationId",
          "kind",
          "sourceTarget",
          "destination",
          "mechanism",
          "consequenceKey",
        ],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            observationId: z.string().min(1).max(200),
            kind: z.literal("transfer"),
            sourceTarget: z.unknown(),
            destination: z.unknown(),
            mechanism: z.unknown(),
            consequenceKey: z.string().min(1).max(500),
          })
          .parse(input);
        const { sessionId, ...request } = parsed;
        return runtime.beginSemanticTransaction(
          sessionId,
          beginSemanticTransactionRequestSchema.parse(request),
        );
      },
    },
    {
      name: "browser.transaction_advance",
      description:
        "Advance one prepare or commit phase using an action grounded in a fresh observation. Commit is the explicit consequential boundary and uses the transaction consequence key; an unknown commit is terminal and must not be replayed or replaced with a fallback. A keyboard transfer may stage a page-level clipboard copy/cut with no expectedEffects only when the exact transaction source is already selected; completed trusted dispatch advances the transaction while the receipt honestly retains outcome unknown and records evidenceBasis trusted_dispatch. A transfer commit must include a bounded expected effect for the exact transaction source: target_within_scope for a visible declared destination, target_absent or target_within_scope before later remote-destination verification, or target_present after an explicit clipboard paste. Unrelated or already-visible destination text is not commit evidence.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          transactionId: { type: "string", pattern: "^tx_" },
          observationId: { type: "string", minLength: 1, maxLength: 200 },
          phase: { type: "string", enum: ["prepare", "commit"] },
          action: browserInteractionActionJsonSchema,
          expectedEffects: {
            type: "array",
            minItems: 0,
            maxItems: 20,
            items: expectedEffectJsonSchema,
          },
          effect: {
            type: "string",
            enum: [
              "navigate",
              "reversible_ui",
              "edit_content",
              "external_commit",
              "irreversible",
            ],
          },
        },
        required: [
          "sessionId",
          "transactionId",
          "observationId",
          "phase",
          "action",
          "expectedEffects",
        ],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            transactionId: z.string().startsWith("tx_"),
            observationId: z.string().min(1).max(200),
            phase: z.enum(["prepare", "commit"]),
            action: z.unknown(),
            expectedEffects: z.array(z.unknown()).max(20),
            effect: z.unknown().optional(),
          })
          .parse(input);
        const { sessionId, ...request } = parsed;
        return runtime.advanceSemanticTransaction(
          sessionId,
          advanceSemanticTransactionRequestSchema.parse(request),
        );
      },
    },
    {
      name: "browser.transaction_verify",
      description:
        "Finalize a committed semantic transaction from a fresh observation. For within_scope destinations, Runtime verifies the original source target inside the declared scope. For destination_observation transfers, first open the exact destination; Runtime verifies the exact source target is present and requires at least one additional destination-context effect such as url_equals or a breadcrumb/header target.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          transactionId: { type: "string", pattern: "^tx_" },
          observationId: { type: "string", minLength: 1, maxLength: 200 },
          additionalExpectedEffects: {
            type: "array",
            maxItems: 19,
            items: expectedEffectJsonSchema,
            description:
              "Additional bounded evidence. Required for destination_observation verification and must independently identify the opened destination, for example with url_equals or a destination breadcrumb/header target.",
          },
        },
        required: ["sessionId", "transactionId", "observationId"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            transactionId: z.string().startsWith("tx_"),
            observationId: z.string().min(1).max(200),
            additionalExpectedEffects: z
              .array(z.unknown())
              .max(19)
              .optional()
              .default([]),
          })
          .parse(input);
        const { sessionId, ...request } = parsed;
        return runtime.verifySemanticTransaction(
          sessionId,
          verifySemanticTransactionRequestSchema.parse(request),
        );
      },
    },
    {
      name: "browser.transaction_status",
      description:
        "Read the immutable identity, phase receipts, verification, and terminal status of one semantic transaction.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          transactionId: { type: "string", pattern: "^tx_" },
        },
        required: ["sessionId", "transactionId"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            transactionId: z.string().startsWith("tx_"),
          })
          .parse(input);
        return runtime.getSemanticTransaction(
          parsed.sessionId,
          semanticTransactionReferenceSchema.parse(parsed).transactionId,
        );
      },
    },
    {
      name: "browser.transaction_cancel",
      description:
        "Cancel a semantic transaction before its commit boundary. Committed or terminal transactions cannot be cancelled.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          transactionId: { type: "string", pattern: "^tx_" },
        },
        required: ["sessionId", "transactionId"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            transactionId: z.string().startsWith("tx_"),
          })
          .parse(input);
        return runtime.cancelSemanticTransaction(
          parsed.sessionId,
          semanticTransactionReferenceSchema.parse(parsed).transactionId,
        );
      },
    },
    {
      name: "browser.navigate",
      description:
        "Navigate the active page to an absolute http or https URL. If a safely completed read-only navigation or history operation reaches the wrong nonconsequential outcome, inspect freshly and choose another safe read-only Rove route. Every such retry must include recovery with one stable operationId; Runtime admits at most two attempts and refuses the third, including across restart. Recoverable routing misses do not end the task. Runtime policy may reject repeated, over-budget, or unsafe actions; never retry in a tight loop.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          url: { type: "string" },
          recovery: browserRecoveryJsonSchema,
        },
        required: ["sessionId", "url"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            url: z.string(),
            recovery: browserRecoveryAdmissionRequestSchema.optional(),
          })
          .parse(input);
        return afterRecoveryAdmission(
          runtime,
          parsed.sessionId,
          parsed.recovery,
          () =>
            runtime.navigate(
              parsed.sessionId,
              navigateRequestSchema.parse({ url: parsed.url }),
            ),
        );
      },
    },
    {
      name: "browser.open_page",
      description:
        "Open an absolute http or https URL in a new Rove-managed browser page, make it active, and return its stable page ID. Use this instead of browser keyboard shortcuts when a workflow requires a separate tab.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          url: { type: "string" },
        },
        required: ["sessionId", "url"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({ sessionId: sessionIdSchema, url: z.string() })
          .parse(input);
        return runtime.openPage(
          parsed.sessionId,
          navigateRequestSchema.parse({ url: parsed.url }),
        );
      },
    },
    {
      name: "browser.pages",
      description:
        "List every Rove-managed browser page with its stable page ID, URL, title, active state, and revision.",
      inputSchema: sessionIdJsonSchema,
      handler: (input) =>
        runtime.pages(
          z.object({ sessionId: sessionIdSchema }).parse(input).sessionId,
        ),
    },
    {
      name: "browser.switch_page",
      description:
        "Switch browser focus and active Rove authority to a page returned by browser.pages or browser.open_page.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          pageId: { type: "string", minLength: 1 },
        },
        required: ["sessionId", "pageId"],
        additionalProperties: false,
      },
      handler: async (input) => {
        const parsed = z
          .object({ sessionId: sessionIdSchema, pageId: z.string().min(1) })
          .parse(input);
        return runtime.switchPage(parsed.sessionId, parsed.pageId);
      },
    },
    {
      name: "browser.close_page",
      description:
        "Close one Rove-managed browser page by stable page ID. List pages first when the target page is uncertain.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          pageId: { type: "string", minLength: 1 },
        },
        required: ["sessionId", "pageId"],
        additionalProperties: false,
      },
      handler: async (input) => {
        const parsed = z
          .object({ sessionId: sessionIdSchema, pageId: z.string().min(1) })
          .parse(input);
        await runtime.closePage(parsed.sessionId, parsed.pageId);
        return { ok: true, pageId: parsed.pageId };
      },
    },
    {
      name: "browser.inspect",
      description:
        "Inspect page text, actionable targets, and observational perception facts in metadata.pageState/pageStatePropositions. Inspection is observational and never requests or takes human control. It deliberately does not expose the deprecated page-wide mutation verdict; metadata.actionAuthority states that authorization is deferred until a freshly grounded browser.interact proposal. Diagnostic browserEvidence entries alone are not required-path failures. When the main document succeeds and pageState is ready, unrelated non-main-frame or subresource failures are diagnostic only unless evidence shows they prevented a required target or outcome; optional survey/feedback cards are likewise diagnostic. Do not request human control for an optional survey after the requested outcome is proven; leave it untouched. If it blocks a still-required target, dismiss it only through a freshly grounded nonconsequential action. Do not stop merely because an ordinary modal or overlay is observed as unknown_interstitial. An explicitly retryable read-only or conclusively pre-dispatch PAGE_CHANGED, OBSERVATION_STALE, or equivalent freshness rejection permits a fresh inspect/re-ground/continue sequence; screenshot retry must use the new observation. INVALID_INPUT permits a mechanically corrected request when the exact validation path proves pre-handler rejection with no dispatch; identical replay is forbidden. If a former target disappears or a safely completed read-only navigation/history result is wrong, inspect the current state and choose another safe Rove route instead of ending the task. Respect Runtime action-rate and repeated-action rejections and never retry in a tight loop. Authentication, required consent, human verification, credentials, access restrictions, terminal page failure, unresolved instability, Runtime refusal, and any unknown or uncertain consequential outcome remain hard boundaries and must never be retried.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          pageId: { type: "string" },
          includeText: { type: "boolean", default: true },
          includeTargets: { type: "boolean", default: true },
          includeViewport: { type: "boolean", default: true },
          includeStructure: { type: "boolean", default: true },
          maxTextChars: {
            type: "integer",
            minimum: 1,
            maximum: 50000,
            default: 20000,
          },
          maxStructureChars: {
            type: "integer",
            minimum: 1,
            maximum: 30000,
            default: 12000,
          },
          targetLimit: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            default: 200,
          },
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
      handler: async (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            pageId: z.string().optional(),
            includeText: z.boolean().optional().default(true),
            includeTargets: z.boolean().optional().default(true),
            includeViewport: z.boolean().optional().default(true),
            includeStructure: z.boolean().optional().default(true),
            maxTextChars: z
              .number()
              .int()
              .positive()
              .max(50_000)
              .optional()
              .default(20_000),
            maxStructureChars: z
              .number()
              .int()
              .positive()
              .max(30_000)
              .optional()
              .default(12_000),
            targetLimit: z
              .number()
              .int()
              .positive()
              .max(500)
              .optional()
              .default(200),
          })
          .parse(input);
        const { sessionId, ...options } = parsed;
        const inspection = await runtime.inspect(
          sessionId,
          inspectOptionsSchema.parse(options),
        );
        return inspectionForAgent(inspection);
      },
    },
    {
      name: "browser.scroll",
      description:
        "Scroll the active page by CSS pixels. Use bounded increments and inspect between repeated navigation or pagination steps.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          direction: { type: "string", enum: ["up", "down", "left", "right"] },
          amount: { type: "integer", minimum: 1, maximum: 10000, default: 600 },
        },
        required: ["sessionId", "direction"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            direction: z.enum(["up", "down", "left", "right"]),
            amount: z.number().int().min(1).max(10_000).optional().default(600),
          })
          .parse(input);
        return runtime.scroll(
          parsed.sessionId,
          scrollRequestSchema.parse(parsed),
        );
      },
    },
    {
      name: "browser.back",
      description:
        "Navigate the active page backward. If it safely completes at the wrong nonconsequential location, inspect freshly and choose another safe read-only Rove route. Every retry must include recovery with one stable operationId; Runtime refuses the third admission.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          recovery: browserRecoveryJsonSchema,
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
      handler: async (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            recovery: browserRecoveryAdmissionRequestSchema.optional(),
          })
          .parse(input);
        return afterRecoveryAdmission(
          runtime,
          parsed.sessionId,
          parsed.recovery,
          () => runtime.back(parsed.sessionId),
        );
      },
    },
    {
      name: "browser.forward",
      description:
        "Navigate the active page forward. If it safely completes at the wrong nonconsequential location, inspect freshly and choose another safe read-only Rove route. Every retry must include recovery with one stable operationId; Runtime refuses the third admission.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", minLength: 1 },
          recovery: browserRecoveryJsonSchema,
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            recovery: browserRecoveryAdmissionRequestSchema.optional(),
          })
          .parse(input);
        return afterRecoveryAdmission(
          runtime,
          parsed.sessionId,
          parsed.recovery,
          () => runtime.forward(parsed.sessionId),
        );
      },
    },
    {
      name: "browser.screenshot",
      description:
        "Capture browser visual evidence. Viewport and region captures can include bounded inline PNG content while preserving durable screenshot evidence. Pass observationId to bind the capture to the same page, document revision, URL, viewport, scroll position, and ownership; unrelated dynamic DOM churn is recorded at the mutation version actually captured.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            minLength: 1,
          },
          mode: {
            type: "string",
            enum: ["viewport", "full-page", "target", "region"],
            default: "viewport",
          },
          target: targetJsonSchema,

          region: {
            type: "object",
            properties: {
              x: {
                type: "number",
                minimum: 0,
              },
              y: {
                type: "number",
                minimum: 0,
              },
              width: {
                type: "number",
                exclusiveMinimum: 0,
              },
              height: {
                type: "number",
                exclusiveMinimum: 0,
              },
            },
            required: ["x", "y", "width", "height"],
            additionalProperties: false,
          },
          observationId: {
            type: "string",
            minLength: 1,
            maxLength: 200,
          },
          label: {
            type: "string",
            maxLength: 200,
          },
        },
        required: ["sessionId"],
        additionalProperties: false,
      },
      present: toolSuccessWithImage,
      handler: (input) => {
        const parsed = z
          .object({
            sessionId: sessionIdSchema,
            mode: z
              .enum(["viewport", "full-page", "target", "region"])
              .optional()
              .default("viewport"),
            target: targetSchema.optional(),

            region: z
              .object({
                x: z.number().finite().nonnegative(),
                y: z.number().finite().nonnegative(),
                width: z.number().finite().positive(),
                height: z.number().finite().positive(),
              })
              .optional(),
            observationId: z.string().min(1).max(200).optional(),
            label: z.string().max(200).optional(),
          })
          .parse(input);

        return runtime.screenshot(
          parsed.sessionId,
          screenshotRequestSchema.parse({
            mode: parsed.mode,
            target: parsed.target,
            region: parsed.region,
            observationId: parsed.observationId,
            label: parsed.label,
          }),
        );
      },
    },
  ];
}
