# Application and Capability Contracts

**Status:** Target application contracts. Names below express intended commands and semantics; they are not a declaration that these routes are already implemented or a new public partner API.

## Surfaces

The renderer uses a narrow host-owned command/query bridge. The application service resolves task ownership, workflow association, stable Result identity, attention identity, grants, engine associations, and browser resources. Workflow Home and Outputs filter the existing local snapshot by exact associations; selecting an item routes to its owning task/result/request. Codex communicates through a qualified App Server adapter. Browser/file/integration adapters expose bounded capability operations. Account/workflow synchronization has a separate small authenticated boundary.

External MCP support can expose authorized capabilities, but it must not bypass the same operation and permission checks used by the application. Human take/return controls are trusted user intents, not agent-granted authority. No general partner onboarding, billing API, public task REST platform, or remote browser service is implied.

## Command envelope

A logical command has a stable `operationId`, a command `type`, the applicable `taskId` or `workflowId`, an optional expected entity revision, and a validated payload. The host determines owner identity and resolves private resource credentials; the renderer cannot supply authoritative ownership or substitute another profile.

```json
{
  "operationId": "op_opaque",
  "type": "task.message",
  "taskId": "task_opaque",
  "payload": {
    "text": "Draft replies for these findings",
    "selectedResultIds": ["result_opaque"]
  }
}
```

Opaque identifiers are examples, not required regexes. The same accepted operation ID with the same payload returns its known acceptance/outcome; the same ID with a different payload is a conflict. A response distinguishes rejection, acceptance, and uncertainty. Transport success alone does not mean the external task succeeded.

## Product command families

