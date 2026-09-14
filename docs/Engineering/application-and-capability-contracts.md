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

| Commands                                                                  | Required behavior                                                                                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task.start`, `task.message`                                              | Validate model readiness for inference; resolve guidance and exact task; acquire no browser unless needed.                                                          |
| `task.stop`, `task.cleanup.retry`                                         | Stop further dispatch for current work or retry only exact resource cleanup; preserve conversation and results; reconcile in-flight effects.                        |
| `task.archive`, `task.restore`, `task.delete`                             | Archive/restore mutate only local history organization, never Finish, cleanup, or provider state; explicit destructive deletion remains separate and unimplemented. |
| `workflow.create`, `workflow.edit`, `workflow.archive`, `workflow.delete` | Permit a name-only sparse initial configuration; validate later approved portable content and expected revision; never cascade deletion into local task history.    |
| `workflow.promote`                                                        | Show and approve the exact selected reusable information; do not upload a task implicitly.                                                                          |
| `result.create`, `result.revise`, `result.select`, `result.authorize`     | Resolve exact task/source/revision; bind action authorization to reviewed material before Runtime dispatch.                                                         |
| `browser.open`, `control.take`, `control.return`                          | Resolve task-owned resources and current control generation; do not use selected UI tab as authority.                                                               |
| `recording.start`, `recording.stop`                                       | Confirm scope and privacy/OS permissions; persist artifact availability separately from recording intent.                                                           |
| `attention.respond`                                                       | Match task, request, operation, generation, and scope; accept a live decision once.                                                                                 |
| `resource.grant`, `resource.revoke`                                       | Select/resolve authorized resources; reject stale, out-of-scope, or revoked use.                                                                                    |
| Model connect/disconnect                                                  | Change the model connection, not the Rove owner or local data.                                                                                                      |

Reading tasks, results, and artifacts does not require model access. Query responses include enough revision and status information for coherent UI updates. List operations use bounded pagination and a stable cursor rather than assuming one complete in-memory list forever.

Archive is accepted only when no Codex turn is actively executing; it does not implicitly Stop. Archive and Restore bypass execution-intent reduction entirely, so a pending cleanup command or exact uncertainty fence is preserved byte-for-byte while the local preference changes. The preference and a digest-bound operation receipt commit atomically: exact retries return the recorded acceptance, conflicting operation-ID reuse is rejected, and a delayed retry cannot overwrite a later organization choice. Archived Tasks are excluded from normal Task History and appear in a separate restore/read surface that keeps unresolved attention visible; restoring does not steal selection. Restore succeeds from the same local preference while Codex is unavailable. Provider thread unarchive or replacement is deferred until a later model-assisted message actually needs provider execution.

The ordinary composer prioritizes task text while keeping attachment, one shared Commands entry, participation mode, approval policy, combined model and reasoning effort, and Send quietly visible at supported viewport sizes. Responsive allocation must preserve recognizable labels rather than reducing adjacent controls to ambiguous ellipses. The shared searchable command palette progressively discloses implemented long-tail choices and mirrors those visible settings through the same authoritative launch state. For an exact selected task with pending conversational input, the renderer replaces that composer with controls bound to the existing `attention.respond` identity and generation. Background-task attention cannot replace the selected task's composer and is labeled **Needs input** only on its owning task until response. Browser control handoff stays on the Runtime control path; a task without an exact attached Runtime browser says **No browser attached** rather than projecting its configured identity as live. Approval presentation must retain the exact material being authorized.

Creating a workflow returns its exact identity so the renderer can select Workflow Home immediately. Starting a task from that Home sends the exact workflow identity through the ordinary task command and uses the applicable approved configuration revision under the existing explicit disclosure rule. Standalone task commands omit workflow identity and retain their behavior.

## Engine adapter

The adapter owns initialize/ready negotiation, version compatibility, request correlation, thread attachment, turn submission/steering/interruption, attention translation, and supported history reads. Use [App Server's documented interface](https://developers.openai.com/codex/app-server/) for the selected binary; do not access undocumented internal history databases or copy login state across accounts.

Before spawning App Server, the host resolves one repository-approved component identity. The single selection binds the executable/helper identity, generated-schema fingerprint, compiled Runtime validator catalog, and history compatibility mode. Development accepts only that exact component in Rove's managed component store; packaged execution accepts only that exact component in application resources. Resolution verifies platform, architecture, reported upstream version, executable digest, helper digest, the actual runtime catalog file digest, and its independently generated TypeScript aggregate. External installations may be passed explicitly to engineering qualification tooling, but are not fallback runtime authority. Candidate qualification, managed installation, and durable approved-set promotion are distinct commands and state transitions.

Every inbound event resolves to the exact engine association and task. A stale connection epoch cannot mutate a newer task association. An upstream acknowledgement lost after possible turn submission requires correlation before retry. Do not silently change from subscription authentication to API-key billing.

## Capability envelope and receipt

A capability invocation identifies the task/turn, operation, capability, scoped resource, input, and applicable authority generation. Browser mutations additionally bind current page/observation targets. File operations use managed artifact or grant IDs, not arbitrary filesystem paths supplied by a webpage.

A capability receipt records operation identity, whether dispatch occurred or is unknown, observed effect status, evidence/result references, and bounded diagnostics. It does not turn a completed click into a confirmed purchase or send. Missing post-action evidence remains visible as a verification problem, not a reason to resend automatically.

The capability catalog declares input/output schema, required grants, read-only versus consequential behavior, cancellation semantics, and output size limits. It is host-controlled. A skill or external response cannot register a new unrestricted shell or file capability.

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

## Workflow-sync and MCP boundaries

Workflow synchronization uploads only validated approved configuration, using owner-scoped authentication and conditional revision semantics. It is not a remote execution API. See [portability](workflow-context-and-portability.md).

For HTTP MCP integrations, follow the selected supported [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization); do not forward one service's bearer token to another. A stdio subprocess uses its separately controlled launch/environment boundary rather than assuming HTTP OAuth automatically applies.

## Implementation mapping

Current entry points include `apps/companion/src/main/codex/local-product-api.ts`, `product-task-port.ts`, `results.ts`, the thread/session supervisor, `apps/mcp`, and the private Runtime API. Local result commands, selected-result turn snapshots, exact result-revision Workflow promotion, and Runtime-owned prepare/validate/authorize/commit plans for task-result actions are implemented through these seams. A semantic result authorization is not direct dispatch authority: the concrete grounded plan must match the saved recipient, content, files, target, and scope. Other command names in this target catalog are not thereby declared implemented. Existing command names and protocol identifiers are compatibility facts; adapt them deliberately rather than adding a competing second product API.
