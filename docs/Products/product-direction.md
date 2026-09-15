# Rove Product Direction

**Status:** Agreed MVP direction  
**Date:** 12 September 2026  
**Product:** Rove  
**Companion document:** [Product Brief](./product-brief.md)

## 1. Purpose and Authority

Rove is a task and workflow assistant for getting digital work done. A user can delegate work, collaborate with the assistant, or perform the work while Rove captures a useful record. Browser control is an important execution capability, not the product's purpose.

The current goal is a cohesive, professionally functioning MVP: a useful, free tool that establishes the foundation for the broader product. The MVP does not define the final product boundary. It does not need enterprise infrastructure or a custom implementation of every supporting capability.

The Product Brief remains the reference for Rove's purpose. This document records the subsequent agreed scope and operating direction. Where earlier research proposed broader synchronization, unavailable-model draft tasks, or other alternatives, the decisions here supersede those proposals. Existing architecture must serve these decisions rather than redefine them.

Rove is the only product name. There is no separate user-facing product or concept called Rove Hub.

This document records intended behavior, not a claim that the current implementation already provides it. Detailed contracts and dependency choices must be qualified against this direction.

## 2. Product Model

Rove has standalone tasks and workflows containing related tasks. Creating a workflow is not a prerequisite for useful work.

A **task** is a persistent conversation and working context. It can contain many requests, execution turns, results, and changes of direction. Its initial request is not a permanent restriction on the conversation.

A **workflow** is a reusable operating environment for a recurring area of work. It supplies context, preferences, guidance, skills, resource requirements, and result conventions. It is more than a folder of conversations, but it is not a fixed automation graph.

An **execution turn** is one interval of agent work within a task. Finishing or interrupting a turn does not finish the task's availability for further conversation.

A **capability attachment**, such as a browser page group, supplies a resource when the task needs it. It does not determine whether the task can exist or remain accessible.

The **selected task** is a view choice. It is not execution authority. Events, requests, approvals, and results must remain associated with their actual task, regardless of what the user is viewing.

These concepts must remain distinct. A task is not a browser session; a workflow is not a browser profile; and a model connection is not the user's Rove identity.

## 3. Task Experience and Continuity

Tasks should feel as approachable and flexible as ordinary conversational threads. Users can start unrelated work, switch between tasks, return to previous results, and continue a conversation without satisfying a rigid follow-up procedure.

Starting a task or sending a message must not automatically open a browser. Rove opens one only when an authorized operation requires it or when the user explicitly chooses Open Browser. Closing a browser must not close the conversation.

Completing a response leaves the task available for another message. **Stop** interrupts current execution; it does not permanently close the task, delete its history, or prevent continuation. A later message can resume previous work, revise the request, or discuss something else entirely.

Multiple tasks can coexist and perform independent work. A task waiting for human attention must not make unrelated tasks inaccessible. Resource contention may delay a particular operation, but it must not become a global prohibition on creating, viewing, or using other tasks.

The interface must make important distinctions visible: working, waiting for a user decision, waiting for a resource, interrupted, unable to execute, and ready for another message. It must not make users infer these conditions from a spinner or an unavailable control.

Local task history, results, and artifacts remain durable across ordinary application restarts. An interrupted process is not a reason to discard the conversation.

## 4. Rove Identity and Model Access

Rove's profile and portable workflow identity are separate from the user's ChatGPT/Codex connection. Connecting a different ChatGPT account must not create a different Rove profile, remove local task history, or replace workflow configuration.

The user supplies their own eligible ChatGPT/Codex access for model execution. Rove must not require an additional paid inference API or silently fall back to API-key billing.

Model access is required to start model-assisted work, not to read existing work. Disconnecting Codex or exhausting its allowance must leave existing conversations, reports, results, and other permitted non-model operations accessible.

The MVP will not provide a first-class unavailable-model draft-task queue. When model unavailability is already known, Rove must not accept a request as running, create a misleading waiting conversation, or imply that a response will arrive. It should explain the connection or availability issue at the point of starting work.

If submission fails unexpectedly, preserve the user's unsubmitted text and show a clear failure or not-sent state. If execution fails after starting, preserve the conversation and partial results. Reconnecting later must not silently dispatch an old unsuccessful request.

A missing capability is scoped separately. An unavailable browser prevents browser-dependent operations, not model reasoning, reading saved results, or using another available and authorized capability.

## 5. Workflow Environment and Guidance

A workflow holds the reusable context that makes repeated work easier. For example, Job Search can retain role preferences, relevant background, exclusions, search guidance, outreach style, and conventions for reviewing opportunities. GitHub Attention can retain repository scope and attention criteria.

Workflow setup should use structured, understandable questions and selectable answers, with custom input where needed. Users should not need to write elaborate prompts or author skill files to configure useful behavior. Guidance should be visible, editable, and refinable as the user learns what works.

