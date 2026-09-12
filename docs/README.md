# Rove documentation

Rove is a task and workflow assistant. These documents describe the product being built, the design that should serve it, and how changes are verified. Rove has not shipped a production release. Document titles and filenames identify their subject, not a product version, implementation milestone, phase, gate, or ticket.

## Authority and reading order

The [Product Brief](Products/product-brief.md) establishes purpose. The [Product Direction](Products/product-direction.md) records the agreed scope, including portable workflow setup and device-local tasks. The documents below make that direction actionable; they do not silently expand it.

| Document                                                                                            | Responsibility                                                                                |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [Platform Policy](Products/platform-policy.md)                                                      | Product invariants, permission boundaries, persistence scope, and change policy.              |
| [Product Operating Model](Products/product-operating-model.md)                                      | What users can do, task continuity, attention, modes, and representative journeys.            |
| [Logical Domain Model](Engineering/logical-domain-model.md)                                         | Concepts, relationships, ownership, and lifecycle distinctions.                               |
| [System Architecture and Transactional Design](Engineering/system-architecture-and-transactions.md) | Component boundaries, consistency, action dispatch, and recovery.                             |
| [Relational Data Model](Engineering/relational-data-model.md)                                       | Target storage responsibilities, constraints, local/portable separation, and migration rules. |
| [Technology Stack](Engineering/technology-stack.md)                                                 | Retained choices, qualified dependencies, alternatives, and unresolved provider bindings.     |
| [Application and Capability Contracts](Engineering/application-and-capability-contracts.md)         | Local commands/queries, model integration, capability operations, errors, and authorization.  |
| [Events and Live State](Engineering/events-and-live-state.md)                                       | Durable facts, streaming presentation, ordering, resubscription, and replay boundaries.       |
| [Security and Authentication](Engineering/security-and-authentication.md)                           | Rove identity, Codex connection, device secrets, untrusted input, and data disclosure.        |
| [Workflow Context and Portability](Engineering/workflow-context-and-portability.md)                 | Guided setup, context assembly, curated knowledge, and limited synchronization.               |
| [Browser Control and Recording](Engineering/browser-control-and-recording.md)                       | Task-owned pages, shared resources, perception, handoff, capture, and requested video.        |
| [Testing and Operations](Engineering/testing-and-operations.md)                                     | Executable checks, acceptance scenarios, packaging, recovery, backup, and evidence.           |

There is no partner-facing platform API commitment. The usual API/Partner Integration document is therefore replaced by application and capability contracts. A separate distributed realtime platform, technical workflow engine, and product release-version documents are unnecessary. Small design rationales belong with the responsible document rather than in a second, competing architecture collection.

## Design is not implementation status

The engineering documents specify target behavior. Existing code supplies reusable foundations but has not thereby been certified to satisfy the new product model. A rename, passing regression test, or updated document is not proof that workflow portability, lazy browser attachment, or browser-group concurrency has been implemented.

The bounded task-lifecycle correction was implemented from baseline `3f9d74bb011b52caf92bd857a8fd8922eb3b7a8f`. Ordinary model tasks can now start and continue without a Runtime session or browser identity; a task-scoped MCP capability attaches one correlated Runtime/browser session only when browser work is requested. Browser loss does not close the Codex conversation, Stop interrupts only the active turn, and launch/message admission checks the live host account and selected model before durable task acceptance. Existing browser-backed tasks retain their stored session capability compatibility and exact task/thread/session routing.

This is implementation evidence for task independence and lazy browser attachment only. It does not certify workflow portability, page-group concurrency, account/workflow synchronization, requested video capture, or a replacement UI/browser stack. Existing local task and execution stores remain device-local product state, not a workflow synchronization service.

## Decisions still requiring implementation evidence

The account/workflow-sync provider, browser-group implementation, exact video-capture adapter, and any replacement UI or browser library remain bounded implementation choices. Their required behavior is specified here. Do not adopt the earlier full task-sync proposal, move credentials to the cloud, or add another agent framework merely to complete those choices.

## Repository maintenance

See [Contributing](../CONTRIBUTING.md) for semantic naming, migration compatibility, and checks. [Agent instructions](../AGENTS.md) apply to coding agents. Test fixtures live under `tests/fixtures`, executable investigations under `experiments`, and generated reports under ignored `artifacts/`. Historical documents and screenshots are recoverable through Git history; they are not a second source of current product requirements.

External references are primary documentation checked on 12 September 2026. They explain dependency behavior, not measured Rove reliability. Dependency versions in the lockfile and generated upstream contracts are technical compatibility information, not Rove product editions.