| Commands                                                                  | Required behavior                                                                                                                                                                  |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task.start`, `task.message`                                              | Validate model readiness for inference; resolve guidance and exact task; acquire no browser unless needed.                                                                         |
| `task.stop`, `task.cleanup.retry`                                         | Stop further dispatch for current work or retry only exact resource cleanup; preserve conversation and results; reconcile in-flight effects.                                       |
| `task.archive`, `task.restore`, `task.delete`                             | Archive/restore mutate only local history organization, never Finish, cleanup, or provider state; explicit destructive deletion remains separate and unimplemented.                |
| `workflow.create`, `workflow.edit`, `workflow.archive`, `workflow.delete` | Permit a name-only sparse initial configuration; validate later approved portable content and expected revision; never cascade deletion into local task history.                   |
| `workflow.promote`                                                        | Show and approve the exact selected reusable information; do not upload a task implicitly.                                                                                         |
| `result.create`, `result.revise`, `result.select`, `result.authorize`     | Resolve exact task/source/revision; bind action authorization to reviewed material before Runtime dispatch.                                                                        |
| `browser.open`, `control.take`, `control.pause`, `control.return`         | Resolve the exact Task-to-Runtime association and current ownership/handoff generation before mutation; selected/current UI state and newest-session ordering are never authority. |
| `recording.start`, `recording.stop`                                       | Confirm scope and privacy/OS permissions; persist artifact availability separately from recording intent.                                                                          |
| `attention.respond`                                                       | Match task, request, operation, generation, and scope; accept a live decision once.                                                                                                |
| `resource.grant`, `resource.revoke`                                       | Select/resolve authorized resources; reject stale, out-of-scope, or revoked use.                                                                                                   |
| Model connect/disconnect                                                  | Change the model connection, not the Rove owner or local data.                                                                                                                     |

Reading tasks, results, and artifacts does not require model access. Query responses include enough revision and status information for coherent UI updates. List operations use bounded pagination and a stable cursor rather than assuming one complete in-memory list forever.

Archive is accepted only when no Codex turn is actively executing; it does not implicitly Stop. Archive and Restore bypass execution-intent reduction entirely, so a pending cleanup command or exact uncertainty fence is preserved byte-for-byte while the local preference changes. The preference and a digest-bound operation receipt commit atomically: exact retries return the recorded acceptance, conflicting operation-ID reuse is rejected, and a delayed retry cannot overwrite a later organization choice. Archived Tasks are excluded from normal Task History and appear in the separate **Settings → Archived tasks** restore/read surface, which keeps unresolved attention visible without occupying ordinary sidebar navigation; restoring does not steal selection. Restore succeeds from the same local preference while Codex is unavailable. Provider thread unarchive or replacement is deferred until a later model-assisted message actually needs provider execution.

The ordinary composer prioritizes task text while keeping attachment, one shared Commands entry, participation mode, approval policy, combined model and reasoning effort, and Send quietly visible at supported viewport sizes. Responsive allocation must preserve recognizable labels rather than reducing adjacent controls to ambiguous ellipses. The shared searchable command palette progressively discloses implemented long-tail choices and mirrors those visible settings through the same authoritative launch state. For an exact selected task with pending conversational input, the renderer replaces that composer with controls bound to the existing `attention.respond` identity and generation. Background-task attention cannot replace the selected task's composer and is labeled **Needs input** only on its owning task until response. Browser control handoff stays on the Runtime control path; a task without an exact attached Runtime browser says **No browser attached** rather than projecting its configured identity as live. Approval presentation must retain the exact material being authorized.

Desktop browser controls carry the Task identity the user acted on. The trusted host resolves that Task through the durable engine association, validates the exact live Runtime session plus bootstrap receipt, and sends Runtime the expected ownership generation and, when applicable, handoff identity and generation. Runtime rejects stale or mismatched authority before beginning a browser ownership transition. The compact follower may choose which task-owned browser to present, but that presentation choice cannot become mutation authority; a pending or human-owned handoff remains visible ahead of a newly started agent session.

Creating a workflow returns its exact identity so the renderer can select Workflow Home immediately. Starting a task from that Home sends the exact workflow identity through the ordinary task command and uses the applicable approved configuration revision under the existing explicit disclosure rule. Standalone task commands omit workflow identity and retain their behavior.

## Engine adapter

The adapter owns initialize/ready negotiation, version compatibility, request correlation, thread attachment, turn submission/steering/interruption, attention translation, and supported history reads. Use [App Server's documented interface](https://developers.openai.com/codex/app-server/) for the selected binary; do not access undocumented internal history databases or copy login state across accounts.

Before spawning App Server, the host resolves one repository-approved component identity. The single selection binds the executable/helper identity, generated-schema fingerprint, compiled Runtime validator catalog, and history compatibility mode. Development accepts only that exact component in Rove's managed component store; packaged execution accepts only that exact component in application resources. Resolution verifies platform, architecture, reported upstream version, executable digest, helper digest, the actual runtime catalog file digest, and its independently generated TypeScript aggregate. External installations may be passed explicitly to engineering qualification tooling, but are not fallback runtime authority. Candidate qualification, managed installation, and durable approved-set promotion are distinct commands and state transitions.

Every inbound event resolves to the exact engine association and task. A stale connection epoch cannot mutate a newer task association. Live App Server notifications are the ordered low-latency path, not the only durable-truth path. For supported reconstructible facts, exact bound `thread/read` history is authoritative external evidence used to converge the SQLite Task ledger through the same semantic normalization and `TaskEngine` reduction as live events. The adapter validates exact Task, thread, App Server session, source, item/turn, and Runtime handoff identities before accepting repair. History reads never authorize turn submission, steering, tool execution, approval, browser mutation, or any other new external work. An upstream acknowledgement lost after possible turn submission requires correlation before retry. Do not silently change from subscription authentication to API-key billing.

Reconciliation is triggered and bounded around failure in the Task-ingestion listener itself, App Server connection replacement, desktop startup for open bound Tasks, and exact cross-authority contradictions such as Runtime `awaiting_human` with a matching handoff but no durable continuation. A failure in another App Server listener remains a host-health diagnostic and is not evidence that Task ingestion failed. Failed events are classified by semantics: terminal turn/item facts use thread history; server requests and `serverRequest/resolved` use live-attention authority; provider archive notifications use provider membership authority; intermediate deltas/progress are expendable when terminal history is sufficient. It does not assume per-Task connection positions are contiguous. Three failed history attempts persist a safe recovery-required diagnostic and stop; raw App Server payloads are not retained.

Outstanding blockers are bounded, typed, Task/thread-bound durable records. A success removes only the exact blocker owned by that recovery authority: thread-history success cannot clear live-attention or provider-membership uncertainty, and a different request cannot clear an exact live request/resolution blocker. A later exact live request/resolution or provider archive observation may clear its matching blocker. Overflow remains fail-closed rather than dropping uncertainty. Ordinary turn/item/user-message materialization and completed Rove request-human calls are reconstructible from qualified full history. Outstanding App Server server-request attention is not present in normal thread history and therefore remains live-only: notification loss cannot manufacture an approval or prompt and instead fails closed for the affected Task.

After a completed request-human observation commits, Companion acknowledges the exact handoff ID and generation to Runtime. `control.wait` may block only when Runtime exposes that durable Companion acknowledgement. MCP handler success and its process-local memory are not durability authority; before acknowledgement the tool returns a bounded retry/reconciliation error rather than entering an indefinite wait.

## Capability envelope and receipt

A capability invocation identifies the task/turn, operation, capability, scoped resource, input, and applicable authority generation. Browser mutations additionally bind current page/observation targets and an intended outcome/consequence. Low-level expected-effect predicates may remain Runtime implementation data, but they are not the product-level meaning of the operation and should not be the only way the reasoning agent can ask Rove to establish success. File operations use managed artifact or grant IDs, not arbitrary filesystem paths supplied by a webpage.

A capability receipt records operation identity, whether dispatch occurred or is unknown, observed effect status, evidence/result references, bounded diagnostics, and enough correlation to reconcile later evidence when supported. It does not turn a completed click into a confirmed purchase or send. Missing post-action evidence remains visible as a verification problem, not a reason to resend automatically.

The capability catalog declares input/output schema, required grants, read-only versus consequential behavior, cancellation semantics, reconciliation support, and output size limits. It is host-controlled. A skill or external response cannot register a new unrestricted shell or file capability.

## Browser execution and reconciliation

The agent-facing browser contract is outcome-oriented above the Runtime's strict action primitives. Codex should be able to inspect current state, request a grounded interaction, and continue toward an intended result without having to correctly program every low-level verification predicate for the current application's DOM shape.

The browser capability uses progressive perception. Structured text, semantic targets, state, scopes, and revision/freshness data are preferred when sufficient. Coverage and truncation metadata are part of the decision input. When the current representation cannot establish the required proposition, the capability may use targeted or differently bounded inspection, scroll/search, a fresh observation after settling, screenshot/visual interpretation, or another permitted read-only view. Known-incomplete evidence cannot be upgraded to authoritative merely because a matching string or target happens to appear.

A consequential interaction crosses one mutation boundary under a stable consequence identity. Before dispatch, Runtime durably binds the exact internal expected effects and the bounded predecessor truth needed for causal verification; later reads cannot replace that basis. Immediate post-action evidence may settle the effect as applied or not applied. If dispatch occurred but the requested outcome remains unverified, the mutation is fenced and the operation may enter bounded read-only reconciliation. `browser.reconcile_outcome` accepts only the existing session, consequence key, and fresh observation identity. It currently settles ordinary visible target-presence/absence and whole-page visible-text effects through canonical target and focused-text evidence. Reconciliation remains attached to the same durable effect and immutable original receipt; it cannot repeat the effect, substitute another transport, alter authorized material, accept replacement outcomes, or create a new consequence under the guise of verification.

Semantic transfer transactions retain bounded session-scoped orchestration identity for the exact source, destination, mechanism, prepare/commit phases, and fresh destination verification. Their agent-facing advance and destination-verification inputs use the same semantic outcome vocabulary as ordinary browser interactions; low-level expected effects remain private Runtime protocol data. Commit dispatch still uses ordinary `Runtime.interact`, `ActionReceipt`, and durable EffectJournal truth. An unknown commit must be settled through `browser.reconcile_outcome`; terminal journal truth projects the live transaction to committed or not applied only after the durable journal write and exact fence release. A committed transaction may separately remain uncertain while read-only destination evidence is incomplete, and that verification may retry from a different fresh observation without creating a mutation fence. The session-scoped transaction projection is not a second durable dispatch authority and may be unavailable after Runtime process loss even though EffectJournal truth remains durable.

Fresh authoritative contradiction can settle the effect as not applied. Fresh success is causal only when the predecessor proposition was authoritatively contradicted; pre-existing success, an unresolved predecessor, or unresolved fresh evidence remains unknown. Terminal settlement appends one optimistic effect-journal version and clears only that consequence key's replay fence after the durable write succeeds. Legacy unresolved records without a verification basis remain readable but cannot be settled automatically.

A terminal unresolved state means bounded permitted reconciliation could not establish the outcome, or a hard human/security/service boundary prevents further evidence gathering. It should not be produced merely because one immediate observation format was insufficient.

This adaptive execution architecture is implemented and deterministically generalized for the qualified capability families. The overall browser capability remains partial where concrete perception, traversal, visual interpretation, widget, or cross-origin action families remain incomplete. The production MCP contract is regression-protected so low-level Runtime effect fields and predicate kinds do not become normal Codex-facing inputs again.

## Attention and authorization

An approval is tied to task, operation, recipient/resource scope, content/attachment digest, and live request generation. Changed content or a different target may require fresh authorization. Concrete batch approval is supported without presenting a confirmation for every ordinary navigation step.

Human ownership and action authorization are related but different: permission to send a message does not allow agent mutation while the human controls the page. Declining an action must not be converted into execution through another adapter.

## Errors and retries

| Error category                                      | Caller behavior                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Invalid input / model unavailable before acceptance | Do not show running work; preserve user text and explain the correction.              |
| Revision or stale-target conflict                   | Fetch current state and re-ground; never reuse obsolete authority blindly.            |
| Missing grant / denied action / service restriction | Request legitimate user input or explain the boundary; no bypass.                     |
| Resource busy                                       | Wait only for that resource; keep unrelated work usable.                              |
| Definite pre-dispatch transient failure             | Bounded retry may be allowed within current authorization.                            |
| Possible dispatch / unknown consequential outcome   | Reconcile evidence; do not recommend blind retry.                                     |
| Storage failure after dispatch                      | Preserve uncertainty and surface incomplete persistence; do not fabricate completion. |

Errors include an operation reference, safe user message, classification, and explicit retry disposition. Secret tokens, local sensitive paths, and raw third-party payloads are not diagnostic messages.

Browser mutation recovery is bounded to two re-grounded admissions for one stable recovery operation identity in the task-bound MCP Runtime session. Retried pre-dispatch interactions and navigation/history routes present that same identity; Runtime persists the count with the session and refuses the third admission, including after restart. Invalid input may be mechanically corrected only with proof that the handler did not run and fresh grounding produces a different valid request. A safely completed read-only operation may try another freshly grounded Rove route within that budget. Unknown consequential outcomes stop mutation replay immediately and cannot enter mutation recovery or be replayed through any capability. They may enter separately bounded read-only reconciliation tied to the existing operation/consequence identity. The App Server/MCP boundary does not expose a durable Codex turn identity, so the existing task capability plus Runtime session and stable recovery operation remain the smallest enforceable mutation-recovery scope; this does not create a planner.

A conclusively pre-dispatch or read-only browser failure does not prohibit a separately authorized integration, plugin, API, or suitable CLI when that capability legitimately fits the requested outcome and service rules permit it. The alternate must not expand authorization, evade a restriction, or replay an unresolved effect. This is a host policy boundary, not an implemented alternate integration or stealth-browser fallback; no alternate is invoked unless a separately authorized production capability already exists.

## Workflow-sync and MCP boundaries

Workflow synchronization uploads only validated approved configuration, using owner-scoped authentication and conditional revision semantics. It is not a remote execution API. See [portability](workflow-context-and-portability.md).

For HTTP MCP integrations, follow the selected supported [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization); do not forward one service's bearer token to another. A stdio subprocess uses its separately controlled launch/environment boundary rather than assuming HTTP OAuth automatically applies.

## Implementation mapping

Current entry points include `apps/companion/src/main/codex/local-product-api.ts`, `product-task-port.ts`, `results.ts`, `browser-route-policy.ts`, the thread/session supervisor, `apps/mcp`, and the private Runtime API. Local result commands, exact selected-revision turn snapshots, separated user/evidence input, bounded browser recovery/alternate classification, exact result-revision Workflow promotion, semantic outcome inputs for ordinary browser interactions, and Runtime-owned prepare/validate/authorize/commit plans for task-result actions are implemented through these seams. The MCP boundary compiles ordinary semantic outcomes into private Runtime verification effects. A semantic result authorization is not direct dispatch authority: the concrete grounded plan must match the saved recipient, content, files, target, and scope, and commit reuses that plan's verification basis rather than accepting another from the caller. Other command names in this target catalog are not thereby declared implemented. Existing command names and protocol identifiers are compatibility facts; adapt them deliberately rather than adding a competing second product API.