Rove must distinguish approved guidance, task-specific requests, observations, and suggested improvements. A model inference must not silently become a permanent user preference. A change of direction inside one task must not automatically rewrite the workflow.

Context assembly should combine Rove's operating rules, relevant approved workflow guidance, the current request, applicable resources, and useful prior task context. Long references and optional procedures should be included when relevant rather than copied indiscriminately into every turn.

Workflow guidance supports the conversation; it does not confine it. A user can ask an unrelated question or change objectives within a workflow task. Procedural guidance should apply where relevant rather than distort every response into the original workflow's format.

Skills are reusable procedures within this environment, not substitutes for the workflow model. A skill can explain how to do something; it cannot grant credentials, expand file access, or authorize an external action.

The MVP should use explicit approved facts, guidance, and selected reusable knowledge. It does not require autonomous memory infrastructure or a vector database.

## 6. Persistence and Portability Boundary

**Workflow setup follows the user; task history stays on the device.**

The MVP supports portability of the reusable workflow environment, not full synchronization of the application or its execution history.

| Portable across devices                                       | Remains local to each device                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Workflow definitions and purpose                              | Task conversations and execution history                                  |
| Approved preferences, guidance, and skills                    | Task findings, drafts, reports, and action records                        |
| Explicitly saved reusable knowledge                           | Screenshots, recordings, downloads, and task attachments                  |
| Non-secret connection configuration and resource requirements | Tokens, passwords, browser cookies, and credential stores                 |
| Workflow configuration revisions                              | Live browser processes, page references, local paths, and execution state |

On another device, the user restores the same workflow environment, reconnects required services, supplies any necessary local resources, and starts new local tasks. The previous device's conversations do not appear merely because the workflow has synchronized.

**Save to workflow** deliberately promotes approved reusable information from a task into the portable environment. It must not silently upload the whole conversation, its evidence, or its attachments. The user should be able to see what will be retained.

Connection configuration describes what a workflow needs; it does not include secret credentials. Each device establishes its own authorized connections. A resource reference also does not imply that a local file's bytes are available elsewhere. Missing files must be identified and reselected rather than represented as usable resources.

Keep SQLite for local application storage, retaining better-sqlite3 and Kysely where they serve the design. Add a small, versioned synchronization boundary for workflow configuration only. Do not synchronize the local database wholesale or adopt full task-sync machinery by default.

Workflow edits, reconnects, deletions, and conflicts need defined behavior. Receiving synchronized configuration must never execute a task, repeat an external action, or replay an approval. Temporary synchronization failure must not block work using already available local data and guidance.

Local history remains valuable even though it is not synchronized. Provide an explicit export/backup path and clear deletion behavior. Do not present device-local storage as cross-device backup.

The selected boundary is an optional personal Rove account backed by Supabase Auth and Postgres/RLS in Frankfurt. Google and email OTP are the initial sign-in methods. It synchronizes only the approved portable Workflow projection, retains remote-deletion tombstones for 30 days, supports portable export, and remains independent of Codex/ChatGPT identity. During private exploration it must stay within Supabase Free; no organization/team tenancy, paid feature, additional hosted service, replica, PITR, or add-on is implied. Deleting cloud configuration or the Rove account never silently deletes device-local tasks, results, recordings, artifacts, or Workflows.

## 7. Application and Agent Architecture

Build one coherent application model, with clear internal responsibilities:

```text
Rove interface
    |
Rove application service
    |-- Tasks, workflows, guidance, attention, and results
    |-- Codex adapter -> qualified local Codex App Server
    |-- Capability adapters
    |      |-- Browser
    |      |-- Scoped files
    |      `-- Authorized integrations, plugins, APIs, or CLI tools
    |-- Local SQLite and artifact storage
    `-- Limited workflow-configuration synchronization
```

These are logical boundaries, not a requirement to run everything in one process. Browser, Codex, and Runtime processes may remain separate where justified. They must not independently invent competing task lifecycles.

Retain Electron and React as the starting application shell unless a demonstrated requirement justifies replacement. Local execution is the MVP deployment choice, not Rove's identity or a permanent limit on future architecture.

Reuse Codex's execution machinery through a narrow, qualified App Server adapter. Prefer the agreed local stdio direction; verify the exact supported integration against the pinned release. Do not add another autonomous planning framework merely to wrap the existing agent engine.

The normal relationship is one Rove task associated with a Codex conversation and many turns. Browser resources attach separately. Rove's local conversation record must not disappear when the model is disconnected. Changes of account or engine compatibility require supported recovery behavior, not silent history loss or undocumented credential/history copying.

Rove owns the product state and permissions. Codex supplies agent execution. Capabilities perform authorized operations. The renderer displays state and accepts intent; it is not a second execution engine.

