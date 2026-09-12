# Logical Domain Model

**Status:** Target design derived from the product documents; not a claim that these concepts already exist as separate tables or services.

## Core relationships

```text
Rove profile
  |-- Workflow environment -- approved revisions and reusable guidance
  |       `-- Local tasks on each device
  `-- Standalone local tasks
          |-- Conversation entries and execution turns
          |-- Engine associations
          |-- Capability attachments and grants
          |-- Attention requests and authorized actions
          `-- Results, artifacts, and outcome evidence
```

A workflow can exist without tasks on this device. A task can exist without a workflow. A task can continue after an execution turn ends or its browser closes. No association implies that task history is synchronized with the workflow.

## Concepts and ownership

| Concept               | Identity and responsibility                                                               | Persistence                                                         |
| --------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Rove profile          | Stable owner of portable setup and this device's local work; distinct from model account. | Account identity plus local profile partition.                      |
| Workflow environment  | Purpose and approved operating context for recurring work.                                | Small portable configuration and local cache.                       |
| Workflow revision     | Immutable approved configuration used to identify what guidance applied.                  | Portable configuration metadata; not a product release version.     |
| Task                  | Flexible conversation and related work; standalone or associated with a workflow.         | Local.                                                              |
| Conversation entry    | User input, assistant output, or meaningful displayed tool/result item.                   | Local; raw model internals are not a product record.                |
| Execution turn        | A bounded attempt to respond to a request inside a task.                                  | Local status, correlation, and outcomes.                            |
| Engine association    | Mapping from a task to a qualified Codex thread/account connection epoch.                 | Local; no credential values in the mapping.                         |
| Capability attachment | Availability and ownership of a resource needed by a task.                                | Local; live authority must be revalidated after restart.            |
| Browser identity/host | Rove-owned profile and the verified process using it.                                     | Local identity; current process evidence is ephemeral/reconciled.   |
| Page group            | Task-owned set of pages within a host; not an authentication boundary.                    | Local mapping, re-established using current browser evidence.       |
| Grant                 | User-authorized access to a resource and operations within a scope.                       | Local, revocable, never inherited from webpage instructions.        |
| Attention request     | A pending decision or intervention addressed to one task/operation.                       | Local with resolved/cancelled/expired state.                        |
| Operation             | One accepted command with stable identity and dispatch/outcome evidence.                  | Local journal; deduplication is not external exactly-once delivery. |
| Result                | A finding collection, draft, record, recommendation, or action outcome.                   | Local; can reference sources and artifacts.                         |
| Artifact              | A managed local file with ownership, type, size, integrity, and origin metadata.          | Local bytes and metadata.                                           |
| Workflow promotion    | User-approved selection of reusable information to place in guidance.                     | Portable only after explicit approval and validation.               |

## Task, turn, control, and presentation are separate

A task's organization state is active or archived; explicit deletion has separate cleanup rules. Its execution state may be idle, starting, running, waiting for attention, waiting for a resource, stopped, failed, or requiring outcome reconciliation. These are projections of facts, not permission to erase the conversation.

An execution turn may complete while the task remains active. Stop interrupts the turn and future dispatch; it does not create a terminal conversation state. A new message may redirect the work. An unresolved external operation restricts repetition of that operation, not ordinary discussion.

Control ownership belongs to the affected capability resource. Agent Mode, Companion Mode, and Capture Mode establish participation expectations but do not transfer authority merely because the selected view changes. Capture remains human-led; returning a browser resource to an agent requires an explicit compatible operation.

The renderer's selected task, current tab, expanded result, and local unsent composer text are presentation state. They are not routing keys for background events or authorization evidence.

## Invariants

Every execution, attention request, result, artifact, and capability command has an exact task association. Task identity is validated before resolving model thread or browser resource mappings. A stale request cannot authorize a replacement operation or another task.

A task does not require a browser. Browser attachments are acquired on demand, and release does not delete the task. A workflow does not contain a writable Chrome profile or Codex token. Multiple groups may share browser identity but must coordinate genuinely shared effects.

Approved workflow guidance, task instructions, observed facts, and suggested learning are distinguishable. Guidance revisions are immutable records of an approved configuration. A running turn records the applied revision or snapshot; it does not silently consume a mid-action configuration edit.

An operation records authorization, dispatch, and observed outcome separately. An approval binds the actual recipient/content/resource scope. Retrying after uncertain external dispatch is a reconciliation decision, not an ordinary transport retry.

## Boundaries and aggregates

Treat the workflow environment as the portable consistency unit. Its revision is replaced atomically with conditional update semantics. Treat the task as the local work unit, while allowing browser resources shared by several tasks to have their own coordinator.

Do not hold a task database transaction across a model call or browser interaction. Shared browser ownership is not a task foreign-key lock. The operation journal connects committed intent with later observations without making all task state globally exclusive.

An account change creates a different model-connection epoch. It does not create a new Rove owner. Reusing an engine thread after that change requires supported compatibility evidence; otherwise continuation must preserve the Rove record and make any new association explicit.

## Deletion and history

Deleting a workflow removes portable setup after explicit confirmation, not its existing local conversations. Local tasks retain the snapshot and display name needed to understand past work; their live workflow reference may become absent. Deleting a task requires settling active operations and references before removing its managed artifacts. Revoking a grant prevents future use but does not falsify a previously confirmed action.

## Existing implementation boundary

The current source has task-ledger/engine stores and a task-addressed product port in `apps/companion/src/main/codex`. Runtime owns existing browser/session state. Those are implementation foundations, not a requirement to encode the entire new domain inside one session record or create a parallel authoritative task state machine. See [architecture](system-architecture-and-transactions.md) and [data model](relational-data-model.md).
