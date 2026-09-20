# Logical Domain Model

**Status:** Target design derived from the product documents. Local Workflow environments and stable task results now implement the corresponding portions without requiring every concept to become a separate table or service.

## Core relationships

```text
Rove profile
  |-- Workflow environment -- identity and approved configuration revisions
  |       |-- Associated independent local tasks on each device
  |       |       |-- Structured results and artifacts
  |       |       `-- Task-owned attention
  |       `-- Workspace projections: Home, Outputs, Context/settings
  `-- Standalone local tasks
          |-- Conversation entries and execution turns
          |-- Engine associations
          |-- Capability attachments and grants
          |-- Attention requests and authorized actions
          `-- Results, artifacts, and outcome evidence
```

A workflow can exist without configuration beyond its name and without tasks on this device. A task can exist without a workflow. A task can continue after an execution turn ends or its browser closes. Workflow Home and Outputs query existing associated task, Result, and attention identities; they do not own duplicate copies. No association implies that task history is synchronized with the workflow.

## Concepts and ownership

| Concept               | Identity and responsibility                                                               | Persistence                                                         |
| --------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Rove profile          | Stable owner of portable setup and this device's local work; distinct from model account. | Account identity plus local profile partition.                      |
| Workflow environment  | Persistent named place for recurring work and its optional approved operating context.    | Small portable identity/configuration and local cache.              |
| Workflow revision     | Immutable approved configuration used to identify what guidance applied.                  | Portable configuration metadata; not a product release version.     |
| Task                  | Flexible conversation and related work; standalone or associated with a workflow.         | Local.                                                              |
| Accepted user instruction | User input durably accepted by Rove and immediately placed in the local conversation, with operation identity and delivery state. | Local; later provider materialization corroborates the same item. |
| Queued follow-up      | Ordered Task-owned instruction accepted for later execution, not yet delivered to the model or transcript. | Local and restart-safe until edited, removed, or promoted.          |
| Conversation entry    | Accepted user instruction after delivery begins, assistant output, or meaningful displayed work/result item. | Local; raw model internals are not a product record.                |
| Execution turn        | A bounded attempt to respond to a request inside a task.                                  | Local status, correlation, and outcomes.                            |
| Engine association    | Mapping from a task to a qualified Codex thread/account connection epoch.                 | Local; no credential values in the mapping.                         |
| Capability attachment | Availability and ownership of a resource needed by a task.                                | Local; live authority must be revalidated after restart.            |
| Browser identity/host | Rove-owned profile and the verified process using it.                                     | Local identity; current process evidence is ephemeral/reconciled.   |
| Page group            | Task-owned set of pages within a host; not an authentication boundary.                    | Local mapping, re-established using current browser evidence.       |
| Grant                 | User-authorized access to a resource and operations within a scope.                       | Local, revocable, never inherited from webpage instructions.        |
| Attention request     | A pending decision or intervention addressed to one task/operation.                       | Local with resolved/cancelled/expired state.                        |
| Browser control ownership | Exact current human/agent ownership of one task-bound browser resource and its handoff generation. | Runtime authority, durably correlated where continuation requires it. |
| Recovery blocker      | Exact bounded uncertainty that prevents an unsafe transition or replay until its owning authority reconciles it. | Local; typed by authority and correlation rather than customer copy. |
| Customer presentation state | Customer-safe projection of execution, interaction capabilities, attention, control ownership, and recovery consequences. | Derived; optional session preferences such as expanded history remain presentation-only. |
| Operation             | One accepted command with stable identity plus intent, dispatch, reconciliation, and outcome evidence. | Local journal; deduplication is not external exactly-once delivery. |
| Result                | A finding collection, draft, record, recommendation, or action outcome.                   | Local; can reference sources and artifacts.                         |
| Artifact              | A managed local file with ownership, type, size, integrity, and origin metadata.          | Local bytes and metadata.                                           |
| Workflow promotion    | User-approved selection of reusable information to place in guidance.                     | Portable only after explicit approval and validation.               |

## Task, turn, control, and presentation are separate

A task's organization state is active or archived; explicit deletion has separate cleanup rules. An accepted user instruction is durable Task conversation truth before provider materialization. An execution turn is the bounded agent attempt that may later deliver that instruction. A queued follow-up is neither an execution turn nor a delivered conversation entry until promotion begins; stopping does not discard or execute it.