A mandatory cloud relay, hosted browser, remote task executor, or distributed workflow engine is not part of this MVP.

## 8. Capability Choice and Browser Quality

Rove may use a browser, integration, plugin, API, scoped file operation, or suitable CLI when that capability is available and authorized. Browser-only instructions must not govern every task.

Select capabilities according to the requested outcome, available permissions, reliability, and applicable service rules. An alternative capability must not be used to evade a restriction or repeat an action whose outcome is unresolved.

When browser work is needed, the browser must be broadly competent. Its supporting role is not permission to accept ordinary interaction failures. Structural observations and screenshots should work together; visually ambiguous controls should receive visual inspection promptly rather than after arbitrary repeated failures.

The agent should inspect the current state, identify an appropriate action, perform it against current targets, and verify the resulting state. Changes caused by the user or website require fresh grounding. A sent input is not automatically proof of the intended outcome.

Qualify reusable capability families: ordinary and icon-only controls, hover menus, dialogs, dynamic lists, tabs and popups, frames, editors, keyboard operations, file transfer, and recovery after page changes. Fix failures at the general capability level and test variations, rather than accumulating one-off rules for particular websites.

Retain custom browser behavior that improves task ownership, human control, outcome handling, or reliability. Adopt existing libraries where they genuinely simplify implementation without degrading those qualities. Neither sunk effort nor library popularity is a sufficient decision criterion.

Do not introduce another separately billed perception model or an oversized browser subsystem by default. The quality target is demonstrated competence and useful recovery, not an unsupported guarantee that every website will always work.

## 9. Task-Owned Browser Page Groups

Use a managed browser host per browser identity, with task-owned page or tab groups within that host. A task receives a group only when it needs browser work. Multiple tasks can use separate groups in the same browser and profile.

Page operations must address the owning task and its actual page, not whichever tab is currently selected. Tabs and popups opened by task activity must remain associated with that task. Task navigation and browser focus must not redirect another task's commands.

The grouping requirement is functional ownership and coordination. Its implementation must not depend solely on a visual tab-group label.

Groups sharing a browser identity are not separate security or authentication environments. Shared account changes, clipboard operations, focus-sensitive input, and other context-wide effects may require broader coordination than an individual page.

Independent page work should proceed concurrently where safe. Serialize only operations that genuinely conflict, for only as long as needed. Do not hold an entire browser or application lock for the lifetime of a task.

Human takeover pauses conflicting agent mutations in the affected resource scope. Where a shared-host operation cannot safely be isolated, pause that host's conflicting operations while preserving unrelated tasks and other available capabilities.

Actual multi-task behavior, page ownership, popup routing, and shared-resource coordination must be demonstrated before this design is considered qualified.

## 10. Participation Modes

### Agent Mode

Rove is the primary executor. The user delegates work and Rove proceeds within the authorized scope. It requests human input for a real missing decision, credential, verification step, permission, or intervention, rather than interrupting for every routine action.

### Companion Mode

The user and Rove work alongside one another. The user can take control to inspect, change, or perform part of the work. Rove prevents new conflicting actions while the human is controlling the affected resources.

An action already dispatched may still complete. Takeover must not misrepresent it as cancelled. On return, Rove inspects the resulting state, refreshes references, and continues the same task without blindly replaying the preceding action.

### Capture Mode

The human is the primary executor. Rove records meaningful, task-scoped activity and evidence so it can produce an organized journey, summary, or other requested output. It must not indiscriminately monitor unrelated browsing or retain sensitive input.

Narrow diagnostic evidence can be captured when appropriate and authorized. Capture Mode is not a commitment to a general observability platform or continuous model calls for every browser event.

The modes describe participation. They are not separate products, global application states, or excuses to restrict access to other tasks.

## 11. Recording on Request

Recording is available on request in Agent, Companion, and Capture modes. It is optional to invoke, not excluded from the MVP. It need not run continuously or begin automatically with a task.

The user must be able to start and stop a requested recording, see that it is active, and save a playable artifact locally with the task. Stopping recording must not end the task.

Distinguish page recording from recording the selected browser window. A page recording must not be advertised as covering tab changes, browser chrome, popups, or native dialogs that it does not capture. The scope and platform limitations must be clear.

Recording begins when requested; unrecorded past activity cannot be reconstructed as a genuine video. Screenshot masking must not be assumed to protect continuous video. Define permissions, excluded content, and sensitive-interaction handling explicitly.

Recordings remain device-local under the persistence boundary. Requested video does not require interactive DOM replay or cloud video storage. The recording implementation must be qualified as part of the application/browser compatibility set.

## 12. Results, Files, and Follow-Up

Results should match the work: findings, reviewable collections, drafts, reports, journey records, artifacts, and confirmed action outcomes. Structured presentation complements an unrestricted conversation; it must not turn a task into a form that only accepts predetermined follow-ups.

