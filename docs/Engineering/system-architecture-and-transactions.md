# System Architecture and Transactional Design

**Status:** Target architecture. Existing source is reused where it satisfies the product model; this document does not certify the current runtime as conformant.

## Logical structure

```text
Renderer / Rove interface
    | narrow validated commands, queries, and subscriptions
Application service
    |-- Local task/workflow/result authority
    |-- Context assembly and human attention
    |-- Codex adapter -> qualified local App Server process
    |-- Capability adapters -> browser, files, authorized integrations
    |-- SQLite metadata + managed local artifact files
    `-- Account and small workflow-configuration synchronization adapter
```

Logical boundaries need not become independently deployed services. Keep Electron/React as the starting shell. Keep the browser and Codex in supervised processes where useful. The existing NestJS Runtime may continue serving browser authority through a private adapter. It must not decide that every new conversation requires a browser.

The application service owns product commands and task state. The Codex adapter owns transport, supported protocol conversion, engine-account association, and event correlation. Runtime/capability adapters own the truth they can actually observe. The renderer submits intent and renders projections, not a second task scheduler.

A mandatory cloud task executor, device relay, hosted browser, or distributed workflow engine is unnecessary. The cloud-facing boundary is limited to account identity and approved workflow configuration. Existing control-plane experiments may remain available but are not a prerequisite for ordinary local tasks.

Workflow Home, Outputs, and attention summaries are renderer/application projections over the existing local Workflow, task, Result, and attention authorities. They introduce no workspace-specific task copies, output records, or attention state machine. Exact workflow association filters membership; exact task/result/request identity routes selection and action.

## Authority and consistency

Use one authoritative local task store through the application service, not independent lifecycle writers in renderer, App Server event handlers, and Runtime adapters. Reuse the existing ledger's useful atomicity and deduplication. Do not add another event-sourced engine merely to implement new entities.

SQLite mutations use short transactions. Enable foreign keys for each connection, set a busy timeout, and select durability settings explicitly. WAL permits readers alongside a writer but does not remove the single-writer model. No transaction waits on a human, model, browser, or synchronization request. [SQLite transactions](https://www.sqlite.org/lang_transaction.html) and [foreign keys](https://www.sqlite.org/foreignkeys.html) define the underlying constraints.

Managed file persistence is a two-resource problem. Write bytes to an owned temporary path, verify them, move to the final managed location, and publish metadata only when availability is established. Reconcile unreferenced temporary files and missing referenced files after interruption. Do not claim that a database commit alone durably created a video or download.

## Request acceptance

A new model-assisted task follows this sequence:

1. Validate the user intent, Rove profile, model readiness, input bounds, grants, and applicable workflow revision. Known model unavailability rejects before presenting execution as accepted.
2. Commit the task/request and an operation identity atomically, without acquiring browser resources.
3. Obtain or resume the qualified engine association, then dispatch using the operation's correlation identifier where supported.
4. Record acceptance and later output facts. The UI distinguishes submission, execution, failure, and uncertainty.

A readiness check is not a guarantee that dispatch succeeds. A pre-dispatch failure can be reported as not submitted. A lost response after possible dispatch is unresolved until correlated with supported engine evidence. Do not create a second user turn blindly after reconnect. Local unsent composer text is not a durable automatic-execution queue.

## External actions

For a consequential action, validate current task ownership, grant scope, targets, content, and any approval. Persist the intended operation and its consequence identity before dispatch. Perform the external action outside the database transaction. Persist the observed receipt afterward.

Separate dispatch from outcome: not dispatched, possibly dispatched, dispatched with an unverified effect, confirmed effect, and confirmed failure are different facts. If acknowledgement is lost after an email might have been sent, inspect permitted evidence or request user reconciliation. A new adapter, restart, or retry button does not make repetition safe. No universal exactly-once guarantee is made for third-party websites.

Read-only operations and proven pre-dispatch failures may use bounded retries with fresh grounding. Classify errors rather than blanket-retrying every exception. Each retry remains within permission and repeated-action limits.

## Stop, takeover, and return

Stop first prevents new dispatch for the affected turn. Then interrupt the engine through its supported interface and reconcile any in-flight operation. Preserve conversation and results; stopping does not archive or delete the task.

Human takeover prevents new conflicting browser mutations before confirming control transfer. An already dispatched action can complete or remain unresolved. The owner change and its reason are persisted. On return, inspect actual state, invalidate stale target references, resolve compatible pending attention once, and continue the task without replaying the preceding action.

Locks cover the actual shared resource: a page, context-wide account change, clipboard, or other proven conflict. Do not hold a browser/profile lease simply because a task exists. Resource admission and control ownership are not the selected UI task.

The implemented browser adapter preserves one task-scoped Runtime session and capability while allowing several such sessions to share one managed persistent browser host. Page ownership and logical active-page state are session-scoped; the profile lease is host-scoped; focus-sensitive operations and human takeover coordinate at the host. Takeover presents the requesting page, and return invalidates shared-context target authority before reopening mutation admission. Browser identity therefore remains a shared resource, not a task identifier. Unowned restored or late-attribution pages are quarantined rather than adopted from physical focus, and persistent-host ownership is retained across incomplete shutdown until process death is verified.

## Workflow edits and synchronization

A local workflow edit validates an allowlisted configuration and commits a new local revision plus a pending configuration-sync record. The remote write uses an expected revision. A conflict preserves both versions for explicit resolution rather than overwriting silently. Applying downloaded configuration never dispatches a model turn or external action.

Name-only creation commits a valid sparse initial configuration, then the renderer selects the new workflow. Advanced configuration uses the same immutable revision path later from secondary Context/settings. Starting from Workflow Home uses the ordinary task-acceptance transaction with the selected workflow identity and applicable approved revision; it does not create a special task lifecycle.

Tasks use local approved snapshots. Deleting synchronized setup does not cascade into local task history. See [workflow portability](workflow-context-and-portability.md) for the complete narrow contract.

## Startup and recovery

On startup, recover local records, verify process identities, reconnect only to owned resources, and query supported engine/browser state. Unknown processes are not attached to or killed. A stored PID, browser URL, or page reference alone is insufficient authority after restart.

Initialize the local SQLite task/Workflow/Result authority before starting Codex. Publish those local read projections even when App Server startup fails; Codex health gates model submission and provider-dependent recovery, not reading local work. Rebuild display projections from authoritative local data. A renderer reconnection must not repeat accepted commands. Reconcile unsettled operations individually and allow unrelated tasks to remain usable. Old browser references expire; an engine thread identifier is not proof of current attachment.

The production `product-task-port` projects a persistent Task independently of Codex thread presence, provider archival, Runtime cleanup, and local history organization. A missing provider thread remains a readable local conversation; a later model message prepares a new supported Codex association without discarding local entries. Completed legacy close records migrate to open Task semantics. Close commands remain internal cleanup compatibility and are not exposed as Product completion or Archive.

## Dependency boundary

Use the official [Codex App Server interface](https://developers.openai.com/codex/app-server/) through a pinned, qualified local adapter. Generate or check contracts against the selected binary, initialize correctly, and reject incompatible messages without corrupting task history. Upstream experimental features require explicit qualification. Upstream documentation describes capabilities; it does not establish Rove's end-to-end reliability.

Component supply is outside task/domain state. A repository-owned manifest selects one immutable qualified Codex executable/helper/schema/validator/history set; a per-user Rove-managed store supplies its binaries during development, and packaged resources supply them after staging. The resolver verifies the complete selected set before process launch. Candidate discovery and qualification cannot mutate the selected identity, installation cannot imply approval, and promotion cannot bypass recorded qualification evidence or a compiled schema binding. A retained set is rollback-capable only while all of those parts remain available and compatible. This boundary keeps an unrelated ChatGPT or editor update from changing Rove startup behavior.