Execution facts may describe idle, starting, running, waiting, interrupted, failed, or reconciliation work. Customer presentation instead distinguishes useful Working, genuine Waiting for you, You're in control, Checking state, Stopping, Stopped, failure, and uncertainty. Presentation is a projection of facts and safe interaction capabilities, not permission to erase conversation, authorize execution, or infer browser ownership.

An execution turn may complete while the task remains active. Stop interrupts the turn and future dispatch; it does not create a terminal conversation state. A new message may redirect the work. An unresolved external operation restricts repetition of that operation, not ordinary discussion.

Attention, recovery, and control ownership are independent. Attention means a real user action is pending. A recovery blocker may restrict an exact transition without creating attention. Control ownership belongs to the affected capability resource. Agent Mode, Companion Mode, and Capture Mode establish participation expectations but do not transfer authority merely because the selected view changes. Capture remains human-led; returning a browser resource to an agent requires an explicit compatible operation followed by fresh inspection where required.

The renderer's selected task, current tab, expanded result, and local unsent composer text are presentation state. They are not routing keys for background events or authorization evidence.

The selected workflow and selected workspace section are also presentation state. Workflow task, output, and attention lists are derived by exact workflow association and source-task identity. Opening an item routes to its owning task/result/request rather than transferring authority to the workflow view.

## Invariants

Every execution, attention request, result, artifact, and capability command has an exact task association. Task identity is validated before resolving model thread or browser resource mappings. A stale request cannot authorize a replacement operation or another task.

A task does not require a browser. Browser attachments are acquired on demand, and release does not delete the task. A workflow does not contain a writable Chrome profile or Codex token. Multiple groups may share browser identity but must coordinate genuinely shared effects.

Approved workflow guidance, task instructions, observed facts, and suggested learning are distinguishable. Guidance revisions are immutable records of an approved configuration. A running turn records the applied revision or snapshot; it does not silently consume a mid-action configuration edit.

An operation records intended consequence, authorization, dispatch, reconciliation evidence, and terminal outcome separately. An approval binds the actual recipient/content/resource scope. After uncertain external dispatch, the mutation remains fenced while bounded read-only reconciliation may continue against current evidence. Re-dispatch is not reconciliation and is never an ordinary transport retry.

## Boundaries and aggregates

Treat the workflow environment as the portable consistency unit. Its revision is replaced atomically with conditional update semantics. Treat the task as the local work unit, while allowing browser resources shared by several tasks to have their own coordinator.

Do not hold a task database transaction across a model call or browser interaction. Shared browser ownership is not a task foreign-key lock. The operation journal connects committed intent with later observations without making all task state globally exclusive.

An account change creates a different model-connection epoch. It does not create a new Rove owner. Reusing an engine thread after that change requires supported compatibility evidence; otherwise continuation must preserve the Rove record and make any new association explicit.

## Deletion and history

Deleting a workflow removes portable setup after explicit confirmation, not its existing local conversations. Local tasks retain the snapshot and display name needed to understand past work; their live workflow reference may become absent. Deleting a task requires settling active operations and references before removing its managed artifacts. Revoking a grant prevents future use but does not falsify a previously confirmed action.

## Existing implementation boundary

The current source has task-ledger/engine stores, local Workflow/result relations, and a task-addressed product port in `apps/companion/src/main/codex`. The ledger aggregate and its locally persisted conversation represent durable Task existence. Codex turn facts represent execution activity; `desiredState` and close stages remain internal compatibility/resource-cleanup machinery and completed cleanup returns the Task to an open, messageable projection. `task_history_preference.archived` is the sole local Task-history authority: absent legacy values backfill to unarchived and never inherit provider thread state. Result selection is a local product fact; the exact selected snapshot applied to a new turn remains in the durable task event/outbox. Runtime owns browser/session state and the external-effect journal. The companion's action result is reconciled from exact Runtime effect truth rather than becoming a parallel dispatch authority. See [architecture](system-architecture-and-transactions.md), [structured results](structured-results-and-actions.md), and [data model](relational-data-model.md).