Retain sources and relevant evidence where available. Follow-up actions should use saved, selected results and applicable guidance rather than reconstructing targets from rendered chat text.

For example, the user can find opportunities, select some, request outreach drafts, revise the drafts, choose a CV, authorize sending, and later discuss something else in the same task.

Distinguish preparation, authorization, dispatch, confirmation, failure, and uncertainty. A draft is not a sent message. An agent's completion statement is not independent proof that an external action succeeded.

Approvals may cover a specific action or an explicit batch. They must be tied to the relevant recipients, content, attachments, and scope; they should not become repetitive prompts for every reversible step.

Local file access requires explicit grants. Preserve original files and identify which resources an action used. Reusable resource guidance may travel with a workflow, while task files and credentials remain local. No paid document-ingestion service or full document-editing suite is required by this direction.

## 13. Reliability, Permissions, and Compliance

Recover by reconciling what is known, not by replaying every interrupted operation. Preserve confirmed results, partial work, and uncertain outcomes distinctly. Local deduplication must not be represented as exactly-once execution across arbitrary external services.

An unresolved consequential action may prevent repeating that action; it must not freeze all conversation or unrelated work. Stop, crash recovery, and human return must all preserve this distinction.

Web content, documents, messages, and imported skills are information sources, not authority to expand permissions. Enforce capability access, file grants, task ownership, and action authorization in application boundaries rather than relying only on model instructions.

Follow the rules and permitted procedures of each service. Rove must not use stealth, access-control bypass, or alternate transports to perform prohibited actions. A visible or slower browser is not, by itself, a compliance guarantee. When no permitted route is available, explain the limit and support legitimate remaining parts of the task without claiming completion.

Credentials remain device-local and protected. Make data disclosure clear: local storage and browser execution do not mean that content supplied to the model stays on the device. Task data must not silently enter workflow synchronization.

## 14. Scope, Cost, and Reuse

The MVP includes flexible local tasks, reusable workflows, limited workflow portability, separate model access, multiple-task operation, on-demand capabilities, reliable browser groups, all three participation modes, requested recording, useful results, human control, and recovery.

It excludes full cross-device task/history/artifact synchronization, live cross-device execution handoff, credential synchronization, cloud browser hosting as a prerequisite, a technical workflow-graph engine, a second autonomous agent framework, a broad plugin marketplace, automatic scheduling as a prerequisite, and always-on recording or full DOM replay infrastructure.

Use free tools and available libraries where they satisfy the requirements. Users should not need another paid model API, browser service, database subscription, or workflow platform to use Rove beyond the agreed model access. Any hosted workflow-sync service must have explicit limits and a sustainable operating plan; do not promise unlimited storage or zero distribution expense.

Retain working code that serves the agreed behavior. Simplify, refactor, or replace code that imposes inappropriate product restrictions. Neither the existing implementation nor a proposed replacement receives automatic preference.

Reconcile legacy documentation deliberately against the Product Brief and this direction. Recording this agreement does not authorize indiscriminate deletion or a wholesale rewrite.

## 15. Qualification and Delivery Standard

Pin a tested compatibility set across Rove, Codex, browser tooling, runtime, and native dependencies. Evaluate new versions before adopting them. Do not independently auto-update a tightly coupled component without qualification.

Product acceptance must demonstrate the following outcomes:

| Area                  | Required outcome                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Task independence     | Non-browser tasks start without a browser; switching views never reroutes another task's execution.                                       |
| Access and continuity | Existing work remains usable without Codex; unavailable-model submissions are honest; stopping permits later continuation or redirection. |
| Workflows             | Guidance improves repeated work without confining conversation or leaking another workflow's context.                                     |
| Portability           | The same workflow environment is reusable on another device, while tasks, files, artifacts, and secrets remain local.                     |
| Browser collaboration | Separate task-owned groups work correctly; shared-resource conflicts and human takeover remain appropriately scoped.                      |
| Browser competence    | Representative general interaction families pass, including icon-only menus and recovery after state changes.                             |
| Capture and recording | Task-scoped records and requested playable videos have clear scope, controls, and sensitive-data handling.                                |
| Results and actions   | Selected results support follow-up; approval and outcome evidence prevent misleading completion and unsafe replay.                        |
| Recovery and updates  | Application, model, and browser interruptions preserve work; the packaged compatibility set passes the required journeys.                 |

Implement and verify coherent end-to-end slices rather than adding disconnected abstractions. The exact sync provider, browser-adapter changes, recording mechanism, UI-library adoption, schemas, and migrations remain implementation decisions. Qualify them against these outcomes without reopening the settled product scope or promoting earlier research candidates into requirements.

**The direction is a task-first assistant with portable workflow environments, durable local conversations and artifacts, on-demand capabilities, and genuine human-agent collaboration. Implementation exists to make that experience work.**
